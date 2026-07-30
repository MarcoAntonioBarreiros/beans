import { createAudioController } from './audio.js';
import { createEntitySystem } from './entities.js';
import { createGameLoop } from './game-loop.js';
import { getHudDom, createHud } from './hud.js';
import { createInput } from './input.js';
import { createPhysicsSystem } from './physics.js';
import { createRenderer } from './render/renderer.js';
import { createGameState } from './state.js';

export function createGame({ documentRef = document, windowRef = window } = {}) {
  const canvas = documentRef.getElementById('game');
  const state = createGameState();
  const testMode = new URLSearchParams(windowRef.location.search).has('test');
  const dom = getHudDom(documentRef);
  const hud = createHud({ dom, state });
  const audio = createAudioController({ document: documentRef, getPlayer: () => state.player });
  let entities;

  const input = createInput({
    target: windowRef,
    document: documentRef,
    onRespawn: manual => {
      if (state.gameState === 'play') entities.respawn(manual);
    },
    onToggleSound: () => audio.toggleSound(),
  });

  entities = createEntitySystem({ state, hud });
  const physics = createPhysicsSystem({ state, input, entities, hud, audio });
  const renderer = createRenderer({ canvas, state, entities });
  const loop = createGameLoop({
    update: physics.update,
    render: renderer.render,
    now: () => windowRef.performance.now(),
    raf: fn => windowRef.requestAnimationFrame(fn),
  });

  function startGame() {
    entities.resetGame();
    state.gameState = 'play';
    hud.showPlay();
    if (!testMode) audio.initAudio();
    hud.showToast('A lavoura de Lia está perdendo força', 'Desça à rizosfera e encontre aliados capazes de reativar as conexões do solo.');
  }

  function backToIntro() {
    state.gameState = 'intro';
    hud.showIntro();
  }

  function showControls() {
    windowRef.alert('Mover: WASD ou setas\nPular: Espaço / W / seta para cima\nSalto duplo: pressione salto novamente no ar, após encontrar Azospirillum\nImpulso de Hifa: Shift (após desbloquear)\nPulso Mineral: K (após desbloquear)\nReiniciar: R\nSom: M');
  }

  documentRef.getElementById('startBtn').onclick = startGame;
  documentRef.getElementById('againBtn').onclick = startGame;
  documentRef.getElementById('backBtn').onclick = backToIntro;
  documentRef.getElementById('howBtn').onclick = showControls;
  documentRef.getElementById('soundBtn').onclick = audio.toggleSound;

  const promptTimer = windowRef.setInterval(() => hud.updatePrompt(), 140);

  const api = {
    ready: true,
    state,
    input,
    startGame,
    resetGame: entities.resetGame,
    respawn: entities.respawn,
    step: loop.step,
    render: renderer.render,
    stop: loop.stop,
    setPlayer(values) {
      Object.assign(state.player, values);
    },
    destroy() {
      loop.stop();
      input.destroy();
      windowRef.clearInterval(promptTimer);
    },
  };

  windowRef.__BEANS_GAME__ = api;
  renderer.render();
  if (!testMode) loop.start();
  return api;
}

createGame();
