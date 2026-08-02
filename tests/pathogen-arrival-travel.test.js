import assert from 'node:assert/strict';
import test from 'node:test';

import {
  continuousMeanInterval,
  createPathogenArrival,
  PATHOGEN_ARRIVAL_DEFAULTS,
} from '../src/procgen/pathogen-arrival.js';
import { PATHOGEN_PRESSURE_DEFAULTS } from '../src/procgen/pathogen-pressure.js';
import { createPlatformVisuals } from '../src/procgen/platform-visuals.js';
import { createRalstoniaVascularWilt } from '../src/procgen/ralstonia-vascular-wilt.js';
import { MELOIDOGYNE_BASE_SPEED } from '../src/procgen/meloidogyne-lifecycle.js';
import { createSimulator } from '../src/procgen/simulator.js';

// CORREÇÕES DA ETAPA 2 — o relógio e o corpo
// ==========================================
//
// Duas coisas estavam erradas e são independentes uma da outra:
//
//   1. A FREQUÊNCIA respondia à FAIXA, não ao valor. Pressão 9 e pressão 15
//      caíam na mesma faixa e produziam o mesmo relógio; em 16 havia um degrau
//      brusco. O jogador via a frequência mudar de repente sem nada ter mudado
//      de repente no solo, e não via nada mudar enquanto a pressão subia dentro
//      da faixa. Os testes 1-9 cobrem a interpolação que substituiu os degraus.
//
//   2. A CHEGADA era um desenho geométrico em cima do destino: elipse crescendo,
//      retângulo pontilhado e um contador em segundos. Isso avisava onde olhar
//      sem nunca mostrar a coisa, e o "aviso" aparecia num lugar onde ainda não
//      havia patógeno nenhum. Os testes 10-25 cobrem a origem física, o
//      deslocamento e o que sumiu da tela.

const PRESSURE = PATHOGEN_PRESSURE_DEFAULTS;
const ARRIVAL = PATHOGEN_ARRIVAL_DEFAULTS;
const STEP = 1 / 60;

function root(index, overrides = {}) {
  return {
    x: 300 + index * 520, y: 500, w: 220, h: 54,
    type: 'root', logicIndex: index, rootHealth: 1,
    ...overrides,
  };
}

function fakeSystems() {
  const meloArrivals = [];
  const ralstoniaArrivals = [];
  // Fechamento, e nao `this`: o controlador extrai o metodo para chamar
  // (`const api = arrivalApi(pathogen)`), entao um duplo que dependa de `this`
  // quebra por motivo de teste, nao de produto.
  const juveniles = [];
  const galls = [];
  const eggMasses = [];
  const foci = [];
  let groupSerial = 0;
  // O duplo precisa cobrir o CONTRATO NOVO: o controlador nao conta mais a
  // chegada ao criar os J2 — ele observa o grupo e conta quando alguem alcanca
  // a rizosfera. Sem `arrivalGroupSnapshot` aqui, ele observaria o vazio.
  const meloidogyneLifecycle = {
    juveniles,
    galls,
    eggMasses,
    introduceJ2Arrival(request) {
      meloArrivals.push(request);
      const groupId = `fake-group-${++groupSerial}`;
      const speed = request.travelSpeed || 47;
      const pathLength = 600;
      const created = [0, 1].map(() => ({
        alive: true, state: 'seeking',
        x: request.originX ?? 0, y: request.originY ?? 0,
        arrivalGroupId: groupId, arrivalTransit: true,
        arrivalCompleted: false, arrivalIntercepted: false,
        arrivalSpeed: speed, arrivalPathLength: pathLength,
        arrivalTraveled: 0, arrivalProgress: 0,
        arrivalPreferredRoot: request.preferredRoot || null,
      }));
      juveniles.push(...created);
      return {
        ...request, groupId, juveniles: created, count: created.length,
        speed, pathLength, travelSeconds: pathLength / speed, transit: true,
      };
    },
    arrivalGroupSnapshot(groupId) {
      const members = juveniles.filter(entry => entry.arrivalGroupId === groupId);
      const transit = members.filter(entry => entry.arrivalTransit && entry.alive);
      const arrived = members.filter(entry => entry.arrivalCompleted);
      const intercepted = members.filter(entry => entry.arrivalIntercepted);
      const mean = key => (transit.length
        ? transit.reduce((sum, entry) => sum + entry[key], 0) / transit.length : null);
      const pathLength = transit.length ? transit[0].arrivalPathLength : 600;
      const traveled = transit.length ? transit[0].arrivalTraveled : pathLength;
      return {
        groupId,
        memberCount: members.length,
        transitCount: transit.length,
        arrivedCount: arrived.length,
        interceptedCount: intercepted.length,
        meanX: mean('x'), meanY: mean('y'),
        pathLength, traveled,
        remaining: Math.max(0, pathLength - traveled),
        speed: transit.length ? transit[0].arrivalSpeed : 47,
        estimatedSecondsRemaining: Math.max(0, pathLength - traveled) / 47,
        progress: transit.length
          ? Math.min(.999, traveled / pathLength)
          : (arrived.length ? 1 : 0),
      };
    },
    releaseArrivalGroup(groupId) {
      const group = juveniles.filter(e => e.arrivalGroupId === groupId && e.arrivalTransit);
      for (const entry of group) {
        entry.arrivalTransit = false;
        entry.arrivalCompleted = true;
        entry.arrivalProgress = 1;
        entry.arrivalTraveled = entry.arrivalPathLength;
      }
      return group.length;
    },
    removeArrivalGroup(groupId) {
      let removed = 0;
      for (let index = juveniles.length - 1; index >= 0; index--) {
        if (juveniles[index].arrivalGroupId !== groupId || !juveniles[index].arrivalTransit) continue;
        juveniles.splice(index, 1);
        removed++;
      }
      return removed;
    },
    // Atalhos de teste: empurram o grupo pelo trajeto sem rodar o ciclo real.
    advanceGroup(groupId, pixels) {
      for (const entry of juveniles) {
        if (entry.arrivalGroupId !== groupId || !entry.arrivalTransit) continue;
        entry.arrivalTraveled = Math.min(entry.arrivalPathLength, entry.arrivalTraveled + pixels);
        entry.arrivalProgress = entry.arrivalTraveled / entry.arrivalPathLength;
        const root = entry.arrivalPreferredRoot;
        if (root) {
          const t = entry.arrivalProgress;
          entry.x = (entry.x) + (root.x + root.w * .4 - entry.x) * t;
          entry.y = (entry.y) + (root.y + 30 - entry.y) * t;
        }
        if (entry.arrivalTraveled >= entry.arrivalPathLength) {
          entry.arrivalTransit = false;
          entry.arrivalCompleted = true;
        }
      }
    },
    captureGroup(groupId) {
      for (const entry of juveniles) {
        if (entry.arrivalGroupId !== groupId || !entry.arrivalTransit) continue;
        entry.arrivalTransit = false;
        entry.arrivalIntercepted = true;
        entry.alive = false;
      }
    },
  };
  return {
    meloArrivals,
    ralstoniaArrivals,
    meloidogyneLifecycle,
    ralstoniaControl: {
      foci,
      introduceEnvironmentalInoculum(request) {
        ralstoniaArrivals.push(request);
        foci.push({ state: 'surface', neutralized: false, vascularLoad: 0 });
        return request;
      },
    },
  };
}

function harness({
  totalPressure = 4,
  band = 'safe',
  seed = 'travel',
  roots = null,
  cameraX = 0,
  cameraY = 0,
} = {}) {
  const platforms = roots || Array.from({ length: 6 }, (_, index) => root(index));
  const state = {
    time: 0,
    cameraX,
    cameraY,
    visibleWorldWidth: 1280,
    visibleWorldHeight: 720,
    campaign: { phase: 10, seed },
    player: { x: 120, y: 420, w: 30, h: 48 },
    level: {
      platforms,
      exudateClouds: [],
      exudates: [],
      microbeEncounters: [],
      ralstoniaTravelInoculum: [],
      pathogenPressure: { totalPressure, pressureBand: band, settings: PRESSURE },
      objectiveProgress: { attemptId: 1 },
    },
  };
  const systems = fakeSystems();
  const arrival = createPathogenArrival({ state, systems });
  arrival.reset();
  return { state, systems, arrival, platforms };
}

function advance(arrival, state, seconds, step = STEP) {
  const frames = Math.round(seconds / step);
  for (let frame = 0; frame < frames; frame++) {
    state.time += step;
    arrival.update(step);
  }
}

const intervalAt = pressure => continuousMeanInterval(pressure, PRESSURE, ARRIVAL).interval;

// ---------------------------------------------------------------------------
// 1-9 · A FREQUÊNCIA RESPONDE AO VALOR DA PRESSÃO
// ---------------------------------------------------------------------------

test('1. pressão zero dá exatamente o intervalo do solo saudável', () => {
  assert.equal(intervalAt(0), ARRIVAL.safeMeanIntervalSeconds);
});

test('2. cada antigo limite de faixa continua valendo o intervalo daquela faixa', () => {
  // Os limites viraram pontos de interpolação: exatamente neles o valor é o
  // mesmo de antes. É o que mantém a mudança compatível com o ajuste do Lab.
  assert.equal(intervalAt(PRESSURE.safeBandMaximum), ARRIVAL.moderateMeanIntervalSeconds);
  assert.equal(intervalAt(PRESSURE.moderateBandMaximum), ARRIVAL.highMeanIntervalSeconds);
  assert.equal(intervalAt(PRESSURE.highBandMaximum), ARRIVAL.criticalMeanIntervalSeconds);
});

test('3. entre dois pontos o intervalo é estritamente intermediário', () => {
  const middle = (PRESSURE.safeBandMaximum + PRESSURE.moderateBandMaximum) / 2;
  const value = intervalAt(middle);
  assert.ok(value < ARRIVAL.moderateMeanIntervalSeconds, 'não desceu do ponto de baixo');
  assert.ok(value > ARRIVAL.highMeanIntervalSeconds, 'passou do ponto de cima');
});

test('4. o intervalo cai monotonicamente com a pressão', () => {
  let previous = Infinity;
  for (let pressure = 0; pressure <= 60; pressure += 0.5) {
    const value = intervalAt(pressure);
    assert.ok(value <= previous + 1e-9, `subiu em pressão ${pressure}`);
    previous = value;
  }
});

test('5. duas pressões DENTRO da mesma faixa produzem intervalos diferentes', () => {
  // Este era o defeito: 9 e 15 caem as duas em `moderate` e antes davam o
  // mesmo relógio.
  const low = intervalAt(PRESSURE.safeBandMaximum + 1);
  const high = intervalAt(PRESSURE.moderateBandMaximum - 1);
  assert.ok(high < low - 1, `mesma faixa, mesmo intervalo: ${low} vs ${high}`);
});

test('6. não há degrau na fronteira das faixas', () => {
  for (const edge of [
    PRESSURE.safeBandMaximum,
    PRESSURE.moderateBandMaximum,
    PRESSURE.highBandMaximum,
  ]) {
    const before = intervalAt(edge - 0.01);
    const after = intervalAt(edge + 0.01);
    assert.ok(
      Math.abs(before - after) < 0.5,
      `salto de ${(before - after).toFixed(2)}s na fronteira ${edge}`,
    );
  }
});

test('7. acima do último ponto o intervalo ainda cai, mas nunca cruza o piso', () => {
  const atStop = intervalAt(PRESSURE.highBandMaximum);
  const beyond = intervalAt(PRESSURE.highBandMaximum * 3);
  const absurd = intervalAt(10000);
  assert.ok(beyond <= atStop, 'parou de responder acima do último ponto');
  assert.ok(absurd >= ARRIVAL.criticalMeanIntervalSeconds - 1e-9, 'cruzou o piso');
});

test('8. o detalhe da interpolação identifica os dois pontos e a fração', () => {
  const middle = (PRESSURE.safeBandMaximum + PRESSURE.moderateBandMaximum) / 2;
  const detail = continuousMeanInterval(middle, PRESSURE, ARRIVAL);
  assert.equal(detail.lowerStop.at, PRESSURE.safeBandMaximum);
  assert.equal(detail.upperStop.at, PRESSURE.moderateBandMaximum);
  assert.ok(Math.abs(detail.fraction - 0.5) < 1e-9);
  // A fração tem de reconstruir o intervalo, senão ela é decoração.
  const rebuilt = detail.lowerStop.interval
    + (detail.upperStop.interval - detail.lowerStop.interval) * detail.fraction;
  assert.ok(Math.abs(rebuilt - detail.interval) < 1e-9);
});

test('9. o controlador anda mais rápido com pressão maior DENTRO da mesma faixa', () => {
  const measure = totalPressure => {
    const { state, arrival } = harness({ totalPressure, band: 'moderate' });
    advance(arrival, state, 10);
    return arrival.arrivalProgress;
  };
  const low = measure(PRESSURE.safeBandMaximum + 0.5);
  const high = measure(PRESSURE.moderateBandMaximum - 0.5);
  assert.ok(high > low * 1.1, `mesma faixa, mesmo avanço: ${low} vs ${high}`);
});

test('10. o diagnóstico publica a interpolação, não só o intervalo final', () => {
  const { arrival } = harness({ totalPressure: 12, band: 'moderate' });
  const reading = arrival.update(STEP);
  assert.ok(reading.meanIntervalDetail, 'faltou meanIntervalDetail');
  assert.equal(reading.meanIntervalDetail.interval, reading.currentMeanInterval);
  assert.ok(Number.isFinite(reading.meanIntervalDetail.lowerStop.at));
  assert.ok(Number.isFinite(reading.meanIntervalDetail.fraction));
});

// ---------------------------------------------------------------------------
// 11-16 · A CHEGADA VEM DE ALGUM LUGAR
// ---------------------------------------------------------------------------

test('11. toda chegada declara um tipo de origem e coordenadas finitas', () => {
  const { state, arrival } = harness();
  arrival.forceArrival('ralstonia');
  const warning = state.level.pathogenArrival.warning;
  assert.ok(
    ['left', 'right', 'below', 'necrotic'].includes(warning.originType),
    `tipo de origem inesperado: ${warning.originType}`,
  );
  assert.ok(Number.isFinite(warning.originX));
  assert.ok(Number.isFinite(warning.originY));
  assert.ok(Number.isFinite(warning.targetY));
});

test('12. as origens laterais nascem FORA do trecho visível', () => {
  // Se a origem nascesse dentro da tela, o patógeno apareceria do nada no meio
  // do campo de visão — que é o defeito do marcador, com outro desenho.
  let checked = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const { state, arrival } = harness({ seed: `lateral-${attempt}`, cameraX: 900 });
    arrival.forceArrival('ralstonia');
    const warning = state.level.pathogenArrival.warning;
    if (warning.originType === 'left') {
      assert.ok(warning.originX < state.cameraX, 'a origem esquerda nasceu dentro da tela');
      checked++;
    }
    if (warning.originType === 'right') {
      const right = state.cameraX + state.visibleWorldWidth;
      assert.ok(warning.originX > right, 'a origem direita nasceu dentro da tela');
      checked++;
    }
  }
  assert.ok(checked > 0, 'nenhuma origem lateral foi sorteada em 30 tentativas');
});

test('13. a origem "below" nasce abaixo da raiz-alvo', () => {
  let checked = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const { state, arrival } = harness({ seed: `below-${attempt}` });
    arrival.forceArrival('ralstonia');
    const warning = state.level.pathogenArrival.warning;
    if (warning.originType !== 'below') continue;
    assert.ok(
      warning.originY > warning.targetY,
      'a origem de baixo nasceu acima do alvo',
    );
    checked++;
  }
  assert.ok(checked > 0, 'nenhuma origem "below" foi sorteada em 40 tentativas');
});

test('14. sem tecido morto, a origem necrótica nunca é sorteada', () => {
  // "Região necrótica publicada no nível" não existe como dado — `necrotic-zone`
  // é fundo decorativo. O equivalente real é tecido MORTO: raiz em colapso ou
  // com foco de fungo oportunista. Sem nenhuma delas, o tipo sai do sorteio.
  for (let attempt = 0; attempt < 40; attempt++) {
    const { state, arrival } = harness({ seed: `sem-necrose-${attempt}` });
    arrival.forceArrival('ralstonia');
    assert.notEqual(state.level.pathogenArrival.warning.originType, 'necrotic');
  }
});

test('15. com tecido morto por perto, a origem necrótica passa a aparecer', () => {
  const roots = [
    root(0, { rootHealth: 0.08, rootState: 'collapse' }),
    root(1),
    root(2),
    root(3),
  ];
  let seen = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const { state, arrival } = harness({ seed: `necrose-${attempt}`, roots: roots.map(r => ({ ...r })) });
    arrival.forceArrival('ralstonia');
    const warning = state.level.pathogenArrival.warning;
    if (warning.originType !== 'necrotic') continue;
    // Ela nasce DENTRO do tecido morto, não numa coordenada solta.
    const dead = state.level.platforms.find(entry => (entry.rootHealth ?? 1) < 0.3);
    assert.ok(warning.originX >= dead.x && warning.originX <= dead.x + dead.w);
    seen++;
  }
  assert.ok(seen > 0, 'com tecido morto disponível, a origem necrótica nunca saiu');
});

test('16. a origem é determinística pela seed e varia entre chegadas', () => {
  const run = seed => {
    const { state, arrival } = harness({ seed });
    const types = [];
    for (let index = 0; index < 5; index++) {
      arrival.forceArrival('ralstonia', { immediate: true });
      const started = state.level.pathogenArrival.eventHistory
        .filter(entry => entry.kind === 'travel-start');
      types.push(started.at(-1).originType);
    }
    return types;
  };
  assert.ok(run('origem-a').every(Boolean), 'alguma chegada saiu sem tipo de origem');
  assert.deepEqual(run('origem-a'), run('origem-a'), 'a mesma seed mudou de origem');
  const varied = new Set(run('origem-a').concat(run('origem-b')));
  assert.ok(varied.size > 1, 'a origem foi sempre a mesma em dez chegadas');
});

// ---------------------------------------------------------------------------
// 17-19 · OS J2 NASCEM NA ORIGEM
// ---------------------------------------------------------------------------

function realMeloHarness() {
  const sim = createSimulator();
  sim.state.level.dynamicPathogenArrival = true;
  sim.state.level.platforms = [
    { x: 300, y: 500, w: 240, h: 54, type: 'root', logicIndex: 1 },
    { x: 900, y: 480, w: 240, h: 54, type: 'root', logicIndex: 3 },
  ];
  sim.state.level.exudateClouds = [];
  sim.meloidogyneLifecycle.reset();
  return sim;
}

test('17. os J2 nascem na origem informada, não debaixo da raiz-alvo', () => {
  const sim = realMeloHarness();
  const target = sim.state.level.platforms[1];
  const originX = -420;
  const originY = 610;
  sim.meloidogyneLifecycle.introduceJ2Arrival({
    originX, originY, preferredRoot: target, source: 'test',
  });
  const juveniles = sim.meloidogyneLifecycle.juveniles;
  assert.ok(juveniles.length >= 1);
  for (const juvenile of juveniles) {
    assert.ok(Math.abs(juvenile.x - originX) < 60, `J2 fora da origem em x: ${juvenile.x}`);
    assert.ok(Math.abs(juvenile.y - originY) < 40, `J2 fora da origem em y: ${juvenile.y}`);
    // E longe do alvo — nascer no destino apagaria o percurso inteiro.
    assert.ok(Math.abs(juvenile.x - (target.x + target.w / 2)) > 800);
  }
});

test('18. a raiz preferida orienta o primeiro impulso do J2', () => {
  const sim = realMeloHarness();
  const target = sim.state.level.platforms[1];
  sim.meloidogyneLifecycle.introduceJ2Arrival({
    originX: -400, originY: 600, preferredRoot: target, source: 'test',
  });
  for (const juvenile of sim.meloidogyneLifecycle.juveniles) {
    assert.equal(juvenile.targetRoot, target, 'a preferência não foi registrada');
    assert.ok(juvenile.vx > 0, 'o J2 saiu nadando para longe da raiz preferida');
    assert.ok(juvenile.retarget > 0, 'a preferência seria descartada no primeiro quadro');
  }
});

test('19. a preferência não é destino fixo: o J2 troca por uma raiz mais atraente', () => {
  const sim = realMeloHarness();
  const near = sim.state.level.platforms[0];
  const far = sim.state.level.platforms[1];
  // Nasce perto da raiz 0, mas com preferência pela raiz 1 e uma nuvem forte
  // sobre a raiz 0. Depois do retarget, o gradiente ganha da preferência.
  sim.state.level.exudateClouds = [
    { x: near.x + near.w / 2, y: near.y - 10, radius: 150, life: 30, maxLife: 30 },
  ];
  sim.meloidogyneLifecycle.introduceJ2Arrival({
    originX: near.x + near.w / 2, originY: near.y + 70, preferredRoot: far, source: 'test',
  });
  const juvenile = sim.meloidogyneLifecycle.juveniles[0];
  assert.equal(juvenile.targetRoot, far, 'a preferência inicial não foi aplicada');
  for (let frame = 0; frame < 300 && juvenile.targetRoot === far; frame++) {
    sim.state.time += STEP;
    sim.meloidogyneLifecycle.update(STEP);
  }
  assert.notEqual(
    juvenile.targetRoot, far,
    'o J2 ignorou a nuvem e ficou preso na preferência',
  );
});

// ---------------------------------------------------------------------------
// 20-23 · O DESLOCAMENTO
// ---------------------------------------------------------------------------

test('20. o inóculo da Ralstonia é publicado no nível durante o percurso', () => {
  const { state, arrival } = harness();
  arrival.forceArrival('ralstonia');
  const travelling = state.level.ralstoniaTravelInoculum;
  assert.equal(travelling.length, 1, 'nenhum inóculo em trânsito no nível');
  assert.ok(Number.isFinite(travelling[0].x));
  assert.ok(Number.isFinite(travelling[0].y));
  assert.equal(state.level.ralstoniaFoci?.length ?? 0, 0, 'criou foco antes de chegar');
});

test('21. o inóculo se aproxima da raiz ao longo do percurso', () => {
  const { state, arrival } = harness();
  arrival.forceArrival('ralstonia');
  const inoculum = state.level.ralstoniaTravelInoculum[0];
  const targetX = state.level.pathogenArrival.warning.targetX;
  const startDistance = Math.abs(inoculum.x - targetX);
  advance(arrival, state, ARRIVAL.warningSeconds * 0.6);
  const midDistance = Math.abs(inoculum.x - targetX);
  assert.ok(midDistance < startDistance, 'o inóculo não andou em direção ao alvo');
  assert.ok(inoculum.progress > 0.4 && inoculum.progress < 1);
});

test('22. ao chegar, o inóculo some do nível e vira foco superficial', () => {
  const { state, arrival, systems } = harness();
  arrival.forceArrival('ralstonia');
  advance(arrival, state, ARRIVAL.warningSeconds + 0.5);
  assert.equal(state.level.ralstoniaTravelInoculum.length, 0, 'o inóculo ficou no mundo');
  assert.equal(systems.ralstoniaArrivals.length, 1);
  assert.equal(systems.ralstoniaControl.foci[0].vascularLoad, 0, 'entrou já no xilema');
});

test('23. cancelar o percurso retira o inóculo em trânsito', () => {
  const { state, arrival, systems } = harness();
  arrival.forceArrival('ralstonia');
  assert.equal(state.level.ralstoniaTravelInoculum.length, 1);
  arrival.cancelWarning();
  assert.equal(state.level.ralstoniaTravelInoculum.length, 0, 'sobrou inóculo órfão');
  assert.equal(systems.ralstoniaArrivals.length, 0);
});

test('24. o progresso do percurso vai de 0 a 1 no tempo de deslocamento', () => {
  const { state, arrival } = harness();
  arrival.forceArrival('ralstonia');
  assert.equal(state.level.pathogenArrival.warning.travelProgress, 0);
  assert.equal(
    state.level.pathogenArrival.warning.estimatedTravelSeconds,
    ARRIVAL.warningSeconds,
  );
  advance(arrival, state, ARRIVAL.warningSeconds / 2);
  const half = state.level.pathogenArrival.warning.travelProgress;
  assert.ok(half > 0.4 && half < 0.6, `progresso na metade: ${half}`);
  advance(arrival, state, ARRIVAL.warningSeconds / 2 + 0.2);
  assert.equal(state.level.pathogenArrival.warning, null);
});

// ---------------------------------------------------------------------------
// 25-28 · PONTUAÇÃO POR PATÓGENO
// ---------------------------------------------------------------------------

test('25. Meloidogyne penaliza tecido em colapso e prefere raiz viva', () => {
  // Ela estabelece sítio de alimentação e vira fêmea ali: raiz quase morta não
  // sustenta o ciclo. Não é preferência estética.
  const roots = [
    root(0, { rootHealth: 0.05, rootState: 'collapse' }),
    root(1, { rootHealth: 1 }),
  ];
  const { arrival } = harness({ roots });
  const scores = arrival.scoreTargets('meloidogyne');
  const dead = scores.find(entry => entry.logicIndex === 0);
  const alive = scores.find(entry => entry.logicIndex === 1);
  assert.ok(dead.tissue < 0, 'tecido morto não foi penalizado');
  assert.ok(alive.tissue > 0, 'tecido vivo não foi favorecido');
  assert.ok(alive.tissue > dead.tissue);
});

test('26. Ralstonia prefere raiz com ferida, mas alcança raiz intacta', () => {
  const roots = [
    root(0, { rootHealth: 1 }),
    root(1, { rootHealth: 1, woundOpening: 0.6 }),
  ];
  const { arrival } = harness({ roots });
  const scores = arrival.scoreTargets('ralstonia');
  const intact = scores.find(entry => entry.logicIndex === 0);
  const wounded = scores.find(entry => entry.logicIndex === 1);
  assert.ok(wounded.lesion > intact.lesion, 'a ferida não aumentou a preferência');
  // Sem exclusão: a raiz intacta continua sendo candidata pontuável.
  assert.ok(Number.isFinite(intact.score));
  assert.equal(intact.lesion, 0);
});

test('27. a colonização por Rhizoctonia e o fungo oportunista também abrem porta', () => {
  const roots = [
    root(0),
    root(1, { rhizoctoniaColonization: 0.4 }),
    root(2, { opportunisticFocus: true }),
  ];
  const { arrival } = harness({ roots });
  const scores = arrival.scoreTargets('ralstonia');
  assert.ok(scores.find(entry => entry.logicIndex === 1).lesion > 0);
  assert.ok(scores.find(entry => entry.logicIndex === 2).lesion > 0);
  assert.equal(scores.find(entry => entry.logicIndex === 0).lesion, 0);
});

test('28. o diagnóstico abre a pontuação parcela por parcela', () => {
  const { arrival } = harness();
  const reading = arrival.update(STEP);
  for (const pathogen of ['meloidogyne', 'ralstonia']) {
    const candidates = reading.candidateScores[pathogen];
    assert.ok(candidates.length > 0, `sem candidatos para ${pathogen}`);
    for (const key of [
      'logicIndex', 'x', 'y', 'score', 'cloud', 'distance',
      'tissue', 'occupancy', 'protection', 'lesion',
    ]) {
      assert.ok(key in candidates[0], `falta ${key} na pontuação de ${pathogen}`);
    }
    // Vêm ordenados: o primeiro é o alvo que seria escolhido agora.
    for (let index = 1; index < candidates.length; index++) {
      assert.ok(candidates[index - 1].score >= candidates[index].score);
    }
  }
});

// ---------------------------------------------------------------------------
// 29-30 · O QUE SAIU DA TELA
// ---------------------------------------------------------------------------

function recordingContext() {
  const calls = [];
  const gradient = { addColorStop() {} };
  const record = name => (...args) => { calls.push({ name, args }); };
  const base = {
    save: record('save'), restore: record('restore'),
    translate: record('translate'), scale: record('scale'), rotate: record('rotate'),
    beginPath: record('beginPath'), closePath: record('closePath'),
    moveTo: record('moveTo'), lineTo: record('lineTo'), arc: record('arc'),
    arcTo: record('arcTo'), quadraticCurveTo: record('quadraticCurveTo'),
    bezierCurveTo: record('bezierCurveTo'), ellipse: record('ellipse'),
    rect: record('rect'), roundRect: record('roundRect'),
    fill: record('fill'), stroke: record('stroke'), clip: record('clip'),
    fillRect: record('fillRect'), strokeRect: record('strokeRect'),
    clearRect: record('clearRect'), fillText: record('fillText'),
    strokeText: record('strokeText'), drawImage: record('drawImage'),
    setLineDash: record('setLineDash'),
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  const ctx = new Proxy(base, {
    get(target, key) { return key in target ? target[key] : undefined; },
    set() { return true; },
  });
  return { ctx, calls };
}

// Cena mínima: nenhuma plataforma, nenhum rótulo. Assim tudo o que for
// desenhado veio necessariamente do código de chegada.
function renderScene({ debug }) {
  const target = root(3);
  const state = {
    time: 4, cameraX: 0, cameraY: 0,
    visibleWorldWidth: 1280, visibleWorldHeight: 720,
    player: { x: 100, y: 400, w: 30, h: 48 },
    level: {
      platforms: [],
      worldLabels: [],
      traversalDebugVisible: debug,
      ralstoniaTravelInoculum: [{
        id: 'inoculo', x: 640, y: 560, originX: 200, originY: 620,
        targetRoot: target, progress: 0.5, wobblePhase: 1.2,
      }],
      pathogenArrival: {
        settings: { warningSeconds: 5 },
        candidateScores: { ralstonia: [], meloidogyne: [] },
        warning: {
          pathogen: 'ralstonia', targetRoot: target,
          targetX: target.x + target.w / 2, targetY: target.y,
          originType: 'left', originX: 200, originY: 620,
          travelProgress: 0.5, estimatedTravelSeconds: 5, timeRemaining: 2.5,
          travelPoint: { x: 640, y: 560 },
          entities: [], organisms: [],
        },
      },
    },
  };
  const { ctx, calls } = recordingContext();
  createPlatformVisuals({ state }).drawWorld(ctx);
  return calls;
}

test('29. no jogo normal o percurso é desenhado e o marcador geométrico não', () => {
  const calls = renderScene({ debug: false });
  // O inóculo é desenhado: elipse de mucilagem, bastonetes e rastro.
  assert.ok(calls.some(call => call.name === 'ellipse'), 'o inóculo não foi desenhado');
  assert.ok(calls.some(call => call.name === 'roundRect'), 'as células não foram desenhadas');
  // E nada do marcador: contorno pontilhado da raiz-alvo nem contagem em texto.
  assert.equal(
    calls.filter(call => call.name === 'strokeRect').length, 0,
    'o retângulo pontilhado em volta da raiz-alvo continua no jogo normal',
  );
  assert.equal(
    calls.filter(call => call.name === 'fillText').length, 0,
    'a contagem regressiva continua no jogo normal',
  );
  assert.equal(
    calls.filter(call => call.name === 'setLineDash').length, 0,
    'sobrou tracejado de marcador no jogo normal',
  );
});

test('30. com o painel de debug ligado, origem, trajetória e alvo voltam a aparecer', () => {
  const calls = renderScene({ debug: true });
  assert.ok(
    calls.some(call => call.name === 'strokeRect'),
    'o contorno da raiz-alvo não aparece nem no debug',
  );
  assert.ok(
    calls.some(call => call.name === 'fillText'),
    'o debug não escreve origem, progresso e tempo restante',
  );
  assert.ok(
    calls.some(call => call.name === 'setLineDash'),
    'a trajetória prevista não foi desenhada no debug',
  );
});

// ---------------------------------------------------------------------------
// 31-42 · A CHEGADA DE MELOIDOGYNE TAMBÉM ATRAVESSA O SOLO
// ---------------------------------------------------------------------------
//
// Antes: os J2 nasciam na origem e nadavam a 47 px/s pelo comportamento normal
// de busca. Com a origem a uma tela de distância, isso é meia fase de travessia
// — a chegada existia nos dados e não na tela. Agora eles têm um estado de
// APROXIMAÇÃO (`arrivalTransit`) conduzido pelo lifecycle durante
// `warningSeconds`, e só depois viram J2 comuns.

function transitHarness({ travelSpeed = MELOIDOGYNE_BASE_SPEED, originX = -300, originY = 620 } = {}) {
  const sim = createSimulator();
  sim.state.level.dynamicPathogenArrival = true;
  // Geometria realista: a 47 px/s a origem tem de estar a uma distancia
  // plausivel — e o que `constrainOriginToView` garante no jogo. Um alvo a duas
  // telas daria uma travessia de quase um minuto, que nao e o caso de uso.
  sim.state.level.platforms = [
    { x: 900, y: 500, w: 240, h: 54, type: 'root', logicIndex: 1 },
    { x: 300, y: 470, w: 240, h: 54, type: 'root', logicIndex: 4 },
  ];
  sim.state.level.exudateClouds = [];
  sim.meloidogyneLifecycle.reset();
  const target = sim.state.level.platforms[1];
  const result = sim.meloidogyneLifecycle.introduceJ2Arrival({
    originX, originY, preferredRoot: target, travelSpeed, source: 'test',
  });
  return { sim, target, result };
}

function runLifecycle(sim, seconds, step = STEP) {
  const frames = Math.round(seconds / step);
  for (let frame = 0; frame < frames; frame++) {
    sim.state.time += step;
    sim.meloidogyneLifecycle.update(step);
  }
}

const distanceToRoot = (juvenile, root) => Math.hypot(
  juvenile.x - (root.x + root.w / 2),
  juvenile.y - root.y,
);

test('31. a chegada cria um grupo de J2 em aproximação, com identidade comum', () => {
  const { sim, result } = transitHarness();
  const juveniles = sim.meloidogyneLifecycle.juveniles;
  assert.ok(juveniles.length >= 2 && juveniles.length <= 3, `grupo de ${juveniles.length}`);
  assert.equal(sim.meloidogyneLifecycle.arrivalTransitCount, juveniles.length);
  for (const juvenile of juveniles) {
    assert.equal(juvenile.arrivalTransit, true);
    assert.equal(juvenile.arrivalGroupId, result.groupId, 'J2 da mesma chegada em grupos diferentes');
    assert.equal(juvenile.arrivalProgress, 0);
    assert.equal(juvenile.arrivalSpeed, MELOIDOGYNE_BASE_SPEED);
    // A duracao NAO e um parametro: ela sai do comprimento da propria curva.
    assert.ok(juvenile.arrivalPathLength > 0);
    assert.ok(Math.abs(
      juvenile.arrivalDuration - juvenile.arrivalPathLength / MELOIDOGYNE_BASE_SPEED,
    ) < 1e-6);
  }
  assert.ok(result.travelSeconds > 0);
  assert.equal(result.speed, MELOIDOGYNE_BASE_SPEED);
});

test('32. em aproximação o J2 não penetra e não faz o retarget normal', () => {
  const { sim, target } = transitHarness();
  // Uma nuvem forte na OUTRA raiz, bem no caminho. Durante a aproximação ela
  // não pode desviar ninguém: o retarget está suspenso.
  const decoy = sim.state.level.platforms[0];
  sim.state.level.exudateClouds = [
    { x: decoy.x + decoy.w / 2, y: decoy.y - 10, radius: 200, life: 60, maxLife: 60 },
  ];
  runLifecycle(sim, 3);
  for (const juvenile of sim.meloidogyneLifecycle.juveniles) {
    assert.equal(juvenile.state, 'seeking', 'começou a penetrar durante a aproximação');
    assert.equal(juvenile.arrivalPreferredRoot, target);
    assert.ok(juvenile.arrivalTransit, 'a aproximação terminou cedo demais');
  }
  assert.equal(sim.meloidogyneLifecycle.gallCount, 0);
});

test('33. o grupo atravessa o solo: a distância até a raiz cai ao longo do percurso', () => {
  const { sim, target, result } = transitHarness();
  const juvenile = sim.meloidogyneLifecycle.juveniles[0];
  const start = distanceToRoot(juvenile, target);
  const samples = [start];
  for (let quarter = 0; quarter < 4; quarter++) {
    runLifecycle(sim, result.travelSeconds / 4);
    samples.push(distanceToRoot(juvenile, target));
  }
  for (let index = 1; index < samples.length; index++) {
    assert.ok(
      samples[index] < samples[index - 1],
      `o grupo parou de se aproximar entre as amostras ${index - 1} e ${index}: ${samples.join(' -> ')}`,
    );
  }
  assert.ok(samples.at(-1) < start * 0.25, `terminou longe demais: ${samples.at(-1)} de ${start}`);
});

test('34. o percurso dura o comprimento dividido pela velocidade, e devolve o J2 à busca', () => {
  const { sim, target, result } = transitHarness();
  const expected = result.travelSeconds;
  // A duracao nao e escolhida: e consequencia. Percorrer 47px leva 1s, sempre.
  assert.ok(
    Math.abs(expected - result.pathLength / MELOIDOGYNE_BASE_SPEED) < 1e-6,
    'a duracao nao saiu do comprimento da trajetoria',
  );
  runLifecycle(sim, expected * 0.85);
  assert.ok(sim.meloidogyneLifecycle.arrivalTransitCount > 0, 'terminou antes da hora');
  runLifecycle(sim, expected * 0.4);
  assert.equal(sim.meloidogyneLifecycle.arrivalTransitCount, 0, 'não terminou no tempo');
  for (const juvenile of sim.meloidogyneLifecycle.juveniles) {
    assert.equal(juvenile.arrivalTransit, false);
    assert.equal(juvenile.arrivalCompleted, true, 'não foi marcado como chegado');
    // Liberado para o ciclo normal: ou ainda procurando, ou ja entrando na
    // raiz. O que nao pode e ter ficado preso no estado de aproximacao.
    assert.ok(
      ['seeking', 'penetrating', 'migrating'].includes(juvenile.state),
      `estado inesperado depois da liberacao: ${juvenile.state}`,
    );
    // Chegou na rizosfera: perto da raiz.
    assert.ok(distanceToRoot(juvenile, target) < 220);
  }
});

test('35. a aproximação usa dt, não a contagem de quadros', () => {
  const measure = step => {
    const { sim } = transitHarness();
    runLifecycle(sim, 6, step);
    return sim.meloidogyneLifecycle.juveniles[0].arrivalProgress;
  };
  const fine = measure(1 / 120);
  const coarse = measure(1 / 30);
  assert.ok(Math.abs(fine - coarse) < 0.02, `progresso divergiu: ${fine} vs ${coarse}`);
});

test('36. a aproximação acompanha a raiz se ela se mover', () => {
  const { sim, target, result } = transitHarness();
  runLifecycle(sim, result.travelSeconds * 0.4);
  target.x += 600;
  // O percurso ficou mais longo, entao a viagem demora mais — o grupo NAO
  // acelera para compensar, e por isso o tempo extra e generoso.
  runLifecycle(sim, result.travelSeconds * 2 + 600 / MELOIDOGYNE_BASE_SPEED);
  for (const juvenile of sim.meloidogyneLifecycle.juveniles) {
    assert.ok(
      distanceToRoot(juvenile, target) < 260,
      'o grupo foi para onde a raiz estava, não para onde ela está',
    );
  }
});

test('37. cada J2 tem seu próprio desvio: o grupo não viaja empilhado', () => {
  const { sim } = transitHarness();
  runLifecycle(sim, 6);
  const juveniles = sim.meloidogyneLifecycle.juveniles;
  let maxSeparation = 0;
  for (let a = 0; a < juveniles.length; a++) {
    for (let b = a + 1; b < juveniles.length; b++) {
      maxSeparation = Math.max(
        maxSeparation,
        Math.hypot(juveniles[a].x - juveniles[b].x, juveniles[a].y - juveniles[b].y),
      );
    }
  }
  assert.ok(maxSeparation > 8, `os J2 viajaram colados: separação máxima ${maxSeparation}`);
  assert.ok(maxSeparation < 400, `os J2 se perderam uns dos outros: ${maxSeparation}`);
});

test('38. a mesma chegada produz a mesma trajetória', () => {
  const trace = () => {
    const { sim } = transitHarness();
    const path = [];
    for (let sample = 0; sample < 5; sample++) {
      runLifecycle(sim, 2);
      const juvenile = sim.meloidogyneLifecycle.juveniles[0];
      path.push([Math.round(juvenile.x), Math.round(juvenile.y)]);
    }
    return path;
  };
  assert.deepEqual(trace(), trace(), 'a trajetória mudou entre duas execuções iguais');
});

test('39. sem tempo de percurso o comportamento antigo continua igual', () => {
  // A eclosão de uma massa de ovos não é uma chegada: o J2 nasce na raiz e já
  // procura. Só a chegada externa tem aproximação.
  const { sim } = transitHarness({ travelSpeed: 0 });
  for (const juvenile of sim.meloidogyneLifecycle.juveniles) {
    assert.ok(!juvenile.arrivalTransit, 'criou aproximação sem tempo de percurso');
  }
  assert.equal(sim.meloidogyneLifecycle.arrivalTransitCount, 0);
});

test('40. o controlador não move os J2 — quem conduz é o lifecycle', () => {
  // Se os dois empurrassem o mesmo J2 no mesmo quadro, o movimento seria a soma
  // de duas intenções e nenhuma apareceria direito.
  const { state, arrival, systems } = harness();
  arrival.forceArrival('meloidogyne');
  const warning = state.level.pathogenArrival.warning;
  assert.ok(warning.organisms.length > 0, 'os J2 não foram registrados na chegada');
  assert.equal(warning.entities.length, 0, 'o controlador criou entidade própria para os J2');
  const before = warning.organisms.map(entry => ({ x: entry.x, y: entry.y }));
  advance(arrival, state, ARRIVAL.warningSeconds * 0.5);
  // O duplo não roda o lifecycle, então nada pode ter movido estes J2.
  for (let index = 0; index < before.length; index++) {
    assert.equal(systems.meloidogyneLifecycle.juveniles[index].x, before[index].x);
    assert.equal(systems.meloidogyneLifecycle.juveniles[index].y, before[index].y);
  }
});

test('41. a chegada passa a VELOCIDADE para o ciclo, não uma duração', () => {
  const { state, arrival, systems } = harness();
  arrival.forceArrival('meloidogyne');
  const request = systems.meloArrivals.at(-1);
  assert.equal(request.travelSpeed, MELOIDOGYNE_BASE_SPEED);
  assert.equal(request.travelSeconds, undefined, 'ainda manda duração pronta');
  assert.ok(Number.isFinite(request.originX) && Number.isFinite(request.originY));
  assert.ok(request.preferredRoot, 'a raiz preferida não foi passada');
  assert.equal(state.level.pathogenArrival.warning.pathogen, 'meloidogyne');
});

// ---------------------------------------------------------------------------
// 42-44 · VISIBILIDADE NAS ROTAS VERTICAIS
// ---------------------------------------------------------------------------

test('42. no alto de uma rota vertical a origem continua perto da câmera', () => {
  // O caso que quebrava: jogador a 800px de altura, fundo do mundo uma tela
  // abaixo. Uma origem "de baixo" ancorada no fundo do mundo nascia fora da
  // câmera e o grupo só aparecia colado na raiz.
  const roots = Array.from({ length: 5 }, (_, index) => root(index, { y: -260 }));
  for (let attempt = 0; attempt < 25; attempt++) {
    const { state, arrival } = harness({
      seed: `vertical-${attempt}`,
      roots: roots.map(entry => ({ ...entry })),
      cameraY: -420,
    });
    state.level.worldBottomY = 1400;
    state.player.y = -300;
    arrival.forceArrival('meloidogyne');
    const warning = state.level.pathogenArrival.warning;
    const top = state.cameraY;
    const bottom = state.cameraY + state.visibleWorldHeight;
    assert.ok(
      warning.originY > top - 300 && warning.originY < bottom + 300,
      `origem ${warning.originType} em y=${Math.round(warning.originY)}`
      + ` fora da faixa visível ${Math.round(top)}..${Math.round(bottom)}`,
    );
  }
});

test('43. a origem nasce fora da tela, mas a um passo dela', () => {
  // As duas coisas ao mesmo tempo: se nascesse dentro, o patógeno brotaria no
  // meio do campo de visão; se nascesse longe, o grupo passaria quase todo o
  // percurso invisível.
  let lateral = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const { state, arrival } = harness({ seed: `borda-${attempt}`, cameraX: 1200 });
    arrival.forceArrival('meloidogyne');
    const warning = state.level.pathogenArrival.warning;
    const left = state.cameraX;
    const right = state.cameraX + state.visibleWorldWidth;
    if (warning.originType === 'left') {
      assert.ok(warning.originX < left, 'nasceu dentro da tela');
      assert.ok(left - warning.originX <= 320, `nasceu a ${left - warning.originX}px da borda`);
      lateral++;
    }
    if (warning.originType === 'right') {
      assert.ok(warning.originX > right, 'nasceu dentro da tela');
      assert.ok(warning.originX - right <= 320, `nasceu a ${warning.originX - right}px da borda`);
      lateral++;
    }
  }
  assert.ok(lateral > 0, 'nenhuma origem lateral em 40 tentativas');
});

// ---------------------------------------------------------------------------
// 44-45 · AS BARRAS E OS NÚMEROS SAEM DA RENDERIZAÇÃO NORMAL
// ---------------------------------------------------------------------------

function meloRenderCalls({ debug }) {
  const sim = createSimulator();
  sim.state.cameraX = 0;
  sim.state.time = 6;
  sim.state.level.dynamicPathogenArrival = true;
  sim.state.level.traversalDebugVisible = debug;
  const host = { x: 200, y: 500, w: 260, h: 54, type: 'root', logicIndex: 2 };
  sim.state.level.platforms = [host];
  sim.meloidogyneLifecycle.reset();
  // Uma galha madura (com sequela) e uma massa de ovos: as duas fontes de
  // número sobre o mundo.
  sim.meloidogyneLifecycle.galls.push({
    id: 'g', platform: host, x: host.x + 100, y: host.y + 18, generation: 0,
    progress: 0.9, age: 40, stage: 'adult-female', femaleMaturity: 1,
    eggTimer: 5, eggMassesLaid: 0, phase: 0.4, permanentPenalty: 0.22,
    adultDrain: 0, adultAnnounced: true, senescence: 0, dead: false,
  });
  sim.meloidogyneLifecycle.eggMasses.push({
    id: 'm', platform: host, x: host.x + 160, y: host.y - 7, generation: 1,
    eggs: 6, maxEggs: 8, hatch: 3, age: 5, emptyAge: 0, phase: 1,
    neutralized: false, trichodermaSuppression: 0, trichodermaLysis: 0,
  });
  const { ctx, calls } = recordingContext();
  sim.meloidogyneLifecycle.render(ctx);
  return calls.filter(call => call.name === 'fillText').map(call => String(call.args[0]));
}

test('44. os números de infestação saem do mundo e o rótulo do estágio fica', () => {
  const normal = meloRenderCalls({ debug: false });
  assert.ok(
    normal.some(text => /fêmea|galha|células/.test(text)),
    'o rótulo do estágio sumiu junto — ele diz O QUE é aquilo e não existe no painel',
  );
  assert.ok(
    !normal.some(text => text.includes('saúde máxima')),
    'a porcentagem de saúde máxima perdida continua desenhada no mundo',
  );
  assert.ok(
    !normal.some(text => text.startsWith('ovos ')),
    'a contagem de ovos continua desenhada no mundo',
  );

  const debug = meloRenderCalls({ debug: true });
  assert.ok(debug.some(text => text.includes('saúde máxima')), 'o número não voltou no debug');
  assert.ok(debug.some(text => text.startsWith('ovos ')), 'a contagem não voltou no debug');
});

test('45. os trilhos de carga da Ralstonia saem do mundo e voltam no Tab', () => {
  const scene = debug => {
    const host = {
      id: 'raiz', logicIndex: 5, x: 200, y: 500, w: 240, h: 60, type: 'root',
      rootHealth: 0.6, ralstoniaEntryWound: 0.45,
    };
    const state = {
      time: 12, cameraX: 0, gameState: 'play',
      player: { x: 260, y: 452, w: 32, h: 48 },
      campaign: { phase: 9 },
      level: {
        platforms: [host], ralstoniaFoci: [], rhizobiumNodules: [], biofilms: [],
        traversalDebugVisible: debug,
      },
    };
    const system = createRalstoniaVascularWilt({
      state,
      entities: { burst() {}, damagePlayer() {} },
      inoculants: { colonies: [] },
      pseudomonas: { colonies: [] },
    });
    system.initialize?.();
    const foci = state.level.ralstoniaFoci;
    if (!foci.length) {
      foci.push({
        id: 'foco', root: host, x: host.x + host.w / 2, activationState: 'active',
        surfaceLoad: 0.3, vascularLoad: 0.4, woundOpening: 0.5, age: 4, phase: 0,
        oozeTimer: 0.2, stressTimer: 1, spreadTimer: 10, roleBadgeTimer: 0,
        announcedEntry: true, announcedVascular: false, announcedCritical: false,
        neutralized: false, dormant: false, contained: false,
        bacillusControl: 0.4, pseudomonasControl: 0.3, azospirillumClosure: 0.2,
        vascularEfficiency: 0.7,
      });
    } else {
      // O foco nasce `pending` e o render desvia para o marcador de regiao;
      // aqui interessa o foco ja ativo, que e onde os trilhos apareciam.
      Object.assign(foci[0], {
        activationState: 'active', vascularLoad: 0.4, surfaceLoad: 0.3,
        woundOpening: 0.5, age: 4, roleBadgeTimer: 0,
        bacillusControl: 0.4, pseudomonasControl: 0.3, azospirillumClosure: 0.2,
      });
    }
    const { ctx, calls } = recordingContext();
    system.render(ctx);
    return calls;
  };

  const normal = scene(false);
  const debug = scene(true);
  const bars = calls => calls.filter(call => call.name === 'fillRect').length;
  const labels = calls => calls.filter(call => call.name === 'fillText').length;

  assert.ok(bars(debug) > bars(normal), 'os trilhos não voltaram com o Tab ligado');
  assert.ok(
    bars(normal) <= 1,
    `sobraram ${bars(normal)} barras no jogo normal — o painel contextual já publica todas`,
  );
  assert.equal(labels(normal), 0, 'sobrou rótulo de carga desenhado sobre a raiz');
  assert.ok(labels(debug) > 0, 'os rótulos não voltaram no debug');
});

test('46. o caminho completo do Phase Lab: origem, travessia, rizosfera, busca', () => {
  // Controlador REAL ligado ao ciclo REAL — é o que o botão "Forçar
  // Meloidogyne" dispara, e é onde os dois lados precisam se encontrar.
  const sim = createSimulator();
  const state = sim.state;
  state.campaign = { phase: 10, seed: 'lab-melo' };
  state.cameraX = 0;
  state.cameraY = 0;
  state.visibleWorldWidth = 1280;
  state.visibleWorldHeight = 720;
  state.level.dynamicPathogenArrival = true;
  state.level.platforms = Array.from({ length: 4 }, (_, index) => root(index));
  state.level.exudateClouds = [];
  state.level.exudates = [];
  state.level.microbeEncounters = [];
  state.level.pathogenPressure = { totalPressure: 4, pressureBand: 'safe', settings: PRESSURE };
  state.level.objectiveProgress = { attemptId: 1 };
  sim.meloidogyneLifecycle.reset();

  const arrival = createPathogenArrival({
    state,
    systems: { meloidogyneLifecycle: sim.meloidogyneLifecycle },
  });
  arrival.reset();
  arrival.forceArrival('meloidogyne');

  const warning = state.level.pathogenArrival.warning;
  const target = warning.targetRoot;
  const juvenile = sim.meloidogyneLifecycle.juveniles[0];

  // 1 · origem física, fora da tela mas encostada nela.
  assert.ok(['left', 'right', 'below', 'necrotic'].includes(warning.originType));
  assert.ok(Math.abs(juvenile.x - warning.originX) < 100, 'o J2 não nasceu na origem');
  const startDistance = distanceToRoot(juvenile, target);
  assert.ok(startDistance > 300, `nasceu perto demais do alvo: ${Math.round(startDistance)}px`);

  // 2 · grupo atravessando o solo, conduzido pelo ciclo, a 47 px/s.
  assert.ok(sim.meloidogyneLifecycle.arrivalTransitCount >= 2);
  const estimate = state.level.pathogenArrival.meloidogyneArrival.totalDistance
    / MELOIDOGYNE_BASE_SPEED;
  const run = seconds => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
      state.time += STEP;
      sim.meloidogyneLifecycle.update(STEP);
      arrival.update(STEP);
    }
  };
  run(estimate * 0.5);
  assert.ok(
    distanceToRoot(juvenile, target) < startDistance * 0.7,
    'o grupo mal saiu do lugar na metade do percurso',
  );
  // Metade do caminho e o aviso ainda nao pode ter sido contabilizado.
  assert.equal(state.level.pathogenArrival.totalArrivals, 0, 'contou antes de chegar');

  // 3 · chegada à rizosfera e liberação para a busca normal.
  run(estimate * 0.7);
  assert.equal(sim.meloidogyneLifecycle.arrivalTransitCount, 0, 'o grupo não foi liberado');
  assert.equal(state.level.pathogenArrival.warning, null, 'o acompanhamento não terminou');
  // 4 · daqui em diante é o ciclo de sempre: ele encontrou raiz e entrou nela.
  const survivors = sim.meloidogyneLifecycle.juveniles;
  const engaged = survivors.some(entry => entry.state !== 'seeking')
    || sim.meloidogyneLifecycle.gallCount > 0
    || survivors.length === 0;
  assert.ok(engaged, 'nenhum J2 do grupo chegou a interagir com a raiz depois de liberado');
});
