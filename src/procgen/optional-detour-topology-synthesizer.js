// Sintetizador central da rota opcional — Checkpoint T1
// =====================================================
//
// Este é o ponto em que o T1 deixa de parecer com o B2. No B2 cada desafio
// devolvia a própria geometria e o compositor colava blocos: o resultado era
// previsível porque ninguém tinha uma visão do conjunto. Aqui existe UM
// sintetizador que recebe a topologia (silhueta), o desafio escolhido e as
// restrições dele, e só então cria plataformas, raízes, vãos, larguras,
// posições, sockets e a preparação da queda — tudo com a mesma informação na
// mão.
//
// Regras estruturais desta etapa:
//   * `HARD_PHOSPHATE_GATE_MODULE.buildGeometry()` e
//     `HARD_MYCORRHIZA_GAP_MODULE.buildGeometry()` NÃO são chamados aqui. O que
//     se reaproveita deles é o runtime, os contentRequests e a materialização.
//   * nada de `Math.random()`: toda decisão sai de `createRandom(seed)`.
//   * o sintetizador não escreve em `level`; devolve o que produziu e o
//     compositor decide empurrar ou descartar.

import { materializeOptionalDetourContent } from './optional-detour-content.js';
import {
  AZO_LATERAL_ACCESS_MODULE,
  createOptionalDetourPlatform,
  HARD_MOVEMENT_RECIPES,
} from './optional-detour-modules.js';
import {
  buildOptionalDetourTopologyGraph,
  MYCORRHIZA_RUNTIME_MINIMUM_GAP,
  MYCORRHIZA_RUNTIME_VERTICAL_LIMIT,
  selectTopologyChallenge,
} from './optional-detour-challenge-constraints.js';
import {
  allocateTopologyZoneSpans,
  generateOptionalDetourTopology,
  optionalDetourTopologyFamilyOrder,
  topologyChallengePositionClass,
  validateOptionalDetourTopology,
} from './optional-detour-topology.js';
import {
  chooseAccessLanding,
  cruiseLaneY,
} from './optional-detour-builder.js';
import {
  collectOptionalDetourCandidates,
  OPTIONAL_DETOUR_AUTHORED_ENCOUNTER_SPACING,
  primaryRouteGeometryHash,
} from './optional-detour-planner.js';
import { canTraverseEdge } from './traversal-edge-physics.js';
import { createRandom } from './random.js';

const PLATFORM_HEIGHT = 54;
// Altura do bloco de fosfato criado por `createPhosphateDepositAt`. Repetida
// aqui porque a coluna proibida precisa ser calculada ANTES de o depósito
// existir.
const DEPOSIT_HEIGHT = 210;
const DEPOSIT_WIDTH = 58;
const DEPOSIT_RIGHT_INSET = 64;
// Separação mínima entre uma plataforma da rota opcional e a plataforma da rota
// principal logo abaixo dela. NÃO é o MIN_PRIMARY_CLEARANCE (210) do builder:
// aquele vale para o pouso de acesso, que precisa caber no enquadramento da
// câmera. Aqui o requisito é só não encostar — a rota opcional do B2 também
// passa perto da principal em vários trechos, e exigir 170 px reprovava
// candidatos que o B2 aceita.
const PRIMARY_SEPARATION = 48;
const OVERLAP_MARGIN = 10;

export const T1_ATTEMPT_LIMITS = Object.freeze({
  topologies: 3,
  challengeAssignmentsPerTopology: 2,
  synthesesPerAssignment: 3,
  get maximumPerCandidate() {
    return this.topologies
      * this.challengeAssignmentsPerTopology
      * this.synthesesPerAssignment;
  },
});

// Medido contra as primitivas reais da Fase 10 (`canTraverseEdge` varrendo vãos
// de 200 a 1200 px): o maior vão transponível é 430 px subindo 64, 460 px no
// plano e 480 px descendo 64. Abaixo de 500 px a "ponte obrigatória" seria
// apenas um salto difícil. O valor é o PISO da busca, não a resposta: a
// calibração continua confirmando com a física antes de aceitar o vão.
const MYCORRHIZA_BLOCKING_GAP_FLOOR = 500;

export const T1_SILHOUETTE_CONTRACTS = Object.freeze({
  minimumVerticalRange: 180,
  minimumClimbCount: 1,
  minimumDropCount: 1,
  maximumMonotonicShare: 0.65,
  maximumFlatShare: 0.55,
  maximumPlatformCoverage: 0.70,
  flatStepThreshold: 26,
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const lerp = (a, b, t) => a + (b - a) * t;

function pickInRange(random, [minimum, maximum]) {
  return lerp(minimum, maximum, random());
}

// A zona declara uma FAIXA de desnível; sortear uniformemente dentro dela fazia
// as zonas se anularem e a amplitude final ficar abaixo dos 180 px do contrato.
// Quando a intenção da zona tem sinal, o sorteio puxa para o extremo daquele
// sinal — a silhueta continua variando, mas variando longe do plano.
function zoneTargetDelta(zone, random) {
  const [minimum, maximum] = zone.verticalDeltaRange;
  const middle = (minimum + maximum) / 2;
  const bias = 0.42 + random() * 0.58;
  if (middle < -12) return lerp(maximum, minimum, bias);
  if (middle > 12) return lerp(minimum, maximum, bias);
  return lerp(minimum, maximum, random());
}

function deterministicShuffle(values, random) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function rangeDistance(value, [minimum, maximum]) {
  if (value < minimum) return minimum - value;
  if (value > maximum) return value - maximum;
  return 0;
}

function rectsIntersect(left, right, margin = OVERLAP_MARGIN) {
  return left.x < right.x + right.w + margin
    && left.x + left.w > right.x - margin
    && left.y < right.y + right.h + margin
    && left.y + left.h > right.y - margin;
}

function insideBounds(platform, bounds, margin = 6) {
  if (!bounds) return false;
  return platform.x < bounds.right + margin
    && platform.x + platform.w > bounds.left - margin
    && platform.y < bounds.bottom + margin
    && platform.y + platform.h > bounds.top - margin;
}

function usableRecipes(abilities) {
  const available = new Set(abilities);
  return HARD_MOVEMENT_RECIPES.filter(recipe => (
    (recipe.requiredAbilities || []).every(ability => available.has(ability))
  ));
}

function primitivesForRecipe(level, recipe) {
  const allowed = new Set(recipe.allowedPrimitiveIds);
  return (level.primitives || []).filter(primitive => allowed.has(primitive.id));
}

function normalPrimitives(level) {
  return (level.primitives || []).filter(primitive => (
    !(primitive.requires || []).includes('mycorrhizaStructures')
  ));
}

// ---------------------------------------------------------------------------
// COLOCAÇÃO DE UM PASSO
// ---------------------------------------------------------------------------

function primarySeparationViolated(platform, primaryRoute) {
  for (const other of primaryRoute) {
    if (
      other.x >= platform.x + platform.w
      || other.x + other.w <= platform.x
    ) continue;
    if (other.y <= platform.y) continue;
    if (other.y - (platform.y + platform.h) < PRIMARY_SEPARATION) return true;
  }
  return false;
}

/**
 * Coloca UMA plataforma à direita de `from`, escolhendo entre as receitas
 * físicas declaradas. A receita não é decoração: o vão, a largura de pouso e o
 * delta vertical saem das faixas dela, e a aresta é validada com as primitivas
 * que a receita declara. Devolve `null` quando nenhuma receita serve — e é
 * isso que faz a síntese tentar outra combinação em vez de forçar geometria.
 */
function placeStep({
  from,
  targetSpan,
  desiredDelta,
  recipes,
  level,
  random,
  context,
  idPrefix,
  moduleId,
  order,
  occupied,
  forbiddenBounds,
  corridor,
  widthOverride = null,
  minimumWidth = 0,
  section,
  zoneId,
}) {
  const gapShare = 0.48 + random() * 0.22;
  const widthJitter = random();
  const shuffled = deterministicShuffle(recipes, random);
  const ordered = [...shuffled].sort((left, right) => (
    rangeDistance(desiredDelta, left.verticalDeltaRange)
    - rangeDistance(desiredDelta, right.verticalDeltaRange)
  ));

  const attempted = [];
  for (const recipe of ordered) {
    const delta = clamp(
      desiredDelta,
      recipe.verticalDeltaRange[0],
      recipe.verticalDeltaRange[1],
    );
    const gap = clamp(targetSpan * gapShare, recipe.gapRange[0], recipe.gapRange[1]);
    const rawWidth = widthOverride ?? (targetSpan - gap);
    let width = clamp(
      rawWidth,
      recipe.landingWidthRange[0],
      recipe.landingWidthRange[1],
    );
    width = Math.round(clamp(
      width * (0.94 + widthJitter * 0.12),
      recipe.landingWidthRange[0],
      recipe.landingWidthRange[1],
    ));
    // O piso de largura (espaço de interação) tem prioridade sobre o jitter:
    // sem isto uma receita cujo pouso MÁXIMO é 200 px era descartada só porque
    // o jitter a encolhia para 188.
    if (width < minimumWidth && recipe.landingWidthRange[1] >= minimumWidth) {
      width = Math.round(recipe.landingWidthRange[1]);
    }
    if (width < minimumWidth) {
      attempted.push(`${recipe.id}:width-below-minimum`);
      continue;
    }
    const y = Math.round(clamp(from.y + delta, corridor.top, corridor.bottom));
    const x = Math.round(from.x + from.w + gap);
    const platform = createOptionalDetourPlatform(context, {
      id: `${idPrefix}`,
      moduleId,
      x,
      y,
      w: width,
      order,
    });
    platform.optionalDetourSection = section;
    platform.optionalDetourZoneId = zoneId;
    platform.movementRecipeId = recipe.id;
    platform.verticalIntent = recipe.verticalIntent;
    platform.movementGap = Math.round(gap);
    platform.verticalDeltaY = Math.round(y - from.y);
    platform.authored = true;

    if (occupied.some(other => rectsIntersect(platform, other))) {
      attempted.push(`${recipe.id}:overlap`);
      continue;
    }
    if (forbiddenBounds.some(bounds => insideBounds(platform, bounds))) {
      attempted.push(`${recipe.id}:forbidden-bounds`);
      continue;
    }
    if (primarySeparationViolated(platform, context.primaryRoute)) {
      attempted.push(`${recipe.id}:primary-separation`);
      continue;
    }
    const validation = canTraverseEdge({
      from,
      to: platform,
      primitives: primitivesForRecipe(level, recipe),
    });
    if (!validation.valid) {
      attempted.push(`${recipe.id}:edge-invalid`);
      continue;
    }
    platform.validatedPrimitiveId = validation.passingPrimitiveIds[0] || null;
    return {
      platform,
      recipe,
      gap: Math.round(gap),
      delta: platform.verticalDeltaY,
      edge: {
        from: from.platformId || from.id,
        to: platform.platformId,
        role: 'movement',
        recipeId: recipe.id,
        primitiveId: platform.validatedPrimitiveId,
        valid: true,
      },
      attempted,
    };
  }
  return { platform: null, attempted };
}

// Quantidade de plataformas DERIVADA do vão e das receitas — nunca fixa, nunca
// preenchendo automaticamente a sobra (§14).
function planStepCount(budget, recipes, random, maximum = 6) {
  if (!recipes.length) return null;
  const minimumStep = Math.min(...recipes.map(recipe => (
    recipe.gapRange[0] + recipe.landingWidthRange[0]
  )));
  const maximumStep = Math.max(...recipes.map(recipe => (
    recipe.gapRange[1] + recipe.landingWidthRange[1]
  )));
  const lower = Math.max(1, Math.ceil(budget / maximumStep));
  if (lower > maximum) return null;
  const upper = Math.max(lower, Math.min(maximum, Math.floor(budget / minimumStep)));
  return lower + Math.floor(random() * (upper - lower + 1));
}

// ---------------------------------------------------------------------------
// ZONA DE MOVIMENTO
// ---------------------------------------------------------------------------

function synthesizeMovementZone({
  zone,
  zoneRight,
  entryPlatform,
  recipes,
  level,
  random,
  context,
  orderStart,
  occupied,
  forbiddenBounds,
  corridor,
  maximumSteps = 6,
}) {
  const budget = zoneRight - (entryPlatform.x + entryPlatform.w);
  if (budget < 240) {
    return { success: false, reason: `zone-budget-too-small:${Math.round(budget)}` };
  }
  const stepCount = planStepCount(budget, recipes, random, maximumSteps);
  if (!stepCount) {
    return { success: false, reason: `zone-budget-exceeds-step-limit:${Math.round(budget)}` };
  }
  const targetDelta = zoneTargetDelta(zone, random);
  const platforms = [];
  const edges = [];
  let previous = entryPlatform;
  let accumulated = 0;
  const failures = [];

  for (let index = 0; index < stepCount; index++) {
    const remainingSteps = stepCount - index;
    const remainingBudget = zoneRight - (previous.x + previous.w);
    const remainingDelta = targetDelta - accumulated;
    const step = placeStep({
      from: previous,
      targetSpan: remainingBudget / remainingSteps,
      desiredDelta: remainingDelta / remainingSteps,
      recipes,
      level,
      random,
      context,
      idPrefix: `${context.detourId}:${zone.id}:step-${index}`,
      moduleId: 't1-movement',
      order: orderStart + index,
      occupied: [...occupied, ...platforms],
      forbiddenBounds,
      corridor,
      section: `${zone.role}-step`,
      zoneId: zone.id,
    });
    if (!step.platform) {
      failures.push(`step-${index}:${step.attempted.join('|')}`);
      return { success: false, reason: failures.join(';') };
    }
    accumulated += step.delta;
    platforms.push(step.platform);
    edges.push(step.edge);
    previous = step.platform;
  }

  return {
    success: true,
    platforms,
    edges,
    exitPlatform: previous,
    targetDelta: Math.round(targetDelta),
    realizedDelta: Math.round(accumulated),
    stepCount,
    contentRequests: [],
    intentionalGaps: [],
    forbiddenBounds: [],
  };
}

// ---------------------------------------------------------------------------
// §15 — FOSFATO DENTRO DA TOPOLOGIA
// ---------------------------------------------------------------------------

function synthesizePhosphateZone({
  zone,
  zoneRight,
  entryPlatform,
  recipes,
  level,
  random,
  context,
  orderStart,
  occupied,
  forbiddenBounds,
  corridor,
}) {
  const budget = zoneRight - (entryPlatform.x + entryPlatform.w);
  const targetDelta = zoneTargetDelta(zone, random);
  const blockerGap = Math.round(78 + random() * 14);
  const targetWidth = Math.round(218 + random() * 38);
  const approachSpan = Math.round(clamp(budget * 0.42, 380, 720));

  // 1. A aproximação é um passo normal da topologia: o desafio NÃO impõe a sua
  //    própria escada de entrada. É por isso que o depósito pode cair numa
  //    crista, numa subida, numa descida ou numa recuperação.
  const approach = placeStep({
    from: entryPlatform,
    targetSpan: approachSpan,
    desiredDelta: targetDelta * 0.62,
    recipes,
    level,
    random,
    context,
    idPrefix: `${context.detourId}:${zone.id}:phosphate-approach`,
    moduleId: 't1-phosphate-gate',
    order: orderStart,
    occupied,
    forbiddenBounds,
    corridor,
    // Espaço de interação: o jogador precisa parar diante do depósito.
    minimumWidth: 200,
    section: 'phosphate-approach',
    zoneId: zone.id,
  });
  if (!approach.platform) {
    return { success: false, reason: `phosphate-approach:${approach.attempted.join('|')}` };
  }
  const approachPlatform = approach.platform;

  // 2. A coluna do depósito. Ela é proibida a plataformas E a conectores, e
  //    sobe bem acima do bloco: sem essa altura extra bastaria um degrau acima
  //    para contornar o bloqueio, e o desafio biológico viraria enfeite.
  const depositBounds = {
    left: approachPlatform.x + approachPlatform.w - DEPOSIT_RIGHT_INSET,
    right: approachPlatform.x + approachPlatform.w - (DEPOSIT_RIGHT_INSET - DEPOSIT_WIDTH),
    top: approachPlatform.y - DEPOSIT_HEIGHT,
    bottom: approachPlatform.y,
  };
  const bypassBounds = {
    left: depositBounds.left - 70,
    right: depositBounds.right + 12,
    top: depositBounds.top - 170,
    bottom: approachPlatform.y + PLATFORM_HEIGHT,
  };

  // 3. O destino fica logo depois do bloqueio. O desnível vem da zona, mas o
  //    bloco tem 210 px: subir demais deixaria o topo do depósito abaixo do
  //    destino e abriria uma passagem por cima.
  // Três desníveis candidatos em vez de um: o relevo em volta muda de zona para
  // zona, e um único palpite reprovava a zona inteira quando a rota principal
  // passava logo abaixo do destino.
  const destinationOffsets = [
    targetDelta * 0.38 + (random() * 40 - 20),
    targetDelta * 0.18,
    -26 + random() * 22,
  ];
  let destination = null;
  let unblocked = null;
  let destinationFailure = 'phosphate-target-unplaceable';
  for (const [offsetIndex, offset] of destinationOffsets.entries()) {
    const destinationY = Math.round(clamp(
      approachPlatform.y + Math.round(clamp(offset, -40, 84)),
      corridor.top,
      corridor.bottom,
    ));
    const candidatePlatform = createOptionalDetourPlatform(context, {
      id: `${context.detourId}:${zone.id}:phosphate-target`,
      moduleId: 't1-phosphate-gate',
      x: Math.round(approachPlatform.x + approachPlatform.w + blockerGap),
      y: destinationY,
      w: targetWidth,
      order: orderStart + 1,
    });
    candidatePlatform.optionalDetourSection = 'phosphate-target';
    candidatePlatform.optionalDetourZoneId = zone.id;
    candidatePlatform.authored = true;
    candidatePlatform.phosphateGateTarget = true;

    if ([...occupied, approachPlatform].some(other => rectsIntersect(candidatePlatform, other))) {
      destinationFailure = `phosphate-target-overlap:${offsetIndex}`;
      continue;
    }
    if (primarySeparationViolated(candidatePlatform, context.primaryRoute)) {
      destinationFailure = `phosphate-target-primary-separation:${offsetIndex}`;
      continue;
    }
    // Depois de o depósito cair, a aresta precisa ser saltável: um bloqueio
    // biológico que continua intransponível é um beco sem saída.
    const traversal = canTraverseEdge({
      from: approachPlatform,
      to: candidatePlatform,
      primitives: normalPrimitives(level),
    });
    if (!traversal.valid) {
      destinationFailure = `phosphate-target-unreachable-when-unblocked:${offsetIndex}`;
      continue;
    }
    destination = candidatePlatform;
    unblocked = traversal;
    break;
  }
  if (!destination) {
    return { success: false, reason: destinationFailure };
  }

  approachPlatform.phosphateGateApproach = true;
  approachPlatform.preferredPhosphateTargetId = destination.platformId;

  const platforms = [approachPlatform, destination];
  const edges = [
    approach.edge,
    {
      from: approachPlatform.platformId,
      to: destination.platformId,
      role: 'biological-gate',
      blockedUntil: 'phosphate-deposit-broken',
      primitiveId: unblocked.passingPrimitiveIds[0] || null,
      valid: true,
    },
  ];

  // 4. Sobra da zona: passos normais, sem preencher automaticamente.
  const egress = synthesizeEgress({
    zone,
    zoneRight,
    entryPlatform: destination,
    recipes,
    level,
    random,
    context,
    orderStart: orderStart + 2,
    occupied: [...occupied, ...platforms],
    forbiddenBounds: [...forbiddenBounds, bypassBounds],
    corridor,
    sectionPrefix: 'phosphate-egress',
  });
  platforms.push(...egress.platforms);
  edges.push(...egress.edges);

  return {
    success: true,
    platforms,
    edges,
    exitPlatform: egress.exitPlatform || destination,
    challengeId: 'phosphate',
    approachPlatformId: approachPlatform.platformId,
    targetPlatformId: destination.platformId,
    depositBounds,
    bypassBounds,
    forbiddenBounds: [bypassBounds],
    blockedEdge: edges[1],
    intentionalGaps: [{
      fromPlatformId: approachPlatform.platformId,
      toPlatformId: destination.platformId,
      kind: 'phosphate-deposit-blocker',
      bounds: depositBounds,
    }],
    contentRequests: [
      {
        id: `${context.detourId}:${zone.id}:bacillus`,
        type: 'authored-beneficial-colony',
        organism: 'bacillus',
        platformId: approachPlatform.platformId,
        xRatio: 0.28,
        detourModuleId: 't1-phosphate-gate',
      },
      {
        id: `${context.detourId}:${zone.id}:phosphate-deposit`,
        type: 'phosphate-deposit',
        hostPlatformId: approachPlatform.platformId,
        destinationPlatformId: destination.platformId,
        logicIndex: approachPlatform.logicIndex,
        difficulty: 'hard',
        detourModuleId: 't1-phosphate-gate',
      },
    ],
    metrics: {
      blockerGap,
      destinationDelta: destination.y - approachPlatform.y,
      approachWidth: approachPlatform.w,
      targetWidth: destination.w,
    },
  };
}

// ---------------------------------------------------------------------------
// §16 — MICORRIZA DENTRO DA TOPOLOGIA
// ---------------------------------------------------------------------------

function synthesizeMycorrhizaZone({
  zone,
  zoneRight,
  entryPlatform,
  recipes,
  level,
  random,
  context,
  orderStart,
  occupied,
  forbiddenBounds,
  corridor,
}) {
  const budget = zoneRight - (entryPlatform.x + entryPlatform.w);
  const targetDelta = zoneTargetDelta(zone, random);
  const platforms = [];
  const edges = [];
  let order = orderStart;
  let previous = entryPlatform;

  // O portador do myco e do primeiro exsudato é uma plataforma ANTES da
  // origem. Quando a zona é folgada ela nasce dentro da própria zona; quando é
  // apertada, o papel cabe à saída da zona anterior — que já é um nó da
  // topologia. Em nenhum dos casos o desafio inventa um trecho próprio.
  // A aproximação interna só cabe quando sobra vão para ela E para o vão
  // bloqueado inteiro. Com o limiar anterior (1180) ela nascia e depois comia a
  // reserva do próprio vão — era essa a origem de `mycorrhiza-gap-does-not-fit`.
  const internalApproach = budget >= 1180 + 560;
  if (internalApproach) {
    const approach = placeStep({
      from: previous,
      targetSpan: clamp(budget * 0.26, 340, 560),
      desiredDelta: targetDelta * 0.5,
      recipes,
      level,
      random,
      context,
      idPrefix: `${context.detourId}:${zone.id}:myco-approach`,
      moduleId: 't1-mycorrhiza-gap',
      order: order++,
      occupied,
      forbiddenBounds,
      corridor,
      minimumWidth: 180,
      section: 'mycorrhiza-approach',
      zoneId: zone.id,
    });
    if (!approach.platform) {
      return { success: false, reason: `mycorrhiza-approach:${approach.attempted.join('|')}` };
    }
    platforms.push(approach.platform);
    edges.push(approach.edge);
    previous = approach.platform;
  }
  const carrier = previous;

  // O passo até a origem é dimensionado DEPOIS de reservar o vão bloqueado e o
  // destino. Dimensioná-lo por fração do que sobrava era o que produzia
  // `mycorrhiza-gap-does-not-fit`: a origem comia o espaço do próprio vão.
  const reservedForGap = MYCORRHIZA_BLOCKING_GAP_FLOOR + 60 + 210;
  const sourceSpan = clamp(
    (zoneRight - (previous.x + previous.w)) - reservedForGap,
    330,
    520,
  );
  const source = placeStep({
    from: previous,
    targetSpan: sourceSpan,
    desiredDelta: internalApproach ? targetDelta * 0.3 : targetDelta * 0.55,
    recipes,
    level,
    random,
    context,
    idPrefix: `${context.detourId}:${zone.id}:myco-source`,
    moduleId: 't1-mycorrhiza-gap',
    order: order++,
    occupied: [...occupied, ...platforms],
    forbiddenBounds,
    corridor,
    minimumWidth: 180,
    section: 'mycorrhiza-source',
    zoneId: zone.id,
  });
  if (!source.platform) {
    return { success: false, reason: `mycorrhiza-source:${source.attempted.join('|')}` };
  }
  const sourcePlatform = source.platform;
  sourcePlatform.type = 'root';
  sourcePlatform.mycorrhizaBridgeSource = true;
  sourcePlatform.strictPreferredMycorrhizaTarget = true;
  platforms.push(sourcePlatform);
  edges.push(source.edge);

  // O desnível é consequência da topologia, mas o teto é do RUNTIME:
  // `findBridgeTarget` recusa alvos com |dy| > 68 na Fase 10.
  const intentBias = zone.verticalIntent === 'climb' || zone.verticalIntent === 'recover'
    ? -1
    : (zone.verticalIntent === 'descend' || zone.verticalIntent === 'valley' ? 1 : 0);
  const verticalDelta = Math.round(clamp(
    intentBias === 0
      ? (random() * 2 - 1) * 46
      : intentBias * (18 + random() * 44),
    -(MYCORRHIZA_RUNTIME_VERTICAL_LIMIT - 4),
    MYCORRHIZA_RUNTIME_VERTICAL_LIMIT - 4,
  ));
  const targetY = Math.round(clamp(
    sourcePlatform.y + verticalDelta,
    corridor.top,
    corridor.bottom,
  ));
  const effectiveDelta = targetY - sourcePlatform.y;
  if (Math.abs(effectiveDelta) > MYCORRHIZA_RUNTIME_VERTICAL_LIMIT - 4) {
    return { success: false, reason: 'mycorrhiza-vertical-delta-out-of-runtime-range' };
  }

  const targetWidth = Math.round(196 + random() * 46);
  const maximumGap = Math.min(
    660,
    zoneRight - (sourcePlatform.x + sourcePlatform.w) - targetWidth,
  );
  if (maximumGap < MYCORRHIZA_BLOCKING_GAP_FLOOR) {
    return { success: false, reason: `mycorrhiza-gap-does-not-fit:${Math.round(maximumGap)}` };
  }
  let gap = Math.round(clamp(
    MYCORRHIZA_BLOCKING_GAP_FLOOR + random() * 90,
    MYCORRHIZA_BLOCKING_GAP_FLOOR,
    maximumGap,
  ));
  // Calibração pela física: sobe o vão até a travessia regular falhar. É o
  // oposto de "escolher um número bonito" — quem decide é `canTraverseEdge`.
  const regular = normalPrimitives(level);
  let regularTraversalBlocked = false;
  let calibrationAttempts = 0;
  while (gap <= maximumGap) {
    calibrationAttempts++;
    const probe = {
      x: sourcePlatform.x + sourcePlatform.w + gap,
      y: targetY,
      w: targetWidth,
      h: PLATFORM_HEIGHT,
    };
    const traversal = canTraverseEdge({
      from: sourcePlatform,
      to: probe,
      primitives: regular,
    });
    if (!traversal.valid) {
      regularTraversalBlocked = true;
      break;
    }
    gap += 30;
  }
  if (!regularTraversalBlocked) {
    return { success: false, reason: 'mycorrhiza-regular-traversal-not-blocked' };
  }
  if (gap < MYCORRHIZA_RUNTIME_MINIMUM_GAP) {
    return { success: false, reason: 'mycorrhiza-gap-below-runtime-minimum' };
  }

  const destination = createOptionalDetourPlatform(context, {
    id: `${context.detourId}:${zone.id}:myco-target`,
    moduleId: 't1-mycorrhiza-gap',
    x: Math.round(sourcePlatform.x + sourcePlatform.w + gap),
    y: targetY,
    w: targetWidth,
    order: order++,
  });
  destination.optionalDetourSection = 'mycorrhiza-target';
  destination.optionalDetourZoneId = zone.id;
  destination.type = 'root';
  destination.authored = true;
  destination.mycorrhizaBridgeTarget = true;
  destination.preferredMycorrhizaSourceId = sourcePlatform.platformId;
  sourcePlatform.preferredMycorrhizaTargetId = destination.platformId;

  if ([...occupied, ...platforms].some(other => rectsIntersect(destination, other))) {
    return { success: false, reason: 'mycorrhiza-target-overlap' };
  }
  if (primarySeparationViolated(destination, context.primaryRoute)) {
    return { success: false, reason: 'mycorrhiza-target-primary-separation' };
  }
  platforms.push(destination);

  const gapBounds = {
    left: sourcePlatform.x + sourcePlatform.w,
    right: destination.x,
    top: Math.min(sourcePlatform.y, destination.y) - 240,
    bottom: Math.max(sourcePlatform.y, destination.y) + PLATFORM_HEIGHT + 140,
  };

  edges.push({
    from: sourcePlatform.platformId,
    to: destination.platformId,
    role: 'biological-gap',
    blockedUntil: 'mycorrhiza-bridge-built',
    primitiveId: null,
    regularTraversalBlocked: true,
    gap,
    verticalDelta: effectiveDelta,
    valid: true,
  });

  const egress = synthesizeEgress({
    zone,
    zoneRight,
    entryPlatform: destination,
    recipes,
    level,
    random,
    context,
    orderStart: order,
    occupied: [...occupied, ...platforms],
    forbiddenBounds: [...forbiddenBounds, gapBounds],
    corridor,
    sectionPrefix: 'mycorrhiza-egress',
  });
  platforms.push(...egress.platforms);
  edges.push(...egress.edges);

  return {
    success: true,
    platforms,
    edges,
    exitPlatform: egress.exitPlatform || destination,
    challengeId: 'mycorrhiza',
    sourcePlatformId: sourcePlatform.platformId,
    targetPlatformId: destination.platformId,
    carrierPlatformId: carrier.platformId || carrier.id,
    gapBounds,
    forbiddenBounds: [gapBounds],
    blockedEdge: edges.find(edge => edge.role === 'biological-gap'),
    intentionalGaps: [{
      fromPlatformId: sourcePlatform.platformId,
      toPlatformId: destination.platformId,
      kind: 'mycorrhiza-bridge-gap',
      bounds: gapBounds,
    }],
    contentRequests: [
      {
        id: `${context.detourId}:${zone.id}:myco-roaming`,
        type: 'authored-roaming-beneficial',
        organism: 'myco',
        platformId: carrier.platformId || carrier.id,
        xRatio: 0.3,
        detourModuleId: 't1-mycorrhiza-gap',
      },
      {
        id: `${context.detourId}:${zone.id}:exudate-1`,
        type: 'exudate',
        platformId: carrier.platformId || carrier.id,
        xRatio: 0.72,
        detourModuleId: 't1-mycorrhiza-gap',
      },
      {
        id: `${context.detourId}:${zone.id}:exudate-2`,
        type: 'exudate',
        platformId: sourcePlatform.platformId,
        xRatio: 0.8,
        detourModuleId: 't1-mycorrhiza-gap',
      },
    ],
    metrics: {
      gap,
      verticalDelta: effectiveDelta,
      calibrationAttempts,
      internalApproach,
      runtimeBridgeReachable: gap >= MYCORRHIZA_RUNTIME_MINIMUM_GAP
        && Math.abs(effectiveDelta) <= MYCORRHIZA_RUNTIME_VERTICAL_LIMIT,
    },
  };
}

// Sobra da zona de desafio. Zero passos é um resultado legítimo: a sobra fica
// vazia em vez de virar fileira.
function synthesizeEgress({
  zone,
  zoneRight,
  entryPlatform,
  recipes,
  level,
  random,
  context,
  orderStart,
  occupied,
  forbiddenBounds,
  corridor,
  sectionPrefix,
}) {
  const platforms = [];
  const edges = [];
  let previous = entryPlatform;
  const budget = zoneRight - (entryPlatform.x + entryPlatform.w);
  if (budget < 340) {
    return { platforms, edges, exitPlatform: null };
  }
  const stepCount = planStepCount(budget, recipes, random, 2) || 0;
  for (let index = 0; index < stepCount; index++) {
    const remainingSteps = stepCount - index;
    const step = placeStep({
      from: previous,
      targetSpan: (zoneRight - (previous.x + previous.w)) / remainingSteps,
      desiredDelta: (random() * 2 - 1) * 34,
      recipes,
      level,
      random,
      context,
      idPrefix: `${context.detourId}:${zone.id}:${sectionPrefix}-${index}`,
      moduleId: 't1-movement',
      order: orderStart + index,
      occupied: [...occupied, ...platforms],
      forbiddenBounds,
      corridor,
      section: sectionPrefix,
      zoneId: zone.id,
    });
    if (!step.platform) break;
    platforms.push(step.platform);
    edges.push(step.edge);
    previous = step.platform;
  }
  return {
    platforms,
    edges,
    exitPlatform: platforms.length ? previous : null,
  };
}

// ---------------------------------------------------------------------------
// §19 — VALIDAÇÃO GLOBAL
// ---------------------------------------------------------------------------

function silhouetteMetrics(platforms) {
  const ys = platforms.map(platform => platform.y);
  const verticalRange = Math.max(...ys) - Math.min(...ys);
  let climbCount = 0;
  let dropCount = 0;
  const signs = [];
  const spans = [];
  for (let index = 1; index < platforms.length; index++) {
    const delta = platforms[index].y - platforms[index - 1].y;
    const span = (platforms[index].x + platforms[index].w)
      - (platforms[index - 1].x + platforms[index - 1].w);
    spans.push(Math.max(1, span));
    if (delta < -T1_SILHOUETTE_CONTRACTS.flatStepThreshold) {
      climbCount++;
      signs.push(-1);
    } else if (delta > T1_SILHOUETTE_CONTRACTS.flatStepThreshold) {
      dropCount++;
      signs.push(1);
    } else {
      signs.push(0);
    }
  }
  const totalSpan = spans.reduce((sum, value) => sum + value, 0) || 1;
  const runShare = target => {
    let best = 0;
    let run = 0;
    for (let index = 0; index < signs.length; index++) {
      if (signs[index] === target) {
        run += spans[index];
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    }
    return best / totalSpan;
  };
  const monotonicShare = Math.max(runShare(-1), runShare(1));
  const flatShare = runShare(0);
  return {
    ySequence: platforms.map(platform => Math.round(platform.y)),
    verticalRange: Math.round(verticalRange),
    climbCount,
    dropCount,
    monotonicShare: Math.round(monotonicShare * 1000) / 1000,
    flatShare: Math.round(flatShare * 1000) / 1000,
  };
}

function validateSynthesis({
  platforms,
  edges,
  metrics,
  challengeResult,
  challengeId,
  span,
  accessValid,
  dropRejoinValid,
  primaryRouteUnchanged,
}) {
  const failures = [];
  if (!primaryRouteUnchanged) failures.push('primaryRouteChanged');
  if (!accessValid) failures.push('accessInvalid');
  if (!dropRejoinValid) failures.push('dropRejoinInvalid');
  if (metrics.verticalRange < T1_SILHOUETTE_CONTRACTS.minimumVerticalRange) {
    failures.push(`verticalRangeTooSmall:${metrics.verticalRange}`);
  }
  if (metrics.climbCount < T1_SILHOUETTE_CONTRACTS.minimumClimbCount) {
    failures.push('noClimb');
  }
  if (metrics.dropCount < T1_SILHOUETTE_CONTRACTS.minimumDropCount) {
    failures.push('noDrop');
  }
  if (metrics.monotonicShare > T1_SILHOUETTE_CONTRACTS.maximumMonotonicShare) {
    failures.push(`monotonicShare:${metrics.monotonicShare}`);
  }
  if (metrics.flatShare > T1_SILHOUETTE_CONTRACTS.maximumFlatShare) {
    failures.push(`almostHorizontalRoute:${metrics.flatShare}`);
  }
  const movementEdges = edges.filter(edge => edge.role === 'movement');
  if (movementEdges.some(edge => edge.valid !== true)) {
    failures.push('invalidMovementEdge');
  }
  for (let index = 0; index < platforms.length; index++) {
    for (let other = index + 1; other < platforms.length; other++) {
      if (rectsIntersect(platforms[index], platforms[other], 0)) {
        failures.push(`overlappingPlatforms:${platforms[index].platformId}`);
        break;
      }
    }
  }
  const coverage = platforms.reduce((sum, platform) => sum + platform.w, 0)
    / Math.max(1, span);
  if (coverage > T1_SILHOUETTE_CONTRACTS.maximumPlatformCoverage) {
    failures.push(`artificialRowCoversSpan:${Math.round(coverage * 100)}`);
  }

  const forbidden = challengeResult.forbiddenBounds || [];
  const invaders = platforms.filter(platform => (
    platform.platformId !== challengeResult.approachPlatformId
    && platform.platformId !== challengeResult.targetPlatformId
    && platform.platformId !== challengeResult.sourcePlatformId
    && forbidden.some(bounds => insideBounds(platform, bounds, 0))
  ));
  if (invaders.length) failures.push('platformInsideForbiddenBounds');

  if (challengeId === 'phosphate') {
    const crossing = platforms.filter(platform => (
      insideBounds(platform, challengeResult.depositBounds, 0)
    ));
    if (crossing.length) failures.push('platformCrossesDeposit');
    const hasDeposit = challengeResult.contentRequests.some(request => (
      request.type === 'phosphate-deposit'
    ));
    const hasBacillus = challengeResult.contentRequests.some(request => (
      request.type === 'authored-beneficial-colony' && request.organism === 'bacillus'
    ));
    if (!hasDeposit) failures.push('missingPhosphateDeposit');
    if (!hasBacillus) failures.push('missingBacillus');
    if (!challengeResult.blockedEdge?.blockedUntil) failures.push('gateNotBlocked');
  }

  if (challengeId === 'mycorrhiza') {
    const inside = platforms.filter(platform => (
      insideBounds(platform, challengeResult.gapBounds, 0)
    ));
    if (inside.length) failures.push('platformInsideMycorrhizaGap');
    if (challengeResult.blockedEdge?.regularTraversalBlocked !== true) {
      failures.push('regularTraversalNotBlocked');
    }
    if (!challengeResult.metrics.runtimeBridgeReachable) {
      failures.push('bridgeNotReachableByRuntime');
    }
    const exudates = challengeResult.contentRequests.filter(request => (
      request.type === 'exudate'
    ));
    if (exudates.length < 2) failures.push('insufficientExudatesBeforeGap');
    if (!challengeResult.contentRequests.some(request => (
      request.type === 'authored-roaming-beneficial' && request.organism === 'myco'
    ))) {
      failures.push('missingMycoBeforeSource');
    }
  }

  return { valid: failures.length === 0, failures, coverage: Math.round(coverage * 1000) / 1000 };
}

// ---------------------------------------------------------------------------
// §13 — SINTETIZADOR
// ---------------------------------------------------------------------------

export function synthesizeOptionalDetourTopology({
  level,
  candidate,
  topology,
  challengeAssignment,
  constraints = null,
  abilities = [],
  seedValue = '',
  plan = null,
  accessPlatform = null,
  attemptIndex = 0,
} = {}) {
  const failureReasons = [];
  if (!level || !candidate || !topology || !challengeAssignment) {
    return { success: false, failureReasons: ['missing-synthesis-input'] };
  }
  const activeConstraints = constraints || challengeAssignment.constraints;
  const detourPlan = plan || candidate;
  const rejoinPlatform = detourPlan.rejoinPlatform;
  if (!accessPlatform || !rejoinPlatform) {
    return { success: false, failureReasons: ['missing-access-or-rejoin'] };
  }

  const random = createRandom(
    `${seedValue}:t1-synthesis:${candidate.id}:${topology.id}`
    + `:${challengeAssignment.challengeId}:${challengeAssignment.zoneId}:${attemptIndex}`,
  );

  const context = {
    level,
    detourId: detourPlan.id,
    primaryRoute: detourPlan.primaryRoute,
    startPlatform: detourPlan.startPlatform,
    rejoinPlatform,
    seedValue,
    abilities,
  };

  const centralStartX = accessPlatform.x + accessPlatform.w + 20;
  const centralEndX = rejoinPlatform.x - 300;
  const availableSpan = centralEndX - centralStartX;
  if (availableSpan <= 0) {
    return { success: false, failureReasons: ['no-central-span'] };
  }

  const zoneSpans = allocateTopologyZoneSpans(topology, availableSpan);
  if (!zoneSpans) {
    return {
      success: false,
      failureReasons: [`zone-span-allocation-failed:${Math.round(availableSpan)}`],
    };
  }

  const graph = buildOptionalDetourTopologyGraph({
    topology,
    zoneSpans,
    challengeAssignment,
    entryAnchor: accessPlatform,
    startX: centralStartX,
    startY: accessPlatform.y,
  });

  // Corredor vertical: acima dele a rota sai do enquadramento da câmera, abaixo
  // dele encosta na rota principal. A amplitude de 420 px comporta com folga os
  // 180–360 px exigidos pelo contrato.
  const laneY = cruiseLaneY(detourPlan);
  const corridor = {
    top: Math.min(accessPlatform.y, laneY) - 380,
    bottom: Math.max(accessPlatform.y, laneY) + 40,
  };

  const recipes = usableRecipes(abilities);
  if (!recipes.length) {
    return { success: false, failureReasons: ['no-usable-movement-recipe'] };
  }

  const nearbyPrimary = (level.platforms || []).filter(platform => (
    platform.x < centralEndX + 600
    && platform.x + platform.w > centralStartX - 600
  ));

  const platforms = [];
  const edges = [];
  const contentRequests = [];
  const intentionalGaps = [];
  const zoneResults = [];
  let forbiddenBounds = [];
  let cursorPlatform = accessPlatform;
  let order = 100;
  let cursorX = centralStartX;
  let challengeResult = null;

  // As fronteiras de zona são RECALCULADAS a cada zona a partir do que sobrou de
  // verdade. Fixá-las de antemão parecia mais simples, mas um passo que estoura
  // a sua fatia (porque a receita física tem faixas mínimas) empurrava a dívida
  // para a frente até a última zona ficar com 16 px — era daí que vinham
  // `zone-budget-too-small` e `route-overruns-central-span`. Assim a sobra é
  // absorvida pelas zonas seguintes, e a última sempre termina em centralEndX.
  const zoneWeights = zoneSpans.map(entry => entry.span);
  for (let index = 0; index < topology.zones.length; index++) {
    const zone = topology.zones[index];
    const remainingWeight = zoneWeights
      .slice(index)
      .reduce((sum, value) => sum + value, 0);
    const cursorRight = index === 0
      ? cursorX
      : cursorPlatform.x + cursorPlatform.w;
    const remainingSpan = centralEndX - cursorRight;
    const isChallengeZone = zone.id === challengeAssignment.zoneId;
    let span = index === topology.zones.length - 1
      ? remainingSpan
      : remainingSpan * (zoneWeights[index] / Math.max(1, remainingWeight));
    if (isChallengeZone) {
      // A zona do desafio tem prioridade sobre a sobra: o vão bloqueado da
      // micorriza tem um piso físico e não negocia. O que ela pode tomar está
      // limitado ao que as zonas seguintes precisam para existir.
      const tailMinimum = topology.zones
        .slice(index + 1)
        .reduce((sum, next) => sum + next.minimumSpan, 0);
      const required = (activeConstraints?.minimumZoneSpan || 0) + 160;
      // A margem de 220 px é a dívida que um passo pode contrair ao arredondar
      // para a faixa da receita. Sem ela a cauda ficava exatamente nos mínimos
      // e a primeira sobra estourava a última zona.
      span = Math.max(span, Math.min(required, remainingSpan - tailMinimum - 220));
    }
    const zoneRight = cursorRight + span;
    const shared = {
      zone,
      zoneRight,
      entryPlatform: cursorPlatform,
      recipes,
      level,
      random,
      context,
      orderStart: order,
      occupied: [...nearbyPrimary, ...platforms],
      forbiddenBounds,
      corridor,
    };
    let result;
    if (isChallengeZone && challengeAssignment.challengeId === 'phosphate') {
      result = synthesizePhosphateZone(shared);
    } else if (isChallengeZone && challengeAssignment.challengeId === 'mycorrhiza') {
      result = synthesizeMycorrhizaZone(shared);
    } else {
      result = synthesizeMovementZone(shared);
    }
    if (!result.success) {
      failureReasons.push(`${zone.id}:${result.reason}`);
      return {
        success: false,
        failureReasons,
        graph,
        zoneResults,
      };
    }
    platforms.push(...result.platforms);
    edges.push(...result.edges);
    contentRequests.push(...(result.contentRequests || []));
    intentionalGaps.push(...(result.intentionalGaps || []));
    forbiddenBounds = [...forbiddenBounds, ...(result.forbiddenBounds || [])];
    zoneResults.push({
      zoneId: zone.id,
      role: zone.role,
      verticalIntent: zone.verticalIntent,
      span: Math.round(span),
      platformCount: result.platforms.length,
      exitPlatformId: result.exitPlatform.platformId,
      challengeId: isChallengeZone ? challengeAssignment.challengeId : null,
      targetDelta: result.targetDelta ?? null,
      realizedDelta: result.realizedDelta ?? null,
    });
    if (isChallengeZone) challengeResult = result;
    order += 40;
    cursorPlatform = result.exitPlatform;
  }

  if (!challengeResult) {
    return { success: false, failureReasons: ['challenge-zone-not-synthesized'], graph };
  }
  if (cursorPlatform.x + cursorPlatform.w > centralEndX + 120) {
    return {
      success: false,
      failureReasons: [`route-overruns-central-span:${Math.round(cursorPlatform.x + cursorPlatform.w - centralEndX)}`],
      graph,
      zoneResults,
    };
  }

  // Saída por queda: a última plataforma da topologia tem de alcançar a rota
  // principal sem degrau intermediário.
  const dropValidation = canTraverseEdge({
    from: cursorPlatform,
    to: rejoinPlatform,
    primitives: level.primitives || [],
  });
  if (!dropValidation.valid) {
    failureReasons.push('drop-rejoin-unreachable');
    return { success: false, failureReasons, graph, zoneResults };
  }
  edges.push({
    from: cursorPlatform.platformId,
    to: rejoinPlatform.platformId || rejoinPlatform.id,
    role: 'drop-rejoin',
    primitiveId: dropValidation.passingPrimitiveIds[0] || null,
    valid: true,
  });
  intentionalGaps.push({
    fromPlatformId: cursorPlatform.platformId,
    toPlatformId: rejoinPlatform.platformId || rejoinPlatform.id,
    kind: 'drop-rejoin',
  });

  const accessValid = Boolean(accessPlatform.azospirillumLadderDestination);
  const metrics = silhouetteMetrics([accessPlatform, ...platforms]);
  const validation = validateSynthesis({
    platforms,
    edges,
    metrics,
    challengeResult,
    challengeId: challengeAssignment.challengeId,
    span: availableSpan,
    accessValid,
    dropRejoinValid: dropValidation.valid,
    primaryRouteUnchanged: true,
  });

  const occupiedBounds = {
    left: Math.min(accessPlatform.x, ...platforms.map(platform => platform.x)),
    right: Math.max(...platforms.map(platform => platform.x + platform.w)),
    top: Math.min(
      accessPlatform.y,
      ...platforms.map(platform => platform.y),
      ...(challengeResult.depositBounds ? [challengeResult.depositBounds.top] : []),
    ),
    bottom: Math.max(
      accessPlatform.y + accessPlatform.h,
      ...platforms.map(platform => platform.y + platform.h),
    ),
  };

  const structuralSignature = {
    candidateId: candidate.id,
    topologyFamily: topology.family,
    zoneRoles: topology.zones.map(zone => zone.role),
    zoneVerticalIntents: topology.zones.map(zone => zone.verticalIntent),
    challengeId: challengeAssignment.challengeId,
    challengeZoneId: challengeAssignment.zoneId,
    challengePositionClass: topologyChallengePositionClass(
      topology,
      challengeAssignment.zoneId,
    ),
    platformCountPerZone: zoneResults.map(zoneResult => zoneResult.platformCount),
    ySequence: metrics.ySequence,
    verticalRange: metrics.verticalRange,
    climbCount: metrics.climbCount,
    dropCount: metrics.dropCount,
    intentionalGapKinds: intentionalGaps.map(gap => gap.kind),
    connectorCount: 0,
  };

  return {
    success: validation.valid,
    platforms,
    structures: [],
    contentRequests,
    intentionalGaps,
    occupiedBounds,
    entrySocket: {
      platformId: accessPlatform.platformId,
      platform: accessPlatform,
    },
    exitSocket: {
      platformId: cursorPlatform.platformId,
      platform: cursorPlatform,
    },
    dropLaunchSocket: {
      platformId: cursorPlatform.platformId,
      platform: cursorPlatform,
      rejoinPlatformId: rejoinPlatform.platformId || rejoinPlatform.id,
    },
    zoneResults,
    graph,
    edges,
    validation,
    metrics,
    challenge: {
      id: challengeAssignment.challengeId,
      zoneId: challengeAssignment.zoneId,
      positionClass: structuralSignature.challengePositionClass,
      constraints: activeConstraints,
      approachPlatformId: challengeResult.approachPlatformId || null,
      sourcePlatformId: challengeResult.sourcePlatformId || null,
      targetPlatformId: challengeResult.targetPlatformId || null,
      carrierPlatformId: challengeResult.carrierPlatformId || null,
      depositBounds: challengeResult.depositBounds || null,
      gapBounds: challengeResult.gapBounds || null,
      blockedEdge: challengeResult.blockedEdge || null,
      metrics: challengeResult.metrics || {},
    },
    centralStartX,
    centralEndX,
    availableSpan,
    corridor,
    attempts: { geometryAttempt: attemptIndex },
    failureReasons: validation.valid ? [] : validation.failures,
    structuralSignature,
  };
}

// ---------------------------------------------------------------------------
// §17/§18 — INTEGRAÇÃO E TENTATIVAS LIMITADAS
// ---------------------------------------------------------------------------

function snapshotMutableLevel(level) {
  return {
    platformsLength: (level.platforms || []).length,
    crystalsLength: (level.crystals || []).length,
    depositsLength: (level.phosphateDeposits || []).length,
    coloniesLength: (level.authoredBeneficialColonies || []).length,
    azoRequestsLength: (level.authoredAzospirillumLadderRequests || []).length,
    detoursLength: (level.optionalDetours || []).length,
    reservedLength: (level.optionalDetourReservedBounds || []).length,
    authoredEncountersLength: (level.authoredEncounters || []).length,
    exudatesLength: (level.exudates || []).length,
  };
}

function rollback(level, snapshot, startPlatform) {
  level.platforms?.splice(snapshot.platformsLength);
  level.crystals?.splice(snapshot.crystalsLength);
  level.phosphateDeposits?.splice(snapshot.depositsLength);
  level.authoredBeneficialColonies?.splice(snapshot.coloniesLength);
  level.authoredAzospirillumLadderRequests?.splice(snapshot.azoRequestsLength);
  level.optionalDetours?.splice(snapshot.detoursLength);
  level.optionalDetourReservedBounds?.splice(snapshot.reservedLength);
  level.authoredEncounters?.splice(snapshot.authoredEncountersLength);
  level.exudates?.splice(snapshot.exudatesLength);
  if (startPlatform) {
    delete startPlatform.azospirillumLadderHost;
    delete startPlatform.optionalDetourLaunchRoot;
  }
}

function planFromCandidate(level, candidate, seedValue) {
  return {
    ...candidate,
    phase: 10,
    seedValue,
    preEntryPlatformId:
      candidate.preEntryPlatform.platformId || candidate.preEntryPlatform.id,
    primaryRouteGeometryHashBefore: primaryRouteGeometryHash(level),
    authoredEncounterSpacing: OPTIONAL_DETOUR_AUTHORED_ENCOUNTER_SPACING,
  };
}

function organismsFromAbilities(abilities) {
  const available = new Set(abilities);
  const organisms = ['azospirillum'];
  if (available.has('phosphateSolubilization')) organisms.push('bacillus');
  if (available.has('mycorrhizaStructures')) organisms.push('myco');
  return organisms;
}

export function composeOptionalDetourTopologyT1({
  level,
  candidates = [],
  seedValue = '',
  abilities = [],
  organisms = null,
} = {}) {
  const attempts = [];
  const attemptedCandidateIds = [];
  const activeOrganisms = organisms || organismsFromAbilities(abilities);
  const ordered = [...candidates].sort((left, right) => (
    left.hardFailures.length - right.hardFailures.length
    || right.softScore - left.softScore
    || left.startLogicIndex - right.startLogicIndex
  ));

  for (const candidate of ordered) {
    attemptedCandidateIds.push(candidate.id);
    const candidateAttempt = {
      candidateId: candidate.id,
      topologyAttempts: 0,
      challengeAssignmentAttempts: 0,
      geometryAttempts: 0,
      failureReasons: [],
    };
    attempts.push(candidateAttempt);
    if (candidate.hardFailures.length) {
      candidateAttempt.failureReasons.push(...candidate.hardFailures);
      continue;
    }

    const plan = planFromCandidate(level, candidate, seedValue);
    const baseline = snapshotMutableLevel(level);
    const familyOrder = optionalDetourTopologyFamilyOrder({
      seedValue,
      candidateId: candidate.id,
    });

    for (
      let topologyIndex = 0;
      topologyIndex < Math.min(T1_ATTEMPT_LIMITS.topologies, familyOrder.length);
      topologyIndex++
    ) {
      candidateAttempt.topologyAttempts++;
      const topology = generateOptionalDetourTopology({
        candidate,
        seedValue,
        referenceScreenWidth: Number(level.referenceScreenWorldWidth) || 1280,
        referenceScreenHeight: Number(level.referenceScreenWorldHeight) || 720,
        familyId: familyOrder[topologyIndex],
        attemptIndex: topologyIndex,
      });
      if (!topology) {
        candidateAttempt.failureReasons.push(`topology-${topologyIndex}:not-generated`);
        continue;
      }

      let accessLanding;
      try {
        accessLanding = chooseAccessLanding(level, plan);
        if (!accessLanding.collisionFree || !accessLanding.jetpackAccessible) {
          throw new Error('access-not-physically-usable');
        }
      } catch (error) {
        candidateAttempt.failureReasons.push(error.message);
        break;
      }
      const estimatedSpan = (plan.rejoinPlatform.x - 300)
        - (accessLanding.x + 220 + 20);
      const topologyViolations = validateOptionalDetourTopology(topology, {
        availableSpan: estimatedSpan,
      });
      if (topologyViolations.length) {
        candidateAttempt.failureReasons.push(
          `topology-${topology.family}:${topologyViolations.join('+')}`,
        );
        continue;
      }

      const selection = selectTopologyChallenge({
        topology,
        abilities,
        organisms: activeOrganisms,
        seedValue,
        candidateId: candidate.id,
        zoneSpans: Object.fromEntries(
          (allocateTopologyZoneSpans(topology, estimatedSpan) || [])
            .map(entry => [entry.zoneId, entry.span]),
        ),
      });
      if (!selection.assignments.length) {
        candidateAttempt.failureReasons.push(
          `no-compatible-challenge:${selection.rejections.join('+')}`,
        );
        continue;
      }

      // A primeira tentativa é a escolha da seed. A segunda é deliberadamente a
      // melhor opção do OUTRO desafio: com duas amostras do mesmo shuffle, uma
      // topologia que sorteasse fosfato duas vezes nunca daria chance à
      // micorriza, e a variedade exigida no §22 dependeria de sorte.
      const firstAssignment = selection.assignments[0];
      const alternativeAssignment = selection.assignments.find(assignment => (
        assignment.challengeId !== firstAssignment.challengeId
      ));
      const assignmentPool = [firstAssignment, alternativeAssignment]
        .filter(Boolean)
        .slice(0, T1_ATTEMPT_LIMITS.challengeAssignmentsPerTopology);
      for (const assignment of assignmentPool) {
        candidateAttempt.challengeAssignmentAttempts++;
        for (
          let geometryAttempt = 0;
          geometryAttempt < T1_ATTEMPT_LIMITS.synthesesPerAssignment;
          geometryAttempt++
        ) {
          candidateAttempt.geometryAttempts++;
          rollback(level, baseline, plan.startPlatform);

          let accessResult = null;
          try {
            const accessContext = {
              level,
              detourId: plan.id,
              primaryRoute: plan.primaryRoute,
              startPlatform: plan.startPlatform,
              accessLandingX: accessLanding.x,
              accessLandingY: accessLanding.y,
            };
            accessResult = AZO_LATERAL_ACCESS_MODULE.buildGeometry(accessContext);
          } catch (error) {
            candidateAttempt.failureReasons.push(`access:${error.message}`);
            break;
          }
          level.platforms.push(...accessResult.platforms);
          level.authoredAzospirillumLadderRequests = [
            ...(level.authoredAzospirillumLadderRequests || []),
            ...(accessResult.authoredAzospirillumLadderRequests || []),
          ];
          const accessPlatform = accessResult.platforms[0];

          const synthesis = synthesizeOptionalDetourTopology({
            level,
            candidate,
            topology,
            challengeAssignment: assignment,
            constraints: assignment.constraints,
            abilities,
            seedValue,
            plan,
            accessPlatform,
            attemptIndex: geometryAttempt,
          });
          if (!synthesis.success) {
            candidateAttempt.failureReasons.push(
              `${topology.family}:${assignment.challengeId}:${assignment.zoneId}`
              + `:${geometryAttempt}:${(synthesis.failureReasons || []).join('+')}`,
            );
            rollback(level, baseline, plan.startPlatform);
            continue;
          }

          level.platforms.push(...synthesis.platforms);
          const detour = buildTopologyDetourRecord({
            level,
            plan,
            candidate,
            candidates,
            topology,
            assignment,
            synthesis,
            accessLanding,
            accessPlatform,
            seedValue,
            attemptCounters: candidateAttempt,
          });
          level.optionalDetourReservedBounds = [
            ...(level.optionalDetourReservedBounds || []),
            detour.optionalDetourReservedBounds,
          ];
          level.optionalDetours = [...(level.optionalDetours || []), detour];

          const materialized = materializeOptionalDetourContent({
            level,
            detour,
            contentRequests: synthesis.contentRequests,
            random: createRandom(
              `${seedValue}:t1-content:${candidate.id}:${topology.id}:${geometryAttempt}`,
            ),
          });
          if (materialized.failures.length) {
            candidateAttempt.failureReasons.push(
              `materialization:${materialized.failures.join(',')}`,
            );
            rollback(level, baseline, plan.startPlatform);
            continue;
          }
          detour.phosphateDepositId = materialized.deposits[0]?.id || null;
          detour.bacillusColonyId = materialized.authoredColonies[0]?.id || null;
          detour.phosphateDepositInitialState = materialized.deposits[0]
            ? (materialized.deposits[0].broken ? 'open' : 'blocked')
            : null;
          detour.exudateIds = materialized.exudates.map(exudate => exudate.id);

          detour.primaryRouteGeometryHashAfter = primaryRouteGeometryHash(level);
          const primaryUnchanged = detour.primaryRouteGeometryHashAfter
            === plan.primaryRouteGeometryHashBefore;
          const prebuiltBridge = (level.platforms || []).some(platform => (
            platform.mycorrhizaStructure
          ));
          const alreadySolved = (level.phosphateDeposits || []).some(deposit => (
            deposit.optionalDetourId === detour.id && deposit.broken !== false
          ));
          const globalFailures = [];
          if (!primaryUnchanged) globalFailures.push('primaryRouteChanged');
          if (prebuiltBridge) globalFailures.push('prebuiltMycorrhizaBridgePresent');
          if (alreadySolved) globalFailures.push('structureBornSolved');
          if (
            assignment.challengeId === 'phosphate'
            && detour.phosphateDepositInitialState !== 'blocked'
          ) {
            globalFailures.push('depositNotInitiallyBlocked');
          }
          if (globalFailures.length) {
            detour.validation = {
              ...synthesis.validation,
              valid: false,
              failures: [...synthesis.validation.failures, ...globalFailures],
            };
            candidateAttempt.failureReasons.push(`global:${globalFailures.join('+')}`);
            rollback(level, baseline, plan.startPlatform);
            continue;
          }

          detour.validation = {
            ...synthesis.validation,
            primaryRouteGeometryUnchanged: true,
            primaryRouteGeometryHashBefore: plan.primaryRouteGeometryHashBefore,
            primaryRouteGeometryHashAfter: detour.primaryRouteGeometryHashAfter,
          };
          return {
            success: true,
            candidateId: candidate.id,
            detour,
            attempts,
            attemptedCandidateIds,
            failureReasons: [],
          };
        }
      }
    }
    rollback(level, baseline, plan.startPlatform);
  }

  return {
    success: false,
    candidateId: null,
    detour: null,
    attempts,
    attemptedCandidateIds,
    failureReasons: attempts.flatMap(attempt => attempt.failureReasons),
  };
}

function buildTopologyDetourRecord({
  level,
  plan,
  candidate,
  candidates,
  topology,
  assignment,
  synthesis,
  accessLanding,
  accessPlatform,
  seedValue,
  attemptCounters,
}) {
  const occupiedBounds = {
    ...synthesis.occupiedBounds,
    startLogicIndex: plan.startLogicIndex,
    endLogicIndex: plan.endLogicIndex,
    rejoinLogicIndex: plan.endLogicIndex,
    authoredEncounterSpacing: plan.authoredEncounterSpacing,
    reservedThroughLogicIndex:
      plan.endLogicIndex + plan.authoredEncounterSpacing,
  };
  return {
    id: plan.id,
    phase: 10,
    seedValue,
    implementationStage: 'T1',
    candidateId: candidate.id,
    candidateCount: candidates.length,
    candidateSoftScore: candidate.softScore,
    candidateSoftWarnings: [...candidate.softWarnings],
    compositionId: `${candidate.id}:t1:${topology.family}:${assignment.challengeId}`,
    compositionFallback: false,
    compositionFallbackReason: null,
    startLogicIndex: plan.startLogicIndex,
    endLogicIndex: plan.endLogicIndex,
    startPlatformId: plan.startPlatformId,
    preEntryPlatformId: plan.preEntryPlatformId,
    rejoinPlatformId: plan.rejoinPlatformId,
    targetScreenCount: plan.targetScreenCount,
    actualWorldSpan: plan.actualWorldSpan,
    primaryProfile: plan.primaryProfile,
    primaryRouteGeometryHashBefore: plan.primaryRouteGeometryHashBefore,

    topologyId: topology.id,
    topologyFamily: topology.family,
    topologyFamilyLabel: topology.familyLabel,
    topologySignature: topology.signature,
    topologyZones: topology.zones.map(zone => ({
      id: zone.id,
      role: zone.role,
      verticalIntent: zone.verticalIntent,
    })),
    plannedScreens: topology.plannedScreens,
    targetVerticalRange: topology.targetVerticalRange,

    challengeId: assignment.challengeId,
    challengeFamily: assignment.family,
    challengeZoneId: assignment.zoneId,
    challengePositionClass: synthesis.structuralSignature.challengePositionClass,
    challengeGeometryProfiles: [...assignment.geometryProfiles],
    challengeMetrics: synthesis.challenge.metrics,
    mycorrhizaSourcePlatformId: synthesis.challenge.sourcePlatformId,
    mycorrhizaTargetPlatformId: synthesis.challenge.targetPlatformId,
    phosphateApproachPlatformId: synthesis.challenge.approachPlatformId,
    phosphateTargetPlatformId: synthesis.challenge.targetPlatformId,
    regularTraversalBlocked:
      synthesis.challenge.blockedEdge?.regularTraversalBlocked === true,

    accessLandingId: accessPlatform.platformId,
    accessLandingX: accessLanding.x,
    accessLandingY: accessLanding.y,
    accessHorizontalAdvance: accessLanding.horizontalAdvance,
    accessVerticalRise: accessLanding.verticalRise,
    accessVisibleAtZoom1: accessLanding.visibility.zoom1.visible,
    accessVisibleAtZoom145: accessLanding.visibility.zoom145.visible,
    accessModuleId: AZO_LATERAL_ACCESS_MODULE.id,

    centralStartX: synthesis.centralStartX,
    centralEndX: synthesis.centralEndX,
    centralWorldSpan: synthesis.availableSpan,
    zoneResults: synthesis.zoneResults,
    graph: synthesis.graph,
    edges: synthesis.edges,
    intentionalGaps: synthesis.intentionalGaps,
    optionalPlatformIds: [
      accessPlatform.platformId,
      ...synthesis.platforms.map(platform => platform.platformId),
    ],
    connectorPlatformIds: [],
    connectorCount: 0,
    contentRequestIds: synthesis.contentRequests.map(request => request.id),
    structureIds: [],
    entrySocket: synthesis.entrySocket,
    exitSocket: synthesis.exitSocket,
    dropLaunchSocket: synthesis.dropLaunchSocket,
    silhouette: synthesis.metrics,
    corridor: synthesis.corridor,
    optionalDetourReservedBounds: occupiedBounds,
    towerSuppressedForOptionalDetourPlaytest: Boolean(
      level.traversalEncounterStats?.towerSuppressedForOptionalDetourPlaytest,
    ),
    topologyAttempts: attemptCounters.topologyAttempts,
    challengeAssignmentAttempts: attemptCounters.challengeAssignmentAttempts,
    geometryAttempts: attemptCounters.geometryAttempts,
    failureReasons: [...attemptCounters.failureReasons],
    structuralSignature: synthesis.structuralSignature,
    // Overlay do §21: só dados, nenhum colisor.
    topologyOverlay: {
      zones: synthesis.zoneResults,
      nodes: synthesis.graph.nodes,
      edges: synthesis.edges,
      blockedEdge: synthesis.challenge.blockedEdge,
      intentionalGaps: synthesis.intentionalGaps,
      corridor: synthesis.corridor,
      depositBounds: synthesis.challenge.depositBounds,
      gapBounds: synthesis.challenge.gapBounds,
    },
    validation: synthesis.validation,
  };
}

export function createPhaseTenTopologyDetour({
  level,
  phase,
  seedValue,
  abilities = ['doubleJump', 'dash', 'phosphateSolubilization', 'mycorrhizaStructures'],
} = {}) {
  level.optionalDetours = [];
  if (phase !== 10) return null;
  const collected = collectOptionalDetourCandidates({
    level,
    phase,
    seedValue,
    abilities,
  });
  level.optionalDetourCandidateDiagnostics = collected.diagnostics;
  const composition = composeOptionalDetourTopologyT1({
    level,
    candidates: collected.candidates,
    seedValue,
    abilities,
  });
  level.optionalDetourComposition = composition;
  level.optionalDetourTopologyMode = true;
  return composition.success ? composition.detour : null;
}
