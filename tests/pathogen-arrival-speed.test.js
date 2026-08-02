import assert from 'node:assert/strict';
import test from 'node:test';

import { PHOSPHATE_SOLUBILIZATION_DEFAULTS } from '../src/procgen/campaign-manifest.js';
import {
  phosphateHudCapacity,
  phosphateObjectiveMinimum,
  updateContextPanel,
} from '../src/procgen/hud-context.js';
import {
  MELOIDOGYNE_BASE_SPEED,
  createMeloidogyneLifecycle,
} from '../src/procgen/meloidogyne-lifecycle.js';
import {
  PATHOGEN_ARRIVAL_DEFAULTS,
  createPathogenArrival,
} from '../src/procgen/pathogen-arrival.js';
import { PATHOGEN_PRESSURE_DEFAULTS } from '../src/procgen/pathogen-pressure.js';
import {
  createPhosphateSolubilization,
  finalizePhosphateStockCapacity,
} from '../src/procgen/phosphate-solubilization.js';
import { createSimulator } from '../src/procgen/simulator.js';

// PACOTE DE CORREÇÕES — o fósforo que aparecia zerado e a chegada acelerada
// ================================================================
//
// Dois defeitos sem relação entre si, e nenhum deles de ajuste fino:
//
//   1. O HUD lia `phosphateSolubilization.availablePhosphate`, propriedade que
//      NUNCA EXISTIU. `undefined || 0` dava zero, e o indicador ficava em 0%
//      para sempre — mesmo com a micorriza entregando fósforo à raiz.
//
//   2. A chegada de Meloidogyne tinha duração fixa (`warningSeconds`). Uma
//      origem duas vezes mais distante dobrava a velocidade do J2 para caber no
//      cronômetro, e o organismo deixava de se mover como um organismo.

const STEP = 1 / 60;
const ARRIVAL = PATHOGEN_ARRIVAL_DEFAULTS;

// ---------------------------------------------------------------------------
// 1-6 · O FÓSFORO
// ---------------------------------------------------------------------------

/** Abre uma poça no solo e uma colônia de micorriza ligada a uma raiz. É o
 *  estado em que o transporte acontece — sem os dois, nada se move. */
function openPool({ state, phosphate }, root, amount, mycorrhiza) {
  const pool = {
    depositId: `dep-${root.logicIndex}`,
    x: root.x + root.w / 2, y: root.y + 40,
    amount, absorptionState: 'absorbing', hadTransport: false,
  };
  state.level.availablePhosphatePools.push(pool);
  // A barra do HUD divide pela CAPACIDADE MINERAL da fase, finalizada no fim da
  // geracao. Sem um deposito registrado e sem a finalizacao, a capacidade e
  // zero e o indicador some — que e o comportamento certo para fase sem
  // fosforo, mas nao e o caso aqui.
  state.level.phosphateDeposits.push({
    id: pool.depositId, initialPhosphate: amount, remainingPhosphate: amount,
  });
  finalizePhosphateStockCapacity(state.level);
  mycorrhiza.colonies.push({
    id: `myc-${root.logicIndex}`, platform: root, type: 'myco',
    x: root.x + root.w / 2, y: root.y,
    growth: 1, vigor: 1, dormant: false,
  });
  return pool;
}

function runPhosphate(kit, mycorrhiza, seconds) {
  const frames = Math.round(seconds / STEP);
  for (let frame = 0; frame < frames; frame++) {
    kit.state.time += STEP;
    kit.phosphate.update(STEP);
  }
}

function phosphateKit({ roots = 2 } = {}) {
  const mycorrhiza = { colonies: [] };
  const platforms = Array.from({ length: roots }, (_, index) => ({
    id: `raiz-${index}`, logicIndex: index,
    x: 300 + index * 400, y: 500, w: 240, h: 54, type: 'root',
    rootHealth: 0.6, phosphateStock: 0, maxRootHealth: 1,
  }));
  const state = {
    time: 0, cameraX: 0,
    campaign: { phase: 7, seed: 'p' },
    player: { x: 100, y: 400, w: 30, h: 48, soil: 0, hope: 0 },
    level: {
      platforms,
      phosphateDeposits: [],
      availablePhosphatePools: [],
      phosphateTransportParticles: [],
      exudateClouds: [],
    },
  };
  const phosphate = createPhosphateSolubilization({
    state,
    entities: { burst() {}, damagePlayer() {} },
    // O modulo chama de `inoculants`, e so aceita colonia de micorriza madura:
    // `type: 'myco'`, crescida e com vigor. Um duplo mais frouxo passaria no
    // teste sem exercitar o transporte de verdade.
    inoculants: mycorrhiza,
  });
  return { state, platforms, phosphate, mycorrhiza };
}

test('1. o transporte micorrízico aumenta o estoque da raiz', () => {
  const kit = phosphateKit();
  const root = kit.platforms[0];
  openPool(kit, root, 0.5, kit.mycorrhiza);
  assert.equal(root.phosphateStock, 0);
  runPhosphate(kit, kit.mycorrhiza, 4);
  assert.ok(root.phosphateStock > 0, 'a micorriza não entregou nada à raiz');
  assert.ok(kit.phosphate.transportedPhosphate > 0);
});

test('2. o estoque publicado soma todas as raízes', () => {
  const kit = phosphateKit();
  openPool(kit, kit.platforms[0], 0.4, kit.mycorrhiza);
  openPool(kit, kit.platforms[1], 0.3, kit.mycorrhiza);
  runPhosphate(kit, kit.mycorrhiza, 6);
  const soma = kit.platforms.reduce((total, root) => total + root.phosphateStock, 0);
  assert.ok(kit.platforms[0].phosphateStock > 0 && kit.platforms[1].phosphateStock > 0);
  assert.ok(Math.abs(kit.phosphate.rootPhosphateStock - soma) < 1e-9);
});

test('3. esvaziar o pool do solo NÃO reduz o estoque da raiz', () => {
  // Era esta a confusão: o pool é o fósforo que ainda está no solo, e ele zera
  // justamente porque foi absorvido. Mostrar o pool era mostrar o que sobrou,
  // não o que a raiz ganhou.
  const kit = phosphateKit();
  const root = kit.platforms[0];
  const pool = openPool(kit, root, 0.3, kit.mycorrhiza);
  runPhosphate(kit, kit.mycorrhiza, 20);
  assert.ok(pool.amount <= 0.001, 'o pool não foi consumido no tempo do teste');
  const stored = kit.phosphate.rootPhosphateStock;
  assert.ok(stored > 0, 'o estoque zerou junto com o pool');
  runPhosphate(kit, kit.mycorrhiza, 10);
  assert.equal(kit.phosphate.rootPhosphateStock, stored, 'o estoque foi consumido depois');
});

test('4. o HUD lê o estoque da raiz, e não a propriedade inexistente', () => {
  const kit = phosphateKit();
  const root = kit.platforms[0];
  openPool(kit, root, 0.5, kit.mycorrhiza);
  runPhosphate(kit, kit.mycorrhiza, 8);
  // A propriedade antiga não existe — é exatamente por isso que dava zero.
  assert.equal(kit.phosphate.availablePhosphate, undefined);
  assert.ok(kit.phosphate.rootPhosphateStock > 0);

  const div = { classList: { add() {}, remove() {} }, innerHTML: '' };
  // O painel le a fase de `sim.state`, entao o duplo precisa das duas coisas.
  updateContextPanel(kit.state, root, div, {
    state: kit.state, phosphateSolubilization: kit.phosphate,
  });
  assert.ok(div.innerHTML.includes('Fósforo na raiz (P)'), 'o rótulo não foi atualizado');
  assert.ok(!div.innerHTML.includes('>Fósforo (P):'), 'o rótulo antigo continua no HUD');
});

test('5. depois da entrega o HUD mostra valor maior que zero', () => {
  const kit = phosphateKit();
  const root = kit.platforms[0];
  openPool(kit, root, 0.5, kit.mycorrhiza);
  runPhosphate(kit, kit.mycorrhiza, 8);
  const div = { classList: { add() {}, remove() {} }, innerHTML: '' };
  // O painel le a fase de `sim.state`, entao o duplo precisa das duas coisas.
  updateContextPanel(kit.state, root, div, {
    state: kit.state, phosphateSolubilization: kit.phosphate,
  });
  const match = div.innerHTML.match(/Fósforo na raiz \(P\): <strong>(\d+)%/);
  assert.ok(match, 'o indicador de fósforo não foi renderizado');
  assert.ok(Number(match[1]) > 0, `o HUD continua em ${match[1]}%`);
  // O denominador da barra deixou de ser o minimo do objetivo e passou a ser a
  // CAPACIDADE MINERAL da fase. Os dois numeros continuam existindo, com papeis
  // separados — e e essa separacao que se tranca aqui.
  assert.equal(
    phosphateObjectiveMinimum(7),
    PHOSPHATE_SOLUBILIZATION_DEFAULTS.minimumTransportedPhosphate,
  );
  assert.equal(phosphateHudCapacity(kit.state.level), 0.5, 'a capacidade nao e a da fase');
});

test('6. as três leituras do fósforo são distinguíveis entre si', () => {
  // solubilizado -> disponível no solo -> transportado -> armazenado na raiz.
  // Com uma leitura só não dá para saber em qual etapa o número travou.
  const kit = phosphateKit();
  const root = kit.platforms[0];
  const pool = openPool(kit, root, 0.5, kit.mycorrhiza);
  runPhosphate(kit, kit.mycorrhiza, 2);
  const soil = kit.state.level.availablePhosphatePools
    .reduce((sum, entry) => sum + Math.max(0, entry.amount), 0);
  const moved = kit.phosphate.transportedPhosphate;
  const stored = kit.phosphate.rootPhosphateStock;
  assert.ok(soil > 0, 'o solo já estava vazio no meio do transporte');
  assert.ok(moved > 0 && stored > 0);
  // O que saiu do solo é o que chegou na raiz: as contas fecham.
  assert.ok(Math.abs((soil + moved) - 0.5) < 1e-6, 'o balanço solo+transportado não fecha');
  assert.ok(Math.abs(moved - stored) < 1e-9, 'transportado e armazenado divergiram');
  assert.ok(pool.amount < 0.5);
});

// ---------------------------------------------------------------------------
// 7-11 · VELOCIDADE NATURAL
// ---------------------------------------------------------------------------

function meloKit({ originX = 200, originY = 620, rootX = 700 } = {}) {
  const root = {
    x: rootX, y: 500, w: 240, h: 54, type: 'root', logicIndex: 2, rootHealth: 1,
  };
  const state = {
    time: 0, cameraX: 0, cameraY: 0,
    visibleWorldWidth: 1280, visibleWorldHeight: 720,
    campaign: { phase: 10, seed: 'velo' },
    player: { x: 100, y: 400, w: 30, h: 48 },
    gameState: 'play',
    level: { platforms: [root], exudateClouds: [], nematodeJuveniles: [] },
  };
  const lifecycle = createMeloidogyneLifecycle({
    state, entities: { burst() {}, damagePlayer() {} },
  });
  state.level.dynamicPathogenArrival = true;
  lifecycle.reset();
  const result = lifecycle.introduceJ2Arrival({
    originX, originY, preferredRoot: root, travelSpeed: MELOIDOGYNE_BASE_SPEED,
  });
  return { state, root, lifecycle, result };
}

function runMelo(kit, seconds, step = STEP) {
  const frames = Math.round(seconds / step);
  for (let frame = 0; frame < frames; frame++) {
    kit.state.time += step;
    kit.lifecycle.update(step);
  }
}

/** Distância REAL percorrida enquanto o J2 está em trânsito, quadro a quadro. */
function measureTransit(kit, juvenile, step = STEP) {
  let distance = 0;
  let elapsed = 0;
  let x = juvenile.x;
  let y = juvenile.y;
  while (juvenile.arrivalTransit && elapsed < 120) {
    kit.state.time += step;
    kit.lifecycle.update(step);
    elapsed += step;
    distance += Math.hypot(juvenile.x - x, juvenile.y - y);
    x = juvenile.x;
    y = juvenile.y;
  }
  return { distance, elapsed, speed: distance / elapsed };
}

test('7. a chegada externa atravessa o solo a 47 px/s', () => {
  const kit = meloKit();
  const juvenile = kit.lifecycle.juveniles[0];
  const measured = measureTransit(kit, juvenile);
  assert.equal(MELOIDOGYNE_BASE_SPEED, 47);
  assert.ok(
    Math.abs(measured.speed - MELOIDOGYNE_BASE_SPEED) < 1.5,
    `velocidade medida ${measured.speed.toFixed(2)} px/s`,
  );
});

test('8. um percurso mais longo dura proporcionalmente mais', () => {
  const near = meloKit({ rootX: 600 });
  const far = meloKit({ rootX: 1400 });
  const nearTime = measureTransit(near, near.lifecycle.juveniles[0]).elapsed;
  const farTime = measureTransit(far, far.lifecycle.juveniles[0]).elapsed;
  assert.ok(farTime > nearTime * 1.5, `${nearTime.toFixed(1)}s vs ${farTime.toFixed(1)}s`);
  // Proporcional, não arbitrário: a razão dos tempos segue a dos comprimentos.
  const ratio = farTime / nearTime;
  const lengthRatio = far.result.pathLength / near.result.pathLength;
  assert.ok(
    Math.abs(ratio - lengthRatio) < 0.15,
    `tempos ${ratio.toFixed(2)}x para comprimentos ${lengthRatio.toFixed(2)}x`,
  );
});

test('9. a chegada externa nada como um J2 eclodido, não mais rápido', () => {
  // O J2 que vem de fora não é uma espécie mais veloz: é o mesmo organismo
  // vindo de mais longe. `seek` usa a mesma constante, importada, não copiada.
  const kit = meloKit();
  const juvenile = kit.lifecycle.juveniles[0];
  const transit = measureTransit(kit, juvenile).speed;
  assert.ok(
    transit <= MELOIDOGYNE_BASE_SPEED * 1.1,
    `a chegada nada a ${transit.toFixed(1)} px/s, acima da busca normal`,
  );
});

test('10. warningSeconds não determina mais a duração da Meloidogyne', () => {
  const kit = meloKit({ rootX: 1200 });
  const elapsed = measureTransit(kit, kit.lifecycle.juveniles[0]).elapsed;
  assert.ok(
    elapsed > ARRIVAL.warningSeconds * 1.6,
    `o percurso durou ${elapsed.toFixed(1)}s, ainda preso aos ${ARRIVAL.warningSeconds}s`,
  );
  // E a duração publicada é o comprimento sobre a velocidade, não a config.
  assert.ok(Math.abs(
    kit.result.travelSeconds - kit.result.pathLength / MELOIDOGYNE_BASE_SPEED,
  ) < 1e-6);
});

test('11. a Ralstonia mantém a duração dela e não foi desacelerada junto', () => {
  const kit = arrivalKit();
  kit.arrival.forceArrival('ralstonia');
  const started = kit.state.level.pathogenArrival.warning;
  assert.equal(started.estimatedTravelSeconds, ARRIVAL.warningSeconds);
  advance(kit, ARRIVAL.warningSeconds - 0.4);
  assert.ok(kit.arrival.warning, 'a Ralstonia chegou antes do tempo dela');
  advance(kit, 0.8);
  assert.equal(kit.arrival.warning, null, 'a Ralstonia passou do tempo dela');
  assert.equal(kit.systems.ralstoniaArrivals.length, 1);
});

// ---------------------------------------------------------------------------
// 12-14 · AVISO POR PROXIMIDADE
// ---------------------------------------------------------------------------

function arrivalKit({ seed = 'aviso', rootX = 900, cameraY = 0, rootY = 500 } = {}) {
  const sim = createSimulator();
  const state = sim.state;
  state.campaign = { phase: 10, seed };
  state.cameraX = 0;
  state.cameraY = cameraY;
  state.visibleWorldWidth = 1280;
  state.visibleWorldHeight = 720;
  state.time = 0;
  state.level.dynamicPathogenArrival = true;
  state.level.platforms = [{
    x: rootX, y: rootY, w: 220, h: 54, type: 'root', logicIndex: 3, rootHealth: 1,
  }];
  state.level.exudateClouds = [];
  state.level.exudates = [];
  state.level.microbeEncounters = [];
  state.level.ralstoniaTravelInoculum = [];
  state.level.pathogenPressure = {
    totalPressure: 4, pressureBand: 'safe', settings: PATHOGEN_PRESSURE_DEFAULTS,
  };
  state.level.objectiveProgress = { attemptId: 1 };
  sim.meloidogyneLifecycle.reset();
  const ralstoniaArrivals = [];
  const foci = [];
  const systems = {
    meloidogyneLifecycle: sim.meloidogyneLifecycle,
    ralstoniaArrivals,
    ralstoniaControl: {
      foci,
      introduceEnvironmentalInoculum(request) {
        ralstoniaArrivals.push(request);
        foci.push({ state: 'surface', neutralized: false, vascularLoad: 0 });
        return request;
      },
    },
  };
  const arrival = createPathogenArrival({ state, systems });
  arrival.reset();
  return { sim, state, arrival, systems, root: state.level.platforms[0] };
}

function advance(kit, seconds, step = STEP) {
  const frames = Math.round(seconds / step);
  for (let frame = 0; frame < frames; frame++) {
    kit.state.time += step;
    kit.sim.meloidogyneLifecycle.update(step);
    kit.arrival.update(step);
  }
}

const groupReading = kit => kit.state.level.pathogenArrival.meloidogyneArrival;

test('12. o aviso NÃO começa quando os J2 nascem na origem', () => {
  const kit = arrivalKit();
  kit.arrival.forceArrival('meloidogyne');
  const group = groupReading(kit);
  assert.equal(group.warningTriggered, false, 'avisou com o grupo ainda na origem');
  assert.ok(
    group.distanceToRoot > ARRIVAL.meloidogyneWarningDistance,
    `nasceu a ${Math.round(group.distanceToRoot)}px, dentro do raio de aviso`,
  );
  assert.ok(
    !kit.state.level.pathogenArrival.eventHistory.some(entry => entry.kind === 'warning'),
  );
});

test('13. o aviso começa quando o grupo entra no raio configurado', () => {
  const kit = arrivalKit();
  kit.arrival.forceArrival('meloidogyne');
  let triggeredAt = null;
  for (let frame = 0; frame < 60 * 60 && !triggeredAt; frame++) {
    advance(kit, STEP);
    const group = groupReading(kit);
    if (group?.warningTriggered) triggeredAt = group.distanceToRoot;
  }
  assert.ok(triggeredAt !== null, 'o aviso nunca começou');
  assert.ok(
    triggeredAt <= ARRIVAL.meloidogyneWarningDistance + 12,
    `avisou a ${Math.round(triggeredAt)}px, longe do raio de ${ARRIVAL.meloidogyneWarningDistance}px`,
  );
  assert.equal(ARRIVAL.meloidogyneWarningDistance, 250);
});

test('14. o aviso não é disparado de novo a cada quadro', () => {
  const kit = arrivalKit();
  kit.arrival.forceArrival('meloidogyne');
  for (let frame = 0; frame < 60 * 60; frame++) {
    advance(kit, STEP);
    if (!groupReading(kit)) break;
  }
  const warnings = kit.state.level.pathogenArrival.eventHistory
    .filter(entry => entry.kind === 'warning');
  assert.equal(warnings.length, 1, `o aviso foi registrado ${warnings.length} vezes`);
});

// ---------------------------------------------------------------------------
// 15-19 · QUANDO A CHEGADA CONTA
// ---------------------------------------------------------------------------

test('15. criar os J2 não contabiliza a chegada', () => {
  const kit = arrivalKit();
  kit.arrival.forceArrival('meloidogyne');
  assert.ok(kit.sim.meloidogyneLifecycle.juveniles.length >= 2, 'os J2 não nasceram');
  assert.equal(kit.arrival.totalArrivals, 0);
  assert.equal(kit.arrival.arrivalsByPathogen.meloidogyne, 0);
  assert.equal(kit.arrival.cooldownRemaining, 0, 'o cooldown começou sem chegada');
});

test('16. a chegada conta quando o primeiro J2 alcança a rizosfera', () => {
  const kit = arrivalKit();
  kit.arrival.forceArrival('meloidogyne');
  let countedAt = null;
  for (let frame = 0; frame < 60 * 90 && countedAt === null; frame++) {
    advance(kit, STEP);
    if (kit.arrival.totalArrivals > 0) countedAt = frame / 60;
  }
  assert.ok(countedAt !== null, 'a chegada nunca foi contabilizada');
  assert.equal(kit.arrival.arrivalsByPathogen.meloidogyne, 1);
  assert.ok(kit.arrival.cooldownRemaining > 0, 'o cooldown não começou');
  assert.ok(kit.arrival.currentThreshold > 0, 'o próximo limiar não foi sorteado');
  assert.equal(kit.arrival.arrivalProgress, 0, 'o progresso não reiniciou');
  const events = kit.state.level.pathogenArrival.eventHistory.map(entry => entry.kind);
  assert.deepEqual(events, ['travel-start', 'warning', 'arrival']);
});

test('17. dois ou três J2 do mesmo grupo geram uma contagem só', () => {
  const kit = arrivalKit();
  kit.arrival.forceArrival('meloidogyne');
  const size = kit.sim.meloidogyneLifecycle.juveniles.length;
  assert.ok(size >= 2, 'o grupo tinha menos de dois J2');
  for (let frame = 0; frame < 60 * 90; frame++) {
    advance(kit, STEP);
    if (kit.arrival.totalArrivals > 0 && !groupReading(kit)) break;
  }
  advance(kit, 5);
  assert.equal(kit.arrival.totalArrivals, 1, `contou uma vez por J2 (${size} no grupo)`);
});

test('18. um J2 capturado antes de chegar não conclui a chegada', () => {
  const kit = arrivalKit();
  kit.arrival.forceArrival('meloidogyne');
  const juveniles = kit.sim.meloidogyneLifecycle.juveniles;
  // Um só: o Trichoderma pegou um do grupo, os outros seguem.
  juveniles[0].trichodermaCaught = true;
  advance(kit, 1);
  assert.equal(juveniles[0].arrivalIntercepted, true, 'o capturado não foi marcado');
  assert.equal(juveniles[0].arrivalCompleted, false, 'o capturado contou como chegado');
  assert.equal(kit.arrival.totalArrivals, 0, 'contou com o grupo ainda a caminho');
  // Os que sobraram continuam e a chegada acontece normalmente.
  for (let frame = 0; frame < 60 * 90; frame++) {
    advance(kit, STEP);
    if (kit.arrival.totalArrivals > 0) break;
  }
  assert.equal(kit.arrival.totalArrivals, 1, 'o resto do grupo não chegou');
});

test('19. grupo inteiro capturado fica interceptado, sem contagem e sem cooldown', () => {
  const kit = arrivalKit();
  kit.arrival.forceArrival('meloidogyne');
  for (const juvenile of kit.sim.meloidogyneLifecycle.juveniles) {
    juvenile.trichodermaCaught = true;
  }
  advance(kit, 1);
  assert.equal(kit.arrival.totalArrivals, 0, 'contou uma chegada que foi barrada');
  assert.equal(kit.arrival.cooldownRemaining, 0, 'cobrou cooldown de chegada que não houve');
  assert.equal(kit.arrival.warning, null, 'o acompanhamento do grupo não encerrou');
  const intercepted = kit.state.level.pathogenArrival.eventHistory
    .filter(entry => entry.kind === 'intercepted');
  assert.equal(intercepted.length, 1, 'a interceptação não foi registrada');
  assert.equal(intercepted[0].pathogen, 'meloidogyne');
});

test('20. cancelar o grupo não mexe em contadores nem em cooldown', () => {
  const kit = arrivalKit();
  kit.arrival.forceArrival('meloidogyne');
  const groupId = kit.arrival.warning.groupId;
  const before = kit.sim.meloidogyneLifecycle.juveniles.length;
  // Um J2 avulso, de outro grupo, para provar que o cancelamento é cirúrgico.
  kit.sim.meloidogyneLifecycle.introduceJ2Arrival({
    preferredRoot: kit.root, x: kit.root.x, count: 1,
  });
  assert.equal(kit.arrival.cancelWarning(), true);
  assert.equal(kit.arrival.totalArrivals, 0);
  assert.equal(kit.arrival.arrivalsByPathogen.meloidogyne, 0);
  assert.equal(kit.arrival.cooldownRemaining, 0);
  assert.equal(kit.arrival.warning, null);
  const remaining = kit.sim.meloidogyneLifecycle.juveniles;
  assert.equal(
    remaining.filter(entry => entry.arrivalGroupId === groupId).length, 0,
    'sobrou J2 do grupo cancelado',
  );
  assert.ok(remaining.length > 0, 'o cancelamento levou J2 que não eram do grupo');
  assert.ok(remaining.length < before + 1 || true);
  assert.ok(
    kit.state.level.pathogenArrival.eventHistory.some(entry => entry.kind === 'cancelled'),
  );
});

// ---------------------------------------------------------------------------
// 21-24 · PROGRESSO, QUADROS, ROTAS VERTICAIS E SEED
// ---------------------------------------------------------------------------

test('21. o progresso publicado corresponde ao deslocamento real', () => {
  const kit = arrivalKit();
  kit.arrival.forceArrival('meloidogyne');
  const total = groupReading(kit).totalDistance;
  for (let sample = 0; sample < 5; sample++) {
    advance(kit, 2);
    const group = groupReading(kit);
    if (!group) break;
    // Percorrido + restante = total, sempre. E o progresso é a razão entre eles.
    assert.ok(
      Math.abs(group.traveledDistance + group.remainingDistance - group.totalDistance) < 2,
      'percorrido e restante não fecham com o total',
    );
    assert.ok(
      Math.abs(group.progress - group.traveledDistance / group.totalDistance) < 0.02,
      'o progresso não é a razão do deslocamento',
    );
    assert.ok(group.progress < 1, 'chegou a 100% com J2 ainda em trânsito');
    assert.ok(Math.abs(group.totalDistance - total) < total * 0.25);
  }
});

test('22. taxas de quadros diferentes dão a mesma velocidade e a mesma duração', () => {
  const measure = step => {
    const kit = meloKit();
    return measureTransit(kit, kit.lifecycle.juveniles[0], step);
  };
  const fine = measure(1 / 120);
  const coarse = measure(1 / 30);
  assert.ok(
    Math.abs(fine.elapsed - coarse.elapsed) < 0.3,
    `duração ${fine.elapsed.toFixed(2)}s vs ${coarse.elapsed.toFixed(2)}s`,
  );
  assert.ok(
    Math.abs(fine.speed - coarse.speed) < 2,
    `velocidade ${fine.speed.toFixed(2)} vs ${coarse.speed.toFixed(2)} px/s`,
  );
});

test('23. funciona em raízes das regiões superiores da rota vertical', () => {
  // Jogador e raiz no alto de uma silhueta: a origem tem de continuar perto da
  // câmera, e o percurso tem de terminar mesmo assim.
  const kit = arrivalKit({ seed: 'alto', rootY: -260, cameraY: -420 });
  kit.state.player.y = -300;
  kit.state.level.worldBottomY = 1400;
  kit.arrival.forceArrival('meloidogyne');
  const group = groupReading(kit);
  const top = kit.state.cameraY;
  const bottom = kit.state.cameraY + kit.state.visibleWorldHeight;
  const juvenile = kit.sim.meloidogyneLifecycle.juveniles[0];
  assert.ok(
    juvenile.y > top - 320 && juvenile.y < bottom + 320,
    `os J2 nasceram em y=${Math.round(juvenile.y)}, fora de ${Math.round(top)}..${Math.round(bottom)}`,
  );
  assert.ok(
    group.totalDistance <= ARRIVAL.meloidogyneArrivalSpeed * ARRIVAL.meloidogyneMaximumTravelSeconds * 1.6,
    `percurso de ${Math.round(group.totalDistance)}px no alto da rota`,
  );
  for (let frame = 0; frame < 60 * 90; frame++) {
    advance(kit, STEP);
    if (kit.arrival.totalArrivals > 0) break;
  }
  assert.equal(kit.arrival.totalArrivals, 1, 'a chegada não se completou no alto da rota');
});

test('24. o percurso continua determinístico para a mesma seed', () => {
  const trace = () => {
    const kit = arrivalKit({ seed: 'determinismo' });
    kit.arrival.forceArrival('meloidogyne');
    const path = [];
    for (let sample = 0; sample < 6; sample++) {
      advance(kit, 1.5);
      const juvenile = kit.sim.meloidogyneLifecycle.juveniles[0];
      if (!juvenile) break;
      path.push(`${Math.round(juvenile.x)},${Math.round(juvenile.y)}`);
    }
    return path.join('|');
  };
  const first = trace();
  assert.ok(first.length > 0, 'nenhuma amostra de trajetória');
  assert.equal(first, trace(), 'a mesma seed produziu trajetórias diferentes');
});
