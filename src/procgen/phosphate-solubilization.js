import { W } from '../core/constants.js';
import { PHOSPHATE_SOLUBILIZATION_DEFAULTS } from './campaign-manifest.js';
import { recordPhaseObjectiveAction } from './campaign-objective-progress.js';
import { fxLanded } from '../game-audio.js';
import { getPrimaryTraversalPlatforms } from './traversal-route.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function routePlatforms(level) {
  return getPrimaryTraversalPlatforms(level)
    .filter(platform => !platform.recovery && !platform.final && !platform.mycorrhizaStructure)
    .sort((a, b) => (a.logicIndex ?? 0) - (b.logicIndex ?? 0) || a.x - b.x);
}

/**
 * A raiz pode receber uma colônia de micorriza que transporte fósforo?
 *
 * Os descartes não são estéticos. A raiz final encerra a fase; a de recuperação
 * é rede de segurança e some; degrau de escada, ponte e demais estruturas são
 * geometria temporária que o runtime cria e destrói — colonizar qualquer uma
 * delas daria um vínculo que desaparece no meio do transporte.
 */
export function isColonizableTransportRoot(platform) {
  return Boolean(
    platform
    && platform.type === 'root'
    && !platform.final
    && !platform.recovery
    && !platform.mycorrhizaStructure
    && !platform.azospirillumStructure
    && !platform.nitrogenRootStructure
    && !platform.ladderStep
    && !platform.bridgeSpan
    && !platform.removedByChallenge
    && Number.isFinite(platform.x)
    && platform.w > 0,
  );
}

/**
 * A raiz que vai TRANSPORTAR o fósforo deste depósito, se existir.
 *
 * O depósito mineral não precisa estar sobre uma raiz — ele é rocha, e fica no
 * solo. Mas sem raiz colonizável dentro do alcance real da micorriza ele é
 * decoração: dá para solubilizar e o fósforo fica na poça, sem nunca chegar a
 * lugar nenhum. O alcance é lido da configuração (`mycorrhizalReach`), não
 * repetido aqui.
 *
 * Preferência por raiz anterior ou lateralmente próxima na rota: o jogador
 * chega ao depósito vindo de trás, e uma raiz que ele já passou é uma que ele
 * pode voltar e inocular.
 */
export function findTransportRootFor(level, deposit, settings = null) {
  const config = { ...PHOSPHATE_SOLUBILIZATION_DEFAULTS, ...(settings || {}) };
  const reach = Number(config.mycorrhizalReach) || 320;
  const centerX = deposit.x + deposit.w / 2;
  const centerY = deposit.y + deposit.h / 2;
  let best = null;
  for (const platform of level?.platforms || []) {
    if (!isColonizableTransportRoot(platform)) continue;
    // A colônia fica no topo da raiz, que é de onde a distância é medida em
    // `transportingColony`.
    const colonyX = platform.x + platform.w / 2;
    const distance = Math.hypot(colonyX - centerX, platform.y - centerY);
    if (distance > reach) continue;
    const behind = (platform.logicIndex ?? 0) <= (deposit.logicIndex ?? 0);
    const score = distance - (behind ? 40 : 0);
    if (!best || score < best.score) best = { root: platform, distance, score };
  }
  if (!best) return null;
  return { root: best.root, distance: best.distance, reach };
}

/** Grava no depósito com quem ele conta para transportar. Sem raiz ao alcance,
 *  grava o motivo — um depósito sem saída tem de ser visível como tal. */
export function attachTransportRoot(level, deposit, settings = null) {
  const found = findTransportRootFor(level, deposit, settings);
  const config = { ...PHOSPHATE_SOLUBILIZATION_DEFAULTS, ...(settings || {}) };
  deposit.transportReach = Number(config.mycorrhizalReach) || 320;
  if (!found) {
    deposit.transportRoot = null;
    deposit.transportRootLogicIndex = null;
    deposit.transportDistance = null;
    deposit.transportBlockedReason = 'nenhuma raiz colonizavel ao alcance';
    return null;
  }
  deposit.transportRoot = found.root;
  deposit.transportRootLogicIndex = found.root.logicIndex ?? null;
  deposit.transportDistance = found.distance;
  deposit.transportBlockedReason = null;
  return found;
}

export function createPhosphateDepositAt({
  level,
  hostPlatform,
  destinationPlatform = null,
  logicIndex = null,
  optionalDetourId = null,
  detourModuleId = null,
  authored = false,
  difficulty = 'standard',
  id = null,
  settings = null,
} = {}) {
  if (!level || !hostPlatform) return null;
  const config = {
    ...PHOSPHATE_SOLUBILIZATION_DEFAULTS,
    ...(settings || {}),
  };
  const depositHeight = Math.max(
    190,
    Number(config.depositHeight) || 210,
  );
  const deposit = {
    id: id || `${optionalDetourId || 'phase'}:phosphate-deposit:${logicIndex ?? hostPlatform.logicIndex}`,
    phosphateDeposit: true,
    logicIndex: logicIndex ?? hostPlatform.logicIndex,
    requiredFeature: 'phosphateSolubilization',
    x: hostPlatform.x + hostPlatform.w - 64,
    y: hostPlatform.y - depositHeight,
    w: 58,
    h: depositHeight,
    remainingPhosphate: 1,
    initialPhosphate: 1,
    hp: 1,
    broken: false,
    localAvailablePhosphate: 0,
    hostPlatformId: hostPlatform.platformId || hostPlatform.id,
    destinationPlatformId:
      destinationPlatform?.platformId || destinationPlatform?.id || null,
    optionalDetourId,
    detourModuleId,
    routeScope: optionalDetourId ? 'optional' : 'primary',
    routeOwned: Boolean(optionalDetourId),
    authored: Boolean(authored),
    allowOptionalRoutePopulation: Boolean(optionalDetourId && authored),
    difficulty,
  };
  level.crystals ||= [];
  level.phosphateDeposits ||= [];
  // A MESMA instância nas duas coleções. `crystals` é o que o mundo desenha e
  // colide; `phosphateDeposits` é o que o sistema de solubilização percorre.
  // Dois objetos parecidos dariam um bloco que aparece, colide e não reage.
  level.crystals.push(deposit);
  level.phosphateDeposits.push(deposit);
  level.availablePhosphatePools ||= [];
  level.phosphateTransportParticles ||= [];
  // Com quem este depósito conta para transportar. Registrado na criação, junto
  // da geometria que o determina.
  attachTransportRoot(level, deposit, settings);
  return deposit;
}

// Fracoes tiradas da fase padrao (rota de 17: colonia 2, deposito 6, raiz 9).
// Indices fixos faziam a fase inteira desaparecer quando o Phase Lab a encurtava
// — sem colonia, sem deposito e sem raiz-alvo o finalTest fica inalcancavel e a
// fase trava. As fracoes acompanham o reescalonamento.
const COLONY_RATIO = .125;
const DEPOSIT_RATIO = .375;
const ROOT_RATIO = .5625;

export function applyPhaseSevenPhosphateGeometry(level, phase, config = null) {
  if (phase !== 7) return level;
  const platforms = routePlatforms(level);
  // Abaixo disso nao cabem tres pontos distintos na ordem colonia -> deposito ->
  // raiz, e forcar geraria uma fase pior que uma fase sem desafio.
  if (platforms.length < 5) return level;
  const settings = { ...PHOSPHATE_SOLUBILIZATION_DEFAULTS, ...(config || {}) };
  const last = platforms.length - 1;
  const at = ratio => Math.max(1, Math.round(last * ratio));
  const colonyIndex = at(COLONY_RATIO);
  const depositIndex = Math.max(colonyIndex + 1, at(DEPOSIT_RATIO));
  const rootIndex = Math.min(last, Math.max(depositIndex + 1, at(ROOT_RATIO)));
  const colonyPlatform = platforms[colonyIndex];
  const depositPlatform = platforms[depositIndex];
  const rootPlatform = platforms[rootIndex];
  colonyPlatform.type = 'root';
  // O fosfato mineral fica no SOLO (mais lógico que raiz). A micorriza continua
  // absorvendo a partir de uma RAIZ vizinha dentro do alcance (regra em
  // transportingColony), não do depósito diretamente.
  depositPlatform.type = 'soil';
  depositPlatform.phosphateStock = 0;
  rootPlatform.type = 'root';
  rootPlatform.phosphateTarget = true;
  rootPlatform.phosphateStock = 0;

  level.authoredBeneficialColonies = [
    {
      id: 'phase-7-solubilizer-colony',
      type: 'bacillus',
      platform: colonyPlatform,
      x: colonyPlatform.x + colonyPlatform.w * .58,
      y: colonyPlatform.y - 8,
      sourceCount: 5,
      vigor: 1,
      growth: 1,
      rechargeIntensity: .35,
    },
    {
      id: 'phase-7-bridge-mycorrhiza',
      type: 'myco',
      platform: colonyPlatform,
      x: colonyPlatform.x + colonyPlatform.w * .25,
      y: colonyPlatform.y - 8,
      sourceCount: 5,
      vigor: 1,
      growth: 1,
      rechargeIntensity: .35,
    },
  ];

  // O deposito e o desafio-assinatura da fase: ele fecha a rota e so a
  // solubilizacao abre. A altura precisa derrotar salto duplo mais dash, senao
  // vira cenario. Ver a medicao em PHOSPHATE_SOLUBILIZATION_DEFAULTS.
  level.crystals = (level.crystals || []).filter(crystal => crystal.requiredFeature !== 'pulse');
  level.phosphateDeposits = [];
  level.availablePhosphatePools = [];
  level.phosphateTransportParticles = [];
  createPhosphateDepositAt({
    level,
    hostPlatform: depositPlatform,
    destinationPlatform: rootPlatform,
    logicIndex: depositPlatform.logicIndex,
    authored: true,
    difficulty: 'phase-7-signature',
    id: 'phase-7-phosphate-deposit',
    settings,
  });
  // Nao existe rota autoral: o transporte so acontece se o jogador inocular uma
  // micorriza numa raiz ao alcance da poca. A raiz-alvo fica marcada como
  // destino esperado, mas nada nela e funcional por decreto.
  return level;
}

function pointOnRoute(points, progress) {
  if (!points?.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const scaled = clamp(progress, 0, .999999) * (points.length - 1);
  const index = Math.floor(scaled);
  const local = scaled - index;
  const a = points[index];
  const b = points[Math.min(points.length - 1, index + 1)];
  return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
}

export function createPhosphateSolubilization({
  state, input, entities, selection, bacillus, inoculants = null,
}) {
  let charge = 0;
  let chargeParticleCooldown = 0;
  let eHeldLast = false;
  let shots = [];
  let chargeParticles = [];
  let transported = 0;
  let solubilizedCount = 0;
  const CHARGE_KEY = 'phosphate-charge:player';

  function settings() {
    return { ...PHOSPHATE_SOLUBILIZATION_DEFAULTS, ...(state.level.phaseProfile?.phosphateSolubilization || {}) };
  }

  function selected() {
    return Boolean(state.player.canPhosphateSolubilization
      && selection?.isSelected('phosphate-solubilization'));
  }

  function nearestSolubilizer() {
    const px = state.player.x + state.player.w / 2;
    const py = state.player.y + state.player.h / 2;
    const radius = settings().absorptionRadius;
    return bacillus.solubilizerEntries
      .filter(entry => entry.mode !== 'spores' && entry.mode !== 'sporulating' && entry.maturity >= .72)
      .map(entry => ({ entry, distance: Math.hypot(entry.colony.x - px, entry.colony.y - py) }))
      .filter(item => item.distance <= radius)
      .sort((a, b) => a.distance - b.distance)[0]?.entry || null;
  }

  function fireShot() {
    const config = settings();
    if (charge < config.minimumCharge) {
      // Carga insuficiente e descartada: nao houve disparo, entao nao ha som.
      charge = 0;
      state.player.phosphateCharge = 0;
      return;
    }
    const x = state.player.x + state.player.w / 2 + state.player.facing * 18;
    const y = state.player.y + state.player.h * .45;
    shots.push({
      x, y, originX: x, originY: y, direction: state.player.facing || 1,
      charge, energy: charge * 2, distance: 0, hitDeposits: new Set(),
    });
    recordPhaseObjectiveAction(state, 'performedPhosphatePulseCount');
    entities?.audio?.play('phosphatePulseRelease', { x, y });
    entities.burst(x, y, '#df91ff', 10 + Math.round(charge * 12), 110);
    charge = 0;
    state.player.phosphateCharge = 0;
  }

  function prepare(dt) {
    if (state.gameState !== 'play') return;
    const held = Boolean(input.keys.KeyE);
    // A barra so pode SOAR enquanto ela realmente sobe. Segurar E sem
    // solubilizador por perto, sem reserva ou com a carga no teto nao produz
    // som nenhum — o loop e o retrato da carga, nao da tecla.
    let charging = false;
    if (selected() && held) {
      const entry = nearestSolubilizer();
      if (entry && entry.phosphateMetaboliteReserve > 0) {
        const config = settings();
        const gain = dt / Math.max(.1, config.chargeTimeSeconds);
        const consumed = Math.min(gain, entry.phosphateMetaboliteReserve, config.maximumCharge - charge);
        charge = clamp(charge + consumed, 0, config.maximumCharge);
        entry.phosphateMetaboliteReserve -= consumed;
        charging = consumed > 0;
        // Uma particula por quadro empilhava tudo na mesma reta, com fase quase
        // identica: virava um tracejado rigido. Agora saem espacadas no tempo,
        // de pontos diferentes da colonia e com fase propria.
        chargeParticleCooldown -= dt;
        if (consumed > 0 && chargeParticleCooldown <= 0 && chargeParticles.length < 10) {
          chargeParticleCooldown = .16;
          const spread = (Math.random() - .5) * 26;
          chargeParticles.push({
            fromX: entry.colony.x + spread,
            fromY: entry.colony.y + (Math.random() - .5) * 14,
            progress: 0,
            speed: .9 + Math.random() * .5,
            phase: Math.random() * TAU,
            swing: 7 + Math.random() * 9,
          });
        }
      }
    }
    // Som centrado (nao espacial): a carga e do jogador, nao do mundo.
    // `protect` impede o limitador de vozes de derrubar justamente o loop da
    // acao que o jogador esta executando neste instante.
    if (charging) {
      const proporcao = clamp(charge / Math.max(.001, settings().maximumCharge), 0, 1);
      entities?.audio?.startLoop(CHARGE_KEY, 'phosphateCharge', {
        protect: true,
        gain: .55 + proporcao * .45,
        rate: .82 + proporcao * .32,
      });
    } else {
      entities?.audio?.stopLoop(CHARGE_KEY, { fade: .12 });
    }

    if (selected() && !held && eHeldLast) fireShot();
    if (!selected() && !held) charge = 0;
    eHeldLast = held;
    state.player.phosphateCharge = charge;
  }

  function dissolveWithShot(shot) {
    const config = settings();
    for (const deposit of state.level.phosphateDeposits || []) {
      if (deposit.broken || shot.hitDeposits.has(deposit.id)) continue;
      const cx = deposit.x + deposit.w / 2;
      const cy = deposit.y + deposit.h / 2;
      const along = (cx - shot.originX) * shot.direction;
      if (along < 0 || along > config.shotRange || along > shot.distance + 36) continue;
      const halfWidth = 12 + along * (.12 + shot.charge * .13);
      if (Math.abs(cy - shot.originY) > halfWidth + deposit.h / 2) continue;
      const amount = Math.min(deposit.remainingPhosphate, shot.energy * config.amountSolubilizedPerCharge);
      if (amount <= 0) continue;
      shot.hitDeposits.add(deposit.id);
      shot.energy = Math.max(0, shot.energy - amount / Math.max(.001, config.amountSolubilizedPerCharge));
      deposit.remainingPhosphate = clamp(deposit.remainingPhosphate - amount, 0, deposit.initialPhosphate);
      deposit.localAvailablePhosphate = (deposit.localAvailablePhosphate || 0) + amount;
      let pool = (state.level.availablePhosphatePools || []).find(candidate => candidate.depositId === deposit.id);
      if (!pool) {
        pool = {
          depositId: deposit.id, x: cx, y: cy, amount: 0, phase: 0,
          captureRadius: config.localPoolCaptureRadius,
          absorptionState: 'available',
        };
        state.level.availablePhosphatePools.push(pool);
      }
      pool.amount += amount;
      if (deposit.remainingPhosphate <= .0001) {
        // Transicao broken false -> true, uma vez. Sem cooldown: a conclusao
        // nao pode ser engolida pelo cooldown do impacto parcial.
        deposit.broken = true;
        entities?.audio?.play('phosphateDepositComplete', { x: cx, y: cy });
        solubilizedCount += 1;
        state.toast = 'Deposito esgotado: o fosforo foi solubilizado e permanece disponivel localmente.';
        state.toastTime = 4;
      } else {
        // Impacto parcial: cooldown por deposito (0,18 s) evita um som por quadro
        // quando varios tiros chegam juntos.
        entities?.audio?.play('phosphateDissolvePartial', {
          x: cx, y: cy, instanceId: deposit.id,
        });
        state.toast = `Solubilizacao parcial: ${Math.round((1 - deposit.remainingPhosphate / deposit.initialPhosphate) * 100)}%.`;
        state.toastTime = 2.5;
      }
      if (shot.energy <= .001) shot.distance = config.shotRange;
    }
  }

  // Quem transporta o fosfato solubilizado e uma colonia de micorriza inoculada
  // numa raiz, dentro do alcance da poca. Nao ha rota desenhada: os dois pontos
  // sao objetos reais e o vinculo so existe quando o organismo esta la.
  function transportingColony(pool) {
    const colonies = inoculants?.colonies || [];
    const reach = settings().mycorrhizalReach || 320;
    let best = null;
    for (const colony of colonies) {
      if (colony.type !== 'myco' || colony.dormant) continue;
      if (colony.growth < .68 || colony.vigor <= .05) continue;
      if (!colony.platform || colony.platform.type !== 'root') continue;
      const distance = Math.hypot(colony.x - pool.x, colony.y - pool.y);
      if (distance > reach) continue;
      if (!best || distance < best.distance) best = { colony, distance };
    }
    return best?.colony || null;
  }

  function updateTransport(dt) {
    const config = settings();
    for (const pool of state.level.availablePhosphatePools || []) {
      if (pool.amount <= 0) continue;
      const colony = transportingColony(pool);
      pool.transportingColony = colony;
      const transportKey = `phosphate-transport:${pool.depositId}`;
      if (!colony) {
        // Sem micorriza nao ha transporte: o loop encerra.
        entities?.audio?.stopLoop(transportKey);
        pool.absorptionState = 'waiting-mycorrhiza';
        continue;
      }
      const root = colony.platform;
      const amount = Math.min(pool.amount, dt * config.mycorrhizalTransportRate);
      pool.amount -= amount;
      if (amount > 0) {
        pool.hadTransport = true;
        // Ponto medio entre a poca e a colonia que transporta.
        entities?.audio?.startLoop(transportKey, 'phosphateTransport', {
          x: (pool.x + colony.x) / 2,
          y: (pool.y + colony.y) / 2,
          gain: clamp(.45 + amount / Math.max(.0001, dt * config.mycorrhizalTransportRate) * .55, 0, 1),
          rate: .94 + clamp(amount * 6, 0, .12),
        });
      }
      pool.absorptionState = pool.amount > .001 ? 'absorbing' : 'depleted';
      const sourceDeposit = (state.level.phosphateDeposits || []).find(deposit => deposit.id === pool.depositId);
      if (sourceDeposit) sourceDeposit.localAvailablePhosphate = Math.max(0, pool.amount);
      transported += amount;
      root.phosphateStock = (root.phosphateStock || 0) + amount;
      root.nutritionalEfficiency = clamp((root.nutritionalEfficiency || 0) + amount * .08, 0, 1);
      root.metabolicMaintenance = clamp((root.metabolicMaintenance || 0) + amount * .06, 0, 1);
      const maximumHealth = clamp(root.maxRootHealth ?? 1, 0, 1);
      root.rootHealth = Math.min(maximumHealth, (root.rootHealth ?? maximumHealth) + amount * .025);
      state.player.soil += amount * .35;
      state.player.hope += amount * .22;
      // Entrega completa: houve transporte de verdade, a poca acabou e a raiz
      // recebeu quantidade real. Uma vez por poca.
      if (pool.hadTransport && pool.amount <= .001 && !pool.audioDeliveryCompleted) {
        entities?.audio?.stopLoop(transportKey, { fade: .2 });
        const entregue = entities?.audio
          ? fxLanded(entities.audio.play('phosphateRootDeliveryComplete', {
              x: root.x + root.w / 2,
              y: root.y,
              instanceId: pool.depositId,
            }))
          : true;
        if (entregue) pool.audioDeliveryCompleted = true;
      }
      const particles = state.level.phosphateTransportParticles || (state.level.phosphateTransportParticles = []);
      if (particles.length < 14) {
        particles.push({
          poolId: pool.depositId,
          progress: 0,
          speed: .3 + amount * 2,
          wobble: (Math.random() - .5) * 26,
        });
      }
    }
  }

  function update(dt) {
    const config = settings();
    for (const shot of shots) {
      shot.distance += config.shotSpeed * dt;
      shot.x = shot.originX + shot.direction * shot.distance;
      dissolveWithShot(shot);
    }
    shots = shots.filter(shot => shot.distance < config.shotRange);
    for (const particle of chargeParticles) particle.progress += dt * particle.speed;
    chargeParticles = chargeParticles.filter(particle => particle.progress < 1);
    updateTransport(dt);
    for (const particle of state.level.phosphateTransportParticles || []) particle.progress += dt * particle.speed;
    state.level.phosphateTransportParticles = (state.level.phosphateTransportParticles || []).filter(particle => particle.progress < 1);
  }

  function render(ctx) {
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    for (const deposit of state.level.phosphateDeposits || []) {
      if (deposit.broken) continue;
      const ratio = deposit.remainingPhosphate / deposit.initialPhosphate;
      // Prismas de fosfato que BROTAM da rocha: colunas facetadas ancoradas na
      // superficie do bloco, de alturas variadas (estaveis por deposito) que
      // encolhem conforme o fosfato e solubilizado. Antes era um unico poligono
      // flutuando no ar.
      const baseY = deposit.y + deposit.h;
      const count = 5;
      const columnWidth = deposit.w / count;
      ctx.save();
      ctx.globalAlpha = .5 + ratio * .5;
      ctx.shadowBlur = 16;
      ctx.shadowColor = '#db83ff';
      for (let k = 0; k < count; k++) {
        const seed = Math.sin(deposit.x * .13 + k * 12.9898) * .5 + .5;
        const cx = deposit.x + columnWidth * (k + .5);
        const half = columnWidth * (.34 + seed * .12);
        const height = deposit.h * (.55 + seed * .45) * (.4 + ratio * .6);
        const tipY = baseY - height;
        const shoulderY = tipY + height * .2;
        const body = ctx.createLinearGradient(cx, baseY, cx, tipY);
        body.addColorStop(0, '#4a2d63');
        body.addColorStop(1, '#c98cff');
        ctx.fillStyle = body;
        ctx.strokeStyle = '#efb4ff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx - half, baseY);
        ctx.lineTo(cx - half, shoulderY);
        ctx.lineTo(cx, tipY);
        ctx.lineTo(cx + half, shoulderY);
        ctx.lineTo(cx + half, baseY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,236,255,.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, tipY);
        ctx.lineTo(cx, baseY);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const pool of state.level.availablePhosphatePools || []) {
      if (pool.amount <= .001) continue;
      for (let i = 0; i < 9; i++) {
        const angle = state.time * .5 + i * TAU / 9;
        ctx.fillStyle = i % 2 ? '#f2b4ff' : '#ffc966';
        ctx.globalAlpha = .38 + Math.min(1, pool.amount) * .5;
        ctx.beginPath();
        ctx.arc(pool.x + Math.cos(angle) * (15 + i % 3 * 5), pool.y + Math.sin(angle) * (9 + i % 2 * 5), 2.2, 0, TAU);
        ctx.fill();
      }
    }
    // O fosfato viaja entre dois pontos reais: a poca solubilizada e a colonia
    // de micorriza que a esta absorvendo. Sem colonia, nada e desenhado — antes
    // havia uma polilinha fixa que se declarava hifa funcional.
    for (const pool of state.level.availablePhosphatePools || []) {
      const colony = pool.transportingColony;
      if (!colony) continue;
      for (const particle of state.level.phosphateTransportParticles || []) {
        if (particle.poolId !== pool.depositId) continue;
        const t = clamp(particle.progress, 0, 1);
        const x = pool.x + (colony.x - pool.x) * t;
        const y = pool.y + (colony.y - pool.y) * t + Math.sin(t * Math.PI) * particle.wobble;
        ctx.fillStyle = '#ffd56f';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#e4a2ff';
        ctx.globalAlpha = Math.sin(t * Math.PI) * .9 + .1;
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
    // O disparo era um triangulo chapado do jogador ate a frente da onda. Agora
    // e uma frente de acidos organicos: nucleo estreito que desvanece atras e
    // gotas soltas na borda, sem aresta reta.
    for (const shot of shots) {
      const width = 8 + shot.distance * (.05 + shot.charge * .05);
      const tail = Math.max(shot.originX * shot.direction, (shot.x - shot.direction * 130) * shot.direction) * shot.direction;
      const gradient = ctx.createLinearGradient(tail, shot.y, shot.x, shot.y);
      gradient.addColorStop(0, 'rgba(223,145,255,0)');
      gradient.addColorStop(1, 'rgba(240,190,255,.5)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(tail, shot.y);
      ctx.quadraticCurveTo((tail + shot.x) / 2, shot.y - width, shot.x, shot.y);
      ctx.quadraticCurveTo((tail + shot.x) / 2, shot.y + width, tail, shot.y);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(255,214,255,.7)';
      for (let i = 0; i < 4; i++) {
        const along = (i + 1) / 5;
        const dx = tail + (shot.x - tail) * along;
        const dy = shot.y + Math.sin(shot.distance * .05 + i * 1.9) * width * .7;
        ctx.beginPath();
        ctx.arc(dx, dy, 1.6 + (1 - along) * 1.4, 0, TAU);
        ctx.fill();
      }
    }
    for (const particle of chargeParticles) {
      const px = state.player.x + state.player.w / 2;
      const py = state.player.y + state.player.h * .45;
      const t = clamp(particle.progress, 0, 1);
      const x = particle.fromX + (px - particle.fromX) * t;
      const y = particle.fromY + (py - particle.fromY) * t
        + Math.sin(t * Math.PI) * particle.swing * Math.sin(particle.phase);
      ctx.fillStyle = '#e8a4ff';
      ctx.globalAlpha = Math.sin(t * Math.PI) * .85;
      ctx.beginPath(); ctx.arc(x, y, 1.8 + t * 1.6, 0, TAU); ctx.fill();
    }
    if (charge > 0) {
      const px = state.player.x + state.player.w / 2;
      const py = state.player.y + state.player.h * .45;
      ctx.strokeStyle = '#e6a2ff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, 18 + charge * 18, -.5 * Math.PI, (-.5 + charge * 2) * Math.PI); ctx.stroke();
    }
    ctx.restore();
  }

  function clear() {
    entities?.audio?.stopLoop(CHARGE_KEY, { fade: .05 });
    entities?.audio?.stopGroup('phosphate-transport');
    charge = 0;
    eHeldLast = false;
    shots = [];
    chargeParticles = [];
    transported = 0;
    solubilizedCount = 0;
    state.player.phosphateCharge = 0;
  }

  return {
    prepare, update, render, clear, reset: clear,
    get charge() { return charge; },
    get shotCount() { return shots.length; },
    get solubilizedDepositCount() { return solubilizedCount; },
    get transportedPhosphate() { return transported; },
    // A reserva vive na raiz que recebeu o transporte, seja ela qual for.
    get rootPhosphateStock() {
      return (state.level.platforms || [])
        .reduce((sum, platform) => sum + (platform.phosphateStock || 0), 0);
    },
  };
}
