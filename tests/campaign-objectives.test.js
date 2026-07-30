import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensurePhaseObjectiveProgress,
  objectiveConditionId,
  recordPhaseObjectiveAction,
} from '../src/procgen/campaign-objective-progress.js';
import { getPhaseManifest } from '../src/procgen/campaign-manifest.js';
import { createCampaignObjectiveEvaluator } from '../src/procgen/campaign-objectives.js';
import {
  CAMPAIGN_STORAGE_KEY,
  createCampaign,
} from '../src/procgen/campaign-progression.js';
import { createSimulator } from '../src/procgen/simulator.js';

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function campaignAt(phase, unlocks = {}) {
  const campaign = createCampaign(`objective-phase-${phase}`);
  campaign.phase = phase;
  Object.assign(campaign.unlocks, unlocks);
  return campaign;
}

function evaluatorFor(sim) {
  return createCampaignObjectiveEvaluator({ state: sim.state, systems: {} });
}

function performAirJump(sim) {
  sim.state.player.onGround = false;
  sim.state.player.coyote = 0;
  sim.state.player.airJumpAvailable = true;
  sim.state.jumpHeldLast = false;
  sim.setInputs({ Space: true });
  sim.step(.016);
  sim.setInputs({ Space: false });
  sim.step(.016);
}

function performDash(sim) {
  sim.state.player.dashCooldown = 0;
  sim.state.player.dashTime = 0;
  sim.setInputs({ ShiftLeft: true });
  sim.step(.016);
}

test('desbloqueios persistem, mas objetivos de salto duplo e Dash comecam incompletos', () => {
  const phase3 = createSimulator();
  phase3.state.campaign = campaignAt(3, { doubleJump: true, dash: true });
  phase3.reset();

  assert.equal(phase3.state.player.canDoubleJump, true);
  assert.equal(phase3.state.player.canDash, true);
  // O contador de salto duplo e uma acao-por-tentativa: comeca em 0 mesmo com o
  // poder ja desbloqueado. (A prova FINAL da fase 3 agora exige a travessia da
  // raiz lateral obrigatoria; aqui exercitamos so o mecanismo do contador.)
  const jumpRequirement = { type: 'worldState', key: 'performedDoubleJumpCount', operator: '>=', value: 1 };
  const jumpEvaluator = evaluatorFor(phase3);
  assert.equal(jumpEvaluator.evaluate([jumpRequirement]).passed, false);

  performAirJump(phase3);
  assert.equal(ensurePhaseObjectiveProgress(phase3.state).performedDoubleJumpCount, 1);
  assert.equal(jumpEvaluator.evaluate([jumpRequirement]).passed, true);

  const phase4 = createSimulator();
  phase4.state.campaign = campaignAt(4, { doubleJump: true, dash: true });
  phase4.reset();
  const dashRequirement = getPhaseManifest(4).finalTest.requires
    .find(condition => condition.key === 'performedDashCount');
  const dashEvaluator = evaluatorFor(phase4);
  assert.equal(dashEvaluator.evaluate([dashRequirement]).passed, false);

  performDash(phase4);
  assert.equal(ensurePhaseObjectiveProgress(phase4.state).performedDashCount, 1);
  assert.equal(dashEvaluator.evaluate([dashRequirement]).passed, true);
});

test('pressionar uma habilidade indisponivel nao registra acao', () => {
  const sim = createSimulator();
  sim.state.campaign = campaignAt(3);
  sim.reset();
  performAirJump(sim);
  performDash(sim);
  const progress = ensurePhaseObjectiveProgress(sim.state);
  assert.equal(progress.performedDoubleJumpCount, 0);
  assert.equal(progress.performedDashCount, 0);
});

test('reiniciar a tentativa limpa contadores e latches sem apagar poderes', () => {
  const sim = createSimulator();
  sim.state.campaign = campaignAt(4, { doubleJump: true, dash: true });
  sim.reset();
  performAirJump(sim);
  performDash(sim);
  const firstAttempt = ensurePhaseObjectiveProgress(sim.state).attemptId;

  sim.reset();
  const progress = ensurePhaseObjectiveProgress(sim.state);
  assert.ok(progress.attemptId > firstAttempt);
  assert.equal(progress.performedDoubleJumpCount, 0);
  assert.equal(progress.performedDashCount, 0);
  assert.equal(progress.latchedConditions.size, 0);
  assert.equal(sim.state.player.canDoubleJump, true);
  assert.equal(sim.state.player.canDash, true);
});

test('conclusao de uma fase nao aprova a fase seguinte', () => {
  const state = {
    campaign: campaignAt(3, { doubleJump: true }),
    level: {},
  };
  const condition = { type: 'worldState', key: 'performedDoubleJumpCount', operator: '>=', value: 1 };
  const evaluator = createCampaignObjectiveEvaluator({ state });
  recordPhaseObjectiveAction(state, 'performedDoubleJumpCount');
  assert.equal(evaluator.evaluate([condition]).passed, true);
  const previousAttempt = ensurePhaseObjectiveProgress(state).attemptId;

  state.campaign.phase = 4;
  assert.equal(evaluator.evaluate([condition]).passed, false);
  const nextProgress = ensurePhaseObjectiveProgress(state);
  assert.ok(nextProgress.attemptId > previousAttempt);
  assert.equal(nextProgress.performedDoubleJumpCount, 0);
});

test('condicoes com a mesma chave, mas alvo ou valor diferente, nao colidem', () => {
  const state = { campaign: campaignAt(4), level: {} };
  const evaluator = createCampaignObjectiveEvaluator({ state });
  recordPhaseObjectiveAction(state, 'performedDashCount');
  const oneDash = { type: 'worldState', key: 'performedDashCount', target: 'intro', operator: '>=', value: 1 };
  const twoDashes = { type: 'worldState', key: 'performedDashCount', target: 'final', operator: '>=', value: 2 };
  const evaluation = evaluator.evaluate([oneDash, twoDashes]);
  assert.equal(evaluation.results[0].passed, true);
  assert.equal(evaluation.results[1].passed, false);
  assert.notEqual(evaluation.results[0].conditionId, evaluation.results[1].conditionId);

  const progress = ensurePhaseObjectiveProgress(state);
  assert.notEqual(
    objectiveConditionId(oneDash, progress.phaseId, progress.attemptId),
    objectiveConditionId(twoDashes, progress.phaseId, progress.attemptId),
  );
});

test('save antigo ignora latchedObjectives e preserva desbloqueios', () => {
  const storage = new MemoryStorage({
    [CAMPAIGN_STORAGE_KEY]: JSON.stringify({
      seed: 'legacy-objectives',
      phase: 4,
      unlocks: { doubleJump: true, dash: true },
      totalScore: 12,
      history: [],
      latchedObjectives: ['doubleJump', 'dash', 'reachedFinalRoot'],
    }),
  });
  const campaign = createCampaign('fallback', { storage });
  assert.equal(campaign.unlocks.doubleJump, true);
  assert.equal(campaign.unlocks.dash, true);
  assert.equal(campaign.latchedObjectives, undefined);

  const sim = createSimulator();
  sim.state.campaign = campaign;
  sim.reset();
  assert.equal(sim.state.player.canDoubleJump, true);
  assert.equal(sim.state.player.canDash, true);
  assert.equal(ensurePhaseObjectiveProgress(sim.state).performedDashCount, 0);
  assert.equal(ensurePhaseObjectiveProgress(sim.state).latchedConditions.size, 0);
});
