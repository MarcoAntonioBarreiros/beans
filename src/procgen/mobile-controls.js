import { ensureTutorialInterface } from './tutorial-bootstrap.js?v=20260727-organic-card-2';
import { createTutorialManager } from './tutorial-manager.js?v=20260727-organic-card-2';
import {
  createTutorialTriggers,
  TUTORIAL_RUNTIME_VERSION,
} from './tutorial-triggers.js?v=20260727-organic-card-2';

ensureTutorialInterface();

const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const compactTouchViewport = window.matchMedia('(max-width: 900px)').matches;
const touchDevice = coarsePointer || (navigator.maxTouchPoints > 0 && compactTouchViewport);

const root = document.documentElement;
const controls = document.getElementById('touch-controls');
const debug = document.getElementById('debug');
const debugButton = document.querySelector('[data-mobile-action="debug"]');
const resetButton = document.querySelector('[data-mobile-action="reset"]');
const fullscreenButton = document.querySelector('[data-mobile-action="fullscreen"]');

if (touchDevice) root.classList.add('touch-device');

const pressed = new Map();

function emit(code, down) {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
    code,
    key: code,
    bubbles: true,
    cancelable: true,
  }));
}

function releasePointer(pointerId) {
  const state = pressed.get(pointerId);
  if (!state) return;
  clearTimeout(state.timer);
  emit(state.code, false);
  state.button.classList.remove('pressed');
  pressed.delete(pointerId);
}

function pressButton(event) {
  const button = event.currentTarget;
  const code = button.dataset.key;
  if (!code) return;
  event.preventDefault();
  event.stopPropagation();

  try { button.setPointerCapture(event.pointerId); } catch (_) {}
  releasePointer(event.pointerId);
  emit(code, true);
  button.classList.add('pressed');

  const tapOnly = button.dataset.mode === 'tap';
  const state = { code, button, timer: null };
  if (tapOnly) {
    state.timer = setTimeout(() => releasePointer(event.pointerId), 115);
  }
  pressed.set(event.pointerId, state);
}

for (const button of document.querySelectorAll('.touch-key')) {
  button.addEventListener('pointerdown', pressButton, { passive: false });
  button.addEventListener('pointerup', event => releasePointer(event.pointerId));
  button.addEventListener('pointercancel', event => releasePointer(event.pointerId));
  button.addEventListener('lostpointercapture', event => releasePointer(event.pointerId));
  button.addEventListener('contextmenu', event => event.preventDefault());
}

function clearAllInputs({ emitFallbackKeyups = true } = {}) {
  for (const pointerId of [...pressed.keys()]) releasePointer(pointerId);
  if (emitFallbackKeyups) {
    for (const code of ['ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'ShiftLeft', 'ArrowDown']) {
      emit(code, false);
    }
  }
}

window.addEventListener('blur', clearAllInputs);
window.addEventListener('miguelito:tutorial-open', () => {
  // Os ponteiros realmente ativos emitem seu keyup por releasePointer. Nao
  // emitimos keyups sinteticos para todas as teclas aqui: isso faria uma tecla
  // fisica ainda segurada parecer liberada e burlaria a trava de retomada.
  clearAllInputs({ emitFallbackKeyups: false });
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearAllInputs();
});

resetButton?.addEventListener('click', event => {
  event.preventDefault();
  resetButton.blur();
  emit('KeyR', true);
  setTimeout(() => emit('KeyR', false), 80);
});

debugButton?.addEventListener('click', event => {
  event.preventDefault();
  debugButton.blur();
  const visible = debug?.classList.toggle('mobile-visible');
  debugButton.setAttribute('aria-pressed', String(Boolean(visible)));
});

fullscreenButton?.addEventListener('click', async event => {
  event.preventDefault();
  fullscreenButton.blur();
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else await document.exitFullscreen?.();
  } catch (_) {
    // Alguns navegadores móveis não permitem fullscreen fora de apps instalados.
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreenButton?.classList.toggle('active', Boolean(document.fullscreenElement));
});

if (controls && touchDevice) {
  controls.hidden = false;
  document.body.classList.add('touch-ready');
}

function initializeTutorialSystem() {
  const sim = window.miguelitoSim;
  if (!sim?.state) {
    requestAnimationFrame(initializeTutorialSystem);
    return;
  }

  const originalStep = sim.step.bind(sim);
  sim.step = dt => {
    if (sim.state.gameState === 'tutorial') return;
    originalStep(dt);
  };

  const manager = createTutorialManager({ state: sim.state });
  sim.ecology.setTutorialCardSeenResolver?.(cardId => manager.hasSeen(cardId));
  const ralstoniaAdapter = {
    get foci() { return sim.state.level.ralstoniaFoci || []; },
  };
  const trichodermaRhizoctoniaAdapter = {
    get activeAttackCount() {
      return (sim.state.level.enemies || []).filter(enemy => enemy.trichodermaRhizoTargeted).length;
    },
  };

  const triggers = createTutorialTriggers({
    state: sim.state,
    sim,
    manager,
    ralstoniaControl: ralstoniaAdapter,
    trichodermaRhizoctoniaControl: trichodermaRhizoctoniaAdapter,
  });

  const libraryDescription = document.querySelector('.tutorial-library-description');
  if (libraryDescription) {
    libraryDescription.textContent = `Reabra os cartões encontrados nesta sessão da campanha. Sistema didático v${TUTORIAL_RUNTIME_VERSION}`;
  }

  window.addEventListener('miguelito:tutorial-reset', () => {
    requestAnimationFrame(() => triggers.rearm());
  });

  window.miguelitoTutorial = manager;
  window.miguelitoTutorialVersion = TUTORIAL_RUNTIME_VERSION;
  window.miguelitoTutorialDiagnostics = triggers.diagnostics;

  // A apresentação precisa entrar na fila antes do primeiro sensor visual.
  triggers.showWelcome();

  function tutorialFrame() {
    triggers.update();
    requestAnimationFrame(tutorialFrame);
  }
  requestAnimationFrame(tutorialFrame);
}

initializeTutorialSystem();
