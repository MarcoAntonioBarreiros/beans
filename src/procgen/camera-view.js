import { H, W } from '../core/constants.js';
import { clamp, lerp } from '../core/math.js';
import { zoomProfileFor } from './touch-profile.js';

// O perfil de zoom nao e mais unico: celular abre mais perto e chega mais perto
// que computador. Os numeros vivem em `touch-profile.js`, junto do criterio que
// decide qual aparelho e qual — o mesmo que liga os controles touch.

// O afastamento do fim de fase precisa passar do limite que o JOGADOR pode
// escolher: nem 1x nem o minimo de perfil nenhum mostram a raiz inteira mais o
// feijoeiro. Este piso vale SO para a cinematica e nao muda com o aparelho.
const CINEMATIC_MIN_ZOOM = .22;

function roundedZoom(value) {
  return Math.round(value * 20) / 20;
}

export function calculateVerticalCameraTarget({
  playerCenterY,
  visibleHeight,
  verticalAnchor,
  worldHeight = H,
  worldTopY,
  worldBottomY,
}) {
  const safeVisibleHeight = Math.max(1, Number(visibleHeight) || H);
  const rawTarget = (Number(playerCenterY) || 0)
    - safeVisibleHeight * (Number(verticalAnchor) || 0);
  const explicitBounds = Number.isFinite(Number(worldTopY))
    && Number.isFinite(Number(worldBottomY));
  const minCameraY = explicitBounds ? Number(worldTopY) : Math.min(0, rawTarget);
  const maxCameraY = explicitBounds
    ? Math.max(minCameraY, Number(worldBottomY) - safeVisibleHeight)
    : Math.max(0, (Number(worldHeight) || H) - safeVisibleHeight);
  return clamp(rawTarget, minCameraY, maxCameraY);
}

export function createCameraView({ canvas, state }) {
  const windowObject = canvas?.ownerDocument?.defaultView
    || (typeof window === 'undefined' ? null : window);
  // Ancoramento vertical: continua com o criterio frouxo de sempre. Ele so
  // decide se a camera senta o jogador um pouco mais alto na tela, e apertar o
  // criterio aqui mudaria o enquadramento de quem joga em notebook com tela
  // sensivel — sem que ninguem tenha pedido isso.
  const coarsePointer = Boolean(
    windowObject?.matchMedia?.('(pointer: coarse)').matches
      || windowObject?.navigator?.maxTouchPoints > 0,
  );
  // Uma vez so, na criacao: trocar de perfil com o jogo rodando mudaria o
  // enquadramento debaixo do jogador.
  const profile = zoomProfileFor(windowObject);
  let zoom = profile.default;
  let targetZoom = profile.default;
  // Enquanto isto existe, o rastreamento do jogador esta suspenso e quem escreve
  // cameraX/cameraY/zoom e a cinematica. `targetZoom` fica intacto: e a escolha
  // do jogador, e ela volta assim que o foco termina.
  let cinematic = null;
  const readout = document.querySelector('[data-camera-readout]');

  state.cameraZoom = zoom;
  state.cameraY = 0;
  state.cameraIsTouch = coarsePointer;

  function refreshReadout() {
    if (readout) readout.textContent = `${targetZoom.toFixed(2)}×`;
  }

  function setZoom(value) {
    targetZoom = roundedZoom(clamp(value, profile.min, profile.max));
    refreshReadout();
  }

  function zoomIn() {
    setZoom(targetZoom + profile.step);
  }

  function zoomOut() {
    setZoom(targetZoom - profile.step);
  }

  function resetZoom() {
    // O padrao do PERFIL ATIVO, nao um valor global: no celular 1,6x.
    setZoom(profile.default);
  }

  function resetTracking() {
    // Fase nova comeca sem resto de cinematica: se o foco vazasse, a fase
    // seguinte abriria com o zoom do afastamento e sem perseguir o jogador.
    cinematic = null;
    zoom = targetZoom;
    state.cameraZoom = zoom;
    state.cameraX = 0;
    state.cameraY = 0;
  }

  /**
   * Assume a camera para uma cinematica e devolve o enquadramento REAL do
   * instante — nao um valor fixo fingindo ser o quadro anterior. Quem chama
   * interpola a partir daqui, e o primeiro quadro da cinematica e, por
   * construcao, identico ao ultimo quadro jogavel.
   */
  function beginCinematic() {
    const viewportWidth = canvas.width || W;
    const viewportHeight = canvas.height || H;
    cinematic = true;
    return {
      x: state.cameraX || 0,
      y: state.cameraY || 0,
      zoom,
      viewportWidth,
      viewportHeight,
      visibleWidth: viewportWidth / zoom,
      visibleHeight: viewportHeight / zoom,
    };
  }

  function setCinematic({ x, y, zoom: value } = {}) {
    if (!cinematic) return false;
    if (Number.isFinite(value)) {
      zoom = clamp(value, CINEMATIC_MIN_ZOOM, profile.max);
      state.cameraZoom = zoom;
    }
    if (Number.isFinite(x)) state.cameraX = x;
    if (Number.isFinite(y)) state.cameraY = y;
    const viewportWidth = canvas.width || W;
    const viewportHeight = canvas.height || H;
    state.viewportWidth = viewportWidth;
    state.viewportHeight = viewportHeight;
    state.visibleWorldWidth = viewportWidth / zoom;
    state.visibleWorldHeight = viewportHeight / zoom;
    return true;
  }

  /**
   * Devolve a camera ao jogo. O zoom volta a ser o que o jogador escolheu, e
   * nada da cinematica sobrevive para a fase seguinte.
   */
  function endCinematic() {
    if (!cinematic) return false;
    cinematic = null;
    zoom = targetZoom;
    state.cameraZoom = zoom;
    return true;
  }

  function update(dt) {
    // Com o foco cinematico ativo o rastreamento nao roda: o afastamento seria
    // desfeito quadro a quadro pela perseguicao ao jogador.
    if (cinematic) return;
    const zoomBlend = 1 - Math.pow(.0007, dt);
    zoom = lerp(zoom, targetZoom, zoomBlend);
    if (Math.abs(zoom - targetZoom) < .001) zoom = targetZoom;
    state.cameraZoom = zoom;

    const player = state.player;
    if (!player) return;

    const viewportWidth = canvas.width || W;
    const viewportHeight = canvas.height || H;
    const visibleW = viewportWidth / zoom;
    const visibleH = viewportHeight / zoom;
    state.viewportWidth = viewportWidth;
    state.viewportHeight = viewportHeight;
    state.visibleWorldWidth = visibleW;
    state.visibleWorldHeight = visibleH;
    const playerCenterX = player.x + player.w / 2;
    const playerCenterY = player.y + player.h / 2;
    const direction = player.facing || 1;
    const speedLookAhead = clamp(Math.abs(player.vx || 0) * .34, 0, 120);
    const lookAhead = direction * (58 + speedLookAhead);
    const levelEndX = state.level.endX !== undefined ? state.level.endX : 4900;
    const maxCameraX = Math.max(0, levelEndX - visibleW);
    const targetCameraX = clamp(
      playerCenterX + lookAhead - visibleW * .5,
      0,
      maxCameraX,
    );

    const horizontalBlend = 1 - Math.pow(.004, dt);
    state.cameraX = lerp(state.cameraX || 0, targetCameraX, horizontalBlend);

    const verticalAnchor = coarsePointer ? .56 : .61;
    const geometryTop = Number(state.level.geometryTopY);
    const geometryBottom = Number(state.level.geometryBottomY);
    if (Number.isFinite(geometryTop) && Number.isFinite(geometryBottom)) {
      const margin = Math.max(180, visibleH * .35);
      state.level.worldTopY = geometryTop - margin;
      state.level.worldBottomY = geometryBottom + margin;
      state.level.worldVerticalMargin = margin;
    }
    const targetCameraY = calculateVerticalCameraTarget({
      playerCenterY,
      visibleHeight: visibleH,
      verticalAnchor,
      worldHeight: H,
      worldTopY: state.level.worldTopY,
      worldBottomY: state.level.worldBottomY,
    });
    const verticalBlend = 1 - Math.pow(.012, dt);
    state.cameraY = lerp(state.cameraY || 0, targetCameraY, verticalBlend);
  }

  function apply(ctx) {
    ctx.scale(zoom, zoom);
    ctx.translate(0, -(state.cameraY || 0));
  }

  function handleKey(event) {
    if (event.repeat) return;
    if (event.code === 'Equal' || event.code === 'NumpadAdd') {
      event.preventDefault();
      zoomIn();
    } else if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
      event.preventDefault();
      zoomOut();
    } else if (event.code === 'Digit0' || event.code === 'Numpad0') {
      event.preventDefault();
      resetZoom();
    }
  }

  window.addEventListener('keydown', handleKey);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.deltaY < 0) zoomIn();
    else if (event.deltaY > 0) zoomOut();
  }, { passive: false });

  for (const button of document.querySelectorAll('[data-camera-action]')) {
    button.addEventListener('click', event => {
      event.preventDefault();
      const action = button.dataset.cameraAction;
      if (action === 'in') zoomIn();
      else if (action === 'out') zoomOut();
      else resetZoom();
    });
  }

  refreshReadout();
  window.miguelitoCamera = {
    zoomIn,
    zoomOut,
    resetZoom,
    setZoom,
    get zoom() { return zoom; },
    get targetZoom() { return targetZoom; },
  };

  return {
    update,
    apply,
    resetTracking,
    get zoomProfile() { return profile; },
    zoomIn,
    zoomOut,
    resetZoom,
    beginCinematic,
    setCinematic,
    endCinematic,
    get cinematicActive() { return Boolean(cinematic); },
    get zoom() { return zoom; },
    get targetZoom() { return targetZoom; },
  };
}
