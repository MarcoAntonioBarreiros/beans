import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import {
  getPersistentUnlocksBeforePhase,
  getPhaseManifest,
} from '../src/procgen/campaign-manifest.js';
import {
  campaignPhaseSeed,
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import {
  auditTraversableRoute,
  generateLevel,
} from '../src/procgen/generator.js';
import {
  createNitrogenRootDevelopment,
  generateUnderdevelopedNitrogenRoots,
  nitrogenRootVisualBounds,
} from '../src/procgen/nitrogen-root.js';
import {
  createRouteAnchorRegistry,
  recordRouteGeometryStage,
  resolveEntityPlatform,
} from '../src/procgen/route-geometry.js';
import { applySignatureChallenge } from '../src/procgen/signature-challenge.js';
import { generateAzospirillumRootLadders } from '../src/procgen/azospirillum-root-growth.js';

const SEED = 'geometry-phase-three';
const STAGES = [
  'generateLevel',
  'decorateCampaignLevel',
  'applySignatureChallenge',
  'generateAzospirillumRootLadders',
  'generateUnderdevelopedNitrogenRoots',
  'auditTraversableRoute',
];

function route(level) {
  return (level.platforms || [])
    .filter(platform => (
      !platform.recovery
      && !platform.final
      && Number.isInteger(platform.logicIndex)
    ))
    .sort((left, right) => left.logicIndex - right.logicIndex || left.x - right.x);
}

function snapshotByStage(level, stage) {
  return new Map(
    level.routeGeometryTrace
      .find(entry => entry.stage === stage)
      .platforms
      .map(platform => [platform.logicIndex, platform]),
  );
}

// Esta e a mesma sequencia de prepareLevel(), sem Phase Lab e sem inicializar
// DOM/canvas. Os geradores, manifesto, seed de campanha e ordem sao os reais.
function prepareRealPhaseThree({ injectLogicAnchoredEntity = false } = {}) {
  const campaign = createCampaign(SEED, { storage: null });
  campaign.phase = 3;
  Object.assign(campaign.unlocks, getPersistentUnlocksBeforePhase(3));
  const profile = prepareCampaignGeneration(campaign);
  const seedValue = campaignPhaseSeed(campaign);

  let level = generateLevel(seedValue);
  recordRouteGeometryStage(level, 'generateLevel');
  level = decorateCampaignLevel(level, campaign, profile);
  recordRouteGeometryStage(level, 'decorateCampaignLevel');

  const beforeRoots = new Map((level.roots || []).map(root => [
    root,
    { x: root.x, y: root.y },
  ]));
  let outsideEntity = null;
  if (injectLogicAnchoredEntity) {
    outsideEntity = {
      logicIndex: 17,
      x: -900,
      y: route(level).find(platform => platform.logicIndex === 17).y - 31,
      taken: false,
      geometryTestEntity: true,
    };
    level.exudates.push(outsideEntity);
  }

  const anchors = createRouteAnchorRegistry(level);
  anchors.capture();
  applySignatureChallenge(level, campaign.phase);
  recordRouteGeometryStage(level, 'applySignatureChallenge');

  level.microbeEncounters = generateCampaignEncounters({
    platforms: level.platforms,
    phase: campaign.phase,
    seedValue,
  }).concat(level.authoredEncounters || []);

  generateAzospirillumRootLadders({
    level,
    phase: campaign.phase,
    seedValue,
    encounters: level.microbeEncounters,
    config: getPhaseManifest(campaign.phase).azospirillumRootLadder,
  });
  recordRouteGeometryStage(level, 'generateAzospirillumRootLadders');

  generateUnderdevelopedNitrogenRoots({
    level,
    phase: campaign.phase,
    seedValue,
    encounters: level.microbeEncounters,
    config: getPhaseManifest(campaign.phase).nitrogenRoot,
  });
  recordRouteGeometryStage(level, 'generateUnderdevelopedNitrogenRoots');

  auditTraversableRoute(level, {
    doubleJump: Boolean(campaign.unlocks.doubleJump),
    dash: Boolean(campaign.unlocks.dash),
  });
  recordRouteGeometryStage(level, 'auditTraversableRoute');
  anchors.capture();
  anchors.synchronize();

  return { level, campaign, anchors, beforeRoots, outsideEntity };
}

test('pipeline real registra todas as etapas e preserva o desafio de 230 px', () => {
  const { level } = prepareRealPhaseThree();
  assert.deepEqual(level.routeGeometryTrace.map(entry => entry.stage), STAGES);
  assert.ok(level.signatureChallenge, 'o desafio-assinatura precisa existir');
  assert.equal(level.signatureChallenge.rise, 230);
  assert.ok(level.azospirillumRootLadders.length > 0, 'o pipeline precisa incluir Azo');
  assert.ok(level.nitrogenRoots.length > 0, 'o pipeline precisa incluir a raiz nitrogenada');

  const finalRoute = route(level);
  const target = finalRoute.find(platform => platform.signatureChallenge);
  const previous = finalRoute.find(platform => platform.logicIndex === target.logicIndex - 1);
  assert.equal(previous.y - target.y, 230);
});

test('Azo nao altera y da rota e nao cria queda artificial depois do desafio', () => {
  const { level } = prepareRealPhaseThree();
  const afterSignature = snapshotByStage(level, 'applySignatureChallenge');
  const afterAzo = snapshotByStage(level, 'generateAzospirillumRootLadders');
  for (const [logicIndex, platform] of afterSignature) {
    assert.equal(
      afterAzo.get(logicIndex)?.y,
      platform.y,
      `logicIndex ${logicIndex} mudou de y depois do desafio`,
    );
  }
  for (const ladder of level.azospirillumRootLadders) {
    assert.equal(ladder.destination.y, ladder.originalDestinationY);
  }

  const challenge = level.signatureChallenge;
  const signature = snapshotByStage(level, 'applySignatureChallenge');
  const final = snapshotByStage(level, 'auditTraversableRoute');
  const targetAtSignature = signature.get(challenge.chunk);
  const nextAtSignature = signature.get(challenge.chunk + 1);
  const targetAtEnd = final.get(challenge.chunk);
  const nextAtEnd = final.get(challenge.chunk + 1);
  assert.equal(targetAtEnd.y, targetAtSignature.y);
  assert.equal(nextAtEnd.y, nextAtSignature.y);
  assert.equal(nextAtEnd.y - targetAtEnd.y, nextAtSignature.y - targetAtSignature.y);
});

test('nenhuma plataforma normal restante muda de y apos applySignatureChallenge', () => {
  const { level } = prepareRealPhaseThree();
  const signature = snapshotByStage(level, 'applySignatureChallenge');
  for (const stage of [
    'generateAzospirillumRootLadders',
    'generateUnderdevelopedNitrogenRoots',
    'auditTraversableRoute',
  ]) {
    const current = snapshotByStage(level, stage);
    for (const [logicIndex, platform] of current) {
      if (!signature.has(logicIndex)) continue;
      assert.equal(
        platform.y,
        signature.get(logicIndex).y,
        `${stage}: logicIndex ${logicIndex} sofreu uma segunda alteracao vertical`,
      );
    }
  }
});

test('checkpoints e exsudatos mantem o offset da plataforma apos a sincronizacao unica', () => {
  const { level, anchors } = prepareRealPhaseThree();
  const checked = { checkpoints: 0, exudates: 0 };
  for (const [entity, anchor] of anchors.anchors) {
    if (!(anchor.name in checked)) continue;
    const platform = resolveEntityPlatform(level, entity);
    assert.ok(platform, `${anchor.name} sem plataforma`);
    assert.equal(entity.y, platform.y + anchor.offsetY);
    assert.equal(entity.x, platform.x + anchor.offsetX);
    checked[anchor.name]++;
  }
  assert.ok(checked.checkpoints > 0, 'a seed deve exercitar checkpoint');
  assert.ok(checked.exudates > 0, 'a seed deve exercitar exsudato');
});

test('logicIndex ancora a entidade mesmo com x fora da largura da plataforma', () => {
  const { level, anchors, outsideEntity } = prepareRealPhaseThree({
    injectLogicAnchoredEntity: true,
  });
  const anchor = anchors.anchors.get(outsideEntity);
  const platform = route(level).find(item => item.logicIndex === outsideEntity.logicIndex);
  assert.ok(anchor);
  assert.equal(anchor.platform, platform);
  assert.equal(outsideEntity.y, platform.y + anchor.offsetY);
  assert.equal(outsideEntity.x, platform.x + anchor.offsetX);
});

test('sincronizacao horizontal preserva os limites de patrulha do inimigo', () => {
  const platform = { id: 'route-4', logicIndex: 4, x: 300, y: 480, w: 220, h: 60 };
  const enemy = {
    platformId: 'route-4',
    logicIndex: 4,
    x: 360,
    y: 430,
    left: 320,
    right: 470,
  };
  const level = { platforms: [platform], enemies: [enemy] };
  const anchors = createRouteAnchorRegistry(level);
  anchors.capture();
  platform.x += 90;
  platform.y -= 40;
  anchors.synchronize();
  assert.equal(enemy.x, 450);
  assert.equal(enemy.y, 390);
  assert.equal(enemy.left, 410);
  assert.equal(enemy.right, 560);
});

test('raizes decorativas acompanham o trecho deslocado pelo desafio', () => {
  const { level, beforeRoots } = prepareRealPhaseThree();
  const before = snapshotByStage(level, 'decorateCampaignLevel');
  const after = snapshotByStage(level, 'applySignatureChallenge');
  const challengeIndex = level.signatureChallenge.chunk;
  const fromX = before.get(challengeIndex).x;
  const deltaY = after.get(challengeIndex).y - before.get(challengeIndex).y;
  const shifted = [...beforeRoots].filter(([, position]) => position.x >= fromX);
  assert.ok(shifted.length > 0);
  for (const [root, position] of shifted) {
    assert.equal(root.x, position.x);
    assert.equal(root.y, position.y + deltaY);
  }
});

test('raiz nitrogenada e colisor usam geometria continua e numericamente identica no fim', () => {
  const host = { x: 100, y: 500, w: 200, h: 60, type: 'root', logicIndex: 3 };
  const target = { x: 420, y: 360, w: 210, h: 58, type: 'root', logicIndex: 4 };
  const root = {
    id: 'nitrogen-transition',
    hostPlatform: host,
    targetPlatform: target,
    targetLogicIndex: target.logicIndex,
    x: target.x,
    y: target.y,
    rootBaseY: target.y,
    startWidth: 72,
    startHeight: 12,
    targetWidth: target.w,
    targetHeight: target.h,
    currentWidth: 0,
    currentHeight: 0,
    progress: .999,
    functionalProgress: 0,
    stage: 'growing',
    developed: false,
    requiredFixationRate: .05,
    growthDurationSeconds: 1,
    collider: null,
    phase: 0,
  };
  const site = {
    platform: host,
    mature: true,
    stage: 'mature-nodule',
    fixationRate: .05,
    x: 170,
    surfaceY: host.y,
    depth: 20,
  };
  const state = {
    gameState: 'play',
    time: 0,
    cameraX: 0,
    level: {
      platforms: [host],
      nitrogenRoots: [root],
      rhizobiumNodules: [site],
    },
  };
  const before = nitrogenRootVisualBounds(root, .999);
  const finalVisual = nitrogenRootVisualBounds(root, 1);
  assert.equal(before.x, finalVisual.x);
  assert.equal(before.y, finalVisual.y);
  assert.ok(Math.abs(before.w - finalVisual.w) < 1);
  assert.ok(Math.abs(before.h - finalVisual.h) < 1);

  const runtime = createNitrogenRootDevelopment({ state });
  runtime.update(.001);
  assert.equal(root.progress, 1);
  assert.ok(root.collider);
  for (const key of ['x', 'y', 'w', 'h', 'rootBaseY']) {
    assert.equal(root.collider[key], finalVisual[key], `${key} visual/colisor divergente`);
  }
});
