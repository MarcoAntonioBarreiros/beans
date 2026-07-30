import assert from 'node:assert/strict';
import test from 'node:test';

import {
  campaignPhaseSeed,
  createCampaign,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { generateLevel, auditTraversableRoute } from '../src/procgen/generator.js';
import { generateLogicGraph } from '../src/procgen/logic.js';
import { createRandom } from '../src/procgen/random.js';
import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { selectTraversalEncounters } from '../src/procgen/traversal-encounter-selector.js';
import { validateTraversalEncounter } from '../src/procgen/traversal-encounter-validator.js';
import {
  createForkTraversalTemplate,
  FORK_GEOMETRY,
  getTraversalEncounterTemplate,
  sampleForkRoute,
  separationAt,
} from '../src/procgen/traversal-encounter-templates.js';
import {
  getChunkAnchorPlatform,
  getOptionalTraversalPlatforms,
  getPrimaryTraversalPlatforms,
  isOptionalOnlyTraversalPlatform,
} from '../src/procgen/traversal-route.js';

function campaignForPhase(phase, seed) {
  const campaign = createCampaign(seed);
  campaign.phase = phase;
  for (const key of Object.keys(campaign.unlocks)) campaign.unlocks[key] = phase >= 10;
  prepareCampaignGeneration(campaign);
  return campaign;
}

function levelForPhase(phase, seed = `traversal-phase-${phase}`) {
  const campaign = campaignForPhase(phase, seed);
  return generateLevel(campaignPhaseSeed(campaign));
}

function stableEncounterPlan(level) {
  return {
    encounters: level.traversalEncounters,
    stats: level.traversalEncounterStats,
    platforms: level.platforms
      .filter(platform => platform.encounterInstanceId)
      .map(platform => ({
        id: platform.platformId,
        x: platform.x,
        y: platform.y,
        w: platform.w,
        h: platform.h,
        role: platform.routeRole,
        primary: platform.primaryRouteOrder,
        optional: platform.optionalRouteOrder,
      })),
    rewards: level.exudates.filter(item => item.optionalReward),
  };
}

function gapsForBlocks(blocks, orderKey) {
  const route = [...blocks]
    .filter(item => Number.isFinite(item[orderKey]))
    .sort((left, right) => left[orderKey] - right[orderKey]);
  return route.slice(1).map((item, index) => (
    item.x - (route[index].x + route[index].w)
  ));
}

test('fases 1-9 nao recebem encontros de percurso e a fase 3 permanece sem torre', () => {
  for (let phase = 1; phase <= 9; phase++) {
    const level = levelForPhase(phase);
    assert.deepEqual(level.traversalEncounters, [], `fase ${phase}`);
    assert.equal(level.platforms.some(platform => platform.traversalEncounterId), false);
  }
});

test('fase 10 oficial cria exatamente um fork e uma torre, separados por cinco chunks', () => {
  const level = levelForPhase(10, 'official-two-encounters');
  assert.equal(level.traversalEncounters.length, 2);
  assert.deepEqual(
    level.traversalEncounters.map(item => item.templateId).sort(),
    ['fork-high-reward-01', 'tower-safe-fall-01'],
  );
  const positions = level.traversalEncounters.map(item => item.logicIndex).sort((a, b) => a - b);
  assert.ok(positions[0] >= 5);
  assert.ok(positions[1] <= 35);
  assert.ok(positions[1] - positions[0] >= 5);
  assert.equal(level.traversalEncounterStats.created, 2);
  assert.equal(level.traversalEncounterStats.fallbacks, 0);
});

test('a mesma seed reproduz encontros, blocos, IDs e recompensas', () => {
  assert.deepEqual(
    stableEncounterPlan(levelForPhase(10, 'deterministic-traversal')),
    stableEncounterPlan(levelForPhase(10, 'deterministic-traversal')),
  );
});

test('seeds diferentes variam as posicoes sem alterar os dois tipos obrigatorios', () => {
  const signatures = new Set();
  for (let index = 0; index < 30; index++) {
    const level = levelForPhase(10, `varied-${index}`);
    signatures.add(level.traversalEncounters.map(item => item.logicIndex).sort((a, b) => a - b).join(','));
    assert.equal(level.traversalEncounters.length, 2);
  }
  assert.ok(signatures.size > 4);
});

test('cada encontro tem uma unica ancora e entrada/saida compartilhadas pelas duas rotas', () => {
  const level = levelForPhase(10, 'route-metadata');
  for (const encounter of level.traversalEncounters) {
    const blocks = level.platforms.filter(platform => (
      platform.encounterInstanceId === encounter.encounterInstanceId
    ));
    assert.equal(blocks.filter(platform => platform.campaignAnchor).length, 1);
    const entry = blocks.find(platform => platform.blockRole === 'entry');
    const exit = blocks.find(platform => platform.blockRole === 'exit');
    assert.equal(entry.routeRole, 'shared');
    assert.equal(exit.routeRole, 'shared');
    assert.ok(Number.isFinite(entry.primaryRouteOrder));
    assert.ok(Number.isFinite(entry.optionalRouteOrder));
    assert.ok(Number.isFinite(exit.primaryRouteOrder));
    assert.ok(Number.isFinite(exit.optionalRouteOrder));
    assert.equal(getChunkAnchorPlatform(level, encounter.logicIndex), exit);
  }
});

test('rota primaria exclui blocos opcionais e rota opcional segue sua sequencia declarada', () => {
  const level = levelForPhase(10, 'route-helpers');
  const primary = getPrimaryTraversalPlatforms(level);
  assert.equal(primary.some(isOptionalOnlyTraversalPlatform), false);
  for (const encounter of level.traversalEncounters) {
    const optional = getOptionalTraversalPlatforms(level).filter(platform => (
      platform.encounterInstanceId === encounter.encounterInstanceId
    ));
    assert.deepEqual(
      optional.map(platform => platform.optionalRouteOrder),
      [...optional].map(platform => platform.optionalRouteOrder).sort((a, b) => a - b),
    );
  }
});

test('cada rota opcional recebe exatamente dois exsudatos e nenhum recurso comum', () => {
  const level = levelForPhase(10, 'optional-rewards');
  for (const encounter of level.traversalEncounters) {
    const rewards = level.exudates.filter(item => (
      item.encounterInstanceId === encounter.encounterInstanceId
    ));
    assert.equal(rewards.length, 2);
    assert.equal(rewards.every(item => item.optionalReward === true), true);
    assert.equal(new Set(rewards.map(item => item.id)).size, 2);
  }
  for (const reward of level.exudates.filter(item => !item.optionalReward)) {
    const host = reward.platform || level.platforms.find(platform => platform.platformId === reward.platformId);
    assert.equal(host ? isOptionalOnlyTraversalPlatform(host) : false, false);
  }
});

test('validacao confirma rota primaria, opcional, salto duplo e queda segura da torre', () => {
  const level = levelForPhase(10, 'route-validation');
  for (const encounter of level.traversalEncounters) {
    const result = validateTraversalEncounter(level, encounter);
    assert.equal(result.valid, true);
    if (encounter.templateId === 'tower-safe-fall-01') {
      assert.equal(result.requiresDoubleJump, true);
    }
    assert.deepEqual(result.primaryFailures, []);
    assert.deepEqual(result.optionalFailures, []);
    assert.deepEqual(result.safeFallFailures, []);
  }
});

test('um template quebrado e rejeitado sem ser confundido com rota valida', () => {
  const instance = 'broken-instance';
  const broken = {
    templateId: 'tower-safe-fall-01',
    encounterInstanceId: instance,
  };
  const level = {
    platforms: [
      {
        x: 0, y: 500, w: 100, h: 54, logicIndex: 10,
        platformId: 'entry', encounterInstanceId: instance,
        traversalEncounterId: broken.templateId, routeRole: 'shared',
        blockRole: 'entry', primaryRouteOrder: 0, optionalRouteOrder: 0,
      },
      {
        x: 900, y: 100, w: 60, h: 54, logicIndex: 10,
        platformId: 'exit', encounterInstanceId: instance,
        traversalEncounterId: broken.templateId, routeRole: 'shared',
        blockRole: 'exit', primaryRouteOrder: 1, optionalRouteOrder: 1,
      },
    ],
  };
  assert.equal(validateTraversalEncounter(level, broken).valid, false);
});

test('a saida do encontro vira a origem real do chunk seguinte', () => {
  const level = levelForPhase(10, 'exit-is-prev');
  for (const encounter of level.traversalEncounters) {
    const exit = level.platforms.find(platform => platform.platformId === encounter.exitPlatformId);
    const next = getChunkAnchorPlatform(level, encounter.logicIndex + 1);
    if (!next) continue;
    assert.ok(next.x > exit.x + exit.w);
    assert.ok(next.x - (exit.x + exit.w) <= 288);
  }
});

test('encontros curriculares usam a ancora e nao duplicam organismos em blocos opcionais', () => {
  const level = levelForPhase(10, 'campaign-anchor');
  const encounters = generateCampaignEncounters({
    platforms: level.platforms,
    phase: 10,
    seedValue: level.seed,
  });
  const keys = encounters.map(item => `${item.source}:${item.id}:${item.logicIndex}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const encounter of encounters) {
    const anchor = getChunkAnchorPlatform(level, encounter.logicIndex);
    assert.ok(anchor);
    assert.equal(isOptionalOnlyTraversalPlatform(anchor), false);
  }
});

test('auditoria da rota obrigatoria ignora completamente os blocos opcionais', () => {
  const level = levelForPhase(10, 'audit-primary-only');
  const optionalIds = new Set(
    level.platforms.filter(isOptionalOnlyTraversalPlatform).map(platform => platform.platformId),
  );
  const audit = auditTraversableRoute(level, { doubleJump: true, dash: true }, {
    mycorrhizaStructuresAvailable: true,
    jetpackAvailable: true,
  });
  assert.equal([...audit.ordinaryFailures, ...audit.intentionalCrossings].some(item => (
    optionalIds.has(item.previousPlatformId) || optionalIds.has(item.nextPlatformId)
  )), false);
});

test('dimensoes, limites verticais e IDs dos blocos sao validos e unicos', () => {
  const level = levelForPhase(10, 'bounds-and-ids');
  const blocks = level.platforms.filter(platform => platform.encounterInstanceId);
  assert.equal(new Set(blocks.map(platform => platform.platformId)).size, blocks.length);
  assert.equal(blocks.every(platform => (
    platform.w > 0
    && platform.h > 0
    && Number.isFinite(platform.y)
  )), true);
});

test('fork deriva separacao do angulo, mantem plato 22-78 e distribui por arco', () => {
  const spans = [900, 1200, 1500, 1800];
  let previousSeparation = 0;
  let previousHardCount = 0;
  for (const requestedSpan of spans) {
    const template = createForkTraversalTemplate({
      routeSpan: requestedSpan,
      seedValue: `dynamic-fork-${requestedSpan}`,
    });
    const primary = template.blocks.filter(item => item.routeRole === 'primary');
    const optional = template.blocks.filter(item => item.routeRole === 'optional');
    const primaryGaps = gapsForBlocks(template.blocks, 'primaryRouteOrder');
    const optionalGaps = gapsForBlocks(template.blocks, 'optionalRouteOrder');
    const expectedSeparation = Math.tan(52 * Math.PI / 180) * requestedSpan * .22;

    assert.equal(template.generation.encounterSpan, requestedSpan);
    assert.ok(Math.abs(template.generation.maximumSeparation - expectedSeparation) < .01);
    assert.ok(Math.abs(separationAt(.22, expectedSeparation) - expectedSeparation) < .01);
    assert.ok(Math.abs(separationAt(.5, expectedSeparation) - expectedSeparation) < .01);
    assert.ok(Math.abs(separationAt(.78, expectedSeparation) - expectedSeparation) < .01);
    assert.ok(template.generation.maximumSeparation > previousSeparation);
    assert.ok(optional.length >= previousHardCount);
    assert.equal(primary.length, Math.max(4, Math.ceil(template.generation.safeRouteLength / 205) - 1));
    assert.equal(optional.length, Math.max(6, Math.ceil(template.generation.hardRouteLength / 155) - 1));
    assert.ok(primary.length <= FORK_GEOMETRY.technicalPlatformCap);
    assert.ok(optional.length <= FORK_GEOMETRY.technicalPlatformCap);
    assert.equal(primary.every(item => item.w >= 145 && item.w <= 195), true);
    assert.equal(optional.every(item => item.w >= 90 && item.w <= 130), true);
    assert.equal(primaryGaps.every(gap => gap >= -18 && gap <= 95), true);
    assert.equal(optionalGaps.every(gap => gap >= -18 && gap <= 115), true);
    assert.equal(Math.max(...primary.map(item => item.w)) <= 195, true);
    assert.equal(Math.max(...optional.map(item => item.w)) <= 130, true);

    for (const route of ['safe', 'hard']) {
      const polyline = sampleForkRoute({
        encounterSpan: requestedSpan,
        maximumSeparation: expectedSeparation,
        route,
      });
      assert.ok(polyline.points.length >= 101);
      assert.ok(polyline.length >= requestedSpan);
    }
    previousSeparation = template.generation.maximumSeparation;
    previousHardCount = optional.length;
  }
});

test('fork oficial expõe comprimentos reais, separacao, queda parcial e validacao fisica', () => {
  const level = levelForPhase(10, 'fork-metrics');
  const encounter = level.traversalEncounters.find(item => (
    item.templateId === 'fork-high-reward-01'
  ));
  assert.ok(encounter);
  const result = validateTraversalEncounter(level, encounter);
  assert.equal(result.valid, true);
  assert.equal(result.metrics.physicalValidation, true);
  assert.ok(result.metrics.encounterSpan >= 900 && result.metrics.encounterSpan <= 1800);
  assert.ok(result.metrics.primaryRouteLength > 0);
  assert.ok(result.metrics.optionalRouteLength > result.metrics.encounterSpan);
  assert.ok(Math.abs(result.metrics.actualOpeningAngle - 52) < .01);
  assert.ok(result.metrics.maximumVerticalSeparation > 250);
  assert.ok(result.metrics.primaryAverageWidth >= 145);
  assert.ok(result.metrics.optionalAverageWidth <= 130);
  assert.deepEqual(result.rewardFailures, []);

  const debug = level.traversalEncounterStats.details.find(item => (
    item.templateId === 'fork-high-reward-01'
  ));
  assert.ok(debug);
  assert.equal(debug.primaryBlockCount, result.metrics.primaryBlockCount);
  assert.equal(debug.optionalBlockCount, result.metrics.optionalBlockCount);
  assert.equal(debug.physicalValidation, true);
});

test('tower-safe-fall-01 permanece byte-a-byte na geometria especificada', () => {
  const template = getTraversalEncounterTemplate('tower-safe-fall-01');
  assert.equal(template.width, 1035);
  assert.equal(template.minY, -185);
  assert.equal(template.maxY, 144);
  assert.deepEqual(
    template.blocks.map(item => ({
      id: item.id,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      routeRole: item.routeRole,
      primaryRouteOrder: item.primaryRouteOrder,
      optionalRouteOrder: item.optionalRouteOrder,
      campaignAnchor: Boolean(item.campaignAnchor),
    })),
    [
      { id: 'entry', x: 0, y: 0, w: 180, h: 54, routeRole: 'shared', primaryRouteOrder: 0, optionalRouteOrder: 0, campaignAnchor: false },
      { id: 'safe-floor-a', x: 190, y: 90, w: 230, h: 54, routeRole: 'primary', primaryRouteOrder: 1, optionalRouteOrder: null, campaignAnchor: false },
      { id: 'safe-floor-b', x: 425, y: 90, w: 410, h: 54, routeRole: 'primary', primaryRouteOrder: 2, optionalRouteOrder: null, campaignAnchor: false },
      { id: 'step-a', x: 205, y: -110, w: 120, h: 54, routeRole: 'optional', primaryRouteOrder: null, optionalRouteOrder: 1, campaignAnchor: false },
      { id: 'step-b', x: 365, y: -145, w: 110, h: 54, routeRole: 'optional', primaryRouteOrder: null, optionalRouteOrder: 2, campaignAnchor: false },
      { id: 'step-c', x: 525, y: -170, w: 105, h: 54, routeRole: 'optional', primaryRouteOrder: null, optionalRouteOrder: 3, campaignAnchor: false },
      { id: 'top', x: 660, y: -185, w: 135, h: 54, routeRole: 'optional', primaryRouteOrder: null, optionalRouteOrder: 4, campaignAnchor: false },
      { id: 'exit', x: 845, y: 0, w: 190, h: 54, routeRole: 'shared', primaryRouteOrder: 3, optionalRouteOrder: 5, campaignAnchor: true },
    ],
  );
});

test('configuracoes curtas demais falham com seguranca sem corromper chunks', () => {
  const logic = Array.from({ length: 8 }, (_, index) => ({
    index,
    campaignPhase: 10,
    requires: [],
  }));
  const result = selectTraversalEncounters({ logic, phase: 10, seedValue: 'short' });
  assert.deepEqual(result.plans, []);
  assert.equal(result.stats.created, 0);
  assert.ok(result.stats.rejected > 0);
  assert.equal(logic.some(chunk => chunk.reservedByTraversalEncounter), false);
});

test('stress deterministico: 1.000 planos e pipeline real configuravel sem sobreposicao', () => {
  const slots = new Set();
  const forkSpans = new Set();
  let minimumSpacing = Infinity;
  for (let index = 0; index < 1000; index++) {
    const campaign = campaignForPhase(10, `selector-stress-${index}`);
    const seed = campaignPhaseSeed(campaign);
    const logic = generateLogicGraph(createRandom(seed));
    const selection = selectTraversalEncounters({ logic, phase: 10, seedValue: seed });
    assert.equal(selection.plans.length, 2);
    const positions = selection.plans.map(plan => plan.logicIndex).sort((a, b) => a - b);
    minimumSpacing = Math.min(minimumSpacing, positions[1] - positions[0]);
    slots.add(positions.join(','));
    const fork = selection.plans.find(plan => plan.templateId === 'fork-high-reward-01');
    assert.ok(fork.routeSpan >= 900 && fork.routeSpan <= 1800);
    forkSpans.add(fork.routeSpan);
  }
  assert.ok(minimumSpacing >= 5);
  assert.ok(slots.size > 20);
  assert.ok(forkSpans.size > 1);

  const pipelineSeeds = Number(process.env.TRAVERSAL_STRESS_SEEDS || 100);
  let fallbacks = 0;
  for (let index = 0; index < pipelineSeeds; index++) {
    const level = levelForPhase(10, `pipeline-stress-${index}`);
    fallbacks += level.traversalEncounterStats.fallbacks;
    assert.equal(level.traversalEncounters.length, 2);
    assert.equal(level.traversalEncounters.every(item => item.validation.valid), true);
  }
  assert.equal(fallbacks, 0);
});
