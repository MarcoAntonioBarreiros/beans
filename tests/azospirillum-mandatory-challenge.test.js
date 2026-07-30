import assert from 'node:assert/strict';
import test from 'node:test';

import { findRootHost } from '../src/procgen/signature-challenge.js';
import { createAzospirillumRootGrowth } from '../src/procgen/azospirillum-root-growth.js';
import {
  ensurePhaseObjectiveProgress,
  recordPhaseObjectiveAction,
} from '../src/procgen/campaign-objective-progress.js';
import { createCampaignObjectiveEvaluator } from '../src/procgen/campaign-objectives.js';

// --- FASE 2/13-A: escolha do hospedeiro (ultima raiz), com solo no meio -----

function makeRoute(types) {
  // types: array de 'root'|'soil' na ordem da rota. Alvo e o ultimo no.
  let x = 100;
  return types.map((type, index) => {
    const platform = { logicIndex: index, x, y: 500, w: 180, h: 60, type };
    x += 260;
    return platform;
  });
}

test('hospedeiro e a ultima raiz antes do alvo — sem solo no meio', () => {
  const route = makeRoute(['root', 'root', 'root']);
  const target = route[2];
  const host = findRootHost(route, target);
  assert.equal(host, route[1], 'a raiz imediatamente anterior e o hospedeiro');
});

test('hospedeiro pula 1 bloco de solo (root -> soil -> alvo)', () => {
  const route = makeRoute(['root', 'root', 'soil', 'root']); // alvo idx 3
  const target = route[3];
  const host = findRootHost(route, target);
  assert.equal(host, route[1], 'o solo em idx 2 e ignorado; a raiz em idx 1 hospeda');
  assert.equal(host.type, 'root');
});

test('hospedeiro pula 2 blocos de solo (root -> soil -> soil -> alvo)', () => {
  const route = makeRoute(['root', 'soil', 'soil', 'root']); // alvo idx 3
  const target = route[3];
  const host = findRootHost(route, target);
  assert.equal(host, route[0], 'as duas soleiras sao ignoradas; a raiz em idx 0 hospeda');
});

test('nao ha hospedeiro quando a unica raiz anterior esta longe demais', () => {
  const route = makeRoute(['root', 'soil', 'soil', 'soil', 'root']);
  // afasta o alvo bem longe da unica raiz anterior
  const target = route[4];
  target.x = route[0].x + 5000;
  assert.equal(findRootHost(route, target), null);
});

test('plataformas de recuperacao nunca sao hospedeiro', () => {
  const route = makeRoute(['root', 'root', 'root']);
  route[1].recovery = true; // a raiz mais proxima e recuperacao
  const target = route[2];
  assert.equal(findRootHost(route, target), route[0], 'cai para a raiz principal anterior');
});

// --- FASE 6/7/8: runtime da escada obrigatoria + travessia --------------------

function makeChallengeState() {
  const host = { id: 'host', logicIndex: 5, x: 400, y: 500, w: 200, h: 60, type: 'root' };
  const target = {
    id: 'target', logicIndex: 6, x: 720, y: 270, w: 190, h: 58, type: 'root',
    signatureChallenge: 'azospirillumRoots', azospirillumLadderDestination: true,
    mandatoryAzospirillumTarget: true,
  };
  const level = {
    platforms: [host, target],
    azospirillumRootLadders: [],
    azospirillumRoots: [],
    rhizobiumNodules: [],
    azospirillumChallenge: {
      id: 'azo-challenge-5-6',
      hostLogicIndex: 5,
      targetLogicIndex: 6,
      hostPlatform: host,
      targetPlatform: target,
      requiredReach: 96,
      rise: 230,
      developed: false,
      traversed: false,
      mandatory: true,
    },
  };
  const state = {
    gameState: 'play',
    time: 0,
    campaign: { phase: 3 },
    player: { x: 460, y: 452, w: 32, h: 48, onGround: true, vy: 0 },
    level,
    azospirillumNitrogen: { associativeNitrogenRate: 0 }, // N baixo de proposito
  };
  ensurePhaseObjectiveProgress(state);
  const colony = { type: 'azospirillum', platform: host, growth: 1, vigor: 1, dormant: false };
  const inoculants = { colonies: [colony] };
  const entities = { burst: () => {} };
  return { state, host, target, growth: createAzospirillumRootGrowth({ state, entities, inoculants }) };
}

function developLadder(growth, state) {
  // 6s de update: passa dos 3s de crescimento e ativa todos os degraus.
  for (let i = 0; i < 80; i++) { state.time += .08; growth.update(.08); }
}

test('com N baixo a escada obrigatoria ainda alcanca o requiredReach (piso anti-softlock)', () => {
  const { state, host, growth } = makeChallengeState();
  developLadder(growth, state);
  const ladder = (state.level.azospirillumRootLadders || []).find(l => l.mandatoryChallenge);
  assert.ok(ladder, 'uma escada obrigatoria precisa nascer sobre o hospedeiro');
  assert.equal(ladder.challengeId, 'azo-challenge-5-6');
  const topStep = ladder.steps[ladder.steps.length - 1];
  const topReach = host.y - topStep.y;
  assert.ok(
    topReach >= state.level.azospirillumChallenge.requiredReach - 1,
    `o degrau superior (${Math.round(topReach)}px) precisa alcancar o requiredReach (${state.level.azospirillumChallenge.requiredReach})`,
  );
});

test('a escada obrigatoria madura marca challenge.developed', () => {
  const { state, growth } = makeChallengeState();
  assert.equal(state.level.azospirillumChallenge.developed, false);
  developLadder(growth, state);
  assert.equal(state.level.azospirillumChallenge.developed, true);
});

test('so uma escada obrigatoria por host, sem concorrente', () => {
  const { state, growth } = makeChallengeState();
  developLadder(growth, state);
  developLadder(growth, state); // roda de novo
  const mandatory = (state.level.azospirillumRootLadders || []).filter(l => l.mandatoryChallenge);
  assert.equal(mandatory.length, 1);
});

function standOn(state, platform) {
  state.player.onGround = true;
  state.player.x = platform.x + 10;
  state.player.y = platform.y - state.player.h;
}

test('so tocar nos degraus NAO marca traversed; salto duplo sem tocar tambem nao', () => {
  const { state, growth } = makeChallengeState();
  developLadder(growth, state);
  const step = (state.level.platforms || []).find(p => p.azospirillumLadderStep);
  assert.ok(step, 'a escada madura precisa ter degraus com colisor');

  // Toca o degrau, mas nunca dá salto duplo.
  standOn(state, step);
  growth.update(.016);
  assert.equal(state.level.azospirillumChallenge.traversed, false);

  // Salto duplo sem ter tocado a escada (reinicia a tentativa pousando fora).
  standOn(state, state.level.platforms[0]); // hospedeiro (bloco nao relacionado)
  growth.update(.016);
  state.player.onGround = false;
  recordPhaseObjectiveAction(state, 'performedDoubleJumpCount');
  growth.update(.016);
  assert.equal(state.level.azospirillumChallenge.traversed, false);
});

test('tocar a escada, saltar duplo e pousar no alvo marca traversed', () => {
  const { state, target, growth } = makeChallengeState();
  developLadder(growth, state);
  const step = (state.level.platforms || []).find(p => p.azospirillumLadderStep);

  // 1) pisa num degrau da escada obrigatoria
  standOn(state, step);
  growth.update(.016);

  // 2) sobe (airborne) e executa o salto duplo
  state.player.onGround = false;
  state.player.y = step.y - 80;
  recordPhaseObjectiveAction(state, 'performedDoubleJumpCount');
  growth.update(.016);

  // 3) pousa no alvo
  standOn(state, target);
  growth.update(.016);

  assert.equal(state.level.azospirillumChallenge.traversed, true);

  // E a prova final da fase (developed + traversed) fecha.
  const evaluator = createCampaignObjectiveEvaluator({ state, systems: {} });
  const result = evaluator.evaluate([
    { type: 'worldState', key: 'mandatoryAzospirillumChallengeDeveloped', operator: '===', value: true },
    { type: 'worldState', key: 'mandatoryAzospirillumChallengeTraversed', operator: '===', value: true },
  ]);
  assert.equal(result.passed, true);
});

// --- FASE 13-C: nitrogenio ---------------------------------------------------

function makeOptionalRootState(nitrogenRate) {
  const host = { id: 'opt-host', logicIndex: 5, x: 400, y: 500, w: 200, h: 60, type: 'root' };
  const level = {
    platforms: [host],
    azospirillumRootLadders: [],
    azospirillumRoots: [],
    rhizobiumNodules: [],
    // sem azospirillumChallenge: esta raiz e OPCIONAL
  };
  const state = {
    gameState: 'play',
    time: 0,
    campaign: { phase: 3 },
    player: { x: 460, y: 452, w: 32, h: 48, onGround: true, vy: 0 },
    level,
    azospirillumNitrogen: { associativeNitrogenRate: nitrogenRate },
  };
  ensurePhaseObjectiveProgress(state);
  const inoculants = {
    colonies: [{ type: 'azospirillum', platform: host, growth: 1, vigor: 1, dormant: false }],
  };
  return { state, host, growth: createAzospirillumRootGrowth({ state, entities: { burst: () => {} }, inoculants }) };
}

function ladderReach(state, host) {
  const ladder = (state.level.azospirillumRootLadders || [])[0];
  if (!ladder) return 0;
  return host.y - ladder.endY;
}

test('raiz OPCIONAL com N baixo continua curta; com N alto fica maior', () => {
  const baixo = makeOptionalRootState(0);
  baixo.growth.update(.016);
  const alcanceBaixo = ladderReach(baixo.state, baixo.host);

  const alto = makeOptionalRootState(20);
  alto.growth.update(.016);
  const alcanceAlto = ladderReach(alto.state, alto.host);

  assert.ok(alcanceBaixo > 0 && alcanceAlto > 0, 'as duas raizes opcionais precisam nascer');
  assert.ok(
    alcanceAlto > alcanceBaixo + 50,
    `N alto (${Math.round(alcanceAlto)}px) precisa superar N baixo (${Math.round(alcanceBaixo)}px)`,
  );
  // O piso do desafio NAO vale aqui: a raiz opcional pode ser curta.
  assert.ok(alcanceBaixo < 160, `raiz opcional com N baixo ficou longa demais (${Math.round(alcanceBaixo)}px)`);
});

test('raiz OBRIGATORIA com N alto pode passar do requiredReach, mas mantem o salto duplo obrigatorio', () => {
  const { state, host, growth } = makeChallengeState();
  state.azospirillumNitrogen.associativeNitrogenRate = 40; // N farto
  developLadder(growth, state);
  const ladder = (state.level.azospirillumRootLadders || []).find(l => l.mandatoryChallenge);
  assert.ok(ladder);
  const alcance = host.y - ladder.endY;
  const challenge = state.level.azospirillumChallenge;
  assert.ok(alcance >= challenge.requiredReach, 'com N farto a escada nao pode encolher');
  // Continua sobrando desnivel ate o alvo: o salto duplo segue necessario.
  const folgaAteAlvo = ladder.endY - challenge.targetPlatform.y;
  assert.ok(folgaAteAlvo > 0, 'a escada nao pode encostar no alvo e dispensar o salto duplo');
});

test('pousar num bloco nao relacionado limpa o estado transitorio (morte/respawn)', () => {
  const { state, host, target, growth } = makeChallengeState();
  developLadder(growth, state);
  const step = (state.level.platforms || []).find(p => p.azospirillumLadderStep);

  standOn(state, step);
  growth.update(.016);
  // "morre": pousa no hospedeiro (checkpoint), limpando touchedLadder
  standOn(state, host);
  growth.update(.016);
  // agora salta duplo e pousa no alvo — sem ter re-tocado a escada
  state.player.onGround = false;
  recordPhaseObjectiveAction(state, 'performedDoubleJumpCount');
  growth.update(.016);
  standOn(state, target);
  growth.update(.016);
  assert.equal(state.level.azospirillumChallenge.traversed, false);
});
