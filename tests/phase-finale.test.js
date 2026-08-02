import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { createPhaseFinale, phaseFinaleSeconds } from '../src/procgen/phase-finale.js';
import {
  BEAN_PLANT_LABEL,
  beanPlantHeight,
  drawBeanPlant,
  plantStateFromScore,
} from '../src/render/bean-plant-visual.js';
import {
  drawFinalRoot,
  finalRootBounds,
  finalRootCollar,
  FINAL_ROOT_SCALE,
} from '../src/render/final-root-visual.js';
import { celebrationCycleSeconds, PLAYER_SKINS } from '../src/render/player-skins.js';
import { PHASE_VICTORY_TRANSITION_SECONDS } from '../src/audio-manifest.js';

// FIM DE FASE — CONTINUAÇÃO DA FASE, NÃO UMA SEGUNDA CENA
// =======================================================
//
// A primeira versão disto era o protótipo HTML encaixado depois da fase: mundo
// próprio, câmera própria, raiz própria e um Miguelito vetorial improvisado,
// pintando a tela inteira por cima do jogo.
//
// Estes testes existem para que aquilo não volte. Eles vigiam o CONTRATO da
// continuidade: nenhum canvas limpo, nenhuma câmera privada, nenhum segundo
// personagem, nenhum teleporte, e uma raiz só — a mesma antes, durante e depois
// do afastamento.

// --- DUPLOS -----------------------------------------------------------------

function recordingContext() {
  let depth = 0;
  let minDepth = 0;
  let draws = 0;
  const calls = [];
  const gradient = { addColorStop() {} };
  const noop = () => {};
  const paint = name => (...args) => { draws++; calls.push([name, ...args]); };
  const base = {
    save() { depth++; calls.push(['save']); },
    restore() { depth--; minDepth = Math.min(minDepth, depth); calls.push(['restore']); },
    translate: noop, scale: noop, rotate: noop, setTransform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, ellipse: noop, rect: noop, roundRect: noop,
    setLineDash: noop,
    clip() { calls.push(['clip']); },
    fill: paint('fill'), stroke: paint('stroke'),
    fillRect: paint('fillRect'), strokeRect: paint('strokeRect'),
    clearRect: paint('clearRect'),
    fillText: paint('fillText'), strokeText: paint('strokeText'), drawImage: paint('drawImage'),
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
    globalAlpha: 1,
  };
  const ctx = new Proxy(base, {
    get(target, key) { return key in target ? target[key] : undefined; },
    set(target, key, value) { target[key] = value; return true; },
  });
  return {
    ctx,
    get depth() { return depth; },
    get minDepth() { return minDepth; },
    get draws() { return draws; },
    get calls() { return calls; },
    named(name) { return calls.filter(call => call[0] === name); },
  };
}

// Câmera real, reduzida ao contrato que a cinemática usa. Ela guarda tudo que
// recebe para os testes poderem afirmar de onde a interpolação partiu.
function fakeCameraView(state, { width = 1280, height = 720 } = {}) {
  let active = false;
  const applied = [];
  return {
    beginCinematic() {
      active = true;
      return {
        x: state.cameraX, y: state.cameraY, zoom: state.cameraZoom,
        viewportWidth: width, viewportHeight: height,
        visibleWidth: width / state.cameraZoom, visibleHeight: height / state.cameraZoom,
      };
    },
    setCinematic(frame) {
      if (!active) return false;
      applied.push({ ...frame });
      if (Number.isFinite(frame.x)) state.cameraX = frame.x;
      if (Number.isFinite(frame.y)) state.cameraY = frame.y;
      if (Number.isFinite(frame.zoom)) state.cameraZoom = frame.zoom;
      return true;
    },
    endCinematic() { active = false; return true; },
    get cinematicActive() { return active; },
    get applied() { return applied; },
  };
}

function harness({ score = 70, width = 1280, height = 720 } = {}) {
  const state = {
    time: 12,
    gameState: 'transition',
    cameraX: 3400, cameraY: 210, cameraZoom: 1.45,
    viewportWidth: width, viewportHeight: height,
    player: { x: 4100, y: 480, w: 32, h: 48 },
    level: { goal: { x: 4120, y: 350, radius: 78, completed: true }, platforms: [] },
  };
  const cameraView = fakeCameraView(state, { width, height });
  const finale = createPhaseFinale({
    state, cameraView, getViewport: () => ({ width, height }),
  });
  const report = { score, rootHealth: 78, infestation: 6, phase: 6 };
  return { state, cameraView, finale, report };
}

const CELEBRATE = celebrationCycleSeconds(PLAYER_SKINS.miguelito);

function advance(finale, seconds, step = 1 / 60) {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += step) finale.update(step);
}

const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

// --- 1..5 · A ARQUITETURA DA SEGUNDA CENA NÃO PODE VOLTAR --------------------

test('phase-finale nao tem Miguelito proprio, camera propria nem teleporte', () => {
  const code = source('src/procgen/phase-finale.js');
  assert.ok(!/drawMiguelito/.test(code), 'drawMiguelito nao pode existir');
  assert.ok(!/miguelX/.test(code), 'miguelX nao pode existir');
  assert.ok(!/CAM_START|CAM_END/.test(code), 'camera privada nao pode existir');
  assert.ok(!/createPlayerSprite/.test(code), 'a cinematica nao cria sprite de jogador');
  assert.ok(!/state\.player\s*=|player\.x\s*=|player\.y\s*=/.test(code), 'nao mexe no jogador');
  // Nada de mundo proprio: as coordenadas absolutas do prototipo sumiram.
  assert.ok(!/PLANT_X|SOIL_Y|WORLD_H\b/.test(code));
});

test('phase-finale nao limpa nem repinta o canvas inteiro', () => {
  const code = source('src/procgen/phase-finale.js');
  assert.ok(!/clearRect/.test(code), 'nao pode limpar o canvas');
  // O unico fillRect de tela cheia possivel seria em coordenadas de tela; o
  // cartao usa rect/roundRect, e o ceu e recortado acima da superficie.
  assert.ok(!/fillRect\(0,\s*0,\s*width,\s*height\)/.test(code));

  const { finale, report, state } = harness();
  finale.begin({ report, celebrationSeconds: CELEBRATE });
  advance(finale, phaseFinaleSeconds(CELEBRATE) + 0.5);
  const canvas = recordingContext();
  finale.renderWorldLayer(canvas.ctx);
  finale.renderOverlay(canvas.ctx);
  assert.equal(canvas.named('clearRect').length, 0);
  // O ceu e desenhado dentro de um recorte, entao nada do subsolo e repintado.
  assert.ok(canvas.named('clip').length >= 1, 'o ceu precisa estar recortado');
  assert.equal(canvas.depth, 0);
  assert.equal(canvas.minDepth, 0);
  assert.ok(state.player.x === 4100 && state.player.y === 480);
});

test('ocioso: a cinematica nao desenha nada e nao toca na camera', () => {
  const { finale, cameraView, state } = harness();
  advance(finale, 30);
  assert.equal(finale.active, false);
  assert.equal(finale.mode, 'idle');
  assert.equal(cameraView.cinematicActive, false);
  assert.equal(cameraView.applied.length, 0);
  assert.equal(state.cameraZoom, 1.45);

  const canvas = recordingContext();
  assert.equal(finale.renderWorldLayer(canvas.ctx), false);
  assert.equal(finale.renderOverlay(canvas.ctx), false);
  assert.equal(canvas.draws, 0);
});

test('app.js continua desenhando o mundo real durante a cinematica', () => {
  const app = source('src/procgen/app.js');
  // A camada da cinematica entra DEPOIS do renderizador normal, dentro do
  // mesmo `renderWorld` — o mundo da fase nunca deixa de ser desenhado.
  const render = app.slice(app.indexOf('function renderWorld()'), app.indexOf('function loop('));
  assert.ok(render.includes('renderer.render();'));
  assert.ok(render.indexOf('renderer.render();') < render.indexOf('phaseFinale.renderWorldLayer(ctx);'));
  assert.ok(render.includes('sim.goal.render(ctx);'), 'a raiz final continua sendo desenhada pelo goal');
  // O cartao fica fora da transformacao de mundo.
  const loop = app.slice(app.indexOf('function loop('));
  assert.ok(loop.indexOf('renderWorld();') < loop.indexOf('phaseFinale.renderOverlay(ctx);'));
  // E o `update` roda ANTES do desenho, senao a camera do quadro fica atrasada.
  assert.ok(loop.indexOf('phaseFinale.update(dt);') < loop.indexOf('renderWorld();'));
});

// --- 6..10 · CÂMERA REAL, CONTÍNUA, SEM TELEPORTE ---------------------------

test('a interpolacao comeca nos valores REAIS da camera do instante da vitoria', () => {
  const { finale, cameraView, report, state } = harness();
  finale.begin({ report, celebrationSeconds: CELEBRATE });

  const start = finale.startCamera;
  assert.equal(start.x, 3400);
  assert.equal(start.y, 210);
  assert.equal(start.zoom, 1.45);
  // Primeiro quadro da cinematica = ultimo quadro jogavel.
  assert.deepEqual(
    [state.cameraX, state.cameraY, state.cameraZoom],
    [3400, 210, 1.45],
  );
  assert.equal(cameraView.cinematicActive, true);
});

test('raiz e jogador nao saltam na tela ao iniciar a cinematica', () => {
  const { finale, report, state } = harness();
  const goal = state.level.goal;
  const screen = () => {
    const zoom = state.cameraZoom;
    const collar = finalRootCollar(goal);
    return {
      raiz: [(collar.x - state.cameraX) * zoom, (collar.y - state.cameraY) * zoom],
      jogador: [(state.player.x - state.cameraX) * zoom, (state.player.y - state.cameraY) * zoom],
      escala: zoom,
    };
  };

  const antes = screen();
  finale.begin({ report, celebrationSeconds: CELEBRATE });
  finale.update(1 / 60);
  const depois = screen();

  for (const chave of ['raiz', 'jogador']) {
    assert.ok(Math.abs(antes[chave][0] - depois[chave][0]) <= 2, `${chave} saltou em x`);
    assert.ok(Math.abs(antes[chave][1] - depois[chave][1]) <= 2, `${chave} saltou em y`);
  }
  assert.equal(antes.escala, depois.escala, 'o tamanho na tela nao pode mudar');
});

test('a cinematica nunca escreve em state.player', () => {
  const { finale, report, state } = harness();
  const antes = { ...state.player };
  finale.begin({ report, celebrationSeconds: CELEBRATE });
  const canvas = recordingContext();
  for (let i = 0; i < 600; i++) {
    finale.update(1 / 60);
    finale.renderWorldLayer(canvas.ctx);
    finale.renderOverlay(canvas.ctx);
  }
  assert.deepEqual({ ...state.player }, antes);
});

test('a fase seguinte devolve a camera ao jogo', () => {
  const { finale, cameraView, report } = harness();
  finale.begin({ report, celebrationSeconds: CELEBRATE });
  advance(finale, phaseFinaleSeconds(CELEBRATE) + 0.5);
  assert.equal(cameraView.cinematicActive, true);
  finale.reset();
  assert.equal(cameraView.cinematicActive, false);
  assert.equal(finale.mode, 'idle');
});

test('camera-view: resetTracking limpa qualquer foco cinematico pendente', () => {
  const code = source('src/procgen/camera-view.js');
  const reset = code.slice(code.indexOf('function resetTracking()'), code.indexOf('function update(dt)'));
  assert.ok(reset.includes('cinematic = null;'));
  assert.ok(reset.includes('zoom = targetZoom;'));
  // Com foco ativo o rastreamento nao roda: senao a perseguicao ao jogador
  // desfaria o afastamento quadro a quadro.
  assert.match(code, /function update\(dt\) \{[\s\S]{0,240}if \(cinematic\) return;/);
});

// --- 11..15 · O MIGUELITO É O DO RENDERER -----------------------------------

test('o renderer pede celebrate em transition e em end', () => {
  const sprite = source('src/render/player-sprite.js');
  assert.match(sprite, /gameState === 'transition' \|\| gameState === 'end'\) return 'celebrate'/);
});

test('a folha da comemoracao e assets/miguelito/celebrate.png, 8 quadros a 6 fps', () => {
  const sheet = PLAYER_SKINS.miguelito.states.celebrate;
  assert.equal(sheet.src, 'assets/miguelito/celebrate.png');
  assert.equal(sheet.frames, 8);
  assert.equal(sheet.fps, 6);
});

test('o ciclo da comemoracao sai da folha, nao de um numero duplicado', () => {
  const sheet = PLAYER_SKINS.miguelito.states.celebrate;
  assert.equal(CELEBRATE, sheet.frames / sheet.fps);
  assert.ok(Math.abs(CELEBRATE - 1.3333) < 0.001);
  // O astronauta desenhado a mao nao tem folha: cai na definicao canonica.
  assert.equal(celebrationCycleSeconds(PLAYER_SKINS.astronaut), CELEBRATE);
  // E nem `app.js` nem a cinematica podem carregar 8/6 escrito a mao.
  assert.ok(!/frames:\s*8[\s\S]{0,80}fps:\s*6/.test(source('src/procgen/phase-finale.js')));
  assert.match(source('src/procgen/app.js'), /celebrationCycleSeconds\(/);
});

test('o zoom principal so comeca depois do ciclo inteiro da comemoracao', () => {
  const { finale, report, state } = harness();
  finale.begin({ report, celebrationSeconds: CELEBRATE });

  // Um quadro antes do fim do ciclo: camera ainda no enquadramento do gameplay.
  advance(finale, CELEBRATE - 1 / 60);
  assert.equal(finale.mode, 'celebrate');
  assert.deepEqual([state.cameraX, state.cameraY, state.cameraZoom], [3400, 210, 1.45]);

  // O ciclo fecha e a cena passa ao pulso — a camera continua parada.
  advance(finale, 2 / 60);
  assert.equal(finale.mode, 'rootPulse');
  assert.deepEqual([state.cameraX, state.cameraY, state.cameraZoom], [3400, 210, 1.45]);

  // Só no `reveal` a câmera se mexe.
  advance(finale, 1.0);
  assert.equal(finale.mode, 'reveal');
  assert.notEqual(state.cameraZoom, 1.45);
});

test('os oito quadros da comemoracao cabem no tempo em que a camera fica parada', () => {
  const sheet = PLAYER_SKINS.miguelito.states.celebrate;
  const { finale, report } = harness();
  finale.begin({ report, celebrationSeconds: CELEBRATE });
  let quadrosVistos = 0;
  let ultimo = -1;
  for (let t = 0; finale.mode === 'celebrate'; t += 1 / 60) {
    const frame = Math.floor(t * sheet.fps) % sheet.frames;
    if (frame !== ultimo) { quadrosVistos++; ultimo = frame; }
    finale.update(1 / 60);
  }
  assert.equal(quadrosVistos, sheet.frames, 'todos os oito quadros passam antes do zoom');
});

// --- 16..17 · UMA RAIZ SÓ, E O COLO É UM PONTO SÓ ---------------------------

test('goal-system e a cinematica usam o mesmo modelo de raiz', () => {
  const goalSystem = source('src/procgen/goal-system.js');
  const finaleCode = source('src/procgen/phase-finale.js');
  assert.match(goalSystem, /from '\.\.\/render\/final-root-visual\.js'/);
  assert.match(goalSystem, /drawFinalRoot\(ctx, goal/);
  // A cinematica LE os limites e empurra o pulso; nao desenha raiz nenhuma.
  assert.match(finaleCode, /finalRootBounds/);
  assert.ok(!/drawFinalRoot/.test(finaleCode), 'a cinematica nao desenha a raiz');
  assert.match(finaleCode, /finalRootPulse/);
  // E nao sobrou nenhuma geometria de raiz escrita a mao no goal-system.
  assert.ok(!/bezierCurveTo\(-18, -138/.test(goalSystem), 'a raiz antiga foi removida');
});

test('a mesma raiz aparece antes, durante e depois do inicio do zoom', () => {
  const { finale, report, state } = harness();
  const goal = state.level.goal;

  const desenhar = () => {
    const canvas = recordingContext();
    drawFinalRoot(canvas.ctx, goal, {
      pulse: Number(state.level.finalRootPulse) || 0,
      time: state.time,
    });
    return canvas.draws;
  };

  const antes = desenhar();
  finale.begin({ report, celebrationSeconds: CELEBRATE });
  const durante = desenhar();
  advance(finale, phaseFinaleSeconds(CELEBRATE) + 0.5);
  const depois = desenhar();

  // O pulso acrescenta uma passada de aura; a geometria e as camadas continuam
  // as mesmas — a raiz nunca some nem e trocada por outra.
  assert.ok(antes > 0);
  assert.ok(durante >= antes);
  assert.ok(depois >= antes);
});

test('o colo da raiz e o pe do caule sao o mesmo ponto', () => {
  const goal = { x: 4120, y: 350 };
  const collar = finalRootCollar(goal);
  const bounds = finalRootBounds(goal, FINAL_ROOT_SCALE);
  assert.equal(bounds.collarX, collar.x);
  assert.equal(bounds.collarY, collar.y);

  // O primeiro ponto da raiz e a origem local; o caule tambem sai de (0,0).
  const canvas = recordingContext();
  const desenhou = drawBeanPlant(canvas.ctx, {
    collarX: collar.x, collarY: collar.y, scale: FINAL_ROOT_SCALE, plantState: 1, growth: 1,
  });
  assert.equal(desenhou, true);

  const finaleCode = source('src/procgen/phase-finale.js');
  // O colo do desenho da planta vem de `finalRootBounds`, nao de um numero solto.
  assert.match(finaleCode, /collar = \{ x: bounds\.collarX, y: bounds\.collarY \}/);
  assert.match(finaleCode, /collarX: collar\.x,\s*\n\s*collarY: collar\.y,/);
});

// --- 18..21 · OS TRÊS PORTES SÃO VISUALMENTE DIFERENTES ---------------------

test('a nota escolhe o porte, com cortes estaveis', () => {
  assert.equal(plantStateFromScore(0), 0);
  assert.equal(plantStateFromScore(54.9), 0);
  assert.equal(plantStateFromScore(55), 1);
  assert.equal(plantStateFromScore(84.9), 1);
  assert.equal(plantStateFromScore(85), 2);
  // Relatorio ausente nao pode punir com planta murcha (`Number(null)` e 0).
  for (const valor of [undefined, null, NaN, '', '70', {}]) {
    assert.equal(plantStateFromScore(valor), 1, `valor ${String(valor)}`);
  }
  assert.deepEqual([...BEAN_PLANT_LABEL], [
    'Feijoeiro doente', 'Feijoeiro sadio', 'Feijoeiro super sadio',
  ]);
});

test('doente e menor, sadio intermediario, super sadio maior', () => {
  assert.ok(beanPlantHeight(0) < beanPlantHeight(1));
  assert.ok(beanPlantHeight(1) < beanPlantHeight(2));
});

test('doente nao tem flor nem vagem; sadio tem; super sadio tem mais', () => {
  const contar = plantState => {
    const canvas = recordingContext();
    drawBeanPlant(canvas.ctx, {
      collarX: 0, collarY: 0, scale: 1, plantState, growth: 1, time: 0,
    });
    return canvas.draws;
  };
  const doente = contar(0);
  const sadio = contar(1);
  const superSadio = contar(2);
  assert.ok(doente < sadio, `doente ${doente} < sadio ${sadio}`);
  assert.ok(sadio < superSadio, `sadio ${sadio} < super ${superSadio}`);

  // O que separa os tres nao e so tamanho: flor e vagem existem ou nao.
  const plant = source('src/render/bean-plant-visual.js');
  assert.match(plant, /flowers: false, pods: false/);
  assert.equal((plant.match(/flowers: true, pods: true/g) || []).length, 2);
  assert.match(plant, /function drawFlowerCluster/);
  assert.match(plant, /function drawPod/);
  assert.match(plant, /function drawCotyledonPair/);
  assert.match(plant, /function drawTrifoliate/);
});

test('a planta cresce a partir do colo em vez de aparecer inteira', () => {
  const contar = growth => {
    const canvas = recordingContext();
    drawBeanPlant(canvas.ctx, { collarX: 0, collarY: 0, scale: 1, plantState: 2, growth });
    return canvas.draws;
  };
  assert.equal(contar(0), 0);
  assert.ok(contar(0.3) < contar(0.7));
  assert.ok(contar(0.7) < contar(1));
});

// --- 22..25 · CARTÃO E ENQUADRAMENTO ----------------------------------------

test('o cartao so aparece depois de a planta estar visivel', () => {
  const { finale, report } = harness();
  finale.begin({ report, celebrationSeconds: CELEBRATE });
  let plantaAntes = false;
  for (let t = 0; t < phaseFinaleSeconds(CELEBRATE); t += 1 / 60) {
    finale.update(1 / 60);
    assert.ok(!(finale.cardAlpha > 0 && finale.growth === 0), 'cartao antes da planta');
    if (finale.growth > 0.5 && finale.cardAlpha === 0) plantaAntes = true;
  }
  assert.ok(plantaAntes, 'houve um trecho com a planta ja crescida e o cartao ainda nao');
  assert.ok(finale.cardAlpha > 0.99);
});

test('o enquadramento final contem a copa e a ponta da raiz — paisagem e retrato', () => {
  for (const [nome, width, height] of [['paisagem', 1280, 720], ['retrato', 360, 720]]) {
    for (const score of [30, 70, 95]) {
      const { finale, report, state } = harness({ score, width, height });
      finale.begin({ report, celebrationSeconds: CELEBRATE });
      advance(finale, phaseFinaleSeconds(CELEBRATE) + 0.5);
      assert.equal(finale.mode, 'done', `${nome}/${score}`);

      const zoom = state.cameraZoom;
      const topo = state.cameraY;
      const base = state.cameraY + height / zoom;
      const esquerda = state.cameraX;
      const direita = state.cameraX + width / zoom;
      const bounds = finalRootBounds(state.level.goal, FINAL_ROOT_SCALE);
      const copa = bounds.collarY - beanPlantHeight(finale.plantState) * FINAL_ROOT_SCALE;

      assert.ok(copa > topo, `${nome}/${score}: copa cortada em cima`);
      assert.ok(bounds.tipY < base, `${nome}/${score}: ponta da raiz cortada embaixo`);
      assert.ok(bounds.minX > esquerda && bounds.maxX < direita, `${nome}/${score}: raiz cortada nos lados`);

      // E a copa fica ABAIXO da faixa reservada ao cartao.
      const copaNaTela = (copa - topo) * zoom;
      assert.ok(copaNaTela > height * 0.16, `${nome}/${score}: copa atras do cartao`);
      // Nem miniatura ilegivel: a planta ocupa uma fatia util da altura.
      const alturaNaTela = beanPlantHeight(finale.plantState) * FINAL_ROOT_SCALE * zoom;
      assert.ok(alturaNaTela > height * 0.12, `${nome}/${score}: planta minuscula (${Math.round(alturaNaTela)}px)`);
    }
  }
});

test('o HUD some durante a cena, mas os controles ficam', () => {
  const html = source('index.html');
  const regra = html.slice(html.indexOf('body.phase-finale #hud-stock'));
  const bloco = regra.slice(0, regra.indexOf('}') + 1);
  for (const alvo of ['#hud-stock', '#hud-context', '#hud-alerts', '#objective-list', '#survival-hud']) {
    assert.ok(bloco.includes(`body.phase-finale ${alvo}`), `faltou ${alvo}`);
  }
  for (const alvo of ['#mobile-tools', '#touch-controls', '#mission', '#toast']) {
    assert.ok(!bloco.includes(alvo), `${alvo} nao pode ser escondido`);
  }
});

// --- 26..29 · FLUXO DA CAMPANHA ---------------------------------------------

test('a maquina de estados percorre celebrate, rootPulse, reveal, hold e done', () => {
  const { finale, report } = harness();
  assert.equal(finale.mode, 'idle');
  assert.equal(finale.begin({ report, celebrationSeconds: CELEBRATE }), true);

  const vistos = [];
  for (let t = 0; t < phaseFinaleSeconds(CELEBRATE) + 0.5; t += 1 / 60) {
    if (vistos.at(-1) !== finale.mode) vistos.push(finale.mode);
    finale.update(1 / 60);
  }
  if (vistos.at(-1) !== finale.mode) vistos.push(finale.mode);
  assert.deepEqual(vistos, ['celebrate', 'rootPulse', 'reveal', 'hold', 'done']);
});

test('sem audio a espera curta seria menor que a cena — por isso app.js espera', () => {
  assert.ok(PHASE_VICTORY_TRANSITION_SECONDS < phaseFinaleSeconds(CELEBRATE));
  const app = source('src/procgen/app.js');
  assert.match(app, /phaseFinale\.active[\s\S]{0,140}phaseFinale\.mode !== 'done'/);
});

test('com audio o stinger continua sendo mais longo que a cena', () => {
  // O stinger de vitoria tem 10,24 s e e ele quem decide a troca quando ha som.
  assert.ok(phaseFinaleSeconds(CELEBRATE) < 10.24, `cena com ${phaseFinaleSeconds(CELEBRATE)}s`);
});

test('falha da cinematica nao prende a campanha', () => {
  const app = source('src/procgen/app.js');
  assert.match(app, /campaign\.finaleDeadline = sim\.state\.time \+ phaseFinaleSeconds\(celebrationSeconds\) \+ 1\.5/);
  assert.match(app, /sim\.state\.time < \(campaign\.finaleDeadline \|\| 0\)/);

  // E sem gol nao ha cinematica: `begin` recusa em vez de travar.
  const { finale, report, state } = harness();
  state.level.goal = null;
  assert.equal(finale.begin({ report, celebrationSeconds: CELEBRATE }), false);
  assert.equal(finale.mode, 'idle');
});

test('begin repetido nao reinicia uma cena em andamento', () => {
  const { finale, report } = harness({ score: 95 });
  assert.equal(finale.begin({ report, celebrationSeconds: CELEBRATE }), true);
  advance(finale, CELEBRATE + 0.5);
  assert.equal(finale.mode, 'rootPulse');
  assert.equal(finale.begin({ report: { score: 10 }, celebrationSeconds: CELEBRATE }), false);
  assert.equal(finale.plantState, 2);
});

test('a duracao nao depende da taxa de quadros e dt zero nao adianta a cena', () => {
  for (const step of [1 / 120, 1 / 60, 1 / 30]) {
    const { finale, report } = harness();
    finale.begin({ report, celebrationSeconds: CELEBRATE });
    advance(finale, phaseFinaleSeconds(CELEBRATE) - 0.2, step);
    assert.notEqual(finale.mode, 'done', `${Math.round(1 / step)} fps: cedo demais`);
    advance(finale, 0.4, step);
    assert.equal(finale.mode, 'done', `${Math.round(1 / step)} fps: devia ter fechado`);
  }
  const { finale, report } = harness();
  finale.begin({ report, celebrationSeconds: CELEBRATE });
  for (let i = 0; i < 300; i++) finale.update(0);
  assert.equal(finale.mode, 'celebrate');
});

test('a pilha do canvas fecha equilibrada em todos os modos', () => {
  const { finale, report } = harness();
  finale.begin({ report, celebrationSeconds: CELEBRATE });
  for (let t = 0; t <= phaseFinaleSeconds(CELEBRATE) + 0.5; t += 1 / 60) {
    const canvas = recordingContext();
    finale.renderWorldLayer(canvas.ctx);
    finale.renderOverlay(canvas.ctx);
    assert.equal(canvas.depth, 0, `pilha aberta em ${finale.mode}`);
    assert.equal(canvas.minDepth, 0, `restore a mais em ${finale.mode}`);
    finale.update(1 / 60);
  }
});

test('render sobrevive a um canvas sem roundRect', () => {
  const { finale, report } = harness();
  finale.begin({ report, celebrationSeconds: CELEBRATE });
  advance(finale, phaseFinaleSeconds(CELEBRATE) + 0.5);
  const canvas = recordingContext();
  delete canvas.ctx.roundRect;
  assert.doesNotThrow(() => { finale.renderOverlay(canvas.ctx); });
  assert.equal(canvas.depth, 0);
});
