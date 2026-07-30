export function tutorialPauseActive(state, manager = null) {
  return state?.gameState === 'tutorial' || Boolean(manager?.isOpen);
}

export function clearInstantPlayerActions(state) {
  const player = state?.player;
  if (!player) return;
  player.vx = 0;
  player.vy = 0;
  player.dashTime = 0;
  player.jumpBuffer = 0;
  state.jumpHeldLast = false;
}

export function createTutorialInputGate({ keys, sim }) {
  const blockedUntilRelease = new Set();

  function clear({ blockActive = false, extraBlockedCodes = [] } = {}) {
    if (blockActive) {
      for (const [code, down] of Object.entries(keys)) {
        if (down) blockedUntilRelease.add(code);
      }
    }
    for (const code of extraBlockedCodes) {
      if (code) blockedUntilRelease.add(code);
    }
    for (const code of Object.keys(keys)) keys[code] = false;
    sim.setInputs({});
    clearInstantPlayerActions(sim.state);
  }

  function acceptsKeyDown(code) {
    return !blockedUntilRelease.has(code);
  }

  function release(code) {
    keys[code] = false;
    blockedUntilRelease.delete(code);
  }

  return {
    clear,
    acceptsKeyDown,
    release,
    get blockedCodes() { return [...blockedUntilRelease]; },
  };
}

export function advanceGameplayFrame({
  state,
  manager = null,
  sim,
  dt,
  advance,
}) {
  if (tutorialPauseActive(state, manager)) {
    sim.setInputs({});
    return false;
  }
  advance(dt);
  return true;
}
