// Plano vertical da fase — silhueta da rota principal
// ====================================================
//
// A rota principal da Fase 10 não é plana: medindo 12 seeds, ela tem 470 px de
// amplitude e 81 px de |dy| médio por passo. O problema é outro — a maior
// corrida na MESMA direção é de 2 a 4 passos num percurso de 40. Ou seja: uma
// caminhada aleatória dentro de uma faixa, não uma silhueta. O jogador nunca
// escala nada nem desce para lugar nenhum; ele serpenteia.
//
// A causa está em `stabilizeGeometry`: cada passo é limitado em relação ao
// anterior e o conjunto é preso em `clamp(y, 235, 565)`. Ninguém tem uma
// opinião sobre o PERCURSO.
//
// Este módulo dá essa opinião. Ele não cria plataformas nem toca em geometria:
// devolve, para cada chunk do grafo lógico, a faixa vertical que aquele trecho
// deveria ocupar. O gerador continua colocando as plataformas com a mesma
// física de sempre — só passa a mirar uma faixa que se move de propósito.
//
// Sem plano, o gerador mantém exatamente o comportamento atual. É esse o
// fallback: não é um segundo caminho a manter, é a ausência deste.

import { createRandom } from './random.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const lerp = (a, b, t) => a + (b - a) * t;

// Envelope global. A faixa de hoje tem 330 px (235..565); esta tem 820 e entra
// em Y negativo. O mundo e a câmera acompanham porque
// `calculateWorldGeometryBounds` deriva os limites da geometria real — é o
// mesmo motivo pelo qual a rota opcional já vive acima de zero.
export const PHASE_VERTICAL_ENVELOPE = Object.freeze({ top: -220, bottom: 600 });

// Meia-largura da faixa em torno da linha-alvo. Estreita demais e o relevo local
// desaparece (todo passo vira o mesmo passo); larga demais e a intenção da zona
// se dilui na aleatoriedade que já existia.
const BAND_HALF_HEIGHT = 46;

export const PHASE_SILHOUETTE_CONTRACTS = Object.freeze({
  // 430 px é ~60% de uma tela de 720. Abaixo disso a silhueta existe nos
  // números e não existe para quem joga — foi o que aconteceu na primeira
  // versão, que subia 41% de uma tela ao longo de dez telas de largura.
  minimumVerticalRange: 430,
  minimumSustainedRun: 5,
  maximumMonotonicShare: 0.6,
  minimumClimbZones: 1,
  minimumDropZones: 1,
});

// As famílias falam em FRAÇÃO DE CHUNKS, não em pixels de largura: a mesma
// silhueta serve a uma fase de 24 e a uma de 48 chunks. `verticalDelta` é
// assinado — negativo sobe.
// Poucas zonas, longas. A primeira versão tinha 5 a 7 zonas em 40 chunks — 6 a
// 8 chunks cada. Como `traversalLimits` deixa cada passo subir no máximo 46 a
// 92 px, uma zona de 7 chunks nunca passa de ~300 px de altura, e 300 px numa
// fase de 10 telas de largura é visualmente plano.
//
// Com 3 a 5 zonas, uma subida ganha 10 a 15 chunks e pode somar 600 px ou mais.
// É o COMPRIMENTO da zona que vira altura, não o tamanho do passo.
const FAMILY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'open-tower',
    label: 'Torre aberta',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', weight: 0.5, verticalDelta: [-30, 30] }),
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 2.2, verticalDelta: [-780, -580] }),
      Object.freeze({ role: 'summit', verticalIntent: 'hold', weight: 0.9, verticalDelta: [-60, 60] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.6, verticalDelta: [520, 720] }),
    ]),
  }),
  Object.freeze({
    id: 'descending-canyon',
    label: 'Descida em cânion',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', weight: 0.5, verticalDelta: [-30, 20] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.4, verticalDelta: [380, 520] }),
      Object.freeze({ role: 'valley', verticalIntent: 'valley', weight: 0.7, verticalDelta: [-40, 60] }),
      Object.freeze({ role: 'recovery', verticalIntent: 'recover', weight: 2.0, verticalDelta: [-760, -560] }),
    ]),
  }),
  Object.freeze({
    id: 'ridge-valley',
    label: 'Crista e vale',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', weight: 0.5, verticalDelta: [-30, 30] }),
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 1.7, verticalDelta: [-620, -450] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.7, verticalDelta: [480, 660] }),
      Object.freeze({ role: 'recovery', verticalIntent: 'recover', weight: 1.1, verticalDelta: [-400, -270] }),
    ]),
  }),
  Object.freeze({
    id: 'double-crest',
    label: 'Duas cristas',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', weight: 0.4, verticalDelta: [-30, 30] }),
      Object.freeze({ role: 'ridge', verticalIntent: 'climb', weight: 1.3, verticalDelta: [-500, -360] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.1, verticalDelta: [420, 560] }),
      Object.freeze({ role: 'ridge', verticalIntent: 'climb', weight: 1.4, verticalDelta: [-560, -420] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.2, verticalDelta: [430, 580] }),
    ]),
  }),
  Object.freeze({
    id: 'zigzag',
    label: 'Zigue-zague',
    zones: Object.freeze([
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 1.1, verticalDelta: [-430, -320] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.0, verticalDelta: [340, 460] }),
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 1.2, verticalDelta: [-480, -350] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.1, verticalDelta: [380, 500] }),
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 1.0, verticalDelta: [-400, -290] }),
    ]),
  }),
  Object.freeze({
    id: 'long-plateau',
    label: 'Platô alto e queda',
    zones: Object.freeze([
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 1.6, verticalDelta: [-620, -470] }),
      Object.freeze({ role: 'plateau', verticalIntent: 'hold', weight: 2.0, verticalDelta: [-70, 70] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.7, verticalDelta: [600, 780] }),
    ]),
  }),
]);

export const PHASE_SILHOUETTE_FAMILY_IDS = Object.freeze(
  FAMILY_DEFINITIONS.map(family => family.id),
);

export function phaseSilhouetteFamilies() {
  return FAMILY_DEFINITIONS;
}

function pickInRange(random, [minimum, maximum]) {
  return lerp(minimum, maximum, random());
}

/**
 * Constrói o plano vertical de uma fase. Não cria geometria: devolve, para cada
 * chunk, a faixa que o gerador deve mirar.
 */
export function createPhaseVerticalPlan({
  seedValue = '',
  phase = 10,
  totalChunks = 40,
  baseY = 500,
  familyId = null,
  envelope = PHASE_VERTICAL_ENVELOPE,
} = {}) {
  if (!Number.isFinite(totalChunks) || totalChunks < 8) return null;
  const random = createRandom(`${seedValue}:phase-silhouette:p${phase}`);
  // Duas extrações descartadas antes de escolher a família. O Mulberry32 é bom,
  // mas o PRIMEIRO valor de sementes textualmente parecidas ("tela-1:fase-10",
  // "tela-2:fase-10"...) fica agrupado: em 16 seeds, uma das seis famílias não
  // saía nenhuma vez. Aquecer o gerador espalha a escolha.
  random();
  random();
  const family = familyId
    ? FAMILY_DEFINITIONS.find(entry => entry.id === familyId)
    : FAMILY_DEFINITIONS[Math.floor(random() * FAMILY_DEFINITIONS.length)];
  if (!family) return null;

  const totalWeight = family.zones.reduce((sum, zone) => sum + zone.weight, 0);
  const zones = [];
  let cursorChunk = 0;
  let currentY = clamp(baseY, envelope.top, envelope.bottom);

  family.zones.forEach((definition, index) => {
    const isLast = index === family.zones.length - 1;
    const rawSpan = (definition.weight / totalWeight) * totalChunks;
    const chunkSpan = isLast
      ? Math.max(1, totalChunks - cursorChunk)
      : Math.max(2, Math.round(rawSpan));
    const fromChunk = cursorChunk;
    const toChunk = Math.min(totalChunks - 1, cursorChunk + chunkSpan - 1);
    const startY = currentY;
    const delta = pickInRange(random, definition.verticalDelta);
    const endY = clamp(startY + delta, envelope.top, envelope.bottom);

    zones.push({
      id: `${family.id}:z${index}:${definition.role}`,
      order: index,
      role: definition.role,
      verticalIntent: definition.verticalIntent,
      fromChunk,
      toChunk,
      chunkSpan: toChunk - fromChunk + 1,
      startY: Math.round(startY),
      endY: Math.round(endY),
      // O delta REALIZADO, depois do envelope: é ele que conta para os
      // contratos, não o sorteado.
      realizedDelta: Math.round(endY - startY),
    });
    currentY = endY;
    cursorChunk = toChunk + 1;
  });

  const ys = zones.flatMap(zone => [zone.startY, zone.endY]);
  const verticalRange = Math.max(...ys) - Math.min(...ys);
  const climbZones = zones.filter(zone => zone.realizedDelta < -40).length;
  const dropZones = zones.filter(zone => zone.realizedDelta > 40).length;

  const plan = {
    familyId: family.id,
    familyLabel: family.label,
    phase,
    totalChunks,
    baseY: Math.round(baseY),
    envelope,
    bandHalfHeight: BAND_HALF_HEIGHT,
    zones,
    verticalRange,
    climbZones,
    dropZones,
    signature: [
      family.id,
      zones.map(zone => zone.verticalIntent).join('>'),
      zones.map(zone => zone.realizedDelta).join(','),
    ].join('|'),
  };
  return plan;
}

export function validatePhaseVerticalPlan(plan) {
  const violations = [];
  if (!plan) return ['missing-plan'];
  if (plan.verticalRange < PHASE_SILHOUETTE_CONTRACTS.minimumVerticalRange) {
    violations.push(`vertical-range-too-small:${plan.verticalRange}`);
  }
  if (plan.climbZones < PHASE_SILHOUETTE_CONTRACTS.minimumClimbZones) {
    violations.push('no-climb-zone');
  }
  if (plan.dropZones < PHASE_SILHOUETTE_CONTRACTS.minimumDropZones) {
    violations.push('no-drop-zone');
  }
  const sustained = plan.zones.filter(zone => (
    Math.abs(zone.realizedDelta) > 40
    && zone.chunkSpan >= PHASE_SILHOUETTE_CONTRACTS.minimumSustainedRun
  ));
  if (!sustained.length) violations.push('no-sustained-run');
  return violations;
}

/**
 * Faixa vertical que o chunk `index` deveria ocupar. Interpola linearmente
 * dentro da zona: a linha-alvo se move a cada chunk, e é esse movimento que
 * transforma passos aleatórios numa subida ou numa descida legível.
 */
export function verticalBandAt(plan, index) {
  if (!plan) return null;
  const zone = plan.zones.find(entry => index >= entry.fromChunk && index <= entry.toChunk)
    || (index < plan.zones[0].fromChunk ? plan.zones[0] : plan.zones.at(-1));
  const span = Math.max(1, zone.toChunk - zone.fromChunk);
  const progress = clamp((index - zone.fromChunk) / span, 0, 1);
  const target = lerp(zone.startY, zone.endY, progress);
  const half = plan.bandHalfHeight;
  return {
    zoneId: zone.id,
    role: zone.role,
    verticalIntent: zone.verticalIntent,
    target: Math.round(target),
    top: Math.round(Math.max(plan.envelope.top, target - half)),
    bottom: Math.round(Math.min(plan.envelope.bottom, target + half)),
  };
}
