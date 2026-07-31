import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { generateLevel } from '../src/procgen/generator.js';
import { applySignatureChallenge } from '../src/procgen/signature-challenge.js';
import { createPhaseTenOptionalDetour } from '../src/procgen/optional-detour-composer.js';
import {
  createPhaseTenTopologyDetour,
  T1_ATTEMPT_LIMITS,
  T1_SILHOUETTE_CONTRACTS,
} from '../src/procgen/optional-detour-topology-synthesizer.js';
import {
  generateOptionalDetourTopology,
  optionalDetourTopologyFamilyOrder,
  TOPOLOGY_FAMILY_IDS,
  validateOptionalDetourTopology,
} from '../src/procgen/optional-detour-topology.js';
import {
  createMovementConstraints,
  createMycorrhizaConstraints,
  createPhosphateConstraints,
  MYCORRHIZA_RUNTIME_MINIMUM_GAP,
  MYCORRHIZA_RUNTIME_VERTICAL_LIMIT,
} from '../src/procgen/optional-detour-challenge-constraints.js';
import { canTraverseEdge } from '../src/procgen/traversal-edge-physics.js';
import { readFileSync } from 'node:fs';

const ABILITIES = Object.freeze([
  'doubleJump',
  'dash',
  'phosphateSolubilization',
  'mycorrhizaStructures',
]);

// 32 seeds determinísticas e NÃO filtradas: nenhuma foi escolhida por produzir
// um resultado bonito. Parte delas não gera rota nenhuma, e isso é informação —
// o teste mede o que sai, não o que gostaríamos que saísse.
const MATRIX_SEEDS = Object.freeze(Array.from(
  { length: 32 },
  (_, index) => `t1-audit-${index + 1}:fase-10`,
));

function phaseTenGeometry(seed, { phase = 10 } = {}) {
  const campaign = createCampaign(seed.split(':')[0]);
  campaign.phase = phase;
  for (const feature of Object.keys(campaign.unlocks)) {
    campaign.unlocks[feature] = true;
  }
  const profile = prepareCampaignGeneration(campaign);
  let level = generateLevel(seed, {
    referenceScreenWorldWidth: 1280,
    referenceScreenWorldHeight: 720,
    suppressTowerSafeFall: true,
  });
  level.optionalDetourPlaytestMode = true;
  level = decorateCampaignLevel(level, campaign, profile);
  applySignatureChallenge(level, phase);
  return level;
}

function synthesize(seed) {
  const level = phaseTenGeometry(seed);
  const detour = createPhaseTenTopologyDetour({
    level,
    phase: 10,
    seedValue: seed,
    abilities: ABILITIES,
  });
  return { level, detour };
}

function detourPlatforms(level, detour) {
  return (level.platforms || []).filter(platform => (
    platform.optionalDetourId === detour.id
  ));
}

function rectsIntersect(left, right) {
  return left.x < right.x + right.w
    && left.x + left.w > right.x
    && left.y < right.y + right.h
    && left.y + left.h > right.y;
}

function insideBounds(platform, bounds) {
  return platform.x < bounds.right
    && platform.x + platform.w > bounds.left
    && platform.y < bounds.bottom
    && platform.y + platform.h > bounds.top;
}

// Uma única passagem pela matriz alimenta todos os testes de conjunto: repetir
// 32 gerações por asserção deixaria a suíte lenta sem medir nada de novo.
const MATRIX = MATRIX_SEEDS.map(seed => {
  const { level, detour } = synthesize(seed);
  return { seed, level, detour };
});
const ROUTES = MATRIX.filter(entry => entry.detour);

test('T1 - a matriz de 32 seeds produz rotas em número comparável ao B2', () => {
  // Referência viva, não número mágico: o B2 roda nas MESMAS seeds e o T1 não
  // pode ficar muito atrás dele. Se um dia o T1 despencar, esta asserção diz
  // que a causa é o T1 e não as seeds.
  let b2Routes = 0;
  for (const seed of MATRIX_SEEDS) {
    const level = phaseTenGeometry(seed);
    const detour = createPhaseTenOptionalDetour({
      level,
      phase: 10,
      seedValue: seed,
      abilities: ABILITIES,
    });
    if (detour && !detour.compositionFallback) b2Routes++;
  }
  assert.ok(
    ROUTES.length >= 12,
    `T1 sintetizou apenas ${ROUTES.length}/32 rotas`,
  );
  assert.ok(
    ROUTES.length >= b2Routes - 3,
    `T1 ${ROUTES.length} contra B2 ${b2Routes}: diferença acima do tolerado`,
  );
});

test('T1 - DETERMINISMO: mesma seed, mesma topologia, desafio, assinatura e geometria', () => {
  for (const entry of ROUTES.slice(0, 12)) {
    const repeat = synthesize(entry.seed);
    assert.ok(repeat.detour, `${entry.seed}: segunda geração não produziu rota`);
    assert.equal(repeat.detour.topologyId, entry.detour.topologyId);
    assert.equal(repeat.detour.challengeId, entry.detour.challengeId);
    assert.equal(repeat.detour.challengeZoneId, entry.detour.challengeZoneId);
    assert.deepEqual(
      repeat.detour.structuralSignature,
      entry.detour.structuralSignature,
    );
    const geometryOf = ({ level, detour }) => detourPlatforms(level, detour)
      .map(platform => `${platform.platformId}@${platform.x},${platform.y},${platform.w}`)
      .join('|');
    assert.equal(geometryOf(repeat), geometryOf(entry), `${entry.seed}: geometria divergiu`);
  }
});

test('T1 - DETERMINISMO: a topologia abstrata é estável e respeita os contratos', () => {
  for (const seed of MATRIX_SEEDS.slice(0, 16)) {
    const order = optionalDetourTopologyFamilyOrder({ seedValue: seed, candidateId: 'c' });
    assert.deepEqual(
      order,
      optionalDetourTopologyFamilyOrder({ seedValue: seed, candidateId: 'c' }),
    );
    for (const familyId of TOPOLOGY_FAMILY_IDS) {
      const topology = generateOptionalDetourTopology({
        candidate: { id: 'c' },
        seedValue: seed,
        familyId,
      });
      assert.deepEqual(
        validateOptionalDetourTopology(topology),
        [],
        `${seed}/${familyId}: topologia fora do contrato`,
      );
      const twin = generateOptionalDetourTopology({
        candidate: { id: 'c' },
        seedValue: seed,
        familyId,
      });
      assert.equal(topology.signature, twin.signature);
    }
  }
});

test('T1 - VARIEDADE: famílias, desafios, posições e assinaturas', () => {
  const families = new Set(ROUTES.map(entry => entry.detour.topologyFamily));
  const challenges = new Set(ROUTES.map(entry => entry.detour.challengeId));
  const positions = new Set(ROUTES.map(entry => entry.detour.challengePositionClass));
  const signatures = new Set(ROUTES.map(entry => (
    JSON.stringify(entry.detour.structuralSignature)
  )));
  const intents = new Set(ROUTES.map(entry => (
    entry.detour.structuralSignature.zoneVerticalIntents.join('>')
  )));

  assert.ok(families.size >= 4, `apenas ${families.size} famílias: ${[...families]}`);
  assert.ok(challenges.has('phosphate'), 'nenhuma rota com fosfato');
  assert.ok(challenges.has('mycorrhiza'), 'nenhuma rota com micorriza');
  for (const expected of ['early', 'middle', 'late']) {
    assert.ok(positions.has(expected), `nenhum desafio em posição ${expected}`);
  }
  assert.ok(signatures.size >= 8, `apenas ${signatures.size} assinaturas distintas`);
  assert.ok(intents.size >= 4, `apenas ${intents.size} sequências de verticalIntent`);
});

test('T1 - VARIEDADE: cada desafio aparece em mais de uma topologia', () => {
  const byChallenge = { phosphate: new Set(), mycorrhiza: new Set() };
  for (const entry of ROUTES) {
    byChallenge[entry.detour.challengeId]?.add(entry.detour.topologyId);
  }
  assert.ok(
    byChallenge.phosphate.size >= 2,
    `fosfato em apenas ${byChallenge.phosphate.size} topologia(s)`,
  );
  assert.ok(
    byChallenge.mycorrhiza.size >= 2,
    `micorriza em apenas ${byChallenge.mycorrhiza.size} topologia(s)`,
  );
});

test('T1 - SILHUETA: amplitude, subidas, descidas, monotonia e sobreposição', () => {
  for (const entry of ROUTES) {
    const silhouette = entry.detour.silhouette;
    assert.ok(
      silhouette.verticalRange >= T1_SILHOUETTE_CONTRACTS.minimumVerticalRange,
      `${entry.seed}: amplitude ${silhouette.verticalRange}px`,
    );
    assert.ok(silhouette.climbCount >= 1, `${entry.seed}: sem subida`);
    assert.ok(silhouette.dropCount >= 1, `${entry.seed}: sem descida`);
    assert.ok(
      silhouette.monotonicShare <= T1_SILHOUETTE_CONTRACTS.maximumMonotonicShare,
      `${entry.seed}: monotonia ${silhouette.monotonicShare}`,
    );
    const platforms = detourPlatforms(entry.level, entry.detour);
    for (let index = 0; index < platforms.length; index++) {
      for (let other = index + 1; other < platforms.length; other++) {
        assert.ok(
          !rectsIntersect(platforms[index], platforms[other]),
          `${entry.seed}: ${platforms[index].platformId} sobrepõe ${platforms[other].platformId}`,
        );
      }
    }
  }
});

test('T1 - SILHUETA: a saída por queda continua válida e a rota principal intacta', () => {
  for (const entry of ROUTES) {
    const { level, detour } = entry;
    assert.equal(
      detour.primaryRouteGeometryHashAfter,
      detour.primaryRouteGeometryHashBefore,
      `${entry.seed}: hash da rota principal mudou`,
    );
    const launch = detourPlatforms(level, detour).find(platform => (
      platform.platformId === detour.dropLaunchSocket.platformId
    ));
    const rejoin = (level.platforms || []).find(platform => (
      (platform.platformId || platform.id) === detour.rejoinPlatformId
    ));
    assert.ok(launch && rejoin, `${entry.seed}: sockets de queda ausentes`);
    assert.ok(
      canTraverseEdge({ from: launch, to: rejoin, primitives: level.primitives }).valid,
      `${entry.seed}: queda de reencontro impossível`,
    );
  }
});

test('T1 - FOSFATO: depósito bloqueado, Bacillus antes e sem passagem alternativa', () => {
  const phosphateRoutes = ROUTES.filter(entry => entry.detour.challengeId === 'phosphate');
  assert.ok(phosphateRoutes.length >= 2, 'menos de duas rotas com fosfato');
  for (const { seed, level, detour } of phosphateRoutes) {
    const deposit = (level.phosphateDeposits || []).find(candidate => (
      candidate.optionalDetourId === detour.id
    ));
    assert.ok(deposit, `${seed}: depósito não materializado`);
    assert.equal(deposit.broken, false, `${seed}: depósito nasce aberto`);
    assert.ok(Number(deposit.remainingPhosphate) > 0, `${seed}: depósito sem fosfato`);
    assert.equal(deposit.requiredFeature, 'phosphateSolubilization');

    const colony = (level.authoredBeneficialColonies || []).find(candidate => (
      candidate.optionalDetourId === detour.id && candidate.type === 'bacillus'
    ));
    assert.ok(colony, `${seed}: Bacillus ausente`);
    assert.ok(colony.x < deposit.x, `${seed}: Bacillus depois do depósito`);

    // Nenhuma plataforma atravessa o bloco nem passa por cima dele.
    const bypass = detour.topologyOverlay.depositBounds;
    const approachId = detour.phosphateApproachPlatformId;
    const targetId = detour.phosphateTargetPlatformId;
    for (const platform of detourPlatforms(level, detour)) {
      if (platform.platformId === approachId || platform.platformId === targetId) continue;
      assert.ok(
        !insideBounds(platform, bypass),
        `${seed}: ${platform.platformId} atravessa o depósito`,
      );
      assert.ok(
        !(platform.x < bypass.right && platform.x + platform.w > bypass.left
          && platform.y + platform.h > bypass.top - 170
          && platform.y < bypass.bottom),
        `${seed}: ${platform.platformId} permite contornar o depósito por cima`,
      );
    }
  }
});

test('T1 - MICORRIZA: origem, destino, vão bloqueado, vazio e ponte possível', () => {
  const mycorrhizaRoutes = ROUTES.filter(entry => entry.detour.challengeId === 'mycorrhiza');
  assert.ok(mycorrhizaRoutes.length >= 2, 'menos de duas rotas com micorriza');
  const deltas = new Set();
  for (const { seed, level, detour } of mycorrhizaRoutes) {
    const platforms = detourPlatforms(level, detour);
    const source = platforms.find(platform => platform.mycorrhizaBridgeSource);
    const target = platforms.find(platform => platform.mycorrhizaBridgeTarget);
    assert.ok(source && target, `${seed}: origem/destino ausentes`);
    assert.equal(source.type, 'root');
    assert.equal(target.type, 'root');
    assert.equal(source.preferredMycorrhizaTargetId, target.platformId);
    assert.equal(source.strictPreferredMycorrhizaTarget, true);

    // Travessia regular impossível.
    assert.equal(
      canTraverseEdge({ from: source, to: target, primitives: level.primitives }).valid,
      false,
      `${seed}: o vão é saltável sem ponte`,
    );

    // ... e a ponte é possível para o runtime que já existe.
    const gap = target.x - (source.x + source.w);
    const verticalDelta = target.y - source.y;
    assert.ok(gap >= MYCORRHIZA_RUNTIME_MINIMUM_GAP, `${seed}: vão ${gap} abaixo do runtime`);
    assert.ok(
      Math.abs(verticalDelta) <= MYCORRHIZA_RUNTIME_VERTICAL_LIMIT,
      `${seed}: desnível ${verticalDelta} fora do runtime`,
    );
    deltas.add(verticalDelta);

    // Vão vazio e nenhuma ponte pronta na geração.
    const gapBounds = detour.topologyOverlay.gapBounds;
    for (const platform of platforms) {
      if (platform === source || platform === target) continue;
      assert.ok(
        !insideBounds(platform, gapBounds),
        `${seed}: ${platform.platformId} dentro do vão`,
      );
    }
    assert.equal(
      (level.platforms || []).some(platform => platform.mycorrhizaStructure),
      false,
      `${seed}: ponte pronta na geração`,
    );

    // Myco e dois exsudatos antes do vão.
    const myco = (level.authoredEncounters || []).find(encounter => (
      encounter.id === 'myco' && encounter.optionalDetourId === detour.id
    ));
    assert.ok(myco, `${seed}: myco ausente`);
    assert.ok(myco.x < source.x + source.w, `${seed}: myco depois da origem`);
    const exudates = (level.exudates || []).filter(exudate => (
      exudate.optionalDetourId === detour.id
    ));
    assert.ok(exudates.length >= 2, `${seed}: apenas ${exudates.length} exsudato(s)`);
    for (const exudate of exudates) {
      assert.ok(exudate.x <= source.x + source.w, `${seed}: exsudato depois do vão`);
    }
  }
  assert.ok(deltas.size >= 2, `desnível da ponte sem variação: ${[...deltas]}`);
});

test('T1 - RESTRIÇÕES: as funções de desafio não criam plataformas', () => {
  const topology = generateOptionalDetourTopology({
    candidate: { id: 'c' },
    seedValue: 'restricoes',
    familyId: 'ridge-valley',
  });
  const zone = topology.zones.find(entry => entry.role === 'challenge');
  const context = {
    topology,
    zone,
    campaignState: null,
    abilities: ABILITIES,
    organisms: ['bacillus', 'myco'],
    seedValue: 'restricoes',
    zoneSpan: 1800,
  };
  for (const factory of [
    createPhosphateConstraints,
    createMycorrhizaConstraints,
    createMovementConstraints,
  ]) {
    const constraints = factory(context);
    assert.equal(typeof constraints.challengeId, 'string');
    assert.ok(Array.isArray(constraints.requiredNodeRoles));
    assert.ok(Array.isArray(constraints.requiredEdges));
    assert.ok(Array.isArray(constraints.forbiddenEdges));
    assert.ok(Array.isArray(constraints.occupiedRegionRules));
    assert.ok(Array.isArray(constraints.contentRules));
    assert.ok(Array.isArray(constraints.biologicalValidationRules));
    assert.ok(Array.isArray(constraints.physicalValidationRules));
    assert.ok(Array.isArray(constraints.preferredGeometryProfiles));
    // Nenhuma plataforma: o objeto de restrição não tem geometria concreta.
    assert.equal(constraints.platforms, undefined);
    assert.equal(typeof constraints.buildGeometry, 'undefined');
    assert.equal(
      JSON.stringify(constraints).includes('"platformId"'),
      false,
    );
  }
  // Bloqueio por habilidade travada é motivo declarado, não exceção silenciosa.
  const locked = createMycorrhizaConstraints({ ...context, abilities: ['doubleJump'] });
  assert.equal(locked.compatible, false);
  assert.ok(locked.incompatibilityReasons.includes('locked:mycorrhizaStructures'));
});

test('T1 - GRAFO: nós e arestas existem antes da geometria e descrevem o bloqueio', () => {
  for (const { seed, detour } of ROUTES.slice(0, 8)) {
    const graph = detour.graph;
    assert.ok(graph.nodes.length > 0, `${seed}: grafo sem nós`);
    assert.ok(graph.edges.length > 0, `${seed}: grafo sem arestas`);
    for (const node of graph.nodes) {
      assert.equal(node.xRange.length, 2);
      assert.equal(node.yRange.length, 2);
      assert.equal(node.widthRange.length, 2);
      assert.ok(node.xRange[1] >= node.xRange[0]);
    }
    const blocked = graph.edges.filter(edge => edge.blockedUntil);
    assert.equal(blocked.length, 1, `${seed}: esperava exatamente uma aresta bloqueada`);
    assert.ok(blocked[0].forbiddenConnector, `${seed}: aresta bloqueada aceita conector`);
    const rejoin = graph.edges.find(edge => edge.role === 'drop-rejoin');
    assert.ok(rejoin, `${seed}: grafo sem saída por queda`);
  }
});

test('T1 - TENTATIVAS: os limites do §18 são respeitados e registrados', () => {
  assert.equal(T1_ATTEMPT_LIMITS.topologies, 3);
  assert.equal(T1_ATTEMPT_LIMITS.challengeAssignmentsPerTopology, 2);
  assert.equal(T1_ATTEMPT_LIMITS.synthesesPerAssignment, 3);
  assert.equal(T1_ATTEMPT_LIMITS.maximumPerCandidate, 18);
  for (const { seed, level, detour } of ROUTES) {
    assert.ok(detour.topologyAttempts <= T1_ATTEMPT_LIMITS.topologies, seed);
    assert.ok(
      detour.geometryAttempts <= T1_ATTEMPT_LIMITS.maximumPerCandidate,
      `${seed}: ${detour.geometryAttempts} sínteses`,
    );
    for (const attempt of level.optionalDetourComposition.attempts) {
      assert.ok(
        attempt.geometryAttempts <= T1_ATTEMPT_LIMITS.maximumPerCandidate,
        `${seed}/${attempt.candidateId}: ${attempt.geometryAttempts} sínteses`,
      );
    }
  }
});

test('T1 - REGRESSÃO: o B2 continua íntegro e escolhendo micorriza', () => {
  let b2Detours = 0;
  let mycorrhizaSequences = 0;
  for (const seed of MATRIX_SEEDS) {
    const level = phaseTenGeometry(seed);
    const detour = createPhaseTenOptionalDetour({
      level,
      phase: 10,
      seedValue: seed,
      abilities: ABILITIES,
    });
    if (!detour || detour.compositionFallback) continue;
    b2Detours++;
    assert.equal(detour.implementationStage, 'B2', `${seed}: B2 mudou de estágio`);
    assert.equal(
      detour.primaryRouteGeometryHashAfter,
      detour.primaryRouteGeometryHashBefore,
      `${seed}: B2 alterou a rota principal`,
    );
    if ((detour.selectedSequence || []).includes('hard-mycorrhiza-gap')) {
      mycorrhizaSequences++;
    }
  }
  assert.ok(b2Detours > 0, 'o B2 deixou de compor');
  assert.ok(mycorrhizaSequences > 0, 'o B2 deixou de escolher micorriza');
});

test('T1 - REGRESSÃO: app.js chama os dois compositores e o T1 é modo isolado', () => {
  const source = readFileSync(new URL('../src/procgen/app.js', import.meta.url), 'utf8');
  assert.ok(source.includes('createPhaseTenOptionalDetour('), 'app.js não chama mais o B2');
  assert.ok(source.includes('createPhaseTenTopologyDetour('), 'app.js não chama o T1');
  assert.ok(source.includes("'optional-detour-cp2'"), 'CP2 saiu do app.js');
  assert.ok(
    source.includes("optionalDetourVariant === 'optional-detour-topology-t1'"),
    'modo T1 ausente do app.js',
  );
});

test('T1 - REGRESSÃO: nenhuma fase 0-9 recebe rota topológica', () => {
  for (const phase of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const seed = `t1-fase-${phase}`;
    const level = phaseTenGeometry(seed, { phase });
    const before = (level.platforms || []).length;
    const detour = createPhaseTenTopologyDetour({
      level,
      phase,
      seedValue: seed,
      abilities: ABILITIES,
    });
    assert.equal(detour, null, `fase ${phase} recebeu desvio T1`);
    assert.equal((level.platforms || []).length, before, `fase ${phase} mudou de geometria`);
  }
});
