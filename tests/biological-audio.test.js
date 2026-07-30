// Gerenciador de loops dos processos biológicos (Pacote 04)
// ==========================================================
//
// Tudo aqui roda com um AudioContext FALSO. O que está sendo testado não é o
// Web Audio — é a contabilidade: uma voz por instância, idempotência, tetos,
// prioridade, distância, pausa/retomada e limpeza. Esses são os pontos onde um
// erro produz som preso, som dobrado ou silêncio, e nenhum deles aparece num
// teste que só verifica se o arquivo existe.

import assert from 'node:assert/strict';
import test from 'node:test';

import { W } from '../src/core/constants.js';
import { createBiologicalAudio, createNoopBiologicalAudio } from '../src/procgen/biological-audio.js';
import { BIOLOGICAL_LOOP_LIMIT } from '../src/audio-manifest.js';

function fakeParam(value) {
  return {
    value,
    setTargetAtTime(target) { this.value = target; },
    linearRampToValueAtTime(target) { this.value = target; },
  };
}

function fakeContext() {
  const context = {
    currentTime: 0,
    sources: [],
    createBufferSource() {
      const source = {
        buffer: null,
        loop: false,
        playbackRate: fakeParam(1),
        started: false,
        stopped: false,
        stoppedAt: null,
        connect() {},
        disconnect() {},
        start() { source.started = true; },
        stop(when) { source.stopped = true; source.stoppedAt = when ?? 0; },
      };
      context.sources.push(source);
      return source;
    },
    createGain() {
      return { gain: fakeParam(0), connect() {}, disconnect() {} };
    },
    createStereoPanner() {
      return { pan: fakeParam(0), connect() {}, disconnect() {} };
    },
  };
  return context;
}

// `loaded` são as faixas já decodificadas. `deferred` são as que só resolvem
// quando o teste mandar — é assim que o caso "parou antes de carregar" fica
// observável.
function fakeGameAudio({ loaded = [], deferred = [] } = {}) {
  const context = fakeContext();
  const buffers = new Map(loaded.map(id => [id, { duration: 2 }]));
  const resolvers = new Map();
  const played = [];
  let muted = false;

  return {
    context,
    played,
    buffers,
    setMuted(value) { muted = value; },
    // Entrega o buffer pendente de uma faixa, como o fetch faria.
    resolveBuffer(id) {
      buffers.set(id, { duration: 2 });
      const resolve = resolvers.get(id);
      if (resolve) { resolve(buffers.get(id)); resolvers.delete(id); }
      return Promise.resolve();
    },
    playFx(id, options) { played.push({ id, ...options }); return true; },
    preloadBiologicalGroup() { return []; },
    getAudioBridge() {
      return {
        context,
        destination: { connect() {} },
        isReady: () => !muted,
        isMuted: () => muted,
        getBuffer: id => buffers.get(id) || null,
        hasFailed: () => false,
        loadBuffer: (id) => {
          if (buffers.has(id)) return Promise.resolve(buffers.get(id));
          if (!deferred.includes(id)) {
            buffers.set(id, { duration: 2 });
            return Promise.resolve(buffers.get(id));
          }
          if (!resolvers.has(id)) {
            return new Promise(resolve => resolvers.set(id, resolve));
          }
          return new Promise(resolve => resolvers.set(id, resolve));
        },
        preloadGroup: () => [],
        clearQueuedFx() { context.queuedCleared = (context.queuedCleared || 0) + 1; },
        groupState: () => 'pronto',
        now: () => context.currentTime,
        note() {},
        bufferStats: () => ({ loaded: buffers.size, pending: resolvers.size, failed: 0 }),
      };
    },
  };
}

// Jogador no centro do mundo em x=1000; a câmera enquadra 1000±640.
function fakeState({ playerX = 1000, cameraX = 360, gameState = 'play', tutorialOpen = false } = {}) {
  return {
    gameState,
    cameraX,
    tutorialOpen,
    player: { x: playerX, y: 400, w: 30, h: 40 },
  };
}

function harness(options = {}) {
  const gameAudio = fakeGameAudio(options);
  const state = options.state || fakeState();
  const bio = createBiologicalAudio({ gameAudio, getState: () => state });
  return { gameAudio, state, bio };
}

// Perto o bastante para ser audível com folga.
const PERTO = { x: 1010, y: 400 };

const TODAS_AS_LOOPS = [
  'rhizobiumInfectionThread', 'nitrogenFixationActive', 'nitrogenRootGrowth',
  'azospirillumRootGrowth', 'mycorrhizaHyphaGrowth', 'mycorrhizaBridgeGrowth',
  'bacillusBiofilmGrowth', 'bacillusAntibiosis', 'pseudomonasSuppression',
  'trichodermaHyphalAttack', 'phosphateCharge', 'phosphateTransport',
];

// ---------------------------------------------------------------------------
// identidade e idempotência
// ---------------------------------------------------------------------------

test('a mesma instanceKey não cria um segundo source', () => {
  const { gameAudio, bio } = harness({ loaded: ['mycorrhizaBridgeGrowth'] });
  bio.startLoop('mycorrhiza-bridge:a', 'mycorrhizaBridgeGrowth', PERTO);
  bio.startLoop('mycorrhiza-bridge:a', 'mycorrhizaBridgeGrowth', PERTO);
  bio.startLoop('mycorrhiza-bridge:a', 'mycorrhizaBridgeGrowth', PERTO);
  assert.equal(gameAudio.context.sources.length, 1);
  assert.equal(bio.debugSnapshot().loops.length, 1);
});

test('chaves diferentes coexistem como vozes separadas', () => {
  const { gameAudio, bio } = harness({ loaded: ['bacillusBiofilmGrowth'] });
  bio.startLoop('bacillus-biofilm:1', 'bacillusBiofilmGrowth', PERTO);
  bio.startLoop('bacillus-biofilm:2', 'bacillusBiofilmGrowth', PERTO);
  assert.equal(gameAudio.context.sources.length, 2);
  assert.equal(bio.debugSnapshot().loops.length, 2);
});

test('trocar a faixa da mesma chave substitui o loop', () => {
  const { gameAudio, bio } = harness({ loaded: ['bacillusBiofilmGrowth', 'bacillusAntibiosis'] });
  bio.startLoop('bacillus-biofilm:1', 'bacillusBiofilmGrowth', PERTO);
  bio.startLoop('bacillus-biofilm:1', 'bacillusAntibiosis', PERTO);
  assert.equal(gameAudio.context.sources.length, 2, 'a nova faixa tem source próprio');
  assert.equal(gameAudio.context.sources[0].stopped, true, 'a anterior foi parada');
  const loops = bio.debugSnapshot().loops;
  assert.equal(loops.length, 1);
  assert.equal(loops[0].trackId, 'bacillusAntibiosis');
});

test('stopLoop faz fade e para o source', () => {
  const { gameAudio, bio } = harness({ loaded: ['phosphateTransport'] });
  bio.startLoop('phosphate-transport:d1', 'phosphateTransport', PERTO);
  const source = gameAudio.context.sources[0];
  assert.equal(source.started, true);
  assert.equal(bio.stopLoop('phosphate-transport:d1'), true);
  assert.equal(source.stopped, true);
  // O stop é agendado DEPOIS do fade, não no instante zero.
  assert.ok(source.stoppedAt > gameAudio.context.currentTime);
  assert.equal(bio.debugSnapshot().loops.length, 0);
});

test('parar antes do carregamento impede o som tardio', async () => {
  const { gameAudio, bio } = harness({ deferred: ['mycorrhizaHyphaGrowth'] });
  bio.startLoop('mycorrhiza-hypha:n1', 'mycorrhizaHyphaGrowth', PERTO);
  assert.equal(bio.debugSnapshot().pendingLoopCount, 1);
  assert.equal(gameAudio.context.sources.length, 0, 'nada toca sem buffer');

  // O processo terminou enquanto o arquivo ainda vinha.
  bio.stopLoop('mycorrhiza-hypha:n1');
  await gameAudio.resolveBuffer('mycorrhizaHyphaGrowth');
  await Promise.resolve();

  assert.equal(gameAudio.context.sources.length, 0, 'o buffer chegou tarde e foi descartado');
  assert.equal(bio.debugSnapshot().loops.length, 0);
});

test('o buffer que chega a tempo inicia o loop uma única vez', async () => {
  const { gameAudio, bio } = harness({ deferred: ['nitrogenRootGrowth'] });
  bio.startLoop('nitrogen-root:r1', 'nitrogenRootGrowth', { ...PERTO, group: 'nitrogen-root-growth' });
  bio.startLoop('nitrogen-root:r1', 'nitrogenRootGrowth', { ...PERTO, group: 'nitrogen-root-growth' });
  await gameAudio.resolveBuffer('nitrogenRootGrowth');
  await Promise.resolve();
  assert.equal(gameAudio.context.sources.length, 1, 'uma solicitação pendente, um source');
});

// ---------------------------------------------------------------------------
// pausa e retomada
// ---------------------------------------------------------------------------

test('pausar e retomar não duplica o source', () => {
  const { gameAudio, bio } = harness({ loaded: ['azospirillumRootGrowth'] });
  bio.startLoop('azospirillum-growth:l1', 'azospirillumRootGrowth', PERTO);
  bio.pauseLoop('azospirillum-growth:l1');
  bio.pauseLoop('azospirillum-growth:l1');
  bio.resumeLoop('azospirillum-growth:l1');
  bio.resumeLoop('azospirillum-growth:l1');
  assert.equal(gameAudio.context.sources.length, 1);
  assert.equal(bio.debugSnapshot().loops[0].paused, false);
});

test('startLoop numa chave pausada retoma em vez de recomeçar', () => {
  const { gameAudio, bio } = harness({ loaded: ['rhizobiumInfectionThread'] });
  bio.startLoop('rhizobium-thread:s1', 'rhizobiumInfectionThread', PERTO);
  bio.pauseLoop('rhizobium-thread:s1');
  bio.startLoop('rhizobium-thread:s1', 'rhizobiumInfectionThread', PERTO);
  assert.equal(gameAudio.context.sources.length, 1);
  assert.equal(bio.debugSnapshot().loops[0].paused, false);
});

// ---------------------------------------------------------------------------
// limites de voz e prioridade
// ---------------------------------------------------------------------------

test('o teto global é de oito loops', () => {
  const { bio } = harness({ loaded: TODAS_AS_LOOPS });
  // Doze processos distintos, um por grupo: todos cabem individualmente, mas o
  // teto global corta em oito.
  const chaves = [
    ['rhizobium-thread:1', 'rhizobiumInfectionThread'],
    ['nitrogen-fixation:nearest', 'nitrogenFixationActive'],
    ['azospirillum-growth:1', 'azospirillumRootGrowth'],
    ['mycorrhiza-hypha:1', 'mycorrhizaHyphaGrowth'],
    ['mycorrhiza-bridge:1', 'mycorrhizaBridgeGrowth'],
    ['bacillus-biofilm:1', 'bacillusBiofilmGrowth'],
    ['bacillus-antibiosis:1', 'bacillusAntibiosis'],
    ['pseudomonas-suppression:1', 'pseudomonasSuppression'],
    ['trichoderma-attack:1:a', 'trichodermaHyphalAttack'],
    ['phosphate-charge:player', 'phosphateCharge'],
    ['phosphate-transport:1', 'phosphateTransport'],
    ['phosphate-transport:2', 'phosphateTransport'],
  ];
  for (const [key, track] of chaves) bio.startLoop(key, track, PERTO);
  assert.ok(bio.debugSnapshot().loops.length <= BIOLOGICAL_LOOP_LIMIT);
  assert.equal(BIOLOGICAL_LOOP_LIMIT, 8);
});

test('o limite por grupo vale mesmo abaixo do teto global', () => {
  const { bio } = harness({ loaded: ['mycorrhizaBridgeGrowth'] });
  // mycorrhiza-bridge: 1
  bio.startLoop('mycorrhiza-bridge:a', 'mycorrhizaBridgeGrowth', PERTO);
  bio.startLoop('mycorrhiza-bridge:b', 'mycorrhizaBridgeGrowth', PERTO);
  const loops = bio.debugSnapshot().loops;
  assert.equal(loops.length, 1, 'só uma ponte soa por vez');
  assert.equal(loops[0].instanceKey, 'mycorrhiza-bridge:b', 'a mais recente ocupa a vaga');
});

test('a prioridade decide quem sai: a FBN cede lugar à ponte', () => {
  const { bio } = harness({ loaded: TODAS_AS_LOOPS });
  // Preenche o teto com o loop de MENOR prioridade possível (nitrogen-fixation
  // tem prioridade 1) mais outros, e depois pede a ponte (prioridade 7).
  bio.startLoop('nitrogen-fixation:nearest', 'nitrogenFixationActive', PERTO);
  bio.startLoop('bacillus-antibiosis:1', 'bacillusAntibiosis', PERTO);
  bio.startLoop('pseudomonas-suppression:1', 'pseudomonasSuppression', PERTO);
  bio.startLoop('mycorrhiza-hypha:1', 'mycorrhizaHyphaGrowth', PERTO);
  bio.startLoop('mycorrhiza-hypha:2', 'mycorrhizaHyphaGrowth', PERTO);
  bio.startLoop('rhizobium-thread:1', 'rhizobiumInfectionThread', PERTO);
  bio.startLoop('rhizobium-thread:2', 'rhizobiumInfectionThread', PERTO);
  bio.startLoop('bacillus-biofilm:1', 'bacillusBiofilmGrowth', PERTO);
  assert.equal(bio.debugSnapshot().loops.length, 8, 'teto atingido');

  bio.startLoop('mycorrhiza-bridge:a', 'mycorrhizaBridgeGrowth', PERTO);
  const chaves = bio.debugSnapshot().loops.map(loop => loop.instanceKey);
  assert.ok(chaves.includes('mycorrhiza-bridge:a'), 'a ponte entrou');
  assert.ok(!chaves.includes('nitrogen-fixation:nearest'), 'a FBN, de menor prioridade, saiu');
});

test('a carga do fósforo protegida não é despejada', () => {
  const { bio } = harness({ loaded: TODAS_AS_LOOPS });
  bio.startLoop('phosphate-charge:player', 'phosphateCharge', { protect: true });
  for (let index = 0; index < 12; index++) {
    bio.startLoop(`mycorrhiza-hypha:${index}`, 'mycorrhizaHyphaGrowth', PERTO);
    bio.startLoop(`rhizobium-thread:${index}`, 'rhizobiumInfectionThread', PERTO);
    bio.startLoop(`bacillus-biofilm:${index}`, 'bacillusBiofilmGrowth', PERTO);
  }
  const chaves = bio.debugSnapshot().loops.map(loop => loop.instanceKey);
  assert.ok(chaves.includes('phosphate-charge:player'));
  assert.ok(chaves.length <= BIOLOGICAL_LOOP_LIMIT);
});

// ---------------------------------------------------------------------------
// espacialização
// ---------------------------------------------------------------------------

test('som fora do alcance não inicia', () => {
  const { gameAudio, bio } = harness({ loaded: ['bacillusBiofilmGrowth'] });
  const iniciou = bio.startLoop('bacillus-biofilm:longe', 'bacillusBiofilmGrowth', { x: 9000, y: 400 });
  assert.equal(iniciou, false);
  assert.equal(gameAudio.context.sources.length, 0);
  assert.equal(bio.debugSnapshot().rejectedByDistance, 1);
});

test('pan negativo à esquerda, positivo à direita, ~zero no centro', () => {
  const state = fakeState({ playerX: 1000, cameraX: 360 });
  const { bio } = harness({ loaded: ['bacillusBiofilmGrowth'], state });
  const centro = state.cameraX + W / 2; // 1000

  bio.startLoop('bacillus-biofilm:esq', 'bacillusBiofilmGrowth', { x: centro - 300, y: 400 });
  bio.startLoop('bacillus-biofilm:dir', 'bacillusBiofilmGrowth', { x: centro + 300, y: 400 });
  bio.startLoop('bacillus-antibiosis:mid', 'bacillusAntibiosis', { x: centro, y: 400 });

  const porChave = Object.fromEntries(bio.debugSnapshot().loops.map(loop => [loop.instanceKey, loop]));
  assert.ok(porChave['bacillus-biofilm:esq'].pan < -0.1, 'à esquerda');
  assert.ok(porChave['bacillus-biofilm:dir'].pan > 0.1, 'à direita');
  assert.ok(Math.abs(porChave['bacillus-antibiosis:mid'].pan) < 0.01, 'centrado');
});

test('o pan respeita o limite de ±0,80', () => {
  // Câmera à esquerda do jogador: a fonte fica longe do centro da TELA (pan
  // saturado) mas perto do JOGADOR (audível). `range` largo isola o pan da
  // atenuação por distância, que é o que este teste não está medindo.
  const state = fakeState({ playerX: 1000, cameraX: 0 });
  const { bio } = harness({ loaded: ['mycorrhizaHyphaGrowth'], state });
  bio.startLoop('mycorrhiza-hypha:borda', 'mycorrhizaHyphaGrowth', {
    x: 1600, y: 400, range: 2000,
  });
  const loop = bio.debugSnapshot().loops[0];
  assert.ok(loop, 'o loop precisa existir para o pan ser medido');
  assert.equal(loop.pan, 0.80, 'satura no limite, não passa dele');
});

test('um loop inaudível por tempo demais solta o source e volta ao reaproximar', () => {
  const state = fakeState();
  const { gameAudio, bio } = harness({ loaded: ['bacillusBiofilmGrowth'], state });
  bio.startLoop('bacillus-biofilm:1', 'bacillusBiofilmGrowth', PERTO);
  assert.equal(gameAudio.context.sources.length, 1);

  // O processo continua, mas o jogador se afasta muito.
  for (let quadro = 0; quadro < 30; quadro++) {
    bio.updateLoop('bacillus-biofilm:1', { x: 9000, y: 400 });
    bio.update(0.1);
  }
  assert.equal(bio.debugSnapshot().loops[0].released, true, 'o source foi solto');
  assert.equal(gameAudio.context.sources[0].stopped, true);

  // Voltou ao alcance: o loop renasce, sem duplicar a voz.
  bio.updateLoop('bacillus-biofilm:1', PERTO);
  bio.update(0.016);
  assert.equal(gameAudio.context.sources.length, 2, 'um source novo, não o antigo reutilizado');
  assert.equal(bio.debugSnapshot().loops.length, 1, 'continua sendo UMA voz');
});

// ---------------------------------------------------------------------------
// limpeza
// ---------------------------------------------------------------------------

test('um loop que ninguém sustenta é recolhido', () => {
  const { gameAudio, bio } = harness({ loaded: ['trichodermaHyphalAttack'] });
  bio.startLoop('trichoderma-attack:c1:t1', 'trichodermaHyphalAttack', PERTO);
  // Ninguém chama startLoop/updateLoop de novo: o dono sumiu.
  for (let quadro = 0; quadro < 10; quadro++) bio.update(0.1);
  assert.equal(bio.debugSnapshot().loops.length, 0);
  assert.equal(gameAudio.context.sources[0].stopped, true);
});

test('fora de "play" os loops recuam sem sumir da contabilidade', () => {
  const state = fakeState();
  const { bio } = harness({ loaded: ['nitrogenRootGrowth'], state });
  bio.startLoop('nitrogen-root:r1', 'nitrogenRootGrowth', { ...PERTO, group: 'nitrogen-root-growth' });
  state.gameState = 'respawning';
  bio.update(0.016);
  const loop = bio.debugSnapshot().loops[0];
  assert.equal(loop.paused, true, 'a morte não pode deixar som tocando');
});

test('stopGroup encerra só o grupo pedido', () => {
  const { bio } = harness({ loaded: ['mycorrhizaBridgeGrowth', 'bacillusBiofilmGrowth'] });
  bio.startLoop('mycorrhiza-bridge:a', 'mycorrhizaBridgeGrowth', PERTO);
  bio.startLoop('bacillus-biofilm:1', 'bacillusBiofilmGrowth', PERTO);
  bio.stopGroup('mycorrhiza-bridge');
  const chaves = bio.debugSnapshot().loops.map(loop => loop.instanceKey);
  assert.deepEqual(chaves, ['bacillus-biofilm:1']);
});

test('reset limpa loops, pendências e contadores', async () => {
  const { gameAudio, bio } = harness({
    loaded: ['bacillusBiofilmGrowth'],
    deferred: ['mycorrhizaHyphaGrowth'],
  });
  bio.startLoop('bacillus-biofilm:1', 'bacillusBiofilmGrowth', PERTO);
  bio.startLoop('mycorrhiza-hypha:n1', 'mycorrhizaHyphaGrowth', PERTO);
  bio.startLoop('bacillus-biofilm:longe', 'bacillusBiofilmGrowth', { x: 9000, y: 400 });
  assert.equal(bio.debugSnapshot().rejectedByDistance, 1);

  bio.reset();
  const depois = bio.debugSnapshot();
  assert.equal(depois.loops.length, 0);
  assert.equal(depois.pendingLoopCount, 0);
  assert.equal(depois.rejectedByDistance, 0);
  assert.equal(depois.events.length, 0);

  // A pendência cancelada não pode ressuscitar depois do reset.
  await gameAudio.resolveBuffer('mycorrhizaHyphaGrowth');
  await Promise.resolve();
  assert.equal(bio.debugSnapshot().loops.length, 0);
});

test('stopAll limpa tudo', () => {
  const { bio } = harness({ loaded: TODAS_AS_LOOPS });
  bio.startLoop('rhizobium-thread:1', 'rhizobiumInfectionThread', PERTO);
  bio.startLoop('bacillus-biofilm:1', 'bacillusBiofilmGrowth', PERTO);
  bio.startLoop('mycorrhiza-bridge:a', 'mycorrhizaBridgeGrowth', PERTO);
  assert.equal(bio.debugSnapshot().loops.length, 3);
  bio.stopAll({ fade: 0.2, clearPending: true });
  assert.equal(bio.debugSnapshot().loops.length, 0);
});

// ---------------------------------------------------------------------------
// mute
// ---------------------------------------------------------------------------

test('mutar não destrói buffers nem estados', () => {
  const { gameAudio, bio } = harness({ loaded: ['bacillusBiofilmGrowth'] });
  bio.startLoop('bacillus-biofilm:1', 'bacillusBiofilmGrowth', PERTO);
  gameAudio.setMuted(true);
  bio.update(0.016);
  assert.equal(gameAudio.buffers.has('bacillusBiofilmGrowth'), true, 'o buffer continua decodificado');
  assert.equal(bio.debugSnapshot().loops.length, 1, 'o estado do processo continua');
});

test('desmutar não ressuscita processo concluído', () => {
  const { gameAudio, bio } = harness({ loaded: ['bacillusBiofilmGrowth'] });
  bio.startLoop('bacillus-biofilm:1', 'bacillusBiofilmGrowth', PERTO);
  gameAudio.setMuted(true);
  // O processo terminou enquanto estava mudo.
  bio.stopLoop('bacillus-biofilm:1');
  gameAudio.setMuted(false);
  bio.update(0.016);
  assert.equal(bio.debugSnapshot().loops.length, 0);
});

// ---------------------------------------------------------------------------
// efeitos pontuais e cooldowns
// ---------------------------------------------------------------------------

test('efeito pontual sai pelo barramento biológico, com pan', () => {
  const state = fakeState();
  const { gameAudio, bio } = harness({ loaded: [], state });
  bio.play('mycorrhizaArbusculeComplete', { x: state.cameraX + W / 2 + 300, y: 400 });
  assert.equal(gameAudio.played.length, 1);
  assert.equal(gameAudio.played[0].id, 'mycorrhizaArbusculeComplete');
  assert.equal(gameAudio.played[0].bus, 'biological');
  assert.ok(gameAudio.played[0].pan > 0.1);
});

test('o cooldown por instância segura repetição na mesma colônia', () => {
  const { gameAudio, bio } = harness();
  for (let index = 0; index < 10; index++) {
    bio.play('pseudomonasSiderophoreLaunch', { ...PERTO, instanceId: 'colony-1' });
  }
  assert.equal(gameAudio.played.length, 1, 'dez partículas no mesmo instante, um som');
  assert.ok(bio.debugSnapshot().blockedByCooldown >= 9);

  // Passado o cooldown da colônia (0,40 s), volta a tocar. `update` limita o dt
  // a 0,25 s por chamada (é um quadro, não um salto no tempo), então são dois.
  bio.update(0.25);
  bio.update(0.25);
  bio.play('pseudomonasSiderophoreLaunch', { ...PERTO, instanceId: 'colony-1' });
  assert.equal(gameAudio.played.length, 2);
});

test('o cooldown global vale entre instâncias diferentes', () => {
  const { gameAudio, bio } = harness();
  bio.play('pseudomonasIronBind', PERTO);
  bio.play('pseudomonasIronBind', PERTO);
  assert.equal(gameAudio.played.length, 1, 'cooldown global de 0,12 s');
  bio.update(0.2);
  bio.play('pseudomonasIronBind', PERTO);
  assert.equal(gameAudio.played.length, 2);
});

test('conclusões únicas não têm cooldown que possa engoli-las', () => {
  const { gameAudio, bio } = harness();
  // Duas conclusões diferentes no mesmo quadro precisam sair as duas.
  bio.play('phosphateDepositComplete', PERTO);
  bio.play('mycorrhizaBridgeComplete', PERTO);
  bio.play('nitrogenRootComplete', PERTO);
  assert.equal(gameAudio.played.length, 3);
});

test('efeito fora de alcance não toca', () => {
  const { gameAudio, bio } = harness();
  bio.play('mycorrhizaRootContact', { x: 9000, y: 400 });
  assert.equal(gameAudio.played.length, 0);
  assert.equal(bio.debugSnapshot().rejectedByDistance, 1);
});

test('um loop nunca é disparado como efeito pontual', () => {
  const { gameAudio, bio } = harness({ loaded: ['phosphateCharge'] });
  // `rejected` e diferente de `suppressed`: quem chamou NAO deve marcar a
  // transicao como concluida, porque foi um pedido invalido.
  assert.deepEqual(bio.play('phosphateCharge', PERTO), { accepted: false, state: 'rejected' });
  assert.equal(gameAudio.played.length, 0);
});

test('faixa inexistente é rejeitada e o motivo aparece no diagnóstico', () => {
  const { bio } = harness();
  assert.equal(bio.play('naoExiste', PERTO).state, 'rejected');
  assert.equal(bio.debugSnapshot().lastRejectedEffect, 'naoExiste');
  assert.equal(bio.debugSnapshot().lastRejectionReason, 'faixa inexistente');
});

test('cooldown e distância suprimem, não rejeitam', () => {
  // A diferenca importa: o evento biologico ACONTECEU. Se isto voltasse como
  // `rejected`, o sistema tentaria de novo a cada quadro e o som sairia assim
  // que o cooldown expirasse — um eco do evento, fora de hora.
  const { bio } = harness();
  bio.play('pseudomonasSiderophoreLaunch', { ...PERTO, instanceId: 'c1' });
  assert.equal(bio.play('pseudomonasSiderophoreLaunch', { ...PERTO, instanceId: 'c1' }).state, 'suppressed');
  assert.equal(bio.play('mycorrhizaRootContact', { x: 9000, y: 400 }).state, 'suppressed');
});

// ---------------------------------------------------------------------------
// adaptador silencioso
// ---------------------------------------------------------------------------

test('sem ponte de áudio, a fachada é silenciosa e não quebra ninguém', () => {
  const bio = createBiologicalAudio({ gameAudio: null, getState: () => fakeState() });
  // Sem controlador: `suppressed`, nao `rejected` — os modulos marcam a
  // transicao e nao repetem o evento a cada quadro nos testes Node.
  assert.deepEqual(bio.play('rhizobiumRecognition', PERTO), { accepted: false, state: 'suppressed' });
  assert.equal(bio.startLoop('a:b', 'phosphateCharge', PERTO), false);
  assert.equal(bio.updateLoop('a:b', PERTO), false);
  assert.equal(bio.stopLoop('a:b'), false);
  assert.equal(bio.stopGroup('a'), false);
  assert.equal(bio.stopAll(), false);
  bio.update(0.016);
  bio.reset();
  assert.equal(bio.debugSnapshot().available, false);
});

test('o adaptador no-op tem a mesma API', () => {
  const noop = createNoopBiologicalAudio();
  for (const metodo of [
    'play', 'startLoop', 'updateLoop', 'pauseLoop', 'resumeLoop',
    'stopLoop', 'stopGroup', 'stopAll', 'update', 'reset', 'debugSnapshot',
  ]) {
    assert.equal(typeof noop[metodo], 'function', `${metodo} ausente no no-op`);
  }
});

// ---------------------------------------------------------------------------
// concorrência (§43)
// ---------------------------------------------------------------------------

test('cenário com dez processos simultâneos não passa de oito loops', () => {
  const state = fakeState();
  const { bio } = harness({ loaded: TODAS_AS_LOOPS, state });
  const cenario = () => {
    bio.startLoop('rhizobium-thread:s1', 'rhizobiumInfectionThread', PERTO);
    bio.startLoop('mycorrhiza-bridge:b1', 'mycorrhizaBridgeGrowth', PERTO);
    bio.startLoop('azospirillum-growth:l1', 'azospirillumRootGrowth', PERTO);
    bio.startLoop('bacillus-biofilm:c1', 'bacillusBiofilmGrowth', PERTO);
    bio.startLoop('bacillus-antibiosis:c1', 'bacillusAntibiosis', PERTO);
    bio.startLoop('pseudomonas-suppression:c2', 'pseudomonasSuppression', PERTO);
    bio.startLoop('trichoderma-attack:c3:t1', 'trichodermaHyphalAttack', PERTO);
    bio.startLoop('phosphate-charge:player', 'phosphateCharge', { protect: true });
    bio.startLoop('phosphate-transport:d1', 'phosphateTransport', PERTO);
    bio.startLoop('phosphate-transport:d2', 'phosphateTransport', PERTO);
  };
  for (let quadro = 0; quadro < 5; quadro++) {
    cenario();
    bio.update(0.016);
  }

  const snapshot = bio.debugSnapshot();
  assert.ok(snapshot.loops.length <= BIOLOGICAL_LOOP_LIMIT, `passou de 8: ${snapshot.loops.length}`);
  const chaves = snapshot.loops.map(loop => loop.instanceKey);
  assert.ok(chaves.includes('phosphate-charge:player'), 'a carga tem prioridade e proteção');
  assert.ok(chaves.includes('mycorrhiza-bridge:b1'), 'a ponte tem prioridade alta');
  // Nenhum ganho individual pode estourar: o teto é 1 vezes o defaultGain.
  for (const loop of snapshot.loops) {
    assert.ok(loop.gain >= 0 && loop.gain <= 1, `${loop.instanceKey}: ganho ${loop.gain}`);
  }

  bio.stopAll();
  assert.equal(bio.debugSnapshot().loops.length, 0);
});

test('loops distantes cedem lugar aos próximos quando o teto aperta', () => {
  const state = fakeState();
  const { bio } = harness({ loaded: TODAS_AS_LOOPS, state });
  // Duas vozes do mesmo grupo e mesma prioridade: a distante deve ser a vítima.
  bio.startLoop('mycorrhiza-hypha:longe', 'mycorrhizaHyphaGrowth', { x: state.player.x + 500, y: 400 });
  bio.startLoop('mycorrhiza-hypha:perto', 'mycorrhizaHyphaGrowth', PERTO);
  bio.startLoop('mycorrhiza-hypha:tambem-perto', 'mycorrhizaHyphaGrowth', { x: state.player.x + 20, y: 400 });

  const chaves = bio.debugSnapshot().loops.map(loop => loop.instanceKey);
  assert.equal(chaves.length, 2, 'mycorrhiza-hypha tem teto 2');
  assert.ok(!chaves.includes('mycorrhiza-hypha:longe'), 'a mais distante saiu');
});

// ---------------------------------------------------------------------------
// tutorial (Etapa 2)
// ---------------------------------------------------------------------------

test('um cartão de tutorial não destrói os loops em curso', () => {
  const state = fakeState();
  const { gameAudio, bio } = harness({ loaded: ['mycorrhizaBridgeGrowth'], state });
  bio.startLoop('mycorrhiza-bridge:a', 'mycorrhizaBridgeGrowth', PERTO);
  assert.equal(bio.debugSnapshot().registeredLoopCount, 1);

  // 4 s de cartão aberto. A simulação biológica para, ninguém sustenta a chave —
  // e antes disso bastavam 0,6 s para o loop ser recolhido como órfão.
  state.tutorialOpen = true;
  for (let quadro = 0; quadro < 250; quadro++) bio.update(0.016);

  const durante = bio.debugSnapshot();
  assert.equal(durante.registeredLoopCount, 1, 'o loop continua registrado');
  assert.equal(gameAudio.context.sources.length, 1, 'nenhuma voz nova foi criada');

  // Fechou: os sistemas voltam a sustentar dentro da tolerância.
  state.tutorialOpen = false;
  bio.update(0.016);
  bio.startLoop('mycorrhiza-bridge:a', 'mycorrhizaBridgeGrowth', PERTO);
  bio.update(0.016);

  const depois = bio.debugSnapshot();
  assert.equal(depois.registeredLoopCount, 1, 'continua sendo UMA voz');
  assert.equal(gameAudio.context.sources.length, 1, 'não reiniciou o arquivo do começo');
  assert.equal(depois.loops[0].state, 'ativo');
});

test('a tolerância pós-tutorial não impede a expiração normal depois', () => {
  const state = fakeState();
  const { bio } = harness({ loaded: ['mycorrhizaBridgeGrowth'], state });
  bio.startLoop('mycorrhiza-bridge:a', 'mycorrhizaBridgeGrowth', PERTO);
  state.tutorialOpen = true;
  bio.update(0.016);
  state.tutorialOpen = false;
  // Passada a tolerância (0,8 s) e o prazo de órfã (0,6 s), sem ninguém
  // sustentar, o loop sai — o tutorial adia, não isenta.
  for (let quadro = 0; quadro < 40; quadro++) bio.update(0.1);
  assert.equal(bio.debugSnapshot().registeredLoopCount, 0);
});

// ---------------------------------------------------------------------------
// limite de vozes conta só o que é audível (Etapa 7)
// ---------------------------------------------------------------------------

test('vozes inaudíveis não bloqueiam uma voz audível', () => {
  const state = fakeState();
  const { bio } = harness({ loaded: TODAS_AS_LOOPS, state });

  // Doze processos, e só cinco perto do jogador. Antes, o teto global contava
  // TODAS as entradas do mapa — inclusive as fora de alcance — e um processo
  // novo ao lado do jogador simplesmente não começava.
  const longe = { x: state.player.x + 5000, y: 400 };
  const registrados = [
    ['rhizobium-thread:1', 'rhizobiumInfectionThread', PERTO],
    ['rhizobium-thread:2', 'rhizobiumInfectionThread', PERTO],
    ['mycorrhiza-hypha:1', 'mycorrhizaHyphaGrowth', PERTO],
    ['mycorrhiza-hypha:2', 'mycorrhizaHyphaGrowth', PERTO],
    ['bacillus-biofilm:1', 'bacillusBiofilmGrowth', PERTO],
    ['bacillus-biofilm:2', 'bacillusBiofilmGrowth', longe],
    ['phosphate-transport:1', 'phosphateTransport', longe],
    ['phosphate-transport:2', 'phosphateTransport', longe],
    ['trichoderma-attack:1:a', 'trichodermaHyphalAttack', longe],
    ['trichoderma-attack:2:b', 'trichodermaHyphalAttack', longe],
    ['bacillus-antibiosis:1', 'bacillusAntibiosis', longe],
    ['pseudomonas-suppression:1', 'pseudomonasSuppression', longe],
  ];
  for (const [key, track, posicao] of registrados) bio.startLoop(key, track, posicao);

  const snapshot = bio.debugSnapshot();
  assert.ok(snapshot.activeLoopCount <= BIOLOGICAL_LOOP_LIMIT);

  // O processo audível de maior prioridade entra mesmo com o mapa cheio.
  assert.equal(bio.startLoop('mycorrhiza-bridge:nova', 'mycorrhizaBridgeGrowth', PERTO), true);
  const chaves = bio.debugSnapshot().loops.map(loop => loop.instanceKey);
  assert.ok(chaves.includes('mycorrhiza-bridge:nova'), 'a ponte perto do jogador soa');
});

test('o diagnóstico separa registrado, ativo, pausado e fora de alcance', () => {
  const state = fakeState();
  const { bio } = harness({ loaded: TODAS_AS_LOOPS, state });
  bio.startLoop('bacillus-biofilm:1', 'bacillusBiofilmGrowth', PERTO);
  bio.startLoop('bacillus-biofilm:2', 'bacillusBiofilmGrowth', PERTO);
  bio.pauseLoop('bacillus-biofilm:2');

  const snapshot = bio.debugSnapshot();
  assert.equal(snapshot.registeredLoopCount, 2);
  assert.equal(snapshot.activeLoopCount, 1);
  assert.equal(snapshot.pausedLoopCount, 1);
  assert.equal(snapshot.loops.find(l => l.instanceKey === 'bacillus-biofilm:1').state, 'ativo');
  assert.equal(snapshot.loops.find(l => l.instanceKey === 'bacillus-biofilm:2').state, 'pausado');
  assert.equal(typeof snapshot.preloadGroups.rhizobium, 'string');
});

// ---------------------------------------------------------------------------
// alcance (Etapa 3)
// ---------------------------------------------------------------------------

test('um loop discreto continua audível dentro da área visual', () => {
  const state = fakeState();
  const { bio } = harness({ loaded: ['bacillusAntibiosis'], state });
  // Ganho-base 0,09 a 350 px: com a atenuação quadrática antiga isso caía para
  // ~0,015 e o som não existia numa distância em que o jogador VÊ o processo.
  bio.startLoop('bacillus-antibiosis:1', 'bacillusAntibiosis', { x: state.player.x + 350, y: 400 });
  const loop = bio.debugSnapshot().loops[0];
  assert.ok(loop, 'o loop precisa existir a 350 px');
  assert.ok(loop.gain > 0.03, `ganho baixo demais a 350 px: ${loop.gain}`);
});

test('o mesmo loop some perto do limite de alcance', () => {
  const state = fakeState();
  const { bio } = harness({ loaded: ['bacillusAntibiosis'], state });
  const iniciou = bio.startLoop('bacillus-antibiosis:1', 'bacillusAntibiosis', {
    x: state.player.x + 740, y: 400,
  });
  const loops = bio.debugSnapshot().loops;
  assert.ok(!iniciou || loops[0].gain < 0.01, 'praticamente inaudível na borda');
});
