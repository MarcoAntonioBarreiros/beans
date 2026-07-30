import { H } from '../core/constants.js';
import { createMicrobeEcology, MICROBE_MOTION_PROFILES } from './microbe-ecology.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const PROFILE_TUNING = {
  rhizobium: { homePull: .58, cohesion: .065, alignment: .045, wander: .72, turbulence: 68, taxis: 92 },
  azospirillum: { homePull: .62, cohesion: .05, alignment: .035, wander: .92, turbulence: 96, taxis: 108 },
  bacillus: { homePull: .52, cohesion: .085, alignment: .05, wander: .58, turbulence: 52, taxis: 70 },
  pseudomonas: { homePull: .6, cohesion: .045, alignment: .03, wander: .9, turbulence: 88, taxis: 112 },
  oportunista: { homePull: .42, cohesion: .025, alignment: .015, wander: 1.18, turbulence: 78, taxis: 62 },
  trichoderma: { homePull: .46, cohesion: .03, alignment: .018, wander: 1.05, turbulence: 72, taxis: 74 },
};

const ROAMING_DISTANCE = {
  rhizobium: 900,
  azospirillum: 1320,
  bacillus: 720,
  pseudomonas: 1240,
  oportunista: 1650,
  trichoderma: 1180,
};

const MIGRATION_INTERVAL = {
  rhizobium: [5.2, 8.7],
  azospirillum: [3.8, 6.3],
  bacillus: [7.2, 11.5],
  pseudomonas: [4.1, 7.1],
  oportunista: [5.5, 9.8],
  trichoderma: [5.8, 9.4],
};

function centroid(agents) {
  if (!agents.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const agent of agents) {
    x += agent.x;
    y += agent.y;
  }
  return { x: x / agents.length, y: y / agents.length };
}

function smoothField(x, y, time, seed) {
  const n1 = Math.sin(x * .0073 + time * .71 + seed * 1.13);
  const n2 = Math.cos(y * .0091 - time * .53 + seed * 1.91);
  const n3 = Math.sin((x + y) * .0038 + time * .29 + seed * .47);
  const n4 = Math.cos((x - y) * .0047 - time * .37 + seed * 2.17);
  const angle = (n1 + n2 * .72 + n3 * .54 + n4 * .38) * 1.85 + seed;
  const pulse = .62 + .38 * Math.sin(time * .83 + seed * 3.1 + x * .002);
  return { x: Math.cos(angle) * pulse, y: Math.sin(angle) * pulse };
}

function quadraticPoint(a, c, b, t) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

function nearestPointOnRect(x, y, rect) {
  return {
    x: clamp(x, rect.x, rect.x + rect.w),
    y: clamp(y, rect.y, rect.y + rect.h),
  };
}

export function createRoamingMicrobeEcology({ state, entities }) {
  for (const [type, values] of Object.entries(PROFILE_TUNING)) {
    const profile = MICROBE_MOTION_PROFILES[type];
    if (!profile) continue;
    Object.assign(profile, values);
    profile.separation = Math.max(profile.separation || 1, 1.55);
  }

  const base = createMicrobeEcology({ state, entities });
  const niches = [];
  const groups = new Map();
  const dormantEncounters = [];
  let hasSeenCard = () => false;

  function setTutorialCardSeenResolver(resolver) {
    hasSeenCard = typeof resolver === 'function' ? resolver : () => false;
  }

  function buildNiches() {
    niches.length = 0;
    state.level.platforms.forEach((platform, index) => {
      if (platform.w < 62) return;
      const lift = 58 + ((index * 41) % 104);
      niches.push({
        x: platform.x + platform.w / 2,
        y: clamp(platform.y - lift, 74, H - 104),
        kind: platform.final ? 'goal-root' : 'root',
        platformIndex: index,
        recovery: Boolean(platform.recovery),
      });
    });
    state.level.exudates.forEach((exudate, index) => {
      niches.push({
        x: exudate.x,
        y: clamp(exudate.y - 28, 70, H - 104),
        kind: 'exudate',
        resourceIndex: index,
        recovery: false,
      });
    });
    state.level.crystals.forEach((crystal, index) => {
      niches.push({
        x: crystal.x + crystal.w / 2,
        y: clamp(crystal.y - 42, 72, H - 110),
        kind: 'mineral',
        mineralIndex: index,
        recovery: false,
      });
    });
    if (state.level.goal) {
      niches.push({
        x: state.level.goal.x,
        y: state.level.goal.y + 34,
        kind: 'goal-root',
        recovery: false,
      });
    }
  }

  function nearestNicheIndex(x, y, includeRecovery = true) {
    let best = 0;
    let bestDistance = Infinity;
    niches.forEach((niche, index) => {
      if (!includeRecovery && niche.recovery) return;
      const distance = Math.hypot(niche.x - x, (niche.y - y) * 1.25);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  function randomInterval(type) {
    const [min, max] = MIGRATION_INTERVAL[type] || [6, 10];
    return min + Math.random() * (max - min);
  }

  function nichePreference(type, niche) {
    let weight = 1;
    if (niche.kind === 'exudate' && ['rhizobium', 'azospirillum', 'pseudomonas'].includes(type)) weight += 4.2;
    if (niche.kind === 'mineral' && type === 'pseudomonas') weight += 4.8;
    if ((niche.kind === 'root' || niche.kind === 'goal-root') && ['rhizobium', 'azospirillum', 'bacillus'].includes(type)) weight += 2.4;
    if (niche.recovery && !['oportunista', 'trichoderma'].includes(type)) weight *= .25;
    return weight;
  }

  function chooseNextNiche(group, center, forceDifferent = false) {
    const distanceLimit = group.territory || ROAMING_DISTANCE[group.type] || 900;
    const candidates = [];
    niches.forEach((niche, index) => {
      if (forceDifferent && index === group.toIndex) return;
      const dx = niche.x - center.x;
      const dy = niche.y - center.y;
      const distance = Math.hypot(dx, dy * 1.2);
      if (distance < 150 || distance > distanceLimit) return;
      let weight = nichePreference(group.type, niche);
      if (Math.sign(dx || group.direction) === group.direction) weight += 1.35;
      if (Math.abs(dy) > 85) weight += .9;
      if (Math.abs(dy) > 180) weight += .45;
      candidates.push({ index, weight });
    });

    if (!candidates.length) {
      group.direction *= -1;
      return nearestNicheIndex(center.x + group.direction * Math.min(420, distanceLimit * .45), center.y - 90, false);
    }

    const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    let roll = Math.random() * total;
    for (const candidate of candidates) {
      roll -= candidate.weight;
      if (roll <= 0) return candidate.index;
    }
    return candidates[candidates.length - 1].index;
  }

  function beginLeg(group, center) {
    group.fromIndex = group.toIndex;
    group.toIndex = chooseNextNiche(group, center, true);
    group.progress = 0;
    group.duration = randomInterval(group.type);
    group.direction = Math.sign((niches[group.toIndex]?.x || center.x) - center.x) || group.direction;
    const a = niches[group.fromIndex] || center;
    const b = niches[group.toIndex] || center;
    group.curve = {
      x: (a.x + b.x) / 2 + (Math.random() - .5) * 190,
      y: clamp((a.y + b.y) / 2 + (Math.random() - .5) * 260, 80, H - 120),
    };
  }

  function applyGroupRoute(group) {
    const from = niches[group.fromIndex];
    const to = niches[group.toIndex];
    if (!from || !to) return;
    const groupAgents = base.agents.filter(agent => agent.zoneIndex === group.zoneIndex);
    groupAgents.forEach((agent, index) => {
      const lag = agent.routeLag || 0;
      const localT = clamp(group.progress - lag, 0, 1);
      const eased = localT * localT * (3 - 2 * localT);
      const point = quadraticPoint(from, group.curve, to, eased);
      const ahead = quadraticPoint(from, group.curve, to, clamp(eased + .025, 0, 1));
      const dx = ahead.x - point.x;
      const dy = ahead.y - point.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / d;
      const ny = dx / d;
      const wave = Math.sin(state.time * agent.individualRate + agent.noiseSeed) * agent.lateral;
      const field = smoothField(point.x, point.y, state.time * .65, agent.noiseSeed);
      const spread = wave + (index - (groupAgents.length - 1) / 2) * 4.5;
      agent.homeX = point.x + nx * spread + field.x * agent.turbulence * .22;
      agent.homeY = point.y + ny * spread + field.y * agent.turbulence * .18;
      agent.radius = Math.max(agent.radius, 230);
    });
  }

  function configureAgent(agent, index) {
    const profile = PROFILE_TUNING[agent.type] || {};
    agent.routeLag = Math.random() * .16;
    agent.lateral = 18 + Math.random() * 62;
    agent.turbulence = (profile.turbulence || 60) * (.55 + Math.random() * .8);
    agent.individualRate = .55 + Math.random() * 1.35;
    agent.noiseSeed = Math.random() * TAU + index * .173;
    agent.taxisSensitivity = (profile.taxis || 70) * (.65 + Math.random() * .7);
  }

  function initializeGroup(zone, zoneIndex) {
    const zoneAgents = base.agents.filter(agent => agent.zoneIndex === zoneIndex);
    if (!zoneAgents.length || !niches.length) return;
    const center = centroid(zoneAgents);
    const start = nearestNicheIndex(center.x, center.y, false);
    const group = {
      zoneIndex,
      type: zone.id,
      territory: zone.territory || ROAMING_DISTANCE[zone.id] || 900,
      fromIndex: start,
      toIndex: start,
      progress: 1,
      duration: randomInterval(zone.id),
      direction: Math.random() < .5 ? -1 : 1,
      curve: { x: center.x, y: center.y },
      cardId: zone.cardId || null,
      tethered: Boolean(zone.tetherUntilSeen && zone.cardId && !hasSeenCard(zone.cardId)),
      anchorX: zone.x,
      anchorY: zone.y - 32,
      tetherRadius: zone.tetherRadius || 165,
    };
    groups.set(zoneIndex, group);
    if (!group.tethered) beginLeg(group, center);
  }

  function reset(encounters) {
    dormantEncounters.length = 0;
    const activeEncounters = [];
    for (const encounter of encounters) {
      if (encounter.requiresSeenCardId && !hasSeenCard(encounter.requiresSeenCardId)) {
        dormantEncounters.push({ ...encounter });
      } else {
        activeEncounters.push(encounter);
      }
    }
    base.reset(activeEncounters);
    buildNiches();
    groups.clear();

    base.agents.forEach(configureAgent);

    base.encounters.forEach((zone, zoneIndex) => {
      initializeGroup(zone, zoneIndex);
    });
    for (const group of groups.values()) if (!group.tethered) applyGroupRoute(group);
  }

  function clear() {
    groups.clear();
    niches.length = 0;
    dormantEncounters.length = 0;
    base.clear();
  }

  function activateSeenEncounters() {
    for (let index = dormantEncounters.length - 1; index >= 0; index--) {
      const encounter = dormantEncounters[index];
      if (!hasSeenCard(encounter.requiresSeenCardId)) continue;
      dormantEncounters.splice(index, 1);
      const firstAgent = base.agents.length;
      const zone = base.addEncounter(encounter);
      base.agents.slice(firstAgent).forEach((agent, offset) => configureAgent(agent, firstAgent + offset));
      initializeGroup(zone, zone.index);
    }
  }

  function nearestAttractor(agent) {
    const candidates = [];
    if (['rhizobium', 'azospirillum', 'pseudomonas'].includes(agent.type)) {
      state.level.exudates.forEach(exudate => {
        if (!exudate.taken) candidates.push({ x: exudate.x, y: exudate.y, strength: 1.25 });
      });
    }
    if (agent.type === 'pseudomonas') {
      state.level.crystals.forEach(crystal => {
        if (!crystal.broken) candidates.push({ x: crystal.x + crystal.w / 2, y: crystal.y + crystal.h * .25, strength: 1.1 });
      });
    }
    if (['rhizobium', 'azospirillum', 'bacillus'].includes(agent.type)) {
      const nearbyPlatforms = state.level.platforms.filter(p => Math.abs((p.x + p.w / 2) - agent.x) < 520);
      nearbyPlatforms.forEach(p => candidates.push({ x: clamp(agent.x, p.x + 12, p.x + p.w - 12), y: p.y - 46, strength: .55 }));
    }
    if (agent.type === 'oportunista') {
      candidates.push({ x: state.player.x + state.player.w / 2, y: state.player.y + state.player.h / 2, strength: .62 });
    }
    if (agent.type === 'trichoderma') {
      base.agents.forEach(other => {
        if (other.type === 'oportunista') candidates.push({ x: other.x, y: other.y, strength: 1.05 });
      });
    }

    let best = null;
    let bestScore = Infinity;
    candidates.forEach(candidate => {
      const distance = Math.hypot(candidate.x - agent.x, candidate.y - agent.y);
      const score = distance / candidate.strength;
      if (distance < 620 && score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    return best;
  }

  function applyContinuousFields(dt) {
    for (const agent of base.agents) {
      if (agent.rootedFungus) continue;
      const tuning = PROFILE_TUNING[agent.type] || PROFILE_TUNING.rhizobium;
      const field = smoothField(agent.x, agent.y, state.time, agent.noiseSeed);
      let fx = field.x * agent.turbulence;
      let fy = field.y * agent.turbulence;

      const attractor = nearestAttractor(agent);
      if (attractor) {
        const dx = attractor.x - agent.x;
        const dy = attractor.y - agent.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const gradient = clamp(1 - distance / 620, 0, 1);
        fx += dx / distance * agent.taxisSensitivity * gradient * attractor.strength;
        fy += dy / distance * agent.taxisSensitivity * gradient * attractor.strength;
      }

      for (const hazard of state.level.hazards) {
        const point = nearestPointOnRect(agent.x, agent.y, hazard);
        const dx = agent.x - point.x;
        const dy = agent.y - point.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        if (distance < 150) {
          const force = (1 - distance / 150) * 270;
          fx += dx / distance * force;
          fy += dy / distance * force - 75;
        }
      }

      if (agent.type !== 'oportunista') {
        for (const enemy of state.level.enemies) {
          if (!enemy.alive) continue;
          const ex = enemy.x + enemy.w / 2;
          const ey = enemy.y + enemy.h / 2;
          const dx = agent.x - ex;
          const dy = agent.y - ey;
          const distance = Math.max(1, Math.hypot(dx, dy));
          if (distance < 230) {
            const force = (1 - distance / 230) * 225;
            fx += dx / distance * force;
            fy += dy / distance * force;
          }
        }
      }

      const response = dt * (agent.type === 'bacillus' ? .34 : .48);
      agent.vx += fx * response;
      agent.vy += fy * response;
      const maxSpeed = (MICROBE_MOTION_PROFILES[agent.type]?.speed || 70) * 1.45;
      const speed = Math.hypot(agent.vx, agent.vy);
      if (speed > maxSpeed) {
        agent.vx = agent.vx / speed * maxSpeed;
        agent.vy = agent.vy / speed * maxSpeed;
      }
      agent.angle = Math.atan2(agent.vy, agent.vx);
      agent.x += fx * dt * dt * .22;
      agent.y += fy * dt * dt * .22;
      agent.y = clamp(agent.y, 48, H - 48);
      agent.homeX += field.x * tuning.wander * 7;
      agent.homeY += field.y * tuning.wander * 5;
    }
  }

  function update(dt) {
    activateSeenEncounters();
    for (const group of groups.values()) {
      const groupAgents = base.agents.filter(agent => agent.zoneIndex === group.zoneIndex);
      if (!groupAgents.length) continue;
      if (group.tethered && hasSeenCard(group.cardId)) {
        group.tethered = false;
        beginLeg(group, centroid(groupAgents));
      }
      if (group.tethered) {
        for (const agent of groupAgents) {
          agent.homeX = group.anchorX;
          agent.homeY = group.anchorY;
          agent.radius = Math.min(agent.radius, group.tetherRadius);
        }
        continue;
      }
      group.progress += dt / Math.max(1.8, group.duration);
      if (group.progress >= 1) beginLeg(group, centroid(groupAgents));
      applyGroupRoute(group);
    }

    base.update(dt);
    applyContinuousFields(dt);

    for (const group of groups.values()) {
      if (!group.tethered) continue;
      const groupAgents = base.agents.filter(agent => agent.zoneIndex === group.zoneIndex);
      for (const agent of groupAgents) {
        const dx = agent.x - group.anchorX;
        const dy = agent.y - group.anchorY;
        const distance = Math.max(1, Math.hypot(dx, dy));
        if (distance <= group.tetherRadius) continue;
        agent.x = group.anchorX + dx / distance * group.tetherRadius;
        agent.y = group.anchorY + dy / distance * group.tetherRadius;
        agent.vx *= .25;
        agent.vy *= .25;
      }
    }

    for (const group of groups.values()) {
      const groupAgents = base.agents.filter(agent => agent.zoneIndex === group.zoneIndex);
      const zone = base.encounters[group.zoneIndex];
      if (!zone || !groupAgents.length) continue;
      if (group.tethered) {
        zone.x = group.anchorX;
        zone.y = group.anchorY;
        continue;
      }
      const center = centroid(groupAgents);
      zone.x = center.x;
      zone.y = center.y;
      zone.r = Math.max(zone.r || 145, 185);
    }
  }

  return {
    get active() { return base.active; },
    get agents() { return base.agents; },
    get encounters() { return base.encounters; },
    get nicheCount() { return niches.length; },
    get tetheredDebutCount() { return [...groups.values()].filter(group => group.tethered).length; },
    get dormantEncounterCount() { return dormantEncounters.length; },
    clear,
    reset,
    setTutorialCardSeenResolver,
    update,
    render: base.render,
  };
}
