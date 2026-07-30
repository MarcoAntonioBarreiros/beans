import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createNecroticZone } from '../src/render/necrotic-zone.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createRecordingContext() {
  const coordinates = [];
  const record = (...values) => {
    coordinates.push(...values.filter(value => typeof value === 'number'));
  };
  const gradient = { addColorStop: (offset) => record(offset) };
  return {
    coordinates,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    fill() {},
    stroke() {},
    moveTo: record,
    lineTo: record,
    quadraticCurveTo: record,
    bezierCurveTo: record,
    ellipse: record,
    createLinearGradient(...args) {
      record(...args);
      return gradient;
    },
    set globalAlpha(_value) {},
    set fillStyle(_value) {},
    set strokeStyle(_value) {},
    set lineWidth(_value) {},
    set lineCap(_value) {},
  };
}

test('a Zona Necrótica cobre a largura visível com overscan em todos os formatos-alvo', () => {
  const formats = [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [844, 390],
    [667, 340],
  ];
  const zone = createNecroticZone();
  const ctx = createRecordingContext();

  for (const [width, height] of formats) {
    zone.render(ctx, {
      cameraX: 730,
      cameraY: 120,
      zoom: 1,
      viewportWidth: width,
      viewportHeight: height,
      top: 674,
      bottom: 720,
    });
    const bounds = zone.diagnostics().lastBounds;
    assert.ok(bounds.left < 730, `${width}x${height}: faltou overscan à esquerda`);
    assert.ok(bounds.right > 730 + width, `${width}x${height}: faltou overscan à direita`);
    assert.ok(bounds.bottom >= 120 + height, `${width}x${height}: não cobriu o fundo visível`);
  }
});

test('partículas são limitadas, determinísticas e reutilizadas entre quadros', () => {
  const first = createNecroticZone({ seed: 123 });
  const second = createNecroticZone({ seed: 123 });
  const pool = first.diagnostics().poolIdentity;

  first.update(1 / 60);
  first.update(1 / 60);
  second.update(2 / 60);

  assert.equal(first.diagnostics().particleCount, 42);
  assert.equal(first.diagnostics().hyphaCount, 7);
  assert.equal(first.diagnostics().poolIdentity, pool);
  assert.deepEqual(first.diagnostics().poolIdentity, second.diagnostics().poolIdentity);
});

test('pausa não avança a animação e todas as coordenadas renderizadas são finitas', () => {
  const zone = createNecroticZone();
  const ctx = createRecordingContext();
  zone.update(0);
  assert.equal(zone.diagnostics().elapsed, 0);
  zone.render(ctx, {
    cameraX: Number.NaN,
    cameraY: Number.NaN,
    zoom: Number.NaN,
    viewportWidth: 1280,
    viewportHeight: 720,
    top: 674,
    bottom: 720,
  });
  assert.ok(ctx.coordinates.length > 100);
  assert.ok(ctx.coordinates.every(Number.isFinite));
});

test('componente visual não expõe colisores nem recebe ou altera estado de jogo', () => {
  const zone = createNecroticZone();
  const apiKeys = Object.keys(zone).sort();
  const source = fs.readFileSync(path.join(root, 'src/render/necrotic-zone.js'), 'utf8');

  assert.deepEqual(apiKeys, ['diagnostics', 'render', 'setEnabled', 'update']);
  assert.doesNotMatch(source, /\bplayer\b|\bplatforms?\b|\bhazards?\b|\bcollid(?:e|er|ers|ing)\b/i);
  assert.doesNotMatch(source, /\bHUD\b|\bobjectives?\b|\brespawn\b|\bvitality\b/i);
});

test('renderizador não desenha mais triângulos e conserva os hazards somente para limites visuais', () => {
  const renderer = fs.readFileSync(path.join(root, 'src/render/renderer.js'), 'utf8');
  assert.match(renderer, /createNecroticZone/);
  assert.match(renderer, /for \(const hazard of level\.hazards\)/);
  assert.doesNotMatch(renderer, /level\.hazards\.forEach/);
  assert.doesNotMatch(renderer, /h\.x \+ i \+ 9/);
});

test('limites de morte e colisão hostil permanecem exatamente no sistema físico', () => {
  const physics = fs.readFileSync(path.join(root, 'src/physics.js'), 'utf8');
  assert.match(
    physics,
    /player\.y > 760 \|\| level\.hazards\.some\(h => rects\(player, h\)\)/,
  );
  assert.match(
    physics,
    /damagePlayer\?\.\(player\.maxVitality \|\| 5, 'queda na zona hostil', \{ fatal: true, invuln: 0 \}\)/,
  );
});
