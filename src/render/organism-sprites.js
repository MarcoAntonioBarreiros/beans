const DEFAULT_FRAME_WIDTH = 320;
const DEFAULT_FRAME_HEIGHT = 400;

export const ORGANISM_SPRITE_SHEETS = Object.freeze({
  rhizobium: Object.freeze({
    src: 'assets/organisms/rhizobium.png',
    frameCount: 12,
    fps: 6,
    height: 62,
  }),
  azospirillum: Object.freeze({
    src: 'assets/organisms/azospirillum.png',
    frameCount: 12,
    fps: 7,
    height: 68,
  }),
  ralstonia: Object.freeze({
    src: 'assets/organisms/ralstonia.png',
    frameCount: 12,
    fps: 7,
    height: 60,
  }),
  rhizoctonia: Object.freeze({
    src: 'assets/organisms/rhizoctonia.png',
    frameCount: 12,
    fps: 7,
    height: 82,
  }),
  micorriza: Object.freeze({
    src: 'assets/organisms/micorriza.png',
    frameCount: 24,
    fps: 10,
    height: 62,
  }),
  oportunista: Object.freeze({
    src: 'assets/organisms/oportunista.png',
    frameCount: 12,
    fps: 7,
    height: 78,
  }),
  pseudomonas: Object.freeze({
    src: 'assets/organisms/pseudomonas.png',
    frameCount: 24,
    fps: 10,
    height: 66,
  }),
  nematoide: Object.freeze({
    src: 'assets/organisms/nematoide.png',
    frameCount: 12,
    fps: 7,
    height: 68,
  }),
  trichoderma: Object.freeze({
    src: 'assets/organisms/trichoderma.png',
    frameCount: 12,
    fps: 7,
    height: 72,
  }),
});

const enabled = new Map(Object.keys(ORGANISM_SPRITE_SHEETS).map(type => [type, true]));

export function calculateOrganismSpriteFrame(type, time = 0, phase = 0) {
  const sheet = ORGANISM_SPRITE_SHEETS[type];
  if (!sheet) return null;
  const raw = Math.floor(Math.max(0, time) * sheet.fps + Math.abs(phase) * 3.7);
  const frameIndex = raw % sheet.frameCount;
  return {
    frameIndex,
    sourceX: frameIndex * DEFAULT_FRAME_WIDTH,
    sourceY: 0,
    sourceWidth: DEFAULT_FRAME_WIDTH,
    sourceHeight: DEFAULT_FRAME_HEIGHT,
  };
}

export function createOrganismSpriteRenderer({
  imageFactory = () => (typeof Image === 'undefined' ? null : new Image()),
} = {}) {
  const images = new Map();

  function ensureImage(type) {
    const sheet = ORGANISM_SPRITE_SHEETS[type];
    if (!sheet) return null;
    if (images.has(type)) return images.get(type);

    const image = imageFactory(type, sheet);
    const record = { image, loaded: false, failed: !image };
    images.set(type, record);
    if (!image) return record;

    image.onload = () => {
      record.loaded = true;
      record.failed = false;
    };
    image.onerror = () => {
      record.failed = true;
      record.loaded = false;
    };
    image.src = sheet.src;
    return record;
  }

  function draw(ctx, type, {
    x = 0,
    y = 0,
    height = null,
    time = 0,
    phase = 0,
    alpha = 1,
    rotation = 0,
    flipX = false,
    anchorX = .5,
    anchorY = .5,
  } = {}) {
    const sheet = ORGANISM_SPRITE_SHEETS[type];
    if (!sheet || !enabled.get(type)) return false;
    const record = ensureImage(type);
    if (!record?.loaded || record.failed) return false;

    const frame = calculateOrganismSpriteFrame(type, time, phase);
    const renderHeight = Math.max(1, height ?? sheet.height);
    const renderWidth = renderHeight * (DEFAULT_FRAME_WIDTH / DEFAULT_FRAME_HEIGHT);

    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, alpha));
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(flipX ? -1 : 1, 1);
    ctx.drawImage(
      record.image,
      frame.sourceX,
      frame.sourceY,
      frame.sourceWidth,
      frame.sourceHeight,
      -renderWidth * anchorX,
      -renderHeight * anchorY,
      renderWidth,
      renderHeight,
    );
    ctx.restore();
    return true;
  }

  return {
    draw,
    preload(types = Object.keys(ORGANISM_SPRITE_SHEETS)) {
      types.forEach(ensureImage);
    },
    status(type) {
      const record = images.get(type);
      return {
        enabled: Boolean(enabled.get(type)),
        requested: Boolean(record),
        loaded: Boolean(record?.loaded),
        failed: Boolean(record?.failed),
      };
    },
  };
}

export function isOrganismSpriteEnabled(type) {
  return Boolean(enabled.get(type));
}

export function setOrganismSpriteEnabled(type, value) {
  if (!ORGANISM_SPRITE_SHEETS[type]) return false;
  enabled.set(type, Boolean(value));
  return true;
}

export const organismSprites = createOrganismSpriteRenderer();

if (typeof window !== 'undefined') {
  organismSprites.preload();
  window.miguelitoOrganismSprites = {
    enable(type) {
      if (type === 'all') Object.keys(ORGANISM_SPRITE_SHEETS).forEach(key => enabled.set(key, true));
      else setOrganismSpriteEnabled(type, true);
      return this.status();
    },
    disable(type) {
      if (type === 'all') Object.keys(ORGANISM_SPRITE_SHEETS).forEach(key => enabled.set(key, false));
      else setOrganismSpriteEnabled(type, false);
      return this.status();
    },
    toggle(type) {
      if (!ORGANISM_SPRITE_SHEETS[type]) return this.status();
      enabled.set(type, !enabled.get(type));
      return this.status();
    },
    status() {
      return Object.fromEntries(
        Object.keys(ORGANISM_SPRITE_SHEETS).map(type => [type, organismSprites.status(type)]),
      );
    },
  };
}
