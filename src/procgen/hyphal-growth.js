import { H } from '../core/constants.js';

export const TAU = Math.PI * 2;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export function smoothHyphalNoise(x, y, time, seed) {
  return (
    Math.sin(x * .0107 + time * .47 + seed)
    + Math.cos(y * .0089 - time * .31 + seed * 1.73) * .72
    + Math.sin((x + y) * .0041 + time * .19 + seed * .43) * .48
  ) / 2.2;
}

export const HYPHAL_PROFILES = {
  mycorrhiza: {
    kind: 'mycorrhiza', color: '#d6afff', core: '#f4e6ff', tip: '#fff5ff',
    speed: 33, childSpeed: 26, noise: .38, steer: 3.2,
    tropismRange: 580, tropismMin: .08, tropismMax: .72,
    pointSpacing: 4.5, maxDepth: 3,
    branchDistanceMin: 58, branchDistanceMax: 153,
    branchAngleMin: .42, branchAngleMax: .9,
    contactRadius: 20, enableCoil: false,
    haloWidth: 5.2, coreWidth: 1.9,
  },
  trichoderma: {
    kind: 'trichoderma', color: '#8df0a8', core: '#eaffef', tip: '#ffffff',
    speed: 48, childSpeed: 39, noise: .26, steer: 4.4,
    tropismRange: 720, tropismMin: .2, tropismMax: .92,
    pointSpacing: 3.7, maxDepth: 4,
    branchDistanceMin: 34, branchDistanceMax: 86,
    branchAngleMin: .38, branchAngleMax: .82,
    contactRadius: 27, enableCoil: true,
    coilRadius: 42, coilSteer: .84, coilSpeedScale: .78,
    haloWidth: 6.4, coreWidth: 2.15,
  },
};

export function createHyphalTip({ x, y, angle, depth = 0, seed = Math.random() * TAU, mode = 'search', parentId = null }) {
  return {
    id: `${Math.round(seed * 100000)}:${Math.random().toString(36).slice(2, 8)}`,
    points: [{ x, y }], x, y, angle, depth, seed, mode, parentId,
    active: true, age: 0, totalDistance: 0, distanceSincePoint: 0,
    nextBranch: 42 + Math.random() * 65, contact: false, targetId: null,
    orbitSide: Math.random() < .5 ? -1 : 1, coilTurns: 0,
  };
}

export function createHyphalNetwork({ kind, x, y, angle = -.2, seed = Math.random() * TAU, maxBranches, maxPoints, metadata = {}, profile = {} }) {
  const baseProfile = HYPHAL_PROFILES[kind];
  if (!baseProfile) throw new Error(`Unknown hyphal profile: ${kind}`);
  const mergedProfile = { ...baseProfile, ...profile };
  const network = {
    kind, x, y, seed, profile: mergedProfile,
    tips: [], contacts: [], enzymes: [], fragments: [], germination: 0, pointCount: 0,
    maxBranches: maxBranches ?? (kind === 'trichoderma' ? 24 : 18),
    maxPoints: maxPoints ?? (kind === 'trichoderma' ? 560 : 430),
    active: true, fading: 0, exhausted: false, exhaustionNotified: false, metadata,
  };
  network.tips.push(createHyphalTip({ x, y, angle, depth: 0, seed }));
  return network;
}

function spawnBranch(network, parent, angle, mode = parent.mode) {
  if (network.tips.length >= network.maxBranches) return null;
  const child = createHyphalTip({
    x: parent.x, y: parent.y, angle, depth: parent.depth + 1,
    seed: parent.seed + (Math.random() - .5) * 5, mode, parentId: parent.id,
  });
  child.targetId = parent.targetId;
  child.orbitSide = Math.random() < .5 ? -1 : 1;
  network.tips.push(child);
  return child;
}

function maybeBranch(network, tip, profile, branchScale = 1) {
  if (!tip.active || tip.depth >= profile.maxDepth || network.tips.length >= network.maxBranches) return;
  if (tip.totalDistance < tip.nextBranch) return;
  const min = profile.branchDistanceMin / Math.max(.55, branchScale);
  const max = profile.branchDistanceMax / Math.max(.55, branchScale);
  tip.nextBranch += min + Math.random() * Math.max(1, max - min);
  const side = Math.random() < .5 ? -1 : 1;
  const split = profile.branchAngleMin + Math.random() * (profile.branchAngleMax - profile.branchAngleMin);
  spawnBranch(network, tip, tip.angle + side * split, tip.mode);
}

function exhaustPointBudget(network, options) {
  if (network.exhausted) return;
  network.exhausted = true;
  for (const tip of network.tips) tip.active = false;
  if (!network.exhaustionNotified) {
    network.exhaustionNotified = true;
    options.onBudgetExhausted?.(network);
  }
}

export function updateHyphalNetwork(network, dt, options = {}) {
  if (!network.active) return;
  const profile = network.profile;
  const time = options.time ?? 0;
  const bounds = options.bounds || { minX: 10, maxX: 6000, minY: 58, maxY: H - 48 };
  const growthScale = options.growthScale ?? 1;
  const branchScale = options.branchScale ?? 1;
  const targetProvider = options.targetProvider || (() => null);
  const avoidanceProvider = options.avoidanceProvider || (() => ({ x: 0, y: 0 }));

  if (network.pointCount >= network.maxPoints) exhaustPointBudget(network, options);

  if (!network.exhausted) {
    for (const tip of [...network.tips]) {
      if (!tip.active) continue;
      if (network.pointCount >= network.maxPoints) {
        exhaustPointBudget(network, options);
        break;
      }

      tip.age += dt;
      const target = targetProvider(tip, network);
      const noise = smoothHyphalNoise(tip.x, tip.y, time, tip.seed);
      let desired = tip.angle + noise * profile.noise;
      let targetDistance = Infinity;
      let direct = tip.angle;

      if (target) {
        const dx = target.x - tip.x;
        const dy = target.y - tip.y;
        targetDistance = Math.max(1, Math.hypot(dx, dy));
        direct = Math.atan2(dy, dx);
        if (tip.mode === 'coil' && profile.enableCoil) {
          const orbitRadius = target.orbitRadius || profile.coilRadius;
          const orbit = clamp(1 - targetDistance / Math.max(1, orbitRadius * 1.45), 0, 1);
          const tangent = direct + tip.orbitSide * Math.PI * .5;
          desired += angleDelta(desired, tangent) * profile.coilSteer * (.3 + orbit * .7);
        } else {
          const range = target.range || profile.tropismRange;
          const strength = clamp(1 - targetDistance / range, profile.tropismMin, profile.tropismMax) * (target.strength || 1);
          desired += angleDelta(desired, direct) * strength;
        }
      }

      const avoid = avoidanceProvider(tip, network) || { x: 0, y: 0 };
      if (Math.abs(avoid.x) + Math.abs(avoid.y) > .001) {
        desired += angleDelta(desired, Math.atan2(avoid.y, avoid.x)) * (options.avoidanceStrength ?? .72);
      }

      tip.angle += angleDelta(tip.angle, desired) * clamp(dt * profile.steer, 0, 1);
      const baseSpeed = tip.depth === 0 ? profile.speed : Math.max(12, profile.childSpeed - tip.depth * 1.8);
      const coilScale = tip.mode === 'coil' ? profile.coilSpeedScale : 1;
      const proximityScale = target ? 1 + clamp(1 - targetDistance / 190, 0, 1) * .18 : 1;
      const step = baseSpeed * growthScale * coilScale * proximityScale * dt;
      tip.x += Math.cos(tip.angle) * step;
      tip.y += Math.sin(tip.angle) * step;
      tip.y = clamp(tip.y, bounds.minY, bounds.maxY);
      tip.totalDistance += step;
      tip.distanceSincePoint += step;

      if (tip.distanceSincePoint >= profile.pointSpacing) {
        tip.distanceSincePoint = 0;
        tip.points.push({ x: tip.x, y: tip.y, alive: 1 });
        network.pointCount++;
        options.onPoint?.(network, tip);
      }

      if (target) {
        const contactRadius = target.contactRadius || profile.contactRadius;
        if (targetDistance < contactRadius) {
          if (!tip.contact) {
            tip.contact = true;
            network.contacts.push({ x: target.x, y: target.y, life: 1, seed: tip.seed, kind: target.kind, targetId: target.id });
            options.onFirstContact?.(network, tip, target);
          }
          if (profile.enableCoil && tip.mode !== 'coil') {
            tip.mode = 'coil';
            tip.targetId = target.id ?? tip.targetId;
            tip.orbitSide = Math.random() < .5 ? -1 : 1;
            const daughters = options.coilDaughters ?? 2;
            for (let i = 0; i < daughters; i++) {
              const child = spawnBranch(network, tip, tip.angle + (i - (daughters - 1) / 2) * .52, 'coil');
              if (child) child.targetId = tip.targetId;
            }
          }
          if (tip.mode === 'coil') tip.coilTurns += Math.abs(angleDelta(tip.angle, direct)) * dt;
          options.onContact?.(network, tip, target, dt);
        }
      }

      const canBranch = options.canBranch
        ? options.canBranch(network, tip, target, targetDistance)
        : true;
      if (canBranch) maybeBranch(network, tip, profile, tip.mode === 'coil' ? branchScale * 1.65 : branchScale);
      if (tip.x < bounds.minX || tip.x > bounds.maxX || tip.y <= bounds.minY || tip.y >= bounds.maxY) tip.active = false;
      if (tip.points.length > 760) tip.active = false;
    }
  }

  for (const contact of network.contacts) contact.life = Math.max(0, contact.life - dt * .12);
  for (const enzyme of network.enzymes) { enzyme.life -= dt * .6; enzyme.r += dt * 14; }
  for (let i = network.enzymes.length - 1; i >= 0; i--) if (network.enzymes[i].life <= 0) network.enzymes.splice(i, 1);
  for (const fragment of network.fragments) {
    fragment.x += fragment.vx * dt; fragment.y += fragment.vy * dt;
    fragment.vx *= Math.pow(.18, dt); fragment.vy += 32 * dt; fragment.life -= dt * .35;
  }
  for (let i = network.fragments.length - 1; i >= 0; i--) if (network.fragments[i].life <= 0) network.fragments.splice(i, 1);
}

export function renderHyphalNetwork(ctx, network, state, style = {}) {
  const profile = network.profile;
  const color = style.color || profile.color;
  const core = style.core || profile.core;
  const tipColor = style.tip || profile.tip;
  const fade = network.fading > 0 ? clamp(1 - network.fading, 0, 1) : 1;
  ctx.save();
  ctx.translate(-state.cameraX, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const tip of network.tips) {
    if (tip.points.length < 2) continue;
    const alpha = (tip.active ? .9 : .5) * fade;
    ctx.beginPath();
    tip.points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.shadowBlur = style.shadowBlur ?? 12;
    ctx.shadowColor = color;
    ctx.strokeStyle = colorWithAlpha(color, alpha * .28);
    ctx.lineWidth = Math.max(1.3, (style.haloWidth || profile.haloWidth) - tip.depth * .75);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = colorWithAlpha(core, alpha);
    ctx.lineWidth = Math.max(.7, (style.coreWidth || profile.coreWidth) - tip.depth * .22);
    ctx.stroke();
    if (tip.active) {
      ctx.shadowBlur = style.tipBlur ?? 16;
      ctx.shadowColor = color;
      ctx.fillStyle = tipColor;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 2.7 + Math.sin(state.time * 5 + tip.seed) * .65, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  for (const enzyme of network.enzymes) {
    ctx.globalAlpha = clamp(enzyme.life, 0, 1) * fade;
    const gradient = ctx.createRadialGradient(enzyme.x, enzyme.y, 0, enzyme.x, enzyme.y, enzyme.r);
    gradient.addColorStop(0, 'rgba(186,246,111,.36)');
    gradient.addColorStop(1, 'rgba(186,246,111,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(enzyme.x, enzyme.y, enzyme.r, 0, TAU); ctx.fill();
  }
  for (const fragment of network.fragments) {
    ctx.globalAlpha = clamp(fragment.life, 0, 1) * fade;
    ctx.fillStyle = fragment.color || '#ff8297';
    ctx.beginPath(); ctx.arc(fragment.x, fragment.y, fragment.r || 2.2, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawArbuscule(ctx, contact, time, color = '#d6afff') {
  const life = clamp(contact.life ?? 1, 0, 1);
  ctx.save();
  ctx.translate(contact.x, contact.y);
  ctx.globalAlpha = .3 + life * .7;
  ctx.strokeStyle = color;
  ctx.shadowBlur = 10;
  ctx.shadowColor = color;
  ctx.lineWidth = 1.25;
  const branches = 7;
  for (let i = 0; i < branches; i++) {
    const a = -Math.PI * .92 + i / (branches - 1) * Math.PI * .84;
    const length = 12 + (i % 3) * 4 + Math.sin(time * 2 + contact.seed + i) * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(Math.cos(a) * length * .35, Math.sin(a) * length * .4, Math.cos(a + .18) * length * .72, Math.sin(a + .18) * length * .78, Math.cos(a) * length, Math.sin(a) * length);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * length * .58, Math.sin(a) * length * .58);
    ctx.lineTo(Math.cos(a + .32) * length * .88, Math.sin(a + .32) * length * .86);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.restore();
}

function colorWithAlpha(color, alpha) {
  if (color.startsWith('rgba(')) return color;
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const value = hex.length === 3 ? hex.split('').map(character => character + character).join('') : hex;
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return `rgba(${red},${green},${blue},${alpha})`;
  }
  return color;
}
