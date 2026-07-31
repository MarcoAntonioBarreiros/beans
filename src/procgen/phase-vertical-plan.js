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

// Envelope global. A faixa de hoje tem 330 px (235..565); esta tem 480. O mundo
// e a câmera acompanham porque `calculateWorldGeometryBounds` deriva os limites
// da geometria real — é o mesmo motivo pelo qual a rota opcional consegue viver
// em Y negativo.
export const PHASE_VERTICAL_ENVELOPE = Object.freeze({ top: 120, bottom: 600 });

// Meia-largura da faixa em torno da linha-alvo. Estreita demais e o relevo local
// desaparece (todo passo vira o mesmo passo); larga demais e a intenção da zona
// se dilui na aleatoriedade que já existia.
const BAND_HALF_HEIGHT = 52;

export const PHASE_SILHOUETTE_CONTRACTS = Object.freeze({
  minimumVerticalRange: 200,
  minimumSustainedRun: 3,
  maximumMonotonicShare: 0.6,
  minimumClimbZones: 1,
  minimumDropZones: 1,
});

// As famílias falam em FRAÇÃO DE CHUNKS, não em pixels de largura: a mesma
// silhueta serve a uma fase de 24 e a uma de 48 chunks. `verticalDelta` é
// assinado — negativo sobe.
const FAMILY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'ridge-valley',
    label: 'Crista e vale',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', weight: 0.9, verticalDelta: [-29, 29] }),
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 1.2, verticalDelta: [-304, -218] }),
      Object.freeze({ role: 'ridge', verticalIntent: 'crest', weight: 0.8, verticalDelta: [-58, 29] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.3, verticalDelta: [276, 406] }),
      Object.freeze({ role: 'valley', verticalIntent: 'valley', weight: 0.9, verticalDelta: [-29, 58] }),
      Object.freeze({ role: 'recovery', verticalIntent: 'recover', weight: 1.1, verticalDelta: [-261, -160] }),
    ]),
  }),
  Object.freeze({
    id: 'open-tower',
    label: 'Torre aberta',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', weight: 0.8, verticalDelta: [-29, 29] }),
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 1.6, verticalDelta: [-435, -319] }),
      Object.freeze({ role: 'upper', verticalIntent: 'hold', weight: 1.2, verticalDelta: [-58, 58] }),
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 0.9, verticalDelta: [-203, -116] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.5, verticalDelta: [377, 522] }),
    ]),
  }),
  Object.freeze({
    id: 'descending-canyon',
    label: 'Descida em cânion',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', weight: 0.8, verticalDelta: [-44, 14] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.5, verticalDelta: [334, 464] }),
      Object.freeze({ role: 'valley', verticalIntent: 'valley', weight: 1.0, verticalDelta: [-44, 72] }),
      Object.freeze({ role: 'recovery', verticalIntent: 'recover', weight: 1.3, verticalDelta: [-319, -218] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.0, verticalDelta: [174, 290] }),
      Object.freeze({ role: 'exit', verticalIntent: 'hold', weight: 0.8, verticalDelta: [-44, 44] }),
    ]),
  }),
  Object.freeze({
    id: 'double-crest',
    label: 'Duas cristas',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', weight: 0.8, verticalDelta: [-29, 29] }),
      Object.freeze({ role: 'ridge', verticalIntent: 'climb', weight: 1.2, verticalDelta: [-290, -203] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.0, verticalDelta: [218, 319] }),
      Object.freeze({ role: 'valley', verticalIntent: 'valley', weight: 0.9, verticalDelta: [-29, 87] }),
      Object.freeze({ role: 'ridge', verticalIntent: 'climb', weight: 1.3, verticalDelta: [-348, -246] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.0, verticalDelta: [246, 362] }),
    ]),
  }),
  Object.freeze({
    id: 'zigzag',
    label: 'Zigue-zague',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', weight: 0.7, verticalDelta: [-29, 29] }),
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 0.9, verticalDelta: [-246, -174] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 0.9, verticalDelta: [188, 276] }),
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 0.9, verticalDelta: [-276, -203] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 0.9, verticalDelta: [218, 304] }),
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 0.9, verticalDelta: [-232, -160] }),
      Object.freeze({ role: 'exit', verticalIntent: 'descend', weight: 0.8, verticalDelta: [130, 218] }),
    ]),
  }),
  Object.freeze({
    id: 'long-plateau',
    label: 'Platô longo e queda',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', weight: 0.8, verticalDelta: [-29, 29] }),
      Object.freeze({ role: 'climb', verticalIntent: 'climb', weight: 1.1, verticalDelta: [-290, -218] }),
      Object.freeze({ role: 'plateau', verticalIntent: 'hold', weight: 2.0, verticalDelta: [-72, 72] }),
      Object.freeze({ role: 'descent', verticalIntent: 'descend', weight: 1.4, verticalDelta: [362, 493] }),
      Object.freeze({ role: 'exit', verticalIntent: 'recover', weight: 0.9, verticalDelta: [-174, -87] }),
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
