import assert from 'node:assert/strict';
import test from 'node:test';

import { createRhizosphereBackdrop } from '../src/render/rhizosphere-backdrop.js';
import { createRouteAnchorRegistry } from '../src/procgen/route-geometry.js';
import { generateLevel } from '../src/procgen/generator.js';
import {
  createCampaign,
  prepareCampaignGeneration,
  campaignPhaseSeed,
} from '../src/procgen/campaign-progression.js';
import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { getChunkAnchorPlatform } from '../src/procgen/traversal-route.js';
import { applyPhaseFiveTutorialGeometry } from '../src/procgen/phase-five-tutorial.js';

function spyCtx() {
  const fillRects = [];
  const ctx = new Proxy({
    fillRect: (x, y, w, h) => fillRects.push({ x, y, w, h }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] || (() => {}) });
  return { ctx, fillRects };
}

function fakeImage() {
  return {
    naturalWidth: 1024, naturalHeight: 1024, width: 1024, height: 1024,
    complete: true, decoding: '', src: '',
  };
}

// ============================================================
// A. O fundo screen-anchored (veu do backdrop) cobre o viewport
//    inteiro desde x=0, mesmo com cameraX > 0. Antes ancorava em
//    cameraX e deixava a faixa [0, cameraX] descoberta a esquerda —
//    onde o quadro anterior sobrevivia como fantasma.
// ============================================================
test('A: o veu do backdrop cobre o viewport desde x=0 com cameraX > 0', () => {
  const backdrop = createRhizosphereBackdrop({ createImage: fakeImage });
  const { ctx, fillRects } = spyCtx();
  backdrop.render(ctx, { cameraX: 640, cameraY: 30, zoom: 1.45 }, { width: 1280, height: 720 });
  const veil = fillRects.find(rect => rect.w >= 600);
  assert.ok(veil, 'o veu deveria desenhar um retangulo cobrindo o viewport');
  assert.equal(veil.x, 0, 'o veu deve comecar em x=0, nao em cameraX');
});

// ============================================================
// B. O anchor registry move checkpoint e exsudato junto com a
//    plataforma quando ela e reposicionada entre capture e
//    synchronize (o que a geometria autoral das fases 5/6 faz).
//    So move referencias existentes; nao ressuscita removidas.
// ============================================================
test('B: mover a plataforma apos capture leva checkpoint e exsudato junto (offset preservado)', () => {
  const platform = { id: 'p1', logicIndex: 3, x: 1000, y: 400, w: 200, h: 64, type: 'root' };
  const checkpoint = { x: 1080, y: 372, platform };   // offset (+80, -28)
  const exudate = { logicIndex: 3, x: 1100, y: 366 };  // offset (+100, -34), casa por logicIndex
  const level = { platforms: [platform], checkpoints: [checkpoint], exudates: [exudate] };

  const anchors = createRouteAnchorRegistry(level);
  anchors.capture();
  platform.x = 1400;
  platform.y = -180; // geometria autoral sobe a plataforma para Y negativo
  anchors.synchronize();

  assert.equal(checkpoint.x, 1480, 'checkpoint segue a plataforma no X');
  assert.equal(checkpoint.y, -208, 'checkpoint preserva o offset vertical (-28)');
  assert.equal(exudate.x, 1500, 'exsudato segue a plataforma no X');
  assert.equal(exudate.y, -214, 'exsudato preserva o offset vertical (-34)');
});

test('B2: synchronize nao ressuscita entidade cuja plataforma sumiu', () => {
  const platform = { id: 'p1', logicIndex: 3, x: 1000, y: 400, w: 200, h: 64, type: 'root' };
  const exudate = { logicIndex: 3, x: 1100, y: 366 };
  const level = { platforms: [platform], checkpoints: [], exudates: [exudate] };
  const anchors = createRouteAnchorRegistry(level);
  anchors.capture();
  level.platforms = []; // plataforma removida do nivel
  assert.doesNotThrow(() => anchors.synchronize());
  assert.equal(level.platforms.length, 0, 'nenhuma plataforma reinserida');
});

// ============================================================
// C. addExudate (fase 5) reposiciona um exsudato preexistente no
//    mesmo chunk em vez de retornar cedo e conservar x/y antigos.
// ============================================================
test('C: exsudato preexistente no chunk do tutorial e reposicionado na plataforma atual', () => {
  const platforms = [];
  for (let i = 0; i <= 19; i++) {
    platforms.push({ logicIndex: i, x: 300 + i * 240, y: 400, w: 200, h: 64, type: 'root' });
  }
  const staleExudate = { logicIndex: 7, x: 99999, y: 99999, taken: false };
  const level = { campaignPhase: 5, platforms, exudates: [staleExudate] };

  applyPhaseFiveTutorialGeometry(level, 5);

  const p7 = platforms.find(p => p.logicIndex === 7);
  assert.notEqual(staleExudate.x, 99999, 'x antigo nao pode sobreviver');
  assert.ok(Math.abs(staleExudate.x - (p7.x + p7.w * .55)) < 1, 'x reposicionado na plataforma atual');
  assert.ok(Math.abs(staleExudate.y - (p7.y - 34)) < 1, 'y reposicionado acima da plataforma atual');
  // nao duplica: continua havendo um unico exsudato no chunk 7
  assert.equal(level.exudates.filter(e => e.logicIndex === 7).length, 1);
});

// ============================================================
// D. Encounter de micorriza (fase, chunk 3) acompanha uma
//    plataforma em Y negativo/elevada, sem clamp de screen-space
//    em y>=95 (que separava o esporo do micelio na raiz).
// ============================================================
test('D: encounter de micorriza acompanha plataforma alta, sem clamp em y=95', () => {
  const camp = createCampaign('graphic-reg-d');
  camp.phase = 4;
  prepareCampaignGeneration(camp);
  const level = generateLevel(campaignPhaseSeed(camp));
  const p3 = getChunkAnchorPlatform(level, 3);
  assert.ok(p3, 'plataforma do chunk 3 existe');
  p3.y = -220; // rota alta / Y negativo

  const encounters = generateCampaignEncounters({
    platforms: level.platforms,
    phase: 4,
    seedValue: camp.seed,
  });
  const myco = encounters.find(entry => entry.id === 'myco');
  assert.ok(myco, 'ha um encounter de micorriza na fase 4');
  assert.ok(
    myco.y < 0,
    `myco.y=${myco.y} deveria acompanhar a plataforma alta (negativo), nao ficar preso em y>=95`,
  );
});
