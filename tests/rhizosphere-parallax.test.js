import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BIOLOGICAL_PARALLAX_KEY,
  calculateFilamentGeometry,
  createRhizosphereParallax,
  RHIZOSPHERE_PARALLAX_FACTORS,
} from '../src/render/rhizosphere-parallax.js';
import {
  calculateBackdropTiles,
  createRhizosphereBackdrop,
} from '../src/render/rhizosphere-backdrop.js';

class MockGradient {
  addColorStop() {}
}

class MockContext {
  constructor() {
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.filter = 'none';
    this.shadowBlur = 0;
    this.shadowColor = 'transparent';
    this.lineWidth = 1;
    this.lineCap = 'butt';
    this.drawImageCount = 0;
    this.drawImageArgs = [];
    this.fillRectArgs = [];
    this.arcCount = 0;
    this.stack = [];
    this.transformDepth = 0;
  }

  save() {
    this.stack.push({
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      filter: this.filter,
      shadowBlur: this.shadowBlur,
      shadowColor: this.shadowColor,
      transformDepth: this.transformDepth,
    });
  }

  restore() {
    const state = this.stack.pop();
    assert.ok(state, 'restore sem save correspondente');
    Object.assign(this, state);
  }

  createLinearGradient() { return new MockGradient(); }
  clearRect() {}
  fillRect(...args) { this.fillRectArgs.push(args); }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  ellipse() {}
  fill() {}
  stroke() {}
  rotate() {}
  scale() {}
  setLineDash() {}
  translate() { this.transformDepth++; }
  arc() { this.arcCount++; }
  drawImage(...args) {
    this.drawImageCount++;
    this.drawImageArgs.push(args);
  }
}

function createMockCanvasFactory() {
  return () => ({
    width: 0,
    height: 0,
    context: new MockContext(),
    getContext() { return this.context; },
  });
}

function createComponent(seed = 'parallax-test') {
  return createRhizosphereParallax({
    seed,
    createCanvas: createMockCanvasFactory(),
  });
}

test('paralaxe começa ativo e toggle suspende update e render', () => {
  const component = createComponent();
  const ctx = new MockContext();
  const camera = { cameraX: 200, cameraY: 30, zoom: 1.45 };
  const player = { x: 10, y: 20, onGround: false };

  assert.equal(component.enabled, true);
  component.update(0.016, camera, player);
  component.render(ctx, camera, { width: 1280, height: 720 });
  const beforeDisable = component.diagnostics();
  assert.ok(beforeDisable.stats.updateCount > 0);
  assert.ok(beforeDisable.stats.renderCount > 0);
  assert.ok(ctx.drawImageCount > 0);

  assert.equal(component.toggle(), false);
  assert.equal(component.enabled, false);
  const draws = ctx.drawImageCount;
  component.update(0.1, camera, player);
  component.render(ctx, camera, { width: 1280, height: 720 });
  const disabled = component.diagnostics();
  assert.equal(disabled.elapsed, beforeDisable.elapsed);
  assert.equal(disabled.stats.updateCount, beforeDisable.stats.updateCount);
  assert.equal(disabled.stats.renderCount, beforeDisable.stats.renderCount);
  assert.equal(ctx.drawImageCount, draws);

  assert.equal(component.toggle(), true);
  component.update(0.016, camera, player);
  component.render(ctx, camera, { width: 1280, height: 720 });
  assert.ok(component.diagnostics().stats.updateCount > disabled.stats.updateCount);
  assert.ok(ctx.drawImageCount > draws);
});

test('componente não modifica câmera nem jogador e só possui objetos decorativos próprios', () => {
  const component = createComponent();
  const camera = { cameraX: 310, cameraY: 74, zoom: 1.3 };
  const player = { x: 250, y: 333, vx: 120, vy: -300, onGround: false };
  const cameraSnapshot = structuredClone(camera);
  const playerSnapshot = structuredClone(player);
  component.update(0.016, camera, player);
  component.render(new MockContext(), camera, { width: 1280, height: 720 });
  assert.deepEqual(camera, cameraSnapshot);
  assert.deepEqual(player, playerSnapshot);
  const source = readFileSync(new URL('../src/render/rhizosphere-parallax.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /collider|hitbox|damage|objective|inoculat|level\.platforms|level\.enemies/i);
});

test('fatores horizontais permanecem abaixo do plano jogável', () => {
  for (const factor of Object.values(RHIZOSPHERE_PARALLAX_FACTORS)) {
    assert.ok(factor > 0);
    assert.ok(factor < 1);
  }
  assert.ok(RHIZOSPHERE_PARALLAX_FACTORS.deep < RHIZOSPHERE_PARALLAX_FACTORS.biology);
  assert.ok(RHIZOSPHERE_PARALLAX_FACTORS.biology < RHIZOSPHERE_PARALLAX_FACTORS.particles);
});

test('resposta vertical é suavizada, limitada e volta ao neutro após pouso', () => {
  const component = createComponent();
  const camera = { cameraX: 0, cameraY: 100, zoom: 1 };
  const player = { onGround: true };
  component.update(0.016, camera, player);

  camera.cameraY = 0;
  player.onGround = false;
  component.update(0.016, camera, player);
  const first = component.diagnostics().vertical;
  assert.ok(first.deep > 0 && first.deep < 6);
  assert.ok(first.biology > first.deep && first.biology < 12);
  assert.ok(first.particles > first.biology && first.particles < 16);

  for (let i = 0; i < 180; i++) component.update(0.016, camera, player);
  const peak = component.diagnostics().vertical;
  assert.ok(Math.abs(peak.deep) <= 6);
  assert.ok(Math.abs(peak.biology) <= 12);
  assert.ok(Math.abs(peak.particles) <= 16);

  camera.cameraY = 100;
  player.onGround = true;
  for (let i = 0; i < 180; i++) component.update(0.016, camera, player);
  const landed = component.diagnostics().vertical;
  assert.ok(Math.abs(landed.deep) < 0.02);
  assert.ok(Math.abs(landed.biology) < 0.02);
  assert.ok(Math.abs(landed.particles) < 0.02);
});

test('resize mantém caches válidos e repetição cobre viewports largos', () => {
  const component = createComponent();
  assert.equal(component.resize(1920, 1080), true);
  const large = component.diagnostics();
  assert.equal(large.width, 1920);
  assert.equal(large.height, 1080);
  assert.ok(large.cacheHeight >= 1080);
  assert.ok(Number.isFinite(large.cacheHeight));

  assert.equal(component.resize(1920, 1080), false);
  assert.equal(component.diagnostics().stats.cacheBuildCount, large.stats.cacheBuildCount);

  const ctx = new MockContext();
  component.render(ctx, { cameraX: 25000, cameraY: 180, zoom: 1 }, { width: 1920, height: 1080 });
  assert.ok(ctx.drawImageCount >= 6, 'cada cache deve repetir além das duas bordas do viewport');
});

test('pool de partículas é fixo, determinístico e não cresce', () => {
  const first = createComponent('same-seed');
  const second = createComponent('same-seed');
  const pool = first.diagnostics().particlePool;
  assert.equal(pool.length, 32);
  assert.deepEqual(pool, second.diagnostics().particlePool);
  for (let i = 0; i < 2000; i++) {
    first.update(0.016, { cameraX: i * 4, cameraY: i % 90, zoom: 1.45 }, { onGround: i % 30 === 0 });
  }
  assert.strictEqual(first.diagnostics().particlePool, pool);
  assert.equal(pool.length, 32);
});

test('wobble usa apenas o cache, é lento e permanece dentro de limites discretos', () => {
  const component = createComponent();
  component.update(0.016, { cameraX: 0, cameraY: 0, zoom: 1 }, { onGround: true });
  const first = component.diagnostics().motion;
  for (let i = 0; i < 600; i++) {
    component.update(0.016, { cameraX: 0, cameraY: 0, zoom: 1 }, { onGround: true });
  }
  const later = component.diagnostics().motion;
  assert.notDeepEqual(later, first);
  assert.ok(Math.abs(later.deep.x) <= 2.2);
  assert.ok(Math.abs(later.deep.y) <= 1.5);
  assert.ok(Math.abs(later.biology.x) <= 9);
  assert.ok(Math.abs(later.biology.y) <= 5.5);
  assert.ok(Math.abs(later.biology.rotation) <= 0.008);
  assert.ok(later.biology.scale >= 0.995 && later.biology.scale <= 1.005);
  assert.equal(component.diagnostics().stats.cacheBuildCount, 0);
});

test('filamentos profundos oscilam com base inferior fixa e topo livre', () => {
  const component = createComponent('underwater-filaments');
  component.resize(1280, 720);
  const filament = component.diagnostics().deepFilamentPool[0];
  const first = calculateFilamentGeometry(filament, 0, 1);
  const later = calculateFilamentGeometry(filament, 2.3, 1);

  assert.deepEqual(later.end, first.end, 'a base inferior do filamento deve permanecer ancorada');
  assert.notDeepEqual(later.start, first.start, 'a extremidade superior deve oscilar ao longo do tempo');
  const lowerControlMovement = Math.abs(later.controlTwo.x - first.controlTwo.x);
  const tipMovement = Math.abs(later.start.x - first.start.x);
  assert.ok(tipMovement > lowerControlMovement, 'a flexão deve aumentar em direção ao topo');
  assert.ok(tipMovement <= filament.amplitude * 2 + 1e-9);
});

test('filamentos são determinísticos pela seed e movimento reduzido limita a oscilação', () => {
  const normal = createRhizosphereParallax({
    seed: 'same-underwater-seed',
    createCanvas: createMockCanvasFactory(),
    reducedMotion: false,
  });
  const reduced = createRhizosphereParallax({
    seed: 'same-underwater-seed',
    createCanvas: createMockCanvasFactory(),
    reducedMotion: true,
  });
  normal.resize(1280, 720);
  reduced.resize(1280, 720);
  const normalDiagnostics = normal.diagnostics();
  const reducedDiagnostics = reduced.diagnostics();

  assert.deepEqual(
    normalDiagnostics.deepFilamentPool,
    reducedDiagnostics.deepFilamentPool,
    'a composição deve depender somente da seed',
  );
  assert.equal(normalDiagnostics.stats.deepFilamentCount, 7);
  assert.equal(reducedDiagnostics.filamentMotion.scale, 0.18);

  const filament = normalDiagnostics.deepFilamentPool[0];
  const still = calculateFilamentGeometry(filament, 0, 0);
  const reducedLater = calculateFilamentGeometry(filament, 3, reducedDiagnostics.filamentMotion.scale);
  const normalLater = calculateFilamentGeometry(filament, 3, normalDiagnostics.filamentMotion.scale);
  assert.ok(
    Math.abs(reducedLater.start.x - still.start.x)
      < Math.abs(normalLater.start.x - still.start.x),
  );
});

test('render restaura alpha, composição, filtro, sombra e pilha de transformação', () => {
  const component = createComponent();
  const ctx = new MockContext();
  ctx.globalAlpha = 0.73;
  ctx.globalCompositeOperation = 'multiply';
  ctx.filter = 'contrast(1.1)';
  ctx.shadowBlur = 9;
  ctx.shadowColor = '#abc';
  const before = {
    globalAlpha: ctx.globalAlpha,
    globalCompositeOperation: ctx.globalCompositeOperation,
    filter: ctx.filter,
    shadowBlur: ctx.shadowBlur,
    shadowColor: ctx.shadowColor,
    transformDepth: ctx.transformDepth,
  };
  component.render(ctx, { cameraX: 20, cameraY: 40, zoom: 1.45 }, { width: 1280, height: 720 });
  assert.deepEqual({
    globalAlpha: ctx.globalAlpha,
    globalCompositeOperation: ctx.globalCompositeOperation,
    filter: ctx.filter,
    shadowBlur: ctx.shadowBlur,
    shadowColor: ctx.shadowColor,
    transformDepth: ctx.transformDepth,
  }, before);
  assert.equal(ctx.stack.length, 0);
});

test('mudança de fase recria composição estável sem duplicar pools ou listeners', () => {
  const first = createComponent('phase-seed');
  const second = createComponent('phase-seed');
  assert.equal(first.diagnostics().stats.particleCount, 32);
  assert.equal(second.diagnostics().stats.particleCount, 32);
  assert.deepEqual(first.diagnostics().particlePool, second.diagnostics().particlePool);
  const source = readFileSync(new URL('../src/render/rhizosphere-parallax.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /addEventListener|removeEventListener/);
});

test('tecla P está livre e integração mantém paralaxe atrás do mundo e das plataformas', () => {
  assert.equal(BIOLOGICAL_PARALLAX_KEY, 'KeyP');
  const appSource = readFileSync(new URL('../src/procgen/app.js', import.meta.url), 'utf8');
  const physicsSource = readFileSync(new URL('../src/physics.js', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../src/render/renderer.js', import.meta.url), 'utf8');

  assert.doesNotMatch(physicsSource, /KeyP/);
  assert.match(appSource, /BIOLOGICAL_PARALLAX_KEY/);
  assert.ok(rendererSource.indexOf('drawBackground();') < rendererSource.indexOf('drawWorld();'));
  assert.ok(appSource.indexOf('renderer.render();') < appSource.indexOf('platformVisuals.drawWorld(ctx);'));
  assert.doesNotMatch(rendererSource, /platform\.globalAlpha|platforms.*globalAlpha/);
});

test('fundo panorâmico preserva proporção, cobre o viewport e alterna cópias espelhadas', () => {
  const centered = calculateBackdropTiles({
    sourceWidth: 4996,
    sourceHeight: 940,
    viewportWidth: 1280,
    viewportHeight: 720,
    cameraX: 0,
    seedPosition: 0,
  });
  assert.ok(centered.length >= 1);
  assert.ok(centered[0].width >= 1280);
  assert.ok(centered[0].height >= 720);
  assert.ok(Math.abs(centered[0].width / centered[0].height - 4996 / 940) < 1e-9);

  const crossingEdge = calculateBackdropTiles({
    sourceWidth: 4996,
    sourceHeight: 940,
    viewportWidth: 1280,
    viewportHeight: 720,
    cameraX: 0,
    seedPosition: 0.95,
  });
  assert.ok(crossingEdge.some(tile => tile.mirrored));
  assert.ok(crossingEdge.some(tile => !tile.mirrored));
  for (let index = 1; index < crossingEdge.length; index++) {
    assert.ok(
      Math.abs(
        crossingEdge[index - 1].x + crossingEdge[index - 1].width
          - crossingEdge[index].x,
      ) < 1e-9,
    );
  }
});

test('imagem de fundo é desenhada antes do paralaxe e permanece independente do toggle P', () => {
  const fakeImage = {
    complete: true,
    naturalWidth: 4996,
    naturalHeight: 940,
    decoding: '',
    src: '',
  };
  const backdrop = createRhizosphereBackdrop({
    seed: 'phase-one',
    createImage: () => fakeImage,
  });
  const anotherPhase = createRhizosphereBackdrop({
    seed: 'phase-two',
    createImage: () => ({ ...fakeImage }),
  });
  assert.notEqual(backdrop.seedPosition, anotherPhase.seedPosition);
  const ctx = new MockContext();
  assert.equal(backdrop.render(ctx, { cameraX: 2400 }, { width: 1280, height: 720 }), true);
  assert.ok(ctx.drawImageCount >= 1);

  const rendererSource = readFileSync(new URL('../src/render/renderer.js', import.meta.url), 'utf8');
  assert.ok(
    rendererSource.indexOf('rhizosphereBackdrop.render(')
      < rendererSource.indexOf('parallaxBackground.render('),
  );
  assert.doesNotMatch(
    readFileSync(new URL('../src/render/rhizosphere-backdrop.js', import.meta.url), 'utf8'),
    /BIOLOGICAL_PARALLAX_KEY|toggle\(/,
  );
});

test('fundo acompanha camera vertical sem revelar a borda da imagem', () => {
  const fakeImage = {
    complete: true,
    naturalWidth: 4996,
    naturalHeight: 940,
    decoding: '',
    src: '',
  };
  const backdrop = createRhizosphereBackdrop({
    seed: 'vertical-camera',
    createImage: () => fakeImage,
  });
  const ctx = new MockContext();
  assert.equal(
    backdrop.render(
      ctx,
      { cameraX: 0, cameraY: -260 },
      { width: 1558, height: 720 },
    ),
    true,
  );
  assert.ok(ctx.drawImageCount >= 1);
  const tiles = calculateBackdropTiles({
    sourceWidth: 4996,
    sourceHeight: 940,
    viewportWidth: 1558,
    viewportHeight: 720,
    cameraX: 0,
    cameraY: -260,
    seedPosition: 0,
  });
  assert.ok(new Set(tiles.map(tile => tile.row)).size >= 2);
  assert.ok(tiles.some(tile => tile.mirroredY));
  assert.ok(tiles.some(tile => !tile.mirroredY));
  const visibleRows = [...new Set(tiles.map(tile => tile.row))].sort((a, b) => a - b);
  assert.deepEqual(visibleRows, [-1, 0]);
  assert.deepEqual(
    ctx.fillRectArgs.at(-1),
    [0, -260, 1558, 720],
    'o veil e a imagem devem permanecer ancorados ao viewport deslocado',
  );
});
