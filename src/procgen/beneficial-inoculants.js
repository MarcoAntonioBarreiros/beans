import { organismVerticalBounds } from './world-bounds.js';
import { H, W } from '../core/constants.js';
import { drawInoculatedBacillusSprite, isBacillusSpriteEnabled } from '../render/bacillus-sprite.js';
import { organismSprites } from '../render/organism-sprites.js';
import { COLONY_ESTABLISHMENT_GROWTH } from '../audio-manifest.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const PROFILES = {
  rhizobium: {
    label: 'Rhizobium',
    short: 'Rhizobium',
    color: '#c7a5ff',
    pale: '#f0e4ff',
    role: 'pré-nódulo',
    drain: .0014,
  },
  azospirillum: {
    label: 'Azospirillum',
    short: 'Azospirillum',
    color: '#72e8dd',
    pale: '#ddfffb',
    role: 'rizoplano ativo',
    drain: .0012,
  },
  bacillus: {
    label: 'Bacillus',
    short: 'Bacillus',
    color: '#70e5d6',
    pale: '#e3fff5',
    role: 'biofilme',
    drain: .0005,
  },
  pseudomonas: {
    label: 'Pseudomonas',
    short: 'Pseudomonas',
    color: '#8db8ff',
    pale: '#e2edff',
    role: 'zona supressiva',
    drain: .002,
  },
  // A micorriza e fungo e nao vagueia, mas o inoculo se captura e se carrega
  // como o das bacterias. Entrar aqui basta para valer todo o pipeline de
  // captura, transporte e inoculacao, que e generico sobre PROFILES.
  myco: {
    label: 'Micorriza',
    short: 'Micorriza',
    color: '#d6afff',
    pale: '#f0e4ff',
    role: 'rede hifal',
    drain: .0016,
  },
};

const BENEFICIAL_TYPES = Object.keys(PROFILES);

function nearestSupport(state, x, y, maxDistance = 190) {
  let best = null;
  let bestDistance = maxDistance;
  for (const platform of state.level.platforms || []) {
    if (platform.final || platform.recovery || platform.mycorrhizaStructure) continue;
    const pointX = clamp(x, platform.x + 18, platform.x + platform.w - 18);
    const pointY = platform.y - 7;
    const distance = Math.hypot(pointX - x, pointY - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { platform, x: pointX, y: pointY, distance };
    }
  }
  return best;
}

export function createBeneficialInoculants({ state, input, ecology, entities }) {
  const colonies = [];
  const followDuration = 30;
  const maxFollowers = 8;
  const maxPerSpecies = 3;
  let nextColonyId = 1;
  let eHeldLast = false;
  let suppressEUntilRelease = false;
  let lastRecruitToastAt = -Infinity;
  // Quando existe seletor, so o organismo escolhido responde ao E. Sem seletor
  // o comportamento antigo continua valendo, para os testes existentes.
  let activeSelection = null;

  function isBeneficial(agent) {
    return Boolean(agent && PROFILES[agent.type]);
  }

  function followers() {
    return ecology.agents.filter(agent => (
      isBeneficial(agent)
      && (agent.beneficialRecruitedUntil || 0) > state.time
    ));
  }

  function followerGroups() {
    const groups = new Map();
    for (const agent of followers()) {
      if (!groups.has(agent.type)) groups.set(agent.type, []);
      groups.get(agent.type).push(agent);
    }
    return groups;
  }

  function releaseAgent(agent) {
    agent.beneficialRecruitedUntil = 0;
    agent.beneficialFollowSlot = null;
    agent.beneficialRecruitSource = null;
  }

  function removeAgent(agent) {
    const index = ecology.agents.indexOf(agent);
    if (index >= 0) ecology.agents.splice(index, 1);
  }

  function clear() {
    for (const agent of ecology.agents) {
      if (isBeneficial(agent)) releaseAgent(agent);
    }
    colonies.length = 0;
    nextColonyId = 1;
    eHeldLast = false;
    suppressEUntilRelease = false;
    lastRecruitToastAt = -Infinity;
    state.level.beneficialColonies = colonies;
  }

  function reset() {
    clear();
    state.level.beneficialColonies = colonies;
    for (const spec of state.level.authoredBeneficialColonies || []) createAuthoredColony(spec);
  }

  function recruitFromClouds() {
    const clouds = state.level.exudateClouds || [];
    let currentFollowers = followers();

    for (const cloud of clouds) {
      if (!cloud.recruitedBeneficials) cloud.recruitedBeneficials = new Set();
      const perSpecies = new Map();
      for (const agent of currentFollowers) {
        perSpecies.set(agent.type, (perSpecies.get(agent.type) || 0) + 1);
      }

      const candidates = ecology.agents
        .filter(agent => (
          isBeneficial(agent)
          && Math.hypot(agent.x - cloud.x, agent.y - cloud.y) < Math.max(66, cloud.radius * .82)
        ))
        .sort((a, b) => (
          Math.hypot(a.x - cloud.x, a.y - cloud.y)
          - Math.hypot(b.x - cloud.x, b.y - cloud.y)
        ));

      for (const agent of candidates) {
        const alreadyFollowing = (agent.beneficialRecruitedUntil || 0) > state.time;
        const speciesCount = perSpecies.get(agent.type) || 0;
        if (!alreadyFollowing && currentFollowers.length >= maxFollowers) break;
        if (!alreadyFollowing && speciesCount >= maxPerSpecies) continue;

        agent.beneficialRecruitedUntil = Math.max(
          agent.beneficialRecruitedUntil || 0,
          state.time + followDuration,
        );
        agent.beneficialRecruitSource = cloud.id;
        if (agent.beneficialFollowSlot == null) agent.beneficialFollowSlot = currentFollowers.length;
        if (!currentFollowers.includes(agent)) {
          currentFollowers.push(agent);
          perSpecies.set(agent.type, speciesCount + 1);
        }

        if (!cloud.recruitedBeneficials.has(agent.id)) {
          cloud.recruitedBeneficials.add(agent.id);
          const profile = PROFILES[agent.type];
          entities.burst(agent.x, agent.y, profile.color, 12, 92);
          // UMA confirmação por nuvem. Uma nuvem recruta vários agentes no mesmo
          // quadro; um som por célula viraria seis cópias sobrepostas do mesmo
          // arquivo. `alreadyFollowing` acima já garante que renovar o tempo de
          // seguimento não passa por aqui.
          if (!alreadyFollowing && !cloud.interactionRecruitmentAudioPlayed) {
            cloud.interactionRecruitmentAudioPlayed = true;
            entities.interactionFx?.('microbeRecruitment', {
              gain: 1, rate: 1, instanceId: `cloud:${cloud.id}`,
            });
          }
          // Descoberta silenciosa: o recrutamento já é o feedback deste quadro.
          entities.discoverMicrobe?.(agent.type, false, { sound: false });
          if (state.time - lastRecruitToastAt > 2.2) {
            state.toast = `${profile.label} recrutado: leve a comunidade até uma raiz e pressione E novamente para inocular.`;
            state.toastTime = 4.6;
            lastRecruitToastAt = state.time;
          }
        }
      }
    }
  }

  function followPlayer(dt) {
    const recruited = followers().sort((a, b) => (
      BENEFICIAL_TYPES.indexOf(a.type) - BENEFICIAL_TYPES.indexOf(b.type)
      || String(a.id).localeCompare(String(b.id))
    ));
    const playerX = state.player.x + state.player.w / 2;
    const playerY = state.player.y + state.player.h / 2;

    recruited.forEach((agent, index) => {
      agent.beneficialFollowSlot = index;
      const row = Math.floor(index / 3);
      const column = index % 3;
      const lateral = (column - 1) * (34 + row * 4);
      const targetX = playerX - state.player.facing * (80 + row * 28) + lateral;
      const escortLift = agent.type === 'bacillus' ? 74 : 0;
      // A escolta tem de ficar ACIMA de Miguelito. Com o teto fixo em 62 ela
      // aparecia ABAIXO dele sempre que a rota subia para Y negativo — o
      // alvo caía fora do clamp e virava o chão da tela antiga.
      const escortBounds = organismVerticalBounds(state.level);
      const targetY = clamp(
        playerY - 42 - row * 27 - escortLift + Math.sin(state.time * 2.25 + index * .8) * 10,
        escortBounds.minY,
        escortBounds.maxY,
      );
      const dx = targetX - agent.x;
      const dy = targetY - agent.y;
      const distance = Math.max(1, Math.hypot(dx, dy));

      if (distance > 760) {
        agent.x = targetX;
        agent.y = targetY;
        agent.vx = 0;
        agent.vy = 0;
        entities.burst(agent.x, agent.y, PROFILES[agent.type].color, 8, 62);
      } else {
        const desiredSpeed = Math.min(225, 56 + distance * 1.5);
        const response = clamp(dt * 6.8, 0, 1);
        const desiredVX = dx / distance * desiredSpeed;
        const desiredVY = dy / distance * desiredSpeed;
        agent.vx += (desiredVX - agent.vx) * response;
        agent.vy += (desiredVY - agent.vy) * response;
        agent.x += dx * clamp(dt * 2.5, 0, .17);
        agent.y += dy * clamp(dt * 2.25, 0, .15);
      }

      agent.homeX = targetX;
      agent.homeY = targetY;
      agent.radius = Math.max(agent.radius || 0, 275);
      agent.angle = Math.atan2(agent.vy, agent.vx);
    });

    for (const agent of ecology.agents) {
      if (!isBeneficial(agent)) continue;
      if ((agent.beneficialRecruitedUntil || 0) <= state.time) releaseAgent(agent);
    }
  }

  function createBacillusBiofilm(colony) {
    const films = state.level.biofilms || (state.level.biofilms = []);
    const existing = films.find(film => Math.hypot(film.x - colony.x, film.y - colony.y) < 120);
    if (existing) {
      existing.targetRadius = Math.max(existing.targetRadius || 78, 84 + colony.sourceCount * 5);
      return existing;
    }
    const film = {
      x: colony.x,
      y: colony.y,
      radius: 18,
      targetRadius: 84 + colony.sourceCount * 5,
      growth: 0,
      age: 0,
      activated: false,
      platform: colony.platform,
      natural: false,
      inoculated: true,
    };
    films.push(film);
    return film;
  }

  function createColony(type, agents, support, offsetIndex, totalGroups) {
    const profile = PROFILES[type];
    const count = Math.max(1, agents.length);
    const spread = totalGroups > 1 ? 54 : 0;
    const x = clamp(
      support.x + (offsetIndex - (totalGroups - 1) / 2) * spread,
      support.platform.x + 24,
      support.platform.x + support.platform.w - 24,
    );
    const colony = {
      id: `beneficial-colony-${nextColonyId++}`,
      type,
      x,
      y: support.y,
      platform: support.platform,
      sourceCount: count,
      vigor: clamp(.48 + count * .14, 0, 1),
      growth: .06,
      age: 0,
      stage: 'estabelecendo',
      dormant: false,
      // Colônia do jogador: ainda vai aderir, então pode soar ao cruzar o limiar.
      audioEstablished: false,
      rechargeIntensity: 0,
      radius: 58 + count * 8,
      phase: Math.random() * TAU,
      linkedBiofilm: null,
    };
    colonies.push(colony);
    for (const agent of agents) removeAgent(agent);
    state.discoveredMicrobes.add(type);

    if (type === 'bacillus') {
      colony.linkedBiofilm = createBacillusBiofilm(colony);
      colony.stage = 'biofilme';
    }
    entities.burst(colony.x, colony.y, profile.color, 24 + count * 5, 125);
    return colony;
  }

  function createAuthoredColony(spec) {
    const platform = spec.platform || state.level.platforms?.[spec.platformIndex];
    if (!platform) return null;
    const colony = {
      id: spec.id || `beneficial-colony-${nextColonyId++}`,
      type: spec.type || 'bacillus',
      x: Number.isFinite(spec.x) ? spec.x : platform.x + platform.w / 2,
      y: Number.isFinite(spec.y) ? spec.y : platform.y - 8,
      platform,
      sourceCount: spec.sourceCount || 4,
      vigor: clamp(spec.vigor ?? 1, 0, 1),
      growth: clamp(spec.growth ?? 1, 0, 1),
      age: spec.age || 30,
      stage: spec.stage || 'biofilme maduro',
      dormant: Boolean(spec.dormant),
      rechargeIntensity: clamp(spec.rechargeIntensity ?? .35, 0, 1),
      radius: spec.radius || 82,
      phase: Number.isFinite(spec.phase) ? spec.phase : 0,
      linkedBiofilm: null,
      authored: true,
      optionalDetourId: spec.optionalDetourId || null,
      detourModuleId: spec.detourModuleId || null,
      routeScope: spec.routeScope || null,
      routeOwned: Boolean(spec.routeOwned),
      allowOptionalRoutePopulation: Boolean(spec.allowOptionalRoutePopulation),
      // Colônia autoral já vem aderida com o cenário: nunca toca estabelecimento.
      audioEstablished: true,
    };
    colonies.push(colony);
    if (colony.type === 'bacillus') colony.linkedBiofilm = createBacillusBiofilm(colony);
    state.discoveredMicrobes.add(colony.type);
    return colony;
  }

  function depositFollowers() {
    let groups = followerGroups();
    if (!groups.size) return false;

    // Com seletor ativo, deposita somente o organismo escolhido — e nao responde
    // ao E quando o escolhido pertence a outro sistema (exsudato, Trichoderma).
    if (activeSelection) {
      const chosen = activeSelection.current;
      if (!chosen || chosen.kind !== 'organism') return false;
      const agents = groups.get(chosen.type);
      if (!agents) return false;
      groups = new Map([[chosen.type, agents]]);
    }
    const player = state.player;
    const support = nearestSupport(
      state,
      player.x + player.w / 2 + player.facing * 36,
      player.y + player.h,
      210,
    );
    if (!support) {
      state.toast = 'Inoculação impossível: aproxime Miguelito de uma raiz ou plataforma estável.';
      state.toastTime = 3.8;
      return true;
    }

    const entries = [...groups.entries()];
    const names = [];
    const createdColonies = [];
    entries.forEach(([type, agents], index) => {
      createdColonies.push(createColony(type, agents, support, index, entries.length));
      names.push(`${PROFILES[type].label} (${agents.length})`);
    });
    // UMA vez por ação, não uma por espécie. Sem seletor os testes depositam
    // vários grupos de uma vez, e o jogador executou um comando só.
    // Os retornos antecipados acima já cobriram "sem seguidores" e "sem suporte".
    if (createdColonies.length) {
      entities.interactionFx?.('inoculationPlace', {
        gain: 1,
        rate: 1,
        instanceId: createdColonies.map(colony => colony.id).join('|'),
      });
    }
    state.toast = `Inoculantes depositados: ${names.join(', ')}. As comunidades agora permanecem fixas e usam vigor persistente.`;
    state.toastTime = 5.5;
    return true;
  }

  function prepare() {
    const pressed = Boolean(input.keys.KeyE);
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
      const range = Math.max(130, cloud.radius * 2.05);
      if (distance >= range) continue;
      const life = clamp(cloud.life / Math.max(.1, cloud.maxLife || 10), 0, 1);
      best = Math.max(best, (1 - distance / range) * (.45 + life * .55));
    }
    return best;
  }

  function updateRhizobium(colony, dt) {
    colony.stage = colony.growth < .72 ? 'colonizando a raiz' : 'pré-nódulo';
    if (colony.growth < .72) return;
    const factor = colony.sourceCount * colony.vigor;
    state.player.soil += dt * .009 * factor;
    state.player.hope += dt * .013 * factor;
  }

  function updateAzospirillum(colony, dt) {
    colony.stage = colony.growth < .68 ? 'aderindo ao rizoplano' : 'rizoplano ativo';
    if (colony.growth < .68) return;
    const factor = colony.sourceCount * colony.vigor;
    state.player.soil += dt * .007 * factor;
    state.player.hope += dt * .011 * factor;
  }

  function updatePseudomonas(colony, dt) {
    colony.stage = colony.growth < .65 ? 'ocupando o nicho' : 'liberando sideróforos';
    if (colony.growth < .65) return;
    // A supressão depende da reserva real de Fe do sistema de sideróforos.
    // Um halo visual sem ferro capturado não controla o fungo.
  }

  // A colonia micorrizica precisa colonizar a raiz antes de emitir hifa. O
  // limiar espelha o do Azospirillum: so depois dele a estrutura pode nascer.
  function updateMycorrhiza(colony, dt) {
    colony.stage = colony.growth < .68 ? 'colonizando o cortex' : 'micélio ativo';
    if (colony.growth < .68) return;
    const factor = colony.sourceCount * colony.vigor;
    state.player.soil += dt * .008 * factor;
    state.player.hope += dt * .012 * factor;
  }

  function updateColony(colony, dt) {
    colony.age += dt;
    const previousGrowth = colony.growth;
    colony.growth = clamp(colony.growth + dt * .3, 0, 1);
    // Só a PASSAGEM pelo limiar de aderência, uma vez por colônia. Permanecer
    // acima dele nos quadros seguintes não repete.
    if (
      !colony.audioEstablished
      && previousGrowth < COLONY_ESTABLISHMENT_GROWTH
      && colony.growth >= COLONY_ESTABLISHMENT_GROWTH
    ) {
      const result = entities.interactionFx?.('colonyEstablished', {
        gain: 1, rate: 1, instanceId: colony.id,
      });
      // `rejected` significa que o pedido não foi aceito (faixa inexistente ou
      // arquivo com falha definitiva). Marcar aqui apagaria o evento para sempre.
      if (result?.state !== 'rejected') colony.audioEstablished = true;
    }
    // A recarga e derivada do combustivel-base vezes os multiplicadores que os
    // patogenos publicam. Antes a Ralstonia fazia `rechargeIntensity *= ...`
    // direto no campo: o valor-base era destruido e tirar a pressao nao
    // devolvia nada (e o resultado dependia da ordem de update dos sistemas).
    const fuel = cloudIntensity(colony);
    colony.rechargeIntensity = clamp(fuel * clamp(colony.vascularEfficiencyMultiplier ?? 1, 0, 1), 0, 1);
    if (fuel > .02) {
      colony.vigor = clamp(colony.vigor + dt * (.025 + fuel * .105), 0, 1);
    }

    if (colony.vigor <= .025) {
      colony.vigor = 0;
      colony.dormant = true;
      colony.stage = 'dormente';
      return;
    }
    if (colony.dormant && colony.vigor > .1) colony.dormant = false;
    if (colony.dormant) return;

    const profile = PROFILES[colony.type];
    colony.vigor = clamp(colony.vigor - dt * profile.drain * (1 + colony.sourceCount * .18), 0, 1);
    if (colony.type === 'rhizobium') updateRhizobium(colony, dt);
    else if (colony.type === 'azospirillum') updateAzospirillum(colony, dt);
    else if (colony.type === 'pseudomonas') updatePseudomonas(colony, dt);
    else if (colony.type === 'bacillus') colony.stage = 'biofilme';
    else if (colony.type === 'myco') updateMycorrhiza(colony, dt);
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    recruitFromClouds();
    followPlayer(dt);
    for (const colony of colonies) updateColony(colony, dt);
  }

  function drawFollowerTrails(ctx) {
    const recruited = followers();
    if (!recruited.length) return;
    const playerX = state.player.x + state.player.w / 2;
    const playerY = state.player.y + state.player.h / 2;
    for (const agent of recruited) {
      const profile = PROFILES[agent.type];
      ctx.strokeStyle = `${profile.color}66`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(agent.x, agent.y);
      ctx.quadraticCurveTo((agent.x + playerX) / 2, Math.min(agent.y, playerY) - 22, playerX, playerY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = profile.color;
      ctx.globalAlpha = .65;
      ctx.beginPath();
      ctx.arc(agent.x, agent.y, 12 + Math.sin(state.time * 3 + agent.noiseSeed) * 2, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawColony(ctx, colony) {
    const profile = PROFILES[colony.type];
    const growth = colony.growth;
    const pulse = 1 + Math.sin(state.time * 2 + colony.phase) * .045;
    const radius = (16 + colony.sourceCount * 3.2) * growth * pulse;
    ctx.save();
    ctx.translate(colony.x, colony.y);

    // O vigor/evolucao da colonia agora e lido pela COR e intensidade do halo,
    // no lugar da barra: cor do organismo quando vigorosa, ambar e vermelho
    // conforme enfraquece; halo mais forte = mais vigor.
    const vigorColor = colony.vigor > .55 ? profile.color : colony.vigor > .24 ? '#ffd36f' : '#ff8297';
    const vigorAlpha = colony.dormant
      ? '22'
      : Math.round(clamp(34 + colony.vigor * 94, 34, 128)).toString(16).padStart(2, '0');
    const haloRadius = colony.radius * (.55 + growth * .45);
    const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, haloRadius);
    halo.addColorStop(0, `${vigorColor}${vigorAlpha}`);
    halo.addColorStop(.6, `${vigorColor}${colony.dormant ? '11' : '2a'}`);
    halo.addColorStop(1, `${vigorColor}00`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloRadius, 0, TAU);
    ctx.fill();

    ctx.fillStyle = profile.color;
    ctx.strokeStyle = profile.pale;
    ctx.lineWidth = 1.2;
    const cellCount = 7 + colony.sourceCount * 3;
    const colonySpriteType = colony.type === 'myco' ? 'micorriza' : colony.type;
    const colonySpriteStatus = organismSprites.status(colonySpriteType);
    const colonySpriteReady = colonySpriteStatus.enabled && colonySpriteStatus.loaded && !colonySpriteStatus.failed;
    for (let i = 0; i < cellCount; i++) {
      const angle = i / cellCount * TAU + colony.phase;
      const rr = radius * (.25 + (i % 4) * .18);
      const x = Math.cos(angle) * rr;
      const y = -4 + Math.sin(angle) * rr * .48;
      ctx.globalAlpha = colony.dormant ? .32 : .55 + (i % 3) * .14;
      ctx.beginPath();
      if (colony.type === 'rhizobium') {
        if (colonySpriteReady) {
          if (i < 3) organismSprites.draw(ctx, 'rhizobium', {
            x: (i - 1) * 25,
            y: -22 + Math.sin(state.time * 2 + i) * 3,
            height: 55,
            time: state.time,
            phase: colony.phase + i,
            alpha: colony.dormant ? .45 : 1,
            flipX: i === 0,
          });
        } else {
          ctx.ellipse(x, y, 4.5, 2.4, angle + .4, 0, TAU);
          ctx.fill();
          ctx.stroke();
        }
      } else if (colony.type === 'azospirillum') {
        if (colonySpriteReady) {
          if (i < 3) organismSprites.draw(ctx, 'azospirillum', {
            x: (i - 1) * 25,
            y: -24 + Math.sin(state.time * 2 + i) * 3,
            height: 64,
            time: state.time,
            phase: colony.phase + i,
            alpha: colony.dormant ? .42 : 1,
            flipX: i === 0,
          });
        } else {
          ctx.ellipse(x, y, 5.3, 1.8, angle, 0, TAU);
          ctx.fill();
          ctx.stroke();
        }
      } else if (colony.type === 'bacillus') {
        const spriteCount = 5;
        if (i < spriteCount) {
          const alpha = colony.dormant ? .35 : .95;
          const bx = (i / Math.max(1, spriteCount - 1) - 0.5) * Math.max(110, radius * 2.2);
          const by = -22 + Math.sin(state.time * 2.2 + i * 0.8) * 3;
          const drawn = drawInoculatedBacillusSprite(ctx, bx, by, 54, null, state.time, i, alpha);
          if (!drawn) {
            ctx.roundRect(x - 4.5, y - 2, 9, 4, 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      } else if (colony.type === 'pseudomonas' || colony.type === 'myco') {
        if (colonySpriteReady) {
          const spriteType = colony.type === 'myco' ? 'micorriza' : 'pseudomonas';
          if (i < 3) organismSprites.draw(ctx, spriteType, {
            x: (i - 1) * 24,
            y: -21 + Math.sin(state.time * 2.1 + i) * 3,
            height: colony.type === 'myco' ? 50 : 57,
            time: state.time,
            phase: colony.phase + i,
            alpha: colony.dormant ? .4 : .95,
            flipX: i === 0,
          });
        } else {
          ctx.ellipse(x, y, 4.8, 2, angle - .25, 0, TAU);
          ctx.fill();
          ctx.stroke();
        }
      } else {
        ctx.ellipse(x, y, 4.8, 2, angle - .25, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // A barra de vigor foi removida (poluicao): o estado agora vive no halo.
    // Mantemos so o rotulo de identidade do organismo.
    const labelY = radius + 14;
    ctx.font = '700 9px Inter,system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#effff5';
    ctx.fillText(`${profile.short} — ${colony.stage}`, 0, labelY + 8);
    if (colony.type === 'azospirillum' && colony.associativeNitrogenActive) {
      ctx.font = '650 8px Inter,system-ui';
      ctx.fillStyle = 'rgba(255,215,131,.9)';
      ctx.fillText('Fixação associativa de N', 0, labelY + 19);
    }
    ctx.restore();
  }

  function render(ctx) {
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    drawFollowerTrails(ctx);
    for (const colony of colonies) {
      if (colony.x < state.cameraX - 180 || colony.x > state.cameraX + W + 180) continue;
      drawColony(ctx, colony);
    }
    ctx.restore();
  }

  function summaryFromCounts(items) {
    return BENEFICIAL_TYPES
      .map(type => {
        const count = items.filter(item => item.type === type).length;
        return count ? `${PROFILES[type].short} ${count}` : null;
      })
      .filter(Boolean)
      .join(', ');
  }

  return {
    followerGroups,
    setSelection(selection) { activeSelection = selection; },
    get followerCount() { return followers().length; },
    get followerSummary() { return summaryFromCounts(followers()); },
    get colonyCount() { return colonies.length; },
    get bacillusColonyCount() { return colonies.filter(colony => colony.type === 'bacillus').length; },
    get colonySummary() { return summaryFromCounts(colonies); },
    get vigorAverage() {
      if (!colonies.length) return 0;
      return colonies.reduce((sum, colony) => sum + colony.vigor, 0) / colonies.length;
    },
    get colonies() { return colonies; },
    createAuthoredColony,
    clear,
    reset,
    prepare,
    update,
    render,
  };
}
