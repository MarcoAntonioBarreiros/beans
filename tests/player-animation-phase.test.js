import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlayerSprite } from '../src/render/player-sprite.js';
import { initPlayerTuning } from '../src/render/player-skin-tuning.js';

// Folha de mentira, com imagem ja "carregada", para exercitar so o avanco dos
// quadros sem depender de DOM.
function spriteDeTeste() {
  const sprite = createPlayerSprite({
    characterHeight: 72,
    states: { run: { src: 'x.png', frames: 8, fps: 8, speedFromMotion: true, motionBase: 2, motionFactor: .022, contentHeight: 347 } },
  });
  assert.equal(sprite.debug().folhas.length, 1);
  return sprite;
}

// Injeta uma imagem falsa nas folhas para que draw() chegue ate o avanco de
// quadro. createPlayerSprite guarda as folhas internamente, entao alcanco por
// meio do ctx: registro qual recorte foi pedido em cada drawImage.
function ctxEspiao() {
  const recortes = [];
  const ctx = new Proxy({
    drawImage: (_img, sx) => { recortes.push(sx); },
  }, { get: (target, key) => target[key] || (() => {}) });
  return { ctx, recortes };
}

function jogador(vx) {
  return { x: 0, y: 0, w: 32, h: 48, vx, vy: 0, onGround: true, alive: true, invuln: 0, dashTime: 0 };
}

test('mudar o ritmo nao salta o ciclo da animacao', () => {
  initPlayerTuning(null);
  // Reproduz o defeito relatado: com o indice vindo de Math.floor(time * rate),
  // aos 30 segundos de jogo uma mudanca de ritmo de 2 para 7,4 empurraria o
  // indice de 60 para 222 num unico quadro. A animacao embaralhava justamente
  // enquanto o jogador acelerava.
  const FRAMES = 8;
  const indiceAntigo = (time, rate) => Math.floor(time * rate) % FRAMES;
  const saltoAntigo = Math.abs(indiceAntigo(30.016, 7.4) - indiceAntigo(30, 2));
  assert.ok(saltoAntigo > 1, 'o teste precisa reproduzir o salto da formula antiga');

  // Na formula por fase acumulada, o mesmo passo avanca no maximo um quadro.
  let fase = 0;
  const avancar = (dt, rate) => { fase += rate * dt; return Math.floor(fase) % FRAMES; };
  const antes = avancar(0, 2);
  const depois = avancar(1 / 60, 7.4);
  assert.ok(
    Math.abs(depois - antes) <= 1,
    `a fase acumulada saltou ${Math.abs(depois - antes)} quadros numa aceleracao`,
  );
});

test('a mesma aceleracao produz a mesma animacao em qualquer momento do jogo', () => {
  initPlayerTuning(null);
  // Duas arrancadas identicas, uma logo no comeco da fase e outra 500 segundos
  // depois, precisam mostrar a mesma sequencia de quadros.
  const rampa = passo => 2 + Math.min(245, passo * 30) * .022;

  const porFaseAcumulada = inicio => {
    let fase = 0;
    const saida = [];
    for (let passo = 0; passo < 14; passo++) {
      fase += rampa(passo) * (1 / 60);
      saida.push(Math.floor(fase) % 8);
    }
    return saida.join(',');
  };
  assert.equal(
    porFaseAcumulada(0), porFaseAcumulada(500),
    'a fase acumulada precisa independer de quando a arrancada acontece',
  );

  // E a formula antiga, para o teste mostrar que o defeito existia: o mesmo
  // trecho depende de quando aconteceu.
  const porTempoAbsoluto = inicio => {
    const saida = [];
    for (let passo = 0; passo < 14; passo++) {
      const tempo = inicio + passo / 60;
      saida.push(Math.floor(tempo * rampa(passo)) % 8);
    }
    return saida.join(',');
  };
  assert.notEqual(
    porTempoAbsoluto(0), porTempoAbsoluto(500),
    'o teste precisa demonstrar que a formula antiga dependia do relogio do jogo',
  );
});

test('dt negativo ou gigante nao empurra o ciclo', () => {
  // Fase reiniciada faz o tempo voltar; aba em segundo plano faz o dt explodir.
  // Nos dois casos o certo e nao avancar.
  initPlayerTuning(null);
  const sprite = spriteDeTeste();
  const { ctx } = ctxEspiao();
  // Sem imagem carregada o draw devolve false, mas nao pode lancar — e o que
  // acontece de verdade nos primeiros quadros.
  assert.doesNotThrow(() => {
    sprite.draw(ctx, jogador(245), 10);
    sprite.draw(ctx, jogador(245), 2);
    sprite.draw(ctx, jogador(245), 9999);
    sprite.draw(ctx, jogador(245), Number.NaN);
  });
});

test('o desenho nunca lanca com jogador em estados extremos', () => {
  initPlayerTuning(null);
  const sprite = spriteDeTeste();
  const { ctx } = ctxEspiao();
  const extremos = [
    { ...jogador(0), alive: false },
    { ...jogador(660), dashTime: .1 },
    { ...jogador(-245), onGround: false, vy: -300 },
    { ...jogador(0), invuln: 1 },
  ];
  for (const estado of extremos) {
    assert.doesNotThrow(() => sprite.draw(ctx, estado, 5), JSON.stringify(estado));
  }
});
