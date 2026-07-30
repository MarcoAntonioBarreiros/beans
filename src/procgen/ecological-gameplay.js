import { H, W } from '../core/constants.js';
import { drawInoculatedBacillusSprite, isBacillusSpriteEnabled } from '../render/bacillus-sprite.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function nearestPointOnPlatform(x, y, platform) {
  return {
    x: clamp(x, platform.x + 18, platform.x + platform.w - 18),
    y: platform.y - 7,
  };
}

export function createEcologicalGameplay({ state, input, entities, ecology }) {
  const clouds = [];
  const biofilms = [];
  const formingBiofilms = new Map();
  let nextCloudId = 1;
  let deployedCloudCount = 0;
  let eHeldLast = false;
  let infectionAnnounced = false;
  let activeSelection = null;

  function toast(title, message, seconds = 4.7) {
    state.toast = `${title}: ${message}`;
    state.toastTime = seconds;
  }

  function clear() {
    entities?.audio?.stopGroup('bacillus-biofilm');
    clouds.length = 0;
    biofilms.length = 0;
    formingBiofilms.clear();
    eHeldLast = false;
    infectionAnnounced = false;
    deployedCloudCount = 0;
  }

  function reset() {
    clear();
    state.level.exudateClouds = clouds;
    state.level.biofilms = biofilms;
    state.player.infection = 0;
    state.player.infectionExposure = 0;
    state.player.moveMultiplier = 1;
    for (const checkpoint of state.level.checkpoints || []) {
      biofilms.push({
        x: checkpoint.x,
        y: checkpoint.y + 8,
        radius: 72,
        targetRadius: 72,
        growth: 1,
        age: 12,
        activated: Boolean(checkpoint.active),
        checkpoint,
        natural: true,
      });
    }
  }

  function deployCloud() {
    const player = state.player;
    if (player.exudates <= 0) {
      toast('Sem exsudatos', 'Colete gotas verdes antes de liberar um gradiente químico.', 3.2);
      return;
    }
    player.exudates--;
    if (clouds.length >= 4) clouds.shift();
    const cloud = {
      id: nextCloudId++,
      x: player.x + player.w / 2 + player.facing * 24,
      y: player.y + player.h / 2,
      radius: 24,
      targetRadius: 155,
      life: 10,
      maxLife: 10,
      phase: Math.random() * TAU,
    };
    clouds.push(cloud);
    // Depois da nuvem existir de verdade: o retorno lá em cima já descartou o
    // caso "sem exsudatos", e `prepare` já filtra a tecla segurada. A expansão e
    // a morte da nuvem não passam por aqui.
    entities?.interactionFx?.('exudateRelease', { gain: 1, rate: 1, instanceId: cloud.id });
    deployedCloudCount++;
    entities.burst(cloud.x, cloud.y, '#b7f36b', 22, 135);
    toast('Gradiente de exsudatos', 'A nuvem atrai comunidades móveis e orienta interações ecológicas.', 3.5);
  }

  function prepare() {
    const pressed = Boolean(input.keys.KeyE);
    // Com seletor ativo, o exsudato so sai quando ele e o item escolhido; senao
    // o E pertence ao organismo selecionado.
    const exudateSelected = !activeSelection || activeSelection.isSelected('exudate');
    if (pressed && !eHeldLast && state.gameState === 'play' && exudateSelected) deployCloud();
    eHeldLast = pressed;
    state.player.moveMultiplier = 1 - clamp(state.player.infection || 0, 0, 1) * .32;
  }

  function updateClouds(dt) {
    for (const cloud of clouds) {
      cloud.life -= dt;
      cloud.radius += (cloud.targetRadius - cloud.radius) * clamp(dt * 2.3, 0, 1);
      cloud.y += Math.sin(state.time * .9 + cloud.phase) * dt * 2.2;
    }
    for (let i = clouds.length - 1; i >= 0; i--) {
      if (clouds[i].life <= 0) clouds.splice(i, 1);
    }
  }

  function attractionWeight(type) {
    if (type === 'bacillus') return 1.5;
    if (type === 'trichoderma') return 1.35;
    if (type === 'rhizobium') return 1.25;
    if (type === 'azospirillum') return 1.18;
    if (type === 'pseudomonas') return 1.12;
    if (type === 'oportunista') return .42;
    return .7;
  }

  function applyCloudTaxia(dt) {
    for (const agent of ecology.agents) {
      let best = null;
      let bestScore = Infinity;
      for (const cloud of clouds) {
        const distance = Math.hypot(cloud.x - agent.x, cloud.y - agent.y);
        if (distance > cloud.radius * 3.2) continue;
        const score = distance / attractionWeight(agent.type);
        if (score < bestScore) {
          best = cloud;
          bestScore = score;
        }
      }
      if (!best) continue;
      const dx = best.x - agent.x;
      const dy = best.y - agent.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const gradient = clamp(1 - distance / (best.radius * 3.2), 0, 1);
      const force = 165 * attractionWeight(agent.type) * gradient;
      agent.vx += dx / distance * force * dt;
      agent.vy += dy / distance * force * dt;
      agent.homeX += dx / distance * force * dt * .9;
      agent.homeY += dy / distance * force * dt * .7;
    }
  }

  function updateInfection(dt) {
    const player = state.player;
    const center = { x: player.x + player.w / 2, y: player.y + player.h / 2 };
    // O contato com o oportunista é calculado pela geometria real das hifas e
    // dos esporos. A proximidade do antigo ícone não cria mais infecção.
    player.infectionExposure = Math.max(0, (player.infectionExposure || 0) - dt * .72);
    if (player.infection > .06) {
      player.hope = Math.max(0, player.hope - dt * (.18 + player.infection * .58));
      if (!infectionAnnounced) {
        infectionAnnounced = true;
        toast('Contaminação oportunista', 'Propágulos aderiram. Afaste-se ou procure Bacillus e Trichoderma para reduzir a pressão.', 5.2);
      }
    } else if (player.infection <= .015) {
      infectionAnnounced = false;
    }
  }

  function nearestPlatform(x, y, maxDistance = 170) {
    let best = null;
    let bestPoint = null;
    let bestDistance = maxDistance;
    for (const platform of state.level.platforms) {
      if (platform.recovery || platform.final) continue;
      const point = nearestPointOnPlatform(x, y, platform);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        best = platform;
        bestPoint = point;
        bestDistance = distance;
      }
    }
    return best ? { platform: best, point: bestPoint, distance: bestDistance } : null;
  }

  function createBiofilm(point, platform) {
    if (biofilms.some(film => Math.abs(film.x - point.x) < 150)) return;
    biofilms.push({
      x: point.x,
      y: point.y,
      radius: 18,
      targetRadius: 88,
      growth: 0,
      age: 0,
      activated: false,
      platform,
      natural: false,
    });
    // Criação REAL (o guarda acima já descartou o caso de filme vizinho). Entrar
    // numa zona pronta não passa por aqui e por isso não toca de novo.
    entities?.audio?.play('bacillusBiofilmComplete', { x: point.x, y: point.y });
    entities.burst(point.x, point.y, '#70e5d6', 38, 175);
    toast('Biofilme de Bacillus', 'A matriz aderida estabilizou a raiz e criou uma nova zona segura.', 4.8);
    state.discoveredMicrobes.add('bacillus');
  }

  function updateBiofilmFormation(dt) {
    for (const cloud of clouds) {
      const support = nearestPlatform(cloud.x, cloud.y);
      if (!support) continue;
      const bacilli = ecology.agents.filter(agent => (
        agent.type === 'bacillus'
        && Math.hypot(agent.x - support.point.x, agent.y - support.point.y) < 112
      ));
      const key = `${cloud.id}:${support.platform.logicIndex ?? Math.round(support.platform.x)}`;
      // Uma voz por FORMAÇÃO (nuvem + plataforma), não por biofilme: duas
      // formações simultâneas em plataformas diferentes soam como duas.
      const loopKey = `ecological-biofilm:${key}`;
      if (bacilli.length >= 3) {
        const current = formingBiofilms.get(key) || {
          progress: 0,
          x: support.point.x,
          y: support.point.y,
          platform: support.platform,
        };
        current.progress += dt * clamp(bacilli.length / 4, .65, 1.8);
        current.x = support.point.x;
        current.y = support.point.y;
        formingBiofilms.set(key, current);
        entities?.audio?.startLoop(loopKey, 'bacillusBiofilmGrowth', {
          // Compartilha o teto de vozes com o biofilme das colônias: é o mesmo
          // processo, e somar as duas fontes dobraria a mesma textura.
          group: 'bacillus-biofilm',
          x: current.x,
          y: current.y,
          gain: .5 + clamp(current.progress / 3.4, 0, 1) * .5,
          rate: .92 + clamp(current.progress / 3.4, 0, 1) * .14,
        });
        if (current.progress >= 3.4) {
          entities?.audio?.stopLoop(loopKey, { fade: .2 });
          createBiofilm(current, current.platform);
          formingBiofilms.delete(key);
          cloud.life = Math.min(cloud.life, 1.2);
        }
      } else {
        const current = formingBiofilms.get(key);
        if (current) {
          current.progress = Math.max(0, current.progress - dt * .4);
          // Progresso zerado: a formação foi abandonada e o loop some com ela.
          if (current.progress <= 0) {
            formingBiofilms.delete(key);
            entities?.audio?.stopLoop(loopKey);
          }
        }
      }
    }

    const player = state.player;
    const center = { x: player.x + player.w / 2, y: player.y + player.h / 2 };
    for (const film of biofilms) {
      if (film.checkpoint) {
        film.x = film.checkpoint.x;
        film.y = film.checkpoint.y + 8;
      }
      film.age += dt;
      film.growth = clamp(film.growth + dt * .42, 0, 1);
      film.radius += ((film.targetRadius || 78) - film.radius) * clamp(dt * 1.8, 0, 1);
      if (Math.hypot(center.x - film.x, center.y - film.y) >= film.radius) continue;
      player.infection = Math.max(0, (player.infection || 0) - dt * .72);
      player.infectionExposure = Math.max(0, (player.infectionExposure || 0) - dt * 1.8);
      player.soil += dt * .32;
      if (film.checkpoint?.active) film.activated = true;
      if (!film.activated) {
        film.activated = true;
        if (film.checkpoint) film.checkpoint.active = true;
        state.currentCheckpoint = { x: film.x - player.w / 2, y: film.y - player.h - 8 };
        // A marca fica no checkpoint quando ele existe, senão no próprio filme.
        // É o que impede a física e este sistema de tocarem o mesmo ponto duas
        // vezes — os dois enxergam o mesmo objeto.
        //
        // Um checkpoint que já nasceu ativo nem chega aqui: a linha acima marca
        // `film.activated` e o bloco inteiro é pulado.
        const audioOwner = film.checkpoint || film;
        if (!audioOwner.interactionAudioActivated) {
          audioOwner.interactionAudioActivated = true;
          entities?.interactionFx?.('checkpointActivation', {
            gain: 1,
            rate: 1,
            instanceId: audioOwner.id ?? `biofilm:${Math.round(film.x)}:${Math.round(film.y)}`,
          });
        }
        entities.burst(film.x, film.y, '#70e5d6', 26, 145);
        toast('Zona segura de Bacillus', 'Checkpoint ativado; a matriz remove contaminação e recupera o solo.', 4.5);
      }
    }
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    updateClouds(dt);
    applyCloudTaxia(dt);
    updateInfection(dt);
    updateBiofilmFormation(dt);
  }

  function drawCloud(ctx, cloud) {
    const life = clamp(cloud.life / cloud.maxLife, 0, 1);
    const alpha = Math.min(1, life * 2.5);
    const gradient = ctx.createRadialGradient(cloud.x, cloud.y, 4, cloud.x, cloud.y, cloud.radius);
    gradient.addColorStop(0, `rgba(207,255,136,${.24 * alpha})`);
    gradient.addColorStop(.5, `rgba(183,243,107,${.12 * alpha})`);
    gradient.addColorStop(1, 'rgba(183,243,107,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.radius, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 18; i++) {
      const angle = i / 18 * TAU + state.time * (.12 + (i % 3) * .04) + cloud.phase;
      const radius = cloud.radius * (.18 + (i % 6) / 7);
      ctx.globalAlpha = alpha * (.25 + (i % 4) * .1);
      ctx.fillStyle = i % 2 ? '#d6ff94' : '#b7f36b';
      ctx.beginPath();
      ctx.arc(cloud.x + Math.cos(angle) * radius, cloud.y + Math.sin(angle * 1.3) * radius * .55, 1.5 + i % 3, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBiofilm(ctx, film) {
    const pulse = 1 + Math.sin(state.time * 1.8 + film.x * .01) * .04;
    ctx.save();
    ctx.translate(film.x, film.y);
    ctx.scale(pulse, pulse * .62);
    const radius = film.radius * film.growth;
    const matrix = ctx.createRadialGradient(0, 0, 4, 0, 0, radius);
    matrix.addColorStop(0, film.activated ? 'rgba(112,229,214,.34)' : 'rgba(112,229,214,.24)');
    matrix.addColorStop(.7, 'rgba(112,229,214,.11)');
    matrix.addColorStop(1, 'rgba(112,229,214,0)');
    ctx.fillStyle = matrix;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = film.activated ? 'rgba(190,255,241,.72)' : 'rgba(112,229,214,.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.arc(0, 0, radius * .72, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    // Partículas brilhantes da matriz do biofilme (camada frontal em partículas)
    for (let i = 0; i < 10; i++) {
      const angle = i / 10 * TAU + state.time * .12;
      const radiusOffset = radius * (.28 + (i % 3) * .18);
      const bx = Math.cos(angle) * radiusOffset;
      const by = Math.sin(angle) * radiusOffset * 0.45;
      const alpha = .5 + (i % 3) * .18;
      ctx.fillStyle = i % 2 ? 'rgba(112,229,214,0.75)' : 'rgba(227,255,245,0.85)';
      ctx.beginPath();
      ctx.arc(bx, by - 6, 2.5 + (i % 3) * 0.9, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawInfection(ctx) {
    const infection = clamp(state.player.infection || 0, 0, 1);
    if (infection <= .01) return;
    const px = state.player.x + state.player.w / 2;
    const py = state.player.y + state.player.h / 2;
    const count = 2 + Math.floor(infection * 6);
    for (let i = 0; i < count; i++) {
      const angle = i / count * TAU + state.time * (.55 + i * .04);
      const radius = 22 + (i % 3) * 6;
      ctx.fillStyle = '#ff8297';
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#ff6f91';
      ctx.globalAlpha = .4 + infection * .5;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const aa = k / 10 * TAU;
        const rr = k % 2 ? 3.5 : 5.5;
        const x = px + Math.cos(angle) * radius + Math.cos(aa) * rr;
        const y = py + Math.sin(angle) * radius * .65 + Math.sin(aa) * rr;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .25, W / 2, H / 2, Math.max(W, H) * .72);
    vignette.addColorStop(0, 'rgba(255,70,110,0)');
    vignette.addColorStop(1, `rgba(130,10,48,${infection * .22})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function render(ctx) {
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    for (const cloud of clouds) drawCloud(ctx, cloud);
    for (const candidate of formingBiofilms.values()) {
      const progress = clamp(candidate.progress / 3.4, 0, 1);
      ctx.strokeStyle = `rgba(112,229,214,${.18 + progress * .42})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.arc(candidate.x, candidate.y, 18 + progress * 48, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const film of biofilms) drawBiofilm(ctx, film);
    drawInfection(ctx);
    ctx.restore();
  }

  return {
    setSelection(selection) { activeSelection = selection; },
    get cloudCount() { return clouds.length; },
    get deployedCloudCount() { return deployedCloudCount; },
    get biofilmCount() { return biofilms.length; },
    clear,
    reset,
    prepare,
    update,
    render,
  };
}
