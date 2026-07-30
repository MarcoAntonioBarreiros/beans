function hasTraversalMetadata(platform) {
  return Boolean(platform?.encounterInstanceId || platform?.traversalEncounterId);
}

export function isOptionalDetourPlatform(platform) {
  return Boolean(
    platform
    && platform.routeRole === 'optional'
    && platform.routeScope === 'optional'
    && platform.optionalDetourId,
  );
}

export function isSharedTraversalPlatform(platform) {
  return hasTraversalMetadata(platform) && platform.routeRole === 'shared';
}

export function isPrimaryTraversalPlatform(platform) {
  if (!platform || platform.recovery || platform.final) return false;
  if (isOptionalDetourPlatform(platform)) return false;
  if (!hasTraversalMetadata(platform)) return true;
  return isSharedTraversalPlatform(platform)
    || platform.routeRole === 'primary'
    || platform.isPrimaryRoute === true;
}

export function isOptionalTraversalPlatform(platform) {
  if (!platform || platform.recovery || platform.final) return false;
  if (isOptionalDetourPlatform(platform)) return true;
  if (!hasTraversalMetadata(platform)) return false;
  return isSharedTraversalPlatform(platform)
    || platform.routeRole === 'optional'
    || platform.isOptionalRoute === true;
}

export function isOptionalOnlyTraversalPlatform(platform) {
  return isOptionalTraversalPlatform(platform) && !isPrimaryTraversalPlatform(platform);
}

function routeOrder(platform, key) {
  return Number.isFinite(platform?.[key]) ? platform[key] : Number.MAX_SAFE_INTEGER;
}

function byDeclaredRoute(key) {
  return (left, right) => (
    (left.logicIndex ?? Number.MAX_SAFE_INTEGER) - (right.logicIndex ?? Number.MAX_SAFE_INTEGER)
    || routeOrder(left, key) - routeOrder(right, key)
    || left.x - right.x
  );
}

export function getPrimaryTraversalPlatforms(level) {
  return (level?.platforms || [])
    .filter(platform => (
      isPrimaryTraversalPlatform(platform)
      && Number.isInteger(platform.logicIndex)
      && platform.logicIndex >= 0
    ))
    .sort(byDeclaredRoute('primaryRouteOrder'));
}

export function getOptionalTraversalPlatforms(level) {
  return (level?.platforms || [])
    .filter(isOptionalTraversalPlatform)
    .sort(byDeclaredRoute('optionalRouteOrder'));
}

export function getOptionalDetourPlatforms(level, optionalDetourId = null) {
  return (level?.platforms || [])
    .filter(platform => (
      isOptionalDetourPlatform(platform)
      && (!optionalDetourId || platform.optionalDetourId === optionalDetourId)
    ))
    .sort((left, right) => (
      routeOrder(left, 'optionalRouteOrder') - routeOrder(right, 'optionalRouteOrder')
      || left.x - right.x
    ));
}

export function getOptionalDetourModules(level, optionalDetourId = null) {
  const modules = new Map();
  for (const platform of getOptionalDetourPlatforms(level, optionalDetourId)) {
    if (!platform.detourModuleId) continue;
    const entry = modules.get(platform.detourModuleId) || {
      id: platform.detourModuleId,
      optionalDetourId: platform.optionalDetourId,
      platformIds: [],
    };
    entry.platformIds.push(platform.platformId ?? platform.id);
    modules.set(platform.detourModuleId, entry);
  }
  return [...modules.values()];
}

export function getPrimaryPlatformsInsideDetour(level, optionalDetourId) {
  const detour = (level?.optionalDetours || [])
    .find(candidate => candidate.id === optionalDetourId);
  if (!detour) return [];
  const start = Number(detour.startLogicIndex);
  const end = Number(detour.endLogicIndex);
  return getPrimaryTraversalPlatforms(level)
    .filter(platform => platform.logicIndex >= start && platform.logicIndex <= end);
}

export function getChunkAnchorPlatform(level, logicIndex) {
  if (!Number.isInteger(logicIndex)) return null;
  const matches = (level?.platforms || []).filter(platform => (
    !platform.recovery
    && !platform.final
    && platform.logicIndex === logicIndex
  ));
  if (!matches.length) return null;
  return matches.find(platform => platform.campaignAnchor === true)
    || matches.find(platform => platform.blockRole === 'exit')
    || matches.find(isPrimaryTraversalPlatform)
    || matches[0];
}
