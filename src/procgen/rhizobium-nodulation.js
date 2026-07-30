import { W } from '../core/constants.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

const STAGES = [
  'recognition',
  'root-hair-curl',
  'infection-thread',
  'primordium',
  'young-nodule',
  'mature-nodule',
];

const STAGE_DURATION = {
  recognition: 1.8,
  'root-hair-curl': 2.3,
  'infection-thread': 4.7,
  primordium: 3.8,
  'young-nodule': 4.4,
};

function hostCompatible(colony) {
  return Boolean(
    colony?.platform
    && colony.platform.type === 'root'
    && !colony.platform.mycorrhizaStructure,
  );
}

function stageIndex(stage) {
  return Math.max(0, STAGES.indexOf(stage));
}

function stageLabel(site, activity = 0) {
  if (!site.compatible) return 'sem raiz hospedeira';
  if (site.paused) return site.mature ? 'nódulo inativo — pouco carbono' : 'nodulação pausada — pouco carbono';
  if (site.stage === 'recognition') return 'reconhecimento do hospedeiro';
  if (site.stage === 'root-hair-curl') return 'curvatura do pelo radicular';
  if (site.stage === 'infection-thread') return 'fio de infecção';
  if (site.stage === 'primordium') return 'primórdio do nódulo';
  if (site.stage === 'young-nodule') return 'nódulo jovem';
  if (activity > .55) return 'fixação ativa de N₂';
  if (activity > .16) return 'fixação limitada de N₂';
  return 'nódulo inativo — pouco carbono';
}

export function createRhizobiumNodulation({ state, entities, inoculants }) {
  const sites = new Map();
  let totalFixation = 0;
  let lastToastAt = -Infinity;

  function clear() {
    // Os fios de infecção e a FBN pertencem a esta fase: nenhum atravessa.
    entities?.audio?.stopGroup('rhizobium-thread');
    entities?.audio?.stopLoop('nitrogen-fixation:nearest');
    sites.clear();
    totalFixation = 0;
    state.level.rhizobiumNodules = [];
  }

  function reset() {
    clear();
  }

  function createSite(colony) {
    const compatible = hostCompatible(colony);
    const site = {
      id: `nodule-${colony.id}`,
      colony,
      platform: colony.platform,
      x: colony.x,
      surfaceY: colony.platform?.y ?? colony.y,
      depth: clamp((colony.platform?.h || 56) * .34, 16, 34),
      compatible,
      stage: compatible ? 'recognition' : 'incompatible',
      progress: 0,
      maturity: 0,
      mature: false,
      paused: false,
      activity: 0,
      fixationRate: 0,
      phase: Math.random() * TAU,
      lobes: clamp(colony.sourceCount || 1, 1, 3),
      announced: new Set(),
    };
    sites.set(colony.id, site);
    // Reconhecimento hospedeiro–Rhizobium: o sítio nasce JÁ nesse estágio, então
    // a criação é a transição. Uma vez por sítio, nunca por quadro.
    if (compatible) {
      entities?.audio?.play('rhizobiumRecognition', { x: site.x, y: site.surfaceY });
    }
    if (!compatible && state.time - lastToastAt > 2.4) {
      state.toast = 'Rhizobium sem hospedeiro: a colônia permanece na rizosfera, mas não forma nódulos em blocos de solo.';
      state.toastTime = 5.2;
      lastToastAt = state.time;
    }
    return site;
  }

  function syncSites() {
    const rhizobiumColonies = (inoculants.colonies || []).filter(colony => colony.type === 'rhizobium');
    const activeIds = new Set(rhizobiumColonies.map(colony => colony.id));

    for (const colony of rhizobiumColonies) {
      let site = sites.get(colony.id);
      if (!site) site = createSite(colony);
      site.colony = colony;
      site.platform = colony.platform;
      site.x = colony.x;
      site.surfaceY = colony.platform?.y ?? colony.y;
    }
    for (const id of sites.keys()) {
      if (!activeIds.has(id)) sites.delete(id);
    }
    state.level.rhizobiumNodules = [...sites.values()];
  }

  function announce(site, key, text, seconds = 4.8) {
    if (site.announced.has(key)) return;
    site.announced.add(key);
    if (state.time - lastToastAt < 1.8) return;
    state.toast = text;
    state.toastTime = seconds;
    lastToastAt = state.time;
  }

  // Áudio e toast respondem à MESMA transição, mas um não depende do outro: o
  // toast tem cooldown próprio (`announce`) e engoliria o som se fosse o gatilho.
  function advanceStage(site) {
    const index = stageIndex(site.stage);
    const next = STAGES[Math.min(STAGES.length - 1, index + 1)];
    site.stage = next;
    site.progress = 0;
    const audio = entities?.audio;
    const threadKey = `rhizobium-thread:${site.id}`;

    if (next === 'root-hair-curl') {
      audio?.play('rhizobiumRootHairCurl', { x: site.x, y: site.surfaceY });
      announce(site, next, 'Sinalização simbiótica: o pelo radicular começou a se curvar ao redor do Rhizobium.');
    } else if (next === 'infection-thread') {
      audio?.startLoop(threadKey, 'rhizobiumInfectionThread', {
        x: site.x, y: site.surfaceY, gain: .55,
      });
      announce(site, next, 'Fio de infecção: as bactérias avançam de forma controlada para o interior da raiz.');
    } else if (next === 'primordium') {
      // O fio terminou: o loop sai antes de o primórdio soar.
      audio?.stopLoop(threadKey);
      audio?.play('rhizobiumPrimordium', { x: site.x, y: site.surfaceY + site.depth });
      announce(site, next, 'Primórdio nodular: células da raiz começaram a formar o novo órgão simbiótico.');
    } else if (next === 'young-nodule') {
      audio?.play('rhizobiumYoungNodule', { x: site.x, y: site.surfaceY + site.depth });
      announce(site, next, 'Nódulo jovem: o Rhizobium começa a se diferenciar em bacteroides.');
    } else if (next === 'mature-nodule') {
      site.mature = true;
      site.maturity = 1;
      // Única transição mature false → true de um sítio. Um nódulo restaurado já
      // maduro não passa por aqui e por isso não toca conclusão.
      audio?.play('rhizobiumMatureNodule', { x: site.x, y: site.surfaceY + site.depth });
      announce(site, next, 'Nódulo maduro: leghemoglobina controla o oxigênio e a fixação biológica de nitrogênio foi ativada.', 5.6);
      entities.burst(site.x, site.surfaceY + site.depth, '#ff9db5', 36, 145);
    }
  }

  function updateDevelopingSite(site, dt) {
    const colony = site.colony;
    const carbon = clamp(
      .18 + colony.vigor * .72 + (colony.rechargeIntensity || 0) * .32,
      .12,
      1.22,
    );
    const sourceBoost = 1 + Math.max(0, (colony.sourceCount || 1) - 1) * .13;
    site.paused = colony.dormant || colony.vigor < .055;
    site.activity = 0;
    site.fixationRate = 0;

    const audio = entities?.audio;
    const threadKey = `rhizobium-thread:${site.id}`;

    if (site.paused) {
      // Sem carbono o fio para de avançar: o loop recua, mas não é destruído.
      if (site.stage === 'infection-thread') audio?.pauseLoop(threadKey);
      colony.stage = stageLabel(site);
      return;
    }

    const duration = STAGE_DURATION[site.stage] || 1;
    site.progress = clamp(site.progress + dt * carbon * sourceBoost / duration, 0, 1);
    colony.stage = stageLabel(site);

    // Sustenta o loop do fio: posição acompanha a profundidade atual, ganho e
    // rate sobem com o avanço. `startLoop` é idempotente — não cria segundo
    // source nem reinicia a faixa.
    if (site.stage === 'infection-thread') {
      audio?.startLoop(threadKey, 'rhizobiumInfectionThread', {
        x: site.x,
        y: site.surfaceY + site.depth * site.progress,
        gain: .55 + site.progress * .45,
        rate: .94 + site.progress * .12,
      });
    }

    if (site.progress >= 1) advanceStage(site);
  }

  function updateMatureSite(site, dt) {
    const colony = site.colony;
    const carbon = clamp(
      colony.vigor * .82 + (colony.rechargeIntensity || 0) * .36,
      0,
      1,
    );
    const bacteroidCapacity = .58 + Math.min(3, colony.sourceCount || 1) * .24;
    const activity = clamp(carbon * bacteroidCapacity, 0, 1.35);
    site.paused = colony.dormant || colony.vigor < .045;
    site.activity = site.paused ? 0 : activity;
    site.fixationRate = site.activity * (colony.sourceCount || 1);
    totalFixation += site.fixationRate;
    colony.stage = stageLabel(site, site.activity);

    if (site.activity <= 0) return;

    colony.vigor = clamp(colony.vigor - dt * .00165 * site.fixationRate, 0, 1);
    state.player.soil += dt * .022 * site.fixationRate;
    state.player.hope += dt * .013 * site.fixationRate;

    if (Math.random() < dt * .45 * site.activity) {
      const angle = site.phase + state.time * .7;
      entities.burst(
        site.x + Math.cos(angle) * 12,
        site.surfaceY + site.depth + Math.sin(angle) * 7,
        '#ffd783',
        2,
        28,
      );
    }
  }

  // Um loop de FBN por nódulo viraria zumbido: numa raiz com três nódulos
  // maduros seriam três cópias da mesma textura somadas. Toca no máximo UM, o do
  // nódulo funcional mais próximo, e a posição acompanha esse nódulo.
  const FIXATION_AUDIBLE_ACTIVITY = .16;
  const FIXATION_KEY = 'nitrogen-fixation:nearest';

  function updateFixationLoop() {
    const audio = entities?.audio;
    if (!audio) return;
    const player = state.player;
    const playerCenterX = player ? player.x + player.w / 2 : 0;

    let nearest = null;
    let nearestDistance = Infinity;
    for (const site of sites.values()) {
      if (!site.mature || site.activity <= FIXATION_AUDIBLE_ACTIVITY) continue;
      const distance = Math.abs(site.x - playerCenterX);
      if (distance < nearestDistance) {
        nearest = site;
        nearestDistance = distance;
      }
    }

    if (!nearest) {
      audio.stopLoop(FIXATION_KEY);
      return;
    }
    audio.startLoop(FIXATION_KEY, 'nitrogenFixationActive', {
      x: nearest.x,
      y: nearest.surfaceY + nearest.depth,
      // Proporcional à atividade real do nódulo, e sempre discreto.
      gain: clamp(nearest.activity, 0, 1),
      rate: .96 + clamp(nearest.activity, 0, 1) * .08,
    });
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    syncSites();
    totalFixation = 0;

    for (const site of sites.values()) {
      const colony = site.colony;
      if (!site.compatible) {
        colony.stage = 'rizosfera sem hospedeiro';
        site.activity = 0;
        site.fixationRate = 0;
        continue;
      }
      if (!site.mature) updateDevelopingSite(site, dt);
      else updateMatureSite(site, dt);
    }

    updateFixationLoop();
  }

  function drawRootHair(ctx, site) {
    const stage = stageIndex(site.stage);
    if (stage < 1) return;
    const curl = clamp(stage === 1 ? site.progress : 1, 0, 1);
    const y = site.surfaceY - 4;
    ctx.strokeStyle = `rgba(235,221,198,${.35 + curl * .55})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(site.x - 28, y + 2);
    ctx.bezierCurveTo(
      site.x - 18, y - 24 * curl,
      site.x + 22, y - 25 * curl,
      site.x + 11, y - 4,
    );
    if (curl > .56) {
      ctx.bezierCurveTo(site.x + 2, y + 7, site.x - 7, y - 3, site.x + 1, y - 10);
    }
    ctx.stroke();
  }

  function drawInfectionThread(ctx, site) {
    const index = stageIndex(site.stage);
    if (index < 2) return;
    const progress = index === 2 ? site.progress : 1;
    const startY = site.surfaceY - 7;
    const endY = site.surfaceY + site.depth * progress;
    ctx.strokeStyle = `rgba(224,190,255,${.42 + progress * .5})`;
    ctx.lineWidth = 2.1;
    ctx.shadowBlur = 7;
    ctx.shadowColor = '#c7a5ff';
    ctx.beginPath();
    ctx.moveTo(site.x + 1, startY);
    ctx.bezierCurveTo(
      site.x + 12, lerp(startY, endY, .34),
      site.x - 10, lerp(startY, endY, .7),
      site.x + 2, endY,
    );
    ctx.stroke();
    ctx.shadowBlur = 0;

    const cellCount = 2 + Math.floor(progress * 5);
    for (let i = 0; i < cellCount; i++) {
      const t = (i + .5) / cellCount * progress;
      const yy = lerp(startY, site.surfaceY + site.depth, t);
      const xx = site.x + Math.sin(t * Math.PI * 3 + site.phase) * 5;
      ctx.fillStyle = '#ead8ff';
      ctx.beginPath();
      ctx.ellipse(xx, yy, 2.8, 1.4, t * 2, 0, TAU);
      ctx.fill();
    }
  }

  function drawPrimordium(ctx, site) {
    const index = stageIndex(site.stage);
    if (index < 3) return;
    const development = index === 3 ? site.progress * .48 : index === 4 ? .48 + site.progress * .42 : 1;
    const radius = lerp(3, 15 + site.lobes * 1.7, development);
    const centerY = site.surfaceY + site.depth;

    ctx.save();
    ctx.translate(site.x, centerY);
    ctx.scale(1, .76);
    const gradient = ctx.createRadialGradient(-radius * .2, -radius * .25, 1, 0, 0, radius * 1.2);
    gradient.addColorStop(0, index >= 5 ? '#ffd0da' : '#f6dfc8');
    gradient.addColorStop(.62, index >= 5 ? '#df6688' : '#dba98f');
    gradient.addColorStop(1, 'rgba(94,38,50,.82)');
    ctx.fillStyle = gradient;
    ctx.strokeStyle = index >= 5 ? '#ffb2c5' : '#f1c7ac';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const angle = i / 18 * TAU;
      const lobe = 1 + Math.sin(angle * site.lobes + site.phase) * .12 * development;
      const x = Math.cos(angle) * radius * lobe;
      const y = Math.sin(angle) * radius * lobe;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (index >= 4) {
      const count = 5 + site.colony.sourceCount * 3;
      for (let i = 0; i < count; i++) {
        const angle = i / count * TAU + site.phase;
        const rr = radius * (.2 + (i % 4) * .15);
        ctx.fillStyle = index >= 5 ? '#7b254a' : '#a2697d';
        ctx.globalAlpha = .52 + (i % 3) * .15;
        ctx.beginPath();
        ctx.ellipse(Math.cos(angle) * rr, Math.sin(angle) * rr, 3.2, 1.25, angle, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawFixationFlux(ctx, site) {
    if (!site.mature || site.activity <= .08) return;
    const centerY = site.surfaceY + site.depth;
    const intensity = clamp(site.activity, 0, 1);
    for (let i = 0; i < 5; i++) {
      const t = (state.time * (.18 + i * .012) + i * .21 + site.phase) % 1;
      const angle = site.phase + i * 1.37;
      const startX = site.x + Math.cos(angle) * (36 + i * 3);
      const startY = centerY - 30 - i * 3;
      const x = lerp(startX, site.x, t);
      const y = lerp(startY, centerY, t) + Math.sin(t * Math.PI) * 8;
      ctx.globalAlpha = (.25 + intensity * .6) * (1 - Math.abs(t - .5) * .7);
      ctx.fillStyle = '#8db8ff';
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, TAU);
      ctx.fill();
    }

    for (let i = 0; i < 4; i++) {
      const t = (state.time * .22 + i * .27 + site.phase * .2) % 1;
      const x = site.x + (i - 1.5) * 5 + Math.sin(t * TAU + i) * 2;
      const y = lerp(centerY, site.surfaceY + 5, t);
      ctx.globalAlpha = .25 + intensity * .65;
      ctx.fillStyle = '#ffd783';
      ctx.beginPath();
      ctx.arc(x, y, 2.1, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.font = '700 8px Inter,system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(180,208,255,.82)';
    ctx.fillText('N₂', site.x - 27, centerY - 24);
    ctx.fillStyle = 'rgba(255,220,139,.9)';
    ctx.fillText('NH₄⁺', site.x + 26, site.surfaceY + 4);
  }

  function drawIncompatible(ctx, site) {
    ctx.strokeStyle = 'rgba(199,165,255,.45)';
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(site.x, site.surfaceY - 8, 15, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function render(ctx) {
    if (!sites.size) return;
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    for (const site of sites.values()) {
      if (site.x < state.cameraX - 160 || site.x > state.cameraX + W + 160) continue;
      if (!site.compatible) {
        drawIncompatible(ctx, site);
        continue;
      }
      drawRootHair(ctx, site);
      drawInfectionThread(ctx, site);
      drawPrimordium(ctx, site);
      drawFixationFlux(ctx, site);
    }
    ctx.restore();
  }

  return {
    get siteCount() { return sites.size; },
    get matureCount() { return [...sites.values()].filter(site => site.mature).length; },
    get activeCount() { return [...sites.values()].filter(site => site.mature && site.activity > .16).length; },
    get incompatibleCount() { return [...sites.values()].filter(site => !site.compatible).length; },
    get fixationRate() { return totalFixation; },
    clear,
    reset,
    update,
    render,
  };
}
