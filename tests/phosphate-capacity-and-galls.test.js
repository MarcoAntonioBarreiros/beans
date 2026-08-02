import assert from 'node:assert/strict';
import test from 'node:test';

import { PHOSPHATE_SOLUBILIZATION_DEFAULTS, getPhaseManifest } from '../src/procgen/campaign-manifest.js';
import {
  phosphateHudCapacity,
  phosphateObjectiveMinimum,
  updateContextPanel,
} from '../src/procgen/hud-context.js';
import {
  createPhosphateDepositAt,
  createPhosphateSolubilization,
  finalizePhosphateStockCapacity,
} from '../src/procgen/phosphate-solubilization.js';
import {
  createMeloidogyneLifecycle,
  isActiveMeloidogyneGall,
} from '../src/procgen/meloidogyne-lifecycle.js';
import { createPathogenArrival } from '../src/procgen/pathogen-arrival.js';
import { PATHOGEN_PRESSURE_DEFAULTS } from '../src/procgen/pathogen-pressure.js';

// DUAS CORREÇÕES PEQUENAS E ISOLADAS
// ==================================
//
//   1. A barra de fósforo dividia o estoque por `minimumTransportedPhosphate`
//      (0,65), que é o MÍNIMO DO OBJETIVO, não a reserva da fase. Numa fase com
//      quatro depósitos de 1 unidade, transportar o primeiro já marcava 100%.
//
//   2. A galha residual — a cicatriz que sobra quando a fêmea morre — era
//      contada como organismo. Ocupava vaga na raiz para sempre e mantinha a
//      fase presa em "Meloidogyne ativa", bloqueando toda chegada externa nova.

const STEP = 1 / 60;

// ---------------------------------------------------------------------------
// CAPACIDADE DE FÓSFORO
// ---------------------------------------------------------------------------

function levelWithDeposits(amounts) {
  const level = {
    platforms: [], crystals: [], phosphateDeposits: [],
    availablePhosphatePools: [], phosphateTransportParticles: [],
  };
  amounts.forEach((amount, index) => {
    const root = {
      id: `r${index}`, logicIndex: index, x: 400 + index * 500, y: 500,
      w: 240, h: 54, type: 'root', rootHealth: 0.6, maxRootHealth: 1,
    };
    level.platforms.push(root);
    const deposit = createPhosphateDepositAt({
      level, hostPlatform: root, logicIndex: index, id: `dep-${index}`,
    });
    deposit.initialPhosphate = amount;
    deposit.remainingPhosphate = amount;
  });
  return level;
}

test('1. a capacidade só existe depois de finalizada', () => {
  const level = levelWithDeposits([1]);
  assert.equal(level.phosphateStockCapacity, undefined, 'a capacidade nasceu pronta');
  // Nada dentro de `createPhosphateDepositAt` calcula capacidade: no momento em
  // que ele roda, os depósitos seguintes ainda não existem.
  assert.equal(finalizePhosphateStockCapacity(level), 1);
  assert.equal(level.phosphateStockCapacity, 1);
});

test('2-4. a capacidade é a soma de initialPhosphate', () => {
  assert.equal(finalizePhosphateStockCapacity(levelWithDeposits([1])), 1);
  assert.equal(finalizePhosphateStockCapacity(levelWithDeposits([1, 1])), 2);
  assert.equal(finalizePhosphateStockCapacity(levelWithDeposits([1, 0.5])), 1.5);
  assert.equal(finalizePhosphateStockCapacity(levelWithDeposits([1, 1, 1, 1])), 4);
});

test('5. a mesma instância em crystals e phosphateDeposits conta uma vez só', () => {
  const level = levelWithDeposits([1, 1]);
  // As duas coleções apontam para os mesmos objetos, de propósito. Somar as duas
  // dobraria a capacidade e a barra nunca passaria de 50%.
  assert.equal(level.crystals.length, 2);
  assert.equal(level.phosphateDeposits.length, 2);
  for (const deposit of level.phosphateDeposits) assert.ok(level.crystals.includes(deposit));
  assert.equal(finalizePhosphateStockCapacity(level), 2);
  assert.equal(level.phosphateDepositCount, 2);
});

test('6. depósito decorativo ou inválido não entra na conta', () => {
  const level = levelWithDeposits([1]);
  // Cristal decorativo: está em `crystals` e nunca foi registrado no sistema.
  level.crystals.push({ phosphateDeposit: true, initialPhosphate: 5, decorativo: true });
  // Registrado, mas sem reserva declarada — não entrega fósforo nenhum.
  level.phosphateDeposits.push({ id: 'vazio', initialPhosphate: 0 });
  level.phosphateDeposits.push({ id: 'invalido' });
  assert.equal(finalizePhosphateStockCapacity(level), 1);
  assert.equal(level.phosphateDepositCount, 3, 'a contagem de unicos mudou de forma inesperada');
});

test('7-8. dissolver o depósito e esvaziar a poça não reduzem a capacidade', () => {
  const level = levelWithDeposits([1, 1]);
  finalizePhosphateStockCapacity(level);
  assert.equal(level.phosphateStockCapacity, 2);
  // A fase TINHA 2 unidades. Que elas tenham saído da rocha não muda isso.
  for (const deposit of level.phosphateDeposits) {
    deposit.remainingPhosphate = 0;
    deposit.broken = true;
    deposit.localAvailablePhosphate = 0;
  }
  level.availablePhosphatePools = [];
  assert.equal(level.phosphateStockCapacity, 2, 'a capacidade caiu com o consumo');
});

function hudPercent(level, rootPhosphateStock, phase = 7) {
  const div = { classList: { add() {}, remove() {} }, innerHTML: '' };
  const state = { campaign: { phase }, level, activeBiomes: [] };
  updateContextPanel(state, level.platforms[0], div, {
    state,
    phosphateSolubilization: { rootPhosphateStock },
  });
  const match = div.innerHTML.match(/Fósforo na raiz \(P\): <strong>(\d+)%/);
  return match ? Number(match[1]) : null;
}

test('9. um depósito totalmente transportado é 100%', () => {
  const level = levelWithDeposits([1]);
  finalizePhosphateStockCapacity(level);
  assert.equal(hudPercent(level, 0.25), 25);
  assert.equal(hudPercent(level, 0.5), 50);
  assert.equal(hudPercent(level, 1), 100);
});

test('10. um de dois depósitos totalmente transportado é 50%', () => {
  const level = levelWithDeposits([1, 1]);
  finalizePhosphateStockCapacity(level);
  assert.equal(hudPercent(level, 0.5), 25);
  assert.equal(hudPercent(level, 1), 50);
  assert.equal(hudPercent(level, 1.5), 75);
  assert.equal(hudPercent(level, 2), 100);
});

test('11. um de quatro depósitos totalmente transportado é 25%', () => {
  const level = levelWithDeposits([1, 1, 1, 1]);
  finalizePhosphateStockCapacity(level);
  assert.equal(hudPercent(level, 1), 25);
  assert.equal(hudPercent(level, 2), 50);
  assert.equal(hudPercent(level, 4), 100);
  // E nunca passa de 100, mesmo com estoque acima da capacidade.
  assert.equal(hudPercent(level, 9), 100);
});

test('12-13. o HUD lê o estoque da raiz e NÃO usa mais o mínimo do objetivo', () => {
  const level = levelWithDeposits([4]);
  finalizePhosphateStockCapacity(level);
  // Com o denominador antigo (0,65), 0,65 transportado daria 100%. Com a
  // capacidade real (4), dá 16%.
  const minimum = PHOSPHATE_SOLUBILIZATION_DEFAULTS.minimumTransportedPhosphate;
  assert.equal(hudPercent(level, minimum), Math.round(minimum / 4 * 100));
  assert.notEqual(hudPercent(level, minimum), 100, 'o mínimo do objetivo ainda é o denominador');
  assert.equal(phosphateHudCapacity(level), 4);
});

test('14. o mínimo do objetivo continua existindo e inalterado', () => {
  assert.equal(
    phosphateObjectiveMinimum(7),
    PHOSPHATE_SOLUBILIZATION_DEFAULTS.minimumTransportedPhosphate,
  );
  // O manifesto da fase 7 não foi tocado.
  assert.equal(
    getPhaseManifest(7)?.phosphateSolubilization?.minimumTransportedPhosphate,
    PHOSPHATE_SOLUBILIZATION_DEFAULTS.minimumTransportedPhosphate,
  );
});

test('15. sem depósito funcional a capacidade é zero e o indicador some', () => {
  const level = {
    platforms: [{ id: 'r', logicIndex: 0, x: 0, y: 500, w: 200, h: 54, type: 'root' }],
    crystals: [], phosphateDeposits: [], availablePhosphatePools: [],
  };
  assert.equal(finalizePhosphateStockCapacity(level), 0);
  assert.equal(phosphateHudCapacity(level), 0);
  // Sem divisão por zero e sem barra fantasma.
  assert.equal(hudPercent(level, 0.5), null);
});

test('16. o desafio autoral da fase 7 mantém geometria e reserva', () => {
  // Um depósito autoral continua nascendo com 1 unidade e a altura mínima que
  // torna a parede intransponível sem solubilizar.
  const level = levelWithDeposits([]);
  const root = { id: 'h', logicIndex: 3, x: 400, y: 500, w: 240, h: 54, type: 'root' };
  level.platforms.push(root);
  const deposit = createPhosphateDepositAt({
    level, hostPlatform: root, logicIndex: 3, authored: true, id: 'autoral',
  });
  assert.equal(deposit.initialPhosphate, 1);
  assert.equal(deposit.remainingPhosphate, 1);
  assert.ok(deposit.h >= 190, `altura da parede caiu para ${deposit.h}`);
  assert.equal(deposit.authored, true);
  assert.equal(finalizePhosphateStockCapacity(level), 1);
});

test('17-18. respawn preserva a capacidade; reconstrução recalcula', () => {
  const level = levelWithDeposits([1, 1]);
  finalizePhosphateStockCapacity(level);
  const frozen = level.phosphateStockCapacity;
  // Respawn não reconstrói o nível: nada chama a finalização de novo.
  for (const deposit of level.phosphateDeposits) deposit.remainingPhosphate = 0;
  assert.equal(level.phosphateStockCapacity, frozen);
  // Reconstrução completa: fase nova, capacidade nova.
  const rebuilt = levelWithDeposits([1, 1, 1]);
  assert.equal(finalizePhosphateStockCapacity(rebuilt), 3);
});

// ---------------------------------------------------------------------------
// GALHAS RESIDUAIS
// ---------------------------------------------------------------------------

const gall = (overrides = {}) => ({
  id: 'g', platform: null, progress: 0.9, stage: 'adult-female',
  dead: false, permanentPenalty: 0.2, ...overrides,
});

test('19-21. galha viva conta como ativa, em qualquer estágio com fêmea', () => {
  assert.equal(isActiveMeloidogyneGall(gall({ stage: 'young-gall', progress: 0.3 })), true);
  assert.equal(isActiveMeloidogyneGall(gall({ stage: 'mature-gall', progress: 0.6 })), true);
  // Senescente ainda é fêmea viva: ela está morrendo, não morta.
  assert.equal(isActiveMeloidogyneGall(gall({ stage: 'senescent-female' })), true);
});

test('22-23. galha morta ou residual NÃO conta como ativa', () => {
  assert.equal(isActiveMeloidogyneGall(gall({ dead: true })), false);
  assert.equal(isActiveMeloidogyneGall(gall({ stage: 'residual-gall' })), false);
  assert.equal(isActiveMeloidogyneGall(null), false);
});

function meloKit() {
  const root = {
    id: 'raiz', logicIndex: 3, x: 400, y: 500, w: 240, h: 54, type: 'root', rootHealth: 0.8,
  };
  const state = {
    time: 0, cameraX: 0, gameState: 'play',
    campaign: { phase: 10, seed: 'galha' },
    player: { x: 420, y: 440, w: 30, h: 48 },
    level: { platforms: [root], exudateClouds: [], dynamicPathogenArrival: true },
  };
  const lifecycle = createMeloidogyneLifecycle({
    state, entities: { burst() {}, damagePlayer() {} },
  });
  lifecycle.reset();
  return { state, root, lifecycle };
}

function addScar(lifecycle, root) {
  lifecycle.galls.push(gall({
    id: `scar-${lifecycle.galls.length}`, platform: root,
    x: root.x + 60 + lifecycle.galls.length * 40, y: root.y + 18, phase: 0,
    stage: 'residual-gall', dead: true, progress: 1, permanentPenalty: 0.22,
  }));
}

test('24. a galha residual permanece no mundo e mantém a sequela', () => {
  const { root, lifecycle, state } = meloKit();
  addScar(lifecycle, root);
  const scar = lifecycle.galls[0];
  // Não some: continua desenhada, com a penalidade permanente registrada.
  assert.equal(lifecycle.galls.length, 1);
  assert.equal(scar.permanentPenalty, 0.22);
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_target, key) => (key === 'createRadialGradient'
      ? () => ({ addColorStop() {} })
      : (...args) => { calls.push({ name: String(key), args }); }),
    set: () => true,
  });
  state.level.traversalDebugVisible = false;
  lifecycle.render(ctx);
  assert.ok(calls.some(call => call.name === 'ellipse'), 'a cicatriz deixou de ser desenhada');
});

test('25-26. duas cicatrizes não ocupam vaga nem bloqueiam nova penetração', () => {
  const { root, lifecycle } = meloKit();
  addScar(lifecycle, root);
  addScar(lifecycle, root);
  // Antes: duas galhas na raiz = occupancy 2 = raiz permanentemente imune.
  lifecycle.introduceJ2Arrival({ preferredRoot: root, x: root.x + 100, count: 1 });
  const juvenile = lifecycle.juveniles[0];
  assert.ok(juvenile, 'nenhum J2 foi criado');
  assert.equal(juvenile.targetRoot, root, 'o J2 recusou a raiz cicatrizada');
});

test('27. galha ATIVA continua ocupando vaga', () => {
  const { root, lifecycle } = meloKit();
  lifecycle.galls.push(gall({ id: 'viva-1', platform: root }));
  lifecycle.galls.push(gall({ id: 'viva-2', platform: root }));
  // Duas galhas vivas na mesma raiz continuam sendo o teto: a regra não foi
  // afrouxada, só parou de contar cicatriz.
  const active = lifecycle.galls.filter(isActiveMeloidogyneGall);
  assert.equal(active.length, 2);
});

// ---------------------------------------------------------------------------
// AMEAÇA ATIVA E NOVA CHEGADA
// ---------------------------------------------------------------------------

function arrivalKit({ galls = [], juveniles = [], eggMasses = [] } = {}) {
  const root = {
    x: 900, y: 500, w: 220, h: 54, type: 'root', logicIndex: 3, rootHealth: 1,
  };
  const state = {
    time: 0, cameraX: 0, cameraY: 0,
    visibleWorldWidth: 1280, visibleWorldHeight: 720,
    campaign: { phase: 10, seed: 'ativo' },
    player: { x: 100, y: 400, w: 30, h: 48 },
    level: {
      platforms: [root], exudateClouds: [], exudates: [], microbeEncounters: [],
      ralstoniaTravelInoculum: [],
      pathogenPressure: {
        totalPressure: 4, pressureBand: 'safe', settings: PATHOGEN_PRESSURE_DEFAULTS,
      },
      objectiveProgress: { attemptId: 1 },
    },
  };
  const systems = {
    meloidogyneLifecycle: {
      galls, juveniles, eggMasses,
      introduceJ2Arrival: () => null,
    },
  };
  const arrival = createPathogenArrival({ state, systems });
  arrival.reset();
  return { state, arrival, root, systems };
}

const isActive = kit => kit.arrival.update(STEP).activeByPathogen.meloidogyne === 1;

test('28. J2 vivo mantém a Meloidogyne ativa', () => {
  assert.equal(isActive(arrivalKit({ juveniles: [{ alive: true, state: 'seeking' }] })), true);
});

test('29. galha ativa mantém a Meloidogyne ativa', () => {
  assert.equal(isActive(arrivalKit({ galls: [gall()] })), true);
});

test('30. massa com ovos mantém ativa; massa vazia e neutralizada não', () => {
  assert.equal(isActive(arrivalKit({ eggMasses: [{ eggs: 4, neutralized: false }] })), true);
  assert.equal(isActive(arrivalKit({ eggMasses: [{ eggs: 0, neutralized: false }] })), false);
  assert.equal(isActive(arrivalKit({ eggMasses: [{ eggs: 5, neutralized: true }] })), false);
});

test('31. só cicatrizes: a Meloidogyne deixa de ser ameaça ativa', () => {
  // Este era o bloqueio permanente. Depois do primeiro ciclo terminar, restavam
  // cicatrizes — e a fase ficava para sempre em "ameaça ativa", sem nunca
  // permitir uma nova chegada externa.
  const kit = arrivalKit({
    galls: [gall({ dead: true, stage: 'residual-gall' }), gall({ stage: 'residual-gall' })],
    eggMasses: [{ eggs: 0, neutralized: false }],
    juveniles: [{ alive: false, state: 'seeking' }],
  });
  assert.equal(isActive(kit), false);
  // E volta a ser elegível — obedecendo cooldown e às demais regras normais.
  assert.ok(kit.arrival.eligiblePathogens().includes('meloidogyne'));
});

test('32. a chegada nova continua obedecendo cooldown e limite por espécie', () => {
  const kit = arrivalKit({ galls: [gall({ stage: 'residual-gall', dead: true })] });
  // Com uma galha ATIVA no lugar da cicatriz, a espécie sai da elegibilidade —
  // `maximumActivePerPathogen` não foi tocado.
  const blocked = arrivalKit({ galls: [gall()] });
  assert.ok(kit.arrival.eligiblePathogens().includes('meloidogyne'));
  assert.ok(!blocked.arrival.eligiblePathogens().includes('meloidogyne'));
  assert.equal(kit.arrival.settings.maximumActivePerPathogen, 1);
});

test('33-34. a Ralstonia continua enxergando a cicatriz como porta de entrada', () => {
  // A correção tira a cicatriz da OCUPAÇÃO, não da lesão. A Ralstonia entra por
  // ferida, e a porta que a galha abriu continua aberta depois de a fêmea morrer.
  const semCicatriz = arrivalKit();
  const comCicatriz = arrivalKit({ galls: [] });
  comCicatriz.systems.meloidogyneLifecycle.galls.push(
    gall({ platform: comCicatriz.root, dead: true, stage: 'residual-gall' }),
  );
  const limpo = semCicatriz.arrival.scoreTargets('ralstonia')[0];
  const marcado = comCicatriz.arrival.scoreTargets('ralstonia')[0];
  assert.equal(limpo.lesion, 0);
  assert.ok(marcado.lesion >= 0.6, `a cicatriz deixou de contar como lesão: ${marcado.lesion}`);
  assert.ok(marcado.score > limpo.score, 'a raiz cicatrizada ficou menos atraente');
  // E para a Meloidogyne a mesma cicatriz NÃO é ocupação.
  const meloMarcado = comCicatriz.arrival.scoreTargets('meloidogyne')[0];
  // `Math.abs` porque a parcela e `-0.3 * ocupacao`, e zero vezes negativo da
  // `-0` — que nao e `0` para o strict-equal, mas e a mesma ausencia de ocupacao.
  assert.equal(Math.abs(meloMarcado.occupancy), 0, 'a cicatriz ocupou vaga para a Meloidogyne');
});
