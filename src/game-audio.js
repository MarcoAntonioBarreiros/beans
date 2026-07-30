// Controlador de áudio do jogo
// ============================
//
// Um único AudioContext, quatro barramentos e um compressor suave no fim. Música
// e ambiente são `HTMLAudioElement` ligados ao grafo por `createMediaElementSource`
// (streaming, loop, crossfade, pouca memória no celular); efeitos curtos são
// AudioBuffer decodificados uma vez e disparados por `BufferSource`.
//
// Nada toca antes da primeira interação do usuário: o navegador bloqueia, e o
// silêncio inicial é o comportamento correto. O `unlock()` acontece no primeiro
// pointerdown/touchstart/keydown e a partir dali música, ambientes e o scheduler
// de gotas começam.
//
// O controlador NUNCA lê ou altera dados biológicos para decidir som, e o sorteio
// das gotas usa um RNG próprio — o RNG da campanha decide geometria, e puxar
// números dele para escolher uma gota mudaria o nível gerado.
//
// O bundler aceita apenas `export const` / `export function`.

import {
  AMBIENCE_LAYERS,
  AMBIENCE_LAYER_GAINS,
  AUDIO_DEFAULTS,
  BIOLOGICAL_AUDIO_GROUPS,
  BIOLOGICAL_BUS_SCALE,
  BIOLOGICAL_TUTORIAL_DUCK,
  CRITICAL_FX_QUEUE_SECONDS,
  fxDeliveryClass,
  AUDIO_STORAGE_KEY,
  AUDIO_STORAGE_KEY_V1,
  AUDIO_STORAGE_VERSION,
  AUDIO_TRACKS,
  DROP_SCHEDULE,
  DROP_TRACK_IDS,
  DUCK_LEVELS,
  INTERNAL_ROOT_FLOW,
  MUSIC_CROSSFADE_SECONDS,
  MUSIC_FIRST_FADE_SECONDS,
  MUSIC_SUPPRESSION_SECONDS,
  STINGER_FADE_SECONDS,
  migrateAudioSettings,
  musicTrackForPhase,
} from './audio-manifest.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Janela máxima que um efeito TRANSITÓRIO pode esperar pelo próprio buffer.
// Acima disso o som sairia depois do movimento e é descartado.
//
// Efeitos CRÍTICOS não usam esta janela: 80 ms é curto demais para a primeira
// vez que um arquivo é pedido, e era por isso que o primeiro som de um processo
// sumia ao entrar numa fase. Eles vão para a fila confiável, que espera
// `CRITICAL_FX_QUEUE_SECONDS`.
const FX_MAXIMUM_DELAY_MS = 80;

// Resultado de um pedido de efeito. Quem chama precisa distinguir "não vai sair
// nunca" (rejected) de "vai sair daqui a pouco" (queued) — marcar a transição
// como concluída no primeiro caso apagaria o evento para sempre.
const FX_PLAYED = Object.freeze({ accepted: true, state: 'played' });
const FX_QUEUED = Object.freeze({ accepted: true, state: 'queued' });
const FX_SUPPRESSED = Object.freeze({ accepted: false, state: 'suppressed' });
const FX_REJECTED = Object.freeze({ accepted: false, state: 'rejected' });

// Um pedido foi "entregue" quando não foi recusado: tocou, entrou na fila, ou o
// jogador está sem som. Nos três casos a transição pode ser marcada — insistir
// não traria o som de volta e repetiria o evento a cada quadro.
export function fxLanded(result) {
  if (result === undefined || result === null || result === false) return false;
  if (result === true) return true;
  return result.state !== 'rejected';
}

// Adaptador silencioso: mesma API, nenhum efeito. É o que o simulador usa nos
// testes Node, onde não existe AudioContext nem document.
export function createNoopAudio() {
  return {
    init() {},
    unlock() {},
    update() {},
    setPhase() {},
    // Sem audio no ambiente: o pedido nao foi recusado, so nao ha som. Quem
    // chama pode marcar a transicao e seguir em frente.
    playFx() { return { accepted: false, state: 'suppressed' }; },
    playStinger() { return false; },
    preloadBiologicalGroup() { return []; },
    clearQueuedFx() {},
    getAudioBridge() { return null; },
    toggleMute() { return false; },
    setMuted() {},
    isMuted() { return false; },
    isUnlocked() { return false; },
    getUiState() { return { available: false, unlocked: false, muted: false, audible: false }; },
    beginPhaseVictory() {},
    endPhaseVictory() {},
    ensureExpectedMediaPlayback() { return Promise.resolve(false); },
    stopStinger() {},
    suspend() {},
    resume() {},
    destroy() {},
    toneNow() {},
    debugSnapshot() {
      return {
        available: false, unlocked: false, contextState: 'noop', muted: false,
        musicTrackId: null, crossfadingTo: null, musicPhase: null,
        ambienceLayers: [], internalRootFlow: 0,
        currentDrop: null, nextDropIn: null, lastFx: null, errors: [],
        initialized: false, audible: false, musicSuppression: 1,
        activeStinger: null, storageVersion: AUDIO_STORAGE_VERSION,
      };
    },
  };
}

function readStoredSettings(windowRef) {
  try {
    const atual = windowRef?.localStorage?.getItem(AUDIO_STORAGE_KEY);
    if (atual) {
      const parsed = JSON.parse(atual);
      if (parsed && typeof parsed === 'object') return migrateAudioSettings(parsed);
    }
    // Sem v2: tenta migrar a v1 de quem já abriu o jogo antes.
    const antigo = windowRef?.localStorage?.getItem(AUDIO_STORAGE_KEY_V1);
    if (antigo) {
      const parsed = JSON.parse(antigo);
      if (parsed && typeof parsed === 'object') return migrateAudioSettings(parsed);
    }
    return null;
  } catch {
    // localStorage indisponível (modo privado, iframe restrito): segue sem persistir.
    return null;
  }
}

function writeStoredSettings(windowRef, settings) {
  try {
    windowRef?.localStorage?.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Sem persistência: o jogo continua normalmente.
  }
}

export function createGameAudio({
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  getState = () => null,
  getCampaign = () => null,
  disabled = false,
  random = Math.random,
} = {}) {
  if (disabled || !windowRef || !documentRef) return createNoopAudio();

  const AudioContextClass = windowRef.AudioContext || windowRef.webkitAudioContext;
  if (typeof AudioContextClass !== 'function') return createNoopAudio();

  // ---- estado -------------------------------------------------------------
  const stored = readStoredSettings(windowRef);
  const settings = {
    muted: Boolean(stored?.muted),
    master: Number.isFinite(stored?.master) ? stored.master : AUDIO_DEFAULTS.master,
    music: Number.isFinite(stored?.music) ? stored.music : AUDIO_DEFAULTS.music,
    ambience: Number.isFinite(stored?.ambience) ? stored.ambience : AUDIO_DEFAULTS.ambience,
    drops: Number.isFinite(stored?.drops) ? stored.drops : AUDIO_DEFAULTS.drops,
    fx: Number.isFinite(stored?.fx) ? stored.fx : AUDIO_DEFAULTS.fx,
    stinger: Number.isFinite(stored?.stinger) ? stored.stinger : AUDIO_DEFAULTS.stinger,
    version: AUDIO_STORAGE_VERSION,
  };

  let context = null;
  let initialized = false;
  let unlocked = false;
  let destroyed = false;
  const errors = [];
  const timers = new Set();
  const listeners = [];

  let masterGain = null;
  let musicGain = null;
  let ambienceGain = null;
  let dropGain = null;
  let fxGain = null;

  const decks = [];
  let activeDeck = 0;
  let currentMusicId = null;
  let crossfadingTo = null;
  let musicPhase = null;

  const ambienceNodes = new Map();
  let internalFlowGainNow = INTERNAL_ROOT_FLOW.offRoot;

  const fxBuffers = new Map();
  const fxPending = new Map();
  const fxFailed = new Set();
  let lastFxId = null;
  let lastJumpAt = -Infinity;

  const dropNodes = new Map();
  let currentDropId = null;
  let lastDropId = null;
  let nextDropIn = 0;
  let dropActive = false;

  // Barramento dos processos biológicos (Pacote 04). Fica separado dos efeitos
  // comuns para poder recuar durante um tutorial sem abafar o salto e o dano, e
  // para o compressor ver a soma dos loops como uma camada só.
  let biologicalGain = null;

  let stingerElement = null;
  let stingerGain = null;
  let stingerBusGain = null;
  let stingerId = null;
  let stingerEndedHandler = null;

  let duck = 1;
  let duckTarget = 1;
  // Supressão exclusiva da MÚSICA. Vai a 0 durante a vitória de fase, sem mexer
  // no ambiente nem no stinger — antes a música da fase continuava audível por
  // baixo da vitória.
  let musicSuppression = 1;
  let musicSuppressionTarget = 1;
  let victoryActive = false;
  let phaseVictoryPlaying = false;
  let campaignVictoryPlaying = false;
  let lastVictoryPhase = null;
  let lastPlaybackError = null;
  const fxLoadPromises = new Map();
  // Pedidos criticos aguardando o proprio buffer (ver `queueCriticalFx`).
  const queuedFx = new Map();

  // Anel de mensagens do painel de debug.
  //
  // Eram 12, e isso ficou pequeno demais: `preloadShortFx` passou a buscar 14
  // arquivos (os 4 efeitos do jogador mais os 10 do Pacote 03). Numa rede ruim,
  // em que todos falham, as primeiras mensagens eram empurradas para fora antes
  // de alguém abrir o painel — e a falha do salto, que é a mais importante,
  // sumia justamente no cenário em que ela acontece.
  function note(message) {
    if (errors.length > 40) errors.shift();
    errors.push(message);
  }

  function addTimer(id) { timers.add(id); return id; }
  function clearTimers() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  }

  function assetUrl(src) {
    // Caminho relativo à página. Em `dist/` o HTML e `assets/` são irmãos, e em
    // desenvolvimento também — então o relativo funciona nos dois.
    return src;
  }

  // ---- grafo --------------------------------------------------------------

  function init() {
    if (initialized || destroyed) return;
    initialized = true;
    try {
      context = new AudioContextClass();
    } catch (error) {
      note(`AudioContext indisponível: ${error?.message || error}`);
      context = null;
      return;
    }

    masterGain = context.createGain();
    // Compressor SUAVE: existe só para impedir que a soma de música, ambiente,
    // gotas e efeitos estoure. Não é para achatar a dinâmica.
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 24;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;

    masterGain.connect(compressor);
    compressor.connect(context.destination);

    musicGain = context.createGain();
    ambienceGain = context.createGain();
    dropGain = context.createGain();
    fxGain = context.createGain();
    // Barramento PRÓPRIO para os stingers: a vitória precisa poder tocar com a
    // música da fase suprimida, sem depender do volume dos efeitos comuns.
    stingerBusGain = context.createGain();
    biologicalGain = context.createGain();
    for (const bus of [musicGain, ambienceGain, dropGain, fxGain, stingerBusGain, biologicalGain]) {
      bus.connect(masterGain);
    }

    applyBusVolumes();

    for (let index = 0; index < 2; index++) {
      const element = documentRef.createElement('audio');
      element.preload = 'none';
      element.loop = true;
      element.crossOrigin = 'anonymous';
      const gain = context.createGain();
      gain.gain.value = 0;
      let source = null;
      try {
        source = context.createMediaElementSource(element);
        source.connect(gain);
        gain.connect(musicGain);
      } catch (error) {
        note(`deck de música ${index} falhou: ${error?.message || error}`);
      }
      decks.push({ element, gain, source, trackId: null });
    }

    stingerElement = documentRef.createElement('audio');
    stingerElement.preload = 'none';
    stingerElement.crossOrigin = 'anonymous';
    stingerGain = context.createGain();
    stingerGain.gain.value = 1;
    try {
      const source = context.createMediaElementSource(stingerElement);
      source.connect(stingerGain);
      stingerGain.connect(stingerBusGain);
    } catch (error) {
      note(`deck de stinger falhou: ${error?.message || error}`);
    }

    // PRELOAD AQUI, não no unlock.
    //
    // `fetch` e `decodeAudioData` funcionam com o contexto suspenso — só
    // `source.start()` exige desbloqueio. Carregar no unlock deixava o primeiro
    // salto de CADA fase sem som: a fase nova recria o app, o unlock já
    // aconteceu, e o buffer só começava a ser buscado no primeiro pulo.
    preloadShortFx();

    registerUnlockListeners();
    registerVisibilityListener();
  }

  function applyBusVolumes() {
    if (!context) return;
    const muted = settings.muted ? 0 : 1;
    const ambienteVitoria = victoryActive ? DUCK_LEVELS.victoryAmbience : 1;
    setGain(masterGain, settings.master * muted);
    setGain(musicGain, settings.music * duck * musicSuppression, MUSIC_SUPPRESSION_SECONDS);
    setGain(ambienceGain, settings.ambience * duck * ambienteVitoria);
    setGain(dropGain, settings.drops * duck);
    setGain(fxGain, settings.fx);
    setGain(stingerBusGain, settings.stinger);
    // Tutorial aberto: os processos recuam sem serem destruídos.
    const tutorialAberto = getState?.()?.tutorialOpen === true;
    setGain(
      biologicalGain,
      settings.fx * BIOLOGICAL_BUS_SCALE * (tutorialAberto ? BIOLOGICAL_TUTORIAL_DUCK : 1),
      0.25,
    );
  }

  function setGain(node, value, seconds = 0.08) {
    if (!node || !context) return;
    const target = clamp(value, 0, 4);
    // Não reprograma se o alvo não mudou: evita rampas por quadro.
    if (Math.abs((node.gain.value ?? 0) - target) < 0.0005) return;
    try {
      node.gain.setTargetAtTime(target, context.currentTime, Math.max(0.01, seconds / 3));
    } catch {
      node.gain.value = target;
    }
  }

  // ---- desbloqueio --------------------------------------------------------

  function registerUnlockListeners() {
    const handler = () => unlock();
    for (const type of ['pointerdown', 'touchstart', 'keydown']) {
      windowRef.addEventListener(type, handler, { passive: true });
      listeners.push([windowRef, type, handler]);
    }
  }

  function removeUnlockListeners() {
    for (let index = listeners.length - 1; index >= 0; index--) {
      const [target, type, handler] = listeners[index];
      if (!['pointerdown', 'touchstart', 'keydown'].includes(type)) continue;
      target.removeEventListener(type, handler);
      listeners.splice(index, 1);
    }
  }

  // Desbloqueio REAL: espera o `resume()` resolver e confirma `running` antes de
  // marcar `unlocked`. A versão anterior marcava `unlocked = true` na primeira
  // linha e disparava mídia sem esperar nada — se o navegador recusasse, o jogo
  // ficava "desbloqueado" e mudo, e a única saída era ligar e desligar o botão.
  async function unlock() {
    if (destroyed) return false;
    if (!initialized) init();
    if (!context) {
      note('AudioContext indisponível');
      return false;
    }

    // Já desbloqueado e rodando: nada a fazer, e nada é duplicado.
    if (unlocked && context.state === 'running') return true;

    try {
      if (context.state !== 'running') await context.resume();
      if (context.state !== 'running') {
        note(`AudioContext permaneceu em ${context.state}`);
        return false;
      }

      const primeiraVez = !unlocked;
      unlocked = true;
      removeUnlockListeners();

      await startAmbience();
      await setPhase(currentPhase(), { immediate: true, forcePlayback: true });
      // Idempotente: se o preload do init falhou por rede, tenta de novo aqui.
      preloadShortFx();
      if (primeiraVez) scheduleNextDrop(DROP_SCHEDULE.firstDelaySeconds);
      applyBusVolumes();
      note('Áudio desbloqueado');
      return true;
    } catch (error) {
      unlocked = false;
      lastPlaybackError = `${error?.message || error}`;
      note(`Falha ao desbloquear áudio: ${lastPlaybackError}`);
      return false;
    }
  }

  // Repara uma reprodução que falhou: reconfirma o contexto, garante que os
  // ambientes previstos e a música da fase estão tocando, sem reiniciar nada que
  // já esteja numa posição válida e sem criar um segundo MediaElementSource.
  async function ensureExpectedMediaPlayback() {
    if (destroyed || !context) return false;
    if (context.state !== 'running') {
      try { await context.resume(); } catch (error) {
        note(`resume falhou: ${error?.message || error}`);
        return false;
      }
    }
    if (context.state !== 'running') return false;
    if (!unlocked) return false;

    await startAmbience();
    for (const node of ambienceNodes.values()) {
      if (node.element.paused) play(node.element, node.track.id);
    }
    const deck = decks[activeDeck];
    if (currentMusicId && deck?.element?.paused) {
      play(deck.element, currentMusicId);
    } else if (!currentMusicId) {
      await setPhase(currentPhase(), { immediate: true, forcePlayback: true });
    }
    preloadShortFx();
    applyBusVolumes();
    return true;
  }

  function currentPhase() {
    const campaign = getCampaign?.();
    if (Number.isFinite(campaign?.phase)) return campaign.phase;
    const state = getState?.();
    return Number.isFinite(state?.campaign?.phase) ? state.campaign.phase : 0;
  }

  // ---- mídia --------------------------------------------------------------

  function makeMediaNode(track, destination, gainValue) {
    const element = documentRef.createElement('audio');
    element.src = assetUrl(track.src);
    element.loop = Boolean(track.loop);
    element.preload = track.preload || 'auto';
    element.crossOrigin = 'anonymous';
    const gain = context.createGain();
    gain.gain.value = gainValue;
    try {
      const source = context.createMediaElementSource(element);
      source.connect(gain);
      gain.connect(destination);
    } catch (error) {
      note(`${track.id}: grafo falhou (${error?.message || error})`);
    }
    element.addEventListener('error', () => {
      note(`${track.id}: falha ao carregar ${track.src}`);
    });
    return { element, gain, track };
  }

  // Reprodução com erro VISÍVEL. O `.catch(() => {})` de antes engolia a recusa
  // do navegador: o jogo ficava mudo e o debug não dizia por quê.
  async function safePlay(element, trackId) {
    try {
      const result = element.play?.();
      if (result && typeof result.then === 'function') await result;
      return true;
    } catch (error) {
      lastPlaybackError = `${trackId}: ${error?.message || error}`;
      note(`Falha ao tocar ${lastPlaybackError} (contexto ${context?.state}, mudo ${settings.muted}, unlocked ${unlocked})`);
      return false;
    }
  }

  // Versão sem espera. O erro continua sendo REGISTRADO (nada de
  // `catch(() => {})`), só não bloqueia quem chamou.
  //
  // É a que os caminhos quentes usam: `element.play()` de uma faixa longa em
  // streaming só resolve quando a reprodução realmente começa, e esperar por isso
  // dentro do `unlock()` deixava o desbloqueio pendurado enquanto o navegador
  // carregava 3,7 MB de OGG.
  function play(element, trackId = 'mídia') {
    const resultado = safePlay(element, trackId);
    if (resultado?.catch) resultado.catch(() => {});
    return resultado;
  }

  // ---- ambiente -----------------------------------------------------------

  async function startAmbience() {
    if (!context) return;
    for (const id of AMBIENCE_LAYERS) {
      if (ambienceNodes.has(id)) continue;
      const track = AUDIO_TRACKS[id];
      if (!track) continue;
      const node = makeMediaNode(track, ambienceGain, track.defaultGain);
      ambienceNodes.set(id, node);
      play(node.element, id);
    }
  }

  // O fluxo interno da raiz sobe quando Miguelito está apoiado numa raiz. Só lê
  // `supportPlatform.type`, que a física já mantém — nenhum dado biológico.
  function updateInternalRootFlow(dt) {
    const node = ambienceNodes.get('ambienceInternalRootFlow');
    if (!node) return;
    const state = getState?.();
    const onRoot = state?.player?.supportPlatform?.type === 'root';
    let target = onRoot ? INTERNAL_ROOT_FLOW.onRoot : INTERNAL_ROOT_FLOW.offRoot;
    if (currentPhase() === 9) target = Math.min(INTERNAL_ROOT_FLOW.maximum, target + INTERNAL_ROOT_FLOW.phaseNineBonus);

    const passo = dt / Math.max(0.05, INTERNAL_ROOT_FLOW.rampSeconds);
    internalFlowGainNow += (target - internalFlowGainNow) * clamp(passo, 0, 1);
    setGain(node.gain, internalFlowGainNow, INTERNAL_ROOT_FLOW.rampSeconds);
  }

  // ---- música e crossfade -------------------------------------------------

  async function setPhase(phase, { immediate = false, forcePlayback = false } = {}) {
    if (destroyed) return;
    musicPhase = phase;
    if (!unlocked || !context) return;
    const trackId = musicTrackForPhase(phase);
    // Mesma faixa: NÃO reinicia nem volta ao começo — a menos que o deck esteja
    // parado porque a reprodução foi recusada no primeiro unlock.
    if (trackId === currentMusicId) {
      const deck = decks[activeDeck];
      if (forcePlayback && deck?.element?.paused) play(deck.element, trackId);
      return;
    }
    await crossfadeTo(trackId, immediate ? MUSIC_FIRST_FADE_SECONDS : MUSIC_CROSSFADE_SECONDS);
  }

  async function crossfadeTo(trackId, seconds) {
    const track = AUDIO_TRACKS[trackId];
    if (!track || !decks.length) return;
    const incoming = decks[1 - activeDeck];
    const outgoing = decks[activeDeck];

    if (incoming.trackId !== trackId) {
      incoming.element.src = assetUrl(track.src);
      incoming.element.loop = true;
      incoming.trackId = trackId;
    }
    incoming.element.currentTime = 0;
    setGain(incoming.gain, 0, 0.01);
    // O estado da faixa é assumido AQUI, antes de a mídia terminar de carregar:
    // esperar o `play()` de um streaming longo pendurava o unlock inteiro.
    activeDeck = 1 - activeDeck;
    currentMusicId = trackId;
    crossfadingTo = trackId;
    play(incoming.element, trackId);
    setGain(incoming.gain, track.defaultGain, seconds);

    if (outgoing.trackId) {
      setGain(outgoing.gain, 0, seconds);
      const element = outgoing.element;
      addTimer(setTimeout(() => {
        try { element.pause(); element.currentTime = 0; } catch { /* elemento já descartado */ }
      }, seconds * 1000 + 120));
    }

    addTimer(setTimeout(() => { crossfadingTo = null; }, seconds * 1000 + 60));
  }

  // ---- efeitos ------------------------------------------------------------

  // Carrega os efeitos curtos assim que o contexto está rodando. Sem isso, o
  // PRIMEIRO salto (ou o primeiro dano) só disparava o fetch e saía sem som.
  function preloadShortFx() {
    if (!context) return;
    for (const track of Object.values(AUDIO_TRACKS)) {
      if (track.kind !== 'fx' || track.preload !== 'auto') continue;
      loadFxBuffer(track);
    }
  }

  function loadFxBuffer(track) {
    if (fxBuffers.has(track.id) || fxFailed.has(track.id)) return fxLoadPromises.get(track.id) || null;
    // Uma promessa por arquivo: nada de fetch duplicado.
    if (fxLoadPromises.has(track.id)) return fxLoadPromises.get(track.id);
    const promise = windowRef.fetch(assetUrl(track.src))
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(data => context.decodeAudioData(data))
      .then(buffer => { fxBuffers.set(track.id, buffer); fxPending.delete(track.id); })
      .catch(error => {
        // Um arquivo que falha não pode derrubar o jogo — e não é buscado de novo.
        fxPending.delete(track.id);
        fxFailed.add(track.id);
        lastPlaybackError = `${track.id}: ${error?.message || error}`;
        note(lastPlaybackError);
      });
    fxPending.set(track.id, promise);
    fxLoadPromises.set(track.id, promise);
    return promise;
  }

  // Pacote 04: carrega um grupo inteiro (rhizobium, micorriza, fósforo…) fora do
  // caminho crítico. `loadFxBuffer` já é idempotente e guarda uma promessa por
  // arquivo, então chamar de novo para um grupo já carregado não busca nada.
  function preloadBiologicalGroup(groupId) {
    const ids = BIOLOGICAL_AUDIO_GROUPS[groupId];
    if (!ids || !context) return [];
    const promises = [];
    for (const id of ids) {
      const track = AUDIO_TRACKS[id];
      if (!track) continue;
      const promise = loadFxBuffer(track);
      if (promise) promises.push(promise);
    }
    return promises;
  }

  // Ponte para o gerenciador de loops biológicos. Ele NÃO cria contexto nem
  // decodifica por conta própria: usa este contexto, este cache de buffers e um
  // barramento dedicado.
  function getAudioBridge() {
    return {
      get context() { return context; },
      get destination() { return biologicalGain; },
      isReady: () => Boolean(context)
        && unlocked
        && !settings.muted
        && !destroyed
        && context.state === 'running',
      isMuted: () => settings.muted,
      getBuffer: id => fxBuffers.get(id) || null,
      hasFailed: id => fxFailed.has(id),
      loadBuffer: id => {
        const track = AUDIO_TRACKS[id];
        if (!track || !context) return null;
        if (fxBuffers.has(id)) return Promise.resolve(fxBuffers.get(id));
        return loadFxBuffer(track);
      },
      preloadGroup: preloadBiologicalGroup,
      clearQueuedFx,
      playFx,
      now: () => context?.currentTime ?? 0,
      note,
      bufferStats: () => ({
        loaded: fxBuffers.size,
        pending: fxPending.size,
        failed: fxFailed.size,
        queuedFx: queuedFx.size,
      }),
      groupState: (groupId) => {
        const ids = BIOLOGICAL_AUDIO_GROUPS[groupId] || [];
        if (!ids.length) return 'desconhecido';
        if (ids.every(id => fxBuffers.has(id))) return 'pronto';
        if (ids.some(id => fxFailed.has(id))) return 'falhou';
        if (ids.some(id => fxPending.has(id))) return 'carregando';
        return 'ausente';
      },
    };
  }

  function playFx(id, { gain = 1, rate = 1, pan = 0, bus = null, instanceId = null } = {}) {
    if (destroyed || !unlocked || !context || settings.muted) return FX_SUPPRESSED;
    const track = AUDIO_TRACKS[id];
    if (!track) { note(`FX desconhecido: ${id}`); return FX_REJECTED; }
    if (track.kind === 'stinger') {
      return playStinger(id, { gain }) ? FX_PLAYED : FX_REJECTED;
    }
    // Arquivo que já falhou de vez: não adianta enfileirar.
    if (fxFailed.has(id)) return FX_REJECTED;

    const buffer = fxBuffers.get(id);
    if (buffer) return emitBuffer(id, { gain, rate, pan, bus }) ? FX_PLAYED : FX_REJECTED;

    const promise = loadFxBuffer(track);
    if (!promise?.then) return FX_REJECTED;

    if (fxDeliveryClass(id) === 'critical') {
      return queueCriticalFx(id, { gain, rate, pan, bus, instanceId }, promise);
    }

    // TRANSITÓRIO: aguarda a promessa QUE JÁ EXISTE (nunca dispara um segundo
    // fetch) por uma janela curta. Passando disso o som chegaria depois do
    // movimento — pior que silêncio.
    const pedidoEm = Date.now();
    const limite = new Promise(resolve => addTimer(setTimeout(() => resolve('tempo'), FX_MAXIMUM_DELAY_MS)));
    Promise.race([promise, limite]).then(quem => {
      const atrasado = quem === 'tempo' || Date.now() - pedidoEm > FX_MAXIMUM_DELAY_MS;
      if (atrasado || !fxBuffers.has(id)) {
        note(`${id}: buffer chegou tarde demais, som descartado`);
        return;
      }
      emitBuffer(id, { gain, rate, pan, bus });
    });
    return FX_QUEUED;
  }

  // Fila confiável dos efeitos críticos.
  //
  // Uma entrada por trackId+instanceId: o mesmo evento pedido em vários quadros
  // (é o padrão — os sistemas rodam a 60 Hz) não pode virar cinco reproduções
  // quando o arquivo finalmente chegar.
  function queueCriticalFx(id, options, promise) {
    const chave = `${id}:${options.instanceId ?? '-'}`;
    if (queuedFx.has(chave)) return FX_QUEUED;

    const entrada = { id, options, requestedAt: Date.now(), cancelled: false };
    queuedFx.set(chave, entrada);
    promise.then(() => {
      if (entrada.cancelled || queuedFx.get(chave) !== entrada) return;
      queuedFx.delete(chave);
      const atraso = Date.now() - entrada.requestedAt;
      if (atraso > CRITICAL_FX_QUEUE_SECONDS * 1000) {
        note(`${id}: evento crítico esperou ${Math.round(atraso)} ms e foi descartado`);
        return;
      }
      if (!fxBuffers.has(id)) { note(`${id}: buffer nunca chegou`); return; }
      emitBuffer(id, options);
    });
    // Rede de segurança: se a promessa nunca resolver, a entrada não pode ficar
    // presa bloqueando o mesmo evento para sempre.
    addTimer(setTimeout(() => {
      if (queuedFx.get(chave) === entrada) queuedFx.delete(chave);
    }, CRITICAL_FX_QUEUE_SECONDS * 1000 + 250));
    return FX_QUEUED;
  }

  // Troca de fase, reset, morte com reinício do processo: nenhum evento da fase
  // anterior pode tocar depois que ela acabou.
  function clearQueuedFx() {
    for (const entrada of queuedFx.values()) entrada.cancelled = true;
    queuedFx.clear();
  }

  function emitBuffer(id, { gain = 1, rate = 1, pan = 0, bus = null } = {}) {
    const track = AUDIO_TRACKS[id];
    const buffer = fxBuffers.get(id);
    if (!track || !buffer || !context || settings.muted) return false;

    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = clamp(rate, 0.5, 2);
      const nodeGain = context.createGain();
      nodeGain.gain.value = clamp(track.defaultGain * gain, 0, 2);
      let tail = nodeGain;
      if (pan && typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner();
        panner.pan.value = clamp(pan, -1, 1);
        nodeGain.connect(panner);
        tail = panner;
      }
      source.connect(nodeGain);
      // Efeito biológico vai pelo barramento dos processos; o resto pelo de FX.
      tail.connect((bus === 'biological' && biologicalGain) ? biologicalGain : fxGain);
      source.onended = () => { try { source.disconnect(); tail.disconnect(); } catch { /* já desconectado */ } };
      source.start();
      lastFxId = id;
      return true;
    } catch (error) {
      note(`${id}: ${error?.message || error}`);
      return false;
    }
  }

  // Stingers longos rodam como mídia. Um por vez: o curto de vitória de fase e o
  // longo de fim de campanha nunca tocam juntos.
  //
  // `onEnded` é o que permite a vitória tocar INTEIRA: quem decide o momento da
  // troca de fase é o evento `ended` do elemento, não um cronômetro fixo que
  // cortava o arquivo de 10,24 s aos 7,5 s.
  function playStinger(id, { gain = 1, onEnded = null } = {}) {
    if (destroyed || !unlocked || !context || settings.muted || !stingerElement) return false;
    const track = AUDIO_TRACKS[id];
    if (!track) { note(`stinger desconhecido: ${id}`); return false; }
    try {
      stingerElement.pause();
      // Um listener por reprodução: sem remover o anterior, um stinger antigo
      // dispararia o callback do novo.
      if (stingerEndedHandler) {
        stingerElement.removeEventListener('ended', stingerEndedHandler);
        stingerEndedHandler = null;
      }
      stingerEndedHandler = () => {
        stingerEndedHandler = null;
        if (stingerId === id) stingerId = null;
        if (typeof onEnded === 'function') onEnded(id);
      };
      stingerElement.addEventListener('ended', stingerEndedHandler, { once: true });

      stingerElement.src = assetUrl(track.src);
      stingerElement.currentTime = 0;
      setGain(stingerGain, clamp(track.defaultGain * gain, 0, 2), 0.05);
      play(stingerElement, id);
      stingerId = id;
      lastFxId = id;
      return true;
    } catch (error) {
      note(`${id}: ${error?.message || error}`);
      return false;
    }
  }

  // Vitória de fase: a música da fase some por fade, o ambiente fica discreto e
  // as gotas param. O stinger toca no barramento próprio, sem competir.
  //
  // `onEnded` é repassado ao stinger: quem decide o momento da troca de fase é o
  // fim real do arquivo, não um cronômetro.
  function beginPhaseVictory({ campaign = false, onEnded = null } = {}) {
    if (destroyed) return false;
    if (campaign) {
      if (campaignVictoryPlaying) return false;
      campaignVictoryPlaying = true;
    } else {
      if (phaseVictoryPlaying) return false;
      phaseVictoryPlaying = true;
      lastVictoryPhase = currentPhase();
    }
    victoryActive = true;
    musicSuppressionTarget = 0;
    applyBusVolumes();

    const iniciou = playStinger(campaign ? 'campaignVictory' : 'phaseVictory', {
      gain: 1,
      onEnded,
    });
    if (!iniciou) {
      // Sem áudio (mudo, arquivo ausente, contexto indisponível): desfaz as
      // marcas para o jogo não ficar preso esperando um `ended` que não vem.
      victoryActive = false;
      if (campaign) campaignVictoryPlaying = false;
      else phaseVictoryPlaying = false;
      musicSuppressionTarget = 1;
      applyBusVolumes();
    }
    return iniciou;
  }

  // Próxima fase: o stinger sai por fade, o ambiente volta e a música nova entra.
  // As gotas só voltam depois de alguns segundos, para não caírem em cima do
  // crossfade.
  function endPhaseVictory() {
    if (destroyed) return;
    stopStinger(STINGER_FADE_SECONDS);
    victoryActive = false;
    phaseVictoryPlaying = false;
    musicSuppressionTarget = 1;
    dropActive = false;
    currentDropId = null;
    scheduleNextDrop(DROP_SCHEDULE.firstDelaySeconds);
    applyBusVolumes();
  }

  function stopStinger(seconds = 0.4) {
    if (!stingerElement || !stingerId) return;
    // Interrupção explícita (reset, nova campanha, morte): o callback de `ended`
    // não deve disparar como se a faixa tivesse terminado sozinha.
    if (stingerEndedHandler) {
      stingerElement.removeEventListener('ended', stingerEndedHandler);
      stingerEndedHandler = null;
    }
    setGain(stingerGain, 0, seconds);
    const element = stingerElement;
    addTimer(setTimeout(() => {
      try { element.pause(); element.currentTime = 0; } catch { /* já parado */ }
    }, seconds * 1000 + 80));
    stingerId = null;
  }

  // ---- gotas --------------------------------------------------------------

  function scheduleNextDrop(seconds = null) {
    const janela = DROP_SCHEDULE;
    nextDropIn = Number.isFinite(seconds)
      ? seconds
      : janela.minimumSeconds + random() * (janela.maximumSeconds - janela.minimumSeconds);
  }

  function dropAllowed() {
    if (!unlocked || settings.muted || destroyed || !context) return false;
    if (documentRef.hidden) return false;
    if (victoryActive) return false;
    const state = getState?.();
    const gameState = state?.gameState;
    return gameState !== 'end' && gameState !== 'respawning';
  }

  function playDrop() {
    // Uma gota por vez, e nunca a mesma duas vezes seguidas.
    const disponiveis = DROP_TRACK_IDS.filter(id => id !== lastDropId && !fxFailed.has(id));
    const pool = disponiveis.length ? disponiveis : DROP_TRACK_IDS;
    const id = pool[Math.min(pool.length - 1, Math.floor(clamp(random(), 0, 0.999) * pool.length))];
    const track = AUDIO_TRACKS[id];
    if (!track) return;

    let node = dropNodes.get(id);
    if (!node) {
      node = makeMediaNode(track, dropGain, track.defaultGain);
      node.element.loop = false;
      node.element.addEventListener('ended', () => {
        if (currentDropId === id) { currentDropId = null; dropActive = false; scheduleNextDrop(); }
      });
      if (typeof context.createStereoPanner === 'function') {
        node.panner = context.createStereoPanner();
        try {
          node.gain.disconnect();
          node.gain.connect(node.panner);
          node.panner.connect(dropGain);
        } catch (error) {
          note(`${id}: panner falhou (${error?.message || error})`);
        }
      }
      dropNodes.set(id, node);
    }

    const janela = DROP_SCHEDULE;
    node.gain.gain.value = clamp(
      janela.gainMinimum + random() * (janela.gainMaximum - janela.gainMinimum),
      0, 2,
    );
    if (node.panner) {
      node.panner.pan.value = janela.panMinimum + random() * (janela.panMaximum - janela.panMinimum);
    }
    node.element.playbackRate = janela.rateMinimum + random() * (janela.rateMaximum - janela.rateMinimum);
    try { node.element.currentTime = 0; } catch { /* mídia ainda carregando */ }
    play(node.element);

    currentDropId = id;
    lastDropId = id;
    dropActive = true;
    // Rede de segurança: se o `ended` não vier (mídia que falhou), destrava.
    addTimer(setTimeout(() => {
      if (currentDropId === id) { currentDropId = null; dropActive = false; scheduleNextDrop(); }
    }, 12000));
  }

  function updateDrops(dt) {
    if (!dropAllowed()) return;
    if (dropActive) return;
    nextDropIn -= dt;
    if (nextDropIn > 0) return;
    playDrop();
  }

  // ---- mixagem por estado do jogo ----------------------------------------

  function updateDuck(dt) {
    const state = getState?.();
    const gameState = state?.gameState;
    if (state?.tutorialOpen === true) duckTarget = DUCK_LEVELS.tutorial;
    else if (gameState === 'respawning') duckTarget = DUCK_LEVELS.respawning;
    else if (gameState === 'end') duckTarget = DUCK_LEVELS.end;
    else duckTarget = 1;

    const passo = clamp(dt / 0.4, 0, 1);
    const anterior = duck;
    duck += (duckTarget - duck) * passo;
    if (Math.abs(duck - anterior) > 0.002) applyBusVolumes();
  }

  function update(dt) {
    if (destroyed || !unlocked || !context) return;
    const passo = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    if (Math.abs(musicSuppression - musicSuppressionTarget) > 0.002) {
      const avanco = clamp(passo / MUSIC_SUPPRESSION_SECONDS, 0, 1);
      musicSuppression += (musicSuppressionTarget - musicSuppression) * avanco;
      applyBusVolumes();
    }
    updateDuck(passo);
    updateInternalRootFlow(passo);
    updateDrops(passo);
  }

  // ---- mute e persistência ------------------------------------------------

  function persist() {
    writeStoredSettings(windowRef, { ...settings });
  }

  async function setMuted(value) {
    settings.muted = Boolean(value);
    applyBusVolumes();
    persist();
    if (settings.muted) {
      stopStinger(0.2);
      return settings.muted;
    }
    // Desmutar precisa REPARAR: se o primeiro unlock falhou, a música e os
    // ambientes estão parados e só subir o ganho não traria som nenhum.
    await ensureExpectedMediaPlayback();
    return settings.muted;
  }

  async function toggleMute() {
    await setMuted(!settings.muted);
    return settings.muted;
  }

  // Estado para a interface distinguir bloqueado, ligado, mudo e indisponível.
  function getUiState() {
    return {
      available: Boolean(context),
      unlocked,
      muted: settings.muted,
      audible: Boolean(context) && unlocked && !settings.muted && context.state === 'running',
    };
  }

  // ---- visibilidade -------------------------------------------------------

  function registerVisibilityListener() {
    const handler = () => {
      if (!unlocked || !context) return;
      if (documentRef.hidden) {
        setGain(masterGain, 0, 0.15);
        addTimer(setTimeout(() => {
          if (documentRef.hidden) suspend();
        }, 220));
      } else {
        // Voltar não garante que o `resume()` foi aceito: repara a reprodução.
        const promessa = resume();
        if (promessa?.then) promessa.then(() => ensureExpectedMediaPlayback());
        else ensureExpectedMediaPlayback();
      }
    };
    documentRef.addEventListener('visibilitychange', handler);
    listeners.push([documentRef, 'visibilitychange', handler]);
  }

  function suspend() {
    if (!context) return;
    try {
      const promise = context.suspend?.();
      if (promise?.catch) promise.catch(() => {});
    } catch { /* contexto já suspenso */ }
  }

  async function resume() {
    if (!context || !unlocked) return false;
    try {
      if (context.state !== 'running') await context.resume?.();
    } catch (error) {
      note(`resume falhou: ${error?.message || error}`);
      return false;
    }
    applyBusVolumes();
    return context.state === 'running';
  }

  // ---- destruição ---------------------------------------------------------

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearQueuedFx();
    victoryActive = false;
    phaseVictoryPlaying = false;
    campaignVictoryPlaying = false;
    clearTimers();
    for (const [target, type, handler] of listeners) target.removeEventListener(type, handler);
    listeners.length = 0;
    for (const node of ambienceNodes.values()) {
      try { node.element.pause(); node.element.src = ''; } catch { /* já descartado */ }
    }
    ambienceNodes.clear();
    for (const node of dropNodes.values()) {
      try { node.element.pause(); node.element.src = ''; } catch { /* já descartado */ }
    }
    dropNodes.clear();
    for (const deck of decks) {
      try { deck.element.pause(); deck.element.src = ''; } catch { /* já descartado */ }
    }
    try { stingerElement?.pause(); } catch { /* já parado */ }
    try { context?.close?.(); } catch { /* já fechado */ }
    context = null;
  }

  // ---- compatibilidade ----------------------------------------------------

  // Mantido só para chamadas antigas não quebrarem. NÃO produz som: a trilha
  // sintetizada do protótipo brigaria com as músicas reais.
  function toneNow() {}

  function debugSnapshot() {
    const camadaCaverna = ambienceNodes.get('ambienceCaveBase');
    const deck = decks[activeDeck];
    return {
      available: Boolean(context),
      initialized,
      unlocked,
      contextState: context?.state || 'closed',
      muted: settings.muted,
      audible: getUiState().audible,
      musicTrackId: currentMusicId,
      currentMusic: currentMusicId,
      musicElementPaused: deck?.element ? Boolean(deck.element.paused) : null,
      musicSuppression,
      crossfadingTo,
      musicPhase,
      activeStinger: stingerId,
      ambienceLayers: [...ambienceNodes.keys()],
      ambiencePlaying: [...ambienceNodes.entries()]
        .filter(([, node]) => !node.element.paused)
        .map(([id]) => id),
      ambienceBus: settings.ambience,
      caveBaseEffectiveGain: camadaCaverna
        ? settings.ambience * AMBIENCE_LAYER_GAINS.caveBase
        : 0,
      internalRootFlow: internalFlowGainNow,
      dropBus: settings.drops,
      currentDrop: currentDropId,
      nextDropIn: dropActive ? null : Math.max(0, nextDropIn),
      fxLoaded: [...fxBuffers.keys()],
      lastFx: lastFxId,
      lastPlaybackError,
      stinger: stingerId,
      storageVersion: settings.version,
      errors: [...errors],
    };
  }

  return {
    init,
    unlock,
    update,
    setPhase,
    playFx,
    playStinger,
    preloadBiologicalGroup,
    clearQueuedFx,
    getAudioBridge,
    stopStinger,
    toggleMute,
    setMuted,
    isMuted: () => settings.muted,
    isUnlocked: () => unlocked,
    getUiState,
    beginPhaseVictory,
    endPhaseVictory,
    ensureExpectedMediaPlayback,
    suspend,
    resume,
    destroy,
    toneNow,
    debugSnapshot,
    // Cooldown do salto: defesa contra repeat de teclado disparando o mesmo FX.
    canPlayJump(now) {
      if (now - lastJumpAt < 0.05) return false;
      lastJumpAt = now;
      return true;
    },
  };
}
