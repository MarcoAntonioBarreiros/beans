const DEFAULT_SEED = 0x4e454352;
const SPORE_COUNT = 42;
const HYPHA_COUNT = 7;
const TILE_WIDTH = 1540;
const OVERSCAN = 96;
const TAU = Math.PI * 2;

function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function createNecroticZone({ seed = DEFAULT_SEED, enabled = true } = {}) {
  const random = createRandom(seed);
  const spores = Array.from({ length: SPORE_COUNT }, () => ({
    x: random() * TILE_WIDTH,
    depth: .08 + random() * .9,
    speed: 5 + random() * 13,
    drift: 2 + random() * 8,
    frequency: .18 + random() * .42,
    phase: random() * TAU,
    radiusX: .55 + random() * 1.25,
    radiusY: 1.8 + random() * 3.8,
    alpha: .12 + random() * .22,
    hue: random(),
  }));
  const hyphae = Array.from({ length: HYPHA_COUNT }, (_, index) => ({
    x: (index + .45 + random() * .32) / HYPHA_COUNT * TILE_WIDTH,
    depth: .18 + random() * .58,
    length: 24 + random() * 42,
    lean: -18 + random() * 36,
    phase: random() * TAU,
    sway: 1.4 + random() * 3.4,
    fork: random() > .28,
    alpha: .16 + random() * .18,
  }));

  let active = Boolean(enabled);
  let elapsed = 0;
  const diagnostics = {
    enabled: active,
    elapsed,
    particleCount: spores.length,
    hyphaCount: hyphae.length,
    poolIdentity: spores,
    lastBounds: {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
  };

  function setEnabled(nextEnabled) {
    active = Boolean(nextEnabled);
    diagnostics.enabled = active;
  }

  function update(dt) {
    if (!active) return;
    const safeDt = Math.max(0, Math.min(.1, finite(dt)));
    elapsed += safeDt;
    diagnostics.elapsed = elapsed;
  }

  function boundaryY(x, top, layer = 0) {
    const slow = Math.sin(x * .0082 + elapsed * .23 + layer * 1.7);
    const broad = Math.sin(x * .0029 - elapsed * .12 + layer * 2.4);
    const amplitude = layer === 0 ? 1.65 : 1;
    return top - 7.5
      + slow * 2.7 * amplitude
      + broad * 2.4 * amplitude
      + layer * 4.8;
  }

  function drawFogLayer(ctx, left, right, top, bottom, layer, color, alpha) {
    const step = 86 + layer * 17;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(left, boundaryY(left, top, layer));
    for (let x = left; x < right; x += step) {
      const nextX = Math.min(right, x + step);
      const controlX = (x + nextX) / 2;
      const controlY = boundaryY(controlX, top, layer)
        + Math.sin(controlX * .015 + elapsed * (.14 + layer * .035)) * (2.6 + layer);
      ctx.quadraticCurveTo(
        controlX,
        controlY,
        nextX,
        boundaryY(nextX, top, layer),
      );
    }
    ctx.lineTo(right, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawSpores(ctx, left, right, top, bottom) {
    const depth = Math.max(54, bottom - top);
    const firstTile = Math.floor((left - OVERSCAN) / TILE_WIDTH);
    const lastTile = Math.floor((right + OVERSCAN) / TILE_WIDTH);
    for (let tile = firstTile; tile <= lastTile; tile++) {
      const tileX = tile * TILE_WIDTH;
      for (const spore of spores) {
        const x = tileX + spore.x
          + Math.sin(elapsed * spore.frequency + spore.phase) * spore.drift;
        if (x < left - OVERSCAN || x > right + OVERSCAN) continue;
        const travel = elapsed * spore.speed + spore.depth * depth;
        const y = bottom - positiveModulo(travel, depth + 18);
        const fadeIn = Math.min(1, Math.max(0, (bottom - y) / 13));
        const fadeOut = Math.min(1, Math.max(0, (y - top + 8) / 20));
        ctx.globalAlpha = spore.alpha * fadeIn * fadeOut;
        ctx.fillStyle = spore.hue < .34
          ? '#9b365c'
          : spore.hue < .68 ? '#b43f70' : '#74416f';
        ctx.beginPath();
        ctx.ellipse(x, y, spore.radiusX, spore.radiusY, 0, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawHyphae(ctx, left, right, top, bottom) {
    const firstTile = Math.floor((left - OVERSCAN) / TILE_WIDTH);
    const lastTile = Math.floor((right + OVERSCAN) / TILE_WIDTH);
    ctx.lineCap = 'round';
    for (let tile = firstTile; tile <= lastTile; tile++) {
      const tileX = tile * TILE_WIDTH;
      for (const hypha of hyphae) {
        const anchorX = tileX + hypha.x;
        if (anchorX < left - 70 || anchorX > right + 70) continue;
        const anchorY = top + 10 + hypha.depth * Math.max(28, bottom - top - 8);
        const sway = Math.sin(elapsed * .18 + hypha.phase) * hypha.sway;
        const tipX = anchorX + hypha.lean + sway;
        const tipY = anchorY - hypha.length;
        ctx.globalAlpha = hypha.alpha;
        ctx.strokeStyle = '#8e3a61';
        ctx.lineWidth = .75;
        ctx.beginPath();
        ctx.moveTo(anchorX, anchorY);
        ctx.bezierCurveTo(
          anchorX - hypha.lean * .18,
          anchorY - hypha.length * .32,
          tipX + hypha.lean * .22,
          anchorY - hypha.length * .7,
          tipX,
          tipY,
        );
        ctx.stroke();

        if (hypha.fork) {
          const forkY = anchorY - hypha.length * .55;
          const forkX = anchorX + hypha.lean * .42 + sway * .4;
          ctx.globalAlpha = hypha.alpha * .72;
          ctx.beginPath();
          ctx.moveTo(forkX, forkY);
          ctx.quadraticCurveTo(
            forkX - 8 - hypha.lean * .12,
            forkY - 7,
            forkX - 13 + sway,
            forkY - 17,
          );
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  function render(ctx, view = {}) {
    if (!active || !ctx) return;
    const cameraX = finite(view.cameraX);
    const zoom = Math.max(.1, finite(view.zoom, 1));
    const viewportWidth = Math.max(1, finite(view.viewportWidth, 1280) / zoom);
    const viewportHeight = Math.max(1, finite(view.viewportHeight, 720) / zoom);
    const cameraY = finite(view.cameraY);
    const top = finite(view.top, 674);
    const visibleBottom = cameraY + viewportHeight + 12;
    const bottom = Math.max(finite(view.bottom, 720), visibleBottom, top + 58);
    const left = cameraX - OVERSCAN;
    const right = cameraX + viewportWidth + OVERSCAN;

    diagnostics.lastBounds.left = left;
    diagnostics.lastBounds.right = right;
    diagnostics.lastBounds.top = top;
    diagnostics.lastBounds.bottom = bottom;

    ctx.save();
    const gradient = ctx.createLinearGradient(0, top - 10, 0, bottom);
    gradient.addColorStop(0, 'rgba(86,20,48,.72)');
    gradient.addColorStop(.26, 'rgba(55,14,38,.9)');
    gradient.addColorStop(1, 'rgba(13,7,18,.98)');
    drawFogLayer(ctx, left, right, top, bottom, 0, gradient, 1);
    drawFogLayer(ctx, left, right, top, bottom, 1, '#8f2854', .26);
    drawFogLayer(ctx, left, right, top, bottom, 2, '#592044', .25);
    drawFogLayer(ctx, left, right, top, bottom, 3, '#34152f', .27);
    drawHyphae(ctx, left, right, top, bottom);
    drawSpores(ctx, left, right, top, bottom);
    ctx.restore();
  }

  return {
    update,
    render,
    setEnabled,
    diagnostics: () => diagnostics,
  };
}
