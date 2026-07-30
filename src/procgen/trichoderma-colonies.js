import { H } from '../core/constants.js';
import { organismSprites } from '../render/organism-sprites.js';
import { COLONY_ESTABLISHMENT_GROWTH } from '../audio-manifest.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function nearestSubstrate(state, x, y, maxDistance = 150) {
  let best = null;
  let bestDistance = maxDistance;
  for (const platform of state.level.platforms || []) {
    if (platform.final) continue;
    const pointX = clamp(x, platform.x + 16, platform.x + platform.w - 16);
    const pointY = platform.y - 7;
    const distance = Math.hypot(pointX - x, pointY - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: pointX, y: pointY, platform };
    }
  }
  return best;
}

export function createTrichodermaColonies({ state, input, ecology, entities }) {
  const colonies = [];
  let nextColonyId = 1;
  let eHeldLast = false;
  let suppressEUntilRelease = false;
  let activeSelection = null;

  function recruitedFollowers() {
    return ecology.agents.filter(agent => (
      agent.type === 'trichoderma'
      && !agent.hyphalAttack
      && (agent.recruitedUntil || 0) > state.time
    ));
  }

  function removeAgent(agent) {
    const index = ecology.agents.indexOf(agent);
    if (index >= 0) ecology.agents.splice(index, 1);
  }

  function createColony({ x, y, agents = [], natural = false }) {
    const support = nearestSubstrate(state, x, y);
    const count = Math.max(1, agents.length || 1);
    const colony = {
      id: `tricho-colony-${nextColonyId++}`,
      x: support?.x ?? x,
      y: support?.y ?? clamp(y, 72, H - 72),
      platform: support?.platform || null,
      vigor: natural ? .62 : clamp(.48 + count * .13, 0, 1),
      growth: .08,
      age: 0,
      sourceCount: count,
      natural,
      activeTargetId: null,
      cooldownUntil: 0,
      kills: 0,
      stage: 'inoculated',
      exhausted: false,
      // Germinação natural não é ação do jogador: nasce já "estabelecida" para
      // não imitar o feedback de uma inoculação manual.
      audioEstablished: natural,
      rechargeIntensity: 0,
      phase: Math.random() * TAU,
    };
    colonies.push(colony);
    for (const agent of agents) removeAgent(agent);
    entities.discoverMicrobe?.('trichoderma', false, { sound: false });
    entities.burst(colony.x, colony.y, '#8df0a8', 28 + count * 4, 145);
    return colony;
  }

  function depositFollowers() {
    const followers = recruitedFollowers();
    if (!followers.length) return false;
    const player = state.player;
    const x = player.x + player.w / 2 + player.facing * 42;
    const y = player.y + player.h - 2;
    const colony = createColony({ x, y, agents: followers, natural: false });
    // Depois da colônia existir e dos agentes saírem da lista móvel. Uma vez por
    // ação — `inoculateNaturalAgent` não passa por aqui, e não deve: germinação
    // natural não é uso do inoculante carregado.
    entities.interactionFx?.('inoculationPlace', { gain: 1, rate: 1, instanceId: colony.id });
    state.toast = `Trichoderma inoculado: ${followers.length} propágulo${followers.length > 1 ? 's' : ''} formaram uma colônia fixa com vigor persistente`;
    state.toastTime = 5.2;
    colony.stage = 'ready';
    return true;
  }

  function inoculateNaturalAgent(agent) {
    if (!agent || agent.type !== 'trichoderma') return null;
    if ((agent.recruitedUntil || 0) > state.time || agent.hyphalAttack) return null;
    return createColony({ x: agent.x, y: agent.y, agents: [agent], natural: true });
  }

  function prepare() {
    const pressed = Boolean(input.keys.KeyE);
    // Com seletor ativo, o Trichoderma so responde ao E quando ele e o escolhido.
    if (activeSelection && !activeSelection.isSelected('trichoderma')) {
      eHeldLast = pressed;
      return;
    }
    if (pressed && !eHeldLast && state.gameState === 'play' && depositFollowers()) {
      suppressEUntilRelease = true;
    }
    if (suppressEUntilRelease && pressed) input.keys.KeyE = false;
    if (!pressed) suppressEUntilRelease = false;
    eHeldLast = pressed;
  }

  function cloudIntensity(colony) {
    let best = 0;
    for (const cloud of state.level.exudateClouds || []) {
      const distance = Math.hypot(cloud.x - colony.x, cloud.y - colony.y);
      const range = Math.max(135, cloud.radius * 2.1);
      if (distance >= range) continue;
      const life = clamp(cloud.life / Math.max(.1, cloud.maxLife || 10), 0, 1);
      best = Math.max(best, (1 - distance / range) * (.48 + life * .52));
    }
    return best;
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    for (const colony of colonies) {
      colony.age += dt;
      const previousGrowth = colony.growth;
      colony.growth = clamp(colony.growth + dt * .34, 0, 1);
      // Primeira passagem pelo limiar de aderência, só para colônia inoculada
      // pelo jogador. Reativação, ataque e crescimento contínuo não tocam.
      if (
        !colony.audioEstablished
        && previousGrowth < COLONY_ESTABLISHMENT_GROWTH
        && colony.growth >= COLONY_ESTABLISHMENT_GROWTH
      ) {
        const result = entities.interactionFx?.('colonyEstablished', {
          gain: 1, rate: 1, instanceId: colony.id,
        });
        if (result?.state !== 'rejected') colony.audioEstablished = true;
      }
      const fuel = cloudIntensity(colony);
      colony.rechargeIntensity = fuel;
      if (fuel > .02) {
        colony.vigor = clamp(colony.vigor + dt * (.035 + fuel * .13), 0, 1);
        // Transicao exhausted true -> false por exsudato. O combustivel continuo
        // mantem `exhausted` em false depois disso, entao nao repete.
        if (colony.vigor > .1 && colony.exhausted) {
          colony.exhausted = false;
          colony.stage = 'ready';
          entities?.audio?.play('trichodermaReactivation', { x: colony.x, y: colony.y });
          entities.burst(colony.x, colony.y, '#d6ff94', 14, 85);
        }
      }
      if (!colony.activeTargetId && !colony.exhausted && state.time >= colony.cooldownUntil) {
        colony.stage = 'ready';
      }
    }
  }

  function drawColony(ctx, colony) {
    const growth = colony.growth;
    const pulse = 1 + Math.sin(state.time * 2.2 + colony.phase) * .05;
    const radius = (18 + colony.sourceCount * 2.8) * growth * pulse;
    ctx.save();
    ctx.translate(colony.x, colony.y);

    const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, radius * 2.8);
    halo.addColorStop(0, `rgba(141,240,168,${.2 + colony.vigor * .22})`);
    halo.addColorStop(1, 'rgba(141,240,168,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 2.8, 0, TAU);
    ctx.fill();

    const spriteDrawn = organismSprites.draw(ctx, 'trichoderma', {
      x: 0,
      y: 3,
      height: 70 * Math.max(.35, growth),
      time: state.time,
      phase: colony.phase,
      alpha: colony.exhausted ? .42 : .72 + colony.vigor * .28,
      anchorY: .82,
      flipX: Math.sin(colony.phase) < 0,
    });
    if (spriteDrawn) {
      ctx.save();
      ctx.globalAlpha = 0;
    }
    ctx.strokeStyle = colony.exhausted ? 'rgba(255,130,151,.58)' : 'rgba(184,255,198,.72)';
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 7; i++) {
      const angle = -Math.PI + i / 6 * Math.PI;
      const length = radius * (.72 + (i % 3) * .16);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(angle) * length * .45, -4 - (i % 2) * 5, Math.cos(angle) * length, Math.sin(angle) * length * .28 - 3);
      ctx.stroke();
    }

    for (let i = 0; i < 8 + colony.sourceCount * 2; i++) {
      const angle = i / (8 + colony.sourceCount * 2) * TAU + colony.phase;
      const rr = radius * (.22 + (i % 4) * .17);
      ctx.fillStyle = i % 3 ? '#8df0a8' : '#ecfff1';
      ctx.globalAlpha = colony.exhausted ? .35 : .62 + (i % 3) * .1;
      ctx.beginPath();
      ctx.ellipse(Math.cos(angle) * rr, -5 + Math.sin(angle) * rr * .42, 3.8, 2.6, angle, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (spriteDrawn) ctx.restore();

    const width = 52;
    const barY = radius + 12;
    ctx.fillStyle = 'rgba(3,18,24,.82)';
    ctx.fillRect(-width / 2 - 2, barY - 2, width + 4, 8);
    ctx.fillStyle = colony.vigor > .55 ? '#8df0a8' : colony.vigor > .24 ? '#ffd36f' : '#ff8297';
    ctx.fillRect(-width / 2, barY, width * clamp(colony.vigor, 0, 1), 4);
    if (colony.rechargeIntensity > .05) {
      ctx.strokeStyle = '#d6ff94';
      ctx.strokeRect(-width / 2 - 1, barY - 1, width + 2, 6);
    }
    ctx.font = '700 9px Inter,system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#effff5';
    const label = colony.exhausted ? 'colônia exaurida' : colony.activeTargetId ? 'colônia ativa' : 'colônia inoculada';
    ctx.fillText(label, 0, barY + 18);
    ctx.restore();
  }

  function render(ctx) {
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    for (const colony of colonies) drawColony(ctx, colony);
    ctx.restore();
  }

  function clear() {
    entities?.audio?.stopGroup('trichoderma-attack');
    colonies.length = 0;
    nextColonyId = 1;
    eHeldLast = false;
    suppressEUntilRelease = false;
  }

  function reset() { clear(); }

  function byId(id) {
    return colonies.find(colony => colony.id === id) || null;
  }

  return {
    setSelection(selection) { activeSelection = selection; },
    get colonies() { return colonies; },
    get followerCount() { return recruitedFollowers().length; },
    get colonyCount() { return colonies.length; },
    get vigorAverage() {
      if (!colonies.length) return 0;
      return colonies.reduce((sum, colony) => sum + colony.vigor, 0) / colonies.length;
    },
    byId,
    inoculateNaturalAgent,
    clear,
    reset,
    prepare,
    update,
    render,
  };
}
