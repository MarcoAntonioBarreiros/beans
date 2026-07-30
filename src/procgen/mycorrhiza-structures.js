import { W } from '../core/constants.js';
import { getPhaseManifest, MYCORRHIZA_BRIDGE_DEFAULTS } from './campaign-manifest.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

function topPoint(platform, x) {
  return {
    x: clamp(x, platform.x + 18, platform.x + platform.w - 18),
    y: platform.y - 6,
  };
}

function platformDistance(platform, x, y) {
  const point = topPoint(platform, x);
  return { point, distance: Math.hypot(point.x - x, point.y - y) };
}

function nearestSourcePlatform(state, cloud, maxDistance = 165) {
  let best = null;
  let bestDistance = maxDistance;
  for (const platform of state.level.platforms || []) {
    if (platform.final || platform.mycorrhizaStructure) continue;
    const { point, distance } = platformDistance(platform, cloud.x, cloud.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { platform, point, distance };
    }
  }
  return best;
}

function horizontalGap(source, target) {
  if (target.x >= source.x + source.w) return target.x - (source.x + source.w);
  if (source.x >= target.x + target.w) return source.x - (target.x + target.w);
  return 0;
}

function findBridgeTarget(state, sourceInfo, cloud, config) {
  const source = sourceInfo.platform;
  const sourceCenter = source.x + source.w / 2;
  const direction = cloud.x >= sourceCenter ? 1 : -1;
  const maximumVerticalOffset = config.horizontalOnly ? 68 : 105;

  if (source.preferredMycorrhizaTargetId) {
    const prefTarget = (state.level.platforms || []).find(p => (
      (p.platformId || p.id) === source.preferredMycorrhizaTargetId
    ));
    if (prefTarget) {
      const targetCenter = prefTarget.x + prefTarget.w / 2;
      const validDirection = (targetCenter - sourceCenter) * direction > 0;
      const gap = horizontalGap(source, prefTarget);
      const dy = Math.abs(prefTarget.y - source.y);
      if (validDirection && gap >= 58 && dy <= maximumVerticalOffset) {
        const startX = direction > 0 ? source.x + source.w - 12 : source.x + 12;
        const endX = direction > 0 ? prefTarget.x + 12 : prefTarget.x + prefTarget.w - 12;
        return {
          target: prefTarget,
          start: { x: startX, y: source.y - 7 },
          end: { x: endX, y: prefTarget.y - 7 },
          gap,
          dy,
        };
      }
    }
    if (source.strictPreferredMycorrhizaTarget) {
      return null;
    }
  }

  let best = null;
  let bestScore = Infinity;

  for (const target of state.level.platforms || []) {
    if (target === source || target.final || target.recovery || target.mycorrhizaStructure) continue;
    const targetCenter = target.x + target.w / 2;
    if ((targetCenter - sourceCenter) * direction <= 0) continue;
    const gap = horizontalGap(source, target);
    if (gap < 58) continue;
    const dy = Math.abs(target.y - source.y);
    if (dy > maximumVerticalOffset) continue;
    const score = gap + dy * 2.2 + (target.type === 'root' ? -12 : 0);
    if (score < bestScore) {
      bestScore = score;
      const startX = direction > 0 ? source.x + source.w - 12 : source.x + 12;
      const endX = direction > 0 ? target.x + 12 : target.x + target.w - 12;
      best = {
        target,
        start: { x: startX, y: source.y - 7 },
        end: { x: endX, y: target.y - 7 },
        gap,
        dy,
      };
    }
  }
  return best;
}

function buildBridgeGeometry(candidate) {
  const { start, end } = candidate;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const segments = clamp(Math.ceil(distance / 58), 3, 8);
  const points = [];
  const colliders = [];
  const sag = Math.min(28, distance * .08);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = lerp(start.y, end.y, t) + Math.sin(t * Math.PI) * sag;
    const x = lerp(start.x, end.x, t);
    points.push({ x, y });
    if (i < segments) {
      const nextT = (i + 1) / segments;
      const nextX = lerp(start.x, end.x, nextT);
      const nextY = lerp(start.y, end.y, nextT) + Math.sin(nextT * Math.PI) * sag;
      const minX = Math.min(x, nextX);
      colliders.push({
        x: minX - 5,
        y: Math.min(y, nextY) - 5,
        w: Math.abs(nextX - x) + 10,
        h: 12 + Math.abs(nextY - y),
        type: 'root',
        mycorrhizaStructure: true,
        structureType: 'bridge',
      });
    }
  }
  return { start, end, points, colliders, length: distance };
}

function sameConnection(structure, source, target) {
  return (
    (structure.source === source && structure.target === target)
    || (structure.source === target && structure.target === source)
  );
}

// Ponte pendente: quando nao ha plataforma-alvo no alcance, a hifa se estende na
// direcao do exsudato ate um comprimento maximo fixo e termina no ar (target
// nulo). O limite evita pontes infinitas.
function buildDanglingCandidate(sourceInfo, cloud, config) {
  const source = sourceInfo.platform;
  const sourceCenter = source.x + source.w / 2;
  const direction = cloud.x >= sourceCenter ? 1 : -1;
  const maxLength = clamp(Number(config.danglingMaxLength) || 300, 140, 360);
  const startX = direction > 0 ? source.x + source.w - 12 : source.x + 12;
  const start = { x: startX, y: source.y - 7 };
  const end = { x: startX + direction * maxLength, y: source.y - 7 + 26 };
  return { target: null, start, end, gap: maxLength, dy: 26, dangling: true };
}

export function createMycorrhizaStructures({ state, entities, inoculants = null }) {
  let activeInoculants = inoculants;

  // Sem sistema de inoculantes ligado, o comportamento antigo permanece: e o que
  // os testes de geometria exercitam isoladamente.
  function maturedMycorrhizaOn(platform) {
    if (!activeInoculants) return true;
    const colonies = activeInoculants.colonies || [];
    return colonies.some(colony => (
      colony.type === 'myco'
      && colony.platform === platform
      && colony.growth >= .68
      && colony.vigor > .05
      && !colony.dormant
    ));
  }

  const structures = [];
  let nextId = 1;
  let lastToastAt = -Infinity;

  function clear() {
    entities?.audio?.stopGroup('mycorrhiza-bridge');
    structures.length = 0;
    if (state.level.platforms) {
      state.level.platforms = state.level.platforms.filter(platform => !platform.mycorrhizaStructure);
    }
    nextId = 1;
    lastToastAt = -Infinity;
  }

  function reset() {
    clear();
  }

  function createStructure(cloud, sourceInfo, type, candidate) {
    const geometry = buildBridgeGeometry(candidate);
    const target = candidate.target;
    if (structures.some(item => sameConnection(item, sourceInfo.platform, target))) {
      cloud.mycorrhizaStructureHandled = true;
      return null;
    }

    const structure = {
      id: `myco-structure-${nextId++}`,
      type: 'bridge',
      dangling: Boolean(candidate.dangling),
      source: sourceInfo.platform,
      target,
      start: geometry.start,
      end: geometry.end,
      points: geometry.points,
      colliders: geometry.colliders,
      length: geometry.length,
      progress: 0,
      maturity: 0,
      mature: false,
      phase: Math.random() * TAU,
      cloudId: cloud.id,
      growthDuration: clamp(2.8 + geometry.length / 115, 3.6, 7.2),
    };
    structures.push(structure);
    cloud.mycorrhizaStructureHandled = true;
    cloud.life = Math.max(cloud.life, 4.5);
    // Depois de a estrutura existir de verdade: início e loop. Vale também para
    // a ponte PENDENTE (`dangling`) — ela cresce e merece o mesmo áudio.
    entities?.audio?.play('mycorrhizaBridgeStart', {
      x: structure.start.x,
      y: structure.start.y,
    });
    entities?.audio?.startLoop(`mycorrhiza-bridge:${structure.id}`, 'mycorrhizaBridgeGrowth', {
      x: structure.start.x,
      y: structure.start.y,
      gain: .65,
    });
    entities.burst(structure.start.x, structure.start.y, '#d6afff', 20, 110);
    state.toast = 'Micorriza orientada: hifas finas começaram a conectar lateralmente as raízes sobre o vão.';
    state.toastTime = 4.8;
    return structure;
  }

  function tryCreateFromCloud(cloud) {
    // O runtime desta estrutura ja e chamado somente depois do desbloqueio de
    // mycorrhizaStructures. O Dash pertence a um evento posterior da Fase 4 e
    // nao pode impedir a demonstracao nem a pratica da ponte micorrizica.
    if (cloud.mycorrhizaStructureHandled) return;
    const age = (cloud.maxLife || 10) - cloud.life;
    if (age < .55 || cloud.radius < 72) return;
    const sourceInfo = nearestSourcePlatform(state, cloud);
    if (!sourceInfo) {
      if (age > 2.2) cloud.mycorrhizaStructureHandled = true;
      return;
    }

    // A ponte e efeito da micorriza inoculada, nao do exsudato solto. Sem uma
    // colonia madura na raiz de origem, o exsudato apenas atrai e alimenta —
    // era isso que fazia pontes nascerem em qualquer lugar.
    if (!maturedMycorrhizaOn(sourceInfo.platform)) {
      if (age > 2.2) cloud.mycorrhizaStructureHandled = true;
      return;
    }

    const nearEdge = Math.min(
      Math.abs(cloud.x - sourceInfo.platform.x),
      Math.abs(cloud.x - (sourceInfo.platform.x + sourceInfo.platform.w)),
    ) < 94;

    const phase = state.campaign?.phase ?? state.level.campaignPhase;
    const config = getPhaseManifest(phase)?.mycorrhizaBridge || MYCORRHIZA_BRIDGE_DEFAULTS;

    if (sourceInfo.platform.strictPreferredMycorrhizaTarget) {
      const bridge = findBridgeTarget(state, sourceInfo, cloud, config);
      if (bridge) {
        createStructure(cloud, sourceInfo, 'bridge', bridge);
      }
      if (age > 2.2) cloud.mycorrhizaStructureHandled = true;
      return;
    }

    if (nearEdge) {
      const bridge = findBridgeTarget(state, sourceInfo, cloud, config);
      if (bridge) {
        createStructure(cloud, sourceInfo, 'bridge', bridge);
        return;
      }
    }

    const bridge = findBridgeTarget(state, sourceInfo, cloud, config);
    if (bridge) {
      createStructure(cloud, sourceInfo, 'bridge', bridge);
      return;
    }

    // Sem alvo dentro do alcance: forma uma ponte PENDENTE (uma ponta no ar) ate
    // um comprimento maximo fixo, para a mecanica nao travar quando nao ha onde
    // ancorar. O limite evita pontes infinitas.
    const dangling = buildDanglingCandidate(sourceInfo, cloud, config);
    if (dangling && !structures.some(item => item.dangling && item.source === sourceInfo.platform)) {
      createStructure(cloud, sourceInfo, 'bridge', dangling);
      return;
    }

    if (age > 2.2) cloud.mycorrhizaStructureHandled = true;
  }

  function rebuildCollisionPlatforms() {
    state.level.platforms = (state.level.platforms || [])
      .filter(platform => !platform.mycorrhizaStructure);
    const matureColliders = structures
      .filter(structure => structure.mature)
      .flatMap(structure => structure.colliders);
    state.level.platforms.push(...matureColliders);
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    for (const cloud of state.level.exudateClouds || []) tryCreateFromCloud(cloud);

    let collisionDirty = false;
    for (const structure of structures) {
      if (structure.structureType === 'bridge' && structure.target) {
        const expectedStartY = structure.source.y;
        const expectedEndY = structure.target.y;
        if (structure.start.y !== expectedStartY || structure.end.y !== expectedEndY) {
          structure.start.y = expectedStartY;
          structure.end.y = expectedEndY;
          const sag = Math.min(28, structure.length * .08);
          const segments = structure.colliders.length;
          for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const y = lerp(structure.start.y, structure.end.y, t) + Math.sin(t * Math.PI) * sag;
            structure.points[i].y = y;
            if (i < segments) {
              const nextT = (i + 1) / segments;
              const nextY = lerp(structure.start.y, structure.end.y, nextT) + Math.sin(nextT * Math.PI) * sag;
              structure.colliders[i].y = Math.min(y, nextY) - 5;
              structure.colliders[i].h = 12 + Math.abs(nextY - y);
            }
          }
        }
      }

      if (structure.mature) continue;
      structure.progress = clamp(structure.progress + dt / structure.growthDuration, 0, 1);
      if (structure.progress > .72) {
        structure.maturity = clamp(structure.maturity + dt * .56, 0, 1);
      }
      // O som acompanha a ponta que avança: posição interpolada entre origem e
      // destino pelo progresso real.
      const bridgeKey = `mycorrhiza-bridge:${structure.id}`;
      entities?.audio?.startLoop(bridgeKey, 'mycorrhizaBridgeGrowth', {
        x: lerp(structure.start.x, structure.end.x, structure.progress),
        y: lerp(structure.start.y, structure.end.y, structure.progress),
        gain: .65 + structure.progress * .35,
        rate: .90 + structure.progress * .13,
      });
      if (structure.progress >= 1 && structure.maturity >= 1) {
        structure.mature = true;
        collisionDirty = true;
        // Conclusão pela transição mature false → true, no ponto de chegada.
        // Independente do toast, que tem cooldown de 1,5 s logo abaixo.
        entities?.audio?.stopLoop(bridgeKey, { fade: .25 });
        entities?.audio?.play('mycorrhizaBridgeComplete', {
          x: structure.end.x,
          y: structure.end.y,
        });
        state.player.hope += 3;
        state.player.soil += 1.6;
        entities.burst(structure.end.x, structure.end.y, '#d6afff', 34, 175);
        if (state.time - lastToastAt > 1.5) {
          state.toast = 'Ponte micorrízica madura: o feixe hifal horizontal agora pode ser atravessado.';
          state.toastTime = 5;
          lastToastAt = state.time;
        }
      }
    }
    if (collisionDirty) rebuildCollisionPlatforms();
  }

  function drawPath(ctx, structure, visibleCount) {
    const points = structure.points.slice(0, Math.max(2, visibleCount));
    if (points.length < 2) return;
    const matureAlpha = structure.mature ? .92 : .34 + structure.maturity * .42;

    for (let strand = -1; strand <= 1; strand++) {
      ctx.strokeStyle = strand === 0
        ? `rgba(244,226,255,${matureAlpha})`
        : `rgba(182,137,232,${matureAlpha * .68})`;
      ctx.lineWidth = strand === 0 ? (structure.mature ? 3.4 : 2.2) : 1.3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      points.forEach((point, index) => {
        const previous = points[Math.max(0, index - 1)];
        const next = points[Math.min(points.length - 1, index + 1)];
        const angle = Math.atan2(next.y - previous.y, next.x - previous.x) + Math.PI / 2;
        const wave = Math.sin(index * 1.7 + structure.phase + strand) * (structure.mature ? 2.2 : 4.5);
        const x = point.x + Math.cos(angle) * (strand * 4 + wave);
        const y = point.y + Math.sin(angle) * (strand * 4 + wave);
        index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
  }

  function drawStructure(ctx, structure) {
    const segmentProgress = structure.progress * (structure.points.length - 1);
    const visibleCount = clamp(Math.ceil(segmentProgress) + 1, 2, structure.points.length);
    drawPath(ctx, structure, visibleCount);

    const visiblePoints = structure.points.slice(0, visibleCount);
    ctx.shadowBlur = structure.mature ? 16 : 9;
    ctx.shadowColor = '#d6afff';

    for (let i = 1; i < visiblePoints.length - 1; i++) {
      const point = visiblePoints[i];
      ctx.fillStyle = structure.mature ? '#ead3ff' : 'rgba(214,175,255,.45)';
      ctx.beginPath();
      ctx.arc(point.x, point.y, structure.mature ? 4.2 : 2.4, 0, TAU);
      ctx.fill();
    }

    const tip = visiblePoints[visiblePoints.length - 1];
    ctx.fillStyle = '#fff3ff';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 3.5 + Math.sin(state.time * 5 + structure.phase), 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (!structure.mature && Math.abs(structure.start.x - (state.cameraX + W / 2)) < W * .8) {
      const percent = Math.round((structure.progress * .72 + structure.maturity * .28) * 100);
      ctx.font = '700 10px Inter,system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f4e6ff';
      ctx.fillText(`ponte micorrízica ${percent}%`, structure.start.x, structure.start.y - 26);
    }
  }

  function render(ctx) {
    if (!structures.length) return;
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    for (const structure of structures) {
      if (structure.end.x < state.cameraX - 180 || structure.start.x > state.cameraX + W + 180) continue;
      drawStructure(ctx, structure);
    }
    ctx.restore();
  }

  return {
    setInoculants(next) { activeInoculants = next; },
    get structureCount() { return structures.length; },
    get matureCount() { return structures.filter(structure => structure.mature).length; },
    get growingCount() { return structures.filter(structure => !structure.mature).length; },
    get ladderCount() { return 0; },
    get bridgeCount() { return structures.filter(structure => structure.type === 'bridge').length; },
    get structures() { return structures; },
    clear,
    reset,
    update,
    render,
  };
}
