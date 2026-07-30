const POSITIONED_COLLECTIONS = Object.freeze([
  'platforms', 'exudates', 'crystals', 'enemies', 'allies', 'checkpoints',
]);

function routePlatform(level, logicIndex) {
  return (level.platforms || []).find(platform => (
    !platform.recovery && !platform.final && platform.logicIndex === logicIndex
  ));
}

function shiftDownstream(level, fromX, deltaX, deltaY) {
  for (const collectionName of POSITIONED_COLLECTIONS) {
    for (const entity of level[collectionName] || []) {
      if (!Number.isFinite(entity.x) || entity.x < fromX) continue;
      entity.x += deltaX;
      if (Number.isFinite(entity.y)) entity.y += deltaY;
    }
  }
  if (Number.isFinite(level.endX)) level.endX += deltaX;
  if (Number.isFinite(level.cameraMaxX)) level.cameraMaxX += deltaX;
}

/**
 * Autora a primeira travessia micorrizica sem substituir o runtime procedural:
 * a estrutura real ainda nasce do exsudato e so recebe colisao quando madura.
 */
export function applyPhaseFourMycorrhizaIntro(level, phase, config = {}) {
  if (phase !== 4) return null;
  const sourceChunk = Number(config.introSourceChunk);
  const targetChunk = Number(config.introTargetChunk);
  const desiredGap = Number(config.introGap);
  const verticalOffset = Number(config.introVerticalOffset);
  if (![sourceChunk, targetChunk, desiredGap, verticalOffset].every(Number.isFinite)) return null;

  const source = routePlatform(level, sourceChunk);
  const target = routePlatform(level, targetChunk);
  if (!source || !target || target.x <= source.x) return null;

  const oldTargetX = target.x;
  const desiredTargetX = source.x + source.w + desiredGap;
  const desiredTargetY = source.y - verticalOffset;
  const deltaX = desiredTargetX - target.x;
  const deltaY = desiredTargetY - target.y;
  shiftDownstream(level, oldTargetX, deltaX, deltaY);

  source.type = 'root';
  source.mycorrhizaIntroHost = true;
  target.mycorrhizaIntroDestination = true;
  return {
    source,
    target,
    gap: target.x - (source.x + source.w),
    verticalOffset: source.y - target.y,
  };
}
