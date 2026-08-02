import { H, W } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { drawArbuscule } from '../procgen/hyphal-growth.js';
import { createMicrobeRenderer } from './microbes.js';
import { createNecroticZone } from './necrotic-zone.js';
import { createPlayerSprite } from './player-sprite.js';
import { resolvePlayerSkin } from './player-skins.js';
import { drawInoculatedBacillusSprite, isBacillusSpriteEnabled } from './bacillus-sprite.js';
import { organismSprites } from './organism-sprites.js';
import { createRhizosphereBackdrop } from './rhizosphere-backdrop.js';
import { createRhizosphereParallax } from './rhizosphere-parallax.js';

function mixHex(a, b, t) {
  const value = clamp(t, 0, 1);
  const parse = color => [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const channel = (x, y) => Math.round(x + (y - x) * value).toString(16).padStart(2, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

export function createRenderer({
  canvas,
  state,
  entities,
  playerSkin = null,
  parallaxSeed = 'rhizosphere',
}) {
  const ctx = canvas.getContext('2d');
  const microbes = createMicrobeRenderer({ ctx, state, entities });
  const necroticZone = createNecroticZone();
  const rhizosphereBackdrop = createRhizosphereBackdrop({
    seed: parallaxSeed,
    createImage: () => canvas.ownerDocument?.createElement?.('img') || null,
  });
  const parallaxBackground = createRhizosphereParallax({
    seed: parallaxSeed,
    createCanvas: () => canvas.ownerDocument?.createElement?.('canvas') || null,
  });
  let lastNecroticTime = Number.isFinite(state.time) ? state.time : 0;
  const parallaxCamera = { cameraX: 0, cameraY: 0, zoom: 1 };
  const parallaxViewport = { width: W, height: H };
  const necroticView = {
    cameraX: 0,
    cameraY: 0,
    zoom: 1,
    viewportWidth: W,
    viewportHeight: H,
    top: 674,
    bottom: H,
  };
  const skin = playerSkin || resolvePlayerSkin({
    locationLike: typeof window === 'undefined' ? null : window.location,
    storage: (() => { try { return window.localStorage; } catch (_) { return null; } })(),
  });
  const sprite = skin?.states ? createPlayerSprite(skin) : null;

  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function drawBackground() {
    // Area VISIVEL do mundo, nao tamanho do canvas: com zoom < 1 (o afastamento
    // do fim de fase) a area visivel e maior que a superficie de desenho, e o
    // degrade terminava no meio da tela.
    const zoom = Math.max(.01, Number(state.cameraZoom) || 1);
    const viewportWidth = (canvas.width || W) / zoom;
    const viewportHeight = (canvas.height || H) / zoom;
    const cameraX = state.cameraX || 0;
    const cameraY = state.cameraY || 0;
    const g = ctx.createLinearGradient(0, cameraY, 0, cameraY + viewportHeight);
    g.addColorStop(0, '#0d2f37');
    g.addColorStop(.45, '#10262e');
    g.addColorStop(1, '#170f1b');
    ctx.fillStyle = g;
    // O fundo fica ancorado ao viewport. Como a transformacao vertical da
    // camera ja esta aplicada ao contexto, somar cameraY aqui a cancela e evita
    // revelar a borda superior da imagem em trechos que sobem acima de y=0. O
    // mesmo vale no eixo X, onde a translacao e feita por cada sistema.
    ctx.fillRect(cameraX, cameraY, viewportWidth, viewportHeight);
    rhizosphereBackdrop.render(ctx, parallaxCamera, parallaxViewport);
    parallaxBackground.render(ctx, parallaxCamera, parallaxViewport);
  }

  function drawRootStress(platform, health, time) {
    const damage = 1 - health;
    if (damage <= .08) return;

    const veinCount = Math.max(2, Math.floor(damage * 8));
    ctx.save();
    ctx.globalAlpha = .18 + damage * .55;
    ctx.strokeStyle = damage > .62 ? '#4d1f31' : '#813f3d';
    ctx.lineWidth = 1 + damage * 1.6;
    for (let i = 0; i < veinCount; i++) {
      const x = platform.x + 14 + ((i * 47 + platform.logicIndex * 19) % Math.max(20, platform.w - 28));
      const y = platform.y + 8 + (i % 3) * Math.min(14, platform.h * .18);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 7 + damage * 10, y + 8);
      ctx.lineTo(x + 3, y + 15 + damage * 10);
      ctx.stroke();
    }
    ctx.restore();

    if (platform.healthTrend) {
      const alpha = clamp(platform.healthTrendTime || 0, 0, 1) * .34;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = platform.healthTrend > 0 ? '#9dffb1' : '#ff6f91';
      ctx.lineWidth = 3;
      roundedRect(platform.x - 2, platform.y - 2, platform.w + 4, platform.h + 4, 15);
      ctx.stroke();
      ctx.restore();
    }

    if (damage > .55) {
      ctx.save();
      ctx.globalAlpha = .12 + damage * .18;
      ctx.fillStyle = '#ff6f91';
      const pulse = 3 + Math.sin(time * 2.5 + platform.x * .01) * 1.2;
      for (let i = 0; i < 5; i++) {
        const x = platform.x + platform.w * (i + .5) / 5;
        ctx.beginPath();
        ctx.arc(x, platform.y + 9, pulse, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawRhizoctonia(enemy, index, time) {
    const hpRatio = clamp((enemy.hp ?? 3) / Math.max(1, enemy.maxHp || 3), 0, 1);
    const charge = clamp(enemy.attackCharge || 0, 0, 1);
    const lunge = enemy.mode === 'lunge' ? 1 : 0;
    const stunned = enemy.mode === 'stunned';
    const pulse = 1 + Math.sin(time * 2.4 + index) * .05;
    const spriteStatus = organismSprites.status('rhizoctonia');
    const spriteReady = spriteStatus.enabled && spriteStatus.loaded && !spriteStatus.failed;

    ctx.save();
    // A sheet é desenhada pelo controle da Rhizoctonia depois da hifa de
    // ataque. Aqui mantemos somente o fallback procedural reversível.
    if (spriteReady) ctx.globalAlpha = 0;
    ctx.translate(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2 + 4);
    ctx.scale(pulse * (1 + charge * .12), pulse * .76);

    ctx.fillStyle = 'rgba(35,17,25,.9)';
    ctx.beginPath();
    ctx.ellipse(0, 7, 30, 19, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 18 + charge * 16;
    ctx.shadowColor = stunned ? '#ffca7d' : '#ff5d82';
    const cushion = ctx.createRadialGradient(-5, -5, 2, 0, 2, 25);
    cushion.addColorStop(0, stunned ? '#c98560' : '#b54c64');
    cushion.addColorStop(.58, '#71334f');
    cushion.addColorStop(1, '#3b1f31');
    ctx.fillStyle = cushion;
    ctx.beginPath();
    ctx.ellipse(0, 0, 22 + charge * 4, 13 + lunge * 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = stunned ? '#ffd38b' : '#ff8297';
    ctx.lineWidth = 1.7 + charge;
    for (let k = 0; k < 8; k++) {
      const direction = k < 4 ? -1 : 1;
      const row = k % 4;
      const startX = direction * (8 + row * 3);
      const endX = direction * (27 + row * 7 + charge * 13);
      const endY = 7 + (row - 1.5) * 6;
      ctx.beginPath();
      ctx.moveTo(startX, 2 + row);
      ctx.bezierCurveTo(
        direction * (16 + row * 4),
        -8 + row * 5,
        direction * (22 + row * 5),
        12 + row * 2,
        endX,
        endY,
      );
      ctx.stroke();
    }

    ctx.fillStyle = '#3a1726';
    for (let k = 0; k < 7; k++) {
      const angle = k / 7 * Math.PI * 2 + time * .08;
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * 13, Math.sin(angle) * 7, 2.2 + (k % 2), 0, Math.PI * 2);
      ctx.fill();
    }

    if (charge > .05) {
      ctx.globalAlpha = .28 + charge * .6;
      ctx.strokeStyle = '#ff416d';
      ctx.lineWidth = 2 + charge * 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 29 + charge * 14, 19 + charge * 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    ctx.save();
    ctx.font = '700 9px Inter,system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd5df';
    ctx.fillText('Rhizoctonia', enemy.x + enemy.w / 2, enemy.y - 13);
    ctx.fillStyle = 'rgba(22,12,18,.78)';
    ctx.fillRect(enemy.x - 1, enemy.y - 8, enemy.w + 2, 5);
    ctx.fillStyle = hpRatio > .5 ? '#ff8297' : '#ffb15c';
    ctx.fillRect(enemy.x, enemy.y - 7, enemy.w * hpRatio, 3);
    ctx.restore();
  }

  function drawWorld() {
    const { time, cameraX, level } = state;
    const player = state.player;
    ctx.save();
    ctx.translate(-cameraX, 0);
    if (level.endX === undefined) {
      ctx.strokeStyle = 'rgba(108,231,223,.22)';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 10]);
      for (let x = 1180; x < 3120; x += 150) {
        ctx.beginPath();
        ctx.moveTo(x, 640);
        ctx.bezierCurveTo(x + 40, 520, x - 60, 430, x + 70, 300);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    level.platforms.forEach(p => {
      // O desenho visual das plataformas e suas texturas e totalmente conduzido por platform-visuals.js.
      // A geometria e colisao fisica em level.platforms permanecem 100% ativas para o personagem.
    });

    if (level.hazards.length) {
      let top = Infinity;
      let bottom = -Infinity;
      for (const hazard of level.hazards) {
        top = Math.min(top, hazard.y);
        bottom = Math.max(bottom, hazard.y + hazard.h);
      }
      necroticView.cameraX = cameraX;
      necroticView.cameraY = state.cameraY || 0;
      necroticView.zoom = state.cameraZoom || 1;
      necroticView.viewportWidth = canvas.width || W;
      necroticView.viewportHeight = canvas.height || H;
      necroticView.top = top;
      necroticView.bottom = bottom;
      necroticZone.render(ctx, necroticView);
    }

    if (level.endX === undefined) {
      ctx.strokeStyle = '#cfaa72';
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(3850, 465);
      ctx.bezierCurveTo(4040, 360, 4290, 370, 4740, 520);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,233,182,.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    level.crystals.forEach(c => {
      if (c.phosphateDeposit) return;
      if (c.broken) return;
      ctx.save();
      ctx.translate(c.x + c.w / 2, c.y + c.h);
      const glow = ctx.createRadialGradient(0, -c.h * .55, 4, 0, -c.h * .55, c.h);
      glow.addColorStop(0, 'rgba(255,177,92,.65)');
      glow.addColorStop(1, 'rgba(255,177,92,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-c.w, -c.h * 1.6, c.w * 2, c.h * 1.8);
      ctx.fillStyle = '#d78353';
      ctx.strokeStyle = '#ffca7d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-c.w * .48, 0);
      ctx.lineTo(-c.w * .32, -c.h * .52);
      ctx.lineTo(-c.w * .1, -c.h);
      ctx.lineTo(c.w * .12, -c.h * .6);
      ctx.lineTo(c.w * .34, -c.h * .88);
      ctx.lineTo(c.w * .48, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });

    const optionalRewardGroups = new Map();
    for (const reward of level.exudates) {
      if (!reward.optionalReward || reward.taken || !reward.encounterInstanceId) continue;
      if (!optionalRewardGroups.has(reward.encounterInstanceId)) {
        optionalRewardGroups.set(reward.encounterInstanceId, []);
      }
      optionalRewardGroups.get(reward.encounterInstanceId).push(reward);
    }
    for (const rewards of optionalRewardGroups.values()) {
      const centerX = rewards.reduce((sum, reward) => sum + reward.x, 0) / rewards.length;
      const centerY = rewards.reduce((sum, reward) => sum + reward.y, 0) / rewards.length;
      const pulse = .5 + .5 * Math.sin(time * 1.8);
      ctx.save();
      ctx.strokeStyle = `rgba(205,255,136,${.18 + pulse * .14})`;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(183,243,107,.45)';
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, 48 + pulse * 4, 27 + pulse * 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    level.exudates.forEach((o, i) => {
      if (o.taken) return;
      const bob = Math.sin(time * 2 + i) * 7;
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#b7f36b';
      ctx.fillStyle = '#cfff88';
      ctx.beginPath();
      ctx.arc(o.x, o.y + bob, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(183,243,107,.5)';
      ctx.beginPath();
      ctx.arc(o.x, o.y + bob, 14 + Math.sin(time * 3 + i) * 2, 0, Math.PI * 2);
      ctx.stroke();
    });

    microbes.discoverVisibleEncounters();
    level.checkpoints.forEach((c, ci) => {
      ctx.save();
      ctx.translate(c.x, c.y);
      const col = c.active ? '#70e5d6' : 'rgba(185,220,207,.35)';
      const glow = c.active ? .20 : .06;
      ctx.fillStyle = `rgba(112,229,214,${glow})`;
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2 + time * .12;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 18, Math.sin(a) * 13, 17 + Math.sin(time + i) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!isBacillusSpriteEnabled()) {
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2 + ci * .45;
          const bx = Math.cos(a) * 19;
          const by = Math.sin(a) * 13;
          microbes.drawBacteriumWithFlags(bx, by, a + Math.PI / 2, .55, col, i + ci, 'short', 'peri', c.active && i % 3 === 0 ? .9 : 0);
        }
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, 31 + Math.sin(time * 2 + ci) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    });

    microbes.drawMicrobeEcosystems();
    level.allies.forEach((a, i) => {
      if (a.taken) return;
      ctx.save();
      ctx.translate(a.x, a.y + Math.sin(time * 2 + i) * 7);
      if (a.id === 'azo') {
        ctx.shadowBlur = 25;
        ctx.shadowColor = '#72e8dd';
        microbes.drawBacteriumWithFlags(0, 0, -.35, 1.45, '#72e8dd', i, 'curved', 'single');
        ctx.strokeStyle = 'rgba(199,165,255,.55)';
        ctx.lineWidth = 1.4;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(0, 0, 22 + k * 9 + Math.sin(time * 2 + k) * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (a.id === 'myco') {
        if (a.mycorrhizaArbusculeDebut) {
          // A estreia usa a mesma morfologia arbuscular das pequenas estruturas
          // de colonizacao, apenas ampliada para ser reconhecida pelo jogador.
          ctx.save();
          ctx.scale(3, 3);
          drawArbuscule(ctx, { x: 0, y: 8, seed: i + 1, life: 1 }, time, '#d6afff');
          ctx.restore();
        } else {
          ctx.shadowBlur = 26;
          ctx.shadowColor = '#d6afff';
          ctx.strokeStyle = '#d6afff';
          ctx.lineWidth = 2.4;
          for (let k = 0; k < 7; k++) {
            const ang = k / 7 * Math.PI * 2 + time * .06;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(Math.cos(ang) * 18, Math.sin(ang) * 12, Math.cos(ang + .4) * 30, Math.sin(ang + .4) * 24, Math.cos(ang) * 38, Math.sin(ang) * 30);
            ctx.stroke();
          }
          ctx.fillStyle = '#f0dcff';
          ctx.beginPath();
          ctx.arc(0, 0, 11, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Fitohormônio: poder liberado pela RAIZ saudável (não um organismo).
        // Uma gota luminosa na linguagem do exsudato, com um ícone por poder.
        const pulse = 1 + Math.sin(time * 3 + i) * .08;
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#ffd783';
        const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 21 * pulse);
        halo.addColorStop(0, 'rgba(255,233,160,.9)');
        halo.addColorStop(.55, 'rgba(183,243,107,.4)');
        halo.addColorStop(1, 'rgba(183,243,107,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, 21 * pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = '#eaffc4';
        ctx.strokeStyle = 'rgba(120,90,40,.5)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.bezierCurveTo(9, -4, 9, 9, 0, 13);
        ctx.bezierCurveTo(-9, 9, -9, -4, 0, -13);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = '#2f5a1e';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (a.id === 'power-jump') {
          ctx.moveTo(-5, 4); ctx.lineTo(0, -2); ctx.lineTo(5, 4);
          ctx.moveTo(-5, 9); ctx.lineTo(0, 3); ctx.lineTo(5, 9);
        } else if (a.id === 'power-dash') {
          ctx.moveTo(-6, -3); ctx.lineTo(1, 3); ctx.lineTo(-6, 9);
          ctx.moveTo(1, -3); ctx.lineTo(8, 3); ctx.lineTo(1, 9);
        } else {
          for (let k = 0; k < 6; k++) {
            const ang = k / 6 * Math.PI * 2;
            ctx.moveTo(Math.cos(ang) * 3, Math.sin(ang) * 3 + 2);
            ctx.lineTo(Math.cos(ang) * 8, Math.sin(ang) * 8 + 2);
          }
        }
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      ctx.shadowBlur = 0;
      ctx.restore();
    });

    level.enemies.forEach((enemy, index) => {
      if (!enemy.alive) return;
      drawRhizoctonia(enemy, index, time);
    });

    level.particles.forEach(p => {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.globalAlpha = 1;
    drawPlayer();
    ctx.restore();
  }

  function drawFungalAttachment(player, time) {
    const infection = clamp(Math.max(player.infection || 0, player.fungalContamination || 0), 0, 1);
    if (infection < .06) return;
    const opportunisticContact = clamp(Math.max(
      player.fungalAttachmentLevel || 0,
      (player.fungalContamination || 0) * .82,
    ), 0, 1);
    const count = 2 + Math.floor((opportunisticContact || infection) * 7);
    ctx.save();
    ctx.globalAlpha = .24 + infection * .58;
    ctx.strokeStyle = infection > .7 ? '#ff657f' : '#c86b85';
    ctx.fillStyle = infection > .7 ? '#8e2949' : '#71334f';
    ctx.lineWidth = .8 + infection * .9;
    for (let i = 0; i < count; i++) {
      const seed = i * 1.73;
      const x = -9 + ((i * 7) % 19);
      const y = -4 + ((i * 9) % 23);
      const radius = .8 + (i % 3) * .4 + infection * .45;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (i % 2 === 0 && opportunisticContact > .04) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(
          x + Math.sin(time * 2 + seed) * 4,
          y - 3 - opportunisticContact * 4,
          x + Math.cos(time + seed) * (5 + opportunisticContact * 5),
          y + Math.sin(seed) * 4,
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawPlayer() {
    const player = state.player;
    const time = state.time;
    ctx.save();
    ctx.translate(player.x + player.w / 2, player.y + player.h / 2);
    ctx.scale(player.facing, 1);
    if (!player.alive) {
      ctx.rotate(-.28);
      ctx.globalAlpha = .42;
    }
    const blink = player.invuln > 0 && Math.floor(time * 14) % 2 === 0;
    if (blink) ctx.globalAlpha = .35;

    // A skin troca so o corpo. Tudo que vem depois — hifa aderida, carga de
    // fosfato, aviso de dash bloqueado — e informacao de jogo, nao enfeite do
    // astronauta, e precisa aparecer em qualquer personagem.
    if (!sprite?.draw(ctx, player, time, state.gameState)) drawAstronautBody(player);

    drawFungalAttachment(player, time);
    drawJetpack(player, time);

    if (player.canPhosphateSolubilization) {
      ctx.shadowBlur = 16;
      ctx.shadowColor = '#df91ff';
      ctx.fillStyle = '#df91ff';
      ctx.beginPath();
      ctx.arc(15, -2, 3 + (player.phosphateCharge || 0) * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    if ((player.nematodeLoad || 0) >= 2) {
      ctx.fillStyle = '#ffd7a0';
      ctx.font = '800 8px Inter,system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('DASH BLOQUEADO', 0, -36);
    }
    ctx.restore();
  }

  // Propulsão da Rizósfera. Tudo aqui é traço determinístico desenhado por
  // quadro — nenhuma partícula física entra no nível, para não haver centenas de
  // objetos vivos só por causa de um efeito. O colisor, o player.y, a câmera e o
  // tamanho do personagem NÃO são tocados: é puramente visual.
  // Cápsula (retângulo de pontas arredondadas) desenhada com arcos. ctx.roundRect
  // resolveria em uma linha, mas não existe em todo navegador que o jogo suporta.
  function capsulePath(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }

  function drawJetpack(player, time) {
    if (!player.canJetpack) return;
    const energy = Math.max(0, Math.min(1, player.jetpackEnergy || 0));
    // Sobre a mochila, um pouco acima do centro do corpo — no quadril o medidor
    // ficava solto, sem parecer parte do equipamento.
    const coreX = -13;
    const coreY = -6;

    // Medidor da mochila: uma cápsula de combustível, não um retângulo solto.
    // O nível sobe de baixo para cima e as marcas correspondem aos TETOS que as
    // raízes entregam (50/70/80%), então o desenho ensina a regra: parar num
    // traço significa que aquela raiz não dava mais que aquilo.
    const capsuleW = 8;
    const capsuleH = 19;
    const radius = capsuleW / 2;
    const left = coreX - capsuleW / 2;
    const top = coreY - capsuleH / 2;
    const innerTop = top + 1.5;
    const innerH = capsuleH - 3;
    const pulse = energy >= .999 ? .88 + Math.sin(time * 4.2) * .12 : 1;

    ctx.save();

    // Corpo escuro da cápsula (sem depender de roundRect, que nem todo browser
    // antigo expõe).
    capsulePath(left, top, capsuleW, capsuleH, radius);
    ctx.fillStyle = 'rgba(4,26,24,.85)';
    ctx.fill();

    // Líquido: recorta pela cápsula e preenche a fração de baixo para cima.
    if (energy > 0) {
      ctx.save();
      capsulePath(left + 1, innerTop, capsuleW - 2, innerH, radius - 1);
      ctx.clip();
      const filled = innerH * energy;
      const fillTop = innerTop + innerH - filled;
      const gradient = ctx.createLinearGradient(0, innerTop + innerH, 0, fillTop);
      gradient.addColorStop(0, '#3fd9a4');
      gradient.addColorStop(1, '#c8ffe8');
      ctx.fillStyle = gradient;
      ctx.globalAlpha = pulse;
      ctx.fillRect(left, fillTop, capsuleW, filled + 1);
      // Menisco: uma linha clara no topo do líquido dá leitura imediata do nível.
      ctx.globalAlpha = .9 * pulse;
      ctx.fillStyle = '#eafff6';
      ctx.fillRect(left, fillTop, capsuleW, 1.2);
      ctx.restore();
    }

    // Marcas dos tetos das raízes.
    ctx.globalAlpha = .4;
    ctx.fillStyle = '#0a2f2a';
    for (const marca of [.5, .7, .8]) {
      const y = innerTop + innerH * (1 - marca);
      ctx.fillRect(left + 1.5, y, capsuleW - 3, .9);
    }

    // Contorno: acende junto com a carga.
    ctx.globalAlpha = .35 + energy * .5;
    capsulePath(left, top, capsuleW, capsuleH, radius);
    ctx.strokeStyle = energy <= 0 ? '#4d7a70' : '#8ef0c6';
    ctx.lineWidth = 1.1;
    ctx.shadowColor = '#8ef0c6';
    ctx.shadowBlur = energy <= 0 ? 0 : 3 + energy * 9 * pulse;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Bico inferior: identifica de que lado sai o jato.
    ctx.globalAlpha = .5 + energy * .35;
    ctx.fillStyle = energy <= 0 ? '#4d7a70' : '#8ef0c6';
    ctx.beginPath();
    ctx.moveTo(left + 1.5, top + capsuleH);
    ctx.lineTo(left + capsuleW - 1.5, top + capsuleH);
    ctx.lineTo(left + capsuleW / 2, top + capsuleH + 2.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Jato: intensidade CONSTANTE enquanto propulsiona. O tamanho não representa
    // a energia restante — isso enganaria o jogador, que lê a reserva no núcleo.
    if (player.jetpackActive) {
      ctx.save();
      const flicker = .78 + Math.sin(time * 38) * .22;
      const length = 16 * flicker;
      // O jato sai do BICO da cápsula, não de um ponto solto no corpo.
      const nozzleY = top + capsuleH + 2;
      const gradient = ctx.createLinearGradient(coreX, nozzleY, coreX, nozzleY + length);
      gradient.addColorStop(0, 'rgba(230,255,246,.98)');
      gradient.addColorStop(.35, 'rgba(112,229,214,.8)');
      gradient.addColorStop(1, 'rgba(112,229,214,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(coreX - 4, nozzleY);
      ctx.lineTo(coreX + 4, nozzleY);
      ctx.lineTo(coreX, nozzleY + length);
      ctx.closePath();
      ctx.fill();
      // Linhas de ar: três traços determinísticos pelo tempo, sem estado.
      ctx.strokeStyle = 'rgba(214,255,244,.4)';
      ctx.lineWidth = 1;
      for (let index = 0; index < 3; index++) {
        const offset = ((time * 170 + index * 13) % 26) - 6;
        ctx.beginPath();
        ctx.moveTo(coreX - 9 + index * 9, nozzleY + 3 + offset);
        ctx.lineTo(coreX - 9 + index * 9, nozzleY + 8 + offset);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Recarga: traços subindo da raiz até a mochila. A quantidade acompanha o
    // multiplicador (mais organismos = fluxo mais intenso), sem virar enxame.
    const recharging = player.onGround
      && player.jetpackConnectionTime >= 0
      && player.jetpackRechargeRoot
      && energy < (player.jetpackRechargeCap || 0);
    if (recharging) {
      const traces = Math.round(2 + (player.jetpackRechargeMultiplier || 1) * 2);
      ctx.save();
      ctx.strokeStyle = 'rgba(142,240,198,.6)';
      ctx.lineWidth = 1.4;
      for (let index = 0; index < traces; index++) {
        const phase = (time * 1.6 + index / traces) % 1;
        const y = 24 - phase * 26;
        ctx.globalAlpha = .12 + (1 - phase) * .5;
        ctx.beginPath();
        ctx.moveTo(coreX - 2 + Math.sin(phase * 6 + index) * 3, y);
        ctx.lineTo(coreX - 2 + Math.sin(phase * 6 + index) * 3, y - 4);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawAstronautBody(player) {
    ctx.strokeStyle = '#ff6f91';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    ctx.quadraticCurveTo(-28 - player.vx * .02, -2, -34 - player.vx * .035, 7);
    ctx.stroke();
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#6ce7df';
    ctx.fillStyle = '#172f39';
    roundedRect(-13, -18, 26, 36, 10);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#6ce7df';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#dffdf4';
    ctx.beginPath();
    ctx.arc(0, -18, 12, Math.PI, 0);
    ctx.lineTo(12, -10);
    ctx.lineTo(-12, -10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#173e47';
    ctx.beginPath();
    ctx.ellipse(2, -17, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#dffdf4';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-7, 16);
    ctx.lineTo(-8, 24);
    ctx.moveTo(7, 16);
    ctx.lineTo(9, 24);
    ctx.stroke();
  }

  function drawIntroBackdrop() {
    drawBackground();
    ctx.save();
    ctx.globalAlpha = .6;
    ctx.translate(-120, 0);
    ctx.fillStyle = '#51382f';
    ctx.fillRect(0, 575, 1500, 200);
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = 'rgba(210,169,105,.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(i * 120 + 40, 590);
      ctx.quadraticCurveTo(i * 120 + 80, 500, i * 120 + 100, 380);
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    const necroticTime = Number.isFinite(state.time) ? state.time : lastNecroticTime;
    const necroticDt = necroticTime >= lastNecroticTime
      ? Math.min(.1, necroticTime - lastNecroticTime)
      : 0;
    necroticZone.update(necroticDt);
    parallaxCamera.cameraX = state.cameraX || 0;
    parallaxCamera.cameraY = state.cameraY || 0;
    parallaxCamera.zoom = state.cameraZoom || 1;
    parallaxViewport.width = canvas.width || W;
    parallaxViewport.height = canvas.height || H;
    parallaxBackground.update(necroticDt, parallaxCamera, state.player);
    lastNecroticTime = necroticTime;
    const sx = state.shake ? (Math.random() - .5) * state.shake * 24 : 0;
    const sy = state.shake ? (Math.random() - .5) * state.shake * 16 : 0;
    ctx.save();
    ctx.translate(sx, sy);
    if (state.gameState === 'intro') drawIntroBackdrop();
    else {
      drawBackground();
      drawWorld();
    }
    ctx.restore();
  }

  return {
    render, drawBackground, drawWorld, drawPlayer,
    necroticZone,
    rhizosphereBackdrop,
    parallaxBackground,
    playerSkin: { id: skin?.id || 'astronaut', usingSprite: () => Boolean(sprite && !sprite.isFallback()), debug: () => sprite?.debug() || null },
  };
}
