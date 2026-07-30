import { W } from '../core/constants.js';
import { getTutorialModeAt, tutorialPacing } from './campaign-manifest.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const TUTORIAL_RUNTIME_VERSION = '2026.07.23.1';
export const TUTORIAL_SIMULTANEOUS_FIRST_ENCOUNTERS_EVENT =
  tutorialPacing.simultaneousFirstEncountersEventName;

export const TUTORIAL_PROXIMITY = Object.freeze({
  microbeAgent: 220,
  microbeCommunity: 210,
  organism: 280,
  structure: 300,
  rootProcess: 320,
});

const discoveryCards = {
  rhizobium: 'organism-rhizobium',
  azospirillum: 'organism-azospirillum',
  myco: 'organism-mycorrhiza',
  bacillus: 'organism-bacillus',
  pseudomonas: 'organism-pseudomonas',
  trichoderma: 'organism-trichoderma',
  phos: 'organism-phosphate-solubilizer',
  oportunista: 'organism-opportunistic-fungus',
};

export function createTutorialTriggers({
  state,
  sim,
  manager,
  ralstoniaControl,
  trichodermaRhizoctoniaControl,
}) {
  let lastCheckAt = -Infinity;
  let resumeDelayUntil = 0;
  let lastUnexpectedFirstAppearance = null;
  let lastSimultaneousFirstEncounters = null;
  let knownPhase = null;

  function conditionSnapshot() {
    return {
      exudate: (state.player.exudates || 0) > 0,
      inoculation: sim.beneficialInoculants.followerCount > 0
        || sim.trichodermaColonies.followerCount > 0,
      doubleJump: Boolean(state.player.canDoubleJump),
      dash: Boolean(state.player.canDash),
      phosphateSolubilization: Boolean(state.player.canPhosphateSolubilization),
    };
  }

  let previousConditions = conditionSnapshot();

  window.addEventListener('miguelito:tutorial-close', () => {
    resumeDelayUntil = performance.now() + 520;
  });
  window.addEventListener(tutorialPacing.diagnosticEventName, event => {
    lastUnexpectedFirstAppearance = event.detail || null;
  });
  window.addEventListener(TUTORIAL_SIMULTANEOUS_FIRST_ENCOUNTERS_EVENT, event => {
    lastSimultaneousFirstEncounters = event.detail || null;
  });

  function playerPoint() {
    return {
      x: state.player.x + state.player.w / 2,
      y: state.player.y + state.player.h / 2,
    };
  }

  function distanceToPlayer(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
    const player = playerPoint();
    return Math.hypot(x - player.x, y - player.y);
  }

  function nearPoint(x, y, radius = 520) {
    return distanceToPlayer(x, y) <= radius;
  }

  function nearPlatform(platform, radius = 560) {
    return distanceToPlatform(platform) <= radius;
  }

  function distanceToPlatform(platform) {
    if (!platform) return Infinity;
    const player = playerPoint();
    const x = clamp(player.x, platform.x, platform.x + platform.w);
    const y = platform.y;
    return Math.hypot(x - player.x, y - player.y);
  }

  function currentChunkIndex() {
    let chunkIndex = -1;
    for (const platform of state.level.platforms || []) {
      if (!platform.recovery && !platform.final && state.player.x >= platform.x) {
        chunkIndex = Math.max(chunkIndex, platform.logicIndex ?? -1);
      }
    }
    return Math.max(0, chunkIndex);
  }

  function tutorialContext(extra = {}) {
    const phase = Number.isInteger(state.campaign?.phase)
      ? state.campaign.phase
      : Number.isInteger(state.level.campaignPhase) ? state.level.campaignPhase : 1;
    const chunkIndex = currentChunkIndex();
    return {
      phase,
      chunkIndex,
      tutorialMode: getTutorialModeAt(phase, chunkIndex),
      worldX: playerPoint().x,
      visibleWorldWidth: (state.viewportWidth || W) / Math.max(0.1, state.cameraZoom || 1),
      nowSeconds: performance.now() / 1000,
      ...extra,
    };
  }

  function trigger(id, condition, extra = {}) {
    return Boolean(condition && manager.trigger(id, tutorialContext(extra)));
  }

  // Cada fase entra assumindo o que as anteriores já ensinaram. Roda na criação
  // e a cada troca de fase, sem depender do primeiro quadro do loop.
  function syncPhaseKnowledge() {
    const phase = state.campaign?.phase;
    if (!Number.isInteger(phase) || phase === knownPhase) return;
    knownPhase = phase;
    manager.syncPriorKnowledge?.(phase);
  }

  syncPhaseKnowledge();

  function organismCandidates() {
    const candidatesByCard = new Map();

    function addCandidate(cardId, distance, extra = {}) {
      if (!cardId || manager.hasSeen(cardId) || !Number.isFinite(distance)) return;
      const current = candidatesByCard.get(cardId);
      if (!current || distance < current.distance) {
        candidatesByCard.set(cardId, { cardId, distance, ...extra });
      }
    }

    for (const agent of sim.ecology.agents || []) {
      const cardId = discoveryCards[agent.type];
      const originZone = sim.ecology.encounters?.[agent.zoneIndex];
      // Enquanto uma estreia móvel ainda é inédita e está presa à sua zona,
      // a proximidade deve ser medida pelo centro visível da comunidade. Um
      // indivíduo na borda não pode antecipar o cartão para o chunk anterior.
      if (
        originZone?.source === 'debut'
        && originZone.tetherUntilSeen
        && cardId
        && !manager.hasSeen(cardId)
      ) continue;
      const distance = distanceToPlayer(agent.x, agent.y);
      if (distance > TUTORIAL_PROXIMITY.microbeAgent) continue;
      addCandidate(cardId, distance, { type: agent.type, source: 'agent' });
    }

    for (const zone of sim.ecology.encounters || []) {
      const cardId = discoveryCards[zone.id];
      const distance = distanceToPlayer(zone.x, zone.y);
      if (distance > TUTORIAL_PROXIMITY.microbeCommunity) continue;
      addCandidate(cardId, distance, { type: zone.id, source: 'community' });
    }

    for (const ally of state.level.allies || []) {
      if (!ally.presentationOnly && !ally.fixedDebut) continue;
      const cardId = ally.cardId || discoveryCards[ally.id];
      const distance = distanceToPlayer(ally.x, ally.y);
      if (distance > TUTORIAL_PROXIMITY.organism) continue;
      addCandidate(cardId, distance, { type: ally.id, source: 'fixed-debut' });
    }

    for (const enemy of state.level.enemies || []) {
      if (!enemy.alive || (enemy.type !== 'rhizoctonia' && !Number.isFinite(enemy.colonization))) continue;
      const distance = distanceToPlayer(
        enemy.x + (enemy.w || 0) / 2,
        enemy.y + (enemy.h || 0) / 2,
      );
      if (distance <= TUTORIAL_PROXIMITY.organism) {
        addCandidate('organism-rhizoctonia', distance, { source: 'enemy' });
      }
    }

    for (const focus of ralstoniaControl.foci || []) {
      if (focus.neutralized) continue;
      const distance = distanceToPlatform(focus.root);
      if (distance <= TUTORIAL_PROXIMITY.rootProcess) {
        addCandidate('organism-ralstonia', distance, { source: 'focus' });
      }
    }

    for (const juvenile of sim.meloidogyneLifecycle.juveniles || []) {
      if (!juvenile.alive) continue;
      const distance = distanceToPlayer(juvenile.x, juvenile.y);
      if (distance <= TUTORIAL_PROXIMITY.organism) {
        addCandidate('organism-meloidogyne-j2', distance, { source: 'juvenile' });
      }
    }

    for (const gall of sim.meloidogyneLifecycle.galls || []) {
      if (gall.progress < .78) continue;
      const distance = distanceToPlayer(gall.x, gall.platform?.y ?? gall.y);
      if (distance <= TUTORIAL_PROXIMITY.structure) {
        addCandidate('organism-meloidogyne-female', distance, { source: 'gall' });
      }
    }

    return [...candidatesByCard.values()]
      .sort((a, b) => a.distance - b.distance || a.cardId.localeCompare(b.cardId));
  }

  function triggerNearestOrganism() {
    const candidates = organismCandidates();
    if (candidates.length > 1) {
      const context = tutorialContext();
      const detail = {
        phase: context.phase,
        chunkIndex: context.chunkIndex,
        candidates: candidates.map(candidate => ({
          cardId: candidate.cardId,
          type: candidate.type || null,
          source: candidate.source,
          distance: Math.round(candidate.distance),
        })),
      };
      lastSimultaneousFirstEncounters = detail;
      const event = typeof CustomEvent === 'function'
        ? new CustomEvent(TUTORIAL_SIMULTANEOUS_FIRST_ENCOUNTERS_EVENT, { detail })
        : Object.assign(new Event(TUTORIAL_SIMULTANEOUS_FIRST_ENCOUNTERS_EVENT), { detail });
      window.dispatchEvent(event);
    }

    for (const candidate of candidates) {
      if (!manager.trigger(candidate.cardId, tutorialContext({
        source: tutorialPacing.firstAppearanceEvent,
        organismType: candidate.type || null,
        organismSource: candidate.source,
      }))) continue;
      if (candidate.type) state.discoveredMicrobes.add(candidate.type);
      return true;
    }
    return false;
  }

  function triggerStateTransitions() {
    const current = conditionSnapshot();
    const transitions = [
      ['action-exudate', current.exudate && !previousConditions.exudate],
      ['action-inoculation', current.inoculation && !previousConditions.inoculation],
      ['power-double-jump', current.doubleJump && !previousConditions.doubleJump],
      ['power-dash', current.dash && !previousConditions.dash],
      ['power-pulse', current.phosphateSolubilization && !previousConditions.phosphateSolubilization],
    ];
    previousConditions = current;
    for (const [id, active] of transitions) {
      if (active && manager.trigger(id, tutorialContext())) return true;
    }
    return false;
  }

  function update() {
    if (manager.isOpen || state.gameState !== 'play' || state.campaign?.transitionRequested) return;

    syncPhaseKnowledge();

    const now = performance.now();
    if (now < resumeDelayUntil || now - lastCheckAt < 140) return;
    lastCheckAt = now;

    // Entre todos os organismos próximos, abre primeiro o mais perto de Miguelito.
    if (triggerNearestOrganism()) return;
    if (triggerStateTransitions()) return;

    const eggMasses = sim.meloidogyneLifecycle.eggMasses || [];
    const nearbyEggMass = eggMasses.find(mass => (
      mass.eggs > 0 && nearPoint(mass.x, mass.y, TUTORIAL_PROXIMITY.structure)
    ));
    if (trigger('structure-egg-mass', nearbyEggMass)) return;

    const galls = sim.meloidogyneLifecycle.galls || [];
    const nearbyGall = galls.find(gall => (
      gall.progress >= .12
      && nearPoint(gall.x, gall.platform?.y || gall.y, TUTORIAL_PROXIMITY.structure)
    ));
    if (trigger('structure-gall', nearbyGall)) return;

    const nodules = state.level.rhizobiumNodules || [];
    const nearbyNodule = nodules.find(site => (
      site.compatible && nearPoint(site.x, site.surfaceY, TUTORIAL_PROXIMITY.rootProcess)
    ));
    if (trigger('structure-nodule', nearbyNodule)) return;

    const activeFixation = nodules.find(site => (
      site.fixationRate > .05 && nearPoint(site.x, site.surfaceY, TUTORIAL_PROXIMITY.rootProcess)
    ));
    if (trigger('process-fbn', activeFixation)) return;

    const nearbyBiofilm = (state.level.biofilms || []).find(film => (
      film.functional
      && nearPoint(film.x, film.platform?.y ?? film.y, TUTORIAL_PROXIMITY.structure)
    ));
    if (trigger('structure-biofilm', nearbyBiofilm)) return;

    const pseudomonasKnown = state.discoveredMicrobes.has('pseudomonas');
    const siderophoreActive = sim.pseudomonasSiderophores.freeCount > 0
      || sim.pseudomonasSiderophores.loadedCount > 0
      || sim.pseudomonasSiderophores.ironRecovered > 0;
    const nearbyPseudomonas = (sim.ecology.agents || []).some(agent => (
      agent.type === 'pseudomonas'
      && nearPoint(agent.x, agent.y, TUTORIAL_PROXIMITY.organism)
    ));
    if (trigger('process-siderophore', pseudomonasKnown && siderophoreActive && nearbyPseudomonas)) return;

    const nearbyArbuscule = (state.level.mycorrhizaArbuscules || []).find(arbuscule => (
      arbuscule.maturity > .08
      && nearPoint(arbuscule.x, arbuscule.y, TUTORIAL_PROXIMITY.structure)
    ));
    if (trigger('structure-arbuscule', nearbyArbuscule)) return;

    const mycorrhizaPath = (state.level.platforms || []).find(platform => (
      platform.mycorrhizaStructure && nearPlatform(platform, TUTORIAL_PROXIMITY.rootProcess)
    ));
    if (trigger('structure-mycorrhiza-path', mycorrhizaPath)) return;

    const lateralRoot = (state.level.azospirillumRoots || []).find(root => (
      root.visibleProgress > .06
      && (
        nearPoint(root.startX, root.startY, TUTORIAL_PROXIMITY.rootProcess)
        || nearPoint(root.endX, root.endY, TUTORIAL_PROXIMITY.rootProcess)
      )
    ));
    if (trigger('structure-lateral-root', lateralRoot)) return;

    const roots = (state.level.platforms || []).filter(root => (
      root.type === 'root'
      && !root.final
      && !root.recovery
      && !root.mycorrhizaStructure
      && nearPlatform(root, TUTORIAL_PROXIMITY.rootProcess)
    ));
    const changedRoot = roots.find(root => root.rootState && root.rootState !== 'healthy');
    if (trigger('process-root-health', changedRoot)) return;

    const recoveringRoot = roots.find(root => root.healthTrend > 0 && root.recoveryPulse > .2);
    if (trigger('process-root-recovery', recoveringRoot)) return;

    const collapsedRoot = roots.find(root => root.rootState === 'collapse' || root.unstable);
    if (trigger('process-root-collapse', collapsedRoot)) return;

    const nearbyTargetedRhizoctonia = (state.level.enemies || []).some(enemy => (
      enemy.trichodermaRhizoTargeted
      && nearPoint(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, TUTORIAL_PROXIMITY.structure)
    ));
    const nearbyOpportunisticFungus = (sim.ecology.agents || []).some(agent => (
      agent.type === 'oportunista'
      && nearPoint(agent.x, agent.y, TUTORIAL_PROXIMITY.structure)
    ));
    const ironCompetitionVisible = state.campaign?.phase === 5
      && state.discoveredMicrobes.has('oportunista')
      && state.discoveredMicrobes.has('pseudomonas')
      && nearbyOpportunisticFungus
      && (sim.opportunisticFungus?.maximumIronLimitation || 0) >= .18;
    if (trigger('process-iron-competition', ironCompetitionVisible)) return;
    // Gatilhos da Ralstonia. O runtime marca o marco (`didactics`) uma unica vez
    // por fase; aqui o cartao so abre se o jogador estiver PERTO do foco — abrir
    // uma explicacao de algo que aconteceu fora da tela confunde mais que ensina.
    // Foco pendente nunca dispara: ele ainda nao existe para o jogador.
    const ralstoniaDidactics = ralstoniaControl.didactics || {};
    const visibleFocus = (ralstoniaControl.foci || []).find(focus => (
      focus.activationState !== 'pending'
      && !focus.neutralized
      && nearPlatform(focus.root, TUTORIAL_PROXIMITY.rootProcess)
    ));
    if (trigger('process-ralstonia-entry', ralstoniaDidactics.entry && visibleFocus)) return;
    if (trigger('process-vascular-obstruction', ralstoniaDidactics.obstruction && visibleFocus)) return;
    if (trigger('process-ralstonia-containment', ralstoniaDidactics.containment && visibleFocus)) return;
    const spreadVisible = (ralstoniaControl.activeSpreadEvents || []).some(event => (
      nearPlatform(event.sourceRoot, 620) || nearPlatform(event.targetRoot, 620)
    ));
    if (trigger('process-ralstonia-spread', ralstoniaDidactics.spread && spreadVisible)) return;

    const mycoparasitismActive = (
      trichodermaRhizoctoniaControl.activeAttackCount > 0 && nearbyTargetedRhizoctonia
    ) || (sim.trichoderma.attackCount > 0 && nearbyOpportunisticFungus);
    trigger('process-mycoparasitism', mycoparasitismActive);
  }

  function showWelcome() {
    manager.trigger('system-welcome', {
      tutorialMode: 'guided',
      worldX: playerPoint().x,
      visibleWorldWidth: (state.viewportWidth || W) / Math.max(0.1, state.cameraZoom || 1),
      nowSeconds: performance.now() / 1000,
      affectsPacing: false,
    });
  }

  function rearm() {
    // Fotografa o estado atual: poderes já ativos não reaparecem imediatamente.
    previousConditions = conditionSnapshot();
    resumeDelayUntil = performance.now() + 700;
    lastCheckAt = -Infinity;
  }

  function diagnostics() {
    const player = playerPoint();
    const chunkIndex = currentChunkIndex();
    const phase = Number.isInteger(state.campaign?.phase) ? state.campaign.phase : 1;
    const nearbyAgents = (sim.ecology.agents || [])
      .map(agent => ({
        type: agent.type,
        distance: Math.round(Math.hypot(agent.x - player.x, agent.y - player.y)),
      }))
      .filter(agent => agent.distance <= 500)
      .sort((a, b) => a.distance - b.distance);

    return {
      version: TUTORIAL_RUNTIME_VERSION,
      gameState: state.gameState,
      tutorialOpen: manager.isOpen,
      phase,
      chunkIndex,
      tutorialMode: getTutorialModeAt(phase, chunkIndex),
      conditions: conditionSnapshot(),
      discovered: [...state.discoveredMicrobes],
      nearbyAgents,
      closestCandidate: organismCandidates()[0] || null,
      lastUnexpectedFirstAppearance,
      lastSimultaneousFirstEncounters,
    };
  }

  return { update, showWelcome, rearm, diagnostics };
}
