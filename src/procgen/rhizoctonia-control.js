import { organismSprites } from '../render/organism-sprites.js';
import { publishControlSignal } from './biological-audio-signals.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const TAU = Math.PI * 2;

export function createRhizoctoniaAttackHyphaPath({
  startX,
  startY,
  endX,
  endY,
  phase = 0,
  charge = 0,
}) {
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  const pointCount = clamp(Math.ceil(length / 12), 5, 24);
  const amplitude = Math.min(16, Math.max(4, length * .075)) * (.42 + clamp(charge, 0, 1) * .58);
  const points = [];
  for (let index = 0; index <= pointCount; index++) {
    const progress = index / pointCount;
    const envelope = Math.sin(progress * Math.PI);
    const broadWave = Math.sin(progress * Math.PI * 2.35 + phase) * amplitude;
    const fineWave = Math.sin(progress * Math.PI * 5.7 + phase * 1.41) * amplitude * .22;
    const offset = (broadWave + fineWave) * envelope;
    points.push({
      x: startX + dx * progress + normalX * offset,
      y: startY + dy * progress + normalY * offset,
    });
  }
  return points;
}

function nearestHostRoot(state, enemy) {
  const centerX = enemy.x + enemy.w / 2;
  const feetY = enemy.y + enemy.h;
  let best = null;
  let bestDistance = Infinity;
  for (const platform of state.level.platforms || []) {
    if (platform.type !== 'root' || platform.final || platform.recovery || platform.mycorrhizaStructure) continue;
    const x = clamp(centerX, platform.x + 18, platform.x + platform.w - 18);
    const distance = Math.hypot(x - centerX, platform.y - feetY);
    if (distance < bestDistance) {
      best = platform;
      bestDistance = distance;
    }
  }
  return best;
}

function stageLabel(enemy) {
  if (enemy.contained) return 'contida por Bacillus';
  const value = enemy.colonization || 0;
  if (value < .25) return 'foco inicial';
  if (value < .5) return 'colonização superficial';
  if (value < .75) return 'lesão ativa';
  return 'necrose cortical';
}

export function createRhizoctoniaControl({ state, entities, pseudomonas }) {
  const memory = new Map();
  let lastInstructionAt = -Infinity;
  let controlledCount = 0;
  let activeCount = 0;

  function announce(text, duration = 5, cooldown = 2.4) {
    if (state.time - lastInstructionAt < cooldown) return;
    state.toast = text;
    state.toastTime = duration;
    lastInstructionAt = state.time;
  }

  function ensure(enemy, index = 0) {
    if (!enemy || !enemy.alive) return null;
    const host = enemy.hostPlatform || nearestHostRoot(state, enemy);
    if (!host) return null;
    enemy.type = 'rhizoctonia';
    enemy.hostPlatform = host;
    enemy.maxHp = enemy.maxHp || 3;
    enemy.hp = Number.isFinite(enemy.hp) ? enemy.hp : enemy.maxHp;
    enemy.colonization = clamp(Number.isFinite(enemy.colonization) ? enemy.colonization : .16, .06, 1);
    enemy.infectionX = Number.isFinite(enemy.infectionX)
      ? clamp(enemy.infectionX, host.x + 24, host.x + host.w - 24)
      : clamp(enemy.x + enemy.w / 2, host.x + 24, host.x + host.w - 24);
    enemy.x = enemy.infectionX - enemy.w / 2;
    enemy.y = host.y - enemy.h - 5;
    enemy.stun = 999;
    enemy.attackCooldown = Number.isFinite(enemy.attackCooldown) ? enemy.attackCooldown : .8 + index * .12;
    enemy.rhizoCharge = enemy.rhizoCharge || 0;
    enemy.rhizoLunge = enemy.rhizoLunge || 0;
    enemy.rhizoAttackDirection = enemy.rhizoAttackDirection || 1;
    enemy.rhizoHitApplied = Boolean(enemy.rhizoHitApplied);
    enemy.containmentTime = enemy.containmentTime || 0;
    enemy.contained = Boolean(enemy.contained);
    enemy.phase = Number.isFinite(enemy.phase) ? enemy.phase : index * 1.71 + Math.random() * TAU;
    if (!memory.has(enemy)) memory.set(enemy, { hp: enemy.hp, announced: false });
    return host;
  }

  function bacillusStrength(enemy, host) {
    let best = 0;
    let melhorFilme = null;
    const spreadRadius = Math.max(34, host.w * (enemy.colonization || .1) * .48);
    for (const film of state.level.biofilms || []) {
      if (!film.functional || film.platform !== host) continue;
      const radius = Math.max(28, film.radius || film.targetRadius || 0);
      const distance = Math.max(0, Math.abs((film.x || 0) - enemy.infectionX) - spreadRadius);
      if (distance >= radius * 1.35) continue;
      const maturity = clamp(film.protectionStrength || film.growth || .35, .2, 1);
      const strength = maturity * (1 - distance / (radius * 1.35));
      if (strength > best) { best = strength; melhorFilme = film; }
    }
    // Publica a pressao JA CALCULADA para o audio poder representa-la. Nao
    // altera nada: `best` e devolvido igual, com ou sem esta linha.
    if (melhorFilme?.bacillusColonyId && best > 0) {
      publishControlSignal(state, 'bacillusAntibiosis', {
        colonyId: melhorFilme.bacillusColonyId,
        targetId: enemy.trichodermaRhizoId || `rhizoctonia-${Math.round(enemy.infectionX)}`,
        targetType: 'rhizoctonia',
        pressure: clamp(best, 0, 1),
        x: melhorFilme.x,
        y: melhorFilme.y,
      });
    }
    return clamp(best, 0, 1);
  }

  function pseudomonasStrength(enemy, host, dt) {
    let best = 0;
    const entries = pseudomonas?.colonyStates;
    if (!entries) return 0;
    for (const entry of entries.values()) {
      const colony = entry.colony;
      if (!colony || colony.dormant || colony.vigor <= .04 || entry.ironReserve <= .025) continue;
      const sameRoot = colony.platform === host;
      const distance = Math.hypot(colony.x - enemy.infectionX, colony.y - host.y);
      const range = (sameRoot ? 285 : 215) + (colony.sourceCount || 1) * 18;
      if (distance >= range) continue;
      const reserve = clamp(entry.ironReserve / .7, 0, 1);
      const pressure = clamp((1 - distance / range) * reserve * colony.vigor * (sameRoot ? 1.18 : .82), 0, 1);
      if (pressure <= .02) continue;
      best = Math.max(best, pressure);
      entry.activePressure = Math.max(entry.activePressure || 0, pressure * .8);
      publishControlSignal(state, 'pseudomonasSuppression', {
        colonyId: colony.id,
        targetId: enemy.trichodermaRhizoId || `rhizoctonia-${Math.round(enemy.infectionX)}`,
        targetType: 'rhizoctonia',
        pressure,
        x: colony.x,
        y: colony.y,
      });
      entry.ironReserve = Math.max(0, entry.ironReserve - dt * .0035 * pressure);
    }
    return clamp(best, 0, 1);
  }

  function prepare() {
    for (let index = 0; index < (state.level.enemies || []).length; index++) {
      const enemy = state.level.enemies[index];
      if (!enemy.alive) continue;
      ensure(enemy, index);
      enemy.stun = 999;
    }
  }

  function damagePlayerFromAttack(enemy, player) {
    const damage = enemy.colonization >= .72 ? 2 : 1;
    entities.damagePlayer?.(damage, damage > 1 ? 'hifa invasiva de Rhizoctonia' : 'hifa de Rhizoctonia', {
      infection: damage > 1 ? .22 : .1,
      invuln: damage > 1 ? 1.2 : 1.02,
      knockbackX: -enemy.rhizoAttackDirection * (damage > 1 ? 345 : 245),
      knockbackY: damage > 1 ? -300 : -225,
    });
  }

  function updateAttack(enemy, host, player, dt, control) {
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
    const playerCenterX = player.x + player.w / 2;
    const feetY = player.y + player.h;
    const onRoot = playerCenterX >= host.x - 8
      && playerCenterX <= host.x + host.w + 8
      && Math.abs(feetY - host.y) < 96;
    const dx = playerCenterX - enemy.infectionX;
    const distance = Math.abs(dx);
    const attackRange = 92 + enemy.colonization * 112;
    const suppressed = enemy.contained || control >= .82;

    if (suppressed || !onRoot || distance > attackRange + 55) {
      enemy.rhizoCharge = Math.max(0, enemy.rhizoCharge - dt * 1.65);
      enemy.rhizoLunge = Math.max(0, enemy.rhizoLunge - dt * 1.8);
      enemy.rhizoHitApplied = false;
      return;
    }

    if (enemy.rhizoLunge > 0) {
      enemy.rhizoLunge = Math.max(0, enemy.rhizoLunge - dt);
      const reach = attackRange * (1 - enemy.rhizoLunge / .34);
      enemy.attackTipX = enemy.infectionX + enemy.rhizoAttackDirection * reach;
      if (!enemy.rhizoHitApplied && Math.abs(playerCenterX - enemy.attackTipX) < 42 && Math.abs(feetY - host.y) < 88) {
        enemy.rhizoHitApplied = true;
        damagePlayerFromAttack(enemy, player);
      }
      if (enemy.rhizoLunge <= 0) {
        enemy.attackCooldown = 2.15 + control * 1.35;
        enemy.rhizoHitApplied = false;
      }
      return;
    }

    if (enemy.attackCooldown > 0 || distance > attackRange) {
      enemy.rhizoCharge = Math.max(0, enemy.rhizoCharge - dt * 1.2);
      return;
    }

    enemy.rhizoAttackDirection = Math.sign(dx) || enemy.rhizoAttackDirection;
    const chargeRate = (.82 + enemy.colonization * .42) * (1 - control * .62);
    enemy.rhizoCharge = clamp(enemy.rhizoCharge + dt * chargeRate, 0, 1);
    if (enemy.rhizoCharge >= 1) {
      enemy.rhizoCharge = 0;
      enemy.rhizoLunge = .34;
      enemy.rhizoHitApplied = false;
      announce('Rhizoctonia: a borda da colônia lançou uma hifa de ataque. Afaste-se do halo vermelho ou contenha o foco com Bacillus.', 4.2, 1.4);
    }
  }

  function updateEnemy(enemy, index, dt) {
    const host = ensure(enemy, index);
    if (!host || !enemy.alive) return;

    const mem = memory.get(enemy);
    if (mem && enemy.hp < mem.hp) {
      enemy.colonization = Math.max(.06, enemy.colonization - .13 * (mem.hp - enemy.hp));
      mem.hp = enemy.hp;
    }

    const bacillus = bacillusStrength(enemy, host);
    const iron = pseudomonasStrength(enemy, host, dt);
    enemy.bacillusControl = bacillus;
    enemy.ironLimitation = iron;
    const synergy = bacillus * (1 + iron * .6);
    const phaseFactor = 1 + Math.min(.35, Math.max(0, (state.campaign?.phase || 1) - 1) * .035);
    const naturalGrowth = (.012 + enemy.colonization * .012) * phaseFactor * (1 - iron * .58);
    const retreat = synergy * (.018 + bacillus * .025);
    const net = naturalGrowth - retreat;
    enemy.colonization = clamp(enemy.colonization + dt * net, .06, 1);

    if (bacillus >= .58 && enemy.colonization <= .18) enemy.containmentTime += dt * (.7 + bacillus);
    else enemy.containmentTime = Math.max(0, enemy.containmentTime - dt * .65);
    if (enemy.containmentTime >= 2.6) enemy.contained = true;
    if (enemy.contained && bacillus < .28) enemy.contained = false;
    if (enemy.contained) enemy.colonization = Math.max(.07, enemy.colonization - dt * .012);

    const control = clamp(bacillus * .74 + iron * .34, 0, 1);
    const pressure = enemy.contained
      ? .018
      : clamp(.08 + enemy.colonization * .72 - control * .42, .03, .9);
    host.rhizoctoniaPressure = Math.max(host.rhizoctoniaPressure || 0, pressure);
    host.rhizoctoniaColonization = Math.max(host.rhizoctoniaColonization || 0, enemy.colonization);
    host.rhizoctoniaControl = Math.max(host.rhizoctoniaControl || 0, control);

    if (enemy.contained || net < 0) {
      host.rootDamage = clamp((host.rootDamage || 0) - dt * (.004 + synergy * .013), 0, .94);
    } else {
      host.rootDamage = clamp((host.rootDamage || 0) + dt * pressure * (.012 + enemy.colonization * .012), 0, .94);
    }
    host.rootHealth = clamp(1 - (host.rootDamage || 0), .06, 1);

    updateAttack(enemy, host, state.player, dt, control);

    if (!mem.announced && Math.abs((state.player.x + state.player.w / 2) - enemy.infectionX) < 330) {
      mem.announced = true;
      announce('Controle de Rhizoctonia: Bacillus maduro contém a expansão, Pseudomonas com reserva de Fe enfraquece o fungo e Trichoderma realiza micoparasitismo.', 6.4, .2);
    }
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    activeCount = 0;
    controlledCount = 0;
    for (const root of state.level.platforms || []) {
      if (root.type !== 'root') continue;
      root.rhizoctoniaColonization = 0;
      root.rhizoctoniaControl = 0;
      // A pressao tambem precisa zerar a cada frame: como e reatribuida por
      // Math.max, sem este reset ela virava um pico permanente e a raiz nunca
      // recuperava depois da praga morta — o objetivo da Fase 6 nunca fechava.
      root.rhizoctoniaPressure = 0;
    }
    (state.level.enemies || []).forEach((enemy, index) => {
      if (!enemy.alive) return;
      activeCount++;
      updateEnemy(enemy, index, dt);
      if (enemy.contained || (enemy.bacillusControl || 0) >= .45) controlledCount++;
    });
  }

  function drawColonizedRoot(ctx, enemy, index) {
    const host = enemy.hostPlatform;
    if (!host) return;
    const colonization = clamp(enemy.colonization || 0, 0, 1);
    const span = clamp(40 + host.w * colonization * .86, 40, host.w - 18);
    const left = clamp(enemy.infectionX - span / 2, host.x + 8, host.x + host.w - span - 8);
    const top = host.y - 4;
    const control = clamp((enemy.bacillusControl || 0) * .74 + (enemy.ironLimitation || 0) * .34, 0, 1);

    ctx.save();
    const patch = ctx.createLinearGradient(left, 0, left + span, 0);
    patch.addColorStop(0, 'rgba(88,34,55,0)');
    patch.addColorStop(.18, `rgba(106,38,58,${.2 + colonization * .22})`);
    patch.addColorStop(.5, `rgba(48,18,31,${.36 + colonization * .32})`);
    patch.addColorStop(.82, `rgba(106,38,58,${.2 + colonization * .22})`);
    patch.addColorStop(1, 'rgba(88,34,55,0)');
    ctx.fillStyle = patch;
    ctx.fillRect(left, top, span, 13 + colonization * 13);

    const strandCount = 5 + Math.floor(colonization * 13);
    for (let i = 0; i < strandCount; i++) {
      const t = strandCount <= 1 ? .5 : i / (strandCount - 1);
      const x0 = enemy.infectionX;
      const x1 = left + span * t;
      const wave = Math.sin(index * 1.7 + i * 2.1) * (5 + colonization * 7);
      ctx.strokeStyle = enemy.contained ? 'rgba(151,126,116,.45)' : `rgba(255,91,124,${.25 + colonization * .42})`;
      ctx.lineWidth = 1 + colonization * 1.6;
      ctx.beginPath();
      ctx.moveTo(x0, top + 5 + (i % 3));
      ctx.bezierCurveTo(
        x0 + (x1 - x0) * .34,
        top + wave,
        x0 + (x1 - x0) * .72,
        top + 5 - wave * .45,
        x1,
        top + 5 + (i % 4),
      );
      ctx.stroke();
    }

    const cushions = Math.floor(colonization * 4.2);
    for (let i = 0; i < cushions; i++) {
      const x = left + span * ((i + 1) / (cushions + 1));
      const r = 4 + colonization * 5 + (i % 2) * 2;
      ctx.fillStyle = enemy.contained ? 'rgba(126,99,94,.64)' : 'rgba(136,49,72,.82)';
      ctx.strokeStyle = enemy.contained ? '#9effdf' : '#ff8297';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, top + 5, r, r * .48, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }

    if (control > .05) {
      ctx.strokeStyle = control > .55 ? 'rgba(158,255,223,.75)' : 'rgba(213,255,109,.62)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(left, top - 4);
      ctx.lineTo(left + span, top - 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawStatus(ctx, enemy) {
    // Barras de status removidas a pedido do usuário
  }

  function traceAttackHypha(ctx, points) {
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
    });
    ctx.stroke();
  }

  function drawAttackBranches(ctx, points, enemy, halo = false) {
    const charge = clamp(enemy.rhizoCharge || 0, 0, 1);
    const branchCount = charge > .62 ? 3 : 2;
    for (let index = 0; index < branchCount; index++) {
      const pointIndex = Math.min(
        points.length - 2,
        Math.max(1, Math.round((.34 + index * .22) * (points.length - 1))),
      );
      const point = points[pointIndex];
      const previous = points[pointIndex - 1];
      const next = points[pointIndex + 1];
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const side = Math.sin((enemy.phase || 0) * 1.7 + index * 2.3) < 0 ? -1 : 1;
      const normalX = -dy / length * side;
      const normalY = dx / length * side;
      const branchLength = 10 + charge * 13 + index * 2;
      const endX = point.x + normalX * branchLength + dx / length * branchLength * .32;
      const endY = point.y + normalY * branchLength + dy / length * branchLength * .32;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.quadraticCurveTo(
        point.x + normalX * branchLength * .55,
        point.y + normalY * branchLength * .55,
        endX,
        endY,
      );
      ctx.lineWidth = halo ? 3.4 : .9;
      ctx.stroke();
    }
  }

  function drawAttack(ctx, enemy) {
    const host = enemy.hostPlatform;
    if (!host) return;
    const charge = clamp(enemy.rhizoCharge || 0, 0, 1);
    const lunging = enemy.rhizoLunge > 0;
    if (charge <= .02 && !lunging) return;
    const startX = enemy.infectionX;
    const endX = lunging
      ? (enemy.attackTipX || startX)
      : startX + enemy.rhizoAttackDirection * (45 + charge * (70 + enemy.colonization * 70));
    const startY = host.y - 10;
    const endY = startY - 4;
    const points = createRhizoctoniaAttackHyphaPath({
      startX,
      startY,
      endX,
      endY,
      phase: enemy.phase || 0,
      charge: Math.max(charge, lunging ? .8 : 0),
    });
    ctx.save();
    ctx.globalAlpha = .3 + Math.max(charge, lunging ? .8 : 0) * .65;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Mesma linguagem das hifas de ataque do Trichoderma: bainha neon,
    // núcleo fino, crescimento orgânico e pequenas ramificações laterais.
    ctx.shadowColor = '#ff416d';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = 'rgba(255,65,109,.32)';
    ctx.lineWidth = 6.4;
    traceAttackHypha(ctx, points);
    drawAttackBranches(ctx, points, enemy, true);

    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffdbe3';
    ctx.lineWidth = 2.15;
    traceAttackHypha(ctx, points);
    drawAttackBranches(ctx, points, enemy, false);

    ctx.shadowColor = '#ff416d';
    ctx.shadowBlur = 15;
    ctx.fillStyle = '#fff4f7';
    ctx.beginPath();
    ctx.arc(endX, endY, 2.7 + Math.sin(state.time * 5 + (enemy.phase || 0)) * .6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawRhizoctoniaSprite(ctx, enemy, index) {
    const charge = clamp(enemy.rhizoCharge || 0, 0, 1);
    const pulse = 1 + Math.sin(state.time * 2.4 + index) * .05;
    organismSprites.draw(ctx, 'rhizoctonia', {
      x: enemy.x + enemy.w / 2,
      y: enemy.y + enemy.h / 2 + 2,
      height: 105 * pulse * (1 + charge * .08),
      time: state.time,
      phase: enemy.phase ?? index,
      alpha: enemy.contained ? .58 : 1,
      flipX: (enemy.rhizoAttackDirection || 1) < 0,
    });
  }

  function render(ctx) {
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    (state.level.enemies || []).forEach((enemy, index) => {
      if (!enemy.alive || !ensure(enemy, index)) return;
      drawColonizedRoot(ctx, enemy, index);
      drawAttack(ctx, enemy);
      // A sheet fecha a composição na frente da hifa. Se estiver desativada,
      // o fallback procedural já foi desenhado pelo renderer principal.
      drawRhizoctoniaSprite(ctx, enemy, index);
      drawStatus(ctx, enemy);
    });
    ctx.restore();
  }

  function reset() {
    memory.clear();
    lastInstructionAt = -Infinity;
    controlledCount = 0;
    activeCount = 0;
  }

  return {
    get activeCount() { return activeCount; },
    get controlledCount() { return controlledCount; },
    prepare,
    update,
    render,
    reset,
  };
}
