import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { generateLevel } from '../src/procgen/generator.js';
import {
  collectOptionalDetourCandidates,
  primaryRouteGeometryHash,
} from '../src/procgen/optional-detour-planner.js';
import {
  composeOptionalDetour,
  createPhaseTenOptionalDetour,
} from '../src/procgen/optional-detour-composer.js';
import { applySignatureChallenge } from '../src/procgen/signature-challenge.js';
import { canTraverseEdge } from '../src/procgen/traversal-edge-physics.js';

const SEED = 'phase-lab-10:fase-10';
const ABILITIES = Object.freeze([
  'doubleJump',
  'dash',
  'phosphateSolubilization',
]);

function phaseTenGeometry() {
  const campaign = createCampaign('phase-lab-10');
  campaign.phase = 10;
  for (const feature of Object.keys(campaign.unlocks)) {
    campaign.unlocks[feature] = true;
  }
  const profile = prepareCampaignGeneration(campaign);
  let level = generateLevel(SEED, {
    referenceScreenWorldWidth: 1280,
    referenceScreenWorldHeight: 720,
    suppressTowerSafeFall: true,
  });
  level.optionalDetourPlaytestMode = true;
  level = decorateCampaignLevel(level, campaign, profile);
  applySignatureChallenge(level, 10);
  return level;
}

function composeDefault() {
  const level = phaseTenGeometry();
  const primaryHashBefore = primaryRouteGeometryHash(level);
  const collected = collectOptionalDetourCandidates({
    level,
    phase: 10,
    seedValue: SEED,
    abilities: ABILITIES,
  });
  const detour = createPhaseTenOptionalDetour({
    level,
    phase: 10,
    seedValue: SEED,
    abilities: ABILITIES,
  });
  return { level, detour, collected, primaryHashBefore };
}

test('B1 coleta candidatos e soft warnings não eliminam janelas viáveis', () => {
  const level = phaseTenGeometry();
  const { candidates, diagnostics } = collectOptionalDetourCandidates({
    level,
    phase: 10,
    seedValue: SEED,
    abilities: ABILITIES,
  });
  assert.ok(candidates.length > 1);
  assert.equal(diagnostics.viableCandidateCount > 0, true);
  assert.ok(candidates.some(candidate => candidate.softWarnings.length > 0));
  assert.ok(candidates.some(candidate => (
    candidate.softWarnings.length > 0 && !candidate.hardFailures.length
  )));
});

test('B1 tenta candidatos por score e instala o phosphate gate', () => {
  const { level, detour, collected } = composeDefault();
  const firstViable = collected.candidates.find(candidate => (
    !candidate.hardFailures.length
  ));
  assert.ok(detour);
  assert.equal(detour.compositionFallback, false);
  assert.equal(detour.candidateId, firstViable.id);
  assert.equal(
    level.optionalDetourComposition.attempts[0].candidateId,
    firstViable.id,
  );
  assert.ok(detour.challengeModuleIds.includes('hard-phosphate-gate'));
  assert.ok(
    detour.optionalPlatformIds.some(id => id.includes('phosphate-gate')),
  );
  const access = level.platforms.find(platform => (
    platform.platformId === detour.accessLandingId
  ));
  const entry = level.platforms.find(platform => (
    platform.platformId === detour.mandatoryComboEntryPlatformId
  ));
  const normal = level.primitives.filter(primitive => (
    !(primitive.requires || []).length
  ));
  const doubleOnly = level.primitives.filter(primitive => (
    (primitive.requires || []).includes('doubleJump')
    && !(primitive.requires || []).includes('dash')
  ));
  const dashOnly = level.primitives.filter(primitive => (
    (primitive.requires || []).includes('dash')
    && !(primitive.requires || []).includes('doubleJump')
  ));
  const combo = level.primitives.filter(primitive => (
    primitive.id === 'running-double-jump-dash'
  ));
  assert.equal(canTraverseEdge({ from: access, to: entry, primitives: normal }).valid, false);
  assert.equal(canTraverseEdge({ from: access, to: entry, primitives: doubleOnly }).valid, false);
  assert.equal(canTraverseEdge({ from: access, to: entry, primitives: dashOnly }).valid, false);
  assert.equal(canTraverseEdge({ from: access, to: entry, primitives: combo }).valid, true);
});

test('B1 materializa depósito bloqueado e Bacillus acessível antes dele', () => {
  const { level, detour } = composeDefault();
  const deposit = level.phosphateDeposits.find(candidate => (
    candidate.id === detour.phosphateDepositId
  ));
  const colony = level.authoredBeneficialColonies.find(candidate => (
    candidate.id === detour.bacillusColonyId
  ));
  assert.ok(deposit);
  assert.equal(deposit.broken, false);
  assert.equal(deposit.remainingPhosphate, 1);
  assert.equal(deposit.optionalDetourId, detour.id);
  assert.equal(deposit.detourModuleId, 'hard-phosphate-gate');
  assert.equal(deposit.routeScope, 'optional');
  assert.ok(colony);
  assert.ok(colony.x < deposit.x);
  assert.equal(colony.routeScope, 'optional');
});

test('B1 isola população global e não cruza o depósito com conectores', () => {
  const { level, detour } = composeDefault();
  const encounters = generateCampaignEncounters({
    platforms: level.platforms,
    phase: 10,
    seedValue: SEED,
  });
  assert.ok(encounters.every(encounter => (
    encounter.platform?.routeScope !== 'optional'
  )));
  assert.equal(
    detour.validation.phosphateGate.connectorInvadesDeposit,
    false,
  );
  assert.equal(
    detour.validation.phosphateGate.platformCrossingCount,
    0,
  );
});

test('B1 preserva a rota principal e a seed padrão não usa fallback', () => {
  const { level, detour, primaryHashBefore } = composeDefault();
  assert.equal(primaryRouteGeometryHash(level), primaryHashBefore);
  assert.equal(detour.validation.primaryRouteGeometryUnchanged, true);
  assert.equal(detour.validation.valid, true);
  assert.equal(detour.compositionFallback, false);
});

test('B1 expõe falha e fallback de forma explícita', () => {
  const level = phaseTenGeometry();
  const result = composeOptionalDetour({
    level,
    candidates: [],
    seedValue: SEED,
    abilities: ABILITIES,
  });
  assert.equal(result.success, false);
  assert.deepEqual(result.attempts, []);

  for (const platform of level.platforms) platform.authored = true;
  const detour = createPhaseTenOptionalDetour({
    level,
    phase: 10,
    seedValue: `${SEED}:no-window`,
    abilities: ABILITIES,
  });
  assert.equal(detour, null);
  assert.equal(level.optionalDetourComposition.compositionFallback, true);
  assert.equal(
    level.optionalDetourComposition.compositionFallbackReason,
    'no-viable-candidate-for-scaffold',
  );
});
