const TAU = Math.PI * 2;
const TILE_WIDTH = 1440;
const MIN_CACHE_HEIGHT = 720;
const DEEP_STRUCTURE_COUNT = 14;
const BIOLOGY_STRUCTURE_COUNT = 24;
const PARTICLE_COUNT = 32;
const DEEP_FILAMENT_COUNT = 7;

export const BIOLOGICAL_PARALLAX_KEY = 'KeyP';
export const RHIZOSPHERE_PARALLAX_FACTORS = Object.freeze({
  deep: 0.055,
  biology: 0.16,
  particles: 0.22,
});

const VERTICAL_LIMITS = Object.freeze({
  deep: 6,
  biology: 12,
  particles: 16,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashSeed(value) {
  const text = String(value ?? 'rhizosphere');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed) {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function resetCanvasState(ctx) {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.setLineDash?.([]);
}

function drawAggregate(ctx, random, height) {
  const x = random() * TILE_WIDTH;
  const y = height * (0.2 + random() * 0.68);
  const rx = 85 + random() * 170;
  const ry = 42 + random() * 95;
  ctx.fillStyle = random() > 0.5
    ? 'rgba(31,77,84,.045)'
    : 'rgba(36,66,78,.055)';
  ctx.strokeStyle = 'rgba(91,183,173,.025)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - rx, y);
  for (let i = 1; i <= 10; i++) {
    const angle = Math.PI + (i / 10) * TAU;
    const jitter = 0.82 + random() * 0.26;
    ctx.lineTo(x + Math.cos(angle) * rx * jitter, y + Math.sin(angle) * ry * jitter);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function consumeAggregateRandom(random) {
  for (let aggregate = 0; aggregate < 7; aggregate++) {
    for (let call = 0; call < 15; call++) random();
  }
}

function buildDeepFilaments(seed, height) {
  const random = createRandom(seed ^ 0x4a21b3c7);
  // Mantém a mesma sequência que antes desenhava os agregados e, em seguida,
  // as grandes estruturas filamentosas no bitmap profundo.
  consumeAggregateRandom(random);
  return Array.from({ length: DEEP_FILAMENT_COUNT }, (_, index) => {
    const x = random() * TILE_WIDTH;
    const width = 8 + random() * 18;
    const direction = random() > 0.5 ? 1 : -1;
    const top = -50 + random() * 190;
    const length = height * (0.58 + random() * 0.52);
    const colorVariant = random() > 0.5;
    return {
      index,
      x,
      top,
      width,
      length,
      controlOneX: direction * (35 + random() * 85),
      controlTwoX: -direction * (20 + random() * 70),
      endX: direction * (45 + random() * 110),
      phase: random() * TAU,
      angularSpeed: TAU / (4.5 + random() * 3.5),
      amplitude: 3.5 + random() * 4,
      waveLag: 0.8 + random() * 0.7,
      stroke: colorVariant
        ? 'rgba(62,126,126,.20)'
        : 'rgba(66,105,117,.17)',
      highlight: 'rgba(107,209,194,.07)',
    };
  });
}

export function calculateFilamentGeometry(filament, elapsed, motionScale = 1) {
  const time = Math.max(0, Number(elapsed) || 0);
  const scale = clamp(Number(motionScale) || 0, 0, 1);
  const wave = time * filament.angularSpeed + filament.phase;
  const sway = progress => (
    Math.sin(wave - filament.waveLag * progress)
    * filament.amplitude
    * Math.pow(1 - progress, 1.35)
    * scale
  );
  const bob = Math.sin(wave * 0.73 + filament.phase) * filament.amplitude * 0.16 * scale;
  return {
    start: {
      x: filament.x + sway(0),
      y: filament.top + bob,
    },
    controlOne: {
      x: filament.x + filament.controlOneX + sway(0.32),
      y: filament.top + filament.length * 0.28 + bob * 0.65,
    },
    controlTwo: {
      x: filament.x + filament.controlTwoX + sway(0.68),
      y: filament.top + filament.length * 0.65 + bob * 0.25,
    },
    end: {
      x: filament.x + filament.endX,
      y: filament.top + filament.length,
    },
  };
}

function traceFilament(ctx, geometry) {
  ctx.beginPath();
  ctx.moveTo(geometry.start.x, geometry.start.y);
  ctx.bezierCurveTo(
    geometry.controlOne.x,
    geometry.controlOne.y,
    geometry.controlTwo.x,
    geometry.controlTwo.y,
    geometry.end.x,
    geometry.end.y,
  );
}

function drawFilament(ctx, filament, elapsed, motionScale) {
  const geometry = calculateFilamentGeometry(filament, elapsed, motionScale);
  ctx.strokeStyle = filament.stroke;
  ctx.lineWidth = filament.width;
  ctx.lineCap = 'round';
  traceFilament(ctx, geometry);
  ctx.stroke();
  ctx.strokeStyle = filament.highlight;
  ctx.lineWidth = Math.max(1, filament.width * 0.16);
  traceFilament(ctx, geometry);
  ctx.stroke();
}

function buildDeepCache(ctx, seed, height) {
  const random = createRandom(seed ^ 0x4a21b3c7);
  ctx.save();
  resetCanvasState(ctx);
  ctx.clearRect(0, 0, TILE_WIDTH, height);

  const beam = ctx.createLinearGradient(0, height * 0.1, TILE_WIDTH, height * 0.8);
  beam.addColorStop(0, 'rgba(44,117,124,0)');
  beam.addColorStop(0.47, 'rgba(64,139,142,.045)');
  beam.addColorStop(0.57, 'rgba(94,177,168,.075)');
  beam.addColorStop(1, 'rgba(44,117,124,0)');
  ctx.fillStyle = beam;
  ctx.fillRect(0, 0, TILE_WIDTH, height);

  for (let i = 0; i < 7; i++) drawAggregate(ctx, random, height);
  ctx.restore();
}

function drawProtozoan(ctx, random, x, y) {
  const rx = 16 + random() * 14;
  const ry = 10 + random() * 9;
  const tilt = (random() - 0.5) * 0.8;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.fillStyle = 'rgba(74,164,164,.08)';
  ctx.strokeStyle = 'rgba(119,220,207,.20)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(140,220,207,.13)';
  for (let i = 0; i < 4; i++) {
    const angle = i * 1.7 + random();
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * rx * 0.46, Math.sin(angle) * ry * 0.48, 1.6 + random() * 2.2, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(125,207,199,.12)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * TAU;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * rx, Math.sin(angle) * ry);
    ctx.lineTo(Math.cos(angle) * (rx + 4), Math.sin(angle) * (ry + 3));
    ctx.stroke();
  }
  ctx.restore();
}

function drawAlgaeChain(ctx, random, x, y) {
  const angle = (random() - 0.5) * 1.1;
  const cells = 4 + Math.floor(random() * 3);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = 'rgba(104,207,184,.18)';
  ctx.fillStyle = 'rgba(64,152,143,.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < cells; i++) {
    ctx.beginPath();
    ctx.ellipse(i * 9, Math.sin(i * 1.4) * 2, 5.5, 3.8, i * 0.14, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(130,220,192,.11)';
    ctx.beginPath();
    ctx.arc(i * 9 + 1, Math.sin(i * 1.4) * 2, 1.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(64,152,143,.08)';
  }
  ctx.restore();
}

function drawCrystalCluster(ctx, random, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(134,162,204,.18)';
  ctx.fillStyle = 'rgba(77,116,159,.055)';
  ctx.lineWidth = 1;
  const shards = 5 + Math.floor(random() * 3);
  const rotation = random() * TAU;
  for (let i = 0; i < shards; i++) {
    const angle = rotation + i / shards * TAU;
    const length = 13 + random() * 12;
    const width = 5 + random() * 4;
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -width * 0.35);
    ctx.lineTo(length * 0.68, -width * 0.5);
    ctx.lineTo(length, 0);
    ctx.lineTo(length * 0.68, width * 0.5);
    ctx.lineTo(0, width * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(118,167,191,.09)';
  ctx.beginPath();
  ctx.arc(0, 0, 3.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBubbleCluster(ctx, random, x, y) {
  ctx.save();
  ctx.strokeStyle = 'rgba(123,203,207,.14)';
  ctx.fillStyle = 'rgba(78,151,163,.035)';
  ctx.lineWidth = 1;
  const count = 3 + Math.floor(random() * 4);
  for (let i = 0; i < count; i++) {
    const radius = 3 + random() * 8;
    const bx = x + (random() - 0.5) * 36;
    const by = y + (random() - 0.5) * 28;
    ctx.beginPath();
    ctx.arc(bx, by, radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(185,232,229,.11)';
    ctx.beginPath();
    ctx.arc(bx - radius * 0.3, by - radius * 0.34, Math.max(0.8, radius * 0.16), 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(78,151,163,.035)';
  }
  ctx.restore();
}

function drawDistantHyphae(ctx, random, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(133,196,205,.13)';
  ctx.lineWidth = 0.9;
  const direction = random() > 0.5 ? 1 : -1;
  for (let i = 0; i < 5; i++) {
    const startY = (i - 2) * 5;
    ctx.beginPath();
    ctx.moveTo(0, startY);
    ctx.bezierCurveTo(
      direction * (12 + random() * 8),
      startY - 8,
      direction * (24 + random() * 12),
      startY + 8,
      direction * (35 + random() * 16),
      startY - 2,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function buildBiologyCache(ctx, seed, height) {
  const random = createRandom(seed ^ 0x7f4a7c15);
  ctx.save();
  resetCanvasState(ctx);
  ctx.clearRect(0, 0, TILE_WIDTH, height);
  for (let i = 0; i < BIOLOGY_STRUCTURE_COUNT; i++) {
    const x = 32 + random() * (TILE_WIDTH - 64);
    const y = 90 + random() * Math.max(220, height - 190);
    const kind = i % 5;
    if (kind === 0) drawProtozoan(ctx, random, x, y);
    else if (kind === 1) drawAlgaeChain(ctx, random, x, y);
    else if (kind === 2) drawCrystalCluster(ctx, random, x, y);
    else if (kind === 3) drawBubbleCluster(ctx, random, x, y);
    else drawDistantHyphae(ctx, random, x, y);
  }
  ctx.restore();
}

function createCache(factory, width, height) {
  const canvas = factory?.();
  if (!canvas) return null;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext?.('2d');
  return ctx ? { canvas, ctx } : null;
}

function drawTiled(ctx, cache, cameraX, factor, cameraY, verticalOffset, viewportWidth, motion) {
  if (!cache) return;
  const effectiveX = cameraX * factor;
  const firstTile = Math.floor(effectiveX / TILE_WIDTH) - 1;
  const lastTile = Math.ceil((effectiveX + viewportWidth) / TILE_WIDTH) + 1;
  ctx.save();
  resetCanvasState(ctx);
  ctx.translate(motion.x, cameraY + verticalOffset + motion.y);
  for (let tile = firstTile; tile <= lastTile; tile++) {
    const x = tile * TILE_WIDTH - effectiveX;
    if (motion.rotation || motion.scale !== 1) {
      ctx.save();
      ctx.translate(x + TILE_WIDTH / 2, cache.canvas.height / 2);
      ctx.rotate(motion.rotation);
      ctx.scale(motion.scale, motion.scale);
      ctx.drawImage(cache.canvas, -TILE_WIDTH / 2, -cache.canvas.height / 2);
      ctx.restore();
    } else {
      ctx.drawImage(cache.canvas, x, 0);
    }
  }
  ctx.restore();
}

function drawTiledFilaments(
  ctx,
  filaments,
  cameraX,
  cameraY,
  verticalOffset,
  viewportWidth,
  elapsed,
  motion,
  motionScale,
) {
  if (!filaments.length) return;
  const effectiveX = cameraX * RHIZOSPHERE_PARALLAX_FACTORS.deep;
  const firstTile = Math.floor(effectiveX / TILE_WIDTH) - 1;
  const lastTile = Math.ceil((effectiveX + viewportWidth) / TILE_WIDTH) + 1;
  ctx.save();
  resetCanvasState(ctx);
  ctx.translate(motion.x, cameraY + verticalOffset + motion.y);
  for (let tile = firstTile; tile <= lastTile; tile++) {
    const tileX = tile * TILE_WIDTH - effectiveX;
    ctx.save();
    ctx.translate(tileX, 0);
    for (const filament of filaments) {
      drawFilament(ctx, filament, elapsed, motionScale);
    }
    ctx.restore();
  }
  ctx.restore();
}

export function createRhizosphereParallax({
  seed = 'rhizosphere',
  createCanvas = null,
  reducedMotion = null,
} = {}) {
  const seedHash = hashSeed(seed);
  const random = createRandom(seedHash ^ 0x51ed270b);
  const particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
    x: random() * TILE_WIDTH,
    y: 70 + random() * 570,
    radius: 0.7 + random() * 1.5,
    phase: random() * TAU,
    speed: 0.18 + random() * 0.35,
    drift: 5 + random() * 7,
    alpha: 0.08 + random() * 0.1,
    index,
  }));

  let enabled = true;
  let width = 0;
  let height = 0;
  let cacheHeight = 0;
  let deepCache = null;
  let biologyCache = null;
  let deepFilaments = [];
  let elapsed = 0;
  let baselineCameraY = 0;
  let initialized = false;
  const vertical = { deep: 0, biology: 0, particles: 0 };
  const deepMotion = { x: 0, y: 0, rotation: 0, scale: 1 };
  const biologyMotion = { x: 0, y: 0, rotation: 0, scale: 1 };
  const prefersReducedMotion = reducedMotion == null
    ? Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
    : Boolean(reducedMotion);
  const filamentMotionScale = prefersReducedMotion ? 0.18 : 1;
  const stats = {
    updateCount: 0,
    renderCount: 0,
    cacheBuildCount: 0,
    particleCount: PARTICLE_COUNT,
    deepStructureCount: DEEP_STRUCTURE_COUNT,
    deepFilamentCount: DEEP_FILAMENT_COUNT,
    biologyStructureCount: BIOLOGY_STRUCTURE_COUNT,
  };

  function rebuildCaches() {
    cacheHeight = Math.max(MIN_CACHE_HEIGHT, Math.ceil(height));
    deepCache = createCache(createCanvas, TILE_WIDTH, cacheHeight);
    biologyCache = createCache(createCanvas, TILE_WIDTH, cacheHeight);
    if (deepCache) buildDeepCache(deepCache.ctx, seedHash, cacheHeight);
    if (biologyCache) buildBiologyCache(biologyCache.ctx, seedHash, cacheHeight);
    deepFilaments = buildDeepFilaments(seedHash, cacheHeight);
    stats.cacheBuildCount++;
  }

  function resize(nextWidth, nextHeight) {
    const safeWidth = Math.max(1, Math.ceil(Number(nextWidth) || 1));
    const safeHeight = Math.max(1, Math.ceil(Number(nextHeight) || 1));
    if (safeWidth === width && safeHeight === height) return false;
    width = safeWidth;
    height = safeHeight;
    if (!deepCache || !biologyCache || safeHeight > cacheHeight || safeHeight < cacheHeight - 240) {
      rebuildCaches();
    }
    return true;
  }

  function update(dt, camera = {}, player = null) {
    if (!enabled) return;
    const safeDt = clamp(Number(dt) || 0, 0, 0.1);
    const cameraY = Number(camera.cameraY) || 0;
    if (!initialized) {
      baselineCameraY = cameraY;
      initialized = true;
    }

    if (player?.onGround) {
      const groundBlend = 1 - Math.pow(0.004, safeDt);
      baselineCameraY += (cameraY - baselineCameraY) * groundBlend;
    }

    const displacement = cameraY - baselineCameraY;
    const smooth = 1 - Math.pow(0.01, safeDt);
    const deepTarget = clamp(-displacement * RHIZOSPHERE_PARALLAX_FACTORS.deep, -VERTICAL_LIMITS.deep, VERTICAL_LIMITS.deep);
    const biologyTarget = clamp(-displacement * RHIZOSPHERE_PARALLAX_FACTORS.biology, -VERTICAL_LIMITS.biology, VERTICAL_LIMITS.biology);
    const particleTarget = clamp(-displacement * RHIZOSPHERE_PARALLAX_FACTORS.particles, -VERTICAL_LIMITS.particles, VERTICAL_LIMITS.particles);
    vertical.deep += (deepTarget - vertical.deep) * smooth;
    vertical.biology += (biologyTarget - vertical.biology) * smooth;
    vertical.particles += (particleTarget - vertical.particles) * smooth;
    elapsed += safeDt;
    // O conteúdo continua pré-renderizado. Só o bitmap em cache recebe uma
    // oscilação muito lenta e limitada, evitando redesenhar cada organismo.
    deepMotion.x = Math.sin(elapsed * 0.16) * 2.2;
    deepMotion.y = Math.sin(elapsed * 0.12 + 0.8) * 1.5;
    biologyMotion.x = Math.sin(elapsed * 0.42) * 9;
    biologyMotion.y = Math.sin(elapsed * 0.34 + 1.1) * 5.5;
    biologyMotion.rotation = Math.sin(elapsed * 0.28) * 0.008;
    biologyMotion.scale = 1 + Math.sin(elapsed * 0.31 + 0.7) * 0.005;
    stats.updateCount++;
  }

  function drawParticles(ctx, camera, viewport) {
    const cameraX = Number(camera.cameraX) || 0;
    const cameraY = Number(camera.cameraY) || 0;
    const viewWidth = Number(viewport.width) || width;
    const viewHeight = Number(viewport.height) || height;
    const effectiveX = cameraX * RHIZOSPHERE_PARALLAX_FACTORS.particles;
    const firstTile = Math.floor(effectiveX / TILE_WIDTH) - 1;
    const lastTile = Math.ceil((effectiveX + viewWidth) / TILE_WIDTH) + 1;

    ctx.save();
    resetCanvasState(ctx);
    ctx.translate(0, cameraY + vertical.particles);
    ctx.fillStyle = '#8fc8c7';
    for (let tile = firstTile; tile <= lastTile; tile++) {
      const tileX = tile * TILE_WIDTH - effectiveX;
      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        const x = tileX + particle.x + Math.sin(elapsed * particle.speed + particle.phase) * particle.drift;
        if (x < -8 || x > viewWidth + 8) continue;
        const y = ((particle.y + elapsed * particle.speed * 4) % (viewHeight + 80)) - 40;
        ctx.globalAlpha = particle.alpha * (0.78 + Math.sin(elapsed * 0.6 + particle.phase) * 0.22);
        ctx.beginPath();
        ctx.arc(x, y, particle.radius, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function render(ctx, camera = {}, viewport = {}) {
    if (!enabled || !ctx) return;
    const zoom = Math.max(0.01, Number(camera.zoom) || 1);
    const viewportWidth = Math.max(1, (Number(viewport.width) || width || 1280) / zoom);
    const viewportHeight = Math.max(1, (Number(viewport.height) || height || 720) / zoom);
    resize(Number(viewport.width) || width || 1280, Number(viewport.height) || height || 720);

    const cameraX = Number(camera.cameraX) || 0;
    const cameraY = Number(camera.cameraY) || 0;
    ctx.save();
    resetCanvasState(ctx);
    drawTiled(
      ctx,
      deepCache,
      cameraX,
      RHIZOSPHERE_PARALLAX_FACTORS.deep,
      cameraY,
      vertical.deep,
      viewportWidth,
      deepMotion,
    );
    drawTiledFilaments(
      ctx,
      deepFilaments,
      cameraX,
      cameraY,
      vertical.deep,
      viewportWidth,
      elapsed,
      deepMotion,
      filamentMotionScale,
    );
    drawTiled(
      ctx,
      biologyCache,
      cameraX,
      RHIZOSPHERE_PARALLAX_FACTORS.biology,
      cameraY,
      vertical.biology,
      viewportWidth,
      biologyMotion,
    );
    drawParticles(ctx, camera, { width: viewportWidth, height: viewportHeight });
    ctx.restore();
    stats.renderCount++;
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    return enabled;
  }

  function toggle() {
    return setEnabled(!enabled);
  }

  function diagnostics() {
    return {
      enabled,
      width,
      height,
      cacheHeight,
      elapsed,
      vertical: { ...vertical },
      motion: {
        deep: { ...deepMotion },
        biology: { ...biologyMotion },
      },
      factors: RHIZOSPHERE_PARALLAX_FACTORS,
      limits: VERTICAL_LIMITS,
      particlePool: particles,
      deepFilamentPool: deepFilaments,
      filamentMotion: {
        reduced: prefersReducedMotion,
        scale: filamentMotionScale,
      },
      stats: { ...stats },
    };
  }

  return {
    update,
    render,
    resize,
    setEnabled,
    toggle,
    diagnostics,
    get enabled() { return enabled; },
  };
}
