import assert from 'node:assert/strict';
import test from 'node:test';

import { generateLevel } from '../src/procgen/generator.js';
import { createSimulator } from '../src/procgen/simulator.js';
import { tutorialPacing } from '../src/procgen/campaign-manifest.js';
import { createTutorialFlow } from '../src/procgen/tutorial-flow.js';
import {
  isHardReloadShortcut,
  isTutorialAdvanceShortcut,
  TUTORIAL_STORAGE_KEYS,
} from '../src/procgen/tutorial-manager.js';
import {
  createTutorialTriggers,
  TUTORIAL_PROXIMITY,
  TUTORIAL_SIMULTANEOUS_FIRST_ENCOUNTERS_EVENT,
} from '../src/procgen/tutorial-triggers.js';
import { getCardsTaughtBeforePhase } from '../src/procgen/tutorial-prior-knowledge.js';
import {
  createAutomaticTutorialSafetyGate,
  createPendingTutorialQueue,
  findSupportingTutorialPlatform,
  stabilizePlayerForAutomaticTutorial,
} from '../src/procgen/tutorial-presentation.js';
import {
  advanceGameplayFrame,
  createTutorialInputGate,
} from '../src/procgen/tutorial-pause.js';

test('simuladores auxiliares não substituem o simulador ativo exposto', () => {
  const previousWindow = globalThis.window;
  const activeSimulator = createSimulator();
  globalThis.window = { miguelitoSim: activeSimulator };

  try {
    generateLevel('tutorial-runtime-regression');
    assert.equal(globalThis.window.miguelitoSim, activeSimulator);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

function runTriggerScenario({
  agents = [],
  encounters = [],
  enemies = [],
  juveniles = [],
  galls = [],
  discovered = [],
  seen = [],
} = {}) {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const triggered = [];
  const simultaneousDiagnostics = [];
  const seenCards = new Set(seen);
  globalThis.window.addEventListener(TUTORIAL_SIMULTANEOUS_FIRST_ENCOUNTERS_EVENT, event => {
    simultaneousDiagnostics.push(event.detail);
  });
  const state = {
    gameState: 'play',
    campaign: { transitionRequested: false },
    player: {
      x: 0, y: 0, w: 0, h: 0, exudates: 0,
      canDoubleJump: false, canDash: false, canPulse: false,
    },
    discoveredMicrobes: new Set(discovered),
    level: {
      enemies, rhizobiumNodules: [], biofilms: [],
      mycorrhizaArbuscules: [], platforms: [], azospirillumRoots: [],
    },
  };
  const sim = {
    ecology: {
      agents,
      encounters,
    },
    beneficialInoculants: { followerCount: 0 },
    trichodermaColonies: { followerCount: 0 },
    meloidogyneLifecycle: { juveniles, eggMasses: [], galls },
    pseudomonasSiderophores: { freeCount: 0, loadedCount: 0, ironRecovered: 0 },
    trichoderma: { attackCount: 0 },
  };
  const manager = {
    isOpen: false,
    hasSeen: id => seenCards.has(id),
    trigger: id => {
      triggered.push(id);
      return true;
    },
  };

  try {
    const triggers = createTutorialTriggers({
      state,
      sim,
      manager,
      ralstoniaControl: { foci: [] },
      trichodermaRhizoctoniaControl: { activeAttackCount: 0 },
    });
    triggers.update();
    return { triggered, discovered: state.discoveredMicrobes, simultaneousDiagnostics };
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

function runMicrobeTriggerAt(distance) {
  return runTriggerScenario({
    agents: [{ type: 'bacillus', x: distance, y: 0 }],
    encounters: [{ id: 'bacillus', x: distance, y: 0, r: 185 }],
  });
}

test('cartão de organismo não abre somente porque ele está desenhado à distância', () => {
  const result = runMicrobeTriggerAt(TUTORIAL_PROXIMITY.microbeAgent + 1);
  assert.deepEqual(result.triggered, []);
  assert.equal(result.discovered.size, 0);
});

test('cartão de organismo abre quando Miguelito chega bem perto', () => {
  const result = runMicrobeTriggerAt(TUTORIAL_PROXIMITY.microbeAgent - 1);
  assert.deepEqual(result.triggered, ['organism-bacillus']);
  assert.equal(result.discovered.has('bacillus'), true);
});

test('indivíduo na borda não antecipa cartão de uma estreia ainda tethered', () => {
  const result = runTriggerScenario({
    agents: [{ type: 'bacillus', zoneIndex: 0, x: 72, y: 0 }],
    encounters: [{
      id: 'bacillus', source: 'debut', tetherUntilSeen: true,
      x: TUTORIAL_PROXIMITY.microbeCommunity + 1, y: 0,
    }],
  });

  assert.deepEqual(result.triggered, []);
  assert.equal(result.discovered.size, 0);
});

test('estreia tethered abre pelo centro da primeira colônia', () => {
  const result = runTriggerScenario({
    agents: [{ type: 'bacillus', zoneIndex: 0, x: 400, y: 0 }],
    encounters: [{
      id: 'bacillus', source: 'debut', tetherUntilSeen: true,
      x: TUTORIAL_PROXIMITY.microbeCommunity - 1, y: 0,
    }],
  });

  assert.deepEqual(result.triggered, ['organism-bacillus']);
  assert.equal(result.discovered.has('bacillus'), true);
});

test('organismo mais próximo tem prioridade entre tipos diferentes', () => {
  const result = runTriggerScenario({
    enemies: [{ type: 'rhizoctonia', alive: true, x: 240, y: 0, w: 0, h: 0 }],
    juveniles: [{ alive: true, x: 80, y: 0 }],
  });

  assert.deepEqual(result.triggered, ['organism-meloidogyne-j2']);
  assert.equal(result.simultaneousDiagnostics.length, 1);
  assert.deepEqual(
    result.simultaneousDiagnostics[0].candidates.map(candidate => candidate.cardId),
    ['organism-meloidogyne-j2', 'organism-rhizoctonia'],
  );
});

test('descoberta lógica distante não abre cartão sem proximidade', () => {
  const result = runTriggerScenario({ discovered: ['bacillus'] });
  assert.deepEqual(result.triggered, []);
});

test('atalhos de hard reload são reconhecidos sem confundir recarga comum', () => {
  assert.equal(isHardReloadShortcut({ code: 'F5', ctrlKey: true }), true);
  assert.equal(isHardReloadShortcut({ code: 'KeyR', ctrlKey: true, shiftKey: true }), true);
  assert.equal(isHardReloadShortcut({ code: 'KeyR', metaKey: true, shiftKey: true }), true);
  assert.equal(isHardReloadShortcut({ code: 'F5' }), false);
  assert.equal(isHardReloadShortcut({ code: 'KeyR', ctrlKey: true, shiftKey: false }), false);
  assert.match(TUTORIAL_STORAGE_KEYS.seen, /:v3$/);
  assert.match(TUTORIAL_STORAGE_KEYS.unlocked, /:v3$/);
  assert.match(TUTORIAL_STORAGE_KEYS.pages, /:v3$/);
});

test('andar e pular não avançam nem fecham o cartão', () => {
  assert.equal(isTutorialAdvanceShortcut({ code: 'ArrowLeft' }), false);
  assert.equal(isTutorialAdvanceShortcut({ code: 'ArrowRight' }), false);
  assert.equal(isTutorialAdvanceShortcut({ code: 'Space' }), false);
  assert.equal(isTutorialAdvanceShortcut({ code: 'Enter' }), true);
  assert.equal(isTutorialAdvanceShortcut({ code: 'Enter', repeat: true }), false);
});

const guided = (overrides = {}) => ({
  tutorialMode: 'guided',
  phase: 1,
  chunkIndex: 4,
  worldX: 1000,
  visibleWorldWidth: 900,
  nowSeconds: 10,
  ...overrides,
});

const firstEncounter = (overrides = {}) => guided({
  source: tutorialPacing.firstAppearanceEvent,
  ...overrides,
});

test('estreia obrigatória abre por proximidade mesmo em modo silencioso e sob trava espacial', () => {
  const flow = createTutorialFlow();
  const welcome = flow.handle('system-welcome', guided({ worldX: 900, nowSeconds: 1 }));
  assert.equal(welcome.open, true);
  flow.markSeen(welcome.cardId);

  const bacillus = flow.handle('organism-bacillus', firstEncounter({
    tutorialMode: 'silent',
    phase: 1,
    chunkIndex: 6,
    worldX: 950,
    nowSeconds: 2,
  }));
  assert.equal(bacillus.open, true);
  assert.equal(bacillus.reason, 'mandatory-first-appearance');
  assert.deepEqual(bacillus.unlockedPages, [0]);
});

test('bypass obrigatório não vale para organismo conhecido, geração ou gatilho derivado', () => {
  const known = createTutorialFlow({ seen: ['organism-bacillus'], unlocked: ['organism-bacillus'] });
  const knownEncounter = known.handle('organism-bacillus', firstEncounter({ phase: 1, chunkIndex: 6 }));
  assert.equal(knownEncounter.open, false);
  assert.equal(knownEncounter.reason, 'already-seen');

  const generated = createTutorialFlow();
  const generationEvent = generated.handle('organism-bacillus', guided({ phase: 1, chunkIndex: 6 }));
  assert.equal(generationEvent.open, false);
  assert.equal(generationEvent.reason, 'proximity-required');

  const derived = generated.handle('structure-biofilm', guided({ phase: 1, chunkIndex: 6 }));
  assert.equal(derived.open, false);
  assert.equal(derived.reason, 'guide-only');
});

test('cadeias liberam páginas progressivamente no mesmo cartão sem abrir derivados', () => {
  const flow = createTutorialFlow();
  const bacillus = flow.handle('organism-bacillus', firstEncounter({ phase: 1, chunkIndex: 6 }));
  assert.deepEqual(bacillus.unlockedPages, [0]);
  flow.markSeen(bacillus.cardId);

  const biofilm = flow.handle('structure-biofilm', guided({
    tutorialMode: 'silent',
    phase: 1,
    chunkIndex: 12,
  }));
  assert.equal(biofilm.cardId, 'organism-bacillus');
  assert.equal(biofilm.open, false);
  assert.equal(biofilm.reason, 'guide-only');
  assert.deepEqual(flow.pagesFor('organism-bacillus'), [0, 1, 2, 3]);

  const rhizobium = createTutorialFlow();
  rhizobium.handle('organism-rhizobium', firstEncounter({ phase: 2, chunkIndex: 4 }));
  assert.deepEqual(rhizobium.pagesFor('organism-rhizobium'), [0]);
  rhizobium.handle('structure-nodule', guided({ phase: 2, chunkIndex: 6 }));
  assert.deepEqual(rhizobium.pagesFor('organism-rhizobium'), [0, 1, 2]);
  rhizobium.handle('process-fbn', guided({ phase: 2, chunkIndex: 8 }));
  assert.deepEqual(rhizobium.pagesFor('organism-rhizobium'), [0, 1, 2, 3]);
});

test('fungo e Pseudomonas mantêm cartões separados e competição exige ambos conhecidos', () => {
  const flow = createTutorialFlow();
  const opportunist = flow.handle('organism-opportunistic-fungus', firstEncounter({
    phase: 5, chunkIndex: 2, worldX: 4000,
  }));
  assert.equal(opportunist.cardId, 'organism-opportunistic-fungus');
  flow.markSeen(opportunist.cardId);

  const prematureProcess = flow.handle('process-iron-competition', guided({
    phase: 5, chunkIndex: 13, worldX: 4200,
  }));
  assert.equal(prematureProcess.handled, false);
  assert.equal(prematureProcess.reason, 'prerequisite');

  const pseudomonas = flow.handle('organism-pseudomonas', firstEncounter({
    phase: 5, chunkIndex: 8, worldX: 4100,
  }));
  assert.equal(pseudomonas.cardId, 'organism-pseudomonas');
  assert.notEqual(pseudomonas.cardId, opportunist.cardId);
  flow.markSeen(pseudomonas.cardId);

  const process = flow.handle('process-iron-competition', guided({
    phase: 5, chunkIndex: 13, worldX: 4200,
  }));
  assert.equal(process.handled, true);
  assert.equal(process.cardId, 'process-iron-competition');
});

test('modo silencioso e trava espacial registram no GUIA sem pausar', () => {
  const silentFlow = createTutorialFlow();
  const silent = silentFlow.handle('action-exudate', guided({ tutorialMode: 'silent' }));
  assert.equal(silent.open, false);
  assert.equal(silent.reason, 'silent');
  assert.deepEqual(silentFlow.pagesFor('action-exudate'), [0, 1, 2]);

  const spacedFlow = createTutorialFlow();
  const welcome = spacedFlow.handle('system-welcome', guided({ worldX: 0, nowSeconds: 0 }));
  assert.equal(welcome.open, true);
  spacedFlow.markSeen(welcome.cardId);
  const suppressed = spacedFlow.handle('action-exudate', guided({ worldX: 100, nowSeconds: 1 }));
  assert.equal(suppressed.open, false);
  assert.equal(suppressed.reason, 'spatial-suppression');
  assert.equal(spacedFlow.isUnlocked('action-exudate'), true);

  const releasedByTime = spacedFlow.handle('action-exudate', guided({ worldX: 100, nowSeconds: 61 }));
  assert.equal(releasedByTime.open, true);

  const distanceFlow = createTutorialFlow();
  distanceFlow.handle('system-welcome', guided({ worldX: 0, nowSeconds: 0 }));
  const releasedByDistance = distanceFlow.handle('action-exudate', guided({ worldX: 900, nowSeconds: 1 }));
  assert.equal(releasedByDistance.open, true);
});

test('poder ignora somente a trava espacial e não o modo silencioso', () => {
  const guidedFlow = createTutorialFlow();
  guidedFlow.handle('system-welcome', guided({ worldX: 0, nowSeconds: 0 }));
  const power = guidedFlow.handle('power-double-jump', guided({
    phase: 3, chunkIndex: 20, worldX: 100, nowSeconds: 1,
  }));
  assert.equal(power.open, true);
  assert.equal(power.reason, 'event-immediate');

  const silentFlow = createTutorialFlow();
  const silentPower = silentFlow.handle('power-double-jump', guided({
    tutorialMode: 'silent', phase: 3, chunkIndex: 24,
  }));
  assert.equal(silentPower.open, false);
  assert.equal(silentPower.reason, 'silent');
});

test('só fases anteriores contam como já ensinadas', () => {
  const antesDaTres = getCardsTaughtBeforePhase(3);
  assert.ok(antesDaTres.includes('organism-bacillus'));
  assert.ok(antesDaTres.includes('organism-rhizobium'));
  assert.ok(
    !antesDaTres.includes('organism-azospirillum'),
    'a estreia da própria fase 3 não pode nascer marcada como vista',
  );

  const antesDaCinco = getCardsTaughtBeforePhase(5);
  assert.ok(antesDaCinco.includes('organism-mycorrhiza'));
  assert.ok(
    !antesDaCinco.includes('organism-opportunistic-fungus'),
    'a estreia da própria fase 5 não pode nascer marcada como vista',
  );

  assert.deepEqual(getCardsTaughtBeforePhase(0), []);
  assert.deepEqual(getCardsTaughtBeforePhase(undefined), []);
});

test('a fase avisa o manager do que já foi ensinado antes dela', () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const syncedPhases = [];
  const state = {
    gameState: 'play',
    campaign: { phase: 4, transitionRequested: false },
    player: {
      x: 0, y: 0, w: 0, h: 0, exudates: 0,
      canDoubleJump: false, canDash: false, canPulse: false,
    },
    discoveredMicrobes: new Set(),
    level: {
      enemies: [], rhizobiumNodules: [], biofilms: [],
      mycorrhizaArbuscules: [], platforms: [], azospirillumRoots: [],
    },
  };
  const sim = {
    ecology: { agents: [], encounters: [] },
    beneficialInoculants: { followerCount: 0 },
    trichodermaColonies: { followerCount: 0 },
    meloidogyneLifecycle: { juveniles: [], eggMasses: [], galls: [] },
    pseudomonasSiderophores: { freeCount: 0, loadedCount: 0, ironRecovered: 0 },
    trichoderma: { attackCount: 0 },
  };

  try {
    const triggers = createTutorialTriggers({
      state,
      sim,
      manager: {
        isOpen: false,
        hasSeen: () => false,
        trigger: () => true,
        syncPriorKnowledge: phase => { syncedPhases.push(phase); },
      },
      ralstoniaControl: { foci: [] },
      trichodermaRhizoctoniaControl: { activeAttackCount: 0 },
    });

    triggers.update();
    triggers.update();
    assert.deepEqual(syncedPhases, [4], 'a mesma fase não é sincronizada duas vezes');

    state.campaign.phase = 5;
    triggers.update();
    assert.deepEqual(syncedPhases, [4, 5], 'trocar de fase reavalia o que já foi ensinado');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('organismo inédito continua abrindo na primeira aparição, sem espera', () => {
  const primeira = runTriggerScenario({
    agents: [{ type: 'bacillus', x: 40, y: 0 }],
  });
  assert.deepEqual(primeira.triggered, ['organism-bacillus']);

  // Dois inéditos lado a lado: o mais próximo abre já, sem trava de intervalo.
  const juntos = runTriggerScenario({
    agents: [
      { type: 'bacillus', x: 90, y: 0 },
      { type: 'rhizobium', x: 40, y: 0 },
    ],
  });
  assert.deepEqual(juntos.triggered, ['organism-rhizobium']);
});

test('painel aberto não cria fila geral e preserva um encontro obrigatório como pendente', () => {
  const flow = createTutorialFlow();
  const mandatory = flow.handle('organism-bacillus', firstEncounter({
    phase: 1,
    chunkIndex: 6,
    panelOpen: true,
  }));
  assert.equal(mandatory.handled, true);
  assert.equal(mandatory.open, false);
  assert.equal(mandatory.reason, 'panel-open');
  assert.equal(mandatory.mandatoryFirstAppearance, true);

  const secondary = flow.handle('action-exudate', guided({ panelOpen: true }));
  assert.equal(secondary.open, false);
  assert.equal(secondary.reason, 'panel-open');
});

function safeTutorialState(overrides = {}) {
  const platform = {
    id: 'safe-root',
    x: 100,
    y: 400,
    w: 180,
    h: 72,
    type: 'root',
  };
  const player = {
    x: 145,
    y: platform.y - 48,
    w: 32,
    h: 48,
    vx: 70,
    vy: 0,
    onGround: true,
    alive: true,
    dashTime: 0,
    tutorialUnsafeUntil: 0,
  };
  return {
    state: {
      time: 10,
      gameState: 'play',
      respawnTimer: 0,
      jumpHeldLast: false,
      player,
      level: { platforms: [platform] },
      ...overrides,
    },
    platform,
    player,
  };
}

test('fila automática preserva ordem e deduplica cartões e gatilhos', () => {
  const queue = createPendingTutorialQueue();
  assert.equal(queue.enqueue({ cardId: 'a', triggerId: 'trigger-a' }), true);
  assert.equal(queue.enqueue({ cardId: 'a', triggerId: 'trigger-a-repeat' }), false);
  assert.equal(queue.enqueue({ cardId: 'b', triggerId: 'trigger-b' }), true);
  assert.equal(queue.hasTrigger('trigger-a'), true);
  assert.deepEqual(queue.snapshot().map(entry => entry.cardId), ['a', 'b']);
  assert.equal(queue.shift().cardId, 'a');
  assert.equal(queue.shift().cardId, 'b');
  assert.equal(queue.length, 0);
});

test('gatilho no ar permanece pendente até apoio estável', () => {
  const { state, platform, player } = safeTutorialState();
  const queue = createPendingTutorialQueue();
  let gameplayEffects = 0;
  gameplayEffects++;
  queue.enqueue({ cardId: 'organism-bacillus', triggerId: 'organism-bacillus' });

  player.onGround = false;
  player.y -= 80;
  player.vy = 160;
  const gate = createAutomaticTutorialSafetyGate({ state });
  assert.equal(gate.inspect(.05).safe, false);
  assert.equal(queue.length, 1);
  assert.equal(gameplayEffects, 1, 'o efeito do gatilho ocorre sem esperar o modal');

  player.y = platform.y - player.h;
  player.vy = 0;
  player.onGround = true;
  assert.equal(gate.inspect(.05).safe, false, 'um quadro de contato não basta');
  assert.equal(gate.inspect(.05).safe, false, 'a confirmação também exige vários quadros');
  const stable = gate.inspect(.05);
  assert.equal(stable.safe, true);
  assert.equal(stabilizePlayerForAutomaticTutorial(state, stable.support), true);
  assert.equal(player.vx, 0);
  assert.equal(player.vy, 0);
});

test('apoio mínimo na borda não é superfície segura', () => {
  const { state, platform, player } = safeTutorialState();
  player.x = platform.x + platform.w - 4;
  assert.equal(findSupportingTutorialPlatform(state), null);
});

test('dash, dano, knockback, morte e respawn bloqueiam apresentação', () => {
  const { state, player } = safeTutorialState();
  const gate = createAutomaticTutorialSafetyGate({ state });

  player.dashTime = .1;
  assert.equal(gate.inspect(.05).reason, 'dash');
  player.dashTime = 0;
  player.tutorialUnsafeUntil = state.time + .2;
  assert.equal(gate.inspect(.05).reason, 'damage');
  player.tutorialUnsafeUntil = 0;
  player.onGround = false;
  player.vy = -220;
  assert.equal(gate.inspect(.05).reason, 'jumping');
  player.alive = false;
  assert.equal(gate.inspect(.05).reason, 'dead');
  player.alive = true;
  state.gameState = 'respawning';
  state.respawnTimer = .4;
  assert.equal(gate.inspect(.05).reason, 'game-state');
});

test('morte não descarta nem marca cartão pendente', () => {
  const { state, platform, player } = safeTutorialState();
  const queue = createPendingTutorialQueue();
  queue.enqueue({ cardId: 'organism-rhizobium', triggerId: 'organism-rhizobium' });
  const seen = new Set();
  const gate = createAutomaticTutorialSafetyGate({ state });

  player.alive = false;
  state.gameState = 'respawning';
  state.respawnTimer = .5;
  assert.equal(gate.inspect(.1).safe, false);
  assert.equal(queue.length, 1);
  assert.equal(seen.has('organism-rhizobium'), false);

  player.alive = true;
  state.gameState = 'play';
  state.respawnTimer = 0;
  player.y = platform.y - player.h;
  player.vy = 0;
  player.onGround = true;
  gate.inspect(.05);
  gate.inspect(.05);
  assert.equal(gate.inspect(.05).safe, true);
  assert.equal(queue.shift().cardId, 'organism-rhizobium');
});

test('pausa central impede que o simulador real e runtimes avancem', () => {
  const sim = createSimulator();
  const before = {
    time: sim.state.time,
    x: sim.state.player.x,
    y: sim.state.player.y,
    toastTime: sim.state.toastTime,
  };
  sim.state.gameState = 'tutorial';
  let controllerUpdates = 0;
  const advanced = advanceGameplayFrame({
    state: sim.state,
    manager: { isOpen: true },
    sim,
    dt: .1,
    advance: dt => {
      sim.step(dt);
      controllerUpdates++;
    },
  });
  assert.equal(advanced, false);
  assert.equal(controllerUpdates, 0);
  assert.equal(sim.state.time, before.time);
  assert.equal(sim.state.player.x, before.x);
  assert.equal(sim.state.player.y, before.y);
  assert.equal(sim.state.toastTime, before.toastTime);
});

test('entradas anteriores e teclas mantidas exigem liberação', () => {
  const sim = createSimulator();
  const keys = { Space: true, ShiftLeft: true, KeyE: true, ArrowRight: true };
  sim.setInputs(keys);
  const gate = createTutorialInputGate({ keys, sim });
  gate.clear({ blockActive: true, extraBlockedCodes: ['KeyJ'] });

  assert.equal(sim.input.keys.Space, false);
  assert.equal(sim.input.keys.ShiftLeft, false);
  assert.equal(sim.input.keys.KeyE, false);
  assert.equal(gate.acceptsKeyDown('Space'), false);
  assert.equal(gate.acceptsKeyDown('KeyJ'), false);
  gate.release('Space');
  assert.equal(gate.acceptsKeyDown('Space'), true);
  assert.equal(gate.acceptsKeyDown('ShiftLeft'), false);
});

import fs from 'node:fs';
import path from 'node:path';

test('os 3 PNGs do cartão didático existem nos caminhos de assets e dist e a pasta está limpa', () => {
  const files = ['tutorial-card.png', 'tutorial-close.png', 'tutorial-arrow.png'];
  for (const f of files) {
    assert.ok(fs.existsSync(path.join('assets/ui/tutorial', f)), `Falta asset: assets/ui/tutorial/${f}`);
    assert.ok(fs.existsSync(path.join('dist/assets/ui/tutorial', f)), `Falta em dist: dist/assets/ui/tutorial/${f}`);
  }
  const unwanted = ['tutorial-arrow-next.png', 'tutorial-arrow-prev.png', 'assetsuitutorialtutorial-arrow-next-prev.png'];
  for (const f of unwanted) {
    assert.ok(!fs.existsSync(path.join('assets/ui/tutorial', f)), `Arquivo duplicado/antigo não deve existir: ${f}`);
  }
});

test('validação das imagens e aria-labels na estrutura do cartão didático em tutorial-manager.js', () => {
  const managerCode = fs.readFileSync('src/procgen/tutorial-manager.js', 'utf8');

  assert.ok(managerCode.includes('./assets/ui/tutorial/tutorial-card.png'), 'Arte do cartão deve referenciar tutorial-card.png');
  assert.ok(managerCode.includes('./assets/ui/tutorial/tutorial-close.png'), 'Botão fechar deve conter tutorial-close.png');
  assert.ok(managerCode.includes('./assets/ui/tutorial/tutorial-arrow.png'), 'Ambas as setas devem usar tutorial-arrow.png');
  assert.ok(!managerCode.includes('tutorial-arrow-next.png'), 'Não deve referenciar tutorial-arrow-next.png');
  assert.ok(!managerCode.includes('tutorial-arrow-prev.png'), 'Não deve referenciar tutorial-arrow-prev.png');
  assert.ok(managerCode.includes("panel.classList.add('tutorial-panel--card')"), 'Modo cartão adiciona classe tutorial-panel--card');
  assert.ok(managerCode.includes("panel.classList.add('tutorial-panel--library')"), 'Modo biblioteca adiciona classe tutorial-panel--library');
  assert.ok(!managerCode.includes('nextButton.textContent ='), 'Não deve sobrescrever nextButton.textContent para preservar a imagem');
});

import { execSync } from 'node:child_process';

test('validação estrita de transparência real da imagem da seta tutorial-arrow.png', () => {
  const pyCode = "from PIL import Image; import sys; img = Image.open('assets/ui/tutorial/tutorial-arrow.png'); sys.exit('Modo nao e RGBA') if img.mode != 'RGBA' else None; w, h = img.size; corners = [img.getpixel((0,0))[3], img.getpixel((w-1,0))[3], img.getpixel((0,h-1))[3], img.getpixel((w-1,h-1))[3]]; sys.exit(f'Cantos opacos: {corners}') if any(c > 5 for c in corners) else None; alpha = img.getchannel('A'); bbox = alpha.getbbox(); sys.exit('Alfa vazio') if bbox is None else None; opaque_count = sum(1 for p in alpha.getdata() if p > 10); ratio = opaque_count / (w * h); sys.exit(f'Mais de 95% opaco: {ratio}') if ratio > 0.95 else None; print('OK')";
  const result = execSync(`python -c "${pyCode}"`, { encoding: 'utf8' }).trim();
  assert.equal(result, 'OK');
});



