import assert from 'node:assert/strict';
import test from 'node:test';

import {
  campaignPhaseSeed,
  createCampaign,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { generateLevel } from '../src/procgen/generator.js';

function createPhaseOneLevel(seed = 'test-seed-123') {
  const campaign = createCampaign(seed);
  const profile = prepareCampaignGeneration(campaign);
  return {
    level: generateLevel(campaignPhaseSeed(campaign)),
    profile,
  };
}

function stablePlatform(platform) {
  return {
    x: platform.x,
    y: platform.y,
    w: platform.w,
    h: platform.h,
    type: platform.type,
    logicIndex: platform.logicIndex,
    repaired: Boolean(platform.repaired),
    recovery: Boolean(platform.recovery),
  };
}

function stableGenerationPlan(level) {
  return {
    platforms: level.platforms.map(stablePlatform),
    hazards: level.hazards,
    crystals: level.crystals,
    enemies: level.enemies,
    exudates: level.exudates,
    allies: level.allies,
    checkpoints: level.checkpoints,
    roots: level.roots,
    spores: level.spores,
    debugInfo: level.debugInfo,
    primitives: level.primitives,
    endX: level.endX,
    cameraMaxX: level.cameraMaxX,
  };
}

test('a mesma seed reproduz o mesmo plano procedural', () => {
  const first = createPhaseOneLevel().level;
  const second = createPhaseOneLevel().level;

  // validateChunk usa o simulador completo. O sistema de saúde radicular acrescenta
  // estado de runtime às plataformas e sorteia collapseCooldown com Math.random().
  // Esse temporizador não faz parte do plano procedural; geometria e conteúdo fazem.
  assert.deepEqual(stableGenerationPlan(first), stableGenerationPlan(second));
});

test('cada chunk gera uma plataforma principal e recuperações declaradas', () => {
  const { level, profile } = createPhaseOneLevel();
  const mainPlatforms = level.platforms.filter(platform => !platform.recovery);
  const recoveryCount = level.debugInfo.reduce((sum, chunk) => sum + chunk.recoveryRoots, 0);

  assert.equal(level.debugInfo.length, profile.totalChunks);
  assert.equal(mainPlatforms.length, profile.totalChunks + 1, 'início + uma plataforma principal por chunk');
  assert.equal(
    level.platforms.length,
    1 + profile.totalChunks + recoveryCount,
    'total deve incluir início, chunks e raízes de recuperação condicionais',
  );
});

test('todas as plataformas geradas têm geometria válida', () => {
  const { level } = createPhaseOneLevel();
  assert.equal(level.platforms.every(platform => (
    platform
      && Number.isFinite(platform.x)
      && Number.isFinite(platform.y)
      && platform.w > 0
      && platform.h > 0
  )), true);
});
