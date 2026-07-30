import assert from 'node:assert/strict';
import test from 'node:test';

import { createRalstoniaVascularWilt } from '../src/procgen/ralstonia-vascular-wilt.js';

// Regressão da pilha do canvas.
//
// O módulo desenha dentro de um save()/translate(-cameraX) próprio. Um
// ctx.restore() sem save() correspondente desempilha a translação da CÂMERA, e
// todo sistema desenhado DEPOIS da Ralstonia — ecologia, Meloidogyne e todos os
// organismos benéficos — passa a desenhar em coordenadas de tela, flutuando no
// ar enquanto a câmera anda.
//
// Foi exatamente o que aconteceu quando a Ralstonia entrou na campanha: os
// patógenos anteriores na ordem de render (Rhizoctonia) ficaram certos e tudo
// que vinha depois se soltou. Este teste conta save/restore durante um render
// real, então o desequilíbrio falha aqui e não no playtest.

function recordingContext() {
  let depth = 0;
  let minDepth = 0;
  const gradient = { addColorStop() {} };
  const noop = () => {};
  const base = {
    save() { depth++; },
    restore() { depth--; minDepth = Math.min(minDepth, depth); },
    translate: noop, scale: noop, rotate: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, ellipse: noop, rect: noop, roundRect: noop,
    fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop, drawImage: noop, setLineDash: noop,
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  const ctx = new Proxy(base, {
    get(target, key) { return key in target ? target[key] : undefined; },
    set() { return true; },
  });
  return {
    ctx,
    get depth() { return depth; },
    get minDepth() { return minDepth; },
  };
}

function harness({ vascularLoad = .4, neutralized = false, age = 0 } = {}) {
  const root = {
    id: 'raiz-infectada', logicIndex: 5,
    x: 200, y: 500, w: 240, h: 60, type: 'root',
    rootHealth: .6, ralstoniaEntryWound: .45,
  };
  const state = {
    time: 12, cameraX: 340, gameState: 'play',
    player: { x: 260, y: 452, w: 32, h: 48 },
    level: { platforms: [root], ralstoniaFoci: [], rhizobiumNodules: [], biofilms: [] },
    campaign: { phase: 9 },
  };
  const system = createRalstoniaVascularWilt({
    state,
    entities: { burst() {}, damagePlayer() {} },
    inoculants: { colonies: [] },
    pseudomonas: { colonies: [] },
  });
  system.initialize?.();
  // Garante ao menos um foco visível no estado pedido, mesmo que a seleção
  // automática não escolha esta raiz.
  const foci = state.level.ralstoniaFoci;
  if (!foci.length) {
    foci.push({
      id: 'foco-teste', root, x: root.x + root.w / 2,
      surfaceLoad: .3, vascularLoad, age, phase: 0,
      oozeTimer: .2, stressTimer: 1, spreadTimer: 10,
      announcedEntry: false, announcedVascular: false, announcedCritical: false,
      neutralized, dormant: false,
      bacillusControl: .4, pseudomonasControl: .3, vascularEfficiency: .7,
    });
  } else {
    Object.assign(foci[0], { vascularLoad, neutralized, age, bacillusControl: .4, pseudomonasControl: .3 });
  }
  return { state, system, root };
}

test('render da Ralstonia devolve a pilha do canvas exatamente como recebeu', () => {
  const { system } = harness();
  const rec = recordingContext();
  system.render(rec.ctx);
  assert.equal(
    rec.depth, 0,
    `a pilha terminou em ${rec.depth}: um restore() a mais derruba a câmera de todo sistema desenhado depois`,
  );
});

test('render nunca desempilha abaixo do nível em que foi chamado', () => {
  // Terminar em zero não basta: um restore() a mais seguido de um save() a mais
  // também fecharia em zero, mas no meio do caminho a câmera já teria caído.
  const { system } = harness();
  const rec = recordingContext();
  system.render(rec.ctx);
  assert.equal(
    rec.minDepth, 0,
    `a pilha desceu para ${rec.minDepth}: a translação da câmera foi removida durante o render`,
  );
});

test('a pilha continua equilibrada em todos os estágios do foco', () => {
  for (const caso of [
    { nome: 'superficial', vascularLoad: .02 },
    { nome: 'entrando', vascularLoad: .1 },
    { nome: 'vascular', vascularLoad: .4 },
    { nome: 'obstruido', vascularLoad: .6 },
    { nome: 'critico', vascularLoad: .9 },
    { nome: 'neutralizado', vascularLoad: 0, neutralized: true },
    { nome: 'neutralizado antigo', vascularLoad: 0, neutralized: true, age: 30 },
  ]) {
    const { system } = harness(caso);
    const rec = recordingContext();
    system.render(rec.ctx);
    assert.equal(rec.depth, 0, `estágio ${caso.nome}: pilha terminou em ${rec.depth}`);
    assert.equal(rec.minDepth, 0, `estágio ${caso.nome}: pilha desceu para ${rec.minDepth}`);
  }
});

test('render sem foco nenhum não mexe na pilha', () => {
  const { state, system } = harness();
  state.level.ralstoniaFoci.length = 0;
  const rec = recordingContext();
  system.render(rec.ctx);
  assert.equal(rec.depth, 0);
  assert.equal(rec.minDepth, 0);
});
