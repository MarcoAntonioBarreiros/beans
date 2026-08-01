import { getNitrogenAvailability } from './nitrogen-availability.js';

// PRESSÃO DE PATÓGENOS — etapa 1: medir
// =====================================
//
// Este módulo não ataca ninguém e não muda o jogo. Ele CALCULA uma leitura e a
// publica em `state.level.pathogenPressure`, para que a etapa seguinte tenha um
// número em que confiar. Nada aqui lê teclado, cria entidade ou mexe em
// geometria.
//
// A ideia central é que exsudato barato não existe. Cada aplicação custa o
// dobro da anterior enquanto as nuvens anteriores ainda estiverem no ar, então
// despejar quatro seguidas custa 1+2+4+8 = 15, e as mesmas quatro espaçadas
// custam 1+1+1+1 = 4. O jogador paga pela pressa, não pelo uso.
//
// AMBIGUIDADES QUE ENCONTREI, e o que decidi:
//
//   O teto de nuvens é 4, e `deployCloud` faz `clouds.shift()` ANTES de criar a
//   quinta. Contar depois do shift daria 3 (custo 8) para quem já está no teto.
//   O registro acontece ANTES do shift: com quatro nuvens no ar a quinta custa
//   16, que é o exemplo do enunciado.
//
//   O nitrogênio já vem normalizado (`getNitrogenAvailability().totalFraction`,
//   0 a 1). O ferro NÃO tinha máximo publicado: `ironMax = 1.5` era uma
//   constante local dentro de `hud-context.js`, usada só para desenhar a barra.
//   Reusei o mesmo valor — a leitura da pressão e a barra do HUD têm de
//   concordar — mas exportei como constante nomeada em vez de duplicar o número.
//
//   Não existia um identificador de aplicação. A nuvem tem `id` incremental
//   (`nextCloudId++`), único dentro da fase, e é ele que uso como
//   `applicationId`. Um `Set` de ids já vistos impede contagem dupla.

export const PATHOGEN_PRESSURE_DEFAULTS = Object.freeze({
  recoveryGraceSeconds: 25,
  recoveryPointsPerSecond: 0.1,
  basalPressure: 1,
  nitrogenDeficitWeight: 4,
  ironDeficitWeight: 4,
  safeBandMaximum: 8,
  moderateBandMaximum: 16,
  highBandMaximum: 30,
});

// Mesmo teto que `hud-context.js` usa para desenhar a barra de Fe³⁺. Se um dia
// mudar, tem de mudar nos dois — por isso está exportado daqui.
export const IRON_STOCK_MAXIMUM = 1.5;

// Quantas aplicações o histórico guarda. É diagnóstico de playtest, não save.
const APPLICATION_HISTORY_LIMIT = 12;

export const PATHOGEN_PRESSURE_RECOVERY_STATES = Object.freeze([
  'blocked-by-clouds',
  'waiting',
  'recovering',
  'idle',
]);

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function classifyPressureBand(totalPressure, settings = PATHOGEN_PRESSURE_DEFAULTS) {
  if (totalPressure <= settings.safeBandMaximum) return 'safe';
  if (totalPressure <= settings.moderateBandMaximum) return 'moderate';
  if (totalPressure <= settings.highBandMaximum) return 'high';
  return 'critical';
}

export function exudateUseCost(activeCloudCountBeforeUse) {
  const clouds = Math.max(0, Math.floor(Number(activeCloudCountBeforeUse) || 0));
  return 2 ** clouds;
}

export function createPathogenPressure({ state, settings = null } = {}) {
  const config = { ...PATHOGEN_PRESSURE_DEFAULTS, ...(settings || {}) };

  let exudatePoints = 0;
  let recoveryDelayRemaining = 0;
  let recoveryState = 'idle';
  let applicationHistory = [];
  // Ids já contabilizados. Vive fora do histórico porque o histórico é podado.
  let registeredApplications = new Set();

  function level() { return state?.level || {}; }

  function activeCloudCount() {
    return (level().exudateClouds || []).length;
  }

  // O ferro vem do módulo de sideróforos, que é do simulador e não do nível.
  // Aceito as duas origens: em teste é prático injetar direto no `state`.
  function ironStock() {
    const direct = Number(state?.pseudomonasSiderophores?.ironRecovered);
    if (Number.isFinite(direct)) return direct;
    const fromLevel = Number(level().ironRecovered);
    return Number.isFinite(fromLevel) ? fromLevel : 0;
  }

  function normalizedNitrogen() {
    try {
      const availability = getNitrogenAvailability({
        state,
        azospirillumNitrogen: state?.azospirillumNitrogen,
      });
      const fraction = Number(availability?.totalFraction);
      return Number.isFinite(fraction) ? clamp(fraction, 0, 1) : 0;
    } catch (_) {
      // A leitura da pressão nunca pode derrubar o quadro por causa de um
      // estado parcial (troca de fase, nível ainda montando).
      return 0;
    }
  }

  function normalizedIron() {
    return clamp(ironStock() / IRON_STOCK_MAXIMUM, 0, 1);
  }

  function publish() {
    const nitrogenDeficit = 1 - normalizedNitrogen();
    const ironDeficit = 1 - normalizedIron();
    const nitrogenDeficitPressure = nitrogenDeficit * config.nitrogenDeficitWeight;
    const ironDeficitPressure = ironDeficit * config.ironDeficitWeight;
    const totalPressure = config.basalPressure
      + exudatePoints
      + nitrogenDeficitPressure
      + ironDeficitPressure;
    const reading = {
      exudatePoints,
      activeCloudCount: activeCloudCount(),
      nextUseCost: exudateUseCost(activeCloudCount()),
      recoveryState,
      recoveryDelayRemaining,
      recoveryPointsPerSecond: config.recoveryPointsPerSecond,
      nitrogenDeficitPressure,
      ironDeficitPressure,
      basalPressure: config.basalPressure,
      totalPressure,
      pressureBand: classifyPressureBand(totalPressure, config),
      applicationHistory: [...applicationHistory],
      settings: { ...config },
    };
    if (state?.level) state.level.pathogenPressure = reading;
    return reading;
  }

  /**
   * Registra uma aplicação CONFIRMADA de exsudato.
   *
   * Tem de ser chamada ANTES de a nuvem nova entrar na lista, e antes do
   * `clouds.shift()` que o teto de quatro dispara — senão quem já está no teto
   * pagaria 8 em vez de 16.
   */
  function registerSuccessfulExudateUse(applicationId) {
    if (applicationId === undefined || applicationId === null) return null;
    const key = String(applicationId);
    if (registeredApplications.has(key)) return null;
    registeredApplications.add(key);

    const activeCloudCountBeforeUse = activeCloudCount();
    const cost = exudateUseCost(activeCloudCountBeforeUse);
    const pointsBefore = exudatePoints;
    exudatePoints = pointsBefore + cost;
    // Toda aplicação reinicia a espera, esteja o sistema esperando ou já
    // recuperando. É isso que faz o uso repetido custar caro de verdade.
    recoveryDelayRemaining = config.recoveryGraceSeconds;
    recoveryState = 'blocked-by-clouds';

    const entry = {
      applicationId: key,
      activeCloudCountBeforeUse,
      cost,
      pointsBefore,
      pointsAfter: exudatePoints,
      phaseTime: Number(state?.time) || 0,
      timestamp: Number(state?.time) || 0,
    };
    applicationHistory = [...applicationHistory, entry].slice(-APPLICATION_HISTORY_LIMIT);
    publish();
    return entry;
  }

  function update(dt = 0) {
    const step = Number(dt) || 0;
    const clouds = activeCloudCount();

    if (clouds > 0) {
      // Enquanto há nuvem no ar não se recupera nada, e o relógio da espera
      // fica cheio: a contagem só começa depois que a última some.
      recoveryState = 'blocked-by-clouds';
      recoveryDelayRemaining = config.recoveryGraceSeconds;
    } else if (exudatePoints <= 0) {
      recoveryState = 'idle';
      recoveryDelayRemaining = 0;
      exudatePoints = 0;
    } else if (recoveryDelayRemaining > 0) {
      recoveryState = 'waiting';
      recoveryDelayRemaining = Math.max(0, recoveryDelayRemaining - step);
      // Sem `else`: o quadro em que a espera zera ainda é de espera. Recuperar
      // no mesmo quadro devolveria uma fração de ponto antes da hora.
    } else {
      recoveryState = 'recovering';
      exudatePoints = Math.max(0, exudatePoints - config.recoveryPointsPerSecond * step);
      if (exudatePoints <= 0) {
        exudatePoints = 0;
        recoveryState = 'idle';
      }
    }

    return publish();
  }

  /**
   * Zera a leitura e SOLTA as referências. Chamado na troca de fase: uma nuvem
   * da fase anterior não pode continuar contando aqui.
   */
  function clear() {
    exudatePoints = 0;
    recoveryDelayRemaining = 0;
    recoveryState = 'idle';
    applicationHistory = [];
    registeredApplications = new Set();
    if (state?.level) state.level.pathogenPressure = null;
  }

  /**
   * Reconstrução da fase: `R`, troca de fase, recomeço de campanha.
   *
   * MORTE E CHECKPOINT NAO PASSAM POR AQUI, e isso decide o comportamento.
   * Conferindo o simulador: `respawn(reason)` trata morte e retorno ao
   * checkpoint, e ele só mexe no JOGADOR — posição, vitalidade, mochila,
   * infecção. Não toca em `state.level`, então as nuvens continuam no ar, as
   * colônias continuam crescendo e o solo segue como estava.
   *
   * `reset()` é outra coisa: ele faz `state.level = createEmptyLevel()`. O
   * mundo inteiro é refeito e as nuvens deixam de existir.
   *
   * Daí a regra, que é a do projeto e não uma invenção deste módulo: a pressão
   * é propriedade do SOLO, não do jogador. Morrer não a apaga — seria estranho
   * que morrer limpasse a bagunça química que o jogador acabou de fazer.
   * Refazer a fase apaga, porque não sobrou solo nenhum para pressionar.
   */
  function reset() {
    clear();
    publish();
  }

  function configure(nextSettings) {
    Object.assign(config, nextSettings || {});
    return publish();
  }

  function restoreDefaults() {
    Object.assign(config, PATHOGEN_PRESSURE_DEFAULTS);
    return publish();
  }

  return {
    get settings() { return { ...config }; },
    get exudatePoints() { return exudatePoints; },
    get recoveryState() { return recoveryState; },
    get recoveryDelayRemaining() { return recoveryDelayRemaining; },
    get applicationHistory() { return [...applicationHistory]; },
    get reading() { return level().pathogenPressure || publish(); },
    registerSuccessfulExudateUse,
    update,
    reset,
    clear,
    configure,
    restoreDefaults,
    publish,
  };
}
