import { createRandom } from './random.js';
import {
  getPhaseManifest,
  getProceduralPoolAt,
  getRoamingDebutsAt,
} from './campaign-manifest.js';
import {
  getChunkAnchorPlatform,
  getPrimaryTraversalPlatforms,
} from './traversal-route.js';

const MIN_ZONE_SPACING = 390;
const MIN_DEBUT_CLEARANCE = 430;
const MIN_NEWCOMER_SEPARATION = 440;

function shuffledBag(types, random) {
  const bag = [...types];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function routePlatforms(platforms) {
  return getPrimaryTraversalPlatforms({ platforms })
    .filter(platform => platform.w >= 100);
}

function platformForChunk(platforms, chunkIndex) {
  return getChunkAnchorPlatform({ platforms }, chunkIndex);
}

function zonePosition(platform, random) {
  const lateral = (random() - .5) * Math.min(platform.w * .28, 54);
  return {
    x: platform.x + platform.w / 2 + lateral,
    y: Math.max(95, platform.y - 88 - random() * 42),
  };
}

function nearAnyDebut(x, debutZones) {
  return debutZones.some(zone => Math.abs(zone.x - x) < MIN_DEBUT_CLEARANCE);
}

export function generateCampaignEncounters({ platforms, phase, seedValue }) {
  const manifest = getPhaseManifest(phase);
  if (!manifest) return [];

  const random = createRandom(`${seedValue}:campaign-encounters:p${phase}`);
  const route = routePlatforms(platforms);
  const representativeRoute = [...new Set(route.map(platform => platform.logicIndex))]
    .map(logicIndex => platformForChunk(route, logicIndex))
    .filter(Boolean);
  const encounters = [];
  const debutZones = [];
  const currentPhaseCards = new Map();
  for (const presentation of manifest.presentations) {
    const types = presentation.roamingType
      ? [presentation.roamingType]
      : Array.isArray(presentation.roamingTypes) ? presentation.roamingTypes : [];
    for (const type of types) currentPhaseCards.set(type, presentation.cardId);
  }

  for (const chunk of representativeRoute) {
    for (const debut of getRoamingDebutsAt(phase, chunk.logicIndex)) {
      const platform = platformForChunk(route, chunk.logicIndex);
      if (!platform) continue;
      const position = zonePosition(platform, random);
      const zone = {
        id: debut.type,
        x: position.x,
        y: position.y,
        r: 155,
        territory: 620,
        collect: false,
        logicIndex: chunk.logicIndex,
        source: 'debut',
        cardId: debut.cardId,
        presentationId: debut.presentationId,
        debutZoneId: debut.debutZoneId,
        tetherUntilSeen: debut.tetherUntilSeen,
        tetherRadius: 165,
        // Quem ensina a mecanica e o organismo. Ver getRoamingDebutsAt.
        unlockFeature: debut.unlockFeature || null,
      };
      const overlappingDebut = debutZones.find(existing => (
        Math.hypot(existing.x - zone.x, existing.y - zone.y) <= MIN_NEWCOMER_SEPARATION
      ));
      if (overlappingDebut) {
        throw new Error(
          `Estreias inéditas simultâneas na fase ${phase}: ${overlappingDebut.id}/${zone.id}`,
        );
      }
      encounters.push(zone);
      debutZones.push(zone);
    }
  }

  let bag = [];
  let bagKey = '';
  let previousType = null;
  let nextSpawnX = 430 + random() * 190;

  for (const platform of representativeRoute) {
    if (platform.x < nextSpawnX || nearAnyDebut(platform.x + platform.w / 2, debutZones)) continue;
    const pool = getProceduralPoolAt(phase, platform.logicIndex);
    if (!pool.length) continue;

    const currentKey = pool.join('|');
    if (currentKey !== bagKey) {
      bag = shuffledBag(pool, random);
      bagKey = currentKey;
    } else if (!bag.length) {
      bag = shuffledBag(pool, random);
    }

    let type = bag.pop();
    if (type === previousType && bag.length) {
      bag.unshift(type);
      type = bag.pop();
    }
    previousType = type;
    const position = zonePosition(platform, random);
    encounters.push({
      id: type,
      x: position.x,
      y: position.y,
      r: 145 + random() * 65,
      territory: 520 + random() * 720,
      collect: false,
      logicIndex: platform.logicIndex,
      source: 'procedural',
      requiresSeenCardId: currentPhaseCards.get(type) || null,
    });
    nextSpawnX = platform.x + MIN_ZONE_SPACING + random() * 360;
  }

  return encounters;
}
