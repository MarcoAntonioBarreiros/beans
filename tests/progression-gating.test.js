import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceCampaignPhase,
  campaignPhaseSeed,
  createCampaign,
  getPhaseProfile,
  prepareCampaignGeneration,
  unlockCampaignFeature,
} from '../src/procgen/campaign-progression.js';
import {
  campaignManifest,
  getPersistentUnlocksBeforePhase,
  getPhaseManifest,
} from '../src/procgen/campaign-manifest.js';
import { generateLevel } from '../src/procgen/generator.js';
import { createSimulator } from '../src/procgen/simulator.js';

const SEEDS = Array.from({ length: 12 }, (_, index) => `gating-seed-${index + 1}`);

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function campaignAtPhase(phase, seed, { normalProgression = true } = {}) {
  const campaign = createCampaign(seed);
  campaign.phase = phase;
  if (normalProgression) Object.assign(campaign.unlocks, getPersistentUnlocksBeforePhase(phase));
  return campaign;
}

function generatePhase(phase, seed, options) {
  const campaign = campaignAtPhase(phase, seed, options);
  const profile = prepareCampaignGeneration(campaign);
  const level = generateLevel(campaignPhaseSeed(campaign));
  return { campaign, profile, level };
}

function assertFeatureStartsAfterEvent(level, phase, feature) {
  const event = getPhaseManifest(phase).unlockEvents.find(candidate => candidate.feature === feature);
  assert.ok(event, `evento de ${feature} deve existir na fase ${phase}`);
  const beforeOrAtUnlock = level.debugInfo.filter(info => info.index <= event.eventChunk);
  const afterUnlock = level.debugInfo.filter(info => info.index > event.eventChunk);

  for (const info of beforeOrAtUnlock) {
    assert.equal(info.logic.availableUnlocks[feature], false, `${feature} indisponível no chunk ${info.index}`);
    assert.equal(info.logic.requires.includes(feature), false, `${feature} não pode ser exigido no chunk ${info.index}`);
  }
  assert.equal(afterUnlock.some(info => info.logic.availableUnlocks[feature]), true);
}

test('perfil, título, missão e eventos de todas as fases vêm do manifesto', () => {
  for (const phase of campaignManifest) {
    const campaign = campaignAtPhase(phase.phase, `profile-${phase.phase}`, { normalProgression: false });
    const profile = getPhaseProfile(campaign);
    assert.equal(profile.id, phase.id);
    assert.equal(profile.title, phase.title);
    assert.equal(profile.theme, phase.theme);
    assert.equal(profile.mission, phase.mission);
    assert.equal(profile.totalChunks, phase.totalChunks);
    assert.deepEqual(
      profile.unlockEvents.map(event => ({ feature: event.feature, eventChunk: event.eventChunk })),
      phase.unlockEvents.map(event => ({ feature: event.feature, eventChunk: event.eventChunk })),
    );
  }
});

test('múltiplas seeds nunca exigem salto duplo antes do chunk seguinte ao desbloqueio', () => {
  for (const seed of SEEDS) {
    const { level } = generatePhase(3, seed);
    assertFeatureStartsAfterEvent(level, 3, 'doubleJump');
    // O chunk do desbloqueio sai do manifesto, nao de um numero escrito aqui.
    // Estava fixo em 20 e a fase 3 foi encurtada de 40 para 25 chunks — o teste
    // passou a reprovar a fase por um valor que so existia no proprio teste.
    const unlockChunk = getPhaseManifest(3).unlockEvents
      .find(event => event.feature === 'doubleJump').eventChunk;
    for (const info of level.debugInfo.filter(entry => entry.index <= unlockChunk)) {
      assert.doesNotMatch(info.primitive, /double/);
    }
    assert.equal(
      level.debugInfo.filter(info => info.logic.requires.includes('doubleJump'))
        .every(info => info.index > unlockChunk && info.logic.availableUnlocks.doubleJump),
      true,
    );
  }
});

test('múltiplas seeds nunca criam vão obrigatório de Dash antes do desbloqueio', () => {
  for (const seed of SEEDS) {
    const { level } = generatePhase(4, seed);
    assertFeatureStartsAfterEvent(level, 4, 'dash');
    for (const info of level.debugInfo.filter(entry => entry.index <= 20)) {
      assert.doesNotMatch(info.primitive, /dash/);
    }
    assert.equal(
      level.debugInfo.filter(info => info.logic.requires.includes('dash'))
        .every(info => info.index > 20 && info.logic.availableUnlocks.dash),
      true,
    );
  }
});

test('múltiplas seeds não geram cristal ou requisito de Pulso antes do desbloqueio', () => {
  for (const seed of SEEDS) {
    for (let phase = 0; phase < 7; phase++) {
      assert.deepEqual(generatePhase(phase, `${seed}:phase-${phase}`).level.crystals, []);
    }
    const { level } = generatePhase(7, seed);
    assertFeatureStartsAfterEvent(level, 7, 'phosphateSolubilization');
    assert.deepEqual(level.crystals, []);
  }
});

test('ponte micorrízica e raiz lateral permanecem bloqueadas até seus eventos', () => {
  for (const seed of SEEDS) {
    const phase3 = generatePhase(3, `${seed}:roots`).level;
    assertFeatureStartsAfterEvent(phase3, 3, 'azospirillumRoots');

    const phase4 = generatePhase(4, `${seed}:bridges`).level;
    assertFeatureStartsAfterEvent(phase4, 4, 'mycorrhizaStructures');
  }

  const campaign = campaignAtPhase(4, 'runtime-world-gates', { normalProgression: false });
  const sim = createSimulator();
  sim.state.campaign = campaign;
  let bridgeUpdates = 0;
  let lateralRootUpdates = 0;
  sim.mycorrhizaStructures.update = () => { bridgeUpdates++; };
  sim.azospirillumRootGrowth.update = () => { lateralRootUpdates++; };

  sim.step(0);
  assert.equal(bridgeUpdates, 0);
  assert.equal(lateralRootUpdates, 0);

  unlockCampaignFeature(sim.state, 'mycorrhizaStructures');
  sim.step(0);
  assert.equal(bridgeUpdates, 1);
  assert.equal(lateralRootUpdates, 0);

  unlockCampaignFeature(sim.state, 'azospirillumRoots');
  sim.step(0);
  assert.equal(bridgeUpdates, 2);
  assert.equal(lateralRootUpdates, 1);
});

test('morte, checkpoint, reset e recarga preservam somente poderes obtidos', () => {
  const storage = new MemoryStorage();
  const campaign = createCampaign('persistent-seed', { storage });
  const sim = createSimulator();
  sim.state.campaign = campaign;

  unlockCampaignFeature(sim.state, 'doubleJump');
  unlockCampaignFeature(sim.state, 'mycorrhizaStructures');
  sim.state.level.checkpoints = [{ x: 321, y: 276, active: false }];
  sim.state.player.x = 305;
  sim.state.player.y = 252;
  sim.step(0);
  assert.deepEqual(sim.state.currentCheckpoint, { x: 305, y: 222 });

  sim.state.player.canDash = true;
  sim.state.player.canPhosphateSolubilization = true;
  sim.entities.respawn('death');

  assert.equal(sim.state.player.x, 305);
  assert.equal(sim.state.player.y, 222);
  assert.equal(sim.state.player.canDoubleJump, true);
  assert.equal(sim.state.player.canDash, false);
  assert.equal(sim.state.player.canPhosphateSolubilization, false);

  sim.reset();
  assert.equal(sim.state.player.canDoubleJump, true);
  assert.equal(sim.state.player.canDash, false);
  assert.equal(sim.state.player.canPhosphateSolubilization, false);

  const reloaded = createCampaign('ignored-fallback', { storage });
  assert.equal(reloaded.seed, 'persistent-seed');
  assert.deepEqual(reloaded.unlocks, {
    doubleJump: true,
    dash: false,
    phosphateSolubilization: false,
    mycorrhizaStructures: true,
    azospirillumRoots: false,
    // A Propulsao da Rizosfera nasce bloqueada: um save da fase 2 nao pode
    // herdar um poder que so estreia na fase 5.
    jetpack: false,
  });
});

test('avanço de fase não concede automaticamente poderes não obtidos', () => {
  const campaign = campaignAtPhase(2, 'phase-advance', { normalProgression: false });
  campaign.unlocks.doubleJump = true;
  assert.equal(advanceCampaignPhase(campaign), true);
  assert.equal(campaign.phase, 3);
  assert.deepEqual(campaign.unlocks, {
    doubleJump: true,
    dash: false,
    phosphateSolubilization: false,
    mycorrhizaStructures: false,
    azospirillumRoots: false,
    jetpack: false,
  });
});

test('a última fase do manifesto encerra a progressão sem criar uma fase inexistente', () => {
  // A campanha passou a terminar na fase 10 (ecossistema integrado); a 9 e a
  // fase da Ralstonia e ainda avanca.
  const ralstonia = campaignAtPhase(9, 'campaign-ralstonia', { normalProgression: false });
  assert.equal(advanceCampaignPhase(ralstonia), true, 'a fase 9 ainda avanca para a 10');
  assert.equal(ralstonia.phase, 10);

  const campaign = campaignAtPhase(10, 'campaign-end', { normalProgression: false });
  assert.equal(advanceCampaignPhase(campaign), false);
  assert.equal(campaign.phase, 10);
});
