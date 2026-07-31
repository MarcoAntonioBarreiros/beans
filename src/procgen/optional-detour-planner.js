import { createRandom } from './random.js';
import { getPrimaryTraversalPlatforms } from './traversal-route.js';

export const REFERENCE_SCREEN_WORLD_WIDTH = 1280;
export const OPTIONAL_DETOUR_AUTHORED_ENCOUNTER_SPACING = 2;
// Separação vertical de projeto entre a rota opcional e a rota principal. Não é
// "não encostar": é o espaço que o personagem precisa para saltar POR BAIXO,
// pela rota fácil, sem bater na rota de cima. O número já existia aqui como
// MINIMUM_PRE_REJOIN_SEPARATION e no builder como uma segunda cópia; agora é um
// só, exportado, porque duas constantes para o mesmo contrato foi exatamente o
// que deixou o sintetizador T1 usar 48 px sem ninguém notar.
export const OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE = 270;
const MIN_START_WIDTH = 160;
const MIN_REJOIN_WIDTH = 220;
const WINDOW_TOLERANCE = .15;
const PERCEPTIBLE_VERTICAL_DELTA = 28;
const MINIMUM_PRIMARY_VERTICAL_RANGE = 90;
const MAXIMUM_ASCENDING_RUN = 3;
const ACCESS_HORIZONTAL_ADVANCES = Object.freeze([300, 340, 380, 420, 460, 500, 520]);
const ACCESS_VERTICAL_RISES = Object.freeze([230, 250, 275, 300, 320, 340]);
const MINIMUM_PRE_REJOIN_SEPARATION = OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE;

function platformCenterX(platform) {
  return platform.x + platform.w / 2;
}

function hasCheckpoint(level, platform) {
  return (level.checkpoints || []).some(checkpoint => (
    checkpoint.platform === platform
    || checkpoint.platformId === platform.platformId
    || checkpoint.logicIndex === platform.logicIndex
  ));
}

function belongsToFixedGeometry(platform) {
  return Boolean(
    platform.authored
    || platform.fixedBlockId
    || platform.signatureChallenge
    || platform.mandatoryAzospirillumTarget
    || platform.mycorrhizaIntroDestination
    || platform.traversalEncounterId
    || platform.encounterInstanceId
    || platform.blockRole
    || platform.isSkillIntro
    || platform.allyId,
  );
}

function startEligible(level, platform, routeLength) {
  return platform.type === 'root'
    && platform.w >= MIN_START_WIDTH
    && platform.logicIndex >= 5
    && platform.logicIndex <= routeLength - 5
    && !platform.recovery
    && !platform.final
    && !hasCheckpoint(level, platform)
    && !belongsToFixedGeometry(platform);
}

function rejoinEligible(level, platform, routeLength) {
  return platform.type === 'root'
    && platform.w >= MIN_REJOIN_WIDTH
    && platform.logicIndex >= 6
    && platform.logicIndex <= routeLength - 5
    && !platform.recovery
    && !platform.final
    && !hasCheckpoint(level, platform)
    && !belongsToFixedGeometry(platform);
}

function ensurePrimaryPlatformId(platform, routeIndex) {
  const id = platform.platformId || platform.id
    || `primary-route-${platform.logicIndex}-${routeIndex}`;
  platform.platformId ||= id;
  return id;
}

function maximumAccessSeparation(route, host) {
  let maximum = -Infinity;
  for (const horizontalAdvance of ACCESS_HORIZONTAL_ADVANCES) {
    const candidateX = host.x + host.w + horizontalAdvance + 110;
    const nearest = route.reduce((current, platform) => (
      !current
      || Math.abs(platformCenterX(platform) - candidateX)
        < Math.abs(platformCenterX(current) - candidateX)
        ? platform
        : current
    ), null);
    for (const verticalRise of ACCESS_VERTICAL_RISES) {
      maximum = Math.max(maximum, nearest.y - (host.y - verticalRise));
    }
  }
  return maximum;
}

function longestSignedRun(deltas, predicate) {
  let longest = 0;
  let current = 0;
  for (const delta of deltas) {
    if (predicate(delta)) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function classifyPrimaryProfile({
  primaryClimbCount,
  primaryDropCount,
  primaryNetDelta,
  longestClimbRun,
  longestDropRun,
}) {
  if (primaryClimbCount >= 2 && primaryDropCount >= 2) {
    if (longestDropRun >= 2 && primaryNetDelta < 0) return 'deep-dip-recovery';
    if (longestClimbRun >= 2 && primaryNetDelta > 0) return 'broken-ridge';
    return 'double-undulation';
  }
  if (primaryNetDelta < 0) return 'ascending-with-release';
  if (primaryNetDelta > 0) return 'descending-with-recovery';
  return 'ridge-valley';
}

export function analyzePrimaryWindow(route, startIndex, rejoinIndex) {
  const platforms = route.slice(startIndex, rejoinIndex + 1);
  const primaryYSequence = platforms.map(platform => platform.y);
  const perceptibleDeltas = [];
  for (let index = 1; index < primaryYSequence.length; index++) {
    const delta = primaryYSequence[index] - primaryYSequence[index - 1];
    perceptibleDeltas.push(
      Math.abs(delta) >= PERCEPTIBLE_VERTICAL_DELTA ? delta : 0,
    );
  }
  const primaryClimbCount = perceptibleDeltas.filter(delta => delta < 0).length;
  const primaryDropCount = perceptibleDeltas.filter(delta => delta > 0).length;
  const primaryVerticalRange = primaryYSequence.length
    ? Math.max(...primaryYSequence) - Math.min(...primaryYSequence)
    : 0;
  const primaryNetDelta = primaryYSequence.length > 1
    ? primaryYSequence.at(-1) - primaryYSequence[0]
    : 0;
  const longestClimbRun = longestSignedRun(perceptibleDeltas, delta => delta < 0);
  const longestDropRun = longestSignedRun(perceptibleDeltas, delta => delta > 0);
  let endingClimbRun = 0;
  for (let index = perceptibleDeltas.length - 1; index >= 0; index--) {
    if (perceptibleDeltas[index] >= 0) break;
    endingClimbRun++;
  }
  const primaryProfileValid = primaryClimbCount > 0
    && primaryDropCount > 0
    && primaryVerticalRange >= MINIMUM_PRIMARY_VERTICAL_RANGE
    && longestClimbRun <= MAXIMUM_ASCENDING_RUN
    && endingClimbRun < MAXIMUM_ASCENDING_RUN;
  const primaryProfile = classifyPrimaryProfile({
    primaryClimbCount,
    primaryDropCount,
    primaryNetDelta,
    longestClimbRun,
    longestDropRun,
  });
  return {
    primaryYSequence,
    primaryVerticalRange,
    primaryClimbCount,
    primaryDropCount,
    primaryNetDelta,
    longestClimbRun,
    longestDropRun,
    primaryProfile,
    primaryProfileValid,
    endingClimbRun,
  };
}

export function logicIndexAtWorldX(primaryRoute, x) {
  let nearest = primaryRoute[0] || null;
  let nearestDistance = Infinity;
  for (const platform of primaryRoute) {
    const distance = Math.abs(platformCenterX(platform) - x);
    if (distance >= nearestDistance) continue;
    nearest = platform;
    nearestDistance = distance;
  }
  return nearest?.logicIndex ?? -1;
}

export function primaryRouteGeometryHash(level) {
  const serialized = getPrimaryTraversalPlatforms(level)
    .map(platform => [
      platform.logicIndex,
      Number(platform.x).toFixed(3),
      Number(platform.y).toFixed(3),
      Number(platform.w).toFixed(3),
      Number(platform.h).toFixed(3),
      platform.type,
    ].join(':'))
    .join('|');
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function authoredConflict(route, startIndex, rejoinIndex) {
  return route.slice(startIndex + 1, rejoinIndex).some(platform => (
    platform.authored
    && (
      platform.signatureChallenge
      || platform.mandatoryAzospirillumTarget
      || platform.traversalEncounterId
      || platform.blockRole
    )
  ));
}

function candidateForWindow({
  level,
  route,
  startIndex,
  rejoinIndex,
  requestedScreenCount,
}) {
  const startPlatform = route[startIndex] || null;
  const rejoinPlatform = route[rejoinIndex] || null;
  const hardFailures = [];
  if (!startPlatform) hardFailures.push('missing-start-platform');
  if (!rejoinPlatform) hardFailures.push('missing-rejoin-platform');
  if (!startPlatform || !rejoinPlatform) return null;

  const actualWorldSpan = platformCenterX(rejoinPlatform)
    - platformCenterX(startPlatform);
  const targetScreenCount = Math.max(
    3,
    Math.min(6, Math.round(actualWorldSpan / REFERENCE_SCREEN_WORLD_WIDTH)),
  );
  const targetWorldSpan = targetScreenCount * REFERENCE_SCREEN_WORLD_WIDTH;
  const spanError = Math.abs(actualWorldSpan - targetWorldSpan) / targetWorldSpan;
  const primaryAnalysis = analyzePrimaryWindow(route, startIndex, rejoinIndex);
  const accessSeparationCapacity = maximumAccessSeparation(route, startPlatform);
  const accessFeasibility = {
    physicallyPossible: accessSeparationCapacity >= 170,
    idealSeparationAvailable:
      accessSeparationCapacity >= MINIMUM_PRE_REJOIN_SEPARATION,
    maximumSeparation: accessSeparationCapacity,
  };
  const drop = rejoinPlatform.y - startPlatform.y;
  const dropRejoinFeasibility = {
    physicallyPossible: Number.isFinite(drop) && actualWorldSpan > 0,
    verticalDelta: drop,
  };

  if (actualWorldSpan < 3 * REFERENCE_SCREEN_WORLD_WIDTH) {
    hardFailures.push('world-span-below-three-screens');
  }
  if (!accessFeasibility.physicallyPossible) {
    hardFailures.push('access-physically-impossible');
  }
  if (!dropRejoinFeasibility.physicallyPossible) {
    hardFailures.push('drop-rejoin-impossible');
  }
  if (authoredConflict(route, startIndex, rejoinIndex)) {
    hardFailures.push('mandatory-authored-geometry-conflict');
  }

  const softWarnings = [];
  if (primaryAnalysis.longestClimbRun > MAXIMUM_ASCENDING_RUN) {
    softWarnings.push('primary-route-climbs-too-long');
  }
  if (primaryAnalysis.primaryVerticalRange < MINIMUM_PRIMARY_VERTICAL_RANGE) {
    softWarnings.push('limited-primary-route-variation');
  }
  if (!accessFeasibility.idealSeparationAvailable) {
    softWarnings.push('vertical-separation-below-ideal');
  }
  if (spanError > WINDOW_TOLERANCE) {
    softWarnings.push('window-smaller-or-larger-than-preferred');
  }
  if (!primaryAnalysis.primaryProfileValid) {
    softWarnings.push('primary-profile-not-preferred');
  }

  const softScore = 100
    - spanError * 24
    - softWarnings.length * 7
    + Math.min(12, primaryAnalysis.primaryVerticalRange / 24);
  const id = `optional-detour-p10-${startPlatform.logicIndex}-${rejoinPlatform.logicIndex}`;
  const preEntryPlatform = route[Math.max(0, startIndex - 1)] || startPlatform;
  ensurePrimaryPlatformId(startPlatform, startIndex);
  ensurePrimaryPlatformId(preEntryPlatform, Math.max(0, startIndex - 1));
  ensurePrimaryPlatformId(rejoinPlatform, rejoinIndex);

  return {
    id,
    startPlatformId: startPlatform.platformId,
    rejoinPlatformId: rejoinPlatform.platformId,
    startLogicIndex: startPlatform.logicIndex,
    endLogicIndex: rejoinPlatform.logicIndex,
    targetScreenCount,
    requestedScreenCount,
    targetWorldSpan,
    actualWorldSpan,
    centralWorldSpan: Math.max(0, actualWorldSpan - 1040),
    primaryProfile: primaryAnalysis.primaryProfile,
    accessFeasibility,
    dropRejoinFeasibility,
    softScore,
    softWarnings,
    hardFailures,
    startPlatform,
    preEntryPlatform,
    rejoinPlatform,
    startIndex,
    rejoinIndex,
    primaryRoute: route,
    span: actualWorldSpan,
    error: spanError,
    screenCount: targetScreenCount,
    accessSeparationCapacity,
    ...primaryAnalysis,
  };
}

export function collectOptionalDetourCandidates({
  level,
  phase,
  seedValue,
  abilities = [],
} = {}) {
  const diagnostics = {
    phase,
    seedValue,
    abilities: [...abilities],
    routePlatformCount: 0,
    examinedWindowCount: 0,
    viableCandidateCount: 0,
    rejectedCandidateCount: 0,
    hardFailureCounts: {},
  };
  if (!level || phase !== 10) {
    diagnostics.reason = 'optional-detour-only-exists-in-phase-10';
    return { candidates: [], diagnostics };
  }
  const route = getPrimaryTraversalPlatforms(level);
  diagnostics.routePlatformCount = route.length;
  if (route.length < 10) {
    diagnostics.reason = 'primary-route-too-short';
    return { candidates: [], diagnostics };
  }
  route.forEach(ensurePrimaryPlatformId);

  const candidates = [];
  for (let startIndex = 0; startIndex < route.length; startIndex++) {
    const startPlatform = route[startIndex];
    if (!startEligible(level, startPlatform, route.length)) continue;
    for (
      let rejoinIndex = startIndex + 1;
      rejoinIndex < route.length;
      rejoinIndex++
    ) {
      const rejoinPlatform = route[rejoinIndex];
      if (!rejoinEligible(level, rejoinPlatform, route.length)) continue;
      diagnostics.examinedWindowCount++;
      const candidate = candidateForWindow({
        level,
        route,
        startIndex,
        rejoinIndex,
        requestedScreenCount: 6,
      });
      if (!candidate) continue;
      for (const failure of candidate.hardFailures) {
        diagnostics.hardFailureCounts[failure] =
          (diagnostics.hardFailureCounts[failure] || 0) + 1;
      }
      if (candidate.hardFailures.length) diagnostics.rejectedCandidateCount++;
      else diagnostics.viableCandidateCount++;
      candidates.push(candidate);
    }
  }
  candidates.sort((left, right) => (
    left.hardFailures.length - right.hardFailures.length
    || right.softScore - left.softScore
    || left.startLogicIndex - right.startLogicIndex
    || left.endLogicIndex - right.endLogicIndex
  ));
  return { candidates, diagnostics };
}

export function planOptionalDetour({
  level,
  phase,
  seedValue,
} = {}) {
  const { candidates, diagnostics } = collectOptionalDetourCandidates({
    level,
    phase,
    seedValue,
  });
  const route = getPrimaryTraversalPlatforms(level || {});
  const random = createRandom(`${seedValue}:optional-detour-window:p${phase}`);
  const viable = candidates.filter(candidate => !candidate.hardFailures.length);
  let selected = null;
  for (let screenCount = 6; screenCount >= 3 && !selected; screenCount--) {
    const targetSpan = screenCount * REFERENCE_SCREEN_WORLD_WIDTH;
    const legacyPreferred = viable.filter(candidate => (
      candidate.primaryProfileValid
      && candidate.accessFeasibility.idealSeparationAvailable
      && Math.abs(candidate.actualWorldSpan - targetSpan) / targetSpan
        <= WINDOW_TOLERANCE
    )).map(candidate => ({
      candidate,
      error: Math.abs(candidate.actualWorldSpan - targetSpan) / targetSpan,
    })).sort((left, right) => (
      left.error - right.error
      || left.candidate.startLogicIndex - right.candidate.startLogicIndex
    ));
    if (!legacyPreferred.length) continue;
    const bestError = legacyPreferred[0].error;
    const equivalent = legacyPreferred.filter(item => (
      item.error <= bestError + .04
    ));
    selected = equivalent[Math.floor(random() * equivalent.length)].candidate;
  }
  selected ||= viable[0] || null;
  const planningAttempts = [{
    screenCount: '3-6',
    adequateCandidateCount: viable.length,
    collectedCandidateCount: candidates.length,
  }];
  if (!selected) {
    level.optionalDetourPlanningFailure = {
      reason: 'no-physically-viable-primary-window',
      minimumVerticalRange: MINIMUM_PRIMARY_VERTICAL_RANGE,
      maximumAscendingRun: MAXIMUM_ASCENDING_RUN,
      attempts: planningAttempts,
      diagnostics,
      seedValue,
    };
    return null;
  }

  const id = selected.id;
  const preEntryPlatform = route[Math.max(0, selected.startIndex - 1)] || selected.startPlatform;
  return {
    id,
    phase,
    seedValue,
    startPlatform: selected.startPlatform,
    preEntryPlatform,
    rejoinPlatform: selected.rejoinPlatform,
    startLogicIndex: selected.startPlatform.logicIndex,
    endLogicIndex: selected.rejoinPlatform.logicIndex,
    startPlatformId: selected.startPlatform.platformId,
    preEntryPlatformId: preEntryPlatform.platformId,
    rejoinPlatformId: selected.rejoinPlatform.platformId,
    targetScreenCount: selected.screenCount,
    requestedScreenCount: selected.requestedScreenCount,
    targetWorldSpan: selected.targetWorldSpan,
    actualWorldSpan: selected.actualWorldSpan,
    centralWorldSpan: selected.centralWorldSpan,
    softScore: selected.softScore,
    softWarnings: [...selected.softWarnings],
    hardFailures: [...selected.hardFailures],
    candidateDiagnostics: diagnostics,
    primaryYSequence: selected.primaryYSequence,
    primaryVerticalRange: selected.primaryVerticalRange,
    primaryClimbCount: selected.primaryClimbCount,
    primaryDropCount: selected.primaryDropCount,
    primaryNetDelta: selected.primaryNetDelta,
    longestClimbRun: selected.longestClimbRun,
    longestDropRun: selected.longestDropRun,
    primaryProfile: selected.primaryProfile,
    primaryProfileValid: selected.primaryProfileValid,
    planningAttempts,
    authoredEncounterSpacing: OPTIONAL_DETOUR_AUTHORED_ENCOUNTER_SPACING,
    primaryRoute: route,
    primaryRouteGeometryHashBefore: primaryRouteGeometryHash(level),
  };
}
