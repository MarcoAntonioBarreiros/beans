import {
  AZO_LATERAL_ACCESS_MODULE,
  DROP_REJOIN_MODULE,
  HARD_MOVEMENT_COMBO_MODULE,
} from './optional-detour-modules.js';
import { createOptionalDetourContentRequests } from './optional-detour-content.js';
import {
  OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE,
  planOptionalDetour,
  primaryRouteGeometryHash,
} from './optional-detour-planner.js';
import { createRandom } from './random.js';

const ACCESS_WIDTH = 220;
const ACCESS_HEIGHT = 54;
const ACCESS_HORIZONTAL_ADVANCES = Object.freeze([300, 340, 380, 420, 460, 500, 520]);
const ACCESS_VERTICAL_RISES = Object.freeze([230, 250, 275, 300, 320, 340]);
const CAMERA_LOOK_AHEAD = 58;
const CAMERA_APPROACH_SPEED = 245;
const CAMERA_VERTICAL_ANCHOR = .61;
const MIN_PRIMARY_CLEARANCE = 210;
const MINIMUM_PRE_REJOIN_SEPARATION = OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE;
const PRE_REJOIN_PROGRESS_LIMIT = .85;

export function cruiseLaneY(plan) {
  const insideWindow = plan.primaryRoute.filter(platform => (
    platform.logicIndex >= plan.startLogicIndex
    && platform.logicIndex <= plan.endLogicIndex
  ));
  const topmostPrimaryY = Math.min(...insideWindow.map(platform => platform.y));
  // Mantém altura do personagem, arco de pulo e margem livres sobre toda a
  // projeção da rota principal. O mundo e a câmera já suportam Y negativo.
  return topmostPrimaryY - 285;
}

function hypotheticalViewport(level, platform, zoom) {
  const viewportWidth = Number(level.referenceScreenWorldWidth) || 1280;
  const viewportHeight = Number(level.referenceScreenWorldHeight) || 720;
  const visibleWidth = viewportWidth / zoom;
  const visibleHeight = viewportHeight / zoom;
  const playerCenterX = platform.x + platform.w / 2;
  const playerCenterY = platform.y - 32;
  const speedLookAhead = Math.min(CAMERA_APPROACH_SPEED * .34, 120);
  const maximumCameraX = Math.max(0, (Number(level.endX) || 0) - visibleWidth);
  return {
    zoom,
    x: Math.max(0, Math.min(
      maximumCameraX,
      playerCenterX + CAMERA_LOOK_AHEAD + speedLookAhead - visibleWidth / 2,
    )),
    y: playerCenterY - visibleHeight * CAMERA_VERTICAL_ANCHOR,
    w: visibleWidth,
    h: visibleHeight,
    viewportWidth,
    viewportHeight,
  };
}

function visibilityFromViewport(candidate, viewport) {
  const overlap = Math.max(
    0,
    Math.min(candidate.x + candidate.w, viewport.x + viewport.w)
      - Math.max(candidate.x, viewport.x),
  );
  const widthRatio = overlap / candidate.w;
  const surfaceScreenY = (candidate.y - viewport.y) * viewport.zoom;
  return {
    visible: widthRatio >= .35
      && surfaceScreenY >= 92
      && surfaceScreenY <= viewport.viewportHeight - 50,
    widthRatio,
    surfaceScreenY,
  };
}

function primaryClearance(plan, candidate) {
  let minimum = Infinity;
  for (const platform of plan.primaryRoute) {
    if (
      platform.x >= candidate.x + candidate.w + 6
      || platform.x + platform.w <= candidate.x - 6
    ) continue;
    minimum = Math.min(minimum, platform.y - (candidate.y + candidate.h));
  }
  return minimum;
}

export function chooseAccessLanding(level, plan) {
  const host = plan.startPlatform;
  const preEntry = plan.preEntryPlatform;
  const viewports = {
    zoom1: hypotheticalViewport(level, preEntry, 1),
    zoom145: hypotheticalViewport(level, preEntry, 1.45),
  };
  const candidates = [];
  for (const horizontalAdvance of ACCESS_HORIZONTAL_ADVANCES) {
    for (const verticalRise of ACCESS_VERTICAL_RISES) {
      const candidate = {
        x: host.x + host.w + horizontalAdvance,
        y: host.y - verticalRise,
        w: ACCESS_WIDTH,
        h: ACCESS_HEIGHT,
        horizontalAdvance,
        verticalRise,
      };
      const zoom1 = visibilityFromViewport(candidate, viewports.zoom1);
      const zoom145 = visibilityFromViewport(candidate, viewports.zoom145);
      const clearance = primaryClearance(plan, candidate);
      const nearestPrimary = nearestPrimaryPlatform(plan.primaryRoute, candidate);
      const nearestPrimarySeparation = nearestPrimary
        ? nearestPrimary.y - candidate.y
        : Infinity;
      const rootChordLength = Math.hypot(
        horizontalAdvance,
        Math.max(0, verticalRise - 22),
      );
      // O amostrador existente da raiz exige pelo menos 80 px entre degraus.
      // Rejeitar aqui uma corda curta preserva o algoritmo biológico sem criar
      // uma entrada que ele necessariamente recusaria depois.
      const rootGeometryCompatible = rootChordLength >= 395;
      const collisionFree = clearance >= MIN_PRIMARY_CLEARANCE
        && nearestPrimarySeparation >= MINIMUM_PRE_REJOIN_SEPARATION
        && rootGeometryCompatible;
      const score = (zoom1.visible ? 0 : 100000)
        + (zoom145.visible ? 0 : 100000)
        + (collisionFree ? 0 : 50000
          + Math.max(0, MIN_PRIMARY_CLEARANCE - clearance) * 100
          + Math.max(
            0,
            MINIMUM_PRE_REJOIN_SEPARATION - nearestPrimarySeparation,
          ) * 100)
        + horizontalAdvance * .2
        + Math.abs(verticalRise - 285);
      candidates.push({
        ...candidate,
        clearance,
        nearestPrimarySeparation,
        rootChordLength,
        rootGeometryCompatible,
        collisionFree,
        visibility: { zoom1, zoom145 },
        score,
      });
    }
  }
  const selected = candidates.sort((left, right) => left.score - right.score)[0];
  return {
    ...selected,
    viewports,
    jetpackAccessible: selected.horizontalAdvance <= 520 && selected.verticalRise <= 340,
    simpleJumpAccessible: selected.horizontalAdvance < 220 && selected.verticalRise < 115,
  };
}

export function moduleRecord(module, result) {
  return {
    id: module.id,
    family: module.family,
    kind: module.kind,
    platformIds: result.platforms.map(platform => platform.platformId),
    contentRequestIds: result.contentRequests.map(request => request.id).filter(Boolean),
    structureIds: (result.structures || []).map(structure => structure.id).filter(Boolean),
    intentionalGaps: result.intentionalGaps || [],
    occupiedBounds: result.occupiedBounds,
    validationRules: result.validationRules,
  };
}

function platformCenterX(platform) {
  return platform.x + platform.w / 2;
}

function nearestPrimaryPlatform(primaryRoute, optionalPlatform) {
  const center = platformCenterX(optionalPlatform);
  return primaryRoute.reduce((nearest, platform) => {
    if (!nearest) return platform;
    return Math.abs(platformCenterX(platform) - center)
      < Math.abs(platformCenterX(nearest) - center)
      ? platform
      : nearest;
  }, null);
}

function preRejoinSeparation(plan, optionalPlatforms) {
  const entryX = platformCenterX(optionalPlatforms[0]);
  const rejoinX = platformCenterX(plan.rejoinPlatform);
  const span = Math.max(1, rejoinX - entryX);
  const samples = optionalPlatforms.map(platform => {
    const progress = (platformCenterX(platform) - entryX) / span;
    const primaryPlatform = nearestPrimaryPlatform(plan.primaryRoute, platform);
    const verticalSeparation = primaryPlatform
      ? primaryPlatform.y - platform.y
      : Infinity;
    return {
      optionalPlatformId: platform.platformId,
      primaryPlatformId: primaryPlatform?.platformId || null,
      progress,
      verticalSeparation,
      preRejoin: progress <= PRE_REJOIN_PROGRESS_LIMIT,
    };
  });
  const preRejoinSamples = samples.filter(sample => sample.preRejoin);
  const minimumPreRejoinSeparation = preRejoinSamples.length
    ? Math.min(...preRejoinSamples.map(sample => sample.verticalSeparation))
    : Infinity;
  const prematureConvergenceCount = preRejoinSamples.filter(sample => (
    sample.verticalSeparation < MINIMUM_PRE_REJOIN_SEPARATION
  )).length;
  return {
    minimumPreRejoinSeparation,
    prematureConvergenceCount,
    samples,
  };
}

function hardRouteMetrics(accessPlatform, movementPlatforms) {
  const route = [accessPlatform, ...movementPlatforms];
  const ySequence = route.map(platform => platform.y);
  const deltas = ySequence.slice(1).map((value, index) => value - ySequence[index]);
  return {
    ySequence,
    hardVerticalAmplitude: ySequence.length
      ? Math.max(...ySequence) - Math.min(...ySequence)
      : 0,
    hardClimbCount: deltas.filter(delta => delta <= -28).length,
    hardDropCount: deltas.filter(delta => delta >= 28).length,
    movementRecipes: movementPlatforms.map(platform => platform.movementRecipeId),
  };
}

export function buildOptionalDetour(level, plan) {
  if (!level || !plan) return null;
  const accessLanding = chooseAccessLanding(level, plan);
  const targetCruiseLaneY = cruiseLaneY(plan);
  const context = {
    level,
    detourId: plan.id,
    primaryRoute: plan.primaryRoute,
    startPlatform: plan.startPlatform,
    preEntryPlatform: plan.preEntryPlatform,
    rejoinPlatform: plan.rejoinPlatform,
    accessLandingX: accessLanding.x,
    accessLandingY: accessLanding.y,
    cruiseLaneY: targetCruiseLaneY,
    seedValue: plan.seedValue,
    random: createRandom(
      `${plan.seedValue}:${plan.id}:optional-detour-composition`,
    ),
  };

  const access = AZO_LATERAL_ACCESS_MODULE.buildGeometry(context);
  level.platforms.push(...access.platforms);
  level.authoredAzospirillumLadderRequests = [
    ...(level.authoredAzospirillumLadderRequests || []),
    ...(access.authoredAzospirillumLadderRequests || []),
  ];
  context.accessPlatform = access.platforms[0];

  const challenge = HARD_MOVEMENT_COMBO_MODULE.buildGeometry(context);
  level.platforms.push(...challenge.platforms);
  context.lastHardPlatform = challenge.platforms.at(-1);

  const exit = DROP_REJOIN_MODULE.buildGeometry(context);
  const contentRequests = createOptionalDetourContentRequests(context);
  const modules = [
    moduleRecord(AZO_LATERAL_ACCESS_MODULE, access),
    moduleRecord(HARD_MOVEMENT_COMBO_MODULE, challenge),
    moduleRecord(DROP_REJOIN_MODULE, exit),
  ];
  const optionalPlatforms = [...access.platforms, ...challenge.platforms];
  const separation = preRejoinSeparation(plan, optionalPlatforms);
  const hardMetrics = hardRouteMetrics(context.accessPlatform, challenge.platforms);
  const transitionPlatforms = challenge.transitionPlatforms || [];
  const cruisePlatforms = challenge.cruisePlatforms || [];
  const transitionWorldSpan = transitionPlatforms.length
    ? transitionPlatforms.at(-1).x + transitionPlatforms.at(-1).w - context.accessPlatform.x
    : 0;
  const occupiedBounds = {
    left: Math.min(plan.startPlatform.x, ...optionalPlatforms.map(platform => platform.x)),
    right: Math.max(plan.rejoinPlatform.x + plan.rejoinPlatform.w,
      ...optionalPlatforms.map(platform => platform.x + platform.w)),
    top: Math.min(...optionalPlatforms.map(platform => platform.y)),
    bottom: Math.max(plan.startPlatform.y + plan.startPlatform.h,
      ...optionalPlatforms.map(platform => platform.y + platform.h)),
    startLogicIndex: plan.startLogicIndex,
    endLogicIndex: plan.endLogicIndex,
    rejoinLogicIndex: plan.endLogicIndex,
    authoredEncounterSpacing: plan.authoredEncounterSpacing,
    reservedThroughLogicIndex: plan.endLogicIndex + plan.authoredEncounterSpacing,
  };
  const detour = {
    id: plan.id,
    phase: plan.phase,
    startLogicIndex: plan.startLogicIndex,
    endLogicIndex: plan.endLogicIndex,
    startPlatformId: plan.startPlatformId,
    preEntryPlatformId: plan.preEntryPlatformId,
    rejoinPlatformId: plan.rejoinPlatformId,
    targetScreenCount: plan.targetScreenCount,
    requestedScreenCount: plan.requestedScreenCount,
    actualWorldSpan: plan.actualWorldSpan,
    seedValue: plan.seedValue,
    primaryYSequence: [...plan.primaryYSequence],
    primaryVerticalRange: plan.primaryVerticalRange,
    primaryClimbCount: plan.primaryClimbCount,
    primaryDropCount: plan.primaryDropCount,
    primaryNetDelta: plan.primaryNetDelta,
    longestClimbRun: plan.longestClimbRun,
    longestDropRun: plan.longestDropRun,
    primaryProfile: plan.primaryProfile,
    primaryProfileValid: plan.primaryProfileValid,
    accessLandingId: context.accessPlatform.platformId,
    accessLandingX: accessLanding.x,
    accessLandingY: accessLanding.y,
    accessHorizontalAdvance: accessLanding.horizontalAdvance,
    accessVerticalRise: accessLanding.verticalRise,
    accessPrimaryClearance: accessLanding.clearance,
    accessVisibleAtZoom1: accessLanding.visibility.zoom1.visible,
    accessVisibleAtZoom145: accessLanding.visibility.zoom145.visible,
    accessVisibility: accessLanding.visibility,
    hypotheticalViewports: accessLanding.viewports,
    accessJetpackAccessible: accessLanding.jetpackAccessible,
    accessSimpleJumpAccessible: accessLanding.simpleJumpAccessible,
    cruiseLaneY: targetCruiseLaneY,
    cruiseProfileId: challenge.cruiseProfileId,
    hardMacroProfile: challenge.hardMacroProfile,
    transitionFamilyId: challenge.transitionFamilyId,
    preferredVerticalAmplitude: challenge.preferredVerticalAmplitude,
    minimumPreRejoinSeparation: separation.minimumPreRejoinSeparation,
    prematureConvergenceCount: separation.prematureConvergenceCount,
    preRejoinSeparationSamples: separation.samples,
    hardVerticalAmplitude: hardMetrics.hardVerticalAmplitude,
    hardClimbCount: hardMetrics.hardClimbCount,
    hardDropCount: hardMetrics.hardDropCount,
    hardYSequence: hardMetrics.ySequence,
    transitionPlatformIds: transitionPlatforms.map(platform => platform.platformId),
    cruisePlatformIds: cruisePlatforms.map(platform => platform.platformId),
    transitionWorldSpan,
    transitionPlatformCount: transitionPlatforms.length,
    movementPlatformCount: challenge.platforms.length,
    accessModuleId: AZO_LATERAL_ACCESS_MODULE.id,
    challengeModuleIds: [HARD_MOVEMENT_COMBO_MODULE.id],
    exitModuleId: DROP_REJOIN_MODULE.id,
    optionalPlatformIds: optionalPlatforms.map(platform => platform.platformId),
    contentRequestIds: contentRequests.map(request => request.id).filter(Boolean),
    rewardIds: [],
    modules,
    moduleFamilies: [
      AZO_LATERAL_ACCESS_MODULE.family,
      ...challenge.moduleFamilies,
      DROP_REJOIN_MODULE.family,
    ],
    moduleFamilyCount: new Set([
      AZO_LATERAL_ACCESS_MODULE.family,
      ...challenge.moduleFamilies,
      DROP_REJOIN_MODULE.family,
    ]).size,
    biologicalModuleCount: 0,
    primaryRecapCount: 0,
    implementationStage: 'A',
    structuralSignature: {
      screenCount: plan.targetScreenCount,
      primaryProfile: plan.primaryProfile,
      hardMacroProfile: challenge.hardMacroProfile,
      accessVariant: `${accessLanding.horizontalAdvance}x${accessLanding.verticalRise}`,
      moduleFamilies: [
        challenge.transitionFamilyId,
        ...challenge.moduleFamilies.filter(family => family !== challenge.transitionFamilyId),
      ],
      movementRecipes: hardMetrics.movementRecipes,
      cruiseYSequence: challenge.cruisePlatforms.map(platform => platform.y),
    },
    validation: null,
    primaryRouteGeometryHashBefore: plan.primaryRouteGeometryHashBefore,
    primaryRouteGeometryHashAfter: primaryRouteGeometryHash(level),
    towerSuppressedForOptionalDetourPlaytest: Boolean(
      level.traversalEncounterStats?.towerSuppressedForOptionalDetourPlaytest
    ),
    optionalDetourReservedBounds: occupiedBounds,
  };
  level.optionalDetourReservedBounds = [
    ...(level.optionalDetourReservedBounds || []),
    occupiedBounds,
  ];
  level.optionalDetours = [...(level.optionalDetours || []), detour];
  return detour;
}

export function createPhaseTenOptionalDetour({ level, phase, seedValue } = {}) {
  level.optionalDetours = [];
  if (phase !== 10) return null;
  const plan = planOptionalDetour({ level, phase, seedValue });
  if (!plan) return null;
  return buildOptionalDetour(level, plan);
}
