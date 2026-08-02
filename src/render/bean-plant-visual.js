// O FEIJOEIRO — MORFOLOGIA DO PROTÓTIPO APROVADO
// ==============================================
//
// Feijoeiro, não árvore genérica: caule cônico, cotilédones no primeiro nó,
// folhas TRIFOLIADAS (folíolo terminal maior e dois laterais), flores papilionadas
// rosa-claro e vagens de inserção lateral. As três configurações são as do
// protótipo, sem simplificação.
//
// Tudo em coordenadas LOCAIS, com o COLO NA ORIGEM e o caule subindo para -y. O
// colo é o mesmo ponto que `final-root-visual.js` calcula a partir de
// `state.level.goal` — o pé do caule e a cabeça da raiz não são dois pontos que
// possam divergir, são o mesmo.
//
// A PLANTA É O BOLETIM. O porte sai de `buildPhaseReport().score`, e a diferença
// não é texto: o debilitado é menor, de caule fino, folha amarelada e caída, sem
// flor nem vagem; o sadio floresce e vinga algumas vagens; o super sadio é maior,
// com mais nós, mais flores e mais vagens.

const lerp = (a, b, t) => a + (b - a) * t;

export const BEAN_PLANT_LABEL = Object.freeze([
  'Feijoeiro doente',
  'Feijoeiro sadio',
  'Feijoeiro super sadio',
]);

export const BEAN_PLANT_CONFIG = Object.freeze([
  Object.freeze({
    height: 280, stemBaseW: 28, stemTopW: 10, nodes: 3, size: 0.78,
    droop: 1.1, flowers: false, pods: false,
    colors: Object.freeze({
      base: '#8a943a', light: '#aebd4f', dark: '#4a521a', stem: '#6e7529', cotyledon: '#696336',
    }),
  }),
  Object.freeze({
    height: 520, stemBaseW: 40, stemTopW: 14, nodes: 5, size: 1.0,
    droop: 0.05, flowers: true, pods: true,
    colors: Object.freeze({
      base: '#38a825', light: '#5cd645', dark: '#1b5910', stem: '#328f22', cotyledon: '#7fa638',
    }),
  }),
  Object.freeze({
    height: 680, stemBaseW: 46, stemTopW: 18, nodes: 7, size: 1.25,
    droop: -0.08, flowers: true, pods: true,
    colors: Object.freeze({
      base: '#2a9e1b', light: '#4de838', dark: '#12420a', stem: '#248217', cotyledon: '#68a12d',
    }),
  }),
]);

/**
 * O ESTADO DA PLANTA SAI DO DESEMPENHO, não de um sorteio.
 *
 * `buildPhaseReport().score` já combina saúde radicular (40), ausência de
 * infestação (20), fixação de N (15), proteção por Bacillus (15) e transporte
 * vascular (10) — reusá-lo mantém a planta honesta em vez de criar um segundo
 * critério que pode divergir do que o jogo diz na mesma tela.
 */
export function plantStateFromScore(score) {
  // Só número mesmo. `Number(null)` e `Number('')` valem 0 — um relatório vazio
  // viraria a planta doente, punindo o jogador por uma falha de leitura.
  if (typeof score !== 'number' || !Number.isFinite(score)) return 1;
  if (score < 55) return 0;
  if (score >= 85) return 2;
  return 1;
}

export function beanPlantConfig(plantState) {
  return BEAN_PLANT_CONFIG[plantState] || BEAN_PLANT_CONFIG[1];
}

/** Altura da copa acima do colo, em unidades locais. A câmera enquadra por aqui. */
export function beanPlantHeight(plantState) {
  return beanPlantConfig(plantState).height;
}

function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t, tt = t * t, uu = u * u, uuu = uu * u, ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

function bezierAngle(t, p0, p1, p2, p3) {
  const u = 1 - t;
  const dx = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
  const dy = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
  return Math.atan2(dy, dx);
}

// Folíolo: contorno em duas béziers, gradiente longitudinal, brilho recortado
// dentro da própria forma e nervura central com quatro pares de secundárias.
function drawLeaflet(ctx, length, maxWidth, colors) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(length * 0.25, -maxWidth * 0.8, length * 0.7, -maxWidth * 0.6, length, 0);
  ctx.bezierCurveTo(length * 0.7, maxWidth * 0.6, length * 0.25, maxWidth * 0.8, 0, 0);

  const fill = ctx.createLinearGradient(0, -maxWidth, length, maxWidth);
  fill.addColorStop(0, colors.light);
  fill.addColorStop(0.5, colors.base);
  fill.addColorStop(1, colors.dark);
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.save();
  ctx.clip();
  const shine = ctx.createLinearGradient(0, -maxWidth * 0.8, length * 0.8, maxWidth * 0.2);
  shine.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
  shine.addColorStop(0.5, 'rgba(255, 255, 255, 0.08)');
  shine.addColorStop(1, 'transparent');
  ctx.fillStyle = shine;
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = colors.dark;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(length * 0.95, 0);
  for (let index = 1; index <= 4; index++) {
    const vx = length * (index / 4.8);
    ctx.moveTo(vx, 0);
    ctx.quadraticCurveTo(vx + length * 0.1, -maxWidth * 0.35, vx + length * 0.22, -maxWidth * 0.52);
    ctx.moveTo(vx, 0);
    ctx.quadraticCurveTo(vx + length * 0.1, maxWidth * 0.35, vx + length * 0.22, maxWidth * 0.52);
  }
  ctx.strokeStyle = colors.dark;
  ctx.lineWidth = 1.1;
  ctx.globalAlpha *= 0.65;
  ctx.stroke();
  ctx.restore();
}

// Folha trifoliada: pecíolo curvado pelo `droop` e três folíolos — terminal
// maior à frente, dois laterais abertos. É a folha que identifica o feijoeiro.
function drawTrifoliate(ctx, x, y, angle, scale, colors, droop) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  const petiole = 58;
  ctx.fillStyle = colors.dark;
  ctx.beginPath(); ctx.ellipse(0, 0, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(petiole * 0.5, droop * 12, petiole, droop * 4);
  ctx.strokeStyle = colors.dark; ctx.lineWidth = 4.2; ctx.lineCap = 'round'; ctx.stroke();
  ctx.strokeStyle = colors.stem; ctx.lineWidth = 2.6; ctx.stroke();
  ctx.save();
  ctx.translate(petiole, droop * 4);
  ctx.save(); ctx.translate(14, 0); ctx.rotate(droop * 0.15); drawLeaflet(ctx, 78, 44, colors); ctx.restore();
  ctx.save(); ctx.rotate(-0.68 + droop * 0.25); drawLeaflet(ctx, 62, 35, colors); ctx.restore();
  ctx.save(); ctx.rotate(0.68 + droop * 0.25); drawLeaflet(ctx, 62, 35, colors); ctx.restore();
  ctx.restore();
  ctx.restore();
}

// Cotilédones: as duas reservas do grão, no primeiro nó. Sem eles a planta lê
// como muda genérica; com eles, como feijoeiro recém-emergido.
function drawCotyledonPair(ctx, x, y, angle, scale, colors) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 8, -4);
    ctx.rotate(side * 0.35);
    ctx.beginPath();
    ctx.ellipse(side * 14, 0, 18, 11, side * 0.2, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(side * 14, -3, 2, side * 14, 0, 18);
    grad.addColorStop(0, '#a8d654');
    grad.addColorStop(1, colors.cotyledon || '#709632');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = colors.dark;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// Flor papilionada: estandarte grande e asas menores, em par no racemo.
function drawFlowerCluster(ctx, x, y, angle, scale) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(16, -10);
  ctx.strokeStyle = '#386b24'; ctx.lineWidth = 2.4; ctx.stroke();
  ctx.translate(16, -10);
  for (let flower = 0; flower < 2; flower++) {
    ctx.save();
    ctx.translate(flower * 10, flower * 5);
    ctx.fillStyle = '#4c8235';
    ctx.beginPath(); ctx.arc(-2, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fbeaf2'; ctx.strokeStyle = '#db8fb7'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(5, -6, 10, 12, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f3cfe0';
    ctx.beginPath(); ctx.ellipse(7, 3, 8, 5, -0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// Vagem: pendente, curva, presa lateralmente ao nó por um pedúnculo curto.
function drawPod(ctx, x, y, angle, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2.1);
  ctx.scale(scale, scale);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 12);
  ctx.strokeStyle = '#2c5417'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.translate(0, 12);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(16, 25, 18, 65, 5, 100);
  ctx.bezierCurveTo(0, 106, -3, 106, -4, 100);
  ctx.bezierCurveTo(6, 65, 3, 25, 0, 0);
  const grad = ctx.createLinearGradient(-5, 0, 20, 100);
  grad.addColorStop(0, '#80c955'); grad.addColorStop(0.5, '#56a132'); grad.addColorStop(1, '#376b20');
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = '#234513'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(16, 25, 18, 65, 5, 100);
  ctx.strokeStyle = '#9ee376'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();
}

// Caule cônico: casca escura, corpo e um realce claro deslocado à esquerda.
function drawTaperedStem(ctx, p0, p1, p2, p3, config, growth) {
  const steps = 32;
  const passes = [
    [config.colors.dark, 1, 0],
    [config.colors.stem, 0.76, 0],
    ['rgba(255, 255, 255, 0.38)', 0.22, -2],
  ];
  for (const [color, factor, shift] of passes) {
    for (let index = 0; index < steps; index++) {
      const t1 = (index / steps) * growth;
      const t2 = ((index + 1) / steps) * growth;
      const a = bezierPoint(t1, p0, p1, p2, p3);
      const b = bezierPoint(t2, p0, p1, p2, p3);
      ctx.beginPath();
      ctx.moveTo(a.x + shift, a.y);
      ctx.lineTo(b.x + shift, b.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = lerp(config.stemBaseW * factor, config.stemTopW * factor, (t1 + t2) / 2);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
}

/**
 * Desenha o feijoeiro com o pé exatamente no colo informado.
 *
 * `growth` (0..1) revela o caule a partir do colo — é o crescimento da
 * cinemática, não um fade: os nós entram quando o caule chega neles.
 */
export function drawBeanPlant(ctx, {
  collarX = 0,
  collarY = 0,
  scale = 1,
  plantState = 1,
  growth = 1,
  alpha = 1,
  time = 0,
} = {}) {
  const reveal = Math.max(0, Math.min(1, Number(growth) || 0));
  if (reveal <= 0.001 || alpha <= 0.001) return false;
  const config = beanPlantConfig(plantState);

  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, alpha));
  ctx.translate(collarX, collarY);
  ctx.scale(scale, scale);

  const sway = Math.sin(time * 1.4) * 12;
  const p0 = { x: 0, y: 0 };
  const p1 = { x: -10, y: -config.height * 0.28 };
  const p2 = { x: sway + 18, y: -config.height * 0.68 };
  const p3 = { x: sway * 1.2, y: -config.height };

  drawTaperedStem(ctx, p0, p1, p2, p3, config, reveal);

  if (reveal > 0.06) {
    const cotyledon = bezierPoint(0.05, p0, p1, p2, p3);
    drawCotyledonPair(
      ctx, cotyledon.x, cotyledon.y, bezierAngle(0.05, p0, p1, p2, p3),
      config.size * 1.1, config.colors,
    );
  }

  for (let index = 1; index <= config.nodes; index++) {
    const t = index / (config.nodes + 0.8);
    if (t > reveal) break;
    const pos = bezierPoint(t, p0, p1, p2, p3);
    const angle = bezierAngle(t, p0, p1, p2, p3);
    const side = index % 2 === 0 ? 1 : -1;
    ctx.fillStyle = config.colors.dark;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, 8 * config.size, 0, Math.PI * 2); ctx.fill();
    drawTrifoliate(
      ctx, pos.x, pos.y, angle + side * 0.85,
      config.size * (0.85 + t * 0.35), config.colors, config.droop,
    );
    if (!config.flowers || index < 2) continue;
    if (plantState === 1 && index % 2 === 0) {
      drawFlowerCluster(ctx, pos.x, pos.y, angle - side * 0.5, config.size * 1.25);
      drawPod(ctx, pos.x, pos.y + 10, angle + side * 0.3, config.size * 0.95);
    } else if (plantState === 2) {
      drawFlowerCluster(ctx, pos.x, pos.y, angle - side * 0.6, config.size * 1.35);
      drawPod(ctx, pos.x, pos.y + 8, angle + side * 0.4, config.size * 1.2);
      if (index > 2) drawPod(ctx, pos.x - 12, pos.y + 16, angle - side * 0.3, config.size * 1.05);
    }
  }

  if (reveal >= 0.999) {
    drawTrifoliate(
      ctx, p3.x, p3.y, bezierAngle(1, p0, p1, p2, p3) - Math.PI / 2,
      config.size * 1.3, config.colors, config.droop,
    );
  }

  ctx.restore();
  return true;
}
