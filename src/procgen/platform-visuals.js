import { H, W } from '../core/constants.js';
import { drawWorldLabel } from './world-label.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function platformSeed(platform) {
  const x = Math.round(platform.x || 0);
  const y = Math.round(platform.rootBaseY ?? platform.y ?? 0);
  const w = Math.round(platform.w || 0);
  return Math.abs((x * 73856093) ^ (y * 19349663) ^ (w * 83492791));
}

function pseudo(seed, index) {
  const value = Math.sin(seed * .000013 + index * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function roundedPath(ctx, platform, radius) {
  ctx.beginPath();
  ctx.roundRect(platform.x, platform.y, platform.w, platform.h, radius);
}

function stateInfo(platform) {
  const health = clamp(platform.rootHealth ?? 1, 0, 1);
  const name = platform.rootState || (health >= .75 ? 'healthy' : health >= .5 ? 'stressed' : health >= .25 ? 'compromised' : 'collapse');
  if (name === 'healthy') return { label: 'saudável', color: '#9bea8f', overlay: 'rgba(99,208,127,.08)' };
  if (name === 'stressed') return { label: 'estressada', color: '#ffd36f', overlay: 'rgba(244,177,70,.12)' };
  if (name === 'compromised') return { label: 'comprometida', color: '#ff9c70', overlay: 'rgba(214,84,67,.18)' };
  return { label: 'em colapso', color: '#ff657f', overlay: 'rgba(79,25,38,.36)' };
}

const ROOT_PALETTE = Object.freeze({
  outline: '#3f2d1d',
  innerBase: '#4b361f',
  green: ['#63753a', '#6d8140', '#596b33'],
  greenStroke: '#394622',
  blue: ['#70807a', '#7c8d86', '#66756f'],
  blueStroke: '#4c5a56',
  ochreSmall: ['#6d532d', '#785b31', '#624a27'],
  ochreLarge: ['#6f5027', '#78562a', '#654821'],
  ochreStroke: '#4a3720',
  radicle: '#8c9256',
});

function drawTissueLayerCanvas(ctx, seed, options) {
  const { startX, endX, startY, endY, cellW, cellH, fillColors, strokeColor, strokeWidth } = options;
  const width = endX - startX;
  const height = endY - startY;
  const cols = Math.max(1, Math.round(width / cellW));
  const rows = Math.max(1, Math.round(height / cellH));
  const dx = width / cols;
  const dy = height / rows;

  for (let i = 0; i < rows; i++) {
    const rowY = startY + i * dy;
    const isOffset = (i % 2 === 1);
    const currentCols = isOffset ? cols + 1 : cols;

    for (let j = 0; j < currentCols; j++) {
      const idx = i * 31 + j * 7;
      const cellX = startX + j * dx - (isOffset ? dx * 0.5 : 0);
      const jx = (pseudo(seed, idx + 1) - 0.5) * dx * 0.2;
      const jy = (pseudo(seed, idx + 2) - 0.5) * dy * 0.2;
      const w = dx * (0.95 + pseudo(seed, idx + 3) * 0.13);
      const h = dy * (0.95 + pseudo(seed, idx + 4) * 0.13);
      const rx = Math.min(w, h) * (0.25 + pseudo(seed, idx + 5) * 0.2);
      const fill = fillColors[Math.floor(pseudo(seed, idx + 6) * fillColors.length)];

      ctx.fillStyle = fill;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.beginPath();
      ctx.roundRect(cellX + jx, rowY + jy, w, h, rx);
      ctx.fill();
      ctx.stroke();

      // Nucleus
      const nucW = w * (0.12 + pseudo(seed, idx + 7) * 0.1);
      const nucH = h * (0.12 + pseudo(seed, idx + 8) * 0.1);
      const maxOffX = Math.max(0, (w / 2) - nucW - strokeWidth);
      const maxOffY = Math.max(0, (h / 2) - nucH - strokeWidth);
      let offX = (pseudo(seed, idx + 9) - 0.5) * 2 * maxOffX;
      let offY = (pseudo(seed, idx + 10) - 0.5) * 2 * maxOffY;
      if (pseudo(seed, idx + 11) > 0.5) offX *= 1.3;
      if (pseudo(seed, idx + 12) > 0.5) offY *= 1.3;
      offX = clamp(offX, -maxOffX, maxOffX);
      offY = clamp(offY, -maxOffY, maxOffY);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.ellipse(cellX + jx + w / 2 + offX, rowY + jy + h / 2 + offY, Math.max(1, nucW), Math.max(1, nucH), 0, 0, TAU);
      ctx.fill();
    }
  }
}

function drawUpwardHairs(ctx, platform, seed) {
  const hairCount = Math.max(3, Math.min(12, Math.floor(platform.w / 60)));
  const safeCount = Math.max(2, hairCount);
  const margin = platform.w * 0.13;
  const height = platform.h;
  ctx.save();
  ctx.strokeStyle = ROOT_PALETTE.radicle;
  ctx.lineWidth = clamp(height * 0.020, 1.4, 2.6);
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.95;

  for (let i = 0; i < safeCount; i++) {
    const t = safeCount === 1 ? 0.5 : i / (safeCount - 1);
    const startX = platform.x + margin + t * (platform.w - margin * 2) + (pseudo(seed, i + 80) - 0.5) * platform.w * 0.03;
    const startY = platform.y + pseudo(seed, i + 81) * height * 0.07;
    const length = (0.2 + pseudo(seed, i + 82) * 0.15) * height;

    const c1x = startX + (pseudo(seed, i + 83) - 0.5) * 12;
    const c2x = startX + (pseudo(seed, i + 84) - 0.5) * 24;
    const endX = startX + (pseudo(seed, i + 85) - 0.5) * 30;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(c1x, startY - length * 0.3, c2x, startY - length * 0.7, endX, startY - length);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawRootVisual(ctx, platform) {
  const seed = platformSeed(platform);
  const radius = platform.final ? 18 : 15;
  const health = clamp(platform.rootHealth ?? 1, 0, 1);
  const permanentDamage = clamp(platform.permanentDamage || 0, 0, .7);
  const stateStyle = stateInfo(platform);

  // 1. Radículas / Pelos no topo
  drawUpwardHairs(ctx, platform, seed);

  ctx.save();
  roundedPath(ctx, platform, radius);
  ctx.clip();

  // 2. Fundo base
  ctx.fillStyle = ROOT_PALETTE.innerBase;
  ctx.fillRect(platform.x, platform.y, platform.w, platform.h);

  const padX = platform.w * 0.05;
  const gX = platform.x - padX;
  const gEndX = platform.x + platform.w + padX;
  const y = platform.y;
  const height = platform.h;

  const greenBand = height * 0.20;
  const blueBand = height * 0.14;
  const smallOchreBand = height * 0.10;

  // Camada 1: Verde (Topo)
  drawTissueLayerCanvas(ctx, seed, {
    startX: gX, endX: gEndX, startY: y - 5, endY: y + greenBand,
    cellW: clamp(height * 0.24, 15, 36), cellH: Math.max(4, greenBand * 0.5),
    fillColors: ROOT_PALETTE.green, strokeColor: ROOT_PALETTE.greenStroke,
    strokeWidth: clamp(height * 0.010, 0.75, 1.2),
  });

  // Camada 2: Azul
  drawTissueLayerCanvas(ctx, seed, {
    startX: gX, endX: gEndX, startY: y + greenBand, endY: y + greenBand + blueBand,
    cellW: clamp(height * 0.12, 10, 20), cellH: Math.max(3, blueBand * 0.5),
    fillColors: ROOT_PALETTE.blue, strokeColor: ROOT_PALETTE.blueStroke,
    strokeWidth: clamp(height * 0.008, 0.65, 1),
  });

  // Camada 3: Ocre Pequena
  drawTissueLayerCanvas(ctx, seed, {
    startX: gX, endX: gEndX, startY: y + greenBand + blueBand, endY: y + greenBand + blueBand + smallOchreBand,
    cellW: clamp(height * 0.15, 12, 22), cellH: Math.max(3, smallOchreBand * 0.5),
    fillColors: ROOT_PALETTE.ochreSmall, strokeColor: ROOT_PALETTE.ochreStroke,
    strokeWidth: clamp(height * 0.009, 0.7, 1.05),
  });

  // Camada 4: Ocre Grande (Córtex inferior)
  drawTissueLayerCanvas(ctx, seed, {
    startX: gX, endX: gEndX, startY: y + greenBand + blueBand + smallOchreBand, endY: y + height + 10,
    cellW: clamp(height * 0.26, 17, 34), cellH: clamp(height * 0.13, 10, 18),
    fillColors: ROOT_PALETTE.ochreLarge, strokeColor: ROOT_PALETTE.ochreStroke,
    strokeWidth: clamp(height * 0.010, 0.75, 1.15),
  });

  // Overlay de estado de saúde
  ctx.fillStyle = stateStyle.overlay;
  ctx.fillRect(platform.x, platform.y, platform.w, platform.h);

  if (permanentDamage > .01) {
    const scarWidth = platform.w * permanentDamage;
    const scarX = platform.x + platform.w - scarWidth;
    const scar = ctx.createLinearGradient(scarX, platform.y, platform.x + platform.w, platform.y + platform.h);
    scar.addColorStop(0, 'rgba(80,42,47,.04)');
    scar.addColorStop(.45, `rgba(72,33,43,${.2 + permanentDamage * .55})`);
    scar.addColorStop(1, `rgba(37,20,31,${.28 + permanentDamage * .5})`);
    ctx.fillStyle = scar;
    ctx.fillRect(scarX, platform.y, scarWidth, platform.h);
  }

  const rootDamage = clamp(platform.rootDamage || 0, 0, 1);
  if (rootDamage > .025) {
    const stress = ctx.createLinearGradient(platform.x, platform.y, platform.x + platform.w, platform.y + platform.h);
    stress.addColorStop(0, `rgba(255,116,105,${rootDamage * .16})`);
    stress.addColorStop(.55, `rgba(128,42,54,${rootDamage * .24})`);
    stress.addColorStop(1, `rgba(72,22,40,${rootDamage * .12})`);
    ctx.fillStyle = stress;
    ctx.fillRect(platform.x, platform.y, platform.w, platform.h);
  }

  ctx.restore();

  // Outlining do bloco de raiz
  ctx.save();
  ctx.strokeStyle = ROOT_PALETTE.outline;
  ctx.lineWidth = Math.max(2, height * 0.025);
  roundedPath(ctx, platform, radius);
  ctx.stroke();
  ctx.restore();

  if (platform.fixedObjective) {
    const objectivePulse = .78 + Math.sin(3.2) * .08;
    ctx.save();
    ctx.strokeStyle = `rgba(255,213,111,${objectivePulse})`;
    ctx.fillStyle = 'rgba(255,213,111,.08)';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#ffd56f';
    roundedPath(ctx, platform, radius);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffd56f';
    ctx.fillRect(platform.x + 12, platform.y - 2, Math.max(24, platform.w - 24), 4);
    ctx.restore();
  }
}

export function createPlatformVisuals({ state }) {

  const SOIL_PALETTE = Object.freeze({
    base: '#3a2115',
    aggregates: ['#472a1b', '#301b11', '#402417'],
    pores: '#1c100a',
    silt: ['#613c28', '#523120'],
    outline: '#24140d',
  });

  function drawOrganicBlobCanvas(ctx, seed, idx, cx, cy, radius, fillStyle, alpha) {
    const sides = Math.floor(5 + pseudo(seed, idx + 1) * 4);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fillStyle;
    ctx.strokeStyle = fillStyle;
    ctx.lineWidth = radius * 0.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * TAU;
      const r = radius * (0.6 + pseudo(seed, idx + 10 + i) * 0.6);
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawSoil(ctx, platform) {
    const seed = platformSeed(platform);
    const radius = 10;
    const x = platform.x;
    const y = platform.y;
    const width = platform.w;
    const height = platform.h;
    const area = width * height;

    ctx.save();
    roundedPath(ctx, platform, radius);
    ctx.clip();

    // Fundo base
    ctx.fillStyle = SOIL_PALETTE.base;
    ctx.fillRect(x, y, width, height);

    // 1. Macroagregados (Torrões maiores)
    const macroCount = Math.floor(area / 1500);
    for (let i = 0; i < macroCount; i++) {
      const idx = i * 13 + 500;
      const cx = x + pseudo(seed, idx) * width;
      const cy = y + pseudo(seed, idx + 1) * height;
      const r = (0.15 + pseudo(seed, idx + 2) * 0.20) * height;
      const color = SOIL_PALETTE.aggregates[Math.floor(pseudo(seed, idx + 3) * SOIL_PALETTE.aggregates.length)];
      const alpha = 0.7 + pseudo(seed, idx + 4) * 0.3;
      drawOrganicBlobCanvas(ctx, seed, idx, cx, cy, r, color, alpha);
    }

    // 2. Porosidade (Espaços vazios escuros estruturais)
    const poreCount = Math.floor(area / 2000);
    for (let i = 0; i < poreCount; i++) {
      const idx = i * 17 + 1000;
      const cx = x + pseudo(seed, idx) * width;
      const cy = y + pseudo(seed, idx + 1) * height;
      const r = (0.05 + pseudo(seed, idx + 2) * 0.07) * height;
      drawOrganicBlobCanvas(ctx, seed, idx, cx, cy, r, SOIL_PALETTE.pores, 0.8);
    }

    // 3. Partículas de Silte / Areia (Incrustações minerais claras)
    const siltCount = Math.floor(area / 800);
    for (let i = 0; i < siltCount; i++) {
      const idx = i * 19 + 2000;
      const cx = x + pseudo(seed, idx) * width;
      const cy = y + pseudo(seed, idx + 1) * height;
      const r = 1.5 + pseudo(seed, idx + 2) * 2.5;
      const color = SOIL_PALETTE.silt[Math.floor(pseudo(seed, idx + 3) * SOIL_PALETTE.silt.length)];
      const alpha = 0.5 + pseudo(seed, idx + 4) * 0.4;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();

    // Outlining do bloco de solo
    ctx.save();
    ctx.strokeStyle = SOIL_PALETTE.outline;
    ctx.lineWidth = Math.max(2, height * 0.025);
    roundedPath(ctx, platform, radius);
    ctx.stroke();
    ctx.restore();
  }

  function drawTraversalDebug(ctx) {
    const encounters = state.level.traversalEncounters || [];
    if (!state.level.traversalDebugVisible || !encounters.length) return;
    const colors = { shared: '#63ef9d', primary: '#64b7ff', optional: '#ffd75c' };
    ctx.save();
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 2;
    for (const encounter of encounters) {
      const blocks = (state.level.platforms || [])
        .filter(platform => platform.encounterInstanceId === encounter.encounterInstanceId);
      for (const role of ['primary', 'optional']) {
        const key = role === 'primary' ? 'primaryRouteOrder' : 'optionalRouteOrder';
        const route = blocks
          .filter(platform => platform.routeRole === role || platform.routeRole === 'shared')
          .sort((left, right) => left[key] - right[key]);
        ctx.strokeStyle = colors[role];
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        route.forEach((platform, index) => {
          const x = platform.x + platform.w / 2;
          const y = platform.y - 14;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const platform of blocks) {
        ctx.strokeStyle = colors[platform.routeRole] || '#fff';
        ctx.strokeRect(platform.x - 2, platform.y - 2, platform.w + 4, platform.h + 4);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(
          `${platform.blockRole}:${platform.platformId.split(':').at(-1)}`,
          platform.x + platform.w / 2,
          platform.y - 21,
        );
      }
      for (const reward of (state.level.exudates || []).filter(item => (
        item.encounterInstanceId === encounter.encounterInstanceId
      ))) {
        ctx.strokeStyle = '#ffd75c';
        ctx.beginPath();
        ctx.arc(reward.x, reward.y, 22, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawOptionalDetourDebug(ctx) {
    if (
      !state.level.traversalDebugVisible
      || !state.level.optionalDetourPlaytestMode
    ) return;
    const detour = state.level.optionalDetours?.[0];
    if (!detour) return;
    const byId = id => (state.level.platforms || []).find(platform => (
      (platform.platformId ?? platform.id) === id
    ));
    const groups = [
      { ids: [detour.startPlatformId], color: '#ffcf56' },
      { ids: [detour.preEntryPlatformId], color: '#65d7ff' },
      { ids: [detour.accessLandingId], color: '#ff71e8' },
      { ids: detour.transitionPlatformIds || [], color: '#ff9f59' },
      { ids: detour.cruisePlatformIds || [], color: '#b889ff' },
      { ids: [detour.rejoinPlatformId], color: '#74f39a' },
    ];
    ctx.save();
    ctx.lineWidth = 3;
    ctx.setLineDash([9, 6]);
    for (const group of groups) {
      ctx.strokeStyle = group.color;
      for (const id of group.ids) {
        const platform = byId(id);
        if (!platform) continue;
        ctx.strokeRect(platform.x - 5, platform.y - 5, platform.w + 10, platform.h + 10);
        if (platform.detourModuleId === 'hard-movement-combo') {
          const gap = Number(platform.movementGap);
          const deltaY = Number(platform.verticalDeltaY);
          ctx.save();
          ctx.setLineDash([]);
          ctx.font = '600 12px ui-monospace, SFMono-Regular, Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = group.color;
          ctx.fillText(
            `${platform.optionalDetourSection} | ${platform.movementRecipeId}`
              + ` | ${platform.verticalIntent}`
              + ` | ${platform.validatedPrimitiveId || 'INVALID'}`
              + ` | gap ${Number.isFinite(gap) ? Math.round(gap) : '-'}`
              + ` | dY ${Number.isFinite(deltaY) ? Math.round(deltaY) : '-'}`,
            platform.x + platform.w / 2,
            platform.y - 10,
          );
          ctx.restore();
        }
      }
    }
    const host = byId(detour.startPlatformId);
    const access = byId(detour.accessLandingId);
    if (host && access) {
      ctx.strokeStyle = '#d8bb78';
      ctx.beginPath();
      ctx.moveTo(host.x + host.w - 26, host.y - 6);
      ctx.lineTo(access.x - 26, access.y + 16);
      ctx.stroke();
    }
    const viewports = detour.hypotheticalViewports || {};
    for (const [key, viewport] of Object.entries(viewports)) {
      ctx.strokeStyle = key === 'zoom1' ? '#46e8ff' : '#ff69c8';
      ctx.lineWidth = 2;
      ctx.setLineDash(key === 'zoom1' ? [14, 8] : [5, 7]);
      ctx.strokeRect(viewport.x, viewport.y, viewport.w, viewport.h);
    }
    ctx.restore();
  }

  // Portões de subida da ROTA PRINCIPAL. Desenha o desnível pedido entre
  // hospedeiro e degrau, e o estado da escada que o abre. Nada aqui vira
  // colisor: é só `ctx`.
  function drawAscentGateDebug(ctx) {
    if (!state.level.traversalDebugVisible) return;
    const gates = state.level.ascentGates || [];
    if (!gates.length) return;
    ctx.save();
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (const gate of gates) {
      const { host, destination } = gate;
      if (!host || !destination) continue;
      const ladder = (state.level.azospirillumRootLadders || [])
        .find(entry => entry.ascentGateId === gate.id || entry.host === host) || null;
      const developed = Boolean(ladder?.developed);
      ctx.strokeStyle = developed ? '#8ef5b0' : '#72e8dd';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 3;
      ctx.setLineDash(developed ? [] : [9, 6]);
      const x = host.x + host.w - 10;
      ctx.beginPath();
      ctx.moveTo(x, host.y - 6);
      ctx.lineTo(x, destination.y - 6);
      ctx.stroke();
      ctx.setLineDash([]);
      // Contorno do degrau: o que a rota PEDIU, para conferir contra o que
      // apareceu na tela.
      ctx.lineWidth = 2;
      ctx.strokeRect(destination.x, destination.y, destination.w, destination.h);
      const estado = !ladder ? 'SEM ESCADA'
        : developed ? 'escada madura'
        : ladder.progress > 0 ? `escada ${Math.round(ladder.progress * 100)}%`
        : 'inocular Azospirillum aqui';
      ctx.fillText(`PORTAO +${gate.rise}px — ${estado}`, x + 8, destination.y - 12);
    }
    ctx.restore();
  }

  // Overlay do §21. Desenha limites de zona, nós do grafo, arestas normais, a
  // aresta bloqueada, o vão intencional e a saída por queda. Nada aqui cria
  // colisor: é só `ctx`.
  function drawTopologyT1Debug(ctx) {
    if (!state.level.traversalDebugVisible) return;
    const detour = (state.level.optionalDetours || [])
      .find(entry => entry.implementationStage === 'T1');
    if (!detour) return;
    const overlay = detour.topologyOverlay || {};
    const byId = id => (state.level.platforms || []).find(platform => (
      (platform.platformId ?? platform.id) === id
    ));
    ctx.save();
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    // Limites das zonas.
    const corridor = overlay.corridor || {};
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    for (const zone of overlay.zones || []) {
      const exit = byId(zone.exitPlatformId);
      if (!exit) continue;
      const x = exit.x + exit.w;
      ctx.strokeStyle = zone.challengeId ? '#ff8ae2' : '#5fd0ff';
      ctx.beginPath();
      ctx.moveTo(x, (corridor.top ?? exit.y - 320));
      ctx.lineTo(x, (corridor.bottom ?? exit.y + 220));
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(
        `${zone.role}/${zone.verticalIntent}${zone.challengeId ? ` [${zone.challengeId}]` : ''}`,
        x + 6,
        (corridor.top ?? exit.y - 320) + 16,
      );
    }

    // Nós do grafo: faixas, não posições finais — por isso retângulos ocos.
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = 'rgba(160, 200, 255, .55)';
    for (const node of overlay.nodes || []) {
      const [left, right] = node.xRange || [];
      const [top, bottom] = node.yRange || [];
      if (![left, right, top, bottom].every(Number.isFinite)) continue;
      ctx.strokeRect(left, top, right - left, bottom - top);
    }

    // Arestas.
    ctx.setLineDash([]);
    for (const edge of overlay.edges || []) {
      const from = byId(edge.from);
      const to = byId(edge.to);
      if (!from || !to) continue;
      if (edge.role === 'movement') ctx.strokeStyle = '#8ef5b0';
      else if (edge.role === 'drop-rejoin') ctx.strokeStyle = '#ffd75c';
      else ctx.strokeStyle = '#ff5b6e';
      ctx.lineWidth = edge.role === 'movement' ? 2 : 4;
      ctx.beginPath();
      ctx.moveTo(from.x + from.w - 8, from.y - 10);
      ctx.lineTo(to.x + 8, to.y - 10);
      ctx.stroke();
      if (edge.role !== 'movement') {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(
          edge.blockedUntil || edge.role,
          from.x + from.w + 10,
          from.y - 18,
        );
      }
    }

    // Corredor de queda: reserva VAZIA. Desenhado só como contorno e texto —
    // nada aqui vira colisor, e é justamente por ser vazio que ele existe.
    const dropCorridor = overlay.dropCorridor;
    if (dropCorridor) {
      ctx.setLineDash([14, 8]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffd75c';
      ctx.strokeRect(
        dropCorridor.left,
        dropCorridor.top,
        dropCorridor.right - dropCorridor.left,
        dropCorridor.bottom - dropCorridor.top,
      );
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd75c';
      const textX = dropCorridor.left + 10;
      let textY = dropCorridor.top + 18;
      const lines = [
        overlay.dropRejoinDirect
          ? 'DROP REJOIN — QUEDA DIRETA'
          : 'DROP REJOIN — QUEDA INDIRETA',
        `PLATAFORMAS NO CORREDOR: ${overlay.dropRejoinPlatformCount ?? '-'}`,
        `SEPARACAO MINIMA DA ROTA FACIL: ${overlay.minimumPrimaryClearance ?? '-'} px`,
      ];
      for (const line of lines) {
        ctx.fillText(line, textX, textY);
        textY += 15;
      }
    }

    // Vãos intencionais.
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 6]);
    for (const gap of overlay.intentionalGaps || []) {
      const bounds = gap.bounds;
      if (!bounds) continue;
      ctx.strokeStyle = gap.kind === 'mycorrhiza-bridge-gap' ? '#ff5b6e' : '#ffa552';
      ctx.strokeRect(
        bounds.left,
        bounds.top,
        bounds.right - bounds.left,
        bounds.bottom - bounds.top,
      );
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(gap.kind, bounds.left + 6, bounds.top - 4);
    }
    ctx.restore();
  }

  function drawWorld(ctx) {
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    const visibleWidth = state.visibleWorldWidth || state.viewportWidth || W;
    const visibleHeight = state.visibleWorldHeight || state.viewportHeight || H;
    const cameraY = state.cameraY || 0;
    const margin = 220;
    const viewLeft = (state.cameraX || 0) - margin;
    const viewRight = (state.cameraX || 0) + visibleWidth + margin;
    const viewTop = cameraY - margin;
    const viewBottom = cameraY + visibleHeight + margin;
    for (const platform of state.level.platforms || []) {
      if (platform.mycorrhizaStructure || platform.azospirillumStructure) continue;
      if (
        platform.x + platform.w < viewLeft
        || platform.x > viewRight
        || platform.y + platform.h < viewTop
        || platform.y > viewBottom
      ) continue;
      // Recovery desligada e recovery desligada, sem excecao. A versao anterior
      // tinha `&& !platform.safetyStep`, e por isso um degrau da antiga rede
      // anti-softlock continuava visivel mesmo com o toggle ativo. Defesa contra
      // niveis salvos antigos, uso do Phase Lab e residuos.
      //
      // Uma recovery PROMOVIDA (ex.: hospedeiro da escada de Azospirillum)
      // recebe `recovery = false` e por isso continua aqui, visivel e normal.
      if (platform.recovery && state.recoveryPlatformsDisabled) continue;

      if (platform.type === 'soil') drawSoil(ctx, platform);
      else drawRootVisual(ctx, platform);
    }

    for (const label of state.level.worldLabels || []) {
      drawWorldLabel(ctx, label.x, label.y, label.text, label.options);
    }
    drawTraversalDebug(ctx);
    drawOptionalDetourDebug(ctx);
    drawTopologyT1Debug(ctx);
    drawAscentGateDebug(ctx);

    ctx.restore();
  }

  function renderLabel(ctx) {
    // Rótulos adicionais, se houver
  }

  return {
    drawWorld,
    renderWorld: drawWorld,
    renderLabel,
  };
}
