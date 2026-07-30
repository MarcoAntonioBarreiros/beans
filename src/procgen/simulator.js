import { createPhysicsSystem } from '../physics.js';
import { createPlayer, resetJetpackRuntime, resetPlayer } from '../player.js';
import { applyPersistentUnlocks, unlockCampaignFeature } from './campaign-progression.js';
import { createMicrobeArt } from '../data/microbes.js';
import { createRoamingMicrobeEcology } from './microbe-roaming.js';
import { createMycorrhizaGrowth } from './mycorrhiza-growth.js';
import { createMycorrhizaStructures } from './mycorrhiza-structures.js';
import { createTrichodermaGrowth } from './trichoderma-growth.js';
import { createTrichodermaRecruitment } from './trichoderma-recruitment.js';
import { createTrichodermaColonies } from './trichoderma-colonies.js';
import { createBeneficialInoculants } from './beneficial-inoculants.js';
import { createPseudomonasSiderophores } from './pseudomonas-siderophores.js';
import { createOpportunisticFungus } from './opportunistic-fungus.js';
import { createBacillusBioprotection } from './bacillus-bioprotection.js';
import { createBacillusBioprotectionSafety } from './bacillus-bioprotection-safety.js';
import { createRhizobiumNodulation } from './rhizobium-nodulation.js';
import { createNitrogenRootDevelopment } from './nitrogen-root.js';
import { createAzospirillumRootGrowth } from './azospirillum-root-growth.js';
import { createAzospirillumRootSafety } from './azospirillum-root-safety.js';
import { createRenewableExudates } from './renewable-exudates.js';
import { createAzospirillumNitrogen } from './azospirillum-nitrogen.js';
import { createMeloidogyneLifecycle } from './meloidogyne-lifecycle.js';
import { createGoalSystem } from './goal-system.js';
import { createEcologicalGameplay } from './ecological-gameplay.js';
import { createPathogenSurvival } from './pathogen-survival.js';
import { createNoopAudio } from '../game-audio.js';
import { DISCOVERABLE_MICROBE_IDS } from '../audio-manifest.js';
import { createNoopBiologicalAudio } from './biological-audio.js';
import { createInoculumSelection } from './inoculum-selection.js';
import { createPhosphateSolubilization } from './phosphate-solubilization.js';
import {
  createEmptyObjectiveProgress,
  resetPhaseObjectiveProgress,
} from './campaign-objective-progress.js';

function createEmptyLevel() {
  return {
    platforms: [], hazards: [], crystals: [], enemies: [], exudates: [],
    allies: [], checkpoints: [], particles: [], pulses: [], goal: null,
    exudateClouds: [], biofilms: [], beneficialColonies: [], rhizobiumNodules: [],
    nitrogenRoots: [],
    azospirillumRootLadders: [], azospirillumRoots: [], ironDeposits: [], siderophores: [],
    phosphateDeposits: [], availablePhosphatePools: [], phosphateTransportParticles: [],
    nematodeEggMasses: [], nematodeJuveniles: [], rootGalls: [],
    objectiveProgress: createEmptyObjectiveProgress(),
  };
}

// Exsudato so podia ser ganho pegando os que a fase colocou — cada um uma vez,
// para sempre — e morrer apagava metade do estoque. Nao havia nenhum caminho de
// volta: o recurso so diminuia. Uma fase que exige mais inoculacoes do que o
// estoque restante virava matematicamente impossivel, sem nenhum aviso, e o
// jogador ficava procurando um recurso que nao existia mais. A fase 3 com duas
// secoes de nitrogenio mais escada e o pior caso disso.
//
// Ao renascer, os exsudatos DALI PARA A FRENTE voltam a existir. A penalidade da
// morte continua: metade do que estava carregado some e e preciso refazer o
// caminho. O que deixa de acontecer e o mundo destruir o recurso em definitivo.
// Os que ficaram para tras nao voltam, entao o trecho ja vencido nao vira fonte
// infinita.
//
// O jogo nao procedural sempre fez isso (src/data/level.js). Perdeu-se na
// migracao para o procedural, e nao foi decisao de design.
// Exsudatos RENOVAVEIS ficam de fora desta funcao de proposito: quem controla o
// ciclo deles e o modulo de regeneracao (renewable-exudates.js), pelo tempo e
// pela saude da raiz. Reativa-los aqui criaria dois donos do mesmo item — e,
// pior, transformaria a morte numa forma de farmar exsudato instantaneo
// (morrer -> renovavel volta -> coletar -> morrer). O respawn apenas devolve os
// exsudatos INICIAIS adiante; o renovavel volta quando o cronometro dele mandar.
export function restoreExudatesAhead(level, fromX) {
  let restored = 0;
  for (const exudate of level?.exudates || []) {
    if (exudate.renewable) continue;
    if (!exudate.taken || !Number.isFinite(exudate.x) || exudate.x < fromX) continue;
    exudate.taken = false;
    restored++;
  }
  return restored;
}

export function createSimulator({
  audio: audioController = null,
  biologicalAudio: biologicalAudioController = null,
} = {}) {
  const state = {
    time: 0,
    gameState: 'play',
    proceduralCampaign: true,
    player: createPlayer(),
    level: createEmptyLevel(),
    jumpHeldLast: false,
    discoveredMicrobes: new Set(),
    microbeArt: createMicrobeArt(),
    campaign: null,
    cameraX: 0,
    shake: 0,
    respawnTimer: 0,
    // Plataformas de recuperação desligadas DE VEZ: as plataforminhas
    // decorativas no fundo dos vãos não aparecem nem sustentam. O jogador pediu
    // para tirá-las; a tecla T ainda permite religá-las para depuração.
    //
    // Não existe exceção: toda plataforma com `recovery === true` fica inativa,
    // inclusive um eventual `safetyStep` residual. O pipeline de campanha não
    // cria mais nenhum, e as travessias intencionais das fases 1–4 são
    // resolvidas pelas próprias mecânicas (conclusão do bloco autoral, FBN na
    // raiz nitrogenada, ponte micorrízica, raiz lateral de Azospirillum).
    //
    // Uma recovery promovida por uma mecânica recebe `recovery = false` e volta
    // a ser desenhada e sólida — é assim que o hospedeiro da escada de
    // Azospirillum continua funcionando.
    recoveryPlatformsDisabled: true,
  };

  const input = {
    keys: {
      ArrowLeft: false, KeyA: false,
      ArrowRight: false, KeyD: false,
      Space: false, KeyW: false, ArrowUp: false,
      ShiftLeft: false, ShiftRight: false, KeyJ: false,
      KeyE: false,
      // Propulsao da Rizosfera: comando proprio, nunca o botao de pulo.
      KeyK: false, KeyC: false,
      // Seta para baixo cicla o inoculo carregado. A de cima nao serve: e pulo.
      ArrowDown: false,
    },
  };

  // Audio injetado pelo app; nos testes Node entra o adaptador silencioso. O
  // simulador nunca toca em `window` ou `document` — quem faz isso e o
  // controlador, criado no app. Precisa nascer ANTES de `entities` porque a
  // fachada de interacao (Pacote 03) encaminha para ele.
  const audio = audioController || createNoopAudio();

  const entities = {
    // Fachada de áudio dos processos biológicos (Pacote 04). SEMPRE existe: nos
    // testes Node e em qualquer caminho sem navegador é o adaptador silencioso,
    // então nenhum módulo biológico precisa checar `window` ou `AudioContext`.
    audio: biologicalAudioController || createNoopBiologicalAudio(),

    // Fachada dos efeitos de INTERAÇÃO (Pacote 03). Só encaminha para `playFx`,
    // sem `bus: 'biological'` — estes sons vão pelo barramento geral de efeitos.
    // Devolve o resultado original (`played` / `queued` / `suppressed` /
    // `rejected`) para quem chama decidir se marca o evento como entregue.
    interactionFx: (trackId, options = {}) => audio.playFx(trackId, options),
    burst: (x, y, color, count, speed) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * speed;
        state.level.particles.push({
          x, y,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity,
          r: 1 + Math.random() * 2,
          color,
          life: .4 + Math.random() * .4,
          max: .8,
        });
      }
    },
    // Único ponto de descoberta — e por isso o único lugar onde o som dela pode
    // morar sem repetir. Devolve se ESTA chamada foi a primeira, para quem
    // chama não precisar consultar o Set antes.
    //
    // `options.sound = false` existe para os casos em que a descoberta acontece
    // junto de um evento mais forte: o checkpoint que revela o Bacillus e o
    // recrutamento que é o primeiro contato com a espécie. Ali empilhar dois
    // sons no mesmo quadro só embola.
    discoverMicrobe: (id, showCard = true, options = {}) => {
      const first = !state.discoveredMicrobes.has(id);
      state.discoveredMicrobes.add(id);
      if (first && options.sound !== false && DISCOVERABLE_MICROBE_IDS.includes(id)) {
        entities.interactionFx('microbeDiscovery', { gain: 1, rate: 1, instanceId: id });
      }
      return first;
    },
    // Desbloqueio disparado pelo proprio organismo, ao inves de por um item de
    // coleta a parte. Ver o comentario em microbe-ecology.js.
    unlockCampaignFeature: (feature, zone) => {
      if (!unlockCampaignFeature(state, feature)) return;
      state.toast = zone?.unlockDesc || 'Uma nova função do solo vivo foi liberada.';
      state.toastTime = 5.2;
    },
    respawn: reason => {
      const player = state.player;
      for (const juvenile of state.level.nematodeJuveniles || []) {
        if (juvenile.carriedByPlayer) juvenile.alive = false;
      }
      player.x = state.currentCheckpoint ? state.currentCheckpoint.x : 100;
      player.y = state.currentCheckpoint ? state.currentCheckpoint.y : 400;
      player.vx = 0;
      player.vy = 0;
      player.alive = true;
      player.vitality = player.maxVitality || 5;
      restoreExudatesAhead(state.level, player.x);
      player.infectionExposure = 0;
      player.infection = Math.min(.12, Math.max(0, (player.infection || 0) * .2));
      player.fungalContamination = Math.min(.08, Math.max(0, (player.fungalContamination || 0) * .15));
      player.fungalAttachmentLevel = 0;
      player.nematodeLoad = 0;
      player.fungalDamageCooldown = 1.8;
      player.nematodeDamageCooldown = 1.8;
      player.healCooldown = 2;
      player.dashSuppressed = false;
      player.airJumpAvailable = player.canDoubleJump;
      // A mochila volta VAZIA: o respawn não concede carga. O jogador recarrega
      // normalmente na raiz do checkpoint, se ela tiver ao menos 70% de saúde.
      player.jetpackEnergy = 0;
      player.jetpackLockedUntilGround = false;
      resetJetpackRuntime(player);
      if (state.campaign) applyPersistentUnlocks(player, state.campaign);
      player.invuln = 1.7;
      player.tutorialUnsafeUntil = state.time + .1;
      state.respawnTimer = 0;
      state.gameState = 'play';
      state.toast = reason === 'death'
        ? 'Respawn no último biofilme: Vitalidade restaurada.'
        : 'Retorno ao último ponto seguro.';
      state.toastTime = 4.2;
    },
  };

  const hud = {
    setMission: mission => { state.mission = mission; },
    showToast: (title, desc) => {
      state.toast = `${title}: ${desc}`;
      state.toastTime = 4.7;
    },
    updateHud: () => {},
    showEnd: () => {},
  };

  const ecology = createRoamingMicrobeEcology({ state, entities });
  const mycorrhiza = createMycorrhizaGrowth({ state, entities });
  const mycorrhizaStructures = createMycorrhizaStructures({ state, entities });
  const recruitment = createTrichodermaRecruitment({ state, ecology, entities });
  const trichodermaColonies = createTrichodermaColonies({ state, input, ecology, entities });
  const trichoderma = createTrichodermaGrowth({ state, entities, ecology, colonies: trichodermaColonies });
  const goal = createGoalSystem({ state, entities });
  const gameplay = createEcologicalGameplay({ state, input, entities, ecology });
  const beneficialInoculants = createBeneficialInoculants({ state, input, ecology, entities });
  const pseudomonasSiderophores = createPseudomonasSiderophores({
    state,
    entities,
    ecology,
    inoculants: beneficialInoculants,
  });
  const opportunisticFungus = createOpportunisticFungus({ state, entities, ecology });
  const bacillusBioprotection = createBacillusBioprotection({
    state,
    entities,
    ecology,
    inoculants: beneficialInoculants,
  });
  const bacillusBioprotectionSafety = createBacillusBioprotectionSafety({
    state,
    inoculants: beneficialInoculants,
  });
  const rhizobiumNodulation = createRhizobiumNodulation({ state, entities, inoculants: beneficialInoculants });
  const nitrogenRootDevelopment = createNitrogenRootDevelopment({ state, entities });
  const azospirillumRootGrowth = createAzospirillumRootGrowth({ state, entities, inoculants: beneficialInoculants });
  const azospirillumRootSafety = createAzospirillumRootSafety({ state, rootGrowth: azospirillumRootGrowth });
  const azospirillumNitrogen = createAzospirillumNitrogen({ state, inoculants: beneficialInoculants });
  const meloidogyneLifecycle = createMeloidogyneLifecycle({ state, entities });
  const pathogenSurvival = createPathogenSurvival({ state, entities, ecology, audio });
  // A raiz viva volta a exsudar: exsudato deixa de ser recurso estritamente
  // finito e a prova obrigatoria da fase 3 nunca fica sem como ser resolvida.
  const renewableExudates = createRenewableExudates({ state });

  // Um unico item selecionado por vez decide quem responde ao E: cada sistema
  // consulta a selecao antes de agir, em vez de disputar a tecla por ordem.
  const inoculumSelection = createInoculumSelection({
    entities,
    state,
    input,
    inoculants: beneficialInoculants,
    trichodermaColonies,
  });
  // A ponte micorrizica passa a exigir colonia inoculada na raiz de origem, em
  // vez de nascer de qualquer exsudato solto perto de uma borda.
  mycorrhizaStructures.setInoculants(beneficialInoculants);
  // A micorriza inoculada emite hifas e forma arbusculos como a do cenario.
  mycorrhiza.setInoculants(beneficialInoculants);
  beneficialInoculants.setSelection(inoculumSelection);
  trichodermaColonies.setSelection(inoculumSelection);
  gameplay.setSelection(inoculumSelection);
  state.inoculumSelection = inoculumSelection;
  const phosphateSolubilization = createPhosphateSolubilization({
    state,
    input,
    entities,
    selection: inoculumSelection,
    bacillus: bacillusBioprotection,
    // Quem carrega o fosfato ate a raiz e a micorriza inoculada, nao uma rota
    // desenhada: o transporte precisa enxergar as colonias reais.
    inoculants: beneficialInoculants,
  });

  state.microbeEcology = ecology;
  state.mycorrhizaGrowth = mycorrhiza;
  state.mycorrhizaStructures = mycorrhizaStructures;
  state.trichodermaGrowth = trichoderma;
  state.trichodermaRecruitment = recruitment;
  state.trichodermaColonies = trichodermaColonies;
  state.beneficialInoculants = beneficialInoculants;
  state.pseudomonasSiderophores = pseudomonasSiderophores;
  state.opportunisticFungus = opportunisticFungus;
  state.bacillusBioprotection = bacillusBioprotection;
  state.rhizobiumNodulation = rhizobiumNodulation;
  state.nitrogenRootDevelopment = nitrogenRootDevelopment;
  state.azospirillumRootGrowth = azospirillumRootGrowth;
  state.azospirillumRootSafety = azospirillumRootSafety;
  state.azospirillumNitrogen = azospirillumNitrogen;
  state.meloidogyneLifecycle = meloidogyneLifecycle;
  state.goalSystem = goal;
  state.ecologicalGameplay = gameplay;
  state.pathogenSurvival = pathogenSurvival;
  state.phosphateSolubilization = phosphateSolubilization;
  state.renewableExudates = renewableExudates;

  const physics = createPhysicsSystem({ state, input, entities, hud, audio });

  function reset() {
    // Antes de qualquer sistema: nenhum loop de uma fase pode atravessar para a
    // seguinte, nem sobreviver a um reinício de campanha.
    entities.audio.stopAll({ fade: 0.20, clearPending: true });
    const nextObjectiveAttemptId = (state.level.objectiveProgress?.attemptId || 0) + 1;
    resetPlayer(state.player, state.campaign?.unlocks);
    state.player.alive = true;
    state.time = 0;
    state.currentCheckpoint = null;
    state.jumpHeldLast = false;
    state.respawnTimer = 0;
    recruitment.clear();
    trichoderma.clear();
    trichodermaColonies.clear();
    azospirillumRootGrowth.clear();
    azospirillumNitrogen.clear();
    pseudomonasSiderophores.clear();
    opportunisticFungus.clear();
    bacillusBioprotection.clear();
    meloidogyneLifecycle.clear();
    beneficialInoculants.clear();
    nitrogenRootDevelopment.clear();
    rhizobiumNodulation.clear();
    mycorrhizaStructures.clear();
    ecology.clear();
    mycorrhiza.clear();
    goal.clear();
    gameplay.clear();
    pathogenSurvival.clear();
    phosphateSolubilization.clear();
    state.level = createEmptyLevel();
    resetPhaseObjectiveProgress(state, {
      phaseId: state.campaign?.phase ?? null,
      attemptId: nextObjectiveAttemptId,
    });
    for (const key in input.keys) input.keys[key] = false;
  }

  function resetEcology(encounters) {
    ecology.reset(encounters);
  }

  function resetBiology() {
    mycorrhiza.reset();
    mycorrhizaStructures.reset();
    trichoderma.reset();
    recruitment.reset();
    trichodermaColonies.reset();
    goal.reset();
    gameplay.reset();
    azospirillumRootGrowth.reset();
    azospirillumNitrogen.reset();
    beneficialInoculants.reset();
    pseudomonasSiderophores.reset();
    opportunisticFungus.reset();
    bacillusBioprotection.reset();
    rhizobiumNodulation.reset();
    nitrogenRootDevelopment.reset();
    meloidogyneLifecycle.reset();
    pathogenSurvival.reset();
    phosphateSolubilization.reset();
    renewableExudates.reset();
  }

  function setInputs(newKeys) {
    for (const key in input.keys) input.keys[key] = false;
    for (const key in newKeys) if (newKeys[key]) input.keys[key] = true;
  }

  function step(dt) {
    inoculumSelection.prepare(dt);
    phosphateSolubilization.prepare(dt);
    trichodermaColonies.prepare(dt);
    beneficialInoculants.prepare(dt);
    gameplay.prepare(dt);
    pathogenSurvival.prepare(dt);
    opportunisticFungus.prepare(dt);
    physics.update(dt);
    ecology.update(dt);
    recruitment.update(dt);
    beneficialInoculants.update(dt);
    pseudomonasSiderophores.update(dt);
    opportunisticFungus.update(dt);

    const azospirillumRootsUnlocked = state.campaign
      ? Boolean(state.campaign.unlocks.azospirillumRoots)
      : true;
    if (azospirillumRootsUnlocked) {
      azospirillumRootGrowth.update(dt);
      azospirillumRootSafety.update(dt);
    }

    rhizobiumNodulation.update(dt);
    azospirillumNitrogen.update(dt);
    nitrogenRootDevelopment.update(dt);
    trichodermaColonies.update(dt);
    gameplay.update(dt);
    bacillusBioprotection.update(dt);
    phosphateSolubilization.update(dt);
    bacillusBioprotectionSafety.update(dt);
    meloidogyneLifecycle.update(dt);
    trichoderma.update(dt);
    mycorrhiza.update(dt);

    const mycorrhizaStructuresUnlocked = state.campaign
      ? Boolean(state.campaign.unlocks.mycorrhizaStructures)
      : true;
    if (mycorrhizaStructuresUnlocked) mycorrhizaStructures.update(dt);

    pathogenSurvival.update(dt);
    // Roda depois das colonias/selecao: a garantia emergencial precisa enxergar
    // o estado ja atualizado (inoculo carregado, colonia no hospedeiro).
    renewableExudates.update(dt, {
      inoculants: beneficialInoculants,
      inoculumSelection,
    });
    goal.update(dt);
    if (state.toastTime > 0) state.toastTime -= dt;
  }

  const simulator = {
    audio,
    biologicalAudio: entities.audio,
    state, input, entities, ecology, mycorrhiza, mycorrhizaStructures,
    trichoderma, recruitment, trichodermaColonies, beneficialInoculants,
    pseudomonasSiderophores, opportunisticFungus, bacillusBioprotection, bacillusBioprotectionSafety,
    rhizobiumNodulation, nitrogenRootDevelopment, azospirillumRootGrowth, azospirillumRootSafety,
    azospirillumNitrogen, renewableExudates,
    meloidogyneLifecycle, pathogenSurvival, goal, gameplay,
    phosphateSolubilization,
    inoculumSelection,
    reset, resetEcology, resetBiology, setInputs, step,
  };

  return simulator;
}
