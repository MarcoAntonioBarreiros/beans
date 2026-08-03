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

// FAIXA VERTICAL DOS ORGANISMOS
// =============================
//
// Os módulos de organismo prendiam Y em faixas absolutas — [74, H-104] para os
// nichos, [62, H-68] para a escolta que segue Miguelito. Escritas quando o
// mundo tinha UMA tela de altura, viraram um teto: com a silhueta planejada a
// rota principal sobe até Y negativo, e todo organismo ficava pendurado no
// fundo da tela antiga. A escolta chegava a aparecer ABAIXO do jogador em vez
// de acima dele, porque `playerY - 42` caía fora do clamp.
//
// É o mesmo defeito da senoide de `geometry.js`, do `[220, 560]` e do
// `[250, 555]` do fallback: limite absoluto sobrevivendo a uma mudança de
// escala do mundo. Aqui o limite passa a sair da geometria real.
//
// A abertura é só para CIMA, de propósito. Embaixo continuam os hazards em
// y=674, e afrouxar aquele lado poria organismo dentro da zona letal — somar
// sem quebrar o que já funcionava.
const ORGANISM_HEADROOM = 130;

export function organismVerticalBounds(level, { topMargin = 62, bottomMargin = 68 } = {}) {
  const defaultMinimum = topMargin;
  const geometryTop = Number(level?.geometryTopY);
  return {
    minY: finite(geometryTop)
      ? Math.min(defaultMinimum, geometryTop - ORGANISM_HEADROOM)
      : defaultMinimum,
    maxY: H - bottomMargin,
  };
}

// FAIXA VERTICAL DAS HIFAS
// ========================
//
// Micorriza, Trichoderma e o fungo oportunista prendiam as pontas em faixas
// absolutas — [58, H-48], [54, H-48], [48, H-48]. Nasceram quando o mundo tinha
// UMA tela de altura e viraram teto: na Fase 10 a rota principal sobe para Y
// negativo, a colônia de micorriza fica lá em cima e a primeira ponta da hifa
// era jogada de volta para y=58 no primeiro quadro — um salto visível entre o
// esporo e a hifa, seguido da ponta morrendo por sair dos limites.
//
// O teto agora sai da geometria real, e SÓ desce abaixo do valor histórico
// quando a geometria de fato sobe. Em fase plana o número é idêntico ao de
// antes, então nada muda onde nada estava quebrado.
//
// O piso continua absoluto DE PROPÓSITO: embaixo estão os hazards e a zona
// letal, e afrouxar aquele lado poria hifa dentro deles. É o mesmo critério de
// `organismVerticalBounds`.
const HYPHAL_HEADROOM = 130;

export function hyphalWorldBounds(level, { topMargin = 58, bottomMargin = 48, headroom = HYPHAL_HEADROOM } = {}) {
  const geometryTop = Number(level?.geometryTopY);
  const opensUpward = finite(geometryTop) && geometryTop < topMargin;
  return {
    minX: 8,
    maxX: Math.max(64, (Number(level?.endX) || 6500) - 8),
    minY: opensUpward ? geometryTop - headroom : topMargin,
    maxY: H - bottomMargin,
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
