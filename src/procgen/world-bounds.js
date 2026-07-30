import { H } from '../core/constants.js';

function finite(value) {
  return Number.isFinite(Number(value));
}

function includePoint(bounds, y) {
  if (!finite(y)) return;
  bounds.minY = Math.min(bounds.minY, Number(y));
  bounds.maxY = Math.max(bounds.maxY, Number(y));
}

function includeBox(bounds, entity) {
  if (!entity || !finite(entity.y)) return;
  const y = Number(entity.y);
  const height = finite(entity.h) ? Math.max(0, Number(entity.h)) : 0;
  includePoint(bounds, y);
  includePoint(bounds, y + height);
}

function includeDecorativeRoot(bounds, root) {
  includeBox(bounds, root);
  if (!root || !finite(root.y) || !finite(root.len) || !finite(root.ang)) return;
  includePoint(bounds, Number(root.y) + Math.sin(Number(root.ang)) * Number(root.len));
}

function includeStructure(bounds, structure) {
  includeBox(bounds, structure);
  includePoint(bounds, structure?.startY);
  includePoint(bounds, structure?.endY);
  includePoint(bounds, structure?.topY);
  includePoint(bounds, structure?.bottomY);
  for (const point of structure?.points || structure?.steps || structure?.segments || []) {
    includeBox(bounds, point);
    includePoint(bounds, point?.startY);
    includePoint(bounds, point?.endY);
  }
}

export function calculateWorldGeometryBounds(level) {
  const bounds = { minY: Infinity, maxY: -Infinity };
  for (const platform of level?.platforms || []) includeBox(bounds, platform);
  for (const root of level?.roots || []) includeDecorativeRoot(bounds, root);
  for (const key of [
    'nitrogenRoots',
    'azospirillumRootLadders',
    'mycorrhizaStructures',
    'phosphateStructures',
  ]) {
    for (const structure of level?.[key] || []) includeStructure(bounds, structure);
  }
  if (!finite(bounds.minY) || !finite(bounds.maxY)) {
    return { geometryTopY: 0, geometryBottomY: H };
  }
  return {
    geometryTopY: bounds.minY,
    geometryBottomY: bounds.maxY,
  };
}

export function synchronizeWorldBounds(level, visibleWorldHeight = H) {
  const geometry = calculateWorldGeometryBounds(level);
  const visibleHeight = Math.max(1, Number(visibleWorldHeight) || H);
  const margin = Math.max(180, visibleHeight * .35);
  level.geometryTopY = geometry.geometryTopY;
  level.geometryBottomY = geometry.geometryBottomY;
  level.worldTopY = geometry.geometryTopY - margin;
  level.worldBottomY = geometry.geometryBottomY + margin;
  level.worldVerticalMargin = margin;
  return {
    ...geometry,
    worldTopY: level.worldTopY,
    worldBottomY: level.worldBottomY,
    margin,
  };
}
