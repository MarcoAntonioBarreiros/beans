import {
  AZOSPIRILLUM_NITROGEN_DEFAULTS,
  getPhaseManifest,
} from './campaign-manifest.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function currentConfig(state) {
  const phase = state.campaign?.phase ?? state.level.campaignPhase;
  return getPhaseManifest(phase)?.azospirillumNitrogen || AZOSPIRILLUM_NITROGEN_DEFAULTS;
}

function activeAzospirillum(colony) {
  return Boolean(
    colony?.type === 'azospirillum'
    && colony.platform?.type === 'root'
    && colony.growth >= .68
    && colony.vigor > .05
    && !colony.dormant,
  );
}

export function sameRootSystem(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftSystem = left.rootSystemId ?? left.rootSystem?.id ?? null;
  const rightSystem = right.rootSystemId ?? right.rootSystem?.id ?? null;
  return leftSystem !== null && rightSystem !== null && leftSystem === rightSystem;
}

export function createAzospirillumNitrogen({ state, inoculants }) {
  const announcedPairs = new Set();
  let associativeNitrogenRate = 0;
  let synergizedNoduleCount = 0;

  function clearColonyState() {
    for (const colony of inoculants.colonies || []) {
      if (colony.type !== 'azospirillum') continue;
      delete colony.associativeNitrogenRate;
      delete colony.associativeNitrogenActive;
    }
  }

  function clearNoduleState() {
    for (const site of state.level.rhizobiumNodules || []) {
      if (site.azospirillumSynergyActive) {
        site.fixationRate = site.baseFixationRate || site.fixationRate || 0;
      }
      delete site.azospirillumSynergyMultiplier;
      delete site.azospirillumSynergyActive;
      delete site.azospirillumAppliedFixationRate;
      delete site.baseFixationRate;
    }
  }

  function clear() {
    clearColonyState();
    clearNoduleState();
    announcedPairs.clear();
    associativeNitrogenRate = 0;
    synergizedNoduleCount = 0;
  }

  function reset() {
    clear();
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    const config = currentConfig(state);
    const activeColonies = (inoculants.colonies || []).filter(activeAzospirillum);
    associativeNitrogenRate = 0;
    synergizedNoduleCount = 0;

    for (const colony of inoculants.colonies || []) {
      colony.associativeNitrogenRate = 0;
      colony.associativeNitrogenActive = false;
    }
    for (const colony of activeColonies) {
      const activity = clamp(colony.vigor * (.72 + (colony.rechargeIntensity || 0) * .28), 0, 1);
      const rate = config.associativeRate * activity;
      colony.associativeNitrogenRate = rate;
      colony.associativeNitrogenActive = rate > 0;
      associativeNitrogenRate += rate;
      state.player.soil += dt * rate * .22;
      state.player.hope += dt * rate * .12;
    }

    for (const site of state.level.rhizobiumNodules || []) {
      const currentFixationRate = site.fixationRate || 0;
      const previousBoostStillApplied = site.azospirillumSynergyActive
        && Math.abs(currentFixationRate - (site.azospirillumAppliedFixationRate || 0)) < 1e-9;
      const rawFixationRate = previousBoostStillApplied
        ? (site.baseFixationRate || 0)
        : currentFixationRate;
      site.fixationRate = rawFixationRate;
      site.baseFixationRate = rawFixationRate;
      site.azospirillumSynergyMultiplier = 1;
      site.azospirillumSynergyActive = false;
      delete site.azospirillumAppliedFixationRate;
      if (!(site.mature || site.stage === 'mature-nodule') || site.baseFixationRate <= 0) continue;
      const partner = activeColonies.find(colony => sameRootSystem(colony.platform, site.platform));
      if (!partner) continue;

      site.azospirillumSynergyMultiplier = config.rhizobiumSynergyMultiplier;
      site.azospirillumSynergyActive = true;
      site.fixationRate = site.baseFixationRate * config.rhizobiumSynergyMultiplier;
      site.azospirillumAppliedFixationRate = site.fixationRate;
      synergizedNoduleCount++;
      const pairId = `${partner.id}:${site.id}`;
      if (!announcedPairs.has(pairId)) {
        announcedPairs.add(pairId);
        state.toast = 'Co-inoculação: FBN potencializada';
        state.toastTime = 3.6;
      }
    }
  }

  return {
    get associativeNitrogenRate() { return associativeNitrogenRate; },
    get synergizedNoduleCount() { return synergizedNoduleCount; },
    sameRootSystem,
    clear,
    reset,
    update,
  };
}
