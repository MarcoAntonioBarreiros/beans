import { canTraverseEdge } from './traversal-edge-physics.js';
import {
  getOptionalDetourPlatforms,
  getPrimaryTraversalPlatforms,
} from './traversal-route.js';
import { primaryRouteGeometryHash } from './optional-detour-planner.js';
import { HARD_MOVEMENT_RECIPES } from './optional-detour-modules.js';

function overlapsHorizontally(left, right, margin = 0) {
  return left.x < right.x + right.w + margin
    && left.x + left.w > right.x - margin;
}

function validatePhosphateGate(level, detour) {
  const failures = [];
  const primary = getPrimaryTraversalPlatforms(level);
  const optional = getOptionalDetourPlatforms(level, detour.id);
  const hashAfter = primaryRouteGeometryHash(level);
  const hashEqual = hashAfter === detour.primaryRouteGeometryHashBefore;
  if (!hashEqual) failures.push('primaryRouteGeometryChanged');

  const hasPhosphate = detour.challengeModuleIds?.includes('hard-phosphate-gate');
  const hasMycorrhiza = detour.challengeModuleIds?.includes('hard-mycorrhiza-gap');

  let deposit = null;
  let colony = null;
  let depositBounds = null;
  let crossingPlatforms = [];
  let connectorInvadesDeposit = false;
  let mainRouteBlocked = false;

  if (hasPhosphate) {
    deposit = (level.phosphateDeposits || []).find(candidate => (
      candidate.id === detour.phosphateDepositId
      || (
        candidate.optionalDetourId === detour.id
        && candidate.detourModuleId === 'hard-phosphate-gate'
      )
    ));
    colony = (level.authoredBeneficialColonies || []).find(candidate => (
      candidate.id === detour.bacillusColonyId
      || (
        candidate.optionalDetourId === detour.id
        && candidate.detourModuleId === 'hard-phosphate-gate'
        && candidate.type === 'bacillus'
      )
    ));
    if (!deposit) failures.push('missingPhosphateDeposit');
    if (deposit && deposit.detourModuleId !== 'hard-phosphate-gate') {
      failures.push('depositOutsidePhosphateModule');
    }
    if (deposit?.broken !== false || Number(deposit?.remainingPhosphate) <= 0) {
      failures.push('depositNotInitiallyBlocked');
    }
    if (!colony) failures.push('missingAuthoredBacillus');
    if (deposit && colony && colony.x >= deposit.x) {
      failures.push('bacillusAfterDeposit');
    }
    if (
      deposit
      && (
        !deposit.phosphateDeposit
        || deposit.requiredFeature !== 'phosphateSolubilization'
      )
    ) {
      failures.push('depositNotAffectedBySolubilization');
    }

    depositBounds = detour.phosphateGateDepositBounds;
    crossingPlatforms = depositBounds
      ? optional.filter(platform => (
          platform.x < depositBounds.right
          && platform.x + platform.w > depositBounds.left
          && platform.y < depositBounds.bottom - 2
          && platform.y + platform.h > depositBounds.top + 2
        ))
      : [];
    if (crossingPlatforms.length) failures.push('platformCrossesDeposit');

    const connectorPlatforms = optional.filter(platform => (
      (detour.connectorPlatformIds || []).includes(platform.platformId)
    ));
    connectorInvadesDeposit = depositBounds && connectorPlatforms.some(platform => (
      platform.x < depositBounds.right
      && platform.x + platform.w > depositBounds.left
      && platform.y < depositBounds.bottom
      && platform.y + platform.h > depositBounds.top
    ));
    if (connectorInvadesDeposit) failures.push('connectorInvadesDeposit');

    mainRouteBlocked = deposit
      ? primary.some(platform => (
          platform.x < deposit.x + deposit.w
          && platform.x + platform.w > deposit.x
          && platform.y < deposit.y + deposit.h
          && platform.y + platform.h > deposit.y
        ))
      : false;
    if (mainRouteBlocked) failures.push('phosphateGateBlocksPrimaryRoute');
  }

  if (hasMycorrhiza) {
    const mycoSource = optional.find(p => p.mycorrhizaBridgeSource);
    const mycoTarget = optional.find(p => p.mycorrhizaBridgeTarget);
    if (!mycoSource || !mycoTarget) {
      failures.push('missingMycorrhizaPlatforms');
    } else {
      if (mycoSource.type !== 'root' || mycoTarget.type !== 'root') {
        failures.push('mycorrhizaPlatformsNotRoots');
      }
      if (mycoSource.preferredMycorrhizaTargetId !== mycoTarget.platformId) {
        failures.push('mycorrhizaTargetMismatch');
      }
      if (mycoSource.strictPreferredMycorrhizaTarget !== true) {
        failures.push('strictPreferredMycorrhizaTargetNotSet');
      }
      if (Math.abs(mycoTarget.y - mycoSource.y) > 68) {
        failures.push('mycorrhizaVerticalDeltaExceeded');
      }
    }

    const gap = (detour.intentionalGaps || []).find(g => g.kind === 'mycorrhiza-bridge-gap')
      || (level.optionalDetours || []).flatMap(d => d.intentionalGaps || []).find(g => g.kind === 'mycorrhiza-bridge-gap');
    if (!gap) {
      failures.push('missingMycorrhizaGap');
    } else if (gap.bounds) {
      const gapPlatform = optional.find(p => (
        p.x < gap.bounds.right && p.x + p.w > gap.bounds.left &&
        p.y < gap.bounds.bottom && p.y + p.h > gap.bounds.top
      ));
      if (gapPlatform) failures.push('platformInsideMycorrhizaGap');
    }

    if (detour.regularTraversalBlocked !== true) {
      failures.push('regularTraversalNotBlocked');
    }

    const mycoEncounter = (level.authoredEncounters || []).find(e => (
      e.id === 'myco' && e.optionalDetourId === detour.id
    ));
    if (!mycoEncounter) failures.push('missingAuthoredMycoEncounter');

    const moduleExudates = (level.exudates || []).filter(e => (
      e.optionalDetourId === detour.id && e.detourModuleId === 'hard-mycorrhiza-gap'
    ));
    if (moduleExudates.length < 2) failures.push('insufficientModuleExudates');

    const matureMycoColony = (level.authoredBeneficialColonies || []).find(c => (
      c.type === 'myco' && c.optionalDetourId === detour.id
    ));
    if (matureMycoColony) failures.push('authoredMatureMycoColonyCreated');

    const readyBridges = (level.platforms || []).filter(p => p.mycorrhizaStructure);
    if (readyBridges.length > 0) failures.push('prebuiltMycorrhizaBridgePresent');
  }

  const mandatoryEntry = optional.find(platform => (
    platform.platformId === detour.mandatoryComboEntryPlatformId
  ));
  const rejoin = primary.find(platform => (
    (platform.platformId || platform.id) === detour.rejoinPlatformId
  ));
  const allPrimitives = level.primitives || [];
  const moduleResults = detour.moduleResults || [];
  const firstModuleEntry = optional.find(platform => (
    platform.platformId === moduleResults[0]?.entryPlatformId
  ));
  const lastModuleExit = optional.find(platform => (
    platform.platformId === moduleResults.at(-1)?.exitPlatformId
  ));
  const connectorEdgesValid = (detour.connectorEdges || []).every(edge => (
    edge.direct === true || edge.valid === true
  ));
  const entryReachable = connectorEdgesValid
    && Boolean(mandatoryEntry)
    && Boolean(firstModuleEntry);
  const exitEdge = lastModuleExit && rejoin
    ? canTraverseEdge({ from: lastModuleExit, to: rejoin, primitives: allPrimitives })
    : { valid: false };
  if (!entryReachable) failures.push('entrySocketUnreachable');
  if (!exitEdge.valid) failures.push('exitSocketUnreachableAfterResolution');

  const access = optional.find(platform => (
    platform.platformId === detour.accessLandingId
  ));
  const normalPrimitives = allPrimitives.filter(primitive => (
    !(primitive.requires || []).length
  ));
  const doubleJumpOnlyPrimitives = allPrimitives.filter(primitive => (
    (primitive.requires || []).includes('doubleJump')
    && !(primitive.requires || []).includes('dash')
  ));
  const dashOnlyPrimitives = allPrimitives.filter(primitive => (
    (primitive.requires || []).includes('dash')
    && !(primitive.requires || []).includes('doubleJump')
  ));
  const comboPrimitives = allPrimitives.filter(primitive => (
    primitive.id === 'running-double-jump-dash'
  ));
  const mandatoryEntryComboOnly = Boolean(access && mandatoryEntry)
    && !canTraverseEdge({
      from: access,
      to: mandatoryEntry,
      primitives: normalPrimitives,
    }).valid
    && !canTraverseEdge({
      from: access,
      to: mandatoryEntry,
      primitives: doubleJumpOnlyPrimitives,
    }).valid
    && !canTraverseEdge({
      from: access,
      to: mandatoryEntry,
      primitives: dashOnlyPrimitives,
    }).valid
    && canTraverseEdge({
      from: access,
      to: mandatoryEntry,
      primitives: comboPrimitives,
    }).valid;
  if (!mandatoryEntryComboOnly) failures.push('mandatoryEntryNotComboOnly');

  const expectedSequence = detour.selectedSequence || [];
  const actualSequence = moduleResults.map(result => result.moduleId);
  if (JSON.stringify(expectedSequence) !== JSON.stringify(actualSequence)) {
    failures.push('moduleOrderMismatch');
  }

  let minGap = Infinity;
  let overlapCount = 0;
  const approachEdges = [];
  let everyApproachEdgeValid = true;

  if (hasPhosphate) {
    const approachPlatforms = optional.filter(p => p.optionalDetourSection === 'phosphate-approach');
    const allowedPrimitiveIds = ['running-double-jump-early', 'running-double-jump-late', 'running-double-jump-dash'];
    const approachPrimitives = (level.primitives || []).filter(primitive => allowedPrimitiveIds.includes(primitive.id));
    
    approachPlatforms.sort((a, b) => a.x - b.x);

    for (let i = 0; i < approachPlatforms.length - 1; i++) {
      const p1 = approachPlatforms[i];
      const p2 = approachPlatforms[i + 1];
      const gap = p2.x - (p1.x + p1.w);
      
      if (gap < minGap) minGap = gap;
      if (gap < 0) overlapCount++;

      const edgeValid = canTraverseEdge({
        from: p1,
        to: p2,
        primitives: approachPrimitives,
      }).valid;
      
      approachEdges.push({ from: p1.id, to: p2.id, valid: edgeValid, gap });
      if (!edgeValid) everyApproachEdgeValid = false;
    }

    if (approachPlatforms.length > 1) {
      if (minGap < 70) failures.push('phosphateApproachGapTooSmall');
      if (overlapCount > 0) failures.push('phosphateApproachOverlap');
      if (!everyApproachEdgeValid) failures.push('phosphateApproachInvalidEdge');
    }
  }

  if (hasPhosphate && actualSequence.filter(id => id === 'hard-phosphate-gate').length !== 1) {
    failures.push('invalidPhosphateModuleCount');
  }
  if (hasMycorrhiza && actualSequence.filter(id => id === 'hard-mycorrhiza-gap').length !== 1) {
    failures.push('invalidMycorrhizaModuleCount');
  }
  const phosphateResult = moduleResults.find(result => (
    result.moduleId === 'hard-phosphate-gate'
  ));
  const phosphatePlatforms = optional.filter(platform => (
    platform.detourModuleId === 'hard-phosphate-gate'
  ));
  const phosphateInsideSlot = !hasPhosphate || (Boolean(phosphateResult)
    && phosphatePlatforms.every(platform => (
      platform.x >= phosphateResult.slotLeft - 1
      && platform.x + platform.w <= phosphateResult.slotRight + 1
    )));
  if (hasPhosphate && !phosphateInsideSlot) failures.push('phosphateOutsideAllocatedSlot');
  const slotOrderValid = moduleResults.every((result, index) => (
    result.slotIndex === index
    && (
      index === 0
      || result.slotLeft >= moduleResults[index - 1].slotRight
    )
  ));
  if (!slotOrderValid) failures.push('moduleSlotsOverlapOrReorder');

  const movementModules = moduleResults.filter(result => (
    result.moduleId === 'hard-movement-combo'
  ));
  let invalidDeclaredMovementEdgeCount = 0;
  const movementEdgesValid = movementModules.every(result => {
    const route = result.platformIds
      .map(platformId => optional.find(platform => platform.platformId === platformId))
      .filter(Boolean);
    return route.length >= 3 && route.slice(1).every((platform, index) => (
      canTraverseEdge({
        from: route[index],
        to: platform,
        primitives: allPrimitives,
      }).valid
    ));
  });
  const movementDeclaredEdgesValid = movementModules.every(result => {
    const route = result.platformIds
      .map(platformId => optional.find(platform => platform.platformId === platformId))
      .filter(Boolean);
    if (route.length < 3) return false;
    return route.slice(1).every((platform, index) => {
      const allowedIds = new Set(platform.allowedPrimitiveIds || []);
      const declaredPrimitives = allPrimitives.filter(primitive => (
        allowedIds.has(primitive.id)
      ));
      const valid = declaredPrimitives.length > 0 && canTraverseEdge({
        from: route[index],
        to: platform,
        primitives: declaredPrimitives,
      }).valid;
      if (!valid) invalidDeclaredMovementEdgeCount++;
      return valid;
    });
  });
  if (movementModules.length > 0 && !movementEdgesValid) failures.push('invalidMovementModuleEdge');
  if (movementModules.length > 0 && !movementDeclaredEdgesValid) {
    failures.push('invalidDeclaredMovementModuleEdge');
  }

  const sequenceSpanCompatible = Number(detour.minimumSequenceSpan)
      <= Number(detour.availableSpan)
    && Number(detour.availableSpan)
      <= Number(detour.maximumSequenceSpan) + 650;
  if (!sequenceSpanCompatible) failures.push('sequenceSpanIncompatible');
  if (Number(detour.unusedSpan) > 650) failures.push('unusedSpanExceedsLimit');
  if (!Number.isFinite(detour.leadingMargin)) failures.push('missingLeadingMargin');
  if (!Number.isFinite(detour.trailingMargin)) failures.push('missingTrailingMargin');
  if (Number(detour.connectorPlatformCount) > 4) {
    failures.push('totalConnectorLimitExceeded');
  }
  if (Number(detour.maximumConnectorChainLength) > 2) {
    failures.push('connectorChainLimitExceeded');
  }

  return {
    valid: failures.length === 0,
    failures,
    primaryRouteGeometryHashBefore: detour.primaryRouteGeometryHashBefore,
    primaryRouteGeometryHashAfter: hashAfter,
    primaryRouteGeometryUnchanged: hashEqual,
    optionalPlatformCount: optional.length,
    platformsByModule: optional.reduce((counts, platform) => {
      counts[platform.detourModuleId] =
        (counts[platform.detourModuleId] || 0) + 1;
      return counts;
    }, {}),
    phosphateGate: hasPhosphate ? {
      depositExists: Boolean(deposit),
      depositBlocked: deposit?.broken === false,
      depositId: deposit?.id || null,
      bacillusExists: Boolean(colony),
      bacillusBeforeDeposit: Boolean(deposit && colony && colony.x < deposit.x),
      entrySocketReachable: entryReachable,
      exitSocketReachable: exitEdge.valid,
      connectorInvadesDeposit: Boolean(connectorInvadesDeposit),
      platformCrossingCount: crossingPlatforms.length,
      primaryRouteBlocked: mainRouteBlocked,
      phosphateApproachMinimumGap: minGap,
      phosphateApproachOverlapCount: overlapCount,
      phosphateApproachEdgeCount: approachEdges.length,
      phosphateApproachEdgesValid: everyApproachEdgeValid,
    } : null,
    moduleOrderValid:
      JSON.stringify(expectedSequence) === JSON.stringify(actualSequence),
    phosphateInsideSlot,
    slotOrderValid,
    movementEdgesValid,
    movementDeclaredEdgesValid,
    invalidDeclaredMovementEdgeCount,
    connectorEdgesValid,
    mandatoryEntryComboOnly,
    sequenceSpanCompatible,
    unusedSpan: detour.unusedSpan,
    leadingMargin: detour.leadingMargin,
    trailingMargin: detour.trailingMargin,
    connectorPlatformCount: detour.connectorPlatformCount,
    maximumConnectorChainLength: detour.maximumConnectorChainLength,
  };
}

function clearanceViolations(level, detour, minimumClearance = 210) {
  const primary = getPrimaryTraversalPlatforms(level)
    .filter(platform => (
      platform.logicIndex >= detour.startLogicIndex
      && platform.logicIndex <= detour.endLogicIndex
    ));
  const optional = getOptionalDetourPlatforms(level, detour.id);
  const violations = [];
  for (const upper of optional) {
    for (const lower of primary) {
      if (!overlapsHorizontally(upper, lower, 6)) continue;
      const clearance = lower.y - (upper.y + upper.h);
      if (clearance >= minimumClearance) continue;
      violations.push({
        optionalPlatformId: upper.platformId,
        primaryPlatformId: lower.platformId,
        clearance,
      });
    }
  }
  return violations;
}

function movementValidation(level, detour) {
  const modulePlatforms = getOptionalDetourPlatforms(level, detour.id)
    .filter(platform => platform.detourModuleId === 'hard-movement-combo');
  const access = getOptionalDetourPlatforms(level, detour.id)
    .find(platform => platform.detourModuleId === 'azo-lateral-access');
  const route = [access, ...modulePlatforms].filter(Boolean);
  const recipes = new Map(HARD_MOVEMENT_RECIPES.map(recipe => [recipe.id, recipe]));
  const normal = (level.primitives || []).filter(primitive => !(primitive.requires || []).length);
  const doubleJumpOnly = (level.primitives || []).filter(primitive => (
    (primitive.requires || []).includes('doubleJump')
    && !(primitive.requires || []).includes('dash')
  ));
  const dashOnly = (level.primitives || []).filter(primitive => (
    (primitive.requires || []).includes('dash')
    && !(primitive.requires || []).includes('doubleJump')
  ));
  const combo = (level.primitives || []).filter(primitive => (
    primitive.id === 'running-double-jump-dash'
  ));
  const edges = [];
  for (let index = 1; index < route.length; index++) {
    const from = route[index - 1];
    const to = route[index];
    const recipe = recipes.get(to.movementRecipeId);
    const allowedIds = new Set(recipe?.allowedPrimitiveIds || []);
    const allowedPrimitives = (level.primitives || [])
      .filter(primitive => allowedIds.has(primitive.id));
    const declaredResult = canTraverseEdge({
      from,
      to,
      primitives: allowedPrimitives,
    });
    const normalResult = canTraverseEdge({ from, to, primitives: normal });
    const doubleJumpResult = canTraverseEdge({
      from,
      to,
      primitives: doubleJumpOnly,
    });
    const dashResult = canTraverseEdge({ from, to, primitives: dashOnly });
    const comboResult = canTraverseEdge({ from, to, primitives: combo });
    const comboOnly = !normalResult.valid
      && !doubleJumpResult.valid
      && !dashResult.valid
      && comboResult.valid;
    edges.push({
      fromPlatformId: from.platformId,
      toPlatformId: to.platformId,
      movementRecipeId: to.movementRecipeId || null,
      declaredRequiredAbilities: [...(recipe?.requiredAbilities || [])],
      allowedPrimitiveIds: [...(recipe?.allowedPrimitiveIds || [])],
      validatedPrimitiveId: declaredResult.passingPrimitiveIds[0] || null,
      gap: declaredResult.gap,
      rise: declaredResult.rise,
      drop: declaredResult.drop,
      verticalDeltaY: to.y - from.y,
      verticalIntent: to.verticalIntent || recipe?.verticalIntent || null,
      section: to.optionalDetourSection || null,
      valid: Boolean(recipe && declaredResult.valid),
      normalValid: normalResult.valid,
      doubleJumpOnlyValid: doubleJumpResult.valid,
      dashOnlyValid: dashResult.valid,
      comboValid: comboResult.valid,
      comboOnly,
    });
  }
  const cruiseEdges = edges.filter(edge => edge.section === 'cruise');
  const cruisePlatforms = modulePlatforms
    .filter(platform => platform.optionalDetourSection === 'cruise');
  const firstCruiseIndex = route.findIndex(platform => (
    platform.optionalDetourSection === 'cruise'
  ));
  const cruiseOrigin = firstCruiseIndex > 0 ? route[firstCruiseIndex - 1] : null;
  const cruiseYSequence = [
    ...(cruiseOrigin ? [cruiseOrigin.y] : []),
    ...cruisePlatforms.map(platform => platform.y),
  ];
  const cruiseVerticalAmplitude = cruiseYSequence.length
    ? Math.max(...cruiseYSequence) - Math.min(...cruiseYSequence)
    : 0;
  const hardYSequence = route.map(platform => platform.y);
  const hardVerticalAmplitude = hardYSequence.length
    ? Math.max(...hardYSequence) - Math.min(...hardYSequence)
    : 0;
  const perceptibleThreshold = 28;
  const ascentCount = cruiseEdges
    .filter(edge => edge.verticalDeltaY <= -perceptibleThreshold).length;
  const descentCount = cruiseEdges
    .filter(edge => edge.verticalDeltaY >= perceptibleThreshold).length;
  const nearHorizontalCount = cruiseEdges
    .filter(edge => Math.abs(edge.verticalDeltaY) < perceptibleThreshold).length;
  const everyEdgeValid = edges.length > 0 && edges.every(edge => edge.valid);
  const comboOnlyEdgeCount = edges.filter(edge => edge.comboOnly).length;
  const hardClimbCount = edges
    .filter(edge => edge.verticalDeltaY <= -perceptibleThreshold).length;
  const hardDropCount = edges
    .filter(edge => edge.verticalDeltaY >= perceptibleThreshold).length;
  const firstEdgeComboOnly = edges[0]?.comboOnly === true;
  return {
    edges,
    everyEdgeValid,
    comboOnlyEdgeCount,
    invalidEdgeCount: edges.filter(edge => !edge.valid).length,
    ySequence: route.map(platform => platform.y),
    hardYSequence,
    hardVerticalAmplitude,
    hardClimbCount,
    hardDropCount,
    firstEdgeComboOnly,
    cruiseYSequence,
    cruiseVerticalAmplitude,
    ascentCount,
    descentCount,
    nearHorizontalCount,
    cruiseEdgeCount: cruiseEdges.length,
    verticalDiversityValid: hardClimbCount > 0
      && hardDropCount > 0
      && hardVerticalAmplitude >= 180,
  };
}

export function validateOptionalDetour(level, detour) {
  if (!detour) return { valid: false, failures: ['missingDetour'] };
  if (
    detour.challengeModuleIds?.includes('hard-phosphate-gate')
    || detour.challengeModuleIds?.includes('hard-mycorrhiza-gap')
  ) {
    return validatePhosphateGate(level, detour);
  }
  const primary = getPrimaryTraversalPlatforms(level);
  const optional = getOptionalDetourPlatforms(level, detour.id);
  const primaryIds = new Set(primary.map(platform => platform.platformId ?? platform.id));
  const failures = [];
  const hashAfter = primaryRouteGeometryHash(level);
  const hashEqual = hashAfter === detour.primaryRouteGeometryHashBefore;
  if (!hashEqual) failures.push('primaryRouteGeometryChanged');
  if (!primaryIds.has(detour.startPlatformId)) failures.push('startNotPrimary');
  if (!primaryIds.has(detour.rejoinPlatformId)) failures.push('rejoinNotPrimary');
  if (!optional.length) failures.push('missingOptionalPlatforms');

  const accessPlatforms = optional.filter(platform => platform.detourModuleId === 'azo-lateral-access');
  const movementPlatforms = optional.filter(platform => platform.detourModuleId === 'hard-movement-combo');
  const transitionPlatforms = movementPlatforms
    .filter(platform => platform.optionalDetourSection === 'transition');
  const cruisePlatforms = movementPlatforms
    .filter(platform => platform.optionalDetourSection === 'cruise');
  if (accessPlatforms.length !== 1) failures.push('invalidAzoAccessPlatformCount');
  if (!movementPlatforms.length) failures.push('missingMovementPlatforms');
  if (movementPlatforms.some(platform => platform.w > 290)) {
    failures.push('oversizedMovementPlatform');
  }
  const authoredRequest = (level.authoredAzospirillumLadderRequests || [])
    .some(request => (
      request.optionalDetourId === detour.id
      && request.hostPlatformId === detour.startPlatformId
      && request.destinationPlatformId === accessPlatforms[0]?.platformId
    ));
  if (!authoredRequest) failures.push('missingAuthoredAzoRequest');
  if (!detour.accessVisibleAtZoom1) failures.push('accessNotVisibleAtZoom1');
  if (!detour.accessVisibleAtZoom145) failures.push('accessNotVisibleAtZoom145');
  if (!detour.accessJetpackAccessible) failures.push('accessOutsideJetpackEnvelope');
  if (detour.accessSimpleJumpAccessible) failures.push('accessReachableBySimpleJump');
  if (detour.targetScreenCount < 3 || detour.targetScreenCount > 6) {
    failures.push('invalidScreenCount');
  }
  if (!detour.primaryProfileValid) failures.push('invalidPrimaryProfile');
  if (detour.prematureConvergenceCount > 0) failures.push('prematureRouteConvergence');
  if (detour.minimumPreRejoinSeparation < 270) {
    failures.push('insufficientPreRejoinSeparation');
  }

  const clearance = clearanceViolations(level, detour);
  if (clearance.length) failures.push('primaryRouteClearance');
  const movement = movementValidation(level, detour);
  if (!movement.everyEdgeValid) failures.push('invalidMovementEdge');
  if (!movement.firstEdgeComboOnly) failures.push('firstEdgeNotComboOnly');
  if (!movement.verticalDiversityValid) failures.push('insufficientCruiseVerticalDiversity');

  const lastHardPlatform = movementPlatforms.at(-1);
  const rejoin = primary.find(platform => (
    (platform.platformId ?? platform.id) === detour.rejoinPlatformId
  ));
  const dropColumnOccupied = optional.some(platform => (
    platform !== lastHardPlatform
    && platform.x < rejoin.x + rejoin.w
    && platform.x + platform.w > lastHardPlatform.x
    && platform.y > lastHardPlatform.y
    && platform.y < rejoin.y
  ));
  if (dropColumnOccupied) failures.push('dropColumnOccupied');

  const transitionGradual = transitionPlatforms.length > 0
    && transitionPlatforms.every((platform, index) => {
      const previous = index === 0 ? accessPlatforms[0] : transitionPlatforms[index - 1];
      return Math.abs(platform.y - previous.y) <= 180;
    });
  if (!transitionGradual) failures.push('missingGradualTransition');
  const upperSpan = movementPlatforms.length
    ? movementPlatforms.at(-1).x + movementPlatforms.at(-1).w - accessPlatforms[0].x
    : 0;
  if (upperSpan < 2 * 1280) failures.push('upperRouteTooShort');

  const towerPlatforms = (level.platforms || []).filter(platform => (
    platform.traversalEncounterId === 'tower-safe-fall-01'
    || platform.encounterInstanceId?.includes('tower-safe-fall-01')
  ));
  if (detour.towerSuppressedForOptionalDetourPlaytest && towerPlatforms.length) {
    failures.push('towerSafeFallPresent');
  }
  const safeFloorPlatforms = (level.platforms || []).filter(platform => (
    /safe-floor-[ab]$/.test(platform.platformId || platform.id || '')
  ));
  if (detour.towerSuppressedForOptionalDetourPlaytest && safeFloorPlatforms.length) {
    failures.push('towerSafeFloorPresent');
  }
  if ((level.traversalEncounterStats?.fallbacks || 0) > 0) failures.push('traversalFallbackPresent');

  return {
    valid: failures.length === 0,
    failures,
    primaryRouteGeometryHashBefore: detour.primaryRouteGeometryHashBefore,
    primaryRouteGeometryHashAfter: hashAfter,
    primaryRouteGeometryUnchanged: hashEqual,
    optionalPlatformCount: optional.length,
    platformsByModule: optional.reduce((counts, platform) => {
      counts[platform.detourModuleId] = (counts[platform.detourModuleId] || 0) + 1;
      return counts;
    }, {}),
    clearanceViolations: clearance,
    movement,
    primaryProfileValid: detour.primaryProfileValid,
    primaryProfile: detour.primaryProfile,
    minimumPreRejoinSeparation: detour.minimumPreRejoinSeparation,
    prematureConvergenceCount: detour.prematureConvergenceCount,
    hardVerticalAmplitude: movement.hardVerticalAmplitude,
    hardClimbCount: movement.hardClimbCount,
    hardDropCount: movement.hardDropCount,
    moduleFamilyCount: detour.moduleFamilyCount,
    biologicalModuleCount: detour.biologicalModuleCount,
    primaryRecapCount: detour.primaryRecapCount,
    structuralSignature: detour.structuralSignature,
    accessVisibleAtZoom1: detour.accessVisibleAtZoom1,
    accessVisibleAtZoom145: detour.accessVisibleAtZoom145,
    accessJetpackAccessible: detour.accessJetpackAccessible,
    accessSimpleJumpAccessible: detour.accessSimpleJumpAccessible,
    transitionPlatformCount: transitionPlatforms.length,
    cruisePlatformCount: cruisePlatforms.length,
    transitionGradual,
    upperRouteWorldSpan: upperSpan,
    towerSafeFallPlatformCount: towerPlatforms.length,
    safeFloorPlatformCount: safeFloorPlatforms.length,
  };
}
