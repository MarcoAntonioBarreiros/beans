import { H, W } from '../core/constants.js';
import { clamp, createHyphalNetwork, renderHyphalNetwork, TAU, updateHyphalNetwork } from './hyphal-growth.js';
import { fxLanded } from '../game-audio.js';

function nearestPointOnRect(x, y, rect) {
  return { x: clamp(x, rect.x, rect.x + rect.w), y: clamp(y, rect.y, rect.y + rect.h) };
}

function avoidHazards(state, tip) {
  let fx = 0;
  let fy = 0;
  for (const hazard of state.level.hazards) {
    const point = nearestPointOnRect(tip.x, tip.y, hazard);
    const dx = tip.x - point.x;
    const dy = tip.y - point.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    if (distance < 135) {
      const force = (1 - distance / 135) * 1.8;
      fx += dx / distance * force;
      fy += dy / distance * force - .38;
    }
  }
  return { x: fx, y: fy };
}

function byAgentId(agents, id) {
  return agents.find(agent => agent.id === id) || null;
}

export function createTrichodermaGrowth({ state, entities, ecology, colonies }) {
  const networks = new Map();
  const detectionRadius = 540;
  const naturalGerminationRadius = 190;
  const maxActiveNetworks = 6;
  let lastExhaustionToastAt = -Infinity;

  function releaseColony(network, { reward = 0, cooldown = 1.4, stage = 'ready' } = {}) {
    const colony = colonies.byId(network?.metadata?.colonyId);
    if (!colony) return;
    colony.activeTargetId = null;
    colony.cooldownUntil = state.time + cooldown;
    colony.vigor = clamp(colony.vigor + reward, 0, 1);
    colony.exhausted = colony.vigor <= .015;
    colony.stage = colony.exhausted ? 'exhausted' : stage;
  }

  function clear() {
    entities?.audio?.stopGroup('trichoderma-attack');
    networks.clear();
    for (const colony of colonies.colonies) {
      colony.activeTargetId = null;
      colony.stage = colony.exhausted ? 'exhausted' : 'ready';
    }
    lastExhaustionToastAt = -Infinity;
  }

  function reset() { clear(); }

  function activeNetworkCount() {
    let count = 0;
    for (const network of networks.values()) {
      if (
        network.active
        && !network.metadata.completed
        && !network.metadata.aborted
        && !network.metadata.exhausted
      ) count++;
    }
    return count;
  }

  function searchNetworks() {
    return [...networks.values()].filter(network => (
      network.active
      && !network.metadata.contactLocked
      && !network.metadata.completed
      && !network.metadata.aborted
      && !network.metadata.exhausted
    ));
  }

  function findNearestColony(target) {
    let best = null;
    let bestScore = Infinity;
    for (const colony of colonies.colonies) {
      if (colony.activeTargetId || colony.exhausted || colony.vigor <= .04) continue;
      if (state.time < colony.cooldownUntil) continue;
      const distance = Math.hypot(colony.x - target.x, colony.y - target.y);
      if (distance > detectionRadius) continue;
      const score = distance / (.72 + colony.vigor * .45);
      if (score < bestScore) {
        best = colony;
        bestScore = score;
      }
    }
    return best;
  }

  function germinateNaturalColony(target) {
    let best = null;
    let bestDistance = naturalGerminationRadius;
    for (const agent of ecology.agents) {
      if (agent.type !== 'trichoderma' || agent.hyphalAttack) continue;
      if ((agent.recruitedUntil || 0) > state.time) continue;
      const distance = Math.hypot(agent.x - target.x, agent.y - target.y);
      if (distance < bestDistance) {
        best = agent;
        bestDistance = distance;
      }
    }
    if (!best) return null;
    return colonies.inoculateNaturalAgent(best);
  }

  function createAttack(target, colony) {
    if (!colony || colony.activeTargetId || networks.has(target.id) || colony.vigor <= .04) return false;
    const angle = Math.atan2(target.y - colony.y, target.x - colony.x);
    const network = createHyphalNetwork({
      kind: 'trichoderma',
      x: colony.x,
      y: colony.y,
      angle,
      maxBranches: 22,
      maxPoints: 620,
      metadata: {
        targetId: target.id,
        colonyId: colony.id,
        contact: 0,
        lysis: 0,
        phase: Math.random() * TAU,
        completed: false,
        aborted: false,
        exhausted: false,
        stalled: 0,
        contactLocked: false,
        stage: 'search',
        lastPointCount: 0,
        lastTipCount: 1,
        fuelIntensity: 0,
      },
    });
    network.germination = 1;
    // O ataque hifal generico (contra o fungo oportunista) tinha toda a
    // mecanica e nenhum som: so os controles especificos de Rhizoctonia e
    // Meloidogyne soavam. Mesma chave por instancia dos outros dois, entao os
    // tres compartilham o teto de vozes de `trichoderma-attack`.
    network.metadata.audioKey = `trichoderma-attack:${colony.id}:${target.id}`;
    entities?.audio?.startLoop(network.metadata.audioKey, 'trichodermaHyphalAttack', {
      x: (colony.x + target.x) / 2,
      y: (colony.y + target.y) / 2,
      gain: .6,
    });
    networks.set(target.id, network);
    colony.activeTargetId = target.id;
    colony.stage = 'search';
    colony.exhausted = false;
    state.discoveredMicrobes.add('trichoderma');
    entities.burst(colony.x, colony.y, '#8df0a8', 18, 115);
    return true;
  }

  function abortAttack(network, target, retryDelay = 1.2) {
    if (!network || network.metadata.aborted || network.metadata.completed || network.metadata.exhausted) return;
    network.metadata.aborted = true;
    network.active = false;
    network.fading = .9;
    // Alvo sumiu ou a colonia se perdeu: encerra o loop, SEM efeito de
    // conclusao — nao houve controle.
    entities?.audio?.stopLoop(network.metadata.audioKey);
    releaseColony(network, { cooldown: 1.2, stage: 'ready' });
    if (target) target.trichoRetryAt = state.time + retryDelay;
  }

  function exhaustAttack(network, target) {
    if (!network || network.metadata.contactLocked || network.metadata.exhausted || network.metadata.completed) return;
    network.metadata.exhausted = true;
    network.metadata.stage = 'retracting';
    network.active = false;
    network.fading = .01;
    entities?.audio?.stopLoop(network.metadata.audioKey);
    const colony = colonies.byId(network.metadata.colonyId);
    if (colony) {
      colony.vigor = 0;
      colony.exhausted = true;
      colony.stage = 'exhausted';
      colony.activeTargetId = null;
      colony.cooldownUntil = state.time + 2.2;
    }
    if (target) target.trichoRetryAt = state.time + 2.2;

    const tip = [...network.tips].reverse().find(candidate => candidate.points.length) || network.tips[0];
    if (tip) entities.burst(tip.x, tip.y, '#8df0a8', 16, 80);
    if (state.time - lastExhaustionToastAt > 2.4) {
      state.toast = 'Colônia exaurida: a hifa não alcançou o alvo. Libere exsudatos junto à colônia ou à frente de crescimento para reativá-la.';
      state.toastTime = 5.4;
      lastExhaustionToastAt = state.time;
    }
  }

  function completeAttack(network, target) {
    if (network.metadata.completed) return;
    network.metadata.completed = true;
    network.metadata.stage = 'completed';
    network.active = false;
    network.fading = .01;
    // Controle concluido PELO Trichoderma. Um alvo removido por outro sistema
    // passa por `abortAttack`, que nao chega aqui.
    entities?.audio?.stopLoop(network.metadata.audioKey, { fade: .2 });
    entities?.audio?.play('trichodermaControlComplete', {
      x: target.x, y: target.y, instanceId: target.id,
    });
    const index = ecology.agents.indexOf(target);
    if (index >= 0) ecology.agents.splice(index, 1);
    const colony = colonies.byId(network.metadata.colonyId);
    if (colony) {
      colony.kills += 1;
      colony.vigor = clamp(colony.vigor + .14, 0, 1);
      colony.exhausted = false;
    }
    releaseColony(network, { cooldown: 1.8, stage: 'ready' });
    state.player.soil += 1.8;
    state.player.hope += 2.6;
    if (Math.hypot(target.x - (state.player.x + 16), target.y - (state.player.y + 24)) < 260) {
      state.player.infection = Math.max(0, (state.player.infection || 0) - .16);
    }
    entities.burst(target.x, target.y, '#8df0a8', 42, 230);
    entities.burst(target.x, target.y, '#ff8297', 24, 175);
    state.toast = 'Micoparasitismo concluído: a colônia recuperou 14% de vigor e permanece inoculada para novos alvos';
    state.toastTime = 4.8;
  }

  function nearestTipDistance(network, target) {
    let best = Math.hypot(network.x - target.x, network.y - target.y);
    for (const tip of network.tips) {
      if (!tip.active) continue;
      best = Math.min(best, Math.hypot(tip.x - target.x, tip.y - target.y));
    }
    return best;
  }

  function cloudFuelIntensity(network, colony) {
    const clouds = state.level.exudateClouds || [];
    if (!clouds.length) return 0;
    const anchors = [colony, ...network.tips.filter(tip => tip.active)];
    let best = 0;
    for (const cloud of clouds) {
      const lifeFactor = clamp(cloud.life / Math.max(.1, cloud.maxLife || 10), 0, 1);
      const range = Math.max(125, cloud.radius * 2.15);
      for (const anchor of anchors) {
        const distance = Math.hypot(anchor.x - cloud.x, anchor.y - cloud.y);
        if (distance >= range) continue;
        best = Math.max(best, (1 - distance / range) * (.5 + lifeFactor * .5));
      }
    }
    return best;
  }

  function updateVigor(network, colony, target, dt) {
    const metadata = network.metadata;
    const fuel = cloudFuelIntensity(network, colony);
    metadata.fuelIntensity = fuel;
    colony.rechargeIntensity = Math.max(colony.rechargeIntensity || 0, fuel);

    if (fuel > 0) colony.vigor = clamp(colony.vigor + dt * (.03 + fuel * .12), 0, 1);
    if (metadata.contactLocked) {
      metadata.lastPointCount = network.pointCount;
      metadata.lastTipCount = network.tips.length;
      return;
    }

    const pointDelta = Math.max(0, network.pointCount - metadata.lastPointCount);
    const tipDelta = Math.max(0, network.tips.length - metadata.lastTipCount);
    const activeTips = network.tips.filter(tip => tip.active).length;
    const distance = nearestTipDistance(network, target);
    const distanceFactor = distance > 330 ? 1.22 : distance > 180 ? 1 : .82;
    const drain = (
      pointDelta * .0042
      + tipDelta * .044
      + activeTips * dt * .0065
    ) * distanceFactor;

    colony.vigor = clamp(colony.vigor - drain, 0, 1);
    metadata.lastPointCount = network.pointCount;
    metadata.lastTipCount = network.tips.length;
    if (colony.vigor <= 0) exhaustAttack(network, target);
  }

  function lockContact(network, target) {
    if (network.metadata.contactLocked) return;
    network.metadata.contactLocked = true;
    network.metadata.stage = 'coil';
    network.metadata.contact = Math.max(network.metadata.contact, .08);
    network.metadata.stalled = 0;
    network.maxPoints = Math.max(network.maxPoints, network.pointCount + 280);
    const colony = colonies.byId(network.metadata.colonyId);
    if (colony) colony.stage = 'coil';
    // Primeira chegada da hifa ao alvo, uma vez por ataque.
    if (!network.metadata.audioContacted) {
      const entregue = entities?.audio
        ? fxLanded(entities.audio.play('trichodermaTargetContact', {
            x: target.x, y: target.y, instanceId: target.id,
          }))
        : true;
      if (entregue) network.metadata.audioContacted = true;
    }
    entities.burst(target.x, target.y, '#baf66f', 12, 90);
  }

  function advanceAutonomousLysis(network, target, dt) {
    if (!network.metadata.contactLocked) return;
    const colony = colonies.byId(network.metadata.colonyId);
    if (colony) colony.stage = 'lysis';
    target.vx *= Math.pow(.06, dt);
    target.vy *= Math.pow(.06, dt);

    const coilTips = network.tips.filter(tip => tip.mode === 'coil').length;
    const coilTurns = network.tips.reduce((sum, tip) => sum + tip.coilTurns, 0);
    const coilContribution = clamp(coilTurns / Math.max(3, coilTips * 2.6), 0, 1);
    network.metadata.contact = clamp(network.metadata.contact + dt * (.34 + coilTips * .008), 0, 1);
    network.metadata.lysis = clamp(
      network.metadata.lysis + dt * (.16 + coilContribution * .18 + Math.min(.1, coilTips * .006)),
      0,
      1,
    );

    if (Math.random() < dt * (3.2 + coilContribution * 4.5)) {
      network.enzymes.push({
        x: target.x + (Math.random() - .5) * 22,
        y: target.y + (Math.random() - .5) * 18,
        r: 3,
        life: 1,
      });
      if (network.enzymes.length > 90) network.enzymes.shift();
    }
    if (Math.random() < dt * network.metadata.lysis * 3.4) {
      network.fragments.push({
        x: target.x + (Math.random() - .5) * 18,
        y: target.y + (Math.random() - .5) * 14,
        vx: (Math.random() - .5) * 38,
        vy: -12 - Math.random() * 34,
        r: 1.5 + Math.random() * 2.4,
        life: 1,
        color: '#ff8297',
      });
      if (network.fragments.length > 70) network.fragments.shift();
    }
  }

  function updateAttack(network, dt) {
    const target = byAgentId(ecology.agents, network.metadata.targetId);
    const colony = colonies.byId(network.metadata.colonyId);
    if (!target) {
      abortAttack(network, null, 0);
      return;
    }
    if (!colony) {
      abortAttack(network, target, 1.5);
      return;
    }

    const cameraCenter = state.cameraX + W / 2;
    if (Math.abs(target.x - cameraCenter) > W * 1.25 && !network.metadata.contactLocked) return;

    const closestDistance = nearestTipDistance(network, target);
    const branchScale = network.metadata.contactLocked
      ? 1.45
      : closestDistance > 300
        ? .52
        : closestDistance > 175
          ? .76
          : 1.12;
    const growthScale = network.metadata.contactLocked
      ? 1
      : .34 + colony.vigor * .82;

    updateHyphalNetwork(network, dt, {
      time: state.time,
      bounds: { minX: 8, maxX: (state.level.endX || 6500) - 8, minY: 54, maxY: H - 48 },
      growthScale,
      branchScale,
      coilDaughters: 3,
      targetProvider: () => {
        const currentTarget = byAgentId(ecology.agents, network.metadata.targetId);
        if (!currentTarget) return null;
        return {
          id: currentTarget.id,
          x: currentTarget.x,
          y: currentTarget.y,
          kind: 'fungal-target',
          range: 760,
          strength: 1.32,
          contactRadius: 48,
          orbitRadius: 48,
        };
      },
      avoidanceProvider: tip => avoidHazards(state, tip),
      canBranch: (currentNetwork, tip, currentTarget, targetDistance) => {
        if (tip.mode === 'coil' || currentNetwork.metadata.contactLocked) return true;
        const activeSearchTips = currentNetwork.tips.filter(candidate => candidate.active && candidate.mode === 'search').length;
        if (targetDistance > 300) return activeSearchTips < 2 && tip.depth < 1;
        if (targetDistance > 175) return activeSearchTips < 4 && tip.depth < 2;
        return activeSearchTips < 8 && tip.depth < 3;
      },
      onFirstContact: (currentNetwork, tip, contactTarget) => lockContact(currentNetwork, contactTarget),
      onContact: currentNetwork => { currentNetwork.metadata.stalled = 0; },
      onBudgetExhausted: currentNetwork => {
        if (!currentNetwork.metadata.contactLocked) exhaustAttack(currentNetwork, target);
      },
    });

    if (network.metadata.exhausted || network.metadata.aborted) return;
    updateVigor(network, colony, target, dt);
    if (network.metadata.exhausted) return;
    advanceAutonomousLysis(network, target, dt);

    const activeTips = network.tips.filter(tip => tip.active).length;
    if (activeTips === 0 && !network.metadata.contactLocked && network.metadata.lysis < 1) {
      network.metadata.stalled += dt;
      if (network.metadata.stalled > .7) abortAttack(network, target, 1.4);
    } else if (!network.metadata.contactLocked) {
      network.metadata.stalled = Math.max(0, network.metadata.stalled - dt * .5);
    }
    if (network.metadata.lysis >= 1) { completeAttack(network, target); return; }

    // Sustenta o loop: sem isto o gerenciador recolhe a voz como orfa no meio
    // do ataque. Posicao acompanha a ponta ativa mais avancada.
    const ponta = [...network.tips].reverse().find(tip => tip.active) || null;
    const enovelado = network.metadata.contactLocked;
    entities?.audio?.startLoop(network.metadata.audioKey, 'trichodermaHyphalAttack', {
      x: enovelado ? target.x : (ponta?.x ?? network.x),
      y: enovelado ? target.y : (ponta?.y ?? network.y),
      gain: enovelado ? .9 : .6 + clamp(network.metadata.contact, 0, 1) * .25,
      rate: enovelado ? 1.04 : .95,
    });
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    const cameraCenter = state.cameraX + W / 2;
    const opportunists = ecology.agents.filter(agent => agent.type === 'oportunista');
    let activeCount = activeNetworkCount();

    for (const target of opportunists) {
      if (activeCount >= maxActiveNetworks) break;
      if (networks.has(target.id) || (target.trichoRetryAt || 0) > state.time) continue;
      if (Math.abs(target.x - cameraCenter) > W * .9) continue;
      let colony = findNearestColony(target);
      if (!colony) colony = germinateNaturalColony(target);
      if (colony && createAttack(target, colony)) activeCount++;
    }

    for (const [id, network] of [...networks]) {
      if (network.metadata.aborted || network.metadata.exhausted) {
        network.fading += dt * .45;
        if (network.fading >= 1) networks.delete(id);
        continue;
      }
      if (network.metadata.completed || !network.active) {
        network.fading += dt * .34;
        if (network.fading >= 1) networks.delete(id);
        continue;
      }
      updateAttack(network, dt);
    }
  }

  function renderTargetStatus(ctx, network) {
    const target = byAgentId(ecology.agents, network.metadata.targetId);
    if (!target) return;
    const contact = network.metadata.contact;
    const lysis = network.metadata.lysis;
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    const pulse = 1 + Math.sin(state.time * 3.4 + network.metadata.phase) * .06;
    ctx.strokeStyle = `rgba(141,240,168,${.18 + contact * .62})`;
    ctx.lineWidth = 1.2 + contact * 2.2;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.arc(target.x, target.y, (18 + lysis * 18) * pulse, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    const coils = 2 + Math.floor(contact * 7);
    for (let i = 0; i < coils; i++) {
      const angle = state.time * (2.8 + i * .08) + network.metadata.phase + i / coils * TAU;
      const radius = 11 + i * 2.3;
      ctx.strokeStyle = `rgba(141,240,168,${.2 + contact * .62})`;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.ellipse(target.x + Math.cos(angle) * 2.5, target.y + Math.sin(angle) * 1.8, radius, radius * .58, angle * .2, angle, angle + Math.PI * 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function render(ctx) {
    for (const network of networks.values()) {
      renderHyphalNetwork(ctx, network, state, {
        color: '#8df0a8', core: '#eaffef', tip: '#ffffff', shadowBlur: 14,
      });
      renderTargetStatus(ctx, network);
    }
  }

  return {
    get attackCount() { return activeNetworkCount(); },
    get searchCount() { return searchNetworks().length; },
    get vigorAverage() { return colonies.vigorAverage; },
    get tipCount() {
      return [...networks.values()].reduce((sum, network) => sum + network.tips.filter(tip => tip.active).length, 0);
    },
    clear,
    reset,
    update,
    render,
  };
}
