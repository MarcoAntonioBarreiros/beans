const DEFAULT_SOURCE = 'assets/backgrounds/miguelito-rhizosphere.png';
const HORIZONTAL_FACTOR = 0.018;

function hashSeed(value) {
  const text = String(value ?? 'rhizosphere');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isMirroredTile(index) {
  return Math.abs(index % 2) === 1;
}

export function calculateBackdropTiles({
  sourceWidth,
  sourceHeight,
  viewportWidth,
  viewportHeight,
  cameraX = 0,
  cameraY = 0,
  seedPosition = 0,
  factor = HORIZONTAL_FACTOR,
}) {
  const sw = Math.max(1, Number(sourceWidth) || 1);
  const sh = Math.max(1, Number(sourceHeight) || 1);
  const vw = Math.max(1, Number(viewportWidth) || 1);
  const vh = Math.max(1, Number(viewportHeight) || 1);
  const scale = Math.max(vw / sw, vh / sh);
  const drawWidth = sw * scale;
  const drawHeight = sh * scale;
  const normalizedStart = ((Number(seedPosition) || 0) % 1 + 1) % 1;
  const effectiveX = normalizedStart * drawWidth + (Number(cameraX) || 0) * factor;
  const firstColumn = Math.floor(effectiveX / drawWidth);
  const lastColumn = Math.ceil((effectiveX + vw) / drawWidth);
  const verticalOrigin = (vh - drawHeight) / 2;
  const viewTop = Number(cameraY) || 0;
  const firstRow = Math.floor((viewTop - verticalOrigin) / drawHeight);
  const lastRow = Math.floor((viewTop + vh - verticalOrigin - .001) / drawHeight);
  const tiles = [];

  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      const mirroredX = isMirroredTile(column);
      const mirroredY = isMirroredTile(row);
      tiles.push({
        index: column,
        column,
        row,
        x: column * drawWidth - effectiveX,
        y: verticalOrigin + row * drawHeight,
        width: drawWidth,
        height: drawHeight,
        mirrored: mirroredX,
        mirroredX,
        mirroredY,
      });
    }
  }

  return tiles;
}

export function createRhizosphereBackdrop({
  src = DEFAULT_SOURCE,
  seed = 'rhizosphere',
  createImage = null,
} = {}) {
  const seedPosition = hashSeed(seed) / 4294967296;
  const image = createImage?.() || null;
  if (image) {
    image.decoding = 'async';
    image.src = src;
  }

  function render(ctx, camera = {}, viewport = {}) {
    if (!ctx || !image?.complete || !(image.naturalWidth > 0) || !(image.naturalHeight > 0)) {
      return false;
    }

    // O QUE SE ENXERGA DO MUNDO, nao o tamanho do canvas.
    //
    // Com zoom < 1 a area visivel e MAIOR que a superficie de desenho, e usar a
    // largura do canvas direto deixava o fundo terminando no meio da tela — um
    // retangulo de borda dura que so apareceu quando o afastamento do fim de
    // fase passou de 1x. `rhizosphere-parallax` ja fazia esta conta.
    const zoom = Math.max(.01, Number(camera.zoom) || 1);
    const width = Math.max(1, (Number(viewport.width) || 1280) / zoom);
    const height = Math.max(1, (Number(viewport.height) || 720) / zoom);
    const tiles = calculateBackdropTiles({
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
      viewportWidth: width,
      viewportHeight: height,
      cameraX: camera.cameraX,
      cameraY: camera.cameraY,
      seedPosition,
    });
    const cameraY = Number(camera.cameraY) || 0;

    ctx.save();
    ctx.globalAlpha = 0.82;
    for (const tile of tiles) {
      ctx.save();
      ctx.translate(
        tile.x + (tile.mirroredX ? tile.width : 0),
        tile.y + (tile.mirroredY ? tile.height : 0),
      );
      ctx.scale(tile.mirroredX ? -1 : 1, tile.mirroredY ? -1 : 1);
      ctx.drawImage(image, 0, 0, tile.width, tile.height);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    const veil = ctx.createLinearGradient(0, cameraY, 0, cameraY + height);
    veil.addColorStop(0, 'rgba(1,13,20,.20)');
    veil.addColorStop(0.58, 'rgba(3,18,25,.34)');
    veil.addColorStop(1, 'rgba(10,8,18,.56)');
    ctx.fillStyle = veil;
    // Ancorado na camera, nao em x=0: o veu acompanha o trecho visivel.
    const cameraX = Number(camera.cameraX) || 0;
    ctx.fillRect(cameraX, cameraY, width, height);
    ctx.restore();
    return true;
  }

  return {
    render,
    image,
    source: src,
    seedPosition,
  };
}
