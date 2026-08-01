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
// Altura de um degrau servido por escada de Azospirillum. Vem do acesso da rota
// opcional (`ACCESS_VERTICAL_RISES`, 230 a 340 px), que é a faixa que o runtime
// da escada já sabe construir e o jogador já sabe usar.
export const AZO_ASCENT_RISE_RANGE = Object.freeze([240, 330]);

// Chunk mínimo para um portão. Abaixo de 4 o gerador ainda está no regime
// "forgiving" (maxRise 28) e o trecho serve de aquecimento — pôr uma escada ali
// tranca o jogador antes de ele ter checkpoint.
//
// 6, e não 4, porque o portão precisa de espaço ANTES dele: o jogador tem de
// cruzar com o Azospirillum, recrutá-lo e colher um exsudato. Com o portão em
// c4 sobravam três chunks para as três coisas.
export const ASCENT_GATE_MINIMUM_CHUNK = 6;

// PORTÕES DA ROTA PRINCIPAL — três tipos, um mecanismo
// ====================================================
//
// Um portão é um passo que a física do salto NÃO vence e que um organismo
// abre. O Azospirillum foi o primeiro; ele não substitui os outros dois, soma
// a eles. Cada tipo pede uma geometria diferente, e é por isso que os três
// convivem na mesma fase:
//
//   azospirillumAscent — degrau 240 a 330 px ACIMA. Vence o teto de 92 px por
//                        passo de `traversalLimits`. Aberto pela escada.
//   mycorrhizaBridge   — vão largo demais para saltar, e quase sem desnível
//                        porque o runtime da ponte exige |dy| <= 68 com
//                        `horizontalOnly`. Aberto pela ponte de hifas.
//   phosphateWall      — depósito mineral de 190 a 210 px fechando a passagem
//                        sobre a própria plataforma. Aberto pelo pulso de
//                        solubilização. Não mexe na altura da rota.
//
// Vão máximo saltável medido: 430 a 480 px conforme o desnível. O piso de 520
// deixa margem para o pior caso — abaixo disso o jogador pula e a ponte vira
// decoração, que foi o que aconteceu com o fosfato durante toda a campanha.
export const MYCORRHIZA_BRIDGE_GAP_RANGE = Object.freeze([520, 610]);
// O runtime da ponte (`findBridgeTarget`) recusa alvo com |dy| > 68. 60 deixa
// folga para o arredondamento da geometria.
export const MYCORRHIZA_BRIDGE_MAX_DELTA = 60;

export const ROUTE_GATE_KINDS = Object.freeze([
  'azospirillumAscent',
  'mycorrhizaBridge',
  'phosphateWall',
  'nitrogenRootGate',
]);

// O portao de FBN ocupa DOIS chunks: a plataforma que sera removida e a que
// fica depois dela. O vao total (esquerda ate direita) precisa passar de 142 px
// — o salto comum — enquanto cada pouso isolado continua saltavel, senao o
// jogador nao consegue nem chegar ao alvo nem sair dele.
//
// Estes numeros saem de `PHASE_TWO_MAX_ORDINARY_GAP = 142` em nitrogen-root.js:
// 110 + largura do alvo + 110 sempre passa de 142 no total e nunca passa de 142
// em cada perna.
export const NITROGEN_GATE_LANDING_GAP_RANGE = Object.freeze([96, 126]);
export const NITROGEN_GATE_TARGET_WIDTH_RANGE = Object.freeze([104, 140]);

// Cada tipo pede a habilidade que o abre. Sem ela o portão é softlock, não
// desafio — é a mesma regra que já vale para a escada.
export const ROUTE_GATE_REQUIRED_ABILITY = Object.freeze({
  azospirillumAscent: 'azospirillumRoots',
  mycorrhizaBridge: 'mycorrhizaStructures',
  phosphateWall: 'phosphateSolubilization',
  // A FBN nao tem desbloqueio: nodular esta disponivel desde a fase 2. Quem
  // decide se o portao pode existir e a presenca do Rhizobium.
  nitrogenRootGate: null,
});

// A habilidade nao basta: quem ABRE o portao e o ORGANISMO, e o Phase Lab pode
// desliga-lo na caixa de selecao. Sem esta tabela o portao aparecia mesmo com
// o organismo desmarcado — um softlock, e uma regra minha sobrescrevendo a do
// laboratorio.
export const ROUTE_GATE_REQUIRED_ORGANISM = Object.freeze({
  azospirillumAscent: 'azospirillum',
  mycorrhizaBridge: 'myco',
  phosphateWall: 'bacillus',
  nitrogenRootGate: 'rhizobium',
});

/**
 * Chunks em que a subida deixa de ser saltável e passa a exigir escada.
 *
 * É aqui que a verticalidade real nasce. `traversalLimits` deixa cada passo
 * subir 46 a 92 px — teto do salto duplo, e não dá para elevá-lo sem tornar a
 * rota intraversável. Uma zona de 8 chunks chega a ~350 px, o que numa fase de
 * dez telas de largura é uma rampa, não uma torre.
 *
 * A escada de Azospirillum sobe 240 a 330 px em UM passo. Três degraus desses
 * fazem 700 a 1000 px — isso cabe na tela e se lê como torre. O runtime já
 * existe; o que faltava era a rota PEDIR, em vez de a escada procurar onde
 * encaixar depois (foi por isso que ela parecia aparecer por acaso).
 *
 * POR QUE AS DUAS PRIMEIRAS TENTATIVAS FALHARAM. O degrau saía 19 px ABAIXO do
 * hospedeiro em vez de 250 acima, e a hipótese de ids colididos não explicava
 * nada. A causa era o próprio pipeline do chunk, em dois pontos:
 *
 *   1. `stabilizeGeometry` fecha com
 *      `candidate.y = previous.y + clamp(dy, -limits.maxRise, limits.maxDrop)`.
 *      Uma subida de 250 px vira 92 px — o teto do salto duplo — sem aviso.
 *   2. o que sobra é submetido a `validated()`, que reprova; depois de 12
 *      tentativas `createSafeFallback` DESCARTA o candidato e devolve uma
 *      plataforma nova a `previous.y ± 42`. Daí os 19 px para baixo.
 *
 * Ou seja: não havia nada a consertar no plano. Um portão não pode passar por
 * `stabilizeGeometry`/`validated` — ele é geometria autoral, como os encontros
 * de travessia, e o gerador precisa de um ramo próprio que o construa e siga
 * adiante. É o que `generateLevel` faz agora.
 */
export function plannedAscentGates(plan, { minimumZoneRise = 300 } = {}) {
  if (!plan) return [];
  const gates = [];
  for (const zone of plan.zones) {
    if (zone.realizedDelta > -minimumZoneRise) continue;
    // Um degrau a cada ~5 chunks da zona, no máximo três: mais que isso vira
    // elevador, não escalada.
    const count = Math.max(1, Math.min(3, Math.floor(zone.chunkSpan / 5)));
    for (let index = 0; index < count; index++) {
      const at = zone.fromChunk + Math.round(
        ((index + 1) / (count + 1)) * (zone.toChunk - zone.fromChunk),
      );
      if (at < ASCENT_GATE_MINIMUM_CHUNK || at >= plan.totalChunks - 1) continue;
      if (gates.some(gate => Math.abs(gate.chunkIndex - at) < 3)) continue;
      gates.push({
        chunkIndex: at,
        zoneId: zone.id,
        mechanic: 'azospirillumAscent',
        riseRange: AZO_ASCENT_RISE_RANGE,
      });
    }
  }
  return gates;
}

/**
 * Todos os portões da fase, dos três tipos, já distribuídos.
 *
 * A escada vem primeiro porque é a única que EXIGE uma zona específica: sem
 * uma subida longa, um degrau de 300 px não tem para onde ir. Os outros dois
 * são geometria local — um vão largo e uma parede — e cabem em qualquer zona,
 * então preenchem o que sobrou.
 *
 * `kinds` existe para o teste poder isolar um tipo, e para uma fase sem a
 * habilidade correspondente simplesmente não pedir aquele portão.
 */
export function plannedRouteGates(plan, {
  kinds = ROUTE_GATE_KINDS,
  minimumZoneRise = 300,
  maximumBridges = 2,
  maximumWalls = 2,
  maximumNitrogenGates = 3,
  // Distância mínima entre portões, em chunks. Dois desafios colados viram um
  // desafio só, e sem espaço para respirar entre eles.
  minimumSpacing = 4,
} = {}) {
  if (!plan) return [];
  const allowed = new Set(kinds);
  const gates = allowed.has('azospirillumAscent')
    ? plannedAscentGates(plan, { minimumZoneRise })
    : [];
  const free = at => (
    at >= ASCENT_GATE_MINIMUM_CHUNK
    && at < plan.totalChunks - 2
    && !gates.some(gate => Math.abs(gate.chunkIndex - at) < minimumSpacing)
  );

  // RODIZIO ENTRE OS TIPOS, e nao uma passada por tipo.
  //
  // A primeira versao rodava um tipo de cada vez, na ordem em que estao
  // declarados, e quem vinha por ultimo herdava a sobra. Medido em 16 planos:
  // 44 escadas, 29 pontes, 15 paredes e 4 portoes de FBN. O quarto tipo nao
  // "falhava" — ele nunca tinha onde nascer, porque `minimumSpacing` ja estava
  // gasto quando chegava a vez dele.
  //
  // Agora cada tipo coloca UM por rodada, e a ordem das rodadas gira conforme o
  // plano. Ninguem e sempre o primeiro, e ninguem herda so a sobra.
  const ZONE_OFFSETS = [0.5, 0.3, 0.7, 0.2, 0.8];
  const queues = new Map();
  const register = (mechanic, limit, build) => {
    if (!allowed.has(mechanic)) return;
    const slots = [];
    for (const zone of plan.zones) {
      const span = zone.toChunk - zone.fromChunk;
      for (const offset of ZONE_OFFSETS) {
        slots.push({ at: zone.fromChunk + Math.round(span * offset), zone });
      }
    }
    queues.set(mechanic, { slots, limit, build, placed: 0 });
  };

  register('mycorrhizaBridge', maximumBridges, () => ({
    gapRange: MYCORRHIZA_BRIDGE_GAP_RANGE,
    maximumVerticalDelta: MYCORRHIZA_BRIDGE_MAX_DELTA,
  }));
  register('phosphateWall', maximumWalls, () => ({}));
  register('nitrogenRootGate', maximumNitrogenGates, () => ({
    landingGapRange: NITROGEN_GATE_LANDING_GAP_RANGE,
    targetWidthRange: NITROGEN_GATE_TARGET_WIDTH_RANGE,
  }));

  // A ordem gira com o plano: sem isso a micorriza seria sempre a primeira a
  // escolher, do mesmo jeito que a escada era antes.
  const order = [...queues.keys()];
  const rotation = plan.zones.length % Math.max(1, order.length);
  const rotated = [...order.slice(rotation), ...order.slice(0, rotation)];

  let placedInRound = true;
  while (placedInRound) {
    placedInRound = false;
    for (const mechanic of rotated) {
      const queue = queues.get(mechanic);
      if (!queue || queue.placed >= queue.limit) continue;
      const slotIndex = queue.slots.findIndex(slot => free(slot.at));
      if (slotIndex < 0) continue;
      const slot = queue.slots.splice(slotIndex, 1)[0];
      gates.push({
        chunkIndex: slot.at,
        zoneId: slot.zone.id,
        mechanic,
        ...queue.build(slot.zone),
      });
      queue.placed++;
      placedInRound = true;
    }
  }

  return gates.sort((left, right) => left.chunkIndex - right.chunkIndex);
}

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
    // Limites absolutos que `generateGeometry` aplica no nascimento da
    // plataforma. Sem eles a fase continua presa em 220..560, por mais que o
    // plano peça outra coisa.
    floorLimit: plan.envelope.top,
    ceilingLimit: plan.envelope.bottom,
    // O teto da faixa abre para caber um degrau de escada inteiro: sem isso, a
    // plataforma que a escada alcanca cairia fora da faixa e os chunks
    // seguintes a arrastariam para baixo.
    top: Math.round(Math.max(plan.envelope.top, target - half - 340)),
    bottom: Math.round(Math.min(plan.envelope.bottom, target + half)),
  };
}
