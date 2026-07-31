// Topologias abstratas da rota opcional — Checkpoint T1
// =====================================================
//
// Este módulo NÃO cria plataformas. Ele decide a SILHUETA: quantos trechos a
// rota tem, o que cada um pretende fazer com a altura (subir, descer, segurar,
// coroar, afundar, recuperar) e qual fração do vão horizontal cada um merece.
//
// Por que separar isso da geometria: no B2 cada desafio trazia a própria
// geometria pronta (`buildGeometry`), então a silhueta da rota era a soma de
// três blocos autocontidos — e o resultado tendia à mesma torre com os mesmos
// degraus, porque ninguém tinha uma opinião sobre o conjunto. Aqui a opinião
// sobre o conjunto vem PRIMEIRO, e o desafio depois se encaixa nela.
//
// Tudo é determinístico: mesma seed, mesma topologia. Nenhum `Math.random()`.

import { createRandom } from './random.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Papéis de zona. `challenge` é o único que um desafio biológico pode ocupar;
// os demais são silhueta pura.
export const TOPOLOGY_ZONE_ROLES = Object.freeze([
  'entry',
  'movement',
  'challenge',
  'ridge',
  'valley',
  'recovery',
  'drop-rejoin',
]);

// O que a zona pretende fazer com a altura. `hold` não é "plano": é "sem
// intenção vertical declarada", e o sintetizador ainda pode variar dentro dela.
export const TOPOLOGY_VERTICAL_INTENTS = Object.freeze([
  'hold',
  'climb',
  'descend',
  'crest',
  'valley',
  'recover',
]);

// Contratos da §6, em um lugar só para o teste poder importar em vez de
// repetir os números.
export const TOPOLOGY_CONTRACTS = Object.freeze({
  minimumScreens: 3,
  maximumScreens: 6,
  minimumVerticalRange: 180,
  maximumVerticalRange: 360,
  maximumMonotonicShare: 0.65,
  minimumClimbCount: 1,
  minimumDropCount: 1,
});

// Perfis geométricos que cada zona aceita hospedar. O desafio declara os seus
// (§8 e §9) e a interseção decide se ele cabe ali — é este par de listas que
// substitui o "cada desafio tem seu próprio pedaço de fase".
const PROFILES_BY_INTENT = Object.freeze({
  hold: Object.freeze(['plateau-break', 'recovery-gate']),
  climb: Object.freeze(['rising-gap', 'broken-climb-gap', 'plateau-break']),
  descend: Object.freeze(['descending-step', 'descending-gap', 'valley-exit']),
  crest: Object.freeze(['ridge-edge', 'ridge-break']),
  valley: Object.freeze(['valley-crossing', 'valley-exit']),
  recover: Object.freeze(['recovery-gate', 'rising-gap']),
});

function profilesFor(verticalIntent) {
  return PROFILES_BY_INTENT[verticalIntent] || Object.freeze([]);
}

// ---------------------------------------------------------------------------
// FAMÍLIAS
// ---------------------------------------------------------------------------
//
// Cada família é uma sequência de zonas com intenção vertical declarada.
// `spanWeight` é uma FRAÇÃO RELATIVA: o sintetizador normaliza os pesos contra
// o vão disponível, então a mesma família se adapta a candidatos curtos e
// longos sem mudar de identidade.
//
// `verticalDeltaRange` é em pixels e assinado: negativo sobe (y menor), positivo
// desce. São faixas, não valores — quem escolhe dentro delas é a seed.
//
// `spanBase` é o vão que a zona QUER. O mínimo é 72% dele: separar os dois é o
// que permite a mesma família caber num candidato curto sem perder a silhueta,
// porque o alvo (`preferredSpan`) continua valendo para o contrato de telas
// enquanto o piso (`minimumSpan`) apenas diz onde a zona deixa de existir.
//
// OPEN TOWER é perfil abstrato, não a torre antiga: não reaproveita
// `tower-safe-fall-01`, `safe-floor-a/b` nem `step-a/b/c`. A diferença é que a
// subida aqui é uma INTENÇÃO de zona, cuja geometria o sintetizador resolve.

const FAMILY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'ridge-valley',
    label: 'Crista e vale',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', spanWeight: 0.9, spanBase: 390, verticalDeltaRange: Object.freeze([-20, 20]), required: true }),
      Object.freeze({ role: 'movement', verticalIntent: 'climb', spanWeight: 1.1, spanBase: 475, verticalDeltaRange: Object.freeze([-150, -90]), required: true }),
      Object.freeze({ role: 'ridge', verticalIntent: 'crest', spanWeight: 1.0, spanBase: 430, verticalDeltaRange: Object.freeze([-40, 10]), required: true }),
      Object.freeze({ role: 'challenge', verticalIntent: 'descend', spanWeight: 1.9, spanBase: 900, verticalDeltaRange: Object.freeze([20, 110]), required: true }),
      Object.freeze({ role: 'valley', verticalIntent: 'valley', spanWeight: 1.0, spanBase: 430, verticalDeltaRange: Object.freeze([40, 120]), required: true }),
      Object.freeze({ role: 'recovery', verticalIntent: 'recover', spanWeight: 1.0, spanBase: 430, verticalDeltaRange: Object.freeze([-110, -50]), required: true }),
      Object.freeze({ role: 'drop-rejoin', verticalIntent: 'descend', spanWeight: 0.8, spanBase: 345, verticalDeltaRange: Object.freeze([30, 90]), required: true }),
    ]),
  }),

  Object.freeze({
    id: 'broken-climb',
    label: 'Subida interrompida',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', spanWeight: 0.9, spanBase: 400, verticalDeltaRange: Object.freeze([-20, 20]), required: true }),
      Object.freeze({ role: 'movement', verticalIntent: 'climb', spanWeight: 1.2, spanBase: 530, verticalDeltaRange: Object.freeze([-140, -80]), required: true }),
      // A interrupção é uma queda curta no meio da subida: é ela que impede a
      // rota de virar uma escada monotônica.
      Object.freeze({ role: 'valley', verticalIntent: 'descend', spanWeight: 0.8, spanBase: 355, verticalDeltaRange: Object.freeze([50, 100]), required: true }),
      Object.freeze({ role: 'challenge', verticalIntent: 'climb', spanWeight: 1.9, spanBase: 920, verticalDeltaRange: Object.freeze([-120, -50]), required: true }),
      Object.freeze({ role: 'movement', verticalIntent: 'climb', spanWeight: 1.0, spanBase: 445, verticalDeltaRange: Object.freeze([-110, -55]), required: true }),
      Object.freeze({ role: 'recovery', verticalIntent: 'recover', spanWeight: 0.9, spanBase: 400, verticalDeltaRange: Object.freeze([-30, 30]), required: true }),
      Object.freeze({ role: 'drop-rejoin', verticalIntent: 'descend', spanWeight: 0.8, spanBase: 355, verticalDeltaRange: Object.freeze([60, 130]), required: true }),
    ]),
  }),

  Object.freeze({
    id: 'double-crest',
    label: 'Duas cristas',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', spanWeight: 0.9, spanBase: 425, verticalDeltaRange: Object.freeze([-20, 20]), required: true }),
      Object.freeze({ role: 'ridge', verticalIntent: 'crest', spanWeight: 1.2, spanBase: 565, verticalDeltaRange: Object.freeze([-140, -80]), required: true }),
      Object.freeze({ role: 'movement', verticalIntent: 'descend', spanWeight: 1.0, spanBase: 470, verticalDeltaRange: Object.freeze([50, 110]), required: true }),
      Object.freeze({ role: 'challenge', verticalIntent: 'valley', spanWeight: 1.9, spanBase: 950, verticalDeltaRange: Object.freeze([10, 80]), required: true }),
      Object.freeze({ role: 'ridge', verticalIntent: 'crest', spanWeight: 1.2, spanBase: 565, verticalDeltaRange: Object.freeze([-150, -90]), required: true }),
      Object.freeze({ role: 'drop-rejoin', verticalIntent: 'descend', spanWeight: 0.9, spanBase: 425, verticalDeltaRange: Object.freeze([70, 140]), required: true }),
    ]),
  }),

  Object.freeze({
    id: 'descending-recovery',
    label: 'Descida e recuperação',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', spanWeight: 0.9, spanBase: 430, verticalDeltaRange: Object.freeze([-30, 10]), required: true }),
      // Desafio logo no começo: é isto que produz a classe `early`.
      Object.freeze({ role: 'challenge', verticalIntent: 'climb', spanWeight: 1.9, spanBase: 960, verticalDeltaRange: Object.freeze([-120, -60]), required: true }),
      Object.freeze({ role: 'movement', verticalIntent: 'descend', spanWeight: 1.3, spanBase: 620, verticalDeltaRange: Object.freeze([90, 170]), required: true }),
      Object.freeze({ role: 'recovery', verticalIntent: 'recover', spanWeight: 1.1, spanBase: 525, verticalDeltaRange: Object.freeze([-130, -70]), required: true }),
      Object.freeze({ role: 'movement', verticalIntent: 'hold', spanWeight: 1.0, spanBase: 480, verticalDeltaRange: Object.freeze([-25, 25]), required: true }),
      Object.freeze({ role: 'drop-rejoin', verticalIntent: 'descend', spanWeight: 0.8, spanBase: 380, verticalDeltaRange: Object.freeze([50, 120]), required: true }),
    ]),
  }),

  Object.freeze({
    id: 'open-tower',
    label: 'Torre aberta',
    zones: Object.freeze([
      Object.freeze({ role: 'entry', verticalIntent: 'hold', spanWeight: 0.8, spanBase: 370, verticalDeltaRange: Object.freeze([-20, 20]), required: true }),
      Object.freeze({ role: 'movement', verticalIntent: 'climb', spanWeight: 1.3, spanBase: 600, verticalDeltaRange: Object.freeze([-200, -130]), required: true }),
      Object.freeze({ role: 'ridge', verticalIntent: 'hold', spanWeight: 1.2, spanBase: 555, verticalDeltaRange: Object.freeze([-35, 25]), required: true }),
      Object.freeze({ role: 'challenge', verticalIntent: 'crest', spanWeight: 1.9, spanBase: 940, verticalDeltaRange: Object.freeze([-60, 20]), required: true }),
      Object.freeze({ role: 'movement', verticalIntent: 'descend', spanWeight: 1.2, spanBase: 555, verticalDeltaRange: Object.freeze([80, 150]), required: true }),
      Object.freeze({ role: 'drop-rejoin', verticalIntent: 'descend', spanWeight: 0.8, spanBase: 370, verticalDeltaRange: Object.freeze([50, 120]), required: true }),
    ]),
  }),
]);

export const TOPOLOGY_FAMILY_IDS = Object.freeze(
  FAMILY_DEFINITIONS.map(family => family.id),
);

export function optionalDetourTopologyFamilies() {
  return FAMILY_DEFINITIONS;
}

// ---------------------------------------------------------------------------
// GERAÇÃO
// ---------------------------------------------------------------------------

function pickInRange(random, [minimum, maximum]) {
  return minimum + random() * (maximum - minimum);
}

// A ordem de tentativa das famílias é embaralhada pela seed, mas de forma
// determinística: o mesmo candidato na mesma seed sempre vê a mesma ordem.
function familyOrder(seedValue, candidateId) {
  const random = createRandom(`${seedValue}:t1-family:${candidateId}`);
  const pool = [...FAMILY_DEFINITIONS];
  for (let index = pool.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [pool[index], pool[target]] = [pool[target], pool[index]];
  }
  return pool;
}

export function optionalDetourTopologyFamilyOrder({ seedValue, candidateId }) {
  return familyOrder(seedValue, candidateId).map(family => family.id);
}

// Quanto da rota é percorrido sem mudar de direção vertical. Serve ao contrato
// "não monotônica por mais de 65%": uma rota que só sobe é uma escada, e uma
// escada não é uma silhueta.
function monotonicShare(zones) {
  const signs = zones.map(zone => {
    const middle = (zone.verticalDeltaRange[0] + zone.verticalDeltaRange[1]) / 2;
    if (middle < -12) return -1;
    if (middle > 12) return 1;
    return 0;
  });
  const totalSpan = zones.reduce((sum, zone) => sum + zone.spanWeight, 0);
  let best = 0;
  let runSign = null;
  let runSpan = 0;
  for (let index = 0; index < zones.length; index++) {
    const sign = signs[index];
    if (sign !== 0 && sign === runSign) {
      runSpan += zones[index].spanWeight;
    } else {
      runSign = sign;
      runSpan = sign === 0 ? 0 : zones[index].spanWeight;
    }
    best = Math.max(best, runSpan);
  }
  return totalSpan > 0 ? best / totalSpan : 0;
}

function classifyChallengePosition(order, total) {
  const ratio = total > 1 ? order / (total - 1) : 0;
  if (ratio <= 0.34) return 'early';
  if (ratio <= 0.67) return 'middle';
  return 'late';
}

export function topologyChallengePositionClass(topology, zoneId) {
  const zone = topology.zones.find(candidate => candidate.id === zoneId);
  if (!zone) return null;
  return classifyChallengePosition(zone.order, topology.zones.length);
}

/**
 * Gera a topologia ABSTRATA de uma rota opcional. Nenhuma coordenada concreta:
 * as zonas declaram intenção e proporção, e é o sintetizador que resolve isso
 * em x, y e largura contra o vão real do candidato.
 */
export function generateOptionalDetourTopology({
  candidate,
  seedValue,
  referenceScreenWidth = 1280,
  referenceScreenHeight = 720,
  familyId = null,
  attemptIndex = 0,
} = {}) {
  if (!candidate) return null;
  const candidateId = candidate.id || 'candidate';
  const ordered = familyOrder(seedValue, candidateId);
  const family = familyId
    ? FAMILY_DEFINITIONS.find(entry => entry.id === familyId)
    : ordered[attemptIndex % ordered.length];
  if (!family) return null;

  const random = createRandom(
    `${seedValue}:t1-topology:${candidateId}:${family.id}:${attemptIndex}`,
  );

  // Amplitude planejada dentro do contrato. É um ALVO para o sintetizador, não
  // uma promessa: ele valida o resultado real depois de concretizar.
  const targetVerticalRange = Math.round(pickInRange(random, [
    TOPOLOGY_CONTRACTS.minimumVerticalRange + 15,
    TOPOLOGY_CONTRACTS.maximumVerticalRange - 20,
  ]));

  const zones = family.zones.map((definition, index) => {
    const jitter = 0.88 + random() * 0.24;
    const minimumSpan = Math.round(definition.spanBase * 0.72);
    const preferredSpan = Math.round(
      Math.max(minimumSpan, definition.spanBase * 1.42 * jitter),
    );
    const allowedChallengeProfiles = profilesFor(definition.verticalIntent);
    return Object.freeze({
      id: `${family.id}:z${index}:${definition.role}`,
      order: index,
      role: definition.role,
      spanWeight: Math.round(definition.spanWeight * jitter * 1000) / 1000,
      spanBase: definition.spanBase,
      minimumSpan,
      preferredSpan,
      verticalIntent: definition.verticalIntent,
      verticalDeltaRange: definition.verticalDeltaRange,
      allowedChallengeProfiles,
      // Hospedar o desafio não é privilégio da zona chamada `challenge`: se
      // fosse, cada família teria uma única posição possível e o contrato
      // "desafio no início, meio ou fim" (§6) seria impossível de cumprir. A
      // zona `challenge` continua sendo a que reserva mais vão; as outras
      // podem receber o desafio quando a alocação real lhes der espaço.
      challengeCapable: definition.role !== 'entry'
        && definition.role !== 'drop-rejoin'
        && allowedChallengeProfiles.length > 0,
      required: definition.required !== false,
    });
  });

  const entryZone = zones.find(zone => zone.role === 'entry');
  const exitZone = zones.find(zone => zone.role === 'drop-rejoin');
  const challengeZoneIds = zones
    .filter(zone => zone.challengeCapable)
    .map(zone => zone.id);
  const preferredChallengeZoneId = zones
    .find(zone => zone.role === 'challenge')?.id || challengeZoneIds[0] || null;

  // Conta pelo DELTA declarado, não pelo rótulo da intenção: `crest` sobe na
  // família double-crest e é quase plana na open-tower, então o rótulo sozinho
  // classificava errado e reprovava famílias válidas.
  const midpointOf = zone => (zone.verticalDeltaRange[0] + zone.verticalDeltaRange[1]) / 2;
  const expectedClimbCount = zones.filter(zone => midpointOf(zone) < -12).length;
  const expectedDropCount = zones.filter(zone => midpointOf(zone) > 12).length;

  const totalPreferredSpan = zones.reduce((sum, zone) => sum + zone.preferredSpan, 0);
  const screenSpan = Math.max(1, referenceScreenWidth);

  const topology = {
    id: `${family.id}:${candidateId}:${attemptIndex}`,
    family: family.id,
    familyLabel: family.label,
    zones,
    entryZoneId: entryZone?.id || null,
    exitZoneId: exitZone?.id || null,
    challengeZoneIds,
    preferredChallengeZoneId,
    targetVerticalRange,
    expectedClimbCount,
    expectedDropCount,
    // Métricas do contrato, calculadas aqui para o teste não ter de reimplementá-las.
    plannedScreens: Math.round((totalPreferredSpan / screenSpan) * 100) / 100,
    plannedMonotonicShare: Math.round(monotonicShare(zones) * 1000) / 1000,
    referenceScreenWidth,
    referenceScreenHeight,
    signature: null,
  };

  topology.signature = [
    family.id,
    zones.map(zone => zone.role).join('>'),
    zones.map(zone => zone.verticalIntent).join('>'),
    targetVerticalRange,
  ].join('|');

  return topology;
}

/**
 * Contratos da §6 avaliados sobre a topologia abstrata. Devolve a lista de
 * violações — vazia quando ela é válida.
 */
export function validateOptionalDetourTopology(topology, { availableSpan = null } = {}) {
  const violations = [];
  if (!topology) return ['missing-topology'];

  if (!topology.entryZoneId) violations.push('missing-entry-zone');
  if (!topology.exitZoneId) violations.push('missing-drop-rejoin-zone');
  if (!topology.challengeZoneIds.length) violations.push('no-challenge-capable-zone');

  if (topology.expectedClimbCount < TOPOLOGY_CONTRACTS.minimumClimbCount) {
    violations.push('no-planned-climb');
  }
  if (topology.expectedDropCount < TOPOLOGY_CONTRACTS.minimumDropCount) {
    violations.push('no-planned-drop');
  }
  if (
    topology.targetVerticalRange < TOPOLOGY_CONTRACTS.minimumVerticalRange
    || topology.targetVerticalRange > TOPOLOGY_CONTRACTS.maximumVerticalRange
  ) {
    violations.push(`vertical-range-out-of-contract:${topology.targetVerticalRange}`);
  }
  if (topology.plannedMonotonicShare > TOPOLOGY_CONTRACTS.maximumMonotonicShare) {
    violations.push(`monotonic-share:${topology.plannedMonotonicShare}`);
  }
  if (
    topology.plannedScreens < TOPOLOGY_CONTRACTS.minimumScreens
    || topology.plannedScreens > TOPOLOGY_CONTRACTS.maximumScreens
  ) {
    violations.push(`screen-span-out-of-contract:${topology.plannedScreens}`);
  }

  // O vão do candidato precisa comportar ao menos os mínimos somados.
  if (Number.isFinite(availableSpan)) {
    const requiredSpan = topology.zones.reduce((sum, zone) => sum + zone.minimumSpan, 0);
    if (availableSpan < requiredSpan) {
      violations.push(`available-span-too-small:${Math.round(availableSpan)}<${requiredSpan}`);
    }
  }

  return violations;
}

// Distribui o vão real entre as zonas, respeitando os mínimos. Fica aqui, e não
// no sintetizador, porque é a topologia que decide a PROPORÇÃO — o sintetizador
// só recebe o resultado e resolve a geometria dentro dele.
export function allocateTopologyZoneSpans(topology, availableSpan) {
  const zones = topology.zones;
  const minimumTotal = zones.reduce((sum, zone) => sum + zone.minimumSpan, 0);
  if (availableSpan < minimumTotal) return null;

  const surplus = availableSpan - minimumTotal;
  const weightTotal = zones.reduce((sum, zone) => sum + zone.spanWeight, 0);
  let consumed = 0;
  const spans = zones.map((zone, index) => {
    const isLast = index === zones.length - 1;
    const share = weightTotal > 0 ? (zone.spanWeight / weightTotal) * surplus : 0;
    const span = isLast
      ? availableSpan - consumed
      : Math.round(zone.minimumSpan + share);
    consumed += span;
    return { zoneId: zone.id, span: Math.max(zone.minimumSpan, span) };
  });
  return spans;
}
