import { campaignManifest } from './campaign-manifest.js';
import { createRandom } from './random.js';
import {
  MELOIDOGYNE_BASE_SPEED,
  isActiveMeloidogyneGall,
} from './meloidogyne-lifecycle.js';
import { PATHOGEN_PRESSURE_DEFAULTS } from './pathogen-pressure.js';

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
  // `warningSeconds` continua sendo o percurso da RALSTONIA, e só dela: o
  // inóculo é uma entidade abstrata do controlador e pode ter duração própria.
  // A Meloidogyne saiu deste relógio — ver abaixo.
  warningSeconds: 5,
  maximumActiveThreats: 2,
  maximumActivePerPathogen: 1,

  // --- MELOIDOGYNE ---------------------------------------------------------
  //
  // O J2 é um organismo, não um marcador, e nada à velocidade que um J2 nada.
  // Com duração fixa, uma origem duas vezes mais distante dobrava a velocidade
  // do bicho para caber no cronômetro. Agora a distância manda: percurso longo
  // demora mais, e é o mesmo número que `seek` usa (importado, não repetido).
  meloidogyneArrivalSpeed: MELOIDOGYNE_BASE_SPEED,
  // A que distância da rizosfera o aviso começa. Na velocidade-base isso dá
  // pouco mais de cinco segundos de reação — a mesma janela do relógio antigo,
  // agora medida em espaço, que é o que o jogador enxerga.
  meloidogyneWarningDistance: 250,
  // Teto do percurso. A origem continua nascendo fora da tela, mas 47 px/s
  // atravessando o mundo inteiro seria uma chegada de minutos: acima disto a
  // origem é trocada pela borda mais próxima em vez de ser encurtada, porque
  // encurtar a traria para dentro do enquadramento.
  meloidogyneMaximumTravelSeconds: 14,
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

/**
 * Intervalo médio pelo VALOR da pressão, não pela faixa.
 *
 * Com degraus, pressão 9 e pressão 15 produziam o mesmo relógio e depois um
 * salto brusco em 16 — o jogador via a frequência mudar de repente sem nada
 * ter mudado de repente no solo. Aqui os limites das faixas viram pontos de
 * interpolação e o meio deles é contínuo.
 *
 *   pressão 0              -> safeMeanIntervalSeconds
 *   safeBandMaximum        -> moderateMeanIntervalSeconds
 *   moderateBandMaximum    -> highMeanIntervalSeconds
 *   highBandMaximum        -> criticalMeanIntervalSeconds
 *
 * Acima do último ponto o intervalo continua caindo, devagar, com piso em
 * `criticalMeanIntervalSeconds`: pressão absurda não vira chegada instantânea.
 *
 * A faixa continua sendo publicada — ela é boa como leitura visual. O que não
 * serve mais é usá-la como relógio.
 */
export function continuousMeanInterval(
  totalPressure,
  pressureSettings = PATHOGEN_PRESSURE_DEFAULTS,
  arrivalSettings = PATHOGEN_ARRIVAL_DEFAULTS,
) {
  const pressure = Math.max(0, Number(totalPressure) || 0);
  const stops = [
    { at: 0, interval: arrivalSettings.safeMeanIntervalSeconds },
    { at: pressureSettings.safeBandMaximum, interval: arrivalSettings.moderateMeanIntervalSeconds },
    { at: pressureSettings.moderateBandMaximum, interval: arrivalSettings.highMeanIntervalSeconds },
    { at: pressureSettings.highBandMaximum, interval: arrivalSettings.criticalMeanIntervalSeconds },
  ];
  for (let index = 1; index < stops.length; index++) {
    const previous = stops[index - 1];
    const current = stops[index];
    if (pressure > current.at) continue;
    const span = Math.max(1e-6, current.at - previous.at);
    const fraction = clamp((pressure - previous.at) / span, 0, 1);
    return {
      interval: previous.interval + (current.interval - previous.interval) * fraction,
      lowerStop: previous,
      upperStop: current,
      fraction,
    };
  }
  // Acima do último ponto: aproxima do piso sem nunca cruzá-lo. A meia-vida é
  // a largura da última faixa, então dobrar a pressão ainda muda alguma coisa.
  const last = stops[stops.length - 1];
  const beyond = pressure - last.at;
  const width = Math.max(1e-6, last.at - stops[stops.length - 2].at);
  const decay = 1 - 1 / (1 + beyond / width);
  return {
    interval: Math.max(
      arrivalSettings.criticalMeanIntervalSeconds,
      last.interval * (1 - decay * 0.999),
    ),
    lowerStop: last,
    upperStop: { at: Infinity, interval: arrivalSettings.criticalMeanIntervalSeconds },
    fraction: decay,
  };
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
  let announcedPathogens = new Set();

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

  function intervalDetail() {
    return continuousMeanInterval(
      pressure()?.totalPressure ?? 0,
      pressure()?.settings || PATHOGEN_PRESSURE_DEFAULTS,
      config,
    );
  }

  function currentMeanInterval() {
    return intervalDetail().interval;
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

  /**
   * A Meloidogyne esta ATIVA — isto e, ha organismo vivo no solo ou na raiz?
   *
   * Cicatriz nao e organismo. `galls.length` contava toda galha, inclusive a
   * residual, e a residual nunca some: depois do primeiro ciclo terminar, a
   * fase ficava presa em "ameaca ativa" para sempre e nenhuma chegada externa
   * nova podia acontecer. O ciclo terminado bloqueava o proximo por deixar
   * evidencia de que existiu.
   *
   * Ativa quando ha J2 vivo (em transito, buscando, penetrando ou migrando),
   * galha ativa, ou massa com ovos viaveis. Massa vazia, massa neutralizada,
   * femea morta e cicatriz nao contam.
   */
  function meloidogyneActive() {
    const lifecycle = systems.meloidogyneLifecycle;
    if (!lifecycle) return 0;
    const juveniles = (lifecycle.juveniles || []).filter(entry => entry.alive).length;
    const galls = (lifecycle.galls || []).filter(isActiveMeloidogyneGall).length;
    const masses = (lifecycle.eggMasses || [])
      .filter(mass => mass.eggs > 0 && !mass.neutralized).length;
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
    const scored = scoreTargets(pathogen);
    if (!scored.length) return null;
    // Coinfecção é permitida: a raiz não é excluída por já ter o outro
    // patógeno. Se ela é o melhor alvo, ela é o alvo.
    return scored[0].root;
  }

  // --- ORIGEM FÍSICA DA CHEGADA -------------------------------------------
  //
  // O patógeno vem de algum lugar. Nada de coordenada fixa de tela: a origem
  // sai da câmera atual e dos limites reais do mundo, então funciona em
  // qualquer zoom e em qualquer altura da silhueta.
  //
  // AMBIGUIDADE: "região necrótica publicada no nível" não existe.
  // `necrotic-zone.js` é fundo decorativo, não dado de fase. O equivalente real
  // é tecido MORTO: raiz em colapso (`rootHealth` baixo) ou com foco de fungo
  // oportunista. É isso que uso, e é de onde faz sentido um inóculo partir.

  const ORIGIN_TYPES = Object.freeze(['left', 'right', 'below', 'necrotic']);

  const ORIGIN_LABEL = Object.freeze({
    left: 'pela esquerda',
    right: 'pela direita',
    below: 'por baixo, do solo profundo',
    necrotic: 'de um tecido radicular necrosado',
  });

  function viewportBounds() {
    const cameraX = Number(state?.cameraX) || 0;
    const cameraY = Number(state?.cameraY) || 0;
    const width = Number(state?.visibleWorldWidth) || 1280;
    const height = Number(state?.visibleWorldHeight) || 720;
    return {
      left: cameraX,
      right: cameraX + width,
      top: cameraY,
      bottom: cameraY + height,
    };
  }

  function necroticRoots() {
    return candidateRoots().filter(root => (
      (root.rootHealth ?? 1) < 0.3
      || root.rootState === 'collapse'
      || root.opportunisticFocus === true
    ));
  }

  // Quanto a origem pode ficar FORA do trecho visível.
  //
  // Ela precisa nascer fora — o patógeno vem de algum lugar, e brotar no meio
  // do campo de visão seria o defeito do marcador com outro desenho. Mas se
  // ficar longe demais o grupo passa quase todo o percurso invisível e só
  // aparece colado na raiz, que é o mesmo defeito pelo outro lado.
  //
  // Isto ficou crítico com as rotas verticais: com o jogador no alto de uma
  // silhueta de 800px, uma origem no solo profundo cai uma tela inteira abaixo
  // da câmera e nunca é vista.
  const ORIGIN_MAXIMUM_OFFSCREEN = 260;

  /**
   * Traz a origem para a borda da câmera sem deixá-la entrar.
   *
   * O tipo continua valendo — esquerda continua nascendo à esquerda e fora — só
   * a distância é que passa a ser medida em relação ao que está na tela, e não
   * em relação ao mundo inteiro.
   */
  function constrainOriginToView(origin, targetY) {
    const view = viewportBounds();
    const out = ORIGIN_MAXIMUM_OFFSCREEN;
    let { originX, originY } = origin;
    originX = clamp(originX, view.left - out, view.right + out);
    originY = clamp(originY, view.top - out, view.bottom + out);
    // Invariantes do tipo, reaplicadas depois do corte.
    if (origin.originType === 'left') originX = Math.min(originX, view.left - 60);
    if (origin.originType === 'right') originX = Math.max(originX, view.right + 60);
    // "De baixo" tem de continuar sendo de baixo, mesmo quando a raiz-alvo está
    // no alto de uma rota vertical e o fundo do mundo ficou fora da câmera.
    if (origin.originType === 'below') originY = Math.max(originY, targetY + 90);
    return { ...origin, originX, originY };
  }

  /**
   * Distância máxima aceitável do percurso, em pixels.
   *
   * Só faz sentido para a Meloidogyne, porque só ela viaja a uma velocidade
   * física. O inóculo da Ralstonia tem duração própria e não é afetado.
   */
  function maximumTravelDistance(pathogen) {
    if (pathogen !== 'meloidogyne') return Infinity;
    return config.meloidogyneArrivalSpeed * config.meloidogyneMaximumTravelSeconds;
  }

  function selectOrigin(pathogen, targetRoot) {
    const random = createRandom(
      `${seedValue()}:arrival-origin:${pathogen}:n${totalArrivals}:a${attemptId()}`,
    );
    const view = viewportBounds();
    const margin = 140 + random() * 120;
    const targetX = targetRoot ? targetRoot.x + targetRoot.w / 2 : view.left + 200;
    const targetY = targetRoot ? targetRoot.y : view.bottom - 100;
    const limit = maximumTravelDistance(pathogen);

    // A necrótica só entra se existir E estiver dentro do trecho visível, ou
    // logo ao lado dele, E dentro do alcance do percurso. Diferente das outras,
    // esta é um lugar REAL — puxá-la para perto seria mentir sobre onde o
    // tecido morto está, então ela é DESCARTADA em vez de deslocada, e o
    // sorteio cai em outra origem válida.
    const necrotic = necroticRoots().filter(root => {
      const center = root.x + root.w / 2;
      if (center <= view.left - 400 || center >= view.right + 400) return false;
      return Math.hypot(center - targetX, root.y - targetY) <= limit;
    });
    const pool = necrotic.length ? ORIGIN_TYPES : ORIGIN_TYPES.filter(type => type !== 'necrotic');
    const type = pool[Math.floor(random() * pool.length) % pool.length];

    if (type === 'necrotic') {
      const source = necrotic[Math.floor(random() * necrotic.length) % necrotic.length];
      return {
        originType: 'necrotic',
        originX: source.x + 20 + random() * Math.max(1, source.w - 40),
        originY: source.y + 18 + random() * 26,
        sourceLogicIndex: source.logicIndex,
      };
    }
    if (type === 'below') {
      const floor = Number(level().worldBottomY);
      const belowY = Math.min(
        Number.isFinite(floor) ? floor - 30 : view.bottom + 120,
        view.bottom + margin,
      );
      return constrainOriginToView({
        originType: 'below',
        originX: targetX + (random() - 0.5) * 260,
        originY: Math.max(targetY + 90, belowY),
      }, targetY);
    }
    // Lateral longe demais: TROCA de lado em vez de encurtar. Encurtar traria a
    // origem para dentro do enquadramento, e a origem tem de nascer fora dele —
    // a borda mais próxima resolve as duas coisas.
    let fromLeft = type === 'left';
    const distanceFrom = side => Math.abs((side ? view.left - margin : view.right + margin) - targetX);
    if (distanceFrom(fromLeft) > limit && distanceFrom(!fromLeft) < distanceFrom(fromLeft)) {
      fromLeft = !fromLeft;
    }
    return constrainOriginToView({
      originType: fromLeft ? 'left' : 'right',
      originX: fromLeft ? view.left - margin : view.right + margin,
      originY: targetY + 30 + random() * 60,
    }, targetY);
  }

  // --- PONTUAÇÃO POR PATÓGENO ----------------------------------------------
  //
  // Separadas de propósito. Os dois querem coisas diferentes de uma raiz, e
  // misturar isso numa função só foi o que fez a versão anterior escolher
  // alvos que não diziam nada.

  function rootHealthOf(root) {
    const health = Number(root.rootHealth);
    return Number.isFinite(health) ? clamp(health, 0, 1) : 1;
  }

  /** Vagas de infeccao OCUPADAS nesta raiz. So organismo vivo — duas cicatrizes
   *  antigas nao podem tornar a raiz permanentemente imune. */
  function occupancyOf(root) {
    const lifecycle = systems.meloidogyneLifecycle;
    if (!lifecycle) return 0;
    const galls = (lifecycle.galls || [])
      .filter(gall => gall.platform === root && isActiveMeloidogyneGall(gall)).length;
    const inside = (lifecycle.juveniles || [])
      .filter(juvenile => juvenile.targetRoot === root && juvenile.state !== 'seeking').length;
    return galls + inside;
  }

  /**
   * Galhas de QUALQUER estagio nesta raiz, inclusive as residuais.
   *
   * A Ralstonia entra por ferida, e a cicatriz de Meloidogyne continua sendo
   * uma porta — nao importa se a femea que a abriu ja morreu. Separar as duas
   * contagens e o que permite tirar a cicatriz da ocupacao SEM mexer na
   * pontuacao da Ralstonia, que fica exatamente como estava.
   */
  function gallScarsOf(root) {
    const lifecycle = systems.meloidogyneLifecycle;
    if (!lifecycle) return 0;
    return (lifecycle.galls || []).filter(gall => gall.platform === root).length;
  }

  function ralstoniaOn(root) {
    const foci = systems.ralstoniaControl?.foci || level().ralstoniaFoci || [];
    return foci.some(focus => focus.root === root && !focus.neutralized);
  }

  /**
   * Meloidogyne precisa de tecido VIVO: ela estabelece sítio de alimentação e
   * vira fêmea ali. Raiz quase morta não serve — não é preferência estética, é
   * o que a biologia do ciclo exige.
   */
  function scoreMeloidogyneTarget(root) {
    const health = rootHealthOf(root);
    const cloud = cloudAttraction(root);
    const distance = playerDistanceScore(root);
    // Abaixo de 0,25 o tecido está em colapso: penalidade forte, não exclusão.
    const tissue = health < 0.25 ? -1.4 : health < 0.5 ? -0.2 : 0.35 + health * 0.4;
    const occupancy = -0.3 * occupancyOf(root);
    const protection = -protectionPenalty(root);
    return {
      logicIndex: root.logicIndex,
      cloud,
      distance,
      tissue,
      occupancy,
      protection,
      lesion: 0,
      otherPathogen: ralstoniaOn(root) ? 0 : 0,
      score: cloud * 3 + distance + tissue + occupancy + protection,
    };
  }

  /**
   * Ralstonia entra por ferida. Lesão, galha de Meloidogyne, dano de
   * Rhizoctonia ou fungo oportunista AUMENTAM a preferência — mas nenhum é
   * requisito: ela também alcança raiz intacta.
   */
  function scoreRalstoniaTarget(root) {
    const health = rootHealthOf(root);
    const cloud = cloudAttraction(root);
    const distance = playerDistanceScore(root);
    let lesion = 0;
    // Cicatriz conta: a porta que a galha abriu continua aberta depois de a
    // femea morrer. Por isso `gallScarsOf` e nao `occupancyOf`.
    if (gallScarsOf(root) > 0) lesion += 0.6;
    if ((root.rhizoctoniaColonization || 0) > 0.15) lesion += 0.5;
    if (root.opportunisticFocus) lesion += 0.4;
    if ((root.woundOpening || 0) > 0.1) lesion += 0.5;
    // Dano moderado abre porta; colapso total já não sustenta colonização.
    if (health < 0.7 && health > 0.2) lesion += 0.45;
    const protection = -protectionPenalty(root);
    return {
      logicIndex: root.logicIndex,
      cloud,
      distance,
      tissue: health < 0.2 ? -0.5 : 0,
      occupancy: 0,
      protection,
      lesion,
      otherPathogen: gallScarsOf(root) > 0 ? 1 : 0,
      score: cloud * 3 + distance + lesion + protection + (health < 0.2 ? -0.5 : 0),
    };
  }

  function playerDistanceScore(root) {
    const playerX = (state?.player?.x ?? 0) + (state?.player?.w ?? 0) / 2;
    const ahead = root.x + root.w / 2 - playerX;
    return ahead >= 0 ? 1 / (1 + ahead / 900) : 0.35 / (1 + Math.abs(ahead) / 900);
  }

  function scoreTargets(pathogen) {
    const scorer = pathogen === 'ralstonia' ? scoreRalstoniaTarget : scoreMeloidogyneTarget;
    return candidateRoots()
      .map(root => ({ root, ...scorer(root) }))
      .sort((left, right) => right.score - left.score);
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

  /**
   * Uma mensagem curta na PRIMEIRA aparição de cada patógeno na fase, e só.
   *
   * O que precisa ser dito é de onde ele vem e que ainda não chegou — daí em
   * diante o próprio deslocamento é a informação, e repetir o texto a cada
   * chegada transformaria a leitura do solo em leitura de legenda.
   */
  function announceFirstAppearance(pathogen, originType) {
    if (!state || announcedPathogens.has(pathogen)) return;
    announcedPathogens.add(pathogen);
    const where = ORIGIN_LABEL[originType] || 'pelo solo';
    state.toast = pathogen === 'ralstonia'
      ? `Inóculo de Ralstonia atravessando o solo ${where}. Ele só coloniza ao alcançar a raiz.`
      : `Juvenis J2 de Meloidogyne entrando ${where}. Eles nadam até achar uma raiz.`;
    state.toastTime = 5.5;
  }

  /**
   * Começa o DESLOCAMENTO. O aviso deixou de ser um retângulo pontilhado: é o
   * próprio patógeno atravessando o solo, da origem até a rizosfera.
   *
   * Os dois viajam de formas diferentes, e é isso que os torna reconhecíveis —
   * e também por que têm relógios diferentes:
   *
   *   Meloidogyne — os J2 REAIS nascem na origem e nadam a 47 px/s, a mesma
   *   velocidade de um J2 recém-eclodido. Não há entidade intermediária: eles
   *   já são o estágio inicial do ciclo. A duração sai da DISTÂNCIA, e a
   *   chegada só é contabilizada quando alguém alcança a rizosfera.
   *
   *   Ralstonia — um inóculo ambiental temporário com duração própria
   *   (`warningSeconds`), porque o foco superficial só pode existir quando o
   *   inóculo CHEGA. Criar o foco na origem seria colonizar a raiz de longe.
   */
  function beginWarning(pathogen, { tutorial = false, source = 'pressure', targetRoot = null } = {}) {
    const root = targetRoot || selectTargetRoot(pathogen);
    if (!root) return null;
    const origin = selectOrigin(pathogen, root);
    const random = createRandom(
      `${seedValue()}:arrival-path:${pathogen}:n${totalArrivals}:a${attemptId()}`,
    );
    warning = {
      pathogen,
      targetRoot: root,
      targetX: root.x + root.w / 2,
      targetY: root.y,
      ...origin,
      travelProgress: 0,
      estimatedTravelSeconds: config.warningSeconds,
      timeRemaining: config.warningSeconds,
      // Curvatura e oscilação fixas por chegada: a trajetória é orgânica sem
      // deixar de ser determinística.
      curve: (random() - 0.5) * 220,
      wobble: 0.6 + random() * 0.8,
      wobblePhase: random() * Math.PI * 2,
      source,
      tutorial,
      // Duas listas, e a diferença importa: `entities` é o que ESTE controlador
      // move quadro a quadro (o inóculo da Ralstonia); `organisms` é o que já
      // está no mundo e se move sozinho (os J2). Empurrar um J2 daqui seria
      // duplicar o comando do ciclo dele.
      entities: [],
      organisms: [],
    };

    if (pathogen === 'meloidogyne') {
      // Os J2 nascem NA ORIGEM, com a raiz escolhida apenas como preferência.
      // Daqui em diante quem manda é o comportamento normal deles.
      const api = systems.meloidogyneLifecycle?.introduceJ2Arrival;
      const result = api
        ? api({
            originX: origin.originX,
            originY: origin.originY,
            preferredRoot: root,
            source,
            // Velocidade, não duração. O ciclo mede a curva e deriva o tempo.
            travelSpeed: config.meloidogyneArrivalSpeed,
          })
        : null;
      if (!result) { warning = null; return null; }
      warning.organisms = [...result.juveniles];
      warning.groupId = result.groupId;
      warning.pathLength = result.pathLength;
      warning.estimatedTravelSeconds = result.travelSeconds;
      warning.timeRemaining = result.travelSeconds;
      warning.speed = result.speed;
      warning.warningTriggered = false;
      warning.counted = false;
      warning.groupState = 'travelling';
      // Uma leitura ja na criacao: sem ela a primeira publicacao sai sem
      // distancia, e o Phase Lab mostra o grupo "a 0px da raiz" no instante em
      // que ele acabou de nascer do outro lado da tela.
      updateMeloidogyneGroup();
      // NÃO se conta nada aqui. Nascer não é chegar: a contagem acontece quando
      // o primeiro J2 alcança a rizosfera, e um grupo inteiro capturado pelo
      // Trichoderma no caminho nunca chega a ser uma chegada.
      //
      // O progresso do relógio compartilhado reinicia agora, senão ele já está
      // acima do limiar e dispararia uma segunda chegada no quadro seguinte.
      arrivalProgress = 0;
    } else {
      // Entidade temporária, publicada no nível para o renderizador desenhar.
      const inoculum = {
        id: `ralstonia-inoculum-${totalArrivals}-${Math.round(Number(state?.time) || 0)}`,
        x: origin.originX,
        y: origin.originY,
        originX: origin.originX,
        originY: origin.originY,
        targetRoot: root,
        progress: 0,
        wobblePhase: warning.wobblePhase,
        source,
      };
      level().ralstoniaTravelInoculum = [
        ...(level().ralstoniaTravelInoculum || []),
        inoculum,
      ];
      warning.entities = [inoculum];
    }

    announceFirstAppearance(pathogen, origin.originType);
    record('travel-start', {
      pathogen, source, tutorial,
      logicIndex: root.logicIndex,
      originType: origin.originType,
    });
    publish();
    return warning;
  }

  function countArrival(pathogen, { tutorial, source, root, travelling = false }) {
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
      pathogen, source, tutorial,
      logicIndex: root?.logicIndex ?? null,
      travelling,
    });
  }

  /**
   * Posição da entidade em deslocamento, num quadro qualquer.
   *
   * Curva leve mais oscilação: um inóculo não anda em linha reta pelo solo. O
   * DESTINO é lido da raiz a cada quadro — se ela se mover, o percurso se
   * recalcula em vez de apontar para onde ela estava.
   */
  function travelPointAt(entry, progress) {
    const root = entry.targetRoot;
    const targetX = root ? root.x + root.w / 2 : entry.targetX;
    const targetY = root ? root.y + 12 : entry.targetY;
    const t = clamp(progress, 0, 1);
    const arc = Math.sin(t * Math.PI);
    const x = entry.originX + (targetX - entry.originX) * t;
    const y = entry.originY + (targetY - entry.originY) * t
      + arc * (entry.curve ?? 0) * 0.35
      + Math.sin(t * 9 + (entry.wobblePhase ?? 0)) * 14 * (entry.wobble ?? 1) * arc;
    return { x, y };
  }

  // --- ACOMPANHAMENTO DO GRUPO DE MELOIDOGYNE -------------------------------
  //
  // Nada de cronômetro aqui: o controlador só OBSERVA o que o ciclo faz com os
  // J2. Ele decide duas coisas — quando avisar (por distância) e quando
  // contabilizar (quando alguém chega de fato).

  function meloidogyneSnapshot() {
    if (!warning?.groupId) return null;
    return systems.meloidogyneLifecycle?.arrivalGroupSnapshot?.(warning.groupId) || null;
  }

  /** Ponto da rizosfera da raiz preferida, agora. É contra ele que a distância
   *  do grupo é medida — não contra o topo da raiz nem contra o centro dela. */
  function rhizospherePoint(root) {
    return { x: root.x + root.w * 0.4, y: root.y + 30 };
  }

  function updateMeloidogyneGroup() {
    const snapshot = meloidogyneSnapshot();
    if (!snapshot) return;
    const root = warning.targetRoot;
    warning.snapshot = snapshot;
    warning.travelProgress = snapshot.progress;
    warning.timeRemaining = snapshot.estimatedSecondsRemaining;
    warning.estimatedTravelSeconds = snapshot.pathLength / Math.max(1e-6, snapshot.speed);

    // Distância do grupo (posição média dos que ainda vêm) até a rizosfera.
    const target = rhizospherePoint(root);
    warning.distanceToRoot = snapshot.meanX === null
      ? 0
      : Math.hypot(snapshot.meanX - target.x, snapshot.meanY - target.y);

    // AVISO POR PROXIMIDADE. Uma vez por chegada, e nunca na origem: enquanto o
    // grupo está longe o próprio movimento já é o sinal, e um texto repetido a
    // cada quadro viraria ruído em vez de aviso.
    if (
      !warning.warningTriggered
      && snapshot.transitCount > 0
      && warning.distanceToRoot <= config.meloidogyneWarningDistance
    ) {
      warning.warningTriggered = true;
      warning.groupState = 'warning';
      if (state) { state.toast = 'J2 aproximando-se da raiz'; state.toastTime = 3.5; }
      record('warning', {
        pathogen: 'meloidogyne',
        logicIndex: root?.logicIndex ?? null,
        distance: Math.round(warning.distanceToRoot),
      });
    }

    // CHEGOU: pelo menos um J2 do grupo alcançou a rizosfera. Uma contagem por
    // grupo, não uma por J2 — os outros continuam nadando e viram J2 comuns.
    if (snapshot.arrivedCount > 0) {
      if (!warning.counted) {
        warning.counted = true;
        countArrival('meloidogyne', {
          tutorial: warning.tutorial, source: warning.source, root, travelling: true,
        });
      }
      warning.groupState = 'arrived';
      warning = null;
      return;
    }

    // INTERCEPTADO: ninguém em trânsito e ninguém chegou. Sem contagem, sem
    // cooldown — o jogador impediu a chegada, e cobrar o intervalo de uma
    // chegada efetiva seria premiar o patógeno por ter fracassado.
    if (snapshot.transitCount === 0) {
      warning.groupState = 'intercepted';
      record('intercepted', {
        pathogen: 'meloidogyne',
        logicIndex: root?.logicIndex ?? null,
        capturados: snapshot.interceptedCount,
        iniciais: snapshot.memberCount,
      });
      warning = null;
    }
  }

  function completeWarning() {
    if (!warning) return null;
    const { pathogen, targetRoot, tutorial, source } = warning;
    const targetX = targetRoot ? targetRoot.x + targetRoot.w / 2 : warning.targetX;

    if (pathogen === 'meloidogyne') {
      // Não há "completar" por tempo: quem termina o percurso da Meloidogyne é
      // o próprio J2 ao alcançar a rizosfera. Aqui só se empurra o grupo até
      // lá — o Phase Lab usa isto para não esperar a travessia inteira.
      systems.meloidogyneLifecycle?.releaseArrivalGroup?.(warning.groupId);
      updateMeloidogyneGroup();
      publish();
      return true;
    }

    // Ralstonia: o inóculo CHEGOU. Só agora o foco superficial pode existir.
    level().ralstoniaTravelInoculum = (level().ralstoniaTravelInoculum || [])
      .filter(entry => !warning.entities.includes(entry));
    const api = arrivalApi('ralstonia');
    warning = null;
    if (!api) return null;
    const result = api({ targetRoot, x: targetX, source });
    countArrival('ralstonia', { tutorial, source, root: targetRoot });
    publish();
    return result;
  }

  function record(kind, detail) {
    eventHistory = [
      ...eventHistory,
      { kind, phaseTime: Number(state?.time) || 0, ...detail },
    ].slice(-ARRIVAL_HISTORY_LIMIT);
  }

  /**
   * Os candidatos a alvo com a pontuação ABERTA, parcela por parcela.
   *
   * Sem isso o Phase Lab mostra qual raiz foi escolhida mas não por quê, e a
   * diferença entre "a nuvem puxou" e "a lesão puxou" fica invisível — que é
   * exatamente o que se precisa ver para ajustar os pesos.
   */
  function candidateScores(pathogen, limit = 6) {
    return scoreTargets(pathogen).slice(0, limit).map(entry => ({
      logicIndex: entry.logicIndex,
      x: entry.root.x + entry.root.w / 2,
      y: entry.root.y,
      score: entry.score,
      cloud: entry.cloud,
      distance: entry.distance,
      tissue: entry.tissue,
      occupancy: entry.occupancy,
      protection: entry.protection,
      lesion: entry.lesion,
      otherPathogen: entry.otherPathogen,
    }));
  }

  /** Leitura do grupo em trânsito, para o Phase Lab. Tudo em px e px/s, para
   *  poder ser conferido contra o que se vê na tela. */
  function meloidogyneReading() {
    if (!warning || warning.pathogen !== 'meloidogyne') return null;
    const snapshot = warning.snapshot || meloidogyneSnapshot();
    if (!snapshot) return null;
    return {
      groupId: snapshot.groupId,
      initialCount: warning.organisms.length,
      activeCount: snapshot.transitCount,
      capturedCount: snapshot.interceptedCount,
      arrivedCount: snapshot.arrivedCount,
      meanX: snapshot.meanX,
      meanY: snapshot.meanY,
      totalDistance: snapshot.pathLength,
      traveledDistance: snapshot.traveled,
      remainingDistance: snapshot.remaining,
      speed: snapshot.speed,
      estimatedSecondsRemaining: snapshot.estimatedSecondsRemaining,
      progress: snapshot.progress,
      warningTriggered: Boolean(warning.warningTriggered),
      warningDistance: config.meloidogyneWarningDistance,
      distanceToRoot: warning.distanceToRoot ?? null,
      targetLogicIndex: warning.targetRoot?.logicIndex ?? null,
      originType: warning.originType,
      state: warning.groupState || 'travelling',
      counted: Boolean(warning.counted),
    };
  }

  function publish() {
    const active = activeByPathogen();
    const detail = intervalDetail();
    const reading = {
      arrivalProgress,
      currentThreshold,
      currentRate: 1 / Math.max(1e-6, detail.interval),
      currentMeanInterval: detail.interval,
      // A interpolação fica exposta: dá para ver entre quais pontos a pressão
      // atual caiu e o quanto ela já andou entre eles.
      meanIntervalDetail: {
        interval: detail.interval,
        fraction: detail.fraction,
        lowerStop: { at: detail.lowerStop.at, interval: detail.lowerStop.interval },
        upperStop: { at: detail.upperStop.at, interval: detail.upperStop.interval },
      },
      cooldownRemaining,
      warning: warning
        ? {
            pathogen: warning.pathogen,
            targetRoot: warning.targetRoot,
            targetX: warning.targetRoot
              ? warning.targetRoot.x + warning.targetRoot.w / 2
              : warning.targetX,
            targetY: warning.targetRoot ? warning.targetRoot.y : warning.targetY,
            originType: warning.originType,
            originX: warning.originX,
            originY: warning.originY,
            travelProgress: warning.travelProgress,
            estimatedTravelSeconds: warning.estimatedTravelSeconds,
            travelPoint: travelPointAt(warning, warning.travelProgress),
            entities: [...warning.entities],
            organisms: [...warning.organisms],
            timeRemaining: warning.timeRemaining,
            source: warning.source,
            tutorial: warning.tutorial,
            groupId: warning.groupId ?? null,
            warningTriggered: warning.warningTriggered ?? null,
            distanceToRoot: warning.distanceToRoot ?? null,
          }
        : null,
      // O grupo de Meloidogyne, em detalhe. O progresso vem do DESLOCAMENTO
      // real — distância percorrida sobre distância total — e não de um
      // cronômetro, que era o que deixava a barra em 100% com os J2 ainda a
      // meia tela da raiz.
      meloidogyneArrival: meloidogyneReading(),
      candidateScores: {
        meloidogyne: candidateScores('meloidogyne'),
        ralstonia: candidateScores('ralstonia'),
      },
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

    // MELOIDOGYNE — sem cronômetro. O controlador observa o grupo que o ciclo
    // está movendo e decide só duas coisas: quando avisar e quando contabilizar.
    if (warning?.pathogen === 'meloidogyne') {
      updateMeloidogyneGroup();
      return publish();
    }

    // RALSTONIA — duração própria, deslocamento próprio. Não foi desacelerada
    // junto: o inóculo é uma entidade do controlador, não um organismo com
    // velocidade de natação.
    if (warning) {
      warning.timeRemaining -= step;
      warning.travelProgress = clamp(
        1 - warning.timeRemaining / Math.max(1e-6, config.warningSeconds),
        0,
        1,
      );
      for (const entry of warning.entities) {
        const point = travelPointAt({ ...warning, ...entry }, warning.travelProgress);
        entry.x = point.x;
        entry.y = point.y;
        entry.progress = warning.travelProgress;
      }
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

  /**
   * Cancela o que ainda está a caminho — e só isso.
   *
   * Nenhum contador se mexe e nenhum cooldown começa: cancelar não é uma
   * chegada, é o desfazer de uma que não aconteceu. Depois que o grupo alcança
   * a rizosfera ele deixa de ser cancelável, porque nesse momento `warning` já
   * foi encerrado e os J2 viraram J2 comuns — retirá-los seria apagar
   * organismos do mundo, não cancelar um percurso.
   */
  function cancelWarning() {
    if (!warning) return false;
    record('cancelled', {
      pathogen: warning.pathogen,
      logicIndex: warning.targetRoot?.logicIndex ?? null,
      groupId: warning.groupId ?? null,
    });
    // O inóculo em trânsito some junto: cancelar o percurso e deixar a
    // entidade no mundo seria um patógeno órfão nadando para sempre.
    if (warning.entities.length && state?.level) {
      state.level.ralstoniaTravelInoculum = (state.level.ralstoniaTravelInoculum || [])
        .filter(entry => !warning.entities.includes(entry));
    }
    // Só os J2 DAQUELE grupo, pelo `arrivalGroupId`. Uma varredura por
    // referência apagaria também J2 que já tivessem sido liberados e estivessem
    // buscando por conta própria.
    if (warning.groupId) {
      systems.meloidogyneLifecycle?.removeArrivalGroup?.(warning.groupId);
    }
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
    announcedPathogens = new Set();
    if (state?.level) {
      state.level.pathogenArrival = null;
      // Nenhum inóculo em trânsito sobrevive à reconstrução: ele é uma
      // entidade da fase, não do controlador.
      state.level.ralstoniaTravelInoculum = [];
    }
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
    intervalDetail,
    preventionAvailableFromChunk,
    selectTargetRoot,
    selectOrigin,
    scoreTargets,
    candidateScores,
    travelPointAt,
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
