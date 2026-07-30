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

export function createTrichodermaRhizoctoniaControl({ state, entities, colonies }) {
  const attacks = new Map();
  const maxActiveAttacks = 2;
  const detectionRadius = 640;
  let nextFocusId = 1;
  let lastToastAt = -Infinity;
  let eliminatedCount = 0;
  let abortedCount = 0;

  function announce(text, duration = 5, cooldown = 2.2) {
    if (state.time - lastToastAt < cooldown) return;
    state.toast = text;
    state.toastTime = duration;
    lastToastAt = state.time;
  }

  function focusId(enemy) {
    if (!enemy.trichodermaRhizoId) enemy.trichodermaRhizoId = `rhizo-focus-${nextFocusId++}`;
    return enemy.trichodermaRhizoId;
  }

  function targetPosition(enemy) {
    const host = enemy.hostPlatform;
    return {
      x: Number.isFinite(enemy.infectionX) ? enemy.infectionX : enemy.x + enemy.w / 2,
      y: host ? host.y - 8 : enemy.y + enemy.h / 2,
    };
  }

  function activeAttackCount() {
    let count = 0;
    for (const attack of attacks.values()) {
      if (!attack.completed && !attack.aborted) count++;
    }
    return count;
  }

  function targetExists(attack) {
    return (state.level.enemies || []).includes(attack.enemy)
      && attack.enemy.alive
      && attack.enemy.hostPlatform;
  }

  function targetClaimed(enemy) {
    const attack = attacks.get(focusId(enemy));
    return Boolean(attack && !attack.completed && !attack.aborted);
  }

  function eligibleEnemies() {
    return (state.level.enemies || []).filter(enemy => (
      enemy.alive
      && enemy.hostPlatform
      && (enemy.type === 'rhizoctonia' || Number.isFinite(enemy.colonization))
      && (enemy.trichoRhizoRetryAt || 0) <= state.time
      && !targetClaimed(enemy)
    ));
  }

  function idleColonies() {
    return colonies.colonies.filter(colony => (
      !colony.activeTargetId
      && !colony.exhausted
      && colony.vigor > .075
      && colony.growth >= .48
      && state.time >= (colony.cooldownUntil || 0)
    ));
  }

  function assignmentScore(colony, enemy) {
    const point = targetPosition(enemy);
    const distance = Math.hypot(point.x - colony.x, point.y - colony.y);
    if (distance > detectionRadius) return null;
    const colonization = clamp(enemy.colonization || .16, .06, 1);
    const rootDamage = clamp(enemy.hostPlatform?.rootDamage || 0, 0, 1);
    const urgency = .62 + colonization * .7 + rootDamage * .35 + (enemy.contained ? -.16 : .18);
    return { enemy, point, distance, score: distance / Math.max(.35, urgency) };
  }

  function bestAssignment(colony, enemies) {
    let best = null;
    for (const enemy of enemies) {
      const candidate = assignmentScore(colony, enemy);
      if (!candidate) continue;
      if (!best || candidate.score < best.score) best = candidate;
    }
    return best;
  }

  function createAttack(colony, assignment) {
    const enemy = assignment.enemy;
    const id = focusId(enemy);
    const midpoint = {
      x: (colony.x + assignment.point.x) / 2 + (Math.random() - .5) * 110,
      y: Math.min(colony.y, assignment.point.y) - 48 - Math.random() * 90,
    };
    const attack = {
      id,
      enemy,
      colony,
      curve: midpoint,
      distance: assignment.distance,
      search: 0,
      contact: 0,
      lysis: 0,
      state: 'search',
      initialColonization: clamp(enemy.colonization || .16, .06, 1),
      initialRootDamage: clamp(enemy.hostPlatform?.rootDamage || 0, 0, 1),
      phase: Math.random() * TAU,
      fading: 0,
      completed: false,
      aborted: false,
      fragmentTimer: .15,
    };
    attacks.set(id, attack);
    attack.audioKey = `trichoderma-attack:${colony.id}:${id}`;
    // O ataque comecou de verdade: a hifa esta crescendo em direcao ao alvo.
    entities?.audio?.startLoop(attack.audioKey, 'trichodermaHyphalAttack', {
      x: (colony.x + assignment.point.x) / 2,
      y: (colony.y + assignment.point.y) / 2,
      gain: .6,
    });
    colony.activeTargetId = `rhizo-mycoparasitism:${id}`;
    colony.stage = 'hifa buscando Rhizoctonia';
    enemy.trichodermaRhizoTargeted = true;
    enemy.trichodermaSuppression = Math.max(enemy.trichodermaSuppression || 0, .02);
    entities.burst(colony.x, colony.y, '#8df0a8', 18, 115);
    announce(
      'Trichoderma reconheceu um foco de Rhizoctonia: a hifa crescerá até a colônia, fará enovelamento e iniciará a lise.',
      5.8,
      .4,
    );
  }

  function assignTargets() {
    if (activeAttackCount() >= maxActiveAttacks) return;
    const enemies = eligibleEnemies();
    if (!enemies.length) return;
    for (const colony of idleColonies()) {
      if (activeAttackCount() >= maxActiveAttacks) break;
      const available = enemies.filter(enemy => !targetClaimed(enemy));
      const assignment = bestAssignment(colony, available);
      if (assignment) createAttack(colony, assignment);
    }
  }

  function releaseColony(attack, { reward = 0, cooldown = 1.8, exhausted = false } = {}) {
    const colony = attack.colony;
    if (!colony) return;
    if (String(colony.activeTargetId || '').endsWith(attack.id)) colony.activeTargetId = null;
    colony.vigor = clamp(colony.vigor + reward, 0, 1);
    colony.cooldownUntil = state.time + cooldown;
    colony.exhausted = exhausted || colony.vigor <= .02;
    colony.stage = colony.exhausted ? 'exhausted' : 'ready';
  }

  function clearEnemyMarkers(enemy) {
    if (!enemy) return;
    enemy.trichodermaRhizoTargeted = false;
    enemy.trichodermaSuppression = 0;
    enemy.trichodermaLysis = 0;
    enemy.trichodermaContact = 0;
  }

  function abortAttack(attack, { exhausted = false, retry = 1.8 } = {}) {
    if (attack.aborted || attack.completed) return;
    attack.aborted = true;
    attack.state = 'aborted';
    attack.fading = .01;
    entities?.audio?.stopLoop(attack.audioKey);
    if (attack.enemy?.alive) attack.enemy.trichoRhizoRetryAt = state.time + retry;
    clearEnemyMarkers(attack.enemy);
    releaseColony(attack, { cooldown: exhausted ? 3 : 1.35, exhausted });
    abortedCount++;
    if (exhausted) {
      announce(
        'Ataque interrompido: a colônia de Trichoderma perdeu vigor antes de destruir a Rhizoctonia. Exsudatos próximos reduzem esse risco.',
        5.4,
        1.1,
      );
    }
  }

  function vigorDrain(attack, dt, contact = false) {
    const colony = attack.colony;
    if (!colony || dt <= 0) return;
    const enemy = attack.enemy;
    const fuel = clamp(colony.rechargeIntensity || 0, 0, 1);
    const support = clamp((enemy.bacillusControl || 0) * .48 + (enemy.ironLimitation || 0) * .42, 0, 1);
    const distanceFactor = 1 + Math.min(.62, attack.distance / 760);
    const severity = .82 + attack.initialColonization * .72;
    const base = contact ? .0165 : .009;
    const drain = dt * base * distanceFactor * severity * (1 - fuel * .67) * (1 - support * .28);
    colony.vigor = clamp(colony.vigor - drain, 0, 1);
    if (colony.vigor <= .02) abortAttack(attack, { exhausted: true, retry: 3 });
  }

  function advanceSearch(attack, dt) {
    const point = targetPosition(attack.enemy);
    attack.distance = Math.hypot(point.x - attack.colony.x, point.y - attack.colony.y);
    const fuel = clamp(attack.colony.rechargeIntensity || 0, 0, 1);
    const speed = (.31 + attack.colony.vigor * .58 + fuel * .16) / (1 + attack.distance / 760);
    attack.search = clamp(attack.search + dt * speed, 0, 1);
    attack.colony.stage = 'hifa buscando Rhizoctonia';
    vigorDrain(attack, dt, false);
    if (attack.aborted) return;
    if (attack.search >= 1) {
      attack.state = 'contact';
      attack.contact = .04;
      attack.enemy.trichodermaContact = .04;
      // Primeira chegada da hifa ao alvo: uma vez por ataque.
      if (!attack.audioContacted) {
        const entregue = entities?.audio
          ? fxLanded(entities.audio.play('trichodermaTargetContact', {
              x: point.x, y: point.y, instanceId: attack.id,
            }))
          : true;
        if (entregue) attack.audioContacted = true;
      }
      entities.burst(point.x, point.y, '#baf66f', 16, 105);
      announce('Contato estabelecido: Trichoderma iniciou o enovelamento sobre as hifas de Rhizoctonia.', 4.5, 1.2);
    }
  }

  function completeAttack(attack) {
    if (attack.completed || attack.aborted) return;
    const enemy = attack.enemy;
    const host = enemy.hostPlatform;
    const point = targetPosition(enemy);
    attack.completed = true;
    attack.state = 'completed';
    attack.fading = .01;
    // Controle pelo Trichoderma. Alvo que some por outro sistema passa por
    // `abortAttack`, que so encerra o loop e nao toca conclusao.
    entities?.audio?.stopLoop(attack.audioKey, { fade: .2 });
    entities?.audio?.play('trichodermaControlComplete', { x: point.x, y: point.y });
    enemy.alive = false;
    enemy.hp = 0;
    enemy.colonization = .06;
    enemy.rhizoCharge = 0;
    enemy.rhizoLunge = 0;
    enemy.rhizoHitApplied = false;
    enemy.trichodermaLysis = 1;
    enemy.trichodermaSuppression = 1;
    enemy.trichodermaRhizoTargeted = false;
    if (host) {
      host.rhizoctoniaPressure = 0;
      host.rhizoctoniaColonization = 0;
      host.rhizoctoniaControl = 1;
      host.rootDamage = clamp((host.rootDamage || 0) - (.1 + attack.initialColonization * .09), 0, .94);
      host.rootHealth = clamp(1 - host.rootDamage, .06, 1);
    }
    releaseColony(attack, { reward: .105, cooldown: 2.1 });
    eliminatedCount++;
    state.player.soil += 4.2;
    state.player.hope += 5.2;
    entities.burst(point.x, point.y, '#8df0a8', 46, 225);
    entities.burst(point.x, point.y, '#ff8297', 30, 175);
    announce(
      'Micoparasitismo concluído: Trichoderma desestruturou o foco de Rhizoctonia e reduziu a lesão radicular.',
      5.2,
      .5,
    );
  }

  function advanceMycoparasitism(attack, dt) {
    const enemy = attack.enemy;
    const host = enemy.hostPlatform;
    const support = clamp((enemy.bacillusControl || 0) * .48 + (enemy.ironLimitation || 0) * .42, 0, 1);
    const fuel = clamp(attack.colony.rechargeIntensity || 0, 0, 1);

    enemy.trichodermaRhizoTargeted = true;
    enemy.trichodermaContact = attack.contact;
    enemy.trichodermaLysis = attack.lysis;
    enemy.trichodermaSuppression = Math.max(enemy.trichodermaSuppression || 0, clamp(attack.contact * .55 + attack.lysis, 0, 1));
    enemy.rhizoCharge = Math.max(0, (enemy.rhizoCharge || 0) - dt * (1.8 + attack.contact * 2.2));
    if (attack.contact > .58 || attack.lysis > .12) {
      enemy.rhizoLunge = 0;
      enemy.rhizoHitApplied = false;
      enemy.attackCooldown = Math.max(enemy.attackCooldown || 0, 1.35 + attack.lysis * 1.2);
    }

    if (attack.contact < 1) {
      attack.contact = clamp(attack.contact + dt * (.58 + attack.colony.vigor * .36 + support * .18), 0, 1);
      attack.colony.stage = attack.contact < .58 ? 'aderindo à Rhizoctonia' : 'enovelando hifas patogênicas';
      vigorDrain(attack, dt, true);
      if (attack.aborted) return;
      return;
    }

    const resistance = .78 + attack.initialColonization * 1.18;
    const rate = (.105 + attack.colony.vigor * .11 + fuel * .09 + support * .085) / resistance;
    attack.lysis = clamp(attack.lysis + dt * rate, 0, 1);
    attack.colony.stage = 'lise da Rhizoctonia';
    enemy.trichodermaLysis = attack.lysis;
    enemy.trichodermaSuppression = Math.max(enemy.trichodermaSuppression || 0, clamp(.55 + attack.lysis * .45, 0, 1));

    const targetColonization = Math.max(.06, attack.initialColonization * (1 - attack.lysis * .94));
    enemy.colonization = Math.min(enemy.colonization, targetColonization);
    if (host) {
      host.rootDamage = clamp((host.rootDamage || 0) - dt * (.004 + attack.lysis * .022 + support * .008), 0, .94);
      host.rootHealth = clamp(1 - host.rootDamage, .06, 1);
    }

    attack.fragmentTimer -= dt;
    if (attack.fragmentTimer <= 0) {
      const point = targetPosition(enemy);
      attack.fragmentTimer = .18 + Math.random() * .28;
      entities.burst(
        point.x + (Math.random() - .5) * 34,
        point.y + (Math.random() - .5) * 15,
        Math.random() < .58 ? '#8df0a8' : '#ff8297',
        5 + Math.floor(attack.lysis * 6),
        55 + attack.lysis * 70,
      );
    }

    vigorDrain(attack, dt, true);
    if (attack.aborted) return;
    if (attack.lysis >= 1 || enemy.colonization <= .061) completeAttack(attack);
  }

  function updateAttack(attack, dt) {
    if (!targetExists(attack)) {
      abortAttack(attack, { retry: 0 });
      return;
    }
    if (!attack.colony || !colonies.colonies.includes(attack.colony)) {
      abortAttack(attack, { retry: 1.5 });
      return;
    }
    if (attack.state === 'search') advanceSearch(attack, dt);
    else advanceMycoparasitism(attack, dt);
    if (attack.completed || attack.aborted) return;

    // Sustenta o loop: a posição acompanha a ponta ativa (durante a busca, o
    // ponto intermediário entre colônia e alvo; no contato, o próprio alvo).
    const point = targetPosition(attack.enemy);
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
        attack.fading += dt * .7;
        if (attack.fading >= 1) attacks.delete(id);
        continue;
      }
      updateAttack(attack, dt);
    }
  }

  function drawHypha(ctx, attack) {
    const a = { x: attack.colony.x, y: attack.colony.y };
    const b = targetPosition(attack.enemy);
    const visible = attack.state === 'search' ? attack.search : 1;
    const points = 32;
    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#8df0a8';
    ctx.strokeStyle = attack.aborted ? 'rgba(141,240,168,.28)' : '#8df0a8';
    ctx.lineWidth = 2.25;
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const t = i / points * visible;
      const point = quadraticPoint(a, attack.curve, b, t);
      const wave = Math.sin(t * Math.PI * 8 + state.time * 2.1 + attack.phase) * (2.2 + t * 3.6);
      const x = point.x;
      const y = point.y + wave;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    const branchCount = Math.floor(visible * 7);
    for (let i = 1; i <= branchCount; i++) {
      const t = i / 8 * visible;
      const point = quadraticPoint(a, attack.curve, b, t);
      const direction = i % 2 ? -1 : 1;
      const length = 10 + t * 16;
      ctx.strokeStyle = 'rgba(184,255,198,.6)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.quadraticCurveTo(point.x + direction * length * .45, point.y - 7, point.x + direction * length, point.y - 2 + Math.sin(i + state.time) * 3);
      ctx.stroke();
    }

    const tip = quadraticPoint(a, attack.curve, b, visible);
    ctx.fillStyle = '#effff5';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 3.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawContact(ctx, attack) {
    if (attack.state === 'search') return;
    const target = targetPosition(attack.enemy);
    const contact = clamp(attack.contact, 0, 1);
    const lysis = clamp(attack.lysis, 0, 1);
    const radiusBase = 15 + attack.initialColonization * 13;
    const coils = 3 + Math.floor(contact * 8);
    ctx.save();
    for (let i = 0; i < coils; i++) {
      const angle = state.time * (2.1 + i * .06) + attack.phase + i / coils * TAU;
      const radius = radiusBase + i * 2.2;
      ctx.strokeStyle = `rgba(141,240,168,${.22 + contact * .64})`;
      ctx.lineWidth = 1.2 + lysis * .65;
      ctx.beginPath();
      ctx.ellipse(
        target.x + Math.cos(angle) * 3,
        target.y + Math.sin(angle) * 1.8,
        radius,
        radius * .46,
        angle * .13,
        angle,
        angle + Math.PI * 1.62,
      );
      ctx.stroke();
    }

    const droplets = 4 + Math.floor(lysis * 11);
    for (let i = 0; i < droplets; i++) {
      const angle = attack.phase + i * TAU / droplets + state.time * .42;
      const radius = 8 + (i % 5) * 5;
      ctx.fillStyle = i % 3 ? '#d6ff94' : '#8df0a8';
      ctx.globalAlpha = .38 + lysis * .5;
      ctx.beginPath();
      ctx.arc(target.x + Math.cos(angle) * radius, target.y + Math.sin(angle) * radius * .48, 1.5 + lysis * 1.2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawStatus(ctx, attack) {
    if (attack.state === 'search' || attack.completed || attack.aborted) return;
    const target = targetPosition(attack.enemy);
    const width = 106;
    const y = target.y - 42;
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
      clearEnemyMarkers(attack.enemy);
      releaseColony(attack, { cooldown: 0 });
    }
    attacks.clear();
    nextFocusId = 1;
    lastToastAt = -Infinity;
    eliminatedCount = 0;
    abortedCount = 0;
  }

  return {
    get activeAttackCount() { return activeAttackCount(); },
    get eliminatedCount() { return eliminatedCount; },
    get abortedCount() { return abortedCount; },
    update,
    render,
    reset,
  };
}
