import { fxLanded } from '../game-audio.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const TAU = Math.PI * 2;

function quadraticPoint(a, c, b, t) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

export function createTrichodermaMeloidogyneControl({ state, entities, colonies, lifecycle }) {
  const attacks = new Map();
  const maxActiveAttacks = 5;
  const detectionRadius = 560;
  let lastToastAt = -Infinity;
  let eggsDestroyed = 0;
  let eggMassesNeutralized = 0;
  let juvenilesDestroyed = 0;

  function announce(text, duration = 5, cooldown = 2.2) {
    if (state.time - lastToastAt < cooldown) return;
    state.toast = text;
    state.toastTime = duration;
    lastToastAt = state.time;
  }

  function targetPosition(target, type) {
    if (type === 'egg') return { x: target.x, y: target.y - 4 };
    return { x: target.x, y: target.y };
  }

  function targetExists(attack) {
    if (attack.type === 'egg') {
      return lifecycle.eggMasses.includes(attack.target)
        && attack.target.eggs > 0
        && !attack.target.neutralized;
    }
    return lifecycle.juveniles.includes(attack.target)
      && attack.target.alive
      && attack.target.state === 'seeking'
      && !attack.target.carriedByPlayer;
  }

  function targetClaimed(id) {
    return attacks.has(id);
  }

  function idleColonies() {
    return colonies.colonies.filter(colony => (
      !colony.activeTargetId
      && !colony.exhausted
      && colony.vigor > .055
      && state.time >= (colony.cooldownUntil || 0)
      && colony.growth >= .45
    ));
  }

  function availableTargets() {
    const result = [];
    for (const mass of lifecycle.eggMasses) {
      if (mass.eggs <= 0 || mass.neutralized || targetClaimed(mass.id)) continue;
      result.push({ type: 'egg', target: mass, priority: .68 });
    }
    for (const juvenile of lifecycle.juveniles) {
      if (!juvenile.alive || juvenile.state !== 'seeking' || juvenile.carriedByPlayer || targetClaimed(juvenile.id)) continue;
      result.push({ type: 'j2', target: juvenile, priority: 1 });
    }
    return result;
  }

  function bestAssignment(colony, targets) {
    let best = null;
    let bestScore = Infinity;
    for (const candidate of targets) {
      const point = targetPosition(candidate.target, candidate.type);
      const distance = Math.hypot(point.x - colony.x, point.y - colony.y);
      if (distance > detectionRadius) continue;
      const eggUrgency = candidate.type === 'egg'
        ? .72 + candidate.target.eggs / Math.max(1, candidate.target.maxEggs) * .22
        : 1;
      const score = distance * candidate.priority / eggUrgency;
      if (score < bestScore) {
        best = { ...candidate, point, distance };
        bestScore = score;
      }
    }
    return best;
  }

  function createAttack(colony, assignment) {
    const id = assignment.target.id;
    const midpoint = {
      x: (colony.x + assignment.point.x) / 2 + (Math.random() - .5) * 95,
      y: Math.min(colony.y, assignment.point.y) - 42 - Math.random() * 92,
    };
    const attack = {
      id,
      type: assignment.type,
      target: assignment.target,
      colony,
      search: 0,
      contact: 0,
      lysis: 0,
      state: 'search',
      curve: midpoint,
      distance: assignment.distance,
      phase: Math.random() * TAU,
      nextEggThreshold: .16,
      initialEggs: assignment.type === 'egg' ? assignment.target.eggs : 0,
      fading: 0,
      completed: false,
      aborted: false,
    };
    attacks.set(id, attack);
    attack.audioKey = `trichoderma-attack:${colony.id}:${id}`;
    entities?.audio?.startLoop(attack.audioKey, 'trichodermaHyphalAttack', {
      x: (colony.x + assignment.point.x) / 2,
      y: (colony.y + assignment.point.y) / 2,
      gain: .6,
    });
    colony.activeTargetId = `melo-control:${id}`;
    colony.stage = assignment.type === 'egg' ? 'buscando massa de ovos' : 'interceptando J2';
    entities.burst(colony.x, colony.y, '#8df0a8', 16, 105);
    announce(
      assignment.type === 'egg'
        ? 'Trichoderma detectou uma massa de ovos: a hifa crescerá até o alvo, interromperá a eclosão e inviabilizará os ovos gradualmente.'
        : 'Trichoderma detectou um J2 livre: a hifa pode imobilizá-lo antes da penetração radicular.',
      5.8,
      .4,
    );
  }

  function assignTargets() {
    if (attacks.size >= maxActiveAttacks) return;
    const targets = availableTargets();
    if (!targets.length) return;
    for (const colony of idleColonies()) {
      if (attacks.size >= maxActiveAttacks) break;
      const assignment = bestAssignment(colony, targets.filter(candidate => !targetClaimed(candidate.target.id)));
      if (assignment) createAttack(colony, assignment);
    }
  }

  function releaseColony(attack, { reward = 0, cooldown = 1.6, exhausted = false } = {}) {
    const colony = attack.colony;
    if (!colony) return;
    if (String(colony.activeTargetId || '').endsWith(attack.id)) colony.activeTargetId = null;
    colony.vigor = clamp(colony.vigor + reward, 0, 1);
    colony.cooldownUntil = state.time + cooldown;
    colony.exhausted = exhausted || colony.vigor <= .02;
    colony.stage = colony.exhausted ? 'exhausted' : 'ready';
  }

  function abortAttack(attack, exhausted = false) {
    if (attack.aborted || attack.completed) return;
    attack.aborted = true;
    attack.state = 'aborted';
    entities?.audio?.stopLoop(attack.audioKey);
    attack.fading = .01;
    if (attack.type === 'egg') {
      attack.target.trichodermaSuppression = 0;
      attack.target.trichodermaLysis = 0;
    } else if (attack.target) {
      attack.target.trichodermaCaught = false;
      attack.target.trichodermaLysis = 0;
    }
    releaseColony(attack, { cooldown: exhausted ? 2.8 : 1.25, exhausted });
    if (exhausted) {
      announce('Colônia de Trichoderma exaurida: libere exsudatos junto à colônia para recuperar vigor antes de outro ataque.', 5.3, 1.2);
    }
  }

  function removeJuvenile(juvenile) {
    juvenile.alive = false;
    juvenile.trichodermaCaught = false;
    const index = lifecycle.juveniles.indexOf(juvenile);
    if (index >= 0) lifecycle.juveniles.splice(index, 1);
  }

  function completeEggAttack(attack) {
    const mass = attack.target;
    mass.eggs = 0;
    mass.neutralized = true;
    mass.trichodermaSuppression = 1;
    mass.trichodermaLysis = 1;
    mass.emptyAge = 0;
    attack.completed = true;
    attack.state = 'completed';
    attack.fading = .01;
    entities?.audio?.stopLoop(attack.audioKey, { fade: .2 });
    entities?.audio?.play('trichodermaControlComplete', { x: mass.x, y: mass.y });
    eggMassesNeutralized++;
    state.player.soil += 3.4;
    state.player.hope += 4.2;
    releaseColony(attack, { reward: .1, cooldown: 1.9 });
    entities.burst(mass.x, mass.y, '#8df0a8', 36, 185);
    entities.burst(mass.x, mass.y, '#ffe0a6', 24, 135);
    announce('Massa de ovos neutralizada: Trichoderma inviabilizou os ovos e interrompeu uma futura geração de Meloidogyne.', 5.3, .5);
  }

  function completeJ2Attack(attack) {
    const juvenile = attack.target;
    const point = { x: juvenile.x, y: juvenile.y };
    removeJuvenile(juvenile);
    attack.completed = true;
    attack.state = 'completed';
    attack.fading = .01;
    entities?.audio?.stopLoop(attack.audioKey, { fade: .2 });
    entities?.audio?.play('trichodermaControlComplete', point);
    juvenilesDestroyed++;
    state.player.soil += 1.2;
    state.player.hope += 1.8;
    releaseColony(attack, { reward: .045, cooldown: 1.15 });
    entities.burst(point.x, point.y, '#8df0a8', 24, 155);
    entities.burst(point.x, point.y, '#fff0cf', 12, 95);
    announce('J2 lisado por Trichoderma antes da penetração radicular.', 3.8, 1.2);
  }

  function vigorDrain(attack, dt, contact = false) {
    const colony = attack.colony;
    if (!colony) return;
    const distanceFactor = 1 + Math.min(.55, attack.distance / 700);
    const fuel = clamp(colony.rechargeIntensity || 0, 0, 1);
    const base = contact ? (attack.type === 'egg' ? .019 : .014) : .0095;
    const drain = dt * base * distanceFactor * (1 - fuel * .68);
    colony.vigor = clamp(colony.vigor - drain, 0, 1);
    if (colony.vigor <= .02) abortAttack(attack, true);
  }

  function advanceSearch(attack, dt) {
    const targetPoint = targetPosition(attack.target, attack.type);
    attack.distance = Math.hypot(targetPoint.x - attack.colony.x, targetPoint.y - attack.colony.y);
    const speed = (.36 + attack.colony.vigor * .58) / (1 + attack.distance / 750);
    attack.search = clamp(attack.search + dt * speed, 0, 1);
    vigorDrain(attack, dt, false);
    attack.colony.stage = attack.type === 'egg' ? 'hifa buscando ovos' : 'hifa buscando J2';
    if (attack.search >= 1 && !attack.aborted) {
      attack.state = 'contact';
      attack.contact = .04;
      if (!attack.audioContacted) {
        const entregue = entities?.audio
          ? fxLanded(entities.audio.play('trichodermaTargetContact', {
              ...targetPoint, instanceId: attack.id,
            }))
          : true;
        if (entregue) attack.audioContacted = true;
      }
      entities.burst(targetPoint.x, targetPoint.y, '#baf66f', 14, 90);
    }
  }

  function advanceEggLysis(attack, dt) {
    const mass = attack.target;
    mass.trichodermaSuppression = Math.max(mass.trichodermaSuppression || 0, clamp(attack.contact + attack.lysis, 0, 1));
    mass.trichodermaLysis = attack.lysis;
    mass.hatch = Math.max(mass.hatch, .8 + attack.contact * 1.2);
    attack.colony.stage = attack.contact < 1 ? 'aderindo à massa de ovos' : 'enzimas sobre os ovos';

    if (attack.contact < 1) {
      attack.contact = clamp(attack.contact + dt * (.72 + attack.colony.vigor * .35), 0, 1);
      vigorDrain(attack, dt, true);
      return;
    }

    const rate = .115 + attack.colony.vigor * .105 + clamp(attack.colony.rechargeIntensity || 0, 0, 1) * .09;
    attack.lysis = clamp(attack.lysis + dt * rate, 0, 1);
    vigorDrain(attack, dt, true);
    if (attack.aborted) return;

    while (mass.eggs > 0 && attack.lysis >= attack.nextEggThreshold) {
      mass.eggs--;
      eggsDestroyed++;
      attack.nextEggThreshold += 1 / Math.max(1, attack.initialEggs);
      entities.burst(mass.x + (Math.random() - .5) * 12, mass.y - 3, '#d6ff94', 8, 62);
    }
    if (mass.eggs <= 0 || attack.lysis >= 1) completeEggAttack(attack);
  }

  function advanceJ2Lysis(attack, dt) {
    const juvenile = attack.target;
    juvenile.trichodermaCaught = true;
    juvenile.trichodermaLysis = attack.lysis;
    juvenile.vx *= Math.pow(.025, dt);
    juvenile.vy *= Math.pow(.025, dt);
    attack.colony.stage = attack.contact < 1 ? 'enrolando J2' : 'lise do J2';

    if (attack.contact < 1) {
      attack.contact = clamp(attack.contact + dt * (1.05 + attack.colony.vigor * .55), 0, 1);
      vigorDrain(attack, dt, true);
      return;
    }

    attack.lysis = clamp(attack.lysis + dt * (.42 + attack.colony.vigor * .35), 0, 1);
    juvenile.trichodermaLysis = attack.lysis;
    vigorDrain(attack, dt, true);
    if (attack.aborted) return;
    if (attack.lysis >= 1) completeJ2Attack(attack);
  }

  function updateAttack(attack, dt) {
    if (!targetExists(attack)) {
      abortAttack(attack, false);
      return;
    }
    if (!attack.colony || !colonies.colonies.includes(attack.colony)) {
      abortAttack(attack, false);
      return;
    }
    if (attack.state === 'search') {
      advanceSearch(attack, dt);
      sustainAttackAudio(attack);
      return;
    }
    if (attack.type === 'egg') advanceEggLysis(attack, dt);
    else advanceJ2Lysis(attack, dt);
    sustainAttackAudio(attack);
  }

  // Mantem o loop do ataque vivo e posicionado. Sem isto o gerenciador recolhe
  // a voz como orfa depois de meio segundo, no meio do ataque.
  function sustainAttackAudio(attack) {
    if (attack.completed || attack.aborted) return;
    const point = targetPosition(attack.target, attack.type);
    const searching = attack.state === 'search';
    entities?.audio?.startLoop(attack.audioKey, 'trichodermaHyphalAttack', {
      x: searching
        ? attack.colony.x + (point.x - attack.colony.x) * clamp(attack.search, 0, 1)
        : point.x,
      y: searching
        ? attack.colony.y + (point.y - attack.colony.y) * clamp(attack.search, 0, 1)
        : point.y,
      gain: searching ? .6 + attack.search * .25 : .9,
      rate: searching ? .95 : 1.04,
    });
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    assignTargets();
    for (const [id, attack] of [...attacks]) {
      if (attack.completed || attack.aborted) {
        attack.fading += dt * .75;
        if (attack.fading >= 1) attacks.delete(id);
        continue;
      }
      updateAttack(attack, dt);
    }
  }

  function drawHypha(ctx, attack) {
    const a = { x: attack.colony.x, y: attack.colony.y };
    const b = targetPosition(attack.target, attack.type);
    const visible = attack.state === 'search' ? attack.search : 1;
    const points = 28;
    ctx.save();
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#8df0a8';
    ctx.strokeStyle = attack.aborted ? 'rgba(141,240,168,.28)' : '#8df0a8';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const t = Math.min(visible, i / points * visible);
      const point = quadraticPoint(a, attack.curve, b, t);
      const wave = Math.sin(t * Math.PI * 7 + state.time * 2.1 + attack.phase) * (2.5 + t * 2.5);
      const x = point.x;
      const y = point.y + wave;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    const tip = quadraticPoint(a, attack.curve, b, visible);
    ctx.fillStyle = '#effff5';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 3.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawContact(ctx, attack) {
    if (attack.state === 'search') return;
    const target = targetPosition(attack.target, attack.type);
    const progress = clamp(attack.contact, 0, 1);
    const lysis = clamp(attack.lysis, 0, 1);
    const coils = 2 + Math.floor(progress * 7);
    ctx.save();
    for (let i = 0; i < coils; i++) {
      const angle = state.time * (2.4 + i * .08) + attack.phase + i / coils * TAU;
      const radius = (attack.type === 'egg' ? 12 : 8) + i * (attack.type === 'egg' ? 1.8 : 1.15);
      ctx.strokeStyle = `rgba(141,240,168,${.24 + progress * .62})`;
      ctx.lineWidth = 1.15 + lysis * .5;
      ctx.beginPath();
      ctx.ellipse(
        target.x + Math.cos(angle) * 2.2,
        target.y + Math.sin(angle) * 1.5,
        radius,
        radius * .52,
        angle * .15,
        angle,
        angle + Math.PI * 1.55,
      );
      ctx.stroke();
    }

    const droplets = 3 + Math.floor(lysis * 9);
    for (let i = 0; i < droplets; i++) {
      const angle = attack.phase + i * TAU / droplets + state.time * .35;
      const radius = 7 + (i % 4) * 4;
      ctx.fillStyle = i % 2 ? '#d6ff94' : '#8df0a8';
      ctx.globalAlpha = .45 + lysis * .45;
      ctx.beginPath();
      ctx.arc(target.x + Math.cos(angle) * radius, target.y + Math.sin(angle) * radius * .55, 1.5 + lysis, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawStatus(ctx, attack) {
    if (attack.state === 'search' || attack.completed || attack.aborted) return;
    const target = targetPosition(attack.target, attack.type);
    const width = attack.type === 'egg' ? 82 : 62;
    const y = target.y - (attack.type === 'egg' ? 31 : 25);
    ctx.restore();
  }

  function render(ctx) {
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    for (const attack of attacks.values()) {
      ctx.globalAlpha = attack.completed || attack.aborted ? clamp(1 - attack.fading, 0, 1) : 1;
      drawHypha(ctx, attack);
      drawContact(ctx, attack);
      drawStatus(ctx, attack);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function reset() {
    entities?.audio?.stopGroup('trichoderma-attack');
    for (const attack of attacks.values()) {
      if (attack.type === 'egg' && attack.target) {
        attack.target.trichodermaSuppression = 0;
        attack.target.trichodermaLysis = 0;
      }
      if (attack.type === 'j2' && attack.target) {
        attack.target.trichodermaCaught = false;
        attack.target.trichodermaLysis = 0;
      }
      releaseColony(attack, { cooldown: 0 });
    }
    attacks.clear();
    lastToastAt = -Infinity;
    eggsDestroyed = 0;
    eggMassesNeutralized = 0;
    juvenilesDestroyed = 0;
  }

  return {
    get activeAttackCount() { return [...attacks.values()].filter(attack => !attack.completed && !attack.aborted).length; },
    get eggAttackCount() { return [...attacks.values()].filter(attack => attack.type === 'egg' && !attack.completed && !attack.aborted).length; },
    get juvenileAttackCount() { return [...attacks.values()].filter(attack => attack.type === 'j2' && !attack.completed && !attack.aborted).length; },
    get eggsDestroyed() { return eggsDestroyed; },
    get eggMassesNeutralized() { return eggMassesNeutralized; },
    get juvenilesDestroyed() { return juvenilesDestroyed; },
    update,
    render,
    reset,
  };
}
