import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { getPhaseManifest, getPersistentUnlocksBeforePhase } from '../src/procgen/campaign-manifest.js';
import {
  campaignPhaseSeed,
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { generateLevel } from '../src/procgen/generator.js';
import {
  createNitrogenRootDevelopment,
  generateUnderdevelopedNitrogenRoots,
} from '../src/procgen/nitrogen-root.js';

const CONFIG = {
  enabled: true,
  count: 1,
  requiredFixationRate: .05,
  growthDurationSeconds: 4,
};

function fixtureLevel({ exudateIndex = 3, includeRootAfter = true } = {}) {
  return {
    platforms: [
      { x: 100, y: 500, w: 190, h: 60, type: 'root', logicIndex: 1 },
      { x: 360, y: 490, w: 180, h: 60, type: 'root', logicIndex: 2 },
      { x: 620, y: 500, w: 210, h: 60, type: 'root', logicIndex: 3 },
      ...(includeRootAfter ? [
        { x: 900, y: 470, w: 205, h: 62, type: 'root', logicIndex: 4 },
        { x: 1190, y: 480, w: 190, h: 58, type: 'root', logicIndex: 5 },
        { x: 1470, y: 490, w: 205, h: 60, type: 'soil', logicIndex: 6 },
        { x: 1125, y: 590, w: 72, h: 28, type: 'root', logicIndex: 5, recovery: true },
      ] : []),
    ],
    exudates: [{ logicIndex: exudateIndex, x: 680, y: 450, taken: false }],
    nitrogenRoots: [],
  };
}

const rhizobiumAt = logicIndex => [{ id: 'rhizobium', logicIndex, source: 'debut' }];

test('bloco so e gerado depois de Rhizobium, exsudato e raiz colonizavel, nessa ordem', () => {
  assert.deepEqual(generateUnderdevelopedNitrogenRoots({
    level: fixtureLevel(), phase: 1, seedValue: 'phase-one', encounters: rhizobiumAt(2), config: CONFIG,
  }), []);
  assert.deepEqual(generateUnderdevelopedNitrogenRoots({
    level: fixtureLevel(), phase: 2, seedValue: 'no-rhizobium', encounters: [], config: CONFIG,
  }), []);
  assert.deepEqual(generateUnderdevelopedNitrogenRoots({
    level: fixtureLevel({ exudateIndex: 1 }), phase: 2, seedValue: 'early-exudate', encounters: rhizobiumAt(2), config: CONFIG,
  }), []);
  assert.deepEqual(generateUnderdevelopedNitrogenRoots({
    level: fixtureLevel({ includeRootAfter: false }), phase: 2, seedValue: 'only-soil-after', encounters: rhizobiumAt(2), config: CONFIG,
  }), []);

  const level = fixtureLevel();
  const roots = generateUnderdevelopedNitrogenRoots({
    level, phase: 2, seedValue: 'valid-order', encounters: rhizobiumAt(2), config: CONFIG,
  });
  assert.equal(roots.length, 1);
  assert.equal(roots[0].hostPlatform.type, 'root');
  assert.equal(roots[0].hostPlatform, roots[0].leftPlatform);
  assert.ok(roots[0].startWidth >= 64);
  assert.equal(roots[0].startHeight, 12);
  assert.ok(roots[0].hostLogicIndex > roots[0].sourceExudateLogicIndex);
  assert.ok(roots[0].sourceExudateLogicIndex > roots[0].sourceRhizobiumLogicIndex);
  assert.equal(level.platforms.includes(roots[0].targetPlatform), false);
  assert.equal(level.platforms.some(platform => platform.recovery
    && platform.x > roots[0].leftPlatform.x + roots[0].leftPlatform.w
    && platform.x < roots[0].rightPlatform.x), false);
  assert.ok(roots[0].blockedGapWidth >= 210);
  assert.ok(roots[0].blockedGapWidth > 142, 'sem a raiz, o vao deve exceder o salto normal da Fase 2');
  assert.ok(roots[0].leftLandingGap <= 142, 'a borda esquerda da raiz completa deve ser alcancavel');
  assert.ok(roots[0].rightLandingGap <= 142, 'a plataforma seguinte deve ser alcancavel pela raiz completa');
  assert.equal(level.platforms.some(platform => platform.nitrogenRootCollider), false);
});

test('posicao e dimensoes sao reproduziveis pela mesma seed', () => {
  const snapshot = seed => {
    const roots = generateUnderdevelopedNitrogenRoots({
      level: fixtureLevel(), phase: 2, seedValue: seed, encounters: rhizobiumAt(2), config: CONFIG,
    });
    return roots.map(root => ({
      id: root.id, hostLogicIndex: root.hostLogicIndex, targetLogicIndex: root.targetLogicIndex, x: root.x, y: root.y,
      targetWidth: root.targetWidth, targetHeight: root.targetHeight, phase: root.phase,
    }));
  };
  assert.deepEqual(snapshot('deterministic-seed'), snapshot('deterministic-seed'));
});

function runtimeFixture() {
  const level = fixtureLevel();
  const [root] = generateUnderdevelopedNitrogenRoots({
    level, phase: 2, seedValue: 'runtime-root', encounters: rhizobiumAt(2), config: CONFIG,
  });
  const site = {
    platform: root.hostPlatform,
    mature: false,
    stage: 'young-nodule',
    fixationRate: 0,
    x: root.hostPlatform.x + 80,
    surfaceY: root.hostPlatform.y,
    depth: 24,
  };
  level.rhizobiumNodules = [site];
  const state = {
    gameState: 'play', time: 0, cameraX: 0,
    level,
  };
  return { state, root, site, runtime: createNitrogenRootDevelopment({ state }) };
}

test('nodulo imaturo ou FBN abaixo do minimo nao iniciam crescimento', () => {
  const { root, site, runtime } = runtimeFixture();
  site.fixationRate = 1;
  runtime.update(2);
  assert.equal(root.progress, 0);
  assert.equal(root.collider, null);

  site.mature = true;
  site.stage = 'mature-nodule';
  site.fixationRate = .049;
  runtime.update(2);
  assert.equal(root.progress, 0);
  assert.equal(root.collider, null);
});

test('FBN ativa cresce visualmente sem colisao ate 99% e so entao cria plataforma solida', () => {
  const { state, root, site, runtime } = runtimeFixture();
  const originalPlatformCount = state.level.platforms.length;
  site.mature = true;
  site.stage = 'mature-nodule';
  site.fixationRate = .05;

  runtime.update(3.96);
  assert.equal(root.progress, .99);
  assert.equal(root.developed, false);
  assert.equal(root.functionalProgress, 0);
  assert.equal(root.collider, null);
  assert.equal(state.level.platforms.length, originalPlatformCount);

  runtime.update(.04);
  assert.equal(root.progress, 1);
  assert.equal(root.developed, true);
  assert.equal(root.functionalProgress, 1);
  assert.ok(root.collider);
  assert.equal(state.level.platforms.includes(root.collider), true);
  assert.equal(state.level.platforms.length, originalPlatformCount + 1);
  assert.equal(root.collider.type, 'root');
  assert.equal(root.collider.oneWay, false);
  assert.equal(root.collider.logicIndex, root.targetLogicIndex);
  assert.equal(root.collider.x, root.targetPlatform.x);
  assert.equal(root.collider.y, root.targetPlatform.y);
  assert.equal(root.collider.w, root.targetWidth);
  assert.equal(root.collider.h, root.targetHeight);

  site.fixationRate = 0;
  runtime.update(30);
  assert.equal(root.progress, 1);
  assert.equal(root.developed, true);
  assert.equal(state.level.platforms.includes(root.collider), true);
});

test('multiplas seeds da fase 2 respeitam ordem, raiz hospedeira e determinismo', () => {
  for (let index = 0; index < 8; index++) {
    const campaign = createCampaign(`nitrogen-campaign-${index}`);
    campaign.phase = 2;
    Object.assign(campaign.unlocks, getPersistentUnlocksBeforePhase(2));
    const profile = prepareCampaignGeneration(campaign);
    const seedValue = campaignPhaseSeed(campaign);
    const build = () => {
      const level = decorateCampaignLevel(generateLevel(seedValue), campaign, profile);
      const encounters = generateCampaignEncounters({ platforms: level.platforms, phase: 2, seedValue });
      const roots = generateUnderdevelopedNitrogenRoots({
        level, phase: 2, seedValue, encounters, config: getPhaseManifest(2).nitrogenRoot,
      });
      return roots.map(root => ({
        hostLogicIndex: root.hostLogicIndex,
        targetLogicIndex: root.targetLogicIndex,
        sourceRhizobiumLogicIndex: root.sourceRhizobiumLogicIndex,
        sourceExudateLogicIndex: root.sourceExudateLogicIndex,
        hostType: root.hostPlatform.type,
        hostIsPreviousPlatform: root.hostPlatform === root.leftPlatform,
        targetRemoved: !level.platforms.includes(root.targetPlatform),
        blockedGapWidth: root.blockedGapWidth,
        leftLandingGap: root.leftLandingGap,
        rightLandingGap: root.rightLandingGap,
        x: root.x, y: root.y,
      }));
    };
    const first = build();
    assert.deepEqual(first, build());
    assert.equal(first.length, 1);
    assert.equal(first[0].hostType, 'root');
    assert.equal(first[0].hostIsPreviousPlatform, true);
    assert.equal(first[0].targetRemoved, true);
    assert.ok(first[0].blockedGapWidth >= 210);
    assert.ok(first[0].blockedGapWidth > 142);
    assert.ok(first[0].leftLandingGap <= 142);
    assert.ok(first[0].rightLandingGap <= 142);
    assert.ok(first[0].sourceRhizobiumLogicIndex < first[0].sourceExudateLogicIndex);
    assert.ok(first[0].sourceExudateLogicIndex < first[0].hostLogicIndex);
    assert.ok(first[0].hostLogicIndex < first[0].targetLogicIndex);
  }
});
