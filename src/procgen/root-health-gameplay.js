const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function rootState(health) {
  if (health >= .75) return 'healthy';
  if (health >= .5) return 'stressed';
  if (health >= .25) return 'compromised';
  return 'collapse';
}

function stateLabel(stateName) {
  if (stateName === 'healthy') return 'saudável';
  if (stateName === 'stressed') return 'estressada';
  if (stateName === 'compromised') return 'comprometida';
  return 'em colapso';
}

function eligibleRoot(root) {
  return root.type === 'root'
    && !root.final
    && !root.recovery
    && !root.mycorrhizaStructure
    && !root.azospirillumStructure;
}

export function createRootHealthGameplay({ state, entities }) {
  let averageHealth = 1;
  let healthyCount = 0;
  let stressedCount = 0;
  let compromisedCount = 0;
  let collapseCount = 0;
  let lastToastAt = -Infinity;

  function roots() {
    return (state.level.platforms || []).filter(eligibleRoot);
  }

  function announce(root, text, duration = 4.7) {
    const playerX = state.player.x + state.player.w / 2;
    if (Math.abs(playerX - (root.x + root.w / 2)) > 520) return;
    if (state.time - lastToastAt < 2.6) return;
    state.toast = text;
    state.toastTime = duration;
    lastToastAt = state.time;
  }

  function ensureRoot(root) {
    if (!Number.isFinite(root.rootBaseY)) root.rootBaseY = root.y;
    if (!Number.isFinite(root.rootGameplayDamage)) root.rootGameplayDamage = clamp(1 - (root.rootHealth ?? 1), 0, .94);
    if (!Number.isFinite(root.rootHealth)) root.rootHealth = 1;
    if (!Number.isFinite(root.rootMaxHealth)) root.rootMaxHealth = 1;
    if (!Number.isFinite(root.permanentDamage)) root.permanentDamage = 0;
    if (!Number.isFinite(root.supportIntegrity)) root.supportIntegrity = 1;
    if (!Number.isFinite(root.supportOffset)) root.supportOffset = 0;
    if (!Number.isFinite(root.collapseCooldown)) root.collapseCooldown = 2.5 + Math.random() * 2;
    if (!Number.isFinite(root.collisionDisabledUntil)) root.collisionDisabledUntil = 0;
    if (!Number.isFinite(root.recoveryPulse)) root.recoveryPulse = 0;
    if (!root.rootState) root.rootState = rootState(root.rootHealth);
  }

  function gallPenalty(root, galls) {
    let penalty = 0;
    let adults = 0;
    let mature = 0;
    for (const gall of galls) {
      if (gall.platform !== root) continue;
      if (gall.progress >= .5) {
        mature++;
        penalty += .065;
      }
      if (gall.progress >= .78) {
        adults++;
        penalty += .055;
      }
      if (gall.eggMassesLaid) penalty += .035;
      // Uma femea que completou o ciclo e morreu deixa cicatriz maior: o tecido
      // foi reorganizado em celulas gigantes e nao se refaz. Sem isso a raiz
      // voltava a quase cheia depois da morte dela e a sequela nao se lia.
      if (gall.dead) penalty += .06;
    }
    return { penalty: clamp(penalty, 0, .52), adults, mature };
  }

  function noduleSupport(root) {
    let activity = 0;
    let count = 0;
    for (const site of state.level.rhizobiumNodules || []) {
      if (site.platform !== root || !site.mature) continue;
      count++;
      activity += clamp(site.activity || 0, 0, 1.35);
    }
    return {
      count,
      strength: clamp(activity / 2.2, 0, 1),
    };
  }

  function mycorrhizaSupport(root) {
    let maturity = 0;
    let count = 0;
    for (const arbuscule of state.level.mycorrhizaArbuscules || []) {
      if (arbuscule.platform !== root) continue;
      count++;
      maturity += clamp(arbuscule.maturity || 0, 0, 1);
    }
    return {
      count,
      strength: clamp(maturity / 2.4, 0, 1),
    };
  }

  function biofilmSupport(root) {
    let best = 0;
    for (const film of state.level.biofilms || []) {
      if (film.platform !== root || !film.functional) continue;
      best = Math.max(best, clamp(film.protectionStrength || film.growth || 0, 0, 1));
    }
    return best;
  }

  // Raiz lateral de Azospirillum ancorada nesta raiz: outro benefico que cura.
  function lateralRootSupport(root) {
    let best = 0;
    for (const lateral of state.level.azospirillumRoots || []) {
      if ((lateral.host || lateral.platform) !== root) continue;
      best = Math.max(best, lateral.developed === true ? 1 : clamp(lateral.visibleProgress || 0, 0, 1));
    }
    return best;
  }

  function pathogenTarget(root, adults) {
    const nematode = clamp(root.meloidogyneBurden || 0, 0, 1);
    const rhizoctonia = clamp(
      Math.max(root.rhizoctoniaColonization || 0, root.rhizoctoniaPressure || 0) * .72,
      0,
      1,
    );
    const ralstonia = clamp(
      Math.max(root.ralstoniaDamage || 0, (root.ralstoniaVascularLoad || 0) * .68),
      0,
      1,
    );
    const adultDrain = clamp(adults * .085, 0, .34);
    return clamp(Math.max(nematode * .72 + adultDrain, rhizoctonia, ralstonia), 0, .94);
  }

  function playerStanding(root) {
    const player = state.player;
    const centerX = player.x + player.w / 2;
    const feetY = player.y + player.h;
    return centerX >= root.x - 4
      && centerX <= root.x + root.w + 4
      && Math.abs(feetY - root.y) < 22;
  }

  function updateSupportFailure(root, dt, mycorrhiza) {
    const health = root.rootHealth;
    const stabilityBonus = mycorrhiza * .24;
    const targetSupport = clamp(health * .82 + stabilityBonus - root.permanentDamage * .22, .03, 1);
    root.supportIntegrity += (targetSupport - root.supportIntegrity) * clamp(dt * 1.2, 0, 1);

    let targetOffset = 0;
    if (root.rootState === 'stressed') targetOffset = 1.5 + (1 - root.supportIntegrity) * 3;
    else if (root.rootState === 'compromised') targetOffset = 6 + (1 - root.supportIntegrity) * 12;
    else if (root.rootState === 'collapse') {
      targetOffset = 19 + (1 - root.supportIntegrity) * 28 + Math.sin(state.time * 4.8 + root.x * .01) * 3.5;
    }
    root.supportOffset += (targetOffset - root.supportOffset) * clamp(dt * (root.rootState === 'collapse' ? 2.8 : 1.35), 0, 1);
    root.y = root.rootBaseY + root.supportOffset;
    root.unstable = root.rootState === 'collapse' || root.supportIntegrity < .28;

    if (!root.unstable) {
      root.collapseCooldown = Math.max(2.2, root.collapseCooldown - dt * .25);
      return;
    }

    root.collapseCooldown -= dt * (1 - mycorrhiza * .62);
    if (root.collapseCooldown > 0 || !playerStanding(root)) return;

    root.collapseCooldown = 5.2 + Math.random() * 3.4 + mycorrhiza * 4;
    root.collisionDisabledUntil = state.time + clamp(.3 + (1 - root.supportIntegrity) * .48 - mycorrhiza * .2, .2, .7);
    root.supportOffset += 8 + (1 - root.supportIntegrity) * 9;
    state.shake = Math.max(state.shake || 0, .34);
    entities.burst(root.x + root.w / 2, root.y + 4, '#b77b5b', 24, 150);
    announce(root, 'A raiz perdeu sustentação: o tecido cedeu temporariamente. Micorriza madura reduz esse risco.', 4.8);
  }

  function updateRoot(root, dt, galls) {
    ensureRoot(root);
    const oldHealth = root.rootHealth;
    const oldState = root.rootState;
    const gall = gallPenalty(root, galls);
    const nodules = noduleSupport(root);
    const mycorrhiza = mycorrhizaSupport(root);
    const biofilm = biofilmSupport(root);
    const targetDamage = pathogenTarget(root, gall.adults);

    root.permanentDamage = gall.penalty;
    root.rootMaxHealth = clamp(1 - gall.penalty, .38, 1);
    root.matureGallCount = gall.mature;
    root.adultFemaleCount = gall.adults;
    root.noduleRecovery = nodules.strength;
    root.mycorrhizaRecovery = mycorrhiza.strength;

    const lateral = lateralRootSupport(root);
    const recoveryBlocked = Boolean(root.recoveryBlocked) || (root.ralstoniaVascularLoad || 0) >= .58;
    // Sem base autonoma: a raiz so melhora com os beneficos do jogador (FBN/
    // nodulos, biofilme, micorriza, raiz lateral). Sem nenhum, recuperacao = 0.
    // Teto maior para a cura ate 100% ser viável em tempo jogável.
    const recoveryStrength = clamp(
      nodules.strength * .034
      + mycorrhiza.strength * .04
      + biofilm * .03
      + lateral * .028,
      0,
      .12,
    ) * (recoveryBlocked ? .16 : 1) * (1 - gall.adults * .13);

    if (targetDamage > root.rootGameplayDamage) {
      const speed = .55 + targetDamage * 1.15 + gall.adults * .12;
      root.rootGameplayDamage += (targetDamage - root.rootGameplayDamage) * clamp(dt * speed, 0, 1);
    } else {
      root.rootGameplayDamage = Math.max(targetDamage, root.rootGameplayDamage - dt * recoveryStrength);
    }

    root.rootHealth = clamp(
      Math.min(root.rootMaxHealth, 1 - root.rootGameplayDamage),
      .04,
      root.rootMaxHealth,
    );
    root.rootDamage = clamp(1 - root.rootHealth, 0, .96);
    if (state.gameState === 'play' && state.time > 0.4 && root.rootHealth < .88) {
      root.wasDamaged = true;
    }
    root.healthTrend = root.rootHealth > oldHealth + .0004 ? 1 : root.rootHealth < oldHealth - .0004 ? -1 : 0;
    root.recoveryPulse = root.healthTrend > 0
      ? clamp(root.recoveryPulse + dt * (1 + nodules.strength + mycorrhiza.strength), 0, 1)
      : Math.max(0, root.recoveryPulse - dt * .8);
    root.rootState = rootState(root.rootHealth);
    root.rootStateLabel = stateLabel(root.rootState);

    if (root.rootState !== oldState) {
      if (root.rootState === 'collapse') announce(root, 'Raiz em colapso: a sustentação e o transporte estão gravemente comprometidos.', 5.2);
      else if (oldState === 'collapse' && root.rootState === 'compromised') announce(root, 'Recuperação visível: a raiz saiu do colapso, mas ainda permanece comprometida.', 4.7);
      else if (root.healthTrend > 0) announce(root, `A raiz melhorou para o estado ${root.rootStateLabel}.`, 4.1);
    }

    updateSupportFailure(root, dt, mycorrhiza.strength);
  }

  function update(dt, galls = []) {
    if (state.gameState !== 'play') return;
    const list = roots();
    let sum = 0;
    healthyCount = stressedCount = compromisedCount = collapseCount = 0;

    for (const root of list) {
      updateRoot(root, dt, galls);
      sum += root.rootHealth;
      if (root.rootState === 'healthy') healthyCount++;
      else if (root.rootState === 'stressed') stressedCount++;
      else if (root.rootState === 'compromised') compromisedCount++;
      else collapseCount++;
    }
    averageHealth = list.length ? sum / list.length : 1;
  }

  function clear() {
    for (const root of roots()) {
      if (Number.isFinite(root.rootBaseY)) root.y = root.rootBaseY;
      delete root.rootBaseY;
      delete root.rootGameplayDamage;
      delete root.rootMaxHealth;
      delete root.permanentDamage;
      delete root.supportIntegrity;
      delete root.supportOffset;
      delete root.collapseCooldown;
      delete root.collisionDisabledUntil;
      delete root.recoveryPulse;
      delete root.healthTrend;
      delete root.rootState;
      delete root.rootStateLabel;
      delete root.unstable;
      delete root.wasDamaged;
      delete root.matureGallCount;
      delete root.adultFemaleCount;
      delete root.noduleRecovery;
      delete root.mycorrhizaRecovery;
    }
    averageHealth = 1;
    healthyCount = stressedCount = compromisedCount = collapseCount = 0;
    lastToastAt = -Infinity;
  }

  function reset() {
    clear();
    for (const root of roots()) ensureRoot(root);
  }

  return {
    get averageHealth() { return averageHealth; },
    get healthyCount() { return healthyCount; },
    get stressedCount() { return stressedCount; },
    get compromisedCount() { return compromisedCount; },
    get collapseCount() { return collapseCount; },
    clear,
    reset,
    update,
  };
}
