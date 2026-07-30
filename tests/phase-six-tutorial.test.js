import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { getPersistentUnlocksBeforePhase, getPhaseManifest } from '../src/procgen/campaign-manifest.js';
import {
  campaignPhaseSeed,
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { generateLevel } from '../src/procgen/generator.js';
import { createTutorialFlow } from '../src/procgen/tutorial-flow.js';
import {
  applyPhaseSixTutorialEncounters,
  applyPhaseSixTutorialGeometry,
} from '../src/procgen/phase-six-tutorial.js';

function buildPhaseSix(seed = 'phase-six-tutorial') {
  const campaign = createCampaign(seed);
  campaign.phase = 6;
  Object.assign(campaign.unlocks, getPersistentUnlocksBeforePhase(6));
  const profile = prepareCampaignGeneration(campaign);
  const seedValue = campaignPhaseSeed(campaign);
  const rawLevel = generateLevel(seedValue);
  applyPhaseSixTutorialGeometry(rawLevel, 6);
  const level = decorateCampaignLevel(rawLevel, campaign, profile);
  const encounters = applyPhaseSixTutorialEncounters(
    level,
    generateCampaignEncounters({ platforms: level.platforms, phase: 6, seedValue }),
    6,
  );
  return { level, encounters };
}

test('Fase 6 apresenta Rhizoctonia, Trichoderma e somente depois micoparasitismo', () => {
  const manifest = getPhaseManifest(6);
  const opening = manifest.presentations.slice(0, 3);
  assert.deepEqual(opening.map(item => item.id), [
    'presentation-root-health',
    'presentation-trichoderma',
    'presentation-mycoparasitism',
  ]);
  assert.ok(opening[0].debutChunk < opening[1].debutChunk);
  assert.ok(opening[1].debutChunk < opening[2].debutChunk);
  assert.deepEqual(opening[2].prerequisitePresentationIds, [
    'presentation-root-health',
    'presentation-trichoderma',
  ]);
  assert.equal(manifest.segments.find(segment => segment.id === 'p6-rhizo-practice').from, 11);
});

test('cartão de micoparasitismo exige os dois organismos e abre no início da interação', () => {
  const flow = createTutorialFlow();
  const encounter = (phase, chunkIndex, worldX) => ({
    tutorialMode: 'guided',
    source: 'first-proximity-encounter',
    phase,
    chunkIndex,
    worldX,
    visibleWorldWidth: 1000,
    nowSeconds: chunkIndex + 1,
  });
  const guided = (chunkIndex, worldX) => ({
    tutorialMode: 'guided',
    phase: 6,
    chunkIndex,
    worldX,
    visibleWorldWidth: 1000,
    nowSeconds: chunkIndex + 2,
  });

  const rhizoctonia = flow.handle('organism-rhizoctonia', encounter(6, 1, 500));
  assert.equal(rhizoctonia.open, true);
  flow.markSeen(rhizoctonia.cardId);

  const premature = flow.handle('process-mycoparasitism', guided(2, 800));
  assert.equal(premature.reason, 'prerequisite');

  const trichoderma = flow.handle('organism-trichoderma', encounter(6, 3, 1010));
  assert.equal(trichoderma.open, true);
  flow.markSeen(trichoderma.cardId);

  const interaction = flow.handle('process-mycoparasitism', guided(3, 1010));
  assert.equal(interaction.open, true);
  assert.equal(interaction.reason, 'event-immediate');
  assert.equal(interaction.cardId, 'process-mycoparasitism');
});

test('abertura fixa garante lesão, exsudato e estreia separada de Trichoderma', () => {
  for (let index = 0; index < 12; index++) {
    const { level, encounters } = buildPhaseSix(`phase-six-${index}`);
    const enemy = level.enemies.find(item => item.debut && item.type === 'rhizoctonia');
    const trichoderma = encounters.find(item => item.source === 'debut' && item.id === 'trichoderma');
    const exudates = level.exudates.filter(item => item.authoredPhaseSixIntro);
    const host = level.platforms.find(platform => platform.logicIndex === 1 && !platform.recovery);

    assert.ok(enemy && trichoderma && host);
    assert.equal(enemy.logicIndex, 1);
    assert.equal(host.type, 'root');
    assert.deepEqual(exudates.map(item => item.logicIndex), [2]);
    assert.deepEqual(
      encounters.filter(item => item.logicIndex < 11).map(item => [item.id, item.logicIndex, item.source]),
      [['trichoderma', 3, 'debut']],
    );

    const enemyCenter = enemy.x + enemy.w / 2;
    const separation = Math.abs(trichoderma.x - enemyCenter);
    assert.ok(separation > 490, 'os dois cartões não podem entrar juntos no raio de proximidade');
    assert.ok(separation <= 640, 'a colônia inoculada deve alcançar o foco com a mecânica real');
  }
});

test('rota inicial é simples e a intervenção não altera o restante da fase', () => {
  const campaign = createCampaign('phase-six-rest-preserved');
  campaign.phase = 6;
  Object.assign(campaign.unlocks, getPersistentUnlocksBeforePhase(6));
  prepareCampaignGeneration(campaign);
  const raw = generateLevel(campaignPhaseSeed(campaign));
  const laterBefore = structuredClone({
    platforms: raw.platforms.filter(item => item.logicIndex >= 11),
    enemies: raw.enemies.filter(item => item.logicIndex >= 11),
    exudates: raw.exudates.filter(item => item.logicIndex >= 11),
  });

  applyPhaseSixTutorialGeometry(raw, 6);
  const intro = [0, 1, 2, 3].map(chunk => raw.platforms.find(item => (
    item.logicIndex === chunk && !item.recovery
  )));
  for (let index = 1; index < intro.length; index++) {
    const gap = intro[index].x - (intro[index - 1].x + intro[index - 1].w);
    assert.equal(gap, 72);
    assert.ok(Math.abs(intro[index].y - intro[index - 1].y) <= 12);
  }
  assert.deepEqual({
    platforms: raw.platforms.filter(item => item.logicIndex >= 11),
    enemies: raw.enemies.filter(item => item.logicIndex >= 11),
    exudates: raw.exudates.filter(item => item.logicIndex >= 11),
  }, laterBefore);
});

test('composição da abertura é determinística pela seed', () => {
  const snapshot = ({ level, encounters }) => ({
    route: level.platforms
      .filter(item => item.authoredPhaseSixIntro)
      .map(item => ({
        logicIndex: item.logicIndex,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        type: item.type,
      })),
    enemies: level.enemies
      .filter(item => item.logicIndex < 11)
      .map(item => ({
        logicIndex: item.logicIndex,
        x: item.x,
        y: item.y,
        type: item.type,
        debut: item.debut,
      })),
    exudates: level.exudates
      .filter(item => item.authoredPhaseSixIntro)
      .map(item => ({ logicIndex: item.logicIndex, x: item.x, y: item.y })),
    encounters: encounters
      .filter(item => item.logicIndex < 11)
      .map(item => ({
        id: item.id,
        logicIndex: item.logicIndex,
        x: item.x,
        y: item.y,
        source: item.source,
      })),
  });
  assert.deepEqual(
    snapshot(buildPhaseSix('same-phase-six')),
    snapshot(buildPhaseSix('same-phase-six')),
  );
});
