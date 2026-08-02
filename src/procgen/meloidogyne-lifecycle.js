import { createRandom } from './random.js';
import { W } from '../core/constants.js';
import { organismSprites } from '../render/organism-sprites.js';
import { createRootHealthGameplay } from './root-health-gameplay.js';
import { MELOIDOGYNE_DEFAULTS } from './campaign-manifest.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (p, s = 0) => {
  const v = Math.sin(((p.x || 0) * 12.9898 + (p.y || 0) * 78.233 + (p.w || 0) * 37.719 + s * 31.17) * .001) * 43758.5453;
  return v - Math.floor(v);
};
const pointOnRoot = (p, x) => ({ x: clamp(x, p.x + 18, p.x + p.w - 18), y: p.y - 5 });

/**
 * VELOCIDADE-BASE DO J2, em px/s.
 *
 * É a velocidade com que um J2 recém-eclodido nada até a raiz (`seek`), e agora
 * também a da chegada externa: um J2 que vem de fora não é uma espécie mais
 * rápida, é o mesmo organismo vindo de mais longe. O número mora aqui e só
 * aqui — o controlador de chegadas importa esta constante em vez de repetir
 * 47 do outro lado.
 */
export const MELOIDOGYNE_BASE_SPEED = 47;

// Quantos pedaços usar para medir o comprimento da trajetória curva. Com 18 o
// erro contra uma integração fina fica abaixo de 1%, e é o que decide a duração
// do percurso — medir a corda em vez da curva encurtaria a viagem.
const ARRIVAL_PATH_SAMPLES = 18;

export function createMeloidogyneLifecycle({ state, entities }) {
  const eggs = [], juveniles = [], galls = [];
  const rootGameplay = createRootHealthGameplay({ state, entities });
  let eggId = 1, juvenileId = 1, gallId = 1, lastToast = -Infinity;
  let healthAverage = 1, infestation = 0;

  const roots = () => (state.level.platforms || []).filter(p => (
    p.type === 'root'
    && !p.final
    && !p.recovery
    && !p.mycorrhizaStructure
    && (p.routeScope !== 'optional' || p.allowOptionalRoutePopulation)
  ));
  function prepareRoot(p) {
    if (p.type !== 'root') return;
    if (!Number.isFinite(p.rootHealth)) p.rootHealth = 1;
    if (!Number.isFinite(p.rootDamage)) p.rootDamage = 0;
    if (!Number.isFinite(p.carbonAvailability)) p.carbonAvailability = 1;
    if (!Number.isFinite(p.nutrientEfficiency)) p.nutrientEfficiency = 1;
    if (!Number.isFinite(p.meloidogyneBurden)) p.meloidogyneBurden = 0;
  }
  function announce(text, duration = 5) {
    if (state.time - lastToast < 2.2) return;
    state.toast = text;
    state.toastTime = duration;
    lastToast = state.time;
  }
  function expose() {
    state.level.nematodeEggMasses = eggs;
    state.level.nematodeJuveniles = juveniles;
    state.level.rootGalls = galls;
  }

  // Parametros ajustaveis pelo Phase Lab, como nas outras mecanicas.
  function settings() {
    return { ...MELOIDOGYNE_DEFAULTS, ...(state.level.phaseProfile?.meloidogyne || {}) };
  }

  function addEggMass(platform, x, generation = 0, sourceGallId = null, initial = false) {
    prepareRoot(platform);
    const maxEggs = initial ? 7 + Math.floor(hash(platform, 113 + generation) * 4) : 5 + generation + Math.floor(Math.random() * 3);
    const mass = {
      id: `melo-egg-${eggId++}`, platform,
      x: clamp(x, platform.x + 20, platform.x + platform.w - 20), y: platform.y - 7,
      eggs: maxEggs, maxEggs, generation, sourceGallId, initial,
      hatch: .8 + hash(platform, 127 + generation) * 2.2,
      age: 0, emptyAge: 0, phase: hash(platform, 139 + generation) * TAU,
      trichodermaSuppression: 0, trichodermaLysis: 0, neutralized: false,
    };
    eggs.push(mass);
    return mass;
  }

  // Os focos se distribuem ao longo da fase em vez de se concentrarem no comeco.
  // Antes a infestacao inteira nascia nos primeiros blocos e gastava ali todas
  // as geracoes, deixando o final da fase vazio.
  function seedInfestation() {
    const startChunk = state.level.pathogenSchedule?.meloidogyne;
    if (!Number.isInteger(startChunk)) return;
    const candidates = roots()
      .filter(p => (p.logicIndex ?? -1) >= startChunk && p.w >= 120 && !p.azospirillumStructure)
      .sort((a, b) => (a.logicIndex ?? 0) - (b.logicIndex ?? 0));
    if (!candidates.length) return;

    const config = settings();
    const spacing = Math.max(2, config.focusSpacingChunks);
    const span = (candidates.at(-1).logicIndex ?? 0) - (candidates[0].logicIndex ?? 0) + 1;
    const wanted = clamp(Math.round(span / spacing), 1, Math.max(1, config.maxFoci));

    const chosen = [];
    for (let i = 0; i < wanted; i++) {
      // Distribui os focos por posicao na lista, do primeiro bloco elegivel ate
      // o ultimo, para a pressao acompanhar o jogador ao longo da fase.
      const at = Math.min(
        candidates.length - 1,
        Math.round(i * (candidates.length - 1) / Math.max(1, wanted - 1 || 1)),
      );
      const platform = candidates[at];
      if (!chosen.includes(platform)) chosen.push(platform);
    }
    for (const p of chosen) addEggMass(p, p.x + p.w * (.28 + hash(p, 29) * .44), 0, null, true);
  }

  let arrivalCount = 0;

  function clear() {
    arrivalCount = 0;
    rootGameplay.clear();
    eggs.length = juveniles.length = galls.length = 0;
    for (const p of state.level.platforms || []) {
      delete p.rootHealth; delete p.rootDamage; delete p.carbonAvailability;
      delete p.nutrientEfficiency; delete p.meloidogyneBurden; delete p.meloidogyneStage;
    }
    eggId = juvenileId = gallId = 1;
    lastToast = -Infinity; healthAverage = 1; infestation = 0; expose();
  }
  function reset() {
    eggs.length = juveniles.length = galls.length = 0;
    eggId = juvenileId = gallId = 1; lastToast = -Infinity;
    arrivalCount = 0;
    for (const p of roots()) prepareRoot(p);
    expose();
    // A fase NAO nasce mais infestada. A primeira geracao chega por
    // `introduceJ2Arrival`, sob controle da pressao. `seedInfestation` fica
    // para quem desligar as chegadas dinamicas — e para as fases que ainda
    // dependem dela.
    if (!state.level?.dynamicPathogenArrival) seedInfestation();
    rootGameplay.reset();
  }

  function spawnJ2(mass) {
    if (mass.neutralized || juveniles.length >= 18) return false;
    const a = -Math.PI / 2 + (Math.random() - .5) * 1.2;
    juveniles.push({
      id: `melo-j2-${juvenileId++}`, generation: mass.generation,
      x: mass.x + (Math.random() - .5) * 12, y: mass.y - 8 - Math.random() * 7,
      vx: Math.cos(a) * (18 + Math.random() * 16), vy: Math.sin(a) * (18 + Math.random() * 12),
      state: 'seeking', targetRoot: null, targetX: mass.x, progress: 0,
      age: 0, retarget: 0, cooldown: 0, phase: Math.random() * TAU, alive: true,
      trichodermaCaught: false, trichodermaLysis: 0,
    });
    entities.burst(mass.x, mass.y - 8, '#fff0cf', 8, 58);
    return true;
  }

  /**
   * CHEGADA EXTERNA DE J2 — substitui a infestação pré-instalada.
   *
   * A fase deixa de nascer com massas de ovos nas plataformas. A primeira
   * geração entra por aqui: alguns J2 no SOLO, fora da raiz, já no estado
   * `seeking` — o mesmo em que um J2 recém-eclodido fica. Daí em diante nada
   * muda: eles procuram raiz, penetram, migram, formam sítio de alimentação,
   * galha, fêmea, e as fêmeas põem massas. O ciclo continua inteiro; só o
   * ponto de entrada mudou.
   *
   * Os J2 nascem na ORIGEM FÍSICA da chegada — a borda do trecho visível, o
   * solo profundo, um tecido necrosado — e não colados embaixo da raiz-alvo.
   * Nascer no destino não é chegar: some com o percurso, que é justamente o
   * intervalo em que o jogador ainda pode reforçar a prevenção.
   *
   * `preferredRoot` é PREFERÊNCIA, não destino fixo. Ela orienta o primeiro
   * impulso e vale até o primeiro `retarget`; depois disso quem decide é
   * `chooseRoot`, com o gradiente de exsudato que estiver no solo naquele
   * momento. Uma nuvem melhor no caminho desvia a chegada, como deve.
   */
  function introduceJ2Arrival({
    targetRoot = null, preferredRoot = null, x = null,
    originX = null, originY = null, count = null, source = 'arrival',
    travelSpeed = null, transit = false,
  } = {}) {
    const root = preferredRoot || targetRoot || roots()[0];
    if (!root) return null;
    prepareRoot(root);
    const rootCenterX = root.x + root.w / 2;
    // `x` continua aceito: é a assinatura antiga, e chamador que só sabe o
    // eixo horizontal não deve parar de funcionar.
    const spawnX = Number.isFinite(originX) ? originX
      : Number.isFinite(x) ? x
      : rootCenterX;
    // Determinístico pela seed da fase: quantidade, posição e direção saem do
    // mesmo lugar, então a mesma seed produz a mesma chegada.
    const random = createRandom(
      `${state.campaign?.seed || state.level?.seed || 'melo'}:j2-arrival:${arrivalCount++}`,
    );
    const spawnY = Number.isFinite(originY) ? originY : root.y + 26 + random() * 18;
    const wanted = Number.isInteger(count) ? count : 2 + Math.floor(random() * 2);
    // Aproximação visível: pedida explicitamente, ou implícita quando vem uma
    // velocidade. Sem ela o comportamento antigo continua — os J2 nascem já
    // buscando, que é o que a eclosão de uma massa de ovos faz.
    const speedRequested = Number.isFinite(travelSpeed) && travelSpeed > 0 ? travelSpeed : null;
    const inTransit = Boolean(transit || speedRequested);
    const arrivalSpeed = speedRequested || MELOIDOGYNE_BASE_SPEED;
    const groupId = `melo-arrival-${arrivalCount}`;
    const created = [];
    for (let index = 0; index < wanted; index++) {
      if (juveniles.length >= 18) break;
      const jitterX = spawnX + (random() - .5) * 90;
      const jitterY = spawnY + (random() - .5) * 46;
      // Impulso inicial apontado para a raiz preferida, com dispersão: o grupo
      // sai junto da origem mas não em formação.
      const toRoot = Math.atan2((root.y + 14) - jitterY, rootCenterX - jitterX);
      const angle = toRoot + (random() - .5) * .9;
      const speed = 26 + random() * 18;
      const juvenile = {
        id: `melo-j2-${juvenileId++}`, generation: 0,
        x: jitterX, y: jitterY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        state: 'seeking', targetRoot: root, targetX: rootCenterX, progress: 0,
        // `retarget` positivo segura a preferência pelo primeiro trecho do
        // percurso; zerado, `seek` chamaria `chooseRoot` no primeiro quadro e a
        // preferência não teria efeito nenhum.
        age: 0, retarget: 1.1 + random() * 1.2, cooldown: 0,
        phase: random() * TAU, alive: true,
        trichodermaCaught: false, trichodermaLysis: 0,
        arrivalSource: source, arrivalOriginX: jitterX, arrivalOriginY: jitterY,
        // --- APROXIMAÇÃO VISÍVEL ------------------------------------------
        // O J2 é o organismo real do ciclo desde a origem, mas até alcançar a
        // rizosfera ele está em TRÂNSITO: some do controle de `seek` e é o
        // trajeto que manda nele.
        //
        // O trajeto NÃO tem cronômetro. Ele avança por DISTÂNCIA, à mesma
        // velocidade-base de um J2 recém-eclodido: um percurso mais longo
        // simplesmente demora mais. Com duração fixa, uma origem duas vezes
        // mais distante dobrava a velocidade do organismo para caber no relógio
        // — e a chegada deixava de parecer um nematoide nadando.
        arrivalTransit: inTransit,
        arrivalGroupId: inTransit ? groupId : null,
        arrivalProgress: 0,
        arrivalSpeed,
        arrivalTraveled: 0,
        arrivalPathLength: 0,
        arrivalPreferredRoot: root,
        arrivalCompleted: false,
        arrivalIntercepted: false,
        // Diferenças individuais: cada um curva e ondula de um jeito, então o
        // grupo chega junto sem chegar em fila — e cada um tem seu próprio
        // comprimento de trajeto, logo sua própria duração.
        arrivalCurve: (random() - .5) * 150,
        arrivalWobble: .55 + random() * .9,
        arrivalPhase: random() * TAU,
        arrivalLead: index * .06 + random() * .05,
      };
      if (inTransit) {
        juvenile.arrivalPathLength = arrivalPathLength(juvenile, root);
        juvenile.arrivalDuration = juvenile.arrivalPathLength / arrivalSpeed;
      } else {
        juvenile.arrivalDuration = 0;
      }
      juveniles.push(juvenile);
      created.push(juvenile);
      entities.burst(juvenile.x, juvenile.y, '#e6d2a0', 6, 48);
    }
    if (!created.length) return null;
    expose();
    const pathLength = created.reduce((sum, entry) => sum + entry.arrivalPathLength, 0)
      / created.length;
    return {
      targetRoot: root, preferredRoot: root, x: spawnX,
      originX: spawnX, originY: spawnY, groupId,
      transit: inTransit, speed: arrivalSpeed,
      pathLength,
      travelSeconds: inTransit ? pathLength / arrivalSpeed : 0,
      count: created.length, juveniles: created, source,
    };
  }

  /** Ponto da rizosfera para onde este J2 está indo, lido da raiz agora. */
  function arrivalDestination(j, root) {
    return {
      x: clamp(root.x + root.w * (.3 + (j.arrivalLead || 0)), root.x + 14, root.x + root.w - 14),
      y: root.y + 30,
    };
  }

  /** Posição na trajetória, em `t` de 0 a 1. Uma função só, usada pelo
   *  movimento e pela medição — se fossem duas, a distância medida seria de uma
   *  curva e o organismo andaria por outra. */
  function arrivalPointAt(j, destination, t) {
    const arc = Math.sin(t * Math.PI);
    return {
      x: j.arrivalOriginX + (destination.x - j.arrivalOriginX) * t
        + Math.sin(t * 5.5 + j.arrivalPhase) * 11 * (j.arrivalWobble || 1) * arc,
      y: j.arrivalOriginY + (destination.y - j.arrivalOriginY) * t
        + arc * (j.arrivalCurve || 0)
        + Math.cos(t * 7.5 + j.arrivalPhase) * 9 * (j.arrivalWobble || 1) * arc,
    };
  }

  /**
   * Comprimento REAL da trajetória, somando os pedaços da curva.
   *
   * A corda entre origem e destino subestima o caminho: a curvatura e a
   * ondulação acrescentam distância, e é essa distância que o organismo
   * percorre. Medir a corda faria a viagem terminar antes do tempo, o que é
   * outra forma de acelerar artificialmente.
   */
  function arrivalPathLength(j, root) {
    const destination = arrivalDestination(j, root);
    let total = 0;
    let previous = arrivalPointAt(j, destination, 0);
    for (let step = 1; step <= ARRIVAL_PATH_SAMPLES; step++) {
      const point = arrivalPointAt(j, destination, step / ARRIVAL_PATH_SAMPLES);
      total += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
    }
    return Math.max(1, total);
  }

  /**
   * O TRAJETO ATÉ A RIZOSFERA.
   *
   * Quem conduz é o lifecycle, não o controlador de chegadas: se os dois
   * empurrassem o mesmo J2 no mesmo quadro, o movimento seria a soma de duas
   * intenções e nenhuma delas apareceria direito. O controlador escolhe a
   * origem e o alvo; daqui em diante o organismo é do ciclo.
   *
   * O destino é lido da raiz A CADA QUADRO — se ela se mover, o trajeto se
   * recalcula em vez de apontar para onde ela estava.
   *
   * Determinístico: posição e ondulação saem de `arrivalPhase`, `arrivalCurve`
   * e `arrivalWobble`, todos sorteados da seed na criação. Nada de `state.time`
   * na forma da curva, só no balanço, que é enfeite.
   */
  function updateArrivalTransit(j, dt) {
    const root = roots().includes(j.arrivalPreferredRoot) ? j.arrivalPreferredRoot : null;
    if (!root) { releaseFromTransit(j, null); return; }

    // Avanço por DISTÂNCIA: o organismo nada tantos pixels por segundo, e o
    // progresso é quanto disso já cobriu o caminho. O comprimento é remedido a
    // cada quadro porque a raiz pode se mover — se ela se afasta, o percurso
    // fica mais longo e a viagem demora mais, que é o que aconteceria de fato.
    j.arrivalTraveled += (j.arrivalSpeed || MELOIDOGYNE_BASE_SPEED) * dt;
    j.arrivalPathLength = arrivalPathLength(j, root);
    j.arrivalDuration = j.arrivalPathLength / (j.arrivalSpeed || MELOIDOGYNE_BASE_SPEED);
    j.arrivalProgress = clamp(j.arrivalTraveled / j.arrivalPathLength, 0, 1);

    // A rizosfera, não a superfície: o J2 chega ao SOLO junto da raiz e só
    // depois procura o ponto de entrada.
    const destination = arrivalDestination(j, root);
    const previousX = j.x;
    const previousY = j.y;
    const point = arrivalPointAt(j, destination, j.arrivalProgress);
    j.x = point.x;
    j.y = point.y;
    // A velocidade sai do próprio deslocamento: é ela que orienta o desenho do
    // corpo, então precisa ser a real, não uma inventada.
    if (dt > 0) { j.vx = (j.x - previousX) / dt; j.vy = (j.y - previousY) / dt; }

    if (j.arrivalProgress >= 1) releaseFromTransit(j, root);
  }

  /** Distância que ainda falta, em pixels, para este J2 alcançar a rizosfera. */
  function arrivalRemainingDistance(j) {
    if (!j.arrivalTransit) return 0;
    return Math.max(0, (j.arrivalPathLength || 0) - (j.arrivalTraveled || 0));
  }

  /**
   * Fim do trajeto: o J2 vira um J2 comum. Nada de estado especial sobrando —
   * daqui em diante ele procura, penetra, migra e forma galha como qualquer
   * outro, e pode trocar de raiz se aparecer uma nuvem melhor.
   *
   * `arrivalCompleted` fica marcado porque é o que o controlador de chegadas lê
   * para contabilizar: a chegada acontece AQUI, ao alcançar a rizosfera, e não
   * lá atrás quando o grupo nasceu na origem.
   */
  function releaseFromTransit(j, root) {
    j.arrivalTransit = false;
    j.arrivalProgress = 1;
    j.arrivalCompleted = Boolean(root);
    j.state = 'seeking';
    j.targetRoot = root || null;
    if (root) j.targetX = clamp(j.x, root.x + 12, root.x + root.w - 12);
    // Curto: a preferência já foi honrada pelo trajeto inteiro. O que vale
    // agora é o gradiente que estiver no solo.
    j.retarget = .35 + Math.random() * .5;
    j.cooldown = 0;
    entities.burst(j.x, j.y, '#ffd9a8', 7, 52);
  }

  /**
   * Encerra um grupo inteiro de uma vez, alcançando a rizosfera.
   *
   * Só o Phase Lab usa: "forçar chegada imediata" não pode ter um segundo
   * caminho de código, então ela empurra o grupo até o fim do MESMO trajeto em
   * vez de criar J2 já colados na raiz.
   */
  function releaseArrivalGroup(groupId) {
    const group = juveniles.filter(j => j.arrivalGroupId === groupId && j.arrivalTransit);
    for (const j of group) {
      const root = roots().includes(j.arrivalPreferredRoot) ? j.arrivalPreferredRoot : null;
      if (root) {
        j.arrivalTraveled = j.arrivalPathLength = arrivalPathLength(j, root);
        const destination = arrivalDestination(j, root);
        const point = arrivalPointAt(j, destination, 1);
        j.x = point.x;
        j.y = point.y;
      }
      releaseFromTransit(j, root);
    }
    return group.length;
  }

  /** Retira do mundo os J2 de um grupo que ainda estejam em trânsito. */
  function removeArrivalGroup(groupId) {
    let removed = 0;
    for (let index = juveniles.length - 1; index >= 0; index--) {
      const j = juveniles[index];
      if (j.arrivalGroupId !== groupId || !j.arrivalTransit) continue;
      juveniles.splice(index, 1);
      removed++;
    }
    if (removed) expose();
    return removed;
  }

  /** Fotografia de um grupo em trânsito, para o controlador e o Phase Lab. */
  function arrivalGroupSnapshot(groupId) {
    const members = juveniles.filter(j => j.arrivalGroupId === groupId);
    const transit = members.filter(j => j.arrivalTransit && j.alive);
    const arrived = members.filter(j => j.arrivalCompleted);
    const intercepted = members.filter(j => j.arrivalIntercepted);
    const meanX = transit.length
      ? transit.reduce((sum, j) => sum + j.x, 0) / transit.length : null;
    const meanY = transit.length
      ? transit.reduce((sum, j) => sum + j.y, 0) / transit.length : null;
    const pathLength = transit.length
      ? transit.reduce((sum, j) => sum + (j.arrivalPathLength || 0), 0) / transit.length : 0;
    const traveled = transit.length
      ? transit.reduce((sum, j) => sum + (j.arrivalTraveled || 0), 0) / transit.length : pathLength;
    const remaining = transit.length
      ? Math.min(...transit.map(arrivalRemainingDistance)) : 0;
    const speed = transit.length
      ? transit.reduce((sum, j) => sum + (j.arrivalSpeed || MELOIDOGYNE_BASE_SPEED), 0) / transit.length
      : MELOIDOGYNE_BASE_SPEED;
    return {
      groupId,
      memberCount: members.length,
      transitCount: transit.length,
      arrivedCount: arrived.length,
      interceptedCount: intercepted.length,
      meanX, meanY, pathLength, traveled, remaining, speed,
      estimatedSecondsRemaining: remaining / Math.max(1e-6, speed),
      // Nunca 100% antes de alguem alcancar: enquanto houver J2 em transito, o
      // progresso e o do mais adiantado, e ele so chega a 1 quando chega mesmo.
      progress: transit.length
        ? clamp(Math.max(...transit.map(j => j.arrivalProgress || 0)), 0, .999)
        : (arrived.length ? 1 : 0),
    };
  }

  function updateEggs(dt) {
    for (const m of eggs) {
      m.age += dt; m.y = m.platform.y - 7; m.x = clamp(m.x, m.platform.x + 20, m.platform.x + m.platform.w - 20);
      const suppression = clamp(m.trichodermaSuppression || 0, 0, 1);
      if (m.neutralized) { m.eggs = 0; m.emptyAge += dt; continue; }
      if (m.eggs <= 0) { m.emptyAge += dt; continue; }
      m.hatch -= dt * (1 - suppression * .98);
      m.trichodermaSuppression = Math.max(0, suppression - dt * .18);
      m.trichodermaLysis = Math.max(0, (m.trichodermaLysis || 0) - dt * .06);
      if (m.hatch <= 0 && spawnJ2(m)) {
        m.eggs--; m.hatch = 1.45 + Math.random() * 2.4 + m.generation * .18;
        if (m.eggs === m.maxEggs - 1) announce('Eclosão de Meloidogyne: juvenis J2 móveis deixaram a massa de ovos e procuram uma raiz hospedeira.');
      } else if (m.hatch <= 0) m.hatch = 1;
    }
    for (let i = eggs.length - 1; i >= 0; i--) if (!eggs[i].eggs && eggs[i].emptyAge > 10 && eggs[i].sourceGallId) eggs.splice(i, 1);
  }

  function exudateAttraction(p) {
    let best = 0;
    for (const c of state.level.exudateClouds || []) {
      const q = pointOnRoot(p, c.x), range = Math.max(145, c.radius * 2.25);
      const d = Math.hypot(c.x - q.x, c.y - q.y);
      if (d < range) best = Math.max(best, (1 - d / range) * (.45 + .55 * clamp(c.life / Math.max(.1, c.maxLife || 10), 0, 1)));
    }
    return best;
  }
  function bacillusDefense(p, x) {
    let value = 0;
    for (const f of state.level.biofilms || []) {
      if (!f.functional || f.platform !== p) continue;
      const r = Math.max(16, f.radius || f.targetRadius || 0), d = Math.abs((f.x || 0) - x);
      if (d < r) value = Math.max(value, clamp(f.protectionStrength || 0, .25, 1) * (1 - d / r));
    }
    return value;
  }
  function occupancy(p) {
    return galls.filter(g => g.platform === p).length + juveniles.filter(j => j.alive && j.targetRoot === p && j.state !== 'seeking').length;
  }
  function chooseRoot(j) {
    let best = null, score = Infinity;
    for (const p of roots()) {
      prepareRoot(p);
      if (occupancy(p) >= 2) continue;
      const q = pointOnRoot(p, j.x), d = Math.hypot(q.x - j.x, q.y - j.y);
      if (d > 820) continue;
      const s = d / (.78 + exudateAttraction(p) * 1.55 + clamp(p.rootHealth ?? 1, .12, 1) * .28)
        + occupancy(p) * 105 + bacillusDefense(p, q.x) * 180;
      if (s < score) { score = s; best = { p, x: q.x }; }
    }
    if (best) { j.targetRoot = best.p; j.targetX = best.x; }
  }
  function steer(j, x, y, dt, speed) {
    const dx = x - j.x, dy = y - j.y, d = Math.max(1, Math.hypot(dx, dy));
    const wave = Math.sin(state.time * 6.5 + j.phase) * 12;
    const tx = dx / d * speed - dy / d * wave, ty = dy / d * speed + dx / d * wave * .55;
    const b = clamp(dt * 3.9, 0, 1);
    j.vx += (tx - j.vx) * b; j.vy += (ty - j.vy) * b; j.x += j.vx * dt; j.y += j.vy * dt;
    return d;
  }

  function seek(j, dt) {
    // Defesa: quem está em trânsito não passa por aqui. Se passasse, `seek`
    // sobrescreveria a posição do trajeto no mesmo quadro em que ele a calcula.
    if (j.arrivalTransit) return;
    j.retarget -= dt; j.cooldown = Math.max(0, j.cooldown - dt);
    if (!j.targetRoot || !roots().includes(j.targetRoot) || j.retarget <= 0) { chooseRoot(j); j.retarget = 1.2 + Math.random() * 1.1; }
    if (!j.targetRoot) { j.x += j.vx * dt; j.y += j.vy * dt; return; }
    const q = pointOnRoot(j.targetRoot, j.targetX); j.targetX = q.x;
    if (steer(j, q.x, q.y, dt, MELOIDOGYNE_BASE_SPEED + j.generation * 2.5) > 13 || j.cooldown > 0) return;
    if (occupancy(j.targetRoot) >= 2) { j.targetRoot = null; j.cooldown = 1.5; return; }
    const defense = bacillusDefense(j.targetRoot, q.x);
    if (defense > .58 && Math.random() < defense * .72) {
      j.vx *= -1.1; j.vy = -28 - defense * 24; j.cooldown = 3 + defense * 3; j.targetRoot = null;
      entities.burst(q.x, q.y, '#a8ffe6', 8, 62); return;
    }
    j.state = 'penetrating'; j.progress = 0; j.x = q.x; j.y = q.y;
    announce('Penetração radicular: um juvenil J2 iniciou a entrada. Biofilmes ativos podem reduzir esse sucesso.');
  }
  function penetrate(j, dt) {
    const p = j.targetRoot;
    if (!p) { j.state = 'seeking'; return; }
    j.progress = clamp(j.progress + dt * .19 * (1 - bacillusDefense(p, j.targetX) * .72), 0, 1);
    j.x = j.targetX + Math.sin(j.progress * Math.PI * 4 + j.phase) * 3;
    j.y = p.y + j.progress * Math.min(15, p.h * .22);
    if (j.progress < 1) return;
    j.state = 'migrating'; j.progress = 0;
    const dir = j.targetX < p.x + p.w / 2 ? 1 : -1;
    j.feedingX = clamp(j.targetX + dir * (26 + Math.random() * 34), p.x + 28, p.x + p.w - 28);
    announce('Migração interna: o J2 atravessa os tecidos em direção ao local de alimentação permanente.');
  }
  function addGall(j) {
    const p = j.targetRoot;
    if (!p || galls.length >= 8 || galls.filter(g => g.platform === p).length >= 2) { j.alive = false; return; }
    galls.push({
      id: `melo-gall-${gallId++}`, platform: p, x: j.feedingX, y: p.y + Math.min(22, p.h * .34),
      generation: j.generation, progress: .04, age: 0, stage: 'feeding-site', femaleMaturity: 0,
      eggTimer: 10 + Math.random() * 4, eggMassesLaid: 0, phase: Math.random() * TAU,
      permanentPenalty: 0, adultDrain: 0, adultAnnounced: false,
      senescence: 0, dead: false,
    });
    j.alive = false; entities.burst(j.feedingX, p.y + 4, '#ffb08f', 16, 78);
    announce('Sítio de alimentação: células gigantes começaram a sustentar a formação da galha.', 5.5);
  }
  function migrate(j, dt) {
    const p = j.targetRoot;
    if (!p) { j.state = 'seeking'; return; }
    j.progress = clamp(j.progress + dt * .17, 0, 1);
    j.x += (j.feedingX - j.x) * clamp(dt * 2.2, 0, 1);
    j.y = p.y + 10 + Math.sin(j.progress * Math.PI) * Math.min(26, p.h * .38);
    if (j.progress >= 1) addGall(j);
  }
  function updateJuveniles(dt) {
    for (const j of juveniles) {
      j.age += dt;
      if (!j.alive) continue;
      if (j.trichodermaCaught && j.state === 'seeking') {
        j.vx *= Math.pow(.02, dt);
        j.vy *= Math.pow(.02, dt);
        // Capturado a caminho: o trajeto acaba ali. Trichoderma pega J2 no solo,
        // e o solo é exatamente onde ele está. Interceptado NÃO é chegada — o
        // controlador conta grupos que alcançam a rizosfera, e este não alcançou.
        if (j.arrivalTransit) { j.arrivalTransit = false; j.arrivalIntercepted = true; }
        continue;
      }
      // Em trânsito, o trajeto manda — e só ele. Nada de `seek`, nada de
      // retarget, nada de penetração: o J2 ainda não chegou.
      if (j.arrivalTransit) { updateArrivalTransit(j, dt); continue; }
      if (j.age > 32 && j.state === 'seeking') j.alive = false;
      if (!j.alive) continue;
      if (j.state === 'seeking') seek(j, dt); else if (j.state === 'penetrating') penetrate(j, dt); else migrate(j, dt);
    }
    for (let i = juveniles.length - 1; i >= 0; i--) if (!juveniles[i].alive) juveniles.splice(i, 1);
  }

  // A femea nao drena para sempre: ela ovipoe, envelhece e morre. O que fica e a
  // sequela — a galha e a saude maxima perdida. A pressao do nematoide nao vem
  // de uma femea sangrando eternamente, vem da geracao seguinte.
  function stage(g) {
    if (g.dead) return 'residual-gall';
    if (g.senescence > 0) return 'senescent-female';
    if (g.progress < .2) return 'feeding-site';
    if (g.progress < .5) return 'young-gall';
    if (g.progress < .78) return 'mature-gall';
    if (g.progress < 1) return 'sedentary-female';
    return g.eggMassesLaid ? 'egg-laying-female' : 'adult-female';
  }
  function layEggs(g) {
    const config = settings();
    if (g.generation >= config.maxGenerations
      || g.eggMassesLaid
      || eggs.length >= config.maxSimultaneousEggMasses) return;
    const x = clamp(g.x + 22, g.platform.x + 20, g.platform.x + g.platform.w - 20);
    addEggMass(g.platform, x, g.generation + 1, g.id); g.eggMassesLaid = 1;
    entities.burst(x, g.platform.y - 6, '#ffe0a6', 18, 72);
    announce('Nova massa de ovos: a fêmea adulta completou o ciclo e iniciou outra geração.', 5.5);
  }
  function updateGalls(dt) {
    for (const g of galls) {
      g.age += dt; g.x = clamp(g.x, g.platform.x + 28, g.platform.x + g.platform.w - 28);
      g.y = g.platform.y + Math.min(22, g.platform.h * .34);
      if (g.progress < 1) g.progress = clamp(g.progress + dt * (.045 + (1 - clamp(g.platform.rootHealth ?? 1, .15, 1)) * .012), 0, 1);
      else if (!g.eggMassesLaid) {
        g.femaleMaturity = clamp(g.femaleMaturity + dt * .09, 0, 1);
        g.eggTimer -= dt;
        if (g.femaleMaturity >= .8 && g.eggTimer <= 0) layEggs(g);
      } else if (!g.dead) {
        // Depois de ovipor, a femea entra em senescencia: para de produzir e a
        // drenagem cai ate zero. Ela nao poe uma segunda massa.
        g.senescence = clamp(g.senescence + dt / Math.max(1, settings().senescenceSeconds), 0, 1);
        if (g.senescence >= 1) {
          g.dead = true;
          g.adultDrain = 0;
          announce('A fêmea morreu de velhice. A galha e a perda de saúde máxima permanecem: é sequela, não infecção ativa.', 6);
        }
      }
      g.stage = stage(g);
      g.permanentPenalty = g.progress >= .78 ? .12 + (g.eggMassesLaid ? .035 : 0) : g.progress >= .5 ? .065 : 0;
      // A drenagem e da femea viva. Morta, a galha continua sendo cicatriz — sem
      // dano ativo, mas tambem sem devolver a saude maxima perdida.
      const liveDrain = .085 + g.femaleMaturity * .035;
      g.adultDrain = g.dead ? 0
        : g.progress >= .78 ? liveDrain * (1 - g.senescence)
          : 0;
      if (g.progress >= .78 && !g.adultAnnounced) {
        g.adultAnnounced = true;
        announce('Fêmea adulta de Meloidogyne: protegida dentro da raiz, não pode ser atingida. O controle possível é sobre ovos e J2.', 6);
      }
    }
  }

  function standingOn(p) {
    const pl = state.player, x = pl.x + pl.w / 2, feet = pl.y + pl.h;
    return x >= p.x - 4 && x <= p.x + p.w + 4 && Math.abs(feet - p.y) < 18;
  }
  function updateRoots(dt) {
    const list = roots(); let pressure = 0;
    for (const p of list) {
      prepareRoot(p);
      const pg = galls.filter(g => g.platform === p);
      const invading = juveniles.filter(j => j.targetRoot === p && j.state !== 'seeking').length;
      const burden = pg.reduce((value, g) => value + .1 + g.progress * .18 + g.adultDrain + g.eggMassesLaid * .055, 0) + invading * .035;
      p.meloidogyneBurden = clamp(burden, 0, .95);
      p.meloidogyneStage = pg.length ? (pg.some(g => g.progress >= .78) ? 'fêmea adulta sedentária' : pg.some(g => g.progress >= .5) ? 'galha madura' : 'galha em formação') : invading ? 'penetração ativa' : 'saudável';
      pressure += burden;
    }

    rootGameplay.update(dt, galls);
    healthAverage = rootGameplay.averageHealth;
    infestation = list.length ? clamp(pressure / list.length, 0, 1) : 0;

    for (const p of list) {
      // DERIVADO, nao degradado. Com `Math.min(valor anterior, ...)` o campo so
      // podia cair: quando a Ralstonia recuava e `vascularEfficiency` voltava a
      // subir, carbono e nutricao ficavam presos no pior valor da partida.
      // Agora sao recalculados do zero a partir da saude e dos multiplicadores
      // publicados pelos patogenos, entao aliviar a pressao devolve funcao.
      p.carbonAvailability = clamp(
        p.rootHealth * (p.vascularEfficiency ?? 1) * (p.ralstoniaCarbonMultiplier ?? 1),
        .05, 1,
      );
      p.nutrientEfficiency = clamp(
        p.rootHealth * (p.mycorrhizaEfficiency ?? 1) * (p.ralstoniaNutrientMultiplier ?? 1),
        .04, 1,
      );
      if (standingOn(p) && p.rootHealth < .82) {
        const stress = 1 - p.rootHealth;
        state.player.hope = Math.max(0, state.player.hope - dt * stress * .16);
        state.player.soil = Math.max(0, state.player.soil - dt * stress * .065);
      }
    }
  }

  function update(dt) {
    if (state.gameState !== 'play') return;
    for (const p of roots()) prepareRoot(p);
    updateEggs(dt); updateJuveniles(dt); updateGalls(dt); updateRoots(dt);
  }

  function drawEgg(ctx, m) {
    const ratio = m.eggs / Math.max(1, m.maxEggs), empty = m.eggs <= 0;
    const neutralized = Boolean(m.neutralized);
    ctx.save(); ctx.translate(m.x, m.y); ctx.globalAlpha = empty ? clamp(1 - m.emptyAge / 11, 0, .55) : 1;
    ctx.fillStyle = neutralized ? 'rgba(94,181,116,.24)' : empty ? 'rgba(180,132,105,.22)' : 'rgba(255,213,155,.28)';
    ctx.strokeStyle = neutralized ? 'rgba(141,240,168,.82)' : empty ? 'rgba(199,157,128,.25)' : 'rgba(255,235,196,.82)';
    ctx.beginPath(); ctx.ellipse(0, -2, 16 + ratio * 6, 9 + ratio * 4, 0, 0, TAU); ctx.fill(); ctx.stroke();
    for (let i = 0; i < Math.max(2, m.eggs); i++) {
      const a = i / Math.max(2, m.eggs) * TAU + m.phase, r = 3 + i % 3 * 3;
      ctx.fillStyle = neutralized ? '#9dd7a8' : i % 2 ? '#fff0cf' : '#ffd7a0'; ctx.beginPath(); ctx.ellipse(Math.cos(a) * r, -2 + Math.sin(a) * r * .48, 2.7, 1.9, a, 0, TAU); ctx.fill();
    }
    ctx.font = '700 8px Inter,system-ui'; ctx.textAlign = 'center';
    // "massa neutralizada" e confirmacao de uma acao que o jogador acabou de
    // fazer, e fica. A CONTAGEM de ovos e numero de infestacao, e o desenho da
    // massa ja mostra quantos ovos restam pelo tamanho e pela quantidade de
    // pontos — o numero por cima disso e a mesma informacao duas vezes.
    if (neutralized) { ctx.fillStyle = '#baffc7'; ctx.fillText('massa neutralizada', 0, -17); }
    else if (!empty && state.level?.traversalDebugVisible) {
      ctx.fillStyle = '#fff0cf'; ctx.fillText(`ovos ${m.eggs}`, 0, -17);
    }
    ctx.restore();
  }
  function drawJ2(ctx, j) {
    const caught = Boolean(j.trichodermaCaught);
    const embedded = j.state !== 'seeking', a = Math.atan2(j.vy || 0, j.vx || 1);
    const length = embedded ? 34 : 42;
    if (organismSprites.draw(ctx, 'nematoide', {
      x: j.x,
      y: j.y,
      height: embedded ? 45 : 62,
      time: state.time,
      phase: j.phase,
      alpha: caught ? .52 : 1,
      flipX: (j.vx || 1) < 0,
    })) {
      ctx.save();
      ctx.font = '700 7px Inter,system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = caught ? '#baffc7' : '#fff1d5';
      ctx.fillText(embedded ? 'J2 interno' : 'J2', j.x, j.y - (embedded ? 25 : 34));
      ctx.restore();
      return;
    }
    ctx.save(); ctx.translate(j.x, j.y); ctx.rotate(a);
    ctx.shadowBlur = caught ? 10 : embedded ? 7 : 5;
    ctx.shadowColor = caught ? '#8df0a8' : embedded ? '#ff9f8f' : '#fff0cf';
    ctx.strokeStyle = caught ? '#8df0a8' : embedded ? '#ffa197' : '#fff1d5';
    ctx.lineWidth = caught ? 3 : embedded ? 2.8 : 2.35;
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, x = (t - .5) * length;
      const y = Math.sin(t * Math.PI * 3 + state.time * 7 + j.phase) * (embedded ? 1.7 : caught ? .8 : 3.2);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = caught ? '#d6ff94' : '#ffcab8'; ctx.beginPath(); ctx.arc(length / 2, 0, 2.6, 0, TAU); ctx.fill();
    ctx.font = '700 7px Inter,system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = caught ? '#baffc7' : '#fff1d5';
    ctx.fillText(embedded ? 'J2 interno' : 'J2', 0, -9);
    ctx.restore();
  }
  function drawAdultFemale(ctx, g, p) {
    if (p < .72) return;
    const maturity = clamp((p - .72) / .28 + g.femaleMaturity * .25, 0, 1.2);
    const bodyW = 9 + maturity * 12;
    const bodyH = 12 + maturity * 19;
    ctx.save();
    ctx.translate(0, 5 + Math.min(8, g.platform.h * .12));
    const gradient = ctx.createRadialGradient(-bodyW * .25, -bodyH * .2, 2, 0, 0, bodyH);
    gradient.addColorStop(0, '#fff8e8');
    gradient.addColorStop(.5, '#f4d7c4');
    gradient.addColorStop(1, '#c77d73');
    ctx.fillStyle = gradient;
    ctx.strokeStyle = '#fff1de';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(0, -bodyH * .58);
    ctx.bezierCurveTo(bodyW * .75, -bodyH * .45, bodyW, bodyH * .22, bodyW * .28, bodyH * .62);
    ctx.bezierCurveTo(0, bodyH * .78, -bodyW * .72, bodyH * .56, -bodyW * .82, 0);
    ctx.bezierCurveTo(-bodyW * .72, -bodyH * .38, -bodyW * .3, -bodyH * .55, 0, -bodyH * .58);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8f4f55'; ctx.beginPath(); ctx.arc(0, -bodyH * .54, 2.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(177,94,91,.42)'; ctx.lineWidth = .8;
    for (let i = 0; i < 4; i++) {
      const yy = -bodyH * .25 + i * bodyH * .19;
      ctx.beginPath(); ctx.moveTo(-bodyW * .45, yy); ctx.quadraticCurveTo(0, yy + 3, bodyW * .5, yy - 1); ctx.stroke();
    }
    ctx.restore();
  }
  function drawGall(ctx, g) {
    const p = clamp(g.progress, 0, 1), w = 11 + p * 25, h = 8 + p * 17;
    ctx.save(); ctx.translate(g.x, g.platform.y + 2);
    const gradient = ctx.createRadialGradient(0, 3, 2, 0, 5, w);
    gradient.addColorStop(0, p > .75 ? '#ff9784' : '#e2a670'); gradient.addColorStop(.7, '#9d5b44'); gradient.addColorStop(1, 'rgba(92,49,43,.08)');
    ctx.fillStyle = gradient; ctx.strokeStyle = '#ffcd9f'; ctx.beginPath(); ctx.ellipse(0, 5, w, h, 0, 0, TAU); ctx.fill(); ctx.stroke();
    drawAdultFemale(ctx, g, p);
    const labels = { 'feeding-site': 'células gigantes', 'young-gall': 'galha jovem', 'mature-gall': 'galha madura', 'sedentary-female': 'fêmea sedentária', 'adult-female': 'fêmea adulta', 'egg-laying-female': 'fêmea + oviposição' };
    ctx.font = p >= .78 ? '700 9px Inter,system-ui' : '700 8px Inter,system-ui'; ctx.textAlign = 'center';
    ctx.fillStyle = p >= .78 ? '#fff0df' : '#ffd0b0'; ctx.fillText(labels[g.stage] || 'galha', 0, -h - 8);
    // O rotulo do estagio fica: ele diz O QUE e aquilo, e nao existe em lugar
    // nenhum alem do mundo. A porcentagem de saude maxima perdida sai — e um
    // numero de infeccao, e o painel contextual ja publica a saude da raiz.
    if (p >= .5 && state.level?.traversalDebugVisible) {
      ctx.fillStyle = '#ff9f8f';
      ctx.fillText(`−${Math.round((g.permanentPenalty || 0) * 100)}% saúde máxima`, 0, -h - 19);
    }
    ctx.restore();
  }
  function render(ctx) {
    ctx.save(); ctx.translate(-state.cameraX, 0);
      // Health bars removed per user request
    for (const g of galls) if (g.x > state.cameraX - 100 && g.x < state.cameraX + W + 100) drawGall(ctx, g);
    for (const m of eggs) if (m.x > state.cameraX - 80 && m.x < state.cameraX + W + 80) drawEgg(ctx, m);
    for (const j of juveniles) if (j.x > state.cameraX - 100 && j.x < state.cameraX + W + 100) drawJ2(ctx, j);
    ctx.restore();
  }

  return {
    get eggMassCount() { return eggs.filter(m => m.eggs > 0).length; },
    get eggCount() { return eggs.reduce((s, m) => s + m.eggs, 0); },
    get juvenileCount() { return juveniles.filter(j => j.state === 'seeking').length; },
    get arrivalTransitCount() { return juveniles.filter(j => j.arrivalTransit).length; },
    arrivalGroupSnapshot,
    releaseArrivalGroup,
    removeArrivalGroup,
    get penetratingCount() { return juveniles.filter(j => j.state !== 'seeking').length; },
    get gallCount() { return galls.length; },
    get matureGallCount() { return galls.filter(g => g.progress >= .5).length; },
    get femaleCount() { return galls.filter(g => g.progress >= .78).length; },
    get adultFemaleCount() { return galls.filter(g => g.progress >= 1).length; },
    get rootHealthAverage() { return healthAverage; },
    get infestationPercent() { return infestation * 100; },
    get healthyRootCount() { return rootGameplay.healthyCount; },
    get stressedRootCount() { return rootGameplay.stressedCount; },
    get compromisedRootCount() { return rootGameplay.compromisedCount; },
    get collapsedRootCount() { return rootGameplay.collapseCount; },
    introduceJ2Arrival,
    get eggMasses() { return eggs; }, get juveniles() { return juveniles; }, get galls() { return galls; },
    clear, reset, update, render,
  };
}
