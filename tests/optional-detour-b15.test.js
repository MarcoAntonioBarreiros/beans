import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { generateLevel } from '../src/procgen/generator.js';
import {
  allocateOptionalDetourB15Slots,
  createPhaseTenOptionalDetour,
  selectOptionalDetourB15Sequence,
} from '../src/procgen/optional-detour-composer.js';
import {
  HARD_MOVEMENT_COMBO_MODULE,
  HARD_PHOSPHATE_GATE_MODULE,
} from '../src/procgen/optional-detour-modules.js';
import { applySignatureChallenge } from '../src/procgen/signature-challenge.js';
import { getPhaseManifest, setPhaseManifestOverride } from '../src/procgen/campaign-manifest.js';

function cloneForFixedLength(manifest) {
  return JSON.parse(JSON.stringify({ ...manifest, chunkRange: undefined }));
}

// Cenario de SEEDS curadas contra uma fase de 40 chunks — ver o mesmo comentario
// em optional-detour-stage-a. O que se exercita aqui e o conector do desvio,
// nao o comprimento da fase.
setPhaseManifestOverride(cloneForFixedLength(getPhaseManifest(10)));

const ABILITIES = Object.freeze([
  'doubleJump',
  'dash',
  'phosphateSolubilization',
]);
const REGRESSION_SEEDS = Object.freeze([7, 8, 10, 21, 25]
  .map(index => `phase-lab-audit-${index}:fase-10`));
const MATRIX_SEEDS = Object.freeze(Array.from(
  { length: 24 },
  (_, index) => `phase-lab-audit-${index + 1}:fase-10`,
));

function phaseTenGeometry(seed) {
  const campaign = createCampaign(seed.split(':')[0]);
  campaign.phase = 10;
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
  applySignatureChallenge(level, 10);
  return level;
}

function compose(seed) {
  const level = phaseTenGeometry(seed);
  const detour = createPhaseTenOptionalDetour({
    level,
    phase: 10,
    seedValue: seed,
    abilities: ABILITIES,
  });
  return { level, detour };
}

test('B1.5 seleciona sequência e aloca slots de forma pura e determinística', () => {
  const input = {
    availableSpan: 5200,
    seedValue: 'sequence-unit-seed',
    candidateId: 'candidate-unit',
    phosphateModule: HARD_PHOSPHATE_GATE_MODULE,
    movementModule: HARD_MOVEMENT_COMBO_MODULE,
  };
  const first = selectOptionalDetourB15Sequence(input);
  const second = selectOptionalDetourB15Sequence(input);
  assert.deepEqual(second, first);
  assert.ok(first);
  assert.equal(
    first.modules.filter(moduleId => moduleId === 'hard-phosphate-gate').length,
    1,
  );
  assert.ok(
    first.modules.filter(moduleId => moduleId === 'hard-movement-combo').length
    <= 2,
  );

  const allocationInput = {
    sequence: first,
    centralStartX: 1000,
    centralEndX: 6200,
    random: () => .42,
  };
  const allocationA = allocateOptionalDetourB15Slots(allocationInput);
  const allocationB = allocateOptionalDetourB15Slots(allocationInput);
  assert.deepEqual(allocationB, allocationA);
  assert.ok(allocationA.slots.every(slot => (
    slot.allocatedSpan >= slot.minimumWorldSpan
    && slot.allocatedSpan <= slot.maximumWorldSpan
    && slot.slotLeft >= 1000
    && slot.slotRight <= 6200
  )));
  assert.ok(allocationA.slots.slice(1).every((slot, index) => (
    slot.slotLeft >= allocationA.slots[index].slotRight
  )));

  const residual = allocateOptionalDetourB15Slots({
    sequence: {
      id: 'phosphate',
      modules: ['hard-phosphate-gate'],
    },
    centralStartX: 1000,
    centralEndX: 3400,
    random: () => .42,
  });
  assert.equal(residual.unusedSpan, 600);
  assert.equal(residual.leadingMargin, 300);
  assert.equal(residual.trailingMargin, 300);
  assert.equal(residual.slots[0].slotLeft, 1300);
  assert.equal(residual.slots[0].slotRight, 3100);
  assert.equal(allocateOptionalDetourB15Slots({
    sequence: {
      id: 'phosphate',
      modules: ['hard-phosphate-gate'],
    },
    centralStartX: 1000,
    centralEndX: 3500,
    random: () => .42,
  }), null);
});

test('B1.5 mantém fosfato único, bloqueado e confinado ao slot', () => {
  const { level, detour } = compose('phase-lab-10:fase-10');
  assert.ok(detour);
  assert.strictEqual(
    detour.implementationStage,
    'B2',
    'implementationStage deve ser B2'
  );
  assert.equal(detour.compositionFallback, false);
  assert.equal(
    detour.selectedSequence.filter(id => id === 'hard-phosphate-gate').length,
    1,
  );
  const deposit = level.phosphateDeposits.find(candidate => (
    candidate.id === detour.phosphateDepositId
  ));
  const bacillus = level.authoredBeneficialColonies.find(candidate => (
    candidate.id === detour.bacillusColonyId
  ));
  assert.ok(deposit);
  assert.equal(deposit.broken, false);
  assert.ok(bacillus.x < deposit.x);
  assert.equal(detour.validation.phosphateInsideSlot, true);
  assert.equal(detour.validation.phosphateGate.platformCrossingCount, 0);
  assert.equal(detour.validation.phosphateGate.connectorInvadesDeposit, false);
  assert.equal(detour.validation.moduleOrderValid, true);
  assert.equal(detour.validation.slotOrderValid, true);
  assert.equal(detour.validation.movementEdgesValid, true);
  assert.equal(detour.validation.movementDeclaredEdgesValid, true);
  assert.equal(detour.validation.mandatoryEntryComboOnly, true);
  assert.ok(detour.unusedSpan <= 650);
  assert.ok(detour.connectorPlatformCount <= 4);
  assert.ok(detour.maximumConnectorChainLength <= 2);
  assert.equal(
    detour.validation.primaryRouteGeometryHashBefore,
    detour.validation.primaryRouteGeometryHashAfter,
  );
});

test('B1.5 corrige as cinco seeds que produziam conectores longos', () => {
  for (const seed of REGRESSION_SEEDS) {
    const { detour } = compose(seed);
    assert.ok(detour, seed);
    assert.equal(detour.compositionFallback, false, seed);
    assert.equal(detour.validation.valid, true, seed);
    assert.ok(detour.unusedSpan <= 650, seed);
    assert.ok(detour.connectorPlatformCount <= 4, seed);
    assert.ok(detour.maximumConnectorChainLength <= 2, seed);
    assert.equal(detour.validation.mandatoryEntryComboOnly, true, seed);
    assert.equal(detour.validation.movementDeclaredEdgesValid, true, seed);
    assert.equal(
      detour.validation.phosphateGate.platformCrossingCount,
      0,
      seed,
    );
    assert.notEqual(
      detour.selectedSequenceId,
      detour.availableSpan
        > HARD_PHOSPHATE_GATE_MODULE.maximumWorldSpan + 650
        ? 'phosphate'
        : '__not-applicable__',
      seed,
    );
  }
});

test('B1.5 cobre 24 seeds reais sem filtrar previamente por sucesso', () => {
  const results = MATRIX_SEEDS.map(seed => {
    const { detour } = compose(seed);
    return {
      seed,
      detour,
      noCandidate: !detour,
      fallback: Boolean(detour?.compositionFallback),
    };
  });
  assert.equal(results.length, 24);
  const composed = results.filter(result => (
    result.detour && !result.detour.compositionFallback
  ));
  assert.ok(composed.length >= 8);
  assert.ok(composed.every(({ detour }) => detour.validation.valid));
  assert.ok(composed.every(({ detour }) => (
    detour.primaryRouteGeometryHashBefore
    === detour.primaryRouteGeometryHashAfter
  )));

  const sequences = new Set(composed.map(({ detour }) => (
    detour.selectedSequenceId
  )));
  assert.ok(sequences.size >= 2);
  const positionClasses = new Set(composed.map(({ detour }) => (
    detour.phosphatePositionClass
  )));
  assert.ok(positionClasses.has('early'));
  assert.ok(
    positionClasses.has('middle'),
  );
  assert.ok(positionClasses.has('late'));
  assert.ok(composed.some(({ detour }) => (
    detour.selectedSequence.indexOf('hard-movement-combo')
    < detour.selectedSequence.indexOf('hard-phosphate-gate')
  )));
  assert.ok(composed.some(({ detour }) => (
    detour.selectedSequence.lastIndexOf('hard-movement-combo')
    > detour.selectedSequence.indexOf('hard-phosphate-gate')
  )));

  for (const { detour } of composed) {
    assert.equal(
      detour.selectedSequence.filter(id => id === 'hard-phosphate-gate').length,
      1,
    );
    assert.ok(
      detour.selectedSequence
        .filter(id => id === 'hard-movement-combo').length <= 2,
    );
    assert.equal(detour.validation.moduleOrderValid, true);
    assert.equal(detour.validation.slotOrderValid, true);
    assert.equal(detour.validation.connectorEdgesValid, true);
    assert.equal(detour.validation.phosphateInsideSlot, true);
    assert.equal(detour.validation.mandatoryEntryComboOnly, true);
    assert.equal(detour.validation.movementDeclaredEdgesValid, true);
    assert.equal(detour.validation.invalidDeclaredMovementEdgeCount, 0);
    assert.ok(detour.unusedSpan <= 650);
    assert.ok(detour.connectorPlatformCount <= 4);
    assert.ok(detour.maximumConnectorChainLength <= 2);
    assert.ok(
      detour.availableSpan <= detour.maximumSequenceSpan + 650,
    );
    if (
      detour.availableSpan
      > HARD_PHOSPHATE_GATE_MODULE.maximumWorldSpan + 650
    ) {
      assert.notEqual(detour.selectedSequenceId, 'phosphate');
    }
  }

  const fallbackResults = results.filter(result => result.fallback);
  assert.ok(fallbackResults.every(({ detour }) => (
    !detour || detour.implementationStage !== 'B1.5'
  )));
  const deterministicA = compose('phase-lab-audit-10:fase-10').detour;
  const deterministicB = compose('phase-lab-audit-10:fase-10').detour;
  assert.deepEqual(
    deterministicB.structuralSignature,
    deterministicA.structuralSignature,
  );
});
