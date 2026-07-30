const initialPlayer = {
  x: 90,
  y: 500,
  w: 32,
  h: 48,
  vx: 0,
  vy: 0,
  onGround: false,
  facing: 1,
  coyote: 0,
  jumpBuffer: 0,
  canDoubleJump: false,
  airJumpAvailable: false,
  canDash: false,
  canPhosphateSolubilization: false,
  phosphateCharge: 0,
  dashTime: 0,
  dashCooldown: 0,
  invuln: 0,
  tutorialUnsafeUntil: 0,
  alive: true,
  exudates: 0,
  soil: 28,
  hope: 31,
  maxVitality: 5,
  vitality: 5,
  infection: 0,
  infectionExposure: 0,
  fungalContamination: 0,
  fungalAttachmentLevel: 0,
  fungalDamageCooldown: 0,
  nematodeDamageCooldown: 0,
  healCooldown: 0,
  nematodeLoad: 0,
  moveMultiplier: 1,
  accelerationMultiplier: 1,
  jumpMultiplier: 1,
  dashCooldownMultiplier: 1,
  dashSuppressed: false,
  deathFlash: 0,
  deaths: 0,
  // Propulsão da Rizósfera. A energia é normalizada (0..1) e NUNCA é restaurada
  // sozinha ao pousar: ela só sobe recarregando sobre uma raiz elegível.
  canJetpack: false,
  jetpackActive: false,
  jetpackEnergy: 0,
  jetpackMaximumEnergy: 1,
  jetpackRechargeCap: 0,
  jetpackRechargeMultiplier: 1,
  jetpackConnectionTime: 0,
  jetpackRechargeRoot: null,
  jetpackLockedUntilGround: false,
  // Plataforma que de fato sustentou o último pouso. A recarga usa isto, não
  // proximidade geométrica.
  supportPlatform: null,
};

export function createPlayer() {
  return { ...initialPlayer };
}

// Zera só o RUNTIME da mochila (propulsão, conexão, multiplicadores). Não
// desbloqueia nem bloqueia a habilidade, e não devolve energia: quem decide a
// energia é a recarga sobre a raiz.
export function resetJetpackRuntime(player) {
  player.jetpackActive = false;
  player.jetpackRechargeRoot = null;
  player.jetpackConnectionTime = 0;
  player.jetpackRechargeCap = 0;
  player.jetpackRechargeMultiplier = 1;
}

// Desliga a propulsão em curso preservando a energia restante. `lockUntilGround`
// impede reativação na mesma sequência aérea (usado pelo Dash e pelo dano).
export function cancelJetpack(player, { lockUntilGround = false } = {}) {
  player.jetpackActive = false;
  if (lockUntilGround) player.jetpackLockedUntilGround = true;
}

export function resetPlayer(player, unlocks = null) {
  const deaths = player.deaths || 0;
  Object.assign(player, initialPlayer);
  player.deaths = deaths;
  if (!unlocks) return;
  player.canDoubleJump = Boolean(unlocks.doubleJump);
  player.canDash = Boolean(unlocks.dash);
  player.canPhosphateSolubilization = Boolean(unlocks.phosphateSolubilization);
  player.canJetpack = Boolean(unlocks.jetpack);
  player.airJumpAvailable = player.canDoubleJump;
}
