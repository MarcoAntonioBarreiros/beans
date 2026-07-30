import { createRandom } from './random.js';
import { canTraverseEdge } from './traversal-edge-physics.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const TAU = Math.PI * 2;

const FALLBACK_PRIMITIVES = Object.freeze([
  Object.freeze({ id: 'controlled-drop', requires: [] }),
  Object.freeze({ id: 'standing-jump-short', requires: [] }),
  Object.freeze({ id: 'standing-jump-long', requires: [] }),
  Object.freeze({ id: 'running-jump-short', requires: [] }),
  Object.freeze({ id: 'running-jump-long', requires: [] }),
  Object.freeze({ id: 'running-double-jump-early', requires: ['doubleJump'] }),
  Object.freeze({ id: 'running-double-jump-late', requires: ['doubleJump'] }),
  Object.freeze({ id: 'ground-dash', requires: ['dash'] }),
  Object.freeze({ id: 'air-dash', requires: ['dash'] }),
  Object.freeze({
    id: 'running-double-jump-dash',
    requires: ['doubleJump', 'dash'],
  }),
]);

const SAFE_AGENT_TYPES = Object.freeze(['normal']);
const HARD_AGENT_TYPES = Object.freeze([
  'normal',
  'conservative',
  'error-early',
  'error-late',
]);

const block = (
  id,
  x,
  y,
  w,
  routeRole,
  primaryRouteOrder,
  optionalRouteOrder,
  extra = {},
) => ({
  id,
  x,
  y,
  w,
  h: 54,
  type: 'root',
  routeRole,
  blockRole: routeRole === 'shared'
    ? (id === 'entry' ? 'entry' : 'exit')
    : 'route',
  isPrimaryRoute: routeRole !== 'optional',
  isOptionalRoute: routeRole !== 'primary',
  primaryRouteOrder,
  optionalRouteOrder,
  ...extra,
});

export const FORK_GEOMETRY = Object.freeze({
  referenceScreenWorldWidth: 1280,
  sharedWidth: 140,
  minimumScreenCount: 3,
  maximumScreenCount: 6,
  openingScreenCount: 1,
  closingScreenCount: 1,
  maximumInternalPlatforms: 64,
  samplesPerScreen: 220,
  safe: Object.freeze({
    variationMinimum: 35,
    variationMaximum: 50,
    openingClosing: Object.freeze({
      minimumPitch: 190,
      maximumPitch: 225,
      minimumWidth: 175,
      maximumWidth: 215,
    }),
    central: Object.freeze({
      minimumPitch: 215,
      maximumPitch: 255,
      minimumWidth: 175,
      maximumWidth: 220,
    }),
  }),
  hard: Object.freeze({
    variationMinimum: 120,
    variationMaximum: 190,
    opening: Object.freeze({
      minimumPitch: 170,
      maximumPitch: 180,
      minimumWidth: 80,
      maximumWidth: 90,
    }),
    closing: Object.freeze({
      minimumPitch: 230,
      maximumPitch: 260,
      minimumWidth: 70,
      maximumWidth: 90,
    }),
    central: Object.freeze({
      minimumPitch: 230,
      maximumPitch: 310,
      minimumWidth: 90,
      maximumWidth: 130,
    }),
  }),
});

export function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function separationAtDistance(
  distance,
  maximumSeparation,
  openingSpan,
  encounterSpan,
  closingSpan = openingSpan,
) {
  const x = clamp(distance, 0, encounterSpan);
  if (x < openingSpan) {
    return maximumSeparation * smoothstep(x / Math.max(1, openingSpan));
  }
  const closingStart = encounterSpan - closingSpan;
  if (x > closingStart) {
    const closingProgress = (x - closingStart) / Math.max(1, closingSpan);
    return maximumSeparation * (1 - smoothstep(closingProgress));
  }
  return maximumSeparation;
}

export function separationAt(t, maximumSeparation, options = {}) {
  const encounterSpan = options.encounterSpan || 1;
  const openingSpan = options.openingSpan || encounterSpan / 3;
  const closingSpan = options.closingSpan || openingSpan;
  return separationAtDistance(
    clamp(t, 0, 1) * encounterSpan,
    maximumSeparation,
    openingSpan,
    encounterSpan,
    closingSpan,
  );
}

function routePoint({
  distance,
  encounterSpan,
  openingSpan,
  closingSpan,
  maximumSeparation,
  openScreenCount,
  route,
  safeVariationAmplitude,
  hardVariationAmplitude,
}) {
  const separation = separationAtDistance(
    distance,
    maximumSeparation,
    openingSpan,
    encounterSpan,
    closingSpan,
  );
  const closingStart = encounterSpan - closingSpan;
  const insideOpenRegion = distance >= openingSpan && distance <= closingStart;
  const openRouteSpan = Math.max(1, closingStart - openingSpan);
  const centralProgress = clamp((distance - openingSpan) / openRouteSpan, 0, 1);
  let localVariation = 0;
  if (insideOpenRegion) {
    const oscillations = Math.max(1, openScreenCount);
    const wave = Math.sin(TAU * oscillations * centralProgress);
    if (route === 'safe') {
      localVariation = safeVariationAmplitude * wave;
    } else {
      localVariation = hardVariationAmplitude * wave;
    }
  }
  return {
    t: distance / Math.max(1, encounterSpan),
    x: FORK_GEOMETRY.sharedWidth / 2 + distance,
    y: route === 'safe'
      ? localVariation
      : -separation + localVariation,
    horizontalDistance: distance,
    separation,
    localVariation,
  };
}

export function sampleForkRoute({
  encounterSpan,
  openingSpan,
  closingSpan,
  maximumSeparation,
  route,
  safeVariationAmplitude = 0,
  hardVariationAmplitude = 0,
  samples = null,
}) {
  const points = [];
  let length = 0;
  const encounterScreenCount = encounterSpan / FORK_GEOMETRY.referenceScreenWorldWidth;
  const openScreenCount = Math.max(1, encounterScreenCount - 2);
  const count = Math.max(
    180,
    Math.floor(samples || encounterScreenCount * FORK_GEOMETRY.samplesPerScreen),
  );
  for (let index = 0; index <= count; index++) {
    const point = routePoint({
      distance: encounterSpan * (index / count),
      encounterSpan,
      openingSpan,
      closingSpan,
      maximumSeparation,
      openScreenCount,
      route,
      safeVariationAmplitude,
      hardVariationAmplitude,
    });
    if (points.length) {
      const previous = points.at(-1);
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
    points.push({ ...point, distance: length });
  }
  return { points, length };
}

function pointAtArcDistance(polyline, distance) {
  const target = clamp(distance, 0, polyline.length);
  const points = polyline.points;
  let low = 1;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].distance < target) low = middle + 1;
    else high = middle;
  }
  const next = points[low];
  const previous = points[Math.max(0, low - 1)];
  const segmentLength = Math.max(.0001, next.distance - previous.distance);
  const amount = (target - previous.distance) / segmentLength;
  return {
    t: previous.t + (next.t - previous.t) * amount,
    x: previous.x + (next.x - previous.x) * amount,
    y: previous.y + (next.y - previous.y) * amount,
    horizontalDistance: previous.horizontalDistance
      + (next.horizontalDistance - previous.horizontalDistance) * amount,
    distance: target,
  };
}

function arcDistanceAtT(polyline, t) {
  const target = clamp(t, 0, 1);
  const points = polyline.points;
  let low = 1;
  let high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].t < target) low = middle + 1;
    else high = middle;
  }
  const next = points[low];
  const previous = points[Math.max(0, low - 1)];
  const span = Math.max(.0001, next.t - previous.t);
  const amount = (target - previous.t) / span;
  return previous.distance + (next.distance - previous.distance) * amount;
}

function randomBetween(random, minimum, maximum) {
  return minimum + (maximum - minimum) * random();
}

function createRegionBlocks({
  prefix,
  routeRole,
  region,
  polyline,
  startT,
  endT,
  includeEnd,
  limits,
  random,
}) {
  const startArc = arcDistanceAtT(polyline, startT);
  const endArc = arcDistanceAtT(polyline, endT);
  const regionLength = Math.max(1, endArc - startArc);
  const targetPitch = randomBetween(
    random,
    limits.minimumPitch,
    limits.maximumPitch,
  );
  const intervalCount = Math.max(1, Math.ceil(regionLength / targetPitch));
  const blocks = [];
  for (let index = 1; index <= intervalCount; index++) {
    if (!includeEnd && index === intervalCount) continue;
    const routeDistance = startArc + regionLength * (index / intervalCount);
    const point = pointAtArcDistance(polyline, routeDistance);
    const width = randomBetween(random, limits.minimumWidth, limits.maximumWidth);
    blocks.push(block(
      `${prefix}-${region}-${index}`,
      point.x - width / 2,
      point.y,
      width,
      routeRole,
      null,
      null,
      {
        routeT: point.t,
        routeDistance,
        forkRegion: region,
      },
    ));
  }
  return { blocks, targetPitch, regionLength };
}

function createInitialRouteBlocks({
  route,
  polyline,
  encounterSpan,
  openingSpan,
  closingSpan,
  random,
}) {
  const closingStart = encounterSpan - closingSpan;
  const routeLimits = FORK_GEOMETRY[route];
  const prefix = route === 'safe' ? 'safe' : 'high';
  const routeRole = route === 'safe' ? 'primary' : 'optional';
  const regions = [
    {
      id: 'opening',
      startT: 0,
      endT: openingSpan / encounterSpan,
      includeEnd: true,
      limits: route === 'hard' ? routeLimits.opening : routeLimits.openingClosing,
    },
    {
      id: 'central',
      startT: openingSpan / encounterSpan,
      endT: closingStart / encounterSpan,
      includeEnd: true,
      limits: routeLimits.central,
    },
    {
      id: 'closing',
      startT: closingStart / encounterSpan,
      endT: 1,
      includeEnd: false,
      limits: route === 'hard' ? routeLimits.closing : routeLimits.openingClosing,
    },
  ];
  const blocks = [];
  const regionMetrics = {};
  for (const region of regions) {
    const generated = createRegionBlocks({
      prefix,
      routeRole,
      region: region.id,
      polyline,
      startT: region.startT,
      endT: region.endT,
      includeEnd: region.includeEnd,
      limits: region.limits,
      random,
    });
    blocks.push(...generated.blocks);
    regionMetrics[region.id] = {
      targetPitch: generated.targetPitch,
      routeLength: generated.regionLength,
      blockCount: generated.blocks.length,
    };
  }
  return { blocks, regionMetrics };
}

function assignRouteOrders(entry, exit, primaryBlocks, optionalBlocks) {
  primaryBlocks.sort((left, right) => left.routeT - right.routeT);
  optionalBlocks.sort((left, right) => left.routeT - right.routeT);
  entry.primaryRouteOrder = 0;
  entry.optionalRouteOrder = 0;
  primaryBlocks.forEach((platform, index) => {
    platform.primaryRouteOrder = index + 1;
    platform.optionalRouteOrder = null;
  });
  optionalBlocks.forEach((platform, index) => {
    platform.primaryRouteOrder = null;
    platform.optionalRouteOrder = index + 1;
  });
  exit.primaryRouteOrder = primaryBlocks.length + 1;
  exit.optionalRouteOrder = optionalBlocks.length + 1;
}

function routeWithShared(entry, internal, exit) {
  return [entry, ...internal, exit];
}

function routeEdgeResults(route, primitives, agentTypes) {
  return route.slice(1).map((to, index) => ({
    from: route[index],
    to,
    physics: canTraverseEdge({
      from: route[index],
      to,
      primitives,
      agentTypes,
    }),
  }));
}

function refinementWidth(route, point, seedValue) {
  const region = point.horizontalDistance < FORK_GEOMETRY.referenceScreenWorldWidth
    || point.horizontalDistance
      > (point.encounterSpan - FORK_GEOMETRY.referenceScreenWorldWidth)
    ? 'openingClosing'
    : 'central';
  const routeLimits = FORK_GEOMETRY[route];
  const limits = region === 'openingClosing' && route === 'hard'
    ? routeLimits.opening
    : routeLimits[region];
  const random = createRandom(
    `${seedValue}:${route}:refine:${Math.round(point.distance * 1000)}`,
  );
  return randomBetween(random, limits.minimumWidth, limits.maximumWidth);
}

function refineFailedEdges({
  route,
  entry,
  exit,
  internal,
  polyline,
  primitives,
  agentTypes,
  seedValue,
  encounterSpan,
}) {
  let refinementCount = 0;
  let failures = [];
  while (internal.length <= FORK_GEOMETRY.maximumInternalPlatforms) {
    const ordered = routeWithShared(entry, internal, exit);
    const results = routeEdgeResults(ordered, primitives, agentTypes);
    failures = results.filter(result => !result.physics.valid);
    if (!failures.length) {
      return { valid: true, refinementCount, failures: [], edgeResults: results };
    }
    if (internal.length >= FORK_GEOMETRY.maximumInternalPlatforms) break;
    const failure = failures[0];
    const fromArc = arcDistanceAtT(polyline, failure.from.routeT ?? 0);
    const toArc = arcDistanceAtT(polyline, failure.to.routeT ?? 1);
    const middleArc = (fromArc + toArc) / 2;
    const point = {
      ...pointAtArcDistance(polyline, middleArc),
      encounterSpan,
    };
    if (
      Math.abs((failure.to.routeT ?? 1) - (failure.from.routeT ?? 0)) < .00001
    ) break;
    const width = refinementWidth(route, point, seedValue);
    const routeRole = route === 'safe' ? 'primary' : 'optional';
    internal.push(block(
      `${route}-refine-${refinementCount + 1}`,
      point.x - width / 2,
      point.y,
      width,
      routeRole,
      null,
      null,
      {
        routeT: point.t,
        routeDistance: middleArc,
        forkRegion: 'refined',
        edgeRefinement: true,
      },
    ));
    internal.sort((left, right) => left.routeT - right.routeT);
    refinementCount++;
  }
  return {
    valid: false,
    refinementCount,
    failures,
    edgeResults: routeEdgeResults(
      routeWithShared(entry, internal, exit),
      primitives,
      agentTypes,
    ),
    limitReached: internal.length >= FORK_GEOMETRY.maximumInternalPlatforms,
  };
}

function centralEdge(result, openingSpan, closingStart, baseX) {
  const midpoint = (
    result.from.x + result.from.w / 2
    + result.to.x + result.to.w / 2
  ) / 2 - baseX;
  return midpoint >= openingSpan && midpoint <= closingStart;
}

function advancedCentralEdges({
  route,
  basicPrimitives,
  advancedPrimitives,
  openingSpan,
  closingStart,
}) {
  const baseX = FORK_GEOMETRY.sharedWidth / 2;
  return route.slice(1).map((to, index) => {
    const from = route[index];
    const advanced = canTraverseEdge({
      from,
      to,
      primitives: advancedPrimitives,
      agentTypes: HARD_AGENT_TYPES,
    });
    const basic = canTraverseEdge({
      from,
      to,
      primitives: basicPrimitives,
      agentTypes: SAFE_AGENT_TYPES,
    });
    return { from, to, advanced, basic };
  }).filter(result => (
    centralEdge(result, openingSpan, closingStart, baseX)
    && result.advanced.valid
    && !result.basic.valid
  ));
}

function enforceAdvancedCentralEdge({
  entry,
  exit,
  optionalBlocks,
  basicPrimitives,
  advancedPrimitives,
  openingSpan,
  closingStart,
}) {
  const route = routeWithShared(entry, optionalBlocks, exit);
  let advancedEdges = advancedCentralEdges({
    route,
    basicPrimitives,
    advancedPrimitives,
    openingSpan,
    closingStart,
  });
  if (advancedEdges.length) return advancedEdges;

  const candidates = optionalBlocks.filter(platform => (
    platform.x + platform.w / 2 >= openingSpan + FORK_GEOMETRY.sharedWidth / 2
    && platform.x + platform.w / 2 <= closingStart + FORK_GEOMETRY.sharedWidth / 2
  ));
  for (const candidate of candidates) {
    const originalY = candidate.y;
    for (const offset of [-40, 40, -80, 80, -120, 120]) {
      candidate.y = originalY + offset;
      const candidateRoute = routeWithShared(entry, optionalBlocks, exit);
      const allAdvanced = routeEdgeResults(
        candidateRoute,
        advancedPrimitives,
        HARD_AGENT_TYPES,
      ).every(result => result.physics.valid);
      if (!allAdvanced) continue;
      advancedEdges = advancedCentralEdges({
        route: candidateRoute,
        basicPrimitives,
        advancedPrimitives,
        openingSpan,
        closingStart,
      });
      if (advancedEdges.length) {
        candidate.advancedDifficultyAdjustment = offset;
        return advancedEdges;
      }
    }
    candidate.y = originalY;
  }
  return [];
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function routeGaps(route) {
  return route.slice(1).map((item, index) => (
    item.x - (route[index].x + route[index].w)
  ));
}

function routeVerticalDeltas(route) {
  return route.slice(1).map((item, index) => Math.abs(item.y - route[index].y));
}

function summarizeFailure(route, failure) {
  return {
    route,
    from: failure.from.id,
    to: failure.to.id,
    ...failure.physics,
  };
}

export function createForkTraversalTemplate({
  seedValue = 'fork-high-reward-01',
  encounterScreenCount: requestedScreenCount = null,
  primitives = FALLBACK_PRIMITIVES,
} = {}) {
  const random = createRandom(`${seedValue}:screen-fork`);
  const referenceScreenWorldWidth = FORK_GEOMETRY.referenceScreenWorldWidth;
  const encounterScreenCount = Number.isInteger(requestedScreenCount)
    ? clamp(
        requestedScreenCount,
        FORK_GEOMETRY.minimumScreenCount,
        FORK_GEOMETRY.maximumScreenCount,
      )
    : FORK_GEOMETRY.minimumScreenCount
      + Math.floor(random() * (
        FORK_GEOMETRY.maximumScreenCount - FORK_GEOMETRY.minimumScreenCount + 1
      ));
  const encounterSpan = encounterScreenCount * referenceScreenWorldWidth;
  const openingSpan = referenceScreenWorldWidth;
  const closingSpan = referenceScreenWorldWidth;
  const openRouteSpan = encounterSpan - openingSpan - closingSpan;
  const maximumSeparation = referenceScreenWorldWidth;
  const safeVariationAmplitude = randomBetween(
    random,
    FORK_GEOMETRY.safe.variationMinimum,
    FORK_GEOMETRY.safe.variationMaximum,
  );
  const hardVariationAmplitude = randomBetween(
    random,
    FORK_GEOMETRY.hard.variationMinimum,
    FORK_GEOMETRY.hard.variationMaximum,
  );
  const routeOptions = {
    encounterSpan,
    openingSpan,
    closingSpan,
    maximumSeparation,
    safeVariationAmplitude,
    hardVariationAmplitude,
  };
  const safePolyline = sampleForkRoute({ ...routeOptions, route: 'safe' });
  const hardPolyline = sampleForkRoute({ ...routeOptions, route: 'hard' });
  const safeInitial = createInitialRouteBlocks({
    route: 'safe',
    polyline: safePolyline,
    encounterSpan,
    openingSpan,
    closingSpan,
    random,
  });
  const hardInitial = createInitialRouteBlocks({
    route: 'hard',
    polyline: hardPolyline,
    encounterSpan,
    openingSpan,
    closingSpan,
    random,
  });
  const primaryBlocks = safeInitial.blocks;
  const optionalBlocks = hardInitial.blocks;
  const entry = block('entry', 0, 0, FORK_GEOMETRY.sharedWidth, 'shared', 0, 0, {
    routeT: 0,
    routeDistance: 0,
  });
  const exit = block(
    'exit',
    encounterSpan,
    0,
    FORK_GEOMETRY.sharedWidth,
    'shared',
    null,
    null,
    { campaignAnchor: true, routeT: 1 },
  );
  assignRouteOrders(entry, exit, primaryBlocks, optionalBlocks);

  const availablePrimitives = primitives.length ? primitives : FALLBACK_PRIMITIVES;
  const basicPrimitives = [
    { id: 'controlled-drop', requires: [] },
    ...availablePrimitives.filter(primitive => (
      (primitive.requires || []).length === 0
      && primitive.id !== 'controlled-drop'
    )),
  ];
  const advancedPrimitives = availablePrimitives.filter(primitive => (
    (primitive.requires || []).includes('doubleJump')
    || (primitive.requires || []).includes('dash')
  ));
  const hardTraversalPrimitives = [
    ...basicPrimitives,
    ...advancedPrimitives,
  ];
  const safeRefinement = refineFailedEdges({
    route: 'safe',
    entry,
    exit,
    internal: primaryBlocks,
    polyline: safePolyline,
    primitives: basicPrimitives,
    agentTypes: SAFE_AGENT_TYPES,
    seedValue,
    encounterSpan,
  });
  const hardRefinement = refineFailedEdges({
    route: 'hard',
    entry,
    exit,
    internal: optionalBlocks,
    polyline: hardPolyline,
    primitives: hardTraversalPrimitives,
    agentTypes: HARD_AGENT_TYPES,
    seedValue,
    encounterSpan,
  });
  assignRouteOrders(entry, exit, primaryBlocks, optionalBlocks);
  const closingStart = encounterSpan - closingSpan;
  const advancedEdges = hardRefinement.valid
    ? enforceAdvancedCentralEdge({
        entry,
        exit,
        optionalBlocks,
        basicPrimitives,
        advancedPrimitives,
        openingSpan,
        closingStart,
      })
    : [];
  assignRouteOrders(entry, exit, primaryBlocks, optionalBlocks);

  const primaryRoute = routeWithShared(entry, primaryBlocks, exit);
  const optionalRoute = routeWithShared(entry, optionalBlocks, exit);
  const rewardHost = optionalBlocks.reduce((closest, candidate) => (
    !closest || Math.abs(candidate.routeT - .5) < Math.abs(closest.routeT - .5)
      ? candidate
      : closest
  ), null);
  const blocks = [entry, ...primaryBlocks, ...optionalBlocks, exit];
  const primaryGaps = routeGaps(primaryRoute);
  const optionalGaps = routeGaps(optionalRoute);
  const primaryVerticalDeltas = routeVerticalDeltas(primaryRoute);
  const optionalVerticalDeltas = routeVerticalDeltas(optionalRoute);
  const generationFailures = [
    ...safeRefinement.failures.map(failure => summarizeFailure('primary', failure)),
    ...hardRefinement.failures.map(failure => summarizeFailure('optional', failure)),
  ];
  if (!advancedEdges.length) {
    generationFailures.push({
      route: 'optional',
      reason: 'noAdvancedCentralEdge',
      attemptedPrimitiveIds: advancedPrimitives.map(primitive => primitive.id),
    });
  }

  return Object.freeze({
    id: 'fork-high-reward-01',
    kind: 'fork',
    dynamic: true,
    width: encounterSpan + FORK_GEOMETRY.sharedWidth,
    minY: Math.min(...blocks.map(item => item.y)),
    maxY: Math.max(...blocks.map(item => item.y + item.h)),
    blocks: Object.freeze(blocks),
    rewardSocket: Object.freeze({
      blockId: rewardHost?.id || optionalBlocks[0]?.id,
      offsetX: (rewardHost?.w || optionalBlocks[0]?.w || 100) / 2,
      offsetY: -36,
    }),
    generation: Object.freeze({
      referenceScreenWorldWidth,
      encounterScreenCount,
      encounterSpan,
      openingSpan,
      openRouteSpan,
      closingSpan,
      maximumSeparation,
      safeRouteLength: safePolyline.length,
      hardRouteLength: hardPolyline.length,
      primaryCount: primaryBlocks.length,
      optionalCount: optionalBlocks.length,
      primaryAverageWidth: average(primaryBlocks.map(item => item.w)),
      optionalAverageWidth: average(optionalBlocks.map(item => item.w)),
      primaryAverageGap: average(primaryGaps),
      optionalAverageGap: average(optionalGaps),
      primaryAverageVerticalDelta: average(primaryVerticalDeltas),
      optionalAverageVerticalDelta: average(optionalVerticalDeltas),
      safeVariationAmplitude,
      hardVariationAmplitude,
      safeRegionMetrics: safeInitial.regionMetrics,
      hardRegionMetrics: hardInitial.regionMetrics,
      safeRefinementCount: safeRefinement.refinementCount,
      hardRefinementCount: hardRefinement.refinementCount,
      advancedCentralEdges: advancedEdges.map(edge => ({
        from: edge.from.id,
        to: edge.to.id,
        passingPrimitiveIds: edge.advanced.passingPrimitiveIds,
        gap: edge.advanced.gap,
        rise: edge.advanced.rise,
        drop: edge.advanced.drop,
      })),
      generationFailures,
      separationAtOpeningEnd: separationAtDistance(
        openingSpan,
        maximumSeparation,
        openingSpan,
        encounterSpan,
        closingSpan,
      ),
      separationAtCenter: separationAtDistance(
        encounterSpan / 2,
        maximumSeparation,
        openingSpan,
        encounterSpan,
        closingSpan,
      ),
      separationAtClosingStart: separationAtDistance(
        encounterSpan - closingSpan,
        maximumSeparation,
        openingSpan,
        encounterSpan,
        closingSpan,
      ),
    }),
  });
}

const TOWER_SAFE_FALL_TEMPLATE = Object.freeze({
  id: 'tower-safe-fall-01',
  kind: 'tower',
  width: 1035,
  minY: -185,
  maxY: 144,
  blocks: Object.freeze([
    block('entry', 0, 0, 180, 'shared', 0, 0),
    block('safe-floor-a', 190, 90, 230, 'primary', 1, null),
    block('safe-floor-b', 425, 90, 410, 'primary', 2, null),
    block('step-a', 205, -110, 120, 'optional', null, 1),
    block('step-b', 365, -145, 110, 'optional', null, 2),
    block('step-c', 525, -170, 105, 'optional', null, 3),
    block('top', 660, -185, 135, 'optional', null, 4),
    block('exit', 845, 0, 190, 'shared', 3, 5, { campaignAnchor: true }),
  ]),
  rewardSocket: Object.freeze({ blockId: 'top', offsetX: 68, offsetY: -36 }),
});

export const TRAVERSAL_ENCOUNTER_TEMPLATES = Object.freeze({
  'fork-high-reward-01': Object.freeze({
    id: 'fork-high-reward-01',
    kind: 'fork',
    dynamic: true,
  }),
  'tower-safe-fall-01': TOWER_SAFE_FALL_TEMPLATE,
});

export function getTraversalEncounterTemplate(id, options = {}) {
  if (id === 'fork-high-reward-01') return createForkTraversalTemplate(options);
  return TRAVERSAL_ENCOUNTER_TEMPLATES[id] || null;
}
