// Sons de interação (Pacote 03)
// ==============================
//
// Estes dez efeitos respondem a AÇÕES do jogador, e o defeito típico deles não
// é o silêncio: é o excesso. Uma nuvem que recruta seis agentes, uma inoculação
// que deposita três espécies, um checkpoint visto por dois sistemas ao mesmo
// tempo — cada um desses vira uma sobreposição do mesmo arquivo se o gatilho
// estiver no lugar errado. É isso que este arquivo mede.
//
// O espião devolve o resultado estruturado real do controlador
// (`{ accepted, state }`), porque o código de produção decide com base nele se
// marca o evento como entregue.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createInoculumSelection } from '../src/procgen/inoculum-selection.js';
import { createPhysicsSystem } from '../src/physics.js';
import { createEcologicalGameplay } from '../src/procgen/ecological-gameplay.js';
import { createBeneficialInoculants } from '../src/procgen/beneficial-inoculants.js';
import { createTrichodermaColonies } from '../src/procgen/trichoderma-colonies.js';
import { createTrichodermaRecruitment } from '../src/procgen/trichoderma-recruitment.js';
import { COLONY_ESTABLISHMENT_GROWTH, DISCOVERABLE_MICROBE_IDS } from '../src/audio-manifest.js';

function spyFx({ state: resultState = 'played' } = {}) {
  const calls = [];
  return {
    calls,
    count: trackId => calls.filter(call => call.trackId === trackId).length,
    ids: () => calls.map(call => call.trackId),
    fn(trackId, options = {}) {
      calls.push({ trackId, options });
      return { accepted: resultState !== 'rejected', state: resultState };
    },
  };
}

// `entities` como o simulador monta: `discoverMicrobe` centraliza o som da
// descoberta, exatamente como em produção.
function makeEntities(fx, state) {
  const entities = {
    interactionFx: fx.fn,
    audio: {
      play() {}, startLoop() {}, updateLoop() {}, pauseLoop() {}, resumeLoop() {},
      stopLoop() {}, stopGroup() {}, stopAll() {}, update() {}, reset() {},
    },
    burst() {},
    unlockCampaignFeature() {},
    respawn() {},
    damagePlayer() {},
    discoverMicrobe: (id, showCard = true, options = {}) => {
      const first = !state.discoveredMicrobes.has(id);
      state.discoveredMicrobes.add(id);
      if (first && options.sound !== false && DISCOVERABLE_MICROBE_IDS.includes(id)) {
        entities.interactionFx('microbeDiscovery', { gain: 1, rate: 1, instanceId: id });
      }
      return first;
    },
  };
  return entities;
}

function baseState(overrides = {}) {
  return {
    time: 10,
    gameState: 'play',
    cameraX: 0,
    shake: 0,
    discoveredMicrobes: new Set(),
    player: {
      x: 100, y: 400, w: 32, h: 48, vx: 0, vy: 0, facing: 1,
      soil: 0, hope: 0, exudates: 0, alive: true, vitality: 5, maxVitality: 5,
      infection: 0, infectionExposure: 0, onGround: true, invuln: 0,
    },
    level: {
      platforms: [], hazards: [], crystals: [], enemies: [], exudates: [],
      allies: [], checkpoints: [], particles: [], pulses: [], goal: null,
      exudateClouds: [], biofilms: [], beneficialColonies: [], rhizobiumNodules: [],
      nitrogenRoots: [], azospirillumRootLadders: [], azospirillumRoots: [],
      ironDeposits: [], siderophores: [], phosphateDeposits: [],
      availablePhosphatePools: [], nematodeEggMasses: [], nematodeJuveniles: [],
      rootGalls: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SELEÇÃO
// ---------------------------------------------------------------------------

// O seletor só oferece o que o jogador REALMENTE carrega. Sem seguidores e sem
// exsudato a lista tem menos de duas entradas e `cycle()` nunca muda nada — foi
// exatamente esse o erro da primeira versão destes testes, que passavam vazios.
function selectionHarness() {
  const fx = spyFx();
  const state = baseState();
  state.player.exudates = 3;
  const entities = makeEntities(fx, state);
  const input = { keys: { ArrowDown: false } };
  const selection = createInoculumSelection({
    entities, state, input,
    inoculants: {
      colonies: [],
      followers: () => [{ id: 'a1', type: 'bacillus' }],
      followerGroups: () => new Map([['bacillus', [{ id: 'a1', type: 'bacillus' }]]]),
    },
    trichodermaColonies: { colonies: [], recruitedFollowers: () => [] },
  });
  return { fx, state, input, selection };
}

test('seleção: o harness oferece pelo menos duas opções', () => {
  const { selection } = selectionHarness();
  assert.ok(selection.options().length >= 2, 'sem isto os testes abaixo seriam vazios');
});

test('seleção: com duas opções, um ciclo toca uma vez', () => {
  const { fx, selection } = selectionHarness();
  assert.equal(selection.cycle(), true);
  assert.equal(fx.count('uiSelectionCycle'), 1);
});

test('seleção: com menos de duas opções, silêncio', () => {
  const fx = spyFx();
  const state = baseState();
  state.player.exudates = 0;
  const entities = makeEntities(fx, state);
  const selection = createInoculumSelection({
    entities, state, input: { keys: {} },
    inoculants: { colonies: [], followers: () => [], followerGroups: () => new Map() },
    trichodermaColonies: { colonies: [], recruitedFollowers: () => [] },
  });
  assert.ok(selection.options().length < 2, 'cenário sem escolha');
  assert.equal(selection.cycle(), false);
  assert.equal(fx.count('uiSelectionCycle'), 0);
});

test('seleção: consultar options() não toca nada', () => {
  const { fx, selection } = selectionHarness();
  selection.options();
  selection.options();
  assert.equal(fx.count('uiSelectionCycle'), 0);
});

test('seleção: a seta segurada não repete o som', () => {
  const { fx, input, selection } = selectionHarness();
  input.keys.ArrowDown = true;
  selection.prepare(0.016);
  selection.prepare(0.016);
  selection.prepare(0.016);
  assert.equal(fx.count('uiSelectionCycle'), 1, 'uma pressão, um som');

  // Soltar e pressionar de novo conta como uma nova troca.
  input.keys.ArrowDown = false;
  selection.prepare(0.016);
  input.keys.ArrowDown = true;
  selection.prepare(0.016);
  assert.equal(fx.count('uiSelectionCycle'), 2);
});

// ---------------------------------------------------------------------------
// COLETA DE EXSUDATO
// ---------------------------------------------------------------------------

function physicsHarness() {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  const input = { keys: {} };
  const hud = { setMission() {}, showToast() {}, updateHud() {}, showEnd() {} };
  const physics = createPhysicsSystem({
    state, input, entities, hud,
    audio: { playFx() { return { accepted: true, state: 'played' }; }, canPlayJump: () => true },
  });
  return { fx, state, entities, physics };
}

function exudateAt(x, y, extra = {}) {
  return { x, y, taken: false, ...extra };
}

test('coleta: uma coleta real toca uma vez', () => {
  const { fx, state, physics } = physicsHarness();
  state.level.exudates.push(exudateAt(state.player.x + 16, state.player.y + 24));
  physics.update(0.016);
  assert.equal(fx.count('exudatePickup01'), 1);
  assert.equal(state.player.exudates, 1);
});

test('coleta: item já coletado não toca', () => {
  const { fx, state, physics } = physicsHarness();
  state.level.exudates.push(exudateAt(state.player.x + 16, state.player.y + 24, { taken: true }));
  physics.update(0.016);
  physics.update(0.016);
  assert.equal(fx.calls.filter(call => call.trackId.startsWith('exudatePickup')).length, 0);
});

test('coleta: quatro coletas usam 01, 02, 03 e voltam ao 01', () => {
  const { fx, state, physics } = physicsHarness();
  for (let index = 0; index < 4; index++) {
    state.level.exudates.push(exudateAt(state.player.x + 16, state.player.y + 24, { id: `ex-${index}` }));
    physics.update(0.016);
  }
  const coletas = fx.ids().filter(id => id.startsWith('exudatePickup'));
  assert.deepEqual(coletas, [
    'exudatePickup01', 'exudatePickup02', 'exudatePickup03', 'exudatePickup01',
  ]);
});

test('coleta: restaurar um exsudato pelo respawn não toca', () => {
  const { fx, state, physics } = physicsHarness();
  const gota = exudateAt(9000, 9000, { id: 'ex-longe', taken: true });
  state.level.exudates.push(gota);
  // O respawn apenas devolve `taken` a false, longe do jogador.
  gota.taken = false;
  physics.update(0.016);
  assert.equal(fx.calls.filter(call => call.trackId.startsWith('exudatePickup')).length, 0);
});

// ---------------------------------------------------------------------------
// CHECKPOINT
// ---------------------------------------------------------------------------

test('checkpoint: a primeira ativação toca; reentrar não', () => {
  const { fx, state, physics } = physicsHarness();
  const checkpoint = { id: 'cp-1', x: state.player.x + 16, y: state.player.y + 24, active: false };
  state.level.checkpoints.push(checkpoint);
  physics.update(0.016);
  assert.equal(fx.count('checkpointActivation'), 1);
  assert.equal(checkpoint.active, true);

  // Vários quadros dentro do checkpoint já ativo.
  physics.update(0.016);
  physics.update(0.016);
  assert.equal(fx.count('checkpointActivation'), 1);
});

test('checkpoint: o que já nasce ativo nunca toca', () => {
  const { fx, state, physics } = physicsHarness();
  state.level.checkpoints.push({
    id: 'cp-ativo', x: state.player.x + 16, y: state.player.y + 24,
    active: true, interactionAudioActivated: true,
  });
  physics.update(0.016);
  physics.update(0.016);
  assert.equal(fx.count('checkpointActivation'), 0);
});

test('checkpoint: a descoberta do Bacillus não empilha som', () => {
  const { fx, state, physics } = physicsHarness();
  state.level.checkpoints.push({
    id: 'cp-2', x: state.player.x + 16, y: state.player.y + 24, active: false,
  });
  physics.update(0.016);
  assert.equal(fx.count('checkpointActivation'), 1);
  assert.equal(fx.count('microbeDiscovery'), 0, 'quem manda é a ativação');
  assert.equal(state.discoveredMicrobes.has('bacillus'), true, 'mas a descoberta é registrada');
});

// ---------------------------------------------------------------------------
// DESCOBERTA
// ---------------------------------------------------------------------------

test('descoberta: a primeira toca, a segunda não', () => {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  assert.equal(entities.discoverMicrobe('rhizobium'), true);
  assert.equal(entities.discoverMicrobe('rhizobium'), false);
  assert.equal(fx.count('microbeDiscovery'), 1);
});

test('descoberta: itens não microbianos não tocam', () => {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  for (const id of ['phos', 'power-jump', 'power-dash', 'power-pulse']) {
    entities.discoverMicrobe(id);
  }
  assert.equal(fx.count('microbeDiscovery'), 0);
  assert.equal(state.discoveredMicrobes.has('phos'), true, 'mas continua registrado');
});

test('descoberta: sound false registra sem tocar', () => {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  entities.discoverMicrobe('trichoderma', false, { sound: false });
  assert.equal(fx.count('microbeDiscovery'), 0);
  assert.equal(state.discoveredMicrobes.has('trichoderma'), true);
});

// ---------------------------------------------------------------------------
// LIBERAÇÃO DE EXSUDATO
// ---------------------------------------------------------------------------

function ecoHarness() {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  const input = { keys: { KeyE: false } };
  const gameplay = createEcologicalGameplay({
    state, input, entities, ecology: { agents: [] },
  });
  return { fx, state, input, gameplay };
}

test('liberação: a nuvem criada toca uma vez', () => {
  const { fx, state, input, gameplay } = ecoHarness();
  state.player.exudates = 2;
  input.keys.KeyE = true;
  gameplay.prepare(0.016);
  assert.equal(fx.count('exudateRelease'), 1);
});

test('liberação: sem estoque não toca', () => {
  const { fx, state, input, gameplay } = ecoHarness();
  state.player.exudates = 0;
  input.keys.KeyE = true;
  gameplay.prepare(0.016);
  assert.equal(fx.count('exudateRelease'), 0);
});

test('liberação: a tecla segurada não repete', () => {
  const { fx, state, input, gameplay } = ecoHarness();
  state.player.exudates = 5;
  input.keys.KeyE = true;
  gameplay.prepare(0.016);
  gameplay.prepare(0.016);
  gameplay.prepare(0.016);
  assert.equal(fx.count('exudateRelease'), 1);
});

test('liberação: a expansão da nuvem ao longo do tempo não toca', () => {
  const { fx, state, input, gameplay } = ecoHarness();
  state.player.exudates = 1;
  input.keys.KeyE = true;
  gameplay.prepare(0.016);
  input.keys.KeyE = false;
  for (let quadro = 0; quadro < 60; quadro++) gameplay.update(0.05);
  assert.equal(fx.count('exudateRelease'), 1);
});

// ---------------------------------------------------------------------------
// RECRUTAMENTO E INOCULAÇÃO (benéficos)
// ---------------------------------------------------------------------------

function inoculantsHarness({ agentes = 4 } = {}) {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  const input = { keys: { KeyE: false } };
  const plataforma = { x: 60, y: 452, w: 300, h: 56, type: 'root', logicIndex: 1 };
  state.level.platforms.push(plataforma);

  const agents = Array.from({ length: agentes }, (_, index) => ({
    id: `ag-${index}`, type: 'bacillus',
    x: state.player.x + 10 + index, y: state.player.y + 10,
    vx: 0, vy: 0, homeX: 0, homeY: 0,
  }));
  const ecology = { agents };
  const inoculants = createBeneficialInoculants({ state, input, ecology, entities });
  const cloud = {
    id: 1, x: state.player.x, y: state.player.y, radius: 150, life: 10, maxLife: 10,
  };
  state.level.exudateClouds.push(cloud);
  return { fx, state, input, ecology, inoculants, cloud, plataforma };
}

test('recrutamento: vários agentes da mesma nuvem geram UMA confirmação', () => {
  const { fx, inoculants } = inoculantsHarness({ agentes: 5 });
  inoculants.update(0.05);
  inoculants.update(0.05);
  assert.equal(fx.count('microbeRecruitment'), 1, 'cinco agentes, um som');
});

test('recrutamento: renovar o tempo de seguimento não toca de novo', () => {
  const { fx, inoculants } = inoculantsHarness({ agentes: 2 });
  inoculants.update(0.05);
  for (let quadro = 0; quadro < 30; quadro++) inoculants.update(0.05);
  assert.equal(fx.count('microbeRecruitment'), 1);
});

test('recrutamento: a descoberta acontece sem empilhar som', () => {
  const { fx, state, inoculants } = inoculantsHarness({ agentes: 2 });
  inoculants.update(0.05);
  assert.equal(state.discoveredMicrobes.has('bacillus'), true);
  assert.equal(fx.count('microbeDiscovery'), 0, 'o recrutamento é o feedback');
});

test('inoculação: uma ação válida toca uma vez, mesmo com vários grupos', () => {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  const input = { keys: { KeyE: false } };
  state.level.platforms.push({ x: 60, y: 452, w: 300, h: 56, type: 'root', logicIndex: 1 });
  // Duas espécies seguindo ao mesmo tempo: uma ação, dois grupos.
  const agents = [
    { id: 'a1', type: 'bacillus', x: 110, y: 410, vx: 0, vy: 0 },
    { id: 'a2', type: 'rhizobium', x: 112, y: 410, vx: 0, vy: 0 },
  ];
  const ecology = { agents };
  const inoculants = createBeneficialInoculants({ state, input, ecology, entities });
  state.level.exudateClouds.push({ id: 1, x: 110, y: 410, radius: 150, life: 10, maxLife: 10 });
  inoculants.update(0.05);

  input.keys.KeyE = true;
  inoculants.prepare(0.016);
  assert.equal(fx.count('inoculationPlace'), 1, 'uma ação, um som');
});

test('inoculação: sem seguidores não toca', () => {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  const input = { keys: { KeyE: true } };
  state.level.platforms.push({ x: 60, y: 452, w: 300, h: 56, type: 'root', logicIndex: 1 });
  const inoculants = createBeneficialInoculants({ state, input, ecology: { agents: [] }, entities });
  inoculants.prepare(0.016);
  assert.equal(fx.count('inoculationPlace'), 0);
});

test('inoculação: sem suporte válido não toca', () => {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  const input = { keys: { KeyE: false } };
  // Sem plataforma nenhuma: `nearestSupport` falha e vem o toast de impossível.
  const agents = [{ id: 'a1', type: 'bacillus', x: 110, y: 410, vx: 0, vy: 0 }];
  const inoculants = createBeneficialInoculants({ state, input, ecology: { agents }, entities });
  state.level.exudateClouds.push({ id: 1, x: 110, y: 410, radius: 150, life: 10, maxLife: 10 });
  inoculants.update(0.05);
  input.keys.KeyE = true;
  inoculants.prepare(0.016);
  assert.equal(fx.count('inoculationPlace'), 0);
});

// ---------------------------------------------------------------------------
// ESTABELECIMENTO
// ---------------------------------------------------------------------------

test('estabelecimento: cruzar o limiar toca uma vez e não repete acima dele', () => {
  const { fx, state, input, inoculants, plataforma } = inoculantsHarness({ agentes: 2 });
  inoculants.update(0.05);
  input.keys.KeyE = true;
  inoculants.prepare(0.016);
  input.keys.KeyE = false;

  const colonia = state.level.beneficialColonies?.[0] || inoculants.colonies[0];
  assert.ok(colonia, 'a colônia foi criada');
  assert.ok(colonia.growth < COLONY_ESTABLISHMENT_GROWTH, 'nasce abaixo do limiar');
  assert.equal(plataforma.type, 'root');

  for (let quadro = 0; quadro < 200; quadro++) inoculants.update(0.05);
  assert.ok(colonia.growth >= COLONY_ESTABLISHMENT_GROWTH);
  assert.equal(fx.count('colonyEstablished'), 1, 'uma vez por colônia');
});

test('estabelecimento: colônia autoral não toca retroativamente', () => {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  const plataforma = { x: 60, y: 452, w: 300, h: 56, type: 'root', logicIndex: 1 };
  state.level.platforms.push(plataforma);
  state.level.authoredBeneficialColonies = [{
    id: 'autoral-1', type: 'bacillus', platform: plataforma, growth: 1, vigor: 1,
  }];
  const inoculants = createBeneficialInoculants({
    state, input: { keys: {} }, ecology: { agents: [] }, entities,
  });
  inoculants.reset();
  for (let quadro = 0; quadro < 100; quadro++) inoculants.update(0.05);
  assert.equal(fx.count('colonyEstablished'), 0);
  assert.equal(fx.count('inoculationPlace'), 0);
});

test('estabelecimento: um pedido rejeitado não marca o evento como entregue', () => {
  const fx = spyFx({ state: 'rejected' });
  const state = baseState();
  const entities = makeEntities(fx, state);
  const colonia = { id: 'c1', growth: 0, audioEstablished: false };
  // Simula o contrato usado nos módulos: só marca quando não foi recusado.
  const resultado = entities.interactionFx('colonyEstablished', { instanceId: colonia.id });
  if (resultado?.state !== 'rejected') colonia.audioEstablished = true;
  assert.equal(colonia.audioEstablished, false, 'continua podendo tocar depois');
});

// ---------------------------------------------------------------------------
// TRICHODERMA
// ---------------------------------------------------------------------------

test('trichoderma: colônia natural não toca inoculação nem estabelecimento', () => {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  state.level.platforms.push({ x: 60, y: 452, w: 300, h: 56, type: 'root', logicIndex: 1 });
  const agente = { id: 'tr-1', type: 'trichoderma', x: 120, y: 430, vx: 0, vy: 0 };
  const colonies = createTrichodermaColonies({
    state, input: { keys: {} }, ecology: { agents: [agente] }, entities,
  });
  const colonia = colonies.inoculateNaturalAgent(agente);
  assert.ok(colonia, 'a colônia natural foi criada');
  assert.equal(fx.count('inoculationPlace'), 0, 'germinação natural não é ação do jogador');
  for (let quadro = 0; quadro < 200; quadro++) colonies.update(0.05);
  assert.equal(fx.count('colonyEstablished'), 0);
});

test('trichoderma: a nuvem compartilha a marca de recrutamento com os benéficos', () => {
  const fx = spyFx();
  const state = baseState();
  const entities = makeEntities(fx, state);
  const agentes = [
    { id: 'b1', type: 'bacillus', x: 110, y: 410, vx: 0, vy: 0 },
    { id: 't1', type: 'trichoderma', x: 112, y: 410, vx: 0, vy: 0 },
  ];
  const ecology = { agents: agentes };
  const inoculants = createBeneficialInoculants({
    state, input: { keys: {} }, ecology, entities,
  });
  const recruitment = createTrichodermaRecruitment({ state, ecology, entities });
  state.level.exudateClouds.push({ id: 7, x: 110, y: 410, radius: 150, life: 10, maxLife: 10 });

  inoculants.update(0.05);
  recruitment.update(0.05);
  assert.equal(
    fx.count('microbeRecruitment'), 1,
    'uma nuvem que atrai duas espécies dá um único feedback',
  );
});
