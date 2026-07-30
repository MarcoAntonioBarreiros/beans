// Integração do Pacote 04 nos sistemas biológicos
// ================================================
//
// O teste do gerenciador (biological-audio.test.js) prova que a contabilidade
// de vozes está correta. Este prova a outra metade: que cada som sai da
// TRANSIÇÃO REAL do sistema, uma vez, e não a cada quadro, não pelo toast e não
// quando o processo já estava concluído antes de a fase começar.
//
// `entities.audio` é um espião com a mesma API da fachada. Nenhum módulo
// biológico sabe que é um espião — é exatamente o ponto da fachada.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRhizobiumNodulation } from '../src/procgen/rhizobium-nodulation.js';
import { createNitrogenRootDevelopment } from '../src/procgen/nitrogen-root.js';
import { createBacillusBioprotection } from '../src/procgen/bacillus-bioprotection.js';
import { createPseudomonasSiderophores } from '../src/procgen/pseudomonas-siderophores.js';
import { createTrichodermaColonies } from '../src/procgen/trichoderma-colonies.js';
import { createAzospirillumRootGrowth } from '../src/procgen/azospirillum-root-growth.js';
import { createMycorrhizaGrowth } from '../src/procgen/mycorrhiza-growth.js';
import { createPhosphateSolubilization } from '../src/procgen/phosphate-solubilization.js';
import { createTrichodermaGrowth } from '../src/procgen/trichoderma-growth.js';
import { publishControlSignal } from '../src/procgen/biological-audio-signals.js';
import { campaignManifest } from '../src/procgen/campaign-manifest.js';
import { biologicalGroupsForProgress } from '../src/audio-manifest.js';

function spyAudio() {
  const calls = [];
  const loops = new Map();
  const api = {
    calls,
    loops,
    fx: () => calls.filter(call => call.kind === 'play').map(call => call.trackId),
    countFx: trackId => calls.filter(call => call.kind === 'play' && call.trackId === trackId).length,
    play(trackId, options = {}) { calls.push({ kind: 'play', trackId, options }); return true; },
    startLoop(instanceKey, trackId, options = {}) {
      calls.push({ kind: 'startLoop', instanceKey, trackId, options });
      const existing = loops.get(instanceKey);
      if (existing && existing.trackId === trackId) {
        existing.options = { ...existing.options, ...options };
        existing.paused = false;
        existing.starts++;
        return true;
      }
      loops.set(instanceKey, {
        trackId,
        options,
        // Mesmo contrato do gerenciador real: o grupo é `options.group` quando
        // declarado, senão o prefixo da chave. `stopGroup` casa pelos dois.
        group: options.group || instanceKey.split(':')[0],
        paused: false,
        starts: 1,
      });
      return true;
    },
    updateLoop(instanceKey, options = {}) {
      const loop = loops.get(instanceKey);
      if (!loop) return false;
      loop.options = { ...loop.options, ...options };
      return true;
    },
    pauseLoop(instanceKey) {
      const loop = loops.get(instanceKey);
      if (!loop) return false;
      calls.push({ kind: 'pauseLoop', instanceKey });
      loop.paused = true;
      return true;
    },
    resumeLoop(instanceKey) {
      const loop = loops.get(instanceKey);
      if (!loop) return false;
      loop.paused = false;
      return true;
    },
    stopLoop(instanceKey) {
      calls.push({ kind: 'stopLoop', instanceKey });
      return loops.delete(instanceKey);
    },
    stopGroup(groupId) {
      let stopped = false;
      for (const [key, loop] of [...loops.entries()]) {
        if (loop.group !== groupId && key.split(':')[0] !== groupId) continue;
        stopped = loops.delete(key) || stopped;
      }
      return stopped;
    },
    stopAll() { loops.clear(); return true; },
    update() {},
    reset() {},
    debugSnapshot() { return { available: true, loops: [...loops.keys()] }; },
  };
  return api;
}

function baseState(overrides = {}) {
  return {
    time: 10,
    gameState: 'play',
    cameraX: 0,
    shake: 0,
    player: {
      x: 100, y: 400, w: 30, h: 40, soil: 0, hope: 0,
      infection: 0, infectionExposure: 0, phosphateCharge: 0,
    },
    level: {
      platforms: [], rhizobiumNodules: [], nitrogenRoots: [], biofilms: [],
      exudateClouds: [], ironDeposits: [], siderophores: [],
      phosphateDeposits: [], availablePhosphatePools: [],
      exudates: [], hazards: [], crystals: [], enemies: [], allies: [], particles: [],
    },
    ...overrides,
  };
}

function makeEntities(audio) {
  return { audio, burst() {}, discoverMicrobe() {}, respawn() {}, unlockCampaignFeature() {} };
}

// ---------------------------------------------------------------------------
// RHIZOBIUM (§35)
// ---------------------------------------------------------------------------

function rhizobiumHarness() {
  const audio = spyAudio();
  const entities = makeEntities(audio);
  const state = baseState();
  const root = { x: 100, y: 300, w: 200, h: 56, type: 'root', logicIndex: 1 };
  state.level.platforms.push(root);
  const colony = {
    id: 'col-rhizo-1', type: 'rhizobium', x: 180, y: 300, platform: root,
    vigor: 1, growth: 1, dormant: false, sourceCount: 2, rechargeIntensity: 1, stage: '',
  };
  const inoculants = { colonies: [colony] };
  const nodulation = createRhizobiumNodulation({ state, entities, inoculants });
  return { audio, state, colony, root, nodulation };
}

// Avança até o sítio alcançar o estágio pedido (ou estourar o orçamento).
function avancarAte(nodulation, state, condicao, passos = 4000) {
  for (let index = 0; index < passos; index++) {
    nodulation.update(0.05);
    state.time += 0.05;
    if (condicao()) return true;
  }
  return false;
}

test('rhizobium: reconhecimento toca uma vez, na criação do sítio', () => {
  const { audio, nodulation } = rhizobiumHarness();
  nodulation.update(0.016);
  nodulation.update(0.016);
  nodulation.update(0.016);
  assert.equal(audio.countFx('rhizobiumRecognition'), 1);
});

test('rhizobium: cada estágio toca uma vez e o fio de infecção vira loop', () => {
  const { audio, state, nodulation } = rhizobiumHarness();
  const sitio = () => state.level.rhizobiumNodules[0];

  assert.ok(avancarAte(nodulation, state, () => sitio()?.stage === 'infection-thread'));
  assert.equal(audio.countFx('rhizobiumRootHairCurl'), 1);
  assert.ok(audio.loops.has(`rhizobium-thread:${sitio().id}`), 'o fio tem loop');

  // Vários quadros dentro do estágio: um único loop, nunca um por quadro.
  const antes = audio.loops.get(`rhizobium-thread:${sitio().id}`).starts;
  nodulation.update(0.05);
  nodulation.update(0.05);
  const depois = audio.loops.get(`rhizobium-thread:${sitio().id}`).starts;
  assert.ok(depois > antes, 'o loop é sustentado por quadro (idempotente)');
  assert.equal(audio.loops.size >= 1, true);

  assert.ok(avancarAte(nodulation, state, () => sitio()?.mature === true));
  assert.equal(audio.countFx('rhizobiumPrimordium'), 1);
  assert.equal(audio.countFx('rhizobiumYoungNodule'), 1);
  assert.equal(audio.countFx('rhizobiumMatureNodule'), 1);
});

test('rhizobium: sair do estágio do fio encerra o loop', () => {
  const { audio, state, nodulation } = rhizobiumHarness();
  const sitio = () => state.level.rhizobiumNodules[0];
  assert.ok(avancarAte(nodulation, state, () => sitio()?.stage === 'primordium'));
  assert.equal(audio.loops.has(`rhizobium-thread:${sitio().id}`), false);
});

test('rhizobium: falta de carbono pausa o fio em vez de recomeçá-lo', () => {
  const { audio, state, colony, nodulation } = rhizobiumHarness();
  const sitio = () => state.level.rhizobiumNodules[0];
  assert.ok(avancarAte(nodulation, state, () => sitio()?.stage === 'infection-thread'));
  const chave = `rhizobium-thread:${sitio().id}`;

  colony.vigor = 0.01;
  nodulation.update(0.05);
  assert.equal(audio.loops.get(chave).paused, true);

  colony.vigor = 1;
  nodulation.update(0.05);
  assert.equal(audio.loops.get(chave).paused, false, 'retoma, não recomeça');
});

test('rhizobium: o nódulo maduro não toca conclusão de novo a cada quadro', () => {
  const { audio, state, nodulation } = rhizobiumHarness();
  assert.ok(avancarAte(nodulation, state, () => state.level.rhizobiumNodules[0]?.mature === true));
  for (let index = 0; index < 60; index++) nodulation.update(0.05);
  assert.equal(audio.countFx('rhizobiumMatureNodule'), 1);
});

test('FBN: no máximo um loop audível, e ele some quando a fixação cai', () => {
  const audio = spyAudio();
  const entities = makeEntities(audio);
  const state = baseState();
  const raizes = [0, 1, 2].map(index => ({
    x: 100 + index * 300, y: 300, w: 200, h: 56, type: 'root', logicIndex: index,
  }));
  state.level.platforms.push(...raizes);
  const colonias = raizes.map((platform, index) => ({
    id: `col-${index}`, type: 'rhizobium', x: platform.x + 80, y: 300, platform,
    vigor: 1, growth: 1, dormant: false, sourceCount: 2, rechargeIntensity: 1, stage: '',
  }));
  const nodulation = createRhizobiumNodulation({ state, entities, inoculants: { colonies: colonias } });

  assert.ok(avancarAte(
    nodulation, state,
    () => state.level.rhizobiumNodules.every(site => site.mature),
  ));
  nodulation.update(0.05);

  const fbn = [...audio.loops.keys()].filter(key => key.startsWith('nitrogen-fixation'));
  assert.equal(fbn.length, 1, 'três nódulos maduros, um único loop de FBN');
  assert.equal(fbn[0], 'nitrogen-fixation:nearest');

  // Todas as colônias dormentes: a atividade some e o loop com ela.
  for (const colony of colonias) { colony.dormant = true; colony.vigor = 0; }
  nodulation.update(0.05);
  assert.equal([...audio.loops.keys()].some(key => key.startsWith('nitrogen-fixation')), false);
});

// ---------------------------------------------------------------------------
// RAIZ NITROGENADA (§36)
// ---------------------------------------------------------------------------

function nitrogenHarness({ fixationRate = 0, mature = true } = {}) {
  const audio = spyAudio();
  const entities = makeEntities(audio);
  const state = baseState();
  const host = { x: 100, y: 300, w: 200, h: 56, type: 'root', logicIndex: 1 };
  const target = { x: 500, y: 300, w: 200, h: 56, type: 'root', logicIndex: 2 };
  state.level.platforms.push(host);
  state.level.rhizobiumNodules = [{
    id: 'nodule-1', platform: host, x: 180, surfaceY: 300, depth: 20,
    mature, stage: mature ? 'mature-nodule' : 'young-nodule', fixationRate,
  }];
  const root = {
    id: 'nroot-1', hostPlatform: host, targetPlatform: target,
    targetLogicIndex: 2, x: 500, y: 300,
    startWidth: 80, startHeight: 12, targetWidth: 200, targetHeight: 56,
    currentWidth: 80, currentHeight: 12,
    progress: 0, functionalProgress: 0, stage: 'underdeveloped',
    developed: false, paused: false, requiredFixationRate: 1,
    growthDurationSeconds: 2, phase: 0, collider: null, activeSite: null,
    announced: false, audioCompleted: false,
  };
  state.level.nitrogenRoots = [root];
  const development = createNitrogenRootDevelopment({ state, entities });
  return { audio, state, root, development, nodule: state.level.rhizobiumNodules[0] };
}

test('raiz nitrogenada: sem fixação suficiente, nenhum loop', () => {
  const { audio, development } = nitrogenHarness({ fixationRate: 0 });
  development.update(0.1);
  development.update(0.1);
  assert.equal(audio.loops.size, 0);
  assert.equal(audio.calls.length, 0);
});

test('raiz nitrogenada: nódulo maduro sem taxa suficiente não inicia o crescimento', () => {
  const { audio, development } = nitrogenHarness({ fixationRate: 0.2, mature: true });
  development.update(0.1);
  assert.equal(audio.loops.size, 0, 'maduro não basta; a taxa precisa alcançar o mínimo');
});

test('raiz nitrogenada: crescimento real inicia o loop', () => {
  const { audio, development } = nitrogenHarness({ fixationRate: 2 });
  development.update(0.1);
  assert.equal(audio.loops.has('nitrogen-root:nroot-1'), true);
  assert.equal(audio.loops.get('nitrogen-root:nroot-1').trackId, 'nitrogenRootGrowth');
});

test('raiz nitrogenada: queda da FBN pausa; volta retoma sem recomeçar', () => {
  const { audio, development, nodule } = nitrogenHarness({ fixationRate: 2 });
  development.update(0.1);
  const chave = 'nitrogen-root:nroot-1';

  nodule.fixationRate = 0;
  development.update(0.1);
  assert.equal(audio.loops.get(chave).paused, true);

  nodule.fixationRate = 2;
  development.update(0.1);
  assert.equal(audio.loops.get(chave).paused, false);
});

test('raiz nitrogenada: conclusão para o loop e toca uma única vez', () => {
  const { audio, development, root } = nitrogenHarness({ fixationRate: 2 });
  for (let index = 0; index < 60; index++) development.update(0.1);
  assert.equal(root.developed, true);
  assert.equal(audio.countFx('nitrogenRootComplete'), 1);
  assert.equal(audio.loops.has('nitrogen-root:nroot-1'), false);

  // Muitos quadros depois de pronta: nada toca de novo.
  for (let index = 0; index < 40; index++) development.update(0.1);
  assert.equal(audio.countFx('nitrogenRootComplete'), 1);
});

test('raiz nitrogenada: reset limpa o loop e permite um novo ciclo', () => {
  const { audio, development, root } = nitrogenHarness({ fixationRate: 2 });
  development.update(0.1);
  assert.equal(audio.loops.size, 1);
  development.reset();
  assert.equal(audio.loops.size, 0);
  assert.equal(root.audioCompleted, false);
});

// ---------------------------------------------------------------------------
// BACILLUS (§39)
// ---------------------------------------------------------------------------

function bacillusHarness({ authored = false } = {}) {
  const audio = spyAudio();
  const entities = makeEntities(audio);
  const state = baseState();
  const platform = { x: 100, y: 300, w: 200, h: 56, type: 'root', logicIndex: 1 };
  state.level.platforms.push(platform);
  const colony = {
    id: 'col-bac-1', type: 'bacillus', x: 180, y: 300, platform,
    vigor: 1, growth: authored ? 1 : 0.8, dormant: false, sourceCount: 2,
    rechargeIntensity: 1, stage: '', radius: 40, authored,
  };
  const ecology = { agents: [] };
  const bioprotection = createBacillusBioprotection({
    state, entities, ecology, inoculants: { colonies: [colony] },
  });
  return { audio, state, colony, ecology, bioprotection };
}

test('bacillus: inoculação real toca adesão; colônia autoral não', () => {
  const inoculada = bacillusHarness({ authored: false });
  inoculada.bioprotection.update(0.05);
  assert.equal(inoculada.audio.countFx('bacillusAdhesion'), 1);

  const autoral = bacillusHarness({ authored: true });
  autoral.bioprotection.update(0.05);
  assert.equal(autoral.audio.countFx('bacillusAdhesion'), 0, 'o cenário já vem com ela');
  assert.equal(autoral.audio.countFx('bacillusBiofilmComplete'), 0, 'nem conclusão ao carregar');
});

test('bacillus: adesão e matriz compartilham o mesmo loop de crescimento', () => {
  const { audio, bioprotection } = bacillusHarness();
  bioprotection.update(0.05);
  const chave = 'bacillus-biofilm:col-bac-1';
  assert.equal(audio.loops.has(chave), true);
  const primeiro = audio.loops.get(chave);
  for (let index = 0; index < 20; index++) bioprotection.update(0.05);
  assert.equal(audio.loops.get(chave), primeiro, 'a mesma voz atravessa adhesion → matrix');
});

test('bacillus: maturidade encerra o crescimento e toca conclusão uma vez', () => {
  const { audio, bioprotection } = bacillusHarness();
  for (let index = 0; index < 400; index++) bioprotection.update(0.05);
  assert.equal(audio.countFx('bacillusBiofilmComplete'), 1);
  assert.equal(audio.loops.has('bacillus-biofilm:col-bac-1'), false);
});

test('bacillus: alternar mature ↔ antibiosis não repete a conclusão', () => {
  const { audio, ecology, bioprotection } = bacillusHarness();
  for (let index = 0; index < 400; index++) bioprotection.update(0.05);
  const conclusoes = audio.countFx('bacillusBiofilmComplete');

  // Um fungo entra e sai do raio várias vezes: o modo oscila.
  for (let ciclo = 0; ciclo < 3; ciclo++) {
    ecology.agents = [{ type: 'oportunista', x: 190, y: 300, vx: 0, vy: 0, homeX: 190, homeY: 300 }];
    for (let index = 0; index < 20; index++) bioprotection.update(0.05);
    ecology.agents = [];
    for (let index = 0; index < 20; index++) bioprotection.update(0.05);
  }
  assert.equal(audio.countFx('bacillusBiofilmComplete'), conclusoes);
});

test('bacillus: sem alvo não há antibiose, mesmo com a colônia madura', () => {
  const { audio, bioprotection } = bacillusHarness();
  for (let index = 0; index < 400; index++) bioprotection.update(0.05);
  assert.equal(audio.loops.has('bacillus-antibiosis:col-bac-1'), false);
});

test('bacillus: pressão real inicia a antibiose e o fim dela encerra o loop', () => {
  const { audio, ecology, bioprotection } = bacillusHarness();
  for (let index = 0; index < 400; index++) bioprotection.update(0.05);

  ecology.agents = [{ type: 'oportunista', x: 190, y: 305, vx: 0, vy: 0, homeX: 190, homeY: 305 }];
  for (let index = 0; index < 10; index++) bioprotection.update(0.05);
  assert.equal(audio.loops.has('bacillus-antibiosis:col-bac-1'), true);

  ecology.agents = [];
  bioprotection.update(0.05);
  assert.equal(audio.loops.has('bacillus-antibiosis:col-bac-1'), false);
});

// ---------------------------------------------------------------------------
// PSEUDOMONAS (§40)
// ---------------------------------------------------------------------------

function pseudomonasHarness() {
  const audio = spyAudio();
  const entities = makeEntities(audio);
  const state = baseState();
  state.campaign = { seed: 'teste-pseudomonas' };
  const platform = { x: 100, y: 300, w: 200, h: 56, type: 'root', logicIndex: 1 };
  state.level.platforms.push(platform);
  const colony = {
    id: 'col-pseudo-1', type: 'pseudomonas', x: 180, y: 300, platform,
    vigor: 1, growth: 1, dormant: false, sourceCount: 2, rechargeIntensity: 1,
    stage: '', radius: 60,
  };
  const ecology = { agents: [] };
  const siderophores = createPseudomonasSiderophores({
    state, entities, ecology, inoculants: { colonies: [colony] },
  });
  return { audio, state, colony, ecology, siderophores };
}

test('pseudomonas: muitos lançamentos seguidos não viram metralhadora', () => {
  const { audio, siderophores } = pseudomonasHarness();
  for (let index = 0; index < 200; index++) siderophores.update(0.05);
  const lancamentos = audio.countFx('pseudomonasSiderophoreLaunch');
  assert.ok(lancamentos > 0, 'houve lançamento');
  // Sem cooldown seriam dezenas em 10 s simulados; o espião não aplica o
  // cooldown, então o que se verifica aqui é que cada chamada carrega o
  // `instanceId` da colônia — é ele que o gerenciador usa para segurar.
  const comInstancia = audio.calls.filter(call => (
    call.kind === 'play'
    && call.trackId === 'pseudomonasSiderophoreLaunch'
    && call.options.instanceId === 'col-pseudo-1'
  ));
  assert.equal(comInstancia.length, lancamentos);
});

test('pseudomonas: supressão só toca com pressão real, e só uma por vez', () => {
  const { audio, ecology, siderophores } = pseudomonasHarness();

  // Sem fungo por perto: nenhuma supressão, por mais sideróforos que existam.
  for (let index = 0; index < 100; index++) siderophores.update(0.05);
  assert.equal([...audio.loops.keys()].some(key => key.startsWith('pseudomonas-suppression')), false);

  // Com fungo e reserva de ferro acumulada, a supressão aparece — uma só.
  ecology.agents = [
    { type: 'oportunista', x: 185, y: 300, vx: 0, vy: 0, homeX: 185, homeY: 300, ironLimitation: 0 },
    { type: 'oportunista', x: 195, y: 305, vx: 0, vy: 0, homeX: 195, homeY: 305, ironLimitation: 0 },
  ];
  for (let index = 0; index < 400; index++) siderophores.update(0.05);
  const supressoes = [...audio.loops.keys()].filter(key => key.startsWith('pseudomonas-suppression'));
  assert.ok(supressoes.length <= 1, `mais de uma supressão audível: ${supressoes.length}`);
});

test('pseudomonas: reset limpa o loop de supressão', () => {
  const { audio, ecology, siderophores } = pseudomonasHarness();
  ecology.agents = [{ type: 'oportunista', x: 185, y: 300, vx: 0, vy: 0, homeX: 185, homeY: 300 }];
  for (let index = 0; index < 400; index++) siderophores.update(0.05);
  siderophores.reset();
  assert.equal([...audio.loops.keys()].some(key => key.startsWith('pseudomonas-suppression')), false);
});

// ---------------------------------------------------------------------------
// TRICHODERMA (§41)
// ---------------------------------------------------------------------------

test('trichoderma: a reativação toca na transição exhausted true → false, uma vez', () => {
  const audio = spyAudio();
  const entities = makeEntities(audio);
  const state = baseState();
  const input = { keys: {} };
  const ecology = { agents: [] };
  const colonies = createTrichodermaColonies({ state, input, ecology, entities });

  const colony = {
    id: 'tri-1', x: 200, y: 300, age: 0, growth: 1, vigor: 0.02,
    exhausted: true, activeTargetId: null, cooldownUntil: 0, stage: 'exhausted',
    phase: 0, rechargeIntensity: 0, sourceCount: 1,
  };
  colonies.colonies.push(colony);
  // Nuvem de exsudato em cima da colônia: é ela que recarrega o vigor.
  state.level.exudateClouds = [{ id: 'cloud-1', x: 200, y: 300, radius: 120, life: 10, maxLife: 10 }];

  for (let index = 0; index < 200; index++) colonies.update(0.05);
  assert.equal(colony.exhausted, false, 'a colônia realmente reativou');
  assert.equal(audio.countFx('trichodermaReactivation'), 1);

  // Combustível contínuo depois disso não repete a reativação.
  for (let index = 0; index < 200; index++) colonies.update(0.05);
  assert.equal(audio.countFx('trichodermaReactivation'), 1);
});

test('trichoderma: colônia que nunca esteve exaurida não toca reativação', () => {
  const audio = spyAudio();
  const entities = makeEntities(audio);
  const state = baseState();
  const colonies = createTrichodermaColonies({
    state, input: { keys: {} }, ecology: { agents: [] }, entities,
  });
  colonies.colonies.push({
    id: 'tri-2', x: 200, y: 300, age: 0, growth: 1, vigor: 1,
    exhausted: false, activeTargetId: null, cooldownUntil: 0, stage: 'ready',
    phase: 0, rechargeIntensity: 0, sourceCount: 1,
  });
  state.level.exudateClouds = [{ id: 'cloud-1', x: 200, y: 300, radius: 120, life: 10, maxLife: 10 }];
  for (let index = 0; index < 100; index++) colonies.update(0.05);
  assert.equal(audio.countFx('trichodermaReactivation'), 0);
});

// ---------------------------------------------------------------------------
// AZOSPIRILLUM (§37)
// ---------------------------------------------------------------------------

function azospirillumHarness({ comColonia = true } = {}) {
  const audio = spyAudio();
  const entities = makeEntities(audio);
  const state = baseState();
  const host = { x: 100, y: 400, w: 200, h: 56, type: 'root', logicIndex: 1, azospirillumHairDensity: 0 };
  const destination = { x: 320, y: 200, w: 200, h: 56, type: 'root', logicIndex: 2 };
  state.level.platforms.push(host, destination);

  const steps = [0, 1, 2].map(index => ({
    id: `l1-step-${index + 1}`, index, centerX: 150 + index * 30, y: 380 - index * 60,
    startWidth: 14, startHeight: 4, targetWidth: 64, targetHeight: 12,
    currentWidth: 14, currentHeight: 4, progress: 0, mature: false, collider: null,
  }));
  const ladder = {
    id: 'azo-ladder-1', host, destination, steps,
    hostLogicIndex: 1, startX: 200, startY: 394, endX: 320, endY: 194,
    progress: 0, visibleProgress: 0, mature: false, developed: false, paused: false,
    growthDurationSeconds: 2, knownSkill: false, announced: false,
    audioStarted: false, audioCompleted: false, colony: null,
  };
  state.level.azospirillumRootLadders = [ladder];

  const colony = {
    id: 'col-azo-1', type: 'azospirillum', x: 200, y: 400, platform: host,
    vigor: 1, growth: 1, dormant: false, sourceCount: 1, stage: '',
  };
  const inoculants = { colonies: comColonia ? [colony] : [] };
  const growth = createAzospirillumRootGrowth({ state, entities, inoculants });
  return { audio, state, ladder, colony, inoculants, growth };
}

test('azospirillum: sem colônia funcional, silêncio total', () => {
  const { audio, growth } = azospirillumHarness({ comColonia: false });
  for (let index = 0; index < 40; index++) growth.update(0.05);
  assert.equal(audio.calls.length, 0);
  assert.equal(audio.loops.size, 0);
});

test('azospirillum: início toca o start e abre um loop de crescimento', () => {
  const { audio, growth } = azospirillumHarness();
  growth.update(0.05);
  assert.equal(audio.countFx('azospirillumRootGrowthStart'), 1);
  assert.equal(audio.loops.has('azospirillum-growth:azo-ladder-1'), true);

  // Muitos quadros: o start não se repete e o loop continua sendo um só.
  for (let index = 0; index < 10; index++) growth.update(0.05);
  assert.equal(audio.countFx('azospirillumRootGrowthStart'), 1);
  assert.equal([...audio.loops.keys()].filter(key => key.startsWith('azospirillum-growth')).length, 1);
});

test('azospirillum: perder a colônia pausa; recuperá-la retoma sem novo start', () => {
  const { audio, inoculants, colony, growth } = azospirillumHarness();
  growth.update(0.05);
  const chave = 'azospirillum-growth:azo-ladder-1';

  inoculants.colonies = [];
  growth.update(0.05);
  assert.equal(audio.loops.get(chave).paused, true);

  inoculants.colonies = [colony];
  growth.update(0.05);
  assert.equal(audio.loops.get(chave).paused, false);
  assert.equal(audio.countFx('azospirillumRootGrowthStart'), 1, 'o início não volta a tocar');
});

test('azospirillum: cada degrau toca uma vez, e a conclusão também', () => {
  const { audio, ladder, growth } = azospirillumHarness();
  for (let index = 0; index < 200; index++) growth.update(0.05);
  assert.equal(ladder.developed, true);
  assert.equal(audio.countFx('azospirillumStepMature'), 3, 'três degraus, três sons');
  assert.equal(audio.countFx('azospirillumLadderComplete'), 1);
  assert.equal(audio.loops.has('azospirillum-growth:azo-ladder-1'), false, 'o loop saiu na conclusão');

  // Escada pronta, muitos quadros depois: nada repete.
  for (let index = 0; index < 60; index++) growth.update(0.05);
  assert.equal(audio.countFx('azospirillumStepMature'), 3);
  assert.equal(audio.countFx('azospirillumLadderComplete'), 1);
});

test('azospirillum: uma escada restaurada como developed não toca nada', () => {
  const { audio, ladder, growth } = azospirillumHarness();
  ladder.developed = true;
  for (let index = 0; index < 40; index++) growth.update(0.05);
  assert.equal(audio.countFx('azospirillumStepMature'), 0);
  assert.equal(audio.countFx('azospirillumLadderComplete'), 0);
  assert.equal(audio.countFx('azospirillumRootGrowthStart'), 0);
});

test('azospirillum: reset limpa os loops e libera um novo ciclo', () => {
  const { audio, ladder, growth } = azospirillumHarness();
  growth.update(0.05);
  assert.equal(audio.loops.size, 1);
  growth.reset();
  assert.equal(audio.loops.size, 0);
  assert.equal(ladder.audioStarted, false);
  assert.equal(ladder.audioCompleted, false);
});

// ---------------------------------------------------------------------------
// MICORRIZA (§38)
// ---------------------------------------------------------------------------

function mycorrhizaHarness() {
  const audio = spyAudio();
  const entities = makeEntities(audio);
  const state = baseState();
  state.level.endX = 3000;
  const raiz = { x: 260, y: 380, w: 240, h: 56, type: 'root', logicIndex: 1 };
  state.level.platforms.push(raiz);
  state.level.allies = [{ id: 'myco', x: 200, y: 430, taken: true, presentationOnly: false }];
  state.player.x = 200;
  state.player.y = 420;
  const growth = createMycorrhizaGrowth({ state, entities });
  growth.reset();
  return { audio, state, raiz, growth };
}

test('micorriza: a germinação toca uma vez por rede', () => {
  const { audio, growth } = mycorrhizaHarness();
  for (let index = 0; index < 30; index++) growth.update(0.05);
  assert.equal(audio.countFx('mycorrhizaGermination'), 1);
});

test('micorriza: a rede hifal abre exatamente um loop', () => {
  const { audio, growth } = mycorrhizaHarness();
  for (let index = 0; index < 30; index++) growth.update(0.05);
  const hifas = [...audio.loops.keys()].filter(key => key.startsWith('mycorrhiza-hypha'));
  assert.equal(hifas.length, 1);
  assert.equal(audio.loops.get(hifas[0]).trackId, 'mycorrhizaHyphaGrowth');
});

test('micorriza: o contato com a raiz e o arbúsculo tocam sem repetir por quadro', () => {
  const { audio, growth } = mycorrhizaHarness();
  for (let index = 0; index < 400; index++) growth.update(0.05);
  const contatos = audio.countFx('mycorrhizaRootContact');
  const arbusculos = audio.countFx('mycorrhizaArbusculeComplete');
  assert.ok(contatos > 0, 'houve contato com a raiz');
  // `onContact` roda a cada quadro enquanto a ponta encosta; se o gatilho fosse
  // ele, seriam centenas.
  assert.ok(contatos < 20, `contato repetindo por quadro: ${contatos}`);
  assert.ok(arbusculos <= contatos, 'nunca mais arbúsculos que contatos');
});

test('micorriza: reset encerra os loops da rede', () => {
  const { audio, growth } = mycorrhizaHarness();
  for (let index = 0; index < 30; index++) growth.update(0.05);
  assert.ok(audio.loops.size > 0);
  growth.clear();
  assert.equal([...audio.loops.keys()].some(key => key.startsWith('mycorrhiza-hypha')), false);
});

// ---------------------------------------------------------------------------
// FÓSFORO (§42)
// ---------------------------------------------------------------------------

function phosphateHarness({ reserva = 1, selecionado = true } = {}) {
  const audio = spyAudio();
  const entities = makeEntities(audio);
  const state = baseState();
  state.player.canPhosphateSolubilization = true;
  state.player.facing = 1;
  state.level.phaseProfile = { phosphateSolubilization: {} };
  const platform = { x: 100, y: 300, w: 200, h: 56, type: 'root', logicIndex: 1 };
  state.level.platforms.push(platform);

  const entry = {
    colony: { id: 'col-bac-p', x: 110, y: 400, platform },
    mode: 'mature',
    maturity: 1,
    phosphateMetaboliteReserve: reserva,
  };
  const input = { keys: { KeyE: false } };
  const selection = { isSelected: id => selecionado && id === 'phosphate-solubilization' };
  const phosphate = createPhosphateSolubilization({
    state, input, entities, selection,
    bacillus: { solubilizerEntries: [entry] },
    inoculants: { colonies: [] },
  });
  return { audio, state, input, entry, phosphate };
}

test('fósforo: segurar E sem reserva não abre o loop de carga', () => {
  const { audio, input, phosphate } = phosphateHarness({ reserva: 0 });
  input.keys.KeyE = true;
  for (let index = 0; index < 10; index++) phosphate.prepare(0.05);
  assert.equal(audio.loops.has('phosphate-charge:player'), false);
});

test('fósforo: carga real abre um loop, centrado e protegido', () => {
  const { audio, input, phosphate } = phosphateHarness();
  input.keys.KeyE = true;
  phosphate.prepare(0.05);
  const loop = audio.loops.get('phosphate-charge:player');
  assert.ok(loop, 'o loop da carga existe');
  assert.equal(loop.options.protect, true, 'a ação do jogador não pode ser despejada');
  assert.equal(loop.options.x, undefined, 'som centrado, não espacial');
});

test('fósforo: o loop não duplica e o rate sobe com a carga', () => {
  const { audio, input, phosphate } = phosphateHarness();
  input.keys.KeyE = true;
  phosphate.prepare(0.05);
  const primeiro = audio.loops.get('phosphate-charge:player').options.rate;
  for (let index = 0; index < 10; index++) phosphate.prepare(0.05);
  const loops = [...audio.loops.keys()].filter(key => key.startsWith('phosphate-charge'));
  assert.equal(loops.length, 1);
  assert.ok(audio.loops.get('phosphate-charge:player').options.rate > primeiro);
});

test('fósforo: soltar E encerra a carga', () => {
  const { audio, input, phosphate } = phosphateHarness();
  input.keys.KeyE = true;
  for (let index = 0; index < 5; index++) phosphate.prepare(0.05);
  assert.equal(audio.loops.has('phosphate-charge:player'), true);
  input.keys.KeyE = false;
  phosphate.prepare(0.05);
  assert.equal(audio.loops.has('phosphate-charge:player'), false);
});

test('fósforo: carga insuficiente não dispara som de pulso', () => {
  const { audio, input, phosphate } = phosphateHarness();
  input.keys.KeyE = true;
  phosphate.prepare(0.016); // carga mínima não alcançada
  input.keys.KeyE = false;
  phosphate.prepare(0.016);
  assert.equal(audio.countFx('phosphatePulseRelease'), 0);
});

test('fósforo: carga válida dispara o pulso uma vez', () => {
  const { audio, input, phosphate } = phosphateHarness();
  input.keys.KeyE = true;
  for (let index = 0; index < 40; index++) phosphate.prepare(0.05);
  input.keys.KeyE = false;
  phosphate.prepare(0.05);
  assert.equal(audio.countFx('phosphatePulseRelease'), 1);
});

test('fósforo: a reserva esgotada durante a carga silencia o loop', () => {
  const { audio, input, entry, phosphate } = phosphateHarness({ reserva: 0.05 });
  input.keys.KeyE = true;
  phosphate.prepare(0.05);
  assert.equal(audio.loops.has('phosphate-charge:player'), true);
  entry.phosphateMetaboliteReserve = 0;
  phosphate.prepare(0.05);
  assert.equal(audio.loops.has('phosphate-charge:player'), false);
});

test('fósforo: clear limpa carga e transporte', () => {
  const { audio, input, phosphate } = phosphateHarness();
  input.keys.KeyE = true;
  phosphate.prepare(0.05);
  assert.equal(audio.loops.size, 1);
  phosphate.clear();
  assert.equal(audio.loops.size, 0);
});

// ---------------------------------------------------------------------------
// TRICHODERMA GENÉRICO (Etapa 4)
// ---------------------------------------------------------------------------
//
// O ataque contra o fungo oportunista tinha toda a mecânica — busca, contato,
// lise — e nenhum som: só os controles específicos de Rhizoctonia e Meloidogyne
// tocavam. Este é o sistema que o jogador encontra primeiro.

function trichodermaGenericoHarness() {
  const audio = spyAudio();
  const entities = makeEntities(audio);
  const state = baseState();
  state.level.endX = 4000;
  state.discoveredMicrobes = new Set();

  const alvo = {
    id: 'fungo-1', type: 'oportunista', x: 400, y: 380,
    vx: 0, vy: 0, homeX: 400, homeY: 380, w: 20, h: 20, alive: true,
  };
  const ecology = { agents: [alvo] };
  const colony = {
    id: 'tri-col-1', x: 250, y: 400, vigor: 1, growth: 1,
    exhausted: false, activeTargetId: null, cooldownUntil: 0,
    stage: 'ready', kills: 0, rechargeIntensity: 1, sourceCount: 1,
  };
  const colonies = { colonies: [colony], byId: id => (id === colony.id ? colony : null) };
  const growth = createTrichodermaGrowth({ state, entities, ecology, colonies });
  return { audio, state, alvo, colony, ecology, growth };
}

test('trichoderma genérico: o ataque abre um loop com chave por instância', () => {
  const { audio, growth } = trichodermaGenericoHarness();
  for (let index = 0; index < 40; index++) growth.update(0.05);
  const ataques = [...audio.loops.keys()].filter(key => key.startsWith('trichoderma-attack'));
  assert.equal(ataques.length, 1, 'um loop de ataque');
  assert.equal(ataques[0], 'trichoderma-attack:tri-col-1:fungo-1');
  assert.equal(audio.loops.get(ataques[0]).trackId, 'trichodermaHyphalAttack');
});

test('trichoderma genérico: contato e conclusão tocam uma vez cada', () => {
  const { audio, growth, ecology } = trichodermaGenericoHarness();
  for (let index = 0; index < 900; index++) {
    growth.update(0.05);
    if (!ecology.agents.length) break;
  }
  assert.equal(ecology.agents.length, 0, 'o alvo foi controlado');
  assert.equal(audio.countFx('trichodermaTargetContact'), 1);
  assert.equal(audio.countFx('trichodermaControlComplete'), 1);
  assert.equal([...audio.loops.keys()].some(key => key.startsWith('trichoderma-attack')), false);

  // Muitos quadros depois: nada repete.
  for (let index = 0; index < 60; index++) growth.update(0.05);
  assert.equal(audio.countFx('trichodermaControlComplete'), 1);
});

test('trichoderma genérico: alvo removido por outro sistema não toca conclusão', () => {
  const { audio, growth, ecology } = trichodermaGenericoHarness();
  for (let index = 0; index < 30; index++) growth.update(0.05);
  assert.ok([...audio.loops.keys()].some(key => key.startsWith('trichoderma-attack')));

  // Outro sistema apaga o alvo no meio do ataque.
  ecology.agents.length = 0;
  for (let index = 0; index < 10; index++) growth.update(0.05);

  assert.equal(audio.countFx('trichodermaControlComplete'), 0, 'não houve controle pelo Trichoderma');
  assert.equal([...audio.loops.keys()].some(key => key.startsWith('trichoderma-attack')), false, 'o loop encerra');
});

test('trichoderma genérico: clear encerra os loops de ataque', () => {
  const { audio, growth } = trichodermaGenericoHarness();
  for (let index = 0; index < 30; index++) growth.update(0.05);
  assert.ok(audio.loops.size > 0);
  growth.clear();
  assert.equal([...audio.loops.keys()].some(key => key.startsWith('trichoderma-attack')), false);
});

// ---------------------------------------------------------------------------
// PRESSÃO EXTERNA (Etapa 5)
// ---------------------------------------------------------------------------
//
// Bacillus e Pseudomonas também contêm Rhizoctonia e Ralstonia. Esses sistemas
// já calculam a pressão; o que faltava era o áudio poder lê-la.

test('bacillus: a antibiose soa contra Rhizoctonia, não só contra o oportunista', () => {
  const { audio, state, bioprotection } = bacillusHarness();
  // Amadurece o biofilme sem nenhum fungo oportunista por perto.
  for (let index = 0; index < 400; index++) bioprotection.update(0.05);
  assert.equal(audio.loops.has('bacillus-antibiosis:col-bac-1'), false, 'sem alvo, silêncio');

  // Um foco de Rhizoctonia sendo contido por esta colônia, publicado pelo
  // sistema que já faz esse cálculo.
  publishControlSignal(state, 'bacillusAntibiosis', {
    colonyId: 'col-bac-1',
    targetId: 'rhizo-1',
    targetType: 'rhizoctonia',
    pressure: 0.6,
    x: 180,
    y: 300,
  });
  bioprotection.update(0.05);
  assert.equal(audio.loops.has('bacillus-antibiosis:col-bac-1'), true, 'a contenção real soa');

  // A pressão acabou (ninguém republicou e o sinal expirou).
  state.time += 1;
  bioprotection.update(0.05);
  assert.equal(audio.loops.has('bacillus-antibiosis:col-bac-1'), false, 'termina quando o controle termina');
});

test('pseudomonas: a supressão soa contra Ralstonia, não só contra o oportunista', () => {
  const { audio, state, siderophores } = pseudomonasHarness();
  // Acumula reserva de ferro sem nenhum fungo oportunista.
  for (let index = 0; index < 300; index++) siderophores.update(0.05);
  const chave = 'pseudomonas-suppression:col-pseudo-1';
  assert.equal(audio.loops.has(chave), false, 'reserva sozinha não é supressão');

  publishControlSignal(state, 'pseudomonasSuppression', {
    colonyId: 'col-pseudo-1',
    targetId: 'ralstonia-foco-1',
    targetType: 'ralstonia',
    pressure: 0.5,
    x: 180,
    y: 300,
  });
  siderophores.update(0.05);
  assert.equal(audio.loops.has(chave), true, 'a supressão real soa');

  state.time += 1;
  siderophores.update(0.05);
  assert.equal(audio.loops.has(chave), false);
});

test('o quadro de sinais não altera nenhum valor de gameplay', () => {
  const { state, colony, siderophores } = pseudomonasHarness();
  for (let index = 0; index < 100; index++) siderophores.update(0.05);
  const vigorAntes = colony.vigor;
  const ferroAntes = siderophores.ironReserve;

  publishControlSignal(state, 'pseudomonasSuppression', {
    colonyId: 'col-pseudo-1', targetId: 'x', targetType: 'ralstonia',
    pressure: 0.9, x: 180, y: 300,
  });

  assert.equal(colony.vigor, vigorAntes, 'publicar não consome vigor');
  assert.equal(siderophores.ironReserve, ferroAntes, 'publicar não consome ferro');
});

// ---------------------------------------------------------------------------
// PRELOAD POR PROGRESSO (Etapa 6)
// ---------------------------------------------------------------------------

test('organismos persistentes continuam no preload depois da fase de estreia', () => {
  const unlocks = { azospirillumRoots: true, mycorrhizaStructures: true };
  const naFase = fase => biologicalGroupsForProgress({
    manifests: campaignManifest, phase: fase, unlocks, availableOrganisms: [],
  });

  // Pseudomonas estreia na fase 5 e Trichoderma na 6. Derivando só do cartão da
  // fase atual, os dois sumiam do preload logo depois — e o primeiro uso numa
  // fase adiante saía mudo ou atrasado.
  assert.ok(naFase(5).includes('pseudomonas'), 'estreia da Pseudomonas');
  for (const fase of [6, 7, 8, 9, 10]) {
    assert.ok(naFase(fase).includes('pseudomonas'), `fase ${fase} mantém Pseudomonas`);
  }
  assert.ok(naFase(6).includes('trichoderma'), 'estreia do Trichoderma');
  for (const fase of [7, 8, 9, 10]) {
    assert.ok(naFase(fase).includes('trichoderma'), `fase ${fase} mantém Trichoderma`);
  }
});

test('o que está no seletor entra no preload mesmo sem cartão', () => {
  const grupos = biologicalGroupsForProgress({
    manifests: campaignManifest,
    phase: 2,
    unlocks: {},
    availableOrganisms: ['pseudomonas', 'trichoderma', 'phosphate-solubilization'],
  });
  assert.ok(grupos.includes('pseudomonas'));
  assert.ok(grupos.includes('trichoderma'));
  assert.ok(grupos.includes('phosphate'));
});

test('bacillus está em todas as fases jogáveis', () => {
  for (const manifest of campaignManifest) {
    if (manifest.phase < 1) continue;
    const grupos = biologicalGroupsForProgress({
      manifests: campaignManifest, phase: manifest.phase, unlocks: {}, availableOrganisms: [],
    });
    assert.ok(grupos.includes('bacillus'), `fase ${manifest.phase} sem Bacillus`);
  }
});
