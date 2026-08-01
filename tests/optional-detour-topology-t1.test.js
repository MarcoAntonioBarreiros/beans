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
import { OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE } from '../src/procgen/optional-detour-planner.js';
import { composeOptionalDetourTopologyT1 } from '../src/procgen/optional-detour-topology-synthesizer.js';
import {
  MINIMUM_ZONES_BETWEEN_CHALLENGES,
  selectTopologyChallengePlans,
  T2_DIFFICULTY_BUDGET,
} from '../src/procgen/optional-detour-challenge-constraints.js';
import { readFileSync } from 'node:fs';
import { getPhaseManifest, setPhaseManifestOverride } from '../src/procgen/campaign-manifest.js';

function cloneForFixedLength(manifest) {
  return JSON.parse(JSON.stringify({ ...manifest, chunkRange: undefined }));
}

// Estes cenarios curam SEEDS: cada uma foi escolhida por produzir uma janela
// primaria util numa fase de 40 chunks. O que eles exercitam e o DESVIO, nao o
// comprimento da fase — que passou a variar por seed. Fixar o manifesto aqui
// mantem a curadoria valida; a variacao de comprimento tem cobertura propria
// em progression-gating e phase-vertical-plan.
setPhaseManifestOverride(cloneForFixedLength(getPhaseManifest(10)));

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
  // O piso caiu de propósito. Depois que o corredor de queda passou a ser vazio
  // e a separação da rota principal voltou aos 270 px de projeto, sínteses que
  // antes passavam encostando na rota fácil passaram a ser recusadas. Qualidade
  // geométrica vale mais que quantidade de bifurcações — uma fase sem desvio é
  // um resultado aceitável, uma fase com desvio colado na rota de baixo não é.
  assert.ok(
    ROUTES.length >= 8,
    `T1 sintetizou apenas ${ROUTES.length}/32 rotas`,
  );
  assert.ok(b2Routes > 0, 'o B2 deixou de compor nas mesmas seeds');
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
  const gates = ROUTES.flatMap(entry => entry.detour.challenges
    .filter(challenge => challenge.id === 'phosphate')
    .map(challenge => ({ ...entry, challenge })));
  assert.ok(gates.length >= 2, `apenas ${gates.length} gate(s) de fosfato`);
  for (const { seed, level, detour, challenge } of gates) {
    const deposits = (level.phosphateDeposits || []).filter(candidate => (
      candidate.optionalDetourId === detour.id
      && candidate.hostPlatformId === challenge.approachPlatformId
    ));
    assert.equal(deposits.length, 1, `${seed}: ${deposits.length} depósitos no gate`);
    const deposit = deposits[0];
    assert.equal(deposit.broken, false, `${seed}: depósito nasce aberto`);
    assert.ok(Number(deposit.remainingPhosphate) > 0, `${seed}: depósito sem fosfato`);
    assert.equal(deposit.requiredFeature, 'phosphateSolubilization');

    const colony = (level.authoredBeneficialColonies || []).find(candidate => (
      candidate.optionalDetourId === detour.id
      && candidate.type === 'bacillus'
      && candidate.platformId === challenge.approachPlatformId
    ));
    assert.ok(colony, `${seed}: Bacillus ausente no gate`);
    assert.ok(colony.x < deposit.x, `${seed}: Bacillus depois do depósito`);

    // Nenhuma plataforma atravessa o bloco nem passa por cima dele.
    const bypass = challenge.depositBounds;
    for (const platform of detourPlatforms(level, detour)) {
      if (platform.platformId === challenge.approachPlatformId) continue;
      if (platform.platformId === challenge.targetPlatformId) continue;
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
  const gates = ROUTES.flatMap(entry => entry.detour.challenges
    .filter(challenge => challenge.id === 'mycorrhiza')
    .map(challenge => ({ ...entry, challenge })));
  assert.ok(gates.length >= 2, `apenas ${gates.length} gate(s) de micorriza`);
  const deltas = new Set();
  for (const { seed, level, detour, challenge } of gates) {
    const platforms = detourPlatforms(level, detour);
    const source = platforms.find(platform => (
      platform.platformId === challenge.sourcePlatformId
    ));
    const target = platforms.find(platform => (
      platform.platformId === challenge.targetPlatformId
    ));
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
    for (const platform of platforms) {
      if (platform === source || platform === target) continue;
      assert.ok(
        !insideBounds(platform, challenge.gapBounds),
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
    assert.equal(
      blocked.length,
      detour.challengeCount,
      `${seed}: ${blocked.length} arestas bloqueadas para ${detour.challengeCount} desafios`,
    );
    for (const edge of blocked) {
      assert.ok(edge.forbiddenConnector, `${seed}: aresta bloqueada aceita conector`);
    }
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

test('T1 - QUEDA: drop-rejoin é corredor vazio e a queda é direta', () => {
  for (const { seed, level, detour } of ROUTES) {
    const dropZone = detour.zoneResults.find(zone => zone.role === 'drop-rejoin');
    assert.ok(dropZone, `${seed}: topologia sem zona drop-rejoin`);
    assert.equal(dropZone.platformCount, 0, `${seed}: drop-rejoin gerou plataforma`);
    assert.equal(dropZone.reservedDropCorridor, true, `${seed}: corredor não reservado`);

    // Nenhuma plataforma concreta carrega a zona da queda.
    const tagged = detourPlatforms(level, detour).filter(platform => (
      String(platform.optionalDetourZoneId || '').includes('drop-rejoin')
    ));
    assert.equal(tagged.length, 0, `${seed}: ${tagged.length} plataformas em drop-rejoin`);

    assert.equal(detour.dropRejoinDirect, true, `${seed}: queda não é direta`);
    assert.equal(detour.dropRejoinPlatformCount, 0, `${seed}: corredor ocupado`);
    assert.equal(detour.dropCorridorClear, true, `${seed}: corredor não está limpo`);
    assert.equal(detour.validation.dropRejoinDirect, true);
    assert.equal(detour.validation.dropRejoinPlatformCount, 0);
    assert.equal(detour.validation.dropCorridorClear, true);

    // A queda não depende de degrau: a última plataforma opcional é a de
    // lançamento, e nada opcional existe depois dela.
    const launch = detourPlatforms(level, detour).find(platform => (
      platform.platformId === detour.dropLaunchSocket.platformId
    ));
    assert.ok(launch, `${seed}: plataforma de lançamento ausente`);
    const after = detourPlatforms(level, detour).filter(platform => (
      platform.platformId !== launch.platformId
      && platform.x >= launch.x + launch.w
    ));
    assert.equal(after.length, 0, `${seed}: plataforma depois do lançamento`);

    const rejoin = (level.platforms || []).find(platform => (
      (platform.platformId || platform.id) === detour.rejoinPlatformId
    ));
    assert.ok(
      canTraverseEdge({ from: launch, to: rejoin, primitives: level.primitives }).valid,
      `${seed}: queda direta inválida`,
    );
  }
});

test('T1 - SEPARAÇÃO: 270 px acima da rota principal, sem exceção', () => {
  assert.equal(OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE, 270);
  for (const { seed, level, detour } of ROUTES) {
    assert.equal(
      detour.primaryClearanceContract,
      OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE,
      `${seed}: contrato de separação divergente`,
    );
    assert.equal(
      detour.primaryClearanceViolationCount,
      0,
      `${seed}: ${detour.primaryClearanceViolationCount} violações de separação`,
    );
    assert.ok(
      detour.minimumPrimaryClearance === null
        || detour.minimumPrimaryClearance >= OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE,
      `${seed}: separação mínima ${detour.minimumPrimaryClearance}px`,
    );

    // Medida de novo a partir da geometria, não do relatório: o acesso tem
    // validação própria e a rejoin é da rota principal, então ficam de fora.
    const primary = (level.platforms || []).filter(platform => (
      platform.routeScope !== 'optional' && Number.isInteger(platform.logicIndex)
    ));
    for (const platform of detourPlatforms(level, detour)) {
      if (platform.platformId === detour.accessLandingId) continue;
      for (const other of primary) {
        if (other.x >= platform.x + platform.w || other.x + other.w <= platform.x) continue;
        if (other.y <= platform.y) continue;
        assert.ok(
          other.y - (platform.y + platform.h) >= OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE,
          `${seed}: ${platform.platformId} a ${Math.round(other.y - (platform.y + platform.h))}px`
          + ' da rota principal',
        );
      }
    }
  }
});

test('T1 - ASSINATURA: as métricas da queda e da separação entram na assinatura', () => {
  for (const { seed, detour } of ROUTES) {
    const signature = detour.structuralSignature;
    assert.equal(signature.dropRejoinDirect, true, seed);
    assert.equal(signature.dropRejoinPlatformCount, 0, seed);
    assert.equal(signature.primaryClearanceViolationCount, 0, seed);
    assert.ok(
      signature.minimumPrimaryClearance === null
        || signature.minimumPrimaryClearance >= OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE,
      seed,
    );
  }
});

test('T2 - COMPOSIÇÃO: a mesma rota hospeda fosfato e micorriza juntos', () => {
  const shapes = new Map();
  for (const { detour } of ROUTES) {
    const shape = [...detour.challengeIds].sort().join('+');
    shapes.set(shape, (shapes.get(shape) || 0) + 1);
  }
  const pairs = ROUTES.filter(entry => entry.detour.challengeCount === 2);
  assert.ok(
    pairs.length >= 2,
    `apenas ${pairs.length} rota(s) com dois desafios: ${[...shapes]}`,
  );
  for (const { seed, detour } of pairs) {
    // Exatamente um de cada: dois fosfatos na mesma rota seriam repetição, não
    // composição.
    const unique = new Set(detour.challengeIds);
    assert.equal(unique.size, 2, `${seed}: desafios repetidos`);
    assert.equal(detour.challengeDifficulty, 4, `${seed}: orçamento fora de 4`);
    assert.ok(
      detour.challengeDifficulty <= T2_DIFFICULTY_BUDGET,
      `${seed}: orçamento estourado`,
    );

    // Zonas separadas por pelo menos uma zona de permeio.
    const orders = detour.challengeZoneIds.map(zoneId => (
      detour.zoneResults.findIndex(zone => zone.zoneId === zoneId)
    ));
    assert.ok(
      Math.abs(orders[0] - orders[1]) - 1 >= MINIMUM_ZONES_BETWEEN_CHALLENGES,
      `${seed}: desafios em zonas vizinhas`,
    );
  }
  // Rotas com um desafio só continuam existindo: quando o vão não comporta
  // dois, uma bifurcação simples é o resultado certo, não uma falha.
  assert.ok(
    ROUTES.some(entry => entry.detour.challengeCount === 1),
    'nenhuma rota com um desafio só',
  );
});

test('T2 - COMPOSIÇÃO: cada desafio da rota é materializado por inteiro', () => {
  for (const { seed, level, detour } of ROUTES) {
    const phosphateGates = detour.challengeIds.filter(id => id === 'phosphate').length;
    const mycorrhizaGates = detour.challengeIds.filter(id => id === 'mycorrhiza').length;

    const deposits = (level.phosphateDeposits || []).filter(deposit => (
      deposit.optionalDetourId === detour.id
    ));
    assert.equal(deposits.length, phosphateGates, `${seed}: depósitos != gates`);
    for (const deposit of deposits) {
      assert.equal(deposit.broken, false, `${seed}: depósito nasce aberto`);
    }

    const sources = detourPlatforms(level, detour)
      .filter(platform => platform.mycorrhizaBridgeSource);
    const targets = detourPlatforms(level, detour)
      .filter(platform => platform.mycorrhizaBridgeTarget);
    assert.equal(sources.length, mycorrhizaGates, `${seed}: origens != gates`);
    assert.equal(targets.length, mycorrhizaGates, `${seed}: destinos != gates`);
    for (const source of sources) {
      assert.equal(source.strictPreferredMycorrhizaTarget, true, seed);
      assert.ok(
        targets.some(target => target.platformId === source.preferredMycorrhizaTargetId),
        `${seed}: origem sem destino registrado`,
      );
    }

    // Uma aresta bloqueada por desafio, nem mais nem menos.
    const blocked = detour.edges.filter(edge => edge.blockedUntil);
    assert.equal(
      blocked.length,
      detour.challengeCount,
      `${seed}: ${blocked.length} arestas bloqueadas para ${detour.challengeCount} desafios`,
    );
  }
});

test('T2 - COMPOSIÇÃO: um desafio não invade a região reservada do outro', () => {
  for (const { seed, level, detour } of ROUTES) {
    if (detour.challengeCount < 2) continue;
    const owned = new Set(detour.challenges.flatMap(challenge => [
      challenge.approachPlatformId,
      challenge.sourcePlatformId,
      challenge.targetPlatformId,
    ].filter(Boolean)));
    const regions = detour.challenges.flatMap(challenge => [
      challenge.depositBounds,
      challenge.gapBounds,
    ].filter(Boolean));
    for (const platform of detourPlatforms(level, detour)) {
      if (owned.has(platform.platformId)) continue;
      for (const bounds of regions) {
        assert.ok(
          !insideBounds(platform, bounds),
          `${seed}: ${platform.platformId} dentro de região reservada`,
        );
      }
    }
  }
});

test('T2 - a regra do T1 continua exercitável: maximumChallenges 1 nunca compõe', () => {
  let singleRoutes = 0;
  for (const seed of MATRIX_SEEDS.slice(0, 12)) {
    const level = phaseTenGeometry(seed);
    const collected = composeOptionalDetourTopologyT1({
      level,
      candidates: [],
      seedValue: seed,
      abilities: ABILITIES,
      maximumChallenges: 1,
    });
    assert.equal(collected.success, false, 'sem candidatos não deveria compor');
  }
  for (const seed of MATRIX_SEEDS) {
    const level = phaseTenGeometry(seed);
    const detour = createPhaseTenTopologyDetour({
      level,
      phase: 10,
      seedValue: seed,
      abilities: ABILITIES,
      maximumChallenges: 1,
    });
    if (!detour) continue;
    singleRoutes++;
    assert.equal(detour.challengeCount, 1, `${seed}: compôs com limite 1`);
  }
  assert.ok(singleRoutes > 0, 'o modo de um desafio deixou de produzir rotas');
});

test('T2 - SELEÇÃO: pares vêm antes de planos simples e respeitam o orçamento', () => {
  const topology = generateOptionalDetourTopology({
    candidate: { id: 'c' },
    seedValue: 'plano-t2',
    familyId: 'ridge-valley',
  });
  const zoneSpans = Object.fromEntries(
    topology.zones.map(zone => [zone.id, 2000]),
  );
  const selection = selectTopologyChallengePlans({
    topology,
    abilities: ABILITIES,
    organisms: ['bacillus', 'myco'],
    seedValue: 'plano-t2',
    candidateId: 'c',
    zoneSpans,
  });
  assert.ok(selection.plans.length > 0, 'nenhum plano');
  assert.ok(selection.pairCount > 0, 'nenhum par possível com zonas folgadas');
  assert.equal(selection.plans[0].length, 2, 'o primeiro plano não é um par');
  for (const plan of selection.plans) {
    const cost = plan.reduce((sum, entry) => sum + entry.difficultyCost, 0);
    assert.ok(cost <= T2_DIFFICULTY_BUDGET, `plano custa ${cost}`);
    if (plan.length === 2) {
      assert.notEqual(plan[0].challengeId, plan[1].challengeId);
      assert.ok(
        Math.abs(plan[0].zoneOrder - plan[1].zoneOrder) - 1
          >= MINIMUM_ZONES_BETWEEN_CHALLENGES,
      );
    }
  }
  // Determinismo do plano.
  const twin = selectTopologyChallengePlans({
    topology,
    abilities: ABILITIES,
    organisms: ['bacillus', 'myco'],
    seedValue: 'plano-t2',
    candidateId: 'c',
    zoneSpans,
  });
  assert.deepEqual(
    twin.plans.map(plan => plan.map(entry => `${entry.challengeId}@${entry.zoneId}`)),
    selection.plans.map(plan => plan.map(entry => `${entry.challengeId}@${entry.zoneId}`)),
  );
});
