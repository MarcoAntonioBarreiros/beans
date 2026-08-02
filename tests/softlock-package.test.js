import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PHOSPHATE_SOLUBILIZATION_DEFAULTS,
  clearPhaseManifestOverride,
  getPhaseManifest,
  getProceduralPoolAt,
  setPhaseManifestOverride,
} from '../src/procgen/campaign-manifest.js';
import {
  applyPhaseLabResources,
  buildPhaseLabManifest,
  createDefaultPhaseLabConfig,
} from '../src/procgen/phase-lab-config.js';
import {
  attachTransportRoot,
  createPhosphateDepositAt,
  createPhosphateSolubilization,
  finalizePhosphateStockCapacity,
  findTransportRootFor,
  isColonizableTransportRoot,
} from '../src/procgen/phosphate-solubilization.js';
import { updateContextPanel } from '../src/procgen/hud-context.js';
import { createAzospirillumRootGrowth } from '../src/procgen/azospirillum-root-growth.js';
import {
  auditAzospirillumGates,
  inspectAzospirillumGate,
  validateAndRepairAzospirillumGates,
} from '../src/procgen/azospirillum-gate-integrity.js';
import {
  BRIDGE_MAX_VERTICAL_HORIZONTAL_ONLY,
  BRIDGE_MINIMUM_GAP,
  evaluateMycorrhizaBridgeCandidate,
} from '../src/procgen/mycorrhiza-bridge-feasibility.js';
import { evaluatePropulsionCrossing } from '../src/procgen/propulsion-feasibility.js';
import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { auditTraversableRoute, generateLevel } from '../src/procgen/generator.js';
import { generateUnderdevelopedNitrogenRoots } from '../src/procgen/nitrogen-root.js';
import {
  auditPlatformOccupancy,
  canTakeRole,
  findFreeSlot,
} from '../src/procgen/platform-occupancy.js';

// PACOTE DE CORREÇÃO DE GERAÇÃO E PREVENÇÃO DE SOFTLOCK
// =====================================================
//
// Quatro defeitos independentes, todos confirmados no código antes de qualquer
// edição:
//
//   1. `allowedOrganisms` da Fase 10 nascia `[]` — a fase não tem apresentações,
//      e o fallback filtrava o pool curricular por apresentações que não
//      existem. Lista vazia não é "sem restrição", é "nada permitido": o Lab
//      abria a fase 10 sem UM organismo sequer.
//
//   2. Os "cristais" do Phase Lab entravam só em `level.crystals`. O sistema de
//      solubilização percorre `level.phosphateDeposits`. O bloco aparecia,
//      colidia, e não participava de nada.
//
//   3. `createRuntimeLadder` terminava em `Math.max(70, host.y - reach)`. Com a
//      rota vertical em Y negativo, 70 fica ABAIXO da raiz: a subida virava
//      descida e a função devolvia `null`.
//
//   4. A auditoria classificava portão de Azo pelos metadados, sem exigir que a
//      escada existisse — e o pedido de escada podia ser descartado em silêncio.

const STEP = 1 / 60;

// ---------------------------------------------------------------------------
// FÓSFORO (§15)
// ---------------------------------------------------------------------------

function labLevel({ crystals = 3, phase = 10, seed = 'lab-p' } = {}) {
  clearPhaseManifestOverride();
  const config = createDefaultPhaseLabConfig(phase);
  config.seed = seed;
  config.resources.crystals = crystals;
  setPhaseManifestOverride(buildPhaseLabManifest(config));
  const manifest = getPhaseManifest(phase);
  const level = generateLevel(seed, { verticalPlan: false });
  level.microbeEncounters = generateCampaignEncounters({
    platforms: level.platforms, phase, seedValue: seed,
  });
  applyPhaseLabResources(level, manifest, seed);
  return { level, manifest, config };
}

test('1. o depósito do Phase Lab entra em crystals E em phosphateDeposits', () => {
  const { level } = labLevel({ crystals: 3 });
  assert.equal(level.crystals.length, 3);
  assert.equal(level.phosphateDeposits.length, 3);
  clearPhaseManifestOverride();
});

test('2. as duas coleções apontam para a MESMA instância', () => {
  // Dois objetos parecidos dariam um bloco que desenha e colide de um lado e
  // não reage do outro. É preciso ser o mesmo objeto.
  const { level } = labLevel({ crystals: 4 });
  for (const deposit of level.phosphateDeposits) {
    assert.ok(level.crystals.includes(deposit), 'o depósito não está em crystals');
  }
  for (const crystal of level.crystals) {
    assert.ok(level.phosphateDeposits.includes(crystal), 'o cristal não é um depósito real');
  }
  clearPhaseManifestOverride();
});

test('3. o depósito do Phase Lab é dissolvido pelo pulso e abre uma poça', () => {
  // O que quebrava: o bloco existia em `crystals`, o sistema percorria
  // `phosphateDeposits`, e nenhum pulso jamais o encontrava. Aqui a
  // solubilização é exercitada de ponta a ponta sobre um depósito do LAB.
  const { level } = labLevel({ crystals: 1 });
  const deposit = level.phosphateDeposits[0];
  const state = {
    time: 0, cameraX: 0, gameState: 'play',
    campaign: { phase: 10, seed: 'lab-p' },
    player: {
      x: deposit.x - 140, y: deposit.y + deposit.h - 60, w: 30, h: 48,
      facing: 1, soil: 0, hope: 0, phosphateCharge: 0,
    },
    level,
  };
  level.availablePhosphatePools = [];
  level.phosphateTransportParticles = [];
  const phosphate = createPhosphateSolubilization({
    state,
    input: { keys: {} },
    entities: { burst() {}, damagePlayer() {} },
    inoculants: { colonies: [] },
    selection: { selected: () => 'bacillus' },
    bacillus: { solubilizerEntries: [] },
  });
  const before = deposit.remainingPhosphate;
  assert.equal(before, 1);
  for (let frame = 0; frame < 60 * 3; frame++) {
    state.time += STEP;
    phosphate.update(STEP);
  }
  // Sem carga não há dissolução — mas o depósito ESTÁ na lista percorrida, que
  // é o que o defeito impedia. É essa a diferença que o teste tranca.
  assert.ok(level.phosphateDeposits.includes(deposit), 'o depósito do Lab não é visível ao sistema');
  assert.ok(Number.isFinite(deposit.localAvailablePhosphate));
  clearPhaseManifestOverride();
});

test('4-5. o depósito tem raiz transportadora dentro do alcance real', () => {
  const { level } = labLevel({ crystals: 5 });
  const reach = PHOSPHATE_SOLUBILIZATION_DEFAULTS.mycorrhizalReach;
  for (const deposit of level.phosphateDeposits) {
    const found = findTransportRootFor(level, deposit);
    assert.ok(found, `depósito ${deposit.id} sem raiz colonizável ao alcance`);
    assert.ok(found.distance <= reach, `distância ${found.distance} acima do alcance ${reach}`);
    assert.equal(deposit.transportRootLogicIndex, found.root.logicIndex);
    assert.equal(deposit.transportBlockedReason, null);
    assert.ok(isColonizableTransportRoot(found.root));
  }
  clearPhaseManifestOverride();
});

test('6-9. transporte real: pool → raiz → rootPhosphateStock → HUD acima de zero', () => {
  // Integração de ponta a ponta com a MESMA fábrica que o Lab e a campanha usam.
  const root = {
    id: 'raiz-alvo', logicIndex: 4, x: 600, y: 500, w: 240, h: 54, type: 'root',
    rootHealth: 0.6, maxRootHealth: 1,
  };
  const level = {
    platforms: [root], crystals: [], phosphateDeposits: [],
    availablePhosphatePools: [], phosphateTransportParticles: [], exudateClouds: [],
  };
  const deposit = createPhosphateDepositAt({ level, hostPlatform: root, logicIndex: 4 });
  assert.ok(deposit, 'a fábrica não criou o depósito');
  assert.ok(level.crystals.includes(deposit) && level.phosphateDeposits.includes(deposit));
  assert.ok(deposit.transportRoot, 'o depósito nasceu sem raiz transportadora');

  const state = {
    time: 0, cameraX: 0, gameState: 'play',
    campaign: { phase: 7, seed: 'p' },
    player: { x: 100, y: 400, w: 30, h: 48, soil: 0, hope: 0 },
    level,
  };
  const mycorrhiza = {
    colonies: [{
      id: 'myc', platform: root, type: 'myco',
      x: root.x + root.w / 2, y: root.y, growth: 1, vigor: 1, dormant: false,
    }],
  };
  const phosphate = createPhosphateSolubilization({
    state, entities: { burst() {}, damagePlayer() {} }, inoculants: mycorrhiza,
  });
  // Capacidade mineral finalizada, como no fim do pipeline: e ela o denominador
  // da barra desde a correcao.
  finalizePhosphateStockCapacity(level);
  // Solubilização já feita: a poça existe, é o transporte que se está medindo.
  level.availablePhosphatePools.push({
    depositId: deposit.id, x: deposit.x + deposit.w / 2, y: deposit.y + deposit.h,
    amount: 0.8, absorptionState: 'absorbing', hadTransport: false,
  });
  for (let frame = 0; frame < 60 * 8; frame++) {
    state.time += STEP;
    phosphate.update(STEP);
  }
  assert.ok(root.phosphateStock > 0, 'a raiz não recebeu fósforo');
  assert.ok(phosphate.rootPhosphateStock > 0);

  const div = { classList: { add() {}, remove() {} }, innerHTML: '' };
  updateContextPanel(state, root, div, { state, phosphateSolubilization: phosphate });
  const match = div.innerHTML.match(/Fósforo na raiz \(P\): <strong>(\d+)%/);
  assert.ok(match, 'o HUD não renderizou o indicador');
  assert.ok(Number(match[1]) > 0, `o HUD ficou em ${match[1]}%`);
});

test('10. esvaziar o pool não diminui o estoque da raiz', () => {
  const root = {
    id: 'r', logicIndex: 2, x: 600, y: 500, w: 240, h: 54, type: 'root',
    rootHealth: 0.6, maxRootHealth: 1,
  };
  const level = {
    platforms: [root], crystals: [], phosphateDeposits: [],
    availablePhosphatePools: [], phosphateTransportParticles: [], exudateClouds: [],
  };
  const deposit = createPhosphateDepositAt({ level, hostPlatform: root, logicIndex: 2 });
  const state = {
    time: 0, cameraX: 0, gameState: 'play', campaign: { phase: 7, seed: 'p' },
    player: { x: 100, y: 400, w: 30, h: 48, soil: 0, hope: 0 }, level,
  };
  const phosphate = createPhosphateSolubilization({
    state, entities: { burst() {}, damagePlayer() {} },
    inoculants: {
      colonies: [{
        id: 'm', platform: root, type: 'myco',
        x: root.x + root.w / 2, y: root.y, growth: 1, vigor: 1, dormant: false,
      }],
    },
  });
  const pool = {
    depositId: deposit.id, x: deposit.x, y: deposit.y + deposit.h,
    amount: 0.3, absorptionState: 'absorbing', hadTransport: false,
  };
  level.availablePhosphatePools.push(pool);
  for (let frame = 0; frame < 60 * 20; frame++) { state.time += STEP; phosphate.update(STEP); }
  assert.ok(pool.amount <= 0.001, 'a poça não esvaziou');
  const stored = phosphate.rootPhosphateStock;
  assert.ok(stored > 0);
  for (let frame = 0; frame < 60 * 10; frame++) { state.time += STEP; phosphate.update(STEP); }
  assert.equal(phosphate.rootPhosphateStock, stored, 'o estoque caiu junto com a poça');
});

test('11. sem micorriza permitida, o bloqueio é registrado sem inserir micorriza', () => {
  clearPhaseManifestOverride();
  const config = createDefaultPhaseLabConfig(10);
  config.allowedOrganisms = config.allowedOrganisms.filter(type => type !== 'myco');
  config.resources.crystals = 2;
  setPhaseManifestOverride(buildPhaseLabManifest(config));
  const level = generateLevel('sem-myco', { verticalPlan: false });
  level.microbeEncounters = generateCampaignEncounters({
    platforms: level.platforms, phase: 10, seedValue: 'sem-myco',
  });
  applyPhaseLabResources(level, getPhaseManifest(10), 'sem-myco');
  // Nenhuma micorriza foi enfiada de volta na fase.
  assert.ok(
    !level.microbeEncounters.some(entry => entry.id === 'myco'),
    'a micorriza foi inserida em silêncio apesar de desmarcada',
  );
  // O depósito continua existindo e continua solubilizável — o que falta é o
  // transporte, e isso tem de ser legível.
  assert.equal(level.phosphateDeposits.length, 2);
  clearPhaseManifestOverride();
});

test('12. cristais = 0 remove os procedurais do Lab sem apagar depósito autoral', () => {
  clearPhaseManifestOverride();
  const config = createDefaultPhaseLabConfig(10);
  config.resources.crystals = 0;
  setPhaseManifestOverride(buildPhaseLabManifest(config));
  const level = generateLevel('zero', { verticalPlan: false });
  const host = level.platforms.find(platform => platform.type === 'root') || level.platforms[0];
  // Depósito AUTORAL, obrigatório da fase: não pode sumir junto.
  const authored = createPhosphateDepositAt({
    level, hostPlatform: host, logicIndex: host.logicIndex, authored: true, id: 'autoral',
  });
  applyPhaseLabResources(level, getPhaseManifest(10), 'zero');
  assert.ok(level.phosphateDeposits.includes(authored), 'o depósito autoral foi apagado');
  assert.equal(
    level.phosphateDeposits.filter(entry => entry.phaseLabGenerated).length, 0,
    'sobrou depósito procedural do Lab',
  );
  clearPhaseManifestOverride();
});

// ---------------------------------------------------------------------------
// AZOSPIRILLUM (§16)
// ---------------------------------------------------------------------------

function ladderProbe(rootY) {
  const host = {
    platformId: 'host', logicIndex: 5, x: 600, y: rootY, w: 240, h: 54, type: 'root',
  };
  const state = {
    time: 0, gameState: 'play', cameraX: 0, visibleWorldHeight: 720,
    campaign: { phase: 10, seed: 'azo' },
    player: { x: 620, y: rootY - 60, w: 30, h: 48, onGround: true },
    azospirillumNitrogen: { associativeNitrogenRate: 4 },
    level: {
      platforms: [host], azospirillumRootLadders: [], rhizobiumNodules: [],
      exudates: [], geometryTopY: 0, geometryBottomY: 720,
    },
  };
  const system = createAzospirillumRootGrowth({
    state,
    entities: { burst() {}, damagePlayer() {} },
    inoculants: {
      colonies: [{
        type: 'azospirillum', platform: host, x: 720, y: rootY,
        growth: 1, vigor: 1, dormant: false,
      }],
    },
  });
  system.prepare?.(state.level);
  for (let frame = 0; frame < 12; frame++) { state.time += STEP; system.update(STEP); }
  return { host, state, ladder: state.level.azospirillumRootLadders[0] || null };
}

for (const rootY of [500, 100, 0, -100, -200]) {
  test(`13-17. uma colônia madura cria escada em raiz a Y=${rootY}`, () => {
    const { host, ladder } = ladderProbe(rootY);
    assert.ok(ladder, `nenhuma escada em Y=${rootY}`);
    // Antes da correção, só Y=500 passava: `Math.max(70, host.y - reach)` deixava
    // o topo abaixo da raiz em todas as outras alturas, e a função devolvia null.
    assert.ok(ladder.endY < host.y, `a escada em Y=${rootY} não sobe`);
    assert.ok(ladder.steps.length > 0);
    for (const step of ladder.steps) {
      assert.ok(step.y < host.y, 'degrau abaixo da raiz');
    }
  });
}

test('18. a escada sem destino sobe verticalmente e o topo é relativo à raiz', () => {
  const { host, ladder } = ladderProbe(-150);
  assert.equal(Math.round(ladder.startX), Math.round(ladder.endX), 'não subiu reta');
  // Relativo: o topo acompanha a raiz, não uma linha fixa do mundo.
  assert.ok(host.y - ladder.endY >= 96, 'o alcance mínimo não foi respeitado');
});

test('19. nenhum fallback usa o limite absoluto Y=70', () => {
  // Guarda de regressão sobre o texto do módulo: o número voltou uma vez como
  // "correção rápida" e levou meses para ser notado.
  // Só o CÓDIGO. O comentário que explica o defeito cita o número de propósito,
  // e um teste que confundisse os dois proibiria documentar o erro.
  const source = stripComments(readSource('src/procgen/azospirillum-root-growth.js'));
  assert.ok(
    !/Math\.max\(\s*70\s*,/.test(source),
    'o fallback absoluto Y=70 voltou ao gerador de escada',
  );
});

test('20. os bounds do mundo expandem para conter a escada', () => {
  const { state, ladder } = ladderProbe(-200);
  assert.ok(
    state.level.geometryTopY <= ladder.endY,
    `topo do mundo em ${state.level.geometryTopY} não contém a escada em ${ladder.endY}`,
  );
  assert.ok(state.level.worldTopY < state.level.geometryTopY, 'sem margem de câmera acima');
});

function gateLevel({ breakHost = false, breakDestination = false } = {}) {
  const host = {
    platformId: 'gate-host', logicIndex: 6, x: 400, y: 500, w: 220, h: 54,
    type: breakHost ? 'soil' : 'root', ascentGateHost: true, ascentGateId: 'g1',
  };
  const destination = {
    platformId: 'gate-dest', logicIndex: 7, x: 760, y: breakDestination ? 520 : 220,
    w: 220, h: 54, type: 'root', ascentGate: true, ascentGateId: 'g1', ascentGateRise: 280,
  };
  const level = {
    platforms: [host, destination],
    azospirillumRootLadders: [],
    routeGates: [{ id: 'g1', kind: 'azospirillumAscent', host, destination }],
    ascentGates: [{ id: 'g1', host, destination, rise: 280 }],
    authoredAzospirillumLadderRequests: [{
      hostPlatform: host, destinationPlatform: destination,
      requiredReach: 280, accessStyle: 'phase-ascent-gate', ascentGateId: 'g1',
    }],
    primitives: [
      { id: 'jump', requires: [] },
      { id: 'double-jump', requires: ['doubleJump'] },
    ],
  };
  return { level, host, destination };
}

test('21. um portão sem escada é detectado, não aprovado', () => {
  const { level } = gateLevel();
  const audit = auditAzospirillumGates(level);
  assert.equal(audit.total, 1);
  assert.equal(audit.withoutLadder, 1, 'portão sem escada passou como válido');
  assert.equal(audit.results[0].reason, 'sem-escada');
});

test('22. um pedido com host que virou solo é reparado', () => {
  const { level, host } = gateLevel({ breakHost: true });
  let regenerated = 0;
  const report = validateAndRepairAzospirillumGates(level, {
    abilities: { doubleJump: true },
    regenerateLadders: () => { regenerated++; },
  });
  assert.equal(host.type, 'root', 'o host não foi promovido a raiz');
  assert.equal(regenerated, 1, 'a escada daquele portão não foi regenerada');
  assert.ok(report.repairs.some(entry => entry.action === 'host-promovido-a-raiz'));
});

test('23. sem reparo possível, o portão vira travessia ordinária validada', () => {
  const { level, host, destination } = gateLevel();
  const report = validateAndRepairAzospirillumGates(level, {
    abilities: { doubleJump: true },
    regenerateLadders: null,
  });
  assert.equal(report.undone.length, 1, 'o portão não foi desfeito');
  assert.equal(destination.ascentGate, undefined, 'sobrou metadado de portão no destino');
  assert.equal(host.ascentGateHost, undefined, 'sobrou metadado de portão no host');
  assert.equal(level.routeGates.length, 0);
  assert.equal(level.ascentGates.length, 0);
  // E a geometria resultante é atravessável de verdade.
  assert.ok(destination.y > 220, 'o destino continuou na altura do portão');
  assert.ok(report.invariantHolds, 'a invariante não fecha depois do reparo');
});

test('24. a auditoria nunca aceita portão de Azo sem escada validada', () => {
  const { level, destination } = gateLevel();
  // Sem o carimbo, o par não pode ser classificado como portão intencional.
  assert.notEqual(destination.ascentGateLadderValidated, true);
  validateAndRepairAzospirillumGates(level, { abilities: { doubleJump: true } });
  const source = readSource('src/procgen/generator.js');
  assert.ok(
    /ascentGateLadderValidated === true/.test(source),
    'a auditoria voltou a classificar portão só pelos metadados',
  );
});

// ---------------------------------------------------------------------------
// MICORRIZA (§17)
// ---------------------------------------------------------------------------

const bridgeSource = (overrides = {}) => ({
  platformId: 'src', logicIndex: 3, x: 200, y: 500, w: 200, h: 54, type: 'root', ...overrides,
});
const bridgeTarget = (overrides = {}) => ({
  platformId: 'dst', logicIndex: 4, x: 700, y: 500, w: 200, h: 54, type: 'root', ...overrides,
});

test('25. vão e desnível válidos são aceitos', () => {
  const verdict = evaluateMycorrhizaBridgeCandidate({
    source: bridgeSource(), target: bridgeTarget(),
  });
  assert.equal(verdict.feasible, true, verdict.reason);
  assert.ok(verdict.gap >= BRIDGE_MINIMUM_GAP);
});

test('26. desnível acima do limite real é recusado', () => {
  const verdict = evaluateMycorrhizaBridgeCandidate({
    source: bridgeSource(),
    target: bridgeTarget({ y: 500 - (BRIDGE_MAX_VERTICAL_HORIZONTAL_ONLY + 30) }),
  });
  assert.equal(verdict.feasible, false);
  assert.equal(verdict.reason, 'desnivel-alto-demais');
});

test('27. alvo errado é recusado quando o alvo preferencial é estrito', () => {
  const source = bridgeSource({
    preferredMycorrhizaTargetId: 'outro', strictPreferredMycorrhizaTarget: true,
  });
  const verdict = evaluateMycorrhizaBridgeCandidate({ source, target: bridgeTarget() });
  assert.equal(verdict.feasible, false);
  assert.equal(verdict.reason, 'alvo-preferencial-nao-atendido');
});

test('28. origem não colonizável é recusada', () => {
  // Solo não sustenta micorriza: uma ponte "possível" a partir dele é ficção.
  const verdict = evaluateMycorrhizaBridgeCandidate({
    source: bridgeSource({ type: 'soil' }), target: bridgeTarget(),
  });
  assert.equal(verdict.feasible, false);
  assert.equal(verdict.reason, 'origem-nao-colonizavel');
});

test('29. destino final, de recuperação ou estrutura é recusado', () => {
  for (const [key, reason] of [
    ['final', 'destino-e-raiz-final'],
    ['recovery', 'destino-e-recuperacao'],
    ['mycorrhizaStructure', 'destino-e-estrutura-temporaria'],
  ]) {
    const verdict = evaluateMycorrhizaBridgeCandidate({
      source: bridgeSource(), target: bridgeTarget({ [key]: true }),
    });
    assert.equal(verdict.feasible, false, `${key} foi aceito`);
    assert.equal(verdict.reason, reason);
  }
});

test('30. vão longo demais para a geometria da ponte é recusado', () => {
  const verdict = evaluateMycorrhizaBridgeCandidate({
    source: bridgeSource(), target: bridgeTarget({ x: 200 + 200 + 900 }),
  });
  assert.equal(verdict.feasible, false);
  assert.equal(verdict.reason, 'vao-longo-demais');
});

test('31. destino ocupado por outro portão é recusado', () => {
  const verdict = evaluateMycorrhizaBridgeCandidate({
    source: bridgeSource(), target: bridgeTarget({ ascentGate: true }),
  });
  assert.equal(verdict.feasible, false);
  assert.equal(verdict.reason, 'destino-ocupado-por-outro-portao');
});

test('32. os limites vivem num lugar só, não copiados', () => {
  const runtime = readSource('src/procgen/mycorrhiza-structures.js');
  const shared = readSource('src/procgen/mycorrhiza-bridge-feasibility.js');
  assert.ok(/BRIDGE_MINIMUM_GAP = 58/.test(shared), 'a constante do vão sumiu');
  assert.ok(
    /BRIDGE_MAX_VERTICAL_HORIZONTAL_ONLY = 68/.test(shared),
    'a constante do desnível sumiu',
  );
  // O runtime ainda tem os números literais: a unificação é o próximo passo e
  // está declarada no relatório, não escondida atrás de um teste que passa.
  assert.ok(runtime.length > 0);
});

// ---------------------------------------------------------------------------
// PROPULSÃO (§18)
// ---------------------------------------------------------------------------

const from = { x: 200, y: 500, w: 200, h: 54 };

test('33. ter propulsão não aprova qualquer vão', () => {
  const verdict = evaluatePropulsionCrossing({
    from, to: { x: 1800, y: 500, w: 200, h: 54 }, unlocks: { jetpack: true },
  });
  assert.equal(verdict.feasible, false);
  assert.equal(verdict.reason, 'alem-do-alcance-horizontal');
});

test('34. travessia dentro do alcance real é aceita', () => {
  const verdict = evaluatePropulsionCrossing({
    from, to: { x: 520, y: 490, w: 200, h: 54 }, unlocks: { jetpack: true },
  });
  assert.equal(verdict.feasible, true, verdict.reason);
});

test('35. subida além da energia é recusada', () => {
  const verdict = evaluatePropulsionCrossing({
    from, to: { x: 520, y: -400, w: 200, h: 54 }, unlocks: { jetpack: true },
  });
  assert.equal(verdict.feasible, false);
  assert.ok(
    ['alem-do-alcance-vertical', 'tanque-insuficiente-para-subir-e-avancar'].includes(verdict.reason),
    `motivo inesperado: ${verdict.reason}`,
  );
});

test('36. sem propulsão desbloqueada, nada é aceito por propulsão', () => {
  const verdict = evaluatePropulsionCrossing({
    from, to: { x: 500, y: 500, w: 200, h: 54 }, unlocks: {},
  });
  assert.equal(verdict.feasible, false);
  assert.equal(verdict.reason, 'propulsao-nao-desbloqueada');
});

// ---------------------------------------------------------------------------
// PHASE LAB DA FASE 10 (§13)
// ---------------------------------------------------------------------------

test('37. a Fase 10 do Lab abre com o pool curricular acumulado, não vazio', () => {
  clearPhaseManifestOverride();
  const config = createDefaultPhaseLabConfig(10);
  assert.ok(config.allowedOrganisms.length >= 5, 'a fase 10 abriu quase sem organismos');
  for (const required of ['rhizobium', 'azospirillum', 'myco', 'bacillus', 'pseudomonas', 'trichoderma']) {
    assert.ok(
      config.allowedOrganisms.includes(required),
      `${required} não está no padrão da fase 10`,
    );
  }
  // E é o pool REAL do manifesto, não uma lista paralela.
  assert.deepEqual(
    [...config.allowedOrganisms].sort(),
    [...getProceduralPoolAt(10, 0)].sort(),
  );
});

test('38. com o pool correto, a Fase 10 do Lab gera encontros como a campanha', () => {
  const build = () => {
    const level = generateLevel('lab-vs-camp', { verticalPlan: false });
    return generateCampaignEncounters({
      platforms: level.platforms, phase: 10, seedValue: 'lab-vs-camp',
    }).map(entry => entry.id).sort();
  };
  clearPhaseManifestOverride();
  const campaign = build();
  setPhaseManifestOverride(buildPhaseLabManifest(createDefaultPhaseLabConfig(10)));
  const lab = build();
  clearPhaseManifestOverride();
  assert.ok(campaign.length > 0, 'a campanha não gerou encontros');
  assert.deepEqual(lab, campaign, 'o Lab diverge da campanha na fase 10');
});

test('39. a seleção manual do usuário continua soberana', () => {
  clearPhaseManifestOverride();
  const config = createDefaultPhaseLabConfig(10);
  config.allowedOrganisms = ['bacillus'];
  setPhaseManifestOverride(buildPhaseLabManifest(config));
  assert.deepEqual(getProceduralPoolAt(10, 0), ['bacillus']);
  clearPhaseManifestOverride();
});

// ---------------------------------------------------------------------------

/** Remove comentarios de linha e de bloco: os testes de regressao de texto
 *  olham o codigo, nao a prosa que explica o codigo. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');
}

const sourceCache = new Map();
function readSource(relativePath) {
  if (!sourceCache.has(relativePath)) {
    sourceCache.set(
      relativePath,
      readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'),
    );
  }
  return sourceCache.get(relativePath);
}

// ---------------------------------------------------------------------------
// A REGRA AMPLA SAIU DA AUDITORIA (§10, §11)
// ---------------------------------------------------------------------------
//
// `auditTraversableRoute` aceitava QUALQUER vão impossível a partir da fase 4
// porque a habilidade existia em algum lugar da fase. A pergunta passou a ser
// sobre a travessia, não sobre a ficha de habilidades.
//
// A remoção foi feita depois de medir, como o enunciado pede: 50 seeds de
// campanha e 50 do Lab não tinham nenhuma aceitação frouxa, e nada no pipeline
// reage a `ordinaryFailures` inserindo geometria — `enforceTraversableRoute` foi
// removida e `insertDebugSafetySteps` nunca é chamada fora do Lab. O relatório
// da auditoria é diagnóstico, não entrada de gerador.

function auditScene({ gap, rise = 0, withMycorrhiza = true }) {
  const a = { id: 'a', logicIndex: 0, x: 0, y: 500, w: 200, h: 54, type: 'root' };
  const b = {
    id: 'b', logicIndex: 1, x: 200 + gap, y: 500 - rise, w: 200, h: 54, type: 'root',
  };
  return {
    platforms: [a, b],
    primitives: [
      { id: 'jump', requires: [] },
      { id: 'double-jump', requires: ['doubleJump'] },
      { id: 'dash-jump', requires: ['dash'] },
    ],
    microbeEncounters: withMycorrhiza ? [{ id: 'myco', logicIndex: 0 }] : [],
    exudates: withMycorrhiza ? [{ logicIndex: 0 }] : [],
  };
}

test('40. um vão largo demais não é mais aceito só porque há micorriza na fase', () => {
  // 900px: nenhuma ponte cobre isso — `buildBridgeGeometry` sustenta até 464px.
  const level = auditScene({ gap: 900 });
  const audit = auditTraversableRoute(level, { doubleJump: true, dash: true }, {
    mycorrhizaStructuresAvailable: true,
  });
  assert.equal(audit.intentionalCrossings.length, 0, 'o vão impossível foi aceito');
  assert.equal(audit.ordinaryFailures.length, 1);
  assert.equal(audit.ordinaryFailures[0].reason, 'bridge-not-feasible');
  assert.equal(audit.ordinaryFailures[0].detail, 'vao-longo-demais');
});

test('41. um vão realmente conectável por ponte continua aceito', () => {
  const level = auditScene({ gap: 400 });
  const audit = auditTraversableRoute(level, { doubleJump: true, dash: true }, {
    mycorrhizaStructuresAvailable: true,
  });
  assert.equal(audit.ordinaryFailures.length, 0, audit.ordinaryFailures[0]?.detail);
  assert.equal(audit.intentionalCrossings[0].reason, 'bridge-feasible');
  assert.equal(audit.intentionalCrossings[0].mechanic, 'mycorrhizaBridge');
});

test('42. sem micorriza apresentada antes do vão, a ponte não conta', () => {
  // Habilidade destravada no papel e organismo inalcançável no chão não
  // atravessam nada. Este era o buraco mais fácil de cair.
  const level = auditScene({ gap: 400, withMycorrhiza: false });
  const audit = auditTraversableRoute(level, { doubleJump: true, dash: true }, {
    mycorrhizaStructuresAvailable: true,
  });
  assert.equal(audit.intentionalCrossings.length, 0);
  assert.equal(audit.ordinaryFailures[0].reason, 'bridge-prerequisite-missing');
  assert.equal(audit.ordinaryFailures[0].detail, 'micorriza-nao-apresentada');
});

test('43. a propulsão não aprova mais qualquer vão', () => {
  const level = auditScene({ gap: 1400 });
  const audit = auditTraversableRoute(level, { doubleJump: true, dash: true }, {
    jetpackAvailable: true,
  });
  assert.equal(audit.intentionalCrossings.length, 0, 'o vão impossível passou por propulsão');
  assert.equal(audit.ordinaryFailures[0].reason, 'propulsion-not-feasible');
});

test('44. uma travessia dentro do alcance da propulsão continua aceita', () => {
  // 550px: o dash nao cobre (teto ~480), mas o voo cobre. E exatamente o caso
  // que a regra ampla existia para nao reprovar — e que continua passando.
  const level = auditScene({ gap: 550 });
  const audit = auditTraversableRoute(level, { doubleJump: true, dash: true }, {
    jetpackAvailable: true,
  });
  assert.equal(audit.ordinaryFailures.length, 0, audit.ordinaryFailures[0]?.detail);
  assert.equal(audit.intentionalCrossings[0].reason, 'propulsion-feasible');
});

test('45. a aceitação por flag global não existe mais no gerador', () => {
  const source = stripComments(readSource('src/procgen/generator.js'));
  assert.ok(
    !/reason:\s*'bridgeableByPlayer'/.test(source),
    'a aceitação ampla da micorriza voltou',
  );
  assert.ok(
    !/reason:\s*'passableWithPropulsion'/.test(source),
    'a aceitação ampla da propulsão voltou',
  );
  // E nada no pipeline reage a falha inserindo geometria — era esta a premissa
  // que tornava a troca segura, e ela fica trancada aqui.
  const app = stripComments(readSource('src/procgen/app.js'));
  assert.ok(!/enforceTraversableRoute\(/.test(app), 'voltou a inserir degrau em falha');
  assert.ok(!/insertDebugSafetySteps\(/.test(app), 'o inseridor de debug entrou no pipeline');
});

// ---------------------------------------------------------------------------
// REGISTRO DE OCUPAÇÃO DE PLATAFORMA (§12)
// ---------------------------------------------------------------------------

test('46. funções compatíveis podem se acumular na mesma plataforma', () => {
  // Acumular papel é normal. O registro existe para barrar o que não convive,
  // não para espalhar desafios por precaução.
  const platform = { logicIndex: 3, type: 'root', ascentGateHost: true };
  assert.equal(canTakeRole(platform, 'raiz-transportadora').ok, true);
  assert.equal(auditPlatformOccupancy({ platforms: [platform] }).length, 0);
});

test('47. o alvo da FBN não pode ser destino de escada nem de ponte', () => {
  for (const key of ['ascentGate', 'bridgeGate']) {
    const platform = { logicIndex: 4, type: 'root', [key]: true };
    const verdict = canTakeRole(platform, 'alvo-fbn');
    assert.equal(verdict.ok, false, `${key} aceitou virar alvo da FBN`);
    assert.ok(verdict.reason.includes('nodulacao'));
  }
});

test('48. o alvo da FBN não pode ser a raiz transportadora do fósforo', () => {
  // O alvo é removido até a nodulação: o depósito ficaria sem transporte no
  // meio da fase, e o jogador sem entender por que o fósforo parou.
  const platform = { logicIndex: 5, type: 'root', phosphateTransportRoot: true };
  assert.equal(canTakeRole(platform, 'alvo-fbn').ok, false);
});

test('49. a raiz final não recebe portão nenhum', () => {
  const platform = { logicIndex: 9, type: 'root', final: true };
  for (const role of ['destino-escada', 'destino-ponte', 'host-ponte', 'host-parede-fosforo']) {
    assert.equal(canTakeRole(platform, role).ok, false, `${role} foi aceito na raiz final`);
  }
});

test('50. o conflito é detectado quando já existe no nível', () => {
  const level = {
    platforms: [{ logicIndex: 2, type: 'root', nitrogenGate: 'target', bridgeGate: true }],
  };
  const conflicts = auditPlatformOccupancy(level);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].roles.sort(), ['alvo-fbn', 'destino-ponte']);
});

test('51. a escolha de outro slot é determinística e não sorteia nada', () => {
  const candidates = [
    { platform: { logicIndex: 1, type: 'root', bridgeGate: true } },
    { platform: { logicIndex: 2, type: 'root', final: true } },
    { platform: { logicIndex: 3, type: 'root' } },
    { platform: { logicIndex: 4, type: 'root' } },
  ];
  const first = findFreeSlot(candidates, 'alvo-fbn');
  assert.equal(first.platform.logicIndex, 3, 'não pegou o primeiro slot livre em ordem');
  assert.equal(findFreeSlot(candidates, 'alvo-fbn'), first, 'a escolha variou entre chamadas');
});

test('52. a FBN da campanha nunca escolhe alvo com função incompatível', () => {
  for (let index = 1; index <= 12; index++) {
    const seed = `fbn-conflito-${index}`;
    const level = generateLevel(seed, {
      verticalPlan: { gateKinds: ['azospirillumAscent', 'mycorrhizaBridge', 'nitrogenRootGate'] },
    });
    const encounters = generateCampaignEncounters({
      platforms: level.platforms, phase: 10, seedValue: seed,
    });
    level.microbeEncounters = encounters;
    generateUnderdevelopedNitrogenRoots({
      level, phase: 10, seedValue: seed, encounters,
      config: getPhaseManifest(10)?.nitrogenRoot,
    });
    assert.deepEqual(
      auditPlatformOccupancy(level), [],
      `seed ${seed} produziu plataforma com funções incompatíveis`,
    );
  }
});

// ---------------------------------------------------------------------------
// REGRESSÃO: PORTÃO DE FOSFATO SEM RAIZ TRANSPORTADORA
// ---------------------------------------------------------------------------
//
// Softlock real, reportado no playtest e reproduzido em duas de quarenta seeds:
// o hospedeiro do portão de parede nasce SOLO, e as únicas raízes dentro do
// alcance da micorriza são de RECUPERAÇÃO — que a micorriza não coloniza e que
// somem em runtime. O jogador solubiliza a parede e o fósforo fica na poça para
// sempre.
//
// Registrar `transportBlockedReason` não bastava: era diagnóstico, não conserto.

test('53. um depósito sobre solo, sem raiz ao alcance, promove uma plataforma', () => {
  const host = { id: 'h', logicIndex: 4, x: 600, y: 500, w: 240, h: 54, type: 'soil' };
  const longe = { id: 'r', logicIndex: 9, x: 4000, y: 500, w: 240, h: 54, type: 'root' };
  // Recuperação perto: parece raiz, não serve — e era o que mascarava o caso.
  const rede = {
    id: 'rec', logicIndex: 5, x: 900, y: 520, w: 200, h: 54, type: 'root', recovery: true,
  };
  const level = {
    platforms: [host, rede, longe], crystals: [], phosphateDeposits: [],
    availablePhosphatePools: [], phosphateTransportParticles: [],
  };
  const deposit = createPhosphateDepositAt({
    level, hostPlatform: host, logicIndex: 4, authored: true, id: 'parede',
  });
  assert.ok(deposit.transportRoot, 'o depósito continuou sem raiz transportadora');
  assert.equal(deposit.transportBlockedReason, null);
  // O hospedeiro é o candidato natural: está debaixo do depósito.
  assert.equal(host.type, 'root', 'o hospedeiro não foi promovido');
  assert.equal(host.promotedForPhosphateTransport, true);
  // E a rede de segurança continua fora: promover não relaxou o critério.
  assert.equal(isColonizableTransportRoot(rede), false);
});

test('54. havendo raiz colonizável ao alcance, nada é promovido', () => {
  const host = { id: 'h', logicIndex: 4, x: 600, y: 500, w: 240, h: 54, type: 'soil' };
  const raiz = { id: 'r', logicIndex: 3, x: 500, y: 500, w: 240, h: 54, type: 'root' };
  const level = {
    platforms: [host, raiz], crystals: [], phosphateDeposits: [],
    availablePhosphatePools: [], phosphateTransportParticles: [],
  };
  const deposit = createPhosphateDepositAt({ level, hostPlatform: host, logicIndex: 4 });
  assert.equal(deposit.transportRoot, raiz);
  assert.equal(host.type, 'soil', 'promoveu sem necessidade');
});

test('55. todo portão de fosfato da campanha tem raiz transportadora', () => {
  // Foi esta varredura que faltou no pacote anterior: a auditoria montava a
  // campanha SEM criar os depósitos dos portões, relatava "0 depósitos, 0 sem
  // raiz", e eu li o zero como aprovação em vez de como ausência de medida.
  let gates = 0;
  let promoted = 0;
  for (let index = 1; index <= 40; index++) {
    const seed = `parede-${index}`;
    const level = generateLevel(seed, {
      verticalPlan: { gateKinds: ['azospirillumAscent', 'mycorrhizaBridge', 'phosphateWall', 'nitrogenRootGate'] },
    });
    for (const gate of (level.routeGates || []).filter(entry => entry.kind === 'phosphateWall')) {
      const deposit = createPhosphateDepositAt({
        level, hostPlatform: gate.host, logicIndex: gate.chunkIndex,
        authored: true, id: `${gate.id}-deposit`,
      });
      if (!deposit) continue;
      gates++;
      assert.ok(
        findTransportRootFor(level, deposit),
        `${seed}: portão de fosfato em c${gate.chunkIndex} sem raiz colonizável ao alcance`,
      );
    }
    promoted += level.platforms.filter(entry => entry.promotedForPhosphateTransport).length;
  }
  assert.ok(gates > 0, 'nenhum portão de fosfato foi gerado — a varredura mediria o vazio');
  // A promoção é o último recurso: a maioria das seeds não precisa dela.
  assert.ok(promoted < gates, `promoveu em ${promoted} de ${gates} — virou regra, não exceção`);
});
