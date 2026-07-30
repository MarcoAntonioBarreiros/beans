import { H, W } from '../core/constants.js';
import { fxLanded } from '../game-audio.js';
import { organismSprites } from '../render/organism-sprites.js';
import {
  clamp,
  createHyphalNetwork,
  drawArbuscule,
  renderHyphalNetwork,
  TAU,
  updateHyphalNetwork,
} from './hyphal-growth.js';

function nearestRootTarget(state, x, y, minDistance = 0) {
  let best = null;
  let bestDistance = Infinity;

  state.level.platforms.forEach((platform, index) => {
    const tx = clamp(x, platform.x + 12, platform.x + platform.w - 12);
    const ty = platform.y - 10;
    const distance = Math.hypot(tx - x, (ty - y) * 1.2);
    if (distance >= minDistance && distance < bestDistance && distance < 560) {
      best = {
        id: `root:${index}`,
        x: tx,
        y: ty,
        kind: 'root',
        platform,
        platformIndex: index,
        strength: platform.final ? 1.35 : 1,
        contactRadius: 20,
      };
      bestDistance = distance;
    }
  });

  state.level.exudates.forEach((exudate, index) => {
    if (exudate.taken) return;
    const distance = Math.hypot(exudate.x - x, exudate.y - y);
    if (distance >= minDistance && distance < bestDistance * .94 && distance < 620) {
      best = {
        id: `exudate:${index}`,
        x: exudate.x,
        y: exudate.y,
        kind: 'exudate',
        strength: 1.22,
        contactRadius: 18,
      };
      bestDistance = distance;
    }
  });

  (state.level.exudateClouds || []).forEach(cloud => {
    const distance = Math.hypot(cloud.x - x, cloud.y - y);
    if (distance >= minDistance && distance < bestDistance * .9 && distance < cloud.radius * 3.5) {
      best = {
        id: `cloud:${cloud.id}`,
        x: cloud.x,
        y: cloud.y,
        kind: 'exudate-cloud',
        strength: 1.42,
        contactRadius: Math.max(20, cloud.radius * .18),
      };
      bestDistance = distance;
    }
  });

  return best;
}

function avoidHazards(state, tip) {
  let fx = 0;
  let fy = 0;
  for (const hazard of state.level.hazards) {
    const px = clamp(tip.x, hazard.x, hazard.x + hazard.w);
    const py = clamp(tip.y, hazard.y, hazard.y + hazard.h);
    const dx = tip.x - px;
    const dy = tip.y - py;
    const distance = Math.max(1, Math.hypot(dx, dy));
    if (distance < 130) {
      const force = (1 - distance / 130) * 1.65;
      fx += dx / distance * force;
      fy += dy / distance * force - .42;
    }
  }
  return { x: fx, y: fy };
}

export function createMycorrhizaGrowth({ state, entities, inoculants = null }) {
  const networks = [];
  let active = false;
  let networkId = 0;
  let activeInoculants = inoculants;

  // A micorriza inoculada tem a mesma morfologia da que estreia no cenario:
  // emite hifas e forma arbusculos na raiz. Sem isto ela ficaria sendo apenas
  // uma colonia desenhada, sem a estrutura que a define.
  function spawnFromColonies() {
    for (const colony of activeInoculants?.colonies || []) {
      if (colony.type !== 'myco' || colony.dormant) continue;
      if (colony.growth < .68 || colony.vigor <= .05) continue;
      if (networks.some(network => network.colony === colony)) continue;
      networks.push({
        // Identidade estável da rede: sem ela, duas redes crescendo ao mesmo
        // tempo dividiriam a mesma voz de loop e o mesmo cooldown de contato.
        id: `myco-network-${++networkId}`,
        ally: null,
        colony,
        x: colony.x,
        y: colony.y,
        germination: 0,
        audioGerminated: false,
        pulse: Math.random() * TAU,
        hypha: null,
        arbuscules: [],
        exudateContacts: new Set(),
      });
      active = true;
    }
  }

  function exposeArbuscules() {
    state.level.mycorrhizaArbuscules = networks.flatMap(network => network.arbuscules);
  }

  function setInoculants(next) {
    activeInoculants = next;
  }

  function clear() {
    entities?.audio?.stopGroup('mycorrhiza-hypha');
    networks.length = 0;
    active = false;
    state.level.mycorrhizaArbuscules = [];
  }

  function reset() {
    clear();
    const allies = state.level.allies.filter(ally => ally.id === 'myco' && !ally.presentationOnly);
    for (const ally of allies) {
      networks.push({
        id: `myco-network-${++networkId}`,
        ally,
        x: ally.x,
        y: ally.y,
        germination: 0,
        audioGerminated: false,
        pulse: Math.random() * TAU,
        hypha: null,
        arbuscules: [],
        exudateContacts: new Set(),
      });
    }
    active = networks.length > 0;
    exposeArbuscules();
  }

  function ensureHypha(network) {
    if (network.hypha) return;
    const target = nearestRootTarget(state, network.x, network.y, 75);
    const angle = target ? Math.atan2(target.y - network.y, target.x - network.x) : -.25;
    network.hypha = createHyphalNetwork({
      kind: 'mycorrhiza',
      x: network.x,
      y: network.y,
      angle,
      seed: network.pulse,
      maxBranches: 18,
      maxPoints: 430,
      metadata: { ally: network.ally },
    });
  }

  function addArbuscule(network, target, seed) {
    if (network.arbuscules.some(contact => Math.hypot(contact.x - target.x, contact.y - target.y) < 38)) return;
    network.arbuscules.push({
      x: target.x,
      y: target.y + 4,
      seed,
      life: 1,
      maturity: 0,
      audioCompleted: false,
      targetId: target.id,
      platform: target.platform || null,
      platformIndex: target.platformIndex ?? null,
    });
    exposeArbuscules();
    entities.burst(target.x, target.y, '#d6afff', 16, 90);
    state.player.hope += .8;
  }

  function update(dt) {
    spawnFromColonies();
    if (!active) return;
    for (const network of networks) {
      // Uma rede inoculada acompanha a colonia: se ela se move ou e reposta, a
      // ancora vai junto.
      if (network.colony) {
        network.x = network.colony.x;
        network.y = network.colony.y;
      }
      const playerDistance = Math.hypot(
        state.player.x + state.player.w / 2 - network.x,
        state.player.y + state.player.h / 2 - network.y,
      );
      // A rede que nasce de inoculacao ja esta estabelecida: nao depende de o
      // jogador chegar perto nem de recolher um aliado do cenario.
      const established = Boolean(network.colony) || Boolean(network.ally?.taken);
      const awakened = established || playerDistance < 900;
      if (!awakened) continue;

      // Germinação: a transição é 0 → valor positivo, e acontece uma vez por
      // rede. Uma rede já estabelecida ao carregar a fase não passa por aqui com
      // germination em zero, então não toca.
      const hadGerminated = network.germination > 0;
      network.germination = clamp(network.germination + dt * (established ? .72 : .34), 0, 1);
      if (!hadGerminated && network.germination > 0 && !network.audioGerminated) {
        const entregue = entities?.audio
          ? fxLanded(entities.audio.play('mycorrhizaGermination', {
              x: network.x, y: network.y, instanceId: network.id,
            }))
          : true;
        if (entregue) network.audioGerminated = true;
      }
      if (network.germination > .16) ensureHypha(network);
      if (!network.hypha) continue;

      // Loop da rede hifal: uma voz por rede, ancorada entre a origem da colônia
      // e a ponta ativa mais próxima da câmera. Ganho pelas pontas ativas e pela
      // germinação — uma rede exausta não pode continuar soando como uma viva.
      const hyphaKey = `mycorrhiza-hypha:${network.id}`;
      const activeTips = (network.hypha.tips || []).filter(tip => tip.active);
      if (activeTips.length) {
        const cameraCenterX = (state.cameraX || 0) + W / 2;
        const nearestTip = activeTips.reduce(
          (best, tip) => (Math.abs(tip.x - cameraCenterX) < Math.abs(best.x - cameraCenterX) ? tip : best),
          activeTips[0],
        );
        const intensity = clamp(activeTips.length / 6, .25, 1) * clamp(network.germination, .2, 1);
        entities?.audio?.startLoop(hyphaKey, 'mycorrhizaHyphaGrowth', {
          x: (network.x + nearestTip.x) / 2,
          y: (network.y + nearestTip.y) / 2,
          gain: .5 + intensity * .5,
          rate: .94 + intensity * .10,
        });
      } else {
        // Sem ponta ativa a rede parou de crescer: o loop sai por fade.
        entities?.audio?.stopLoop(hyphaKey);
      }

      updateHyphalNetwork(network.hypha, dt, {
        time: state.time,
        bounds: { minX: 8, maxX: (state.level.endX || 6500) - 8, minY: 58, maxY: H - 48 },
        growthScale: established ? 1.55 : .8,
        branchScale: established ? 1.15 : .82,
        targetProvider: tip => nearestRootTarget(state, tip.x, tip.y, tip.totalDistance < 70 ? 75 : 0),
        avoidanceProvider: tip => avoidHazards(state, tip),
        // `onFirstContact` é o gatilho — `onContact` roda a cada quadro enquanto
        // a ponta encosta e faria o som repetir com o frame rate.
        onFirstContact: (hypha, tip, target) => {
          if (target.kind === 'root') {
            entities?.audio?.play('mycorrhizaRootContact', {
              x: target.x,
              y: target.y,
              instanceId: network.id,
            });
            addArbuscule(network, target, tip.seed);
          } else if (!network.exudateContacts.has(target.id)) {
            network.exudateContacts.add(target.id);
            entities.burst(target.x, target.y, '#d6afff', 8, 65);
          }
        },
        onContact: (hypha, tip, target, frameDt) => {
          if (target.kind === 'root' && tip.depth >= 2 && Math.random() < frameDt * .55) tip.active = false;
        },
      });

      for (const arbuscule of network.arbuscules) {
        if (arbuscule.platform) {
          arbuscule.x = clamp(arbuscule.x, arbuscule.platform.x + 12, arbuscule.platform.x + arbuscule.platform.w - 12);
          arbuscule.y = arbuscule.platform.y - 6;
        }
        arbuscule.maturity = clamp(arbuscule.maturity + dt * .34, 0, 1);
        arbuscule.life = .65 + arbuscule.maturity * .35;
        // Só quando a maturidade CRUZA 1, uma vez por arbúsculo.
        if (arbuscule.maturity >= 1 && !arbuscule.audioCompleted) {
          const entregue = entities?.audio
            ? fxLanded(entities.audio.play('mycorrhizaArbusculeComplete', {
                x: arbuscule.x,
                y: arbuscule.y,
                instanceId: arbuscule.targetId,
              }))
            : true;
          if (entregue) arbuscule.audioCompleted = true;
        }
        const rootEfficiency = clamp(arbuscule.platform?.mycorrhizaEfficiency ?? 1, .08, 1);
        if (arbuscule.maturity >= 1) {
          state.player.hope += dt * .015 * rootEfficiency;
          state.player.soil += dt * .01 * rootEfficiency;
        }
      }
    }
    exposeArbuscules();
  }

  function drawNetwork(ctx, network) {
    // A rede inoculada tambem produz propágulos animados, mas discretos para
    // que as hifas enraizadas continuem sendo a estrutura dominante.
    const sporeAlpha = network.colony || network.ally?.taken ? .52 : 1;
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    const sporeY = network.y + Math.sin(state.time * 1.7 + network.pulse) * 4;
    const spriteDrawn = organismSprites.draw(ctx, 'micorriza', {
      x: network.x,
      y: sporeY,
      height: 56 + network.germination * 8,
      time: state.time,
      phase: network.pulse,
      alpha: sporeAlpha,
      flipX: Math.sin(network.pulse) < 0,
    });
    if (!spriteDrawn) {
      ctx.globalAlpha = sporeAlpha;
      ctx.shadowBlur = 22;
      ctx.shadowColor = '#d6afff';
      ctx.fillStyle = '#f2ddff';
      ctx.beginPath();
      ctx.arc(network.x, sporeY, 9 + network.germination * 2, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (network.hypha) {
      renderHyphalNetwork(ctx, network.hypha, state, {
        color: '#d6afff',
        core: '#f0dcff',
        tip: '#fff3ff',
      });
    }

    ctx.save();
    ctx.translate(-state.cameraX, 0);
    for (const arbuscule of network.arbuscules) {
      const efficiency = clamp(arbuscule.platform?.mycorrhizaEfficiency ?? 1, .08, 1);
      ctx.save();
      ctx.globalAlpha = .28 + efficiency * .72;
      ctx.translate(arbuscule.x, arbuscule.y);
      ctx.scale(.45 + arbuscule.maturity * .55, .45 + arbuscule.maturity * .55);
      ctx.translate(-arbuscule.x, -arbuscule.y);
      drawArbuscule(ctx, arbuscule, state.time, '#d6afff');
      ctx.restore();

      if (arbuscule.maturity > .35) {
        const particles = 4;
        for (let i = 0; i < particles; i++) {
          const phase = (state.time * (.22 + i * .03) + i / particles) % 1;
          const y = arbuscule.y - 3 - phase * 30;
          ctx.fillStyle = i % 2 ? '#ffcf73' : '#d6afff';
          ctx.globalAlpha = (.35 + arbuscule.maturity * .45) * efficiency;
          ctx.beginPath();
          ctx.arc(arbuscule.x + Math.sin(state.time * 2 + i) * 4, y, 1.4 + i % 2, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    if (!network.colony && !network.ally?.taken
      && Math.abs(network.x - (state.cameraX + W / 2)) < W * .7) {
      ctx.font = '700 12px Inter,system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f4e6ff';
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#d6afff';
      const stage = network.germination < .18 ? 'Esporo de micorriza arbuscular' : 'Hifas extrarradiculares com tropismo';
      ctx.fillText(stage, network.x, network.y - 28);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function render(ctx) {
    if (!active) return;
    for (const network of networks) drawNetwork(ctx, network);
  }

  return {
    get active() { return active; },
    get branchCount() { return networks.reduce((sum, network) => sum + (network.hypha?.tips.length || 0), 0); },
    get tipCount() { return networks.reduce((sum, network) => sum + (network.hypha?.tips.filter(tip => tip.active).length || 0), 0); },
    get arbusculeCount() { return networks.reduce((sum, network) => sum + network.arbuscules.length, 0); },
    get arbuscules() { return networks.flatMap(network => network.arbuscules); },
    clear,
    reset,
    update,
    render,
    setInoculants,
  };
}
