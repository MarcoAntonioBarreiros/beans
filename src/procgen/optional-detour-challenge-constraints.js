// Desafios como RESTRIÇÕES — Checkpoint T1
// ========================================
//
// No B2 cada desafio era uma mini-fase pronta: `buildGeometry()` devolvia
// plataformas já posicionadas e o compositor só encaixava blocos lado a lado.
// A consequência era estrutural — a silhueta da rota era a soma de três blocos
// autocontidos, e o fosfato sempre desenhava a mesma aproximação → depósito →
// destino, independentemente do relevo à volta.
//
// Aqui o desafio não desenha nada. Ele declara o que precisa existir (papéis de
// nó, arestas obrigatórias, arestas proibidas, regiões interditadas, conteúdo,
// regras de validação) e o sintetizador central resolve a geometria já
// conhecendo a topologia. Por isso NENHUMA função deste módulo cria
// plataformas.
//
// Os módulos B2 continuam intactos e em uso pelo CP2: este arquivo não os
// importa nem os substitui.

import { createRandom } from './random.js';

// Perfis geométricos que cada desafio aceita hospedar (§8 e §9). A zona declara
// os perfis que sabe oferecer; a interseção com esta lista é o teste de
// compatibilidade — é ela que substitui "cada desafio tem seu próprio pedaço".
export const PHOSPHATE_GEOMETRY_PROFILES = Object.freeze([
  'ridge-edge',
  'plateau-break',
  'descending-step',
  'valley-exit',
  'recovery-gate',
]);

export const MYCORRHIZA_GEOMETRY_PROFILES = Object.freeze([
  'valley-crossing',
  'ridge-break',
  'rising-gap',
  'descending-gap',
  'broken-climb-gap',
]);

export const TOPOLOGY_CHALLENGE_IDS = Object.freeze(['phosphate', 'mycorrhiza']);

// Orçamento de dificuldade do T1. Fosfato e micorriza custam 2 cada, então o
// orçamento 3 é o que garante mecanicamente "exatamente um desafio biológico"
// (§11) sem precisar de um `if` extra em cima da seleção.
export const T1_DIFFICULTY_BUDGET = 3;

export const CHALLENGE_DIFFICULTY_COST = Object.freeze({
  phosphate: 2,
  mycorrhiza: 2,
  movement: 1,
});

// Espaço horizontal mínimo que cada desafio precisa DENTRO da zona.
//
// Fosfato: aproximação (240) + coluna do depósito (82) + destino (220) + folga
// de interação. Micorriza: passo até a origem (>= 330) + vão bloqueado (>= 500,
// medido contra as primitivas da fase — ver MYCORRHIZA_BLOCKING_GAP_FLOOR no
// sintetizador) + destino (>= 200) + folga. O vão é grande porque precisa ser
// intransponível pela física normal — é essa a razão de a zona `challenge`
// reservar mais vão que as outras na topologia.
export const CHALLENGE_MINIMUM_ZONE_SPAN = Object.freeze({
  phosphate: 620,
  mycorrhiza: 1180,
  movement: 300,
});

// Limite do RUNTIME, não escolha de autoria: `findBridgeTarget` em
// mycorrhiza-structures.js usa `maximumVerticalOffset = horizontalOnly ? 68`,
// e a Fase 10 cai em MYCORRHIZA_BRIDGE_DEFAULTS (horizontalOnly: true). Uma
// ponte com desnível maior que isto simplesmente nunca é construída em jogo.
export const MYCORRHIZA_RUNTIME_VERTICAL_LIMIT = 68;
// Mesmo runtime: `horizontalGap(source, target) >= 58`.
export const MYCORRHIZA_RUNTIME_MINIMUM_GAP = 58;

function intersectProfiles(zone, challengeProfiles) {
  const allowed = new Set(zone?.allowedChallengeProfiles || []);
  return challengeProfiles.filter(profile => allowed.has(profile));
}

function abilitySet(abilities) {
  return new Set(Array.isArray(abilities) ? abilities : []);
}

function organismSet(organisms) {
  return new Set(Array.isArray(organisms) ? organisms : []);
}

function zoneBudget(context) {
  const declared = Number(context?.zoneSpan);
  if (Number.isFinite(declared)) return declared;
  return Number(context?.zone?.preferredSpan) || Number(context?.zone?.minimumSpan) || 0;
}

// ---------------------------------------------------------------------------
// §8 — FOSFATO
// ---------------------------------------------------------------------------

export function createPhosphateConstraints(context = {}) {
  const { zone, abilities, organisms } = context;
  const profiles = intersectProfiles(zone, PHOSPHATE_GEOMETRY_PROFILES);
  const available = abilitySet(abilities);
  const present = organismSet(organisms);
  const budget = zoneBudget(context);
  const reasons = [];

  if (!zone) reasons.push('missing-zone');
  if (zone && !zone.challengeCapable) reasons.push('zone-not-challenge-capable');
  if (!profiles.length) reasons.push('no-compatible-geometry-profile');
  if (!available.has('phosphateSolubilization')) reasons.push('locked:phosphateSolubilization');
  if (!available.has('doubleJump')) reasons.push('locked:doubleJump');
  if (!available.has('dash')) reasons.push('locked:dash');
  if (!present.has('bacillus')) reasons.push('missing-organism:bacillus');
  if (budget < CHALLENGE_MINIMUM_ZONE_SPAN.phosphate) {
    reasons.push(`zone-span-too-small:${Math.round(budget)}`);
  }
  if (
    Number.isFinite(Number(context.difficultyBudget))
    && CHALLENGE_DIFFICULTY_COST.phosphate > Number(context.difficultyBudget)
  ) {
    reasons.push('difficulty-budget-exceeded');
  }

  return {
    challengeId: 'phosphate',
    family: 'phosphate-solubilization',
    compatible: reasons.length === 0,
    incompatibilityReasons: reasons,
    difficultyCost: CHALLENGE_DIFFICULTY_COST.phosphate,
    minimumZoneSpan: CHALLENGE_MINIMUM_ZONE_SPAN.phosphate,

    // Papéis que o sintetizador precisa materializar. `challenge-approach` é a
    // região acessível ANTES do bloqueio e `challenge-target` é a região depois
    // dele; o depósito fica entre as duas, por construção.
    requiredNodeRoles: Object.freeze([
      'challenge-approach',
      'challenge-target',
    ]),

    requiredEdges: Object.freeze([
      Object.freeze({
        id: 'phosphate-gate',
        fromRole: 'challenge-approach',
        toRole: 'challenge-target',
        role: 'biological-gate',
        traversalRequirement: 'phosphateSolubilization',
        blockedUntil: 'phosphate-deposit-broken',
        intentionalGap: 'phosphate-deposit-blocker',
        // Depois de o depósito cair, a aresta tem de ser saltável pela física
        // normal — senão o desafio vira um beco sem saída.
        physicallyTraversableWhenUnblocked: true,
      }),
    ]),

    // Nada pode contornar o depósito: nem conector, nem plataforma de
    // movimento, nem sobra de zona.
    forbiddenEdges: Object.freeze([
      Object.freeze({
        id: 'phosphate-bypass',
        toRole: 'challenge-target',
        exceptFromRole: 'challenge-approach',
        reason: 'no-alternative-path-around-deposit',
      }),
    ]),

    occupiedRegionRules: Object.freeze([
      Object.freeze({
        id: 'deposit-column',
        kind: 'forbid-platforms-and-connectors',
        anchorRole: 'challenge-approach',
        // A coluna sobe além do depósito: sem isso, um degrau colocado ACIMA
        // do bloco permitiria pular por cima e o "bloqueio" seria decorativo.
        anchor: 'approach-right-edge',
        offsetLeft: -70,
        offsetRight: 12,
        heightAbove: 380,
      }),
    ]),

    contentRules: Object.freeze([
      Object.freeze({
        id: 'bacillus-before-deposit',
        type: 'authored-beneficial-colony',
        organism: 'bacillus',
        anchorRole: 'challenge-approach',
        placement: 'before-deposit',
        xRatio: 0.28,
      }),
      Object.freeze({
        id: 'phosphate-deposit',
        type: 'phosphate-deposit',
        hostRole: 'challenge-approach',
        destinationRole: 'challenge-target',
        difficulty: 'hard',
        initialState: 'blocked',
      }),
    ]),

    biologicalValidationRules: Object.freeze([
      'depositInitiallyBlocked',
      'depositRequiresSolubilization',
      'bacillusBeforeDeposit',
      'bacillusReachableWithoutDeposit',
    ]),

    physicalValidationRules: Object.freeze([
      'approachReachableFromPreviousZone',
      'interactionSpaceOnApproach',
      'targetReachableOnlyAfterDeposit',
      'noPlatformCrossesDeposit',
      'noBypassAboveDeposit',
    ]),

    preferredGeometryProfiles: Object.freeze(profiles),
  };
}

// ---------------------------------------------------------------------------
// §9 — MICORRIZA
// ---------------------------------------------------------------------------

export function createMycorrhizaConstraints(context = {}) {
  const { zone, abilities, organisms } = context;
  const profiles = intersectProfiles(zone, MYCORRHIZA_GEOMETRY_PROFILES);
  const available = abilitySet(abilities);
  const present = organismSet(organisms);
  const budget = zoneBudget(context);
  const reasons = [];

  if (!zone) reasons.push('missing-zone');
  if (zone && !zone.challengeCapable) reasons.push('zone-not-challenge-capable');
  if (!profiles.length) reasons.push('no-compatible-geometry-profile');
  if (!available.has('mycorrhizaStructures')) reasons.push('locked:mycorrhizaStructures');
  if (!present.has('myco')) reasons.push('missing-organism:myco');
  if (budget < CHALLENGE_MINIMUM_ZONE_SPAN.mycorrhiza) {
    reasons.push(`zone-span-too-small:${Math.round(budget)}`);
  }
  if (
    Number.isFinite(Number(context.difficultyBudget))
    && CHALLENGE_DIFFICULTY_COST.mycorrhiza > Number(context.difficultyBudget)
  ) {
    reasons.push('difficulty-budget-exceeded');
  }

  return {
    challengeId: 'mycorrhiza',
    family: 'mycorrhiza-bridge',
    compatible: reasons.length === 0,
    incompatibilityReasons: reasons,
    difficultyCost: CHALLENGE_DIFFICULTY_COST.mycorrhiza,
    minimumZoneSpan: CHALLENGE_MINIMUM_ZONE_SPAN.mycorrhiza,

    requiredNodeRoles: Object.freeze([
      'challenge-source-root',
      'challenge-target-root',
    ]),

    requiredEdges: Object.freeze([
      Object.freeze({
        id: 'mycorrhiza-bridge',
        fromRole: 'challenge-source-root',
        toRole: 'challenge-target-root',
        role: 'biological-gap',
        traversalRequirement: 'mycorrhizaStructures',
        blockedUntil: 'mycorrhiza-bridge-built',
        intentionalGap: 'mycorrhiza-bridge-gap',
        // O vão tem de ser intransponível pela física normal: se um salto o
        // resolve, a ponte vira enfeite.
        regularTraversalMustFail: true,
        // ... e transponível pelo runtime que já existe.
        runtimeMinimumGap: MYCORRHIZA_RUNTIME_MINIMUM_GAP,
        runtimeVerticalLimit: MYCORRHIZA_RUNTIME_VERTICAL_LIMIT,
      }),
    ]),

    forbiddenEdges: Object.freeze([
      Object.freeze({
        id: 'mycorrhiza-bypass',
        toRole: 'challenge-target-root',
        exceptFromRole: 'challenge-source-root',
        reason: 'no-alternative-path-across-gap',
      }),
    ]),

    occupiedRegionRules: Object.freeze([
      Object.freeze({
        id: 'bridge-gap',
        kind: 'forbid-platforms-and-connectors',
        betweenRoles: Object.freeze(['challenge-source-root', 'challenge-target-root']),
        heightAbove: 240,
        heightBelow: 140,
      }),
    ]),

    contentRules: Object.freeze([
      Object.freeze({
        id: 'myco-before-source',
        type: 'authored-roaming-beneficial',
        organism: 'myco',
        placement: 'before-source',
        xRatio: 0.3,
      }),
      Object.freeze({
        id: 'exudate-before-gap-1',
        type: 'exudate',
        placement: 'before-source',
        xRatio: 0.72,
      }),
      Object.freeze({
        id: 'exudate-before-gap-2',
        type: 'exudate',
        anchorRole: 'challenge-source-root',
        placement: 'before-gap',
        xRatio: 0.8,
      }),
    ]),

    biologicalValidationRules: Object.freeze([
      'sourceAndTargetAreRoots',
      'preferredMycorrhizaTargetIdSet',
      'strictPreferredMycorrhizaTargetSet',
      'mycoAvailableBeforeSource',
      'atLeastTwoExudatesBeforeGap',
      'noPrebuiltBridge',
    ]),

    physicalValidationRules: Object.freeze([
      'sourceReachableFromPreviousZone',
      'regularTraversalBlocked',
      'bridgeReachableByRuntime',
      'gapFreeOfPlatformsAndConnectors',
    ]),

    preferredGeometryProfiles: Object.freeze(profiles),
  };
}

// ---------------------------------------------------------------------------
// §10 — MOVIMENTO
// ---------------------------------------------------------------------------
//
// Movimento não é um desafio selecionável no T1: ele ocupa as zonas SEM desafio
// e liga as zonas entre si. Por isso `compatible` aqui só depende das
// habilidades, e nunca de perfil geométrico.

export function createMovementConstraints(context = {}) {
  const { zone, abilities } = context;
  const available = abilitySet(abilities);
  const budget = zoneBudget(context);
  const reasons = [];
  if (!zone) reasons.push('missing-zone');
  if (!available.has('doubleJump')) reasons.push('locked:doubleJump');
  if (budget < CHALLENGE_MINIMUM_ZONE_SPAN.movement) {
    reasons.push(`zone-span-too-small:${Math.round(budget)}`);
  }

  return {
    challengeId: 'movement',
    family: 'movement',
    compatible: reasons.length === 0,
    incompatibilityReasons: reasons,
    difficultyCost: CHALLENGE_DIFFICULTY_COST.movement,
    minimumZoneSpan: CHALLENGE_MINIMUM_ZONE_SPAN.movement,

    requiredNodeRoles: Object.freeze(['zone-step']),

    requiredEdges: Object.freeze([
      Object.freeze({
        id: 'movement-chain',
        role: 'movement',
        // Quantidade DERIVADA do vão e do relevo, nunca fixa (§14).
        dynamicPlatformCount: true,
        platformCountRange: Object.freeze([1, 6]),
        // O Y é cumulativo: cada passo parte da altura real do passo anterior,
        // não de uma faixa de cruzeiro.
        cumulativeVerticalTarget: true,
        declaredPhysicsRecipes: true,
        everyEdgeValidated: true,
      }),
    ]),

    forbiddenEdges: Object.freeze([
      Object.freeze({
        id: 'movement-into-forbidden-bounds',
        reason: 'no-platform-inside-forbidden-bounds',
      }),
    ]),

    occupiedRegionRules: Object.freeze([
      Object.freeze({
        id: 'respect-challenge-regions',
        kind: 'forbid-platforms-and-connectors',
        source: 'inherited-from-challenge',
      }),
    ]),

    contentRules: Object.freeze([]),

    biologicalValidationRules: Object.freeze([]),

    physicalValidationRules: Object.freeze([
      'everyEdgeValid',
      'noOverlappingPlatforms',
      'minimalConnectors',
      // Uma fileira que ocupa todo o span é exatamente o corredor plano que o
      // B2 produzia; a sobra fica vazia de propósito.
      'noAutomaticSpanFill',
    ]),

    preferredGeometryProfiles: Object.freeze(zone?.allowedChallengeProfiles || []),
  };
}

const CONSTRAINT_FACTORIES = Object.freeze({
  phosphate: createPhosphateConstraints,
  mycorrhiza: createMycorrhizaConstraints,
  movement: createMovementConstraints,
});

export function createChallengeConstraints(challengeId, context) {
  const factory = CONSTRAINT_FACTORIES[challengeId];
  return factory ? factory(context) : null;
}

// ---------------------------------------------------------------------------
// §11 — SELEÇÃO CONDICIONADA
// ---------------------------------------------------------------------------

function deterministicShuffle(values, random) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function positionClass(order, total) {
  const ratio = total > 1 ? order / (total - 1) : 0;
  if (ratio <= 0.34) return 'early';
  if (ratio <= 0.67) return 'middle';
  return 'late';
}

/**
 * Escolhe UM desafio biológico (fosfato OU micorriza) e a zona que o hospeda.
 * Devolve uma lista ordenada deterministicamente porque o compositor tem
 * direito a duas tentativas de atribuição por topologia (§18) — a primeira da
 * lista é a escolha da seed.
 */
export function selectTopologyChallenge({
  topology,
  zones = null,
  abilities = [],
  organisms = [],
  seedValue = '',
  candidateId = 'candidate',
  zoneSpans = null,
  difficultyBudget = T1_DIFFICULTY_BUDGET,
  campaignState = null,
} = {}) {
  if (!topology) {
    return { assignments: [], rejections: ['missing-topology'] };
  }
  const pool = zones && zones.length
    ? zones
    : topology.zones.filter(zone => topology.challengeZoneIds.includes(zone.id));
  if (!pool.length) {
    return { assignments: [], rejections: ['no-challenge-capable-zone'] };
  }

  const spanOf = zone => {
    if (zoneSpans && Number.isFinite(Number(zoneSpans[zone.id]))) {
      return Number(zoneSpans[zone.id]);
    }
    return zone.preferredSpan || zone.minimumSpan || 0;
  };

  const assignments = [];
  const rejections = [];
  for (const zone of pool) {
    for (const challengeId of TOPOLOGY_CHALLENGE_IDS) {
      const context = {
        topology,
        zone,
        campaignState,
        abilities,
        organisms,
        seedValue,
        zoneSpan: spanOf(zone),
        difficultyBudget,
      };
      const constraints = createChallengeConstraints(challengeId, context);
      if (!constraints) continue;
      if (!constraints.compatible) {
        rejections.push(
          `${zone.id}:${challengeId}:${constraints.incompatibilityReasons.join('+')}`,
        );
        continue;
      }
      assignments.push({
        challengeId,
        family: constraints.family,
        zoneId: zone.id,
        zoneOrder: zone.order,
        zoneRole: zone.role,
        zoneVerticalIntent: zone.verticalIntent,
        zoneSpan: spanOf(zone),
        positionClass: positionClass(zone.order, topology.zones.length),
        geometryProfiles: constraints.preferredGeometryProfiles,
        difficultyCost: constraints.difficultyCost,
        constraints,
      });
    }
  }

  if (!assignments.length) {
    return { assignments: [], rejections };
  }

  // São DUAS escolhas, não uma (§11): primeiro o desafio, depois a zona que o
  // hospeda. Embaralhar os pares (zona, desafio) de uma vez só parecia
  // equivalente, mas não é: como o fosfato cabe em muito mais zonas que a
  // micorriza, o sorteio plano dava ao fosfato ~80% das primeiras posições e a
  // micorriza quase desaparecia do conjunto de seeds.
  const random = createRandom(
    `${seedValue}:t1-challenge:${candidateId}:${topology.id}`,
  );
  const byChallenge = new Map();
  for (const assignment of assignments) {
    const group = byChallenge.get(assignment.challengeId) || [];
    group.push(assignment);
    byChallenge.set(assignment.challengeId, group);
  }
  const challengeOrder = deterministicShuffle([...byChallenge.keys()], random);
  const ordered = challengeOrder.flatMap(challengeId => (
    deterministicShuffle(byChallenge.get(challengeId), random)
  ));
  return { assignments: ordered, rejections };
}

// ---------------------------------------------------------------------------
// §12 — GRAFO INTERMEDIÁRIO
// ---------------------------------------------------------------------------
//
// O grafo fica entre a topologia abstrata e a geometria concreta. Ele já tem
// posição, mas em FAIXAS: `xRange`, `yRange` e `widthRange` dizem onde o nó
// pode nascer, não onde ele nasce. Quem fecha os valores é o sintetizador, que
// nesse momento já conhece a física de cada aresta.

function zoneNodeRoles(zone, assignment) {
  if (assignment && assignment.zoneId === zone.id) {
    return [...assignment.constraints.requiredNodeRoles];
  }
  if (zone.role === 'entry') return ['zone-entry'];
  if (zone.role === 'drop-rejoin') return ['zone-step', 'drop-launch'];
  return ['zone-step'];
}

export function buildOptionalDetourTopologyGraph({
  topology,
  zoneSpans = [],
  challengeAssignment = null,
  entryAnchor = null,
  startX = 0,
  startY = 0,
  verticalTolerance = 46,
  widthRange = Object.freeze([150, 285]),
} = {}) {
  if (!topology) return { nodes: [], edges: [], valid: false, reason: 'missing-topology' };
  const spanById = new Map(zoneSpans.map(entry => [entry.zoneId, entry.span]));
  const nodes = [];
  const edges = [];

  if (entryAnchor) {
    nodes.push({
      id: 'anchor:access',
      role: 'access-anchor',
      zoneId: null,
      xRange: [entryAnchor.x, entryAnchor.x + entryAnchor.w],
      yRange: [entryAnchor.y, entryAnchor.y],
      widthRange: [entryAnchor.w, entryAnchor.w],
      platformType: 'root',
      metadata: { platformId: entryAnchor.platformId || entryAnchor.id, fixed: true },
    });
  }

  let cursorX = startX;
  let cursorY = startY;
  let previousNodeId = entryAnchor ? 'anchor:access' : null;

  for (const zone of topology.zones) {
    const span = Number(spanById.get(zone.id)) || zone.preferredSpan;
    const zoneLeft = cursorX;
    const zoneRight = cursorX + span;
    const [deltaMin, deltaMax] = zone.verticalDeltaRange;
    const zoneTopY = cursorY + Math.min(deltaMin, 0);
    const zoneBottomY = cursorY + Math.max(deltaMax, 0);
    const roles = zoneNodeRoles(zone, challengeAssignment);
    const isChallengeZone = Boolean(
      challengeAssignment && challengeAssignment.zoneId === zone.id,
    );

    roles.forEach((role, index) => {
      const slice = roles.length;
      const left = zoneLeft + (span / slice) * index;
      const right = zoneLeft + (span / slice) * (index + 1);
      const nodeId = `${zone.id}#${role}`;
      nodes.push({
        id: nodeId,
        role,
        zoneId: zone.id,
        xRange: [Math.round(left), Math.round(right)],
        yRange: [
          Math.round(zoneTopY - verticalTolerance),
          Math.round(zoneBottomY + verticalTolerance),
        ],
        widthRange: [...widthRange],
        platformType: role.startsWith('challenge-') && isChallengeZone ? 'root' : 'root',
        metadata: {
          verticalIntent: zone.verticalIntent,
          zoneRole: zone.role,
          zoneOrder: zone.order,
          allowedChallengeProfiles: [...zone.allowedChallengeProfiles],
          challengeId: isChallengeZone ? challengeAssignment.challengeId : null,
          // Zonas sem desafio recebem uma contagem de plataformas DERIVADA do
          // vão; o grafo só declara a faixa possível.
          dynamicPlatformCountRange: isChallengeZone ? [1, 3] : [1, 6],
        },
      });

      if (previousNodeId) {
        const challengeEdge = isChallengeZone
          && index === roles.length - 1
          && challengeAssignment.constraints.requiredEdges[0];
        edges.push({
          id: `${previousNodeId}->${nodeId}`,
          fromNodeId: previousNodeId,
          toNodeId: nodeId,
          role: challengeEdge ? challengeEdge.role : 'movement',
          traversalRequirement: challengeEdge
            ? challengeEdge.traversalRequirement
            : 'normal-primitives',
          blockedUntil: challengeEdge ? challengeEdge.blockedUntil : null,
          intentionalGap: challengeEdge ? challengeEdge.intentionalGap : null,
          forbiddenConnector: Boolean(challengeEdge),
          metadata: {
            zoneId: zone.id,
            verticalIntent: zone.verticalIntent,
            challengeId: challengeEdge ? challengeAssignment.challengeId : null,
          },
        });
      }
      previousNodeId = nodeId;
    });

    cursorX = zoneRight;
    cursorY += (deltaMin + deltaMax) / 2;
  }

  // A saída por queda é uma aresta do grafo, não um módulo colado no fim: é
  // isso que permite validá-la junto com as outras.
  nodes.push({
    id: 'anchor:rejoin',
    role: 'rejoin-anchor',
    zoneId: null,
    xRange: [Math.round(cursorX), Math.round(cursorX)],
    yRange: [Math.round(cursorY), Math.round(cursorY)],
    widthRange: [...widthRange],
    platformType: 'primary',
    metadata: { fixed: true },
  });
  if (previousNodeId) {
    edges.push({
      id: `${previousNodeId}->anchor:rejoin`,
      fromNodeId: previousNodeId,
      toNodeId: 'anchor:rejoin',
      role: 'drop-rejoin',
      traversalRequirement: 'free-fall',
      blockedUntil: null,
      intentionalGap: 'drop-rejoin',
      forbiddenConnector: true,
      metadata: { zoneId: topology.zones.at(-1)?.id || null },
    });
  }

  return { nodes, edges, valid: true, reason: null };
}
