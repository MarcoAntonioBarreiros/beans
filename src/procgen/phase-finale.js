// FIM DE FASE — CONTINUAÇÃO DA FASE, NÃO UMA SEGUNDA CENA
// =======================================================
//
// A primeira versão disto era um protótipo HTML encaixado depois da fase: tinha
// mundo próprio (1800x1320), câmera própria, raiz própria e um Miguelito vetorial
// improvisado, e pintava a tela inteira por cima do jogo. O jogador terminava a
// fase e caía dentro de outra coisa.
//
// Este módulo não desenha jogo nenhum. Ele é um CONTROLADOR:
//
//   · assume a câmera REAL (`cameraView.beginCinematic()`) e a interpola a
//     partir do enquadramento que estava no ar no instante da vitória;
//   · lê o colo e os limites da raiz final COMPARTILHADA (`final-root-visual`),
//     a mesma que `goal-system` desenha desde o começo da fase;
//   · empurra o pulso por `level.finalRootPulse`, sem redesenhar a raiz;
//   · acrescenta ao MUNDO só o que ainda não existia: a faixa de superfície, o
//     céu acima dela, as nuvens e o feijoeiro nascendo do mesmo colo;
//   · desenha o cartão de resultado em coordenadas de tela.
//
// Miguelito continua sendo desenhado pelo renderizador normal, no lugar real
// onde terminou a fase, com a animação `celebrate` que o renderer já escolhe em
// `gameState === 'transition'`. Não existe segundo personagem, e o jogador nunca
// é teleportado.
//
// A PLANTA É O BOLETIM: o porte sai de `buildPhaseReport().score`.

import {
  beanPlantHeight,
  drawBeanPlant,
  plantStateFromScore,
  BEAN_PLANT_LABEL,
} from '../render/bean-plant-visual.js';
import {
  finalRootBounds,
  FINAL_ROOT_SCALE,
} from '../render/final-root-visual.js';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

// Escala do feijoeiro. A mesma da raiz: caule e raiz saem do mesmo colo e têm
// que ter a mesma unidade, senão a planta fica desproporcional à raiz que a
// sustenta.
export const BEAN_PLANT_SCALE = FINAL_ROOT_SCALE;

// Duração das etapas depois da comemoração. A comemoração NÃO tem duração fixa
// aqui: ela vem do ciclo da folha de sprite (`celebrationCycleSeconds`).
const ROOT_PULSE_SECONDS = 0.9;
const REVEAL_SECONDS = 2.8;
const HOLD_SECONDS = 1.2;

// Faixa do topo reservada ao cartão. Sem ela o enquadramento centraliza a planta
// na tela inteira e a copa nasce atrás do texto.
const CARD_BAND = 0.19;
const CROWN_MARGIN = 90;
const TIP_MARGIN = 70;
const CINEMATIC_MIN_ZOOM = 0.22;
const CINEMATIC_MAX_ZOOM = 1.6;

/**
 * Quanto a cinemática leva do começo até `done`, dado o ciclo da comemoração.
 *
 * `maybeAdvanceCampaign` precisa disto: a espera SEM áudio é de 3,4 s
 * (`PHASE_VICTORY_TRANSITION_SECONDS`), menor que a cena, e cortaria o
 * afastamento no meio. Com áudio o stinger de 10,24 s já cobre tudo.
 */
export function phaseFinaleSeconds(celebrationSeconds = 0) {
  const celebrate = Math.max(0, Number(celebrationSeconds) || 0);
  return celebrate + ROOT_PULSE_SECONDS + REVEAL_SECONDS + HOLD_SECONDS;
}

export function createPhaseFinale({ state, cameraView, getViewport } = {}) {
  const viewport = typeof getViewport === 'function'
    ? getViewport
    : () => ({
      width: state?.viewportWidth || 1280,
      height: state?.viewportHeight || 720,
    });

  let mode = 'idle';
  let elapsed = 0;
  let clock = 0;
  let report = null;
  let plantState = 1;
  let celebrateSeconds = 0;
  let celebratedFrom = 0;
  let goal = null;
  let collar = null;
  let startCamera = null;
  let endCamera = null;
  let pulse = 0;
  let growth = 0;
  let skyAlpha = 0;
  let cardAlpha = 0;

  const clouds = [
    { x: 120, y: -520, scale: 1.1, speed: 8, opacity: 0.82 },
    { x: 580, y: -430, scale: 0.85, speed: 5, opacity: 0.70 },
    { x: 1050, y: -560, scale: 1.35, speed: 11, opacity: 0.88 },
    { x: 1520, y: -450, scale: 0.95, speed: 7, opacity: 0.75 },
  ];
  const CLOUD_SPAN = 1800;

  function publish() {
    if (!state?.level) return;
    // A raiz é desenhada por `goal-system`; daqui sai só o quanto ela acende.
    state.level.finalRootPulse = mode === 'idle' ? undefined : pulse;
    state.level.finalRootLabelHidden = mode !== 'idle' && mode !== 'celebrate';
  }

  function reset() {
    const wasActive = mode !== 'idle';
    mode = 'idle';
    elapsed = 0;
    clock = 0;
    report = null;
    plantState = 1;
    celebrateSeconds = 0;
    celebratedFrom = 0;
    goal = null;
    collar = null;
    startCamera = null;
    endCamera = null;
    pulse = 0;
    growth = 0;
    skyAlpha = 0;
    cardAlpha = 0;
    if (state?.level) {
      state.level.finalRootPulse = undefined;
      state.level.finalRootLabelHidden = false;
    }
    if (wasActive) cameraView?.endCinematic?.();
  }

  /**
   * Enquadramento final, calculado a partir dos limites REAIS.
   *
   * Copa (que muda de altura com o resultado), ponta da raiz compartilhada e a
   * faixa do cartão. Nada de valores fixos: o mesmo cálculo serve paisagem,
   * retrato e qualquer zoom que o jogador estivesse usando.
   */
  function computeEndCamera() {
    const bounds = finalRootBounds(goal, FINAL_ROOT_SCALE);
    const crown = bounds.collarY - beanPlantHeight(plantState) * BEAN_PLANT_SCALE - CROWN_MARGIN;
    const tip = bounds.tipY + TIP_MARGIN;
    const { width, height } = viewport();
    const span = Math.max(1, tip - crown);
    const zoom = clamp((height * (0.94 - CARD_BAND)) / span, CINEMATIC_MIN_ZOOM, CINEMATIC_MAX_ZOOM);
    const visibleWidth = width / zoom;
    const visibleHeight = height / zoom;
    return {
      x: bounds.collarX - visibleWidth / 2,
      // A copa encosta logo abaixo da faixa do cartão; a ponta da raiz cai
      // dentro dos 94% restantes.
      y: crown - CARD_BAND * visibleHeight,
      zoom,
      crown,
      tip,
    };
  }

  /**
   * Começa a cinemática. Chamada no mesmo ponto em que a fase é dada por
   * concluída — `goal-system` já validou os objetivos pelo guard.
   */
  function begin({ report: phaseReport = null, celebrationSeconds = 0 } = {}) {
    if (mode !== 'idle') return false;
    goal = state?.level?.goal || null;
    if (!goal) return false;
    startCamera = cameraView?.beginCinematic?.();
    if (!startCamera) return false;

    report = phaseReport;
    plantState = plantStateFromScore(phaseReport?.score);
    celebrateSeconds = Math.max(0, Number(celebrationSeconds) || 0);
    const bounds = finalRootBounds(goal, FINAL_ROOT_SCALE);
    collar = { x: bounds.collarX, y: bounds.collarY };
    endCamera = computeEndCamera();
    celebratedFrom = Number(state?.time) || 0;
    mode = 'celebrate';
    elapsed = 0;
    pulse = 0;
    growth = 0;
    skyAlpha = 0;
    cardAlpha = 0;
    // Primeiro quadro da cinemática = último quadro jogável, exatamente.
    cameraView.setCinematic(startCamera);
    publish();
    return true;
  }

  function applyCamera(t) {
    if (!startCamera || !endCamera) return;
    const eased = smooth(clamp(t));
    cameraView.setCinematic({
      x: lerp(startCamera.x, endCamera.x, eased),
      y: lerp(startCamera.y, endCamera.y, eased),
      zoom: lerp(startCamera.zoom, endCamera.zoom, eased),
    });
  }

  function update(dt = 0) {
    const step = Number(dt) || 0;
    clock += step;
    for (const cloud of clouds) {
      cloud.x += cloud.speed * step;
      if (cloud.x >= CLOUD_SPAN) cloud.x -= CLOUD_SPAN;
    }
    if (mode === 'idle') return;
    elapsed += step;

    if (mode === 'celebrate') {
      // A câmera fica parada no enquadramento do gameplay: o afastamento não
      // pode começar antes de a comemoração ter rodado inteira.
      cameraView.setCinematic(startCamera);
      if (elapsed >= celebrateSeconds) { mode = 'rootPulse'; elapsed = 0; }
      publish();
      return;
    }
    if (mode === 'rootPulse') {
      const t = clamp(elapsed / ROOT_PULSE_SECONDS);
      pulse = Math.sin(Math.PI * t) * 0.85;
      cameraView.setCinematic(startCamera);
      if (t >= 1) { mode = 'reveal'; elapsed = 0; }
      publish();
      return;
    }
    if (mode === 'reveal') {
      const t = clamp(elapsed / REVEAL_SECONDS);
      applyCamera(t);
      pulse = 0.25 + Math.sin(clock * 3) * 0.12;
      skyAlpha = clamp(t / 0.45);
      // O caule sai do colo depois de o céu já estar aparecendo.
      growth = clamp((t - 0.3) / 0.6);
      cardAlpha = clamp((t - 0.82) / 0.18);
      if (t >= 1) { mode = 'hold'; elapsed = 0; growth = 1; }
      publish();
      return;
    }
    if (mode === 'hold') {
      applyCamera(1);
      pulse = 0.25 + Math.sin(clock * 3) * 0.12;
      skyAlpha = 1;
      growth = 1;
      cardAlpha = 1;
      if (elapsed >= HOLD_SECONDS) mode = 'done';
      publish();
      return;
    }
    // done: quadro final parado. Quem troca de fase é `maybeAdvanceCampaign`.
    applyCamera(1);
    pulse = 0.25 + Math.sin(clock * 3) * 0.12;
    skyAlpha = 1;
    growth = 1;
    cardAlpha = 1;
    publish();
  }

  // --- DESENHO ---------------------------------------------------------------

  function drawSky(ctx, view) {
    if (skyAlpha <= 0.002) return;
    const surface = collar.y;
    if (view.y1 <= surface - 4000) return;
    const top = Math.min(view.y0, surface - 1400);
    ctx.save();
    ctx.globalAlpha *= skyAlpha;

    // SÓ ACIMA DA SUPERFÍCIE. O subsolo continua sendo o cenário real da fase,
    // desenhado pelo renderizador normal — nada aqui repinta plataforma,
    // organismo, partícula, raiz ou jogador.
    ctx.beginPath();
    ctx.rect(view.x0, top, view.x1 - view.x0, surface - top);
    ctx.clip();

    const sky = ctx.createLinearGradient(0, surface - 900, 0, surface);
    sky.addColorStop(0, '#2572b8');
    sky.addColorStop(0.55, '#4ea1e6');
    sky.addColorStop(1, '#99e0f8');
    ctx.fillStyle = sky;
    ctx.fillRect(view.x0, top, view.x1 - view.x0, surface - top);

    const first = Math.floor((view.x0 - 260) / CLOUD_SPAN);
    const last = Math.ceil((view.x1 + 260) / CLOUD_SPAN);
    for (let tile = first; tile <= last; tile++) {
      for (const cloud of clouds) {
        ctx.save();
        ctx.translate(collar.x - CLOUD_SPAN / 2 + cloud.x + tile * CLOUD_SPAN, surface + cloud.y);
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

    const horizon = ctx.createLinearGradient(0, surface - 90, 0, surface);
    horizon.addColorStop(0, 'rgba(255, 255, 255, 0)');
    horizon.addColorStop(1, 'rgba(255, 255, 255, 0.35)');
    ctx.fillStyle = horizon;
    ctx.fillRect(view.x0, surface - 90, view.x1 - view.x0, 90);
    ctx.restore();

    // Crosta: a linha do horizonte, encostada na superfície. Fica fora do clip
    // para fechar a emenda entre céu e subsolo real.
    ctx.save();
    ctx.globalAlpha *= skyAlpha;
    const crust = ctx.createLinearGradient(0, surface - 10, 0, surface + 14);
    crust.addColorStop(0, '#3d1e16');
    crust.addColorStop(0.5, '#23110d');
    crust.addColorStop(1, 'rgba(35, 17, 13, 0)');
    ctx.fillStyle = crust;
    ctx.fillRect(view.x0, surface - 10, view.x1 - view.x0, 24);
    ctx.restore();
  }

  /**
   * Camada de MUNDO da cinemática: superfície, céu e feijoeiro.
   *
   * Entra depois do renderizador normal, dentro da mesma transformação de
   * câmera. Não limpa o canvas e não cobre o subsolo.
   */
  function renderWorldLayer(ctx) {
    if (mode === 'idle' || !collar) return false;
    if (skyAlpha <= 0.002 && growth <= 0.002) return false;
    const zoom = Number(state.cameraZoom) || 1;
    const { width, height } = viewport();
    const view = {
      x0: (state.cameraX || 0),
      x1: (state.cameraX || 0) + width / zoom,
      y0: (state.cameraY || 0),
      y1: (state.cameraY || 0) + height / zoom,
    };

    ctx.save();
    ctx.translate(-(state.cameraX || 0), 0);
    drawSky(ctx, view);
    drawBeanPlant(ctx, {
      collarX: collar.x,
      collarY: collar.y,
      scale: BEAN_PLANT_SCALE,
      plantState,
      growth,
      time: clock,
    });
    ctx.restore();
    return true;
  }

  /**
   * Cartão de resultado, em coordenadas de TELA — texto não acompanha zoom.
   * Só aparece depois de a planta estar visível, e fica na faixa que o
   * enquadramento reservou para ele, longe da copa.
   */
  function renderOverlay(ctx) {
    if (cardAlpha <= 0.002) return false;
    const { width, height } = viewport();
    const w = Math.min(430, width * 0.7);
    const h = 94;
    const x = (width - w) / 2;
    const y = Math.max(54, height * 0.075);

    ctx.save();
    ctx.globalAlpha = cardAlpha;
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
    ctx.fillText(BEAN_PLANT_LABEL[plantState], x + w / 2, y + 52);
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
    return true;
  }

  return {
    begin,
    update,
    renderWorldLayer,
    renderOverlay,
    reset,
    clear: reset,
    get active() { return mode !== 'idle'; },
    get mode() { return mode; },
    get plantState() { return plantState; },
    get growth() { return growth; },
    get cardAlpha() { return cardAlpha; },
    get pulse() { return pulse; },
    get celebrationSeconds() { return celebrateSeconds; },
    get celebrationStartedAt() { return celebratedFrom; },
    get startCamera() { return startCamera ? { ...startCamera } : null; },
    get endCamera() { return endCamera ? { ...endCamera } : null; },
  };
}
