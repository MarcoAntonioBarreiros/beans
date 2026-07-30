import { createPhosphateDepositAt } from './phosphate-solubilization.js';

function findPlatform(level, platformId) {
  return (level.platforms || []).find(platform => (
    (platform.platformId || platform.id) === platformId
  )) || null;
}

function optionalMetadata(detour, request) {
  return {
    optionalDetourId: detour.id,
    detourModuleId: request.detourModuleId,
    routeScope: 'optional',
    routeOwned: true,
    authored: true,
    allowOptionalRoutePopulation: true,
  };
}

export function materializeOptionalDetourContent({
  level,
  detour,
  contentRequests = [],
  random = null,
} = {}) {
  const result = {
    deposits: [],
    authoredColonies: [],
    authoredEncounters: [],
    exudates: [],
    failures: [],
    byModule: {},
    randomUsed: Boolean(random),
  };
  if (!level || !detour) {
    result.failures.push('missing-level-or-detour');
    return result;
  }

  for (const request of contentRequests) {
    const metadata = optionalMetadata(detour, request);
    const modId = request.detourModuleId || 'unknown';
    if (!result.byModule[modId]) {
      result.byModule[modId] = {
        depositIds: [],
        colonyIds: [],
        authoredEncounterIds: [],
        exudateIds: [],
      };
    }
    const moduleGroup = result.byModule[modId];

    if (request.type === 'phosphate-deposit') {
      const hostPlatform = findPlatform(level, request.hostPlatformId);
      const destinationPlatform = findPlatform(
        level,
        request.destinationPlatformId,
      );
      if (!hostPlatform || !destinationPlatform) {
        result.failures.push(`missing-deposit-platform:${request.id}`);
        continue;
      }
      const deposit = createPhosphateDepositAt({
        level,
        hostPlatform,
        destinationPlatform,
        logicIndex: request.logicIndex,
        optionalDetourId: detour.id,
        detourModuleId: request.detourModuleId,
        authored: true,
        difficulty: request.difficulty,
        id: request.id,
      });
      if (!deposit) {
        result.failures.push(`deposit-not-created:${request.id}`);
        continue;
      }
      Object.assign(deposit, metadata);
      result.deposits.push(deposit);
      moduleGroup.depositIds.push(deposit.id);
      continue;
    }

    if (request.type === 'authored-beneficial-colony') {
      const platform = findPlatform(level, request.platformId);
      if (!platform) {
        result.failures.push(`missing-colony-platform:${request.id}`);
        continue;
      }
      const colony = {
        id: request.id,
        type: request.organism,
        platform,
        platformId: platform.platformId || platform.id,
        x: platform.x + platform.w * (request.xRatio ?? .3),
        y: platform.y - 8,
        sourceCount: 5,
        vigor: 1,
        growth: 1,
        rechargeIntensity: .35,
        phosphateMetaboliteReserve: 1,
        ...metadata,
      };
      level.authoredBeneficialColonies = [
        ...(level.authoredBeneficialColonies || []),
        colony,
      ];
      result.authoredColonies.push(colony);
      moduleGroup.colonyIds.push(colony.id);
      continue;
    }

    if (request.type === 'authored-roaming-beneficial') {
      const platform = findPlatform(level, request.platformId);
      if (!platform) {
        result.failures.push(`missing-roaming-platform:${request.id}`);
        continue;
      }
      const encounter = {
        id: request.organism,
        x: platform.x + platform.w * (request.xRatio ?? .3),
        y: platform.y - 20,
        r: 145,
        territory: 320,
        collect: false,
        logicIndex: platform.logicIndex,
        source: 'optional-detour-authored',
        ...metadata,
      };
      level.authoredEncounters = [
        ...(level.authoredEncounters || []),
        encounter,
      ];
      result.authoredEncounters.push(encounter);
      moduleGroup.authoredEncounterIds.push(encounter.id);
      continue;
    }

    if (request.type === 'exudate') {
      const platform = findPlatform(level, request.platformId);
      if (!platform) {
        result.failures.push(`missing-exudate-platform:${request.id}`);
        continue;
      }
      const exudate = {
        id: request.id,
        platform,
        platformId: platform.platformId || platform.id,
        x: platform.x + platform.w * (request.xRatio ?? .5),
        y: platform.y - 24,
        collected: false,
        ...metadata,
      };
      level.exudates = [...(level.exudates || []), exudate];
      result.exudates.push(exudate);
      moduleGroup.exudateIds.push(exudate.id);
    }
  }

  detour.materializedContent = {
    byModule: result.byModule,
    depositIds: result.deposits.map(deposit => deposit.id),
    colonyIds: result.authoredColonies.map(colony => colony.id),
    authoredEncounterIds: result.authoredEncounters.map(enc => enc.id),
    exudateIds: result.exudates.map(exudate => exudate.id),
    failures: [...result.failures],
  };
  return result;
}

// Compatibilidade temporária com o andaime do Checkpoint A.
export function createOptionalDetourContentRequests() {
  return [];
}
