import { validateChunk } from './agents.js';

const DEFAULT_AGENT_TYPES = Object.freeze(['normal']);
const RESULT_CACHE = new Map();
const MAX_CACHE_ENTRIES = 4096;

function unique(values) {
  return [...new Set(values)];
}

function cacheKey(from, to, primitives, agentTypes) {
  const geometry = [
    from.x,
    from.y,
    from.w,
    from.h,
    to.x,
    to.y,
    to.w,
    to.h,
  ].join(',');
  const primitiveIds = primitives.map(primitive => primitive?.id || '').join(',');
  return `${geometry}|${primitiveIds}|${agentTypes.join(',')}`;
}

function remember(key, result) {
  if (RESULT_CACHE.size >= MAX_CACHE_ENTRIES) RESULT_CACHE.clear();
  RESULT_CACHE.set(key, result);
  return result;
}

export function edgeMeasurements(from, to) {
  const gap = to.x - (from.x + from.w);
  const rise = from.y - to.y;
  const drop = to.y - from.y;
  const centerDistance = (to.x + to.w / 2) - (from.x + from.w / 2);
  return { gap, rise, drop, centerDistance };
}

export function canTraverseEdge({
  from,
  to,
  primitives = [],
  agentTypes = DEFAULT_AGENT_TYPES,
}) {
  const timings = agentTypes.length ? agentTypes : DEFAULT_AGENT_TYPES;
  const key = cacheKey(from, to, primitives, timings);
  const cached = RESULT_CACHE.get(key);
  if (cached) return cached;

  const attemptedPrimitiveIds = [];
  const attemptedTimings = [];

  for (const primitive of primitives) {
    if (!primitive?.id) continue;
    attemptedPrimitiveIds.push(primitive.id);
    for (const agentType of timings) {
      attemptedTimings.push(agentType);
      const valid = validateChunk(
        { ...from },
        { ...to },
        primitive,
        agentType,
      );
      if (!valid) continue;
      const passingAttempt = {
        primitiveId: primitive.id,
        timing: agentType,
      };
      return remember(key, {
        valid: true,
        passingPrimitiveIds: [primitive.id],
        passingAttempts: [passingAttempt],
        attemptedPrimitiveIds: unique(attemptedPrimitiveIds),
        attemptedTimings: unique(attemptedTimings),
        ...edgeMeasurements(from, to),
      });
    }
  }

  return remember(key, {
    valid: false,
    passingPrimitiveIds: [],
    passingAttempts: [],
    attemptedPrimitiveIds: unique(attemptedPrimitiveIds),
    attemptedTimings: unique(attemptedTimings),
    ...edgeMeasurements(from, to),
  });
}
