import { campaignManifest } from './campaign-manifest.js';
import { createRandom } from './random.js';

// CHEGADAS DE PATÓGENO — etapa 2: quando e onde
// =============================================
//
// A etapa 1 mede a pressão. Esta decide o que fazer com ela: em vez de a fase
// nascer já infestada, o patógeno CHEGA durante o jogo, com frequência ditada
// pela pressão que o próprio jogador produziu.
//
// A divisão é essa, e é o que mantém as duas coisas separáveis:
//
//   a PRESSÃO GLOBAL decide QUANDO uma chegada acontece;
//   as NUVENS LOCAIS decidem ONDE ela acontece.
//
// Nitrogênio e ferro entram na pressão global e por isso mudam a frequência,
// mas não escolhem a raiz — carência de nutriente é uma condição do solo
// inteiro, não um endereço.
//
// Uma progressão SÓ, compartilhada. Se cada patógeno tivesse a sua, os dois
// sorteariam no mesmo instante e a fase levaria duas chegadas simultâneas por
// acaso aritmético, não por decisão de projeto.
//
// AMBIGUIDADES QUE ENCONTREI, e o que decidi:
//
//   `ralstonia-vascular-wilt.js` já tinha `preventionAvailableFrom()` — o
//   chunk a partir do qual existe organismo preventivo e exsudato para
//   inoculá-lo. É exatamente o "ponto da rota em que a prevenção ficou
//   acessível" que o enunciado pede, e por isso o reuso em vez de inventar
//   outro critério. Para a Meloidogyne o equivalente é o Trichoderma, que é
//   quem captura J2 e suprime massas.
//
//   O estágio mais precoce de cada ciclo já existia: `seeking` para o J2 (é o
//   estado em que ele nada no solo antes de achar raiz) e `pending` para o foco
//   de Ralstonia (presença superficial, `vascularLoad` zero). Nenhuma chegada
//   cria galha, fêmea ou foco vascular direto.

export const PATHOGEN_ARRIVAL_DEFAULTS = Object.freeze({
  safeMeanIntervalSeconds: 180,
  moderateMeanIntervalSeconds: 90,
  highMeanIntervalSeconds: 45,
  criticalMeanIntervalSeconds: 25,
  minimumCooldownSeconds: 20,
  warningSeconds: 5,
  maximumActiveThreats: 2,
  maximumActivePerPathogen: 1,
});

export const ARRIVAL_PATHOGENS = Object.freeze(['meloidogyne', 'ralstonia']);

const ARRIVAL_HISTORY_LIMIT = 12;
// Faixa do limiar sorteado. Sem ela o intervalo seria exato e o jogador
// aprenderia o relógio em vez de ler o solo.
const THRESHOLD_RANGE = Object.freeze([0.8, 1.2]);
// Raio em que uma nuvem de exsudato ainda influencia a escolha da raiz.
const CLOUD_INFLUENCE_RADIUS = 520;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function meanIntervalForBand(band, settings = PATHOGEN_ARRIVAL_DEFAULTS) {
  if (band === 'critical') return settings.criticalMeanIntervalSeconds;
  if (band === 'high') return settings.highMeanIntervalSeconds;
  if (band === 'moderate') return settings.moderateMeanIntervalSeconds;
  // `safe` NÃO é risco zero: é o intervalo mais longo. Solo saudável adia a
  // chegada, não a elimina.
  return settings.safeMeanIntervalSeconds;
}

// Primeira fase em que o patógeno é apresentado, lida do manifesto em vez de
// escrita à mão: se a campanha for reordenada, isto acompanha.
export function debutPhaseOf(pathogen) {
  for (const phase of campaignManifest) {
    if ((phase.pathogenDebuts || []).some(entry => entry.pathogen === pathogen)) {
      return phase.phase;
    }
  }
  return null;
}

export function createPathogenArrival({ state, systems = {}, settings = null } = {}) {
  const config = { ...PATHOGEN_ARRIVAL_DEFAULTS, ...(settings || {}) };

  let arrivalProgress = 0;
  let currentThreshold = 1;
  let cooldownRemaining = 0;
  let warning = null;
  let totalArrivals = 0;
  let arrivalsByPathogen = { meloidogyne: 0, ralstonia: 0 };
  let tutorialArrivalCompleted = false;
  let tutorialArmed = false;
  let eventHistory = [];

  function level() { return state?.level || {}; }
  function phase() { return state?.campaign?.phase ?? level().campaignPhase ?? 0; }
  function seedValue() {
    return state?.campaign?.seed || level().seed || 'pathogen-arrival';
  }
  function attemptId() {
    return level().objectiveProgress?.attemptId ?? 0;
  }

  function pressure() {
    return level().pathogenPressure || null;
  }

  function currentBand() {
    return pressure()?.pressureBand || 'safe';
  }

  function currentMeanInterval() {
    return meanIntervalForBand(currentBand(), config);
  }

  // Limiar determinístico da PRÓXIMA chegada. Depende da seed, do número da
  // chegada e da tentativa — recomeçar a fase produz a mesma sequência, e duas
  // seeds diferentes produzem sequências diferentes.
  function rollThreshold() {
    const random = createRandom(
      `${seedValue()}:pathogen-arrival:p${phase()}:n${totalArrivals}:a${attemptId()}`,
    );
    const [minimum, maximum] = THRESHOLD_RANGE;
    return minimum + random() * (maximum - minimum);
  }

  // --- AMEAÇAS ATIVAS -------------------------------------------------------
  //
  // "Ativa" é o que o enunciado lista, e cada item vem do estado que o próprio
  // ciclo já mantém. Nada aqui inventa contagem nova.

  function meloidogyneActive() {
    const lifecycle = systems.meloidogyneLifecycle;
    if (!lifecycle) return 0;
    const juveniles = (lifecycle.juveniles || []).filter(entry => entry.alive).length;
    const galls = (lifecycle.galls || []).length;
    const masses = (lifecycle.eggMasses || []).filter(mass => mass.eggs > 0).length;
    return juveniles + galls + masses > 0 ? 1 : 0;
  }

  function ralstoniaActive() {
    const control = systems.ralstoniaControl;
    if (!control) return 0;
    const foci = control.foci || level().ralstoniaFoci || [];
    const alive = foci.filter(focus => (
      focus && focus.state !== 'neutralized' && focus.neutralized !== true
    )).length;
    return alive > 0 ? 1 : 0;
  }

  function activeByPathogen() {
    return {
      meloidogyne: meloidogyneActive(),
      ralstonia: ralstoniaActive(),
    };
  }

  // --- ELEGIBILIDADE --------------------------------------------------------

  function phaseAllows(pathogen) {
    const debut = debutPhaseOf(pathogen);
    return Number.isInteger(debut) && phase() >= debut;
  }

  function eligiblePathogens() {
    const active = activeByPathogen();
    return ARRIVAL_PATHOGENS.filter(pathogen => (
      phaseAllows(pathogen)
      && active[pathogen] < config.maximumActivePerPathogen
      && Boolean(arrivalApi(pathogen))
    ));
  }

  function arrivalApi(pathogen) {
    if (pathogen === 'meloidogyne') return systems.meloidogyneLifecycle?.introduceJ2Arrival || null;
    if (pathogen === 'ralstonia') return systems.ralstoniaControl?.introduceEnvironmentalInoculum || null;
    return null;
  }

  function selectPathogen() {
    const candidates = eligiblePathogens();
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];
    // Favorece levemente quem chegou menos vezes nesta fase, e desempata pela
    // seed: repetir a mesma espécie cinco vezes seguidas seria sorte, não
    // desenho.
    const fewest = Math.min(...candidates.map(entry => arrivalsByPathogen[entry] || 0));
    const leastUsed = candidates.filter(entry => (arrivalsByPathogen[entry] || 0) === fewest);
    const random = createRandom(
      `${seedValue()}:pathogen-choice:p${phase()}:n${totalArrivals}:a${attemptId()}`,
    );
    return leastUsed[Math.floor(random() * leastUsed.length) % leastUsed.length];
  }

  // --- ESCOLHA DA RAIZ ------------------------------------------------------

  function candidateRoots() {
    return (level().platforms || []).filter(platform => (
      platform
      && platform.type === 'root'
      && !platform.final
      && !platform.recovery
      && !platform.mycorrhizaStructure
      && !platform.azospirillumStructure
      && !platform.nitrogenRootStructure
      && Number.isInteger(platform.logicIndex)
      && platform.logicIndex >= 0
      && platform.w >= 100
    ));
  }

  /**
   * Atração local de uma raiz. As nuvens de exsudato próximas mandam aqui — é o
   * gradiente químico que orienta quem está no solo, e o mesmo que já atrai os
   * organismos benéficos em `applyCloudTaxia`.
   */
  function cloudAttraction(root) {
    const clouds = level().exudateClouds || [];
    if (!clouds.length) return 0;
    const centerX = root.x + root.w / 2;
    let attraction = 0;
    for (const cloud of clouds) {
      const distance = Math.hypot((cloud.x ?? 0) - centerX, (cloud.y ?? 0) - (root.y ?? 0));
      if (distance > CLOUD_INFLUENCE_RADIUS) continue;
      // Perto pesa mais, e nuvem prestes a sumir pesa menos. Duas nuvens
      // próximas somam: é uma poça de gradiente, não um interruptor.
      const proximity = 1 - distance / CLOUD_INFLUENCE_RADIUS;
      const life = cloud.maxLife > 0 ? clamp((cloud.life ?? 0) / cloud.maxLife, 0, 1) : 1;
      attraction += proximity * proximity * (0.35 + life * 0.65);
    }
    return attraction;
  }

  // Proteção já estabelecida não torna a raiz invisível: ela continua sendo
  // atraente para o patógeno, e é a própria proteção que barra a instalação
  // depois. Pressão alta aumenta a FREQUÊNCIA, não a resistência do patógeno.
  function protectionPenalty(root) {
    let penalty = 0;
    if (root.biofilmProtected || root.bacillusProtected) penalty += 0.25;
    if (root.trichodermaProtected) penalty += 0.25;
    if ((root.mycorrhizaRecovery || 0) > 0.5) penalty += 0.1;
    return penalty;
  }

  function selectTargetRoot(pathogen) {
    const roots = candidateRoots();
    if (!roots.length) return null;
    const playerX = (state?.player?.x ?? 0) + (state?.player?.w ?? 0) / 2;
    const random = createRandom(
      `${seedValue()}:arrival-target:p${phase()}:n${totalArrivals}:a${attemptId()}`,
    );
    let best = null;
    let bestScore = -Infinity;
    for (const root of roots) {
      const centerX = root.x + root.w / 2;
      const attraction = cloudAttraction(root);
      // Sem nuvem nenhuma a escolha cai na progressão do jogador: uma raiz a
      // trinta telas de distância não é uma ameaça, é um número no painel.
      const ahead = centerX - playerX;
      const proximity = ahead >= 0
        ? 1 / (1 + ahead / 900)
        : 0.35 / (1 + Math.abs(ahead) / 900);
      const score = attraction * 3
        + proximity
        - protectionPenalty(root)
        + random() * 0.15;
      if (score > bestScore) {
        bestScore = score;
        best = root;
      }
    }
    return best;
  }

  // --- EXPOSIÇÃO DIDÁTICA ---------------------------------------------------

  function tutorialPathogen() {
    return ARRIVAL_PATHOGENS.find(pathogen => debutPhaseOf(pathogen) === phase()) || null;
  }

  /**
   * Chunk a partir do qual a prevenção do patógeno é acessível de verdade.
   *
   * Reusa o critério que o runtime da Ralstonia já aplicava: o organismo
   * preventivo tem de ter aparecido E tem de haver exsudato para inoculá-lo —
   * ver `preventionAvailableFrom()` em `ralstonia-vascular-wilt.js`. Sem as
   * duas coisas o jogador VÊ a prevenção e não pode usá-la.
   */
  function preventionAvailableFromChunk(pathogen) {
    const encounters = (level().microbeEncounters || [])
      .filter(entry => Number.isInteger(entry.logicIndex));
    const wanted = pathogen === 'meloidogyne'
      ? ['trichoderma']
      : ['bacillus', 'pseudomonas', 'azospirillum'];
    const organism = encounters
      .filter(entry => wanted.includes(entry.id))
      .map(entry => entry.logicIndex)
      .sort((left, right) => left - right)[0];
    if (!Number.isInteger(organism)) return null;
    const exudate = (level().exudates || [])
      .filter(entry => Number.isInteger(entry.logicIndex) && entry.logicIndex >= organism)
      .map(entry => entry.logicIndex)
      .sort((left, right) => left - right)[0];
    if (!Number.isInteger(exudate)) return null;
    return Math.max(organism, exudate);
  }

  function playerLogicIndex() {
    const playerX = (state?.player?.x ?? 0) + (state?.player?.w ?? 0) / 2;
    let current = -1;
    for (const platform of level().platforms || []) {
      if (!Number.isInteger(platform.logicIndex)) continue;
      if (platform.x <= playerX) current = Math.max(current, platform.logicIndex);
    }
    return current;
  }

  function tutorialReady() {
    if (tutorialArrivalCompleted) return false;
    const pathogen = tutorialPathogen();
    if (!pathogen || !arrivalApi(pathogen)) return false;
    const gate = preventionAvailableFromChunk(pathogen);
    if (!Number.isInteger(gate)) return false;
    // "Ultrapassar a região" é passar do chunk em que a prevenção ficou
    // acessível, não apenas alcançá-lo.
    return playerLogicIndex() > gate;
  }

  // --- AVISO E CHEGADA ------------------------------------------------------

  function beginWarning(pathogen, { tutorial = false, source = 'pressure', targetRoot = null } = {}) {
    const root = targetRoot || selectTargetRoot(pathogen);
    if (!root) return null;
    warning = {
      pathogen,
      targetRoot: root,
      targetX: root.x + root.w / 2,
      timeRemaining: config.warningSeconds,
      source,
      tutorial,
    };
    record('warning', { pathogen, source, tutorial, logicIndex: root.logicIndex });
    publish();
    return warning;
  }

  function completeWarning() {
    if (!warning) return null;
    const { pathogen, targetRoot, tutorial, source } = warning;
    // O aviso acompanha a raiz: se ela se moveu, a chegada acontece onde ela
    // está agora, não onde estava cinco segundos atrás.
    const targetX = targetRoot ? targetRoot.x + targetRoot.w / 2 : warning.targetX;
    const api = arrivalApi(pathogen);
    warning = null;
    if (!api) return null;

    const result = pathogen === 'meloidogyne'
      ? api({ targetRoot, x: targetX, source })
      : api({ targetRoot, x: targetX, source });

    totalArrivals++;
    arrivalsByPathogen = {
      ...arrivalsByPathogen,
      [pathogen]: (arrivalsByPathogen[pathogen] || 0) + 1,
    };
    arrivalProgress = 0;
    currentThreshold = rollThreshold();
    cooldownRemaining = config.minimumCooldownSeconds;
    if (tutorial) tutorialArrivalCompleted = true;
    record('arrival', {
      pathogen,
      source,
      tutorial,
      logicIndex: targetRoot?.logicIndex ?? null,
      ok: Boolean(result),
    });
    publish();
    return result;
  }

  function record(kind, detail) {
    eventHistory = [
      ...eventHistory,
      { kind, phaseTime: Number(state?.time) || 0, ...detail },
    ].slice(-ARRIVAL_HISTORY_LIMIT);
  }

  function publish() {
    const active = activeByPathogen();
    const reading = {
      arrivalProgress,
      currentThreshold,
      currentRate: 1 / Math.max(1e-6, currentMeanInterval()),
      currentMeanInterval: currentMeanInterval(),
      cooldownRemaining,
      warning: warning
        ? {
            pathogen: warning.pathogen,
            targetRoot: warning.targetRoot,
            targetX: warning.targetRoot
              ? warning.targetRoot.x + warning.targetRoot.w / 2
              : warning.targetX,
            timeRemaining: warning.timeRemaining,
            source: warning.source,
            tutorial: warning.tutorial,
          }
        : null,
      eligiblePathogens: eligiblePathogens(),
      activeThreatCount: active.meloidogyne + active.ralstonia,
      activeByPathogen: active,
      totalArrivals,
      arrivalsByPathogen: { ...arrivalsByPathogen },
      tutorialArrivalCompleted,
      tutorialPathogen: tutorialPathogen(),
      pressureBand: currentBand(),
      totalPressure: pressure()?.totalPressure ?? 0,
      eventHistory: [...eventHistory],
      settings: { ...config },
    };
    if (state?.level) state.level.pathogenArrival = reading;
    return reading;
  }

  function update(dt = 0) {
    const step = Number(dt) || 0;

    if (warning) {
      warning.timeRemaining -= step;
      if (warning.timeRemaining <= 0) completeWarning();
      return publish();
    }

    if (cooldownRemaining > 0) {
      cooldownRemaining = Math.max(0, cooldownRemaining - step);
      return publish();
    }

    // A exposição didática tem prioridade e não depende do relógio da pressão.
    if (tutorialReady()) {
      const pathogen = tutorialPathogen();
      if (beginWarning(pathogen, { tutorial: true, source: 'tutorial' })) {
        tutorialArmed = true;
        return publish();
      }
    }

    const active = activeByPathogen();
    const total = active.meloidogyne + active.ralstonia;
    // Teto de ameaças atingido: a progressão PAUSA, não zera. Assim que o
    // jogador controlar o que está no solo, o relógio retoma de onde parou —
    // era esse o risco de travar o controlador para sempre.
    if (total >= config.maximumActiveThreats) return publish();
    if (!eligiblePathogens().length) return publish();

    arrivalProgress += step / Math.max(1e-6, currentMeanInterval());
    if (arrivalProgress >= currentThreshold) {
      const pathogen = selectPathogen();
      if (pathogen) beginWarning(pathogen, { source: 'pressure' });
      else arrivalProgress = currentThreshold;
    }
    return publish();
  }

  // --- ATUADORES DE LABORATÓRIO --------------------------------------------
  //
  // Usam as MESMAS APIs e os mesmos estágios da chegada normal: o Phase Lab
  // encurta a espera, não cria um segundo caminho.

  function forceArrival(pathogen, { immediate = false } = {}) {
    if (!arrivalApi(pathogen)) return null;
    warning = null;
    const started = beginWarning(pathogen, { source: 'phase-lab' });
    if (!started) return null;
    if (immediate) return completeWarning();
    return started;
  }

  function cancelWarning() {
    if (!warning) return false;
    record('warning-cancelled', { pathogen: warning.pathogen });
    warning = null;
    publish();
    return true;
  }

  function clearDiagnostics() {
    totalArrivals = 0;
    arrivalsByPathogen = { meloidogyne: 0, ralstonia: 0 };
    eventHistory = [];
    arrivalProgress = 0;
    currentThreshold = rollThreshold();
    cooldownRemaining = 0;
    publish();
  }

  function clear() {
    arrivalProgress = 0;
    currentThreshold = 1;
    cooldownRemaining = 0;
    warning = null;
    totalArrivals = 0;
    arrivalsByPathogen = { meloidogyne: 0, ralstonia: 0 };
    tutorialArrivalCompleted = false;
    tutorialArmed = false;
    eventHistory = [];
    if (state?.level) state.level.pathogenArrival = null;
  }

  /**
   * Reconstrução da fase. Como na pressão, morte e checkpoint NÃO passam por
   * aqui — `respawn` não toca em `state.level`, então a exposição didática já
   * feita continua feita e o mundo segue como estava. Refazer a fase devolve
   * tudo ao início, inclusive a exposição.
   */
  function reset() {
    clear();
    currentThreshold = rollThreshold();
    publish();
  }

  function configure(nextSettings) {
    Object.assign(config, nextSettings || {});
    return publish();
  }

  function restoreDefaults() {
    Object.assign(config, PATHOGEN_ARRIVAL_DEFAULTS);
    return publish();
  }

  return {
    get settings() { return { ...config }; },
    get arrivalProgress() { return arrivalProgress; },
    get currentThreshold() { return currentThreshold; },
    get cooldownRemaining() { return cooldownRemaining; },
    get warning() { return warning; },
    get totalArrivals() { return totalArrivals; },
    get arrivalsByPathogen() { return { ...arrivalsByPathogen }; },
    get tutorialArrivalCompleted() { return tutorialArrivalCompleted; },
    get tutorialArmed() { return tutorialArmed; },
    get eventHistory() { return [...eventHistory]; },
    eligiblePathogens,
    currentMeanInterval,
    preventionAvailableFromChunk,
    selectTargetRoot,
    cloudAttraction,
    forceArrival,
    cancelWarning,
    clearDiagnostics,
    update,
    reset,
    clear,
    configure,
    restoreDefaults,
    publish,
  };
}
