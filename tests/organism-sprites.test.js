import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  ORGANISM_SPRITE_SHEETS,
  calculateOrganismSpriteFrame,
  createOrganismSpriteRenderer,
  setOrganismSpriteEnabled,
} from '../src/render/organism-sprites.js';
import {
  MICROBE_MOTION_PROFILES,
  ROAMING_ORGANISM_SPRITE_SIZES,
} from '../src/procgen/microbe-ecology.js';
import { createRhizoctoniaAttackHyphaPath } from '../src/procgen/rhizoctonia-control.js';

const root = path.resolve(import.meta.dirname, '..');

function pngDimensions(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.toString('ascii', 1, 4), 'PNG');
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

test('as nove sheets existem e respeitam a grade de 320x400', () => {
  assert.deepEqual(Object.keys(ORGANISM_SPRITE_SHEETS).sort(), [
    'azospirillum',
    'micorriza',
    'nematoide',
    'oportunista',
    'pseudomonas',
    'ralstonia',
    'rhizobium',
    'rhizoctonia',
    'trichoderma',
  ]);

  for (const [type, sheet] of Object.entries(ORGANISM_SPRITE_SHEETS)) {
    const file = path.join(root, sheet.src);
    assert.ok(fs.existsSync(file), `${type}: asset ausente`);
    assert.deepEqual(pngDimensions(file), {
      width: sheet.frameCount * 320,
      height: 400,
    });
  }
});

test('o frame animado é determinístico e permanece dentro da sheet', () => {
  const a = calculateOrganismSpriteFrame('rhizobium', 1.25, 2);
  const b = calculateOrganismSpriteFrame('rhizobium', 1.25, 2);
  assert.deepEqual(a, b);
  assert.ok(a.frameIndex >= 0 && a.frameIndex < 12);
  assert.equal(a.sourceX, a.frameIndex * 320);

  const myco = calculateOrganismSpriteFrame('micorriza', 8.8, 4);
  assert.ok(myco.frameIndex >= 0 && myco.frameIndex < 24);

  const pseudomonas = calculateOrganismSpriteFrame('pseudomonas', 8.8, 4);
  assert.ok(pseudomonas.frameIndex >= 0 && pseudomonas.frameIndex < 24);
});

test('o renderer usa recorte, âncora e escala sem alterar o estado externo do canvas', () => {
  const drawCalls = [];
  const fakeImage = {
    onload: null,
    onerror: null,
    set src(value) {
      this.currentSrc = value;
      this.onload?.();
    },
  };
  const ctx = {
    globalAlpha: .8,
    save() { drawCalls.push(['save']); },
    restore() { drawCalls.push(['restore']); },
    translate(x, y) { drawCalls.push(['translate', x, y]); },
    rotate(value) { drawCalls.push(['rotate', value]); },
    scale(x, y) { drawCalls.push(['scale', x, y]); },
    drawImage(...args) { drawCalls.push(['drawImage', ...args]); },
  };
  const renderer = createOrganismSpriteRenderer({ imageFactory: () => fakeImage });
  assert.equal(renderer.draw(ctx, 'pseudomonas', {
    x: 120,
    y: 80,
    height: 100,
    time: 1,
    phase: 2,
    alpha: .5,
    flipX: true,
  }), true);

  const call = drawCalls.find(entry => entry[0] === 'drawImage');
  assert.ok(call);
  assert.equal(call[4], 320);
  assert.equal(call[5], 400);
  assert.equal(call[8], 80);
  assert.equal(call[9], 100);
  assert.deepEqual(drawCalls.find(entry => entry[0] === 'scale'), ['scale', -1, 1]);
  assert.equal(ctx.globalAlpha, .4);
  assert.deepEqual(drawCalls.at(-1), ['restore']);
});

test('cada sheet pode ser desligada sem remover o fallback procedural', () => {
  const renderer = createOrganismSpriteRenderer({ imageFactory: () => null });
  setOrganismSpriteEnabled('trichoderma', false);
  assert.equal(renderer.draw({}, 'trichoderma'), false);
  setOrganismSpriteEnabled('trichoderma', true);
  assert.equal(renderer.draw({}, 'trichoderma'), false);
});

test('organismos em roaming ficam pouco menores que o Miguelito', () => {
  for (const type of ['rhizobium', 'azospirillum', 'pseudomonas', 'trichoderma', 'myco']) {
    const renderedHeight = ROAMING_ORGANISM_SPRITE_SIZES[type]
      * MICROBE_MOTION_PROFILES[type].scale;
    assert.ok(renderedHeight >= 64 && renderedHeight <= 65.5, `${type}: ${renderedHeight}px`);
  }

  // A spritesheet do Bacillus usa largura; a proporção média de seus quadros
  // transforma essa largura em aproximadamente 64 px de altura.
  const bacillusWidth = ROAMING_ORGANISM_SPRITE_SIZES.bacillus
    * MICROBE_MOTION_PROFILES.bacillus.scale;
  const bacillusHeight = bacillusWidth * (104 / 63);
  assert.ok(bacillusHeight >= 63 && bacillusHeight <= 65);
});

test('a hifa ofensiva da Rhizoctonia é orgânica, determinística e preserva os extremos', () => {
  const options = {
    startX: 180,
    startY: 410,
    endX: 390,
    endY: 406,
    phase: 1.37,
    charge: .82,
  };
  const first = createRhizoctoniaAttackHyphaPath(options);
  const second = createRhizoctoniaAttackHyphaPath(options);
  assert.deepEqual(first, second);
  assert.deepEqual(first[0], { x: options.startX, y: options.startY });
  assert.deepEqual(first.at(-1), { x: options.endX, y: options.endY });
  assert.ok(first.length > 8);
  assert.ok(first.slice(1, -1).some(point => Math.abs(point.y - options.startY) > 3));
});

test('as hifas são compostas antes das sheets do oportunista e da Rhizoctonia', () => {
  const opportunisticSource = fs.readFileSync(
    path.join(root, 'src/procgen/opportunistic-fungus.js'),
    'utf8',
  );
  const opportunisticDraw = opportunisticSource.slice(
    opportunisticSource.indexOf('function drawNetwork(ctx, network)'),
    opportunisticSource.indexOf('function drawVigorIndicator(ctx, network)'),
  );
  assert.ok(
    opportunisticDraw.indexOf('for (const segment of network.segments)')
      < opportunisticDraw.lastIndexOf('drawFocus(ctx, network, vigor)'),
  );

  const rhizoctoniaSource = fs.readFileSync(
    path.join(root, 'src/procgen/rhizoctonia-control.js'),
    'utf8',
  );
  const rhizoctoniaRender = rhizoctoniaSource.slice(
    rhizoctoniaSource.indexOf('function render(ctx)'),
    rhizoctoniaSource.indexOf('function reset()'),
  );
  assert.ok(
    rhizoctoniaRender.indexOf('drawAttack(ctx, enemy)')
      < rhizoctoniaRender.indexOf('drawRhizoctoniaSprite(ctx, enemy, index)'),
  );
});
