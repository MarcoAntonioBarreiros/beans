import { PLAYER_MAX_X, W } from './core/constants.js';
import { clamp, lerp, rects } from './core/math.js';
import { microbeEncounters } from './data/microbes.js';
import { recordPhaseObjectiveAction } from './procgen/campaign-objective-progress.js';
import { unlockCampaignFeature } from './procgen/campaign-progression.js';
import { cancelJetpack } from './player.js';
import {
  JETPACK_CONFIG,
  applyJetpackThrust,
  canActivateJetpack,
  isJetpackRechargeRoot,
  jetpackChargeCapFromRootHealth,
  jetpackConsumptionStep,
  jetpackRechargeMultiplierForRoot,
  jetpackRechargeStep,
  rootHealthForJetpack,
} from './player-jetpack.js';

export function createPhysicsSystem({ state, input, entities, hud, audio }) {
  // Rotação das três variações de coleta de exsudato (Pacote 03). Contador, não
  // sorteio — ver o comentário no ponto de coleta.
  const EXUDATE_PICKUP_TRACKS = ['exudatePickup01', 'exudatePickup02', 'exudatePickup03'];
  let nextExudatePickupVariant = 0;

  function collectCampaignUnlock(ally, player) {
    const feature = ally.unlockFeature
      || (ally.id === 'power-jump' ? 'doubleJump' : ally.id === 'power-dash' ? 'dash' : ally.id === 'power-pulse' ? 'phosphateSolubilization' : ally.id === 'myco' ? 'mycorrhizaStructures' : ally.id === 'azo' ? 'azospirillumRoots' : null);
    unlockCampaignFeature(state, feature);

    let color = '#72e8dd';
    if (feature === 'doubleJump') {
      // Poder da raiz (fitohormonio), nao organismo: sem discoverMicrobe aqui.
      player.airJumpAvailable = true;
      player.soil += 6;
      player.hope += 5;
      hud.setMission('A raiz liberou o salto duplo: pratique o segundo impulso no ar');
    } else if (feature === 'dash') {
      color = '#70e5d6';
      player.soil += 7;
      player.hope += 5;
      hud.setMission('Combine salto duplo e dash para alcançar a primeira raiz principal');
    } else if (feature === 'mycorrhizaStructures') {
      color = '#d6afff';
      player.soil += 8;
      player.hope += 5;
      hud.setMission('Libere exsudatos nas bordas para formar pontes micorrízicas horizontais');
      entities.discoverMicrobe('myco', false);
    } else if (feature === 'phosphateSolubilization') {
      color = '#8db8ff';
      player.soil += 9;
      player.hope += 6;
      hud.setMission('Selecione Solubilização P, carregue perto do Bacillus e solte E na direção do depósito');
      entities.discoverMicrobe('phos', false);
    } else if (feature === 'azospirillumRoots') {
      player.soil += 8;
      player.hope += 6;
      hud.setMission('Inocule Azospirillum em raízes e use exsudatos para orientar novas ramificações');
      entities.discoverMicrobe('azospirillum', false);
    }
    return color;
  }

  function findEnemyHost(enemy, level) {
    const centerX = enemy.x + enemy.w / 2;
    let best = null;
    let bestDistance = Infinity;
    for (const platform of level.platforms) {
      if (platform.final || platform.recovery || platform.mycorrhizaStructure) continue;
      const pointX = clamp(centerX, platform.x, platform.x + platform.w);
      const distance = Math.hypot(pointX - centerX, platform.y - (enemy.y + enemy.h));
      if (distance < bestDistance) {
        best = platform;
        bestDistance = distance;
      }
    }
    if (best) best.type = 'root';
    return best;
  }

  function ensureRhizoctonia(enemy, level) {
    if (enemy.type === 'rhizoctonia' && enemy.hostPlatform) return;
    enemy.type = 'rhizoctonia';
    enemy.maxHp = enemy.maxHp || 3;
    enemy.hp = Number.isFinite(enemy.hp) ? enemy.hp : enemy.maxHp;
    enemy.mode = enemy.mode || 'colonizing';
    enemy.attackCharge = enemy.attackCharge || 0;
    enemy.attackTime = enemy.attackTime || 0;
    enemy.attackCooldown = enemy.attackCooldown || .5;
    enemy.attackDirection = enemy.attackDirection || 1;
    enemy.stun = enemy.stun || 0;
    enemy.colonization = enemy.colonization || .18;
    enemy.hostPlatform = enemy.hostPlatform || findEnemyHost(enemy, level);
    enemy.homeX = enemy.homeX ?? enemy.x;
    if (enemy.hostPlatform) {
      enemy.left = enemy.hostPlatform.x + 14;
      enemy.right = enemy.hostPlatform.x + enemy.hostPlatform.w - enemy.w - 14;
      enemy.x = clamp(enemy.x, enemy.left, enemy.right);
      enemy.y = enemy.hostPlatform.y - enemy.h - 5;
    }
  }

  function updateRhizoctonia(enemy, dt, player, level) {
    ensureRhizoctonia(enemy, level);
    if (!enemy.alive || !enemy.hostPlatform) return;

    const host = enemy.hostPlatform;
    enemy.left = host.x + 14;
    enemy.right = host.x + host.w - enemy.w - 14;
    enemy.x = clamp(enemy.x, enemy.left, enemy.right);
    enemy.y = host.y - enemy.h - 5;
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
    enemy.stun = Math.max(0, enemy.stun - dt);

    const playerCenterX = player.x + player.w / 2;
    const enemyCenterX = enemy.x + enemy.w / 2;
    const dx = playerCenterX - enemyCenterX;
    const horizontalDistance = Math.abs(dx);
    const verticalDistance = Math.abs((player.y + player.h) - host.y);
    const playerOnHostLevel = verticalDistance < 105;

    enemy.colonization = clamp(enemy.colonization + dt * (enemy.stun > 0 ? -.025 : .018), .12, 1);
    host.rhizoctoniaPressure = Math.max(
      host.rhizoctoniaPressure || 0,
      clamp(.12 + enemy.colonization * .58 + (enemy.mode === 'charging' ? .12 : 0), 0, 1),
    );

    if (enemy.stun > 0) {
      enemy.mode = 'stunned';
      return;
    }

    if (enemy.attackTime > 0) {
      enemy.mode = 'lunge';
      enemy.attackTime = Math.max(0, enemy.attackTime - dt);
      enemy.x = clamp(enemy.x + enemy.attackDirection * 165 * dt, enemy.left, enemy.right);
      if (enemy.attackTime <= 0) {
        enemy.mode = 'recovering';
        enemy.attackCooldown = Math.max(enemy.attackCooldown, 2.1);
      }
    } else if (playerOnHostLevel && horizontalDistance < 155 && enemy.attackCooldown <= 0) {
      enemy.mode = 'charging';
      enemy.attackCharge += dt;
      enemy.attackDirection = Math.sign(dx) || enemy.attackDirection;
      if (enemy.attackCharge >= .72) {
        enemy.attackCharge = 0;
        enemy.attackTime = .32;
        enemy.attackCooldown = 2.5;
        enemy.mode = 'lunge';
        state.toast = 'Rhizoctonia formou uma almofada de infecção e lançou uma hifa de ataque.';
        state.toastTime = 3.4;
      }
    } else {
      enemy.attackCharge = Math.max(0, enemy.attackCharge - dt * 1.5);
      enemy.mode = 'colonizing';
      const direction = Math.sign(dx) || 1;
      if (playerOnHostLevel && horizontalDistance < 330) {
        enemy.x = clamp(enemy.x + direction * (17 + enemy.colonization * 9) * dt, enemy.left, enemy.right);
      } else {
        enemy.x += enemy.vx * dt * .42;
        if (enemy.x <= enemy.left || enemy.x >= enemy.right) enemy.vx *= -1;
        enemy.x = clamp(enemy.x, enemy.left, enemy.right);
      }
    }

    if (rects(player, enemy) && player.invuln <= 0) {
      const charged = enemy.mode === 'lunge' && enemy.attackTime > 0;
      const damage = charged ? 2 : 1;
      entities.damagePlayer?.(damage, charged ? 'ataque de Rhizoctonia' : 'contato com Rhizoctonia', {
        infection: charged ? .24 : .11,
        invuln: charged ? 1.25 : 1.05,
        knockbackX: -enemy.attackDirection * (charged ? 360 : 255),
        knockbackY: charged ? -310 : -245,
      });
      enemy.attackTime = 0;
      enemy.attackCharge = 0;
      enemy.attackCooldown = Math.max(enemy.attackCooldown, 2.2);
      enemy.stun = .28;
    }
  }

  // Recarga da mochila. Só acontece com os pés numa raiz elegível, parado, e
  // depois de um atraso fixo de conexão — nunca no ar.
  //
  // A saúde da raiz define o TETO (jetpackChargeCapFromRootHealth); os
  // organismos definem a VELOCIDADE (jetpackRechargeMultiplierForRoot). A saúde
  // nunca entra na velocidade, e a raiz nunca DESCARREGA a mochila: se o tanque
  // já está acima do teto daquela raiz, ele simplesmente fica onde está.
  function updateJetpackRecharge(player, dt) {
    if (!player.canJetpack) return;
    const root = player.onGround ? player.supportPlatform : null;
    const eligible = root && isJetpackRechargeRoot(root);
    const stopped = Math.abs(player.vx) <= JETPACK_CONFIG.maximumRechargeHorizontalSpeed;

    // Sair da raiz, saltar, cair, correr ou trocar de raiz zera a conexão.
    if (!eligible || !stopped || root !== player.jetpackRechargeRoot) {
      player.jetpackRechargeRoot = eligible && stopped ? root : null;
      player.jetpackConnectionTime = 0;
      if (!eligible) {
        player.jetpackRechargeCap = 0;
        player.jetpackRechargeMultiplier = 1;
      }
      if (!player.jetpackRechargeRoot) return;
    }

    player.jetpackConnectionTime += dt;
    const cap = jetpackChargeCapFromRootHealth(rootHealthForJetpack(root));
    player.jetpackRechargeCap = cap;
    const multiplier = jetpackRechargeMultiplierForRoot({
      root,
      state,
      systems: { inoculants: state.beneficialInoculants },
    });
    player.jetpackRechargeMultiplier = multiplier;

    if (player.jetpackConnectionTime < JETPACK_CONFIG.connectionDelaySeconds) return;
    // Raiz doente demais (abaixo de 70%): não recarrega, e também não tira o que
    // a mochila já tem.
    if (cap <= 0) return;
    if (player.jetpackEnergy >= cap) return;
    player.jetpackEnergy = Math.min(
      player.jetpackEnergy + jetpackRechargeStep(dt, multiplier),
      cap,
      player.jetpackMaximumEnergy ?? 1,
    );
  }

  function update(dt) {
    state.time += dt;
    if (state.gameState !== 'play') return;

    const player = state.player;
    const level = state.level;
    const keys = input.keys;
    const moveMultiplier = clamp(player.moveMultiplier ?? 1, .48, 1);
    const accelerationMultiplier = clamp(player.accelerationMultiplier ?? 1, .42, 1);
    const jumpMultiplier = clamp(player.jumpMultiplier ?? 1, .68, 1);

    player.invuln = Math.max(0, player.invuln - dt);
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    const left = keys.ArrowLeft || keys.KeyA;
    const right = keys.ArrowRight || keys.KeyD;
    const jump = keys.Space || keys.KeyW || keys.ArrowUp;
    // Comando proprio da propulsao. Compartilhar o botao de pulo faria a mochila
    // queimar combustivel toda vez que o jogador segurasse o pulo.
    const jetpackHeld = Boolean(keys.KeyK || keys.KeyC);
    const jumpPressed = jump && !state.jumpHeldLast;
    state.jumpHeldLast = jump;
    if (jumpPressed) player.jumpBuffer = .12;
    else player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
    if (player.onGround) {
      player.coyote = .12;
      player.airJumpAvailable = player.canDoubleJump;
    } else {
      player.coyote = Math.max(0, player.coyote - dt);
    }

    if (player.dashTime > 0) {
      player.dashTime -= dt;
      player.vx = player.facing * 660 * (.82 + moveMultiplier * .18);
      player.vy = 0;
    } else {
      const target = (right ? 1 : 0) - (left ? 1 : 0);
      if (target) player.facing = target;
      player.vx = lerp(
        player.vx,
        target * 245 * moveMultiplier,
        1 - Math.pow(.0008, dt * accelerationMultiplier),
      );
      if (!target) player.vx *= Math.pow(.00002, dt);
      player.vy += 1180 * dt;
      player.vy = Math.min(player.vy, 720);
      // Propulsão da Rizósfera: a gravidade do quadro já foi aplicada acima, e o
      // empuxo entra por cima dela. Botão DEDICADO (nunca o de pulo), então
      // segurar o pulo não gasta combustível por acidente.
      if (jetpackHeld && canActivateJetpack(player, state)) {
        player.jetpackActive = true;
        applyJetpackThrust(player, dt);
        player.jetpackEnergy = Math.max(0, player.jetpackEnergy - jetpackConsumptionStep(dt));
        // Acabou o tanque: desliga e NÃO recarrega no ar.
        if (player.jetpackEnergy <= 0) player.jetpackActive = false;
      } else {
        // Soltar o botão preserva a energia restante — é o que permite os pulsos.
        player.jetpackActive = false;
      }
      if (player.jumpBuffer > 0 && player.coyote > 0) {
        player.vy = -465 * jumpMultiplier;
        player.jumpBuffer = 0;
        player.coyote = 0;
        entities.burst(player.x + 16, player.y + 48, '#d9ffc1', 8, 80);
        // O FX toca aqui, no ramo que REALMENTE salta — nunca no keydown, senão
        // apertar sem poder pular (ou o repeat do teclado) soaria igual.
        if (audio.canPlayJump?.(state.time) !== false) {
          audio.playFx?.('playerJump', { gain: 1, rate: 1 });
        }
      } else if (player.jumpBuffer > 0 && player.canDoubleJump && player.airJumpAvailable) {
        player.vy = -445 * jumpMultiplier;
        player.jumpBuffer = 0;
        player.airJumpAvailable = false;
        recordPhaseObjectiveAction(state, 'performedDoubleJumpCount');
        entities.burst(player.x + 16, player.y + 39, '#72e8dd', 22, 165);
        // Mesmo arquivo, um pouco mais agudo e leve: o salto duplo é reconhecível
        // sem precisar de um segundo som. O tom sintetizado antigo saiu — ele
        // brigaria com a música real.
        if (audio.canPlayJump?.(state.time) !== false) {
          audio.playFx?.('playerJump', { gain: 0.95, rate: 1.07 });
        }
      }
    }

    if (
      player.canDash
      && !player.dashSuppressed
      && (keys.ShiftLeft || keys.ShiftRight || keys.KeyJ)
      && player.dashCooldown <= 0
      && player.dashTime <= 0
    ) {
      player.dashTime = .16;
      player.dashCooldown = .82 * (player.dashCooldownMultiplier || 1);
      // O Dash tem prioridade sobre a propulsão e trava a reativação até o
      // próximo pouso — senão daria propulsor → dash → propulsor na mesma
      // sequência aérea. A energia restante é PRESERVADA: o jogador não perde a
      // reserva que conquistou, só não pode encadear os dois.
      cancelJetpack(player, { lockUntilGround: true });
      recordPhaseObjectiveAction(state, 'performedDashCount');
      entities.burst(player.x + 16, player.y + 24, '#6ce7df', 16, 170);
      keys.ShiftLeft = keys.ShiftRight = keys.KeyJ = false;
    }
    const prevY = player.y;
    player.x += player.vx * dt;
    const maxX = level.endX !== undefined ? level.endX : PLAYER_MAX_X;
    player.x = clamp(player.x, 0, maxX - player.w);
    player.onGround = false;
    // Quem sustentou o pouso deste quadro. A recarga da mochila usa ESTA
    // referência, não proximidade geométrica: pisar de raspão perto de uma raiz
    // não pode valer como estar apoiado nela.
    player.supportPlatform = null;
    player.y += player.vy * dt;
    for (const p of level.platforms) {
      // Toggle das plataformas de recuperacao: quando desligadas, deixam de ser
      // solidas (o jogador passa direto por elas) sem regenerar a fase. Sem
      // excecao — o `&& !p.safetyStep` que existia aqui mantinha solido um
      // degrau da antiga rede anti-softlock. Uma recovery promovida recebe
      // `recovery = false` e volta a sustentar normalmente.
      if (p.recovery && state.recoveryPlatformsDisabled) continue;
      if (p.mycorrhizaStructure || p.oneWay) {
        const previousFeet = prevY + player.h;
        const currentFeet = player.y + player.h;
        const horizontalOverlap = player.x + player.w > p.x + 3 && player.x < p.x + p.w - 3;
        const crossedTopWhileFalling = player.vy >= 0
          && previousFeet <= p.y + 8
          && currentFeet >= p.y;

        if (horizontalOverlap && crossedTopWhileFalling) {
          player.y = p.y - player.h;
          player.vy = 0;
          player.onGround = true;
          player.supportPlatform = p;
        }
        continue;
      }

      if (rects(player, p)) {
        if (prevY + player.h <= p.y + 10 && player.vy >= 0) {
          player.y = p.y - player.h;
          player.vy = 0;
          player.onGround = true;
          player.supportPlatform = p;
        } else if (prevY >= p.y + p.h - 8 && player.vy < 0) {
          player.y = p.y + p.h;
          player.vy = 0;
        } else if (player.vx > 0) {
          player.x = p.x - player.w;
          player.vx = 0;
        } else if (player.vx < 0) {
          player.x = p.x + p.w;
          player.vx = 0;
        }
      }
    }
    for (const c of level.crystals) {
      if (!c.broken && rects(player, c)) {
        if (player.vx > 0) {
          player.x = c.x - player.w;
          player.vx = 0;
        } else if (player.vx < 0) {
          player.x = c.x + c.w;
          player.vx = 0;
        }
      }
    }
    // Pousar libera a trava herdada do Dash/dano da sequência aérea anterior.
    if (player.onGround) player.jetpackLockedUntilGround = false;
    updateJetpackRecharge(player, dt);

    if (player.y > 760 || level.hazards.some(h => rects(player, h))) {
      entities.damagePlayer?.(player.maxVitality || 5, 'queda na zona hostil', { fatal: true, invuln: 0 });
      return;
    }

    level.exudates.forEach(o => {
      if (!o.taken && Math.hypot(o.x - (player.x + 16), o.y - (player.y + 24)) < 34) {
        o.taken = true;
        player.exudates++;
        player.soil += 2.3;
        player.hope += 1.7;
        // Depois da coleta REAL. Um item já `taken` nunca chega aqui, e o
        // respawn que devolve exsudatos adiante apenas volta `taken` a false —
        // sem passar por este ramo.
        //
        // A rotação 01 → 02 → 03 → 01 é um contador, não sorteio: `Math.random()`
        // aqui repetiria a mesma variação com frequência perceptível e ainda
        // consumiria RNG de gameplay.
        const trackId = EXUDATE_PICKUP_TRACKS[
          nextExudatePickupVariant % EXUDATE_PICKUP_TRACKS.length
        ];
        nextExudatePickupVariant = (nextExudatePickupVariant + 1) % EXUDATE_PICKUP_TRACKS.length;
        entities.interactionFx?.(trackId, {
          gain: 1,
          rate: 1,
          instanceId: o.id ?? `${Math.round(o.x)}:${Math.round(o.y)}`,
        });
        entities.burst(o.x, o.y, '#b7f36b', 12, 130);
      }
    });
    level.allies.forEach(a => {
      if (a.presentationOnly) return;
      if (!a.taken && Math.hypot(a.x - (player.x + 16), a.y - (player.y + 24)) < 54) {
        a.taken = true;
        const color = collectCampaignUnlock(a, player);
        entities.burst(a.x, a.y, color, 42, 250);
        hud.showToast(a.name || 'Novo mecanismo desbloqueado', a.desc || 'Uma nova função do solo vivo foi liberada.', 4700);
        hud.updateHud();
      }
    });

    microbeEncounters.forEach(z => {
      if (z.collect || state.discoveredMicrobes.has(z.id)) return;
      if (Math.hypot(z.x - (player.x + 16), z.y - (player.y + 24)) < z.r) entities.discoverMicrobe(z.id, true);
    });
    level.checkpoints.forEach(c => {
      if (!c.active && Math.abs((player.x + 16) - c.x) < 46 && Math.abs((player.y + 24) - c.y) < 76) {
        c.active = true;
        state.currentCheckpoint = { x: c.x - 16, y: c.y - 54 };
        // Transição false → true, uma vez por checkpoint. A marca vive no objeto
        // real porque o biofilme ecológico pode ver o MESMO ponto e ativá-lo —
        // sem ela, os dois sistemas tocariam o mesmo som.
        if (!c.interactionAudioActivated) {
          c.interactionAudioActivated = true;
          entities.interactionFx?.('checkpointActivation', {
            gain: 1,
            rate: 1,
            instanceId: c.id ?? `checkpoint:${Math.round(c.x)}:${Math.round(c.y)}`,
          });
        }
        entities.burst(c.x, c.y, '#70e5d6', 28, 165);
        const first = !state.discoveredMicrobes.has('bacillus');
        // Sem som de descoberta: quem manda aqui é a ativação do checkpoint.
        if (first) entities.discoverMicrobe('bacillus', false, { sound: false });
        hud.showToast(
          first ? 'Colônia resistente de Bacillus' : 'Checkpoint de Bacillus ativado',
          first ? 'Biofilme e endósporos estabilizam este ponto. No jogo, a colônia funciona como checkpoint.' : 'Esta microcolônia passa a ser seu novo ponto de retorno.',
          4300,
        );
      }
    });

    for (const platform of level.platforms) {
      if (platform.type === 'root') platform.rhizoctoniaPressure = 0;
    }
    level.enemies.forEach(enemy => updateRhizoctonia(enemy, dt, player, level));

    level.particles.forEach(p => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 180 * dt;
      p.vx *= Math.pow(.12, dt);
    });
    for (let i = level.particles.length - 1; i >= 0; i--) if (level.particles[i].life <= 0) level.particles.splice(i, 1);
    const endX = level.endX !== undefined ? level.endX : 4590;
    if (player.x > endX) player.x = endX - player.w;

    const maxCameraX = level.cameraMaxX !== undefined ? level.cameraMaxX : (4900 - W);
    state.cameraX = lerp(state.cameraX, clamp(player.x - 360, 0, maxCameraX), 1 - Math.pow(.0001, dt));
    state.shake = Math.max(0, state.shake - dt);
    hud.updateHud();
  }

  return { update };
}
