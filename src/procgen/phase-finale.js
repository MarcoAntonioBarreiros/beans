// FIM DE FASE — O FEIJOEIRO REVELADO
// ==================================
//
// A fase inteira acontece embaixo da terra. O jogador passa quarenta chunks
// cuidando de raiz, inoculando organismo, fechando porta de patógeno — e nunca
// vê a planta. Ao alcançar a raiz principal com os objetivos cumpridos, a
// câmera se afasta e mostra o que aquilo tudo estava sustentando: o feijoeiro
// acima do solo.
//
// A PLANTA É O BOLETIM. Três estados, escolhidos pelo desempenho real da fase:
//
//   0 · doente     — caule fino, folhas amareladas e caídas, sem flor nem vagem
//   1 · sadia      — porte normal, floração e vagens
//   2 · super sadia — porte maior, mais nós, mais vagens
//
// Não é decoração com nota escrita por cima: é a nota, desenhada. Quem terminou
// com raiz comprometida e infestação alta vê uma planta murcha, e entende sem
// precisar ler número nenhum.
//
// ONDE ISTO ENTRA NO JOGO
//
// `goal-system.js` já detecta a chegada à raiz final e só deixa passar com
// `completionGuard().passed` — os objetivos da fase cumpridos. Ele marca
// `campaign.transitionRequested`, e `maybeAdvanceCampaign` espera o stinger de
// vitória terminar (10,24 s) antes de trocar de fase. Essa espera JÁ EXISTE e
// hoje é tela parada com um toast. É exatamente a janela desta animação.
//
// O módulo não decide quando a fase acaba, não toca no `gameState` e não segura
// a transição. Se ele falhar, a fase avança como sempre — a animação é aditiva.

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoother = t => t * t * t * (t * (t * 6 - 15) + 10);
const smooth = t => t * t * (3 - 2 * t);

const VIEW_W = 1600;
const VIEW_H = 900;
const WORLD_W = 1800;
const WORLD_H = 1320;
const SOIL_Y = 320;
const PLANT_X = 1390;

const CAM_START = Object.freeze({ x: 1260, y: 810, s: 1.12 });
// Ponta da raiz principal, com uma folga. O enquadramento final tem que caber a
// raiz inteira E a copa — e a copa muda de altura com o estado da planta, então
// o zoom final é calculado, não fixo (`endCamera`). Com um valor fixo o
// feijoeiro vigoroso saía cortado no topo e o debilitado ficava perdido no meio
// de um quadro grande demais para ele.
const ROOT_TIP_Y = 1260;
const CROWN_MARGIN = 60;
// Faixa do topo reservada ao cartão de conclusão. Sem ela o enquadramento
// centraliza a planta na tela inteira e a copa nasce ATRÁS do cartão — foi o que
// aconteceu na primeira passada: o feijoeiro terminava decapitado pelo texto.
const CARD_BAND = 0.19;

// Duração de cada etapa, em segundos. A soma (0,3 + 0,7 + 2,6) fica bem dentro
// dos 10,24 s do stinger de vitória, então a animação termina e o jogador olha
// a planta por alguns segundos antes de a fase trocar.
const APPROACH_SECONDS = 1.0;
const CONFIRM_SECONDS = 0.7;
const ZOOM_SECONDS = 2.6;

/**
 * Quanto a cena leva do começo até `done`.
 *
 * Exportado porque `maybeAdvanceCampaign` precisa saber: a espera SEM áudio é de
 * 3,4 s (`PHASE_VICTORY_TRANSITION_SECONDS`), menor que a animação, e cortaria o
 * afastamento no meio. Com áudio o stinger de 10,24 s já cobre tudo.
 */
export const PHASE_FINALE_SECONDS = APPROACH_SECONDS + CONFIRM_SECONDS + ZOOM_SECONDS;

/**
 * O ESTADO DA PLANTA SAI DO DESEMPENHO, não de um sorteio.
 *
 * `buildPhaseReport().score` já combina saúde radicular (40), ausência de
 * infestação (20), fixação de N (15), proteção por Bacillus (15) e transporte
 * vascular (10). É a medida que o jogo já usa para julgar a fase — reusá-la
 * mantém a planta honesta em vez de criar um segundo critério que pode divergir.
 *
 * Os cortes: abaixo de 55 a fase foi cumprida no limite e a planta mostra isso;
 * acima de 85 o solo ficou de fato saudável.
 */
export function plantStateFromScore(score) {
  // Só número mesmo. `Number(null)` e `Number('')` valem 0 — um relatório vazio
  // ou faltando viraria a planta MURCHA, punindo o jogador por uma falha de
  // leitura. Na dúvida a planta é a sadia, nunca a doente.
  if (typeof score !== 'number' || !Number.isFinite(score)) return 1;
  if (score < 55) return 0;
  if (score >= 85) return 2;
  return 1;
}

export const PLANT_STATE_LABEL = Object.freeze([
  'Feijoeiro debilitado',
  'Feijoeiro sadio',
  'Feijoeiro vigoroso',
]);

const PLANT_CONFIG = Object.freeze([
  {
    height: 280, stemBaseW: 28, stemTopW: 10, nodes: 3, size: 0.78,
    droop: 1.1, flowers: false, pods: false,
    colors: { base: '#8a943a', light: '#aebd4f', dark: '#4a521a', stem: '#6e7529', cotyledon: '#696336' },
  },
  {
    height: 520, stemBaseW: 40, stemTopW: 14, nodes: 5, size: 1.0,
    droop: 0.05, flowers: true, pods: true,
    colors: { base: '#38a825', light: '#5cd645', dark: '#1b5910', stem: '#328f22', cotyledon: '#7fa638' },
  },
  {
    height: 680, stemBaseW: 46, stemTopW: 18, nodes: 7, size: 1.25,
    droop: -0.08, flowers: true, pods: true,
    colors: { base: '#2a9e1b', light: '#4de838', dark: '#12420a', stem: '#248217', cotyledon: '#68a12d' },
  },
]);

const MAIN_ROOT = Object.freeze([
  { x: PLANT_X, y: SOIL_Y }, { x: PLANT_X - 5, y: 460 }, { x: PLANT_X + 10, y: 660 },
  { x: PLANT_X - 15, y: 860 }, { x: PLANT_X - 50, y: 1060 }, { x: PLANT_X - 80, y: 1220 },
]);

const BRANCHES = Object.freeze([
  [{ x: PLANT_X - 2, y: 410 }, { x: 1320, y: 470 }, { x: 1240, y: 510 }],
  [{ x: PLANT_X, y: 510 }, { x: 1450, y: 560 }, { x: 1530, y: 610 }],
  [{ x: PLANT_X + 5, y: 620 }, { x: 1330, y: 680 }, { x: 1220, y: 720 }],
  [{ x: PLANT_X - 5, y: 730 }, { x: 1440, y: 790 }, { x: 1540, y: 830 }],
  [{ x: PLANT_X - 20, y: 870 }, { x: 1290, y: 920 }, { x: 1200, y: 960 }],
  [{ x: PLANT_X - 35, y: 970 }, { x: 1410, y: 1020 }, { x: 1500, y: 1060 }],
]);

export function createPhaseFinale({ getViewport = () => ({ width: VIEW_W, height: VIEW_H }) } = {}) {
  let mode = 'idle';
  let elapsed = 0;
  let plantState = 1;
  let report = null;
  let miguelX = 975;
  let reveal = 0;
  let pulse = 0;
  let confirmProgress = 0;
  let cardAlpha = 0;
  let particles = [];
  let clock = 0;
  const camera = { ...CAM_START };
  const cameraEnd = { x: 1370, y: 500, s: 0.545 };
  const clouds = [
    { x: 120, y: -80, scale: 1.1, speed: 8, opacity: 0.82 },
    { x: 580, y: -20, scale: 0.85, speed: 5, opacity: 0.70 },
    { x: 1050, y: -110, scale: 1.35, speed: 11, opacity: 0.88 },
    { x: 1520, y: -40, scale: 0.95, speed: 7, opacity: 0.75 },
  ];

  function reset() {
    mode = 'idle';
    elapsed = 0;
    clock = 0;
    miguelX = 975;
    reveal = 0;
    pulse = 0;
    confirmProgress = 0;
    cardAlpha = 0;
    particles = [];
    report = null;
    Object.assign(camera, CAM_START);
  }

  /**
   * O enquadramento final depende do porte da planta: a copa do feijoeiro
   * vigoroso sobe 680 px acima do solo, a do debilitado só 280. Um zoom fixo ou
   * cortava a copa alta ou deixava a planta baixa minúscula no meio do quadro.
   */
  function computeEndCamera() {
    const config = PLANT_CONFIG[plantState] || PLANT_CONFIG[1];
    const top = SOIL_Y - config.height - CROWN_MARGIN;
    const span = Math.max(1, ROOT_TIP_Y - top);
    cameraEnd.x = PLANT_X - 20;
    cameraEnd.s = clamp((VIEW_H * (0.94 - CARD_BAND)) / span, 0.3, 0.9);
    // A planta e a raiz se centralizam na faixa LIVRE, abaixo do cartão — daí o
    // deslocamento de meia faixa para cima no alvo da câmera.
    const visibleHeight = VIEW_H / cameraEnd.s;
    cameraEnd.y = (top + ROOT_TIP_Y) / 2 - (CARD_BAND / 2) * visibleHeight;
  }

  /**
   * Começa a revelação. Chamado de `goal-system` no mesmo ponto em que a fase é
   * dada por concluída — isto é, com os objetivos já validados pelo guard.
   */
  function begin(phaseReport = null) {
    if (mode !== 'idle') return false;
    report = phaseReport;
    plantState = plantStateFromScore(phaseReport?.score);
    computeEndCamera();
    mode = 'approach';
    elapsed = 0;
    return true;
  }

  function burst(x, y) {
    for (let index = 0; index < 65; index++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 8;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, decay: 0.01 + Math.random() * 0.015,
        size: 3 + Math.random() * 5,
        color: Math.random() > 0.4 ? '255, 242, 185' : '255, 255, 255',
      });
    }
  }

  /**
   * As faíscas andam no `update`, não no `render`.
   *
   * Estavam no desenho, herdadas do protótipo: quem não desenha não envelhece, e
   * uma faísca sobrevivia parada em cima do Miguelito quando o quadro não era
   * pintado. Os valores vêm de um protótipo travado em 60 fps, então o passo é
   * convertido para o tempo real do quadro.
   */
  function stepParticles(step) {
    const frames = step * 60;
    for (let index = particles.length - 1; index >= 0; index--) {
      const p = particles[index];
      p.x += p.vx * frames;
      p.y += p.vy * frames;
      p.vy += 0.14 * frames;
      p.life -= p.decay * frames;
      if (p.life <= 0) particles.splice(index, 1);
    }
  }

  function update(dt = 0) {
    const step = Number(dt) || 0;
    clock += step;
    stepParticles(step);
    for (const cloud of clouds) {
      cloud.x += cloud.speed * step;
      // Volta exatamente um período: as nuvens são repetidas lado a lado em
      // `drawAtmosphere`, e um resto diferente de WORLD_W abriria emenda.
      if (cloud.x >= WORLD_W) cloud.x -= WORLD_W;
    }
    if (mode === 'idle') return;
    elapsed += step;

    if (mode === 'approach') {
      const t = clamp(elapsed / APPROACH_SECONDS);
      miguelX = lerp(975, 1230, smoother(t));
      if (t >= 1) { mode = 'confirm'; elapsed = 0; burst(1250, 640); }
      return;
    }
    if (mode === 'confirm') {
      const t = clamp(elapsed / CONFIRM_SECONDS);
      confirmProgress = t;
      pulse = Math.sin(Math.PI * t) * 0.75;
      miguelX = 1230;
      if (t >= 1) { mode = 'zoom'; elapsed = 0; }
      return;
    }
    if (mode === 'zoom') {
      const t = clamp(elapsed / ZOOM_SECONDS);
      const eased = smooth(t);
      camera.x = lerp(CAM_START.x, cameraEnd.x, eased);
      camera.y = lerp(CAM_START.y, cameraEnd.y, eased);
      camera.s = lerp(CAM_START.s, cameraEnd.s, eased);
      // A planta aparece no meio do afastamento, e o cartão só depois dela: a
      // ordem importa, senão o texto rouba a leitura do desenho.
      reveal = clamp((t - 0.25) / 0.5);
      cardAlpha = clamp((t - 0.62) / 0.25);
      miguelX = 1230;
      if (t >= 1) { mode = 'done'; reveal = 1; cardAlpha = 1; }
      return;
    }
    // done: respiração lenta na raiz, planta inteira, cartão de pé.
    Object.assign(camera, cameraEnd);
    reveal = 1;
    cardAlpha = 1;
    pulse = 0.2 + Math.sin(clock * 3) * 0.15;
    miguelX = 1230;
  }

  // --- DESENHO -------------------------------------------------------------

  function splinePath(ctx, points) {
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length - 1; index++) {
      const cx = (points[index].x + points[index + 1].x) / 2;
      const cy = (points[index].y + points[index + 1].y) / 2;
      ctx.quadraticCurveTo(points[index].x, points[index].y, cx, cy);
    }
    ctx.lineTo(points.at(-1).x, points.at(-1).y);
  }

  function drawRootPath(ctx, points, baseWidth, glow) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glow > 0.02) {
      ctx.beginPath(); splinePath(ctx, points);
      ctx.strokeStyle = `rgba(255, 230, 150, ${glow * 0.45})`;
      ctx.lineWidth = baseWidth * 2.2;
      ctx.shadowColor = 'rgba(255, 235, 170, 0.9)';
      ctx.shadowBlur = 30 + glow * 40;
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
   * Céu e solo preenchem o RETÂNGULO VISÍVEL, não uma caixa fixa de 1800x1320.
   *
   * O primeiro corte pintava o mundo com largura fixa; no afastamento final a
   * câmera passa a enxergar quase 3000 px de mundo e sobrava moldura preta em
   * volta do céu. O quadro visível é derivado da câmera, então o céu acompanha
   * qualquer proporção de tela — inclusive celular em pé.
   */
  function drawAtmosphere(ctx, view) {
    const { x0, y0, x1, y1 } = view;
    const skyTop = Math.min(y0, -220);
    const upper = ctx.createLinearGradient(0, skyTop, 0, SOIL_Y);
    upper.addColorStop(0, '#2572b8');
    upper.addColorStop(0.55, '#4ea1e6');
    upper.addColorStop(1, '#99e0f8');
    ctx.fillStyle = upper;
    ctx.fillRect(x0, skyTop, x1 - x0, SOIL_Y - skyTop);

    // As nuvens circulam num trecho de 1800 px e são repetidas lado a lado para
    // cobrir o que a câmera enxergar, sem emenda visível.
    const first = Math.floor((x0 - 250) / WORLD_W);
    const last = Math.ceil((x1 + 250) / WORLD_W);
    for (let tile = first; tile <= last; tile++) {
      for (const cloud of clouds) {
        ctx.save();
        ctx.translate(cloud.x + tile * WORLD_W, cloud.y);
        ctx.scale(cloud.scale, cloud.scale);
        ctx.fillStyle = `rgba(255, 255, 255, ${cloud.opacity})`;
        ctx.beginPath();
        ctx.arc(0, 160, 48, 0, Math.PI * 2);
        ctx.arc(38, 142, 38, 0, Math.PI * 2);
        ctx.arc(75, 160, 44, 0, Math.PI * 2);
        ctx.arc(115, 165, 32, 0, Math.PI * 2);
        ctx.arc(38, 172, 30, 0, Math.PI * 2);
        ctx.arc(75, 175, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    const glow = ctx.createLinearGradient(0, SOIL_Y - 90, 0, SOIL_Y);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0.35)');
    ctx.fillStyle = glow;
    ctx.fillRect(x0, SOIL_Y - 90, x1 - x0, 90);

    const soilBottom = Math.max(y1, WORLD_H);
    const sub = ctx.createLinearGradient(0, SOIL_Y, 0, soilBottom);
    sub.addColorStop(0, '#0a2630');
    sub.addColorStop(0.3, '#061820');
    sub.addColorStop(1, '#020a0e');
    ctx.fillStyle = sub;
    ctx.fillRect(x0, SOIL_Y, x1 - x0, soilBottom - SOIL_Y);

    const crust = ctx.createLinearGradient(0, SOIL_Y - 12, 0, SOIL_Y + 16);
    crust.addColorStop(0, '#3d1e16');
    crust.addColorStop(0.5, '#23110d');
    crust.addColorStop(1, 'transparent');
    ctx.fillStyle = crust;
    ctx.fillRect(x0, SOIL_Y - 12, x1 - x0, 28);
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
    ctx.strokeStyle = colors.dark;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // Nervuras.
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
    ctx.restore();
  }

  function drawFlowerCluster(ctx, x, y, angle, scale) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle); ctx.scale(scale, scale);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(16, -10);
    ctx.strokeStyle = '#386b24'; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.translate(16, -10);
    for (let f = 0; f < 2; f++) {
      ctx.save();
      ctx.translate(f * 10, f * 5);
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

  function drawShoot(ctx) {
    if (reveal <= 0) return;
    const config = PLANT_CONFIG[plantState] || PLANT_CONFIG[1];
    const baseY = SOIL_Y;
    const topY = baseY - config.height;
    const sway = Math.sin(clock * 1.4) * 12;
    const p0 = { x: PLANT_X, y: baseY };
    const p1 = { x: PLANT_X - 10, y: baseY - config.height * 0.28 };
    const p2 = { x: PLANT_X + sway + 18, y: baseY - config.height * 0.68 };
    const p3 = { x: PLANT_X + sway * 1.2, y: topY };

    ctx.save();
    ctx.globalAlpha = reveal;

    // Caule com afinamento: três passadas, da casca ao brilho.
    for (const [colorKey, factor] of [['dark', 1], ['stem', 0.76]]) {
      for (let i = 0; i < 32; i++) {
        const t1 = i / 32, t2 = (i + 1) / 32;
        const a = bezierPoint(t1, p0, p1, p2, p3);
        const b = bezierPoint(t2, p0, p1, p2, p3);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = config.colors[colorKey];
        ctx.lineWidth = lerp(config.stemBaseW * factor, config.stemTopW * factor, (t1 + t2) / 2);
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }

    for (let index = 1; index <= config.nodes; index++) {
      const t = index / (config.nodes + 0.8);
      const pos = bezierPoint(t, p0, p1, p2, p3);
      const angle = bezierAngle(t, p0, p1, p2, p3);
      const side = index % 2 === 0 ? 1 : -1;
      ctx.fillStyle = config.colors.dark;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 8 * config.size, 0, Math.PI * 2); ctx.fill();
      drawTrifoliate(ctx, pos.x, pos.y, angle + side * 0.85,
        config.size * (0.85 + t * 0.35), config.colors, config.droop);
      if (config.flowers && index >= 2) {
        if (plantState === 1 && index % 2 === 0) {
          drawFlowerCluster(ctx, pos.x, pos.y, angle - side * 0.5, config.size * 1.25);
          drawPod(ctx, pos.x, pos.y + 10, angle + side * 0.3, config.size * 0.95);
        } else if (plantState === 2) {
          drawFlowerCluster(ctx, pos.x, pos.y, angle - side * 0.6, config.size * 1.35);
          drawPod(ctx, pos.x, pos.y + 8, angle + side * 0.4, config.size * 1.2);
          if (index > 2) drawPod(ctx, pos.x - 12, pos.y + 16, angle - side * 0.3, config.size * 1.05);
        }
      }
    }
    drawTrifoliate(ctx, p3.x, p3.y, bezierAngle(1, p0, p1, p2, p3) - Math.PI / 2,
      config.size * 1.3, config.colors, config.droop);
    ctx.restore();
  }

  function drawParticles(ctx) {
    ctx.save();
    for (const p of particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = `rgba(${p.color}, 1)`;
      ctx.shadowColor = `rgba(${p.color}, 0.85)`;
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /**
   * O cartão é desenhado em COORDENADAS DE TELA, fora da transformação do mundo.
   *
   * Na primeira versão ele vivia no céu, em coordenadas de mundo — e encolhia
   * junto com o afastamento: no enquadramento final a legenda ficava com uns
   * nove pixels de altura, ilegível. Texto não acompanha zoom.
   */
  function drawCard(ctx, width, height) {
    if (cardAlpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = cardAlpha;
    const w = Math.min(430, width * 0.7);
    const h = 94;
    const x = (width - w) / 2;
    // Abaixo da barra de ferramentas do jogo, que fica colada no topo.
    const y = Math.max(54, height * 0.075);
    ctx.fillStyle = 'rgba(4, 22, 27, 0.90)';
    ctx.strokeStyle = 'rgba(255, 235, 138, 0.82)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255, 235, 138, 0.4)';
    ctx.shadowBlur = 24;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, 18);
    else ctx.rect(x, y, w, h);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff5be';
    ctx.font = '800 21px system-ui, sans-serif';
    ctx.fillText('FASE CONCLUÍDA', x + w / 2, y + 30);
    ctx.fillStyle = '#b9d8d1';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(PLANT_STATE_LABEL[plantState], x + w / 2, y + 52);
    const numeros = [
      Number.isFinite(report?.score) ? `${report.score} pontos` : '',
      Number.isFinite(report?.rootHealth) ? `saúde ${report.rootHealth}%` : '',
      Number.isFinite(report?.infestation) ? `infestação ${report.infestation}%` : '',
    ].filter(Boolean);
    if (numeros.length) {
      ctx.fillStyle = '#8fb8b0';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(numeros.join(' · '), x + w / 2, y + 74);
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }

  function drawMiguelito(ctx) {
    const bob = mode === 'approach' ? Math.sin(clock * 16) * 2.5 : Math.sin(clock * 5) * 1.2;
    ctx.save();
    ctx.translate(miguelX, 660 + bob);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.beginPath(); ctx.ellipse(0, 28, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3b2b21'; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-6, 8); ctx.lineTo(-9, 27);
    ctx.moveTo(5, 8); ctx.lineTo(10, 27);
    ctx.stroke();
    ctx.fillStyle = '#10151d';
    ctx.fillRect(-14, 25, 13, 5); ctx.fillRect(4, 25, 13, 5);
    ctx.fillStyle = '#865432';
    ctx.fillRect(-11, -3, 9, 14); ctx.fillRect(1, -3, 9, 14);
    ctx.fillStyle = '#2d86d2';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(-14, -21, 28, 23, 8);
    else ctx.rect(-14, -21, 28, 23);
    ctx.fill();
    ctx.fillStyle = '#cf434a';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(8, -19, 11, 18, 5);
    else ctx.rect(8, -19, 11, 18);
    ctx.fill();
    ctx.strokeStyle = '#c7926d'; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-13, -12); ctx.lineTo(-20, -2);
    ctx.moveTo(13, -12); ctx.lineTo(20, -4);
    ctx.stroke();
    ctx.fillStyle = '#d4a17b';
    ctx.fillRect(-3, -27, 6, 8);
    ctx.beginPath(); ctx.arc(0, -37, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10151d';
    ctx.beginPath();
    ctx.arc(0, -40, 15, Math.PI, Math.PI * 2);
    ctx.lineTo(14, -34);
    ctx.quadraticCurveTo(4, -50, -10, -49);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(5, -38, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /**
   * Desenha por cima de tudo, com transformação PRÓPRIA.
   *
   * A cena do final não compartilha a câmera do jogo de propósito: ela tem seu
   * próprio mundo (1800x1320, solo em y=320) e seu próprio enquadramento. Tentar
   * reaproveitar a câmera da fase misturaria dois sistemas de coordenadas que
   * não têm nada a ver um com o outro.
   */
  function render(ctx) {
    if (mode === 'idle') return false;
    const { width, height } = getViewport();
    ctx.save();
    ctx.fillStyle = '#020a0e';
    ctx.fillRect(0, 0, width, height);
    // O enquadramento é dado pela ALTURA. A cena é alta e estreita — copa no céu,
    // raiz no fundo do solo — e o `min(largura/1600, altura/900)` do primeiro
    // corte encolhia tudo em tela estreita: no celular em pé o feijoeiro virava
    // um risco no meio do quadro. Como o céu e o solo preenchem o retângulo
    // visível, tela larga apenas mostra mais céu.
    const fit = height / VIEW_H;
    const zoom = Math.max(1e-4, fit * camera.s);
    // O retângulo de mundo que esta câmera enxerga. Quem pinta fundo precisa
    // dele: com moldura fixa sobra preto nas bordas no afastamento final.
    const view = {
      x0: camera.x - width / (2 * zoom),
      x1: camera.x + width / (2 * zoom),
      y0: camera.y - height / (2 * zoom),
      y1: camera.y + height / (2 * zoom),
    };
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camera.x, -camera.y);

    drawAtmosphere(ctx, view);
    BRANCHES.forEach((branch, index) => drawRootPath(ctx, branch, 18 - index * 1.5, pulse * 0.4));
    drawRootPath(ctx, MAIN_ROOT, 42, pulse * 0.6);
    if (mode === 'confirm') {
      const radius = confirmProgress * 480;
      const alpha = Math.sin(confirmProgress * Math.PI) * 0.35;
      const wave = ctx.createRadialGradient(1250, 640, Math.max(0, radius - 100), 1250, 640, radius + 100);
      wave.addColorStop(0, 'rgba(255, 240, 180, 0)');
      wave.addColorStop(0.5, `rgba(255, 235, 170, ${alpha})`);
      wave.addColorStop(1, 'rgba(255, 240, 180, 0)');
      ctx.fillStyle = wave;
      ctx.beginPath(); ctx.arc(1250, 640, radius + 100, 0, Math.PI * 2); ctx.fill();
    }
    drawParticles(ctx);
    drawShoot(ctx);
    drawMiguelito(ctx);
    ctx.restore();

    const vignette = ctx.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.25,
      width / 2, height / 2, Math.max(width, height) * 0.75,
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 4, 7, 0.48)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    // Por último e fora da transformação do mundo: texto em pixels de tela, sem
    // a vinheta por cima escurecendo a leitura.
    drawCard(ctx, width, height);
    ctx.restore();
    return true;
  }

  return {
    begin,
    update,
    render,
    reset,
    clear: reset,
    get active() { return mode !== 'idle'; },
    get mode() { return mode; },
    get plantState() { return plantState; },
    get reveal() { return reveal; },
    get cardAlpha() { return cardAlpha; },
  };
}
