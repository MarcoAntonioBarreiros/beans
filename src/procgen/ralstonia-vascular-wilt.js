// Runtime da murcha vascular (Ralstonia solanacearum)
// ===================================================
//
// A fase 9 continua PROCEDURAL: nenhuma plataforma é movida, nenhuma coordenada
// é fixa. O que este runtime faz é escolher, dentro das janelas de chunk que o
// manifesto declara, quais raízes recebem cada papel didático — e só ligar a
// doença quando Miguelito chega perto.
//
// Ordem das responsabilidades neste arquivo:
//   A. seleção procedural das raízes            (selectFocusRoots)
//   B. ativação por proximidade                 (updateActivation)
//   C. porta de entrada dinâmica                (updateWound)
//   D. crescimento superficial e vascular        (updateFocus)
//   E. controles diretos e indiretos            (bacillusStrength / iron pass)
//   F. disseminação                             (updateSpread)
//   G. renderização e HUD                       (render / snapshot)
//   H. contadores e objetivos                   (getters)
//
// Duas invariantes que o código todo respeita:
//   1. Ralstonia PUBLICA valores derivados nas raízes e colônias; ela nunca
//      degrada um valor-base de forma irreversível. Quem calcula rootHealth é
//      root-health-gameplay.js.
//   2. Um foco que entrou no xilema nunca volta a "neutralizado". Conter é
//      segurar, não curar.

import { W } from '../core/constants.js';
import { organismSprites } from '../render/organism-sprites.js';
import { RALSTONIA_DEFAULTS, getPhaseManifest } from './campaign-manifest.js';
import { createRandom } from './random.js';
import { publishControlSignal } from './biological-audio-signals.js';
import {
  RALSTONIA_STATE_LABELS,
  isRalstoniaRootEligible,
  ralstoniaAzospirillumClosure,
  ralstoniaNetGrowth,
  ralstoniaStageForLoads,
  ralstoniaWoundDynamics,
  ralstoniaWoundPressure,
} from './ralstonia-wilt-core.js';
import {
  canRalstoniaFocusSpread,
  chooseRalstoniaSpreadTarget,
  ralstoniaArrivalProtection,
  ralstoniaSpreadOpening,
} from './ralstonia-spread.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function hashRoot(root, salt = 0) {
  const x = Math.round(root?.x || 0);
  const y = Math.round(root?.y || 0);
  const w = Math.round(root?.w || 0);
  const value = Math.sin((x * 12.9898 + y * 78.233 + w * 37.719 + salt * 23.17) * .001) * 43758.5453;
  return value - Math.floor(value);
}

function focusState(focus) {
  return ralstoniaStageForLoads({
    surfaceLoad: focus.surfaceLoad,
    vascularLoad: focus.vascularLoad,
    contained: focus.contained,
    neutralized: focus.neutralized,
  });
}

function stageLabel(focus) {
  return RALSTONIA_STATE_LABELS[focusState(focus)] || 'contaminação superficial';
}

// Leitura interpretativa da porta, para o HUD não mostrar só números.
export function ralstoniaDoorLabel(opening, config = RALSTONIA_DEFAULTS) {
  if (opening <= config.woundSealThreshold) return 'Entrada bloqueada';
  if (opening <= config.woundColonizationLimit) return 'Porta fechando';
  return 'Porta aberta';
}

export function createRalstoniaVascularWilt({ state, entities, inoculants, pseudomonas }) {
  const foci = [];
  const spreadEvents = [];
  let nextId = 1;
  let nextEventId = 1;
  let initialized = false;
  let lastToastAt = -Infinity;

  let neutralizedCount = 0;
  let criticalCount = 0;
  let averageTransport = 1;
  // Marcos da fase 9. `prevented` e `contained` não voltam atrás — senão o
  // objetivo piscaria. `critical` é leitura do agora (condição `live`).
  let preventedCount = 0;
  let containedCount = 0;
  let blockedSpreadCount = 0;
  let successfulSpreadCount = 0;
  let spreadEventCount = 0;

  // Marcadores didáticos: os cartões são abertos por tutorial-triggers.js, que
  // lê estas flags. Cada um dispara uma única vez por fase.
  const didactics = {
    entry: false,
    obstruction: false,
    containment: false,
    spread: false,
  };

  // Limiares e tempos vêm do manifesto da fase; RALSTONIA_DEFAULTS é o fallback.
  const CONFIG = { ...RALSTONIA_DEFAULTS, ...(getPhaseManifest(state.campaign?.phase)?.ralstonia || {}) };

  let random = createRandom(`${state.campaign?.seed || state.level?.seed || 'ralstonia'}:ralstonia-foci`);
  let spreadWindowReached = false;
  let pedagogicalSpreadAttempts = 0;

  function announce(text, duration = 5, cooldown = 2.3) {
    if (state.time - lastToastAt < cooldown) return;
    state.toast = text;
    state.toastTime = duration;
    lastToastAt = state.time;
  }

  function phaseNumber() {
    return Number.isInteger(state.campaign?.phase) ? state.campaign.phase : 0;
  }

  function manifest() {
    return getPhaseManifest(phaseNumber());
  }

  function eligibleRoots() {
    return (state.level.platforms || []).filter(isRalstoniaRootEligible);
  }

  // ---------------------------------------------------------------------------
  // A. SELEÇÃO PROCEDURAL
  // ---------------------------------------------------------------------------

  // Os segmentos do manifesto entram apenas como JANELAS de seleção. Nada de
  // geometria autoral: quem está dentro da janela é o que a geração produziu.
  function segmentWindow(segmentId) {
    const segment = (manifest()?.segments || []).find(entry => entry.id === segmentId);
    if (!segment) return null;
    return { from: segment.from, to: segment.to };
  }

  function rootsInWindow(window, { minimumLogicIndex = -1, exclude = new Set() } = {}) {
    if (!window) return [];
    return eligibleRoots().filter(root => (
      !exclude.has(root)
      && (root.logicIndex ?? -1) >= Math.max(window.from, minimumLogicIndex)
      && (root.logicIndex ?? -1) <= window.to
    ));
  }

  // Escolha determinística dentro de um conjunto.
  //
  // A janela do manifesto é um LIMITE, não uma sugestão: o foco de prevenção
  // pertence a p9-surface-intro e o de contenção a p9-vascular-intro. A versão
  // anterior expandia a busca em degraus até 40 chunks quando o portão de
  // recursos empurrava o mínimo para frente — e o foco vascular ia parar no
  // chunk 17 ou 19, longe da lição que deveria ensinar.
  //
  // Quando o portão de recursos não pode ser satisfeito dentro da janela, o
  // recurso é GARANTIDO antes da raiz (ver `ensureResourceBefore`) em vez de o
  // foco ser deslocado.
  function pickRoot(window, { minimumLogicIndex = -1, exclude = new Set(), salt = 0, strict = false } = {}) {
    if (!window) return null;
    const expansions = strict ? [0] : [0, 3, 6, 12, 40];
    for (const expansion of expansions) {
      const widened = {
        from: Math.max(0, window.from - expansion),
        to: window.to + expansion,
      };
      const pool = rootsInWindow(widened, { minimumLogicIndex, exclude });
      if (!pool.length) continue;
      const ordered = pool.slice().sort((a, b) => (
        (a.logicIndex ?? 0) - (b.logicIndex ?? 0) || a.x - b.x
      ));
      const roll = clamp(random(), 0, .999);
      const index = Math.floor(roll * ordered.length);
      return ordered[(index + salt) % ordered.length];
    }
    return null;
  }

  // Escolha ESTRITA: fica dentro do segmento, e prefere respeitar o portão de
  // recursos. Se o portão não couber na janela, devolve a raiz mais tardia do
  // segmento e sinaliza que o recurso precisa ser garantido antes dela.
  function pickRootInSegment(segmentId, { minimumLogicIndex = -1, exclude = new Set(), salt = 0 } = {}) {
    const window = segmentWindow(segmentId);
    if (!window) return { root: null, needsResourceGuarantee: false };
    const comPortao = pickRoot(window, { minimumLogicIndex, exclude, salt, strict: true });
    if (comPortao) return { root: comPortao, needsResourceGuarantee: false };
    const semPortao = pickRoot(window, { exclude, salt, strict: true });
    if (semPortao) return { root: semPortao, needsResourceGuarantee: true };
    // A janela não tem NENHUMA raiz elegível: promove um bloco de solo do próprio
    // segmento. É o mesmo recurso que a raiz nitrogenada já usa — o tipo é
    // visual, promover é gratuito, e nenhuma plataforma sai do lugar. Melhor do
    // que empurrar a lição de prevenção para o meio da janela de contenção.
    const promovida = promoteSoilInSegment(window, exclude);
    if (promovida) return { root: promovida, needsResourceGuarantee: true, promoted: true };

    // Nem solo promovível existe: aí sim expande, registrando a exceção.
    const expandido = pickRoot(window, { exclude, salt });
    return { root: expandido, needsResourceGuarantee: true, outOfSegment: Boolean(expandido) };
  }

  // Promove o bloco de solo mais largo do segmento a raiz. Só muda `type`.
  function promoteSoilInSegment(window, exclude = new Set()) {
    const candidatas = (state.level.platforms || []).filter(platform => (
      platform.type === 'soil'
      && !exclude.has(platform)
      && !platform.final
      && !platform.recovery
      && (
        platform.routeScope !== 'optional'
        || platform.allowOptionalRoutePopulation
      )
      && !platform.safetyStep
      && !platform.mycorrhizaStructure
      && !platform.azospirillumStructure
      && !platform.azospirillumLadderStep
      && !platform.nitrogenRootCollider
      && !platform.signatureChallenge
      && Number.isInteger(platform.logicIndex)
      && platform.logicIndex >= window.from
      && platform.logicIndex <= window.to
      && platform.w >= 120
    ));
    if (!candidatas.length) return null;
    const escolhida = candidatas.sort((a, b) => b.w - a.w || a.logicIndex - b.logicIndex)[0];
    escolhida.type = 'root';
    escolhida.ralstoniaPromotedRoot = true;
    return escolhida;
  }

  // Recursos disponíveis antes de um chunk: usado para não colocar o foco de
  // prevenção antes de existir qualquer forma de prevenir (seção 22).
  //
  // A lista autoritativa é `level.microbeEncounters` (cada entrada traz `id` do
  // organismo e o `logicIndex` do chunk). `allies`/`agents` entram como fontes
  // complementares porque em cenários de teste e no Phase Lab elas podem ser as
  // únicas presentes. Quando uma fonte não existe o portão simplesmente não
  // restringe — nunca inventa recurso nem move o que já está ancorado.
  function resourceLogicIndexes() {
    const encounters = [];
    const push = (type, logicIndex) => {
      if (!type || !Number.isFinite(logicIndex)) return;
      encounters.push({ type, logicIndex });
    };
    for (const encounter of state.level.microbeEncounters || []) {
      push(encounter.id || encounter.type, encounter.logicIndex ?? chunkIndexAtX(encounter.x));
    }
    for (const ally of state.level.allies || []) {
      push(ally.type || ally.organism || ally.id, ally.logicIndex ?? chunkIndexAtX(ally.x));
    }
    for (const agent of state.level.agents || []) {
      push(agent.type, agent.logicIndex ?? chunkIndexAtX(agent.x));
    }
    const exudates = (state.level.exudates || [])
      .map(node => (node.logicIndex ?? chunkIndexAtX(node.x)))
      .filter(Number.isFinite);
    const ironDeposits = (state.level.ironDeposits || [])
      .map(node => (node.logicIndex ?? chunkIndexAtX(node.x)))
      .filter(Number.isFinite);
    return { encounters, exudates, ironDeposits };
  }

  function chunkIndexAtX(x) {
    let best = -1;
    for (const platform of state.level.platforms || []) {
      if (platform.recovery || platform.final) continue;
      if ((platform.x ?? 0) <= x) best = Math.max(best, platform.logicIndex ?? -1);
    }
    return best;
  }

  function earliestOf(list, predicate) {
    let best = Infinity;
    for (const entry of list) {
      if (!predicate(entry)) continue;
      const index = Number.isFinite(entry.logicIndex) ? entry.logicIndex : entry;
      if (Number.isFinite(index)) best = Math.min(best, index);
    }
    return best;
  }

  // Onde a prevenção passa a ser possível: depois do primeiro organismo capaz
  // de prevenir (Azospirillum, Bacillus ou Pseudomonas) e do primeiro exsudato.
  function preventionAvailableFrom() {
    const { encounters, exudates } = resourceLogicIndexes();
    const organism = earliestOf(encounters, entry => (
      entry.type === 'azospirillum' || entry.type === 'bacillus' || entry.type === 'pseudomonas'
    ));
    const exudate = exudates.length ? Math.min(...exudates) : Infinity;
    const gate = Math.max(
      Number.isFinite(organism) ? organism : 0,
      Number.isFinite(exudate) ? exudate : 0,
    );
    return Number.isFinite(gate) ? gate : 0;
  }

  // Onde a contenção passa a ser possível: Pseudomonas e ferro acessíveis.
  function containmentAvailableFrom() {
    const { encounters, ironDeposits } = resourceLogicIndexes();
    const organism = earliestOf(encounters, entry => entry.type === 'pseudomonas');
    const iron = ironDeposits.length ? Math.min(...ironDeposits) : Infinity;
    const gate = Math.max(
      Number.isFinite(organism) ? organism : 0,
      Number.isFinite(iron) ? iron : 0,
    );
    return Number.isFinite(gate) ? gate : 0;
  }

  function desiredFocusCount() {
    const phase = phaseNumber() || 1;
    const info = manifest();
    const allowedInLab = info?.phaseLab?.allowedPathogens;
    const scheduled = Array.isArray(allowedInLab)
      ? allowedInLab.includes('ralstonia')
      : info?.pathogenDebuts?.some(entry => entry.pathogen === 'ralstonia');
    if (!scheduled) return 0;
    const themeBoost = state.level.phaseTheme === 'infestação' ? 1 : 0;
    return clamp(1 + Math.floor((phase - 4) / 2) + themeBoost, 1, CONFIG.maximumFocusCount);
  }

  function createFocus({
    root,
    role,
    surfaceLoad,
    vascularLoad,
    woundOpening,
    spreadGeneration = 0,
    source = null,
    graceSeconds = null,
  }) {
    const offsetX = clamp(
      root.w * (.24 + hashRoot(root, 47) * .52),
      25,
      Math.max(25, root.w - 25),
    );
    const focus = {
      id: `ralstonia-${nextId++}`,
      root,
      role,
      roleLabel: {
        prevention: 'Foco superficial — ainda é possível impedir a entrada',
        containment: 'Infecção vascular — contenha o avanço',
        spread: 'Foco nascido de disseminação',
      }[role] || 'Foco de Ralstonia',
      shortRoleLabel: {
        prevention: 'Foco superficial',
        containment: 'Infecção vascular',
        spread: 'Foco disseminado',
      }[role] || 'Foco',
      // Ancoragem: a posição é derivada da raiz a cada quadro. Guardar só um x
      // absoluto deixava o foco flutuando quando a raiz colapsava ou deslocava.
      platformId: root.id ?? root.platformId ?? null,
      rootLogicIndex: root.logicIndex ?? -1,
      offsetX,
      x: root.x + offsetX,

      // B. ativação
      activationState: 'pending',
      activationDistance: CONFIG.activationDistance,
      activationGraceRemaining: graceSeconds ?? CONFIG.activationGraceSeconds,
      activatedAt: null,
      source,
      spreadGeneration,

      // C/D. doença
      woundOpening: clamp(woundOpening, 0, 1),
      surfaceLoad: clamp(surfaceLoad, 0, 1),
      vascularLoad: clamp(vascularLoad, 0, 1),
      surfaceNetRate: 0,
      vascularNetRate: 0,
      openingPressure: 0,
      closurePressure: 0,

      // E. controles
      azospirillumClosure: 0,
      bacillusControl: 0,
      pseudomonasControl: 0,

      // marcos
      everEnteredVascular: clamp(vascularLoad, 0, 1) >= CONFIG.vascularEntryThreshold,
      everPrevented: false,
      everContained: false,
      contained: false,
      neutralized: false,
      containHold: 0,
      neutralizeHold: 0,

      // F. disseminação
      spreadTimer: 12 + hashRoot(root, 101) * 8,
      spreadEventsUsed: 0,
      spreadCooldown: 0,
      spreadBudgetBonus: 0,
      pedagogicalSpread: false,

      // apresentação
      age: 0,
      phase: hashRoot(root, 61) * TAU,
      // Animação. Tudo determinístico pela seed (hashRoot), nunca Math.random.
      surfaceMotionPhase: hashRoot(root, 79) * TAU,
      surfaceMotionDirection: hashRoot(root, 83) < .5 ? -1 : 1,
      surfaceTravel: 0,
      entryVisualProgress: clamp(vascularLoad, 0, 1) >= CONFIG.vascularEntryThreshold ? 1 : 0,
      visualX: root.x + offsetX,
      roleBadgeTimer: 0,
      oozeTimer: .2 + hashRoot(root, 73) * .5,
      stressTimer: 2.4 + hashRoot(root, 89) * 2.2,
      announcedEntry: false,
      announcedVascular: false,
      announcedCritical: false,
      state: 'surface',
      vascularEfficiency: 1,
    };
    focus.state = focusState(focus);
    foci.push(focus);
    return focus;
  }

  // Garante um recurso ANTES de um chunk usando a infraestrutura normal de
  // encontros: nada de coordenada fixa, nada de mover o que já existe. Só
  // acrescenta o encontro ancorado numa raiz anterior, quando ele falta.
  function ensureResourceBefore(organism, beforeLogicIndex) {
    const encounters = state.level.microbeEncounters || (state.level.microbeEncounters = []);
    const jaExiste = encounters.some(entry => (
      (entry.id || entry.type) === organism
      && (entry.logicIndex ?? chunkIndexAtX(entry.x)) < beforeLogicIndex
    ));
    if (jaExiste) return null;

    const anfitria = eligibleRoots()
      .filter(root => (root.logicIndex ?? -1) < beforeLogicIndex && (root.logicIndex ?? -1) >= 1)
      .sort((a, b) => (b.logicIndex ?? 0) - (a.logicIndex ?? 0))[0];
    if (!anfitria) return null;

    const encontro = {
      id: organism,
      x: anfitria.x + anfitria.w * (.3 + hashRoot(anfitria, 211) * .4),
      y: anfitria.y - 46,
      r: 168,
      territory: 900,
      collect: false,
      logicIndex: anfitria.logicIndex,
      source: 'ralstonia-guarantee',
      requiresSeenCardId: null,
    };
    encounters.push(encontro);
    return encontro;
  }

  function ensureExudateBefore(beforeLogicIndex) {
    const exudates = state.level.exudates || (state.level.exudates = []);
    if (exudates.some(node => (node.logicIndex ?? chunkIndexAtX(node.x)) < beforeLogicIndex)) return null;
    const anfitria = eligibleRoots()
      .filter(root => (root.logicIndex ?? -1) < beforeLogicIndex && (root.logicIndex ?? -1) >= 1)
      .sort((a, b) => (b.logicIndex ?? 0) - (a.logicIndex ?? 0))[0];
    if (!anfitria) return null;
    const node = {
      logicIndex: anfitria.logicIndex,
      x: anfitria.x + anfitria.w * .5,
      y: anfitria.y - 52,
      taken: false,
      source: 'ralstonia-guarantee',
    };
    exudates.push(node);
    return node;
  }

  function selectFocusRoots() {
    const count = desiredFocusCount();
    if (!count) return;
    const teaching = phaseNumber() === 9;
    const used = new Set();

    if (teaching) {
      // FOCO DE PREVENÇÃO — janela p9-surface-intro (chunks 3–8), sem sair dela.
      const prevencao = pickRootInSegment('p9-surface-intro', {
        minimumLogicIndex: preventionAvailableFrom(),
        exclude: used,
      });
      const preventionRoot = prevencao.root;
      if (preventionRoot) {
        used.add(preventionRoot);
        // Recurso garantido ANTES da raiz em vez de empurrar o foco para frente.
        if (prevencao.needsResourceGuarantee) {
          ensureResourceBefore('bacillus', preventionRoot.logicIndex);
          ensureExudateBefore(preventionRoot.logicIndex);
        }
        const focus = createFocus({
          root: preventionRoot,
          role: 'prevention',
          surfaceLoad: CONFIG.introductoryFocusSurfaceLoad,
          vascularLoad: CONFIG.introductoryVascularLoad,
          woundOpening: CONFIG.preventionFocusWoundOpening,
        });
        focus.outOfSegment = Boolean(prevencao.outOfSegment);
      }

      // FOCO DE CONTENÇÃO — janela p9-vascular-intro (chunks 9–14), posterior ao
      // de prevenção. Começa acima do limiar de entrada: só dá para conter.
      const contencao = pickRootInSegment('p9-vascular-intro', {
        minimumLogicIndex: Math.max(
          containmentAvailableFrom(),
          (preventionRoot?.logicIndex ?? -1) + 1,
        ),
        exclude: used,
        salt: 1,
      });
      const containmentRoot = contencao.root;
      if (containmentRoot) {
        used.add(containmentRoot);
        if (contencao.needsResourceGuarantee) {
          ensureResourceBefore('pseudomonas', containmentRoot.logicIndex);
          ensureExudateBefore(containmentRoot.logicIndex);
        }
        const focus = createFocus({
          root: containmentRoot,
          role: 'containment',
          surfaceLoad: CONFIG.containmentFocusSurfaceLoad,
          vascularLoad: CONFIG.containmentFocusVascularLoad,
          woundOpening: CONFIG.containmentFocusWoundOpening,
        });
        focus.outOfSegment = Boolean(contencao.outOfSegment);
        reserveSpreadTarget(focus);
      }
    }

    // FOCOS DE PRÁTICA — no restante da fase. Também nascem `pending`.
    //
    // Na fase de ensino sobra SEMPRE uma vaga sob `maximumFocusCount`, para uma
    // disseminação bem-sucedida poder criar o foco superficial.
    const seededCap = teaching
      ? Math.min(count, Math.max(1, CONFIG.maximumFocusCount - 1))
      : count;
    const totalChunks = manifest()?.totalChunks ?? 24;
    while (foci.length < seededCap) {
      const practiceRoot = pickRoot(
        { from: teaching ? 21 : 3, to: totalChunks },
        { exclude: used, salt: foci.length },
      );
      if (!practiceRoot) break;
      used.add(practiceRoot);
      const damage = practiceRoot.rootGameplayDamage || 0;
      createFocus({
        root: practiceRoot,
        role: 'practice',
        surfaceLoad: .16 + hashRoot(practiceRoot, 17) * .1,
        vascularLoad: damage > .14 ? .055 : 0,
        woundOpening: clamp(.22 + damage * .4, 0, 1),
      });
    }
  }

  // RESERVA do alvo didático da disseminação, feita na geração — não na hora do
  // evento. Se nenhuma raiz da janela tiver lesão natural suficiente, uma raiz
  // estruturalmente válida recebe um marcador de vulnerabilidade moderado e
  // cicatrizável (`ralstoniaExposureWound`), para a lição acontecer em TODAS as
  // seeds sem depender da sorte da geração.
  function reserveSpreadTarget(sourceFocus) {
    if (!sourceFocus?.root) return null;
    const janela = segmentWindow('p9-spread-intro');
    const candidatas = eligibleRoots().filter(root => (
      root !== sourceFocus.root
      && !foci.some(focus => focus.root === root)
      && (root.logicIndex ?? -1) > (sourceFocus.rootLogicIndex ?? -1)
      && (!janela || (root.logicIndex ?? -1) <= janela.to + 6)
    ));
    if (!candidatas.length) return null;

    const dentroDaFaixa = candidatas.filter(root => {
      const distancia = Math.abs((root.x + root.w / 2) - (sourceFocus.root.x + sourceFocus.root.w / 2));
      return distancia >= CONFIG.minimumSpreadDistance && distancia <= CONFIG.maximumSpreadDistance;
    });
    const pool = dentroDaFaixa.length ? dentroDaFaixa : candidatas;

    // Prefere quem já tem porta real; senão abre uma pequena lesão suscetível.
    const ordenadas = pool.slice().sort((a, b) => {
      const naJanelaA = janela && (a.logicIndex ?? -1) >= janela.from ? 0 : 1;
      const naJanelaB = janela && (b.logicIndex ?? -1) >= janela.from ? 0 : 1;
      if (naJanelaA !== naJanelaB) return naJanelaA - naJanelaB;
      const portaDelta = ralstoniaSpreadOpening(b) - ralstoniaSpreadOpening(a);
      if (Math.abs(portaDelta) > 1e-6) return portaDelta;
      return (a.logicIndex ?? 0) - (b.logicIndex ?? 0);
    });
    const alvo = ordenadas[0];
    if (!alvo) return null;

    if (ralstoniaSpreadOpening(alvo) <= 0.12) {
      alvo.ralstoniaExposureWound = CONFIG.exposureWoundOpening;
    }
    sourceFocus.reservedSpreadTarget = alvo;
    sourceFocus.reservedSpreadTargetPlatformId = alvo.id ?? alvo.platformId ?? null;
    return alvo;
  }

  function seedFoci() {
    foci.length = 0;
    spreadEvents.length = 0;
    nextId = 1;
    nextEventId = 1;
    neutralizedCount = 0;
    criticalCount = 0;
    averageTransport = 1;
    preventedCount = 0;
    containedCount = 0;
    blockedSpreadCount = 0;
    successfulSpreadCount = 0;
    spreadEventCount = 0;
    spreadWindowReached = false;
    pedagogicalSpreadAttempts = 0;
    didactics.entry = false;
    didactics.obstruction = false;
    didactics.containment = false;
    didactics.spread = false;
    random = createRandom(`${state.campaign?.seed || state.level?.seed || 'ralstonia'}:ralstonia-foci`);

    selectFocusRoots();

    state.level.ralstoniaFoci = foci;
    state.level.ralstoniaSpreadEvents = spreadEvents;
    initialized = true;
  }

  /**
   * INOCULO AMBIENTAL — substitui os focos pre-instalados.
   *
   * A fase deixa de nascer com focos escolhidos na geracao. O inoculo CHEGA a
   * rizosfera da raiz escolhida e comeca no estagio mais precoce que o runtime
   * ja conhece: `pending`, com carga superficial introdutoria e carga vascular
   * ZERO. Dai em diante o ciclo e o de sempre — colonizacao da superficie,
   * procura de porta de entrada, e entrada vascular SOMENTE se a prevencao e o
   * controle falharem.
   *
   * A chegada nunca cria foco vascular nem pula etapa superficial: e por isso
   * que `vascularLoad` entra em 0 e `everEnteredVascular` fica falso.
   */
  function introduceEnvironmentalInoculum({ targetRoot = null, x = null, source = 'arrival' } = {}) {
    const root = targetRoot || eligibleRoots()[0];
    if (!root) return null;
    if (!initialized) {
      // Sem `seedFoci` a lista nem existe: a chegada monta o minimo e segue.
      foci.length = 0;
      spreadEvents.length = 0;
      random = random || createRandom(
        `${state.campaign?.seed || state.level?.seed || 'ralstonia'}:ralstonia-foci`,
      );
      state.level.ralstoniaFoci = foci;
      state.level.ralstoniaSpreadEvents = spreadEvents;
      initialized = true;
    }
    const focus = createFocus({
      root,
      role: 'environmental',
      surfaceLoad: CONFIG.introductoryFocusSurfaceLoad,
      // Zero, e este zero e o ponto todo desta etapa.
      vascularLoad: 0,
      woundOpening: CONFIG.preventionFocusWoundOpening,
      source,
    });
    if (!focus) return null;
    if (Number.isFinite(x)) focus.x = x;
    focus.arrivalSource = source;
    return focus;
  }

  function initialize() {
    // As chegadas dinamicas assumem a primeira geracao: sem elas, `seedFoci`
    // continua sendo quem povoa a fase.
    if (state.level?.dynamicPathogenArrival) {
      foci.length = 0;
      spreadEvents.length = 0;
      state.level.ralstoniaFoci = foci;
      state.level.ralstoniaSpreadEvents = spreadEvents;
      random = createRandom(
        `${state.campaign?.seed || state.level?.seed || 'ralstonia'}:ralstonia-foci`,
      );
      initialized = true;
      return;
    }
    seedFoci();
  }

  // ---------------------------------------------------------------------------
  // B. ATIVAÇÃO POR PROXIMIDADE
  // ---------------------------------------------------------------------------

  function playerCenterX() {
    return state.player.x + state.player.w / 2;
  }

  function distanceToRoot(root) {
    const x = playerCenterX();
    if (x < root.x) return root.x - x;
    if (x > root.x + root.w) return x - (root.x + root.w);
    return 0;
  }

  function playerChunkIndex() {
    let best = -1;
    for (const platform of state.level.platforms || []) {
      if (platform.recovery || platform.final) continue;
      if (playerCenterX() >= (platform.x ?? 0)) best = Math.max(best, platform.logicIndex ?? -1);
    }
    return Math.max(0, best);
  }

  // Nada de doença pendente evoluindo do outro lado do mapa: quando o jogador
  // chegasse, a lesão já seria irreversível e a lição de prevenção impossível.
  function updateActivation(focus, dt) {
    if (focus.activationState === 'active' || focus.activationState === 'neutralized') return;

    if (focus.activationState === 'pending') {
      const near = distanceToRoot(focus.root) <= focus.activationDistance
        || playerChunkIndex() >= (focus.rootLogicIndex ?? Infinity) - 1;
      if (!near) return;
      focus.activationState = 'warning';
      focus.activatedAt = state.time;
      focus.roleBadgeTimer = 6;
      announce(
        focus.role === 'containment'
          ? 'A bactéria já entrou no xilema desta raiz. Agora o objetivo é conter o avanço, não eliminar completamente a infecção.'
          : 'Foco superficial: feche a porta, forme uma barreira ou reduza a população antes da entrada no xilema.',
        6.2, .1,
      );
      return;
    }

    // warning: o foco já é visível e o jogador pode agir, mas a doença ainda
    // não avança. O cartão didático abre aqui (tutorial-triggers lê `foci`) e a
    // graça só corre com o jogo rodando e sem tutorial aberto.
    if (state.tutorialOpen === true) return;
    focus.activationGraceRemaining = Math.max(0, focus.activationGraceRemaining - dt);
    if (focus.activationGraceRemaining <= 0) focus.activationState = 'active';
  }

  // ---------------------------------------------------------------------------
  // E. CONTROLES
  // ---------------------------------------------------------------------------

  function bacillusStrength(focus) {
    let best = 0;
    let melhorFilme = null;
    for (const film of state.level.biofilms || []) {
      if (!film.functional || film.platform !== focus.root) continue;
      const radius = Math.max(24, film.radius || film.targetRadius || 0);
      const distance = Math.abs((film.x || 0) - focus.x);
      if (distance >= radius * 1.45) continue;
      const strength = clamp(film.protectionStrength || film.growth || .25, .18, 1);
      const valor = strength * (1 - distance / (radius * 1.45));
      if (valor > best) { best = valor; melhorFilme = film; }
    }
    // So publica para o audio. O valor devolvido e o mesmo de antes.
    if (melhorFilme?.bacillusColonyId && best > 0) {
      publishControlSignal(state, 'bacillusAntibiosis', {
        colonyId: melhorFilme.bacillusColonyId,
        targetId: focus.id,
        targetType: 'ralstonia',
        pressure: clamp(best, 0, 1),
        x: melhorFilme.x,
        y: melhorFilme.y,
      });
    }
    return clamp(best, 0, 1);
  }

  function azospirillumClosureFor(focus) {
    return ralstoniaAzospirillumClosure({
      colonies: inoculants?.colonies || [],
      lateralRoots: state.level.azospirillumRoots || [],
      root: focus.root,
    });
  }

  // Ferro: UMA passada global por quadro.
  //
  // A versão anterior chamava `pseudomonasStrength(focus, dt)` dentro do laço de
  // focos e descontava `entry.ironReserve` a cada chamada: com dois focos no
  // alcance da mesma colônia o ferro era consumido duas vezes no mesmo quadro.
  // Agora as pressões são calculadas sem mutar nada, a demanda é somada e
  // limitada por colônia, e o desconto acontece uma única vez.
  function resolvePseudomonasControl(activeFoci, dt) {
    const strengthByFocus = new Map();
    const entries = pseudomonas?.colonyStates;
    if (!entries) return strengthByFocus;

    for (const entry of entries.values()) {
      const colony = entry.colony;
      if (!colony || colony.dormant || colony.vigor <= .04) continue;

      let demand = 0;
      let bestPressure = 0;
      for (const focus of activeFoci) {
        const sameRoot = colony.platform === focus.root;
        const distance = Math.hypot(colony.x - focus.x, colony.y - focus.root.y);
        const range = sameRoot ? 310 : 215;
        if (distance >= range) continue;
        const reserve = clamp((entry.ironReserve || 0) / .7, 0, 1);
        const pressure = clamp(
          (1 - distance / range) * colony.vigor * (.35 + reserve * .65) * (sameRoot ? 1.2 : .78),
          0, 1,
        );
        if (pressure <= .025) continue;
        demand += pressure;
        bestPressure = Math.max(bestPressure, pressure);
        strengthByFocus.set(focus.id, Math.max(strengthByFocus.get(focus.id) || 0, pressure));
        publishControlSignal(state, 'pseudomonasSuppression', {
          colonyId: colony.id,
          targetId: focus.id,
          targetType: 'ralstonia',
          pressure,
          x: colony.x,
          y: colony.y,
        });
      }

      if (demand <= 0) continue;
      entry.activePressure = Math.max(entry.activePressure || 0, bestPressure * .7);
      // Demanda limitada: dois focos custam mais que um, mas nunca o dobro
      // linear, e nunca mais de um desconto por quadro.
      entry.ironReserve = Math.max(0, (entry.ironReserve || 0) - dt * .0028 * clamp(demand, 0, 1.4));
    }
    return strengthByFocus;
  }

  // ---------------------------------------------------------------------------
  // Prevenção e contenção
  // ---------------------------------------------------------------------------

  function neutralize(focus) {
    if (focus.neutralized || focus.everEnteredVascular) return;
    focus.neutralized = true;
    focus.activationState = 'neutralized';
    focus.surfaceLoad = 0;
    focus.vascularLoad = 0;
    focus.vascularEfficiency = 1;
    focus.root.ralstoniaSurfaceLoad = 0;
    focus.root.ralstoniaVascularLoad = 0;
    focus.root.ralstoniaWilt = 0;
    focus.root.ralstoniaCarbonMultiplier = 1;
    focus.root.ralstoniaNutrientMultiplier = 1;
    focus.root.ralstoniaDamagePressure = 0;
    focus.root.ralstoniaWoundOpening = focus.woundOpening;
    focus.root.vascularEfficiency = Math.max(focus.root.vascularEfficiency || 0, .92);
    focus.root.recoveryBlocked = false;
    focus.state = 'neutralized';
    neutralizedCount++;
    // `everPrevented` impede contagem dupla se o foco voltasse a ser avaliado.
    if (!focus.everPrevented) {
      focus.everPrevented = true;
      preventedCount++;
    }
    // Foco neutralizado não dissemina: cancela o que estava a caminho dele.
    for (const event of spreadEvents) {
      if (event.sourceFocus !== focus) continue;
      if (event.state === 'warning' || event.state === 'traveling') {
        event.state = 'blocked';
        event.blocked = true;
        releaseTarget(event);
      }
    }
    state.player.soil += 2.2;
    state.player.hope += 2.8;
    entities.burst(focus.x, focus.root.y - 5, '#a8ffe6', 28, 150);
    announce('Infecção superficial neutralizada antes da colonização vascular.', 4.4, .8);
  }

  function contain(focus) {
    if (focus.contained || focus.neutralized) return;
    focus.contained = true;
    // Marco permanente separado do estado atual: o objetivo usa `everContained`
    // e não conta o mesmo foco duas vezes se ele escapar e for contido de novo.
    if (!focus.everContained) {
      focus.everContained = true;
      containedCount++;
    }
    state.player.soil += 1.8;
    state.player.hope += 2.4;
    entities.burst(focus.x, focus.root.y - 5, '#6ce7df', 24, 130);
    announce('Infecção vascular contida: o avanço parou. A raiz segue infectada, porém funcional.', 5.2, 1);
  }

  // ---------------------------------------------------------------------------
  // Publicação dos efeitos (sempre derivada)
  // ---------------------------------------------------------------------------

  function applyRootEffects(focus, dt) {
    const root = focus.root;
    const vascular = clamp(focus.vascularLoad, 0, 1);
    const surface = clamp(focus.surfaceLoad, 0, 1);
    const efficiency = clamp(1 - vascular * .86 - surface * .08, .08, 1);
    const wilt = clamp((vascular - .25) / .75, 0, 1);
    const bacterialDamage = clamp(vascular * .54 + surface * .04, 0, .62);

    focus.vascularEfficiency = efficiency;
    root.ralstoniaSurfaceLoad = surface;
    root.ralstoniaVascularLoad = vascular;
    root.ralstoniaWilt = wilt;
    root.ralstoniaStage = stageLabel(focus);
    root.ralstoniaDamage = bacterialDamage;
    root.ralstoniaWoundOpening = focus.woundOpening;
    // PRESSÃO, não saúde. Quem calcula rootHealth/rootDamage é
    // root-health-gameplay.js — dois donos escrevendo no mesmo campo no mesmo
    // quadro se sobrescreviam e o valor final dependia da ordem de update.
    root.ralstoniaDamagePressure = bacterialDamage;
    root.vascularEfficiency = efficiency;
    root.mycorrhizaEfficiency = efficiency;
    // MULTIPLICADORES, não valores destruídos. Antes isto era
    // `root.carbonAvailability = Math.min(anterior, novo)`, que só podia cair:
    // quando a carga vascular recuava, carbono e nutrição ficavam presos no pior
    // valor da partida. Agora quem consome multiplica pelo seu próprio base.
    root.ralstoniaCarbonMultiplier = clamp(efficiency * (1 - vascular * .18), .05, 1);
    root.ralstoniaNutrientMultiplier = clamp(efficiency * (1 - vascular * .12), .04, 1);
    root.recoveryBlocked = vascular >= .58;

    for (const colony of inoculants?.colonies || []) {
      if (colony.platform !== root) continue;
      colony.vascularStress = vascular;
      colony.vascularEfficiencyMultiplier = clamp(1 - vascular * .38, 0, 1);
      colony.vigor = clamp(colony.vigor - dt * vascular * .0035, 0, 1);
    }

    for (const site of state.level.rhizobiumNodules || []) {
      if (site.platform !== root) continue;
      // Multiplicar fixationRate/activity a cada quadro destruía o valor-base de
      // forma acumulativa e irreversível: tirar a pressão não devolvia nada.
      // O base fica intacto e o efetivo é derivado dele.
      if (!Number.isFinite(site.baseFixationRate)) site.baseFixationRate = site.fixationRate || 0;
      if (!Number.isFinite(site.baseActivity)) site.baseActivity = site.activity || 0;
      const rawFixation = site.baseFixationRate;
      const adjustedFixation = rawFixation * efficiency;
      const lostFixation = Math.max(0, rawFixation - adjustedFixation);
      site.vascularEfficiency = efficiency;
      site.effectiveActivity = site.baseActivity * efficiency;
      site.effectiveFixationRate = adjustedFixation;
      state.player.soil = Math.max(0, state.player.soil - dt * .022 * lostFixation);
      state.player.hope = Math.max(0, state.player.hope - dt * .013 * lostFixation);
    }
  }

  function standingOn(root) {
    const player = state.player;
    const centerX = player.x + player.w / 2;
    const feetY = player.y + player.h;
    return centerX >= root.x - 4
      && centerX <= root.x + root.w + 4
      && Math.abs(feetY - root.y) < 20;
  }

  function applyGameplayPressure(focus, dt) {
    if (!standingOn(focus.root) || focus.neutralized) return;
    const vascular = focus.vascularLoad;
    if (vascular > .42) {
      state.player.moveMultiplier = Math.min(state.player.moveMultiplier ?? 1, 1 - vascular * .18);
      state.player.jumpMultiplier = Math.min(state.player.jumpMultiplier ?? 1, 1 - vascular * .1);
      state.player.hope = Math.max(0, state.player.hope - dt * vascular * .15);
      state.player.soil = Math.max(0, state.player.soil - dt * vascular * .065);
    }

    if (vascular < .86) return;
    focus.stressTimer -= dt;
    if (focus.stressTimer > 0) return;
    focus.stressCycle = (focus.stressCycle || 0) + 1;
    focus.stressTimer = 3.6 + hashRoot(focus.root, 149 + focus.stressCycle) * 1.8;
    entities.damagePlayer?.(1, 'colapso de raiz com murcha vascular', {
      infection: 0,
      invuln: 1.1,
      knockbackX: (hashRoot(focus.root, 167 + (focus.stressCycle || 0)) < .5 ? -1 : 1) * 135,
      knockbackY: -185,
    });
    entities.burst(state.player.x + state.player.w / 2, focus.root.y - 2, '#b78a63', 18, 115);
    announce('Raiz em murcha crítica: o colapso vascular tornou a plataforma instável.', 4.2, 1.3);
  }

  // ---------------------------------------------------------------------------
  // C + D. PORTA E CRESCIMENTO
  // ---------------------------------------------------------------------------

  function updateWound(focus, dt) {
    const root = focus.root;
    const dynamics = ralstoniaWoundDynamics({
      currentOpening: focus.woundOpening,
      rootHealth: root.rootHealth ?? 1,
      rootDamage: Number.isFinite(root.rootGameplayDamage) ? root.rootGameplayDamage : null,
      meloidogynePressure: root.meloidogyneBurden || 0,
      rhizoctoniaPressure: Math.max(
        root.rhizoctoniaColonization || 0,
        root.rhizoctoniaPressure || 0,
      ),
      azospirillumClosure: focus.azospirillumClosure,
      dt,
      config: CONFIG,
    });
    focus.woundOpening = dynamics.nextOpening;
    focus.openingPressure = dynamics.openingPressure;
    focus.closurePressure = dynamics.closurePressure;
    focus.lesionFloor = dynamics.lesionFloor;
    root.ralstoniaWoundOpening = focus.woundOpening;
  }

  // MOVIMENTO VISUAL. Não toca em `offsetX` (a âncora): calcula `visualX`, um
  // deslocamento suave dentro de uma faixa segura da raiz. Enquanto a infecção é
  // superficial a bactéria patrulha a superfície; ao entrar no xilema, a
  // animação de entrada roda uma vez e depois o movimento passa a ser interno.
  function updateVisualMotion(focus, dt) {
    const root = focus.root;
    const margem = Math.min(28, root.w * .16);
    const amplitude = Math.min(root.w * .18, 35);
    const velocidade = .55 + (focus.surfaceLoad || 0) * .5;

    focus.surfaceMotionPhase += dt * velocidade * focus.surfaceMotionDirection;
    focus.surfaceTravel = Math.sin(focus.surfaceMotionPhase + focus.phase);
    focus.visualX = clamp(
      focus.x + focus.surfaceTravel * amplitude,
      root.x + margem,
      root.x + root.w - margem,
    );

    // Animação da entrada: ~1s, disparada na transição para o xilema.
    if (focus.everEnteredVascular && focus.entryVisualProgress < 1) {
      focus.entryVisualProgress = clamp(focus.entryVisualProgress + dt, 0, 1);
    }
    if (focus.roleBadgeTimer > 0) focus.roleBadgeTimer = Math.max(0, focus.roleBadgeTimer - dt);
  }

  function updateFocus(focus, dt, pseudomonasByFocus) {
    if (!focus.root || !(state.level.platforms || []).includes(focus.root)) return;
    focus.age += dt;

    // Posição sempre derivada da raiz (ancoragem).
    if (Number.isFinite(focus.offsetX)) {
      focus.x = focus.root.x + focus.offsetX + (focus.root.supportOffset || 0);
    }
    updateVisualMotion(focus, dt);

    updateActivation(focus, dt);

    if (focus.neutralized) {
      focus.root.vascularEfficiency = Math.min(1, (focus.root.vascularEfficiency || .92) + dt * .015);
      return;
    }

    // Controles são lidos mesmo em `warning`: o jogador precisa ver a barreira
    // e a porta reagirem antes da doença começar a correr.
    focus.azospirillumClosure = azospirillumClosureFor(focus);
    focus.bacillusControl = bacillusStrength(focus);
    focus.pseudomonasControl = pseudomonasByFocus.get(focus.id) || 0;

    // Pendente não faz NADA: não cresce, não fecha porta, não gasta recurso,
    // não pressiona a raiz.
    if (focus.activationState === 'pending') {
      focus.surfaceNetRate = 0;
      focus.vascularNetRate = 0;
      return;
    }

    updateWound(focus, dt);

    const growth = ralstoniaNetGrowth({
      surfaceLoad: focus.surfaceLoad,
      vascularLoad: focus.vascularLoad,
      woundOpening: focus.woundOpening,
      bacillusControl: focus.bacillusControl,
      pseudomonasControl: focus.pseudomonasControl,
      config: CONFIG,
    });
    focus.surfaceNetRate = growth.surfaceRate;
    focus.vascularNetRate = growth.vascularRate;
    focus.controlStrength = growth.control;

    // Em `warning` a doença está congelada: o jogador acabou de descobrir o foco.
    const progressing = focus.activationState === 'active';
    if (progressing) {
      focus.surfaceLoad = clamp(focus.surfaceLoad + dt * growth.surfaceRate, 0, 1);
      const floor = focus.everEnteredVascular ? CONFIG.minimumVascularFloorAfterEntry : 0;
      focus.vascularLoad = clamp(focus.vascularLoad + dt * growth.vascularRate, floor, 1);
    }

    const wasVascular = focus.everEnteredVascular;
    if (focus.vascularLoad >= CONFIG.vascularEntryThreshold) focus.everEnteredVascular = true;
    if (!wasVascular && focus.everEnteredVascular) {
      didactics.entry = true;
      focus.announcedEntry = true;
      focus.entryVisualProgress = 0;
      announce('Entrada de Ralstonia: a bactéria atravessou uma região lesionada e alcançou os vasos da raiz.', 5.2, 1.1);
    }
    if (focus.vascularLoad >= CONFIG.obstructionThreshold) didactics.obstruction = true;

    // PREVENÇÃO. Não exige Bacillus nem Pseudomonas: porta fechada OU controle
    // direto suficiente, com a superfície praticamente zerada.
    const doorClosed = focus.woundOpening <= CONFIG.woundColonizationLimit;
    const directControl = growth.control > .3;
    if (progressing
      && !focus.everEnteredVascular
      && focus.surfaceLoad <= CONFIG.surfaceNeutralizationThreshold
      && (doorClosed || directControl)) {
      focus.neutralizeHold += dt;
      if (focus.neutralizeHold >= CONFIG.neutralizationHoldSeconds) {
        neutralize(focus);
        return;
      }
    } else {
      focus.neutralizeHold = 0;
    }

    // CONTENÇÃO. Já entrou, o avanço parou e o controle se manteve.
    if (progressing && focus.everEnteredVascular && growth.holdingVascular && growth.control > .25) {
      focus.containHold += dt;
      if (focus.containHold >= CONFIG.containmentHoldSeconds) {
        contain(focus);
        didactics.containment = true;
      }
    } else {
      focus.containHold = 0;
      // Voltou a crescer: deixa de estar contido (o estado é mantido, não dado).
      if (focus.contained && growth.vascularRate > 0) focus.contained = false;
    }

    focus.state = focusState(focus);

    if (focus.vascularLoad >= .36 && !focus.announcedVascular) {
      focus.announcedVascular = true;
      announce('Colonização vascular ativa: transporte de água, carbono e nutrientes começou a cair.', 5.3, 1.2);
    }
    if (focus.vascularLoad >= CONFIG.criticalThreshold && !focus.announcedCritical) {
      focus.announcedCritical = true;
      announce('Murcha vascular crítica: Bacillus e Pseudomonas agora apenas desaceleram o avanço; a prevenção teria sido mais eficiente.', 6, 1.2);
    }

    applyRootEffects(focus, dt);
    applyGameplayPressure(focus, dt);

    focus.oozeTimer -= dt;
    if (focus.oozeTimer <= 0 && (focus.surfaceLoad > .1 || focus.vascularLoad > .18)) {
      focus.oozeCycle = (focus.oozeCycle || 0) + 1;
      const jitter = hashRoot(focus.root, 131 + focus.oozeCycle);
      focus.oozeTimer = .3 + jitter * .55;
      entities.burst(
        focus.x + (jitter - .5) * 22,
        focus.root.y - 3,
        focus.vascularLoad > .55 ? '#d8b674' : '#f3d49a',
        3 + Math.floor(focus.vascularLoad * 5),
        38 + focus.vascularLoad * 42,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // F. DISSEMINAÇÃO
  // ---------------------------------------------------------------------------

  function occupiedRoots() {
    const set = new Set();
    for (const focus of foci) {
      if (focus.neutralized) continue;
      set.add(focus.root);
    }
    return set;
  }

  function targetedRoots() {
    const set = new Set();
    for (const event of spreadEvents) {
      if (event.state === 'warning' || event.state === 'traveling') set.add(event.targetRoot);
    }
    return set;
  }

  function releaseTarget(event) {
    if (event.targetRoot) delete event.targetRoot.ralstoniaSpreadIncoming;
  }

  function hasActiveEvent(focus) {
    return spreadEvents.some(event => (
      event.sourceFocus === focus
      && (event.state === 'warning' || event.state === 'traveling')
    ));
  }

  // GARANTIA PEDAGÓGICA da terceira lição.
  //
  // A versão anterior marcava `spreadWindowReached = true` no primeiro quadro em
  // que o jogador entrava na região — antes de confirmar que havia foco vascular
  // ATIVO e alvo válido. Se o foco ainda estava `pending` (o normal: o jogador
  // chega na região de disseminação antes de o foco de contenção ativar), a
  // única oportunidade era queimada em silêncio e o objetivo de bloquear
  // disseminação virava impossível.
  //
  // Agora a janela só é considerada alcançada quando existem, ao mesmo tempo:
  // foco ativado, capaz de disseminar, e alvo válido reservado ou escolhível.
  function findSpreadCandidate() {
    return foci.find(focus => (
      !focus.neutralized
      && focus.everEnteredVascular
      && focus.activationState === 'active'
      && focus.spreadGeneration < CONFIG.maximumSpreadGeneration
      && !hasActiveEvent(focus)
    )) || null;
  }

  function spreadTargetAvailableFor(focus) {
    if (focus.reservedSpreadTarget
      && (state.level.platforms || []).includes(focus.reservedSpreadTarget)
      && !foci.some(other => other.root === focus.reservedSpreadTarget && !other.neutralized)
      && !targetedRoots().has(focus.reservedSpreadTarget)) {
      return focus.reservedSpreadTarget;
    }
    return chooseRalstoniaSpreadTarget({
      sourceRoot: focus.root,
      roots: eligibleRoots(),
      config: CONFIG,
      random: createRandom(`${state.campaign?.seed || 'ralstonia'}:probe:${focus.id}`),
      occupiedRoots: occupiedRoots(),
      targetedRoots: targetedRoots(),
    });
  }

  function ensureSpreadOpportunity() {
    if (phaseNumber() !== 9) return;
    const window = segmentWindow('p9-spread-intro');
    if (!window) return;
    if (playerChunkIndex() < window.from) return;
    if (blockedSpreadCount > 0) return;
    if (pedagogicalSpreadAttempts >= CONFIG.maximumPedagogicalSpreadAttempts) return;
    // Já existe um evento rolando: deixa o jogador jogar.
    if (spreadEvents.some(event => event.state === 'warning' || event.state === 'traveling')) return;

    const candidate = findSpreadCandidate();
    // Ainda pending ou em warning: NÃO queima a janela — tenta de novo depois.
    if (!candidate) return;
    if (candidate.spreadCooldown > 0) return;
    // Já armado e esperando o próprio timer: não rearma (rearmar a cada quadro
    // reiniciava o relógio e, pior, gastava as três tentativas em três quadros).
    if (candidate.pedagogicalSpread) return;
    const alvo = spreadTargetAvailableFor(candidate);
    if (!alvo) return;

    spreadWindowReached = true;
    candidate.pedagogicalSpread = true;
    // Cada tentativa pedagógica libera uma cota extra: falhar em bloquear a
    // primeira não pode tornar o objetivo impossível.
    candidate.spreadBudgetBonus = Math.max(
      candidate.spreadBudgetBonus,
      pedagogicalSpreadAttempts,
    );
    candidate.spreadTimer = pedagogicalSpreadAttempts === 0
      ? CONFIG.spreadFirstOpportunitySeconds
      : CONFIG.spreadRetrySeconds;
  }

  function openSpreadEvent(focus) {
    // A reserva feita na geração tem prioridade no evento didático: é a raiz que
    // o jogador consegue alcançar e proteger a tempo.
    const reservado = focus.reservedSpreadTarget
      && (state.level.platforms || []).includes(focus.reservedSpreadTarget)
      && !foci.some(other => other.root === focus.reservedSpreadTarget && !other.neutralized)
      && !targetedRoots().has(focus.reservedSpreadTarget)
      ? focus.reservedSpreadTarget
      : null;
    const target = reservado || chooseRalstoniaSpreadTarget({
      sourceRoot: focus.root,
      roots: eligibleRoots(),
      config: CONFIG,
      random: createRandom(
        `${state.campaign?.seed || 'ralstonia'}:spread:${focus.id}:${focus.spreadEventsUsed}:${focus.platformId ?? focus.rootLogicIndex}`,
      ),
      occupiedRoots: occupiedRoots(),
      targetedRoots: targetedRoots(),
    });
    // Sem alvo elegível: não cria evento, não gasta a cota, tenta de novo depois.
    if (!target) {
      focus.spreadTimer = CONFIG.spreadRetrySeconds;
      return null;
    }

    const event = {
      id: `ralstonia-spread-${nextEventId++}`,
      sourceFocusId: focus.id,
      sourceFocus: focus,
      sourceRoot: focus.root,
      targetRoot: target,
      targetPlatformId: target.id ?? target.platformId ?? null,
      state: 'warning',
      warningRemaining: CONFIG.spreadWarningSeconds,
      travelProgress: 0,
      seed: `${focus.id}:${focus.spreadEventsUsed}`,
      blocked: false,
      completed: false,
    };
    if (reservado) {
      focus.reservedSpreadTarget = null;
      focus.reservedSpreadTargetPlatformId = null;
    }
    spreadEvents.push(event);
    focus.spreadEventsUsed++;
    // A tentativa pedagógica só é gasta quando o evento realmente abre.
    if (focus.pedagogicalSpread) pedagogicalSpreadAttempts++;
    focus.pedagogicalSpread = false;
    spreadEventCount++;
    target.ralstoniaSpreadIncoming = CONFIG.spreadWarningSeconds;
    didactics.spread = true;
    announce('Disseminação bacteriana: proteja a raiz marcada antes da chegada.', 5.4, .9);
    return event;
  }

  // Pressão POTENCIAL da Pseudomonas numa raiz, com a mesma conta de alcance,
  // vigor e reserva de ferro usada na passada global — mas sem consumir nada.
  // O HUD e a chegada usam este helper, então o número mostrado ao jogador é o
  // mesmo que decide o bloqueio. Antes o HUD passava `pseudomonas: 0` e mostrava
  // uma proteção menor do que a real.
  function pseudomonasPotential(root, atX = root.x + root.w / 2) {
    let best = 0;
    for (const entry of pseudomonas?.colonyStates?.values() || []) {
      const colony = entry.colony;
      if (!colony || colony.dormant || colony.vigor <= .04) continue;
      const sameRoot = colony.platform === root;
      const distance = Math.hypot(colony.x - atX, colony.y - root.y);
      const range = sameRoot ? 310 : 215;
      if (distance >= range) continue;
      const reserve = clamp((entry.ironReserve || 0) / .7, 0, 1);
      best = Math.max(best, clamp(
        (1 - distance / range) * colony.vigor * (.35 + reserve * .65) * (sameRoot ? 1.2 : .78),
        0, 1,
      ));
    }
    return best;
  }

  function resolveArrival(event) {
    const target = event.targetRoot;
    const probe = { root: target, x: target.x + target.w / 2 };
    const azo = ralstoniaAzospirillumClosure({
      colonies: inoculants?.colonies || [],
      lateralRoots: state.level.azospirillumRoots || [],
      root: target,
    });
    const bacillus = bacillusStrength(probe);
    const pseudo = pseudomonasPotential(target, probe.x);

    const opening = ralstoniaSpreadOpening(target);
    const verdict = ralstoniaArrivalProtection({
      bacillus,
      pseudomonas: pseudo,
      azospirillumClosure: azo,
      rootHealth: target.rootHealth ?? 1,
      opening,
      config: CONFIG,
    });
    event.arrivalProtection = verdict.protection;
    event.arrivalOpening = opening;

    if (verdict.blocked) {
      event.state = 'blocked';
      event.blocked = true;
      blockedSpreadCount++;
      state.player.soil += 1.4;
      state.player.hope += 1.9;
      entities.burst(probe.x, target.y - 6, '#8ef0c6', 26, 145);
      entities.burst(probe.x, target.y - 14, '#a8ffe6', 18, 95);
      announce(
        verdict.sealed
          ? 'Disseminação bloqueada: a raiz estava cicatrizada e a bactéria não encontrou porta de entrada.'
          : 'Disseminação bloqueada: a proteção biológica impediu a colonização da nova raiz.',
        5, .9,
      );
      // A raiz resistiu: a lesão suscetível criada para a lição cicatriza.
      delete target.ralstoniaExposureWound;
      releaseTarget(event);
      return;
    }

    // Falhou em bloquear: nasce um foco SUPERFICIAL — nunca vascular, nunca
    // crítico. O jogador ainda pode prevenir este.
    event.state = 'completed';
    event.completed = true;
    if (foci.filter(focus => !focus.neutralized).length < CONFIG.maximumFocusCount) {
      const born = createFocus({
        root: target,
        role: 'spread',
        surfaceLoad: CONFIG.spreadFocusInitialSurfaceLoad,
        vascularLoad: 0,
        woundOpening: opening,
        spreadGeneration: (event.sourceFocus?.spreadGeneration || 0) + 1,
        source: event.sourceFocusId,
        graceSeconds: CONFIG.spreadFocusGraceSeconds,
      });
      born.activationState = 'warning';
      born.activatedAt = state.time;
      successfulSpreadCount++;
      entities.burst(probe.x, target.y - 6, '#e8c27e', 24, 130);
      entities.burst(probe.x, target.y - 2, '#d8b674', 16, 70);
      announce('A disseminação chegou: nasceu um novo foco superficial. Ainda dá para prevenir a entrada nesta raiz.', 5.4, .9);
    }
    releaseTarget(event);
  }

  function updateSpread(dt) {
    ensureSpreadOpportunity();

    for (const focus of foci) {
      focus.spreadCooldown = Math.max(0, focus.spreadCooldown - dt);
      if (!canRalstoniaFocusSpread(focus, {
        config: CONFIG,
        activeEventForFocus: hasActiveEvent(focus),
      })) continue;
      if (state.tutorialOpen === true) continue;
      focus.spreadTimer -= dt;
      if (focus.spreadTimer > 0) continue;
      focus.spreadTimer = CONFIG.spreadRetrySeconds;
      openSpreadEvent(focus);
    }

    for (const event of spreadEvents) {
      if (event.state === 'warning') {
        if (state.tutorialOpen === true) continue;
        event.warningRemaining = Math.max(0, event.warningRemaining - dt);
        if (event.targetRoot) event.targetRoot.ralstoniaSpreadIncoming = event.warningRemaining;
        if (event.warningRemaining <= 0) {
          event.state = 'traveling';
          event.travelProgress = 0;
        }
        continue;
      }
      if (event.state === 'traveling') {
        if (state.tutorialOpen === true) continue;
        event.travelProgress = clamp(
          event.travelProgress + dt / Math.max(.4, CONFIG.spreadTravelSeconds),
          0, 1,
        );
        if (event.targetRoot) {
          event.targetRoot.ralstoniaSpreadIncoming = (1 - event.travelProgress)
            * CONFIG.spreadTravelSeconds;
        }
        if (event.travelProgress >= 1) resolveArrival(event);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------

  function update(dt) {
    if (state.gameState !== 'play') return;
    if (!initialized) initialize();

    // Uma passada global de ferro antes dos focos: consumo único por colônia.
    // Só foco ATIVO gera demanda contínua e consome ferro. Em `warning` a doença
    // está congelada e o jogador ainda está lendo o cartão: gastar reserva ali
    // punia quem parou para entender.
    const activeFoci = foci.filter(focus => (
      !focus.neutralized && focus.activationState === 'active'
    ));
    const pseudomonasByFocus = resolvePseudomonasControl(activeFoci, dt);

    criticalCount = 0;
    let transportSum = 0;
    let active = 0;
    for (const focus of foci) {
      updateFocus(focus, dt, pseudomonasByFocus);
      if (focus.neutralized) continue;
      active++;
      transportSum += focus.vascularEfficiency;
      if (focus.vascularLoad >= CONFIG.criticalThreshold) criticalCount++;
    }
    averageTransport = active ? transportSum / active : 1;

    updateSpread(dt);
  }

  // ---------------------------------------------------------------------------
  // G. RENDERIZAÇÃO
  // ---------------------------------------------------------------------------

  // Uma célula pequena de Ralstonia. Usa a sprite quando existe; senão desenha o
  // bacilo procedural. Nunca desenha "a sprite grande" repetida.
  function drawCell(ctx, x, y, { height = 26, phase = 0, alpha = .8, scale = 1, flip = false }) {
    if (organismSprites.draw(ctx, 'ralstonia', {
      x, y, height: height * scale, time: state.time, phase,
      alpha, anchorY: .5, flipX: flip,
    })) return;
    const rod = 2.2 * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(phase + state.time * .6) * .5);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#e8c27e';
    ctx.strokeStyle = 'rgba(107,69,44,.8)';
    ctx.lineWidth = .7;
    ctx.beginPath();
    ctx.roundRect(-rod, -1.2 * scale, rod * 2, 2.4 * scale, 1.2 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // População + movimento.
  //
  // A versão anterior tinha `if (organismSprites.draw(...)) return;` no topo:
  // quando a folha de sprites carregava, a bactéria virava UMA figura parada em
  // `focus.x` e todo o resto — os bacilos menores, a entrada, o interior do vaso
  // — nunca era desenhado. A sprite agora é a célula principal e convive com a
  // população ao redor.
  function drawBacteria(ctx, focus) {
    const root = focus.root;
    const surface = clamp(focus.surfaceLoad, 0, 1);
    const vascular = clamp(focus.vascularLoad, 0, 1);
    const entrando = focus.everEnteredVascular && focus.entryVisualProgress < 1;
    const alphaBase = focus.neutralized ? .38 : .72 + surface * .28;

    // Célula principal. Enquanto está fora, patrulha a superfície; durante a
    // animação de entrada, encolhe e desce para dentro do tecido.
    const t = clamp(focus.entryVisualProgress, 0, 1);
    const mergulho = entrando ? t * Math.min(root.h * .55, 26) : 0;
    const escala = entrando ? 1 - t * .55 : 1;
    organismSprites.draw(ctx, 'ralstonia', {
      x: focus.visualX ?? focus.x,
      y: root.y + 2 + mergulho,
      height: (58 + surface * 12) * escala,
      time: state.time,
      phase: focus.phase,
      alpha: entrando ? alphaBase * (1 - t * .8) : alphaBase,
      anchorY: .88,
      flipX: (focus.surfaceMotionDirection || 1) < 0,
    }) || drawCell(ctx, focus.visualX ?? focus.x, root.y - 12, {
      height: 44, phase: focus.phase, alpha: alphaBase, scale: 2.4,
    });

    // População superficial: 2 a 5 células menores, fases e direções diferentes.
    if (!focus.neutralized || focus.age < 6) {
      const quantidade = 2 + Math.round(surface * 3);
      const margem = Math.min(26, root.w * .16);
      for (let i = 0; i < quantidade; i++) {
        const fase = focus.phase + i * 1.87;
        const direcao = i % 2 ? 1 : -1;
        const passeio = Math.sin(state.time * (.35 + i * .07) * direcao + fase);
        const x = clamp(
          focus.x + passeio * Math.min(root.w * .3, 62),
          root.x + margem,
          root.x + root.w - margem,
        );
        const y = root.y - 6 - Math.abs(Math.sin(fase + state.time * .5)) * 7;
        drawCell(ctx, x, y, {
          height: 20 + (i % 3) * 4,
          phase: fase,
          alpha: (focus.neutralized ? .3 : .62) + surface * .3,
          scale: .8 + (i % 3) * .12,
          flip: direcao < 0,
        });
      }
    }

    // Duas células acompanhando a bactéria principal para dentro da abertura.
    if (entrando) {
      for (let i = 0; i < 2; i++) {
        const atraso = clamp(t - i * .18, 0, 1);
        drawCell(
          ctx,
          (focus.visualX ?? focus.x) + (i ? 9 : -9),
          root.y - 4 + atraso * Math.min(root.h * .5, 22),
          {
            height: 18,
            phase: focus.phase + i * 2.1,
            alpha: (1 - atraso) * .85,
            scale: 1 - atraso * .5,
          },
        );
      }
    }
  }

  // MOVIMENTO VASCULAR: células dentro do vaso, recortadas pelo bloco. O ritmo
  // conta o estágio — fluxo lento em `vascular`, grupos irregulares em
  // `obstructed`, pulsos congestionados em `critical`, quase parado em
  // `contained`. Nada de Math.random por quadro: posição vem de fase + índice.
  function drawVascularMotion(ctx, focus) {
    const root = focus.root;
    const vascular = clamp(focus.vascularLoad, 0, 1);
    if (focus.neutralized || vascular < CONFIG.vascularEntryThreshold) return;

    const estagio = focus.state;
    const quantidade = Math.min(14, 2 + Math.round(vascular * 12));
    const velocidade = estagio === 'contained' ? .12
      : estagio === 'critical' ? .95
      : estagio === 'obstructed' ? .5
      : .32;
    const cor = estagio === 'critical' ? 'rgba(255,150,150,'
      : estagio === 'contained' ? 'rgba(140,230,220,'
      : 'rgba(240,214,160,';

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(root.x, root.y, root.w, root.h, 14);
    ctx.clip();

    for (let i = 0; i < quantidade; i++) {
      const faseCelula = focus.phase + i * 2.399;
      // Percorre o vaso da esquerda para a direita, com volta contínua.
      let avanco = (state.time * velocidade + i / quantidade) % 1;
      if (estagio === 'obstructed') {
        // Interrupções: a célula trava por trechos.
        avanco = avanco < .5 ? avanco : .5 + (avanco - .5) * .35;
      }
      const x = root.x + 10 + avanco * Math.max(20, root.w - 20);
      const faixa = Math.min(root.h - 16, 10 + vascular * 30);
      const y = root.y + 10 + ((i % 4) / 3) * faixa
        + Math.sin(faseCelula + state.time * velocidade * 2) * 2.2;
      const brilho = estagio === 'critical' ? .55 + Math.abs(Math.sin(state.time * 3 + faseCelula)) * .35 : .5;
      ctx.fillStyle = `${cor}${brilho.toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 2.6 + vascular * 1.4, 1.4 + vascular * .8, faseCelula, 0, TAU);
      ctx.fill();
    }

    // Contido: brilho de controle sobre a carga residual, que continua visível.
    if (focus.contained) {
      ctx.strokeStyle = 'rgba(108,231,223,.5)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(root.x + 3, root.y + 3, root.w - 6, root.h - 6, 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawVascularBlockage(ctx, focus) {
    const root = focus.root;
    const vascular = clamp(focus.vascularLoad, 0, 1);
    if (vascular <= .045) return;
    const span = clamp(34 + root.w * vascular * .62, 34, root.w - 18);
    const left = clamp(focus.x - span / 2, root.x + 9, root.x + root.w - span - 9);
    const vesselCount = 3 + Math.floor(vascular * 5);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(root.x, root.y, root.w, root.h, 14);
    ctx.clip();

    const stain = ctx.createLinearGradient(left, root.y, left + span, root.y + root.h);
    stain.addColorStop(0, 'rgba(93,55,36,0)');
    stain.addColorStop(.22, `rgba(82,48,30,${.12 + vascular * .22})`);
    stain.addColorStop(.5, `rgba(43,28,25,${.24 + vascular * .38})`);
    stain.addColorStop(.8, `rgba(104,67,37,${.1 + vascular * .2})`);
    stain.addColorStop(1, 'rgba(93,55,36,0)');
    ctx.fillStyle = stain;
    ctx.fillRect(left, root.y, span, root.h);

    for (let i = 0; i < vesselCount; i++) {
      const y = root.y + 12 + i / Math.max(1, vesselCount - 1) * Math.max(8, root.h - 24);
      const blockage = .18 + vascular * .74;
      ctx.strokeStyle = `rgba(48,29,24,${.24 + vascular * .58})`;
      ctx.lineWidth = 1.2 + vascular * 2.1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.bezierCurveTo(
        left + span * .3, y + Math.sin(i + focus.phase) * 6,
        left + span * .68, y - 4,
        left + span, y + Math.cos(i + focus.phase) * 4,
      );
      ctx.stroke();

      ctx.strokeStyle = `rgba(236,194,119,${.12 + (1 - blockage) * .45})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5 + vascular * 8]);
      ctx.beginPath();
      ctx.moveTo(left, y - 2);
      ctx.lineTo(left + span, y - 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // Estado do foco, desenhado sobre a raiz.
  //
  // ATENÇÃO: esta função roda DENTRO do save()/translate() de render(). Ela
  // precisa fechar exatamente os save() que abrir. Uma versão anterior chamava
  // ctx.restore() sem nenhum save() próprio: isso desempilhava a translação da
  // câmera e todo sistema desenhado DEPOIS da Ralstonia perdia a referência.
  function drawStatus(ctx, focus) {
    if (focus.neutralized && focus.age > 10) return;
    if (focus.activationState === 'pending') return;
    const root = focus.root;
    const x = focus.x;
    const y = root.y + Math.min(root.h - 14, 34);
    const width = Math.min(132, Math.max(96, root.w * .62));
    const surface = clamp(focus.surfaceLoad, 0, 1);
    const vascular = clamp(focus.vascularLoad, 0, 1);
    const opening = clamp(focus.woundOpening, 0, 1);
    const left = x - width / 2;

    ctx.save();

    // Trilho 1 — carga superficial (o que está FORA do tecido).
    ctx.fillStyle = 'rgba(6,20,24,.72)';
    ctx.fillRect(left, y, width, 3.5);
    ctx.fillStyle = 'rgba(232,194,126,.78)';
    ctx.fillRect(left, y, width * surface, 3.5);

    // Trilho 2 — carga vascular (o que já está DENTRO).
    ctx.fillStyle = 'rgba(6,20,24,.72)';
    ctx.fillRect(left, y + 4.5, width, 5);
    ctx.fillStyle = focus.neutralized ? 'rgba(142,240,198,.7)'
      : vascular >= CONFIG.criticalThreshold ? '#ff6f91'
      : vascular >= CONFIG.obstructionThreshold ? '#e8905e'
      : vascular >= CONFIG.vascularEntryThreshold ? '#e8c27e'
      : 'rgba(232,194,126,.35)';
    ctx.fillRect(left, y + 4.5, width * Math.max(vascular, focus.neutralized ? 0 : .03), 5);
    // Contido: marca de crescimento interrompido, com a carga residual visível.
    if (focus.contained && !focus.neutralized) {
      ctx.strokeStyle = 'rgba(108,231,223,.95)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(left + width * vascular, y + 3.4);
      ctx.lineTo(left + width * vascular, y + 11);
      ctx.stroke();
    }

    // Trilho 3 — PORTA DE ENTRADA. Verde-azulado quando está fechando por
    // Azospirillum/cicatrização; âmbar quando continua aberta.
    const doorY = y + 10.5;
    ctx.fillStyle = 'rgba(6,20,24,.6)';
    ctx.fillRect(left, doorY, width, 2.5);
    ctx.fillStyle = opening <= CONFIG.woundSealThreshold ? 'rgba(142,240,198,.95)'
      : opening <= CONFIG.woundColonizationLimit ? 'rgba(126,214,205,.9)'
      : 'rgba(255,150,110,.85)';
    ctx.fillRect(left, doorY, width * Math.max(.02, opening), 2.5);

    // Marcas de controle: Bacillus (contorno de biofilme) e Pseudomonas (ferro).
    if (focus.bacillusControl > .02) {
      ctx.strokeStyle = 'rgba(168,255,230,.85)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(left, doorY + 4.5);
      ctx.lineTo(left + width * focus.bacillusControl, doorY + 4.5);
      ctx.stroke();
    }
    if (focus.pseudomonasControl > .02) {
      ctx.fillStyle = 'rgba(244,162,97,.9)';
      const dots = Math.max(1, Math.round(focus.pseudomonasControl * 7));
      for (let i = 0; i < dots; i++) {
        ctx.beginPath();
        ctx.arc(left + 2 + i * 5.5, doorY + 8, 1.5, 0, TAU);
        ctx.fill();
      }
    }
    if (focus.azospirillumClosure > .02) {
      ctx.strokeStyle = 'rgba(126,214,205,.9)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(left, doorY + 2.2);
      ctx.lineTo(left + width * focus.azospirillumClosure, doorY + 2.2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.font = '700 9px Inter,system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = focus.neutralized ? 'rgba(168,255,230,.9)' : 'rgba(245,226,190,.92)';
    ctx.fillText(stageLabel(focus), x, y - 10);
    ctx.font = '600 8px Inter,system-ui';
    ctx.fillStyle = opening <= CONFIG.woundColonizationLimit
      ? 'rgba(142,240,198,.9)'
      : 'rgba(255,178,150,.9)';
    ctx.fillText(ralstoniaDoorLabel(opening, CONFIG), x, y - 1.5);

    ctx.restore();
  }

  // Selo de papel, temporário: diz de cara se este foco ainda dá para PREVENIR ou
  // se já é caso de CONTER. Some depois de alguns segundos; o painel contextual
  // continua com a informação.
  function drawRoleBadge(ctx, focus) {
    if (focus.roleBadgeTimer <= 0 || focus.neutralized) return;
    const alpha = clamp(focus.roleBadgeTimer / 1.2, 0, 1);
    const x = focus.visualX ?? focus.x;
    const y = focus.root.y - 46;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '800 11px Inter,system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = focus.role === 'containment' ? 'rgba(255,150,110,.95)' : 'rgba(240,214,160,.95)';
    ctx.fillText(focus.shortRoleLabel || 'Foco', x, y);
    ctx.restore();
  }

  // Marcador de REGIÃO para foco ainda pendente. Só aparece quando Miguelito
  // está perto (dois chunks ou ~1,5 tela): o foco de contenção era invisível até
  // ativar, e o jogador não tinha como saber que havia uma segunda lição adiante.
  function drawPendingMarker(ctx, focus) {
    if (focus.activationState !== 'pending') return;
    const distancia = distanceToRoot(focus.root);
    const perto = distancia <= W * 1.5
      || playerChunkIndex() >= (focus.rootLogicIndex ?? Infinity) - 2;
    if (!perto) return;

    const root = focus.root;
    const x = root.x + root.w / 2;
    const y = root.y - 34;
    const pulso = .55 + Math.abs(Math.sin(state.time * 1.6 + focus.phase)) * .35;

    ctx.save();
    ctx.globalAlpha = pulso;
    ctx.strokeStyle = focus.role === 'containment' ? 'rgba(255,150,110,.85)' : 'rgba(240,214,160,.8)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.roundRect(root.x - 2, root.y - 6, root.w + 4, root.h + 8, 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '700 10px Inter,system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = focus.role === 'containment' ? 'rgba(255,178,150,.95)' : 'rgba(245,226,190,.95)';
    ctx.fillText(
      focus.role === 'containment' ? 'Infecção vascular adiante' : 'Contaminação superficial adiante',
      x, y,
    );
    ctx.restore();
  }

  function drawSpreadEvent(ctx, event) {
    if (event.state !== 'warning' && event.state !== 'traveling') return;
    const source = event.sourceRoot;
    const target = event.targetRoot;
    if (!source || !target) return;
    const x0 = source.x + source.w / 2;
    const y0 = source.y - 4;
    const x1 = target.x + target.w / 2;
    const y1 = target.y - 4;

    ctx.save();

    // Fluxo entre origem e alvo — pontilhado no aviso, contínuo na viagem.
    ctx.strokeStyle = event.state === 'warning'
      ? 'rgba(255,178,150,.5)'
      : 'rgba(232,194,126,.85)';
    ctx.lineWidth = event.state === 'warning' ? 1.2 : 2;
    if (event.state === 'warning') ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - 58, x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);

    // Alvo claramente marcado.
    ctx.strokeStyle = 'rgba(255,111,145,.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.roundRect(target.x - 3, target.y - 5, target.w + 6, target.h + 8, 15);
    ctx.stroke();
    ctx.setLineDash([]);

    // Contagem regressiva discreta.
    const remaining = event.state === 'warning'
      ? event.warningRemaining
      : (1 - event.travelProgress) * CONFIG.spreadTravelSeconds;
    ctx.font = '700 10px Inter,system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,196,180,.95)';
    ctx.fillText(`${remaining.toFixed(1)}s`, x1, target.y - 12);

    // Bactérias viajando ao longo da curva — não círculos, e não teleporte.
    if (event.state === 'traveling') {
      const t = event.travelProgress;
      const ctrlX = (x0 + x1) / 2;
      const ctrlY = Math.min(y0, y1) - 58;
      const ponto = p => ({
        x: (1 - p) * (1 - p) * x0 + 2 * (1 - p) * p * ctrlX + p * p * x1,
        y: (1 - p) * (1 - p) * y0 + 2 * (1 - p) * p * ctrlY + p * p * y1,
      });
      for (let i = 0; i < 4; i++) {
        const p = clamp(t - i * .075, 0, 1);
        const atual = ponto(p);
        const seguinte = ponto(clamp(p + .04, 0, 1));
        const angulo = Math.atan2(seguinte.y - atual.y, seguinte.x - atual.x);
        ctx.save();
        ctx.translate(atual.x, atual.y);
        ctx.rotate(angulo);
        ctx.translate(-atual.x, -atual.y);
        drawCell(ctx, atual.x, atual.y, {
          height: 20 - i * 2,
          phase: i * 1.7,
          alpha: .9 - i * .18,
          scale: .95 - i * .12,
          flip: x1 < x0,
        });
        ctx.restore();
        // Exsudato bacteriano de apoio.
        ctx.fillStyle = `rgba(232,194,126,${.35 - i * .07})`;
        ctx.beginPath();
        ctx.arc(atual.x, atual.y + 4, 2 - i * .3, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function render(ctx) {
    if (!foci.length && !spreadEvents.length) return;
    ctx.save();
    ctx.translate(-state.cameraX, 0);
    for (const event of spreadEvents) drawSpreadEvent(ctx, event);
    for (const focus of foci) {
      if (focus.root.x + focus.root.w < state.cameraX - 100 || focus.root.x > state.cameraX + W + 100) continue;
      if (focus.activationState === 'pending') {
        drawPendingMarker(ctx, focus);
        continue;
      }
      drawVascularBlockage(ctx, focus);
      drawVascularMotion(ctx, focus);
      drawBacteria(ctx, focus);
      drawStatus(ctx, focus);
      drawRoleBadge(ctx, focus);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Snapshot para HUD e debug
  // ---------------------------------------------------------------------------

  function focusForRoot(root) {
    return foci.find(focus => focus.root === root && !focus.neutralized)
      || foci.find(focus => focus.root === root)
      || null;
  }

  function incomingEventForRoot(root) {
    return spreadEvents.find(event => (
      event.targetRoot === root && (event.state === 'warning' || event.state === 'traveling')
    )) || null;
  }

  // Leitura interpretativa: o que o jogador PODE fazer agora nesta raiz.
  function readingFor(focus) {
    if (focus.neutralized) return 'Foco neutralizado';
    if (focus.state === 'critical') return 'Murcha crítica';
    if (focus.contained) return 'Infecção contida';
    if (focus.everEnteredVascular) return 'A bactéria já entrou — contenha';
    if (focus.woundOpening <= CONFIG.woundSealThreshold) return 'Entrada bloqueada';
    if (focus.woundOpening <= CONFIG.woundColonizationLimit) return 'Porta fechando';
    return 'Ainda é possível impedir a entrada';
  }

  function rootSnapshot(root) {
    const focus = focusForRoot(root);
    const incoming = incomingEventForRoot(root);
    if (!focus && !incoming) return null;
    const snapshot = {
      hasFocus: Boolean(focus),
      role: focus ? focus.role : null,
      roleLabel: focus ? focus.roleLabel : null,
      shortRoleLabel: focus ? focus.shortRoleLabel : null,
      reading: focus ? readingFor(focus) : 'Raiz visada pela disseminação',
      stage: focus ? focusState(focus) : null,
      stageLabel: focus ? stageLabel(focus) : null,
      doorLabel: focus ? ralstoniaDoorLabel(focus.woundOpening, CONFIG) : null,
      opening: focus ? focus.woundOpening : ralstoniaSpreadOpening(root),
      surfaceLoad: focus ? focus.surfaceLoad : 0,
      vascularLoad: focus ? focus.vascularLoad : 0,
      transport: focus ? (focus.vascularEfficiency ?? 1) : 1,
      azospirillumClosure: focus ? focus.azospirillumClosure : 0,
      bacillusControl: focus ? focus.bacillusControl : 0,
      pseudomonasControl: focus ? focus.pseudomonasControl : 0,
      contained: Boolean(focus?.contained),
      neutralized: Boolean(focus?.neutralized),
      activationState: focus ? focus.activationState : null,
      incomingSeconds: null,
      incomingProtection: null,
    };
    if (incoming) {
      snapshot.incomingSeconds = incoming.state === 'warning'
        ? incoming.warningRemaining
        : (1 - incoming.travelProgress) * CONFIG.spreadTravelSeconds;
      const azo = ralstoniaAzospirillumClosure({
        colonies: inoculants?.colonies || [],
        lateralRoots: state.level.azospirillumRoots || [],
        root,
      });
      snapshot.incomingProtection = ralstoniaArrivalProtection({
        bacillus: bacillusStrength({ root, x: root.x + root.w / 2 }),
        pseudomonas: pseudomonasPotential(root),
        azospirillumClosure: azo,
        rootHealth: root.rootHealth ?? 1,
        opening: ralstoniaSpreadOpening(root),
        config: CONFIG,
      }).protection;
    }
    return snapshot;
  }

  function debugLines() {
    const lines = foci.map(focus => [
      focus.id,
      `#${focus.rootLogicIndex}`,
      focus.activationState,
      `S${focus.surfaceLoad.toFixed(2)}`,
      `V${focus.vascularLoad.toFixed(2)}`,
      `porta${focus.woundOpening.toFixed(2)}`,
      `azo${focus.azospirillumClosure.toFixed(2)}`,
      `bac${focus.bacillusControl.toFixed(2)}`,
      `pse${focus.pseudomonasControl.toFixed(2)}`,
      `dS${focus.surfaceNetRate.toFixed(3)}`,
      `dV${focus.vascularNetRate.toFixed(3)}`,
      focus.contained ? 'contido' : '',
      focus.everContained ? 'jaContido' : '',
      `t${focus.spreadTimer.toFixed(1)}`,
      `ev${focus.spreadEventsUsed}`,
      `g${focus.spreadGeneration}`,
    ].filter(Boolean).join(' '));
    for (const event of spreadEvents) {
      lines.push([
        event.id,
        event.state,
        `alvo#${event.targetRoot?.logicIndex ?? '?'}`,
        event.state === 'warning' ? `aviso${event.warningRemaining.toFixed(1)}` : '',
        event.state === 'traveling' ? `viagem${event.travelProgress.toFixed(2)}` : '',
      ].filter(Boolean).join(' '));
    }
    lines.push(`bloqueadas=${blockedSpreadCount} sucedidas=${successfulSpreadCount}`);
    return lines;
  }

  function clearRootMarkers() {
    for (const root of state.level.platforms || []) {
      delete root.ralstoniaSurfaceLoad;
      delete root.ralstoniaVascularLoad;
      delete root.ralstoniaWilt;
      delete root.ralstoniaStage;
      delete root.ralstoniaDamage;
      delete root.ralstoniaDamagePressure;
      delete root.ralstoniaWoundOpening;
      delete root.ralstoniaCarbonMultiplier;
      delete root.ralstoniaNutrientMultiplier;
      delete root.ralstoniaSpreadIncoming;
      delete root.ralstoniaExposureWound;
      delete root.vascularEfficiency;
      delete root.mycorrhizaEfficiency;
      delete root.recoveryBlocked;
      // Marcador autoral legado: some junto, senão uma raiz de partida antiga
      // continuaria com a porta presa em .45.
      delete root.ralstoniaEntryWound;
    }
    for (const colony of inoculants?.colonies || []) {
      delete colony.vascularStress;
      delete colony.vascularEfficiencyMultiplier;
    }
  }

  function reset() {
    clearRootMarkers();
    foci.length = 0;
    spreadEvents.length = 0;
    state.level.ralstoniaFoci = foci;
    state.level.ralstoniaSpreadEvents = spreadEvents;
    nextId = 1;
    nextEventId = 1;
    initialized = false;
    lastToastAt = -Infinity;
    neutralizedCount = 0;
    criticalCount = 0;
    averageTransport = 1;
    preventedCount = 0;
    containedCount = 0;
    blockedSpreadCount = 0;
    successfulSpreadCount = 0;
    spreadEventCount = 0;
    spreadWindowReached = false;
    pedagogicalSpreadAttempts = 0;
    didactics.entry = false;
    didactics.obstruction = false;
    didactics.containment = false;
    didactics.spread = false;
  }

  // Atuadores de laboratorio. Existem para o Phase Lab e para os testes poderem
  // montar QUALQUER situacao da doenca sem esperar o tempo de jogo: criar foco em
  // cada estagio, mexer na porta, ligar controles, forcar/limpar disseminacao.
  // Nenhum deles e usado pelo jogo normal.
  const lab = {
    spawnFocus({
      root = null,
      logicIndex = null,
      stage = 'pending',
      woundOpening = null,
      spreadGeneration = 0,
    } = {}) {
      const target = root
        || eligibleRoots().find(candidate => candidate.logicIndex === logicIndex)
        || eligibleRoots()[0];
      if (!target) return null;
      const loads = {
        pending: { surface: CONFIG.introductoryFocusSurfaceLoad, vascular: 0 },
        surface: { surface: CONFIG.introductoryFocusSurfaceLoad, vascular: 0 },
        vascular: { surface: CONFIG.containmentFocusSurfaceLoad, vascular: CONFIG.vascularColonizationThreshold + .04 },
        obstructed: { surface: .3, vascular: CONFIG.obstructionThreshold + .02 },
        critical: { surface: .3, vascular: CONFIG.criticalThreshold + .03 },
      }[stage] || { surface: .2, vascular: 0 };
      const focus = createFocus({
        root: target,
        role: 'lab',
        surfaceLoad: loads.surface,
        vascularLoad: loads.vascular,
        woundOpening: Number.isFinite(woundOpening) ? woundOpening : CONFIG.preventionFocusWoundOpening,
        spreadGeneration,
      });
      if (stage !== 'pending') {
        focus.activationState = 'active';
        focus.activationGraceRemaining = 0;
        focus.activatedAt = state.time;
      }
      return focus;
    },
    setFocus(focus, patch = {}) {
      if (!focus) return null;
      Object.assign(focus, patch);
      if (focus.vascularLoad >= CONFIG.vascularEntryThreshold) focus.everEnteredVascular = true;
      focus.state = focusState(focus);
      return focus;
    },
    forceSpread(focus) {
      if (!focus) return null;
      focus.pedagogicalSpread = true;
      focus.spreadTimer = 0;
      return focus;
    },
    openSpreadEvent,
    resolveNextArrival() {
      const event = spreadEvents.find(entry => (
        entry.state === 'warning' || entry.state === 'traveling'
      ));
      if (!event) return null;
      event.state = 'traveling';
      event.travelProgress = 1;
      resolveArrival(event);
      return event;
    },
    clearSpreadEvents() {
      for (const event of spreadEvents) releaseTarget(event);
      spreadEvents.length = 0;
    },
    activateAll() {
      for (const focus of foci) {
        if (focus.neutralized) continue;
        focus.activationState = 'active';
        focus.activationGraceRemaining = 0;
      }
    },
  };

  return {
    introduceEnvironmentalInoculum,
    get foci() { return foci; },
    get focusCount() { return foci.filter(focus => !focus.neutralized).length; },
    get activeFocusCount() {
      return foci.filter(focus => focus.activationState === 'active' && !focus.neutralized).length;
    },
    get pendingFocusCount() {
      return foci.filter(focus => focus.activationState === 'pending').length;
    },
    get neutralizedCount() { return neutralizedCount; },
    get preventedCount() { return preventedCount; },
    get containedCount() { return containedCount; },
    get criticalCount() { return criticalCount; },
    get blockedSpreadCount() { return blockedSpreadCount; },
    get successfulSpreadCount() { return successfulSpreadCount; },
    get spreadEventCount() { return spreadEventCount; },
    get activeSpreadEvents() {
      return spreadEvents.filter(event => event.state === 'warning' || event.state === 'traveling');
    },
    get preservedVascularRootCount() {
      return foci.filter(focus => (
        (focus.vascularEfficiency ?? 1) >= .65
        && (focus.root?.rootHealth ?? 1) >= .55
        && focus.state !== 'critical'
      )).length;
    },
    get averageTransport() { return averageTransport; },
    get foci() { return foci; },
    get spreadEvents() { return spreadEvents; },
    get didactics() { return didactics; },
    // A fase "começou" quando o jogador viu ao menos um foco ou um evento. Antes
    // disso, o status de murcha crítica é neutro — não verde.
    get challengeStarted() {
      return foci.some(focus => focus.activationState !== 'pending')
        || spreadEvents.length > 0;
    },
    get pedagogicalSpreadAttempts() { return pedagogicalSpreadAttempts; },
    get config() { return CONFIG; },
    rootSnapshot,
    debugLines,
    lab,
    initialize,
    update,
    render,
    reset,
  };
}
