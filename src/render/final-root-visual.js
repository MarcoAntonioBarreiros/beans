// A RAIZ FINAL — UM DESENHO SÓ
// ============================
//
// Existia uma raiz principal desenhada em `goal-system.js` e outra, parecida e
// independente, dentro da cinemática de fim de fase. Duas geometrias no mesmo
// lugar: o afastamento da câmera trocava de raiz no meio do caminho, e o colo do
// feijoeiro não caía sobre a raiz que o jogador tinha acabado de alcançar.
//
// Este módulo é a única fonte. `goal-system` desenha por aqui enquanto Miguelito
// se aproxima; a cinemática NÃO desenha raiz nenhuma — ela só empurra o pulso e
// lê os limites geométricos para enquadrar a câmera. Não há crossfade, não há
// troca: é literalmente o mesmo caminho de desenho antes, durante e depois.
//
// GEOMETRIA. Vem do protótipo aprovado, convertida para coordenadas LOCAIS com o
// colo na origem — no protótipo o colo era `(1390, 320)` no mundo dele, e usar
// aqueles números absolutos amarraria a raiz a um mundo que este jogo não tem.
// O colo real sai de `state.level.goal`.
//
// CAMADAS TRANSLÚCIDAS. Halo, córtex externo âmbar, córtex interno creme, tubo
// vascular opaco e filamento luminoso central — a leitura de profundidade do
// protótipo, preservada. A escala aproxima a raiz do tamanho que ela já tinha na
// fase, para a troca de desenho não alterar o enquadramento do gameplay.

const TAU = Math.PI * 2;

// Colo em relação a `goal.y`. O valor vem do desenho anterior, cujo topo ficava
// em `goal.y - 205`: mantê-lo faz a raiz nova nascer onde a antiga terminava.
export const FINAL_ROOT_COLLAR_OFFSET = -205;

// Protótipo -> jogo. Com 0,42 a raiz desce 378 px abaixo do colo, contra os 335
// do desenho anterior, e se espalha 80 px para os lados.
export const FINAL_ROOT_SCALE = 0.42;

export const FINAL_ROOT_MAIN_LOCAL = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: -5, y: 140 }),
  Object.freeze({ x: 10, y: 340 }),
  Object.freeze({ x: -15, y: 540 }),
  Object.freeze({ x: -50, y: 740 }),
  Object.freeze({ x: -80, y: 900 }),
]);

export const FINAL_ROOT_BRANCHES_LOCAL = Object.freeze([
  Object.freeze([{ x: -2, y: 90 }, { x: -70, y: 150 }, { x: -150, y: 190 }]),
  Object.freeze([{ x: 0, y: 190 }, { x: 60, y: 240 }, { x: 140, y: 290 }]),
  Object.freeze([{ x: 5, y: 300 }, { x: -60, y: 360 }, { x: -170, y: 400 }]),
  Object.freeze([{ x: -5, y: 410 }, { x: 50, y: 470 }, { x: 150, y: 510 }]),
  Object.freeze([{ x: -20, y: 550 }, { x: -100, y: 600 }, { x: -190, y: 640 }]),
  Object.freeze([{ x: -35, y: 650 }, { x: 20, y: 700 }, { x: 110, y: 740 }]),
]);

// Larguras em unidades locais. O protótipo usava 42 para o eixo; 56 devolve, na
// escala acima, os ~23 px do traço que a raiz tinha antes.
const MAIN_WIDTH_LOCAL = 56;
const branchWidthLocal = index => 24 - index * 2;

/**
 * O colo: onde a raiz encontra a superfície e de onde o caule sai.
 *
 * É o mesmo ponto para os dois desenhos — não há um "colo da raiz" e um "pé do
 * caule" que possam divergir por arredondamento.
 */
export function finalRootCollar(goal) {
  return {
    x: Number(goal?.x) || 0,
    y: (Number(goal?.y) || 0) + FINAL_ROOT_COLLAR_OFFSET,
  };
}

/**
 * Limites da raiz em coordenadas de mundo. A cinemática enquadra a câmera com
 * isto — nunca com números copiados à mão.
 */
export function finalRootBounds(goal, scale = FINAL_ROOT_SCALE) {
  const collar = finalRootCollar(goal);
  let minX = collar.x;
  let maxX = collar.x;
  let maxY = collar.y;
  const consider = point => {
    const x = collar.x + point.x * scale;
    const y = collar.y + point.y * scale;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const point of FINAL_ROOT_MAIN_LOCAL) consider(point);
  for (const branch of FINAL_ROOT_BRANCHES_LOCAL) for (const point of branch) consider(point);
  return { collarX: collar.x, collarY: collar.y, minX, maxX, tipY: maxY };
}

function splinePath(ctx, points) {
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index++) {
    const cx = (points[index].x + points[index + 1].x) / 2;
    const cy = (points[index].y + points[index + 1].y) / 2;
    ctx.quadraticCurveTo(points[index].x, points[index].y, cx, cy);
  }
  ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
}

/**
 * As cinco passadas translúcidas do protótipo, da casca ao filamento.
 *
 * `pulse` acende a aura dourada; é o mesmo parâmetro usado pela conclusão da
 * fase, então o pulso corre pela raiz que já estava desenhada em vez de por uma
 * cópia acesa por cima.
 */
function drawRootPath(ctx, points, baseWidth, pulse) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pulse > 0.02) {
    ctx.beginPath(); splinePath(ctx, points);
    ctx.strokeStyle = `rgba(255, 230, 150, ${pulse * 0.45})`;
    ctx.lineWidth = baseWidth * 2.2;
    ctx.shadowColor = 'rgba(255, 235, 170, 0.9)';
    ctx.shadowBlur = 30 + pulse * 40;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  const layers = [
    ['rgba(160, 110, 65, 0.28)', 1],
    ['rgba(225, 185, 130, 0.42)', 0.74],
    ['rgba(248, 228, 185, 0.62)', 0.5],
    ['rgba(255, 253, 245, 0.96)', 0.24],
    ['#ffffff', Math.max(1.2 / baseWidth, 0.09)],
  ];
  for (const [color, factor] of layers) {
    ctx.beginPath(); splinePath(ctx, points);
    ctx.strokeStyle = color;
    ctx.lineWidth = baseWidth * factor;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Desenha a raiz final em coordenadas de MUNDO, com o colo em `goal`.
 *
 * Único ponto de desenho da raiz principal no jogo inteiro. `pulse` vai de 0 (em
 * jogo) a 1 (pulso de conclusão) e não altera geometria nenhuma — só acende.
 */
export function drawFinalRoot(ctx, goal, { pulse = 0, scale = FINAL_ROOT_SCALE, time = 0 } = {}) {
  if (!goal) return false;
  const collar = finalRootCollar(goal);
  const glow = Math.max(0, Math.min(1, Number(pulse) || 0));

  ctx.save();
  ctx.translate(collar.x, collar.y);
  ctx.scale(scale, scale);

  FINAL_ROOT_BRANCHES_LOCAL.forEach((branch, index) => {
    drawRootPath(ctx, branch, branchWidthLocal(index), glow * 0.4);
  });
  drawRootPath(ctx, FINAL_ROOT_MAIN_LOCAL, MAIN_WIDTH_LOCAL, glow * 0.6);

  // O halo do córtex luminoso, que é o alvo do jogador durante a fase.
  const breath = 1 + Math.sin(time * 2.1) * 0.05;
  const halo = ctx.createRadialGradient(0, 120, 10, 0, 120, (200 + glow * 90) * breath);
  halo.addColorStop(0, `rgba(255, 240, 180, ${0.22 + glow * 0.22})`);
  halo.addColorStop(0.5, `rgba(255, 220, 140, ${0.09 + glow * 0.13})`);
  halo.addColorStop(1, 'rgba(255, 220, 120, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 120, (200 + glow * 90) * breath, 0, TAU);
  ctx.fill();

  ctx.restore();
  return true;
}
