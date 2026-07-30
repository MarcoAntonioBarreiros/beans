// Fase 9 — Ralstonia: runtime, ativação, porta, disseminação e objetivos
// =====================================================================
//
// Este arquivo cobre o RUNTIME (o que o outro arquivo de Ralstonia não cobre,
// porque lá só vivem as funções puras): ativação por proximidade, dinâmica da
// porta de entrada, consumo de ferro, máquina de disseminação, contadores e o
// objetivo ao vivo.
//
// Toda simulação aqui é headless: nenhum canvas, nenhum DOM.

import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import {
  RALSTONIA_DEFAULTS as C,
  getPersistentUnlocksBeforePhase,
  getPhaseManifest,
} from '../src/procgen/campaign-manifest.js';
import { createCampaignObjectiveEvaluator } from '../src/procgen/campaign-objectives.js';
import {
  campaignPhaseSeed,
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { auditTraversableRoute, generateLevel } from '../src/procgen/generator.js';
import { generateUnderdevelopedNitrogenRoots } from '../src/procgen/nitrogen-root.js';
import { generateAzospirillumRootLadders } from '../src/procgen/azospirillum-root-growth.js';
import { applySignatureChallenge } from '../src/procgen/signature-challenge.js';
import { createRouteAnchorRegistry } from '../src/procgen/route-geometry.js';
import { createRalstoniaVascularWilt } from '../src/procgen/ralstonia-vascular-wilt.js';
import {
  canRalstoniaFocusSpread,
  chooseRalstoniaSpreadTarget,
  ralstoniaArrivalProtection,
  ralstoniaSpreadOpening,
  isRalstoniaSpreadTargetEligible,
} from '../src/procgen/ralstonia-spread.js';
import { ralstoniaAzospirillumClosure, ralstoniaWoundDynamics } from '../src/procgen/ralstonia-wilt-core.js';
import { createRandom } from '../src/procgen/random.js';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Bancada headless
// ---------------------------------------------------------------------------

function makeRoot(logicIndex, overrides = {}) {
  return {
    id: `root-${logicIndex}`,
    type: 'root',
    logicIndex,
    x: logicIndex * 420,
    y: 500,
    w: 220,
    h: 60,
    rootHealth: .5,
    rootGameplayDamage: .5,
    ...overrides,
  };
}

// Nível sintético com uma raiz por chunk: suficiente para exercitar seleção,
// ativação e disseminação sem depender da geração procedural completa.
function bench({
  phase = 9,
  chunks = 36,
  seed = 'bancada',
  rootOverrides = () => ({}),
} = {}) {
  const platforms = [];
  for (let i = 0; i <= chunks; i++) platforms.push(makeRoot(i, rootOverrides(i)));
  platforms.push({ ...makeRoot(chunks + 1), id: 'final', final: true });

  const bursts = [];
  const damages = [];
  const state = {
    time: 0,
    gameState: 'play',
    tutorialOpen: false,
    cameraX: 0,
    campaign: { phase, seed, unlocks: {} },
    player: { x: -5000, y: 440, w: 26, h: 34, soil: 20, hope: 20 },
    level: {
      seed,
      platforms,
      biofilms: [],
      azospirillumRoots: [],
      rhizobiumNodules: [],
      exudates: [],
      ironDeposits: [],
      allies: [],
      agents: [],
    },
    discoveredMicrobes: new Set(),
  };
  const entities = {
    burst: (...args) => bursts.push(args),
    damagePlayer: (...args) => damages.push(args),
  };
  const inoculants = { colonies: [] };
  const pseudomonas = { colonyStates: new Map() };

  const system = createRalstoniaVascularWilt({ state, entities, inoculants, pseudomonas });
  system.initialize();

  const api = {
    state, entities, inoculants, pseudomonas, system, platforms, bursts, damages,
    step(seconds = DT) {
      const steps = Math.max(1, Math.round(seconds / DT));
      for (let i = 0; i < steps; i++) {
        state.time += DT;
        system.update(DT);
      }
    },
    // Coloca Miguelito sobre uma raiz (ativa o foco por proximidade).
    goTo(root) {
      state.player.x = root.x + root.w / 2 - state.player.w / 2;
      state.player.y = root.y - state.player.h;
    },
    addBiofilm(root, strength = .9) {
      const film = {
        functional: true,
        platform: root,
        x: root.x + root.w / 2,
        y: root.y,
        radius: 90,
        protectionStrength: strength,
      };
      state.level.biofilms.push(film);
      return film;
    },
    addAzospirillum(root, { growth = 1, vigor = 1, dormant = false } = {}) {
      const colony = {
        id: `azo-${root.id}`,
        type: 'azospirillum',
        platform: root,
        x: root.x + root.w / 2,
        y: root.y - 8,
        growth, vigor, dormant,
      };
      inoculants.colonies.push(colony);
      return colony;
    },
    addPseudomonas(root, { vigor = 1, ironReserve = .7, dormant = false } = {}) {
      const colony = {
        id: `pse-${root.id}`,
        type: 'pseudomonas',
        platform: root,
        x: root.x + root.w / 2,
        y: root.y - 8,
        vigor, dormant,
      };
      inoculants.colonies.push(colony);
      const entry = { colony, ironReserve, activePressure: 0 };
      pseudomonas.colonyStates.set(colony.id, entry);
      return entry;
    },
  };
  return api;
}

function focusOfRole(system, role) {
  return system.foci.find(focus => focus.role === role) || null;
}

// ---------------------------------------------------------------------------
// 1. SELEÇÃO PROCEDURAL
// ---------------------------------------------------------------------------

test('a fase 9 seleciona um foco de prevencao e um de contencao, em raizes diferentes', () => {
  const b = bench();
  const prevencao = focusOfRole(b.system, 'prevention');
  const contencao = focusOfRole(b.system, 'containment');
  assert.ok(prevencao, 'precisa existir foco de prevencao');
  assert.ok(contencao, 'precisa existir foco de contencao');
  assert.notEqual(prevencao.root, contencao.root, 'as duas licoes exigem raizes diferentes');
  assert.ok(
    contencao.rootLogicIndex > prevencao.rootLogicIndex,
    'a contencao vem depois da prevencao na rota',
  );
});

test('o foco de prevencao nasce prevenivel e o de contencao nasce vascular', () => {
  const b = bench();
  const prevencao = focusOfRole(b.system, 'prevention');
  const contencao = focusOfRole(b.system, 'containment');
  assert.equal(prevencao.everEnteredVascular, false, 'ainda da para prevenir');
  assert.ok(prevencao.vascularLoad < C.vascularEntryThreshold);
  assert.equal(contencao.everEnteredVascular, true, 'so da para conter');
  assert.ok(contencao.vascularLoad >= C.vascularEntryThreshold);
});

test('nenhum foco cai na raiz final, de recuperacao ou em estrutura', () => {
  const b = bench({
    rootOverrides: i => (i % 4 === 0 ? { recovery: true } : {}),
  });
  for (const focus of b.system.foci) {
    assert.equal(focus.root.final, undefined);
    assert.notEqual(focus.root.recovery, true);
    assert.notEqual(focus.root.safetyStep, true);
    assert.notEqual(focus.root.mycorrhizaStructure, true);
  }
});

test('a mesma seed seleciona sempre as mesmas raizes', () => {
  const a = bench({ seed: 'seed-estavel' });
  const c = bench({ seed: 'seed-estavel' });
  assert.deepEqual(
    a.system.foci.map(f => f.rootLogicIndex),
    c.system.foci.map(f => f.rootLogicIndex),
  );
});

// ---------------------------------------------------------------------------
// 2. ATIVAÇÃO POR PROXIMIDADE
// ---------------------------------------------------------------------------

test('foco distante nasce pendente e NAO progride', () => {
  const b = bench();
  const focus = focusOfRole(b.system, 'prevention');
  const superficieInicial = focus.surfaceLoad;
  const vascularInicial = focus.vascularLoad;
  const portaInicial = focus.woundOpening;

  b.step(60);

  assert.equal(focus.activationState, 'pending');
  assert.equal(focus.surfaceLoad, superficieInicial, 'superficie congelada');
  assert.equal(focus.vascularLoad, vascularInicial, 'xilema congelado');
  assert.equal(focus.woundOpening, portaInicial, 'porta congelada');
  assert.equal(focus.root.ralstoniaDamagePressure, undefined, 'nao pressiona a raiz');
  assert.equal(b.system.pendingFocusCount, b.system.foci.length);
});

test('aproximar-se cria o estado warning, e a graca ainda segura a doenca', () => {
  const b = bench();
  const focus = focusOfRole(b.system, 'prevention');
  b.goTo(focus.root);
  b.step(DT);
  assert.equal(focus.activationState, 'warning');

  const superficie = focus.surfaceLoad;
  b.step(C.activationGraceSeconds - 1);
  assert.equal(focus.activationState, 'warning', 'ainda na graca');
  assert.equal(focus.surfaceLoad, superficie, 'a doenca nao avancou durante a graca');
});

test('tutorial aberto pausa a graca', () => {
  const b = bench();
  const focus = focusOfRole(b.system, 'prevention');
  b.goTo(focus.root);
  b.step(DT);
  const restante = focus.activationGraceRemaining;
  b.state.tutorialOpen = true;
  b.step(5);
  assert.equal(focus.activationGraceRemaining, restante, 'a graca nao corre com o cartao aberto');
  b.state.tutorialOpen = false;
  b.step(1);
  assert.ok(focus.activationGraceRemaining < restante);
});

test('depois da graca o foco fica ativo e a doenca corre', () => {
  const b = bench();
  const focus = focusOfRole(b.system, 'prevention');
  b.goTo(focus.root);
  b.step(C.activationGraceSeconds + 2);
  assert.equal(focus.activationState, 'active');
  assert.ok(b.system.activeFocusCount >= 1);
  assert.ok(Number.isFinite(focus.root.ralstoniaDamagePressure), 'agora pressiona a raiz');
});

test('o foco de prevencao AINDA e prevenivel quando o jogador chega', () => {
  const b = bench();
  const focus = focusOfRole(b.system, 'prevention');
  // O jogador demora: 3 minutos vagando longe do foco.
  b.step(180);
  assert.equal(focus.everEnteredVascular, false, 'nao entrou no xilema sem o jogador por perto');
  b.goTo(focus.root);
  b.step(C.activationGraceSeconds + 1);
  assert.equal(focus.everEnteredVascular, false, 'chega ainda prevenivel');
});

// ---------------------------------------------------------------------------
// 3. PORTA DE ENTRADA
// ---------------------------------------------------------------------------

function portaDepois(segundos, opcoes) {
  let opening = opcoes.currentOpening;
  for (let t = 0; t < segundos; t += DT) {
    opening = ralstoniaWoundDynamics({ ...opcoes, currentOpening: opening, dt: DT }).nextOpening;
  }
  return opening;
}

test('ferida sem controle mantem a porta aberta', () => {
  const porta = portaDepois(60, { currentOpening: .35, rootHealth: .5, rootDamage: .5 });
  assert.ok(porta > C.woundColonizationLimit, `porta deveria seguir aberta, ficou ${porta}`);
});

test('Azospirillum funcional fecha a porta; dormente nao fecha', () => {
  const comAzo = portaDepois(60, {
    currentOpening: .35, rootHealth: .5, rootDamage: .5, azospirillumClosure: .9,
  });
  assert.ok(comAzo <= C.woundColonizationLimit, `Azo deveria fechar, ficou ${comAzo}`);

  const b = bench();
  const raiz = b.platforms[5];
  b.addAzospirillum(raiz, { dormant: true });
  assert.equal(
    ralstoniaAzospirillumClosure({ colonies: b.inoculants.colonies, root: raiz }), 0,
    'colonia dormente nao fecha nada',
  );
});

test('Azospirillum imaturo nao fecha; maduro fecha', () => {
  const b = bench();
  const raiz = b.platforms[5];
  const colony = b.addAzospirillum(raiz, { growth: .4 });
  assert.equal(ralstoniaAzospirillumClosure({ colonies: [colony], root: raiz }), 0);
  colony.growth = 1;
  assert.ok(ralstoniaAzospirillumClosure({ colonies: [colony], root: raiz }) > .5);
});

test('raiz lateral desenvolvida no hospedeiro fecha a porta', () => {
  const raiz = makeRoot(5);
  const escada = { host: raiz, developed: true };
  assert.ok(ralstoniaAzospirillumClosure({ lateralRoots: [escada], root: raiz }) > .5);
  assert.equal(
    ralstoniaAzospirillumClosure({ lateralRoots: [{ host: makeRoot(9), developed: true }], root: raiz }),
    0, 'escada em outro hospedeiro nao vale',
  );
});

test('controlar Rhizoctonia e Meloidogyne reduz a pressao da porta', () => {
  const comLesao = ralstoniaWoundDynamics({
    currentOpening: .3, rootHealth: .5, rootDamage: .5, rhizoctoniaPressure: .8, dt: DT,
  });
  const semLesao = ralstoniaWoundDynamics({
    currentOpening: .3, rootHealth: .5, rootDamage: .5, rhizoctoniaPressure: 0, dt: DT,
  });
  assert.ok(comLesao.lesionFloor > semLesao.lesionFloor, 'Rhizoctonia sobe o piso da lesao');
  assert.ok(semLesao.closurePressure > comLesao.closurePressure, 'sem a lesao a porta fecha mais rapido');

  const comNematoide = ralstoniaWoundDynamics({
    currentOpening: .3, rootHealth: .5, rootDamage: .5, meloidogynePressure: .8, dt: DT,
  });
  assert.ok(comNematoide.lesionFloor > semLesao.lesionFloor, 'galhas tambem abrem porta');
});

test('saude recuperada favorece o fechamento', () => {
  const doente = portaDepois(60, { currentOpening: .3, rootHealth: .4, rootDamage: .6 });
  const sadia = portaDepois(60, { currentOpening: .3, rootHealth: .95, rootDamage: .05 });
  assert.ok(sadia < doente, 'raiz recuperada cicatriza mais');
  assert.ok(sadia <= C.woundSealThreshold, 'raiz sadia sela a porta');
});

test('porta selada zera a entrada vascular', () => {
  const b = bench();
  const focus = focusOfRole(b.system, 'prevention');
  b.system.lab.setFocus(focus, { woundOpening: 0, surfaceLoad: 1, activationState: 'active' });
  focus.activationGraceRemaining = 0;
  b.goTo(focus.root);
  b.step(30);
  assert.equal(focus.everEnteredVascular, false, 'sem porta nao existe entrada');
});

// ---------------------------------------------------------------------------
// 4. PREVENÇÃO
// ---------------------------------------------------------------------------

function prepararFocoAtivo(b, role = 'prevention') {
  const focus = focusOfRole(b.system, role);
  b.goTo(focus.root);
  b.step(DT);
  focus.activationGraceRemaining = 0;
  b.step(DT);
  return focus;
}

test('Bacillus sozinho previne quando colocado cedo', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b);
  b.addBiofilm(focus.root, .95);
  b.step(45);
  assert.equal(focus.neutralized, true, 'barreira de Bacillus previne');
  assert.equal(b.system.preventedCount, 1);
});

test('Pseudomonas com ferro previne', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b);
  b.addPseudomonas(focus.root, { vigor: 1, ironReserve: .7 });
  b.step(60);
  assert.equal(focus.neutralized, true);
  assert.equal(b.system.preventedCount, 1);
});

test('Azospirillum sozinho previne ao fechar a porta antes da entrada', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b);
  b.addAzospirillum(focus.root);
  b.step(90);
  assert.equal(focus.everEnteredVascular, false, 'a porta fechou antes da entrada');
  assert.equal(focus.neutralized, true, 'sem porta a populacao superficial perde aderencia');
  assert.equal(b.system.preventedCount, 1);
});

test('sem nenhum controle a doenca entra no xilema', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b);
  b.step(120);
  assert.equal(focus.everEnteredVascular, true, 'porta aberta + tempo = entrada');
  assert.equal(b.system.preventedCount, 0);
});

test('preventedCount nao conta o mesmo foco duas vezes', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b);
  b.addBiofilm(focus.root, .95);
  b.step(45);
  assert.equal(b.system.preventedCount, 1);
  // Força uma segunda avaliação do mesmo foco.
  focus.neutralized = false;
  focus.surfaceLoad = 0;
  focus.activationState = 'active';
  b.step(10);
  assert.equal(b.system.preventedCount, 1, 'everPrevented impede a contagem dupla');
});

test('foco que ja entrou no xilema nunca conta como prevencao', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.addBiofilm(focus.root, 1);
  b.addPseudomonas(focus.root, { ironReserve: .7 });
  b.step(120);
  assert.equal(focus.neutralized, false, 'infeccao vascular nao e curada');
  assert.equal(b.system.preventedCount, 0);
});

// ---------------------------------------------------------------------------
// 5. CONTENÇÃO
// ---------------------------------------------------------------------------

test('Pseudomonas contem uma infeccao vascular, mantendo carga residual', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.addPseudomonas(focus.root, { vigor: 1, ironReserve: .7 });
  b.step(60);
  assert.equal(focus.everContained, true, 'contencao alcancada');
  assert.equal(b.system.containedCount, 1);
  assert.ok(focus.vascularLoad >= C.minimumVascularFloorAfterEntry, 'carga residual permanece');
  assert.equal(focus.neutralized, false, 'contido nao e curado');
});

test('Azospirillum nao reduz a carga vascular', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.addAzospirillum(focus.root);
  const inicial = focus.vascularLoad;
  b.step(90);
  assert.ok(focus.vascularLoad > inicial, 'Azo nao ataca a bacteria dentro do vaso');
  assert.equal(b.system.containedCount, 0);
});

test('retirar o controle permite a retomada, e containedCount nao sobe de novo', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  const entry = b.addPseudomonas(focus.root, { vigor: 1, ironReserve: .7 });
  b.step(60);
  assert.equal(b.system.containedCount, 1);
  assert.equal(focus.contained, true);

  // Controle desaparece.
  entry.colony.dormant = true;
  entry.ironReserve = 0;
  b.step(30);
  assert.equal(focus.contained, false, 'sem controle o avanco volta');
  assert.equal(focus.everContained, true, 'o marco permanece');

  // Volta o controle: contem de novo, mas o contador nao duplica.
  entry.colony.dormant = false;
  entry.ironReserve = .7;
  b.step(60);
  assert.equal(b.system.containedCount, 1, 'um foco conta uma vez');
});

test('murcha critica recua com Bacillus E Pseudomonas', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.system.lab.setFocus(focus, { vascularLoad: C.criticalThreshold + .05 });
  b.step(DT);
  assert.equal(b.system.criticalCount, 1);
  b.addBiofilm(focus.root, 1);
  b.addPseudomonas(focus.root, { vigor: 1, ironReserve: .7 });
  b.step(90);
  // Mede ESTE foco: outros focos da fase seguem sua própria vida e uma
  // asserção sobre o contador global mediria o que o teste não controlou.
  assert.ok(focus.vascularLoad < C.criticalThreshold, 'saiu do critico');
  assert.equal(focus.vascularLoad, C.minimumVascularFloorAfterEntry, 'recuou ao piso, sem cura');
});

// ---------------------------------------------------------------------------
// 6. FERRO (consumo único por colônia por quadro)
// ---------------------------------------------------------------------------

test('o ferro e descontado uma vez por colonia por quadro, mesmo com dois focos', () => {
  const b = bench();
  // Dois focos ativos ao alcance da MESMA colônia.
  const raizA = b.platforms[10];
  const raizB = b.platforms[10];
  const focoA = b.system.lab.spawnFocus({ root: raizA, stage: 'surface' });
  const focoB = b.system.lab.spawnFocus({ root: raizB, stage: 'surface' });
  assert.ok(focoA && focoB);
  const entry = b.addPseudomonas(raizA, { vigor: 1, ironReserve: .7 });
  b.goTo(raizA);
  b.system.lab.activateAll();

  const antes = entry.ironReserve;
  b.step(DT);
  const gastoDois = antes - entry.ironReserve;

  // Mesmo cenário com um foco só.
  const c = bench();
  const raizC = c.platforms[10];
  c.system.lab.spawnFocus({ root: raizC, stage: 'surface' });
  const entryC = c.addPseudomonas(raizC, { vigor: 1, ironReserve: .7 });
  c.goTo(raizC);
  c.system.lab.activateAll();
  const antesC = entryC.ironReserve;
  c.step(DT);
  const gastoUm = antesC - entryC.ironReserve;

  assert.ok(gastoDois > 0, 'houve consumo');
  assert.ok(
    gastoDois < gastoUm * 2 + 1e-9,
    `dois focos nao podem custar o dobro linear (um=${gastoUm}, dois=${gastoDois})`,
  );
});

test('foco pendente, dormente ou fora de alcance nao consome ferro', () => {
  const b = bench();
  const focus = focusOfRole(b.system, 'prevention');
  const entry = b.addPseudomonas(focus.root, { vigor: 1, ironReserve: .7 });
  const antes = entry.ironReserve;
  b.step(2);
  assert.equal(entry.ironReserve, antes, 'foco pendente nao gasta ferro');

  prepararFocoAtivo(b);
  entry.colony.dormant = true;
  const depois = entry.ironReserve;
  b.step(2);
  assert.equal(entry.ironReserve, depois, 'colonia dormente nao gasta ferro');

  entry.colony.dormant = false;
  entry.colony.x = focus.root.x + 5000;
  const longe = entry.ironReserve;
  b.step(2);
  assert.equal(entry.ironReserve, longe, 'colonia fora de alcance nao gasta ferro');
});

test('ferro baixo reduz o efeito da Pseudomonas', () => {
  const forte = bench();
  const focoForte = prepararFocoAtivo(forte, 'containment');
  forte.addPseudomonas(focoForte.root, { vigor: 1, ironReserve: .7 });
  forte.step(1);

  const fraco = bench();
  const focoFraco = prepararFocoAtivo(fraco, 'containment');
  fraco.addPseudomonas(focoFraco.root, { vigor: 1, ironReserve: 0 });
  fraco.step(1);

  assert.ok(
    focoForte.pseudomonasControl > focoFraco.pseudomonasControl,
    'reserva de ferro pesa na supressao',
  );
});

// ---------------------------------------------------------------------------
// 7. VALORES DERIVADOS (nada de degradação irreversível)
// ---------------------------------------------------------------------------

test('a Ralstonia publica multiplicadores, nao destroi valores-base', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.step(20);
  const root = focus.root;
  assert.ok(root.ralstoniaCarbonMultiplier < 1, 'ha perda de carbono');
  assert.equal(root.carbonAvailability, undefined, 'nao escreve o campo compartilhado');
  assert.equal(root.rootHealth, .5, 'nao mexe em rootHealth (dono e root-health-gameplay)');

  const piorMultiplicador = root.ralstoniaCarbonMultiplier;
  // Aliviar a pressão precisa DEVOLVER função.
  b.system.lab.setFocus(focus, { vascularLoad: C.minimumVascularFloorAfterEntry, surfaceLoad: 0 });
  b.step(1);
  assert.ok(
    root.ralstoniaCarbonMultiplier > piorMultiplicador,
    'com menos carga o multiplicador melhora',
  );
});

test('a recarga das colonias e derivada, nao destruida', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  const colony = b.addAzospirillum(focus.root);
  colony.rechargeIntensity = .5;
  b.step(5);
  assert.ok(colony.vascularEfficiencyMultiplier < 1, 'publica multiplicador');
  assert.equal(colony.rechargeIntensity, .5, 'nao sobrescreve o valor-base');
});

// ---------------------------------------------------------------------------
// 8. DISSEMINAÇÃO
// ---------------------------------------------------------------------------

test('foco superficial, neutralizado ou contido nao dissemina', () => {
  const superficial = { activationState: 'active', vascularLoad: .1, spreadEventsUsed: 0, spreadGeneration: 0 };
  assert.equal(canRalstoniaFocusSpread(superficial), false);
  assert.equal(canRalstoniaFocusSpread({ ...superficial, vascularLoad: .9, neutralized: true }), false);
  assert.equal(canRalstoniaFocusSpread({ ...superficial, vascularLoad: .9, contained: true }), false);
  assert.equal(canRalstoniaFocusSpread({ ...superficial, activationState: 'pending', vascularLoad: .9 }), false);
});

test('foco vascular acima do limiar pode disseminar; abaixo, nao', () => {
  const base = { activationState: 'active', spreadEventsUsed: 0, spreadGeneration: 0, everEnteredVascular: true };
  assert.equal(canRalstoniaFocusSpread({ ...base, vascularLoad: C.spreadTriggerThreshold }), true);
  assert.equal(canRalstoniaFocusSpread({ ...base, vascularLoad: C.spreadTriggerThreshold - .01 }), false);
});

test('o limite de geracao e a cota por foco sao respeitados', () => {
  const base = {
    activationState: 'active', vascularLoad: .9, everEnteredVascular: true, spreadEventsUsed: 0,
  };
  assert.equal(canRalstoniaFocusSpread({ ...base, spreadGeneration: 0 }), true);
  assert.equal(
    canRalstoniaFocusSpread({ ...base, spreadGeneration: C.maximumSpreadGeneration }), false,
    'foco da ultima geracao nao gera outro',
  );
  assert.equal(
    canRalstoniaFocusSpread({
      ...base, spreadGeneration: 0, spreadEventsUsed: C.maximumSpreadEventsPerFocus,
    }), false,
    'cota por foco esgotada',
  );
});

test('um evento ativo por foco impede um segundo', () => {
  const focus = {
    activationState: 'active', vascularLoad: .9, everEnteredVascular: true,
    spreadEventsUsed: 0, spreadGeneration: 0,
  };
  assert.equal(canRalstoniaFocusSpread(focus, { activeEventForFocus: true }), false);
});

test('o spreadTimer realmente diminui e abre um evento', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.system.lab.setFocus(focus, { vascularLoad: .9 });
  const antes = focus.spreadTimer;
  b.step(1);
  assert.ok(focus.spreadTimer < antes, 'o timer conta');
  b.step(antes + 2);
  assert.equal(b.system.spreadEventCount, 1, 'abriu exatamente um evento');
  const evento = b.system.spreadEvents[0];
  assert.equal(evento.state, 'warning');
  assert.ok(evento.targetRoot && evento.targetRoot !== focus.root);
});

test('o aviso dura o tempo configurado e depois vira viagem', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.system.lab.setFocus(focus, { vascularLoad: .9 });
  b.system.lab.forceSpread(focus);
  b.step(DT * 2);
  const evento = b.system.spreadEvents[0];
  assert.equal(evento.state, 'warning');
  b.step(C.spreadWarningSeconds - .5);
  assert.equal(evento.state, 'warning', 'ainda avisando');
  b.step(1);
  assert.equal(evento.state, 'traveling', 'agora viaja');
  assert.ok(evento.travelProgress > 0 && evento.travelProgress < 1, 'nao teleporta');
});

test('o alvo respeita distancia minima e maxima e exige porta', () => {
  const origem = makeRoot(0, { x: 0, rootHealth: .3, rootGameplayDamage: .7 });
  const perto = makeRoot(1, { x: 150, rootHealth: .3, rootGameplayDamage: .7 });
  const boa = makeRoot(2, { x: 500, rootHealth: .3, rootGameplayDamage: .7 });
  const integra = makeRoot(3, { x: 620, rootHealth: 1, rootGameplayDamage: 0 });
  const longe = makeRoot(4, { x: 4000, rootHealth: .3, rootGameplayDamage: .7 });
  const finalRoot = makeRoot(5, { x: 560, final: true, rootHealth: .2, rootGameplayDamage: .8 });

  assert.equal(isRalstoniaSpreadTargetEligible(perto, { source: origem }), false, 'perto demais');
  assert.equal(isRalstoniaSpreadTargetEligible(longe, { source: origem }), false, 'longe demais');
  assert.equal(isRalstoniaSpreadTargetEligible(integra, { source: origem }), false, 'raiz integra resiste');
  assert.equal(isRalstoniaSpreadTargetEligible(finalRoot, { source: origem }), false, 'raiz final nunca');
  assert.equal(isRalstoniaSpreadTargetEligible(boa, { source: origem }), true);

  assert.equal(
    isRalstoniaSpreadTargetEligible(boa, { source: origem, occupiedRoots: new Set([boa]) }), false,
    'raiz com foco nao recebe outro',
  );
  assert.equal(
    isRalstoniaSpreadTargetEligible(boa, { source: origem, targetedRoots: new Set([boa]) }), false,
    'raiz com evento a caminho nao recebe outro',
  );
});

test('a mesma seed escolhe sempre o mesmo alvo', () => {
  const monta = () => ({
    origem: makeRoot(0, { x: 0, rootHealth: .3, rootGameplayDamage: .7 }),
    a: makeRoot(2, { x: 500, rootHealth: .3, rootGameplayDamage: .7 }),
    bb: makeRoot(3, { x: 700, rootHealth: .3, rootGameplayDamage: .7 }),
  });
  const escolher = () => {
    const m = monta();
    return chooseRalstoniaSpreadTarget({
      sourceRoot: m.origem,
      roots: [m.a, m.bb],
      random: createRandom('seed-fixa:spread'),
    })?.id;
  };
  assert.ok(escolher(), 'precisa encontrar alvo');
  assert.equal(escolher(), escolher());
});

test('sem alvo elegivel nenhum evento e criado e a cota nao e gasta', () => {
  // Nível com uma única raiz elegível: não há para onde disseminar.
  const b = bench({ chunks: 1 });
  const focus = b.system.lab.spawnFocus({ root: b.platforms[0], stage: 'critical' });
  b.goTo(b.platforms[0]);
  b.system.lab.forceSpread(focus);
  b.step(2);
  assert.equal(b.system.spreadEventCount, 0, 'nenhum evento');
  assert.equal(focus.spreadEventsUsed, 0, 'cota preservada');
  assert.ok(focus.spreadTimer > 0, 'reagenda com spreadRetrySeconds');
});

test('Bacillus no alvo bloqueia a chegada e incrementa o contador uma vez', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.system.lab.setFocus(focus, { vascularLoad: .9 });
  b.system.lab.forceSpread(focus);
  b.step(DT * 2);
  const evento = b.system.spreadEvents[0];
  assert.ok(evento, 'evento aberto');
  b.addBiofilm(evento.targetRoot, 1);
  b.system.lab.resolveNextArrival();
  assert.equal(evento.state, 'blocked');
  assert.equal(b.system.blockedSpreadCount, 1);
  assert.equal(b.system.successfulSpreadCount, 0, 'nenhum foco novo nasceu');
});

test('Azospirillum e Pseudomonas tambem bloqueiam; protecao fraca nao', () => {
  const forte = ralstoniaArrivalProtection({ bacillus: .9, opening: .5 });
  assert.equal(forte.blocked, true, 'Bacillus forte bloqueia');
  assert.equal(ralstoniaArrivalProtection({ pseudomonas: 1, opening: .5 }).blocked, true);
  assert.equal(
    ralstoniaArrivalProtection({ azospirillumClosure: 1, rootHealth: 1, opening: .5 }).blocked, true,
    'porta fechando + tecido recuperado bloqueia',
  );
  assert.equal(ralstoniaArrivalProtection({ bacillus: .1, pseudomonas: .1, opening: .5 }).blocked, false);
  assert.equal(
    ralstoniaArrivalProtection({ opening: C.woundColonizationLimit - .01 }).blocked, true,
    'porta cicatrizada bloqueia sozinha',
  );
});

test('falhar em bloquear cria um foco SUPERFICIAL de geracao seguinte', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.system.lab.setFocus(focus, { vascularLoad: .9 });
  b.system.lab.forceSpread(focus);
  b.step(DT * 2);
  const evento = b.system.spreadEvents[0];
  const antes = b.system.foci.length;
  b.system.lab.resolveNextArrival();

  assert.equal(evento.state, 'completed');
  assert.equal(b.system.successfulSpreadCount, 1);
  assert.equal(b.system.foci.length, antes + 1, 'nasceu um foco');
  const novo = b.system.foci[b.system.foci.length - 1];
  assert.equal(novo.vascularLoad, 0, 'nunca nasce vascular');
  assert.equal(novo.everEnteredVascular, false, 'ainda da para prevenir');
  assert.equal(novo.spreadGeneration, 1);
  assert.equal(novo.activationState, 'warning', 'respeita a graca');
});

test('a disseminacao nao e infinita: geracao 1 nao gera geracao 2 na fase 9', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.system.lab.setFocus(focus, { vascularLoad: .9 });
  b.system.lab.forceSpread(focus);
  b.step(DT * 2);
  b.system.lab.resolveNextArrival();
  const novo = b.system.foci[b.system.foci.length - 1];
  b.system.lab.setFocus(novo, { vascularLoad: .95, activationState: 'active' });
  novo.everEnteredVascular = true;
  b.system.lab.forceSpread(novo);
  b.step(20);
  assert.equal(
    b.system.spreadEventCount, 1,
    'a cascata para na geracao maxima da fase 9',
  );
});

test('maximumFocusCount e respeitado na chegada', () => {
  const b = bench();
  // Enche a fase até o teto de focos.
  while (b.system.focusCount < C.maximumFocusCount) {
    const livre = b.platforms.find(root => (
      !root.final && !b.system.foci.some(focus => focus.root === root)
    ));
    if (!livre) break;
    b.system.lab.spawnFocus({ root: livre, stage: 'surface' });
  }
  const origem = b.system.foci[0];
  b.system.lab.setFocus(origem, { vascularLoad: .9, activationState: 'active' });
  b.goTo(origem.root);
  b.system.lab.forceSpread(origem);
  b.step(DT * 2);
  const antes = b.system.focusCount;
  if (b.system.spreadEvents.length) b.system.lab.resolveNextArrival();
  assert.ok(b.system.focusCount <= C.maximumFocusCount, 'nunca passa do teto');
  assert.ok(b.system.focusCount >= antes - 1);
});

test('reset limpa focos, eventos, contadores e marcadores das raizes', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.system.lab.setFocus(focus, { vascularLoad: .9 });
  b.system.lab.forceSpread(focus);
  b.step(DT * 2);
  assert.ok(b.system.spreadEvents.length);

  b.system.reset();
  assert.equal(b.system.foci.length, 0);
  assert.equal(b.system.spreadEvents.length, 0);
  assert.equal(b.system.blockedSpreadCount, 0);
  assert.equal(b.system.successfulSpreadCount, 0);
  assert.equal(b.system.spreadEventCount, 0);
  for (const root of b.platforms) {
    assert.equal(root.ralstoniaVascularLoad, undefined);
    assert.equal(root.ralstoniaWoundOpening, undefined);
    assert.equal(root.ralstoniaEntryWound, undefined, 'marcador legado tambem sai');
  }
});

test('respawn (novo update depois de morte) nao duplica focos nem eventos', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.system.lab.setFocus(focus, { vascularLoad: .9 });
  b.system.lab.forceSpread(focus);
  b.step(DT * 2);
  const focos = b.system.foci.length;
  const eventos = b.system.spreadEvents.length;

  // Morte: o jogo sai de 'play' e volta.
  b.state.gameState = 'dying';
  b.step(3);
  b.state.gameState = 'play';
  b.step(DT);
  assert.equal(b.system.foci.length, focos, 'nao semeou de novo');
  assert.equal(b.system.spreadEvents.length, eventos, 'nao duplicou o evento');
});

test('eventos ficam pausados enquanto o tutorial esta aberto', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.system.lab.setFocus(focus, { vascularLoad: .9 });
  b.system.lab.forceSpread(focus);
  b.step(DT * 2);
  const evento = b.system.spreadEvents[0];
  const restante = evento.warningRemaining;
  b.state.tutorialOpen = true;
  b.step(3);
  assert.equal(evento.warningRemaining, restante, 'o aviso nao corre com o cartao aberto');
});

// ---------------------------------------------------------------------------
// 9. GATILHOS DIDÁTICOS
// ---------------------------------------------------------------------------

test('os marcos didaticos so acendem quando o evento correspondente acontece', () => {
  const b = bench();
  assert.deepEqual(b.system.didactics, {
    entry: false, obstruction: false, containment: false, spread: false,
  });

  const focus = prepararFocoAtivo(b);
  b.step(120);
  assert.equal(b.system.didactics.entry, true, 'entrada aconteceu');
  b.step(180);
  assert.equal(b.system.didactics.obstruction, true, 'obstrucao aconteceu');

  const c = bench();
  const contencao = prepararFocoAtivo(c, 'containment');
  c.addPseudomonas(contencao.root, { vigor: 1, ironReserve: .7 });
  c.step(60);
  assert.equal(c.system.didactics.containment, true);

  const d = bench();
  const origem = prepararFocoAtivo(d, 'containment');
  d.system.lab.setFocus(origem, { vascularLoad: .9 });
  d.system.lab.forceSpread(origem);
  d.step(DT * 2);
  assert.equal(d.system.didactics.spread, true);
});

test('foco pendente nao acende nenhum marco didatico', () => {
  const b = bench();
  b.step(120);
  assert.equal(b.system.didactics.entry, false);
  assert.equal(b.system.didactics.spread, false);
});

// ---------------------------------------------------------------------------
// 10. OBJETIVO AO VIVO
// ---------------------------------------------------------------------------

function avaliadorFake() {
  const ralstonia = {
    preventedCount: 0,
    containedCount: 0,
    criticalCount: 0,
    blockedSpreadCount: 0,
  };
  const state = {
    campaign: { phase: 9 },
    level: { campaignPhase: 9, goal: { completed: false } },
  };
  const evaluator = createCampaignObjectiveEvaluator({ state, systems: { ralstonia } });
  return { evaluator, ralstonia, state };
}

const REQUISITOS = getPhaseManifest(9).finalTest.requires;

function resultadoDe(evaluator, key) {
  return evaluator.evaluate(REQUISITOS).results.find(r => r.condition.key === key);
}

test('activeCriticalRalstoniaCount e uma condicao AO VIVO', () => {
  const { evaluator, ralstonia } = avaliadorFake();

  ralstonia.criticalCount = 0;
  assert.equal(resultadoDe(evaluator, 'activeCriticalRalstoniaCount').passed, true, 'zero: passa');

  ralstonia.criticalCount = 2;
  assert.equal(
    resultadoDe(evaluator, 'activeCriticalRalstoniaCount').passed, false,
    'com foco critico volta a incompleto — era exatamente o bug do objetivo verde',
  );

  ralstonia.criticalCount = 0;
  assert.equal(resultadoDe(evaluator, 'activeCriticalRalstoniaCount').passed, true, 'volta a passar');
});

test('prevencao, contencao e disseminacao bloqueada continuam acumulativas', () => {
  const { evaluator, ralstonia } = avaliadorFake();
  for (const key of [
    'preventedRalstoniaEntryCount',
    'containedVascularRalstoniaCount',
    'blockedRalstoniaSpreadCount',
  ]) {
    const campo = key === 'preventedRalstoniaEntryCount' ? 'preventedCount'
      : key === 'containedVascularRalstoniaCount' ? 'containedCount'
      : 'blockedSpreadCount';
    ralstonia[campo] = 1;
    assert.equal(resultadoDe(evaluator, key).passed, true, `${key} conquistado`);
    ralstonia[campo] = 0;
    assert.equal(resultadoDe(evaluator, key).passed, true, `${key} permanece latched`);
  }
});

test('a chegada na raiz final continua funcionando', () => {
  const { evaluator, state } = avaliadorFake();
  assert.equal(resultadoDe(evaluator, 'reachedFinalRoot').passed, false);
  state.level.goal.completed = true;
  assert.equal(resultadoDe(evaluator, 'reachedFinalRoot').passed, true);
});

test('o teste final da fase 9 exige as quatro licoes e a chegada', () => {
  const keys = REQUISITOS.map(condition => condition.key);
  assert.deepEqual(keys.sort(), [
    'activeCriticalRalstoniaCount',
    'blockedRalstoniaSpreadCount',
    'containedVascularRalstoniaCount',
    'preventedRalstoniaEntryCount',
    'reachedFinalRoot',
  ]);
  const critico = REQUISITOS.find(c => c.key === 'activeCriticalRalstoniaCount');
  assert.equal(critico.latch, false, 'declarado explicitamente como nao-latched');
});

// ---------------------------------------------------------------------------
// 11. PROCEDURAL EM 100 SEEDS
// ---------------------------------------------------------------------------

// Mesma sequência de prepareLevel(), sem DOM/canvas nem Phase Lab.
function gerarFaseNove(seedName) {
  const campaign = createCampaign(seedName, { storage: null });
  campaign.phase = 9;
  Object.assign(campaign.unlocks, getPersistentUnlocksBeforePhase(9));
  const profile = prepareCampaignGeneration(campaign);
  const seedValue = campaignPhaseSeed(campaign);

  let level = generateLevel(seedValue);
  level = decorateCampaignLevel(level, campaign, profile);

  const anchors = createRouteAnchorRegistry(level);
  anchors.capture();

  applySignatureChallenge(level, campaign.phase);
  level.microbeEncounters = generateCampaignEncounters({
    platforms: level.platforms, phase: campaign.phase, seedValue,
  }).concat(level.authoredEncounters || []);

  const antes = new Map((level.platforms || []).map(p => [
    p, { x: p.x, y: p.y, w: p.w, h: p.h },
  ]));

  generateAzospirillumRootLadders({
    level, phase: campaign.phase, seedValue,
    encounters: level.microbeEncounters,
    config: getPhaseManifest(campaign.phase).azospirillumRootLadder,
  });
  generateUnderdevelopedNitrogenRoots({
    level, phase: campaign.phase, seedValue,
    encounters: level.microbeEncounters,
    config: getPhaseManifest(campaign.phase).nitrogenRoot,
  });
  auditTraversableRoute(level, {
    doubleJump: Boolean(campaign.unlocks.doubleJump),
    dash: Boolean(campaign.unlocks.dash),
  });
  anchors.capture();
  anchors.synchronize();

  return { level, campaign, antes };
}

function sistemaSobre(level, campaign) {
  const state = {
    time: 0, gameState: 'play', tutorialOpen: false, cameraX: 0,
    campaign,
    player: { x: -9000, y: 0, w: 26, h: 34, soil: 20, hope: 20 },
    level,
    discoveredMicrobes: new Set(),
  };
  const system = createRalstoniaVascularWilt({
    state,
    entities: { burst() {}, damagePlayer() {} },
    inoculants: { colonies: [] },
    pseudomonas: { colonyStates: new Map() },
  });
  system.initialize();
  return { state, system };
}

test('100 seeds da fase 9 produzem uma fase jogavel e ancorada', { timeout: 240000 }, () => {
  const problemas = [];
  for (let i = 0; i < 100; i++) {
    const seedName = `ralstonia-seed-${i}`;
    const { level, campaign, antes } = gerarFaseNove(seedName);
    const { state, system } = sistemaSobre(level, campaign);

    const prevencao = system.foci.find(f => f.role === 'prevention');
    const contencao = system.foci.find(f => f.role === 'containment');

    if (!prevencao) { problemas.push(`${seedName}: sem foco de prevencao`); continue; }
    if (!contencao) { problemas.push(`${seedName}: sem foco de contencao`); continue; }
    if (prevencao.root === contencao.root) problemas.push(`${seedName}: focos na mesma raiz`);
    if (contencao.rootLogicIndex <= prevencao.rootLogicIndex) {
      problemas.push(`${seedName}: contencao (${contencao.rootLogicIndex}) nao vem depois da prevencao (${prevencao.rootLogicIndex})`);
    }
    if (prevencao.everEnteredVascular) problemas.push(`${seedName}: prevencao ja vascular`);
    if (!contencao.everEnteredVascular) problemas.push(`${seedName}: contencao nao comeca vascular`);
    if (system.foci.length > getPhaseManifest(9).ralstonia.maximumFocusCount) {
      problemas.push(`${seedName}: focos acima do teto`);
    }

    for (const focus of system.foci) {
      if (focus.root.final) problemas.push(`${seedName}: foco na raiz final`);
      if (focus.root.recovery) problemas.push(`${seedName}: foco em raiz de recuperacao`);
      if (focus.activationState !== 'pending') problemas.push(`${seedName}: foco nasceu ativo`);
    }

    // Foco distante não progride.
    for (let f = 0; f < 240; f++) { state.time += DT; system.update(DT); }
    if (prevencao.everEnteredVascular) {
      problemas.push(`${seedName}: foco distante progrediu ate o xilema`);
    }

    // Existe alvo bloqueável para a disseminação, e nunca é a raiz final.
    const alvo = chooseRalstoniaSpreadTarget({
      sourceRoot: contencao.root,
      roots: (level.platforms || []).filter(p => p.type === 'root'),
      random: createRandom(`${seedName}:alvo`),
      occupiedRoots: new Set(system.foci.map(f => f.root)),
    });
    if (alvo?.final) problemas.push(`${seedName}: disseminacao apontou para a raiz final`);

    // Nenhuma plataforma se moveu por causa da Ralstonia.
    for (const [platform, snapshot] of antes) {
      if (!level.platforms.includes(platform)) continue;
      if (platform.x !== snapshot.x || platform.y !== snapshot.y
        || platform.w !== snapshot.w || platform.h !== snapshot.h) {
        problemas.push(`${seedName}: plataforma #${platform.logicIndex} mudou de posicao`);
        break;
      }
    }

    // Checkpoints, exsudatos e pontes seguem ancorados na rota.
    for (const node of level.exudates || []) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        problemas.push(`${seedName}: exsudato desancorado`);
        break;
      }
    }
    for (const node of level.checkpoints || []) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        problemas.push(`${seedName}: checkpoint desancorado`);
        break;
      }
    }
  }
  assert.deepEqual(problemas, [], problemas.slice(0, 8).join('\n'));
});

// ---------------------------------------------------------------------------
// 12. SIMULAÇÕES TEMPORAIS (cenários A–G da especificação)
// ---------------------------------------------------------------------------

test('CENARIO A — sem controle: entra e agrava, mas nao durante a graca', () => {
  const b = bench();
  const focus = focusOfRole(b.system, 'prevention');
  b.goTo(focus.root);
  b.step(DT);
  b.step(C.activationGraceSeconds - .5);
  assert.equal(focus.everEnteredVascular, false, 'a graca protege');
  b.step(200);
  assert.equal(focus.everEnteredVascular, true);
  assert.ok(focus.vascularLoad > C.obstructionThreshold, 'agrava com o tempo');
});

test('CENARIO F/G — bloqueio e sucesso da disseminacao no mesmo runtime', () => {
  // F: bloqueado.
  const f = bench();
  const origemF = prepararFocoAtivo(f, 'containment');
  f.system.lab.setFocus(origemF, { vascularLoad: .9 });
  f.system.lab.forceSpread(origemF);
  f.step(DT * 2);
  f.addBiofilm(f.system.spreadEvents[0].targetRoot, 1);
  f.system.lab.resolveNextArrival();
  assert.equal(f.system.blockedSpreadCount, 1);
  assert.equal(f.system.successfulSpreadCount, 0);

  // G: bem-sucedido, sem cascata.
  const g = bench();
  const origemG = prepararFocoAtivo(g, 'containment');
  g.system.lab.setFocus(origemG, { vascularLoad: .9 });
  g.system.lab.forceSpread(origemG);
  g.step(DT * 2);
  g.system.lab.resolveNextArrival();
  assert.equal(g.system.successfulSpreadCount, 1);
  g.step(120);
  assert.ok(g.system.spreadEventCount <= 2, 'sem cascata infinita');
});

// ---------------------------------------------------------------------------
// 13. JANELAS ESTRITAS, RESERVA DE ALVO E OPORTUNIDADE GARANTIDA (100 seeds)
// ---------------------------------------------------------------------------

function segmentoDaFaseNove(id) {
  return getPhaseManifest(9).segments.find(segment => segment.id === id);
}

test('100 seeds: os dois focos ficam nas janelas declaradas e o alvo é reservado', { timeout: 600000 }, () => {
  const surface = segmentoDaFaseNove('p9-surface-intro');
  const vascular = segmentoDaFaseNove('p9-vascular-intro');
  const problemas = [];
  let promovidas = 0;

  for (let i = 0; i < 100; i++) {
    const seedName = `janelas-${i}`;
    const { level, campaign } = gerarFaseNove(seedName);
    const { system } = sistemaSobre(level, campaign);

    const prevencao = system.foci.find(f => f.role === 'prevention');
    const contencao = system.foci.find(f => f.role === 'containment');
    if (!prevencao) { problemas.push(`${seedName}: sem foco de prevenção`); continue; }
    if (!contencao) { problemas.push(`${seedName}: sem foco de contenção`); continue; }

    if (prevencao.rootLogicIndex < surface.from || prevencao.rootLogicIndex > surface.to) {
      problemas.push(`${seedName}: prevenção no chunk ${prevencao.rootLogicIndex}, fora de ${surface.from}-${surface.to}`);
    }
    // A regressão que motivou isto: a contenção ia parar nos chunks 17–19.
    if (contencao.rootLogicIndex < vascular.from || contencao.rootLogicIndex > vascular.to) {
      problemas.push(`${seedName}: contenção no chunk ${contencao.rootLogicIndex}, fora de ${vascular.from}-${vascular.to}`);
    }
    if (contencao.rootLogicIndex <= prevencao.rootLogicIndex) {
      problemas.push(`${seedName}: contenção não vem depois da prevenção`);
    }
    if (prevencao.root === contencao.root) problemas.push(`${seedName}: focos na mesma raiz`);
    if (prevencao.root.ralstoniaPromotedRoot || contencao.root.ralstoniaPromotedRoot) promovidas++;

    // Papéis distinguíveis.
    assert.ok(prevencao.roleLabel && contencao.roleLabel, 'cada foco declara o próprio papel');
    assert.notEqual(prevencao.shortRoleLabel, contencao.shortRoleLabel);

    // Alvo de disseminação RESERVADO na geração, com porta real.
    const alvo = contencao.reservedSpreadTarget;
    if (!alvo) { problemas.push(`${seedName}: sem alvo de disseminação reservado`); continue; }
    if (alvo.final) problemas.push(`${seedName}: alvo reservado é a raiz final`);
    if (alvo.recovery) problemas.push(`${seedName}: alvo reservado é raiz de recuperação`);
    if (alvo === contencao.root) problemas.push(`${seedName}: alvo reservado é a própria origem`);
    if (ralstoniaSpreadOpening(alvo) <= 0.12) {
      problemas.push(`${seedName}: alvo reservado sem porta de entrada real`);
    }
  }

  console.log(`    janelas/reserva em 100 seeds: ${promovidas} seed(s) precisaram promover solo a raiz`);
  assert.deepEqual(problemas, [], problemas.slice(0, 8).join('\n'));
});

test('100 seeds: toda partida tem uma disseminação bloqueável', { timeout: 900000 }, () => {
  const janela = segmentoDaFaseNove('p9-spread-intro');
  const problemas = [];
  let bloqueadas = 0;
  let cascatas = 0;

  for (let i = 0; i < 100; i++) {
    const seedName = `oportunidade-${i}`;
    const { level, campaign } = gerarFaseNove(seedName);
    const inoculants = { colonies: [] };
    const pseudomonas = { colonyStates: new Map() };
    const state = {
      time: 0, gameState: 'play', tutorialOpen: false, cameraX: 0,
      campaign,
      player: { x: -9000, y: 0, w: 26, h: 34, soil: 20, hope: 20 },
      level: { ...level, biofilms: [] },
      discoveredMicrobes: new Set(),
    };
    const system = createRalstoniaVascularWilt({
      state, entities: { burst() {}, damagePlayer() {} }, inoculants, pseudomonas,
    });
    system.initialize();
    const step = seconds => {
      for (let f = 0; f < Math.round(seconds / DT); f++) { state.time += DT; system.update(DT); }
    };
    const goTo = root => {
      state.player.x = root.x + root.w / 2 - state.player.w / 2;
      state.player.y = root.y - state.player.h;
    };

    const contencao = system.foci.find(f => f.role === 'containment');
    goTo(contencao.root); step(1); step(12);

    const entrada = (state.level.platforms || [])
      .filter(p => !p.recovery && !p.final && (p.logicIndex ?? -1) >= janela.from)
      .sort((a, b) => a.logicIndex - b.logicIndex)[0] || contencao.root;
    goTo(entrada);
    step(C.spreadFirstOpportunitySeconds + 4);

    const evento = system.activeSpreadEvents[0];
    if (!evento) { problemas.push(`${seedName}: nenhuma oportunidade de disseminação`); continue; }
    if (evento.targetRoot.final) problemas.push(`${seedName}: alvo é a raiz final`);

    // O jogador protege o alvo a tempo.
    state.level.biofilms.push({
      functional: true, platform: evento.targetRoot,
      x: evento.targetRoot.x + evento.targetRoot.w / 2, y: evento.targetRoot.y,
      radius: 90, protectionStrength: 1,
    });
    step(C.spreadWarningSeconds + C.spreadTravelSeconds + 2);
    if (system.blockedSpreadCount >= 1) bloqueadas++;
    else problemas.push(`${seedName}: proteção total não bloqueou a chegada`);

    // E nada de cascata infinita depois disso.
    step(180);
    if (system.spreadEventCount > C.maximumPedagogicalSpreadAttempts + 2) {
      cascatas++;
      problemas.push(`${seedName}: ${system.spreadEventCount} eventos — cascata`);
    }
  }

  console.log(`    disseminação em 100 seeds: ${bloqueadas} bloqueáveis, ${cascatas} cascatas`);
  assert.equal(bloqueadas, 100, 'toda seed precisa oferecer um bloqueio possível');
  assert.deepEqual(problemas, [], problemas.slice(0, 8).join('\n'));
});

test('a janela de disseminação não é queimada com o foco ainda em warning', () => {
  const b = bench();
  const janela = segmentoDaFaseNove('p9-spread-intro');
  const contencao = focusOfRole(b.system, 'containment');

  // O jogador alcança a região da terceira lição e, no caminho, o foco vascular
  // acabou de entrar em `warning` (a graça ainda corre). Era exatamente aqui que
  // a versão anterior marcava `spreadWindowReached = true` e queimava a única
  // oportunidade: nenhum evento abria, e o objetivo de bloquear disseminação
  // ficava impossível pelo resto da partida.
  b.goTo(contencao.root);
  b.step(DT);
  assert.equal(contencao.activationState, 'warning');

  b.goTo(b.platforms[janela.from]);
  b.step(2);
  assert.equal(b.system.spreadEventCount, 0, 'nada abre enquanto a doença está congelada');
  assert.equal(b.system.pedagogicalSpreadAttempts, 0, 'e nenhuma tentativa foi gasta');

  // Passada a graça, a oportunidade continua disponível.
  b.step(C.activationGraceSeconds + C.spreadFirstOpportunitySeconds + 3);
  assert.equal(contencao.activationState, 'active');
  assert.equal(b.system.spreadEventCount, 1, 'a oportunidade não tinha sido perdida');
});

test('falhar em bloquear libera uma nova tentativa, até o limite', () => {
  const b = bench();
  const janela = segmentoDaFaseNove('p9-spread-intro');
  const contencao = prepararFocoAtivo(b, 'containment');
  b.goTo(b.platforms[janela.from]);
  b.step(C.spreadFirstOpportunitySeconds + 3);
  assert.equal(b.system.spreadEventCount, 1);
  assert.equal(b.system.pedagogicalSpreadAttempts, 1);

  // Deixa chegar sem proteger.
  b.step(C.spreadWarningSeconds + C.spreadTravelSeconds + 2);
  assert.equal(b.system.blockedSpreadCount, 0);

  // Segunda chance.
  b.step(C.spreadRetrySeconds + 4);
  assert.ok(b.system.spreadEventCount >= 2, 'uma nova oportunidade aparece');
  assert.ok(
    b.system.pedagogicalSpreadAttempts <= C.maximumPedagogicalSpreadAttempts,
    'sem tentativas infinitas',
  );

  b.step(400);
  assert.ok(
    b.system.pedagogicalSpreadAttempts <= C.maximumPedagogicalSpreadAttempts,
    `no máximo ${C.maximumPedagogicalSpreadAttempts} tentativas pedagógicas`,
  );
});

// ---------------------------------------------------------------------------
// 14. FERRO E HUD
// ---------------------------------------------------------------------------

test('foco em warning não consome ferro; ativo consome', () => {
  const b = bench();
  const focus = focusOfRole(b.system, 'prevention');
  b.goTo(focus.root);
  b.step(DT);
  assert.equal(focus.activationState, 'warning');
  const entry = b.addPseudomonas(focus.root, { vigor: 1, ironReserve: .7 });
  const antes = entry.ironReserve;
  b.step(3);
  assert.equal(entry.ironReserve, antes, 'durante o aviso a reserva não é gasta');

  focus.activationGraceRemaining = 0;
  b.step(2);
  assert.ok(entry.ironReserve < antes, 'com o foco ativo a reserva passa a ser usada');
});

test('o HUD do alvo mostra a Pseudomonas real, não zero', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.system.lab.setFocus(focus, { vascularLoad: .9 });
  b.system.lab.forceSpread(focus);
  b.step(DT * 2);
  const evento = b.system.spreadEvents[0];
  assert.ok(evento);

  const semProtecao = b.system.rootSnapshot(evento.targetRoot);
  b.addPseudomonas(evento.targetRoot, { vigor: 1, ironReserve: .7 });
  const comProtecao = b.system.rootSnapshot(evento.targetRoot);

  assert.ok(
    comProtecao.incomingProtection > semProtecao.incomingProtection,
    'a Pseudomonas no alvo precisa aparecer na proteção mostrada',
  );
});

// ---------------------------------------------------------------------------
// 15. ANIMAÇÃO E ESTADO VISUAL
// ---------------------------------------------------------------------------

function ctxEspiao() {
  const chamadas = [];
  let profundidade = 0;
  let minima = 0;
  const alvo = {
    save() { profundidade++; chamadas.push(['save']); },
    restore() { profundidade--; minima = Math.min(minima, profundidade); chamadas.push(['restore']); },
    measureText: text => ({ width: String(text).length * 7 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    ellipse: (...args) => chamadas.push(['ellipse', ...args]),
    arc: (...args) => chamadas.push(['arc', ...args]),
    fillText: (...args) => chamadas.push(['fillText', ...args]),
    roundRect: (...args) => chamadas.push(['roundRect', ...args]),
    translate: (...args) => chamadas.push(['translate', ...args]),
  };
  const ctx = new Proxy(alvo, { get: (t, k) => t[k] ?? (() => {}) });
  return {
    ctx, chamadas,
    get profundidade() { return profundidade; },
    get minima() { return minima; },
  };
}

test('a sprite principal não impede o desenho da população', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b);
  b.step(2);

  b.state.cameraX = focus.root.x - 300;
  const espiao = ctxEspiao();
  b.system.render(espiao.ctx);
  // A população procedural desenha elipses/roundRects mesmo com sprite ausente:
  // o que não pode acontecer é o render sair depois de uma única figura.
  const desenhos = espiao.chamadas.filter(c => c[0] === 'roundRect' || c[0] === 'ellipse' || c[0] === 'arc');
  assert.ok(desenhos.length >= 3, `esperava vários elementos desenhados, veio ${desenhos.length}`);
  assert.equal(espiao.profundidade, 0, 'a pilha do canvas fecha equilibrada');
  assert.equal(espiao.minima, 0, 'nenhum restore() órfão desempilha a câmera');
});

test('a bactéria superficial se move dentro da raiz, sem mexer na âncora', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b);
  const ancora = focus.offsetX;
  const posicoes = [];
  for (let i = 0; i < 5; i++) { b.step(.4); posicoes.push(focus.visualX); }

  assert.equal(focus.offsetX, ancora, 'a âncora não muda: só o visual se desloca');
  assert.ok(new Set(posicoes.map(x => Math.round(x))).size > 1, 'a posição visual varia');
  for (const x of posicoes) {
    assert.ok(x >= focus.root.x, 'não sai pela esquerda da raiz');
    assert.ok(x <= focus.root.x + focus.root.w, 'não sai pela direita da raiz');
  }
});

test('a entrada no xilema tem progresso visual próprio', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b);
  assert.equal(focus.entryVisualProgress, 0, 'antes da entrada, zero');
  b.system.lab.setFocus(focus, { vascularLoad: C.vascularEntryThreshold + .02 });
  b.step(DT * 2);
  assert.ok(focus.entryVisualProgress > 0 && focus.entryVisualProgress < 1, 'a animação está correndo');
  b.step(1.5);
  assert.equal(focus.entryVisualProgress, 1, 'e termina');
});

test('o foco de contenção nasce com a entrada já concluída', () => {
  const b = bench();
  const focus = focusOfRole(b.system, 'containment');
  assert.equal(focus.entryVisualProgress, 1, 'ele já começa dentro do xilema');
});

test('foco pendente desenha marcador de região quando o jogador se aproxima', () => {
  const b = bench();
  const focus = focusOfRole(b.system, 'containment');
  assert.equal(focus.activationState, 'pending');

  // Longe: nada é desenhado para este foco.
  b.state.cameraX = focus.root.x - 200;
  const longe = ctxEspiao();
  b.system.render(longe.ctx);
  const textosLonge = longe.chamadas.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.equal(
    textosLonge.some(t => String(t).includes('adiante')), false,
    'não revela focos do mapa inteiro',
  );

  // Perto: o marcador aparece.
  b.goTo(b.platforms[Math.max(0, focus.rootLogicIndex - 1)]);
  b.state.cameraX = focus.root.x - 300;
  const perto = ctxEspiao();
  b.system.render(perto.ctx);
  const textosPerto = perto.chamadas.filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(
    textosPerto.some(t => String(t).includes('Infecção vascular adiante')),
    'o segundo foco deixa de ser invisível sem explicação',
  );
  assert.equal(perto.profundidade, 0);
});

test('o estado contido continua mostrando infecção residual', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.addPseudomonas(focus.root, { vigor: 1, ironReserve: .7 });
  b.step(60);
  assert.equal(focus.contained, true);
  assert.ok(focus.vascularLoad >= C.minimumVascularFloorAfterEntry, 'a carga residual permanece');

  b.state.cameraX = focus.root.x - 300;
  const espiao = ctxEspiao();
  b.system.render(espiao.ctx);
  const elipses = espiao.chamadas.filter(c => c[0] === 'ellipse');
  assert.ok(elipses.length > 0, 'ainda há células dentro do vaso — contido não é curado');
  assert.equal(espiao.profundidade, 0);
});

test('a disseminação desenha bactérias ao longo da curva', () => {
  const b = bench();
  const focus = prepararFocoAtivo(b, 'containment');
  b.system.lab.setFocus(focus, { vascularLoad: .9 });
  b.system.lab.forceSpread(focus);
  b.step(DT * 2);
  const evento = b.system.spreadEvents[0];
  evento.state = 'traveling';
  evento.travelProgress = .5;

  b.state.cameraX = focus.root.x - 300;
  const espiao = ctxEspiao();
  b.system.render(espiao.ctx);
  const translacoes = espiao.chamadas.filter(c => c[0] === 'translate');
  // Uma translação é a câmera; as demais orientam as bactérias na trajetória.
  assert.ok(translacoes.length > 1, 'as bactérias viajam orientadas, não como círculos parados');
  assert.equal(espiao.profundidade, 0, 'a pilha fecha equilibrada durante a viagem');
});
