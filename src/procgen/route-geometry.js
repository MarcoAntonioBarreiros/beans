const ANCHORED_COLLECTIONS = Object.freeze([
  'checkpoints',
  'exudates',
  'crystals',
  'enemies',
  'allies',
  'ironDeposits',
  'microbeEncounters',
  'authoredEncounters',
]);

function routePlatforms(level) {
  return getPrimaryTraversalPlatforms(level);
}

function explicitPlatform(level, entity) {
  for (const key of ['platform', 'hostPlatform', 'targetPlatform', 'parentPlatform']) {
    const platform = entity?.[key];
    if (platform && (level.platforms || []).includes(platform)) return platform;
  }
  if (entity?.platformId == null) return null;
  return (level.platforms || []).find(platform => (
    platform.id === entity.platformId || platform.platformId === entity.platformId
  )) || null;
}

function platformByLogicIndex(level, entity) {
  if (!Number.isInteger(entity?.logicIndex)) return null;
  return getChunkAnchorPlatform(level, entity.logicIndex);
}

function platformByLegacyX(level, entity) {
  if (!Number.isFinite(entity?.x)) return null;
  return routePlatforms(level).find(platform => (
    entity.x >= platform.x && entity.x <= platform.x + platform.w
  )) || null;
}

export function resolveEntityPlatform(level, entity) {
  return explicitPlatform(level, entity)
    || platformByLogicIndex(level, entity)
    || platformByLegacyX(level, entity);
}

function collectionEntries(level) {
  return ANCHORED_COLLECTIONS.flatMap(name => (
    (level[name] || []).map(entity => ({ name, entity }))
  ));
}

// Captura o vínculo antes das transformações e sincroniza uma única vez no fim.
// Novas entidades (por exemplo encontros gerados depois do desafio) podem ser
// capturadas sem substituir o offset original das que já existiam.
export function createRouteAnchorRegistry(level) {
  const anchors = new Map();

  function capture() {
    for (const { name, entity } of collectionEntries(level)) {
      if (!entity || anchors.has(entity)) continue;
      const platform = resolveEntityPlatform(level, entity);
      if (!platform || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue;
      anchors.set(entity, {
        name,
        platform,
        platformId: entity.platformId ?? platform.id ?? platform.platformId ?? null,
        logicIndex: Number.isInteger(entity.logicIndex)
          ? entity.logicIndex
          : platform.logicIndex,
        offsetX: entity.x - platform.x,
        offsetY: entity.y - platform.y,
        leftOffset: Number.isFinite(entity.left) ? entity.left - platform.x : null,
        rightOffset: Number.isFinite(entity.right) ? entity.right - platform.x : null,
      });
    }
    return anchors;
  }

  function synchronize() {
    for (const [entity, anchor] of anchors) {
      const platform = (level.platforms || []).includes(anchor.platform)
        ? anchor.platform
        : resolveEntityPlatform(level, {
            platformId: anchor.platformId,
            logicIndex: anchor.logicIndex,
            x: entity.x,
          });
      if (!platform) continue;
      entity.x = platform.x + anchor.offsetX;
      entity.y = platform.y + anchor.offsetY;
      if (anchor.leftOffset != null) entity.left = platform.x + anchor.leftOffset;
      if (anchor.rightOffset != null) entity.right = platform.x + anchor.rightOffset;
    }
    return anchors.size;
  }

  return {
    capture,
    synchronize,
    get size() { return anchors.size; },
    get anchors() { return anchors; },
  };
}

export function recordRouteGeometryStage(level, stage) {
  const snapshot = {
    stage,
    platforms: routePlatforms(level).map(platform => ({
      logicIndex: platform.logicIndex,
      x: platform.x,
      y: platform.y,
      signatureChallenge: platform.signatureChallenge || false,
      azospirillumLadderDestination: Boolean(platform.azospirillumLadderDestination),
    })),
  };
  level.routeGeometryTrace = [...(level.routeGeometryTrace || []), snapshot];
  return snapshot;
}
import {
  getChunkAnchorPlatform,
  getPrimaryTraversalPlatforms,
} from './traversal-route.js';
