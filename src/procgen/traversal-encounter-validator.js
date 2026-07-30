import { canTraverseEdge } from './traversal-edge-physics.js';
import {
  getOptionalTraversalPlatforms,
  getPrimaryTraversalPlatforms,
} from './traversal-route.js';

const BASIC_PRIMITIVES = Object.freeze([
  Object.freeze({ id: 'controlled-drop', requires: [] }),
  Object.freeze({ id: 'standing-jump-short', requires: [] }),
  Object.freeze({ id: 'running-jump-short', requires: [] }),
]);
const ADVANCED_PRIMITIVES = Object.freeze([
  Object.freeze({
    id: 'running-double-jump-early',
    requires: ['doubleJump'],
  }),
  Object.freeze({
    id: 'running-double-jump-late',
    requires: ['doubleJump'],
  }),
  Object.freeze({ id: 'ground-dash', requires: ['dash'] }),
  Object.freeze({ id: 'air-dash', requires: ['dash'] }),
  Object.freeze({
    id: 'running-double-jump-dash',
    requires: ['doubleJump', 'dash'],
  }),
]);
const HARD_TRAVERSAL_PRIMITIVES = Object.freeze([
  ...BASIC_PRIMITIVES,
  ...ADVANCED_PRIMITIVES,
]);
const SAFE_AGENT_TYPES = Object.freeze(['normal']);
const HARD_AGENT_TYPES = Object.freeze([
  'normal',
  'conservative',
  'error-early',
  'error-late',
]);

function routeForInstance(level, instanceId, getter) {
  return getter(level).filter(platform => (
    platform.encounterInstanceId === instanceId
  ));
}

function edgeFailure(route, from, to, physics) {
  return {
    type: 'invalidEdge',
    route,
    from: from.platformId,
    to: to.platformId,
    gap: physics.gap,
    rise: physics.rise,
    drop: physics.drop,
    centerDistance: physics.centerDistance,
    attemptedPrimitiveIds: physics.attemptedPrimitiveIds,
    attemptedTimings: physics.attemptedTimings,
  };
}

function validateSequence(routeId, platforms, primitives, agentTypes) {
  const edges = [];
  const failures = [];
  for (let index = 1; index < platforms.length; index++) {
    const from = platforms[index - 1];
    const to = platforms[index];
    const physics = canTraverseEdge({
      from,
      to,
      primitives,
      agentTypes,
    });
    const edge = { route: routeId, from, to, physics };
    edges.push(edge);
    if (!physics.valid) failures.push(edgeFailure(routeId, from, to, physics));
  }
  return { edges, failures };
}

function safeFallFailures(optional, primary) {
  const floor = primary.filter(platform => platform.blockRole === 'route');
  return optional
    .filter(platform => platform.blockRole === 'route')
    .filter(platform => !floor.some(candidate => (
      platform.x + platform.w >= candidate.x + 24
      && platform.x <= candidate.x + candidate.w - 24
      && candidate.y > platform.y
    )))
    .map(platform => platform.platformId);
}

function center(platform) {
  return {
    x: platform.x + platform.w / 2,
    y: platform.y,
  };
}

function routeLength(route) {
  let length = 0;
  for (let index = 1; index < route.length; index++) {
    const previous = center(route[index - 1]);
    const next = center(route[index]);
    length += Math.hypot(next.x - previous.x, next.y - previous.y);
  }
  return length;
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function routeGaps(route) {
  return route.slice(1).map((platform, index) => (
    platform.x - (route[index].x + route[index].w)
  ));
}

function routeYAtX(route, x) {
  const points = route.map(center).sort((left, right) => left.x - right.x);
  if (!points.length) return 0;
  if (x <= points[0].x) return points[0].y;
  if (x >= points.at(-1).x) return points.at(-1).y;
  for (let index = 1; index < points.length; index++) {
    if (x > points[index].x) continue;
    const previous = points[index - 1];
    const next = points[index];
    const progress = (x - previous.x) / Math.max(1, next.x - previous.x);
    return previous.y + (next.y - previous.y) * progress;
  }
  return points.at(-1).y;
}

function hasFloorBelow(platform, primary) {
  const centerX = platform.x + platform.w / 2;
  return primary.some(candidate => (
    candidate.blockRole === 'route'
    && centerX >= candidate.x + 24
    && centerX <= candidate.x + candidate.w - 24
    && candidate.y > platform.y
  ));
}

function declaredOrdersAreCorrect(route, key) {
  return route.every((platform, index) => platform[key] === index);
}

function centralEdge(edge, entryCenterX, openingSpan, closingStart) {
  const midpointX = (
    edge.from.x + edge.from.w / 2
    + edge.to.x + edge.to.w / 2
  ) / 2 - entryCenterX;
  return midpointX >= openingSpan && midpointX <= closingStart;
}

function advancedCentralEdges(
  optionalEdges,
  entryCenterX,
  openingSpan,
  closingStart,
) {
  return optionalEdges.filter(edge => {
    if (!centralEdge(edge, entryCenterX, openingSpan, closingStart)) return false;
    if (!edge.physics.valid) return false;
    const advanced = canTraverseEdge({
      from: edge.from,
      to: edge.to,
      primitives: ADVANCED_PRIMITIVES,
      agentTypes: HARD_AGENT_TYPES,
    });
    if (!advanced.valid) return false;
    const basic = canTraverseEdge({
      from: edge.from,
      to: edge.to,
      primitives: BASIC_PRIMITIVES,
      agentTypes: SAFE_AGENT_TYPES,
    });
    if (basic.valid) return false;
    edge.physics = advanced;
    return true;
  });
}

function commonPlatformIds(primary, optional) {
  const optionalIds = new Set(optional.map(platform => platform.platformId));
  return primary
    .map(platform => platform.platformId)
    .filter(platformId => optionalIds.has(platformId));
}

function forkValidation({
  level,
  encounter,
  primary,
  optional,
  primaryValidation,
  optionalValidation,
}) {
  const failureReasons = [];
  const primaryInternal = primary.filter(platform => platform.routeRole === 'primary');
  const optionalInternal = optional.filter(platform => platform.routeRole === 'optional');
  const all = [...new Set([...primary, ...optional])];
  const entry = all.find(platform => platform.blockRole === 'entry');
  const exit = all.find(platform => platform.blockRole === 'exit');
  if (!entry) failureReasons.push({ type: 'missingEntry' });
  if (!exit) failureReasons.push({ type: 'missingExit' });

  if (!declaredOrdersAreCorrect(primary, 'primaryRouteOrder')) {
    failureReasons.push({ type: 'invalidRouteOrder', route: 'primary' });
  }
  if (!declaredOrdersAreCorrect(optional, 'optionalRouteOrder')) {
    failureReasons.push({ type: 'invalidRouteOrder', route: 'optional' });
  }
  failureReasons.push(...primaryValidation.failures, ...optionalValidation.failures);

  const generation = encounter.generation || {};
  const referenceScreenWorldWidth = generation.referenceScreenWorldWidth || 1280;
  const encounterScreenCount = generation.encounterScreenCount || 0;
  const openingSpan = generation.openingSpan || 0;
  const closingSpan = generation.closingSpan || 0;
  const expectedSpan = referenceScreenWorldWidth * encounterScreenCount;
  const encounterSpan = entry && exit
    ? (exit.x + exit.w / 2) - (entry.x + entry.w / 2)
    : 0;
  if (encounterScreenCount < 3 || encounterScreenCount > 6) {
    failureReasons.push({
      type: 'invalidEncounterScreenCount',
      encounterScreenCount,
    });
  }
  if (Math.abs(encounterSpan - expectedSpan) > 1) {
    failureReasons.push({
      type: 'invalidEncounterSpan',
      encounterSpan,
      expectedSpan,
    });
  }
  if (Math.abs(openingSpan - referenceScreenWorldWidth) > 1) {
    failureReasons.push({
      type: 'invalidOpeningSpan',
      openingSpan,
      expected: referenceScreenWorldWidth,
    });
  }
  if (Math.abs(closingSpan - referenceScreenWorldWidth) > 1) {
    failureReasons.push({
      type: 'invalidClosingSpan',
      closingSpan,
      expected: referenceScreenWorldWidth,
    });
  }

  const closingStart = encounterSpan - closingSpan;
  const entryCenterX = entry ? entry.x + entry.w / 2 : 0;
  const centralOptional = optionalInternal.filter(platform => {
    const relativeX = platform.x + platform.w / 2 - entryCenterX;
    return relativeX >= openingSpan && relativeX <= closingStart;
  });
  const centralSeparations = centralOptional.map(platform => (
    routeYAtX(primary, platform.x + platform.w / 2) - platform.y
  ));
  const maximumVerticalSeparation = Math.max(0, ...centralSeparations);
  const maximumSeparation = generation.maximumSeparation || 0;
  if (maximumVerticalSeparation < maximumSeparation * .9) {
    failureReasons.push({
      type: 'insufficientCentralSeparation',
      maximumVerticalSeparation,
      required: maximumSeparation * .9,
    });
  }

  const sharedIds = commonPlatformIds(primary, optional);
  const expectedSharedIds = [entry?.platformId, exit?.platformId].filter(Boolean);
  if (
    sharedIds.length !== 2
    || expectedSharedIds.some(platformId => !sharedIds.includes(platformId))
  ) {
    failureReasons.push({
      type: 'routesRejoinBeforeExit',
      sharedPlatformIds: sharedIds,
    });
  }

  const rewards = (level.exudates || []).filter(item => (
    item.encounterInstanceId === encounter.encounterInstanceId
  ));
  const optionalIds = new Set(optionalInternal.map(platform => platform.platformId));
  if (rewards.length !== 2) {
    failureReasons.push({ type: 'invalidRewardCount', count: rewards.length });
  }
  const misplacedRewards = rewards.filter(reward => !optionalIds.has(reward.platformId));
  if (misplacedRewards.length) {
    failureReasons.push({
      type: 'rewardOutsideOptionalRoute',
      rewardIds: misplacedRewards.map(reward => reward.id),
    });
  }

  const advancedEdges = advancedCentralEdges(
    optionalValidation.edges,
    entryCenterX,
    openingSpan,
    closingStart,
  );
  if (!advancedEdges.length) {
    failureReasons.push({ type: 'noAdvancedCentralEdge' });
  }
  for (const generationFailure of generation.generationFailures || []) {
    failureReasons.push({ type: 'templateGenerationFailure', ...generationFailure });
  }

  const primaryGaps = routeGaps(primary);
  const optionalGaps = routeGaps(optional);
  const safeFallCount = optionalInternal.filter(platform => (
    hasFloorBelow(platform, primary)
  )).length;
  const geometry = all.reduce((bounds, platform) => ({
    minY: Math.min(bounds.minY, platform.y),
    maxY: Math.max(bounds.maxY, platform.y + platform.h),
  }), { minY: Infinity, maxY: -Infinity });

  return {
    valid: failureReasons.length === 0,
    failureReasons,
    advancedEdges,
    metrics: {
      templateId: encounter.templateId,
      logicIndex: encounter.logicIndex,
      primaryBlockCount: primaryInternal.length,
      optionalBlockCount: optionalInternal.length,
      encounterSpan,
      horizontalSpan: encounterSpan,
      referenceScreenWorldWidth,
      encounterScreenCount,
      openingSpan,
      openRouteSpan: generation.openRouteSpan,
      closingSpan,
      maximumSeparation,
      maximumVerticalSeparation,
      primaryRouteLength: generation.safeRouteLength || routeLength(primary),
      optionalRouteLength: generation.hardRouteLength || routeLength(optional),
      safeRouteLength: generation.safeRouteLength || routeLength(primary),
      hardRouteLength: generation.hardRouteLength || routeLength(optional),
      primaryAverageWidth: average(primaryInternal.map(platform => platform.w)),
      optionalAverageWidth: average(optionalInternal.map(platform => platform.w)),
      primaryAverageGap: average(primaryGaps),
      optionalAverageGap: average(optionalGaps),
      primaryAverageVerticalDelta: generation.primaryAverageVerticalDelta
        ?? average(primary.slice(1).map((platform, index) => (
          Math.abs(platform.y - primary[index].y)
        ))),
      optionalAverageVerticalDelta: generation.optionalAverageVerticalDelta
        ?? average(optional.slice(1).map((platform, index) => (
          Math.abs(platform.y - optional[index].y)
        ))),
      safeVariationAmplitude: generation.safeVariationAmplitude,
      hardVariationAmplitude: generation.hardVariationAmplitude,
      safeRefinementCount: generation.safeRefinementCount || 0,
      hardRefinementCount: generation.hardRefinementCount || 0,
      advancedCentralEdgeCount: advancedEdges.length,
      advancedCentralEdges: advancedEdges.map(edge => ({
        from: edge.from.platformId,
        to: edge.to.platformId,
        passingPrimitiveIds: edge.physics.passingPrimitiveIds,
        gap: edge.physics.gap,
        rise: edge.physics.rise,
        drop: edge.physics.drop,
      })),
      safeFallCount,
      safeFallRatio: optionalInternal.length
        ? safeFallCount / optionalInternal.length
        : 0,
      geometryMinY: geometry.minY,
      geometryMaxY: geometry.maxY,
      primaryValidation: primaryValidation.failures.length ? 'FALHOU' : 'OK',
      optionalValidation: optionalValidation.failures.length ? 'FALHOU' : 'OK',
      physicalValidation: primaryValidation.failures.length === 0
        && optionalValidation.failures.length === 0,
    },
  };
}

export function validateTraversalEncounter(level, encounter) {
  const primary = routeForInstance(
    level,
    encounter.encounterInstanceId,
    getPrimaryTraversalPlatforms,
  );
  const optional = routeForInstance(
    level,
    encounter.encounterInstanceId,
    getOptionalTraversalPlatforms,
  );
  const primaryValidation = validateSequence(
    'primary',
    primary,
    BASIC_PRIMITIVES,
    SAFE_AGENT_TYPES,
  );
  const optionalValidation = validateSequence(
    'optional',
    optional,
    HARD_TRAVERSAL_PRIMITIVES,
    HARD_AGENT_TYPES,
  );

  if (encounter.templateId === 'fork-high-reward-01') {
    const fork = forkValidation({
      level,
      encounter,
      primary,
      optional,
      primaryValidation,
      optionalValidation,
    });
    return {
      valid: fork.valid,
      primaryFailures: primaryValidation.failures,
      optionalFailures: optionalValidation.failures,
      failureReasons: fork.failureReasons,
      advancedEdges: fork.advancedEdges,
      safeFallFailures: [],
      requiresDoubleJump: fork.advancedEdges.length > 0,
      countFailures: [],
      widthFailures: [],
      gapFailures: [],
      silhouetteFailures: [],
      rewardFailures: [],
      metrics: fork.metrics,
    };
  }

  const safeFall = encounter.templateId === 'tower-safe-fall-01'
    ? safeFallFailures(optional, primary)
    : [];
  const optionalAdvancedEdges = optionalValidation.edges.filter(edge => {
    if (!edge.physics.valid) return false;
    const basic = canTraverseEdge({
      from: edge.from,
      to: edge.to,
      primitives: BASIC_PRIMITIVES,
      agentTypes: SAFE_AGENT_TYPES,
    });
    return !basic.valid;
  });
  const failureReasons = [
    ...primaryValidation.failures,
    ...optionalValidation.failures,
    ...safeFall.map(platformId => ({
      type: 'unsafeFall',
      route: 'optional',
      platformId,
    })),
  ];
  if (
    encounter.templateId === 'tower-safe-fall-01'
    && !optionalAdvancedEdges.length
  ) {
    failureReasons.push({ type: 'optionalRouteDoesNotRequireSkill' });
  }
  return {
    valid: failureReasons.length === 0,
    primaryFailures: primaryValidation.failures,
    optionalFailures: optionalValidation.failures,
    failureReasons,
    safeFallFailures: safeFall,
    requiresDoubleJump: optionalAdvancedEdges.length > 0,
    countFailures: [],
    widthFailures: [],
    gapFailures: [],
    silhouetteFailures: [],
    rewardFailures: [],
    metrics: null,
  };
}
