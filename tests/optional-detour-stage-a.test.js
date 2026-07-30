import assert from 'node:assert/strict';
import test from 'node:test';

import {
  campaignPhaseSeed,
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { generateLevel } from '../src/procgen/generator.js';
import { createPhaseTenOptionalDetour } from '../src/procgen/optional-detour-builder.js';
import { validateOptionalDetour } from '../src/procgen/optional-detour-validator.js';
import { applySignatureChallenge } from '../src/procgen/signature-challenge.js';

const SEEDS = Object.freeze([
  'stage-a-5',
  'stage-a-9',
  'stage-a-10',
  'stage-a-11',
  'stage-a-14',
  'stage-a-20',
  'stage-a-26',
  'stage-a-30',
]);

function phaseTen(seedBase) {
  const campaign = createCampaign(seedBase);
  campaign.phase = 10;
  for (const feature of Object.keys(campaign.unlocks)) {
    campaign.unlocks[feature] = true;
  }
  const profile = prepareCampaignGeneration(campaign);
  const seedValue = campaignPhaseSeed(campaign);
  let level = generateLevel(seedValue, {
    referenceScreenWorldWidth: 1280,
    referenceScreenWorldHeight: 720,
    suppressTowerSafeFall: true,
  });
  level.optionalDetourPlaytestMode = true;
  level = decorateCampaignLevel(level, campaign, profile);
  applySignatureChallenge(level, 10);
  const detour = createPhaseTenOptionalDetour({
    level,
    phase: 10,
    seedValue,
  });
  assert.ok(detour, `a seed ${seedBase} deve possuir janela primária adequada`);
  detour.validation = validateOptionalDetour(level, detour);
  return { level, detour };
}

function stageASignature(detour) {
  return JSON.parse(JSON.stringify(detour.structuralSignature));
}

test('Etapa A produz oito desvios determinísticos, separados e verticalmente diversos', () => {
  const results = SEEDS.map(seed => ({ seed, ...phaseTen(seed) }));
  const signatures = results.map(({ detour }) => (
    JSON.stringify(stageASignature(detour))
  ));
  const macroProfiles = new Set();
  const moduleCombinations = new Set();

  for (const { seed, detour } of results) {
    const movement = detour.validation.movement;
    assert.equal(detour.primaryProfileValid, true, `${seed}: silhueta primária`);
    assert.equal(
      detour.prematureConvergenceCount,
      0,
      `${seed}: não pode convergir antes do reencontro`,
    );
    assert.ok(
      detour.minimumPreRejoinSeparation >= 270,
      `${seed}: separação mínima de 270 px`,
    );
    assert.ok(movement.hardVerticalAmplitude >= 180, `${seed}: amplitude macro`);
    assert.ok(movement.hardClimbCount > 0, `${seed}: precisa subir`);
    assert.ok(movement.hardDropCount > 0, `${seed}: precisa descer`);
    assert.equal(movement.everyEdgeValid, true, `${seed}: física de todas as arestas`);
    assert.equal(movement.firstEdgeComboOnly, true, `${seed}: primeira aresta combo-only`);
    assert.equal(
      detour.validation.primaryRouteGeometryUnchanged,
      true,
      `${seed}: rota primária intacta`,
    );
    macroProfiles.add(detour.hardMacroProfile);
    moduleCombinations.add(JSON.stringify(detour.structuralSignature.moduleFamilies));
  }

  assert.ok(new Set(signatures).size >= 4, 'oito seeds devem produzir ao menos quatro assinaturas');
  assert.ok(macroProfiles.size >= 3, 'a matriz deve usar ao menos três perfis macro');
  assert.ok(moduleCombinations.size >= 3, 'a matriz deve usar ao menos três composições estruturais');

  const repeated = phaseTen(SEEDS[0]).detour;
  assert.deepEqual(
    stageASignature(repeated),
    stageASignature(results[0].detour),
    'a mesma seed deve repetir exatamente a assinatura estrutural',
  );
});

