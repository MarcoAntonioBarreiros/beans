import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  createPhaseFinale,
  plantStateFromScore,
  PHASE_FINALE_SECONDS,
  PLANT_STATE_LABEL,
} from '../src/procgen/phase-finale.js';
import { PHASE_VICTORY_TRANSITION_SECONDS } from '../src/audio-manifest.js';

// FIM DE FASE — A REVELAÇÃO DO FEIJOEIRO
// ======================================
//
// A fase inteira acontece embaixo da terra. Ao alcançar a raiz principal com os
// objetivos cumpridos, a câmera se afasta e mostra a planta que aquilo tudo
// sustentava — e o porte dela é o boletim da fase, não um enfeite com a nota
// escrita por cima.
//
// O que estes testes protegem:
//
//   1. o estado da planta sai de `report.score`, com cortes estáveis;
//   2. no jogo normal o módulo NÃO desenha nada (é aditivo de verdade);
//   3. a cena percorre approach → confirm → zoom → done pelo relógio do quadro;
//   4. a pilha do canvas fecha equilibrada em todos os modos — um `restore()`
//      sobrando aqui desmontaria a transformação de quem desenha depois;
//   5. a planta aparece ANTES do cartão de texto (a ordem da leitura);
//   6. a cena cabe na espera que o jogo já fazia — e `app.js` a espera de fato.

// --- DUPLO DE CANVAS -------------------------------------------------------
//
// Conta save/restore (equilíbrio da pilha) e o total de primitivas desenhadas,
// que é como se mede "desenhou alguma coisa" sem pixels de verdade.

function recordingContext() {
  let depth = 0;
  let minDepth = 0;
  let draws = 0;
  const gradient = { addColorStop() {} };
  const noop = () => {};
  const paint = () => { draws++; };
  const base = {
    save() { depth++; },
    restore() { depth--; minDepth = Math.min(minDepth, depth); },
    translate: noop, scale: noop, rotate: noop, setTransform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, ellipse: noop, rect: noop, roundRect: noop,
    setLineDash: noop, clip: noop,
    fill: paint, stroke: paint, fillRect: paint, strokeRect: paint, clearRect: noop,
    fillText: paint, strokeText: paint, drawImage: paint,
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
    get draws() { return draws; },
  };
}

function finale() {
  return createPhaseFinale({ getViewport: () => ({ width: 1280, height: 720 }) });
}

// Avança a cena em passos de 60 fps, como o laço do jogo faz.
function advance(scene, seconds, step = 1 / 60) {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) scene.update(step);
}

// --- 1. A PLANTA É O BOLETIM ------------------------------------------------

test('o estado da planta sai da nota da fase, com cortes estaveis', () => {
  assert.equal(plantStateFromScore(0), 0);
  assert.equal(plantStateFromScore(54), 0);
  assert.equal(plantStateFromScore(54.9), 0);
  assert.equal(plantStateFromScore(55), 1);
  assert.equal(plantStateFromScore(84), 1);
  assert.equal(plantStateFromScore(84.9), 1);
  assert.equal(plantStateFromScore(85), 2);
  assert.equal(plantStateFromScore(100), 2);
});

test('nota ausente ou invalida cai na planta sadia, nunca na doente', () => {
  // Uma falha de leitura do relatório não pode punir o jogador com uma planta
  // murcha: o padrão é o meio, não o pior caso. Atenção a `null` e `''` —
  // `Number()` transforma os dois em 0, que cairia na faixa da planta doente.
  for (const value of [undefined, null, NaN, '', '70', 'muito bom', {}]) {
    assert.equal(plantStateFromScore(value), 1, `valor: ${String(value)}`);
  }
});

test('cada estado tem rotulo proprio', () => {
  assert.equal(PLANT_STATE_LABEL.length, 3);
  assert.equal(new Set(PLANT_STATE_LABEL).size, 3);
});

test('begin escolhe o estado a partir do relatorio recebido', () => {
  for (const [score, expected] of [[30, 0], [70, 1], [92, 2]]) {
    const scene = finale();
    scene.begin({ score, rootHealth: 80, infestation: 4, phase: 6 });
    assert.equal(scene.plantState, expected, `nota ${score}`);
  }
});

// --- 2. ADITIVO: NO JOGO NORMAL NÃO EXISTE ----------------------------------

test('ocioso: render nao desenha nada e nao mexe na pilha do canvas', () => {
  const scene = finale();
  const canvas = recordingContext();

  // Um minuto inteiro de jogo sem vitória alguma.
  advance(scene, 60);

  assert.equal(scene.active, false);
  assert.equal(scene.mode, 'idle');
  assert.equal(scene.render(canvas.ctx), false);
  assert.equal(canvas.draws, 0);
  assert.equal(canvas.depth, 0);
  assert.equal(canvas.minDepth, 0);
});

test('reset devolve a cena ao estado ocioso', () => {
  const scene = finale();
  scene.begin({ score: 90 });
  advance(scene, PHASE_FINALE_SECONDS + 1);
  assert.equal(scene.mode, 'done');

  scene.reset();
  assert.equal(scene.mode, 'idle');
  assert.equal(scene.active, false);
  assert.equal(scene.reveal, 0);
  assert.equal(scene.cardAlpha, 0);

  const canvas = recordingContext();
  assert.equal(scene.render(canvas.ctx), false);
  assert.equal(canvas.draws, 0);
});

test('begin repetido nao reinicia uma cena em andamento', () => {
  const scene = finale();
  assert.equal(scene.begin({ score: 90 }), true);
  advance(scene, 1.2);
  assert.equal(scene.mode, 'confirm');

  assert.equal(scene.begin({ score: 10 }), false);
  assert.equal(scene.mode, 'confirm');
  assert.equal(scene.plantState, 2, 'a segunda chamada nao pode trocar a planta');
});

// --- 3. A CENA ANDA PELO RELÓGIO DO QUADRO ----------------------------------

test('a cena percorre approach, confirm, zoom e done', () => {
  const scene = finale();
  scene.begin({ score: 70, rootHealth: 80, infestation: 5, phase: 4 });
  assert.equal(scene.mode, 'approach');
  assert.equal(scene.active, true);

  advance(scene, 0.5);
  assert.equal(scene.mode, 'approach');

  advance(scene, 0.8);
  assert.equal(scene.mode, 'confirm');

  advance(scene, 1.0);
  assert.equal(scene.mode, 'zoom');

  advance(scene, 3.0);
  assert.equal(scene.mode, 'done');
  assert.equal(scene.reveal, 1);
  assert.equal(scene.cardAlpha, 1);
});

test('a duracao nao depende da taxa de quadros', () => {
  for (const step of [1 / 120, 1 / 60, 1 / 30]) {
    const scene = finale();
    scene.begin({ score: 70 });
    // Um passo antes do fim ainda não terminou; um passo depois, terminou.
    advance(scene, PHASE_FINALE_SECONDS - 0.2, step);
    assert.notEqual(scene.mode, 'done', `${Math.round(1 / step)} fps: cedo demais`);
    advance(scene, 0.4, step);
    assert.equal(scene.mode, 'done', `${Math.round(1 / step)} fps: devia ter fechado`);
  }
});

test('dt zero nao trava nem adianta a cena', () => {
  const scene = finale();
  scene.begin({ score: 70 });
  for (let i = 0; i < 200; i++) scene.update(0);
  assert.equal(scene.mode, 'approach');
  advance(scene, PHASE_FINALE_SECONDS + 0.5);
  assert.equal(scene.mode, 'done');
});

// --- 4. A PILHA DO CANVAS FECHA EQUILIBRADA ---------------------------------

test('render fecha a pilha do canvas em todos os modos', () => {
  const scene = finale();
  scene.begin({ score: 70, rootHealth: 82, infestation: 6, phase: 7 });

  const visited = new Set();
  for (let elapsed = 0; elapsed <= PHASE_FINALE_SECONDS + 1; elapsed += 1 / 60) {
    const canvas = recordingContext();
    assert.equal(scene.render(canvas.ctx), true);
    assert.equal(canvas.depth, 0, `pilha aberta no modo ${scene.mode}`);
    assert.equal(canvas.minDepth, 0, `restore a mais no modo ${scene.mode}`);
    visited.add(scene.mode);
    scene.update(1 / 60);
  }
  assert.deepEqual([...visited].sort(), ['approach', 'confirm', 'done', 'zoom']);
});

// --- 5. A ORDEM DA LEITURA: PLANTA PRIMEIRO, TEXTO DEPOIS -------------------

test('a planta aparece antes do cartao de texto', () => {
  const scene = finale();
  scene.begin({ score: 90, rootHealth: 95, infestation: 0, phase: 8 });

  let revealFirst = false;
  for (let elapsed = 0; elapsed <= PHASE_FINALE_SECONDS; elapsed += 1 / 60) {
    scene.update(1 / 60);
    if (scene.reveal > 0 && scene.cardAlpha === 0) revealFirst = true;
    // O cartão nunca pode estar visível com a planta ainda invisível.
    assert.ok(!(scene.cardAlpha > 0 && scene.reveal === 0));
  }
  assert.ok(revealFirst, 'houve um trecho com a planta ja visivel e o cartao ainda nao');
});

test('a planta so e desenhada depois de comecar a aparecer', () => {
  const scene = finale();
  scene.begin({ score: 90 });

  // Ainda na aproximação: `reveal` é zero, então o broto não entra no quadro.
  const antes = recordingContext();
  scene.render(antes.ctx);
  const desenhosSemPlanta = antes.draws;

  advance(scene, PHASE_FINALE_SECONDS + 0.5);
  const depois = recordingContext();
  scene.render(depois.ctx);

  assert.equal(scene.reveal, 1);
  assert.ok(
    depois.draws > desenhosSemPlanta,
    `com a planta (${depois.draws}) devia desenhar mais que sem (${desenhosSemPlanta})`,
  );
});

test('planta vigorosa desenha mais que planta debilitada', () => {
  // A prova de que o estado não é só um rótulo: o feijoeiro doente tem menos
  // nós, sem flor e sem vagem, e isso aparece na contagem de primitivas.
  const contar = score => {
    const scene = finale();
    scene.begin({ score });
    advance(scene, PHASE_FINALE_SECONDS + 0.5);
    const canvas = recordingContext();
    scene.render(canvas.ctx);
    return canvas.draws;
  };

  const doente = contar(30);
  const sadia = contar(70);
  const vigorosa = contar(95);
  assert.ok(doente < sadia, `doente ${doente} < sadia ${sadia}`);
  assert.ok(sadia < vigorosa, `sadia ${sadia} < vigorosa ${vigorosa}`);
});

test('render sobrevive a um canvas sem roundRect', () => {
  // `roundRect` é recente. O módulo tem que cair no retângulo reto sem quebrar.
  const scene = finale();
  scene.begin({ score: 70, rootHealth: 80, infestation: 3, phase: 5 });
  advance(scene, PHASE_FINALE_SECONDS + 0.5);

  const canvas = recordingContext();
  delete canvas.ctx.roundRect;
  assert.doesNotThrow(() => scene.render(canvas.ctx));
  assert.equal(canvas.depth, 0);
});

// --- 6. A CENA CABE NA ESPERA QUE O JOGO JÁ FAZIA ---------------------------

test('a cena e mais curta que o stinger de vitoria', () => {
  // O stinger de vitória tem 10,24 s e `maybeAdvanceCampaign` espera o `ended`
  // dele. A cena tem que fechar bem antes, para o jogador olhar a planta parada
  // por alguns segundos em vez de a fase trocar no meio do afastamento.
  assert.ok(PHASE_FINALE_SECONDS < 10.24 - 3, `cena com ${PHASE_FINALE_SECONDS}s`);
});

test('sem audio a espera curta seria menor que a cena — por isso app.js espera', () => {
  // Este é o motivo do portão em `maybeAdvanceCampaign`: sem áudio a troca
  // aconteceria em 3,4 s, cortando a cena. Se algum dia a constante crescer e a
  // desigualdade se inverter, o portão vira código morto e este teste avisa.
  assert.ok(PHASE_VICTORY_TRANSITION_SECONDS < PHASE_FINALE_SECONDS);

  const app = readFileSync(new URL('../src/procgen/app.js', import.meta.url), 'utf8');
  assert.match(app, /phaseFinale\.active[\s\S]{0,120}phaseFinale\.mode !== 'done'/);
  assert.match(app, /campaign\.finaleDeadline = sim\.state\.time \+ PHASE_FINALE_SECONDS/);
});

// --- 7. A LIGAÇÃO COM O JOGO ------------------------------------------------

test('app.js dispara a cena no ponto da captura do relatorio e limpa na fase nova', () => {
  const app = readFileSync(new URL('../src/procgen/app.js', import.meta.url), 'utf8');

  // Disparo: dentro do bloco de captura, DEPOIS de `buildPhaseReport`, com o
  // relatório real. Esse é o único ponto em que os objetivos já foram validados
  // pelo guard do `goal-system`.
  const captura = app.slice(
    app.indexOf('if (!campaign.transitionCaptured) {'),
    app.indexOf('gameAudio.beginPhaseVictory({'),
  );
  assert.ok(captura.includes('const report = buildPhaseReport();'));
  assert.ok(captura.includes('phaseFinale.begin(report);'));

  // Limpeza: toda fase nova começa com a cena ociosa.
  const init = app.slice(app.indexOf('function initGame('), app.indexOf('let phaseCardTimer'));
  assert.ok(init.includes('phaseFinale.reset();'));

  // Desenho: por cima do mundo, nunca por baixo.
  assert.ok(app.indexOf('renderWorld();\n    // Fora do `advance`') > 0);
  assert.ok(app.includes('phaseFinale.update(dt);'));
  assert.ok(app.includes('phaseFinale.render(ctx)'));
});

test('index.html apaga os leitores de HUD durante a cena, mas nao os controles', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const regra = html.slice(html.indexOf('body.phase-finale #hud-stock'));
  const bloco = regra.slice(0, regra.indexOf('}') + 1);

  for (const alvo of ['#hud-stock', '#hud-context', '#hud-alerts', '#objective-list']) {
    assert.ok(bloco.includes(`body.phase-finale ${alvo}`), `faltou ${alvo}`);
  }
  // Os controles e a mensagem de fim de campanha NÃO podem sumir: no fim da
  // campanha a tela final permanece com a cena parada em `done`.
  for (const alvo of ['#mobile-tools', '#touch-controls', '#mission', '#toast']) {
    assert.ok(!bloco.includes(alvo), `${alvo} nao pode ser escondido`);
  }
});
