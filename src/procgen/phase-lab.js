import {
  campaignManifest,
  ECOLOGY_ROAMING_TYPES,
  PATHOGEN_SYSTEMS,
  PHOSPHATE_SOLUBILIZATION_DEFAULTS,
  clearPhaseManifestOverride,
  getPersistentUnlocksBeforePhase,
  setPhaseManifestOverride,
} from './campaign-manifest.js';
import { PLAYER_SKINS, PLAYER_SKIN_STORAGE_KEY, resolvePlayerSkin } from '../render/player-skins.js';
import { PATHOGEN_PRESSURE_DEFAULTS } from './pathogen-pressure.js';
import { PATHOGEN_ARRIVAL_DEFAULTS } from './pathogen-arrival.js';
import { phosphateHudCapacity } from './hud-context.js';
import {
  PLAYER_TUNING_LIMITS, getPlayerTuning, resetPlayerTuning, setPlayerTuning,
} from '../render/player-skin-tuning.js';
import {
  PHASE_LAB_STORAGE_KEY,
  buildPhaseLabManifest,
  createDefaultPhaseLabConfig,
  isPhaseLabEnabled,
  productionPhaseManifest,
  scalePhaseLabSegments,
  validatePhaseLabConfig,
} from './phase-lab-config.js';

const clone = value => JSON.parse(JSON.stringify(value));

const RALSTONIA_FIELDS = Object.freeze([
  'maximumFocusCount', 'activationDistance', 'activationGraceSeconds',
  'vascularEntryThreshold', 'obstructionThreshold', 'criticalThreshold',
  'containmentHoldSeconds', 'neutralizationHoldSeconds',
  'woundOpeningRate', 'woundAzospirillumClosureRate', 'woundColonizationLimit',
  'preventionFocusWoundOpening', 'containmentFocusWoundOpening',
  'spreadTriggerThreshold', 'spreadWarningSeconds', 'spreadTravelSeconds',
  'spreadRetrySeconds', 'spreadTargetProtectionThreshold', 'maximumSpreadGeneration',
]);

const RALSTONIA_LABELS = Object.freeze({
  maximumFocusCount: 'Máximo de focos',
  activationDistance: 'Distância de ativação (px)',
  activationGraceSeconds: 'Graça após ativar (s)',
  vascularEntryThreshold: 'Limiar de entrada vascular',
  obstructionThreshold: 'Limiar de obstrução',
  criticalThreshold: 'Limiar de murcha crítica',
  containmentHoldSeconds: 'Contenção: hold (s)',
  neutralizationHoldSeconds: 'Prevenção: hold (s)',
  woundOpeningRate: 'Porta: taxa de abertura',
  woundAzospirillumClosureRate: 'Porta: fechamento por Azo',
  woundColonizationLimit: 'Porta: limite de colonização',
  preventionFocusWoundOpening: 'Porta inicial (prevenção)',
  containmentFocusWoundOpening: 'Porta inicial (contenção)',
  spreadTriggerThreshold: 'Disseminação: limiar vascular',
  spreadWarningSeconds: 'Disseminação: aviso (s)',
  spreadTravelSeconds: 'Disseminação: viagem (s)',
  spreadRetrySeconds: 'Disseminação: retry (s)',
  spreadTargetProtectionThreshold: 'Disseminação: proteção mínima',
  maximumSpreadGeneration: 'Disseminação: geração máxima',
});

const MELOIDOGYNE_FIELDS = Object.freeze([
  'focusSpacingChunks', 'maxFoci', 'maxGenerations',
  'maxSimultaneousEggMasses', 'senescenceSeconds', 'completedCycleScar',
]);

// A lista sai dos proprios defaults. Quando ela era escrita a mao, uma chave
// nova (mycorrhizalReach) ficava sem campo no painel, o valor lido virava NaN e
// a fase 7 inteira parava de abrir no Phase Lab com "parametro invalido".
const PHOSPHATE_FIELDS = Object.freeze(Object.keys(PHOSPHATE_SOLUBILIZATION_DEFAULTS));
const PHOSPHATE_LABELS = Object.freeze({
  absorptionRadius: 'Raio de carga',
  chargeTimeSeconds: 'Tempo de carga (s)',
  minimumCharge: 'Carga minima',
  maximumCharge: 'Carga maxima',
  shotRange: 'Alcance',
  shotSpeed: 'Velocidade do disparo',
  amountSolubilizedPerCharge: 'Solubilizacao/carga',
  metaboliteProductionRate: 'Producao metabolitos',
  exudateProductionMultiplier: 'Multiplicador exsudato',
  localPoolCaptureRadius: 'Raio de captacao',
  mycorrhizalTransportRate: 'Transporte micorrizico',
  mycorrhizalReach: 'Alcance da micorriza',
  minimumTransportedPhosphate: 'P minimo transportado',
  depositHeight: 'Altura do deposito (min 190)',
});
const PHOSPHATE_STEPS = Object.freeze({
  chargeTimeSeconds: '0.1', minimumCharge: '0.01', maximumCharge: '0.01',
  amountSolubilizedPerCharge: '0.05', metaboliteProductionRate: '0.01',
  exudateProductionMultiplier: '0.1', mycorrhizalTransportRate: '0.01',
  minimumTransportedPhosphate: '0.05', depositHeight: '10',
});

function readConfig(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(PHASE_LAB_STORAGE_KEY));
    return parsed && productionPhaseManifest(parsed.phase) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeConfig(storage, config) {
  try { storage?.setItem(PHASE_LAB_STORAGE_KEY, JSON.stringify(config)); } catch (_) {}
}

function labStyles(documentObject) {
  if (documentObject.querySelector('[data-phase-lab-styles]')) return;
  const style = documentObject.createElement('style');
  style.dataset.phaseLabStyles = '';
  style.textContent = `
    .phase-lab-toggle { position:fixed; z-index:10020; left:12px; top:118px; right:auto; bottom:auto; border:1px solid #75ddd2; border-radius:999px; padding:9px 14px; color:#dffffb; background:#073237e8; font:700 12px system-ui; cursor:pointer; }
    .phase-lab { position:fixed; z-index:10019; right:12px; top:12px; bottom:58px; width:min(390px,calc(100vw - 24px)); overflow:auto; box-sizing:border-box; border:1px solid #65cfc5; border-radius:14px; padding:14px; color:#e9fffc; background:#061c20f2; box-shadow:0 18px 50px #000a; font:13px/1.35 system-ui; }
    .phase-lab[hidden] { display:none; } .phase-lab h2 { margin:0 0 4px; font-size:19px; } .phase-lab p { margin:0 0 12px; color:#a9cfca; }
    .phase-lab label { display:grid; gap:4px; margin:9px 0; font-weight:650; } .phase-lab input,.phase-lab select,.phase-lab textarea { width:100%; box-sizing:border-box; border:1px solid #477a7c; border-radius:7px; padding:7px; color:#f5fffd; background:#09272b; font:12px/1.35 ui-monospace,monospace; }
    .phase-lab textarea { min-height:90px; resize:vertical; } .phase-lab fieldset { margin:10px 0; border:1px solid #315f61; border-radius:9px; } .phase-lab legend { color:#82e8dc; font-weight:750; }
    .phase-lab .checks { display:grid; grid-template-columns:1fr 1fr; gap:5px; } .phase-lab .checks label { display:flex; align-items:center; gap:6px; margin:0; font-weight:500; } .phase-lab .checks input { width:auto; }
    .phase-lab .resources { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; } .phase-lab .actions { display:flex; flex-wrap:wrap; gap:7px; position:sticky; bottom:-14px; padding:10px 0 2px; background:#061c20f2; }
    .phase-lab button { border:1px solid #64cfc5; border-radius:8px; padding:8px 10px; color:#eafffc; background:#124348; font-weight:700; cursor:pointer; } .phase-lab button.primary { color:#052122; background:#79e1d6; }
    .phase-lab-status { white-space:pre-wrap; color:#9df2b8; } .phase-lab-status.error { color:#ff9e9e; }
    .phase-lab-snippet { margin-top:8px; padding:8px; border:1px solid #3d6f72; border-radius:7px; background:#04191d; color:#bdf5ec; font:11px/1.45 ui-monospace,monospace; white-space:pre; overflow-x:auto; user-select:all; }
    @media (pointer:coarse) { .phase-lab { width:min(440px,calc(100vw - 16px)); right:8px; top:8px; } }
  `;
  documentObject.head.appendChild(style);
}

function downloadManifest(windowObject, manifest) {
  const blob = new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = windowObject.document.createElement('a');
  anchor.href = url;
  anchor.download = `phase-${manifest.phase}-manifest.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function createPhaseLabSession({ windowObject = globalThis.window } = {}) {
  const enabled = Boolean(windowObject && isPhaseLabEnabled(windowObject.location));
  if (!enabled) return { enabled: false };
  let storage = null;
  try { storage = windowObject.localStorage; } catch (_) {}
  let config = readConfig(storage) || createDefaultPhaseLabConfig(1);
  let manifest = null;
  let restartCallback = null;

  function applyConfig(nextConfig, { persist = true } = {}) {
    const result = validatePhaseLabConfig(nextConfig);
    if (!result.valid) throw new Error(result.errors.join('\n'));
    clearPhaseManifestOverride();
    manifest = setPhaseManifestOverride(result.manifest);
    config = clone(nextConfig);
    if (persist) writeConfig(storage, config);
    return manifest;
  }

  function configureCampaign(campaign) {
    campaign.seed = String(config.seed);
    campaign.phase = Number(config.phase);
    campaign.unlocks = getPersistentUnlocksBeforePhase(campaign.phase);
    campaign.totalScore = 0;
    campaign.history = [];
    campaign.transitionRequested = false;
    campaign.transitionAt = 0;
    campaign.transitionCaptured = false;
    campaign.pendingReport = null;
    campaign.phaseLab = true;
    campaign.tutorialBootstrapSeen = campaignManifest
      .filter(entry => entry.phase < campaign.phase)
      .flatMap(entry => entry.presentations.map(presentation => presentation.cardId));
    return campaign;
  }

  // Por que o fallback tambem precisa de rede:
  //
  // validatePhaseLabConfig valida o MANIFESTO INTEIRO, nao so a fase editada.
  // Basta uma fase qualquer estar invalida para applyConfig lancar em todas —
  // inclusive na fase 1 do fallback. Como esta chamada rodava desprotegida, a
  // excecao subia no carregamento do modulo e o Phase Lab simplesmente nao
  // aparecia. Foi o que aconteceu quando o manifesto foi publicado com a
  // apresentacao da micorriza sem tetherUntilSeen: nenhuma mensagem, nenhum
  // painel, so um Lab ausente.
  //
  // Agora o pior caso e um Lab que abre dizendo o que esta errado. Uma
  // ferramenta de diagnostico que some justamente quando ha algo para
  // diagnosticar e a pior forma possivel de falhar.
  let bootError = null;
  try {
    applyConfig(config, { persist: false });
  } catch (firstError) {
    try {
      config = createDefaultPhaseLabConfig(1);
      applyConfig(config);
      bootError = `Configuracao salva invalida, voltando para a fase 1:\n${firstError.message}`;
    } catch (fallbackError) {
      // Nem o padrao valida: o manifesto do jogo esta quebrado.
      bootError = `MANIFESTO INVALIDO — nenhuma fase pode ser montada:\n${fallbackError.message}`;
    }
  }

  function mount({ onRestart }) {
    restartCallback = onRestart;
    const documentObject = windowObject.document;
    labStyles(documentObject);
    const toggle = documentObject.createElement('button');
    toggle.className = 'phase-lab-toggle';
    toggle.textContent = 'PHASE LAB';
    toggle.type = 'button';
    const panel = documentObject.createElement('aside');
    panel.className = 'phase-lab';
    panel.setAttribute('aria-label', 'Phase Lab');
    panel.innerHTML = `
      <h2>Phase Lab</h2><p>Runtime real · Ctrl+Enter reinicia · sem editor de plataformas</p>
      <label>Fase <select data-field="phase">${[...Array(11)].map((_, phase) => `<option value="${phase}">Fase ${phase}</option>`).join('')}</select></label>
      <label>Seed <input data-field="seed"></label>
      <label>Personagem <select data-field="playerSkin">${
        Object.values(PLAYER_SKINS).map(entry => `<option value="${entry.id}">${entry.label}</option>`).join('')
      }</select></label>
      <fieldset data-player-tuning><legend>Ajuste do sprite (ao vivo)</legend>
        <label>Altura <span data-tuning-readout="characterHeight"></span>
          <input type="range" data-tuning="characterHeight"
            min="${PLAYER_TUNING_LIMITS.characterHeight.min}" max="${PLAYER_TUNING_LIMITS.characterHeight.max}"
            step="${PLAYER_TUNING_LIMITS.characterHeight.step}"></label>
        <label>Ritmo da corrida <span data-tuning-readout="runSpeedScale"></span>
          <input type="range" data-tuning="runSpeedScale"
            min="${PLAYER_TUNING_LIMITS.runSpeedScale.min}" max="${PLAYER_TUNING_LIMITS.runSpeedScale.max}"
            step="${PLAYER_TUNING_LIMITS.runSpeedScale.step}"></label>
        <button data-action="tuning-reset">Restaurar ajuste</button>
        <button data-action="tuning-copy">Copiar para fixar no jogo</button>
        <div data-tuning-snippet class="phase-lab-snippet" hidden></div>
      </fieldset>
      <label>Quantidade de chunks <input data-field="totalChunks" type="number" min="3" max="120"></label>
      <label>Titulo <input data-field="title"></label>
      <label>Tema <input data-field="theme"></label>
      <label>Objetivo / missao <input data-field="mission"></label>
      <label>Segmentos (JSON do manifesto) <textarea data-field="segments"></textarea></label>
      <fieldset><legend>Organismos permitidos</legend><div class="checks" data-organisms></div></fieldset>
      <fieldset><legend>Patogenos permitidos</legend><div class="checks" data-pathogens></div></fieldset>
      <fieldset><legend>Recursos (vazio = geracao normal)</legend><div class="resources">
        <label>Exsudatos<input data-resource="exudates" type="number" min="0" max="100"></label>
        <label>Cristais<input data-resource="crystals" type="number" min="0" max="100"></label>
        <label>Checkpoints<input data-resource="checkpoints" type="number" min="0" max="100"></label>
      </div></fieldset>
      <fieldset><legend>Pressão de patógenos</legend>
        <div class="resources">
          <label>Espera (s)<input data-pressure="recoveryGraceSeconds" type="number" min="0" step="1"></label>
          <label>Recup./s<input data-pressure="recoveryPointsPerSecond" type="number" min="0" step="0.05"></label>
          <label>Basal<input data-pressure="basalPressure" type="number" min="0" step="0.5"></label>
          <label>Peso N<input data-pressure="nitrogenDeficitWeight" type="number" min="0" step="0.5"></label>
          <label>Peso Fe<input data-pressure="ironDeficitWeight" type="number" min="0" step="0.5"></label>
          <label>Teto safe<input data-pressure="safeBandMaximum" type="number" min="0" step="1"></label>
          <label>Teto moderate<input data-pressure="moderateBandMaximum" type="number" min="0" step="1"></label>
          <label>Teto high<input data-pressure="highBandMaximum" type="number" min="0" step="1"></label>
        </div>
        <button type="button" data-pressure-defaults>Restaurar padrões da pressão</button>
        <pre data-pressure-readout style="margin:8px 0 0; padding:8px; border-radius:8px; background:#04181bcc; color:#cdefe9; font:11px/1.45 ui-monospace,Consolas,monospace; white-space:pre-wrap;">sem leitura</pre>
      </fieldset>
      <fieldset><legend>Chegadas de patógeno</legend>
        <div class="resources">
          <label>Safe (s)<input data-arrival="safeMeanIntervalSeconds" type="number" min="1" step="5"></label>
          <label>Moderate (s)<input data-arrival="moderateMeanIntervalSeconds" type="number" min="1" step="5"></label>
          <label>High (s)<input data-arrival="highMeanIntervalSeconds" type="number" min="1" step="5"></label>
          <label>Critical (s)<input data-arrival="criticalMeanIntervalSeconds" type="number" min="1" step="5"></label>
          <label>Cooldown (s)<input data-arrival="minimumCooldownSeconds" type="number" min="0" step="1"></label>
          <label>Aviso (s)<input data-arrival="warningSeconds" type="number" min="0" step="1"></label>
          <label>Máx. ameaças<input data-arrival="maximumActiveThreats" type="number" min="1" step="1"></label>
          <label>Máx. por espécie<input data-arrival="maximumActivePerPathogen" type="number" min="1" step="1"></label>
        </div>
        <div class="resources">
          <button type="button" data-arrival-force="meloidogyne">Forçar Meloidogyne</button>
          <button type="button" data-arrival-force="ralstonia">Forçar Ralstonia</button>
          <button type="button" data-arrival-cancel>Cancelar aviso</button>
          <button type="button" data-arrival-clear>Limpar diagnóstico</button>
        </div>
        <button type="button" data-arrival-defaults>Restaurar padrões das chegadas</button>
        <p style="margin:6px 0 0; font-size:11px; opacity:.72;">Os intervalos acima são pontos de interpolação, não faixas: a pressão exata define o intervalo entre eles. Tab desenha origem, trajetória, raiz-alvo e as pontuações dos candidatos.</p>
        <pre data-arrival-readout style="margin:8px 0 0; padding:8px; border-radius:8px; background:#04181bcc; color:#cdefe9; font:11px/1.45 ui-monospace,Consolas,monospace; white-space:pre-wrap;">sem leitura</pre>
      </fieldset>
      <fieldset><legend>Raiz dependente de FBN</legend>
        <label><span><input data-nitrogen="enabled" type="checkbox" style="width:auto"> Ativada</span></label>
        <div class="resources">
          <label>Quantidade<input data-nitrogen="count" type="number" min="0" max="8"></label>
          <label>FBN minima<input data-nitrogen="requiredFixationRate" type="number" min="0.001" step="0.01"></label>
          <label>Crescimento (s)<input data-nitrogen="growthDurationSeconds" type="number" min="0.1" step="0.5"></label>
        </div>
      </fieldset>
      <fieldset><legend>Escada radicular de Azospirillum</legend>
        <label><span><input data-azo-ladder="enabled" type="checkbox" style="width:auto"> Ativada</span></label>
        <div class="resources">
          <label>Quantidade<input data-azo-ladder="count" type="number" min="0" max="8"></label>
          <label>Degraus<input data-azo-ladder="stepCount" type="number" min="2" max="10"></label>
          <label>Espaçamento vertical<input data-azo-ladder="verticalSpacing" type="number" min="45" max="110"></label>
          <label>Crescimento (s)<input data-azo-ladder="growthDurationSeconds" type="number" min="0.1" step="0.5"></label>
        </div>
      </fieldset>
      <fieldset><legend>Nitrogênio de Azospirillum</legend><div class="resources">
        <label>Taxa associativa<input data-azo-nitrogen="associativeRate" type="number" min="0.001" max="0.049" step="0.001"></label>
        <label>Sinergia Rhizobium<input data-azo-nitrogen="rhizobiumSynergyMultiplier" type="number" min="1" step="0.05"></label>
      </div></fieldset>
      <fieldset><legend>Ponte micorrízica</legend>
        <label><span><input data-myco-bridge="horizontalOnly" type="checkbox" style="width:auto"> Somente horizontal</span></label>
      </fieldset>
      <fieldset><legend>Fungo oportunista</legend><div class="resources">
        <label>Contaminação<input data-fungus="contaminationRate" type="number" min="0" step="0.05"></label>
        <label>Redução velocidade<input data-fungus="movementSpeedReduction" type="number" min="0" max="0.8" step="0.05"></label>
        <label>Redução aceleração<input data-fungus="accelerationReduction" type="number" min="0" max="0.8" step="0.05"></label>
        <label>Redução pulo<input data-fungus="jumpImpulseReduction" type="number" min="0" max="0.8" step="0.05"></label>
        <label>Recuperação<input data-fungus="recoveryRate" type="number" min="0" step="0.01"></label>
        <label>Crescimento hifal<input data-fungus="hyphalGrowthRate" type="number" min="0" step="0.1"></label>
        <label>Esporulação<input data-fungus="sporulationRate" type="number" min="0" step="0.1"></label>
      </div></fieldset>
      <fieldset><legend>Controle de ferro por Pseudomonas</legend><div class="resources">
        <label>Reserva mínima<input data-iron-control="minimumIronReserve" type="number" min="0" step="0.1"></label>
        <label>Vigor máximo na prova<input data-iron-control="minimumFungalVigor" type="number" min="0" max="1" step="0.05"></label>
        <label>Supressão crescimento<input data-iron-control="growthSuppression" type="number" min="0" max="1" step="0.05"></label>
        <label>Supressão esporos<input data-iron-control="sporulationSuppression" type="number" min="0" max="1" step="0.05"></label>
        <label>Supressão aderência<input data-iron-control="adhesionSuppression" type="number" min="0" max="1" step="0.05"></label>
      </div></fieldset>
      <fieldset><legend>Solubilizacao e transporte de fosfato</legend><div class="resources">
        ${PHOSPHATE_FIELDS.map(key => `<label>${PHOSPHATE_LABELS[key] || key}<input data-phosphate="${key}" type="number" min="0" step="${PHOSPHATE_STEPS[key] || '1'}"></label>`).join('')}
      </div>
        <p style="margin:6px 0 0; font-size:11px; opacity:.72;">O caminho do fósforo tem quatro etapas e cada uma tem seu número: solubilizado → disponível no solo → transportado → armazenado na raiz. O HUD mostra a última.</p>
        <pre data-phosphate-readout style="margin:8px 0 0; padding:8px; border-radius:8px; background:#04181bcc; color:#cdefe9; font:11px/1.45 ui-monospace,Consolas,monospace; white-space:pre-wrap;">sem leitura</pre>
      </fieldset>
      <fieldset><legend>Meloidogyne</legend><div class="resources">
        <label>Focos: 1 a cada N chunks<input data-meloidogyne="focusSpacingChunks" type="number" min="2" max="40"></label>
        <label>Máximo de focos<input data-meloidogyne="maxFoci" type="number" min="1" max="12"></label>
        <label>Gerações por foco<input data-meloidogyne="maxGenerations" type="number" min="1" max="10"></label>
        <label>Massas simultâneas<input data-meloidogyne="maxSimultaneousEggMasses" type="number" min="1" max="40"></label>
        <label>Senescência (s)<input data-meloidogyne="senescenceSeconds" type="number" min="2" step="2"></label>
        <label>Cicatriz do ciclo<input data-meloidogyne="completedCycleScar" type="number" min="0" max="0.3" step="0.01"></label>
      </div></fieldset>
      <fieldset><legend>Ralstonia (murcha vascular)</legend><div class="resources">
        ${RALSTONIA_FIELDS.map(key => `<label>${RALSTONIA_LABELS[key] || key}<input data-ralstonia="${key}" type="number" step="0.01"></label>`).join('')}
      </div></fieldset>
      <label>Objetivo final <input data-field="finalGoal"></label>
      <label>Condicoes finais (JSON) <textarea data-field="finalConditions"></textarea></label>
      <div class="phase-lab-status" role="status"></div>
      <div class="actions"><button class="primary" data-action="apply">Aplicar e reiniciar</button><button data-action="seed">Nova seed</button><button data-action="defaults">Restaurar fase</button><button data-action="export">Exportar manifesto</button></div>
    `;
    documentObject.body.append(panel, toggle);
    const status = panel.querySelector('.phase-lab-status');
    // Se o Lab so conseguiu abrir porque caiu no fallback, o painel diz por que
    // — em vez de o jogador achar que perdeu a propria configuracao.
    if (bootError) {
      status.textContent = bootError;
      status.className = 'phase-lab-status error';
    }

    function checkboxMarkup(types, selected) {
      return types.map(type => `<label><input type="checkbox" value="${type}" ${selected.includes(type) ? 'checked' : ''}>${type}</label>`).join('');
    }
    function fill(next) {
      panel.dataset.totalChunks = String(next.totalChunks);
      for (const key of ['phase', 'seed', 'totalChunks', 'title', 'theme', 'mission', 'finalGoal']) {
        panel.querySelector(`[data-field="${key}"]`).value = next[key];
      }
      panel.querySelector('[data-field="segments"]').value = JSON.stringify(next.segments, null, 2);
      panel.querySelector('[data-field="finalConditions"]').value = JSON.stringify(next.finalConditions, null, 2);
      panel.querySelector('[data-organisms]').innerHTML = checkboxMarkup(ECOLOGY_ROAMING_TYPES, next.allowedOrganisms || []);
      // Ralstonia entra na lista: ela ja e uma fase jogavel (fase 9), nao mais
      // um patogeno excluido do MVP.
      panel.querySelector('[data-pathogens]').innerHTML = checkboxMarkup(
        PATHOGEN_SYSTEMS, next.allowedPathogens || [],
      );
      for (const key of ['exudates', 'crystals', 'checkpoints']) {
        panel.querySelector(`[data-resource="${key}"]`).value = next.resources?.[key] ?? '';
      }
      for (const key of Object.keys(PATHOGEN_ARRIVAL_DEFAULTS)) {
        const field = panel.querySelector(`[data-arrival="${key}"]`);
        if (field) field.value = next.pathogenArrival?.[key] ?? PATHOGEN_ARRIVAL_DEFAULTS[key];
      }
      for (const key of Object.keys(PATHOGEN_PRESSURE_DEFAULTS)) {
        const field = panel.querySelector(`[data-pressure="${key}"]`);
        if (field) field.value = next.pathogenPressure?.[key] ?? PATHOGEN_PRESSURE_DEFAULTS[key];
      }
      panel.querySelector('[data-nitrogen="enabled"]').checked = Boolean(next.nitrogenRoot?.enabled);
      for (const key of ['count', 'requiredFixationRate', 'growthDurationSeconds']) {
        panel.querySelector(`[data-nitrogen="${key}"]`).value = next.nitrogenRoot?.[key] ?? '';
      }
      panel.querySelector('[data-azo-ladder="enabled"]').checked = Boolean(next.azospirillumRootLadder?.enabled);
      for (const key of ['count', 'stepCount', 'verticalSpacing', 'growthDurationSeconds']) {
        panel.querySelector(`[data-azo-ladder="${key}"]`).value = next.azospirillumRootLadder?.[key] ?? '';
      }
      for (const key of ['associativeRate', 'rhizobiumSynergyMultiplier']) {
        panel.querySelector(`[data-azo-nitrogen="${key}"]`).value = next.azospirillumNitrogen?.[key] ?? '';
      }
      panel.querySelector('[data-myco-bridge="horizontalOnly"]').checked = Boolean(next.mycorrhizaBridge?.horizontalOnly);
      for (const key of ['contaminationRate', 'movementSpeedReduction', 'accelerationReduction', 'jumpImpulseReduction', 'recoveryRate', 'hyphalGrowthRate', 'sporulationRate']) {
        panel.querySelector(`[data-fungus="${key}"]`).value = next.opportunisticFungus?.[key] ?? '';
      }
      for (const key of ['minimumIronReserve', 'minimumFungalVigor', 'growthSuppression', 'sporulationSuppression', 'adhesionSuppression']) {
        panel.querySelector(`[data-iron-control="${key}"]`).value = next.pseudomonasIronControl?.[key] ?? '';
      }
      for (const key of MELOIDOGYNE_FIELDS) {
        panel.querySelector(`[data-meloidogyne="${key}"]`).value = next.meloidogyne?.[key] ?? '';
      }
      for (const key of PHOSPHATE_FIELDS) {
        panel.querySelector(`[data-phosphate="${key}"]`).value = next.phosphateSolubilization?.[key] ?? '';
      }
      for (const key of RALSTONIA_FIELDS) {
        panel.querySelector(`[data-ralstonia="${key}"]`).value = next.ralstonia?.[key] ?? '';
      }
    }
    function read() {
      const value = key => panel.querySelector(`[data-field="${key}"]`).value;
      const checked = selector => [...panel.querySelectorAll(`${selector} input:checked`)].map(input => input.value);
      const resource = key => {
        const raw = panel.querySelector(`[data-resource="${key}"]`).value;
        return raw === '' ? null : Number(raw);
      };
      return {
        phase: Number(value('phase')),
        seed: value('seed').trim(),
        totalChunks: Number(value('totalChunks')),
        title: value('title'), theme: value('theme'), mission: value('mission'),
        segments: JSON.parse(value('segments')),
        allowedOrganisms: checked('[data-organisms]'),
        allowedPathogens: checked('[data-pathogens]'),
        resources: { exudates: resource('exudates'), crystals: resource('crystals'), checkpoints: resource('checkpoints') },
        pathogenArrival: Object.fromEntries(
          Object.keys(PATHOGEN_ARRIVAL_DEFAULTS).map(key => {
            const raw = Number(panel.querySelector(`[data-arrival="${key}"]`)?.value);
            return [key, Number.isFinite(raw) ? raw : PATHOGEN_ARRIVAL_DEFAULTS[key]];
          }),
        ),
        pathogenPressure: Object.fromEntries(
          Object.keys(PATHOGEN_PRESSURE_DEFAULTS).map(key => {
            const raw = Number(panel.querySelector(`[data-pressure="${key}"]`)?.value);
            return [key, Number.isFinite(raw) ? raw : PATHOGEN_PRESSURE_DEFAULTS[key]];
          }),
        ),
        nitrogenRoot: {
          enabled: panel.querySelector('[data-nitrogen="enabled"]').checked,
          count: Number(panel.querySelector('[data-nitrogen="count"]').value),
          requiredFixationRate: Number(panel.querySelector('[data-nitrogen="requiredFixationRate"]').value),
          growthDurationSeconds: Number(panel.querySelector('[data-nitrogen="growthDurationSeconds"]').value),
        },
        azospirillumRootLadder: {
          enabled: panel.querySelector('[data-azo-ladder="enabled"]').checked,
          count: Number(panel.querySelector('[data-azo-ladder="count"]').value),
          stepCount: Number(panel.querySelector('[data-azo-ladder="stepCount"]').value),
          verticalSpacing: Number(panel.querySelector('[data-azo-ladder="verticalSpacing"]').value),
          growthDurationSeconds: Number(panel.querySelector('[data-azo-ladder="growthDurationSeconds"]').value),
        },
        azospirillumNitrogen: {
          associativeRate: Number(panel.querySelector('[data-azo-nitrogen="associativeRate"]').value),
          rhizobiumSynergyMultiplier: Number(panel.querySelector('[data-azo-nitrogen="rhizobiumSynergyMultiplier"]').value),
        },
        mycorrhizaBridge: {
          horizontalOnly: panel.querySelector('[data-myco-bridge="horizontalOnly"]').checked,
        },
        opportunisticFungus: Object.fromEntries(
          ['contaminationRate', 'movementSpeedReduction', 'accelerationReduction', 'jumpImpulseReduction', 'recoveryRate', 'hyphalGrowthRate', 'sporulationRate']
            .map(key => [key, Number(panel.querySelector(`[data-fungus="${key}"]`).value)]),
        ),
        pseudomonasIronControl: Object.fromEntries(
          ['minimumIronReserve', 'minimumFungalVigor', 'growthSuppression', 'sporulationSuppression', 'adhesionSuppression']
            .map(key => [key, Number(panel.querySelector(`[data-iron-control="${key}"]`).value)]),
        ),
        meloidogyne: Object.fromEntries(
          MELOIDOGYNE_FIELDS.map(key => [key, Number(panel.querySelector(`[data-meloidogyne="${key}"]`).value)]),
        ),
        phosphateSolubilization: {
          ...config.phosphateSolubilization,
          ...Object.fromEntries(
            PHOSPHATE_FIELDS
              .map(key => [key, Number(panel.querySelector(`[data-phosphate="${key}"]`).value)]),
          ),
        },
        ralstonia: {
          ...config.ralstonia,
          ...Object.fromEntries(
            RALSTONIA_FIELDS
              .filter(key => panel.querySelector(`[data-ralstonia="${key}"]`).value !== '')
              .map(key => [key, Number(panel.querySelector(`[data-ralstonia="${key}"]`).value)]),
          ),
        },
        finalGoal: value('finalGoal'),
        finalConditions: JSON.parse(value('finalConditions')),
      };
    }
    function runApply(next = read()) {
      try {
        applyConfig(next);
        configureCampaign(windowObject.miguelitoSim.state.campaign);
        status.className = 'phase-lab-status';
        status.textContent = 'Configuracao valida. Reiniciando a fase.';
        restartCallback?.();
        fill(config);
      } catch (error) {
        status.className = 'phase-lab-status error';
        status.textContent = error.message;
      }
    }
    fill(config);
    toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; });
    panel.querySelector('[data-field="phase"]').addEventListener('change', event => fill(createDefaultPhaseLabConfig(Number(event.target.value))));
    panel.querySelector('[data-field="totalChunks"]').addEventListener('change', event => {
      try {
        const oldTotal = Number(panel.dataset.totalChunks);
        const nextTotal = Number(event.target.value);
        const segments = JSON.parse(panel.querySelector('[data-field="segments"]').value);
        panel.querySelector('[data-field="segments"]').value = JSON.stringify(scalePhaseLabSegments(segments, oldTotal, nextTotal), null, 2);
        panel.dataset.totalChunks = String(nextTotal);
      } catch (_) {}
    });
    // O renderizador resolve a skin uma vez, na criacao, entao trocar de
    // personagem recarrega a pagina em vez de so reiniciar a fase. Recarregar e
    // honesto: a escolha ja esta salva e o Phase Lab tambem guarda a config.
    const skinSelect = panel.querySelector('[data-field="playerSkin"]');
    try { skinSelect.value = resolvePlayerSkin({ locationLike: windowObject.location, storage }).id; } catch (_) {}
    skinSelect.addEventListener('change', event => {
      const chosen = event.target.value;
      try { storage?.setItem(PLAYER_SKIN_STORAGE_KEY, chosen); } catch (_) {}
      // Tira ?player= da URL para o parametro antigo nao vencer a escolha nova.
      const url = new URL(windowObject.location.href);
      url.searchParams.delete('player');
      windowObject.location.replace(url.toString());
    });

    // Sliders do sprite: mudam o desenho no proximo quadro, sem reiniciar a
    // fase. E ajuste de olho — reiniciar a cada meio pixel tornaria impossivel
    // comparar.
    function pintarAjuste() {
      const tuning = getPlayerTuning();
      for (const input of panel.querySelectorAll('[data-tuning]')) {
        const chave = input.dataset.tuning;
        input.value = tuning[chave];
        const leitura = panel.querySelector(`[data-tuning-readout="${chave}"]`);
        if (leitura) {
          leitura.textContent = chave === 'runSpeedScale'
            ? `${Number(tuning[chave]).toFixed(2)}x`
            : `${Math.round(tuning[chave])}px`;
        }
      }
    }
    for (const input of panel.querySelectorAll('[data-tuning]')) {
      input.addEventListener('input', event => {
        setPlayerTuning({ [event.target.dataset.tuning]: Number(event.target.value) });
        pintarAjuste();
      });
    }
    panel.querySelector('[data-action="tuning-reset"]').addEventListener('click', () => {
      resetPlayerTuning();
      pintarAjuste();
    });

    // O ajuste vive no localStorage: vale nesta maquina, neste navegador. Para
    // virar o padrao do jogo ele precisa entrar no codigo. Em vez de descrever
    // o numero e alguem redigitar, o Lab entrega o trecho pronto para colar.
    panel.querySelector('[data-action="tuning-copy"]').addEventListener('click', () => {
      const tuning = getPlayerTuning();
      const trecho = `// src/render/player-skin-tuning.js\n`
        + `export const PLAYER_TUNING_DEFAULTS = Object.freeze({\n`
        + `  characterHeight: ${Math.round(tuning.characterHeight)},\n`
        + `  runSpeedScale: ${Number(tuning.runSpeedScale.toFixed(2))},\n`
        + `});`;
      const alvo = panel.querySelector('[data-tuning-snippet]');
      alvo.textContent = trecho;
      alvo.hidden = false;
      try { windowObject.navigator?.clipboard?.writeText(trecho); } catch (_) {}
    });

    pintarAjuste();

    panel.querySelector('[data-action="apply"]').addEventListener('click', () => runApply());
    panel.querySelector('[data-action="seed"]').addEventListener('click', () => {
      panel.querySelector('[data-field="seed"]').value = `phase-lab-${Date.now().toString(36)}`;
      runApply();
    });
    panel.querySelector('[data-action="defaults"]').addEventListener('click', () => fill(createDefaultPhaseLabConfig(Number(panel.querySelector('[data-field="phase"]').value))));
    panel.querySelector('[data-action="export"]').addEventListener('click', () => {
      try { downloadManifest(windowObject, buildPhaseLabManifest(read())); } catch (error) { status.textContent = error.message; status.className = 'phase-lab-status error'; }
    });
    windowObject.addEventListener('keydown', event => {
      if (event.ctrlKey && event.code === 'Enter') { event.preventDefault(); runApply(); }
    });
    mountPressureReadout(panel, windowObject);
    mountArrivalReadout(panel, windowObject);
    mountPhosphateReadout(panel, windowObject);
    return panel;
  }

  const api = {
    enabled: true,
    getConfig: () => clone(config),
    getManifest: () => clone(manifest),
    applyConfig(next) {
      applyConfig(next);
      if (windowObject.miguelitoSim?.state?.campaign) configureCampaign(windowObject.miguelitoSim.state.campaign);
      restartCallback?.();
      return clone(manifest);
    },
    restart: () => restartCallback?.(),
    exportManifest: () => JSON.stringify(manifest, null, 2),
  };
  windowObject.miguelitoPhaseLab = api;
  // DIAGNOSTICO AO VIVO DA PRESSAO
  // O painel do Lab e estatico; esta leitura precisa acompanhar o quadro. Um
  // intervalo curto basta e nao disputa com o laco de render.
  function mountPressureReadout(panel, windowObject) {
    const readout = panel.querySelector('[data-pressure-readout]');
    const defaultsButton = panel.querySelector('[data-pressure-defaults]');
    if (!readout) return;
    defaultsButton?.addEventListener('click', () => {
      for (const [key, value] of Object.entries(PATHOGEN_PRESSURE_DEFAULTS)) {
        const field = panel.querySelector(`[data-pressure="${key}"]`);
        if (field) field.value = value;
      }
      windowObject.miguelitoSim?.pathogenPressure?.restoreDefaults();
    });
    // Aplica no sistema vivo assim que o campo muda, sem exigir regerar a fase:
    // ajustar peso durante o playtest e o motivo de estes campos existirem.
    for (const key of Object.keys(PATHOGEN_PRESSURE_DEFAULTS)) {
      panel.querySelector(`[data-pressure="${key}"]`)?.addEventListener('change', event => {
        const value = Number(event.target.value);
        if (!Number.isFinite(value)) return;
        windowObject.miguelitoSim?.pathogenPressure?.configure({ [key]: value });
      });
    }
    const render = () => {
      const reading = windowObject.miguelitoSim?.state?.level?.pathogenPressure;
      if (!reading) {
        readout.textContent = 'sem leitura (fase não iniciada)';
        return;
      }
      const round = value => (Math.round(Number(value) * 100) / 100).toFixed(2);
      const history = (reading.applicationHistory || []).slice(-5).reverse()
        .map(entry => (
          `    #${entry.applicationId} nuvens=${entry.activeCloudCountBeforeUse}`
          + ` custo=${entry.cost} ${round(entry.pointsBefore)}→${round(entry.pointsAfter)}`
          + ` t=${round(entry.phaseTime)}s`
        ))
        .join('\n') || '    (nenhuma)';
      readout.textContent = [
        `pontos de exsudato : ${round(reading.exudatePoints)}`,
        `nuvens ativas      : ${reading.activeCloudCount}`,
        `custo do proximo   : ${reading.nextUseCost}`,
        `recuperacao        : ${reading.recoveryState}`,
        `espera restante    : ${round(reading.recoveryDelayRemaining)}s`,
        `velocidade         : ${round(reading.recoveryPointsPerSecond)}/s`,
        `deficit de N       : ${round(reading.nitrogenDeficitPressure)}`,
        `deficit de Fe      : ${round(reading.ironDeficitPressure)}`,
        `basal              : ${round(reading.basalPressure)}`,
        `PRESSAO TOTAL      : ${round(reading.totalPressure)}  [${reading.pressureBand}]`,
        'ultimas aplicacoes :',
        history,
      ].join('\n');
    };
    render();
    const timer = windowObject.setInterval(render, 250);
    windowObject.addEventListener?.('beforeunload', () => windowObject.clearInterval(timer));
  }

  // DIAGNOSTICO AO VIVO DAS CHEGADAS, e os atuadores de teste. As chegadas
  // forcadas usam `forceArrival`, que passa pelas MESMAS APIs e pelos mesmos
  // estagios da chegada por pressao — o Lab encurta a espera, nao cria um
  // segundo caminho.
  // DIAGNOSTICO DO FOSFORO
  //
  // O indicador do HUD ficava em zero porque lia um nome que nao existia, e nao
  // havia onde conferir. As quatro etapas passam a aparecer separadas: se o
  // numero parar de subir, da para ver EM QUAL delas parou — sem solubilizar,
  // sem micorriza no alcance, ou ja entregue e armazenado.
  function mountPhosphateReadout(panel, windowObject) {
    const readout = panel.querySelector('[data-phosphate-readout]');
    if (!readout) return;
    const render = () => {
      const sim = windowObject.miguelitoSim;
      const phosphate = sim?.phosphateSolubilization;
      const level = sim?.state?.level;
      if (!phosphate || !level) {
        readout.textContent = 'sem leitura (fase não iniciada)';
        return;
      }
      const round = value => (Math.round(Number(value) * 1000) / 1000).toFixed(3);
      const pools = level.availablePhosphatePools || [];
      const soil = pools.reduce((sum, pool) => sum + Math.max(0, pool.amount || 0), 0);
      const deposits = level.phosphateDeposits || [];
      const insoluble = deposits.reduce((sum, entry) => sum + (entry.remainingPhosphate || 0), 0);
      // Por raiz que RECEBEU: sem isto o total nao diz para onde o fosforo foi,
      // e "0,4 armazenado" pode ser uma raiz ou quatro.
      const stocked = (level.platforms || [])
        .filter(platform => (platform.phosphateStock || 0) > 0)
        .sort((left, right) => (right.phosphateStock || 0) - (left.phosphateStock || 0))
        .map(platform => {
          const carrier = pools.find(pool => pool.transportingColony?.platform === platform);
          return `    c${platform.logicIndex ?? '?'} estoque=${round(platform.phosphateStock)}`
            + ` saude=${round(platform.rootHealth ?? 1)}`
            + ` micorriza=${carrier?.transportingColony?.id || carrier?.depositId || '—'}`;
        })
        .join('\n') || '    (nenhuma raiz recebeu fosforo ainda)';
      const poolLines = pools
        .map(pool => (
          `    ${pool.depositId} amount=${round(pool.amount)} ${pool.absorptionState || '—'}`
          + `${pool.transportingColony ? '' : ' (sem micorriza no alcance)'}`
        ))
        .join('\n') || '    (nenhuma poca aberta)';
      readout.textContent = [
        `P insoluvel (deposito) : ${round(insoluble)}`,
        `P disponivel no solo   : ${round(soil)}   <- soma de availablePhosphatePools[].amount`,
        `P transportado na fase : ${round(phosphate.transportedPhosphate)}`,
        `P armazenado nas raizes: ${round(phosphate.rootPhosphateStock)}   <- e este que alimenta o HUD`,
        `capacidade do HUD      : ${round(phosphateHudCapacity(sim?.state?.campaign?.phase ?? 0))}`
          + '   (minimumTransportedPhosphate da fase)',
        'pocas disponiveis      :',
        poolLines,
        'raizes com estoque     :',
        stocked,
      ].join('\n');
    };
    render();
    const timer = windowObject.setInterval(render, 250);
    windowObject.addEventListener?.('beforeunload', () => windowObject.clearInterval(timer));
  }

  function mountArrivalReadout(panel, windowObject) {
    const readout = panel.querySelector('[data-arrival-readout]');
    if (!readout) return;
    const arrival = () => windowObject.miguelitoPathogenArrival || null;

    for (const key of Object.keys(PATHOGEN_ARRIVAL_DEFAULTS)) {
      panel.querySelector(`[data-arrival="${key}"]`)?.addEventListener('change', event => {
        const value = Number(event.target.value);
        if (Number.isFinite(value)) arrival()?.configure({ [key]: value });
      });
    }
    panel.querySelector('[data-arrival-defaults]')?.addEventListener('click', () => {
      for (const [key, value] of Object.entries(PATHOGEN_ARRIVAL_DEFAULTS)) {
        const field = panel.querySelector(`[data-arrival="${key}"]`);
        if (field) field.value = value;
      }
      arrival()?.restoreDefaults();
    });
    for (const button of panel.querySelectorAll('[data-arrival-force]')) {
      button.addEventListener('click', () => {
        arrival()?.forceArrival(button.dataset.arrivalForce);
      });
    }
    panel.querySelector('[data-arrival-cancel]')?.addEventListener('click', () => {
      arrival()?.cancelWarning();
    });
    panel.querySelector('[data-arrival-clear]')?.addEventListener('click', () => {
      arrival()?.clearDiagnostics();
    });

    const render = () => {
      const reading = windowObject.miguelitoSim?.state?.level?.pathogenArrival;
      if (!reading) {
        readout.textContent = 'sem leitura (fase não iniciada)';
        return;
      }
      const round = value => (Math.round(Number(value) * 100) / 100).toFixed(2);
      // O deslocamento e o dado novo: de onde saiu, quanto ja andou, quanto
      // falta. Antes o Lab dizia o alvo e escondia o percurso inteiro.
      const travel = reading.warning
        ? `${reading.warning.pathogen} <- ${reading.warning.originType}`
          + ` (${Math.round(reading.warning.originX)},${Math.round(reading.warning.originY)})`
          + ` -> c${reading.warning.targetRoot?.logicIndex ?? '?'}`
          + ` (${Math.round(reading.warning.targetX)},${Math.round(reading.warning.targetY ?? 0)})`
          + ` ${Math.round((reading.warning.travelProgress || 0) * 100)}%`
          + ` faltam ${round(reading.warning.timeRemaining)}s`
          + ` de ${round(reading.warning.estimatedTravelSeconds)}s`
          + ` (${reading.warning.source}${reading.warning.tutorial ? ', didatica' : ''})`
        : 'nenhum';
      // A interpolacao, aberta: entre quais pontos a pressao atual caiu e o
      // quanto ela ja andou entre eles. Foi a troca dos degraus por isto.
      const detail = reading.meanIntervalDetail;
      const interval = detail
        ? `${round(detail.interval)}s`
          + ` [p${round(detail.lowerStop.at)}=${round(detail.lowerStop.interval)}s`
          + ` -> p${Number.isFinite(detail.upperStop.at) ? round(detail.upperStop.at) : 'inf'}`
          + `=${round(detail.upperStop.interval)}s`
          + ` @${Math.round((detail.fraction || 0) * 100)}%]`
        : `${round(reading.currentMeanInterval)}s`;
      // O GRUPO de Meloidogyne, por deslocamento real. O progresso vinha de um
      // cronometro e chegava a 100% com os J2 ainda a meia tela da raiz.
      const group = reading.meloidogyneArrival;
      const melo = group
        ? [
            `grupo              : ${group.groupId} [${group.state}]`
              + ` alvo c${group.targetLogicIndex ?? '?'} <- ${group.originType}`,
            `  J2               : ${group.activeCount} em transito`
              + ` / ${group.initialCount} iniciais`
              + ` / ${group.capturedCount} capturados`
              + ` / ${group.arrivedCount} chegaram`,
            `  posicao media    : ${group.meanX === null ? '—' : Math.round(group.meanX)}`
              + `, ${group.meanY === null ? '—' : Math.round(group.meanY)}`,
            `  percurso         : ${Math.round(group.traveledDistance)}`
              + ` / ${Math.round(group.totalDistance)}px`
              + ` (faltam ${Math.round(group.remainingDistance)}px)`
              + ` = ${Math.round(group.progress * 100)}%`,
            `  velocidade       : ${round(group.speed)} px/s`
              + ` -> ${round(group.estimatedSecondsRemaining)}s restantes`,
            `  aviso            : ${group.warningTriggered ? 'iniciado' : 'nao'}`
              + ` (raio ${group.warningDistance}px,`
              + ` distancia atual ${group.distanceToRoot === null ? '—' : Math.round(group.distanceToRoot)}px)`,
          ].join('\n')
        : 'nenhum grupo em transito';
      const scorePathogen = reading.warning?.pathogen || 'meloidogyne';
      const scores = (reading.candidateScores?.[scorePathogen] || []).slice(0, 4)
        .map(entry => (
          `    c${entry.logicIndex} s=${round(entry.score)}`
          + ` nuvem=${round(entry.cloud)} dist=${round(entry.distance)}`
          + ` tec=${round(entry.tissue)} les=${round(entry.lesion)}`
          + ` ocu=${round(entry.occupancy)} prot=${round(entry.protection)}`
        ))
        .join('\n') || '    (nenhum candidato)';
      const history = (reading.eventHistory || []).slice(-5).reverse()
        .map(entry => (
          `    ${entry.kind} ${entry.pathogen || ''} c${entry.logicIndex ?? '?'}`
          + `${entry.originType ? ` <-${entry.originType}` : ''} t=${round(entry.phaseTime)}s`
        ))
        .join('\n') || '    (nenhum)';
      readout.textContent = [
        `pressao total      : ${round(reading.totalPressure)}  [${reading.pressureBand}]`,
        `progresso          : ${round(reading.arrivalProgress)} / ${round(reading.currentThreshold)}`,
        `intervalo medio    : ${interval}`,
        `cooldown           : ${round(reading.cooldownRemaining)}s`,
        `elegiveis          : ${(reading.eligiblePathogens || []).join(', ') || 'nenhum'}`,
        `ameacas ativas     : ${reading.activeThreatCount}`
          + ` (melo ${reading.activeByPathogen?.meloidogyne ?? 0},`
          + ` ralstonia ${reading.activeByPathogen?.ralstonia ?? 0})`,
        `em deslocamento    : ${travel}`,
        `meloidogyne        : ${melo}`,
        `chegadas           : ${reading.totalArrivals}`
          + ` (melo ${reading.arrivalsByPathogen?.meloidogyne ?? 0},`
          + ` ralstonia ${reading.arrivalsByPathogen?.ralstonia ?? 0})`,
        `exposicao didatica : ${reading.tutorialPathogen || 'nenhuma nesta fase'}`
          + ` — ${reading.tutorialArrivalCompleted ? 'feita' : 'pendente'}`,
        `candidatos (${scorePathogen}) :`,
        scores,
        'ultimos eventos    :',
        history,
      ].join('\n');
    };
    render();
    const timer = windowObject.setInterval(render, 250);
    windowObject.addEventListener?.('beforeunload', () => windowObject.clearInterval(timer));
  }

  return { enabled, get config() { return config; }, get manifest() { return manifest; }, configureCampaign, mount, api };
}
