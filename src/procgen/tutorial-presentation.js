export const AUTOMATIC_TUTORIAL_STABILITY_SECONDS = 0.1;
export const AUTOMATIC_TUTORIAL_STABILITY_FRAMES = 3;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function platformHasActiveTutorialCollision(platform, state) {
  if (!platform || !Number.isFinite(platform.x) || !Number.isFinite(platform.y)) return false;
  if (!(platform.w > 0) || !(platform.h > 0)) return false;
  if (platform.destroyed || platform.removed || platform.disappearing || platform.vanishing) return false;
  if (platform.disabled || platform.enabled === false || platform.active === false) return false;
  if (platform.colliderActive === false || platform.collisionActive === false || platform.solid === false) return false;
  // Recovery desligada nao e plataforma solida — nem quando marcada safetyStep.
  if (platform.recovery && state?.recoveryPlatformsDisabled) return false;
  if (platform.mature === false || platform.developed === false) return false;
  return true;
}

export function horizontalSupportOverlap(player, platform) {
  return Math.max(
    0,
    Math.min(player.x + player.w, platform.x + platform.w) - Math.max(player.x, platform.x),
  );
}

export function findSupportingTutorialPlatform(state, {
  verticalTolerance = 2.5,
  minimumOverlap = 10,
  overlapRatio = 0.55,
} = {}) {
  const player = state?.player;
  if (!player?.onGround || !player.alive) return null;

  const feetY = player.y + player.h;
  let best = null;
  let bestScore = Infinity;
  for (const platform of state.level?.platforms || []) {
    if (!platformHasActiveTutorialCollision(platform, state)) continue;
    const verticalGap = Math.abs(feetY - platform.y);
    if (verticalGap > verticalTolerance) continue;

    const overlap = horizontalSupportOverlap(player, platform);
    const requiredOverlap = Math.max(
      minimumOverlap,
      Math.min(player.w * overlapRatio, platform.w * overlapRatio),
    );
    if (overlap + 1e-6 < requiredOverlap) continue;

    const centerGap = Math.abs(
      (player.x + player.w / 2) - (platform.x + platform.w / 2),
    );
    const score = verticalGap * 1000 + centerGap;
    if (score < bestScore) {
      best = platform;
      bestScore = score;
    }
  }
  return best;
}

export function automaticTutorialUnsafeReason(state) {
  const player = state?.player;
  if (!player) return 'missing-player';
  if (state.gameState !== 'play') return 'game-state';
  if (!player.alive) return 'dead';
  if ((state.respawnTimer || 0) > 0) return 'respawning';
  if ((player.dashTime || 0) > 0.001) return 'dash';
  if ((player.tutorialUnsafeUntil || -Infinity) > (state.time || 0)) return 'damage';
  if (!player.onGround) return player.vy < 0 ? 'jumping' : 'falling';
  if (Math.abs(player.vy || 0) > 1) return 'vertical-motion';
  return null;
}

export function createAutomaticTutorialSafetyGate({
  state,
  stabilitySeconds = AUTOMATIC_TUTORIAL_STABILITY_SECONDS,
  stabilityFrames = AUTOMATIC_TUTORIAL_STABILITY_FRAMES,
} = {}) {
  let support = null;
  let stableSeconds = 0;
  let stableFrames = 0;
  let lastReason = 'not-checked';

  function reset(reason = 'reset') {
    support = null;
    stableSeconds = 0;
    stableFrames = 0;
    lastReason = reason;
  }

  function inspect(dt = 0) {
    const unsafeReason = automaticTutorialUnsafeReason(state);
    if (unsafeReason) {
      reset(unsafeReason);
      return { safe: false, reason: unsafeReason, support: null, stableSeconds, stableFrames };
    }

    const nextSupport = findSupportingTutorialPlatform(state);
    if (!nextSupport) {
      reset('unsupported');
      return { safe: false, reason: 'unsupported', support: null, stableSeconds, stableFrames };
    }

    if (nextSupport !== support) {
      support = nextSupport;
      stableSeconds = 0;
      stableFrames = 0;
    }

    // Um unico quadro atrasado nunca pode satisfazer sozinho a estabilidade.
    stableSeconds += clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    stableFrames++;
    const safe = stableFrames >= stabilityFrames && stableSeconds >= stabilitySeconds;
    lastReason = safe ? 'stable-support' : 'confirming-support';
    return {
      safe,
      reason: lastReason,
      support,
      stableSeconds,
      stableFrames,
    };
  }

  return {
    inspect,
    reset,
    get support() { return support; },
    diagnostics() {
      return { support, stableSeconds, stableFrames, reason: lastReason };
    },
  };
}

export function stabilizePlayerForAutomaticTutorial(state, support, {
  verticalTolerance = 4,
} = {}) {
  const player = state?.player;
  if (!player || !platformHasActiveTutorialCollision(support, state)) return false;
  const targetY = support.y - player.h;
  if (Math.abs(player.y - targetY) > verticalTolerance) return false;

  player.y = targetY;
  player.vx = 0;
  player.vy = 0;
  player.dashTime = 0;
  player.jumpBuffer = 0;
  player.coyote = 0;
  state.jumpHeldLast = false;
  return true;
}

export function createPendingTutorialQueue() {
  const entries = [];
  const cardIds = new Set();
  const triggerIds = new Set();

  function enqueue(entry) {
    if (!entry?.cardId || cardIds.has(entry.cardId)) return false;
    entries.push(entry);
    cardIds.add(entry.cardId);
    if (entry.triggerId) triggerIds.add(entry.triggerId);
    return true;
  }

  function shift() {
    const entry = entries.shift() || null;
    if (!entry) return null;
    cardIds.delete(entry.cardId);
    if (entry.triggerId) triggerIds.delete(entry.triggerId);
    return entry;
  }

  function removeCard(cardId) {
    const index = entries.findIndex(entry => entry.cardId === cardId);
    if (index < 0) return null;
    const [entry] = entries.splice(index, 1);
    cardIds.delete(entry.cardId);
    if (entry.triggerId) triggerIds.delete(entry.triggerId);
    return entry;
  }

  function clear() {
    entries.length = 0;
    cardIds.clear();
    triggerIds.clear();
  }

  return {
    enqueue,
    shift,
    removeCard,
    clear,
    hasCard: cardId => cardIds.has(cardId),
    hasTrigger: triggerId => triggerIds.has(triggerId),
    peek: () => entries[0] || null,
    get length() { return entries.length; },
    snapshot: () => entries.map(entry => ({ ...entry })),
  };
}
