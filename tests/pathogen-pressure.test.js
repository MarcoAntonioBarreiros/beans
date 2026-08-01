import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPressureBand,
  createPathogenPressure,
  exudateUseCost,
  IRON_STOCK_MAXIMUM,
  PATHOGEN_PRESSURE_DEFAULTS,
} from '../src/procgen/pathogen-pressure.js';
import { createEcologicalGameplay } from '../src/procgen/ecological-gameplay.js';
import { createSimulator } from '../src/procgen/simulator.js';

// Estado mínimo: só o que a leitura consulta. Nitrogênio e ferro entram por
// injeção direta para o teste poder variá-los sem montar uma fase inteira.
function createState({ nitrogen = 0, iron = 0 } = {}) {
  return {
    time: 0,
    level: { exudateClouds: [], platforms: [] },
    pseudomonasSiderophores: { ironRecovered: iron },
    // `getNitrogenAvailability` lê colônias reais; sem elas devolve 0. Para os
    // testes de N o valor entra por este atalho, que o módulo já aceita.
    azospirillumNitrogen: null,
    __nitrogen: nitrogen,
  };
}

function addCloud(state, id) {
  state.level.exudateClouds.push({ id, life: 10 });
}

function removeAllClouds(state) {
  state.level.exudateClouds.length = 0;
}

// Avança o relógio em passos de 1/60, como o jogo.
function advance(pressure, state, seconds, step = 1 / 60) {
  const frames = Math.round(seconds / step);
  for (let frame = 0; frame < frames; frame++) {
    state.time += step;
    pressure.update(step);
  }
}

test('custo dobra a cada nuvem já ativa', () => {
  assert.equal(exudateUseCost(0), 1);
  assert.equal(exudateUseCost(1), 2);
  assert.equal(exudateUseCost(2), 4);
  assert.equal(exudateUseCost(3), 8);
  assert.equal(exudateUseCost(4), 16);
});

test('1. três aplicações espaçadas somam 3 pontos', () => {
  const state = createState();
  const pressure = createPathogenPressure({ state });
  for (let use = 1; use <= 3; use++) {
    // Cada uso acontece com o céu limpo: a nuvem anterior já sumiu.
    removeAllClouds(state);
    pressure.registerSuccessfulExudateUse(`app-${use}`);
    addCloud(state, use);
  }
  assert.equal(pressure.exudatePoints, 3);
});

test('2. três aplicações sobrepostas somam 7 pontos', () => {
  const state = createState();
  const pressure = createPathogenPressure({ state });
  for (let use = 1; use <= 3; use++) {
    pressure.registerSuccessfulExudateUse(`app-${use}`);
    addCloud(state, use);
  }
  assert.equal(pressure.exudatePoints, 1 + 2 + 4);
});

test('3. a nuvem sumir muda o custo, mas não apaga os pontos', () => {
  const state = createState();
  const pressure = createPathogenPressure({ state });
  pressure.registerSuccessfulExudateUse('a');
  addCloud(state, 1);
  pressure.registerSuccessfulExudateUse('b');
  addCloud(state, 2);

  let reading = pressure.update(0);
  assert.equal(reading.activeCloudCount, 2);
  assert.equal(reading.nextUseCost, 4);
  const pointsWithClouds = reading.exudatePoints;
  assert.equal(pointsWithClouds, 3);

  removeAllClouds(state);
  reading = pressure.update(0);
  assert.equal(reading.activeCloudCount, 0);
  assert.equal(reading.nextUseCost, 1, 'o custo volta a 1 com o céu limpo');
  assert.equal(
    reading.exudatePoints,
    pointsWithClouds,
    'os pontos acumulados não somem junto com a nuvem',
  );
});

test('4. a recuperação respeita nuvem, espera, dt e o piso zero', () => {
  const state = createState();
  const pressure = createPathogenPressure({ state });
  const { recoveryGraceSeconds, recoveryPointsPerSecond } = PATHOGEN_PRESSURE_DEFAULTS;

  pressure.registerSuccessfulExudateUse('a');
  addCloud(state, 1);

  // Bloqueada enquanto há nuvem, por mais tempo que passe.
  advance(pressure, state, 60);
  assert.equal(pressure.recoveryState, 'blocked-by-clouds');
  assert.equal(pressure.exudatePoints, 1);

  removeAllClouds(state);
  // Durante a espera não recupera nada.
  advance(pressure, state, recoveryGraceSeconds - 1);
  assert.equal(pressure.recoveryState, 'waiting');
  assert.equal(pressure.exudatePoints, 1);
  assert.ok(pressure.recoveryDelayRemaining > 0);

  // Passada a espera, cai de acordo com o dt.
  advance(pressure, state, 2);
  assert.equal(pressure.recoveryState, 'recovering');
  const expected = 1 - recoveryPointsPerSecond * 1;
  assert.ok(
    Math.abs(pressure.exudatePoints - expected) < 0.02,
    `esperado ~${expected}, obtido ${pressure.exudatePoints}`,
  );

  // E nunca fica negativo.
  advance(pressure, state, 120);
  assert.equal(pressure.exudatePoints, 0);
  assert.equal(pressure.recoveryState, 'idle');
});

test('5. uma aplicação durante a espera reinicia o relógio', () => {
  const state = createState();
  const pressure = createPathogenPressure({ state });
  const { recoveryGraceSeconds } = PATHOGEN_PRESSURE_DEFAULTS;

  pressure.registerSuccessfulExudateUse('a');
  addCloud(state, 1);
  removeAllClouds(state);
  advance(pressure, state, recoveryGraceSeconds - 5);
  const partway = pressure.recoveryDelayRemaining;
  assert.ok(partway > 0 && partway < recoveryGraceSeconds);

  pressure.registerSuccessfulExudateUse('b');
  assert.equal(
    pressure.recoveryDelayRemaining,
    recoveryGraceSeconds,
    'a espera não voltou ao início',
  );
});

test('6. uma aplicação durante a recuperação interrompe, cobra e reinicia', () => {
  const state = createState();
  const pressure = createPathogenPressure({ state });
  const { recoveryGraceSeconds, recoveryPointsPerSecond } = PATHOGEN_PRESSURE_DEFAULTS;

  // Dois usos sobrepostos: 1 + 2 = 3 pontos.
  pressure.registerSuccessfulExudateUse('a');
  addCloud(state, 1);
  pressure.registerSuccessfulExudateUse('b');
  addCloud(state, 2);

  removeAllClouds(state);
  advance(pressure, state, recoveryGraceSeconds + 4);
  assert.equal(pressure.recoveryState, 'recovering');
  const duringRecovery = pressure.exudatePoints;
  assert.ok(duringRecovery < 3 && duringRecovery > 0);

  // Céu limpo: a nova aplicação custa 1.
  pressure.registerSuccessfulExudateUse('c');
  addCloud(state, 3);
  assert.ok(
    Math.abs(pressure.exudatePoints - (duringRecovery + 1)) < 1e-9,
    'o custo somado não foi 1',
  );
  assert.equal(pressure.recoveryDelayRemaining, recoveryGraceSeconds);

  // E a redução para: mais quadros com nuvem no ar não tiram nada.
  const afterUse = pressure.exudatePoints;
  advance(pressure, state, 5);
  assert.equal(pressure.recoveryState, 'blocked-by-clouds');
  assert.equal(pressure.exudatePoints, afterUse);
  assert.ok(recoveryPointsPerSecond > 0);
});

test('7. estoque baixo de N e Fe aumenta a pressão', () => {
  const empty = createState({ iron: 0 });
  const pressureEmpty = createPathogenPressure({ state: empty });
  const readingEmpty = pressureEmpty.update(0);

  const { basalPressure, nitrogenDeficitWeight, ironDeficitWeight } = PATHOGEN_PRESSURE_DEFAULTS;
  // Sem nada: déficit total nos dois, mais a basal.
  assert.equal(readingEmpty.nitrogenDeficitPressure, nitrogenDeficitWeight);
  assert.equal(readingEmpty.ironDeficitPressure, ironDeficitWeight);
  assert.equal(
    readingEmpty.totalPressure,
    basalPressure + nitrogenDeficitWeight + ironDeficitWeight,
  );
  assert.ok(readingEmpty.totalPressure > basalPressure);
});

test('8. repor o ferro reduz a contribuição dele na hora', () => {
  const state = createState({ iron: 0 });
  const pressure = createPathogenPressure({ state });
  const before = pressure.update(0);
  assert.equal(before.ironDeficitPressure, PATHOGEN_PRESSURE_DEFAULTS.ironDeficitWeight);

  // Metade do máximo: metade do déficit.
  state.pseudomonasSiderophores.ironRecovered = IRON_STOCK_MAXIMUM / 2;
  const half = pressure.update(0);
  assert.ok(
    Math.abs(half.ironDeficitPressure - PATHOGEN_PRESSURE_DEFAULTS.ironDeficitWeight / 2) < 1e-9,
    `esperado metade, obtido ${half.ironDeficitPressure}`,
  );
  assert.ok(half.totalPressure < before.totalPressure);

  // Cheio: contribuição zero, e nunca negativa mesmo passando do máximo.
  state.pseudomonasSiderophores.ironRecovered = IRON_STOCK_MAXIMUM * 3;
  const full = pressure.update(0);
  assert.equal(full.ironDeficitPressure, 0);
});

test('9. coletar ou regenerar exsudato não gera ponto', () => {
  const state = createState();
  const pressure = createPathogenPressure({ state });
  // Coleta e regeneração mexem em `player.exudates` e em `level.exudates`,
  // nunca em nuvem. Nada disso passa por `registerSuccessfulExudateUse`.
  state.player = { exudates: 0 };
  state.player.exudates += 3;
  state.level.exudates = [{ taken: false }, { taken: false }];
  advance(pressure, state, 5);
  assert.equal(pressure.exudatePoints, 0);
  assert.equal(pressure.applicationHistory.length, 0);
});

test('10. o mesmo applicationId não conta duas vezes', () => {
  const state = createState();
  const pressure = createPathogenPressure({ state });
  const first = pressure.registerSuccessfulExudateUse('mesma');
  const second = pressure.registerSuccessfulExudateUse('mesma');
  assert.ok(first, 'a primeira tem de ser registrada');
  assert.equal(second, null, 'a repetida tem de ser recusada');
  assert.equal(pressure.exudatePoints, 1);
  assert.equal(pressure.applicationHistory.length, 1);
});

test('11. reset e troca de fase não guardam nuvem da fase anterior', () => {
  const state = createState();
  const pressure = createPathogenPressure({ state });
  pressure.registerSuccessfulExudateUse('a');
  addCloud(state, 1);
  pressure.registerSuccessfulExudateUse('b');
  addCloud(state, 2);
  assert.equal(pressure.exudatePoints, 3);

  pressure.reset();
  assert.equal(pressure.exudatePoints, 0);
  assert.equal(pressure.applicationHistory.length, 0);
  assert.equal(pressure.recoveryState, 'idle');
  // O mesmo id pode voltar a valer: a fase nova recomeça a numeração.
  assert.ok(pressure.registerSuccessfulExudateUse('a'), 'o id da fase anterior travou a nova');

  // `clear` solta a leitura publicada — nada da fase anterior sobrevive nela.
  pressure.clear();
  assert.equal(state.level.pathogenPressure, null);
  const fresh = pressure.update(0);
  assert.equal(fresh.exudatePoints, 0);
  assert.equal(fresh.applicationHistory.length, 0);
});

test('o histórico registra o que a etapa 2 vai precisar', () => {
  const state = createState();
  state.time = 12.5;
  const pressure = createPathogenPressure({ state });
  pressure.registerSuccessfulExudateUse('a');
  addCloud(state, 1);
  const entry = pressure.registerSuccessfulExudateUse('b');
  assert.equal(entry.applicationId, 'b');
  assert.equal(entry.activeCloudCountBeforeUse, 1);
  assert.equal(entry.cost, 2);
  assert.equal(entry.pointsBefore, 1);
  assert.equal(entry.pointsAfter, 3);
  assert.equal(entry.phaseTime, 12.5);
});

test('as faixas seguem os limites configuráveis', () => {
  const { safeBandMaximum, moderateBandMaximum, highBandMaximum } = PATHOGEN_PRESSURE_DEFAULTS;
  assert.equal(classifyPressureBand(0), 'safe');
  assert.equal(classifyPressureBand(safeBandMaximum), 'safe');
  assert.equal(classifyPressureBand(safeBandMaximum + 0.1), 'moderate');
  assert.equal(classifyPressureBand(moderateBandMaximum), 'moderate');
  assert.equal(classifyPressureBand(moderateBandMaximum + 0.1), 'high');
  assert.equal(classifyPressureBand(highBandMaximum), 'high');
  assert.equal(classifyPressureBand(highBandMaximum + 0.1), 'critical');
});

test('a configuração pode ser trocada e restaurada', () => {
  const state = createState();
  const pressure = createPathogenPressure({ state });
  pressure.configure({ basalPressure: 9, recoveryPointsPerSecond: 2 });
  assert.equal(pressure.settings.basalPressure, 9);
  assert.equal(pressure.update(0).basalPressure, 9);
  pressure.restoreDefaults();
  assert.equal(pressure.settings.basalPressure, PATHOGEN_PRESSURE_DEFAULTS.basalPressure);
});

// O caminho de verdade: tecla E -> `deployCloud` -> nuvem -> registro. Se o
// ponto de integração sair do lugar, estes testes caem e os unitários não.
// Segue o mesmo arranjo de `interaction-audio.test.js`, que é como o projeto já
// exercita a liberação de exsudato.
function gameplayHarness() {
  const state = {
    time: 0,
    gameState: 'play',
    level: { exudateClouds: [], biofilms: [], checkpoints: [], platforms: [] },
    player: { x: 100, y: 100, w: 30, h: 48, facing: 1, exudates: 5, infection: 0 },
    pseudomonasSiderophores: { ironRecovered: 0 },
  };
  const input = { keys: { KeyE: false } };
  const pathogenPressure = createPathogenPressure({ state });
  const gameplay = createEcologicalGameplay({
    state,
    input,
    entities: { burst() {}, interactionFx() {}, audio: { stopGroup() {} } },
    ecology: { agents: [] },
    pathogenPressure,
  });
  gameplay.reset();
  return { state, input, gameplay, pathogenPressure };
}

test('integração - a liberação real de exsudato registra o custo', () => {
  const { state, input, gameplay, pathogenPressure } = gameplayHarness();

  input.keys.KeyE = true;
  gameplay.prepare(1 / 60);
  assert.equal(state.level.exudateClouds.length, 1, 'a nuvem não foi criada');
  assert.equal(pathogenPressure.exudatePoints, 1, 'a primeira aplicação não custou 1');

  // Solta e aperta de novo, com a primeira nuvem ainda no ar: custa 2.
  input.keys.KeyE = false;
  gameplay.prepare(1 / 60);
  input.keys.KeyE = true;
  gameplay.prepare(1 / 60);
  assert.equal(state.level.exudateClouds.length, 2);
  assert.equal(pathogenPressure.exudatePoints, 3, '1 + 2 esperados');

  const reading = pathogenPressure.update(1 / 60);
  assert.equal(reading.nextUseCost, 4);
  assert.equal(reading.recoveryState, 'blocked-by-clouds');
});

test('integração - no teto de quatro nuvens a aplicação custa 16', () => {
  // `deployCloud` faz `clouds.shift()` antes de criar a quinta. Contar depois
  // do shift devolveria 3 (custo 8) para quem já está no teto: é por isso que o
  // registro acontece ANTES dele.
  const { state, input, gameplay, pathogenPressure } = gameplayHarness();
  state.player.exudates = 9;
  for (let use = 0; use < 5; use++) {
    input.keys.KeyE = false;
    gameplay.prepare(1 / 60);
    input.keys.KeyE = true;
    gameplay.prepare(1 / 60);
  }
  assert.equal(state.level.exudateClouds.length, 4, 'o teto de nuvens mudou');
  assert.equal(
    pathogenPressure.exudatePoints,
    1 + 2 + 4 + 8 + 16,
    'a quinta aplicação não custou 16',
  );
});

test('integração - sem exsudato no bolso não há ponto', () => {
  const { state, input, gameplay, pathogenPressure } = gameplayHarness();
  state.player.exudates = 0;
  input.keys.KeyE = true;
  gameplay.prepare(1 / 60);
  assert.equal(state.level.exudateClouds.length, 0);
  assert.equal(pathogenPressure.exudatePoints, 0);
});

test('integração - morrer preserva a pressão; refazer a fase apaga', () => {
  // `respawn` (morte e checkpoint) so mexe no JOGADOR: nao toca em
  // `state.level`, entao as nuvens continuam no ar e o solo segue pressionado.
  // `reset` refaz o nivel inteiro — ai nao sobra solo para pressionar.
  const sim = createSimulator();
  // Ceu limpo na hora do registro: custa 1. A nuvem entra DEPOIS, como no jogo.
  sim.pathogenPressure.registerSuccessfulExudateUse('antes-da-morte');
  sim.state.level.exudateClouds.push({ id: 1, life: 10 });
  assert.equal(sim.pathogenPressure.exudatePoints, 1);

  sim.entities.respawn('death');
  assert.equal(
    sim.pathogenPressure.exudatePoints,
    1,
    'morrer nao pode apagar a pressao: o mundo continua o mesmo',
  );
  assert.equal(sim.state.level.exudateClouds.length, 1, 'a nuvem sumiu no respawn');

  sim.reset();
  assert.equal(sim.pathogenPressure.exudatePoints, 0, 'refazer a fase tinha de zerar');
  assert.equal(sim.pathogenPressure.applicationHistory.length, 0);
});

test('integração - o simulador cria, publica e limpa a leitura', () => {
  const sim = createSimulator();
  assert.ok(sim.pathogenPressure, 'o simulador não expõe o sistema');
  sim.step(1 / 60);
  const reading = sim.state.level.pathogenPressure;
  assert.ok(reading, 'a leitura não foi publicada no nível');
  assert.equal(reading.exudatePoints, 0);
  assert.equal(reading.basalPressure, PATHOGEN_PRESSURE_DEFAULTS.basalPressure);

  // OBSERVACAO DE AJUSTE, nao defeito: com os pesos provisorios, uma fase que
  // comeca com N e Fe zerados ja nasce fora da faixa `safe` — 1 + 4 + 4 = 9,
  // contra um teto de 8. Sem nenhum exsudato aplicado. O teste registra o
  // numero em vez de uma faixa, para nao travar o ajuste desses pesos.
  const { basalPressure, nitrogenDeficitWeight, ironDeficitWeight } = PATHOGEN_PRESSURE_DEFAULTS;
  assert.equal(
    reading.totalPressure,
    basalPressure + nitrogenDeficitWeight + ironDeficitWeight,
  );
  assert.equal(
    reading.pressureBand,
    classifyPressureBand(reading.totalPressure),
    'a faixa não corresponde à pressão calculada',
  );
});
