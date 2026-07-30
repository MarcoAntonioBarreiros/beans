import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateVerticalCameraTarget } from '../src/procgen/camera-view.js';
import { synchronizeWorldBounds } from '../src/procgen/world-bounds.js';
import {
  calculateResponsiveCanvasSize,
  createResponsiveCanvas,
} from '../src/procgen/responsive-canvas.js';

test('viewport ultrawide amplia o campo horizontal sem deformar a proporcao', () => {
  const size = calculateResponsiveCanvasSize(844, 390);
  assert.deepEqual(
    { width: size.width, height: size.height },
    { width: 1558, height: 720 },
  );
  assert.ok(Math.abs(size.width / size.height - 844 / 390) < 0.001);
});

test('viewport 16:9 preserva a resolucao logica historica', () => {
  assert.deepEqual(
    calculateResponsiveCanvasSize(1280, 720),
    { width: 1280, height: 720, aspectRatio: 16 / 9 },
  );
});

test('sincronizacao acompanha mudanca de orientacao sem multiplicar listeners', () => {
  let rect = { width: 844, height: 390 };
  const listeners = new Map();
  const visualListeners = new Map();
  const canvas = {
    width: 1280,
    height: 720,
    getBoundingClientRect: () => rect,
  };
  const windowObject = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    requestAnimationFrame(callback) { callback(); },
    visualViewport: {
      addEventListener(type, listener) { visualListeners.set(type, listener); },
      removeEventListener(type) { visualListeners.delete(type); },
    },
  };

  const responsive = createResponsiveCanvas({ canvas, windowObject });
  assert.equal(canvas.width, 1558);
  assert.equal(canvas.height, 720);
  assert.equal(listeners.size, 2);
  assert.equal(visualListeners.size, 1);

  rect = { width: 1280, height: 720 };
  listeners.get('resize')();
  assert.equal(canvas.width, 1280);
  assert.equal(canvas.height, 720);
  assert.equal(responsive.diagnostics().viewportWidth, 1280);

  responsive.destroy();
  assert.equal(listeners.size, 0);
  assert.equal(visualListeners.size, 0);
});

test('camera vertical segue integralmente o jogador acima de y zero', () => {
  const target = calculateVerticalCameraTarget({
    playerCenterY: -80,
    visibleHeight: 720 / 1.45,
    verticalAnchor: 0.56,
  });
  assert.ok(target < -300);
  assert.equal(
    target,
    -80 - (720 / 1.45) * 0.56,
    'o alvo negativo nao pode ser truncado em zero',
  );
});

test('camera vertical preserva o limite inferior historico', () => {
  const visibleHeight = 720 / 1.45;
  const target = calculateVerticalCameraTarget({
    playerCenterY: 900,
    visibleHeight,
    verticalAnchor: 0.61,
  });
  assert.equal(target, 720 - visibleHeight);
});

test('camera vertical usa limites reais acima de zero e abaixo da altura historica', () => {
  const visibleHeight = 500;
  const high = calculateVerticalCameraTarget({
    playerCenterY: -360,
    visibleHeight,
    verticalAnchor: .5,
    worldTopY: -700,
    worldBottomY: 1300,
  });
  const low = calculateVerticalCameraTarget({
    playerCenterY: 1180,
    visibleHeight,
    verticalAnchor: .5,
    worldTopY: -700,
    worldBottomY: 1300,
  });
  assert.equal(high, -610);
  assert.equal(low, 800);
});

test('limites do mundo derivam da geometria e da altura visivel', () => {
  const level = {
    platforms: [
      { x: 0, y: -420, w: 100, h: 54 },
      { x: 200, y: 860, w: 100, h: 80 },
    ],
    roots: [],
  };
  const bounds = synchronizeWorldBounds(level, 800);
  assert.equal(bounds.margin, 280);
  assert.equal(bounds.worldTopY, -700);
  assert.equal(bounds.worldBottomY, 1220);
});
