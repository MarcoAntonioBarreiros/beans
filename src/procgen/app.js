import { generateLevel, auditTraversableRoute } from './generator.js';
import { generateCampaignEncounters } from './campaign-encounters.js';
import { generateUnderdevelopedNitrogenRoots } from './nitrogen-root.js';
import { generateAzospirillumRootLadders } from './azospirillum-root-growth.js';
import { createCampaignObjectiveEvaluator } from './campaign-objectives.js';
import { applyPhaseOneVerticalSlice, createFixedBlockRuntime } from './phase-one-vertical-slice.js';
import { applySignatureChallenge } from './signature-challenge.js';
import {
  createRouteAnchorRegistry,
  recordRouteGeometryStage,
} from './route-geometry.js';
import { applyPhaseFourMycorrhizaIntro } from './phase-four-mycorrhiza-intro.js';
import { applyPhaseFiveTutorialEncounters, applyPhaseFiveTutorialGeometry } from './phase-five-tutorial.js';
import { applyPhaseSixTutorialEncounters, applyPhaseSixTutorialGeometry } from './phase-six-tutorial.js';
import { applyPhaseSevenPhosphateGeometry } from './phosphate-solubilization.js';
import { createPhaseTenOptionalDetour } from './optional-detour-composer.js';
import { createPhaseTenTopologyDetour } from './optional-detour-topology-synthesizer.js';
import { validateOptionalDetour } from './optional-detour-validator.js';
import { getNitrogenAvailability } from './nitrogen-availability.js';
import {
  AZOSPIRILLUM_ROOT_LADDER_DEFAULTS,
  campaignManifest,
  getPhaseManifest,
} from './campaign-manifest.js';
import { applyPhaseLabResources } from './phase-lab-config.js';
import { createPhaseLabSession } from './phase-lab.js';
import { updateContextPanel } from './hud-context.js';
import { computeEcologicalScore } from './ecological-score.js';
import { JETPACK_CONFIG, jetpackRechargeBonuses } from '../player-jetpack.js';
import { initPlayerTuning } from '../render/player-skin-tuning.js';
import { createSimulator } from './simulator.js';
import { createGameAudio } from '../game-audio.js';
import { createBiologicalAudio } from './biological-audio.js';
import {
  biologicalGroupsForProgress,
  PHASE_VICTORY_TOAST_SECONDS,
  VICTORY_AUDIO_FALLBACK_SECONDS,
} from '../audio-manifest.js';
import {
  advanceGameplayFrame,
  createTutorialInputGate,
} from './tutorial-pause.js';
import { createRenderer } from '../render/renderer.js';
import { BIOLOGICAL_PARALLAX_KEY } from '../render/rhizosphere-parallax.js';
import { createPlatformVisuals } from './platform-visuals.js';
import { createCameraView } from './camera-view.js';
import { createResponsiveCanvas } from './responsive-canvas.js';
import { getPrimaryTraversalPlatforms } from './traversal-route.js';
import { synchronizeWorldBounds } from './world-bounds.js';
import { createRhizoctoniaControl } from './rhizoctonia-control.js';
import { createTrichodermaMeloidogyneControl } from './trichoderma-meloidogyne-control.js';
import { createTrichodermaRhizoctoniaControl } from './trichoderma-rhizoctonia-control.js';
import { createRalstoniaVascularWilt } from './ralstonia-vascular-wilt.js';
import {
  advanceCampaignPhase,
  campaignPhaseSeed,
  // `campaignManifest` completo: o preload precisa da união das fases já
  // alcançadas, não só da atual.

  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
  recordPhaseResult,
  resetCampaign,
} from './campaign-progression.js';

const canvas = document.querySelector('canvas');
const responsiveCanvas = createResponsiveCanvas({ canvas, windowObject: window });
const ctx = canvas.getContext('2d');
const debugDiv = document.getElementById('debug');
const missionDiv = document.getElementById('mission');
const phaseCardDiv = document.getElementById('phase-card');
const hudBar = document.getElementById('hud-bar');
const stockDiv = document.getElementById('hud-stock');
const alertsDiv = document.getElementById('hud-alerts');
const toastDiv = document.getElementById('toast');

// Icones do HUD. Desenhados em vez de emoji porque emoji muda de forma e de cor
// conforme o sistema, e aqui a cor carrega significado.
const HUD_ICONS = Object.freeze({
  soil: '<path d="M3 15c2-3 5-3 7-1s5 2 8-1v7H3z" fill="#b07a4a"/><path d="M3 15c2-3 5-3 7-1s5 2 8-1" stroke="#e0a86c" stroke-width="1.6" fill="none"/><circle cx="8" cy="18" r="1.2" fill="#7a5233"/><circle cx="14" cy="19" r="1" fill="#7a5233"/>',
  hope: '<path d="M12 21c0-5 2-8 6-10-1 5-3 8-6 10z" fill="#79e07f"/><path d="M12 21c0-5-2-8-6-10 1 5 3 8 6 10z" fill="#4fbf75"/><path d="M12 21V9" stroke="#adf5b4" stroke-width="1.5"/>',
  exudate: '<path d="M12 3c3.4 4.3 5.4 7.2 5.4 9.6A5.4 5.4 0 0 1 6.6 12.6C6.6 10.2 8.6 7.3 12 3z" fill="#5fd6c8"/><path d="M9.6 13.2a2.6 2.6 0 0 0 2.4 2.6" stroke="#d6fff8" stroke-width="1.3" fill="none"/>',
  microbe: '<ellipse cx="12" cy="12" rx="6.4" ry="4.2" transform="rotate(-24 12 12)" fill="#6ce7df"/><path d="M5 17c-1.6 1-2.4 2-2.6 3M19 7c1.6-1 2.4-2 2.6-3" stroke="#9ff6ee" stroke-width="1.4" fill="none"/><circle cx="10.4" cy="11" r="1.1" fill="#093b3a"/>',
  phosphate: '<path d="m12 3 7 4.5v9L12 21l-7-4.5v-9z" fill="#c9a5ff"/><path d="m12 3 7 4.5v9L12 21l-7-4.5v-9z" stroke="#e6d4ff" stroke-width="1.2" fill="none"/><text x="12" y="15" font-size="8" font-weight="800" text-anchor="middle" fill="#3a1f63">P</text>',
});

// Diagnostico do sprite no painel de debug (Tab). Existe porque "a animacao nao
// apareceu" tem duas causas muito diferentes — a regra de estado nao disparou,
// ou disparou e a folha nao estava pronta e caiu no fallback — e olhando a tela
// as duas sao identicas. Esta linha separa as duas sem precisar de tentativa e
// erro.
// Linha de audio no painel do Tab. Separa "nao desbloqueou ainda" de "esta
// mudo" de "o arquivo falhou" — tres causas que na tela soam identicas.
function audioDiagnostico() {
  const info = gameAudio.debugSnapshot();
  if (!info.available) return 'Áudio: indisponível neste navegador';
  const ambientes = info.ambienceLayers.length
    ? info.ambienceLayers.map(id => id.replace('ambience', '').toLowerCase()).join('/')
    : 'nenhum';
  const proxima = info.nextDropIn === null
    ? 'tocando'
    : `${info.nextDropIn.toFixed(1)} s`;
  return `Áudio: ${info.unlocked ? 'unlocked' : 'locked'} · ${info.contextState}`
    + `${info.muted ? ' · MUDO' : ''} · ${info.musicTrackId || '—'}`
    + `${info.crossfadingTo ? ` → ${info.crossfadingTo}` : ''}`
    + `\nAmbientes: ${ambientes} · rootFlow ${Math.round(info.internalRootFlow * 1000) / 10}%`
    + `\nGota: ${info.currentDrop || '—'} · próxima em ${proxima}`
    + `\nÚltimo FX: ${info.lastFx || '—'}`
    + `\n${biologicalDiagnostico()}`
    + `${info.errors.length ? `\nErros: ${info.errors.slice(-2).join(' | ')}` : ''}`;
}

// Painel dos processos biológicos (Pacote 04). "Não ouvi o biofilme" tem causas
// muito diferentes — o loop nem começou, começou e foi despejado pelo limite de
// vozes, ou está tocando longe demais para ser audível — e na tela as três são
// idênticas. Aqui elas se separam.
function biologicalDiagnostico() {
  const bio = biologicalAudio.debugSnapshot();
  if (!bio.available) return 'Biológico: indisponível';
  const linhas = bio.loops.map(loop => (
    `  ${loop.instanceKey} · ${loop.trackId}`
    + ` · ganho ${loop.gain.toFixed(3)} · pan ${loop.pan >= 0 ? '+' : ''}${loop.pan.toFixed(2)}`
    + ` · rate ${loop.rate.toFixed(2)} · prio ${loop.priority} · ${Math.round(loop.distance)}px`
    + `${loop.paused ? ' · PAUSADO' : ''}${loop.pending ? ' · aguardando buffer' : ''}`
  ));
  return `Biológico: ${bio.activeLoopCount}/${bio.maximumLoopCount} loops`
    + ` (${bio.pendingLoopCount} pendentes) · último ${bio.lastEffect || '—'}`
    + `\nBuffers: ${bio.buffersLoaded} prontos / ${bio.buffersPending} carregando`
    + ` · cooldown bloqueou ${bio.blockedByCooldown} · distância rejeitou ${bio.rejectedByDistance}`
    + (linhas.length ? `\n${linhas.join('\n')}` : '');
}

function spriteDiagnostico() {
  const skin = renderer?.playerSkin;
  if (!skin) return 'Sprite: —';
  if (skin.id === 'astronaut') return 'Sprite: astronauta (desenhado)';
  const info = skin.debug();
  if (!info) return `Sprite: ${skin.id} (sem folhas)`;
  const prontas = info.folhas.filter(folha => folha.ready).map(folha => folha.name);
  const falharam = info.folhas.filter(folha => folha.failed).map(folha => folha.name);
  return `Sprite: ${skin.id} | pedido ${info.pedido || '—'} → desenhado ${info.desenhado || '—'}`
    + `${info.caiuNoFallback ? ' [FALLBACK]' : ''}`
    + `\nFolhas prontas: ${prontas.join(',') || 'nenhuma'}`
    + `${falharam.length ? ` | FALHARAM: ${falharam.join(',')}` : ''}`;
}

function hudIcon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${HUD_ICONS[name] || ''}</svg>`;
}

function renderStockChips(chips) {
  if (!stockDiv) return;
  const markup = chips.map(chip => (
    `<div class="stock-chip${chip.kind === 'hand' ? ' hand' : ''}">`
    + hudIcon(chip.icon)
    + `<div class="read"><span class="label">${chip.label}</span>`
    + `<span class="value">${chip.value}</span></div>`
    + (chip.key ? `<span class="key">${chip.key}</span>` : '')
    + (chip.swap ? `<span class="swap">${chip.swap}</span>` : '')
    + '</div>'
  )).join('');
  // Reescrever o HTML a cada quadro descarta a transicao e pesa; so troca
  // quando o conteudo muda mesmo.
  if (stockDiv.dataset.markup !== markup) {
    stockDiv.dataset.markup = markup;
    stockDiv.innerHTML = markup;
  }
}

function renderAlerts(alerts) {
  if (!alertsDiv) return;
  const markup = alerts
    .map(alert => `<div class="hud-alert${alert.grave ? ' grave' : ''}">${alert.text}</div>`)
    .join('');
  if (alertsDiv.dataset.markup !== markup) {
    alertsDiv.dataset.markup = markup;
    alertsDiv.innerHTML = markup;
  }
}

// Rotulos legiveis para o painel de objetivos: as condicoes do manifesto usam
// chaves tecnicas (ex.: opportunisticFungusVigor) que nao servem ao jogador.
const OBJECTIVE_LABELS = {
  activeMatureNoduleCount: 'Forme nódulos maduros fixando N₂',
  deployedExudateCount: 'Libere exsudatos na rizosfera',
  doubleJump: 'Domine o salto duplo (Azospirillum)',
  dash: 'Domine o impulso (dash)',
  ecologicalScore: 'Deixe o solo saudável e equilibrado',
  functionalBiofilmCount: 'Forme um biofilme funcional',
  functionalMycorrhizaPathCount: 'Estabeleça uma ponte micorrízica',
  performedDashCount: 'Use o Dash nesta tentativa',
  performedDoubleJumpCount: 'Execute um salto duplo nesta tentativa',
  mycorrhizalPhosphateTransported: 'Transporte fósforo pela micorriza',
  neutralizedEggMassCount: 'Neutralize uma massa de ovos de Meloidogyne',
  opportunisticFungusVigor: 'Reduza o vigor do fungo oportunista',
  controlledOpportunisticFungusCount: 'Reduza e mantenha o vigor de um fungo oportunista sob controle',
  preservedRootCount: 'Preserve uma raiz saudável',
  pseudomonasIronReserve: 'Acumule reserva de ferro (Pseudomonas)',
  reachedFinalRoot: 'Alcance a raiz final',
  preventedRalstoniaEntryCount: 'Impeça uma entrada de Ralstonia no xilema',
  containedVascularRalstoniaCount: 'Contenha uma infecção que já alcançou os vasos',
  activeCriticalRalstoniaCount: 'Chegue à raiz final sem murcha crítica ativa',
  blockedRalstoniaSpreadCount: 'Bloqueie uma disseminação para outra raiz',
  averageVascularTransport: 'Preserve o transporte vascular',
  preservedVascularRootCount: 'Preserve raízes com transporte funcional',
  recoveredRootCount: 'Recupere uma raiz danificada',
  rootPhosphateStock: 'Entregue fósforo à raiz-alvo',
  solubilizedPhosphateDepositCount: 'Solubilize o depósito de fosfato',
  totalFixationRate: 'Ative a fixação de nitrogênio',
  visibleLateralRootCount: 'Induza raízes laterais (Azospirillum)',
  mandatoryAzospirillumChallengeDeveloped: 'Amadureça a raiz lateral obrigatória (Azospirillum)',
  mandatoryAzospirillumChallengeTraversed: 'Cruze com a raiz lateral + salto duplo',
};

function objectiveLabel(req) {
  return OBJECTIVE_LABELS[req.key] || req.description || req.key;
}

// Telemetria da Propulsao da Rizosfera — no painel de debug existente (Tab), sem
// criar painel novo nem poluir o HUD.
function jetpackDebug(sim) {
  const player = sim.state.player;
  if (!player?.canJetpack) return '\nPropulsão: bloqueada nesta fase';
  const root = player.jetpackRechargeRoot;
  const bonuses = root
    ? jetpackRechargeBonuses({
        root, state: sim.state, systems: { inoculants: sim.beneficialInoculants },
      })
    : { rhizobium: 0, azospirillum: 0, mycorrhiza: 0, bacillus: 0, pseudomonas: 0 };
  const healthPercent = root ? Math.round(clamp(root.rootHealth ?? 1, 0, 1) * 100) : null;
  const pct = value => `${Math.round(value * 100)}%`;
  return `\nPropulsão: desbloqueada ✓ · ${player.jetpackActive ? 'ATIVA' : 'inativa'}`
    + ` · energia ${pct(player.jetpackEnergy)} · teto da raiz ${pct(player.jetpackRechargeCap)}`
    + ` · ${player.jetpackLockedUntilGround ? 'BLOQUEADA até pousar' : 'liberada'}`
    + `\nRecarga: raiz ${root ? `logicIndex ${root.logicIndex} (saúde ${healthPercent}%)` : '—'}`
    + ` · conexão ${player.jetpackConnectionTime.toFixed(2)}s/${JETPACK_CONFIG.connectionDelaySeconds}s`
    + ` · multiplicador ${player.jetpackRechargeMultiplier.toFixed(2)}×`
    + ` [Rhizobium +${bonuses.rhizobium.toFixed(2)} · Azo +${bonuses.azospirillum.toFixed(2)}`
    + ` · AM +${bonuses.mycorrhiza.toFixed(2)} · Bacillus +${bonuses.bacillus.toFixed(2)}`
    + ` · Pseudomonas +${bonuses.pseudomonas.toFixed(2)}]`
    + `\nVelocidade: vy ${Math.round(player.vy)} · vx ${Math.round(player.vx)}`;
}

// Telemetria da prova obrigatoria de Azospirillum — so no painel de debug (Tab),
// sem poluir o HUD normal. Serve para conferir, em qualquer seed, se a prova esta
// posicionada e dimensionada como deveria.
function azospirillumChallengeDebug(sim) {
  const challenge = sim.state.level.azospirillumChallenge;
  const renewable = sim.renewableExudates;
  if (!challenge) return '';
  const mandatoryLadder = (sim.state.level.azospirillumRootLadders || [])
    .find(ladder => ladder.mandatoryChallenge) || null;
  const actualReach = mandatoryLadder
    ? Math.round(challenge.hostPlatform.y - mandatoryLadder.endY)
    : 0;
  const nextInterval = renewable?.nextIntervalEstimate;
  return `\nDesafio Azo (obrigatório): host ${challenge.hostLogicIndex} → alvo ${challenge.targetLogicIndex}`
    + ` · ${challenge.interveningCount} blocos no meio (${challenge.interveningSoilCount} de solo)`
    + ` · subida ${challenge.rise}px`
    + ` · alcance exigido ${challenge.requiredReach}px / atual ${actualReach}px`
    + ` · sem escada: inalcançável ✓ / com escada: alcançável ✓`
    + ` · desenvolvido ${challenge.developed ? '✓' : '—'} / atravessado ${challenge.traversed ? '✓' : '—'}`
    + `\nExsudatos renováveis: ${renewable?.activeCount ?? 0} ativos`
    + ` · próximo em ${Number.isFinite(nextInterval) ? `${Math.max(0, nextInterval).toFixed(1)}s` : '—'}`
    + ` · emergência ${renewable?.emergencyActive ? 'ativa' : '—'}`;
}

function traversalEncounterDebug(level) {
  const details = level?.traversalEncounterStats?.details || [];
  if (!details.length) return '';
  const number = value => Number.isFinite(value) ? Math.round(value) : 0;
  return details.map(detail => (
    `\nRota ${detail.templateId} #${detail.logicIndex}: `
    + `${detail.primaryBlockCount ?? '-'} baixos / ${detail.optionalBlockCount ?? '-'} altos`
    + ` | tela ref ${number(detail.referenceScreenWorldWidth)}px`
    + ` | ${detail.encounterScreenCount ?? '-'} telas`
    + ` | span ${number(detail.encounterSpan ?? detail.horizontalSpan)}px`
    + ` | abre/aberta/fecha ${number(detail.openingSpan)}/${number(detail.openRouteSpan)}/${number(detail.closingSpan)}px`
    + ` | separacao ${number(detail.maximumSeparation ?? detail.maximumVerticalSeparation)}px`
    + ` | comprimento ${number(detail.safeRouteLength ?? detail.primaryRouteLength)}/${number(detail.hardRouteLength ?? detail.optionalRouteLength)}px`
    + ` | vao medio ${number(detail.primaryAverageGap)}/${number(detail.optionalAverageGap)}px`
    + ` | desnivel medio ${number(detail.primaryAverageVerticalDelta)}/${number(detail.optionalAverageVerticalDelta)}px`
    + ` | arestas avancadas ${detail.advancedCentralEdgeCount ?? 0}`
    + ` | refinamentos ${detail.safeRefinementCount ?? 0}/${detail.hardRefinementCount ?? 0}`
    + ` | geometria Y ${number(detail.geometryMinY)}..${number(detail.geometryMaxY)}`
    + ` | mundo Y ${number(level.worldTopY)}..${number(level.worldBottomY)}`
    + ` | rotas ${detail.primaryValidation || 'OK'}/${detail.optionalValidation || 'OK'}`
    + ` | fisica ${detail.physicalValidation === false ? 'FALHOU' : 'OK'}`
  )).join('');
}

function optionalDetourDebug(level) {
  const detours = level?.optionalDetours || [];
  if (!detours.length) return '';
  return detours.map(detour => {
    const validation = detour.validation || {};
    const movement = validation.movement || {};
    const moduleCounts = Object.entries(validation.platformsByModule || {})
      .map(([moduleId, count]) => `${moduleId}:${count}`)
      .join(', ');
    const phosphate = validation.phosphateGate || {};
    return `\nDesvio opcional ${detour.id}: chunks ${detour.startLogicIndex}->${detour.endLogicIndex}`
      + ` | candidatos ${detour.candidateCount ?? 0}`
      + ` | escolhido ${detour.candidateId || '-'}`
      + ` | score ${Number(detour.candidateSoftScore || 0).toFixed(1)}`
      + ` | avisos ${(detour.candidateSoftWarnings || []).join(',') || '-'}`
      + ` | ${detour.targetScreenCount} telas / span ${Math.round(detour.actualWorldSpan)}px`
      + `\n  entrada x/y ${Math.round(detour.accessLandingX)}/${Math.round(detour.accessLandingY)}`
      + ` | avanço ${Math.round(detour.accessHorizontalAdvance)}px`
      + ` | subida ${Math.round(detour.accessVerticalRise)}px`
      + ` | cruzeiro y ${Math.round(detour.cruiseLaneY)}`
      + `\n  transição ${Math.round(detour.transitionWorldSpan)}px`
      + ` / ${detour.transitionPlatformCount} plataformas`
      + ` | movimento ${detour.movementPlatformCount}`
      + ` | principal ${detour.primaryProfile || '-'}`
      + ` | macro ${detour.hardMacroProfile || detour.cruiseProfileId || '-'}`
      + ` | transição ${detour.transitionFamilyId || '-'}`
      + `\n  Y ${(movement.ySequence || []).map(value => Math.round(value)).join(' -> ') || '-'}`
      + ` | amplitude ${Math.round(movement.hardVerticalAmplitude || 0)}px`
      + ` | sobe/desce ${movement.hardClimbCount || 0}/${movement.hardDropCount || 0}`
      + ` | separação ${Math.round(detour.minimumPreRejoinSeparation || 0)}px`
      + ` convergências=${detour.prematureConvergenceCount || 0}`
      + ` | arestas=${movement.everyEdgeValid ? 'OK' : 'FALHOU'}`
      + ` combo-only=${movement.comboOnlyEdgeCount || 0}`
      + ` invalidas=${movement.invalidEdgeCount || 0}`
      + ` | visível 1x=${detour.accessVisibleAtZoom1 ? 'sim' : 'não'}`
      + ` 1.45x=${detour.accessVisibleAtZoom145 ? 'sim' : 'não'}`
      + ` | ${detour.accessModuleId} -> ${(detour.challengeModuleIds || []).join(',')} -> ${detour.exitModuleId}`
      + ` | ${detour.optionalPlatformIds.length} plataformas [${moduleCounts || '-'}]`
      + `\n  B2 sequencia=${detour.selectedSequenceId || '-'}`
      + ` slots=${(detour.slotAllocation?.slots || []).map(slot => (
        `${slot.slotIndex}:${slot.moduleId}:${Math.round(slot.allocatedSpan)}`
      )).join('|') || '-'}`
      + ` fosfato=${detour.phosphateVariant || '-'}`
      + `/${detour.phosphatePositionClass || '-'}`
      + ` movimento=${detour.structuralSignature?.movementModuleCount ?? 0}`
      + ` span=${Math.round(detour.phosphateGateSpan || 0)}`
      + ` conectores=${detour.connectorPlatformIds?.length || 0}`
      + ` deposito=${detour.phosphateDepositId || '-'}:${detour.phosphateDepositInitialState || '-'}`
      + ` bacillus=${detour.bacillusColonyId || '-'}`
      + ` fallback=${detour.compositionFallback ? 'sim' : 'nao'}`
      + ` motivo=${detour.compositionFallbackReason || '-'}`
      + ` | gate deposito=${phosphate.depositExists ? 'sim' : 'nao'}`
      + ` bacillus=${phosphate.bacillusExists ? 'sim' : 'nao'}`
      + ` | clearance ${validation.clearanceViolations?.length || 0}`
      + ` | hash ${validation.primaryRouteGeometryHashBefore || detour.primaryRouteGeometryHashBefore}`
      + `/${validation.primaryRouteGeometryHashAfter || detour.primaryRouteGeometryHashAfter}`
      + ` ${validation.primaryRouteGeometryUnchanged ? 'OK' : 'FALHOU'}`
      + ` | torre suprimida=${detour.towerSuppressedForOptionalDetourPlaytest ? 'sim' : 'não'}`
      + ` | validacao ${validation.valid ? 'OK' : (validation.failures || []).join(',')}`;
  }).join('');
}

// Painel do §21. Só o modo T1 o produz; o CP2 continua com `optionalDetourDebug`.
function topologyDetourDebug(level) {
  const detour = (level?.optionalDetours || [])
    .find(entry => entry.implementationStage === 'T1');
  if (!detour) {
    if (!level?.optionalDetourTopologyMode) return '';
    const composition = level.optionalDetourComposition || {};
    return `\nTOPOLOGIA T1: nenhuma sintese aceita`
      + `\n  MOTIVOS: ${(composition.failureReasons || []).slice(0, 4).join(' / ') || '-'}`;
  }
  const signature = detour.structuralSignature || {};
  const silhouette = detour.silhouette || {};
  return `\nTOPOLOGIA: ${detour.topologyFamily} (${detour.topologyFamilyLabel})`
    + `\nZONAS: ${(signature.zoneRoles || []).join(' > ')}`
    + `\n  intencoes: ${(signature.zoneVerticalIntents || []).join(' > ')}`
    + `\n  plataformas/zona: ${(signature.platformCountPerZone || []).join('-')}`
    + `\nDESAFIO: ${detour.challengeId} (${detour.challengeFamily})`
    + `\nZONA DO DESAFIO: ${detour.challengeZoneId} | ${detour.challengePositionClass}`
    + `\nAMPLITUDE: ${silhouette.verticalRange}px`
    + ` | monotonia ${silhouette.monotonicShare} | plano ${silhouette.flatShare}`
    + `\nSUBIDAS/DESCIDAS: ${silhouette.climbCount}/${silhouette.dropCount}`
    + `\nTENTATIVAS: topologias ${detour.topologyAttempts}`
    + ` | atribuicoes ${detour.challengeAssignmentAttempts}`
    + ` | sinteses ${detour.geometryAttempts}`
    + ` | falhas ${detour.failureReasons?.length || 0}`
    + `\nDROP REJOIN: ${detour.dropRejoinDirect ? 'queda direta' : 'INDIRETA'}`
    + ` | plataformas no corredor ${detour.dropRejoinPlatformCount}`
    + ` | corredor ${detour.dropCorridorSpan}px`
    + `\nSEPARACAO MINIMA DA ROTA FACIL: ${detour.minimumPrimaryClearance ?? '-'}px`
    + ` (contrato ${detour.primaryClearanceContract}px)`
    + ` | violacoes ${detour.primaryClearanceViolationCount}`
    + `\nASSINATURA: ${JSON.stringify(signature)}`
    + `\n  vaos: ${(detour.intentionalGaps || []).map(gap => gap.kind).join(',') || '-'}`
    + ` | conectores ${detour.connectorCount}`
    + ` | validacao ${detour.validation?.valid ? 'OK' : (detour.validation?.failures || []).join(',')}`;
}

// Um requisito com `displayMode: 'final-status'` nao e conquista acumulativa: e
// um STATUS que precisa valer no momento da conclusao. Mostra-lo verde no
// primeiro quadro (quando ainda nao existe nenhum foco) faz o jogador acreditar
// que ja cumpriu algo — foi exatamente a queixa "um objetivo ja vem concluido".
function finalStatusClass(condition, result) {
  if (condition.key !== 'activeCriticalRalstoniaCount') {
    return result?.passed ? 'stable' : 'violated';
  }
  const criticos = Number(result?.actual) || 0;
  if (criticos > 0) return 'violated';
  if (levelData?.goal?.completed) return 'completed';
  return ralstoniaControl.challengeStarted ? 'stable' : 'pending-status';
}

function finalStatusNote(condition, result) {
  if (condition.key !== 'activeCriticalRalstoniaCount') return '';
  const criticos = Number(result?.actual) || 0;
  if (criticos > 0) return `Murcha crítica ativa: ${criticos}`;
  if (levelData?.goal?.completed) return 'Concluído sem murcha crítica';
  if (!ralstoniaControl.challengeStarted) return '';
  return 'Situação estável: nenhum foco crítico';
}

function renderObjectives(campaign, evaluator) {
  const listDiv = document.getElementById('objective-list');
  const finalTest = getPhaseManifest(campaign.phase)?.finalTest;
  
  if (!listDiv || !finalTest?.requires) {
    if (listDiv && listDiv.innerHTML !== '') listDiv.innerHTML = '';
    return;
  }

  const evaluation = evaluator.evaluate(finalTest.requires);
  let html = '';
  for (const [index, req] of finalTest.requires.entries()) {
    const isCompleted = evaluation.results[index]?.passed === true;
    const classe = req.displayMode === 'final-status'
      ? finalStatusClass(req, evaluation.results[index])
      : (isCompleted ? 'completed' : '');
    const nota = req.displayMode === 'final-status'
      ? finalStatusNote(req, evaluation.results[index])
      : '';
    html += `
      <div class="objective-item ${classe}">
        <div class="circle"></div>
        <div class="text">${objectiveLabel(req)}${nota ? `<span class="note">${nota}</span>` : ''}</div>
      </div>
    `;
  }
  
  if (listDiv.dataset.markup !== html) {
    listDiv.dataset.markup = html;
    listDiv.innerHTML = html;
  }

  if (!listDiv.dataset.touchInit) {
    listDiv.dataset.touchInit = 'true';
    listDiv.addEventListener('pointerdown', (e) => {
      const item = e.target.closest('.objective-item');
      if (item) {
        if (item._autoTimer) clearTimeout(item._autoTimer);
        item.classList.toggle('expanded');
        if (item.classList.contains('expanded')) {
          item._autoTimer = setTimeout(() => {
            item.classList.remove('expanded');
            item._autoTimer = null;
          }, 4000);
        }
      }
    });
  }

  const contextDiv = document.getElementById('hud-context');
  if (contextDiv && !contextDiv.dataset.touchInit) {
    contextDiv.dataset.touchInit = 'true';
    const toggleGauge = (e) => {
      const gauge = e.target.closest('.mobile-gauge-item');
      if (gauge && gauge.dataset.label) {
        const label = gauge.dataset.label;
        window._activeGauges = window._activeGauges || new Set();
        if (window._activeGauges.has(label)) {
          window._activeGauges.delete(label);
        } else {
          window._activeGauges.add(label);
          setTimeout(() => {
            if (window._activeGauges) window._activeGauges.delete(label);
          }, 4000);
        }
      }
    };
    contextDiv.addEventListener('pointerdown', toggleGauge);
    contextDiv.addEventListener('click', toggleGauge);
  }
}
const dashTouchButton = document.querySelector('[data-key="ShiftLeft"]');
const selectionTouchButton = document.querySelector('[data-key="ArrowDown"]');
const jetpackTouchButton = document.getElementById('touch-jetpack');

// O botao PROPULSOR so existe depois do desbloqueio, e o aro dele e o unico
// indicador de energia (nada de barra grande no HUD). Aqui so mudam CLASSES e a
// variavel CSS — o HTML do botao nunca e reescrito a cada quadro.
let lastJetpackClass = '';
let lastJetpackRatio = -1;
function updateJetpackTouchButton(player) {
  if (!jetpackTouchButton) return;
  const unlocked = Boolean(player?.canJetpack);
  if (jetpackTouchButton.hidden === unlocked) jetpackTouchButton.hidden = !unlocked;
  if (!unlocked) return;

  const ratio = Math.max(0, Math.min(1, player.jetpackEnergy || 0));
  if (Math.abs(ratio - lastJetpackRatio) > .004) {
    jetpackTouchButton.style.setProperty('--jetpack-ratio', ratio.toFixed(3));
    lastJetpackRatio = ratio;
  }
  const recharging = player.onGround
    && player.jetpackConnectionTime > 0
    && ratio < (player.jetpackRechargeCap || 0);
  const nextClass = player.jetpackActive ? 'jetpack-active'
    : recharging ? 'jetpack-recharging'
    : ratio <= 0 ? 'jetpack-empty'
    : ratio >= .999 ? 'jetpack-full'
    : 'jetpack-partial';
  if (nextClass === lastJetpackClass) return;
  jetpackTouchButton.classList.remove(
    'jetpack-empty', 'jetpack-partial', 'jetpack-full', 'jetpack-active', 'jetpack-recharging',
  );
  jetpackTouchButton.classList.add(nextClass);
  lastJetpackClass = nextClass;
}

let campaignStorage = null;
try { campaignStorage = window.sessionStorage; } catch (_) {}
// O ajuste do sprite vale em qualquer partida, nao so dentro do Phase Lab:
// precisa ser carregado antes de o renderizador desenhar o primeiro quadro.
initPlayerTuning((() => { try { return window.localStorage; } catch (_) { return null; } })());

const phaseLab = createPhaseLabSession({ windowObject: window });
if (phaseLab.enabled) campaignStorage = null;
const optionalDetourVariant =
  new URLSearchParams(window.location.search).get('v');

// O T1 é um modo NOVO e isolado. O CP2 continua chamando exatamente o
// compositor B2: os dois nunca compartilham resultado.
const optionalDetourTopologyMode =
  optionalDetourVariant === 'optional-detour-topology-t1';

const optionalDetourPlaytestMode = [
  'optional-detour-cp1',
  'optional-detour-cp2',
].includes(optionalDetourVariant) || optionalDetourTopologyMode;

let sim = null;

// O controlador nasce ANTES do simulador e recebe getters preguiçosos: ele
// precisa ler `sim.state` durante o jogo, mas o simulador precisa recebê-lo na
// construção. Sem os getters isso seria dependência circular.
const gameAudio = createGameAudio({
  documentRef: document,
  windowRef: window,
  getState: () => sim?.state,
  getCampaign: () => campaign,
});
gameAudio.init();

// Gerenciador de loops dos processos biológicos. Usa o MESMO AudioContext do
// controlador (via `getAudioBridge`) — nunca cria um segundo.
const biologicalAudio = createBiologicalAudio({
  gameAudio,
  getState: () => sim?.state,
});

sim = createSimulator({ audio: gameAudio, biologicalAudio });
const campaign = createCampaign(phaseLab.enabled ? phaseLab.config.seed : undefined, { storage: campaignStorage });
if (phaseLab.enabled) phaseLab.configureCampaign(campaign);
sim.state.campaign = campaign;
const cameraView = createCameraView({ canvas, state: sim.state });
window.miguelitoViewport = responsiveCanvas;
const rhizoctoniaControl = createRhizoctoniaControl({
  state: sim.state,
  entities: sim.entities,
  pseudomonas: sim.pseudomonasSiderophores,
});
const trichodermaMeloidogyneControl = createTrichodermaMeloidogyneControl({
  state: sim.state,
  entities: sim.entities,
  colonies: sim.trichodermaColonies,
  lifecycle: sim.meloidogyneLifecycle,
});
const trichodermaRhizoctoniaControl = createTrichodermaRhizoctoniaControl({
  state: sim.state,
  entities: sim.entities,
  colonies: sim.trichodermaColonies,
});
const ralstoniaControl = createRalstoniaVascularWilt({
  state: sim.state,
  entities: sim.entities,
  inoculants: sim.beneficialInoculants,
  pseudomonas: sim.pseudomonasSiderophores,
});
const objectiveEvaluator = createCampaignObjectiveEvaluator({
  state: sim.state,
  systems: {
    gameplay: sim.gameplay,
    inoculants: sim.beneficialInoculants,
    pseudomonas: sim.pseudomonasSiderophores,
    opportunisticFungus: sim.opportunisticFungus,
    trichoderma: trichodermaRhizoctoniaControl,
    meloidogyneControl: trichodermaMeloidogyneControl,
    phosphate: sim.phosphateSolubilization,
    ralstonia: ralstoniaControl,
  },
});
const fixedBlockRuntime = createFixedBlockRuntime({
  state: sim.state,
  evaluator: objectiveEvaluator,
  entities: sim.entities,
  ecology: sim.ecology,
});
sim.goal.setCompletionGuard(() => {
  const finalTest = getPhaseManifest(campaign.phase)?.finalTest;
  if (!finalTest) return { passed: true };
  const conditions = (finalTest.requires || []).filter(condition => !(
    condition.type === 'worldState' && condition.key === 'reachedFinalRoot'
  ));
  if (!conditions.length) return { passed: true };
  const result = objectiveEvaluator.evaluate(conditions);
  return {
    passed: result.passed,
    message: campaign.phase === 5
      ? 'A raiz final exige a reserva mínima de ferro e o controle funcional do vigor fúngico.'
      : 'A raiz final aguarda a conclusão do objetivo ecológico indicado.',
  };
});
let profile = null;
let seed = '';
let levelData = null;
let renderer = null;
let platformVisuals = null;
let biologicalParallaxEnabled = true;
// O console de telemetria e ferramenta de desenvolvimento, nao HUD de jogo:
// nasce ligado so dentro do Phase Lab. Fora dele continua acessivel pelo Tab
// (e pelo botao (i) no celular) para quando eu precisar dele numa partida real.
let showDebug = phaseLab.enabled;
debugDiv.classList.toggle('hidden', !showDebug);
let soundButtonUnlocked = false;
let lastTime = performance.now();
let lastToast = '';
let loopErrorCount = 0;
// Depois disso a falha e claramente permanente e insistir so gasta quadro.
const LOOP_ERROR_LIMIT = 240;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function installFinalGoal(level) {
  if (level.goal) return;
  const routePlatforms = getPrimaryTraversalPlatforms(level);
  const last = routePlatforms[routePlatforms.length - 1];
  const finalPlatform = {
    x: last.x + last.w + 78,
    y: clamp(last.y + 18, 300, 545),
    w: 340,
    h: 96,
    type: 'root',
    final: true,
    logicIndex: level.debugInfo.length,
  };
  level.platforms.push(finalPlatform);
  level.goal = {
    x: finalPlatform.x + finalPlatform.w - 92,
    y: finalPlatform.y - 132,
    radius: 78,
    completed: false,
  };
  level.endX = finalPlatform.x + finalPlatform.w + 150;
  level.cameraMaxX = Math.max(0, level.endX - 1000);
}

function prepareLevel() {
  profile = prepareCampaignGeneration(campaign);
  seed = campaignPhaseSeed(campaign);
  levelData = generateLevel(seed, {
    referenceScreenWorldWidth: canvas.width,
    referenceScreenWorldHeight: canvas.height,
    suppressTowerSafeFall: optionalDetourPlaytestMode && campaign.phase === 10,
  });
  levelData.optionalDetourPlaytestMode = optionalDetourPlaytestMode;
  const traceGeometry = stage => (
    campaign.phase === 3 ? recordRouteGeometryStage(levelData, stage) : null
  );
  traceGeometry('generateLevel');
  applyPhaseFourMycorrhizaIntro(
    levelData,
    campaign.phase,
    getPhaseManifest(campaign.phase)?.mycorrhizaBridge,
  );
  applyPhaseFiveTutorialGeometry(levelData, campaign.phase);
  applyPhaseSixTutorialGeometry(levelData, campaign.phase);
  levelData = decorateCampaignLevel(levelData, campaign, profile);
  applyPhaseOneVerticalSlice(levelData, campaign.phase);
  traceGeometry('decorateCampaignLevel');
  const routeAnchors = createRouteAnchorRegistry(levelData);
  routeAnchors.capture();
  // Garante que a mecanica-tema da fase seja necessaria ao menos uma vez.
  applySignatureChallenge(levelData, campaign.phase);
  traceGeometry('applySignatureChallenge');
  const optionalDetourAbilities = [
      ...(campaign.unlocks?.doubleJump ? ['doubleJump'] : []),
      ...(campaign.unlocks?.dash ? ['dash'] : []),
      ...(campaign.unlocks?.phosphateSolubilization
        ? ['phosphateSolubilization']
        : []),
      ...(campaign.unlocks?.mycorrhizaStructures
        ? ['mycorrhizaStructures']
        : []),
  ];
  const optionalDetour = optionalDetourTopologyMode
    ? createPhaseTenTopologyDetour({
        level: levelData,
        phase: campaign.phase,
        seedValue: seed,
        abilities: optionalDetourAbilities,
      })
    : createPhaseTenOptionalDetour({
        level: levelData,
        phase: campaign.phase,
        seedValue: seed,
        abilities: optionalDetourAbilities,
      });
  if (phaseLab.enabled) applyPhaseLabResources(levelData, getPhaseManifest(campaign.phase), seed);
  applyPhaseSevenPhosphateGeometry(
    levelData,
    campaign.phase,
    getPhaseManifest(campaign.phase)?.phosphateSolubilization,
  );
  levelData.microbeEncounters = generateCampaignEncounters({
    platforms: levelData.platforms,
    phase: campaign.phase,
    seedValue: seed,
  }).concat(levelData.authoredEncounters || []);
  levelData.microbeEncounters = applyPhaseFiveTutorialEncounters(
    levelData,
    levelData.microbeEncounters,
    campaign.phase,
    seed,
  );
  levelData.microbeEncounters = applyPhaseSixTutorialEncounters(
    levelData,
    levelData.microbeEncounters,
    campaign.phase,
  );
  const declaredAzospirillumLadder = getPhaseManifest(campaign.phase)?.azospirillumRootLadder;
  const contextualAzospirillumLadder = campaign.phase >= 5
    && campaign.unlocks.azospirillumRoots
    ? {
        ...AZOSPIRILLUM_ROOT_LADDER_DEFAULTS,
        count: 2,
        knownSkill: true,
        preserveDestinationHeight: true,
      }
    : null;
  generateAzospirillumRootLadders({
    level: levelData,
    phase: campaign.phase,
    seedValue: seed,
    encounters: levelData.microbeEncounters,
    config: declaredAzospirillumLadder?.enabled === false
      ? null
      : declaredAzospirillumLadder || contextualAzospirillumLadder,
  });
  // `validateOptionalDetour` conhece o vocabulário do B2 (sequência de módulos,
  // entrada combo obrigatória, slots). Um desvio T1 não tem nada disso e já
  // trouxe a própria validação do §19 — revalidá-lo aqui só produziria falhas
  // sobre campos que ele nunca teve.
  if (optionalDetour && optionalDetour.implementationStage !== 'T1') {
    optionalDetour.validation = validateOptionalDetour(levelData, optionalDetour);
    optionalDetour.primaryRouteGeometryHashAfter =
      optionalDetour.validation.primaryRouteGeometryHashAfter;
  }
  traceGeometry('generateAzospirillumRootLadders');
  generateUnderdevelopedNitrogenRoots({
    level: levelData,
    phase: campaign.phase,
    seedValue: seed,
    encounters: levelData.microbeEncounters,
    config: getPhaseManifest(campaign.phase)?.nitrogenRoot,
  });
  traceGeometry('generateUnderdevelopedNitrogenRoots');
  // O pipeline de campanha NUNCA insere plataformas depois dos desafios. A
  // traversabilidade e auditada; travessias intencionais sao resolvidas pelas
  // proprias mecanicas (raiz nitrogenada com FBN, ponte micorrizica, raiz
  // lateral de Azospirillum, conclusao de bloco autoral).
  //
  // Aqui existia `enforceTraversableRoute`, que inseria um degrau `safetyStep`
  // em qualquer vao que a fisica julgasse impossivel. Como ela rodava DEPOIS de
  // `generateUnderdevelopedNitrogenRoots`, o vao proposital da raiz nitrogenada
  // era lido como falha e recebia um bloco solido embaixo da raiz
  // subdesenvolvida: o portao da FBN ficava atravessavel sem nodulo nenhum.
  levelData.routeAudit = auditTraversableRoute(
    levelData,
    {
      doubleJump: Boolean(campaign.unlocks?.doubleJump),
      dash: Boolean(campaign.unlocks?.dash),
    },
    {
      abilitiesUnlockedDuringPhase: Object.fromEntries(
        (getPhaseManifest(campaign.phase)?.unlockEvents || [])
          .filter(event => event.feature === 'doubleJump' || event.feature === 'dash')
          .map(event => [event.feature, true]),
      ),
      // Capacidades que as primitivas de salto nao modelam, mas o jogador tem.
      mycorrhizaStructuresAvailable: Boolean(campaign.unlocks?.mycorrhizaStructures)
        || (getPhaseManifest(campaign.phase)?.unlockEvents || [])
          .some(event => event.feature === 'mycorrhizaStructures'),
      jetpackAvailable: Boolean(campaign.unlocks?.jetpack)
        || (getPhaseManifest(campaign.phase)?.unlockEvents || [])
          .some(event => event.feature === 'jetpack'),
    },
  );
  traceGeometry('auditTraversableRoute');
  // Inclui encontros e recursos criados depois do desafio, preservando os
  // offsets capturados antes dele para as entidades que ja existiam.
  routeAnchors.capture();
  routeAnchors.synchronize();
  anchorPowerPickups(levelData);
  installFinalGoal(levelData);
  applyInitialRootHealth(levelData, campaign.phase);
  synchronizeWorldBounds(levelData);
}

// Saúde da raiz como feedback central: as raízes começam DANIFICADAS e só sobem
// a 100% quando o jogador aplica benéficos (a recuperação autônoma foi zerada em
// root-health-gameplay). ~65% por padrão; ~50% (45-58%) em fases com fungo
// oportunista, Rhizoctonia ou Ralstonia. Roda depois de installFinalGoal para já
// excluir a raiz final marcada.
function phaseHasRootSickness(phase) {
  const manifest = getPhaseManifest(phase);
  if (!manifest) return false;
  if (manifest.opportunisticFungus) return true;
  return (manifest.pathogenDebuts || []).some(
    debut => debut.pathogen === 'rhizoctonia' || debut.pathogen === 'ralstonia',
  );
}

function applyInitialRootHealth(level, phase) {
  const sick = phaseHasRootSickness(phase);
  for (const root of level.platforms || []) {
    if (root.type !== 'root') continue;
    if (root.final || root.recovery || root.mycorrhizaStructure || root.azospirillumStructure) continue;
    if (!Number.isInteger(root.logicIndex) || root.logicIndex < 0) continue; // plataforma inicial fica saudável
    // Variação leve e determinística pela posição, para as raízes não ficarem
    // todas idênticas.
    const jitter = (Math.abs(Math.sin(root.x * 12.9898) * 43758.5453) % 1);
    const health = sick ? 0.45 + jitter * 0.13 : 0.60 + jitter * 0.10;
    root.rootHealth = health;
    root.rootGameplayDamage = 1 - health;
  }
}

// Os pickups de poder (fitohormonios: power-jump/power-dash/power-pulse) tem que
// ser coletaveis SEM o poder que concedem. Se o desafio-assinatura/escada elevou
// a plataforma do evento, o pickup do salto duplo ficava num bloco que so o
// proprio salto duplo alcanca — um bootstrap-softlock. Este passo re-ancora cada
// pickup a uma plataforma alcancavel por salto simples a partir da anterior.
function anchorPowerPickups(level) {
  const route = getPrimaryTraversalPlatforms(level);
  if (!route.length) return;
  for (const ally of level.allies || []) {
    if (typeof ally.id !== 'string' || !ally.id.startsWith('power-')) continue;
    let idx = route.findIndex(p => p.logicIndex === ally.logicIndex);
    if (idx < 0) {
      idx = route.reduce((best, p, i) => (
        Math.abs(p.x - ally.x) < Math.abs(route[best].x - ally.x) ? i : best
      ), 0);
    }
    // Recua enquanto a plataforma hospedeira exigir mais que um salto simples
    // (~92px de subida) a partir da anterior — garante que da para chegar la sem
    // o poder ainda nao adquirido.
    while (idx > 0 && route[idx - 1].y - route[idx].y > 92) idx--;
    const host = route[idx];
    ally.x = host.x + host.w / 2;
    ally.y = host.y - 28;
    ally.logicIndex = host.logicIndex;
    ally.anchoredPlatform = true;
  }
}

const FEATURE_LABELS = {
  doubleJump: 'salto duplo',
  dash: 'Dash',
  phosphateSolubilization: 'Solubilizacao de fosfato',
  mycorrhizaStructures: 'pontes micorrízicas horizontais',
  azospirillumRoots: 'escadas radiculares de Azospirillum',
};

function phaseIntroText() {
  if (!profile.unlockEvents.length) return profile.mission;
  const names = profile.unlockEvents.map(event => FEATURE_LABELS[event.feature] || event.feature).join(' e ');
  return `Desbloqueios desta fase: ${names}. Cada poder só será exigido depois do chunk de aquisição.`;
}

function updateTouchAbilityVisibility() {
  if (dashTouchButton) {
    dashTouchButton.hidden = !sim.state.player.canDash;
    dashTouchButton.disabled = !sim.state.player.canDash;
  }
  if (selectionTouchButton) selectionTouchButton.disabled = false;
}

// Carrega os grupos de áudio biológico que ESTA fase pode usar, derivados do
// manifesto e dos desbloqueios já conquistados — nunca do nome da música (a
// fase 5 toca o tema da Pseudomonas e usa micorriza, Bacillus e fósforo).
//
// Não bloqueia nada: as promessas ficam soltas, e um som pedido antes de o
// arquivo chegar tem lazy-load defensivo com janela de 80 ms.
function preloadPhaseBiologicalAudio() {
  const organismos = (sim?.inoculumSelection?.options?.() || [])
    .map(option => option.type || option.kind)
    .filter(Boolean);
  const grupos = biologicalGroupsForProgress({
    manifests: campaignManifest,
    phase: campaign.phase,
    unlocks: campaign.unlocks,
    availableOrganisms: organismos,
  });
  for (const group of grupos) gameAudio.preloadBiologicalGroup(group);
  return grupos;
}

function initGame({ announce = false } = {}) {
  sim.reset();
  rhizoctoniaControl.reset();
  trichodermaRhizoctoniaControl.reset();
  trichodermaMeloidogyneControl.reset();
  ralstoniaControl.reset();
  sim.state.campaign = campaign;
  // Nao reinicia audio: `setPhase` compara a faixa mapeada com a que ja toca e
  // so faz crossfade quando muda. Reset da campanha nao recria contexto nem
  // duplica ambientes.
  gameAudio.setPhase(campaign.phase);
  preloadPhaseBiologicalAudio();
  Object.assign(sim.state.level, levelData);
  sim.state.player.x = 100;
  sim.state.player.y = 400;
  sim.state.gameState = 'play';
  sim.state.mission = profile.mission;
  cameraView.resetTracking();
  sim.resetEcology(levelData.microbeEncounters);
  sim.resetBiology();
  ralstoniaControl.initialize();
  renderer = createRenderer({
    canvas,
    state: sim.state,
    entities: sim.entities,
    parallaxSeed: seed || `campaign-phase-${campaign.phase}`,
  });
  renderer.parallaxBackground.setEnabled(biologicalParallaxEnabled);
  platformVisuals = createPlatformVisuals({ state: sim.state });
  toastDiv.className = '';
  lastToast = '';
  updateTouchAbilityVisibility();

  // O gerador cria simuladores auxiliares para validar a geometria. Somente
  // esta instância controla o jogo visível e deve alimentar integrações como
  // o sistema de tutoriais e o diagnóstico exposto no navegador.
  window.miguelitoSim = sim;

  // A abertura da fase nao e narracao: e um cartao de titulo. Ela era anunciada
  // como toast e ao mesmo tempo ficava fixa no canto esquerdo — a mesma frase
  // duas vezes, uma delas para sempre. Agora aparece grande no centro, uma vez,
  // e sai.
  // Segunda passada: agora o seletor de inóculo e os sistemas existem, então os
  // organismos realmente disponíveis entram na conta. A primeira passada (logo
  // após `setPhase`) roda cedo demais para enxergar isso, e o cache impede
  // qualquer download repetido.
  preloadPhaseBiologicalAudio();

  if (announce) showPhaseCard(`Fase ${campaign.phase}`, profile.title, phaseIntroText());
}

let phaseCardTimer = null;

function showPhaseCard(eyebrow, title, subtitle) {
  if (!phaseCardDiv) return;
  phaseCardDiv.innerHTML = `<span class="eyebrow">${eyebrow}</span>`
    + `<span class="title">${title}</span>`
    + `<span class="subtitle">${subtitle}</span>`;
  phaseCardDiv.classList.remove('show', 'leaving');
  // Forca o reinicio da animacao quando duas fases se sucedem rapido.
  void phaseCardDiv.offsetWidth;
  phaseCardDiv.classList.add('show');
  clearTimeout(phaseCardTimer);
  phaseCardTimer = setTimeout(() => {
    phaseCardDiv.classList.add('leaving');
    phaseCardTimer = setTimeout(() => phaseCardDiv.classList.remove('show', 'leaving'), 1100);
  }, 3400);
}

function startNewCampaign() {
  if (phaseLab.enabled) {
    phaseLab.configureCampaign(campaign);
    for (const cardId of campaign.tutorialBootstrapSeen || []) {
      window.miguelitoTutorial?.markSeen?.(cardId);
    }
    sim.state.discoveredMicrobes.clear();
    prepareLevel();
    initGame({ announce: true });
    return;
  }
  resetCampaign(campaign);
  sim.state.discoveredMicrobes.clear();
  prepareLevel();
  initGame({ announce: true });
}

function buildPhaseReport() {
  const scoredRoots = (sim.state.level.platforms || []).filter(root => root.type === 'root' && !root.final && !root.recovery && !root.mycorrhizaStructure);
  const rootHealth = scoredRoots.length
    ? scoredRoots.reduce((sum, root) => sum + clamp(root.rootHealth ?? 1, 0, 1), 0) / scoredRoots.length
    : 1;
  const infestation = clamp((sim.meloidogyneLifecycle.infestationPercent || 0) / 100, 0, 1);
  const fixation = Math.max(0, (sim.state.level.rhizobiumNodules || []).reduce((sum, site) => sum + (site.fixationRate || 0), 0));
  const protection = Math.min(1, (sim.bacillusBioprotection.protectedRootCount || 0) / 4);
  const vascularTransport = clamp(ralstoniaControl.averageTransport, 0, 1);
  const score = Math.round(
    rootHealth * 40
    + (1 - infestation) * 20
    + Math.min(1, fixation / 10) * 15
    + protection * 15
    + vascularTransport * 10,
  );
  const finalTest = getPhaseManifest(campaign.phase)?.finalTest;
  const objectiveResults = objectiveEvaluator.evaluate(finalTest?.requires || []).results.map(result => ({
    conditionId: result.conditionId,
    key: result.condition.key,
    actual: result.actual,
    passed: result.passed,
  }));
  return {
    phase: campaign.phase,
    title: profile.title,
    theme: profile.theme,
    rootHealth: Math.round(rootHealth * 100),
    infestation: Math.round(infestation * 100),
    fixation: Number(fixation.toFixed(1)),
    protectedRoots: sim.bacillusBioprotection.protectedRootCount || 0,
    vascularTransport: Math.round(vascularTransport * 100),
    objectiveResults,
    score,
  };
}

// Alterna o som. Unico ponto: o botao mobile e a tecla M chamam esta mesma API.
//
// O PRIMEIRO acionamento com o audio ainda bloqueado apenas DESBLOQUEIA e liga.
// Antes o `pointerdown` desbloqueava e o `click` seguinte chamava toggleMute():
// o primeiro clique ativava e mutava no mesmo gesto, e o jogador via o botao
// aceso sem som nenhum.
async function toggleGameAudio() {
  const estado = gameAudio.getUiState();
  if (!estado.available) {
    updateSoundButton();
    return false;
  }

  if (!estado.unlocked) {
    const ok = await gameAudio.unlock();
    if (ok && estado.muted) await gameAudio.setMuted(false);
    updateSoundButton();
    sim.state.toast = ok ? 'Som ativado' : 'Não foi possível ativar o som';
    sim.state.toastTime = 1.8;
    return gameAudio.isMuted();
  }

  const muted = await gameAudio.toggleMute();
  updateSoundButton();
  sim.state.toast = muted ? 'Som desativado' : 'Som ativado';
  sim.state.toastTime = 1.6;
  return muted;
}

// O botao reflete os quatro estados reais, nao so `isMuted()`.
function updateSoundButton() {
  const button = document.querySelector('[data-mobile-action="toggle-sound"]');
  if (!button) return;
  const estado = gameAudio.getUiState();

  if (!estado.available) {
    button.textContent = '\u2014';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('title', 'Áudio indisponível');
    button.disabled = true;
    return;
  }
  button.disabled = false;

  if (!estado.unlocked) {
    // Bloqueado: nao pode fingir que o som esta tocando.
    button.textContent = '\u266a';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('title', 'Clique para ativar o som');
    button.classList.add('audio-locked');
    return;
  }
  button.classList.remove('audio-locked');

  if (estado.muted) {
    button.textContent = '\u00d7';
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('title', 'Ativar som');
    return;
  }
  button.textContent = '\u266b';
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('title', 'Desligar som');
}

window.miguelitoAudio = {
  toggle: toggleGameAudio,
  isMuted: () => gameAudio.isMuted(),
  uiState: () => gameAudio.getUiState(),
  debug: () => gameAudio.debugSnapshot(),
  // Processos biológicos (Pacote 04), para inspeção no Console.
  biological: () => biologicalAudio.debugSnapshot(),
};

function maybeAdvanceCampaign() {
  if (!campaign.transitionRequested) return false;

  if (!campaign.transitionCaptured) {
    const report = buildPhaseReport();
    recordPhaseResult(campaign, report);
    // Uma vez por fase, no ponto exato da captura. `beginPhaseVictory` faz mais
    // que tocar o stinger: suprime a musica da fase, abaixa o ambiente e para as
    // gotas — antes a musica continuava audivel por baixo da vitoria.
    //
    // Quem decide a hora de trocar de fase e o FIM REAL do arquivo (`ended`), nao
    // um cronometro: os 3,4 s originais cortavam o stinger de 10,24 s logo no
    // comeco. `transitionAt` continua valendo como espera quando nao ha audio.
    const tocou = gameAudio.beginPhaseVictory({
      onEnded: () => { campaign.victoryAudioFinished = true; },
    });
    campaign.waitingForVictoryAudio = tocou;
    campaign.victoryAudioFinished = !tocou;
    // Rede de seguranca: se o `ended` nunca chegar (midia travada), a fase avanca
    // assim mesmo. Nao corta a reproducao normal.
    campaign.victoryAudioDeadline = tocou
      ? sim.state.time + VICTORY_AUDIO_FALLBACK_SECONDS
      : 0;
    const vascular = report.phase >= 4 ? ` · transporte ${report.vascularTransport}%` : '';
    sim.state.toast = `Fase ${report.phase}: ${report.score} pontos · saúde ${report.rootHealth}% · infestação ${report.infestation}%${vascular}`;
    sim.state.toastTime = PHASE_VICTORY_TOAST_SECONDS;
  }

  // Com audio: espera o stinger terminar (ou o prazo de seguranca).
  if (campaign.waitingForVictoryAudio) {
    const noPrazo = sim.state.time < (campaign.victoryAudioDeadline || 0);
    if (!campaign.victoryAudioFinished && noPrazo) return false;
    campaign.waitingForVictoryAudio = false;
  } else if (sim.state.time < campaign.transitionAt) {
    // Sem audio: a espera curta de sempre.
    return false;
  }

  if (phaseLab.enabled) {
    campaign.transitionRequested = false;
    sim.state.gameState = 'end';
    sim.state.mission = `Phase Lab concluido: ${getPhaseManifest(campaign.phase)?.finalTest?.goal || profile.mission}`;
    return true;
  }

  if (!advanceCampaignPhase(campaign)) {
    campaign.transitionRequested = false;
    sim.state.gameState = 'end';
    sim.state.mission = 'Campanha concluída';
    // Fim de campanha: o resultado longo entra sozinho, nunca junto do curto.
    gameAudio.stopStinger(.5);
    gameAudio.beginPhaseVictory({ campaign: true });
    return true;
  }
  // Fase seguinte: o stinger sai por fade, o ambiente volta, a musica nova entra
  // por crossfade e as gotas so retornam depois de alguns segundos.
  gameAudio.endPhaseVictory();
  // Nenhum processo da fase anterior pode atravessar a troca.
  biologicalAudio.stopAll({ fade: .20, clearPending: true });
  prepareLevel();
  initGame({ announce: true });
  return true;
}

prepareLevel();
initGame({ announce: true });
if (phaseLab.enabled) phaseLab.mount({ onRestart: startNewCampaign });

const recoveryToggleButton = document.querySelector('[data-mobile-action="toggle-recovery"]');
const parallaxToggleButton = document.querySelector('[data-mobile-action="toggle-parallax"]');
function toggleRecoveryPlatforms() {
  const disabled = !sim.state.recoveryPlatformsDisabled;
  sim.state.recoveryPlatformsDisabled = disabled;
  recoveryToggleButton?.setAttribute('aria-pressed', String(disabled));
  sim.state.toast = disabled
    ? 'Plataformas de segurança desligadas: sem os degraus de recuperação.'
    : 'Plataformas de segurança religadas.';
  sim.state.toastTime = 3.2;
}
// Botao de som: um unico listener, chamando a mesma API da tecla M.
const soundToggleButton = document.querySelector('[data-mobile-action="toggle-sound"]');
soundToggleButton?.addEventListener('click', event => {
  event.preventDefault();
  event.stopPropagation();
  toggleGameAudio();
  soundToggleButton.blur();
});
// O botao trata o desbloqueio sozinho, no `click`. Sem isto o `pointerdown` do
// listener global desbloquearia primeiro e o `click` chegaria ja desbloqueado,
// virando um mute imediato.
soundToggleButton?.addEventListener('pointerdown', event => event.stopPropagation());
soundToggleButton?.addEventListener('touchstart', event => event.stopPropagation(), { passive: true });
// Reflete o estado persistido antes de qualquer interacao.
updateSoundButton();

recoveryToggleButton?.addEventListener('click', event => {
  event.preventDefault();
  toggleRecoveryPlatforms();
  recoveryToggleButton.blur();
});

function toggleBiologicalParallax() {
  if (!renderer?.parallaxBackground || sim.state.gameState !== 'play') return;
  biologicalParallaxEnabled = renderer.parallaxBackground.toggle();
  parallaxToggleButton?.setAttribute('aria-pressed', String(biologicalParallaxEnabled));
  sim.state.toast = biologicalParallaxEnabled
    ? 'Paralaxe biológico ativado'
    : 'Paralaxe biológico desativado';
  sim.state.toastTime = 3.2;
}
parallaxToggleButton?.addEventListener('click', event => {
  event.preventDefault();
  toggleBiologicalParallax();
  parallaxToggleButton.blur();
});

// Remove o foco do teclado de qualquer botao clicado para impedir que a tecla Espaco reatire o clique do botao
document.addEventListener('click', event => {
  const btn = event.target?.closest?.('button, [role="button"]');
  if (btn && typeof btn.blur === 'function') btn.blur();
}, { passive: true });
document.addEventListener('mouseup', event => {
  const btn = event.target?.closest?.('button, [role="button"]');
  if (btn && typeof btn.blur === 'function') btn.blur();
}, { passive: true });

const keys = {};
const tutorialInputGate = createTutorialInputGate({ keys, sim });
window.addEventListener('keydown', event => {
  if (phaseLab.enabled && event.target instanceof Element && event.target.closest('.phase-lab')) return;
  if (!tutorialInputGate.acceptsKeyDown(event.code)) {
    event.preventDefault();
    return;
  }

  // Impede que a tecla Espaco (pulo) dispara o clique do botao do DOM focado
  if ((event.code === 'Space' || event.key === ' ') && document.activeElement instanceof HTMLElement && document.activeElement.tagName === 'BUTTON') {
    document.activeElement.blur();
    event.preventDefault();
  }

  keys[event.code] = true;
  if (event.code === 'KeyR' && !event.repeat) startNewCampaign();
  if (event.code === 'KeyT' && !event.repeat) toggleRecoveryPlatforms();
  if (event.code === 'KeyM' && !event.repeat) toggleGameAudio();
  if (event.code === BIOLOGICAL_PARALLAX_KEY && !event.repeat) toggleBiologicalParallax();
  if (event.code === 'Tab') {
    event.preventDefault();
    showDebug = !showDebug;
    debugDiv.classList.toggle('hidden', !showDebug);
  }
});
window.addEventListener('keyup', event => tutorialInputGate.release(event.code));
window.addEventListener('miguelito:tutorial-open', () => {
  tutorialInputGate.clear({ blockActive: true });
});
window.addEventListener('miguelito:tutorial-close', event => {
  tutorialInputGate.clear({
    blockActive: true,
    extraBlockedCodes: event.detail?.blockedInputCodes || [],
  });
  lastTime = performance.now();
});

function currentLogicIndex() {
  let logicIndex = -1;
  for (const platform of getPrimaryTraversalPlatforms(levelData)) {
    if (sim.state.player.x >= platform.x) {
      logicIndex = Math.max(logicIndex, platform.logicIndex ?? -1);
    }
  }
  return logicIndex;
}

function maybeAnnounceTraversalEncounter() {
  if (levelData.traversalRouteHintShown) return;
  const centerX = sim.state.player.x + sim.state.player.w / 2;
  const nearby = (levelData.traversalEncounters || []).find(encounter => {
    const entry = levelData.platforms.find(platform => platform.platformId === encounter.entryPlatformId);
    return entry && Math.abs(centerX - (entry.x + entry.w / 2)) < 280;
  });
  if (!nearby) return;
  levelData.traversalRouteHintShown = true;
  sim.state.toast = 'Rotas altas podem esconder recursos extras.';
  sim.state.toastTime = 3.2;
}

function renderWorld() {
  ctx.save();
  try {
    cameraView.apply(ctx);
    renderer.render();
    sim.state.level.traversalDebugVisible = showDebug;
    platformVisuals.drawWorld(ctx);
    rhizoctoniaControl.render(ctx);
    ralstoniaControl.render(ctx);
    sim.pseudomonasSiderophores.renderDeposits(ctx);
    sim.ecology.render(ctx);
    sim.meloidogyneLifecycle.render(ctx);
    sim.beneficialInoculants.render(ctx);
    sim.pseudomonasSiderophores.render(ctx);
    sim.opportunisticFungus.render(ctx);
    sim.azospirillumRootGrowth.render(ctx);
    sim.rhizobiumNodulation.render(ctx);
    sim.nitrogenRootDevelopment.render(ctx);
    sim.trichodermaColonies.render(ctx);
    sim.trichoderma.render(ctx);
    trichodermaRhizoctoniaControl.render(ctx);
    trichodermaMeloidogyneControl.render(ctx);
    sim.mycorrhizaStructures.render(ctx);
    sim.mycorrhiza.render(ctx);
    sim.goal.render(ctx);
    sim.gameplay.render(ctx);
    sim.bacillusBioprotection.render(ctx);
    sim.phosphateSolubilization.render(ctx);
    fixedBlockRuntime.render(ctx);
    platformVisuals.renderLabel(ctx);
  } finally {
    ctx.restore();
  }
}

function loop(now) {
  try {
    const dt = Math.max(0, Math.min((now - lastTime) / 1000, .1));
    lastTime = now;

    const tutorialManager = window.miguelitoTutorial || null;
    const advanced = advanceGameplayFrame({
      state: sim.state,
      manager: tutorialManager,
      sim,
      dt,
      advance: frameDt => {
        rhizoctoniaControl.prepare(frameDt);
        trichodermaRhizoctoniaControl.update(0);
        trichodermaMeloidogyneControl.update(0);
        sim.setInputs(keys);
        sim.step(frameDt);
        fixedBlockRuntime.update(frameDt);
        rhizoctoniaControl.update(frameDt);
        trichodermaRhizoctoniaControl.update(frameDt);
        trichodermaMeloidogyneControl.update(frameDt);
        ralstoniaControl.update(frameDt);
        maybeAdvanceCampaign();
        cameraView.update(frameDt);
      },
    });
    gameAudio.update(dt);
    // Depois de `sim.step`: as posições e os estados dos processos deste quadro
    // já estão atualizados, então pan, ganho e limite de vozes usam o presente.
    biologicalAudio.update(dt);
    // O desbloqueio pode vir de qualquer clique no jogo: o botao acompanha.
    if (gameAudio.isUnlocked() !== soundButtonUnlocked) {
      soundButtonUnlocked = gameAudio.isUnlocked();
      updateSoundButton();
      // Terceira passada: antes do desbloqueio o AudioContext pode nem existir,
      // e `preloadBiologicalGroup` sai sem carregar nada. Assim que o jogador
      // libera o som, os grupos da fase são buscados de imediato.
      if (soundButtonUnlocked) preloadPhaseBiologicalAudio();
    }
    if (advanced) tutorialManager?.updateAutomaticPresentation?.(dt);
    if (advanced) maybeAnnounceTraversalEncounter();
    renderWorld();
    updateTouchAbilityVisibility();

    // O objetivo da fase agora e dito pelo cartao de abertura. Manter a mesma
    // frase presa no canto o tempo todo so gastava atencao — quem esquecer tem
    // o GUIA. Fica so o numero da fase, curto.
    // No fim da fase mission deixa de ser objetivo e passa a ser a mensagem de
    // conclusao; encurtar ali apagaria justamente o que precisa ser lido.
    if (sim.state.mission) {
      missionDiv.textContent = sim.state.gameState === 'end'
        ? sim.state.mission
        : `Fase ${campaign.phase}`;
    }

    if (sim.state.toastTime > 0 && sim.state.toast && sim.state.toast !== lastToast) {
      toastDiv.textContent = sim.state.toast;
      toastDiv.className = 'show';
      lastToast = sim.state.toast;
    }
    if (sim.state.toastTime <= 0 && toastDiv.className === 'show') {
      toastDiv.className = '';
      lastToast = '';
    }

    const player = sim.state.player;
    // O seletor manda: o HUD mostra o item escolhido, nao uma ordem de prioridade.
    const selected = sim.inoculumSelection.current;
    const totalCarregado = sim.inoculumSelection.options().length;
    // Salto duplo e Dash eram texto permanente no HUD. Sao poderes que o
    // jogador ja tem para sempre: uma vez aprendidos, o lembrete vira ruido.
    // Estoque: o que eu tenho. Numero grande, rotulo pequeno, um chip por coisa.
    const availablePhosphate = (sim.state.level.availablePhosphatePools || [])
      .reduce((sum, pool) => sum + (pool.amount || 0), 0);
    const chips = [];
    if (selected) {
      chips.push({
        kind: 'hand', icon: selected.kind === 'exudate' ? 'exudate' : 'microbe',
        label: selected.label, value: selected.count,
        key: 'E', swap: totalCarregado > 1 ? `↓ ${totalCarregado}` : '',
      });
    }
    chips.push({ icon: 'soil', label: 'Solo', value: Math.round(player.soil) });
    chips.push({ icon: 'hope', label: 'Esperança', value: Math.round(player.hope) });
    chips.push({ icon: 'exudate', label: 'Exsudatos', value: player.exudates });
    if (player.canPhosphateSolubilization && (!selected || (selected.id !== 'phos' && selected.kind !== 'phos'))) {
      chips.push({ icon: 'phosphate', label: 'Carga P', value: `${Math.round((player.phosphateCharge || 0) * 100)}%` });
    }
    renderStockChips(chips);

    // Alertas: so nascem quando ha problema, e ai tem cor propria. Antes eram
    // mais um trecho igual aos outros no meio da mesma frase.
    const alerts = [];
    if (player.fungalContamination > .01) {
      alerts.push({ text: `Contaminação fúngica ${Math.round(player.fungalContamination * 100)}%`, grave: player.fungalContamination > .4 });
    }
    if (player.infection > .01) {
      alerts.push({ text: `Infecção ${Math.round(player.infection * 100)}%`, grave: player.infection > .5 });
    }
    if (sim.meloidogyneLifecycle.infestationPercent > 2) {
      alerts.push({ text: `Meloidogyne ${sim.meloidogyneLifecycle.infestationPercent.toFixed(0)}%`, grave: sim.meloidogyneLifecycle.infestationPercent > 45 });
    }
    if (rhizoctoniaControl.activeCount) {
      alerts.push({ text: `Rhizoctonia ${rhizoctoniaControl.controlledCount}/${rhizoctoniaControl.activeCount} contida${rhizoctoniaControl.activeCount > 1 ? 's' : ''}` });
    }
    // Aviso de disseminacao vem primeiro: e o unico que tem contagem regressiva.
    const disseminacao = ralstoniaControl.activeSpreadEvents[0];
    if (disseminacao) {
      const restante = disseminacao.state === 'warning'
        ? disseminacao.warningRemaining
        : (1 - disseminacao.travelProgress) * ralstoniaControl.config.spreadTravelSeconds;
      alerts.push({
        text: `Disseminação para raiz adiante · ${restante.toFixed(1)} s`,
        grave: true,
      });
    }
    if (ralstoniaControl.focusCount) {
      const contidos = ralstoniaControl.containedCount;
      alerts.push({
        text: `Ralstonia: ${ralstoniaControl.focusCount} foco${ralstoniaControl.focusCount > 1 ? 's' : ''}`
          + `${contidos ? ` · ${contidos} contido${contidos > 1 ? 's' : ''}` : ''}`
          + ` · transporte ${Math.round(ralstoniaControl.averageTransport * 100)}%`,
      });
    }
    renderAlerts(alerts);

    sim.state.level.ecologicalScore = computeEcologicalScore(objectiveEvaluator);
    renderObjectives(campaign, objectiveEvaluator);
    const center = { x: player.x + player.w/2, y: player.y + player.h };
    const nearbyRoot = (sim.state.level.platforms || []).find(p => p.type === 'root' && center.x >= p.x && center.x <= p.x + p.w && Math.abs(center.y - p.y) < 20) || null;
    // `ralstoniaControl` vive no app, nao no simulador; o painel contextual
    // recebe a referencia para poder mostrar porta, cargas e disseminacao.
    if (!sim.ralstoniaControl) sim.ralstoniaControl = ralstoniaControl;
    // Atalho do Phase Lab: window.__ralstoniaLab.spawnFocus({stage:'critical'}) etc.
    if (!window.__ralstoniaLab) window.__ralstoniaLab = ralstoniaControl.lab;
    updateContextPanel(sim.state, nearbyRoot, document.getElementById('hud-context'), sim);
    updateJetpackTouchButton(player);

    if (showDebug) {
      const logicIndex = currentLogicIndex();
      const info = levelData.debugInfo[logicIndex];
      const vigor = Math.round(sim.trichodermaColonies.vigorAverage * 100);
      const beneficialVigor = Math.round(sim.beneficialInoculants.vigorAverage * 100);
      const nitrogenAvailability = getNitrogenAvailability({
        state: sim.state,
        azospirillumNitrogen: sim.azospirillumNitrogen,
      });
      const fixation = nitrogenAvailability.symbioticRaw.toFixed(3);
      const associativeNitrogen = nitrogenAvailability.associativeRaw.toFixed(3);
      const ironRecovered = sim.pseudomonasSiderophores.ironRecovered.toFixed(1);
      const liveRoots = (sim.state.level.platforms || []).filter(root => root.type === 'root' && !root.final && !root.recovery && !root.mycorrhizaStructure);
      const rootHealth = liveRoots.length
        ? Math.round(liveRoots.reduce((sum, root) => sum + clamp(root.rootHealth ?? 1, 0, 1), 0) / liveRoots.length * 100)
        : 100;
      debugDiv.textContent = `CAMPANHA: ${campaign.seed} | Fase ${campaign.phase} — ${profile.title} [${profile.theme}]\nSEED: ${seed} [R=nova campanha | Tab=debug]\nTrecho ${Math.max(0, logicIndex + 1)}/${levelData.debugInfo.length}`
        + (info ? ` | ${info.primitive} | ${info.logic.difficultyTarget} | vão ${info.gap}px` : '')
        + `\nPoderes: salto ${campaign.unlocks.doubleJump ? '✓' : '—'} / dash ${campaign.unlocks.dash ? '✓' : '—'} / solubilizacao P ${campaign.unlocks.phosphateSolubilization ? '✓' : '—'} / pontes AM ${campaign.unlocks.mycorrhizaStructures ? '✓' : '—'} / raízes Azo ${campaign.unlocks.azospirillumRoots ? '✓' : '—'}`
        + `\nCâmera: ${cameraView.zoom.toFixed(2)}× [roda ou +/− | 0=restaurar]`
        + `\n${spriteDiagnostico()}`
        + `\n${audioDiagnostico()}`
        + `\nEcologia: ${sim.ecology.agents.length} organismos / ${sim.ecology.nicheCount} nichos`
        + `\nRhizoctonia: ${rhizoctoniaControl.activeCount} focos / ${rhizoctoniaControl.controlledCount} contidos por biocontrole`
        + `\nTrichoderma anti-Rhizoctonia: ${trichodermaRhizoctoniaControl.activeAttackCount} ataques · ${trichodermaRhizoctoniaControl.eliminatedCount} focos lisados · ${trichodermaRhizoctoniaControl.abortedCount} ataques interrompidos`
        + `\nRalstonia: ${ralstoniaControl.focusCount} focos / ${ralstoniaControl.activeFocusCount} ativos / ${ralstoniaControl.pendingFocusCount} pendentes / ${ralstoniaControl.neutralizedCount} neutralizados / ${ralstoniaControl.criticalCount} críticos · transporte médio ${Math.round(ralstoniaControl.averageTransport * 100)}%`
        + `\nRalstonia prevenidos=${ralstoniaControl.preventedCount} contidos=${ralstoniaControl.containedCount} disseminações=${ralstoniaControl.spreadEventCount} bloqueadas=${ralstoniaControl.blockedSpreadCount} sucedidas=${ralstoniaControl.successfulSpreadCount}`
        + (ralstoniaControl.foci.length ? `\n${ralstoniaControl.debugLines().join('\n')}` : '')
        + `\nMeloidogyne: ${sim.meloidogyneLifecycle.eggMassCount} massas (${sim.meloidogyneLifecycle.eggCount} ovos) / ${sim.meloidogyneLifecycle.juvenileCount} J2 livres / ${sim.meloidogyneLifecycle.penetratingCount} penetrando`
        + `\nTrichoderma anti-Meloidogyne: ${trichodermaMeloidogyneControl.activeAttackCount} ataques (${trichodermaMeloidogyneControl.eggAttackCount} ovos / ${trichodermaMeloidogyneControl.juvenileAttackCount} J2) · ${trichodermaMeloidogyneControl.eggsDestroyed} ovos inviabilizados · ${trichodermaMeloidogyneControl.eggMassesNeutralized} massas neutralizadas · ${trichodermaMeloidogyneControl.juvenilesDestroyed} J2 lisados`
        + `\nGalhas: ${sim.meloidogyneLifecycle.gallCount} totais / ${sim.meloidogyneLifecycle.matureGallCount} maduras / ${sim.meloidogyneLifecycle.femaleCount} fêmeas / saúde radicular média ${rootHealth}%`
        + `\nMicorriza AM: ${sim.mycorrhiza.tipCount} pontas / ${sim.mycorrhiza.branchCount} ramos / ${sim.mycorrhiza.arbusculeCount} arbúsculos`
        + `\nEstruturas AM: ${sim.mycorrhizaStructures.growingCount} crescendo / ${sim.mycorrhizaStructures.matureCount} maduras (${sim.mycorrhizaStructures.bridgeCount} pontes horizontais)`
        + `\nInoculantes: ${sim.beneficialInoculants.followerCount} seguindo / ${sim.beneficialInoculants.colonyCount} colônias / vigor médio ${beneficialVigor}%`
        + (sim.beneficialInoculants.colonySummary ? ` [${sim.beneficialInoculants.colonySummary}]` : '')
        + `\nBacillus: ${sim.bacillusBioprotection.matureBiofilmCount} biofilmes maduros / ${sim.bacillusBioprotection.sporulatedCount} esporulados / ${sim.bacillusBioprotection.germinatingCount} reativando`
        + `\nBioproteção: ${sim.bacillusBioprotection.fungiUnderAntibiosis} fungos sob antibiose / ${sim.bacillusBioprotection.protectedRootCount} raízes protegidas`
        + `\nFosfato: reserva Bacillus ${(sim.bacillusBioprotection.solubilizerEntries.reduce((sum, entry) => sum + (entry.phosphateMetaboliteReserve || 0), 0)).toFixed(2)} / carga ${(player.phosphateCharge || 0).toFixed(2)} / depositos ativos ${(sim.state.level.phosphateDeposits || []).filter(deposit => !deposit.broken).length} / insoluvel ${(sim.state.level.phosphateDeposits || []).reduce((sum, deposit) => sum + (deposit.remainingPhosphate || 0), 0).toFixed(2)} / disponivel ${availablePhosphate.toFixed(2)} / transportado ${sim.phosphateSolubilization.transportedPhosphate.toFixed(2)} / raiz ${sim.phosphateSolubilization.rootPhosphateStock.toFixed(2)}`
        + `\nSideróforos: ${sim.pseudomonasSiderophores.freeCount} livres / ${sim.pseudomonasSiderophores.loadedCount} com Fe³⁺ / Fe recuperado ${ironRecovered} / ${sim.pseudomonasSiderophores.fungiLimitedCount} fungos limitados`
        + `\nDepósitos Fe³⁺: ${sim.pseudomonasSiderophores.activeDepositCount}/${sim.pseudomonasSiderophores.depositCount} ativos / ${sim.pseudomonasSiderophores.activeColonyCount} colônias com reserva`
        + `\nEscadas Azo: ${sim.azospirillumRootGrowth.rootCount} totais / ${sim.azospirillumRootGrowth.growingCount} crescendo / ${sim.azospirillumRootGrowth.matureCount} maduras / ${sim.azospirillumRootGrowth.pausedCount} pausadas`
        + ` · N associativo ${associativeNitrogen} (${(nitrogenAvailability.associativeFraction * 100).toFixed(2)}%)`
        + ` · N simbiótico ${fixation} (${(nitrogenAvailability.symbioticFraction * 100).toFixed(2)}%)`
        + ` · N total ${nitrogenAvailability.percent.toFixed(2)}%`
        + ` · ${nitrogenAvailability.activeAzospirillumColonies} Azo / ${nitrogenAvailability.activeNodules} nódulos`
        + ` · sinergias ${sim.azospirillumNitrogen.synergizedNoduleCount}`
        + `\nRotas: ${levelData.traversalEncounterStats?.created || 0}/${levelData.traversalEncounterStats?.planned || 0} encontros · ${levelData.traversalEncounterStats?.fallbacks || 0} fallbacks`
        + traversalEncounterDebug(levelData)
        + optionalDetourDebug(levelData)
        + topologyDetourDebug(levelData)
        + `\nNodulação: ${sim.rhizobiumNodulation.siteCount} sítios / ${sim.rhizobiumNodulation.matureCount} maduros / ${sim.rhizobiumNodulation.activeCount} ativos / FBN ${fixation}`
        + (sim.rhizobiumNodulation.incompatibleCount ? ` / ${sim.rhizobiumNodulation.incompatibleCount} sem hospedeiro` : '')
        + `\nTrichoderma: ${sim.trichodermaColonies.followerCount} seguindo / ${sim.trichodermaColonies.colonyCount} colônias / vigor médio ${vigor}%`
        + `\nHifas de ataque: ${sim.trichoderma.tipCount} pontas / ${sim.trichoderma.attackCount} alvos / ${sim.trichoderma.searchCount} em busca`
        + `\nInterações: ${sim.gameplay.cloudCount} nuvens / ${sim.gameplay.biofilmCount} biofilmes`
        + azospirillumChallengeDebug(sim)
        + jetpackDebug(sim);
    }

    requestAnimationFrame(loop);
  } catch (error) {
    // Sem repedir o quadro aqui, qualquer excecao pontual congelava o jogo para
    // sempre: o erro era escrito no painel e o loop simplesmente parava. Agora a
    // partida continua e o erro fica registrado, visivel com Tab.
    loopErrorCount++;
    debugDiv.textContent = `ERRO (${loopErrorCount}): ${error.message}\n${error.stack}`;
    if (loopErrorCount === 1) {
      console.error('Erro no loop principal:', error);
      sim.state.toast = 'Um sistema falhou neste quadro. A partida continua; Tab mostra o erro.';
      sim.state.toastTime = 5;
    }
    // Uma falha que se repete a cada quadro nao deve inundar o console nem
    // impedir de jogar, mas tambem nao pode ser escondida.
    if (loopErrorCount < LOOP_ERROR_LIMIT) {
      requestAnimationFrame(loop);
    } else if (loopErrorCount === LOOP_ERROR_LIMIT) {
      debugDiv.classList.remove('hidden');
      debugDiv.textContent = `ERRO PERSISTENTE apos ${LOOP_ERROR_LIMIT} quadros:\n${error.message}\n${error.stack}`;
    }
  }
}

requestAnimationFrame(loop);
