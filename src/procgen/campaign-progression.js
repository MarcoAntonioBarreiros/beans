import {
  CAMPAIGN_UNLOCKS,
  ECOLOGY_ROAMING_TYPES,
  campaignManifest,
  getPathogenStartChunk,
  getPhaseManifest,
} from './campaign-manifest.js';
import { setLogicCampaignProfile } from './logic.js';
import { getChunkAnchorPlatform } from './traversal-route.js';

const MOVEMENT_FEATURES = new Set(['doubleJump', 'dash']);
const DEFAULT_START_PHASE = 1;
const campaignStorage = new WeakMap();

export const CAMPAIGN_STORAGE_KEY = 'miguelito:campaign:v2';

const FEATURE_ALLIES = Object.freeze({
  // Salto duplo, dash e pulso sao PODERES da raiz saudavel (fitohormonios), nao
  // organismos — cada um com id proprio. azospirillumRoots segue com o organismo
  // Azospirillum ('azo'); mycorrhizaStructures com a micorriza ('myco').
  doubleJump: 'power-jump',
  dash: 'power-dash',
  phosphateSolubilization: 'power-pulse',
  mycorrhizaStructures: 'myco',
  azospirillumRoots: 'azo',
});

// O item de coleta de um poder que na verdade e carregado por um organismo
// vagante deve sumir (como a micorriza). O id do ally nem sempre e igual ao tipo
// roaming: 'azo' corresponde ao organismo 'azospirillum'.
const ALLY_ROAMING_TYPE = Object.freeze({ azo: 'azospirillum', myco: 'myco' });

function blankUnlocks(source = {}) {
  return Object.fromEntries(CAMPAIGN_UNLOCKS.map(feature => [feature, source[feature] === true]));
}

// Migracao de saves anteriores a Propulsao da Rizosfera.
//
// Um save antigo simplesmente NAO TEM a chave `jetpack`, o que e diferente de
// te-la explicitamente em false (jogador que ainda nao coletou). Por isso a
// checagem e por presenca da propriedade, nao por valor: quem ja passou da fase
// 5 teria coletado a mochila se ela existisse, entao herda o desbloqueio; quem
// parou antes comeca sem ela; e quem esta na propria fase 5 continua sem, ate
// coletar — e o unico ponto em que nao da para inferir com seguranca.
export function migrateJetpackUnlock(savedUnlocks, savedPhase) {
  if (savedUnlocks && Object.hasOwn(savedUnlocks, 'jetpack')) {
    return savedUnlocks.jetpack === true;
  }
  return Number.isInteger(savedPhase) && savedPhase > 5;
}

function randomCampaignSeed() {
  return `campanha-${Math.floor(Math.random() * 1000000)}`;
}

function validPhase(phase, fallback = DEFAULT_START_PHASE) {
  return Number.isInteger(phase) && getPhaseManifest(phase) ? phase : fallback;
}

function blankCampaign(seed) {
  return {
    seed,
    phase: DEFAULT_START_PHASE,
    unlocks: blankUnlocks(),
    totalScore: 0,
    history: [],
    transitionRequested: false,
    transitionAt: 0,
    // Espera pelo fim do stinger de vitória (ver maybeAdvanceCampaign).
    waitingForVictoryAudio: false,
    victoryAudioFinished: false,
    victoryAudioDeadline: 0,
    transitionCaptured: false,
    pendingReport: null,
  };
}

function readStoredCampaign(storage) {
  if (!storage?.getItem) return null;
  try {
    const parsed = JSON.parse(storage.getItem(CAMPAIGN_STORAGE_KEY));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

export function campaignSnapshot(campaign) {
  return {
    seed: String(campaign.seed || randomCampaignSeed()),
    phase: validPhase(campaign.phase),
    unlocks: blankUnlocks(campaign.unlocks),
    totalScore: Number.isFinite(campaign.totalScore) ? campaign.totalScore : 0,
    history: Array.isArray(campaign.history) ? campaign.history : [],
    pendingReport: campaign.pendingReport ?? null,
  };
}

export function persistCampaign(campaign) {
  const storage = campaignStorage.get(campaign);
  if (!storage?.setItem) return false;
  try {
    storage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(campaignSnapshot(campaign)));
    return true;
  } catch (_) {
    return false;
  }
}

export function createCampaign(seed = randomCampaignSeed(), { storage = null } = {}) {
  const saved = readStoredCampaign(storage);
  const campaign = blankCampaign(saved?.seed ? String(saved.seed) : seed);
  if (saved) {
    campaign.phase = validPhase(saved.phase);
    campaign.unlocks = blankUnlocks(saved.unlocks);
    campaign.unlocks.jetpack = migrateJetpackUnlock(saved.unlocks, saved.phase);
    campaign.totalScore = Number.isFinite(saved.totalScore) ? saved.totalScore : 0;
    campaign.history = Array.isArray(saved.history) ? saved.history : [];
    campaign.pendingReport = saved.pendingReport ?? null;
  }
  if (storage) campaignStorage.set(campaign, storage);
  return campaign;
}

export function resetCampaign(campaign, seed = randomCampaignSeed()) {
  const fresh = blankCampaign(seed);
  Object.assign(campaign, fresh);
  persistCampaign(campaign);
  return campaign;
}

export function ensureCampaignUnlockShape(campaign) {
  campaign.unlocks = blankUnlocks(campaign.unlocks);
  return campaign.unlocks;
}

function tuningForPhase(phase) {
  if (phase === 0) return { hardChance: .02, enemyChance: 0, skillRequirementChance: 0, comboRequirementChance: 0 };
  if (phase === 1) return { hardChance: .08, enemyChance: .12, skillRequirementChance: .56, comboRequirementChance: 0 };
  if (phase === 2) return { hardChance: .10, enemyChance: .14, skillRequirementChance: .60, comboRequirementChance: 0 };
  if (phase === 3) return { hardChance: .14, enemyChance: .18, skillRequirementChance: .68, comboRequirementChance: 0 };
  // Fase 9 (Ralstonia): a dificuldade esta na DOENCA, nao na plataforma. Se a
  // travessia tambem virasse gauntlet, o jogador erraria o pulo em vez de
  // aprender prevencao — entao ela fica proxima do ritmo das fases anteriores.
  if (phase === 9) return { hardChance: .20, enemyChance: .20, skillRequirementChance: .74, comboRequirementChance: .10 };
  // Fase 10 (Ecossistema integrado): gauntlet das mecanicas ja dominadas — mais
  // chunks 'hard' e uma fracao exigindo o combo salto duplo + dash. A rede de
  // rota e auditada (auditTraversableRoute) sem inserir plataforma nenhuma:
  // cada travessia intencional e resolvida pela propria mecanica da fase.
  if (phase === 10) return { hardChance: .34, enemyChance: .26, skillRequirementChance: .82, comboRequirementChance: .30 };
  return {
    hardChance: Math.min(.23, .15 + (phase - 4) * .012),
    enemyChance: Math.min(.28, .18 + (phase - 4) * .01),
    skillRequirementChance: Math.min(.78, .68 + (phase - 4) * .015),
    comboRequirementChance: 0,
  };
}

function runtimeUnlockEvent(event) {
  return {
    ...event,
    chunk: event.eventChunk,
    allyId: FEATURE_ALLIES[event.feature] || null,
  };
}

export function getPhaseProfile(campaign) {
  ensureCampaignUnlockShape(campaign);
  const manifest = getPhaseManifest(campaign.phase);
  if (!manifest) throw new RangeError(`Fase de campanha inexistente: ${campaign.phase}`);

  const tuning = tuningForPhase(manifest.phase);
  const initialUnlocks = blankUnlocks(campaign.unlocks);
  return {
    id: manifest.id,
    phase: manifest.phase,
    title: manifest.title,
    theme: manifest.theme,
    mission: manifest.mission,
    totalChunks: manifest.totalChunks,
    newConcepts: [...manifest.newConcepts],
    newCommand: manifest.newCommand,
    unlockEvents: manifest.unlockEvents.map(runtimeUnlockEvent),
    phosphateSolubilization: manifest.phosphateSolubilization
      ? { ...manifest.phosphateSolubilization }
      : undefined,
    initialUnlocks,
    initialAbilities: [...MOVEMENT_FEATURES].filter(feature => initialUnlocks[feature]),
    ...tuning,
  };
}

export function prepareCampaignGeneration(campaign) {
  const profile = getPhaseProfile(campaign);
  setLogicCampaignProfile(profile);
  return profile;
}

export function campaignPhaseSeed(campaign) {
  return `${campaign.seed}:fase-${campaign.phase}`;
}

function featurePresentation(feature) {
  if (feature === 'doubleJump') {
    return {
      name: 'Fitohormônio de crescimento',
      desc: 'A raiz saudável libera um fitohormônio que impulsiona o salto duplo. Pressione salto novamente enquanto estiver no ar.',
    };
  }
  if (feature === 'dash') {
    return {
      name: 'Impulso da Rizósfera',
      desc: 'A energia do solo vivo libera o dash. Use Shift ou o botão DASH para atravessar vãos rapidamente.',
    };
  }
  if (feature === 'mycorrhizaStructures') {
    return {
      name: 'Mira, a Micorriza',
      desc: 'A rede micorrízica agora pode orientar hifas finas horizontalmente e formar pontes laterais dirigidas por exsudatos.',
    };
  }
  if (feature === 'phosphateSolubilization') {
    return {
      name: 'Enzima de solubilização',
      desc: 'A raiz saudável libera a enzima do pulso: selecione Solubilização P, carregue perto da cepa de Bacillus e solte E para disparar no depósito.',
    };
  }
  return {
    name: 'Ari, o Azospirillum',
    desc: 'A sinalização hormonal do Azospirillum agora pode formar escadas de ramificações em raízes hospedeiras.',
  };
}

export function decorateCampaignLevel(level, campaign, profile = getPhaseProfile(campaign)) {
  level.campaignPhase = campaign.phase;
  level.phaseTheme = profile.theme;
  level.phaseTitle = profile.title;
  level.phaseProfile = profile;
  level.pathogenSchedule = {
    rhizoctonia: getPathogenStartChunk(campaign.phase, 'rhizoctonia'),
    meloidogyne: getPathogenStartChunk(campaign.phase, 'meloidogyne'),
  };

  // A estreia precisa ser o organismo de verdade, nao um icone de coleta.
  // Como ally ela vinha com a morfologia antiga do renderer e, principalmente,
  // SEM propagulo: dava para ler o cartao e nao havia o que capturar, entao a
  // ponte lateral que a prova final exige ficava impossivel de construir. Dava
  // para atravessar a fase toda com salto duplo e mesmo assim nao concluir.
  //
  // Nao entra no pool procedural — a estreia continua fixa, como o teste de
  // ordem exige. E um encontro autoral, num ponto so. O perfil de movimento do
  // myco e de micelio ancorado, entao ele fica onde estreia.
  function authorDebutEncounter(target, presentation, fixed, x, y) {
    if (!ECOLOGY_ROAMING_TYPES.includes(fixed.id)) return;
    target.authoredEncounters = target.authoredEncounters || [];
    // Uma segunda chamada para a mesma estreia duplicaria o organismo.
    if (target.authoredEncounters.some(entry => (
      entry.id === fixed.id && entry.logicIndex === presentation.debutChunk
    ))) return;
    target.authoredEncounters.push({
      id: fixed.id,
      x, y,
      r: 155,
      territory: 620,
      collect: false,
      logicIndex: presentation.debutChunk,
      source: 'debut',
      cardId: presentation.cardId,
      presentationId: presentation.id,
      debutZoneId: presentation.debutZoneId,
      tetherUntilSeen: true,
      tetherRadius: 165,
    });
  }

  const fixedDebutTypes = {
    'organism-mycorrhiza': {
      id: 'myco', name: 'Micorriza arbuscular',
      desc: 'Estrutura fixa de estreia da associação micorrízica.',
    },
    'organism-phosphate-solubilizer': {
      id: 'phos', name: 'Microrganismo solubilizador de fosfato',
      desc: 'Estrutura fixa de estreia da comunidade solubilizadora.',
    },
  };
  const manifest = getPhaseManifest(campaign.phase);
  for (const presentation of manifest.presentations) {
    const fixed = fixedDebutTypes[presentation.cardId];
    if (!fixed || presentation.roamingType || presentation.roamingTypes) continue;
    const functionalDebut = (level.allies || []).find(ally => (
      ally.id === fixed.id && ally.logicIndex === presentation.debutChunk && !ally.presentationOnly
    ));
    if (functionalDebut) {
      Object.assign(functionalDebut, fixed, {
        fixedDebut: true,
        cardId: presentation.cardId,
        presentationId: presentation.id,
        debutZoneId: presentation.debutZoneId,
        mycorrhizaArbusculeDebut: presentation.cardId === 'organism-mycorrhiza',
      });
      authorDebutEncounter(level, presentation, fixed, functionalDebut.x, functionalDebut.y);
      continue;
    }
    const platform = getChunkAnchorPlatform(level, presentation.debutChunk);
    if (!platform) continue;
    const debutX = platform.x + platform.w / 2;
    const debutY = platform.y - 44;
    level.allies.push({
      ...fixed,
      x: debutX,
      y: debutY,
      r: 32,
      taken: false,
      presentationOnly: true,
      cardId: presentation.cardId,
      presentationId: presentation.id,
      debutZoneId: presentation.debutZoneId,
      logicIndex: presentation.debutChunk,
    });

    authorDebutEncounter(level, presentation, fixed, debutX, debutY);
  }

  const queues = new Map();
  for (const event of profile.unlockEvents) {
    if (!event.allyId) continue;
    if (!queues.has(event.allyId)) queues.set(event.allyId, []);
    queues.get(event.allyId).push(event);
  }

  for (const ally of level.allies || []) {
    const event = queues.get(ally.id)?.shift();
    if (!event) continue;
    ally.unlockFeature = event.feature;
    const presentation = featurePresentation(event.feature);
    ally.name = presentation.name;
    ally.desc = presentation.desc;
  }

  // Onde existe o organismo de verdade, o ally e removido — nao escondido.
  //
  // Ele era um item de coleta com arte propria, e sobreviveu a refatoracao da
  // micorriza como um resto: desenhava a morfologia velha por cima do organismo
  // novo e, pior, era o UNICO gatilho do desbloqueio da habilidade. Esconder o
  // desenho e manter o gatilho, como cheguei a fazer, transformou a chave da
  // mecanica num objeto invisivel — pior do que estava.
  //
  // Agora o organismo carrega o desbloqueio, que e onde ele sempre devia estar:
  // quem ensina a micorriza e a micorriza.
  for (const ally of [...(level.allies || [])]) {
    const roamingType = ALLY_ROAMING_TYPE[ally.id];
    if (!roamingType || !ECOLOGY_ROAMING_TYPES.includes(roamingType)) continue;
    const encounter = (level.authoredEncounters || []).find(entry => (
      entry.id === roamingType && entry.logicIndex === ally.logicIndex
    ));
    if (encounter && ally.unlockFeature) {
      encounter.unlockFeature = ally.unlockFeature;
      encounter.unlockName = ally.name;
      encounter.unlockDesc = ally.desc;
    }
    // Some mesmo sem encontro autoral: quando o organismo e vagante, quem
    // carrega o cartao e o desbloqueio e a estreia criada por
    // generateCampaignEncounters. O ally sobrando so voltaria a desenhar a
    // morfologia antiga por cima do organismo.
    level.allies = level.allies.filter(entry => entry !== ally);
  }
  return level;
}

export function unlockCampaignFeature(state, feature) {
  const campaign = state.campaign;
  if (!campaign || !CAMPAIGN_UNLOCKS.includes(feature)) return false;
  ensureCampaignUnlockShape(campaign);
  const firstUnlock = !campaign.unlocks[feature];
  campaign.unlocks[feature] = true;
  applyPersistentUnlocks(state.player, campaign);
  persistCampaign(campaign);
  return firstUnlock;
}

export function applyPersistentUnlocks(player, campaign) {
  const unlocks = blankUnlocks(campaign?.unlocks);
  player.canDoubleJump = unlocks.doubleJump;
  player.canDash = unlocks.dash;
  player.canPhosphateSolubilization = unlocks.phosphateSolubilization;
  player.canJetpack = unlocks.jetpack;
  player.airJumpAvailable = player.canDoubleJump;
}

export function recordPhaseResult(campaign, report) {
  campaign.history.push(report);
  campaign.totalScore += report.score;
  campaign.pendingReport = report;
  campaign.transitionCaptured = true;
  persistCampaign(campaign);
}

export function advanceCampaignPhase(campaign) {
  const currentIndex = campaignManifest.findIndex(entry => entry.phase === campaign.phase);
  if (currentIndex < 0) return false;
  const next = campaignManifest[currentIndex + 1];
  if (!next) return false;
  campaign.phase = next.phase;
  ensureCampaignUnlockShape(campaign);
  campaign.transitionRequested = false;
  campaign.transitionAt = 0;
  campaign.waitingForVictoryAudio = false;
  campaign.victoryAudioFinished = false;
  campaign.victoryAudioDeadline = 0;
  campaign.transitionCaptured = false;
  campaign.pendingReport = null;
  persistCampaign(campaign);
  return true;
}
