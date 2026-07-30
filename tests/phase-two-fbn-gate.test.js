import assert from 'node:assert/strict';
import test from 'node:test';

import { generateLevel } from '../src/procgen/generator.js';
import { validateChunk } from '../src/procgen/agents.js';
import { generateUnderdevelopedNitrogenRoots } from '../src/procgen/nitrogen-root.js';
import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { getPhaseManifest, setPhaseManifestOverride, clearPhaseManifestOverride } from '../src/procgen/campaign-manifest.js';
import {
  buildPhaseLabManifest, createDefaultPhaseLabConfig, scalePhaseLabSegments,
} from '../src/procgen/phase-lab-config.js';
import {
  campaignPhaseSeed, createCampaign, decorateCampaignLevel, prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';

// Na fase 2 o jogador ainda nao tem salto duplo: o duplo so e liberado no chunk
// 20 da fase 3. Sobra o salto simples, que alcanca cerca de 200px.
const SALTO_SIMPLES = Object.freeze({ id: 'running-jump', requires: [] });

// Abaixo disso a fase nao comporta a cadeia rhizobium -> exsudato -> portao sem
// atropelar um recurso que o jogador precisa. Medido, nao escolhido.
const MENOR_FASE_VIAVEL = 14;

function gera(seedName, totalChunks) {
  const base = createDefaultPhaseLabConfig(2);
  setPhaseManifestOverride(buildPhaseLabManifest({
    ...base,
    totalChunks,
    segments: scalePhaseLabSegments(base.segments, base.totalChunks, totalChunks),
  }));
  const campaign = createCampaign(seedName, { storage: null });
  campaign.phase = 2;
  const profile = prepareCampaignGeneration(campaign);
  const seed = campaignPhaseSeed(campaign);
  let level = generateLevel(seed);
  level = decorateCampaignLevel(level, campaign, profile);
  level.microbeEncounters = generateCampaignEncounters({ platforms: level.platforms, phase: 2, seedValue: seed })
    .concat(level.authoredEncounters || []);
  generateUnderdevelopedNitrogenRoots({
    level,
    phase: 2,
    seedValue: seed,
    encounters: level.microbeEncounters,
    config: getPhaseManifest(2)?.nitrogenRoot,
  });
  return level;
}

test('o portao da FBN aparece em toda seed e em todo tamanho de fase', () => {
  for (const total of [MENOR_FASE_VIAVEL, 16, 18, 20, 30, 40]) {
    for (let s = 0; s < 8; s++) {
      const level = gera(`fbn-${total}-${s}`, total);
      assert.equal(
        (level.nitrogenRoots || []).length, 1,
        `fase de ${total} chunks, seed ${s}: nenhuma raiz dependente de FBN foi criada`,
      );
    }
  }
  clearPhaseManifestOverride();
});

test('o vao do portao da FBN nao se vence com o salto simples', () => {
  // Sem isso a raiz subdesenvolvida vira cenario: o jogador pula por cima e
  // termina a fase sem nunca formar o nodulo.
  for (const total of [MENOR_FASE_VIAVEL, 20, 40]) {
    for (let s = 0; s < 8; s++) {
      const [root] = gera(`fbn-${total}-${s}`, total).nitrogenRoots;
      assert.ok(
        !validateChunk(root.leftPlatform, root.rightPlatform, SALTO_SIMPLES, 'normal'),
        `fase de ${total} chunks, seed ${s}: o vao de ${Math.round(root.blockedGapWidth)}px se vence pulando`,
      );
    }
  }
  clearPhaseManifestOverride();
});

test('o hospedeiro do nodulo vem depois do primeiro exsudato', () => {
  // A ordem de ensino: primeiro o jogador tem exsudato para recrutar, so depois
  // a fase cobra o nodulo. Promover solo a raiz nao pode furar essa ordem.
  for (const total of [MENOR_FASE_VIAVEL, 20, 40]) {
    for (let s = 0; s < 8; s++) {
      const [root] = gera(`fbn-${total}-${s}`, total).nitrogenRoots;
      assert.ok(
        root.hostLogicIndex > root.sourceExudateLogicIndex,
        `fase de ${total} chunks, seed ${s}: hospedeiro no chunk ${root.hostLogicIndex} vem antes do exsudato ${root.sourceExudateLogicIndex}`,
      );
      assert.equal(root.hostPlatform.type, 'root', 'o hospedeiro precisa ser uma raiz colonizavel');
    }
  }
  clearPhaseManifestOverride();
});

test('a promocao de solo a raiz nao apaga recurso nenhum do jogador', () => {
  for (const total of [MENOR_FASE_VIAVEL, 20]) {
    for (let s = 0; s < 8; s++) {
      const level = gera(`fbn-${total}-${s}`, total);
      const [root] = level.nitrogenRoots;
      const dentroDoVao = entity => (
        Number.isFinite(entity?.x)
        && entity.x >= root.leftPlatform.x + root.leftPlatform.w
        && entity.x <= root.rightPlatform.x
      );
      for (const colecao of ['exudates', 'crystals', 'checkpoints']) {
        assert.equal(
          (level[colecao] || []).filter(dentroDoVao).length, 0,
          `fase de ${total} chunks, seed ${s}: ${colecao} ficou pendurado dentro do vao`,
        );
      }
      // O microbe que morava no alvo se muda para o hospedeiro, nao desaparece.
      const orfaos = (level.microbeEncounters || []).filter(dentroDoVao);
      assert.equal(orfaos.length, 0, `encontro sem plataforma no vao (seed ${s})`);
    }
  }
  clearPhaseManifestOverride();
});
