let bacillusImage = null;
let imageLoaded = false;
let spriteEnabled = true;

if (typeof window !== 'undefined') {
  bacillusImage = new Image();
  bacillusImage.src = 'assets/bacillus/bacillus.png';
  bacillusImage.onload = () => { imageLoaded = true; };
  bacillusImage.onerror = () => {
    const altImage = new Image();
    altImage.src = 'dist/assets/bacillus/bacillus.png';
    altImage.onload = () => { bacillusImage = altImage; imageLoaded = true; };
  };
}

// Coordenadas exatas de alta resolução (3660x104, 44 frames) extraídas da spritesheet
const FRAMES = [
  { x:   12, w:  63 },  // 0
  { x:   96, w:  63 },  // 1
  { x:  179, w:  63 },  // 2
  { x:  262, w:  62 },  // 3
  { x:  345, w:  63 },  // 4
  { x:  428, w:  63 },  // 5
  { x:  511, w:  63 },  // 6
  { x:  594, w:  63 },  // 7
  { x:  677, w:  62 },  // 8
  { x:  760, w:  62 },  // 9
  { x:  842, w:  63 },  // 10
  { x:  924, w:  65 },  // 11
  { x: 1006, w:  67 },  // 12
  { x: 1088, w:  69 },  // 13
  { x: 1170, w:  72 },  // 14
  { x: 1252, w:  74 },  // 15
  { x: 1335, w:  75 },  // 16
  { x: 1417, w:  76 },  // 17
  { x: 1499, w:  78 },  // 18
  { x: 1582, w:  78 },  // 19
  { x: 1665, w:  78 },  // 20
  { x: 1749, w:  77 },  // 21
  { x: 1832, w:  77 },  // 22
  { x: 1915, w:  77 },  // 23
  { x: 1998, w:  78 },  // 24
  { x: 2081, w:  78 },  // 25
  { x: 2165, w:  77 },  // 26
  { x: 2249, w:  76 },  // 27
  { x: 2333, w:  75 },  // 28
  { x: 2417, w:  74 },  // 29
  { x: 2501, w:  72 },  // 30
  { x: 2586, w:  68 },  // 31
  { x: 2670, w:  66 },  // 32
  { x: 2754, w:  65 },  // 33
  { x: 2838, w:  64 },  // 34
  { x: 2922, w:  63 },  // 35
  { x: 3006, w:  62 },  // 36
  { x: 3090, w:  62 },  // 37
  { x: 3173, w:  63 },  // 38
  { x: 3256, w:  63 },  // 39
  { x: 3339, w:  63 },  // 40
  { x: 3423, w:  62 },  // 41
  { x: 3506, w:  63 },  // 42
  { x: 3589, w:  63 },  // 43
];
const TOTAL_FRAMES = FRAMES.length;
const FRAME_DURATION = 0.08;

function getFrameInfo(time, frameOffset) {
  if (!bacillusImage || !imageLoaded) return null;
  const frameIndex = Math.floor((time / FRAME_DURATION + frameOffset) % TOTAL_FRAMES);
  const f = FRAMES[frameIndex];
  const srcH = bacillusImage.naturalHeight;
  return { srcX: f.x, srcW: f.w, srcH, srcY: 0 };
}

export function drawInoculatedBacillusSprite(ctx, x, y, width = 52, height = null, time = 0, frameOffset = 0, alpha = 1) {
  if (!spriteEnabled || !bacillusImage || !imageLoaded) {
    return false;
  }

  const frame = getFrameInfo(time, frameOffset);
  if (!frame) return false;

  const renderW = width;
  const renderH = height || (width * (frame.srcH / frame.srcW));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    bacillusImage,
    frame.srcX, frame.srcY, frame.srcW, frame.srcH,
    x - renderW / 2, y - renderH / 2, renderW, renderH,
  );
  ctx.restore();
  return true;
}

/**
 * Desenha um Bacillus roaming usando a spritesheet em alta resolução.
 * Substitui drawBacterium + drawFlagellum para agent.type === 'bacillus'.
 */
export function drawRoamingBacillusSprite(ctx, x, y, size = 38, time = 0, phase = 0, alpha = 1) {
  if (!spriteEnabled || !bacillusImage || !imageLoaded) {
    return false;
  }

  const frame = getFrameInfo(time, phase * 3.7);
  if (!frame) return false;

  const renderW = size;
  const renderH = size * (frame.srcH / frame.srcW);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    bacillusImage,
    frame.srcX, frame.srcY, frame.srcW, frame.srcH,
    x - renderW / 2, y - renderH / 2, renderW, renderH,
  );
  ctx.restore();
  return true;
}

export function isBacillusSpriteEnabled() {
  return spriteEnabled;
}

export function setBacillusSpriteEnabled(enabled) {
  spriteEnabled = Boolean(enabled);
}

if (typeof window !== 'undefined') {
  window.miguelitoBacillusSprite = {
    enable: () => { spriteEnabled = true; return 'Sprite de Bacillus ativado'; },
    disable: () => { spriteEnabled = false; return 'Sprite de Bacillus desativado (vetorial original)'; },
    toggle: () => { spriteEnabled = !spriteEnabled; return `Sprite de Bacillus: ${spriteEnabled ? 'ativado' : 'desativado'}`; },
    get isEnabled() { return spriteEnabled; },
  };
}
