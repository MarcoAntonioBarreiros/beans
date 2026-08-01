import { W } from '../core/constants.js';
import { fxLanded } from '../game-audio.js';
import { createRandom } from './random.js';
import { getPrimaryTraversalPlatforms } from './traversal-route.js';
import { drawWorldLabel } from './world-label.js';
import { drawRootVisual } from './platform-visuals.js';

export const NITROGEN_ROOT_BLOCK_TYPE = 'underdeveloped-nitrogen-root';

const TAU = Math.PI * 2;
const PHASE_TWO_MAX_ORDINARY_GAP = 142;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

export function nitrogenRootVisualBounds(root, progress = root.progress) {
  const normalized = clamp(progress, 0, 1);
  return {
    x: root.x,
    y: root.y,
    w: lerp(root.startWidth, root.targetWidth, normalized),
    h: lerp(root.startHeight, root.targetHeight, normalized),
    rootBaseY: root.y,
  };
}

function routePlatforms(level) {
  return getPrimaryTraversalPlatforms(level)
    .filter(platform => !platform.encounterInstanceId);
}

// O gerador sorteia o tipo da plataforma: 75% raiz, 25% solo. Numa fase curta
// esse sorteio sozinho apaga o desafio-assinatura da fase — o portao da FBN
// simplesmente nao acha onde nascer. Promover uma plataforma de solo a raiz e
// gratuito (o tipo e visual) e e exatamente o assunto da fase.
function promotableToRoot(platform) {
  return Boolean(platform && platform.type === 'soil' && !platform.recovery);
}

function colonizableRoot(platform, allowPromotion = false) {
  if (allowPromotion && promotableToRoot(platform)) return colonizableRoot({ ...platform, type: 'root' });
  return Boolean(
    platform
    && platform.type === 'root'
    && !platform.mycorrhizaStructure
    && !platform.azospirillumStructure
    && !platform.azospirillumLadderHost
    && !platform.azospirillumLadderDestination
    // Portões de ponte e de parede, pela mesma razão que a escada já estava
    // nesta lista: a raiz nitrogenada REMOVE a plataforma-alvo, e remover o
    // alvo de uma ponte ou o hospedeiro de uma parede deixa o outro desafio
    // sem para onde ir. Dois portões no mesmo bloco não são um combo, são um
    // softlock.
    && !platform.bridgeGate
    && !platform.bridgeGateHost
    && !platform.phosphateWallGate
    && !platform.ascentGate
    && !platform.ascentGateHost
    && !platform.nitrogenRootCollider
    && !platform.fixedObjective
    && !platform.signatureChallenge
  );
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function occupiesPlatform(entity, platform) {
  if (Number.isInteger(entity?.logicIndex)) return entity.logicIndex === platform.logicIndex;
  return Number.isFinite(entity?.x) && entity.x >= platform.x && entity.x <= platform.x + platform.w;
}

function hasCriticalContent(level, encounters, platform, encountersAreMovable = false) {
  const collections = [
    level.exudates,
    level.crystals,
    level.enemies,
    level.allies,
    level.checkpoints,
  ];
  // Um encontro sobre o alvo normalmente descarta o lugar: apagar a plataforma
  // deixaria o microbio sem casa. Mas no ultimo recurso ele pode se mudar para a
  // raiz hospedeira — que e justamente onde o jogador precisa dele para nodular.
  if (!encountersAreMovable) collections.push(encounters);
  return collections.some(collection => (collection || []).some(entity => occupiesPlatform(entity, platform)));
}

function relocateEncounters(encounters, target, host) {
  for (const encounter of encounters || []) {
    if (!occupiesPlatform(encounter, target)) continue;
    encounter.logicIndex = host.logicIndex;
    if (Number.isFinite(encounter.x)) encounter.x = host.x + host.w / 2;
    if (Number.isFinite(encounter.y)) encounter.y = host.y - 26;
  }
}

function routeGapCandidates(level, encounters, route, firstExudate, allowPromotion = false) {
  const candidates = [];
  for (let routeIndex = 2; routeIndex < route.length - 1; routeIndex++) {
    const targetPlatform = route[routeIndex];
    if (
      !colonizableRoot(targetPlatform, allowPromotion)
      || hasCriticalContent(level, encounters, targetPlatform, allowPromotion)
    ) continue;

    const leftPlatform = route[routeIndex - 1];
    const rightPlatform = route[routeIndex + 1];
    // The source of the FBN must be visually unambiguous: the colonizable root
    // immediately before the missing route platform is always its host.
    const hostPlatform = leftPlatform;
    if (!colonizableRoot(hostPlatform, allowPromotion) || hostPlatform.logicIndex <= firstExudate) continue;

    const blockedGapWidth = rightPlatform.x - (leftPlatform.x + leftPlatform.w);
    const leftLandingGap = targetPlatform.x - (leftPlatform.x + leftPlatform.w);
    const rightLandingGap = rightPlatform.x - (targetPlatform.x + targetPlatform.w);
    if (
      blockedGapWidth <= PHASE_TWO_MAX_ORDINARY_GAP
      || leftLandingGap > PHASE_TWO_MAX_ORDINARY_GAP
      || rightLandingGap > PHASE_TWO_MAX_ORDINARY_GAP
    ) continue;
    candidates.push({
      hostPlatform,
      targetPlatform,
      leftPlatform,
      rightPlatform,
      blockedGapWidth,
      leftLandingGap,
      rightLandingGap,
    });
  }
  return candidates;
}

function removeGapPlatforms(level, slot) {
  const gapStart = slot.leftPlatform.x + slot.leftPlatform.w;
  const gapEnd = slot.rightPlatform.x;
  level.platforms = (level.platforms || []).filter(platform => {
    if (platform === slot.targetPlatform) return false;
    if (!platform.recovery) return true;
    const center = platform.x + platform.w / 2;
    return center <= gapStart || center >= gapEnd;
  });
}

export function generateUnderdevelopedNitrogenRoots({
  level,
  phase,
  seedValue,
  encounters = [],
  config,
} = {}) {
  level.nitrogenRoots = [];
  if (phase < 2 || !config?.enabled || config.count <= 0) return level.nitrogenRoots;

  const rhizobiumIndexes = encounters
    .filter(encounter => encounter.id === 'rhizobium' && Number.isInteger(encounter.logicIndex))
    .map(encounter => encounter.logicIndex)
    .sort((left, right) => left - right);
  if (!rhizobiumIndexes.length) return level.nitrogenRoots;

  const firstRhizobium = rhizobiumIndexes[0];
  const exudateIndexes = (level.exudates || [])
    .filter(exudate => Number.isInteger(exudate.logicIndex) && exudate.logicIndex > firstRhizobium)
    .map(exudate => exudate.logicIndex)
    .sort((left, right) => left - right);
  if (!exudateIndexes.length) return level.nitrogenRoots;

  const firstExudate = exudateIndexes[0];
  const route = routePlatforms(level);

  // TRIOS CONSTRUIDOS PELA ROTA
  // ---------------------------
  // Medindo por que cada posicao era recusada, em 16 seeds da fase 10: o vao
  // nunca reprovou (0), mas o conteudo sobre a plataforma-alvo reprovou 393
  // vezes e o tipo dela 322. A busca dependia de um trio ACIDENTAL — esquerda,
  // alvo, direita com as tres distancias certas e nada em cima —, e por isso a
  // FBN saia uma vez por fase por mais que `count` subisse.
  //
  // Quando o plano PEDE o portao, o gerador constroi o trio: e o mesmo
  // tratamento que a escada, a ponte e a parede ja tinham. A busca continua
  // existindo para as fases que nao pedem, e para completar o que faltar.
  const authoredSlots = [];
  for (const gate of level.routeGates || []) {
    if (gate.kind !== 'nitrogenRootGate' || !gate.rightPlatform) continue;
    const hostPlatform = gate.host;
    const targetPlatform = gate.destination;
    const rightPlatform = gate.rightPlatform;
    if (!hostPlatform || !targetPlatform || !rightPlatform) continue;
    if (hostPlatform.logicIndex <= firstExudate) continue;
    const blockedGapWidth = rightPlatform.x - (hostPlatform.x + hostPlatform.w);
    if (blockedGapWidth <= PHASE_TWO_MAX_ORDINARY_GAP) continue;
    // Encontro em cima do alvo se muda para o hospedeiro, que e onde o jogador
    // precisa dele para nodular.
    relocateEncounters(encounters, targetPlatform, hostPlatform);
    authoredSlots.push({
      hostPlatform,
      targetPlatform,
      leftPlatform: hostPlatform,
      rightPlatform,
      blockedGapWidth,
      leftLandingGap: targetPlatform.x - (hostPlatform.x + hostPlatform.w),
      rightLandingGap: rightPlatform.x - (targetPlatform.x + targetPlatform.w),
      authored: true,
    });
  }
  // Primeiro tenta so onde o sorteio ja pos raiz. So promove solo a raiz se a
  // fase inteira nao oferecer nenhum lugar — assim a variacao entre seeds
  // continua existindo, mas o portao da FBN nunca some.
  //
  // MEDIDO, em 16 seeds da fase 10 com count=3, contando POR QUE cada posicao
  // da rota foi recusada:
  //
  //   alvo com conteudo em cima (exsudato, encontro, inimigo)  393
  //   alvo nao e raiz (o gerador sorteia 25% de solo)          322
  //   pouso esquerdo longe demais                               77
  //   hospedeiro nao colonizavel                                62
  //   antes do primeiro exsudato                                43
  //   pouso direito longe demais                                28
  //   vao estreito demais                                        0
  //   ACEITO                                                    10
  //
  // O vao nunca foi o problema. Quem recusa e o conteudo sobre a plataforma e
  // o sorteio do tipo — e a promocao de solo a raiz, que resolve os dois
  // (`allowPromotion` tambem deixa o encontro se mudar para a raiz
  // hospedeira), so era tentada quando a fase inteira nao oferecia NENHUM
  // lugar. Como quase sempre havia um, ela nunca rodava: dai o portao unico.
  //
  // Onde a fase pede mais de um portao, a promocao entra desde o inicio. Na
  // estreia (fase 2, count 1) o comportamento continua sendo o de antes:
  // primeiro o que o sorteio ja deu, promocao so em ultimo caso.
  const wantsMany = config.count > 1;
  let promoted = wantsMany;
  let candidates = routeGapCandidates(level, encounters, route, firstExudate, wantsMany);
  if (!candidates.length && !promoted) {
    promoted = true;
    candidates = routeGapCandidates(level, encounters, route, firstExudate, true);
  }
  if (!candidates.length && !authoredSlots.length) return level.nitrogenRoots;

  const random = createRandom(`${seedValue}:nitrogen-root:p${phase}`);
  const orderedCandidates = [...candidates].sort((left, right) => (
    left.targetPlatform.logicIndex - right.targetPlatform.logicIndex
    || left.targetPlatform.x - right.targetPlatform.x
  ));
  // Keep seed-based variation, but only among the first valid route slots. This
  // prevents the teaching mechanic from being hidden near the end of the phase.
  //
  // A restricao existe para a ESTREIA: na fase 2 a FBN e o que a fase ensina, e
  // esconde-la no fim seria esconder a aula. Onde ela pede mais de um portao
  // ja nao e estreia — e um desafio entre quatro, e limita-la ao comeco da rota
  // era o que a fazia aparecer uma vez so mesmo com `count` maior.
  const candidateWindow = config.count > 1
    ? orderedCandidates
    : orderedCandidates.slice(0, Math.min(
        orderedCandidates.length,
        Math.max(4, config.count * 4),
      ));
  // Os trios construidos entram primeiro e sem sorteio: a rota ja decidiu onde
  // eles ficam.
  const selected = [...authoredSlots];
  for (const candidate of shuffled(candidateWindow, random)) {
    if (selected.some(existing => Math.abs(existing.targetPlatform.logicIndex - candidate.targetPlatform.logicIndex) < 3)) continue;
    selected.push(candidate);
    if (selected.length >= Math.min(config.count, authoredSlots.length + candidates.length)) break;
  }
  level.nitrogenRoots = selected.map((slot, index) => {
    const { hostPlatform, targetPlatform, leftPlatform, rightPlatform } = slot;
    // Só o par escolhido vira raiz, e só quando não havia alternativa sorteada.
    if (promoted && !slot.authored) {
      if (promotableToRoot(hostPlatform)) hostPlatform.type = 'root';
      if (promotableToRoot(targetPlatform)) targetPlatform.type = 'root';
      relocateEncounters(encounters, targetPlatform, hostPlatform);
    }
    const startWidth = clamp(Math.round(targetPlatform.w * .45), 64, 92);
    const startHeight = 12;
    removeGapPlatforms(level, slot);
    return {
      id: `nitrogen-root-${targetPlatform.logicIndex}-${index}`,
      blockType: NITROGEN_ROOT_BLOCK_TYPE,
      hostPlatform,
      hostLogicIndex: hostPlatform.logicIndex,
      targetPlatform,
      targetLogicIndex: targetPlatform.logicIndex,
      leftPlatform,
      rightPlatform,
      blockedGapWidth: slot.blockedGapWidth,
      leftLandingGap: slot.leftLandingGap,
      rightLandingGap: slot.rightLandingGap,
      sourceRhizobiumLogicIndex: firstRhizobium,
      sourceExudateLogicIndex: firstExudate,
      x: targetPlatform.x,
      y: targetPlatform.y,
      rootBaseY: targetPlatform.y,
      startWidth,
      startHeight,
      targetWidth: targetPlatform.w,
      targetHeight: targetPlatform.h,
      currentWidth: startWidth,
      currentHeight: startHeight,
      progress: 0,
      functionalProgress: 0,
      stage: 'underdeveloped',
      developed: false,
      paused: false,
      requiredFixationRate: config.requiredFixationRate,
      growthDurationSeconds: config.growthDurationSeconds,
      phase: random() * TAU,
      collider: null,
      activeSite: null,
      announced: false,
      // Marca de áudio própria: independente do toast (que tem cooldown).
      audioCompleted: false,
    };
  });
  return level.nitrogenRoots;
}

function removeCollider(state, root) {
  if (!root.collider) return;
  const index = (state.level.platforms || []).indexOf(root.collider);
  if (index >= 0) state.level.platforms.splice(index, 1);
  root.collider = null;
}

function updateCollider(state, root) {
  const fullyDeveloped = root.developed && root.progress >= 1;
  root.functionalProgress = fullyDeveloped ? 1 : 0;
  if (!fullyDeveloped) {
    removeCollider(state, root);
    return;
  }
  if (!root.collider) {
    root.collider = {
      ...root.targetPlatform,
      type: 'root',
      nitrogenRootCollider: true,
      nitrogenRootId: root.id,
      logicIndex: root.targetLogicIndex,
      rootHealth: 1,
      rootMaxHealth: 1,
      supportIntegrity: 1,
    };
    state.level.platforms.push(root.collider);
  }
  const bounds = nitrogenRootVisualBounds(root, 1);
  Object.assign(root.collider, {
    ...bounds,
    oneWay: false,
    mature: true,
  });
}

function associatedNodule(state, root) {
  return (state.level.rhizobiumNodules || []).find(site => site.platform === root.hostPlatform) || null;
}

export function createNitrogenRootDevelopment({ state, entities = null } = {}) {
  function clear() {
    entities?.audio?.stopGroup('nitrogen-root-growth');
    for (const root of state.level.nitrogenRoots || []) removeCollider(state, root);
    state.level.nitrogenRoots = [];
  }

  function reset() {
    entities?.audio?.stopGroup('nitrogen-root-growth');
    for (const root of state.level.nitrogenRoots || []) {
      removeCollider(state, root);
      root.audioCompleted = false;
      root.progress = 0;
      root.functionalProgress = 0;
      root.currentWidth = root.startWidth;
      root.currentHeight = root.startHeight;
      root.stage = 'underdeveloped';
      root.developed = false;
      root.paused = false;
      root.activeSite = null;
      root.announced = false;
    }
  }

  function updateRoot(root, dt) {
    if (root.developed) {
      root.progress = 1;
      const bounds = nitrogenRootVisualBounds(root, 1);
      root.currentWidth = bounds.w;
      root.currentHeight = bounds.h;
      updateCollider(state, root);
      return;
    }

    const site = associatedNodule(state, root);
    root.activeSite = site;
    const mature = Boolean(site?.mature || site?.stage === 'mature-nodule');
    const fixationActive = mature && (site.fixationRate || 0) >= root.requiredFixationRate;
    root.paused = root.progress > 0 && !fixationActive;
    const audio = entities?.audio;
    const loopKey = `nitrogen-root:${root.id}`;

    if (!fixationActive) {
      // Nódulo maduro não basta: sem taxa suficiente a raiz não cresce, e o som
      // não pode dizer que cresce. Pausa em vez de parar — retomar do começo a
      // cada oscilação da FBN soaria como um defeito.
      if (root.progress > 0) audio?.pauseLoop(loopKey);
      updateCollider(state, root);
      return;
    }

    const wasStarted = root.progress > 0;
    // Crescimento realmente em curso: um loop por raiz, sustentado por quadro.
    audio?.startLoop(loopKey, 'nitrogenRootGrowth', {
      // A chave é por raiz; o grupo de vozes é o do processo (o teto e a
      // prioridade do manifesto usam `nitrogen-root-growth`).
      group: 'nitrogen-root-growth',
      x: root.x + root.targetWidth / 2,
      y: root.y,
      gain: .60 + root.progress * .40,
      rate: .92 + root.progress * .14,
    });
    root.progress = clamp(root.progress + dt / Math.max(.1, root.growthDurationSeconds), 0, 1);
    const bounds = nitrogenRootVisualBounds(root);
    root.currentWidth = bounds.w;
    root.currentHeight = bounds.h;
    root.stage = root.progress < .22
      ? 'receiving-nitrogen'
      : root.progress < 1 ? 'growing' : 'developed';
    root.developed = root.progress >= 1;
    root.paused = false;
    updateCollider(state, root);

    if (!wasStarted) entities?.burst?.(site.x, site.surfaceY + site.depth, '#ffd783', 18, 75);
    // Conclusão: transição developed false → true, uma vez, com marca própria —
    // não a do toast, que tem cooldown e poderia engolir o som.
    if (root.developed && !root.audioCompleted) {
      audio?.stopLoop(loopKey);
      // So marca depois de o pedido ser aceito. Se o arquivo ainda nao estava
      // carregado e o pedido foi RECUSADO, a marca ficaria gravada e a conclusao
      // desta raiz nunca mais teria som.
      const entregue = audio ? fxLanded(audio.play('nitrogenRootComplete', {
        x: root.x + root.targetWidth / 2,
        y: root.y,
        instanceId: root.id,
      })) : true;
      if (entregue) root.audioCompleted = true;
    }
    if (root.developed && !root.announced) {
      root.announced = true;
      state.toast = 'FBN ativa: o nitrogenio sustentou o desenvolvimento de uma nova plataforma radicular.';
      state.toastTime = 4.8;
      entities?.burst?.(root.x + root.targetWidth * .65, root.y, '#d9c48b', 34, 120);
    }
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    for (const root of state.level.nitrogenRoots || []) updateRoot(root, dt);
  }

  function drawRoot(ctx, root) {
    const progress = clamp(root.progress, 0, 1);
    const bounds = nitrogenRootVisualBounds(root, progress);
    const width = bounds.w;
    const height = bounds.h;

    ctx.save();
    ctx.lineCap = 'round';

    if (!root.developed || progress < 1) {
      drawRootVisual(ctx, {
        ...bounds,
        type: 'root',
        rootHealth: 1,
      });

      ctx.save();
      ctx.strokeStyle = progress > 0 ? '#98e287' : 'rgba(255,211,111,.85)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.roundRect(bounds.x, bounds.y, bounds.w, bounds.h, 15);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (progress > .38) {
      const hairProgress = clamp((progress - .38) / .62, 0, 1);
      const count = Math.floor(2 + hairProgress * 11);
      ctx.strokeStyle = `rgba(230,218,185,${.24 + hairProgress * .52})`;
      ctx.lineWidth = 1;
      for (let index = 0; index < count; index++) {
        const x = bounds.x + 14 + (index + .5) / count * Math.max(8, width - 28);
        const direction = index % 2 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(x, bounds.y + height - 2);
        ctx.quadraticCurveTo(
          x + direction * 6,
          bounds.y + height + 8,
          x + direction * 10,
          bounds.y + height + 15 + (index % 3) * 3,
        );
        ctx.stroke();
      }
    }

    const site = root.activeSite;
    if (site?.mature && (site.fixationRate || 0) >= root.requiredFixationRate && !root.developed) {
      const sourceX = site.x;
      const sourceY = site.surfaceY + site.depth;
      const targetX = bounds.x + Math.min(width * .58, root.targetWidth * .52);
      const targetY = bounds.y + height * .42;
      const distance = Math.max(80, targetX - sourceX);
      const controlOne = { x: sourceX + distance * .28, y: sourceY - 48 };
      const controlTwo = { x: targetX - distance * .24, y: targetY - 34 };
      const bezierPoint = (start, controlA, controlB, end, travel) => {
        const inverse = 1 - travel;
        return inverse ** 3 * start
          + 3 * inverse ** 2 * travel * controlA
          + 3 * inverse * travel ** 2 * controlB
          + travel ** 3 * end;
      };
      for (let index = 0; index < 9; index++) {
        const travel = (state.time * .42 + index / 9 + root.phase) % 1;
        const x = bezierPoint(sourceX, controlOne.x, controlTwo.x, targetX, travel);
        const y = bezierPoint(sourceY, controlOne.y, controlTwo.y, targetY, travel);
        const visibility = Math.sin(travel * Math.PI);
        ctx.globalAlpha = .2 + .8 * visibility;
        ctx.fillStyle = index % 2 ? '#ffd783' : '#8db8ff';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, 3.2 + (index % 2) * 1.2, 0, TAU);
        ctx.fill();
        if (index % 3 === 0 && travel > .12 && travel < .88) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#fff3c4';
          ctx.font = '800 8px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('N', x, y - 9);
        }
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    if (!root.developed) {
      const percent = Math.round(progress * 100);
      const label = progress > 0
        ? `Raiz recebendo N · ${percent}%`
        : 'Raiz subdesenvolvida · forme o nódulo na raiz anterior';
      drawWorldLabel(ctx, root.x + root.targetWidth / 2, root.y - 20, label, {
        color: progress > 0 ? '#a8f0ea' : '#ffd36f',
        font: '800 12px Inter,system-ui',
        glow: 12,
      });
    }
    ctx.restore();
  }

  function render(ctx) {
    const roots = state.level.nitrogenRoots || [];
    if (!roots.length) return;
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    for (const root of roots) {
      if (root.x + root.currentWidth < state.cameraX - 100 || root.x > state.cameraX + W + 100) continue;
      drawRoot(ctx, root);
    }
    ctx.restore();
  }

  return {
    clear,
    reset,
    update,
    render,
    get rootCount() { return (state.level.nitrogenRoots || []).length; },
    get developedCount() { return (state.level.nitrogenRoots || []).filter(root => root.developed).length; },
    get growingCount() { return (state.level.nitrogenRoots || []).filter(root => root.progress > 0 && !root.developed).length; },
  };
}
