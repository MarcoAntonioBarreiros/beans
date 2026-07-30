import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { getPhaseManifest } from '../src/procgen/campaign-manifest.js';
import { createCampaignObjectiveEvaluator } from '../src/procgen/campaign-objectives.js';
import {
  campaignPhaseSeed,
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { generateLevel } from '../src/procgen/generator.js';
import { createGoalSystem } from '../src/procgen/goal-system.js';
import { applyPhaseOneVerticalSlice, createFixedBlockRuntime } from '../src/procgen/phase-one-vertical-slice.js';

const SEEDS = Array.from({ length: 12 }, (_, index) => `phase-one-seed-${index + 1}`);

function phaseOne(seed) {
  const campaign = createCampaign(seed);
  const profile = prepareCampaignGeneration(campaign);
  const phaseSeed = campaignPhaseSeed(campaign);
  const level = decorateCampaignLevel(generateLevel(phaseSeed), campaign, profile);
  applyPhaseOneVerticalSlice(level, 1);
  const encounters = generateCampaignEncounters({ platforms: level.platforms, phase: 1, seedValue: phaseSeed })
    .concat(level.authoredEncounters || []);
  return { campaign, level, encounters };
}

function mainPlatforms(level) {
  return level.platforms
    .filter(platform => !platform.recovery && !platform.final && platform.logicIndex >= 0)
    .sort((left, right) => left.logicIndex - right.logicIndex);
}

test('Fase 1 segue introdução fixa e termina quatro blocos após o checkpoint', () => {
  const manifest = getPhaseManifest(1);
  assert.equal(manifest.totalChunks, 13);
  assert.deepEqual(
    manifest.segments.map(segment => [segment.id, segment.kind, Boolean(segment.fixedBlock)]),
    [
      ['p1-warmup', 'procedural', false],
      ['p1-intro', 'fixed', true],
      ['p1-challenge', 'procedural', false],
    ],
  );

  for (const seed of SEEDS) {
    const { level, encounters } = phaseOne(seed);
    assert.deepEqual(level.fixedBlocks.map(block => block.id), ['p1-intro']);
    assert.equal(level.fixedBlocks.every(block => block.exitGate), true);
    assert.deepEqual(level.checkpoints, [], 'Bacillus natural não pode antecipar o primeiro biofilme do jogador');
    assert.deepEqual(
      level.fixedBlocks.map(block => block.targetPlatform.objectiveTarget),
      ['p1-intro-root'],
    );
    assert.equal(level.fixedBlocks.every(block => block.targetPlatform.fixedObjective === true), true);
    const introBridge = level.fixedBlocks[0].recoveryPlatform;
    assert.equal(introBridge.logicIndex, 8);
    assert.equal(introBridge.checkpointRecoveryBridge, true);
    assert.equal(level.platforms.includes(introBridge), false, 'a primeira tentativa não possui a raiz de apoio');

    for (const platform of mainPlatforms(level)) {
      const shouldBeAuthored = platform.logicIndex >= 4 && platform.logicIndex <= 8;
      assert.equal(Boolean(platform.authored), shouldBeAuthored, `chunk ${platform.logicIndex}`);
    }
    assert.equal(level.exudates.some(exudate => exudate.logicIndex < 4), false);
    assert.deepEqual(
      level.exudates.filter(exudate => exudate.authored).map(exudate => exudate.logicIndex),
      [4, 5, 7],
    );
    assert.ok(encounters.some(encounter => encounter.source === 'debut' && encounter.id === 'bacillus' && encounter.logicIndex === 6));
    assert.equal(encounters.some(encounter => encounter.source === 'fixed-practice'), false);
    assert.ok(encounters.filter(encounter => encounter.source === 'procedural')
      .every(encounter => encounter.logicIndex >= 9 && encounter.logicIndex <= 12));
    assert.equal(Math.max(...mainPlatforms(level).map(platform => platform.logicIndex)), 12);
  }
});

test('geometria autoral permanece atravessável sem poderes em múltiplas seeds', () => {
  for (const seed of SEEDS) {
    const { level } = phaseOne(`${seed}:geometry`);
    const intro = level.fixedBlocks[0];
    const nextRoot = mainPlatforms(level).find(platform => platform.logicIndex === 9);
    const forcedGap = nextRoot.x - (intro.targetPlatform.x + intro.targetPlatform.w);
    assert.ok(forcedGap >= 360, `primeira tentativa precisa ser impossível: ${forcedGap.toFixed(1)}px`);

    const route = [...mainPlatforms(level), intro.recoveryPlatform]
      .sort((left, right) => left.logicIndex - right.logicIndex || left.x - right.x);
    for (let index = 1; index < route.length; index++) {
      const previous = route[index - 1];
      const current = route[index];
      if (!previous.authored && !current.authored) continue;
      const gap = current.x - (previous.x + previous.w);
      const rise = previous.y - current.y;
      assert.ok(gap >= 0 && gap <= 145, `gap ${gap.toFixed(1)} entre chunks ${previous.logicIndex}/${current.logicIndex}`);
      assert.ok(rise <= 62, `subida ${rise.toFixed(1)} entre chunks ${previous.logicIndex}/${current.logicIndex}`);
      if (current.authored) assert.ok(current.w >= 122);
    }
  }
});

test('cartão visto não aprova a prova; somente biofilme funcional na raiz marcada aprova', () => {
  const { campaign, level } = phaseOne('objective-target');
  const state = {
    campaign,
    level: { ...level, biofilms: [] },
  };
  const gameplay = { deployedCloudCount: 1 };
  const inoculants = { colonies: [{ type: 'bacillus' }] };
  const evaluator = createCampaignObjectiveEvaluator({ state, systems: { gameplay, inoculants } });
  const finalTest = getPhaseManifest(1).finalTest;

  state.discoveredMicrobes = new Set(['bacillus']);
  assert.equal(evaluator.evaluate(finalTest).passed, false);
  state.level.biofilms.push({ functional: true, platform: { objectiveTarget: 'outra-raiz' } });
  assert.equal(evaluator.evaluate(finalTest).passed, false);
  state.level.biofilms.push({ functional: true, platform: level.fixedBlocks[0].targetPlatform });
  assert.equal(evaluator.evaluate(finalTest).passed, true);
});

test('portão do módulo abre apenas após ação real e preserva o progresso local', () => {
  const { campaign, level } = phaseOne('fixed-gate');
  const gameplay = { deployedCloudCount: 0 };
  const state = {
    time: 1,
    gameState: 'play',
    campaign,
    level: { ...level, biofilms: [] },
    cameraX: 480,
    player: { x: level.fixedBlocks[0].gateX, y: 400, w: 32, h: 48, vx: 120, vy: 0, alive: true },
    discoveredMicrobes: new Set(['bacillus']),
    toast: '',
    toastTime: 0,
  };
  const evaluator = createCampaignObjectiveEvaluator({ state, systems: { gameplay, inoculants: { colonies: [] } } });
  const ecology = {
    agents: [{ type: 'bacillus', beneficialRecruitedUntil: 30 }],
    encounters: [],
  };
  const runtime = createFixedBlockRuntime({ state, evaluator, entities: { burst() {} }, ecology });
  const intro = state.level.fixedBlocks[0];

  runtime.update();
  assert.equal(intro.completed, false);
  assert.ok(state.player.x + state.player.w < intro.gateX);

  const translations = [];
  const renderedLabels = [];
  const ctx = new Proxy({
    measureText: text => ({ width: text.length * 7 }),
    translate: (x, y) => translations.push([x, y]),
    fillText: text => renderedLabels.push(text),
    // O Proxy devolve () => {} para o que nao conhece, entao um gradiente viria
    // undefined e quebraria no addColorStop. Aqui ele devolve algo com a forma
    // de CanvasGradient, como o canvas real devolve.
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  }, { get: (target, key) => target[key] || (() => {}) });
  runtime.render(ctx);
  assert.deepEqual(translations, [[-480, 0]], 'portão e marcador usam a câmera horizontal');
  assert.ok(renderedLabels.some(label => label.includes('ALVO DA FASE')));

  gameplay.deployedCloudCount = 1;
  state.level.biofilms.push({ functional: true, platform: { objectiveTarget: 'qualquer-outra-raiz' } });
  state.time = 4;
  runtime.update();
  assert.equal(intro.completed, false, 'biofilme fora do alvo não conclui a ação guiada');

  state.level.biofilms.push({ functional: true, platform: intro.targetPlatform });
  state.time = 7;
  runtime.update();
  assert.equal(intro.completed, true);
  assert.equal(intro.targetPlatform.fixedObjective, false);

  // A raiz de SAIDA do modulo volta a rota na conclusao, nao so depois de morrer.
  // Antes ela era retirada do array na geracao e devolvida apenas num caminho
  // muito especifico (morte depois do checkpoint + respawn sobre o alvo). Numa
  // partida sem morte o chunk ficava ausente e o vao seguinte era intransponivel
  // — quem cobria isso era o degrau global `safetyStep`, que nao existe mais.
  assert.equal(intro.recoveryPlatformUnlocked, true, 'concluir o modulo devolve a raiz de saida');
  assert.equal(state.level.platforms.includes(intro.recoveryPlatform), true);

  renderedLabels.length = 0;
  runtime.render(ctx);
  assert.equal(
    renderedLabels.some(label => label.includes('ALVO DA FASE')),
    false,
    'a instrução desaparece quando o biofilme é confirmado',
  );

  state.currentCheckpoint = {
    x: intro.targetPlatform.x + intro.targetPlatform.w / 2 - state.player.w / 2,
    y: intro.targetPlatform.y - state.player.h,
  };
  state.player.x = intro.targetPlatform.x + intro.targetPlatform.w + 40;
  state.player.deaths = 1;
  state.player.alive = false;
  state.gameState = 'respawning';
  runtime.update();
  // Morrer depois do checkpoint nao muda mais nada: a raiz de saida ja esta la,
  // e o caminho antigo nao pode duplica-la no array.
  assert.equal(intro.recoveryPlatformUnlocked, true);
  assert.equal(
    state.level.platforms.filter(platform => platform === intro.recoveryPlatform).length, 1,
    'a raiz de saida entra na rota uma unica vez',
  );

  state.player.x = state.currentCheckpoint.x;
  state.player.y = state.currentCheckpoint.y;
  state.player.alive = true;
  state.gameState = 'play';
  runtime.update();
  assert.equal(intro.recoveryPlatformUnlocked, true);
  assert.equal(
    state.level.platforms.filter(platform => platform === intro.recoveryPlatform).length, 1,
  );

  state.level.biofilms.length = 0;
  state.player.x = intro.gateX + 20;
  runtime.update();
  assert.ok(state.player.x > intro.gateX, 'conclusão já demonstrada mantém o portão aberto');
});

test('raiz principal respeita o avaliador antes de concluir a fase', () => {
  const state = {
    time: 1,
    gameState: 'play',
    campaign: { phase: 1, transitionRequested: false },
    level: { goal: { x: 100, y: 100, radius: 90, completed: false } },
    player: { x: 84, y: 124, w: 32, h: 48, vx: 20, vy: 0 },
    mission: '', toast: '', toastTime: 0, shake: 0,
  };
  const goal = createGoalSystem({ state, entities: { burst() {} } });
  let passed = false;
  goal.setCompletionGuard(() => ({ passed, message: 'Prova pendente' }));
  goal.reset();

  goal.update();
  assert.equal(state.level.goal.completed, false);
  assert.equal(state.toast, 'Prova pendente');

  passed = true;
  state.time = 4;
  goal.update();
  assert.equal(state.level.goal.completed, true);
  assert.equal(state.campaign.transitionRequested, true);
});
