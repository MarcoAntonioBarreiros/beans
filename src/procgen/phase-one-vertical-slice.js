import { getPhaseManifest } from './campaign-manifest.js';
import { drawWorldLabel } from './world-label.js';

const BLOCK_LAYOUTS = Object.freeze({
  'phase1-intro-v1': Object.freeze({
    roles: ['coleta', 'gradiente', 'encontro', 'inoculacao', 'observacao'],
    yOffsets: [0, -24, -42, -12, 8],
    targetChunk: 7,
    targetId: 'p1-intro-root',
    exudateChunks: [4, 5, 7],
  }),
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function mainPlatform(level, logicIndex) {
  return (level.platforms || []).find(platform => (
    !platform.recovery && !platform.final && platform.logicIndex === logicIndex
  ));
}

function authorGeometry(level, segment, template) {
  const platforms = [];
  for (let chunk = segment.from; chunk <= segment.to; chunk++) {
    const platform = mainPlatform(level, chunk);
    if (!platform) throw new Error(`${segment.id}: plataforma principal ausente no chunk ${chunk}.`);
    platforms.push(platform);
  }

  const left = platforms[0].x;
  const right = platforms[platforms.length - 1].x + platforms[platforms.length - 1].w;
  const slot = (right - left) / platforms.length;
  const startY = platforms[0].y;
  const endY = platforms[platforms.length - 1].y;

  platforms.forEach((platform, index) => {
    const progress = index / Math.max(1, platforms.length - 1);
    const authoredOffset = index === 0 || index === platforms.length - 1
      ? 0
      : template.yOffsets[index] * .15;
    platform.x = left + slot * index;
    platform.y = clamp(startY + (endY - startY) * progress + authoredOffset, 285, 545);
    platform.w = index === platforms.length - 1
      ? right - platform.x
      : Math.max(122, slot - 58);
    platform.h = 64;
    platform.type = 'root';
    platform.authored = true;
    platform.fixedBlockId = segment.id;
    platform.fixedRole = template.roles[index];
  });

  const target = mainPlatform(level, template.targetChunk);
  if (template.targetId) {
    target.objectiveTarget = template.targetId;
    target.fixedObjective = true;
  }

  const last = platforms[platforms.length - 1];
  const next = mainPlatform(level, segment.to + 1);
  const gateX = next
    ? last.x + last.w + Math.max(26, (next.x - (last.x + last.w)) / 2)
    : last.x + last.w + 39;

  return {
    platforms,
    target,
    startX: platforms[0].x,
    endX: last.x + last.w,
    gateX,
  };
}

function addAuthoredExudates(level, chunks) {
  for (const chunk of chunks) {
    const platform = mainPlatform(level, chunk);
    if (!platform) continue;
    level.exudates.push({
      logicIndex: chunk,
      x: platform.x + platform.w * .5,
      y: platform.y - 34,
      taken: false,
      authored: true,
    });
  }
}

export function applyPhaseOneVerticalSlice(level, phase = level.campaignPhase) {
  if (phase !== 1) return level;
  const manifest = getPhaseManifest(1);
  const authoredSegments = manifest.segments.filter(segment => segment.fixedBlock);

  level.fixedBlocks = [];
  level.authoredEncounters = [];
  // Na primeira fase, o primeiro biofilme deve ser uma ação do jogador.
  // Checkpoints procedurais criavam biofilmes naturais e antecipavam Bacillus.
  level.checkpoints = [];
  level.platforms = level.platforms.filter(platform => (
    !platform.recovery
    || !authoredSegments.some(segment => platform.logicIndex >= segment.from && platform.logicIndex <= segment.to)
  ));
  level.exudates = (level.exudates || []).filter(exudate => (
    Number.isInteger(exudate.logicIndex)
    && exudate.logicIndex >= 9
    && !authoredSegments.some(segment => exudate.logicIndex >= segment.from && exudate.logicIndex <= segment.to)
  ));

  for (const segment of authoredSegments) {
    const template = BLOCK_LAYOUTS[segment.fixedBlock.template];
    if (!template) throw new Error(`${segment.id}: template fixo desconhecido ${segment.fixedBlock.template}.`);
    const geometry = authorGeometry(level, segment, template);
    addAuthoredExudates(level, template.exudateChunks);
    const completion = segment.fixedBlock.completionRef === 'finalTest'
      ? manifest.finalTest.requires
      : segment.fixedBlock.completion;
    const recoveryPlatform = segment.id === 'p1-intro'
      ? geometry.platforms[geometry.platforms.length - 1]
      : null;
    if (recoveryPlatform) {
      recoveryPlatform.checkpointRecoveryBridge = true;
      level.platforms = level.platforms.filter(platform => platform !== recoveryPlatform);
    }
    level.fixedBlocks.push({
      id: segment.id,
      kind: segment.kind,
      template: segment.fixedBlock.template,
      objective: segment.fixedBlock.objective,
      completion: completion.map(condition => ({ ...condition })),
      exitGate: segment.fixedBlock.exitGate === true,
      startX: geometry.startX,
      endX: geometry.endX,
      gateX: geometry.gateX,
      targetPlatform: geometry.target,
      recoveryPlatform,
      recoveryPlatformUnlocked: !recoveryPlatform,
      completed: false,
    });
    for (let chunk = segment.from; chunk <= segment.to; chunk++) {
      if (level.debugInfo?.[chunk]) {
        level.debugInfo[chunk].authored = true;
        level.debugInfo[chunk].fixedBlockId = segment.id;
      }
    }
  }

  return level;
}

export function createFixedBlockRuntime({ state, evaluator, entities, ecology = null }) {
  let lastBlockedAt = -Infinity;

  function activeBlocks() {
    return state.level.fixedBlocks || [];
  }

  function missingText(block, result) {
    const missing = result.results.find(entry => !entry.passed);
    if (!missing) return '';
    if (missing.condition.key === 'deployedExudateCount') return 'libere pelo menos um exsudato com E';
    if (missing.condition.key === 'functionalBiofilmCount') {
      return block.kind === 'final'
        ? 'volte à raiz da prova com halo amarelo e forme o biofilme nela'
        : 'volte à raiz de treinamento com halo amarelo e inocule Bacillus nela';
    }
    return 'complete o objetivo ecológico indicado';
  }

  // A raiz de saida do bloco autoral (chunk final de p1-intro) e retirada do
  // array na geracao e devolvida AQUI, quando o modulo e concluido.
  //
  // Antes ela so voltava numa situacao muito especifica (morrer depois do
  // checkpoint e renascer sobre o alvo). Numa partida sem morte o chunk ficava
  // ausente e o vao de ~415px entre a saida do bloco e a plataforma seguinte era
  // intransponivel — quem cobria isso silenciosamente era o degrau global
  // `safetyStep`, que agora nao existe mais. O portao passa a ser resolvido pela
  // propria mecanica da fase: concluiu o modulo, a raiz de saida cresce.
  function unlockRecoveryPlatform(block, mensagem) {
    if (!block.recoveryPlatform || block.recoveryPlatformUnlocked) return;
    block.recoveryPlatformUnlocked = true;
    block.recoveryPlatformPending = false;
    if (!state.level.platforms.includes(block.recoveryPlatform)) {
      state.level.platforms.push(block.recoveryPlatform);
      state.level.platforms.sort((left, right) => left.x - right.x);
    }
    if (mensagem) {
      state.toast = mensagem;
      state.toastTime = 5.2;
    }
    entities.burst(
      block.recoveryPlatform.x + block.recoveryPlatform.w / 2,
      block.recoveryPlatform.y - 18,
      '#ffd56f',
      30,
      145,
    );
  }

  function completeBlock(block) {
    block.completed = true;
    block.completedAt = state.time;
    block.deathsAtCompletion = state.player.deaths || 0;
    block.targetPlatform.fixedObjective = false;
    unlockRecoveryPlatform(block, null);
    state.toast = block.kind === 'final'
      ? 'Prova final concluída: a raiz de saída recebeu um biofilme funcional.'
      : 'Módulo concluído: recrutamento, inoculação e biofilme confirmados.';
    state.toastTime = 5.2;
    entities.burst(block.gateX, block.targetPlatform.y - 70, '#8ff2c1', 34, 150);
  }

  function checkpointIsOnTarget(block) {
    const checkpoint = state.currentCheckpoint;
    if (!checkpoint) return false;
    const checkpointX = checkpoint.x + state.player.w / 2;
    return checkpointX >= block.targetPlatform.x - 80
      && checkpointX <= block.targetPlatform.x + block.targetPlatform.w + 80;
  }

  function updateRecoveryPlatformAfterRespawn(block) {
    if (!block.recoveryPlatform || block.recoveryPlatformUnlocked || !block.completed) return;
    const diedAfterCheckpoint = (state.player.deaths || 0) > (block.deathsAtCompletion || 0);
    const failedBeyondCheckpoint = state.player.x > block.targetPlatform.x + block.targetPlatform.w + 24;
    if (
      !block.recoveryPlatformPending
      && state.gameState === 'respawning'
      && diedAfterCheckpoint
      && failedBeyondCheckpoint
      && checkpointIsOnTarget(block)
    ) {
      block.recoveryPlatformPending = true;
      return;
    }

    if (!block.recoveryPlatformPending || state.gameState !== 'play' || !state.player.alive) return;
    const checkpoint = state.currentCheckpoint;
    const respawnedAtCheckpoint = checkpoint
      && Math.hypot(state.player.x - checkpoint.x, state.player.y - checkpoint.y) < 110;
    if (!respawnedAtCheckpoint || !checkpointIsOnTarget(block)) return;

    unlockRecoveryPlatform(
      block,
      'Checkpoint demonstrado: uma raiz de apoio surgiu para a segunda tentativa.',
    );
  }

  function holdAtGate(block, result) {
    const player = state.player;
    const right = player.x + player.w;
    if (!block.exitGate || block.completed || right <= block.gateX) return;
    player.x = block.gateX - player.w - 2;
    player.vx = Math.min(0, player.vx);
    if (state.time - lastBlockedAt < 2.4) return;
    lastBlockedAt = state.time;
    state.toast = `Saída bloqueada: ${missingText(block, result)}.`;
    state.toastTime = 4.2;
  }

  function update() {
    for (const block of activeBlocks()) updateRecoveryPlatformAfterRespawn(block);
    if (state.gameState !== 'play') return;
    const centerX = state.player.x + state.player.w / 2;
    for (const block of activeBlocks()) {
      const result = evaluator.evaluate(block.completion);
      if (!block.completed && result.passed) completeBlock(block);
      holdAtGate(block, result);
      if (centerX >= block.startX - 260 && centerX <= block.gateX + 80) {
        state.mission = block.completed
          ? `${block.objective} Objetivo concluído; prossiga.`
          : centerX > block.targetPlatform.x + block.targetPlatform.w
            ? `${block.objective} ← Volte à raiz com halo amarelo.`
            : block.objective;
      }
    }
  }

  function hasRecruitedBacillus() {
    return (ecology?.agents || []).some(agent => (
      agent.type === 'bacillus'
      && (agent.beneficialRecruitedUntil || 0) > state.time
    ));
  }

  function hasPlacedBacillus() {
    return (state.level.beneficialColonies || []).some(colony => colony.type === 'bacillus')
      || (state.level.biofilms || []).some(film => film.platform?.objectiveTarget === 'p1-intro-root');
  }

  // A tentativa anterior usava um gradiente radial pintado num fillRect: como o
  // raio era calculado pela largura do texto, o topo e a base do retangulo eram
  // cortados no meio do gradiente e apareciam como uma faixa escura de aresta
  // dura — a mesma caixa quadrada de antes, so que pior. Agora e so texto com
  // glow, igual ao nome das colonias.
  function drawGuidance(ctx, x, y, label, color = '#ffd56f') {
    drawWorldLabel(ctx, x, y, label, {
      color: color === '#ffd56f' ? '#ffe58f' : color,
      font: '900 15px Inter,system-ui',
      glow: 14,
    });
  }

  function render(ctx) {
    ctx.save();
    ctx.translate(-(state.cameraX || 0), 0);
    for (const block of activeBlocks()) {
      if (block.id === 'p1-intro' && !block.completed) {
        const bacillusKnown = state.discoveredMicrobes?.has('bacillus');
        const recruited = hasRecruitedBacillus();
        const placed = hasPlacedBacillus();
        const debut = (ecology?.encounters || []).find(encounter => (
          encounter.source === 'debut'
          && encounter.id === 'bacillus'
          && encounter.logicIndex === 6
        ));
        if (bacillusKnown && !recruited && !placed && debut) {
          drawGuidance(
            ctx,
            debut.x,
            debut.y + 88,
            '↓ LANCE O EXSUDATO PARA RECRUTAR BACILLUS AQUI',
          );
        }
      }

      const target = block.targetPlatform;
      if (!target?.objectiveTarget || block.completed) continue;
      if (block.id === 'p1-intro' && !hasRecruitedBacillus() && !hasPlacedBacillus()) continue;
      const x = target.x + target.w / 2;
      const y = target.y - 72;
      const label = block.kind === 'final'
        ? '↓ ALVO DA PROVA — FORME O BIOFILME AQUI'
        : '↓ ALVO DA FASE — INOCULE BACILLUS AQUI';
      drawGuidance(ctx, x, y, label);
    }
    ctx.restore();
  }

  function finalBlockCompleted() {
    const block = activeBlocks().find(candidate => candidate.kind === 'final');
    return !block || block.completed;
  }

  return { update, render, finalBlockCompleted };
}
