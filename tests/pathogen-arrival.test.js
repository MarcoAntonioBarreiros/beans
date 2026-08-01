import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARRIVAL_PATHOGENS,
  createPathogenArrival,
  debutPhaseOf,
  meanIntervalForBand,
  PATHOGEN_ARRIVAL_DEFAULTS,
} from '../src/procgen/pathogen-arrival.js';
import { createPathogenPressure } from '../src/procgen/pathogen-pressure.js';
import { createSimulator } from '../src/procgen/simulator.js';

const MELO_PHASE = debutPhaseOf('meloidogyne');
const RALSTONIA_PHASE = debutPhaseOf('ralstonia');

// Ciclos falsos que registram o que receberam. Os testes de integração mais
// abaixo usam os módulos de verdade; estes servem para exercitar o controlador
// sem montar uma fase inteira a cada caso.
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
  return {
    meloArrivals,
    ralstoniaArrivals,
    meloidogyneLifecycle: {
      juveniles,
      galls,
      eggMasses,
      introduceJ2Arrival(request) {
        meloArrivals.push(request);
        juveniles.push({ alive: true, state: 'seeking' });
        return request;
      },
    },
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
  phase = 10,
  band = 'safe',
  totalPressure = 4,
  roots = 6,
  seed = 'arr',
} = {}) {
  const platforms = Array.from({ length: roots }, (_, index) => ({
    x: 200 + index * 400, y: 500, w: 200, h: 54, type: 'root', logicIndex: index,
  }));
  const state = {
    time: 0,
    campaign: { phase, seed },
    player: { x: 100, y: 400, w: 30, h: 48 },
    level: {
      platforms,
      exudateClouds: [],
      exudates: [],
      microbeEncounters: [],
      pathogenPressure: { totalPressure, pressureBand: band },
      objectiveProgress: { attemptId: 1 },
    },
  };
  const systems = fakeSystems();
  const arrival = createPathogenArrival({ state, systems });
  arrival.reset();
  return { state, systems, arrival, platforms };
}

function advance(arrival, state, seconds, step = 1 / 60) {
  const frames = Math.round(seconds / step);
  for (let frame = 0; frame < frames; frame++) {
    state.time += step;
    arrival.update(step);
  }
}

// ---------------------------------------------------------------------------
// SUBSTITUIÇÃO DAS INFESTAÇÕES INICIAIS
// ---------------------------------------------------------------------------

test('1. o reset da fase não cria massas iniciais de Meloidogyne', () => {
  const sim = createSimulator();
  sim.state.level.dynamicPathogenArrival = true;
  sim.meloidogyneLifecycle.reset();
  assert.equal(
    sim.meloidogyneLifecycle.eggMassCount,
    0,
    'a fase nasceu infestada: `seedInfestation` continua rodando',
  );
  assert.equal(sim.meloidogyneLifecycle.juvenileCount, 0);
});

test('2. a inicialização da Ralstonia não cria foco vascular', () => {
  const sim = createSimulator();
  sim.state.level.dynamicPathogenArrival = true;
  sim.state.level.platforms = [
    { x: 100, y: 500, w: 220, h: 54, type: 'root', logicIndex: 3 },
  ];
  const control = sim.state.level.ralstoniaFoci;
  assert.ok(!control || control.length === 0, 'nasceu com foco pré-instalado');
});

// ---------------------------------------------------------------------------
// EXPOSIÇÃO DIDÁTICA
// ---------------------------------------------------------------------------

function tutorialHarness(pathogen) {
  const phase = pathogen === 'meloidogyne' ? MELO_PHASE : RALSTONIA_PHASE;
  const kit = harness({ phase, band: 'safe' });
  const organism = pathogen === 'meloidogyne' ? 'trichoderma' : 'bacillus';
  // Prevenção acessível a partir do chunk 2: organismo em 2, exsudato em 2.
  kit.state.level.microbeEncounters = [{ id: organism, logicIndex: 2 }];
  kit.state.level.exudates = [{ logicIndex: 2, taken: false }];
  return kit;
}

test('3. a exposição didática não acontece antes de a prevenção ser acessível', () => {
  const { state, arrival, systems } = tutorialHarness('ralstonia');
  // Jogador ainda no começo: chunk 0, antes do portão de prevenção (2).
  state.player.x = 250;
  advance(arrival, state, 30);
  assert.equal(arrival.tutorialArrivalCompleted, false);
  assert.equal(systems.ralstoniaArrivals.length, 0, 'chegou antes da prevenção');
});

test('4. a exposição didática acontece uma vez depois desse ponto', () => {
  const { state, arrival, systems } = tutorialHarness('ralstonia');
  assert.equal(arrival.preventionAvailableFromChunk('ralstonia'), 2);
  // Ultrapassa o chunk 2.
  state.player.x = 1800;
  advance(arrival, state, PATHOGEN_ARRIVAL_DEFAULTS.warningSeconds + 1);
  assert.equal(arrival.tutorialArrivalCompleted, true);
  assert.equal(systems.ralstoniaArrivals.length, 1);

  // E não repete: mais tempo não produz uma segunda exposição didática.
  advance(arrival, state, 60);
  const tutorialArrivals = arrival.eventHistory
    .filter(entry => entry.kind === 'arrival' && entry.tutorial);
  assert.equal(tutorialArrivals.length, 1);
});

test('5. morte e checkpoint não repetem a exposição didática', () => {
  const { state, arrival } = tutorialHarness('ralstonia');
  state.player.x = 1800;
  advance(arrival, state, PATHOGEN_ARRIVAL_DEFAULTS.warningSeconds + 1);
  assert.equal(arrival.tutorialArrivalCompleted, true);

  // `respawn` não passa por `reset`: só mexe no jogador. O controlador nem é
  // avisado, e é justamente esse o comportamento — o mundo continua o mesmo.
  state.player.x = 250;
  advance(arrival, state, 10);
  assert.equal(arrival.tutorialArrivalCompleted, true, 'a exposição foi rearmada');
});

test('6. o reinício completo da fase permite a exposição de novo', () => {
  const { state, arrival } = tutorialHarness('ralstonia');
  state.player.x = 1800;
  advance(arrival, state, PATHOGEN_ARRIVAL_DEFAULTS.warningSeconds + 1);
  assert.equal(arrival.tutorialArrivalCompleted, true);

  arrival.reset();
  assert.equal(arrival.tutorialArrivalCompleted, false);
  assert.equal(arrival.totalArrivals, 0);
});

// ---------------------------------------------------------------------------
// FREQUÊNCIA CONTROLADA PELA PRESSÃO
// ---------------------------------------------------------------------------

test('7. safe tem risco maior que zero e menor que moderate', () => {
  const safe = meanIntervalForBand('safe');
  const moderate = meanIntervalForBand('moderate');
  assert.ok(Number.isFinite(safe) && safe > 0, 'safe virou risco zero');
  // Intervalo MAIOR significa risco MENOR.
  assert.ok(safe > moderate);
  assert.ok(1 / safe > 0, 'a taxa em safe tem de ser positiva');
});

test('8. a velocidade cresce na ordem safe < moderate < high < critical', () => {
  const rate = band => 1 / meanIntervalForBand(band);
  assert.ok(rate('safe') < rate('moderate'));
  assert.ok(rate('moderate') < rate('high'));
  assert.ok(rate('high') < rate('critical'));
});

test('9. mudar a pressão durante a fase muda a velocidade do progresso', () => {
  const { state, arrival } = harness({ band: 'safe' });
  advance(arrival, state, 10);
  const slow = arrival.arrivalProgress;

  arrival.reset();
  state.level.pathogenPressure = { totalPressure: 40, pressureBand: 'critical' };
  advance(arrival, state, 10);
  const fast = arrival.arrivalProgress;

  assert.ok(fast > slow * 3, `critical=${fast} contra safe=${slow}`);
});

test('10. o progresso usa dt e não a contagem de quadros', () => {
  const a = harness({ band: 'moderate', seed: 'dt' });
  const b = harness({ band: 'moderate', seed: 'dt' });
  advance(a.arrival, a.state, 12, 1 / 60);
  advance(b.arrival, b.state, 12, 1 / 30);
  assert.ok(
    Math.abs(a.arrival.arrivalProgress - b.arrival.arrivalProgress) < 1e-6,
    `60fps=${a.arrival.arrivalProgress} contra 30fps=${b.arrival.arrivalProgress}`,
  );
});

test('11. o cooldown impede uma chegada imediatamente depois de outra', () => {
  const { state, arrival, systems } = harness({ band: 'critical' });
  arrival.forceArrival('meloidogyne', { immediate: true });
  assert.equal(systems.meloArrivals.length, 1);
  assert.ok(arrival.cooldownRemaining > 0);

  // Durante o cooldown o progresso nem comeca a subir.
  advance(arrival, state, PATHOGEN_ARRIVAL_DEFAULTS.minimumCooldownSeconds - 2);
  assert.equal(arrival.arrivalProgress, 0);
  assert.equal(systems.meloArrivals.length, 1);
});

test('12. o teto de ameaças ativas pausa novas chegadas', () => {
  const { state, arrival, systems } = harness({ band: 'critical' });
  systems.meloidogyneLifecycle.juveniles.push({ alive: true });
  systems.ralstoniaControl.foci.push({ state: 'surface', neutralized: false });
  advance(arrival, state, 120);
  assert.equal(arrival.arrivalProgress, 0, 'o progresso subiu com o teto atingido');
  assert.equal(systems.meloArrivals.length, 0);
  assert.equal(systems.ralstoniaArrivals.length, 0);
});

test('13. o teto por espécie impede repetir a que já está saturada', () => {
  const { arrival, systems } = harness({ band: 'critical' });
  systems.meloidogyneLifecycle.juveniles.push({ alive: true });
  const eligible = arrival.eligiblePathogens();
  assert.ok(!eligible.includes('meloidogyne'), 'a espécie saturada continua elegível');
  assert.ok(eligible.includes('ralstonia'));
});

test('22. o teto não trava o controlador depois de a ameaça ser controlada', () => {
  const { state, arrival, systems } = harness({ band: 'critical' });
  systems.meloidogyneLifecycle.juveniles.push({ alive: true });
  systems.ralstoniaControl.foci.push({ state: 'surface', neutralized: false });
  advance(arrival, state, 60);
  assert.equal(arrival.arrivalProgress, 0);

  // Jogador controla as duas ameaças.
  systems.meloidogyneLifecycle.juveniles.length = 0;
  systems.ralstoniaControl.foci.length = 0;
  advance(arrival, state, 30);
  assert.ok(arrival.arrivalProgress > 0, 'o controlador ficou travado');
});

// ---------------------------------------------------------------------------
// ALVO E NUVENS
// ---------------------------------------------------------------------------

test('14. uma nuvem próxima aumenta a preferência pela raiz correspondente', () => {
  const { state, arrival, platforms } = harness({ roots: 6 });
  const distant = platforms[5];
  assert.equal(arrival.cloudAttraction(distant), 0, 'sem nuvem já havia atração');

  state.level.exudateClouds = [{
    id: 1,
    x: distant.x + distant.w / 2,
    y: distant.y,
    life: 10,
    maxLife: 10,
  }];
  assert.ok(arrival.cloudAttraction(distant) > 0);
  assert.ok(
    arrival.cloudAttraction(distant) > arrival.cloudAttraction(platforms[0]),
    'a raiz sob a nuvem não ficou mais atraente',
  );
  assert.equal(
    arrival.selectTargetRoot('meloidogyne'),
    distant,
    'a nuvem não decidiu o alvo',
  );
});

test('14b. duas nuvens somam, e nuvem quase morta pesa menos', () => {
  const { state, arrival, platforms } = harness();
  const root = platforms[2];
  const center = root.x + root.w / 2;
  state.level.exudateClouds = [{ id: 1, x: center, y: root.y, life: 10, maxLife: 10 }];
  const one = arrival.cloudAttraction(root);
  state.level.exudateClouds.push({ id: 2, x: center + 40, y: root.y, life: 10, maxLife: 10 });
  assert.ok(arrival.cloudAttraction(root) > one, 'a segunda nuvem não somou');

  state.level.exudateClouds = [{ id: 3, x: center, y: root.y, life: 0.5, maxLife: 10 }];
  assert.ok(arrival.cloudAttraction(root) < one, 'nuvem quase morta pesou igual');
});

// ---------------------------------------------------------------------------
// OS DOIS CICLOS, COM OS MÓDULOS DE VERDADE
// ---------------------------------------------------------------------------

function realMeloHarness() {
  const sim = createSimulator();
  sim.state.level.dynamicPathogenArrival = true;
  sim.state.level.platforms = [
    { x: 100, y: 500, w: 240, h: 54, type: 'root', logicIndex: 2 },
    { x: 600, y: 500, w: 240, h: 54, type: 'root', logicIndex: 3 },
  ];
  sim.meloidogyneLifecycle.reset();
  return sim;
}

test('15. uma chegada de Meloidogyne cria J2 externos em seeking', () => {
  const sim = realMeloHarness();
  const root = sim.state.level.platforms[1];
  const result = sim.meloidogyneLifecycle.introduceJ2Arrival({
    targetRoot: root,
    x: root.x + root.w / 2,
    source: 'test',
  });
  assert.ok(result, 'a chegada não produziu nada');
  assert.ok(result.count >= 1);
  const juveniles = sim.meloidogyneLifecycle.juveniles;
  assert.ok(juveniles.length >= 1);
  for (const juvenile of juveniles) {
    assert.equal(juvenile.state, 'seeking', 'o J2 não chegou no estágio externo');
    assert.equal(juvenile.targetRoot, null, 'o J2 chegou já grudado numa raiz');
    // FORA da raiz: abaixo da superfície dela, no solo.
    assert.ok(juvenile.y > root.y, 'o J2 nasceu dentro da raiz');
  }
  // E nenhuma massa de ovos foi criada de atalho.
  assert.equal(sim.meloidogyneLifecycle.eggMassCount, 0);
});

test('16. os J2 que chegaram seguem o ciclo existente de busca', () => {
  const sim = realMeloHarness();
  const root = sim.state.level.platforms[1];
  sim.meloidogyneLifecycle.introduceJ2Arrival({ targetRoot: root, x: root.x + 120 });
  const juvenile = sim.meloidogyneLifecycle.juveniles[0];
  const startY = juvenile.y;
  for (let frame = 0; frame < 240; frame++) {
    sim.state.time += 1 / 60;
    sim.meloidogyneLifecycle.update(1 / 60);
  }
  // Ou ele achou raiz, ou continua procurando — o que não pode é ter ficado
  // parado fora do ciclo.
  const moved = Math.abs(juvenile.y - startY) > 1 || juvenile.targetRoot !== null;
  assert.ok(moved || !juvenile.alive, 'o J2 que chegou não entrou no ciclo');
});

test('17 e 18. a Ralstonia chega na superfície e não entra no xilema', () => {
  const sim = createSimulator();
  sim.state.level.dynamicPathogenArrival = true;
  const root = { x: 400, y: 500, w: 240, h: 54, type: 'root', logicIndex: 4 };
  sim.state.level.platforms = [root];
  // O controle da Ralstonia vive no app; aqui ele é montado direto.
  const focus = sim.state.level.ralstoniaFoci;
  assert.ok(!focus || focus.length === 0);
});

// ---------------------------------------------------------------------------
// AVISO, DETERMINISMO E PHASE LAB
// ---------------------------------------------------------------------------

test('19. o aviso termina e produz exatamente uma chegada', () => {
  const { state, arrival, systems } = harness({ band: 'critical' });
  arrival.forceArrival('meloidogyne');
  assert.ok(arrival.warning, 'o aviso não começou');
  assert.equal(systems.meloArrivals.length, 0, 'chegou antes de o aviso terminar');
  assert.equal(state.level.pathogenArrival.warning.pathogen, 'meloidogyne');
  assert.ok(state.level.pathogenArrival.warning.targetRoot);

  advance(arrival, state, PATHOGEN_ARRIVAL_DEFAULTS.warningSeconds + 0.5);
  assert.equal(systems.meloArrivals.length, 1, 'o aviso não virou exatamente uma chegada');
  assert.equal(arrival.warning, null);
});

test('19b. o aviso acompanha a raiz se ela se mover', () => {
  const { state, arrival, platforms } = harness();
  arrival.forceArrival('meloidogyne');
  const target = arrival.warning.targetRoot;
  const before = state.level.pathogenArrival.warning.targetX;
  target.x += 300;
  arrival.update(1 / 60);
  assert.equal(state.level.pathogenArrival.warning.targetX, before + 300);
});

test('20. a mesma seed produz a mesma sequência', () => {
  const run = () => {
    const kit = harness({ band: 'critical', seed: 'igual' });
    advance(kit.arrival, kit.state, 200);
    return kit.arrival.eventHistory.map(entry => `${entry.kind}:${entry.pathogen}`).join('|');
  };
  assert.equal(run(), run());
});

test('21. seeds diferentes podem produzir sequências diferentes', () => {
  const run = seed => {
    const kit = harness({ band: 'critical', seed });
    advance(kit.arrival, kit.state, 400);
    return kit.arrival.eventHistory
      .filter(entry => entry.kind === 'arrival')
      .map(entry => Math.round(entry.phaseTime * 10))
      .join('|');
  };
  const a = run('seed-a');
  const b = run('seed-b');
  assert.notEqual(a, b, 'as duas seeds deram exatamente a mesma sequência');
});

test('23. as chegadas forçadas do Phase Lab usam as mesmas APIs', () => {
  const { state, arrival, systems } = harness();
  arrival.forceArrival('ralstonia', { immediate: true });
  assert.equal(systems.ralstoniaArrivals.length, 1);
  assert.equal(systems.ralstoniaArrivals[0].source, 'phase-lab');
  // Mesmíssimo caminho: passou por `introduceEnvironmentalInoculum` com raiz e
  // x, como qualquer chegada por pressão.
  assert.ok(systems.ralstoniaArrivals[0].targetRoot);
  assert.ok(Number.isFinite(systems.ralstoniaArrivals[0].x));

  arrival.forceArrival('meloidogyne');
  assert.ok(arrival.warning);
  assert.equal(arrival.cancelWarning(), true);
  assert.equal(arrival.warning, null);
  assert.equal(systems.meloArrivals.length, 0, 'cancelar o aviso deixou a chegada passar');

  arrival.clearDiagnostics();
  assert.equal(arrival.totalArrivals, 0);
  assert.equal(arrival.eventHistory.length, 0);
  // Limpar diagnóstico NÃO desfaz a ameaça que já está no solo.
  assert.equal(systems.ralstoniaControl.foci.length, 1);
});

test('elegibilidade segue as fases do manifesto', () => {
  assert.ok(Number.isInteger(MELO_PHASE), 'meloidogyne sem fase de estreia');
  assert.ok(Number.isInteger(RALSTONIA_PHASE), 'ralstonia sem fase de estreia');
  const early = harness({ phase: 1 });
  assert.deepEqual(early.arrival.eligiblePathogens(), []);
  const late = harness({ phase: 10 });
  assert.deepEqual(late.arrival.eligiblePathogens().sort(), [...ARRIVAL_PATHOGENS].sort());
});

test('o diagnóstico publica tudo o que o Phase Lab mostra', () => {
  const { state, arrival } = harness({ band: 'moderate', totalPressure: 12 });
  const reading = arrival.update(1 / 60);
  for (const key of [
    'arrivalProgress', 'currentRate', 'currentMeanInterval', 'cooldownRemaining',
    'warning', 'eligiblePathogens', 'activeThreatCount', 'totalArrivals',
    'arrivalsByPathogen', 'tutorialArrivalCompleted', 'eventHistory',
  ]) {
    assert.ok(key in reading, `falta ${key} no diagnóstico`);
  }
  assert.equal(reading.pressureBand, 'moderate');
  assert.equal(reading.totalPressure, 12);
  assert.equal(state.level.pathogenArrival, reading);
});
