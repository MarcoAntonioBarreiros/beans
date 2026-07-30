// Propulsão da Rizósfera (jetpack)
// ================================
//
// Mochila propulsora de energia FINITA. Não é queda lenta nem hover passivo: a
// gravidade continua agindo e o propulsor aplica força para cima enquanto o
// botão estiver mantido. Com isso o jogador pode frear uma queda, planar,
// segurar o ápice, inverter a queda, ganhar altura, prolongar um salto simples
// ou duplo, e usar tudo isso em pulsos curtos.
//
// A energia vem da raiz: raiz saudável entrega mais RESERVA (o teto), e os
// organismos benéficos entregam mais VELOCIDADE de recarga. As duas coisas são
// deliberadamente separadas — ver jetpackChargeCapFromRootHealth e
// jetpackRechargeMultiplierForRoot.
//
// O procedural NÃO conhece esta habilidade: nenhuma primitiva a exige, nenhuma
// rota depende dela, e nenhum bloco é marcado como "alcançável por propulsão".
// O alcance é consequência da física, da energia disponível e da mão do jogador.

export const JETPACK_CONFIG = Object.freeze({
  // Quanto dura a propulsão contínua com o tanque cheio.
  maximumContinuousSeconds: 1.05,
  // Tempo parado sobre a mesma raiz antes de a recarga começar.
  connectionDelaySeconds: 0.40,
  // Fração de tanque por segundo, sem nenhum organismo.
  baseRechargePerSecond: 0.28,

  // Precisa superar a gravidade do jogo (1180 px/s²) com folga suficiente para
  // inverter uma queda em tempo jogável, não só para segurá-la.
  thrustAcceleration: 1880,
  // Teto de subida DA MOCHILA. Não limita a subida de um salto que já esteja
  // mais rápido — ver applyJetpackThrust.
  maximumJetpackAscentSpeed: 320,
  maximumHorizontalSpeed: 185,

  rhizobiumRechargeBonus: 0.25,
  azospirillumRechargeBonus: 0.15,
  mycorrhizaRechargeBonus: 0.20,
  mycorrhizaWithPhosphorusBonus: 0.30,
  bacillusRechargeBonus: 0.10,
  pseudomonasRechargeBonus: 0.10,

  maximumRechargeMultiplier: 1.80,

  // Acima disto o jogador está correndo, e correr cancela a conexão com a raiz.
  maximumRechargeHorizontalSpeed: 35,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// A saúde da raiz decide APENAS o teto de carga, em faixas. Usa a mesma
// porcentagem ARREDONDADA que o HUD mostra, para não haver divergência entre o
// que o jogador lê e o que a raiz entrega: se a interface diz 99%, a raiz vai
// até 80%; se diz 100%, ela enche o tanque.
//
// De propósito não é interpolação contínua — uma raiz de 81% não dá 81%.
export function jetpackChargeCapFromRootHealth(rootHealth) {
  const healthPercent = Math.round(clamp(Number.isFinite(rootHealth) ? rootHealth : 1, 0, 1) * 100);
  if (healthPercent < 70) return 0;
  if (healthPercent < 80) return 0.50;
  if (healthPercent < 90) return 0.70;
  if (healthPercent < 100) return 0.80;
  return 1;
}

// Raiz elegível para recarregar. Estruturas (degrau de Azospirillum, ponte
// micorrízica), solo, recuperação e colisores auxiliares ficam de fora: a
// energia vem da raiz viva, não de qualquer superfície pisável.
export function isJetpackRechargeRoot(platform) {
  if (!platform || platform.type !== 'root') return false;
  if (platform.recovery || platform.safetyStep) return false;
  if (platform.azospirillumStructure || platform.azospirillumLadderStep) return false;
  if (platform.mycorrhizaStructure) return false;
  if (platform.temporary || platform.collapsed) return false;
  if (platform.collisionDisabledUntil > 0 && platform.rootState === 'collapsed') return false;
  return true;
}

// Raízes antigas ainda sem saúde inicializada valem como saudáveis.
export function rootHealthForJetpack(platform) {
  return Number.isFinite(platform?.rootHealth) ? clamp(platform.rootHealth, 0, 1) : 1;
}

// Os organismos benéficos decidem a VELOCIDADE da recarga — nunca o teto. A
// saúde da raiz é proibida de entrar nesta conta: uma raiz de 70% e uma de 100%
// com os mesmos organismos recarregam no mesmo ritmo; o que muda é onde cada uma
// para.
//
// As condições são LOCAIS (o organismo tem de estar naquela raiz), não contagem
// global — senão uma colônia do outro lado da fase aceleraria esta raiz.
export function jetpackRechargeMultiplierForRoot({ root, state = null, systems = {} } = {}) {
  const bonuses = jetpackRechargeBonuses({ root, state, systems });
  const total = 1
    + bonuses.rhizobium
    + bonuses.azospirillum
    + bonuses.mycorrhiza
    + bonuses.bacillus
    + bonuses.pseudomonas;
  return Math.min(JETPACK_CONFIG.maximumRechargeMultiplier, total);
}

// Detalhado para o painel de debug e para os testes conseguirem afirmar cada
// bônus isoladamente.
export function jetpackRechargeBonuses({ root, state = null, systems = {} } = {}) {
  const zero = { rhizobium: 0, azospirillum: 0, mycorrhiza: 0, bacillus: 0, pseudomonas: 0 };
  if (!root) return zero;
  const level = state?.level || {};

  // Rhizobium: nódulo maduro E fixando de fato nesta raiz.
  const rhizobium = (level.rhizobiumNodules || []).some(site => (
    site.platform === root && site.mature === true && (site.fixationRate || 0) > 0.05
  )) ? JETPACK_CONFIG.rhizobiumRechargeBonus : 0;

  const colonies = systems.inoculants?.colonies || level.beneficialColonies || [];

  // Azospirillum: colônia ativa e já estabelecida nesta raiz.
  const azospirillum = colonies.some(colony => (
    colony.platform === root
    && colony.type === 'azospirillum'
    && colony.dormant !== true
    && (colony.growth ?? 0) >= 0.68
  )) ? JETPACK_CONFIG.azospirillumRechargeBonus : 0;

  // Micorriza: funcional nesta raiz. Com fósforo local disponível o bônus é
  // MAIOR, e substitui o comum — os dois nunca somam.
  const mycorrhizaFunctional = colonies.some(colony => (
    colony.platform === root
    && colony.type === 'myco'
    && colony.dormant !== true
    && (colony.growth ?? 0) >= 0.68
  )) || (level.platforms || []).some(platform => (
    platform.mycorrhizaStructure && platform.mature !== false && platform.hostPlatform === root
  ));
  const phosphorusHere = mycorrhizaFunctional && (
    (root.phosphateStock || 0) > 0
    || (level.availablePhosphatePools || []).some(pool => pool.platform === root && (pool.amount ?? pool.available ?? 0) > 0)
  );
  const mycorrhiza = !mycorrhizaFunctional
    ? 0
    : phosphorusHere
      ? JETPACK_CONFIG.mycorrhizaWithPhosphorusBonus
      : JETPACK_CONFIG.mycorrhizaRechargeBonus;

  // Bacillus: biofilme FUNCIONAL nesta raiz.
  const bacillus = (level.biofilms || []).some(film => (
    film.platform === root && film.functional === true
  )) ? JETPACK_CONFIG.bacillusRechargeBonus : 0;

  // Pseudomonas: não basta a colônia existir visualmente — precisa estar
  // funcionalmente ativa (vigor, não dormente e com atividade de sideróforo ou
  // reserva de ferro nesta raiz).
  const pseudomonas = colonies.some(colony => (
    colony.platform === root
    && colony.type === 'pseudomonas'
    && colony.dormant !== true
    && (colony.vigor ?? 0) > 0.05
    && ((colony.ironReserve || 0) > 0 || (colony.siderophoreActivity || 0) > 0 || (colony.growth ?? 0) >= 0.68)
  )) ? JETPACK_CONFIG.pseudomonasRechargeBonus : 0;

  return { rhizobium, azospirillum, mycorrhiza, bacillus, pseudomonas };
}

// Quanto de energia entra neste quadro. A saúde NÃO aparece aqui: ela só definiu
// o `cap` lá fora.
export function jetpackRechargeStep(dt, multiplier = 1) {
  return dt * JETPACK_CONFIG.baseRechargePerSecond * multiplier;
}

// Consumo linear e previsível: tanque cheio = maximumContinuousSeconds de
// propulsão contínua, independente de estar subindo ou planando.
export function jetpackConsumptionStep(dt) {
  return dt / JETPACK_CONFIG.maximumContinuousSeconds;
}

// A força para cima. A gravidade do quadro JÁ foi aplicada quando isto roda.
//
// O `if` existe para a mochila não ATRAPALHAR um salto: um salto sai a -465px/s
// e o teto da mochila é -320. Sem a checagem, ligar o propulsor logo após pular
// FREARIA a subida. Com ela, a mochila espera o salto perder velocidade e só
// então sustenta ou recupera a subida.
export function applyJetpackThrust(player, dt) {
  const ceiling = -JETPACK_CONFIG.maximumJetpackAscentSpeed;
  if (player.vy > ceiling) {
    player.vy -= JETPACK_CONFIG.thrustAcceleration * dt;
    player.vy = Math.max(player.vy, ceiling);
  }
  player.vx = clamp(
    player.vx,
    -JETPACK_CONFIG.maximumHorizontalSpeed,
    JETPACK_CONFIG.maximumHorizontalSpeed,
  );
}

// Todas as condições de ativação. A única exigência espacial é estar no ar:
// nunca altura, distância, tipo de bloco, direção vertical ou uso prévio do
// salto duplo.
export function canActivateJetpack(player, state) {
  return Boolean(
    player?.canJetpack
    && player.alive
    && state?.gameState === 'play'
    && player.onGround === false
    && player.jetpackEnergy > 0
    && player.jetpackLockedUntilGround !== true
    && player.dashTime <= 0,
  );
}
