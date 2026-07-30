import { createRandom } from './random.js';

// Exsudatos renovaveis
// ====================
//
// O exsudato era um recurso estritamente FINITO: cada um coletavel uma vez, para
// sempre. Uma fase que exige mais inoculacoes do que o estoque restante virava
// matematicamente impossivel — e a prova obrigatoria de Azospirillum da fase 3 e
// exatamente esse caso: sem exsudato nao ha inoculacao, sem inoculacao nao ha
// colonia, sem colonia nao ha raiz lateral, e o bloco alto e inalcancavel.
//
// Aqui a raiz VIVA volta a exsudar: de tempos em tempos um novo exsudato brota
// sobre uma raiz elegivel. O intervalo depende da SAUDE da raiz — raiz saudavel
// exsuda rapido, raiz doente exsuda devagar —, o que amarra este sistema ao
// feedback central de saude radicular em vez de ser um spawner arbitrario.
//
// Nada aqui move plataformas, checkpoints ou os exsudatos iniciais: o modulo so
// LE a geometria pronta e acrescenta itens vinculados a uma raiz por offset.

export const RENEWABLE_EXUDATE_DEFAULTS = Object.freeze({
  enabled: true,
  minimumIntervalSeconds: 18,
  maximumIntervalSeconds: 65,
  healthExponent: 1.4,
  jitterMinimum: 0.8,
  jitterMaximum: 1.2,
  maximumActiveGlobal: 4,
  maximumActivePerRoot: 1,
  emergencyGraceSeconds: 8,
  emergencyRetrySeconds: 6,
  // Abaixo disto a raiz esta doente/morta demais para exsudar naturalmente.
  minimumRootHealth: 0.12,
  minimumRootWidth: 90,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Raiz elegivel: raiz de rota, viva, com superficie para sustentar o item. Nunca
// solo, nunca recuperacao/degrau/estrutura, nunca a raiz final.
export function isEligibleRoot(platform, config = RENEWABLE_EXUDATE_DEFAULTS) {
  if (!platform || platform.type !== 'root') return false;
  if (platform.routeScope === 'optional' && !platform.allowOptionalRoutePopulation) return false;
  if (platform.recovery || platform.final || platform.safetyStep) return false;
  if (platform.azospirillumStructure || platform.azospirillumLadderStep) return false;
  if (platform.mycorrhizaStructure || platform.nitrogenRootStructure) return false;
  if (!Number.isInteger(platform.logicIndex) || platform.logicIndex < 0) return false;
  if (!Number.isFinite(platform.x) || !Number.isFinite(platform.y)) return false;
  if (!(platform.w >= (config.minimumRootWidth ?? 90))) return false;
  const health = Number.isFinite(platform.rootHealth) ? platform.rootHealth : 1;
  return health > (config.minimumRootHealth ?? 0.12);
}

// Intervalo dependente da saude: saudavel ~ minimo, doente ~ maximo.
//
//   base = max - (max - min) * health^expoente
//
// health=1 -> base=min (~18s); health=.5 -> ~47s (com expoente 1.4);
// health=.1 -> ~63s. O jitter deterministico espalha os brotos para eles nao
// nascerem todos no mesmo instante.
export function regenerationInterval(health, random01, config = RENEWABLE_EXUDATE_DEFAULTS) {
  const minimum = config.minimumIntervalSeconds ?? 18;
  const maximum = config.maximumIntervalSeconds ?? 65;
  const exponent = config.healthExponent ?? 1.4;
  const safeHealth = clamp(Number.isFinite(health) ? health : 1, 0, 1);
  const base = maximum - (maximum - minimum) * Math.pow(safeHealth, exponent);
  const jitterMin = config.jitterMinimum ?? 0.8;
  const jitterMax = config.jitterMaximum ?? 1.2;
  const jitter = jitterMin + clamp(random01, 0, 1) * (jitterMax - jitterMin);
  return base * jitter;
}

function rootHealthOf(platform) {
  return Number.isFinite(platform?.rootHealth) ? platform.rootHealth : 1;
}

export function createRenewableExudates({ state, seedValue = null, phase = null, config = null } = {}) {
  const settings = { ...RENEWABLE_EXUDATE_DEFAULTS, ...(config || {}) };
  // Seed e fase sao lidas do estado quando nao vem explicitas: o simulador e
  // criado uma vez e atravessa varias fases, entao fixa-las na construcao daria
  // a mesma sequencia em todas.
  const seedOf = () => seedValue ?? state.level?.seed ?? state.campaign?.seed ?? 'seed';
  const phaseOf = () => phase ?? state.campaign?.phase ?? state.level?.campaignPhase ?? 0;
  // Um slot por raiz: guarda o item (reaproveitado) e o cronometro.
  const slots = new Map();
  let regenerationCounter = 0;
  let emergencyTimer = 0;
  let emergencyCooldown = 0;
  let lastEmergencyExudate = null;

  function level() { return state.level || {}; }

  function eligibleRoots() {
    return (level().platforms || []).filter(platform => isEligibleRoot(platform, settings));
  }

  // Determinismo: seed da fase + logicIndex da raiz + contador de regeneracoes +
  // tentativa. Nunca Math.random().
  function deterministic01(platform, salt) {
    const attemptId = level().objectiveProgress?.attemptId ?? 0;
    const random = createRandom(
      `${seedOf()}:renewable-exudate:p${phaseOf()}:i${platform.logicIndex}:r${salt}:a${attemptId}`,
    );
    return random();
  }

  function slotFor(platform) {
    let slot = slots.get(platform);
    if (!slot) {
      slot = { platform, item: null, timer: 0, generation: 0, scheduled: false };
      slots.set(platform, slot);
    }
    return slot;
  }

  function activeCount() {
    let count = 0;
    for (const slot of slots.values()) {
      if (slot.item && !slot.item.taken) count++;
    }
    return count;
  }

  function scheduleNext(slot) {
    slot.generation++;
    const health = rootHealthOf(slot.platform);
    const jitter01 = deterministic01(slot.platform, slot.generation);
    slot.timer = regenerationInterval(health, jitter01, settings);
    slot.scheduled = true;
  }

  // Posicao sobre a raiz: mesma convencao dos exsudatos iniciais (30px de margem,
  // 25-40px acima da superficie). Guarda o offset para o item acompanhar a
  // plataforma se ela se mover.
  function placeOn(platform, slot) {
    const spread = Math.max(1, platform.w - 60);
    const offsetX = 30 + deterministic01(platform, `x${slot.generation}`) * spread;
    const offsetY = -25 - deterministic01(platform, `y${slot.generation}`) * 15;
    return { offsetX, offsetY };
  }

  function spawnOn(platform, { emergency = false } = {}) {
    const slot = slotFor(platform);
    if (slot.item && !slot.item.taken) return slot.item; // ja existe um ativo nesta raiz
    if (activeCount() >= (settings.maximumActiveGlobal ?? 4)) return null;

    const { offsetX, offsetY } = placeOn(platform, slot);
    if (slot.item) {
      // Reaproveita o slot ja coletado em vez de crescer o array para sempre.
      slot.item.offsetX = offsetX;
      slot.item.offsetY = offsetY;
      slot.item.x = platform.x + offsetX;
      slot.item.y = platform.y + offsetY;
      slot.item.taken = false;
      slot.item.emergency = emergency;
    } else {
      slot.item = {
        renewable: true,
        emergency,
        platform,
        platformId: platform.id ?? platform.platformId ?? null,
        logicIndex: platform.logicIndex,
        offsetX,
        offsetY,
        x: platform.x + offsetX,
        y: platform.y + offsetY,
        taken: false,
      };
      level().exudates = [...(level().exudates || []), slot.item];
    }
    slot.scheduled = false;
    slot.timer = 0;
    regenerationCounter++;
    return slot.item;
  }

  // O item acompanha a plataforma pelo offset (nada de coordenada solta).
  function followPlatforms() {
    for (const slot of slots.values()) {
      if (!slot.item) continue;
      slot.item.x = slot.platform.x + slot.item.offsetX;
      slot.item.y = slot.platform.y + slot.item.offsetY;
    }
  }

  // --- Garantia emergencial anti-softlock -----------------------------------
  //
  // O desafio obrigatorio precisa ser SEMPRE resolvivel. Se o jogador chegou ao
  // corredor sem exsudato nenhum, sem Azospirillum recrutado e sem colonia no
  // hospedeiro, a regeneracao natural pode demorar mais do que a paciencia — e a
  // fase parece travada. Depois de emergencyGraceSeconds nessa situacao, uma raiz
  // elegivel entre o ultimo checkpoint e o hospedeiro brota um exsudato. Ele usa
  // o MESMO visual e o mesmo sistema de coleta: parece regeneracao natural.
  function challengeUnfinished() {
    const challenge = level().azospirillumChallenge;
    return Boolean(challenge) && !challenge.traversed;
  }

  function playerHasNoExudate() {
    return (state.player?.exudates || 0) <= 0;
  }

  function noCollectableExudateAhead(hostX) {
    const fromX = state.currentCheckpoint?.x ?? 0;
    return !(level().exudates || []).some(exudate => (
      !exudate.taken
      && Number.isFinite(exudate.x)
      && exudate.x >= fromX - 40
      && exudate.x <= hostX + 40
    ));
  }

  // "Recrutado" = ha Azospirillum seguindo o jogador. A fonte da verdade sao os
  // seguidores de beneficial-inoculants (followerGroups); a lista da selecao
  // (options()) e o mesmo dado ja formatado, e serve de reserva.
  function noAzospirillumRecruited(systems) {
    const groups = systems?.inoculants?.followerGroups?.();
    if (groups) return !((groups.get?.('azospirillum') || []).length > 0);
    const options = systems?.inoculumSelection?.options?.() || [];
    return !options.some(item => item.type === 'azospirillum' && (item.count || 0) > 0);
  }

  function noColonyOnHost(systems, host) {
    return !(systems?.inoculants?.colonies || []).some(colony => (
      colony.type === 'azospirillum' && colony.platform === host && !colony.dormant
    ));
  }

  function emergencyCandidates(host) {
    const fromX = state.currentCheckpoint?.x ?? 0;
    return eligibleRoots()
      // Nunca depois do bloco alto: o socorro tem de estar no caminho, nao alem dele.
      .filter(platform => platform.x + platform.w <= host.x + host.w + 4)
      .filter(platform => platform.x + platform.w >= fromX - 40)
      // Prioriza as raizes mais saudaveis (exsudam mais).
      .sort((a, b) => rootHealthOf(b) - rootHealthOf(a));
  }

  function updateEmergency(dt, systems) {
    if (emergencyCooldown > 0) emergencyCooldown = Math.max(0, emergencyCooldown - dt);
    const challenge = level().azospirillumChallenge;
    if (!challengeUnfinished() || !challenge?.hostPlatform) { emergencyTimer = 0; return; }
    const host = challenge.hostPlatform;

    const stuck = playerHasNoExudate()
      && noCollectableExudateAhead(host.x)
      && noAzospirillumRecruited(systems)
      && noColonyOnHost(systems, host);
    if (!stuck) { emergencyTimer = 0; return; }

    emergencyTimer += dt;
    if (emergencyTimer < (settings.emergencyGraceSeconds ?? 8)) return;
    if (emergencyCooldown > 0) return;

    const candidates = emergencyCandidates(host);
    if (!candidates.length) return;
    // Escolha deterministica entre as mais saudaveis — nao e sempre o mesmo bloco.
    const pool = candidates.slice(0, Math.min(3, candidates.length));
    const pick = pool[Math.floor(deterministic01(host, `emergency${regenerationCounter}`) * pool.length) % pool.length];
    const item = spawnOn(pick, { emergency: true });
    if (!item) return;
    lastEmergencyExudate = item;
    emergencyTimer = 0;
    emergencyCooldown = settings.emergencyRetrySeconds ?? 6;
  }

  function update(dt, systems = {}) {
    if (!settings.enabled) return;
    if (state.gameState !== 'play') return;

    const roots = eligibleRoots();
    const known = new Set(roots);
    for (const platform of roots) {
      const slot = slotFor(platform);
      // Um exsudato ativo por raiz: enquanto nao for coletado, nada e agendado.
      if (slot.item && !slot.item.taken) { slot.scheduled = false; continue; }
      if (!slot.scheduled) { scheduleNext(slot); continue; }
      slot.timer -= dt;
      if (slot.timer > 0) continue;
      // Reavalia a saude ATUAL ao brotar: uma raiz que piorou espera mais.
      if (activeCount() >= (settings.maximumActiveGlobal ?? 4)) { scheduleNext(slot); continue; }
      spawnOn(platform);
    }
    // Raiz que deixou de ser elegivel (morreu/foi removida) para de contar.
    for (const [platform, slot] of slots) {
      if (known.has(platform)) continue;
      slot.scheduled = false;
      slot.timer = 0;
    }

    followPlatforms();
    updateEmergency(dt, systems);
  }

  function reset() {
    for (const slot of slots.values()) {
      slot.scheduled = false;
      slot.timer = 0;
    }
    emergencyTimer = 0;
    emergencyCooldown = 0;
  }

  return {
    update,
    reset,
    // Telemetria de debug (FASE 14).
    get activeCount() { return activeCount(); },
    get emergencyActive() { return Boolean(lastEmergencyExudate && !lastEmergencyExudate.taken); },
    get nextIntervalEstimate() {
      let soonest = Infinity;
      for (const slot of slots.values()) {
        if (slot.scheduled && slot.timer < soonest) soonest = slot.timer;
      }
      return Number.isFinite(soonest) ? soonest : null;
    },
    get slots() { return slots; },
  };
}
