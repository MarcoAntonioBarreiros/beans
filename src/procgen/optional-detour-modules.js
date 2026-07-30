import { logicIndexAtWorldX } from './optional-detour-planner.js';
import { canTraverseEdge } from './traversal-edge-physics.js';

const PLATFORM_HEIGHT = 54;
const ACCESS_WIDTH = 220;
const MOVEMENT_TECHNICAL_LIMIT = 64;
const LOCAL_EDGE_ATTEMPTS = 4;
export const MAX_CONNECTOR_PLATFORMS_PER_EDGE = 2;

export const HARD_MOVEMENT_RECIPES = Object.freeze([
  Object.freeze({
    id: 'steep-double-jump-up',
    requiredAbilities: ['doubleJump'],
    allowedPrimitiveIds: ['running-double-jump-early', 'running-double-jump-late'],
    gapRange: [150, 220],
    landingWidthRange: [155, 210],
    verticalIntent: 'ascent',
    verticalDeltaRange: [-130, -80],
  }),
  Object.freeze({
    id: 'combo-climb',
    requiredAbilities: ['doubleJump', 'dash'],
    allowedPrimitiveIds: ['running-double-jump-dash'],
    gapRange: [345, 430],
    landingWidthRange: [150, 200],
    verticalIntent: 'ascent',
    verticalDeltaRange: [-95, -55],
  }),
  Object.freeze({
    id: 'ridge-dash',
    requiredAbilities: ['dash'],
    allowedPrimitiveIds: ['air-dash'],
    gapRange: [310, 390],
    landingWidthRange: [160, 220],
    verticalIntent: 'traverse',
    verticalDeltaRange: [-18, 18],
  }),
  Object.freeze({
    id: 'small-drop',
    requiredAbilities: ['doubleJump'],
    allowedPrimitiveIds: ['running-double-jump-late'],
    gapRange: [220, 300],
    landingWidthRange: [190, 245],
    verticalIntent: 'descent',
    verticalDeltaRange: [34, 68],
  }),
  Object.freeze({
    id: 'controlled-drop',
    requiredAbilities: ['doubleJump'],
    allowedPrimitiveIds: ['running-double-jump-late'],
    gapRange: [220, 300],
    landingWidthRange: [220, 285],
    verticalIntent: 'controlled-drop',
    verticalDeltaRange: [110, 180],
  }),
  Object.freeze({
    id: 'drop-and-dash',
    requiredAbilities: ['doubleJump', 'dash'],
    allowedPrimitiveIds: ['running-double-jump-dash'],
    gapRange: [360, 445],
    landingWidthRange: [200, 270],
    verticalIntent: 'controlled-drop',
    verticalDeltaRange: [95, 155],
  }),
]);

export const HARD_MACRO_PROFILES = Object.freeze([
  Object.freeze({
    id: 'ridge-valley',
    zones: Object.freeze([
      Object.freeze({ id: 'ridge-climb', until: .28, targetRatio: .88, preferredRecipe: 'steep-double-jump-up' }),
      Object.freeze({ id: 'ridge-crest', until: .42, targetRatio: .90, preferredRecipe: 'ridge-dash' }),
      Object.freeze({ id: 'wide-valley', until: .72, targetRatio: .12, preferredRecipe: 'controlled-drop' }),
      Object.freeze({ id: 'partial-recovery', until: 1, targetRatio: .55, preferredRecipe: 'combo-climb' }),
    ]),
  }),
  Object.freeze({
    id: 'double-crest',
    zones: Object.freeze([
      Object.freeze({ id: 'first-crest', until: .24, targetRatio: .72, preferredRecipe: 'combo-climb' }),
      Object.freeze({ id: 'middle-release', until: .45, targetRatio: .28, preferredRecipe: 'small-drop' }),
      Object.freeze({ id: 'second-crest', until: .73, targetRatio: 1, preferredRecipe: 'steep-double-jump-up' }),
      Object.freeze({ id: 'high-exit', until: 1, targetRatio: .64, preferredRecipe: 'controlled-drop' }),
    ]),
  }),
  Object.freeze({
    id: 'deep-dip',
    zones: Object.freeze([
      Object.freeze({ id: 'initial-crest', until: .22, targetRatio: .82, preferredRecipe: 'combo-climb' }),
      Object.freeze({ id: 'long-descent', until: .56, targetRatio: 0, preferredRecipe: 'drop-and-dash' }),
      Object.freeze({ id: 'valley-challenge', until: .70, targetRatio: .12, preferredRecipe: 'ridge-dash' }),
      Object.freeze({ id: 'deep-recovery', until: 1, targetRatio: .68, preferredRecipe: 'steep-double-jump-up' }),
    ]),
  }),
  Object.freeze({
    id: 'ascending-steps',
    zones: Object.freeze([
      Object.freeze({ id: 'step-one', until: .22, targetRatio: .38, preferredRecipe: 'steep-double-jump-up' }),
      Object.freeze({ id: 'step-two', until: .45, targetRatio: .62, preferredRecipe: 'combo-climb' }),
      Object.freeze({ id: 'step-three', until: .68, targetRatio: .96, preferredRecipe: 'steep-double-jump-up' }),
      Object.freeze({ id: 'pre-exit-drop', until: 1, targetRatio: .46, preferredRecipe: 'controlled-drop' }),
    ]),
  }),
  Object.freeze({
    id: 'broken-ridge',
    zones: Object.freeze([
      Object.freeze({ id: 'broken-climb', until: .25, targetRatio: .82, preferredRecipe: 'combo-climb' }),
      Object.freeze({ id: 'ridge-gap', until: .48, targetRatio: .85, preferredRecipe: 'ridge-dash' }),
      Object.freeze({ id: 'broken-descent', until: .70, targetRatio: .22, preferredRecipe: 'drop-and-dash' }),
      Object.freeze({ id: 'short-recovery', until: 1, targetRatio: .66, preferredRecipe: 'steep-double-jump-up' }),
    ]),
  }),
]);

const TRANSITION_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'combo-short-double-climb',
    recipes: Object.freeze(['steep-double-jump-up']),
  }),
  Object.freeze({
    id: 'combo-plateau-dash-climb',
    recipes: Object.freeze(['ridge-dash', 'steep-double-jump-up']),
  }),
  Object.freeze({
    id: 'combo-small-drop-recovery',
    recipes: Object.freeze(['small-drop', 'combo-climb']),
  }),
]);

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function randomRange(random, [minimum, maximum]) {
  return lerp(minimum, maximum, random());
}

function recipeById(id) {
  return HARD_MOVEMENT_RECIPES.find(recipe => recipe.id === id);
}

function recipesForIntent(intent) {
  if (intent === 'recover') {
    return ['steep-double-jump-up', 'combo-climb'].map(recipeById);
  }
  if (intent === 'descent') {
    return ['small-drop', 'controlled-drop', 'drop-and-dash'].map(recipeById);
  }
  return HARD_MOVEMENT_RECIPES.filter(recipe => recipe.verticalIntent === intent);
}

function primitivesForRecipe(level, recipe) {
  const allowed = new Set(recipe.allowedPrimitiveIds);
  return (level.primitives || []).filter(primitive => allowed.has(primitive.id));
}

export function createOptionalDetourPlatform(context, {
  id,
  moduleId,
  x,
  y,
  w,
  order,
}) {
  return {
    id,
    platformId: id,
    x,
    y,
    w,
    h: PLATFORM_HEIGHT,
    type: 'root',
    logicIndex: logicIndexAtWorldX(context.primaryRoute, x + w / 2),
    optionalDetourId: context.detourId,
    detourModuleId: moduleId,
    routeRole: 'optional',
    routeScope: 'optional',
    routeOwned: true,
    optionalRouteOrder: order,
  };
}

export const AZO_LATERAL_ACCESS_MODULE = Object.freeze({
  id: 'azo-lateral-access',
  family: 'azospirillum',
  kind: 'access',
  minimumWorldSpan: 360,
  preferredWorldSpan: 520,
  maximumWorldSpan: 760,
  requiredAbilities: ['azospirillumRoots'],
  requiredOrganisms: ['azospirillum'],
  incompatibleFamilies: [],
  difficultyCost: 1,
  createContentRequests() {
    return [];
  },
  buildGeometry(context) {
    const host = context.startPlatform;
    const platform = createOptionalDetourPlatform(context, {
      id: `${context.detourId}:azo-access:destination`,
      moduleId: this.id,
      x: context.accessLandingX,
      y: context.accessLandingY,
      w: ACCESS_WIDTH,
      order: 0,
    });
    platform.azospirillumLadderDestination = true;
    platform.optionalDetourAccess = true;
    platform.optionalDetourLandingSocket = true;
    host.azospirillumLadderHost = true;
    host.optionalDetourLaunchRoot = true;
    const requiredReach = Math.hypot(
      platform.x - (host.x + host.w),
      host.y - platform.y,
    );
    return {
      platforms: [platform],
      structures: [],
      intentionalGaps: [{
        fromPlatformId: host.platformId,
        toPlatformId: platform.platformId,
        kind: 'dynamic-azospirillum-access',
      }],
      contentRequests: [],
      authoredAzospirillumLadderRequests: [{
        hostPlatformId: host.platformId,
        destinationPlatformId: platform.platformId,
        optionalDetourId: context.detourId,
        detourModuleId: this.id,
        accessStyle: 'dynamic-optional-detour',
        requiredReach,
        growthSecondsPer100Units: 1,
        showInstruction: false,
        suppressToast: true,
        silentDiscovery: true,
        authored: true,
      }],
      entrySocket: { platformId: host.platformId },
      exitSocket: { platformId: platform.platformId },
      occupiedBounds: {
        left: host.x,
        right: platform.x + platform.w,
        top: platform.y,
        bottom: host.y + host.h,
      },
      validationRules: ['destinationAboveNormalJump', 'authoredAzoRequest'],
    };
  },
});

export const HARD_MOVEMENT_COMBO_MODULE = Object.freeze({
  id: 'hard-movement-combo',
  family: 'movement',
  kind: 'challenge',
  minimumWorldSpan: 1600,
  preferredWorldSpan: 2600,
  maximumWorldSpan: 6200,
  requiredAbilities: ['doubleJump', 'dash'],
  requiredOrganisms: [],
  incompatibleFamilies: [],
  difficultyCost: 3,
  createContentRequests() {
    return [];
  },
  buildGeometry(context) {
    if (
      Number.isFinite(context.slotLeft)
      && Number.isFinite(context.slotRight)
    ) {
      const slotLeft = context.slotLeft;
      const slotRight = context.slotRight;
      const allocatedSpan = slotRight - slotLeft;
      if (allocatedSpan < this.minimumWorldSpan) {
        throw new Error(`movement-slot-too-short:${Math.round(allocatedSpan)}`);
      }
      const random = context.random;
      const instanceId = context.moduleInstanceId
        || `${this.id}-${context.slotIndex ?? 0}`;
      const source = context.entryRegion?.platform
        || context.entryPlatform
        || context.accessPlatform;
      const baseOrder = 200 + (Number(context.slotIndex) || 0) * 100;
      const platforms = [];
      const intentionalGaps = [];
      const entry = createOptionalDetourPlatform(context, {
        id: `${context.detourId}:${instanceId}:entry`,
        moduleId: this.id,
        x: slotLeft,
        y: Number(context.entryRegion?.y ?? source?.y ?? context.cruiseLaneY),
        w: 176,
        order: baseOrder,
      });
      entry.optionalDetourSection = 'movement-entry';
      entry.optionalDetourModuleInstanceId = instanceId;
      entry.authored = true;
      platforms.push(entry);

      let current = entry;
      let cursorX = entry.x + entry.w;
      const lowerY = Number(context.cruiseLaneY) + 70;
      const upperY = lowerY - 250;
      const recipeCycle = [
        recipeById('steep-double-jump-up'),
        recipeById('ridge-dash'),
        recipeById('controlled-drop'),
        recipeById('combo-climb'),
        recipeById('small-drop'),
      ];
      let recipeIndex = Math.floor(random() * recipeCycle.length);
      while (cursorX + 310 < slotRight && platforms.length < 12) {
        let recipe = recipeCycle[recipeIndex % recipeCycle.length];
        recipeIndex++;
        if (current.y <= upperY + 30 && recipe.verticalIntent === 'ascent') {
          recipe = recipeById('controlled-drop');
        } else if (
          current.y >= lowerY - 30
          && ['descent', 'controlled-drop'].includes(recipe.verticalIntent)
        ) {
          recipe = recipeById('steep-double-jump-up');
        }
        const remaining = slotRight - cursorX;
        let gap = Math.min(randomRange(random, recipe.gapRange), remaining - 155);
        if (gap < recipe.gapRange[0]) break;
        let width = Math.min(
          randomRange(random, recipe.landingWidthRange),
          remaining - gap,
        );
        if (width < 150) break;
        let delta = randomRange(random, recipe.verticalDeltaRange);
        delta = clamp(delta, upperY - current.y, lowerY - current.y);
        let candidate = null;
        let validation = null;
        for (let attempt = 0; attempt < LOCAL_EDGE_ATTEMPTS; attempt++) {
          candidate = createOptionalDetourPlatform(context, {
            id: `${context.detourId}:${instanceId}:step-${platforms.length}`,
            moduleId: this.id,
            x: cursorX + gap,
            y: current.y + delta,
            w: width,
            order: baseOrder + platforms.length,
          });
          validation = canTraverseEdge({
            from: current,
            to: candidate,
            primitives: primitivesForRecipe(context.level, recipe),
          });
          if (validation.valid) break;
          gap = Math.max(recipe.gapRange[0], gap * .94);
          width = Math.min(recipe.landingWidthRange[1], width + 10);
          delta *= .88;
        }
        if (!validation?.valid) break;
        candidate.hardMovementCombo = true;
        candidate.comboStepIndex = platforms.length - 1;
        candidate.movementRecipeId = recipe.id;
        candidate.requiredAbilities = [...recipe.requiredAbilities];
        candidate.allowedPrimitiveIds = [...recipe.allowedPrimitiveIds];
        candidate.validatedPrimitiveId =
          validation.passingPrimitiveIds[0] || null;
        candidate.verticalIntent = recipe.verticalIntent;
        candidate.verticalDeltaY = candidate.y - current.y;
        candidate.movementGap = validation.gap;
        candidate.optionalDetourSection = 'movement-slot';
        candidate.optionalDetourModuleInstanceId = instanceId;
        candidate.authored = true;
        intentionalGaps.push({
          fromPlatformId: current.platformId,
          toPlatformId: candidate.platformId,
          kind: recipe.id,
          requiredAbilities: [...recipe.requiredAbilities],
          allowedPrimitiveIds: [...recipe.allowedPrimitiveIds],
          validatedPrimitiveId: candidate.validatedPrimitiveId,
          gap: validation.gap,
          verticalDeltaY: candidate.verticalDeltaY,
        });
        platforms.push(candidate);
        current = candidate;
        cursorX = current.x + current.w;
      }
      const exitX = slotRight - 176;
      if (exitX > current.x + current.w + 24) {
        const exitRecipe = recipeById('ridge-dash');
        const exitPlatform = createOptionalDetourPlatform(context, {
          id: `${context.detourId}:${instanceId}:exit`,
          moduleId: this.id,
          x: exitX,
          y: current.y,
          w: 176,
          order: baseOrder + platforms.length,
        });
        const exitValidation = canTraverseEdge({
          from: current,
          to: exitPlatform,
          primitives: context.level.primitives || [],
        });
        if (!exitValidation.valid) {
          throw new Error('movement-slot-exit-unreachable');
        }
        exitPlatform.hardMovementCombo = true;
        exitPlatform.comboStepIndex = platforms.length - 1;
        exitPlatform.movementRecipeId = exitRecipe.id;
        exitPlatform.requiredAbilities = [...exitRecipe.requiredAbilities];
        exitPlatform.allowedPrimitiveIds = [...exitRecipe.allowedPrimitiveIds];
        exitPlatform.validatedPrimitiveId =
          exitValidation.passingPrimitiveIds[0] || null;
        exitPlatform.verticalIntent = 'traverse';
        exitPlatform.verticalDeltaY = 0;
        exitPlatform.movementGap = exitValidation.gap;
        exitPlatform.optionalDetourSection = 'movement-slot';
        exitPlatform.optionalDetourModuleInstanceId = instanceId;
        exitPlatform.authored = true;
        intentionalGaps.push({
          fromPlatformId: current.platformId,
          toPlatformId: exitPlatform.platformId,
          kind: 'movement-slot-egress',
          requiredAbilities: [],
          allowedPrimitiveIds: (context.level.primitives || [])
            .map(primitive => primitive.id),
          validatedPrimitiveId: exitPlatform.validatedPrimitiveId,
          gap: exitValidation.gap,
          verticalDeltaY: 0,
        });
        platforms.push(exitPlatform);
        current = exitPlatform;
      }
      if (platforms.length < 3) {
        throw new Error('movement-slot-insufficient-platforms');
      }
      return {
        platforms,
        transitionPlatforms: [],
        cruisePlatforms: platforms.slice(1),
        cruiseProfileId: 'slot-composed',
        hardMacroProfile: 'slot-composed',
        transitionFamilyId: 'slot-composed',
        moduleFamilies: ['slot-composed'],
        preferredVerticalAmplitude:
          Math.max(...platforms.map(platform => platform.y))
          - Math.min(...platforms.map(platform => platform.y)),
        structures: [],
        intentionalGaps,
        contentRequests: [],
        entrySocket: { platformId: entry.platformId, platform: entry },
        exitSocket: { platformId: current.platformId, platform: current },
        occupiedBounds: {
          left: slotLeft,
          right: Math.max(...platforms.map(platform => platform.x + platform.w)),
          top: Math.min(...platforms.map(platform => platform.y)),
          bottom: Math.max(...platforms.map(platform => platform.y + platform.h)),
        },
        validationRules: ['slotBounded', 'everyEdgeValid'],
        allocatedSpan,
        slotLeft,
        slotRight,
        moduleInstanceId: instanceId,
      };
    }
    const random = context.random;
    const routeEndX = context.rejoinPlatform.x - 190;
    let cursorX = context.accessPlatform.x + context.accessPlatform.w;
    let currentY = context.accessLandingY;
    const platforms = [];
    const intentionalGaps = [];
    const transitionPlatforms = [];
    const cruisePlatforms = [];
    const appendPlatform = ({
      recipe,
      gap,
      width,
      nextY,
      section,
      verticalIntent = recipe.verticalIntent,
      macroZoneId = null,
      preserveGeometry = false,
    }) => {
      const from = platforms.at(-1) || context.accessPlatform;
      let localRecipe = recipe;
      let localGap = gap;
      let localWidth = width;
      let localNextY = nextY;
      let platform = null;
      let validation = null;

      for (let attempt = 0; attempt < LOCAL_EDGE_ATTEMPTS; attempt++) {
        platform = createOptionalDetourPlatform(context, {
          id: `${context.detourId}:movement:${platforms.length + 1}`,
          moduleId: this.id,
          x: cursorX + localGap,
          y: localNextY,
          w: localWidth,
          order: platforms.length + 1,
        });
        validation = canTraverseEdge({
          from,
          to: platform,
          primitives: primitivesForRecipe(context.level, localRecipe),
        });
        if (validation.valid) break;

        if (preserveGeometry) break;
        localGap = Math.max(
          localRecipe.gapRange[0],
          localGap * .94,
        );
        if (localNextY < currentY) {
          localNextY = currentY + (localNextY - currentY) * .88;
        }
        localWidth = Math.min(
          localRecipe.landingWidthRange[1],
          localWidth + 12,
        );

        if (attempt === LOCAL_EDGE_ATTEMPTS - 2) {
          const alternative = recipesForIntent(verticalIntent)
            .find(candidate => candidate.id !== localRecipe.id);
          if (alternative) {
            localRecipe = alternative;
            localGap = clamp(localGap, ...alternative.gapRange);
            localWidth = clamp(localWidth, ...alternative.landingWidthRange);
            const deltaY = clamp(
              localNextY - currentY,
              ...alternative.verticalDeltaRange,
            );
            localNextY = currentY + deltaY;
          }
        }
      }

      if (!validation?.valid) return null;
      platform.hardMovementCombo = true;
      platform.comboStepIndex = platforms.length;
      platform.movementRecipeId = localRecipe.id;
      platform.requiredAbilities = [...localRecipe.requiredAbilities];
      platform.allowedPrimitiveIds = [...localRecipe.allowedPrimitiveIds];
      platform.validatedPrimitiveId = validation.passingPrimitiveIds[0] || null;
      platform.verticalIntent = verticalIntent;
      platform.verticalDeltaY = platform.y - currentY;
      platform.movementGap = validation.gap;
      platform.optionalDetourSection = section;
      platform.macroZoneId = macroZoneId;
      intentionalGaps.push({
        fromPlatformId: platforms.at(-1)?.platformId
          || context.accessPlatform.platformId,
        toPlatformId: platform.platformId,
        kind: localRecipe.id,
        requiredAbilities: [...localRecipe.requiredAbilities],
        allowedPrimitiveIds: [...localRecipe.allowedPrimitiveIds],
        validatedPrimitiveId: platform.validatedPrimitiveId,
        gap: validation.gap,
        verticalDeltaY: platform.verticalDeltaY,
      });
      platforms.push(platform);
      if (section === 'transition') transitionPlatforms.push(platform);
      else cruisePlatforms.push(platform);
      cursorX = platform.x + platform.w;
      currentY = platform.y;
      return platform;
    };

    const referenceHeight = Number(context.level.referenceScreenWorldHeight) || 720;
    const preferredVerticalAmplitude = clamp(referenceHeight * .32, 200, 320);
    const cruiseLowerBoundY = context.cruiseLaneY + 10;
    const cruiseUpperBoundY = cruiseLowerBoundY - preferredVerticalAmplitude;

    // A primeira travessia continua combo-only: o gap fica acima do alcance
    // isolado do salto duplo e do air-dash, mas dentro do combo declarado.
    const firstRecipe = recipeById('combo-climb');
    const firstPlatform = appendPlatform({
      recipe: firstRecipe,
      gap: randomRange(random, [405, 430]),
      width: randomRange(random, firstRecipe.landingWidthRange),
      nextY: currentY - randomRange(random, [55, 72]),
      section: 'transition',
      verticalIntent: 'ascent',
      preserveGeometry: true,
    });
    if (!firstPlatform) {
      throw new Error('[optional-detour] approved combo-only first edge is not traversable');
    }

    const transitionFamily = TRANSITION_FAMILIES[
      Math.floor(random() * TRANSITION_FAMILIES.length)
    ];
    for (const recipeId of transitionFamily.recipes) {
      if (cursorX + 250 >= routeEndX) break;
      const recipe = recipeById(recipeId);
      const remaining = routeEndX - cursorX;
      let gap = Math.min(randomRange(random, recipe.gapRange), remaining - 150);
      if (gap < recipe.gapRange[0]) break;
      let width = Math.min(
        randomRange(random, recipe.landingWidthRange),
        remaining - gap,
      );
      if (width < 145) break;
      const appended = appendPlatform({
        recipe,
        gap,
        width,
        nextY: currentY + randomRange(random, recipe.verticalDeltaRange),
        section: 'transition',
        verticalIntent: recipe.verticalIntent,
      });
      if (!appended) break;
    }

    // A família define a forma da transição. Degraus adicionais só existem
    // quando a diferença real até o envelope superior ainda os exige.
    while (currentY - cruiseLowerBoundY > 28 && cursorX + 250 < routeEndX) {
      const remainingRise = currentY - cruiseLowerBoundY;
      const recipe = remainingRise >= 80
        ? recipeById('steep-double-jump-up')
        : recipeById('combo-climb');
      const climb = clamp(
        remainingRise,
        Math.abs(recipe.verticalDeltaRange[1]),
        Math.abs(recipe.verticalDeltaRange[0]),
      );
      const remaining = routeEndX - cursorX;
      const gap = Math.min(randomRange(random, recipe.gapRange), remaining - 150);
      if (gap < recipe.gapRange[0]) break;
      const width = Math.min(
        randomRange(random, recipe.landingWidthRange),
        remaining - gap,
      );
      if (width < 145) break;
      const appended = appendPlatform({
        recipe,
        gap,
        width,
        nextY: currentY - climb,
        section: 'transition',
        verticalIntent: 'ascent',
      });
      if (!appended) break;
    }

    const profile = HARD_MACRO_PROFILES[
      Math.floor(random() * HARD_MACRO_PROFILES.length)
    ];
    const macroStartX = cursorX;
    const macroAvailableSpan = Math.max(1, routeEndX - macroStartX);

    while (cursorX + 250 < routeEndX) {
      if (platforms.length >= MOVEMENT_TECHNICAL_LIMIT) {
        throw new Error(
          `[optional-detour] movement platform technical limit exceeded: `
          + `${platforms.length} platforms before x=${routeEndX}`,
        );
      }
      const progress = clamp((cursorX - macroStartX) / macroAvailableSpan, 0, 1);
      const zone = profile.zones.find(candidate => progress <= candidate.until)
        || profile.zones.at(-1);
      const targetY = cruiseLowerBoundY
        - preferredVerticalAmplitude * zone.targetRatio;
      const difference = targetY - currentY;
      let recipe = recipeById(zone.preferredRecipe);
      if (difference <= -54 && recipe.verticalIntent !== 'ascent') {
        recipe = Math.abs(difference) > 100
          ? recipeById('steep-double-jump-up')
          : recipeById('combo-climb');
      } else if (
        difference >= 82
        && !['descent', 'controlled-drop'].includes(recipe.verticalIntent)
      ) {
        recipe = difference > 125
          ? recipeById('controlled-drop')
          : recipeById('small-drop');
      } else if (Math.abs(difference) < 28) {
        recipe = recipeById('ridge-dash');
      }
      const remaining = routeEndX - cursorX;
      let gap = Math.min(randomRange(random, recipe.gapRange), remaining - 150);
      if (gap < recipe.gapRange[0]) break;
      let width = Math.min(
        randomRange(random, recipe.landingWidthRange),
        remaining - gap,
      );
      if (width < 145) break;
      let availableMinimum = Math.max(
        recipe.verticalDeltaRange[0],
        cruiseUpperBoundY - currentY,
      );
      let availableMaximum = Math.min(
        recipe.verticalDeltaRange[1],
        cruiseLowerBoundY - currentY,
      );
      if (availableMinimum > availableMaximum) {
        recipe = currentY <= cruiseUpperBoundY + 20
          ? recipeById('small-drop')
          : (currentY >= cruiseLowerBoundY - 20
            ? recipeById('steep-double-jump-up')
            : recipeById('ridge-dash'));
        gap = clamp(gap, ...recipe.gapRange);
        width = clamp(width, ...recipe.landingWidthRange);
        availableMinimum = Math.max(
          recipe.verticalDeltaRange[0],
          cruiseUpperBoundY - currentY,
        );
        availableMaximum = Math.min(
          recipe.verticalDeltaRange[1],
          cruiseLowerBoundY - currentY,
        );
      }
      if (availableMinimum > availableMaximum) break;
      const targetDelta = clamp(difference, availableMinimum, availableMaximum);
      const sampledDelta = randomRange(random, [availableMinimum, availableMaximum]);
      const verticalDeltaY = lerp(sampledDelta, targetDelta, .72);
      const nextY = currentY + verticalDeltaY;
      const appended = appendPlatform({
        recipe,
        gap,
        width,
        nextY,
        section: 'cruise',
        verticalIntent: recipe.verticalIntent,
        macroZoneId: zone.id,
      });
      if (!appended) break;
    }

    if (!platforms.length) {
      throw new Error(
        `[optional-detour] insufficient world span for movement module: `
        + `${routeEndX - cursorX}px available`,
      );
    }

    return {
      platforms,
      transitionPlatforms,
      cruisePlatforms,
      cruiseProfileId: profile.id,
      hardMacroProfile: profile.id,
      transitionFamilyId: transitionFamily.id,
      moduleFamilies: [
        transitionFamily.id,
        ...new Set(cruisePlatforms.map(platform => platform.macroZoneId).filter(Boolean)),
      ],
      preferredVerticalAmplitude,
      structures: [],
      intentionalGaps,
      contentRequests: [],
      entrySocket: { platformId: context.accessPlatform.platformId },
      exitSocket: { platformId: platforms.at(-1).platformId },
      occupiedBounds: {
        left: platforms[0].x,
        right: platforms.at(-1).x + platforms.at(-1).w,
        top: Math.min(...platforms.map(platform => platform.y)),
        bottom: Math.max(...platforms.map(platform => platform.y + platform.h)),
      },
      validationRules: ['dynamicPlatformCount', 'everyEdgeValid', 'comboOnlyEdge'],
    };
  },
});

export const DROP_REJOIN_MODULE = Object.freeze({
  id: 'drop-rejoin',
  family: 'exit',
  kind: 'exit',
  minimumWorldSpan: 160,
  preferredWorldSpan: 300,
  maximumWorldSpan: 620,
  requiredAbilities: [],
  requiredOrganisms: [],
  incompatibleFamilies: [],
  difficultyCost: 0,
  createContentRequests() {
    return [];
  },
  buildGeometry(context) {
    return {
      platforms: [],
      structures: [],
      intentionalGaps: [{
        fromPlatformId: context.lastHardPlatform.platformId,
        toPlatformId: context.rejoinPlatform.platformId,
        kind: 'drop-rejoin',
      }],
      contentRequests: [],
      entrySocket: { platformId: context.lastHardPlatform.platformId },
      exitSocket: { platformId: context.rejoinPlatform.platformId },
      occupiedBounds: {
        left: Math.min(context.lastHardPlatform.x, context.rejoinPlatform.x),
        right: context.rejoinPlatform.x + context.rejoinPlatform.w,
        top: context.lastHardPlatform.y,
        bottom: context.rejoinPlatform.y + context.rejoinPlatform.h,
      },
      validationRules: ['clearDropColumn', 'rejoinsPrimaryRoute'],
    };
  },
});

function boundsIntersect(platform, bounds, margin = 8) {
  if (!bounds) return false;
  return platform.x < bounds.right + margin
    && platform.x + platform.w > bounds.left - margin
    && platform.y < bounds.bottom + margin
    && platform.y + platform.h > bounds.top - margin;
}

function usablePrimitives(level, abilities = []) {
  const available = new Set(abilities);
  return (level.primitives || []).filter(primitive => (
    (primitive.requires || []).every(requirement => available.has(requirement))
  ));
}

export const HARD_PHOSPHATE_GATE_MODULE = Object.freeze({
  id: 'hard-phosphate-gate',
  family: 'phosphate-solubilization',
  kind: 'biological-gate',
  minimumWorldSpan: 820,
  preferredWorldSpan: 1180,
  maximumWorldSpan: 1800,
  requiredAbilities: ['doubleJump', 'dash', 'phosphateSolubilization'],
  requiredOrganisms: ['bacillus'],
  incompatibleFamilies: [],
  difficultyCost: 2,
  createContentRequests(context) {
    const approach = context.approachPlatform
      || context.modulePlatforms.at(-2);
    const destination = context.destinationPlatform
      || context.modulePlatforms.at(-1);
    return [
      {
        id: `${context.detourId}:phosphate-gate:deposit`,
        type: 'phosphate-deposit',
        hostPlatformId: approach.platformId,
        destinationPlatformId: destination.platformId,
        logicIndex: approach.logicIndex,
        difficulty: 'hard',
        detourModuleId: this.id,
      },
      {
        id: `${context.detourId}:phosphate-gate:bacillus`,
        type: 'authored-beneficial-colony',
        organism: 'bacillus',
        platformId: approach.platformId,
        xRatio: .30,
        detourModuleId: this.id,
      },
    ];
  },
  buildGeometry(context) {
    const moduleLeft = Number(context.slotLeft);
    const moduleRight = Number(context.slotRight);
    const available = Number(context.allocatedSpan)
      || moduleRight - moduleLeft;
    if (!Number.isFinite(moduleLeft) || !Number.isFinite(moduleRight)) {
      throw new Error('phosphate-gate-missing-slot');
    }
    if (available < this.minimumWorldSpan) {
      throw new Error(`phosphate-gate-span-too-short:${Math.round(available)}`);
    }
    const variants = {
      'phosphate-compact': {
        centerRatio: .38,
        approachWidth: 240,
        destinationWidth: 220,
        yOffset: -18,
      },
      'phosphate-balanced': {
        centerRatio: .52,
        approachWidth: 260,
        destinationWidth: 235,
        yOffset: 8,
      },
      'phosphate-offset': {
        centerRatio: .64,
        approachWidth: 240,
        destinationWidth: 220,
        yOffset: -34,
      },
    };
    const variantId = variants[context.phosphateVariant]
      ? context.phosphateVariant
      : 'phosphate-balanced';
    const variant = variants[variantId];
    const approachWidth = variant.approachWidth;
    const blockerGap = 82;
    const destinationWidth = variant.destinationWidth;
    const maximumApproachX =
      moduleRight - destinationWidth - blockerGap - approachWidth;
    const desiredDepositCenter = moduleLeft + available * variant.centerRatio;
    const approachX = clamp(
      desiredDepositCenter - approachWidth + 30,
      moduleLeft + 180,
      maximumApproachX,
    );
    const destinationX = approachX + approachWidth + blockerGap;
    const entryY = Number(
      context.entryRegion?.y
      ?? context.entryPlatform?.y
      ?? context.accessPlatform?.y
      ?? context.cruiseLaneY,
    );
    const approachY = entryY + variant.yOffset;
    const destinationY = approachY + 18;

    const socketPlatform = context.entryRegion?.platform || context.entryPlatform || context.accessPlatform;
    const approachSupports = [];
    let supportOrder = 300 + (Number(context.slotIndex) || 0) * 100;

    const approach = createOptionalDetourPlatform(context, {
      id: `${context.detourId}:phosphate-gate:${context.slotIndex}:approach`,
      moduleId: this.id,
      x: approachX,
      y: approachY,
      w: approachWidth,
      order: supportOrder,
    });
    approach.optionalDetourSection = 'phosphate-approach';
    approach.movementRecipeId = 'combo-climb';
    approach.requiredAbilities = ['doubleJump', 'dash'];
    approach.optionalDetourModuleInstanceId =
      context.moduleInstanceId || `${this.id}-${context.slotIndex}`;
    approach.authored = true;

    const destination = createOptionalDetourPlatform(context, {
      id: `${context.detourId}:phosphate-gate:${context.slotIndex}:destination`,
      moduleId: this.id,
      x: destinationX,
      y: destinationY,
      w: destinationWidth,
      order: supportOrder + 1,
    });
    destination.optionalDetourSection = 'phosphate-destination';
    destination.optionalDetourModuleInstanceId =
      context.moduleInstanceId || `${this.id}-${context.slotIndex}`;
    destination.authored = true;

    const depositBounds = {
      left: approach.x + approach.w - 64,
      right: approach.x + approach.w - 6,
      top: approach.y - 210,
      bottom: approach.y,
    };
    const egressSupports = [];
    const egressStart = destination.x + destination.w;
    const egressSpan = Math.max(0, moduleRight - egressStart);
    const egressCount = Math.max(0, Math.ceil(egressSpan / 290) - 1);
    for (let index = 1; index <= egressCount; index++) {
      const progress = index / (egressCount + 1);
      const support = createOptionalDetourPlatform(context, {
        id: `${context.detourId}:phosphate-gate:${context.slotIndex}:egress-${index}`,
        moduleId: this.id,
        x: egressStart + egressSpan * progress - 85,
        y: destinationY + (index % 2 ? -12 : 12),
        w: 170,
        order: supportOrder + 1 + index,
      });
      support.optionalDetourSection = 'phosphate-egress';
      support.optionalDetourModuleInstanceId =
        context.moduleInstanceId || `${this.id}-${context.slotIndex}`;
      support.authored = true;
      egressSupports.push(support);
    }
    const moduleContext = {
      ...context,
      modulePlatforms: [
        ...approachSupports,
        approach,
        destination,
        ...egressSupports,
      ],
      approachPlatform: approach,
      destinationPlatform: destination,
    };
    const contentRequests = this.createContentRequests(moduleContext);
    const exitPlatform = egressSupports.at(-1) || destination;
    return {
      platforms: [
        ...approachSupports,
        approach,
        destination,
        ...egressSupports,
      ],
      structures: [],
      entrySocket: {
        platformId: approachSupports[0]?.platformId || approach.platformId,
        platform: approachSupports[0] || approach,
      },
      exitSocket: {
        platformId: exitPlatform.platformId,
        platform: exitPlatform,
      },
      occupiedBounds: {
        left: approachSupports[0]?.x || approach.x,
        right: exitPlatform.x + exitPlatform.w,
        top: Math.min(depositBounds.top, approach.y, destination.y),
        bottom: Math.max(approach.y + approach.h, destination.y + destination.h),
      },
      depositBounds,
      intentionalGaps: [{
        fromPlatformId: approach.platformId,
        toPlatformId: destination.platformId,
        kind: 'phosphate-deposit-blocker',
        bounds: depositBounds,
      }],
      contentRequests,
      validationRules: [
        'blockedPhosphateDeposit',
        'bacillusBeforeDeposit',
        'noPlatformCrossesDeposit',
      ],
      phosphateVariant: variantId,
      phosphateSlotIndex: context.slotIndex,
      phosphateCenterX: depositBounds.left
        + (depositBounds.right - depositBounds.left) / 2,
      slotLeft: moduleLeft,
      slotRight: moduleRight,
      allocatedSpan: available,
    };
  },
});

export function connectOptionalDetourSockets({
  level,
  detourId,
  fromSocket,
  toSocket,
  abilities = [],
  forbiddenBounds = [],
  intentionalGaps = [],
  seedValue = '',
  detourModuleId = 'minimal-connector',
  orderStart = 100,
} = {}) {
  const from = fromSocket?.platform || fromSocket;
  const to = toSocket?.platform || toSocket;
  if (!from || !to) {
    return { success: false, platforms: [], edges: [], reason: 'missing-socket' };
  }
  const primitives = usablePrimitives(level, abilities);
  const direct = canTraverseEdge({ from, to, primitives });
  if (direct.valid) {
    return {
      success: true,
      platforms: [],
      edges: [{ from: from.platformId, to: to.platformId, direct: true }],
      seedValue,
    };
  }

  const horizontalDistance = to.x - (from.x + from.w);
  if (horizontalDistance <= 0) {
    return {
      success: false,
      platforms: [],
      edges: [],
      reason: 'socket-order-invalid',
    };
  }
  const minimumSupportCount = Math.max(1, Math.ceil(horizontalDistance / 300) - 1);
  if (minimumSupportCount > MAX_CONNECTOR_PLATFORMS_PER_EDGE) {
    return {
      success: false,
      platforms: [],
      edges: [],
      reason: 'connector-requires-more-than-two-supports',
    };
  }
  for (
    let supportCount = minimumSupportCount;
    supportCount <= MAX_CONNECTOR_PLATFORMS_PER_EDGE;
    supportCount++
  ) {
    const supports = [];
    let rejected = false;
    for (let index = 1; index <= supportCount; index++) {
      const progress = index / (supportCount + 1);
      const width = 170;
      const centerX = (from.x + from.w / 2)
        + ((to.x + to.w / 2) - (from.x + from.w / 2)) * progress;
      const y = from.y + (to.y - from.y) * progress;
      const support = createOptionalDetourPlatform({
        detourId,
        primaryRoute: level.platforms || [],
      }, {
        id: `${detourId}:${detourModuleId}:${supportCount}:${index}`,
        moduleId: detourModuleId,
        x: centerX - width / 2,
        y,
        w: width,
        order: orderStart + index,
      });
      support.optionalDetourSection = 'connector';
      support.authored = true;
      if (
        forbiddenBounds.some(bounds => boundsIntersect(support, bounds))
        || intentionalGaps.some(gap => gap.bounds && boundsIntersect(support, gap.bounds))
      ) {
        rejected = true;
        break;
      }
      supports.push(support);
    }
    if (rejected) continue;
    const route = [from, ...supports, to];
    const edges = [];
    let valid = true;
    for (let index = 1; index < route.length; index++) {
      const result = canTraverseEdge({
        from: route[index - 1],
        to: route[index],
        primitives,
      });
      edges.push({
        from: route[index - 1].platformId,
        to: route[index].platformId,
        valid: result.valid,
        primitiveId: result.passingPrimitiveIds[0] || null,
      });
      if (!result.valid) {
        valid = false;
        break;
      }
    }
    if (valid) {
      return { success: true, platforms: supports, edges, seedValue };
    }
  }
  return {
    success: false,
    platforms: [],
    edges: [],
    reason: 'no-minimal-connector-found',
  };
}

export const HARD_MYCORRHIZA_GAP_MODULE = Object.freeze({
  id: 'hard-mycorrhiza-gap',
  family: 'mycorrhiza-bridge',
  kind: 'biological-gap',
  minimumWorldSpan: 900,
  preferredWorldSpan: 1300,
  maximumWorldSpan: 1900,
  requiredAbilities: ['mycorrhizaStructures'],
  requiredOrganisms: ['myco'],
  incompatibleFamilies: [],
  difficultyCost: 2,
  createContentRequests(context) {
    const { detourId, slotIndex = 0, modulePlatforms = [] } = context;
    const approach = modulePlatforms.find(p => p.optionalDetourSection === 'mycorrhiza-approach')
      || modulePlatforms[0];
    const source = modulePlatforms.find(p => p.mycorrhizaBridgeSource)
      || modulePlatforms[1];
    const requests = [];
    if (approach) {
      requests.push({
        id: `${detourId}:myco-roaming:${slotIndex}`,
        type: 'authored-roaming-beneficial',
        organism: 'myco',
        platformId: approach.platformId || approach.id,
        xRatio: 0.3,
        detourModuleId: this.id,
      });
      requests.push({
        id: `${detourId}:exudate-1:${slotIndex}`,
        type: 'exudate',
        platformId: approach.platformId || approach.id,
        xRatio: 0.7,
        detourModuleId: this.id,
      });
    }
    if (source) {
      requests.push({
        id: `${detourId}:exudate-2:${slotIndex}`,
        type: 'exudate',
        platformId: source.platformId || source.id,
        xRatio: 0.8,
        detourModuleId: this.id,
      });
    }
    return requests;
  },
  buildGeometry(context) {
    const {
      slotLeft,
      slotRight,
      allocatedSpan,
      slotIndex = 0,
      detourId = 'detour',
      seedValue = '',
      random,
      level = {},
    } = context;

    const available = Math.max(900, allocatedSpan || (slotRight - slotLeft));
    const moduleLeft = slotLeft;
    const moduleRight = slotLeft + available;

    const variantSeed = random ? random() : 0.5;
    let variantId = 'mycorrhiza-level-gap';
    let verticalDelta = 0;
    if (variantSeed < 0.34) {
      variantId = 'mycorrhiza-level-gap';
      verticalDelta = lerp(-24, 24, random ? random() : 0.5);
    } else if (variantSeed < 0.67) {
      variantId = 'mycorrhiza-rising-gap';
      verticalDelta = -lerp(35, 60, random ? random() : 0.5);
    } else {
      variantId = 'mycorrhiza-drop-gap';
      verticalDelta = lerp(35, 60, random ? random() : 0.5);
    }

    verticalDelta = clamp(verticalDelta, -68, 68);

    const instanceId = context.moduleInstanceId || `${this.id}-${slotIndex}`;
    let supportOrder = 100 + slotIndex * 50;

    const approachWidth = 200;
    const approachX = moduleLeft + 30;
    const approachY = context.entryRegion?.y || 400;
    const approach = createOptionalDetourPlatform(context, {
      id: `${detourId}:mycorrhiza-gap:${slotIndex}:approach`,
      moduleId: this.id,
      x: approachX,
      y: approachY,
      w: approachWidth,
      order: supportOrder++,
    });
    approach.optionalDetourSection = 'mycorrhiza-approach';
    approach.optionalDetourModuleInstanceId = instanceId;
    approach.authored = true;

    const sourceWidth = 200;
    const sourceX = approachX + approachWidth + 40;
    const sourceY = approachY;
    const source = createOptionalDetourPlatform(context, {
      id: `${detourId}:mycorrhiza-gap:${slotIndex}:source`,
      moduleId: this.id,
      x: sourceX,
      y: sourceY,
      w: sourceWidth,
      order: supportOrder++,
    });
    source.optionalDetourSection = 'mycorrhiza-source';
    source.optionalDetourModuleInstanceId = instanceId;
    source.type = 'root';
    source.authored = true;
    source.mycorrhizaBridgeSource = true;
    source.strictPreferredMycorrhizaTarget = true;

    const destWidth = 200;
    const destY = sourceY + verticalDelta;

    let gap = Math.round(lerp(460, 560, random ? random() : 0.5));
    let regularTraversalBlocked = false;
    let passingRegularPrimitiveIds = [];
    let gapCalibrationAttempts = 0;

    const normalPrimitives = (level.primitives || []).filter(primitive => (
      !(primitive.requires || []).includes('mycorrhizaStructures')
    ));

    for (let attempt = 0; attempt < 8; attempt++) {
      gapCalibrationAttempts++;
      const tempDestX = sourceX + sourceWidth + gap;
      if (tempDestX + destWidth > moduleRight + 50) break;

      const tempDest = {
        x: tempDestX,
        y: destY,
        w: destWidth,
        h: PLATFORM_HEIGHT,
      };

      const traversal = canTraverseEdge({
        from: source,
        to: tempDest,
        primitives: normalPrimitives,
      });

      if (!traversal.valid) {
        regularTraversalBlocked = true;
        passingRegularPrimitiveIds = [];
        break;
      }

      gap += 30;
      if (gap > 650) {
        break;
      }
    }

    if (!regularTraversalBlocked || gap > 650) {
      return {
        success: false,
        reason: 'regular-traversal-not-blocked',
      };
    }

    const destinationX = sourceX + sourceWidth + gap;
    const destination = createOptionalDetourPlatform(context, {
      id: `${detourId}:mycorrhiza-gap:${slotIndex}:destination`,
      moduleId: this.id,
      x: destinationX,
      y: destY,
      w: destWidth,
      order: supportOrder++,
    });
    destination.optionalDetourSection = 'mycorrhiza-destination';
    destination.optionalDetourModuleInstanceId = instanceId;
    destination.type = 'root';
    destination.authored = true;
    destination.mycorrhizaBridgeTarget = true;

    source.preferredMycorrhizaTargetId = destination.platformId;
    destination.preferredMycorrhizaSourceId = source.platformId;

    const egressSupports = [];
    const egressStart = destinationX + destWidth;
    const egressSpan = Math.max(0, moduleRight - egressStart);
    if (egressSpan > 180) {
      const exitPlatform = createOptionalDetourPlatform(context, {
        id: `${detourId}:mycorrhiza-gap:${slotIndex}:egress`,
        moduleId: this.id,
        x: moduleRight - 180,
        y: destY,
        w: 180,
        order: supportOrder++,
      });
      exitPlatform.optionalDetourSection = 'mycorrhiza-egress';
      exitPlatform.optionalDetourModuleInstanceId = instanceId;
      exitPlatform.authored = true;
      egressSupports.push(exitPlatform);
    }

    const exitPlatform = egressSupports[0] || destination;

    const gapBounds = {
      left: source.x + source.w,
      right: destination.x,
      top: Math.min(source.y, destination.y) - 60,
      bottom: Math.max(source.y + source.h, destination.y + destination.h) + 100,
    };

    const modulePlatforms = [approach, source, destination, ...egressSupports];
    const moduleContext = {
      ...context,
      detourId,
      slotIndex,
      modulePlatforms,
    };
    const contentRequests = this.createContentRequests(moduleContext);

    return {
      platforms: modulePlatforms,
      structures: [],
      contentRequests,
      entrySocket: {
        platformId: approach.platformId,
        platform: approach,
      },
      exitSocket: {
        platformId: exitPlatform.platformId,
        platform: exitPlatform,
      },
      occupiedBounds: {
        left: approach.x,
        right: exitPlatform.x + exitPlatform.w,
        top: Math.min(approach.y, source.y, destination.y) - 30,
        bottom: Math.max(approach.y + approach.h, source.y + source.h, destination.y + destination.h) + 30,
      },
      intentionalGaps: [{
        fromPlatformId: source.platformId,
        toPlatformId: destination.platformId,
        kind: 'mycorrhiza-bridge-gap',
        bounds: gapBounds,
      }],
      contentRequests,
      validationRules: [
        'mycorrhizaRootsLinked',
        'regularTraversalBlocked',
        'gapEmpty',
      ],
      mycorrhizaVariant: variantId,
      mycorrhizaSlotIndex: slotIndex,
      mycorrhizaSourcePlatformId: source.platformId,
      mycorrhizaTargetPlatformId: destination.platformId,
      mycorrhizaGapWidth: gap,
      mycorrhizaVerticalDelta: verticalDelta,
      mycorrhizaCenterX: source.x + source.w + gap / 2,
      regularTraversalBlocked,
      passingRegularPrimitiveIds,
      gapCalibrationAttempts,
      slotLeft: moduleLeft,
      slotRight: moduleRight,
      allocatedSpan: available,
    };
  },
});

export const OPTIONAL_DETOUR_MODULE_CATALOG = Object.freeze([
  AZO_LATERAL_ACCESS_MODULE,
  HARD_PHOSPHATE_GATE_MODULE,
  HARD_MOVEMENT_COMBO_MODULE,
  HARD_MYCORRHIZA_GAP_MODULE,
  DROP_REJOIN_MODULE,
]);
