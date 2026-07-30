import { H } from '../core/constants.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createTrichodermaRecruitment({ state, ecology, entities }) {
  const followDuration = 32;
  const maxFollowers = 4;
  let lastToastAt = -Infinity;

  function recruitedAgents() {
    return ecology.agents.filter(agent => (
      agent.type === 'trichoderma'
      && (agent.recruitedUntil || 0) > state.time
    ));
  }

  function releaseAgent(agent) {
    agent.recruitedUntil = 0;
    agent.followSlot = null;
    agent.recruitSource = null;
  }

  function clear() {
    for (const agent of ecology.agents) {
      if (agent.type === 'trichoderma') releaseAgent(agent);
    }
  }

  function reset() {
    clear();
    lastToastAt = -Infinity;
  }

  function recruitFromClouds() {
    const clouds = state.level.exudateClouds || [];
    let followers = recruitedAgents();

    for (const cloud of clouds) {
      if (!cloud.recruitedTrichoderma) cloud.recruitedTrichoderma = new Set();
      const candidates = ecology.agents
        .filter(agent => (
          agent.type === 'trichoderma'
          && !agent.hyphalAttack
          && Math.hypot(agent.x - cloud.x, agent.y - cloud.y) < Math.max(62, cloud.radius * .78)
        ))
        .sort((a, b) => (
          Math.hypot(a.x - cloud.x, a.y - cloud.y)
          - Math.hypot(b.x - cloud.x, b.y - cloud.y)
        ));

      for (const agent of candidates) {
        const alreadyFollowing = (agent.recruitedUntil || 0) > state.time;
        if (!alreadyFollowing && followers.length >= maxFollowers) break;

        agent.recruitedUntil = Math.max(agent.recruitedUntil || 0, state.time + followDuration);
        agent.recruitSource = cloud.id;
        if (agent.followSlot == null) agent.followSlot = followers.length;
        if (!followers.includes(agent)) followers.push(agent);

        if (!cloud.recruitedTrichoderma.has(agent.id)) {
          cloud.recruitedTrichoderma.add(agent.id);
          entities.burst(agent.x, agent.y, '#baf66f', 16, 105);
          // MESMA marca do recrutamento benéfico, de propósito: uma nuvem que
          // atrai Bacillus e Trichoderma no mesmo período dá um único
          // feedback de "os organismos começaram a seguir", não dois.
          if (!alreadyFollowing && !cloud.interactionRecruitmentAudioPlayed) {
            cloud.interactionRecruitmentAudioPlayed = true;
            entities.interactionFx?.('microbeRecruitment', {
              gain: 1, rate: 1, instanceId: `cloud:${cloud.id}`,
            });
          }
          entities.discoverMicrobe?.('trichoderma', false, { sound: false });
          if (state.time - lastToastAt > 2.5) {
            state.toast = 'Trichoderma recrutado: a colônia seguirá o gradiente de Miguelito e poderá atacar novos alvos';
            state.toastTime = 4.8;
            lastToastAt = state.time;
          }
        }
      }
    }
  }

  function followPlayer(dt) {
    const followers = recruitedAgents();
    const playerX = state.player.x + state.player.w / 2;
    const playerY = state.player.y + state.player.h / 2;

    followers.forEach((agent, index) => {
      agent.followSlot = index;
      if (agent.hyphalAttack) {
        agent.recruitedUntil = Math.max(agent.recruitedUntil, state.time + 10);
        return;
      }

      const row = Math.floor(index / 2);
      const side = index % 2 ? 1 : -1;
      const targetX = playerX - state.player.facing * (74 + row * 26) + side * (24 + row * 6);
      const targetY = clamp(playerY - 48 - row * 24 + Math.sin(state.time * 2.1 + index) * 12, 64, H - 70);
      const dx = targetX - agent.x;
      const dy = targetY - agent.y;
      const distance = Math.max(1, Math.hypot(dx, dy));

      if (distance > 720) {
        agent.x = targetX + side * 18;
        agent.y = targetY;
        agent.vx = 0;
        agent.vy = 0;
        entities.burst(agent.x, agent.y, '#8df0a8', 10, 70);
      } else {
        const desiredSpeed = Math.min(210, 52 + distance * 1.45);
        const desiredVX = dx / distance * desiredSpeed;
        const desiredVY = dy / distance * desiredSpeed;
        const response = clamp(dt * 6.4, 0, 1);
        agent.vx += (desiredVX - agent.vx) * response;
        agent.vy += (desiredVY - agent.vy) * response;
        agent.x += dx * clamp(dt * 2.35, 0, .16);
        agent.y += dy * clamp(dt * 2.1, 0, .14);
      }

      agent.homeX = targetX;
      agent.homeY = targetY;
      agent.radius = Math.max(agent.radius || 0, 260);
      agent.angle = Math.atan2(agent.vy, agent.vx);
    });

    for (const agent of ecology.agents) {
      if (agent.type !== 'trichoderma') continue;
      if ((agent.recruitedUntil || 0) <= state.time && !agent.hyphalAttack) releaseAgent(agent);
    }
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    recruitFromClouds();
    followPlayer(dt);
  }

  return {
    get followerCount() { return recruitedAgents().length; },
    clear,
    reset,
    update,
  };
}
