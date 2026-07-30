import {
  buildOptionalDetour,
  chooseAccessLanding,
  cruiseLaneY,
  moduleRecord,
} from './optional-detour-builder.js';
import { materializeOptionalDetourContent } from './optional-detour-content.js';
import {
  AZO_LATERAL_ACCESS_MODULE,
  connectOptionalDetourSockets,
  createOptionalDetourPlatform,
  DROP_REJOIN_MODULE,
  HARD_MOVEMENT_COMBO_MODULE,
  HARD_MYCORRHIZA_GAP_MODULE,
  HARD_PHOSPHATE_GATE_MODULE,
  OPTIONAL_DETOUR_MODULE_CATALOG,
} from './optional-detour-modules.js';
import {
  collectOptionalDetourCandidates,
  OPTIONAL_DETOUR_AUTHORED_ENCOUNTER_SPACING,
  primaryRouteGeometryHash,
} from './optional-detour-planner.js';
import { validateOptionalDetour } from './optional-detour-validator.js';
import { canTraverseEdge } from './traversal-edge-physics.js';
import { createRandom } from './random.js';

const MODULE_GAP = 100;
export const MAX_RESIDUAL_SPAN = 650;
export const MAX_TOTAL_CONNECTOR_PLATFORMS = 4;
const PHOSPHATE_VARIANTS = Object.freeze([
  'phosphate-compact',
  'phosphate-balanced',
  'phosphate-offset',
]);
const B15_SEQUENCE_DEFINITIONS = Object.freeze([
  // 1 biological challenge
  Object.freeze({ id: 'phosphate', modules: Object.freeze(['hard-phosphate-gate']) }),
  Object.freeze({ id: 'mycorrhiza', modules: Object.freeze(['hard-mycorrhiza-gap']) }),
  Object.freeze({ id: 'phosphate-movement', modules: Object.freeze(['hard-phosphate-gate', 'hard-movement-combo']) }),
  Object.freeze({ id: 'movement-phosphate', modules: Object.freeze(['hard-movement-combo', 'hard-phosphate-gate']) }),
  Object.freeze({ id: 'mycorrhiza-movement', modules: Object.freeze(['hard-mycorrhiza-gap', 'hard-movement-combo']) }),
  Object.freeze({ id: 'movement-mycorrhiza', modules: Object.freeze(['hard-movement-combo', 'hard-mycorrhiza-gap']) }),
  Object.freeze({ id: 'movement-phosphate-movement', modules: Object.freeze(['hard-movement-combo', 'hard-phosphate-gate', 'hard-movement-combo']) }),
  Object.freeze({ id: 'movement-mycorrhiza-movement', modules: Object.freeze(['hard-movement-combo', 'hard-mycorrhiza-gap', 'hard-movement-combo']) }),

  // 2 biological challenges (only when span permits)
  Object.freeze({ id: 'phosphate-mycorrhiza', modules: Object.freeze(['hard-phosphate-gate', 'hard-mycorrhiza-gap']) }),
  Object.freeze({ id: 'mycorrhiza-phosphate', modules: Object.freeze(['hard-mycorrhiza-gap', 'hard-phosphate-gate']) }),
  Object.freeze({ id: 'movement-phosphate-mycorrhiza', modules: Object.freeze(['hard-movement-combo', 'hard-phosphate-gate', 'hard-mycorrhiza-gap']) }),
  Object.freeze({ id: 'movement-mycorrhiza-phosphate', modules: Object.freeze(['hard-movement-combo', 'hard-mycorrhiza-gap', 'hard-phosphate-gate']) }),
  Object.freeze({ id: 'phosphate-movement-mycorrhiza', modules: Object.freeze(['hard-phosphate-gate', 'hard-movement-combo', 'hard-mycorrhiza-gap']) }),
  Object.freeze({ id: 'mycorrhiza-movement-phosphate', modules: Object.freeze(['hard-mycorrhiza-gap', 'hard-movement-combo', 'hard-phosphate-gate']) }),
]);

function planFromCandidate(level, candidate, seedValue) {
  return {
    ...candidate,
    phase: 10,
    seedValue,
    startPlatform: candidate.startPlatform,
    preEntryPlatform: candidate.preEntryPlatform,
    rejoinPlatform: candidate.rejoinPlatform,
    preEntryPlatformId:
      candidate.preEntryPlatform.platformId || candidate.preEntryPlatform.id,
    primaryRoute: candidate.primaryRoute,
    primaryRouteGeometryHashBefore: primaryRouteGeometryHash(level),
    authoredEncounterSpacing: OPTIONAL_DETOUR_AUTHORED_ENCOUNTER_SPACING,
  };
}

function snapshotMutableLevel(level) {
  return {
    platformsLength: (level.platforms || []).length,
    crystalsLength: (level.crystals || []).length,
    depositsLength: (level.phosphateDeposits || []).length,
    coloniesLength: (level.authoredBeneficialColonies || []).length,
    azoRequestsLength: (level.authoredAzospirillumLadderRequests || []).length,
    detoursLength: (level.optionalDetours || []).length,
    reservedLength: (level.optionalDetourReservedBounds || []).length,
    authoredEncountersLength: (level.authoredEncounters || []).length,
    exudatesLength: (level.exudates || []).length,
  };
}

function rollback(level, snapshot, plan) {
  level.platforms?.splice(snapshot.platformsLength);
  level.crystals?.splice(snapshot.crystalsLength);
  level.phosphateDeposits?.splice(snapshot.depositsLength);
  level.authoredBeneficialColonies?.splice(snapshot.coloniesLength);
  level.authoredAzospirillumLadderRequests?.splice(snapshot.azoRequestsLength);
  level.optionalDetours?.splice(snapshot.detoursLength);
  level.optionalDetourReservedBounds?.splice(snapshot.reservedLength);
  level.authoredEncounters?.splice(snapshot.authoredEncountersLength);
  level.exudates?.splice(snapshot.exudatesLength);
  if (plan?.startPlatform) {
    delete plan.startPlatform.azospirillumLadderHost;
    delete plan.startPlatform.optionalDetourLaunchRoot;
  }
}

function hasRequiredAbilities(module, abilities) {
  const available = new Set(abilities);
  return (module.requiredAbilities || []).every(ability => available.has(ability));
}

function sequenceMinimumSpan(sequence, moduleById) {
  return sequence.modules.reduce((total, moduleId) => (
    total + Number(moduleById.get(moduleId)?.minimumWorldSpan || Infinity)
  ), MODULE_GAP * Math.max(0, sequence.modules.length - 1));
}

function sequenceMaximumSpan(sequence, moduleById) {
  return sequence.modules.reduce((total, moduleId) => (
    total + Number(moduleById.get(moduleId)?.maximumWorldSpan || -Infinity)
  ), MODULE_GAP * Math.max(0, sequence.modules.length - 1));
}

function deterministicShuffle(values, random) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function compatibleSequences({
  availableSpan,
  abilities,
  moduleCatalog = OPTIONAL_DETOUR_MODULE_CATALOG,
  phosphateModule = HARD_PHOSPHATE_GATE_MODULE,
  movementModule = HARD_MOVEMENT_COMBO_MODULE,
}) {
  const moduleById = new Map(moduleCatalog.map(module => [module.id, module]));
  const activeAbilities = (abilities && abilities.length > 0)
    ? abilities
    : ['doubleJump', 'dash', 'phosphateSolubilization'];
  return B15_SEQUENCE_DEFINITIONS.filter(sequence => {
    if (sequence.modules.some(id => !moduleById.has(id))) return false;
    if (sequence.modules.some(id => !hasRequiredAbilities(moduleById.get(id), activeAbilities))) {
      return false;
    }
    const minimumSequenceSpan = sequenceMinimumSpan(sequence, moduleById);
    const maximumSequenceSpan = sequenceMaximumSpan(sequence, moduleById);
    return minimumSequenceSpan <= availableSpan
      && availableSpan <= maximumSequenceSpan + MAX_RESIDUAL_SPAN;
  });
}

export function selectOptionalDetourB15Sequence({
  availableSpan,
  seedValue,
  candidateId,
  abilities = [],
  moduleCatalog = OPTIONAL_DETOUR_MODULE_CATALOG,
  phosphateModule = HARD_PHOSPHATE_GATE_MODULE,
  movementModule = HARD_MOVEMENT_COMBO_MODULE,
} = {}) {
  const compatible = compatibleSequences({
    availableSpan,
    abilities,
    moduleCatalog,
    phosphateModule,
    movementModule,
  });
  if (!compatible.length) return null;
  const random = createRandom(
    `${seedValue}:${candidateId}:optional-detour-b15`,
  );
  const shuffled = deterministicShuffle(compatible, random);
  const longest = compatible.find(sequence => (
    sequence.id === 'movement-phosphate-movement' || sequence.id === 'movement-mycorrhiza-movement'
  ));
  const pool = longest && availableSpan >= 4000
    ? [...shuffled, longest, longest]
    : shuffled;
  return pool[Math.floor(random() * pool.length)];
}

export function allocateOptionalDetourB15Slots({
  sequence,
  centralStartX,
  centralEndX,
  random,
  moduleCatalog = OPTIONAL_DETOUR_MODULE_CATALOG,
  phosphateModule = HARD_PHOSPHATE_GATE_MODULE,
  movementModule = HARD_MOVEMENT_COMBO_MODULE,
} = {}) {
  if (!sequence || centralEndX <= centralStartX) return null;
  if (typeof random !== 'function') {
    throw new Error('b15-slot-allocation-requires-deterministic-random');
  }
  const moduleById = new Map(moduleCatalog.map(module => [module.id, module]));
  const modules = sequence.modules.map((moduleId, slotIndex) => ({
    moduleId,
    slotIndex,
    module: moduleById.get(moduleId),
  }));
  if (modules.some(entry => !entry.module)) return null;
  const availableSpan = centralEndX - centralStartX;
  const baseGapSpan = MODULE_GAP * Math.max(0, modules.length - 1);
  const allocations = modules.map(entry => entry.module.minimumWorldSpan);
  const minimumSpan = allocations.reduce((sum, value) => sum + value, baseGapSpan);
  const maximumSpan = modules.reduce((sum, entry) => (
    sum + entry.module.maximumWorldSpan
  ), baseGapSpan);
  if (minimumSpan > availableSpan) return null;

  let extra = availableSpan - minimumSpan;
  const distributionOrder = deterministicShuffle([...modules.keys()], random);
  for (const targetField of ['preferredWorldSpan', 'maximumWorldSpan']) {
    for (const index of distributionOrder) {
      if (extra <= 0) break;
      const target = Number(modules[index].module[targetField]);
      const grant = Math.min(extra, Math.max(0, target - allocations[index]));
      allocations[index] += grant;
      extra -= grant;
    }
  }

  const usedSpan = allocations.reduce((sum, value) => sum + value, baseGapSpan);
  const unusedSpan = Math.max(0, availableSpan - usedSpan);
  if (unusedSpan > MAX_RESIDUAL_SPAN) return null;
  const leadingMargin = unusedSpan * .5;
  const trailingMargin = unusedSpan - leadingMargin;
  let cursor = centralStartX + leadingMargin;
  const slots = modules.map((entry, index) => {
    const slotLeft = cursor;
    const allocatedSpan = allocations[index];
    const slotRight = slotLeft + allocatedSpan;
    cursor = slotRight + (index < modules.length - 1 ? MODULE_GAP : 0);
    return {
      moduleId: entry.moduleId,
      slotIndex: entry.slotIndex,
      slotLeft,
      slotRight,
      allocatedSpan,
      minimumWorldSpan: entry.module.minimumWorldSpan,
      preferredWorldSpan: entry.module.preferredWorldSpan,
      maximumWorldSpan: entry.module.maximumWorldSpan,
    };
  });
  return {
    sequenceId: sequence.id,
    slots,
    gaps: slots.slice(1).map((slot, index) => ({
      left: slots[index].slotRight,
      right: slot.slotLeft,
      width: slot.slotLeft - slots[index].slotRight,
    })),
    availableSpan,
    minimumSpan,
    maximumSpan,
    minimumSequenceSpan: minimumSpan,
    maximumSequenceSpan: maximumSpan,
    usedSpan,
    unusedSpan,
    leadingMargin,
    trailingMargin,
  };
}

function buildMandatoryComboEntry(context) {
  const access = context.accessPlatform;
  const platform = createOptionalDetourPlatform(context, {
    id: `${context.detourId}:mandatory-combo-entry`,
    moduleId: 'optional-detour-entry-combo',
    x: access.x + access.w + 345,
    y: access.y - 62,
    w: 150,
    order: 10,
  });
  platform.optionalDetourSection = 'mandatory-combo-entry';
  platform.movementRecipeId = 'combo-climb';
  platform.requiredAbilities = ['doubleJump', 'dash'];
  platform.authored = true;
  const comboPrimitives = (context.level.primitives || []).filter(primitive => (
    primitive.id === 'running-double-jump-dash'
  ));
  const validation = canTraverseEdge({
    from: access,
    to: platform,
    primitives: comboPrimitives,
  });
  if (!validation.valid) {
    throw new Error('mandatory-combo-entry-unreachable');
  }
  return {
    platform,
    entrySocket: { platformId: platform.platformId, platform },
    edge: {
      from: access.platformId,
      to: platform.platformId,
      direct: true,
      primitiveId: validation.passingPrimitiveIds[0] || null,
    },
  };
}

function compositionResult(detour, attempts) {
  return {
    success: true,
    candidateId: detour.candidateId,
    compositionId: detour.compositionId,
    modules: detour.modules,
    platforms: detour.optionalPlatformIds,
    structures: detour.structureIds || [],
    connectors: detour.connectorPlatformIds,
    contentRequests: detour.contentRequestIds,
    validation: detour.validation,
    attempts,
    failureReasons: [],
    compositionFallback: false,
    detour,
  };
}

function moduleAttemptOrder({
  availableSpan,
  seedValue,
  candidateId,
  abilities = [],
  moduleCatalog = OPTIONAL_DETOUR_MODULE_CATALOG,
}) {
  const compatible = compatibleSequences({
    availableSpan,
    abilities,
    moduleCatalog,
  });

  const selected = selectOptionalDetourB15Sequence({
    availableSpan,
    seedValue,
    candidateId,
    abilities,
    moduleCatalog,
  });

  if (!selected) return [];

  const random = createRandom(
    `${seedValue}:${candidateId}:b2-retry-order`
  );

  const remaining = deterministicShuffle(
    compatible.filter(sequence => sequence.id !== selected.id),
    random,
  );

  return [selected, ...remaining];
}

function phosphateVariantOrder(seedValue, candidateId, sequenceId) {
  const random = createRandom(
    `${seedValue}:${candidateId}:${sequenceId}:phosphate-variant`,
  );
  return deterministicShuffle(PHOSPHATE_VARIANTS, random);
}

function phosphatePositionClass(centerX, centralStartX, centralEndX) {
  const ratio = (centerX - centralStartX)
    / Math.max(1, centralEndX - centralStartX);
  if (ratio < .34) return { ratio, className: 'early' };
  if (ratio < .67) return { ratio, className: 'middle' };
  return { ratio, className: 'late' };
}

export function composeOptionalDetour({
  level,
  candidates = [],
  seedValue,
  abilities = [],
  moduleCatalog = OPTIONAL_DETOUR_MODULE_CATALOG,
} = {}) {
  const attempts = [];
  const attemptedCandidateIds = [];
  const phosphateModule = moduleCatalog.find(module => (
    module.id === HARD_PHOSPHATE_GATE_MODULE.id
  ));
  const movementModule = moduleCatalog.find(module => (
    module.id === HARD_MOVEMENT_COMBO_MODULE.id
  ));
  if (!level || !phosphateModule || !movementModule) {
    return {
      success: false,
      attempts,
      failureReasons: ['missing-level-or-b15-module'],
      compositionFallback: false,
    };
  }
  if (
    !hasRequiredAbilities(phosphateModule, abilities)
    || !hasRequiredAbilities(movementModule, abilities)
  ) {
    return {
      success: false,
      attempts,
      failureReasons: ['required-abilities-unavailable'],
      compositionFallback: false,
    };
  }

  const ordered = [...candidates].sort((left, right) => (
    left.hardFailures.length - right.hardFailures.length
    || right.softScore - left.softScore
    || left.startLogicIndex - right.startLogicIndex
  ));

  for (const candidate of ordered) {
    attemptedCandidateIds.push(candidate.id);
    const candidateAttempt = {
      candidateId: candidate.id,
      softScore: candidate.softScore,
      softWarnings: [...candidate.softWarnings],
      hardFailures: [...candidate.hardFailures],
      failures: [],
      sequenceAttempts: [],
    };
    attempts.push(candidateAttempt);
    if (candidate.hardFailures.length) {
      candidateAttempt.failures.push(...candidate.hardFailures);
      continue;
    }
    const plan = planFromCandidate(level, candidate, seedValue);
    const baseline = snapshotMutableLevel(level);
    let accessLanding;
    try {
      accessLanding = chooseAccessLanding(level, plan);
      if (!accessLanding.collisionFree || !accessLanding.jetpackAccessible) {
        throw new Error('access-not-physically-usable');
      }
    } catch (error) {
      candidateAttempt.failures.push(error.message);
      continue;
    }

    const estimatedAccessRight = accessLanding.x + 220;
    const centralStartX = estimatedAccessRight + 345 + 150 + 20;
    const centralEndX = plan.rejoinPlatform.x - 300;
    const availableSpan = centralEndX - centralStartX;
    const sequenceOrder = moduleAttemptOrder({
      availableSpan,
      seedValue,
      candidateId: candidate.id,
      abilities,
      moduleCatalog,
    });
    if (!sequenceOrder.length) {
      candidateAttempt.failures.push(
        `no-compatible-b15-sequence:${Math.round(availableSpan)}`,
      );
      continue;
    }

    for (const sequence of sequenceOrder) {
      const sequenceHasPhosphate =
        sequence.modules.includes(HARD_PHOSPHATE_GATE_MODULE.id);

      const variants = sequenceHasPhosphate
        ? phosphateVariantOrder(seedValue, candidate.id, sequence.id)
        : [null];

      for (const phosphateVariant of variants) {
        rollback(level, baseline, plan);
        const sequenceAttempt = {
          sequenceId: sequence.id,
          phosphateVariant,
          failures: [],
        };
        candidateAttempt.sequenceAttempts.push(sequenceAttempt);
        const random = createRandom(
          `${seedValue}:${candidate.id}:${sequence.id}:${phosphateVariant}:b15`,
        );
        try {
          const context = {
            level,
            detourId: plan.id,
            primaryRoute: plan.primaryRoute,
            startPlatform: plan.startPlatform,
            preEntryPlatform: plan.preEntryPlatform,
            rejoinPlatform: plan.rejoinPlatform,
            accessLandingX: accessLanding.x,
            accessLandingY: accessLanding.y,
            cruiseLaneY: cruiseLaneY(plan),
            seedValue,
            random,
            abilities,
          };
          const access = AZO_LATERAL_ACCESS_MODULE.buildGeometry(context);
          level.platforms.push(...access.platforms);
          level.authoredAzospirillumLadderRequests = [
            ...(level.authoredAzospirillumLadderRequests || []),
            ...(access.authoredAzospirillumLadderRequests || []),
          ];
          context.accessPlatform = access.platforms[0];
          const mandatoryEntry = buildMandatoryComboEntry(context);
          level.platforms.push(mandatoryEntry.platform);

          const actualCentralStartX = mandatoryEntry.platform.x
            + mandatoryEntry.platform.w + 20;
          const allocation = allocateOptionalDetourB15Slots({
            sequence,
            centralStartX: actualCentralStartX,
            centralEndX,
            random,
            phosphateModule,
            movementModule,
          });
          if (!allocation) throw new Error('b15-slot-allocation-failed');

          const moduleById = new Map(moduleCatalog.map(module => [module.id, module]));
          const moduleResults = [];
          const connectorResults = [];
          const contentRequests = [];
          let currentSocket = mandatoryEntry.entrySocket;
          let phosphateResult = null;
          let mycorrhizaResult = null;
          const accumulatedForbiddenBounds = [];
          const accumulatedIntentionalGaps = [];

          for (const slot of allocation.slots) {
            const module = moduleById.get(slot.moduleId);
            const sourcePlatform = currentSocket.platform
              || level.platforms.find(platform => (
                platform.platformId === currentSocket.platformId
              ));
            const moduleContext = {
              ...context,
              ...slot,
              moduleInstanceId: `${module.id}-${slot.slotIndex}`,
              entryRegion: {
                platform: sourcePlatform,
                x: sourcePlatform.x + sourcePlatform.w,
                y: sourcePlatform.y,
              },
              entryPlatform: sourcePlatform,
              phosphateVariant,
            };
            const result = module.buildGeometry(moduleContext);
            if (!result || result.success === false) {
              throw new Error(`module-geometry-failed:${slot.moduleId}`);
            }
            if (result.depositBounds) accumulatedForbiddenBounds.push(result.depositBounds);
            if (result.intentionalGaps) accumulatedIntentionalGaps.push(...result.intentionalGaps);

            const connector = connectOptionalDetourSockets({
              level,
              detourId: plan.id,
              fromSocket: currentSocket,
              toSocket: result.entrySocket,
              abilities,
              forbiddenBounds: [...accumulatedForbiddenBounds],
              intentionalGaps: [...accumulatedIntentionalGaps],
              seedValue: `${seedValue}:${candidate.id}:${sequence.id}:connector-${slot.slotIndex}`,
              detourModuleId: `minimal-connector-${slot.slotIndex}`,
              orderStart: 500 + slot.slotIndex * 30,
            });
            if (!connector.success) {
              throw new Error(
                `module-connector-${slot.slotIndex}:${connector.reason}`,
              );
            }
            if (connector.platforms.length > 2) {
              throw new Error('connector-chain-exceeds-b15-limit');
            }
            level.platforms.push(...connector.platforms, ...result.platforms);
            connectorResults.push(connector);
            moduleResults.push({ module, result, slot });
            contentRequests.push(...(result.contentRequests || []));
            currentSocket = result.exitSocket;
            if (module.id === HARD_PHOSPHATE_GATE_MODULE.id) phosphateResult = result;
            if (module.id === HARD_MYCORRHIZA_GAP_MODULE.id) mycorrhizaResult = result;
          }
          const connectorPlatformCount = connectorResults.reduce(
            (total, result) => total + result.platforms.length,
            0,
          );
          const maximumConnectorChainLength = connectorResults.reduce(
            (maximum, result) => Math.max(maximum, result.platforms.length),
            0,
          );
          if (connectorPlatformCount > MAX_TOTAL_CONNECTOR_PLATFORMS) {
            throw new Error('total-connectors-exceed-b15-limit');
          }

          const lastHardPlatform = currentSocket.platform
            || level.platforms.find(platform => (
              platform.platformId === currentSocket.platformId
            ));
          context.lastHardPlatform = lastHardPlatform;
          const exit = DROP_REJOIN_MODULE.buildGeometry(context);
          const exitValidation = canTraverseEdge({
            from: lastHardPlatform,
            to: plan.rejoinPlatform,
            primitives: level.primitives || [],
          });
          if (!exitValidation.valid) {
            throw new Error('drop-rejoin-unreachable');
          }

          const optionalPlatforms = [
            ...access.platforms,
            mandatoryEntry.platform,
            ...connectorResults.flatMap(result => result.platforms),
            ...moduleResults.flatMap(entry => entry.result.platforms),
          ];
          const moduleTopBounds = moduleResults.map(({ result }) => result.occupiedBounds?.top).filter(Number.isFinite);
          const moduleBottomBounds = moduleResults.map(({ result }) => result.occupiedBounds?.bottom).filter(Number.isFinite);

          const occupiedBounds = {
            left: Math.min(...optionalPlatforms.map(platform => platform.x)),
            right: Math.max(...optionalPlatforms.map(platform => platform.x + platform.w)),
            top: Math.min(
              ...optionalPlatforms.map(platform => platform.y),
              ...moduleTopBounds,
            ),
            bottom: Math.max(
              ...optionalPlatforms.map(platform => platform.y + platform.h),
              ...moduleBottomBounds,
            ),
            startLogicIndex: plan.startLogicIndex,
            endLogicIndex: plan.endLogicIndex,
            rejoinLogicIndex: plan.endLogicIndex,
            authoredEncounterSpacing: plan.authoredEncounterSpacing,
            reservedThroughLogicIndex:
              plan.endLogicIndex + plan.authoredEncounterSpacing,
          };
          const modules = [
            moduleRecord(AZO_LATERAL_ACCESS_MODULE, access),
            ...moduleResults.map(({ module, result }) => moduleRecord(module, result)),
            moduleRecord(DROP_REJOIN_MODULE, exit),
          ];
          const position = phosphateResult ? phosphatePositionClass(
            phosphateResult.phosphateCenterX,
            actualCentralStartX,
            centralEndX,
          ) : null;
          const connectorPlatformIds = connectorResults
            .flatMap(result => result.platforms.map(platform => platform.platformId));
          const detour = {
            id: plan.id,
            phase: 10,
            seedValue,
            candidateId: candidate.id,
            candidateCount: candidates.length,
            candidateSoftScore: candidate.softScore,
            candidateSoftWarnings: [...candidate.softWarnings],
            compositionId: `${candidate.id}:b15:${sequence.id}:${phosphateVariant}`,
            compositionAttempts: attempts,
            compositionFallback: false,
            compositionFallbackReason: null,
            attemptedCandidateIds: [...attemptedCandidateIds],
            startLogicIndex: plan.startLogicIndex,
            endLogicIndex: plan.endLogicIndex,
            startPlatformId: plan.startPlatformId,
            preEntryPlatformId: plan.preEntryPlatformId,
            rejoinPlatformId: plan.rejoinPlatformId,
            targetScreenCount: plan.targetScreenCount,
            requestedScreenCount: plan.requestedScreenCount,
            actualWorldSpan: plan.actualWorldSpan,
            centralWorldSpan: centralEndX - actualCentralStartX,
            centralStartX: actualCentralStartX,
            centralEndX,
            primaryProfile: plan.primaryProfile,
            primaryProfileValid: plan.primaryProfileValid,
            primaryRouteGeometryHashBefore: plan.primaryRouteGeometryHashBefore,
            accessLandingId: context.accessPlatform.platformId,
            mandatoryComboEntryPlatformId: mandatoryEntry.platform.platformId,
            accessLandingX: accessLanding.x,
            accessLandingY: accessLanding.y,
            accessHorizontalAdvance: accessLanding.horizontalAdvance,
            accessVerticalRise: accessLanding.verticalRise,
            accessVisibleAtZoom1: accessLanding.visibility.zoom1.visible,
            accessVisibleAtZoom145: accessLanding.visibility.zoom145.visible,
            accessJetpackAccessible: accessLanding.jetpackAccessible,
            accessSimpleJumpAccessible: accessLanding.simpleJumpAccessible,
            accessModuleId: AZO_LATERAL_ACCESS_MODULE.id,
            challengeModuleIds: sequence.modules,
            selectedSequenceId: sequence.id,
            selectedSequence: [...sequence.modules],
            slotAllocation: allocation,
            availableSpan: allocation.availableSpan,
            minimumSequenceSpan: allocation.minimumSequenceSpan,
            maximumSequenceSpan: allocation.maximumSequenceSpan,
            unusedSpan: allocation.unusedSpan,
            leadingMargin: allocation.leadingMargin,
            trailingMargin: allocation.trailingMargin,
            moduleResults: moduleResults.map(({ module, result, slot }) => ({
              moduleId: module.id,
              moduleInstanceId: result.moduleInstanceId
                || `${module.id}-${slot.slotIndex}`,
              slotIndex: slot.slotIndex,
              slotLeft: slot.slotLeft,
              slotRight: slot.slotRight,
              allocatedSpan: slot.allocatedSpan,
              entryPlatformId: result.entrySocket.platformId,
              exitPlatformId: result.exitSocket.platformId,
              platformIds: result.platforms.map(platform => platform.platformId),
            })),
            exitModuleId: DROP_REJOIN_MODULE.id,
            modules,
            moduleFamilies: modules.map(module => module.family),
            moduleFamilyCount: new Set(modules.map(module => module.family)).size,
            biologicalModuleCount: moduleResults.filter(m => m.module.kind === 'biological-gate' || m.module.kind === 'biological-gap').length,
            primaryRecapCount: 0,
            optionalPlatformIds: optionalPlatforms.map(platform => platform.platformId),
            connectorPlatformIds,
            connectorEdges: [
              mandatoryEntry.edge,
              ...connectorResults.flatMap(result => result.edges),
            ],
            connectorCount: connectorPlatformCount,
            connectorPlatformCount,
            maximumConnectorChainLength,
            structureIds: [],
            contentRequestIds: contentRequests.map(request => request.id),
            ...(phosphateResult ? {
              phosphateDepositId: `${plan.id}:phosphate-deposit:${phosphateResult.phosphateSlotIndex || 0}`,
              bacillusColonyId: `${plan.id}:bacillus:${phosphateResult.phosphateSlotIndex || 0}`,
              phosphateGateVariant: phosphateResult.phosphateVariant,
              phosphateGateSlotIndex: phosphateResult.phosphateSlotIndex,
              phosphatePositionRatio: position?.ratio,
              phosphatePositionClass: position?.className,
              phosphateGateSpan: phosphateResult.occupiedBounds.right - phosphateResult.occupiedBounds.left,
              phosphateGateEntrySocket: phosphateResult.entrySocket,
              phosphateGateExitSocket: phosphateResult.exitSocket,
              phosphateGateOccupiedBounds: phosphateResult.occupiedBounds,
              phosphateGateDepositBounds: phosphateResult.depositBounds,
            } : {}),
            ...(mycorrhizaResult ? {
              mycorrhizaModuleCount: moduleResults.filter(m => m.module.id === HARD_MYCORRHIZA_GAP_MODULE.id).length,
              mycorrhizaVariant: mycorrhizaResult.mycorrhizaVariant,
              mycorrhizaGapWidth: mycorrhizaResult.mycorrhizaGapWidth,
              mycorrhizaVerticalDelta: mycorrhizaResult.mycorrhizaVerticalDelta,
              mycorrhizaSourcePlatformId: mycorrhizaResult.mycorrhizaSourcePlatformId,
              mycorrhizaTargetPlatformId: mycorrhizaResult.mycorrhizaTargetPlatformId,
              regularTraversalBlocked: mycorrhizaResult.regularTraversalBlocked,
            } : {}),
            intentionalGaps: moduleResults.flatMap(({ result }) => result.intentionalGaps || []),
            optionalDetourReservedBounds: occupiedBounds,
            towerSuppressedForOptionalDetourPlaytest: Boolean(
              level.traversalEncounterStats?.towerSuppressedForOptionalDetourPlaytest,
            ),
            implementationStage: 'B2',
            structuralSignature: {
              sequenceId: sequence.id,
              sequence: [...sequence.modules],
              slots: allocation.slots.map(slot => ({
                moduleId: slot.moduleId,
                slotIndex: slot.slotIndex,
                allocatedSpan: Math.round(slot.allocatedSpan),
              })),
              phosphateVariant: phosphateResult?.phosphateVariant || null,
              phosphateSlotIndex: phosphateResult?.phosphateSlotIndex ?? null,
              phosphatePositionClass: position?.className || null,
              mycorrhizaVariant: mycorrhizaResult?.mycorrhizaVariant || null,
              mycorrhizaSlotIndex: mycorrhizaResult?.mycorrhizaSlotIndex ?? null,
              movementModuleCount: sequence.modules
                .filter(moduleId => moduleId === HARD_MOVEMENT_COMBO_MODULE.id).length,
              minimumSequenceSpan: Math.round(allocation.minimumSequenceSpan),
              maximumSequenceSpan: Math.round(allocation.maximumSequenceSpan),
              unusedSpan: Math.round(allocation.unusedSpan),
              leadingMargin: Math.round(allocation.leadingMargin),
              trailingMargin: Math.round(allocation.trailingMargin),
              connectorPlatformCount,
              maximumConnectorChainLength,
              mandatoryEntryComboOnly: null,
              movementDeclaredEdgesValid: null,
            },
          };
          level.optionalDetourReservedBounds = [
            ...(level.optionalDetourReservedBounds || []),
            occupiedBounds,
          ];
          level.optionalDetours = [...(level.optionalDetours || []), detour];
          const materialized = materializeOptionalDetourContent({
            level,
            detour,
            contentRequests,
            random,
          });
          if (materialized.failures.length) {
            throw new Error(materialized.failures.join(','));
          }
          if (phosphateResult) {
            detour.phosphateDepositId = materialized.deposits[0]?.id || null;
            detour.bacillusColonyId =
              materialized.authoredColonies[0]?.id || null;
            detour.phosphateDepositInitialState = materialized.deposits[0]?.broken
              ? 'open'
              : 'blocked';
          }
          detour.primaryRouteGeometryHashAfter = primaryRouteGeometryHash(level);
          detour.validation = validateOptionalDetour(level, detour);
          detour.structuralSignature.mandatoryEntryComboOnly =
            detour.validation.mandatoryEntryComboOnly;
          detour.structuralSignature.movementDeclaredEdgesValid =
            detour.validation.movementDeclaredEdgesValid;
          sequenceAttempt.validation = detour.validation;
          if (!detour.validation.valid) {
            throw new Error(detour.validation.failures.join(','));
          }
          return compositionResult(detour, attempts);
        } catch (error) {
          sequenceAttempt.failures.push(error.message);
          candidateAttempt.failures.push(
            `${sequence.id}:${phosphateVariant}:${error.message}`,
          );
          rollback(level, baseline, plan);
        }
      }
    }
  }

  return {
    success: false,
    candidateId: null,
    compositionId: null,
    modules: [],
    platforms: [],
    structures: [],
    connectors: [],
    contentRequests: [],
    validation: null,
    attempts,
    failureReasons: attempts.flatMap(attempt => attempt.failures),
    compositionFallback: false,
    attemptedCandidateIds,
  };
}

export function createPhaseTenOptionalDetour({
  level,
  phase,
  seedValue,
  abilities = ['doubleJump', 'dash', 'phosphateSolubilization'],
} = {}) {
  level.optionalDetours = [];
  if (phase !== 10) return null;
  const collected = collectOptionalDetourCandidates({
    level,
    phase,
    seedValue,
    abilities,
  });
  level.optionalDetourCandidateDiagnostics = collected.diagnostics;
  const composition = composeOptionalDetour({
    level,
    candidates: collected.candidates,
    seedValue,
    abilities,
  });
  level.optionalDetourComposition = composition;
  if (composition.success) return composition.detour;

  const fallbackCandidate = collected.candidates.find(candidate => (
    !candidate.hardFailures.length
  ));
  if (!fallbackCandidate) {
    level.optionalDetourComposition = {
      ...composition,
      compositionFallback: true,
      compositionFallbackReason: 'no-viable-candidate-for-scaffold',
    };
    return null;
  }
  const fallback = buildOptionalDetour(
    level,
    planFromCandidate(level, fallbackCandidate, seedValue),
  );
  if (fallback) {
    fallback.compositionFallback = true;
    fallback.compositionFallbackReason =
      composition.failureReasons.join('|') || 'b15-composition-failed';
    fallback.attemptedCandidateIds = composition.attemptedCandidateIds;
    fallback.attemptedCompositions = composition.attempts;
    fallback.candidateCount = collected.candidates.length;
    fallback.candidateSoftScore = fallbackCandidate.softScore;
    fallback.candidateSoftWarnings = [...fallbackCandidate.softWarnings];
  }
  level.optionalDetourComposition = {
    ...composition,
    compositionFallback: true,
    compositionFallbackReason: fallback?.compositionFallbackReason,
    detour: fallback,
  };
  return fallback;
}
