// Áudio dos processos biológicos benéficos (Pacote 04)
// ====================================================
//
// Os módulos biológicos não falam com o Web Audio: eles falam com esta fachada,
// que chega até eles por `entities.audio`. Nos testes Node entra
// `createNoopBiologicalAudio()`, então nenhum módulo precisa checar `window`,
// `document` ou `AudioContext`.
//
// NÃO existe um segundo AudioContext. Tudo aqui usa o contexto, o cache de
// buffers e o barramento que `game-audio.js` expõe por `getAudioBridge()`.
//
// Dois conceitos separados, que valem a leitura antes de mexer:
//
//   `instanceKey`  identifica UM processo de UM objeto — `mycorrhiza-bridge:myco-3`.
//                  É por isso que duas pontes crescendo ao mesmo tempo soam como
//                  duas pontes, e não como uma que reinicia.
//   `group`        é o prefixo da chave (`mycorrhiza-bridge`) e serve para os
//                  tetos de vozes e para a prioridade. É mais fino que o grupo
//                  de preload do manifesto (que é por organismo).
//
// CONTRATO DE VIDA DE UM LOOP: quem inicia mantém. Um loop continua tocando
// enquanto o sistema dono chamar `startLoop`/`updateLoop` para aquela chave;
// parou de chamar, o loop é recolhido por fade em `STALE_SECONDS`. Isso é
// deliberado — a alternativa (cada sistema lembrar de chamar `stopLoop` em todos
// os caminhos de saída, inclusive morte, troca de fase e objeto removido por
// outro sistema) é exatamente o tipo de coisa que deixa som preso. Os sistemas
// ainda chamam `stopLoop` nas conclusões, porque ali o fade precisa ser imediato
// e casar com o efeito de conclusão.

import { W } from '../core/constants.js';
import { fxLanded } from '../game-audio.js';
import {
  AUDIO_TRACKS,
  BIOLOGICAL_AUDIO_GROUPS,
  BIOLOGICAL_COOLDOWNS,
  BIOLOGICAL_FADES,
  BIOLOGICAL_LOOP_LIMIT,
  BIOLOGICAL_LOOP_LIMITS,
  BIOLOGICAL_LOOP_PRIORITY,
  BIOLOGICAL_SPATIAL,
} from '../audio-manifest.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Um loop que ninguém tocou por este tempo é considerado órfão e sai por fade.
const STALE_SECONDS = 0.6;
// Tolerancia depois de fechar um cartao de tutorial, para os sistemas voltarem
// a sustentar as chaves antes de qualquer expiracao.
const TUTORIAL_GRACE_SECONDS = 0.8;
const MAXIMUM_EVENTS = 10;

// Mesmos estados de `game-audio.js`. Repetidos aqui (e nao importados) porque a
// fachada precisa responder identico mesmo quando nao existe controlador.
const BIO_SUPPRESSED = Object.freeze({ accepted: false, state: 'suppressed' });
const BIO_REJECTED = Object.freeze({ accepted: false, state: 'rejected' });

export function createNoopBiologicalAudio() {
  return {
    // Sem audio: o evento nao foi recusado, so nao ha som. Quem chama marca a
    // transicao e segue — e por isso que os testes Node nao repetem eventos.
    play() { return BIO_SUPPRESSED; },
    startLoop() { return false; },
    updateLoop() { return false; },
    pauseLoop() { return false; },
    resumeLoop() { return false; },
    stopLoop() { return false; },
    stopGroup() { return false; },
    stopAll() { return false; },
    update() {},
    reset() {},
    preloadGroup() { return false; },
    debugSnapshot() {
      return {
        available: false,
        registeredLoopCount: 0,
        activeLoopCount: 0,
        pausedLoopCount: 0,
        releasedLoopCount: 0,
        pendingLoopCount: 0,
        queuedFxCount: 0,
        failedBufferCount: 0,
        maximumLoopCount: BIOLOGICAL_LOOP_LIMIT,
        loops: [],
        preloadGroups: {},
        lastEffect: null,
        lastRejectedEffect: null,
        lastRejectionReason: null,
        events: [],
        blockedByCooldown: 0,
        rejectedByDistance: 0,
        buffersLoaded: 0,
        buffersPending: 0,
      };
    },
  };
}

export function groupFromInstanceKey(instanceKey) {
  const text = String(instanceKey || '');
  const separator = text.indexOf(':');
  return separator > 0 ? text.slice(0, separator) : text;
}

export function createBiologicalAudio({ gameAudio = null, getState = () => null } = {}) {
  const bridge = gameAudio?.getAudioBridge?.();
  if (!bridge) return createNoopBiologicalAudio();

  const loops = new Map();
  const instanceCooldowns = new Map();
  const globalCooldowns = new Map();
  const events = [];

  // Relógio próprio, avançado por `update(dt)`. Não é `state.time`: os cooldowns
  // precisam correr mesmo com o jogo em 'end' ou com um cartão aberto, senão o
  // primeiro quadro depois da pausa dispararia tudo de uma vez.
  let clock = 0;
  let blockedByCooldown = 0;
  let rejectedByDistance = 0;
  let lastEffect = null;
  let lastRejection = null;
  // Ate quando a expiracao por orfandade fica suspensa (ver `update`).
  let tutorialGraceUntil = 0;

  function note(kind, key, detail = '') {
    events.push({ at: Math.round(clock * 100) / 100, kind, key, detail });
    if (events.length > MAXIMUM_EVENTS) events.shift();
  }

  function context() { return bridge.context; }

  // ---- espacialização -----------------------------------------------------

  // Um som sem `x` é da interface (a carga do fósforo é do jogador, não do
  // mundo): fica centrado e sem atenuação.
  function spatialFor(options) {
    const x = options?.x;
    if (!Number.isFinite(x)) return { spatial: false, distanceGain: 1, pan: 0, distance: 0 };

    const state = getState?.();
    const player = state?.player;
    if (!player) return { spatial: false, distanceGain: 1, pan: 0, distance: 0 };

    const playerCenterX = player.x + player.w / 2;
    const distance = Math.abs(x - playerCenterX);
    const audibleRange = Number.isFinite(options.range) && options.range > 0
      ? options.range
      : BIOLOGICAL_SPATIAL.defaultRange;
    const normalized = clamp(1 - distance / audibleRange, 0, 1);
    // Expoente configuravel (1,4). Quadratico apagava os processos discretos bem
    // antes da borda da tela — ver o comentario em BIOLOGICAL_SPATIAL.
    const distanceGain = Math.pow(normalized, BIOLOGICAL_SPATIAL.attenuationExponent);

    const screenCenterX = (state.cameraX || 0) + W / 2;
    const pan = clamp(
      (x - screenCenterX) / (W * BIOLOGICAL_SPATIAL.panWidthFactor),
      -BIOLOGICAL_SPATIAL.panLimit,
      BIOLOGICAL_SPATIAL.panLimit,
    );
    return { spatial: true, distanceGain, pan, distance };
  }

  function trackGain(trackId) {
    return AUDIO_TRACKS[trackId]?.defaultGain ?? 0;
  }

  // ---- cooldowns ----------------------------------------------------------

  function cooldownBlocked(trackId, instanceId) {
    const rule = BIOLOGICAL_COOLDOWNS[trackId];
    if (!rule) return false;
    if (rule.global > 0) {
      const last = globalCooldowns.get(trackId);
      if (last !== undefined && clock - last < rule.global) return true;
    }
    if (rule.perInstance > 0 && instanceId !== undefined && instanceId !== null) {
      const last = instanceCooldowns.get(`${trackId}:${instanceId}`);
      if (last !== undefined && clock - last < rule.perInstance) return true;
    }
    return false;
  }

  function markCooldown(trackId, instanceId) {
    const rule = BIOLOGICAL_COOLDOWNS[trackId];
    if (!rule) return;
    if (rule.global > 0) globalCooldowns.set(trackId, clock);
    if (rule.perInstance > 0 && instanceId !== undefined && instanceId !== null) {
      instanceCooldowns.set(`${trackId}:${instanceId}`, clock);
    }
  }

  // ---- efeitos pontuais ---------------------------------------------------

  function play(trackId, options = {}) {
    const track = AUDIO_TRACKS[trackId];
    if (!track || track.kind === 'loop') {
      lastRejection = { trackId, reason: track ? 'faixa em loop nao e efeito pontual' : 'faixa inexistente' };
      return BIO_REJECTED;
    }
    // Cooldown e distancia NAO sao recusa: o evento biologico aconteceu, so nao
    // vira som. Quem chama deve marcar a transicao, senao tentaria de novo a
    // cada quadro e o evento voltaria assim que o cooldown expirasse.
    if (cooldownBlocked(trackId, options.instanceId)) {
      blockedByCooldown++;
      lastRejection = { trackId, reason: 'cooldown' };
      return BIO_SUPPRESSED;
    }

    const space = spatialFor(options);
    if (space.spatial && space.distanceGain * track.defaultGain < BIOLOGICAL_SPATIAL.minimumAudibleGain) {
      rejectedByDistance++;
      lastRejection = { trackId, reason: 'fora de alcance' };
      return BIO_SUPPRESSED;
    }

    // Lazy-load defensivo: se o grupo não foi pré-carregado, `playFx` já aguarda
    // a promessa por uma janela curta e descarta o que chegar tarde.
    const gain = clamp((options.gain ?? 1) * space.distanceGain, 0, 2);
    const resultado = gameAudio.playFx(trackId, {
      gain,
      rate: options.rate ?? 1,
      pan: space.spatial ? space.pan : 0,
      bus: 'biological',
      // Deduplica a fila critica: o mesmo evento do mesmo objeto pedido em
      // varios quadros gera UMA pendencia, nao uma por quadro.
      instanceId: options.instanceId ?? null,
    });
    if (!fxLanded(resultado)) {
      lastRejection = { trackId, reason: resultado?.state || 'recusado' };
      note('fx-recusado', trackId, lastRejection.reason);
      return resultado;
    }
    markCooldown(trackId, options.instanceId);
    lastEffect = trackId;
    note('fx', trackId, `${resultado.state}${space.spatial ? ` pan ${space.pan.toFixed(2)}` : ' centrado'}`);
    return resultado;
  }

  // ---- vozes de loop ------------------------------------------------------

  function voiceTargets(voice) {
    const space = spatialFor(voice.options);
    const base = trackGain(voice.trackId);
    voice.targetPan = space.spatial ? space.pan : 0;
    voice.distance = space.distance;
    voice.spatial = space.spatial;
    voice.targetGain = clamp(base * (voice.options.gain ?? 1) * space.distanceGain, 0, 2);
    voice.targetRate = clamp(voice.options.rate ?? 1, 0.5, 2);
    return voice;
  }

  function audible(voice) {
    return !voice.paused && voice.targetGain >= BIOLOGICAL_SPATIAL.minimumAudibleGain;
  }

  // O TETO conta apenas quem realmente ocupa uma voz: fonte tocando, ou prestes
  // a receber uma. Loop pausado, fora de alcance, solto por distancia ou apenas
  // preservado durante um tutorial NAO podem bloquear um processo audivel — era
  // exatamente isso que fazia um processo novo, perto do jogador, nao soar
  // porque oito processos silenciosos do outro lado da fase seguravam as vagas.
  function occupiesVoice(voice) {
    if (voice.cancelled) return false;
    if (voice.paused) return false;
    if (voice.released) return false;
    if (voice.pending) return audible(voice);
    return Boolean(voice.source) && audible(voice);
  }

  function activeVoices() {
    return [...loops.values()].filter(occupiesVoice);
  }

  function applyGain(voice, value, seconds) {
    if (!voice.gainNode || !context()) return;
    const target = clamp(value, 0, 2);
    try {
      voice.gainNode.gain.setTargetAtTime(
        target,
        context().currentTime,
        Math.max(0.01, seconds / 3),
      );
    } catch {
      voice.gainNode.gain.value = target;
    }
  }

  function attachSource(voice) {
    const audioContext = context();
    const buffer = bridge.getBuffer(voice.trackId);
    if (!audioContext || !buffer || voice.source) return false;

    try {
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = voice.targetRate;

      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0;
      let tail = gainNode;
      let panNode = null;
      if (typeof audioContext.createStereoPanner === 'function') {
        panNode = audioContext.createStereoPanner();
        panNode.pan.value = voice.targetPan;
        gainNode.connect(panNode);
        tail = panNode;
      }
      source.connect(gainNode);
      tail.connect(bridge.destination);
      source.start();

      voice.source = source;
      voice.gainNode = gainNode;
      voice.panNode = panNode;
      voice.pending = false;
      voice.released = false;
      voice.startedAt = clock;
      applyGain(voice, voice.paused ? 0 : voice.targetGain, BIOLOGICAL_FADES.start);
      note('loop-start', voice.instanceKey, voice.trackId);
      return true;
    } catch (error) {
      bridge.note?.(`${voice.trackId}: loop falhou (${error?.message || error})`);
      return false;
    }
  }

  // Solta o source mantendo a voz viva. Usado quando o processo continua, mas
  // saiu do alcance: o loop volta sozinho se a câmera voltar.
  function releaseSource(voice, fade = BIOLOGICAL_FADES.stop) {
    if (!voice.source) return;
    const audioContext = context();
    applyGain(voice, 0, fade);
    try {
      voice.source.stop((audioContext?.currentTime ?? 0) + fade + 0.05);
    } catch { /* já parado */ }
    voice.source = null;
    voice.gainNode = null;
    voice.panNode = null;
    voice.released = true;
  }

  function priorityOf(voice) {
    return BIOLOGICAL_LOOP_PRIORITY[voice.group] ?? Number(voice.options.priority) ?? 0;
  }

  // Pior voz = menor prioridade e, em empate, a mais distante. Protegida nunca
  // sai (a carga do fósforo com a tecla realmente pressionada).
  function worstVoice(candidates) {
    let worst = null;
    for (const voice of candidates) {
      if (voice.protectedVoice) continue;
      if (!worst) { worst = voice; continue; }
      const here = priorityOf(voice);
      const there = priorityOf(worst);
      if (here < there || (here === there && voice.distance > worst.distance)) worst = voice;
    }
    return worst;
  }

  // Devolve false quando não há espaço nem depois de despejar — o novo loop
  // simplesmente não começa, em vez de virar cacofonia.
  function makeRoomFor(group, priority) {
    const groupLimit = BIOLOGICAL_LOOP_LIMITS[group];
    if (Number.isFinite(groupLimit)) {
      const sameGroup = activeVoices().filter(voice => voice.group === group);
      while (sameGroup.length >= groupLimit) {
        const victim = worstVoice(sameGroup);
        if (!victim || priorityOf(victim) > priority) return false;
        stopLoop(victim.instanceKey, { fade: BIOLOGICAL_FADES.stop });
        sameGroup.splice(sameGroup.indexOf(victim), 1);
      }
    }

    let live = activeVoices();
    while (live.length >= BIOLOGICAL_LOOP_LIMIT) {
      const victim = worstVoice(live);
      if (!victim || priorityOf(victim) > priority) return false;
      stopLoop(victim.instanceKey, { fade: BIOLOGICAL_FADES.stop });
      live = live.filter(voice => voice !== victim);
    }
    return true;
  }

  function startLoop(instanceKey, trackId, options = {}) {
    if (!instanceKey || !context()) return false;
    const track = AUDIO_TRACKS[trackId];
    if (!track || track.kind !== 'loop') return false;

    const existing = loops.get(instanceKey);
    if (existing && existing.trackId === trackId) {
      // Idempotente: mesma chave, mesma faixa — só atualiza. Nunca um segundo
      // source, nunca um segundo fetch.
      if (existing.paused) resumeLoop(instanceKey);
      return updateLoop(instanceKey, options);
    }
    if (existing) {
      // Mesma chave, faixa diferente: a anterior sai por fade e a nova entra.
      stopLoop(instanceKey, { fade: BIOLOGICAL_FADES.stop });
    }

    const group = options.group || groupFromInstanceKey(instanceKey);
    const voice = {
      instanceKey,
      trackId,
      group,
      source: null,
      gainNode: null,
      panNode: null,
      startedAt: clock,
      targetGain: 0,
      targetPan: 0,
      targetRate: 1,
      distance: 0,
      spatial: false,
      priority: BIOLOGICAL_LOOP_PRIORITY[group] ?? Number(options.priority) ?? 0,
      paused: false,
      pending: false,
      released: false,
      cancelled: false,
      protectedVoice: Boolean(options.protect),
      inaudibleSince: null,
      lastTouchedAt: clock,
      options: { ...options },
    };
    voiceTargets(voice);

    // Fora de alcance não inicia.
    if (voice.spatial && voice.targetGain < BIOLOGICAL_SPATIAL.minimumAudibleGain) {
      rejectedByDistance++;
      return false;
    }
    if (!makeRoomFor(group, priorityOf(voice))) return false;

    loops.set(instanceKey, voice);

    if (bridge.getBuffer(trackId)) {
      attachSource(voice);
      return true;
    }
    if (bridge.hasFailed(trackId)) {
      loops.delete(instanceKey);
      return false;
    }

    // Buffer a caminho: UMA solicitação pendente por chave. Se o processo
    // terminar antes de o arquivo chegar, `voice.cancelled` impede o som tardio.
    voice.pending = true;
    const promise = bridge.loadBuffer(trackId);
    if (!promise?.then) {
      loops.delete(instanceKey);
      return false;
    }
    promise.then(() => {
      if (voice.cancelled || loops.get(instanceKey) !== voice) return;
      if (!bridge.getBuffer(trackId)) { loops.delete(instanceKey); return; }
      voiceTargets(voice);
      attachSource(voice);
    });
    return true;
  }

  function updateLoop(instanceKey, options = {}) {
    const voice = loops.get(instanceKey);
    if (!voice) return false;
    voice.options = { ...voice.options, ...options };
    if (options.protect !== undefined) voice.protectedVoice = Boolean(options.protect);
    voice.lastTouchedAt = clock;
    voiceTargets(voice);

    if (voice.pending) return true;

    if (!voice.source) {
      // Voz solta por distância: volta assim que for audível de novo.
      if (audible(voice)) attachSource(voice);
      return true;
    }

    applyGain(voice, voice.paused ? 0 : voice.targetGain, BIOLOGICAL_FADES.resume);
    if (voice.panNode) {
      try {
        voice.panNode.pan.setTargetAtTime(voice.targetPan, context().currentTime, 0.05);
      } catch {
        voice.panNode.pan.value = voice.targetPan;
      }
    }
    try {
      voice.source.playbackRate.setTargetAtTime(voice.targetRate, context().currentTime, 0.08);
    } catch {
      voice.source.playbackRate.value = voice.targetRate;
    }
    return true;
  }

  function pauseLoop(instanceKey) {
    const voice = loops.get(instanceKey);
    if (!voice || voice.paused) return false;
    voice.paused = true;
    voice.lastTouchedAt = clock;
    applyGain(voice, 0, BIOLOGICAL_FADES.pause);
    note('loop-pause', instanceKey, voice.trackId);
    return true;
  }

  function resumeLoop(instanceKey, options = {}) {
    const voice = loops.get(instanceKey);
    if (!voice) return false;
    voice.paused = false;
    voice.lastTouchedAt = clock;
    if (Object.keys(options).length) voice.options = { ...voice.options, ...options };
    voiceTargets(voice);
    // Um source já parado não volta: cria outro com o buffer já decodificado.
    if (!voice.source && !voice.pending && audible(voice)) attachSource(voice);
    else applyGain(voice, voice.targetGain, BIOLOGICAL_FADES.resume);
    note('loop-resume', instanceKey, voice.trackId);
    return true;
  }

  function stopLoop(instanceKey, { fade = BIOLOGICAL_FADES.stop } = {}) {
    const voice = loops.get(instanceKey);
    if (!voice) return false;
    // Cancela também a solicitação pendente: um processo que já terminou não
    // pode ganhar som quando o arquivo finalmente chegar.
    voice.cancelled = true;
    loops.delete(instanceKey);
    if (voice.source) releaseSource(voice, fade);
    note('loop-stop', instanceKey, voice.trackId);
    return true;
  }

  function stopGroup(groupId, options = {}) {
    let stopped = false;
    for (const [key, voice] of [...loops.entries()]) {
      if (voice.group !== groupId && groupFromInstanceKey(key) !== groupId) continue;
      stopped = stopLoop(key, options) || stopped;
    }
    return stopped;
  }

  function stopAll({ fade = BIOLOGICAL_FADES.stop, clearPending = true } = {}) {
    let stopped = false;
    for (const key of [...loops.keys()]) stopped = stopLoop(key, { fade }) || stopped;
    if (clearPending) {
      instanceCooldowns.clear();
      globalCooldowns.clear();
      // Efeitos criticos ainda esperando o proprio buffer nao podem tocar na
      // fase seguinte.
      bridge.clearQueuedFx?.();
    }
    return stopped;
  }

  function preloadGroup(groupId) {
    const promises = gameAudio.preloadBiologicalGroup?.(groupId) || [];
    return promises.length > 0;
  }

  function update(dt) {
    const step = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    clock += step;

    // TUTORIAL ABERTO: a simulação biológica para, mas este relógio não. Sem o
    // tratamento abaixo, 0,6 s de cartão aberto bastavam para todo loop virar
    // órfão e ser destruído — o jogador fechava o tutorial e o processo que
    // estava vendo crescer tinha ficado mudo. Aqui os loops são PRESERVADOS:
    // nada expira, nada é cancelado, e quem abaixa o volume é o barramento
    // (BIOLOGICAL_TUTORIAL_DUCK, aplicado em game-audio).
    const state = getState?.();
    const tutorialAberto = state?.tutorialOpen === true;
    if (tutorialAberto) {
      tutorialGraceUntil = clock + TUTORIAL_GRACE_SECONDS;
      return;
    }
    if (!loops.size) return;

    const playing = state?.gameState === 'play';
    // Depois de fechar o cartão os sistemas precisam de alguns quadros para
    // voltar a sustentar as chaves. Expirar nesse intervalo teria o mesmo
    // efeito de expirar durante o tutorial.
    const emTolerancia = clock < tutorialGraceUntil;

    for (const [key, voice] of [...loops.entries()]) {
      // Órfã: o sistema dono parou de sustentar. Sai por fade em vez de ficar
      // presa — é o que garante que morte e troca de fase não deixam som.
      if (!emTolerancia && clock - voice.lastTouchedAt > STALE_SECONDS) {
        stopLoop(key, { fade: BIOLOGICAL_FADES.stop });
        continue;
      }
      // Fora de 'play' (morte, respawn, fim) tudo recua sem ser destruído.
      if (!playing && !voice.paused) {
        voice.paused = true;
        applyGain(voice, 0, BIOLOGICAL_FADES.pause);
        continue;
      }
      if (voice.pending) continue;

      voiceTargets(voice);
      if (voice.paused) continue;

      if (!audible(voice)) {
        if (voice.inaudibleSince === null) voice.inaudibleSince = clock;
        else if (clock - voice.inaudibleSince > BIOLOGICAL_SPATIAL.inaudibleGraceSeconds && voice.source) {
          // Inaudível por tempo demais: solta o source, mantém a voz. Volta
          // sozinha quando o processo voltar ao alcance da câmera.
          releaseSource(voice);
        }
        if (voice.source) applyGain(voice, voice.targetGain, BIOLOGICAL_FADES.pause);
        continue;
      }

      voice.inaudibleSince = null;
      if (!voice.source) { attachSource(voice); continue; }
      applyGain(voice, voice.targetGain, BIOLOGICAL_FADES.resume);
      if (voice.panNode) {
        try {
          voice.panNode.pan.setTargetAtTime(voice.targetPan, context().currentTime, 0.06);
        } catch {
          voice.panNode.pan.value = voice.targetPan;
        }
      }
    }
  }

  function reset() {
    stopAll({ fade: 0.05, clearPending: true });
    events.length = 0;
    blockedByCooldown = 0;
    rejectedByDistance = 0;
    lastEffect = null;
    lastRejection = null;
    tutorialGraceUntil = 0;
    clock = 0;
  }

  // Estado de UMA voz, em uma palavra. Separar isto e o ponto do painel: "nao
  // ouvi o biofilme" tem causas muito diferentes, e na tela todas sao iguais.
  function voiceState(voice) {
    if (voice.pending) return 'pendente';
    if (voice.paused) return 'pausado';
    if (voice.released) return 'fora de alcance';
    if (!voice.source) return 'sem fonte';
    return audible(voice) ? 'ativo' : 'inaudivel';
  }

  function debugSnapshot() {
    const stats = bridge.bufferStats?.() || { loaded: 0, pending: 0, failed: 0, queuedFx: 0 };
    const todas = [...loops.values()];
    const grupos = {};
    if (bridge.groupState) {
      for (const grupo of Object.keys(BIOLOGICAL_AUDIO_GROUPS)) {
        grupos[grupo] = bridge.groupState(grupo);
      }
    }
    return {
      available: true,
      registeredLoopCount: todas.length,
      activeLoopCount: activeVoices().length,
      pausedLoopCount: todas.filter(voice => voice.paused).length,
      releasedLoopCount: todas.filter(voice => voice.released).length,
      pendingLoopCount: todas.filter(voice => voice.pending).length,
      queuedFxCount: stats.queuedFx || 0,
      failedBufferCount: stats.failed || 0,
      maximumLoopCount: BIOLOGICAL_LOOP_LIMIT,
      loops: todas.map(voice => ({
        instanceKey: voice.instanceKey,
        trackId: voice.trackId,
        group: voice.group,
        gain: Math.round(voice.targetGain * 1000) / 1000,
        pan: Math.round(voice.targetPan * 100) / 100,
        rate: Math.round(voice.targetRate * 100) / 100,
        priority: priorityOf(voice),
        distance: Math.round(voice.distance),
        state: voiceState(voice),
        paused: voice.paused,
        pending: voice.pending,
        released: voice.released,
      })),
      preloadGroups: grupos,
      lastEffect,
      lastRejectedEffect: lastRejection?.trackId || null,
      lastRejectionReason: lastRejection?.reason || null,
      events: [...events],
      blockedByCooldown,
      rejectedByDistance,
      buffersLoaded: stats.loaded,
      buffersPending: stats.pending,
    };
  }

  return {
    play,
    startLoop,
    updateLoop,
    pauseLoop,
    resumeLoop,
    stopLoop,
    stopGroup,
    stopAll,
    preloadGroup,
    update,
    reset,
    debugSnapshot,
  };
}
