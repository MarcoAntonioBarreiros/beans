import { W } from '../core/constants.js';
import { getPhaseManifest } from './campaign-manifest.js';
import { ensurePhaseObjectiveProgress } from './campaign-objective-progress.js';
import { createRandom } from './random.js';
import { getPrimaryTraversalPlatforms } from './traversal-route.js';
import { getNitrogenAvailability } from './nitrogen-availability.js';
import { synchronizeWorldBounds } from './world-bounds.js';
import { fxLanded } from '../game-audio.js';

export const AZOSPIRILLUM_ROOT_LADDER_BLOCK_TYPE = 'azospirillum-root-ladder';

const TAU = Math.PI * 2;
const PRACTICE_WINDOW_CHUNKS = 4;
const MIN_VERTICAL_RISE = 210;
const MAX_VERTICAL_RISE = 300;
const FIRST_DEMONSTRATION_VERTICAL_SPACING = 58;
const BRANCH_WIDTH = 90;
const ROOT_SWAY_MAX = 74;
// A raiz lateral sobe, mas pode inclinar ate aqui para encontrar um bloco.
// Passando disso o destino e ignorado e ela sobe reta.
const MAX_LATERAL_REACH = 360;
// Nitrogenio necessario para a escada atingir o alcance maximo.
const STOCK_FOR_FULL_REACH = 8;
// O numero de degraus sai do alcance, nao o contrario: um numero fixo empilhava
// os degraus quase encostados quando a escada era curta. O espacamento alvo fica
// confortavel para subir de degrau em degrau (o salto simples cobre 96px).
const RUNTIME_TARGET_STEP_SPACING = 58;
const RUNTIME_MIN_STEPS = 1;
const RUNTIME_MAX_STEPS = 6;
const RUNTIME_GROWTH_SECONDS = 3;
const OPTIONAL_TARGET_STEP_SPACING = 96;
const OPTIONAL_MIN_STEP_SPACING = 80;
const OPTIONAL_MAX_STEP_SPACING = 115;
const OPTIONAL_TECHNICAL_STEP_LIMIT = 64;
const OPTIONAL_MIN_DEVELOPED_REACH = 96;
const OPTIONAL_GROWTH_SECONDS_PER_100_UNITS = 1;

function runtimeStepCount(reach) {
  const raw = Math.round(reach / RUNTIME_TARGET_STEP_SPACING) - 1;
  return clamp(raw, RUNTIME_MIN_STEPS, RUNTIME_MAX_STEPS);
}
// Sem nitrogenio a raiz lateral mal supera um salto simples; com estoque cheio
// ela alcanca alem do salto duplo. E o estoque que decide, nao a distancia.
const RUNTIME_MIN_REACH = 96;
const RUNTIME_MAX_REACH = 340;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

function routePlatforms(level) {
  return getPrimaryTraversalPlatforms(level)
    .filter(platform => !platform.encounterInstanceId);
}

function topPoint(platform, x) {
  return {
    x: clamp(x, platform.x + 18, platform.x + platform.w - 18),
    y: platform.y - 6,
  };
}

function ladderCandidates(level, firstExudate, minimumHostChunk, maximumHostChunk, config) {
  const candidates = [];
  const platforms = (level.platforms || [])
    .filter(platform => !platform.final && Number.isInteger(platform.logicIndex));
  const mainRoute = routePlatforms(level);

  for (const host of platforms) {
    const knownSkill = Boolean(config.knownSkill);
    const recapAccess = Number.isInteger(config.recapAccessChunk)
      && host.logicIndex === config.recapAccessChunk
      && !host.recovery;
    const eligibleHost = recapAccess
      ? !host.recovery
      : knownSkill
        ? host.type === 'root' && !host.recovery
        : host.type === 'root' && Boolean(host.recovery);
    if (
      !eligibleHost
      || host.logicIndex <= firstExudate
      || host.logicIndex < minimumHostChunk
      || host.logicIndex > maximumHostChunk
    ) continue;

    const hostCenter = host.x + host.w / 2;
    const targets = mainRoute.filter(target => (
      target.logicIndex >= host.logicIndex
      && target.logicIndex <= host.logicIndex + 1
      && target !== host
      && target.y < host.y - 60
    ));
    let bestForHost = null;
    for (const destination of targets) {
      const naturalRise = host.y - destination.y;
      const destinationPoint = topPoint(destination, hostCenter);
      const dx = Math.abs(destinationPoint.x - hostCenter);
      if (naturalRise > 360 || dx > 390) continue;
      // Uma habilidade persistente só responde a um desnível que já existe.
      // Ela nunca eleva a plataforma seguinte nem cria um obstáculo artificial.
      if (knownSkill && naturalRise < MIN_VERTICAL_RISE) continue;

      const verticalSpacing = Math.min(
        Number(config.verticalSpacing) || FIRST_DEMONSTRATION_VERTICAL_SPACING,
        FIRST_DEMONSTRATION_VERTICAL_SPACING,
      );
      // A assinatura da fase e a unica dona do desnivel macro. Este valor serve
      // apenas para preferir uma geometria existente com espacamento didatico;
      // nunca e aplicado de volta ao destino.
      const preferredRise = clamp(
        verticalSpacing * (config.stepCount + 1),
        MIN_VERTICAL_RISE,
        MAX_VERTICAL_RISE,
      );
      const following = mainRoute.find(platform => platform.logicIndex > destination.logicIndex) || null;
      const score = (host.logicIndex - minimumHostChunk) * 1000
        + Math.abs(preferredRise - naturalRise)
        + dx * .35;
      const candidate = {
        host,
        destination,
        following,
        preferredRise,
        dx,
        recapAccess,
        score,
      };
      if (!bestForHost || candidate.score < bestForHost.score) bestForHost = candidate;
    }
    if (bestForHost) candidates.push(bestForHost);
  }
  return candidates;
}

function buildSteps(slot, config, ladderId) {
  const start = topPoint(slot.host, slot.host.x + slot.host.w / 2);
  const end = topPoint(slot.destination, start.x);
  const swayDirection = Math.sign(end.x - start.x || 1);
  const sway = swayDirection * Math.min(ROOT_SWAY_MAX, 24 + slot.dx * .22);
  return Array.from({ length: config.stepCount }, (_, index) => {
    const t = (index + 1) / (config.stepCount + 1);
    const centerX = lerp(start.x, end.x, t) + Math.sin(t * Math.PI) * sway;
    const y = lerp(start.y, end.y, t);
    return {
      id: `${ladderId}-step-${index + 1}`,
      index,
      centerX,
      y,
      startWidth: 14,
      startHeight: 4,
      targetWidth: BRANCH_WIDTH,
      targetHeight: 12,
      currentWidth: 14,
      currentHeight: 4,
      progress: 0,
      mature: false,
      collider: null,
    };
  });
}

function cubicBezierPoint(start, controlA, controlB, end, t) {
  const inverse = 1 - t;
  const inverse2 = inverse * inverse;
  const t2 = t * t;
  return {
    x: inverse2 * inverse * start.x
      + 3 * inverse2 * t * controlA.x
      + 3 * inverse * t2 * controlB.x
      + t2 * t * end.x,
    y: inverse2 * inverse * start.y
      + 3 * inverse2 * t * controlA.y
      + 3 * inverse * t2 * controlB.y
      + t2 * t * end.y,
  };
}

function sampleOptionalAccessPath(host, destination) {
  const start = topPoint(host, host.x + host.w - 26);
  const end = {
    x: destination.x - 26,
    y: destination.y + 16,
  };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const controlA = {
    x: start.x + Math.max(90, dx * .3),
    y: start.y + dy * .16,
  };
  const controlB = {
    x: end.x - Math.max(80, dx * .25),
    y: end.y - dy * .28,
  };
  const points = [];
  let totalLength = 0;
  let previous = start;
  for (let index = 0; index <= 72; index++) {
    const point = cubicBezierPoint(start, controlA, controlB, end, index / 72);
    if (index > 0) totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
    points.push({ ...point, arcDistance: totalLength });
    previous = point;
  }
  return { start, end, points, totalLength };
}

function pointAtArcDistance(path, distance) {
  const target = clamp(distance, 0, path.totalLength);
  for (let index = 1; index < path.points.length; index++) {
    const right = path.points[index];
    if (right.arcDistance < target) continue;
    const left = path.points[index - 1];
    const span = Math.max(.001, right.arcDistance - left.arcDistance);
    const local = (target - left.arcDistance) / span;
    return {
      x: lerp(left.x, right.x, local),
      y: lerp(left.y, right.y, local),
    };
  }
  return { ...path.end };
}

function buildDynamicOptionalSteps(host, destination, ladderId) {
  const path = sampleOptionalAccessPath(host, destination);
  const intervals = Math.max(2, Math.ceil(path.totalLength / OPTIONAL_TARGET_STEP_SPACING));
  const stepCount = intervals - 1;
  const spacing = path.totalLength / intervals;
  if (
    stepCount > OPTIONAL_TECHNICAL_STEP_LIMIT
    || spacing < OPTIONAL_MIN_STEP_SPACING
    || spacing > OPTIONAL_MAX_STEP_SPACING
  ) {
    throw new Error(
      `[azospirillum optional access] invalid sampled ladder geometry: `
      + `length=${path.totalLength.toFixed(2)}, steps=${stepCount}, spacing=${spacing.toFixed(2)}`,
    );
  }
  const steps = Array.from({ length: stepCount }, (_, index) => {
    const arcDistance = spacing * (index + 1);
    const point = pointAtArcDistance(path, arcDistance);
    return {
      id: `${ladderId}-step-${index + 1}`,
      index,
      centerX: point.x,
      y: point.y,
      arcDistance,
      normalizedArcPosition: arcDistance / path.totalLength,
      fullPathLength: path.totalLength,
      segmentLength: spacing,
      startWidth: 14,
      startHeight: 4,
      targetWidth: BRANCH_WIDTH,
      targetHeight: 12,
      currentWidth: 14,
      currentHeight: 4,
      progress: 0,
      mature: false,
      collider: null,
    };
  });
  return {
    ...path,
    spacing,
    steps,
  };
}

export function generateAzospirillumRootLadders({
  level,
  phase,
  seedValue,
  encounters = [],
  config,
} = {}) {
  level.azospirillumRootLadders = [];
  level.azospirillumRoots = [];
  const authoredRequests = level.authoredAzospirillumLadderRequests || [];
  if (phase < 3) return level.azospirillumRootLadders;
  const authoredConfig = {
    enabled: true,
    count: authoredRequests.length,
    stepCount: Math.max(1, Number(config?.stepCount) || 4),
    verticalSpacing: Number(config?.verticalSpacing) || FIRST_DEMONSTRATION_VERTICAL_SPACING,
    growthDurationSeconds: Number(config?.growthDurationSeconds) || RUNTIME_GROWTH_SECONDS,
  };
  const authoredRandom = createRandom(`${seedValue}:authored-azospirillum-root-ladder:p${phase}`);
  for (const [requestIndex, request] of authoredRequests.entries()) {
    // A rota opcional identifica hospedeiro e destino por `platformId`; os
    // portões de subida da rota principal nascem em `generateLevel`, antes de
    // qualquer id ser atribuído, e passam a própria referência. O pipeline
    // muta o nível no lugar, então a referência sobrevive à decoração.
    const host = request.hostPlatform || (level.platforms || []).find(platform => (
      (platform.platformId ?? platform.id) === request.hostPlatformId
    ));
    const destination = request.destinationPlatform
      || (level.platforms || []).find(platform => (
        (platform.platformId ?? platform.id) === request.destinationPlatformId
      ));
    if (!host || !destination || host.type !== 'root' || destination.y >= host.y - 60) continue;
    const requiredReach = Math.max(
      Number(request.requiredReach) || 0,
      host.y - destination.y,
    );
    const dynamicOptional = request.accessStyle === 'dynamic-optional-detour';
    // Degraus continuam usando a mesma geometria/collider do sistema existente.
    // Em acessos muito altos, aumentamos apenas a contagem para manter o
    // espaçamento praticável; nenhuma plataforma da rota é deslocada.
    const legacyStepCount = clamp(
      Math.max(authoredConfig.stepCount, Math.ceil(requiredReach / RUNTIME_TARGET_STEP_SPACING) - 1),
      authoredConfig.stepCount,
      8,
    );
    const slot = {
      host,
      destination,
      following: null,
      dx: Math.abs(
        (destination.x + destination.w / 2)
        - (host.x + host.w / 2)
      ),
    };
    const id = `azo-ladder-authored-${request.optionalDetourId || phase}-${requestIndex}`;
    host.azospirillumLadderHost = true;
    if (!dynamicOptional) {
      host.rootHealth = Number.isFinite(host.rootHealth) ? host.rootHealth : 1;
      host.rootMaxHealth = Number.isFinite(host.rootMaxHealth) ? host.rootMaxHealth : 1;
    }
    destination.azospirillumLadderDestination = true;
    const dynamicGeometry = dynamicOptional
      ? buildDynamicOptionalSteps(host, destination, id)
      : null;
    const stepCount = dynamicGeometry?.steps.length ?? legacyStepCount;
    const start = dynamicGeometry?.start ?? topPoint(host, host.x + host.w / 2);
    const end = dynamicGeometry?.end ?? topPoint(destination, start.x);
    const ladder = {
      id,
      blockType: AZOSPIRILLUM_ROOT_LADDER_BLOCK_TYPE,
      host,
      parent: host,
      destination,
      following: null,
      hostLogicIndex: host.logicIndex,
      destinationLogicIndex: destination.logicIndex,
      originalDestinationY: destination.y,
      originalDestinationX: destination.x,
      blockedRise: host.y - destination.y,
      blockedGap: Math.abs(end.x - start.x),
      actualVerticalSpacing: (host.y - destination.y) / (stepCount + 1),
      horizontalSpacing: slot.dx,
      sourceAzospirillumLogicIndex: host.logicIndex,
      sourceExudateLogicIndex: null,
      recapAccess: true,
      knownSkill: true,
      authored: true,
      optionalDetourId: request.optionalDetourId || null,
      detourModuleId: request.detourModuleId || null,
      accessStyle: request.accessStyle || null,
      ascentGateId: request.ascentGateId || null,
      requiredReach,
      fullPathLength: dynamicGeometry?.totalLength ?? requiredReach,
      pathPoints: dynamicGeometry?.points || null,
      minimumDevelopedReach: dynamicOptional
        ? Math.min(OPTIONAL_MIN_DEVELOPED_REACH, dynamicGeometry.totalLength)
        : 0,
      unlockedDevelopedReach: 0,
      targetDevelopedReach: 0,
      growthSecondsPer100Units: Number(request.growthSecondsPer100Units)
        || OPTIONAL_GROWTH_SECONDS_PER_100_UNITS,
      showInstruction: request.showInstruction === true,
      suppressToast: request.suppressToast === true,
      silentDiscovery: request.silentDiscovery === true,
      tutorialDemonstration: false,
      mandatoryChallenge: false,
      growthDurationSeconds: authoredConfig.growthDurationSeconds,
      progress: 0,
      visibleProgress: 0,
      mature: false,
      developed: false,
      paused: false,
      colony: null,
      announced: false,
      phase: authoredRandom() * TAU,
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
      steps: [],
    };
    ladder.steps = dynamicGeometry?.steps
      || buildSteps(slot, { ...authoredConfig, stepCount }, id);
    if (dynamicOptional) {
      for (const step of ladder.steps) {
        step.optionalDetourId = ladder.optionalDetourId;
        step.detourModuleId = ladder.detourModuleId;
        step.routeRole = 'optional';
        step.routeScope = 'optional';
        step.routeOwned = true;
      }
    }
    level.azospirillumRootLadders.push(ladder);
  }
  level.azospirillumRoots = level.azospirillumRootLadders;

  if (!config?.enabled || config.count <= 0) return level.azospirillumRootLadders;
  const knownSkill = phase > 3 && Boolean(config.knownSkill);
  if (phase > 3 && !knownSkill && !Number.isInteger(config.recapAccessChunk)) {
    return level.azospirillumRootLadders;
  }

  const firstAzospirillum = encounters
    .filter(encounter => encounter.id === 'azospirillum' && Number.isInteger(encounter.logicIndex))
    .map(encounter => encounter.logicIndex)
    .sort((left, right) => left - right)[0];
  if (!Number.isInteger(firstAzospirillum)) return level.azospirillumRootLadders;

  const unlockChunk = getPhaseManifest(phase)?.unlockEvents
    .find(event => event.feature === 'azospirillumRoots')?.eventChunk ?? firstAzospirillum + 4;
  const recapAccessChunk = Number.isInteger(config.recapAccessChunk)
    ? config.recapAccessChunk
    : null;
  const prerequisiteDeadline = recapAccessChunk ?? unlockChunk;
  const route = routePlatforms(level);
  let firstExudate = (level.exudates || [])
    .filter(exudate => (
      Number.isInteger(exudate.logicIndex)
      && exudate.logicIndex > firstAzospirillum
      && exudate.logicIndex <= prerequisiteDeadline
    ))
    .map(exudate => exudate.logicIndex)
    .sort((left, right) => left - right)[0];
  if (!Number.isInteger(firstExudate)) {
    if (knownSkill) return level.azospirillumRootLadders;
    const prerequisitePlatform = route.find(platform => (
      platform.logicIndex > firstAzospirillum
      && platform.logicIndex <= prerequisiteDeadline
      && platform.w >= 100
    ));
    if (!prerequisitePlatform) return level.azospirillumRootLadders;
    const prerequisiteExudate = {
      logicIndex: prerequisitePlatform.logicIndex,
      x: prerequisitePlatform.x + prerequisitePlatform.w * .62,
      y: prerequisitePlatform.y - 32,
      taken: false,
      azospirillumLadderPrerequisite: true,
    };
    level.exudates = [...(level.exudates || []), prerequisiteExudate];
    firstExudate = prerequisiteExudate.logicIndex;
  }

  const minimumHostChunk = recapAccessChunk
    ?? (knownSkill ? firstExudate + 1 : Math.max(firstExudate + 1, unlockChunk + 1));
  const maximumHostChunk = recapAccessChunk
    ?? (knownSkill ? route.at(-1)?.logicIndex ?? firstExudate : unlockChunk + PRACTICE_WINDOW_CHUNKS);
  const candidates = ladderCandidates(
    level,
    firstExudate,
    minimumHostChunk,
    maximumHostChunk,
    config,
  );
  if (!candidates.length) return level.azospirillumRootLadders;

  const ordered = [...candidates].sort((left, right) => (
    left.host.logicIndex - right.host.logicIndex
    || left.score - right.score
    || left.host.x - right.host.x
  ));
  const random = createRandom(`${seedValue}:azospirillum-root-ladder:p${phase}`);
  const selected = [];
  for (const candidate of ordered) {
    if (selected.some(item => Math.abs(item.host.logicIndex - candidate.host.logicIndex) < 4)) continue;
    selected.push(candidate);
    if (selected.length >= Math.min(config.count, ordered.length)) break;
  }

  const proceduralLadders = selected
    .sort((left, right) => left.host.x - right.host.x)
    .map((slot, index) => {
      const id = `azo-ladder-${slot.host.logicIndex}-${index}`;
      const originalDestinationY = slot.destination.y;
      const originalDestinationX = slot.destination.x;
      slot.host.wasRecoveryRoot = Boolean(slot.host.recovery);
      slot.host.recovery = false;
      if (slot.recapAccess) slot.host.type = 'root';
      slot.host.azospirillumLadderHost = true;
      slot.host.rootHealth = Number.isFinite(slot.host.rootHealth) ? slot.host.rootHealth : 1;
      slot.host.rootMaxHealth = Number.isFinite(slot.host.rootMaxHealth) ? slot.host.rootMaxHealth : 1;
      slot.destination.azospirillumLadderDestination = true;
      const start = topPoint(slot.host, slot.host.x + slot.host.w / 2);
      const end = topPoint(slot.destination, start.x);
      const ladder = {
        id,
        blockType: AZOSPIRILLUM_ROOT_LADDER_BLOCK_TYPE,
        host: slot.host,
        parent: slot.host,
        destination: slot.destination,
        following: slot.following,
        hostLogicIndex: slot.host.logicIndex,
        destinationLogicIndex: slot.destination.logicIndex,
        originalDestinationY,
        originalDestinationX,
        blockedRise: slot.host.y - slot.destination.y,
        blockedGap: Math.abs(end.x - start.x),
        actualVerticalSpacing: (slot.host.y - slot.destination.y) / (config.stepCount + 1),
        horizontalSpacing: slot.dx,
        sourceAzospirillumLogicIndex: firstAzospirillum,
        sourceExudateLogicIndex: firstExudate,
        recapAccess: slot.recapAccess,
        knownSkill,
        // Estas escadas de tempo-de-geracao sao a DEMONSTRACAO/pratica inicial
        // (ensinam inoculacao, crescimento, degraus). A prova OBRIGATORIA e outra
        // escada, criada em runtime sobre o hospedeiro registrado pelo desafio.
        tutorialDemonstration: !knownSkill,
        mandatoryChallenge: false,
        growthDurationSeconds: config.growthDurationSeconds,
        progress: 0,
        visibleProgress: 0,
        mature: false,
        developed: false,
        paused: false,
        colony: null,
        announced: false,
        phase: random() * TAU,
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        steps: [],
      };
      ladder.steps = buildSteps(slot, config, id);
      return ladder;
    });
  level.azospirillumRootLadders.push(...proceduralLadders);
  level.azospirillumRoots = level.azospirillumRootLadders;
  return level.azospirillumRootLadders;
}

// Folga, em chunks, entre encontrar o Azospirillum e chegar ao portão. Um
// chunk só não basta: o jogador precisa ver o organismo, recrutá-lo e ainda
// colher um exsudato antes de topar com o degrau.
const ASCENT_GATE_AZO_LEAD_CHUNKS = 2;

/**
 * Garante que o Azospirillum esteja DISPONÍVEL antes do primeiro portão de
 * subida, devolvendo a lista de encontros (estendida quando faltava).
 *
 * Sem isto o portão é um softlock com passos extras: no playtest ele apareceu
 * antes de qualquer Azospirillum na rota, e a fase só destravou porque o
 * jogador voltou depois de achar a colônia mais adiante. A regra é a que o
 * jogador enunciou — o desafio aparece NO ponto em que o Azo já está
 * disponível, ou depois dele.
 *
 * Nunca move o portão nem a geometria: a geometria já foi validada. O que se
 * ajusta é a ORDEM em que a fase apresenta o organismo.
 */
export function ensureAzospirillumBeforeAscentGates({
  level,
  encounters = [],
  seedValue = '',
  phase = 10,
} = {}) {
  const gates = level?.ascentGates || [];
  if (!gates.length) return encounters;
  const firstGateChunk = Math.min(...gates.map(gate => gate.chunkIndex));
  const deadline = firstGateChunk - ASCENT_GATE_AZO_LEAD_CHUNKS;
  const firstAzospirillum = encounters
    .filter(encounter => encounter.id === 'azospirillum' && Number.isInteger(encounter.logicIndex))
    .map(encounter => encounter.logicIndex)
    .sort((left, right) => left - right)[0];
  if (Number.isInteger(firstAzospirillum) && firstAzospirillum <= deadline) return encounters;

  const candidates = routePlatforms(level).filter(platform => (
    Number.isInteger(platform.logicIndex)
    && platform.logicIndex >= 1
    && platform.logicIndex <= Math.max(1, deadline)
    && platform.w >= 120
    && !platform.final
    && !platform.ascentGate
  ));
  if (!candidates.length) return encounters;
  // O mais tarde possível dentro do prazo: aproxima o encontro do portão sem
  // ultrapassá-lo, para não competir com as estreias do começo da fase.
  const host = candidates[candidates.length - 1];
  const random = createRandom(`${seedValue}:ascent-gate-azospirillum:p${phase}`);
  return [
    ...encounters,
    {
      id: 'azospirillum',
      x: host.x + host.w * (.3 + random() * .4),
      y: host.y - 46 - random() * 26,
      r: 155,
      territory: 620,
      collect: false,
      logicIndex: host.logicIndex,
      source: 'ascent-gate-prerequisite',
      requiresSeenCardId: null,
    },
  ];
}

function activeAzospirillumColony(inoculants, ladder) {
  return (inoculants.colonies || []).find(colony => (
    colony.type === 'azospirillum'
    && colony.platform === ladder.host
    && colony.growth >= .68
    && colony.vigor > .05
    && !colony.dormant
  )) || null;
}

// Margem para o degrau SUPERIOR da escada obrigatoria pousar em/acima do
// requiredReach: os degraus sao interpolados, entao o topo real fica um pouco
// abaixo do fim da escada. Somar um espacamento garante que o degrau de
// lancamento chegue ao requiredReach validado pela fisica.
const MANDATORY_TOP_STEP_MARGIN = RUNTIME_TARGET_STEP_SPACING;
// Folga vertical minima entre o degrau de lancamento e o alvo, para o salto
// duplo continuar OBRIGATORIO por mais nitrogenio que exista.
const MANDATORY_TARGET_GAP = 70;

export function createAzospirillumRootGrowth({ state, entities, inoculants }) {
  let lastToastAt = -Infinity;
  // Estado transitorio da travessia da prova obrigatoria (Fase 3).
  let mandatoryAttempt = { touchedLadder: false, doubleJumpAfter: false, lastDoubleJumpCount: 0 };

  function resetMandatoryAttempt() {
    mandatoryAttempt = { touchedLadder: false, doubleJumpAfter: false, lastDoubleJumpCount: 0 };
  }

  function ladders() {
    return state.level.azospirillumRootLadders || [];
  }

  function mandatoryChallenge() {
    return state.level.azospirillumChallenge || null;
  }

  function isMandatoryHost(host) {
    const challenge = mandatoryChallenge();
    if (!challenge || !host) return false;
    return host === challenge.hostPlatform
      || (Number.isInteger(challenge.hostLogicIndex) && host.logicIndex === challenge.hostLogicIndex);
  }

  function removeStepCollider(step) {
    if (!step.collider) return;
    const position = (state.level.platforms || []).indexOf(step.collider);
    if (position >= 0) state.level.platforms.splice(position, 1);
    step.collider = null;
  }

  function removeStepPlatforms() {
    state.level.platforms = (state.level.platforms || [])
      .filter(platform => !platform.azospirillumLadderStep);
    for (const ladder of ladders()) {
      for (const step of ladder.steps || []) step.collider = null;
    }
  }

  function clear() {
    entities?.audio?.stopGroup('azospirillum-growth');
    state.level.platforms = (state.level.platforms || [])
      .filter(platform => !platform.azospirillumStructure);
    state.level.azospirillumRootLadders = [];
    state.level.azospirillumRoots = [];
    lastToastAt = -Infinity;
    resetMandatoryAttempt();
  }

  function reset() {
    entities?.audio?.stopGroup('azospirillum-growth');
    removeStepPlatforms();
    // So os estados transitorios da tentativa sao limpos aqui; challenge.developed
    // e challenge.traversed pertencem ao nivel e sao regidos pelo runtime.
    resetMandatoryAttempt();
    for (const ladder of ladders()) {
      ladder.progress = 0;
      ladder.visibleProgress = 0;
      ladder.unlockedDevelopedReach = 0;
      ladder.targetDevelopedReach = 0;
      ladder.mature = false;
      ladder.developed = false;
      ladder.paused = false;
      ladder.colony = null;
      ladder.announced = false;
      ladder.audioStarted = false;
      ladder.audioCompleted = false;
      ladder.host.azospirillumHairDensity = 0;
      for (const step of ladder.steps || []) {
        step.progress = 0;
        step.currentWidth = step.startWidth;
        step.currentHeight = step.startHeight;
        step.mature = false;
        step.collider = null;
      }
    }
    state.level.azospirillumRoots = ladders();
    lastToastAt = -Infinity;
  }

  function announce(text, seconds = 4.6) {
    if (state.time - lastToastAt < 1.6) return;
    state.toast = text;
    state.toastTime = seconds;
    lastToastAt = state.time;
  }

  function activateStepCollider(ladder, step) {
    if (step.collider || !step.mature) return;
    step.collider = {
      x: step.centerX - step.targetWidth / 2,
      y: step.y,
      w: step.targetWidth,
      h: step.targetHeight,
      type: 'root',
      oneWay: true,
      azospirillumStructure: true,
      azospirillumLadderStep: true,
      azospirillumRootLadder: true,
      ladderId: ladder.id,
      stepId: step.id,
      optionalDetourId: ladder.optionalDetourId || null,
      detourModuleId: ladder.detourModuleId || null,
      routeRole: ladder.optionalDetourId ? 'optional' : undefined,
      routeScope: ladder.optionalDetourId ? 'optional' : undefined,
      routeOwned: Boolean(ladder.optionalDetourId),
      logicIndex: ladder.hostLogicIndex,
      mature: true,
      rootHealth: 1,
      rootMaxHealth: 1,
    };
    state.level.platforms.push(step.collider);
  }

  function updateStep(ladder, step) {
    // Só a transição conta. Um degrau que já estava maduro (escada restaurada,
    // bloco `developed` no topo de `updateLadder`) nunca passa por aqui.
    const wasMature = step.mature === true;
    const localProgress = clamp(ladder.progress * ladder.steps.length - step.index, 0, 1);
    step.progress = Math.max(step.progress, localProgress);
    step.currentWidth = lerp(step.startWidth, step.targetWidth, step.progress);
    step.currentHeight = lerp(step.startHeight, step.targetHeight, step.progress);
    // O degrau so colide em 100%. Colidir a 35% deixa o jogador pisar num
    // degrau que ainda esta crescendo, e a regra existe justamente para a
    // escada ser consequencia da colonia madura e nao um atalho. Isto veio
    // junto de uma correcao de colisao, mas e mudanca de regra de jogo — se for
    // para afrouxar, que seja uma decisao deliberada e com o teste atualizado.
    step.mature = step.progress >= 1;
    if (step.mature) activateStepCollider(ladder, step);
    else removeStepCollider(step);
    if (!wasMature && step.mature) {
      entities?.audio?.play('azospirillumStepMature', {
        x: step.centerX,
        y: step.y,
        instanceId: ladder.id,
      });
    }
  }

  function updateDynamicOptionalLadder(ladder, dt) {
    const colony = activeAzospirillumColony(inoculants, ladder);
    ladder.colony = colony;
    const audio = entities?.audio;
    const loopKey = `azospirillum-growth:${ladder.id}`;
    if (!colony) {
      ladder.paused = ladder.progress > 0;
      if (ladder.progress > 0) audio?.pauseLoop(loopKey);
      return;
    }

    if (!ladder.audioStarted) {
      const delivered = audio ? fxLanded(audio.play('azospirillumRootGrowthStart', {
        x: colony.x,
        y: ladder.host.y,
        instanceId: ladder.id,
      })) : true;
      if (delivered) ladder.audioStarted = true;
    }

    const nitrogen = getNitrogenAvailability({
      state,
      azospirillumNitrogen: state.azospirillumNitrogen,
    });
    const fullLength = Math.max(1, ladder.fullPathLength);
    const minimumReach = Math.min(ladder.minimumDevelopedReach, fullLength);
    ladder.targetDevelopedReach = lerp(
      minimumReach,
      fullLength,
      nitrogen.totalFraction,
    );
    ladder.unlockedDevelopedReach = Math.max(
      ladder.unlockedDevelopedReach || 0,
      ladder.targetDevelopedReach,
    );

    let growing = false;
    for (const step of ladder.steps) {
      if (step.arcDistance > ladder.unlockedDevelopedReach + .001) continue;
      if (step.mature) continue;
      growing = true;
      const wasMature = step.mature;
      const duration = Math.max(
        .1,
        (step.segmentLength / 100) * ladder.growthSecondsPer100Units,
      );
      step.progress = clamp(step.progress + dt / duration, 0, 1);
      step.currentWidth = lerp(step.startWidth, step.targetWidth, step.progress);
      step.currentHeight = lerp(step.startHeight, step.targetHeight, step.progress);
      step.mature = step.progress >= 1;
      if (step.mature) activateStepCollider(ladder, step);
      if (!wasMature && step.mature) {
        audio?.play('azospirillumStepMature', {
          x: step.centerX,
          y: step.y,
          instanceId: ladder.id,
        });
      }
    }

    ladder.progress = ladder.steps.length
      ? ladder.steps.reduce((sum, step) => sum + step.progress, 0) / ladder.steps.length
      : 0;
    ladder.visibleProgress = clamp(ladder.unlockedDevelopedReach / fullLength, 0, 1);
    ladder.host.azospirillumHairDensity = Math.max(
      ladder.host.azospirillumHairDensity || 0,
      ladder.visibleProgress,
    );
    ladder.developed = ladder.unlockedDevelopedReach >= fullLength - .001
      && ladder.steps.every(step => step.mature);
    ladder.mature = ladder.developed;
    ladder.paused = !ladder.developed && !growing;
    colony.stage = ladder.developed
      ? 'acesso radicular opcional maduro'
      : 'formando acesso radicular opcional';

    if (growing) {
      audio?.startLoop(loopKey, 'azospirillumRootGrowth', {
        x: ladder.startX,
        y: lerp(ladder.startY, ladder.endY, ladder.visibleProgress),
        gain: .45 + ladder.visibleProgress * .35,
        rate: .9 + ladder.visibleProgress * .1,
      });
    } else {
      audio?.pauseLoop(loopKey);
    }

    if (!ladder.developed || ladder.audioCompleted) return;
    audio?.stopLoop(loopKey);
    const delivered = audio ? fxLanded(audio.play('azospirillumLadderComplete', {
      x: ladder.endX,
      y: ladder.endY,
      instanceId: ladder.id,
    })) : true;
    if (delivered) ladder.audioCompleted = true;
    ladder.announced = true;
    if (ladder.destination) {
      ladder.destination.rootSystemId = ladder.host.rootSystemId
        || `root-system-${ladder.hostLogicIndex}`;
      ladder.host.rootSystemId = ladder.destination.rootSystemId;
    }
  }

  function updateLadder(ladder, dt) {
    if (ladder.accessStyle === 'dynamic-optional-detour') {
      updateDynamicOptionalLadder(ladder, dt);
      return;
    }
    const oldStartY = ladder.startY;
    ladder.startY = ladder.host.y - 6;
    if (ladder.destination) ladder.endY = ladder.destination.y - 6;
    else ladder.endY += (ladder.startY - oldStartY);
    for (const step of ladder.steps) {
      const t = (step.index + 1) / (ladder.steps.length + 1);
      step.y = lerp(ladder.startY, ladder.endY, t);
      if (step.collider) step.collider.y = step.y;
    }

    if (ladder.developed) {
      ladder.progress = 1;
      ladder.visibleProgress = 1;
      ladder.mature = true;
      ladder.host.azospirillumHairDensity = 1;
      for (const step of ladder.steps) {
        step.progress = 1;
        step.currentWidth = step.targetWidth;
        step.currentHeight = step.targetHeight;
        step.mature = true;
        activateStepCollider(ladder, step);
      }
      return;
    }

    const colony = activeAzospirillumColony(inoculants, ladder);
    ladder.colony = colony;
    ladder.paused = ladder.progress > 0 && !colony;
    const audio = entities?.audio;
    const loopKey = `azospirillum-growth:${ladder.id}`;
    if (!colony) {
      // Sem colônia funcional a escada para de crescer: o loop recua sem morrer,
      // e o efeito de início NÃO volta a tocar quando ela retomar.
      if (ladder.progress > 0) audio?.pauseLoop(loopKey);
      return;
    }

    // Início real: progresso zero e colônia funcional presente. `audioStarted`
    // separa isto do toast, que tem cooldown e é suprimido em `knownSkill`.
    if (ladder.progress === 0 && !ladder.audioStarted) {
      const entregue = audio ? fxLanded(audio.play('azospirillumRootGrowthStart', {
        x: colony.x, y: ladder.host.y, instanceId: ladder.id,
      })) : true;
      if (entregue) ladder.audioStarted = true;
    }
    if (ladder.progress === 0 && !ladder.knownSkill) {
      announce('Azospirillum inoculado: fitormônios iniciaram a escada de ramificações radiculares.');
      entities?.burst?.(colony.x, ladder.host.y, '#72e8dd', 22, 90);
    }
    ladder.progress = clamp(
      ladder.progress + dt / Math.max(.1, ladder.growthDurationSeconds),
      0,
      1,
    );
    ladder.visibleProgress = ladder.progress;
    ladder.host.azospirillumHairDensity = Math.max(
      ladder.host.azospirillumHairDensity || 0,
      ladder.progress,
    );
    colony.stage = ladder.progress < 1 ? 'formando escada radicular' : 'escada radicular madura';
    // Loop de crescimento, sustentado por quadro enquanto a escada avança.
    // Ganho e rate são multiplicadores relativos ao defaultGain da faixa.
    if (ladder.progress < 1) {
      audio?.startLoop(loopKey, 'azospirillumRootGrowth', {
        x: ladder.startX,
        y: lerp(ladder.startY, ladder.endY, ladder.progress),
        gain: .55 + ladder.progress * .45,
        rate: .92 + ladder.progress * .12,
      });
    }
    for (const step of ladder.steps) updateStep(ladder, step);

    ladder.developed = ladder.progress >= 1 && ladder.steps.every(step => step.mature);
    ladder.mature = ladder.developed;
    ladder.paused = false;
    if (ladder.developed && ladder.mandatoryChallenge && state.level.azospirillumChallenge) {
      state.level.azospirillumChallenge.developed = true;
    }
    // Conclusão: primeira transição de `developed`, marca própria (não a do
    // toast). O loop sai antes para o remate não competir com ele.
    if (ladder.developed && !ladder.audioCompleted) {
      audio?.stopLoop(loopKey);
      const entregue = audio ? fxLanded(audio.play('azospirillumLadderComplete', {
        x: ladder.endX,
        y: ladder.endY,
        instanceId: ladder.id,
      })) : true;
      if (entregue) ladder.audioCompleted = true;
    }
    if (ladder.developed && !ladder.announced) {
      ladder.announced = true;
      // Uma escada sem bloco alvo sobe reta: ganha altura, mas nao ha destino
      // com quem compartilhar o sistema radicular.
      if (ladder.destination) {
        ladder.destination.rootSystemId = ladder.host.rootSystemId || `root-system-${ladder.hostLogicIndex}`;
        ladder.host.rootSystemId = ladder.destination.rootSystemId;
      }
      state.player.soil += 4.5;
      state.player.hope += 3.2;
      entities?.burst?.(ladder.endX, ladder.endY, '#d7ba7d', 34, 140);
      announce('Escada radicular madura: todos os degraus agora sustentam Miguelito.', 5.2);
    }
  }

  let runtimeLadderId = 0;

  // A escada e efeito da inoculacao, nao recurso do nivel: onde a colonia de
  // Azospirillum amadurece sobre uma raiz, a raiz lateral sai dali.
  // ESCADA SEM DESTINO: o topo e RELATIVO A RAIZ, nao a uma linha do mundo.
  //
  // Era `Math.max(70, host.y - reach)`. O 70 nasceu quando o mundo tinha uma
  // tela de altura e o topo da geometria ficava perto de y=0 — outro limite
  // absoluto sobrevivendo a uma mudanca de escala, como o `[220, 560]` da
  // senoide e o `[250, 555]` do fallback.
  //
  // Com a silhueta vertical a rota sobe a Y NEGATIVO. Numa raiz em y=-100 com
  // alcance 300, `host.y - reach` da -400, o `Math.max` devolvia 70, e 70 esta
  // 170px ABAIXO da raiz: a subida virava descida, `end.y >= start.y - 40`
  // disparava e a funcao devolvia `null`. Nenhuma escada, e nenhum aviso.
  //
  // Era isto por tras de "a escada do Azo so forma no bloco do desafio": o
  // hospedeiro obrigatorio da fase 3 esta numa altura antiga, e qualquer raiz
  // da parte alta da rota nova caia neste ramo.
  function createRuntimeLadder(host, destination, reach) {
    const start = topPoint(host, host.x + host.w / 2);
    const end = destination
      ? topPoint(destination, start.x)
      : { x: start.x, y: host.y - reach };
    // Continua valendo para DESTINO declarado: destino que nao esta acima do
    // hospedeiro nao e subida, e escada que desce nao existe. Sem destino,
    // `host.y - reach` esta sempre acima, porque `reach >= RUNTIME_MIN_REACH`.
    if (end.y >= start.y - 40) return null;

    const id = `azo-ladder-runtime-${++runtimeLadderId}`;
    const swayDirection = Math.sign(end.x - start.x || 1);
    const sway = swayDirection * Math.min(ROOT_SWAY_MAX, 18 + Math.abs(end.x - start.x) * .2);
    const stepCount = runtimeStepCount(start.y - end.y);
    const steps = Array.from({ length: stepCount }, (_, index) => {
      const t = (index + 1) / (stepCount + 1);
      return {
        id: `${id}-step-${index + 1}`,
        index,
        centerX: lerp(start.x, end.x, t) + Math.sin(t * Math.PI) * sway,
        y: lerp(start.y, end.y, t),
        startWidth: 14,
        startHeight: 4,
        targetWidth: BRANCH_WIDTH,
        targetHeight: 12,
        currentWidth: 14,
        currentHeight: 4,
        progress: 0,
        mature: false,
        collider: null,
      };
    });

    return {
      id,
      host,
      hostLogicIndex: host.logicIndex ?? -1,
      destination,
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
      reach,
      steps,
      growthDurationSeconds: RUNTIME_GROWTH_SECONDS,
      phase: (host.x % 97) / 97 * TAU,
      progress: 0,
      visibleProgress: 0,
      mature: false,
      developed: false,
      paused: false,
      announced: false,
      colony: null,
    };
  }

  // O nitrogenio disponivel governa quanto a raiz lateral cresce: fixacao
  // associativa do proprio Azospirillum mais a simbiotica dos nodulos. Trocar a
  // fonte aqui e suficiente para trocar a regra de alcance.
  function nitrogenStock() {
    const associative = state.azospirillumNitrogen?.associativeNitrogenRate || 0;
    const symbiotic = (state.level.rhizobiumNodules || [])
      .reduce((sum, site) => sum + (site.fixationRate || 0), 0);
    return associative + symbiotic;
  }

  function reachFromStock() {
    const supply = clamp(nitrogenStock() / STOCK_FOR_FULL_REACH, 0, 1);
    return RUNTIME_MIN_REACH + supply * (RUNTIME_MAX_REACH - RUNTIME_MIN_REACH);
  }

  // Piso anti-softlock (Fase 7): na raiz OBRIGATORIA da fase 3, o alcance nunca
  // pode cair abaixo do requiredReach validado — baixa fixacao momentanea de N
  // nao pode tornar a prova impossivel. O nitrogenio ainda influencia raizes
  // opcionais e o vigor; aqui ele so nao consegue encurtar a prova.
  function mandatoryEffectiveReach(challenge) {
    const required = Number.isFinite(challenge.requiredReach) ? challenge.requiredReach : RUNTIME_MIN_REACH;
    const floor = required + MANDATORY_TOP_STEP_MARGIN;
    // Mantem uma folga vertical ao alvo para o salto duplo seguir obrigatorio,
    // por mais nitrogenio que exista.
    const ceiling = Math.max(floor, (Number.isFinite(challenge.rise) ? challenge.rise : floor) - MANDATORY_TARGET_GAP);
    return clamp(Math.max(reachFromStock(), floor), floor, ceiling);
  }

  // A plataforma e a parede da raiz: a raiz lateral sai dela para cima. Havendo
  // bloco alcancavel, a escada inclina em direcao a ele; senao sobe reta.
  function destinationFor(host, reach) {
    const hostCenter = host.x + host.w / 2;
    let best = null;
    for (const candidate of state.level.platforms || []) {
      if (candidate === host || candidate.azospirillumStructure || candidate.mycorrhizaStructure) continue;
      if (candidate.mycorrhizaIntroDestination) continue;
      const rise = host.y - candidate.y;
      if (rise < 60 || rise > reach) continue;
      const point = topPoint(candidate, hostCenter);
      const dx = Math.abs(point.x - hostCenter);
      if (dx > MAX_LATERAL_REACH) continue;
      const score = dx + rise * .4;
      if (!best || score < best.score) best = { platform: candidate, score };
    }
    return best?.platform || null;
  }

  function spawnLaddersFromColonies() {
    const challenge = mandatoryChallenge();
    for (const colony of inoculants.colonies || []) {
      if (colony.type !== 'azospirillum' || colony.dormant) continue;
      if (colony.growth < .68 || colony.vigor <= .05) continue;
      const host = colony.platform;
      if (!host || host.type !== 'root' || host.final) continue;
      if (host.azospirillumStructure || host.mycorrhizaStructure) continue;
      if (ladders().some(ladder => ladder.host === host)) continue;

      const mandatory = Boolean(challenge) && !challenge.traversed && isMandatoryHost(host);
      if (mandatory) {
        // Escada OBRIGATORIA sobre o hospedeiro registrado: sobe reta (raiz
        // lateral nao precisa tocar o alvo) ate a altura de lancamento, e usa o
        // requiredReach com piso anti-softlock. Nao concorre outra escada aqui.
        const reach = mandatoryEffectiveReach(challenge);
        const ladder = createRuntimeLadder(host, null, reach);
        if (ladder) {
          ladder.mandatoryChallenge = true;
          ladder.challengeId = challenge.id;
          ladder.targetPlatform = challenge.targetPlatform;
          state.level.azospirillumRootLadders.push(ladder);
        }
        continue;
      }

      const reach = reachFromStock();
      const ladder = createRuntimeLadder(host, destinationFor(host, reach), reach);
      if (ladder) {
        state.level.azospirillumRootLadders.push(ladder);
        expandBoundsForLadder(ladder);
      }
    }
  }

  /**
   * A escada nova pode passar do topo conhecido do mundo.
   *
   * `synchronizeWorldBounds` só rodava na construção da fase, e a escada é
   * criada em RUNTIME, quando a colônia amadurece. Numa raiz alta o último
   * degrau saía acima de `geometryTopY` e a câmera não subia junto: o jogador
   * escalava para fora do enquadramento.
   *
   * `calculateWorldGeometryBounds` já percorre `azospirillumRootLadders` e os
   * degraus, então basta re-sincronizar — nada de um segundo cálculo paralelo.
   */
  function expandBoundsForLadder(ladder) {
    const topY = Math.min(
      ladder.endY,
      ...ladder.steps.map(step => step.y),
    );
    if (Number.isFinite(state.level.geometryTopY) && topY >= state.level.geometryTopY) return;
    synchronizeWorldBounds(state.level, state.visibleWorldHeight);
  }

  // Prova de fato (Fase 8): so conta como travessia quando Miguelito USA a escada
  // obrigatoria (pisa num degrau dela), executa o salto duplo em seguida e pousa
  // no bloco alvo. Estados transitorios sao limpos ao pousar em bloco nao
  // relacionado (inclui o respawn, que devolve o jogador ao checkpoint).
  function footPlatform() {
    const player = state.player;
    if (!player?.onGround) return null;
    const feetY = player.y + player.h;
    for (const platform of state.level.platforms || []) {
      // Sem excecao para safetyStep: recovery desligada nao sustenta ninguem,
      // logo nao pode ser lida como o chao onde o jogador esta apoiado.
      if (platform.recovery && state.recoveryPlatformsDisabled) continue;
      const overlap = player.x + player.w > platform.x + 3 && player.x < platform.x + platform.w - 3;
      if (!overlap) continue;
      if (Math.abs(feetY - platform.y) > 8) continue;
      return platform;
    }
    return null;
  }

  function mandatoryStepPlatform(platform) {
    if (!platform?.azospirillumLadderStep || !platform.ladderId) return false;
    return ladders().some(ladder => ladder.id === platform.ladderId && ladder.mandatoryChallenge);
  }

  function trackMandatoryTraversal() {
    const challenge = mandatoryChallenge();
    if (!challenge || challenge.traversed) return;
    const player = state.player;
    if (!player) return;

    const doubleJumpCount = ensurePhaseObjectiveProgress(state).performedDoubleJumpCount || 0;
    if (!player.onGround && mandatoryAttempt.touchedLadder && doubleJumpCount > mandatoryAttempt.lastDoubleJumpCount) {
      mandatoryAttempt.doubleJumpAfter = true;
    }
    mandatoryAttempt.lastDoubleJumpCount = doubleJumpCount;

    const foot = footPlatform();
    if (!foot) return;
    if (mandatoryStepPlatform(foot)) {
      mandatoryAttempt.touchedLadder = true;
      return;
    }
    const onTarget = foot === challenge.targetPlatform
      || (foot.mandatoryAzospirillumTarget
        && Number.isInteger(challenge.targetLogicIndex)
        && foot.logicIndex === challenge.targetLogicIndex);
    if (onTarget) {
      if (mandatoryAttempt.touchedLadder && mandatoryAttempt.doubleJumpAfter) challenge.traversed = true;
      return;
    }
    // Pousou num bloco nao relacionado (nem degrau, nem alvo): reinicia a
    // tentativa. Cobre morte/respawn (volta ao checkpoint) e desistencias.
    mandatoryAttempt.touchedLadder = false;
    mandatoryAttempt.doubleJumpAfter = false;
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    if (!state.level.azospirillumRootLadders) state.level.azospirillumRootLadders = [];
    spawnLaddersFromColonies();
    for (const ladder of ladders()) updateLadder(ladder, dt);
    state.level.azospirillumRoots = ladders();
    trackMandatoryTraversal();
  }

  function drawLadder(ctx, ladder) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const points = [
      { x: ladder.startX, y: ladder.startY },
      ...ladder.steps.map(step => ({ x: step.centerX, y: step.y + step.currentHeight / 2 })),
      { x: ladder.endX, y: ladder.endY },
    ];
    const stepsGrowing = ladder.steps.filter(s => s.progress > 0).length;
    const visibleSegments = ladder.developed ? points.length - 1 : (ladder.progress > 0 ? Math.max(1, stepsGrowing) : 0);

    // Mesma topologia da antiga ponte vertical da micorriza: a estrutura
    // detecta a raiz superior e cresce do bloco inferior até ela. Aqui o
    // traço é radicular, não hifal.
    if (visibleSegments > 0) {
      ctx.strokeStyle = ladder.developed ? '#a7784f' : '#c3a172';
      ctx.lineWidth = 5 + ladder.visibleProgress * 2;
      ctx.shadowColor = '#72e8dd';
      ctx.shadowBlur = ladder.developed ? 3 : 8;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index <= visibleSegments; index++) {
        const previous = points[index - 1];
        const point = points[index];
        ctx.quadraticCurveTo(
          lerp(previous.x, point.x, .55) + Math.sin(index * 1.8 + ladder.phase) * 5,
          lerp(previous.y, point.y, .5),
          point.x,
          point.y,
        );
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    const shouldShowInstruction = ladder.showInstruction === true
      || ladder.tutorialDemonstration === true
      || ladder.mandatoryChallenge === true;
    if (ladder.progress === 0 && shouldShowInstruction) {
      ctx.font = '700 12px Inter,system-ui';
      ctx.textAlign = 'center';
      // A demonstracao inicial ENSINA; a prova obrigatoria e o objetivo. O texto
      // precisa separar os dois, senao o jogador toma a demonstracao pela prova.
      const demonstracao = ladder.tutorialDemonstration && !ladder.mandatoryChallenge;
      ctx.fillStyle = demonstracao ? '#c9d8a8' : '#f3ce68';
      ctx.fillText(
        demonstracao
          ? 'Teste o Azospirillum nesta raiz'
          : 'Inocule Azospirillum nesta raiz',
        ladder.host.x + ladder.host.w / 2,
        ladder.host.y - 30,
      );
    }
    for (const step of ladder.steps) {
      if (step.progress <= 0) continue;
      const half = step.currentWidth / 2;
      ctx.strokeStyle = step.mature ? '#d6b67d' : '#d8c69d';
      ctx.lineWidth = step.currentHeight;
      ctx.shadowColor = step.mature ? '#9bea8f' : '#72e8dd';
      ctx.shadowBlur = step.mature ? 5 : 11;
      ctx.beginPath();
      ctx.moveTo(step.centerX - half, step.y + step.currentHeight / 2);
      ctx.quadraticCurveTo(
        step.centerX,
        step.y - 3,
        step.centerX + half,
        step.y + step.currentHeight / 2,
      );
      ctx.stroke();
      ctx.shadowBlur = 0;

      const hairCount = Math.floor(step.progress * 5);
      ctx.strokeStyle = 'rgba(238,220,185,.64)';
      ctx.lineWidth = 1;
      for (let hair = 0; hair < hairCount; hair++) {
        const x = step.centerX - half + (hair + 1) / (hairCount + 1) * step.currentWidth;
        ctx.beginPath();
        ctx.moveTo(x, step.y + 1);
        ctx.lineTo(x + (hair % 2 ? 4 : -4), step.y - 8 - (hair % 3));
        ctx.stroke();
      }
    }

    const rootHairCount = Math.floor(ladder.visibleProgress * 12);
    ctx.strokeStyle = 'rgba(214,239,190,.6)';
    ctx.lineWidth = 1;
    for (let index = 0; index < rootHairCount; index++) {
      const t = (index + 1) / (rootHairCount + 1);
      const segment = Math.min(points.length - 2, Math.floor(t * (points.length - 1)));
      const local = t * (points.length - 1) - segment;
      const x = lerp(points[segment].x, points[segment + 1].x, local);
      const y = lerp(points[segment].y, points[segment + 1].y, local);
      const side = index % 2 === 0 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + side * (8 + index % 4 * 2), y - 4);
      ctx.stroke();
    }

    if (
      !ladder.developed
      && ladder.progress > 0
      && ladder.silentDiscovery !== true
    ) {
      ctx.font = '700 10px Inter,system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#a8f0ea';
      ctx.fillText(`Escada radicular ${Math.round(ladder.progress * 100)}%`, ladder.startX, ladder.host.y - 28);
    }
    ctx.restore();
  }

  function render(ctx) {
    if (!ladders().length) return;
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    for (const ladder of ladders()) {
      const minX = Math.min(ladder.startX, ladder.endX) - 100;
      const maxX = Math.max(ladder.startX, ladder.endX) + 100;
      if (maxX < state.cameraX || minX > state.cameraX + W) continue;
      drawLadder(ctx, ladder);
    }
    ctx.restore();
  }

  return {
    get siteCount() { return ladders().filter(ladder => ladder.colony).length; },
    get rootCount() { return ladders().length; },
    get matureCount() { return ladders().filter(ladder => ladder.developed).length; },
    get growingCount() { return ladders().filter(ladder => ladder.progress > 0 && !ladder.developed).length; },
    get pausedCount() { return ladders().filter(ladder => ladder.paused).length; },
    get platformCount() {
      return ladders().reduce((sum, ladder) => sum + ladder.steps.filter(step => step.collider).length, 0);
    },
    get ladders() { return ladders(); },
    clear,
    reset,
    update,
    render,
  };
}
