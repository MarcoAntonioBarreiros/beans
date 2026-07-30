import assert from 'node:assert/strict';
import test from 'node:test';

import { createCampaignObjectiveEvaluator } from '../src/procgen/campaign-objectives.js';

function recoveredCount(platforms) {
  const state = { level: { platforms }, campaign: { phase: 6 } };
  const evaluator = createCampaignObjectiveEvaluator({ state, systems: {} });
  return evaluator.worldValue({ type: 'worldState', key: 'recoveredRootCount' });
}

test('uma raiz danificada que voltou a >= .75 conta como recuperada', () => {
  assert.equal(recoveredCount([{ type: 'root', wasDamaged: true, rootHealth: .82 }]), 1);
});

test('uma raiz que nunca foi danificada nao conta (nada a recuperar)', () => {
  assert.equal(recoveredCount([{ type: 'root', rootHealth: 1 }]), 0);
});

test('uma raiz danificada ainda abaixo de .75 ainda nao conta', () => {
  assert.equal(recoveredCount([{ type: 'root', wasDamaged: true, rootHealth: .6 }]), 0);
});

test('o registro nao depende de healthTrend instantaneo', () => {
  // Recuperada e estavel (healthTrend 0) ainda conta — antes exigia trend > 0.
  assert.equal(recoveredCount([
    { type: 'root', wasDamaged: true, rootHealth: .9, healthTrend: 0 },
    { type: 'soil', wasDamaged: true, rootHealth: .9 },
  ]), 1);
});
