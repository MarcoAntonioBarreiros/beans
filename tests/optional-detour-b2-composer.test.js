import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { generateLevel } from '../src/procgen/generator.js';
import { createPhaseTenOptionalDetour } from '../src/procgen/optional-detour-composer.js';
import { applySignatureChallenge } from '../src/procgen/signature-challenge.js';

const ABILITIES = Object.freeze([
  'doubleJump',
  'dash',
  'phosphateSolubilization',
  'mycorrhizaStructures'
]);

const MATRIX_SEEDS = Object.freeze(Array.from(
  { length: 24 },
  (_, index) => `phase-lab-b2-audit-${index + 1}:fase-10`,
));

function phaseTenGeometry(seed) {
  const campaign = createCampaign(seed.split(':')[0]);
  campaign.phase = 10;
  for (const feature of Object.keys(campaign.unlocks)) {
    campaign.unlocks[feature] = true;
  }
  const profile = prepareCampaignGeneration(campaign);
  let level = generateLevel(seed, {
    referenceScreenWorldWidth: 1280,
    referenceScreenWorldHeight: 720,
    suppressTowerSafeFall: true,
  });
  level.optionalDetourPlaytestMode = true;
  level = decorateCampaignLevel(level, campaign, profile);
  applySignatureChallenge(level, 10);
  return level;
}

test('PARTE T - B2 Composer Integration: 24 seeds determinísticas', () => {
  const stats = {
    totalSeeds: MATRIX_SEEDS.length,
    realCompositions: 0,
    nullDetours: 0,
    fallbacks: 0,
    phosphateCompositions: 0,
    mycorrhizaCompositions: 0,
    combinedCompositions: 0,
    sequenceIds: new Set(),
  };

  for (const seed of MATRIX_SEEDS) {
    const level = phaseTenGeometry(seed);
    const detour = createPhaseTenOptionalDetour({
      level,
      phase: 10,
      seedValue: seed,
      abilities: [...ABILITIES],
    });

    if (!detour) {
      stats.nullDetours++;
      continue;
    }

    if (detour.compositionFallback) {
      stats.fallbacks++;
      continue;
    }

    stats.realCompositions++;
    assert.strictEqual(
      detour.validation.valid,
      true,
      `Seed ${seed} deve ter composição válida`
    );
    assert.strictEqual(
      detour.primaryRouteGeometryHashBefore,
      detour.primaryRouteGeometryHashAfter,
      `Seed ${seed} não deve alterar rota principal`
    );

    const hasPhosphate = detour.selectedSequence.includes('hard-phosphate-gate');
    const hasMycorrhiza = detour.selectedSequence.includes('hard-mycorrhiza-gap');

    if (hasPhosphate) stats.phosphateCompositions++;
    if (hasMycorrhiza) stats.mycorrhizaCompositions++;
    if (hasPhosphate && hasMycorrhiza) stats.combinedCompositions++;

    stats.sequenceIds.add(detour.selectedSequenceId);

    if (hasMycorrhiza) {
      assert.strictEqual(
        detour.mycorrhizaModuleCount,
        1,
        'mycorrhizaModuleCount deve ser 1'
      );
      
      const encs = level.authoredEncounters || [];
      const mycoEncs = encs.filter(e => e.id === 'myco' && e.source === 'optional-detour-authored');
      assert.strictEqual(mycoEncs.length, 1, 'exatamente um authored roaming encounter de myco');
      
      const exudates = level.exudates || [];
      const mycoExudates = exudates.filter(e => e.id && (e.id.includes(':exudate-1:') || e.id.includes(':exudate-2:')));
      assert.ok(mycoExudates.length >= 2, 'pelo menos dois exsudatos do módulo');
      
      const matureColonies = (level.authoredBeneficialColonies || []).filter(c => c.kind === 'mycorrhiza' && c.mature);
      assert.strictEqual(matureColonies.length, 0, 'nenhuma authored mature colony de myco');
      
      const readyBridges = (level.platforms || []).filter(p => p.mycorrhizaStructure && p.ready);
      assert.strictEqual(readyBridges.length, 0, 'nenhuma ponte pronta na geração');

      assert.ok(detour.intentionalGaps && detour.intentionalGaps.length >= 1, 'intentionalGap existe');
      const gap = detour.intentionalGaps[0];
      const invaders = level.platforms.filter(p =>
        p.x < gap.right && (p.x + p.w) > gap.left &&
        p.y > gap.top && (p.y - p.h) < gap.bottom && p.id !== detour.mycorrhizaTargetPlatformId && p.id !== detour.mycorrhizaSourcePlatformId
      );
      // Ignora conectores se eles passarem longe, mas como as bounds devem ser respeitadas,
      // a checagem rigorosa verifica quem está DENTRO da area.
      assert.strictEqual(invaders.length, 0, 'nenhuma plataforma invade o gap');

      assert.ok(detour.mycorrhizaTargetPlatformId, 'preferredMycorrhizaTargetId existe');
      const src = level.platforms.find(p => p.platformId === detour.mycorrhizaSourcePlatformId);
      assert.strictEqual(src.preferredMycorrhizaTargetId, detour.mycorrhizaTargetPlatformId, 'aponta para destino correto');
      assert.strictEqual(src.strictPreferredMycorrhizaTarget, true, 'strictPreferredMycorrhizaTarget === true');
      assert.strictEqual(detour.regularTraversalBlocked, true, 'regularTraversalBlocked === true');
    }
  }

  const level1 = phaseTenGeometry(MATRIX_SEEDS[0]);
  const detour1 = createPhaseTenOptionalDetour({ level: level1, phase: 10, seedValue: MATRIX_SEEDS[0], abilities: [...ABILITIES] });
  const level2 = phaseTenGeometry(MATRIX_SEEDS[0]);
  const detour2 = createPhaseTenOptionalDetour({ level: level2, phase: 10, seedValue: MATRIX_SEEDS[0], abilities: [...ABILITIES] });
  assert.deepEqual(detour1.structuralSignature, detour2.structuralSignature, 'mesma seed produz assinatura idêntica');

  console.log(stats);
  // Transformando Set em Array para log legível
  stats.sequenceIds = Array.from(stats.sequenceIds);
  console.log(JSON.stringify(stats, null, 2));

  assert.ok(stats.realCompositions >= 10, 'pelo menos 10 composições reais');
  assert.ok(stats.phosphateCompositions >= 1, 'pelo menos uma composição com phosphate');
  assert.ok(stats.mycorrhizaCompositions >= 1, 'pelo menos uma composição com mycorrhiza');
  assert.ok(stats.combinedCompositions >= 1, 'pelo menos uma composição com phosphate + mycorrhiza');
  assert.ok(stats.sequenceIds.length >= 4, 'pelo menos quatro sequenceIds distintos');
  
  if (stats.realCompositions > 0) {
      assert.ok(stats.mycorrhizaCompositions > 0, 'falha de regressão do erro se não escolheu mycorrhiza');
  }
});
