import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RENEWABLE_EXUDATE_DEFAULTS,
  createRenewableExudates,
  isEligibleRoot,
  regenerationInterval,
} from '../src/procgen/renewable-exudates.js';
import { restoreExudatesAhead } from '../src/procgen/simulator.js';

function root(overrides = {}) {
  return {
    id: overrides.id || `root-${overrides.logicIndex ?? 0}`,
    logicIndex: overrides.logicIndex ?? 0,
    x: overrides.x ?? 200,
    y: overrides.y ?? 500,
    w: overrides.w ?? 200,
    h: 60,
    type: 'root',
    rootHealth: overrides.rootHealth ?? 1,
    ...overrides,
  };
}

function makeState({ roots = [root()], exudates = [], player = {}, challenge = null } = {}) {
  return {
    gameState: 'play',
    time: 0,
    campaign: { phase: 3, seed: 'seed-teste' },
    currentCheckpoint: { x: 0, y: 400 },
    player: { x: 220, y: 452, exudates: 0, ...player },
    level: {
      seed: 'seed-teste',
      platforms: roots,
      exudates,
      objectiveProgress: { attemptId: 1 },
      azospirillumChallenge: challenge,
    },
  };
}

function run(system, seconds, dt = 0.5, systems = {}) {
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) system.update(dt, systems);
}

// Os stubs abaixo espelham a API REAL dos sistemas (beneficial-inoculants expoe
// followerGroups() -> Map; inoculum-selection expoe options() -> lista). Usar um
// formato inventado aqui esconderia justamente o tipo de erro que a garantia
// emergencial nao pode ter: achar que ninguem esta recrutado e brotar exsudato
// desnecessario.
function semRecrutados() {
  return {
    inoculants: { colonies: [], followerGroups: () => new Map() },
    inoculumSelection: { options: () => [] },
  };
}

function comAzospirillumRecrutado() {
  return {
    inoculants: {
      colonies: [],
      followerGroups: () => new Map([['azospirillum', [{ type: 'azospirillum' }]]]),
    },
    inoculumSelection: { options: () => [{ kind: 'organism', type: 'azospirillum', count: 1 }] },
  };
}

function comColoniaNoHost(host) {
  return {
    inoculants: {
      colonies: [{ type: 'azospirillum', platform: host, dormant: false }],
      followerGroups: () => new Map(),
    },
    inoculumSelection: { options: () => [] },
  };
}

// --- Formula do intervalo -----------------------------------------------------

test('raiz saudavel regenera mais rapido que raiz doente', () => {
  const saudavel = regenerationInterval(1, .5);
  const media = regenerationInterval(.5, .5);
  const doente = regenerationInterval(.1, .5);
  assert.ok(saudavel < media, `saudavel ${saudavel} deveria ser menor que media ${media}`);
  assert.ok(media < doente, `media ${media} deveria ser menor que doente ${doente}`);
  // Faixas aproximadas declaradas no plano (com jitter neutro em .5 -> fator 1.0).
  assert.ok(saudavel >= 14 && saudavel <= 22, `raiz saudavel: ${saudavel.toFixed(1)}s fora de 14-22s`);
  assert.ok(media >= 30 && media <= 50, `saude intermediaria: ${media.toFixed(1)}s fora de 30-50s`);
  assert.ok(doente >= 50 && doente <= 75, `raiz doente: ${doente.toFixed(1)}s fora de 50-75s`);
});

test('o jitter respeita os limites declarados', () => {
  const minimo = regenerationInterval(1, 0);
  const maximo = regenerationInterval(1, 1);
  const base = RENEWABLE_EXUDATE_DEFAULTS.minimumIntervalSeconds;
  assert.ok(Math.abs(minimo - base * RENEWABLE_EXUDATE_DEFAULTS.jitterMinimum) < .001);
  assert.ok(Math.abs(maximo - base * RENEWABLE_EXUDATE_DEFAULTS.jitterMaximum) < .001);
});

// --- Elegibilidade ------------------------------------------------------------

test('so raiz de rota viva e elegivel: solo, recuperacao, degrau e final ficam de fora', () => {
  assert.equal(isEligibleRoot(root()), true);
  assert.equal(isEligibleRoot({ ...root(), type: 'soil' }), false, 'solo nunca exsuda');
  assert.equal(isEligibleRoot({ ...root(), recovery: true }), false);
  assert.equal(isEligibleRoot({ ...root(), final: true }), false);
  assert.equal(isEligibleRoot({ ...root(), safetyStep: true }), false);
  assert.equal(isEligibleRoot({ ...root(), azospirillumLadderStep: true }), false);
  assert.equal(isEligibleRoot({ ...root(), mycorrhizaStructure: true }), false);
  assert.equal(isEligibleRoot({ ...root(), w: 40 }), false, 'sem superficie nao cabe o item');
  assert.equal(isEligibleRoot({ ...root(), rootHealth: 0 }), false, 'raiz morta nao exsuda');
  assert.equal(isEligibleRoot({ ...root(), logicIndex: -1 }), false);
});

// --- Regeneracao --------------------------------------------------------------

test('a raiz saudavel brota um exsudato renovavel, vinculado a plataforma', () => {
  const platform = root({ rootHealth: 1 });
  const state = makeState({ roots: [platform] });
  const system = createRenewableExudates({ state });
  run(system, 40);

  const renovaveis = state.level.exudates.filter(e => e.renewable);
  assert.equal(renovaveis.length, 1, 'exatamente um renovavel nesta raiz');
  const item = renovaveis[0];
  assert.equal(item.platform, platform);
  assert.equal(item.logicIndex, platform.logicIndex);
  assert.equal(item.taken, false);
  assert.equal(item.x, platform.x + item.offsetX);
  assert.equal(item.y, platform.y + item.offsetY);
  // Fica sobre a superficie da raiz, nao dentro do bloco nem fora da largura.
  assert.ok(item.x > platform.x && item.x < platform.x + platform.w, 'dentro da largura util');
  assert.ok(item.y < platform.y, 'acima da superficie');
});

test('o item acompanha a plataforma pelo offset', () => {
  const platform = root();
  const state = makeState({ roots: [platform] });
  const system = createRenewableExudates({ state });
  run(system, 40);
  const item = state.level.exudates.find(e => e.renewable);
  const offsetX = item.offsetX;
  const offsetY = item.offsetY;

  platform.x += 120;
  platform.y -= 60;
  system.update(.5);
  assert.equal(item.x, platform.x + offsetX);
  assert.equal(item.y, platform.y + offsetY);
});

test('maximo de um renovavel por raiz — nao duplica enquanto nao for coletado', () => {
  const platform = root();
  const state = makeState({ roots: [platform] });
  const system = createRenewableExudates({ state });
  run(system, 300);
  assert.equal(state.level.exudates.filter(e => e.renewable).length, 1);
});

test('depois da coleta o mesmo slot e reaproveitado, sem crescer o array', () => {
  const platform = root();
  const state = makeState({ roots: [platform] });
  const system = createRenewableExudates({ state });
  run(system, 40);
  const item = state.level.exudates.find(e => e.renewable);
  assert.equal(state.level.exudates.length, 1);

  item.taken = true;      // jogador coletou
  run(system, 40);        // novo ciclo
  assert.equal(state.level.exudates.length, 1, 'o array nao pode crescer a cada regeneracao');
  assert.equal(state.level.exudates[0], item, 'o slot e reutilizado');
  assert.equal(item.taken, false, 'o item voltou a existir');
});

test('o teto global de renovaveis ativos e respeitado', () => {
  const roots = Array.from({ length: 8 }, (_, index) => root({
    logicIndex: index, x: 200 + index * 300, id: `r${index}`,
  }));
  const state = makeState({ roots });
  const system = createRenewableExudates({ state });
  run(system, 400);
  const ativos = state.level.exudates.filter(e => e.renewable && !e.taken).length;
  assert.ok(
    ativos <= RENEWABLE_EXUDATE_DEFAULTS.maximumActiveGlobal,
    `${ativos} renovaveis ativos passa do teto de ${RENEWABLE_EXUDATE_DEFAULTS.maximumActiveGlobal}`,
  );
});

test('nunca nasce em bloco de solo', () => {
  const solo = { ...root({ logicIndex: 1 }), type: 'soil' };
  const state = makeState({ roots: [solo] });
  const system = createRenewableExudates({ state });
  run(system, 400);
  assert.equal(state.level.exudates.length, 0);
});

test('raiz morta nao gera naturalmente', () => {
  const morta = root({ rootHealth: 0 });
  const state = makeState({ roots: [morta] });
  const system = createRenewableExudates({ state });
  run(system, 400);
  assert.equal(state.level.exudates.length, 0);
});

test('nao substitui nem altera os exsudatos iniciais', () => {
  const platform = root();
  const inicial = { logicIndex: 0, x: 240, y: 470, taken: false };
  const state = makeState({ roots: [platform], exudates: [inicial] });
  const system = createRenewableExudates({ state });
  run(system, 60);
  assert.equal(inicial.x, 240, 'o exsudato inicial nao pode ser movido');
  assert.equal(inicial.y, 470);
  assert.equal(inicial.renewable, undefined, 'o inicial nao vira renovavel');
  assert.ok(state.level.exudates.includes(inicial), 'o inicial continua na fase');
});

// --- Determinismo -------------------------------------------------------------

test('o calculo e deterministico para a mesma seed e varia entre seeds', () => {
  const posicoes = seed => {
    const platform = root();
    const state = makeState({ roots: [platform] });
    state.level.seed = seed;
    state.campaign.seed = seed;
    const system = createRenewableExudates({ state });
    run(system, 60);
    const item = state.level.exudates.find(e => e.renewable);
    return { x: item.x, y: item.y };
  };
  const a1 = posicoes('seed-A');
  const a2 = posicoes('seed-A');
  const b = posicoes('seed-B');
  assert.deepEqual(a1, a2, 'a mesma seed precisa dar o mesmo resultado');
  assert.notDeepEqual(a1, b, 'seeds diferentes precisam variar');
});

// --- Morte, respawn e farming -------------------------------------------------

test('restoreExudatesAhead nao reativa renovaveis: sem farming por respawn', () => {
  const level = {
    exudates: [
      { x: 100, taken: true },                    // inicial atras
      { x: 900, taken: true },                    // inicial adiante
      { x: 950, taken: true, renewable: true },   // renovavel adiante
    ],
  };
  const devolvidos = restoreExudatesAhead(level, 400);
  assert.equal(devolvidos, 1, 'so o inicial adiante volta');
  assert.equal(level.exudates[1].taken, false, 'o inicial adiante voltou');
  assert.equal(level.exudates[2].taken, true, 'o renovavel continua no cooldown dele');
});

test('a morte nao duplica renovaveis nem cria dois itens na mesma raiz', () => {
  const platform = root();
  const state = makeState({ roots: [platform] });
  const system = createRenewableExudates({ state });
  run(system, 40);
  const item = state.level.exudates.find(e => e.renewable);
  item.taken = true;

  // Respawn: devolve os iniciais adiante e reinicia os cronometros do modulo.
  restoreExudatesAhead(state.level, 0);
  system.reset();
  run(system, 400);

  const renovaveis = state.level.exudates.filter(e => e.renewable);
  assert.equal(renovaveis.length, 1, 'continua um unico slot renovavel nesta raiz');
});

// --- Garantia emergencial -----------------------------------------------------

function makeEmergencyState({ playerExudates = 0, exudates = [] } = {}) {
  const antes = root({ logicIndex: 3, x: 200, rootHealth: .9, id: 'antes' });
  const host = root({ logicIndex: 5, x: 900, rootHealth: .8, id: 'host' });
  const depois = root({ logicIndex: 6, x: 1500, rootHealth: 1, id: 'depois' });
  const target = { ...depois, id: 'target', mandatoryAzospirillumTarget: true };
  const state = makeState({
    roots: [antes, host, depois],
    exudates,
    player: { exudates: playerExudates },
    challenge: {
      id: 'azo-challenge-5-6',
      hostLogicIndex: 5,
      targetLogicIndex: 6,
      hostPlatform: host,
      targetPlatform: target,
      requiredReach: 96,
      developed: false,
      traversed: false,
      mandatory: true,
    },
  });
  return { state, antes, host, depois };
}

test('a garantia emergencial devolve um exsudato quando tudo mais falta', () => {
  const { state } = makeEmergencyState();
  const system = createRenewableExudates({
    state,
    // Isola a emergencia: sem regeneracao natural competindo.
    config: { minimumIntervalSeconds: 9999, maximumIntervalSeconds: 9999 },
  });
  run(system, 12, .5, semRecrutados());
  const emergencial = state.level.exudates.filter(e => e.renewable);
  assert.equal(emergencial.length, 1, 'exatamente um exsudato de emergencia');
  assert.equal(emergencial[0].taken, false);
  // Usa o mesmo formato/coleta dos demais: nada de item artificial de debug.
  assert.equal(typeof emergencial[0].x, 'number');
  assert.equal(typeof emergencial[0].taken, 'boolean');
});

test('a emergencia nunca aparece depois do bloco alto', () => {
  const { state, host } = makeEmergencyState();
  const system = createRenewableExudates({
    state,
    config: { minimumIntervalSeconds: 9999, maximumIntervalSeconds: 9999 },
  });
  run(system, 30, .5, semRecrutados());
  for (const item of state.level.exudates.filter(e => e.renewable)) {
    assert.ok(
      item.x <= host.x + host.w + 40,
      `exsudato de emergencia em x=${item.x} caiu depois do hospedeiro (x=${host.x})`,
    );
  }
});

test('a emergencia nao dispara quando ja existe exsudato disponivel', () => {
  const disponivel = { logicIndex: 3, x: 260, y: 470, taken: false };
  const { state } = makeEmergencyState({ exudates: [disponivel] });
  const system = createRenewableExudates({
    state,
    config: { minimumIntervalSeconds: 9999, maximumIntervalSeconds: 9999 },
  });
  run(system, 30, .5, semRecrutados());
  assert.equal(state.level.exudates.filter(e => e.renewable).length, 0);
});

test('a emergencia nao dispara quando o jogador ja carrega exsudato', () => {
  const { state } = makeEmergencyState({ playerExudates: 2 });
  const system = createRenewableExudates({
    state,
    config: { minimumIntervalSeconds: 9999, maximumIntervalSeconds: 9999 },
  });
  run(system, 30, .5, semRecrutados());
  assert.equal(state.level.exudates.filter(e => e.renewable).length, 0);
});

test('a emergencia nao dispara quando Azospirillum ja esta recrutado', () => {
  const { state } = makeEmergencyState();
  const system = createRenewableExudates({
    state,
    config: { minimumIntervalSeconds: 9999, maximumIntervalSeconds: 9999 },
  });
  run(system, 30, .5, comAzospirillumRecrutado());
  assert.equal(state.level.exudates.filter(e => e.renewable).length, 0);
});

test('a emergencia nao dispara quando ja existe colonia no hospedeiro', () => {
  const { state, host } = makeEmergencyState();
  const system = createRenewableExudates({
    state,
    config: { minimumIntervalSeconds: 9999, maximumIntervalSeconds: 9999 },
  });
  run(system, 30, .5, comColoniaNoHost(host));
  assert.equal(state.level.exudates.filter(e => e.renewable).length, 0);
});

test('a emergencia nao dispara depois do desafio concluido', () => {
  const { state } = makeEmergencyState();
  state.level.azospirillumChallenge.traversed = true;
  const system = createRenewableExudates({
    state,
    config: { minimumIntervalSeconds: 9999, maximumIntervalSeconds: 9999 },
  });
  run(system, 30, .5, semRecrutados());
  assert.equal(state.level.exudates.filter(e => e.renewable).length, 0);
});

test('a emergencia respeita o intervalo de nova tentativa (nao spawna varios)', () => {
  const { state } = makeEmergencyState();
  const system = createRenewableExudates({
    state,
    config: { minimumIntervalSeconds: 9999, maximumIntervalSeconds: 9999 },
  });
  // Roda bastante tempo mantendo a condicao de bloqueio: mesmo assim so o item
  // ativo existe por vez (o teto por raiz e o global seguram o resto).
  run(system, 120, .5, semRecrutados());
  const ativos = state.level.exudates.filter(e => e.renewable && !e.taken).length;
  assert.ok(ativos <= RENEWABLE_EXUDATE_DEFAULTS.maximumActiveGlobal);
});
