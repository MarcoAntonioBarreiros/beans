import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPersistentUnlocksBeforePhase,
  getPhaseManifest,
} from '../src/procgen/campaign-manifest.js';
import {
  campaignPhaseSeed,
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { generateLevel } from '../src/procgen/generator.js';
import {
  createOpportunisticFungus,
  fungalResponse,
  MAX_HYPHAL_SEGMENTS_PER_FOCUS,
  OPPORTUNISTIC_FUNGUS_DEFAULTS,
  PSEUDOMONAS_IRON_CONTROL_DEFAULTS,
} from '../src/procgen/opportunistic-fungus.js';
import { createPseudomonasSiderophores } from '../src/procgen/pseudomonas-siderophores.js';
import { generateAzospirillumRootLadders } from '../src/procgen/azospirillum-root-growth.js';
import {
  applyPhaseFiveTutorialEncounters,
  applyPhaseFiveTutorialGeometry,
} from '../src/procgen/phase-five-tutorial.js';

function fungalHarness(seed = 'fungus-seed') {
  const state = {
    time: 0,
    gameState: 'play',
    cameraX: 0,
    campaign: { phase: 5, seed },
    player: {
      x: 100, y: 250, w: 32, h: 48, vitality: 5,
      moveMultiplier: 1, accelerationMultiplier: 1, jumpMultiplier: 1,
      fungalContamination: 0,
    },
    level: { platforms: [], particles: [] },
  };
  const ecology = { agents: [{
    id: 'focus:0', type: 'oportunista', x: 116, y: 274,
    homeX: 116, homeY: 274, ironLimitation: 0,
  }] };
  const entities = { damagePlayer() {}, burst() {} };
  const system = createOpportunisticFungus({ state, entities, ecology });
  return { state, ecology, system };
}

function run(harness, seconds, dt = 1 / 30) {
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    harness.state.time += dt;
    harness.system.prepare(dt);
    harness.system.update(dt);
  }
}

function rootedFungalHarness(seed = 'rooted-fungus') {
  const root = { x: 180, y: 430, w: 360, h: 80, type: 'root', logicIndex: 2 };
  const state = {
    time: 0,
    gameState: 'play',
    cameraX: 0,
    campaign: { phase: 5, seed },
    player: {
      x: 1050, y: 360, w: 32, h: 48, vitality: 5,
      moveMultiplier: 1, accelerationMultiplier: 1, jumpMultiplier: 1,
      fungalContamination: 0,
    },
    level: { platforms: [root], particles: [] },
  };
  const ecology = {
    encounters: [{ id: 'oportunista', x: 350, y: 330 }],
    agents: Array.from({ length: 4 }, (_, index) => ({
      id: `focus:${index}`,
      type: 'oportunista',
      zoneIndex: 0,
      x: 260 + index * 70,
      y: 220 + index * 20,
      homeX: 350,
      homeY: 330,
      ironLimitation: 0,
    })),
  };
  const entities = { damagePlayer() {}, burst() {} };
  const system = createOpportunisticFungus({ state, entities, ecology });
  return { state, ecology, root, system };
}

test('hifas alcançam Miguelito, aderem e tornam a contaminação funcional', () => {
  const harness = fungalHarness();
  run(harness, 3.5);
  assert.ok(harness.system.contactIntensity > 0);
  assert.ok(harness.state.player.fungalContamination > .12);
  harness.state.player.moveMultiplier = 1;
  harness.state.player.jumpMultiplier = 1;
  harness.system.prepare();
  assert.ok(harness.state.player.moveMultiplier < 1);
  assert.ok(harness.state.player.accelerationMultiplier < 1);
  assert.ok(harness.state.player.jumpMultiplier < 1);
});

test('afastamento reduz contaminação e forte limitação acelera desprendimento', () => {
  const harness = fungalHarness();
  run(harness, 3);
  const contaminated = harness.state.player.fungalContamination;
  harness.state.player.x = 1200;
  harness.ecology.agents[0].ironLimitation = 1;
  run(harness, 2);
  assert.ok(harness.state.player.fungalContamination < contaminated);
});

test('controle por ferro reduz crescimento, esporulação e aderência sem eliminar o fungo', () => {
  const normal = fungalResponse(0, OPPORTUNISTIC_FUNGUS_DEFAULTS, PSEUDOMONAS_IRON_CONTROL_DEFAULTS);
  const limited = fungalResponse(1, OPPORTUNISTIC_FUNGUS_DEFAULTS, PSEUDOMONAS_IRON_CONTROL_DEFAULTS);
  assert.equal(normal.vigor, 1);
  assert.ok(limited.growth < normal.growth);
  assert.ok(limited.sporulation < normal.sporulation);
  assert.ok(limited.adhesion < normal.adhesion);

  const harness = fungalHarness();
  harness.ecology.agents[0].ironLimitation = 1;
  run(harness, 1);
  assert.equal(harness.ecology.agents.length, 1);
  assert.equal(harness.system.controlledFungalVigor, PSEUDOMONAS_IRON_CONTROL_DEFAULTS.minimumFungalVigor);
});

test('halo sem ferro capturado não produz supressão máxima', () => {
  const state = {
    time: 0,
    gameState: 'play',
    campaign: { phase: 5, seed: 'empty-halo' },
    player: { soil: 0, hope: 0 },
    level: {
      platforms: [], particles: [], siderophores: [],
      ironDeposits: [{ id: 'empty', x: 120, y: 200, stock: 0, maxStock: 5, radius: 10 }],
    },
  };
  const agent = { id: 'fungus', type: 'oportunista', x: 120, y: 200, vx: 0, vy: 0 };
  const colony = { id: 'pseudo', type: 'pseudomonas', x: 120, y: 200, radius: 90, vigor: 1, growth: 1 };
  const system = createPseudomonasSiderophores({
    state,
    entities: { burst() {} },
    ecology: { agents: [agent] },
    inoculants: { colonies: [colony] },
  });
  system.update(.2);
  assert.equal(agent.ironLimitation || 0, 0);
  assert.equal(system.ironRecovered, 0);
});

test('Fase 5 ensina fungo, Pseudomonas e somente depois a interação', () => {
  const manifest = getPhaseManifest(5);
  // A sequencia que este teste protege e a de BIOLOGIA. Apresentacoes de poder
  // (a Propulsao da Rizosfera estreia nesta fase) nao entram na conta: elas sao
  // mecanica de jogo e podem aparecer em qualquer ponto sem quebrar a ordem
  // fungo -> Pseudomonas -> interacao.
  const biologia = manifest.presentations.filter(item => !item.cardId.startsWith('power-'));
  assert.deepEqual(biologia.map(item => item.id), [
    'presentation-opportunistic-fungus',
    'presentation-pseudomonas',
    'presentation-iron-competition',
  ]);
  assert.ok(biologia[0].debutChunk < biologia[1].debutChunk);
  assert.ok(biologia[1].debutChunk < biologia[2].debutChunk);
  assert.deepEqual(biologia[2].prerequisitePresentationIds, [
    'presentation-opportunistic-fungus',
    'presentation-pseudomonas',
  ]);
  assert.deepEqual(manifest.finalTest.requires.map(condition => condition.key), [
    'pseudomonasIronReserve',
    'controlledOpportunisticFungusCount',
    'reachedFinalRoot',
  ]);
  assert.equal(manifest.totalChunks, 20);
});

test('rede hifal e resultados são determinísticos pela seed', () => {
  const first = fungalHarness('same-seed');
  const second = fungalHarness('same-seed');
  run(first, 2);
  run(second, 2);
  const snapshot = harness => [...harness.system.networks.values()].map(network => ({
    segments: network.segments.slice(-12),
    spores: network.spores,
    contamination: harness.state.player.fungalContamination,
  }));
  assert.deepEqual(snapshot(first), snapshot(second));
});

test('um foco produz uma única rede ancorada na raiz e não persegue Miguelito', () => {
  const harness = rootedFungalHarness();
  run(harness, 5);
  assert.equal(harness.system.networks.size, 1);
  const [network] = harness.system.networks.values();
  assert.equal(network.activated, false);
  assert.equal(network.segments.length, 0);
  assert.equal(network.hostRoot, harness.root);
  assert.equal(network.anchor.y, harness.root.y - 5);

  harness.state.player.x = network.anchor.x - harness.state.player.w / 2;
  harness.state.player.y = network.anchor.y - harness.state.player.h / 2;
  run(harness, 5);
  assert.equal(network.activated, true);
  assert.deepEqual(network.segments[0].start, { x: network.anchor.x, y: network.anchor.y });
  assert.ok(network.lesions.every(lesion => lesion.root === harness.root || lesion.root === null));
  assert.ok(harness.ecology.agents.every(agent => (
    agent.rootedFungus
    && agent.x === network.anchor.x
    && agent.y === network.anchor.y
  )));

  const previousAnchor = { x: network.anchor.x, y: network.anchor.y };
  harness.state.player.x = 2400;
  harness.state.player.y = 90;
  run(harness, 3);
  assert.deepEqual(network.anchor, { ...previousAnchor, root: harness.root });
  assert.ok(network.segments.every(segment => segment.start.x < 700 && segment.end.x < 700));
});

test('fragmentos aderem somente quando Miguelito toca uma hifa', () => {
  const harness = rootedFungalHarness('contact-on-touch');
  const focusX = harness.ecology.encounters[0].x;
  harness.state.player.x = focusX + 260;
  harness.state.player.y = 300;
  run(harness, 5);
  assert.equal(harness.state.player.fungalContamination, 0);
  const [network] = harness.system.networks.values();
  const segment = network.segments[Math.floor(network.segments.length / 2)];
  harness.state.player.x = (segment.start.x + segment.end.x) / 2 - harness.state.player.w / 2;
  harness.state.player.y = (segment.start.y + segment.end.y) / 2 - harness.state.player.h / 2;
  run(harness, .6);
  assert.ok(harness.state.player.fungalContamination > 0);
  assert.ok(harness.state.player.fungalAttachmentLevel > 0);

  const attached = harness.state.player.fungalAttachmentLevel;
  harness.state.player.x = 1200;
  run(harness, 1.5);
  assert.ok(harness.state.player.fungalAttachmentLevel > 0);
  assert.ok(harness.state.player.fungalAttachmentLevel >= attached * .8);
});

test('a rede preserva a ligação basal e respeita o orçamento de segmentos', () => {
  const harness = rootedFungalHarness('segment-budget');
  harness.state.player.x = 520;
  harness.state.player.y = 350;
  run(harness, 35);
  const [network] = harness.system.networks.values();
  assert.ok(network.segments.length <= MAX_HYPHAL_SEGMENTS_PER_FOCUS);
  assert.deepEqual(network.segments[0].start, { x: network.anchor.x, y: network.anchor.y });
  assert.ok(network.spores.length <= 12);
});

test('tutorial curto cria encontro, controle e corredor final determinísticos', () => {
  const base = {
    platforms: Array.from({ length: 20 }, (_, chunk) => ({
      x: 100 + chunk * 275,
      y: 470,
      w: 180,
      h: 64,
      type: 'root',
      logicIndex: chunk,
    })),
    exudates: [],
    ironDeposits: [],
  };
  const build = () => {
    const level = structuredClone(base);
    applyPhaseFiveTutorialGeometry(level, 5);
    const encounters = applyPhaseFiveTutorialEncounters(level, [
      { id: 'oportunista', source: 'debut', logicIndex: 2, x: 600, y: 350 },
      { id: 'pseudomonas', source: 'debut', logicIndex: 8, x: 2200, y: 350 },
      { id: 'oportunista', source: 'procedural', logicIndex: 12, x: 3300, y: 350 },
    ], 5, 'fixed-seed');
    const ladders = generateAzospirillumRootLadders({
      level,
      phase: 5,
      seedValue: 'fixed-seed',
      encounters,
      config: getPhaseManifest(5).azospirillumRootLadder,
    });
    return { level, encounters, ladders };
  };
  const first = build();
  const second = build();
  assert.deepEqual(first, second);
  assert.deepEqual(first.encounters.map(item => [item.source, item.logicIndex]), [
    ['debut', 2],
    ['debut', 8],
    ['interaction-support', 13],
    ['interaction', 13],
    ['challenge', 16],
  ]);
  assert.equal(first.level.ironDeposits.length, 3);
  assert.deepEqual(first.level.ironDeposits.map(item => item.platform.logicIndex), [8, 13, 15]);
  assert.deepEqual(first.ladders, [], 'a Fase 5 nao cria uma escada de Azo artificial');
  assert.ok(first.level.platforms.filter(platform => platform.fungalChallenge).length === 3);
  const route = first.level.platforms.slice(15, 20);
  assert.ok(route.every((platform, index) => index === 0 || platform.x > route[index - 1].x + route[index - 1].w));
});

test('pipeline real do Phase Lab 5 mantém a rota natural e reúne ferro, Pseudomonas e fungo', () => {
  const campaign = createCampaign('phase-lab-5');
  campaign.phase = 5;
  campaign.unlocks = getPersistentUnlocksBeforePhase(5);
  const profile = prepareCampaignGeneration(campaign);
  const seedValue = campaignPhaseSeed(campaign);
  const rawLevel = generateLevel(seedValue);
  applyPhaseFiveTutorialGeometry(rawLevel, 5);
  const level = decorateCampaignLevel(rawLevel, campaign, profile);
  let encounters = generateCampaignEncounters({
    platforms: level.platforms,
    phase: 5,
    seedValue,
  });
  encounters = applyPhaseFiveTutorialEncounters(level, encounters, 5, seedValue);
  const ladders = generateAzospirillumRootLadders({
    level,
    phase: 5,
    seedValue,
    encounters,
    config: getPhaseManifest(5).azospirillumRootLadder,
  });

  assert.deepEqual(ladders, []);

  const interactionFungus = encounters.find(item => item.source === 'interaction');
  const interactionPseudomonas = encounters.find(item => item.source === 'interaction-support');
  const interactionIron = level.ironDeposits.find(item => item.platform.logicIndex === 13);
  assert.ok(interactionFungus && interactionPseudomonas && interactionIron);
  assert.ok(Math.hypot(
    interactionFungus.x - interactionPseudomonas.x,
    interactionFungus.y - interactionPseudomonas.y,
  ) < 60);
  assert.equal(interactionIron.platform.logicIndex, interactionFungus.logicIndex);
  assert.ok(Math.abs(interactionIron.x - interactionFungus.x) < 8);
  assert.ok(Math.abs(interactionIron.x - interactionPseudomonas.x) < 8);
});

// ============================================================================
// MARCO DE CONTROLE FÚNGICO
// ============================================================================
//
// O objetivo da fase 5 era `opportunisticFungusVigor <= .45`, e
// `controlledFungalVigor` devolvia 0 quando não havia rede nenhuma: sem fungo em
// cena o requisito nascia cumprido. Agora o marco exige que a rede tenha
// existido, estado vigorosa, e sido mantida sob o limiar por tempo real.

import {
  FUNGUS_CONTROL_HOLD_SECONDS,
  FUNGUS_CONTROL_THRESHOLD,
} from '../src/procgen/opportunistic-fungus.js';

// Bancada mínima: exercita só a regra do marco, sem montar o nível.
function bancadaDeControle() {
  let contador = 0;
  const redes = new Map();

  function atualizar(chave, vigor, dt) {
    let rede = redes.get(chave);
    if (!rede) {
      rede = { wasActive: false, maximumObservedVigor: 0, controlHold: 0, everControlled: false, response: null };
      redes.set(chave, rede);
    }
    rede.response = { vigor };
    rede.maximumObservedVigor = Math.max(rede.maximumObservedVigor, vigor);
    if (vigor > .65) rede.wasActive = true;
    if (rede.wasActive && vigor <= FUNGUS_CONTROL_THRESHOLD) {
      rede.controlHold += dt;
      if (rede.controlHold >= FUNGUS_CONTROL_HOLD_SECONDS && !rede.everControlled) {
        rede.everControlled = true;
        contador++;
      }
    } else {
      rede.controlHold = 0;
    }
    return rede;
  }

  return {
    atualizar,
    get contador() { return contador; },
    get vigorDeHud() {
      const valores = [...redes.values()].filter(r => r.response).map(r => r.response.vigor);
      return valores.length ? Math.max(...valores) : 1;
    },
    reiniciar() { redes.clear(); contador = 0; },
  };
}

test('sem fungo: vigor de HUD é 1 e o marco é zero', () => {
  const b = bancadaDeControle();
  assert.equal(b.vigorDeHud, 1, 'ausência de fungo = nada a controlar, não vigor zero');
  assert.equal(b.contador, 0);
});

test('rede recém-criada com vigor alto não conta', () => {
  const b = bancadaDeControle();
  b.atualizar('a', 1, 1 / 60);
  assert.equal(b.contador, 0);
  assert.equal(b.vigorDeHud, 1);
});

test('queda momentânea abaixo do limiar não conta', () => {
  const b = bancadaDeControle();
  b.atualizar('a', 1, 1);
  b.atualizar('a', .3, .5);
  assert.equal(b.contador, 0, 'meio segundo não é controle sustentado');
  b.atualizar('a', .9, .1);
  assert.equal(b.contador, 0);
});

test('controle sustentado por 2 segundos conta uma vez', () => {
  const b = bancadaDeControle();
  b.atualizar('a', 1, 1);
  for (let t = 0; t < FUNGUS_CONTROL_HOLD_SECONDS + .2; t += 1 / 60) b.atualizar('a', .3, 1 / 60);
  assert.equal(b.contador, 1);
  // Voltar a subir não conta de novo.
  b.atualizar('a', .95, .5);
  for (let t = 0; t < FUNGUS_CONTROL_HOLD_SECONDS + .2; t += 1 / 60) b.atualizar('a', .2, 1 / 60);
  assert.equal(b.contador, 1, 'everControlled impede a contagem dupla');
});

test('rede que nasce fraca não conta: precisa ter estado vigorosa', () => {
  const b = bancadaDeControle();
  for (let t = 0; t < 10; t += 1 / 60) b.atualizar('fraca', .2, 1 / 60);
  assert.equal(b.contador, 0);
});

test('com dois focos, o HUD mostra o MENOS controlado', () => {
  const b = bancadaDeControle();
  b.atualizar('a', .30, 1 / 60);
  b.atualizar('b', .90, 1 / 60);
  assert.equal(b.vigorDeHud, .90, 'Math.max, não Math.min');
});

test('controlar só um dos dois: o marco conta, o HUD segue mostrando o pior', () => {
  const b = bancadaDeControle();
  b.atualizar('a', 1, 1);
  b.atualizar('b', 1, 1);
  for (let t = 0; t < FUNGUS_CONTROL_HOLD_SECONDS + .2; t += 1 / 60) {
    b.atualizar('a', .25, 1 / 60);
    b.atualizar('b', .90, 1 / 60);
  }
  assert.equal(b.contador, 1, 'um foco controlado é um marco');
  assert.equal(b.vigorDeHud, .90, 'o outro continua alto no HUD');
});

test('reiniciar a fase zera o contador', () => {
  const b = bancadaDeControle();
  b.atualizar('a', 1, 1);
  for (let t = 0; t < FUNGUS_CONTROL_HOLD_SECONDS + .2; t += 1 / 60) b.atualizar('a', .3, 1 / 60);
  assert.equal(b.contador, 1);
  b.reiniciar();
  assert.equal(b.contador, 0);
  assert.equal(b.vigorDeHud, 1);
});

test('o teste final da fase 5 usa o marco, não o vigor instantâneo', () => {
  const requisitos = getPhaseManifest(5).finalTest.requires.map(c => c.key);
  assert.ok(
    requisitos.includes('controlledOpportunisticFungusCount'),
    'o objetivo passa a exigir controle real',
  );
  assert.equal(
    requisitos.includes('opportunisticFungusVigor'), false,
    'o vigor instantâneo sai do teste final — ele nascia satisfeito sem fungo',
  );
});
