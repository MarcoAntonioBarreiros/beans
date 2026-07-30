import { getPhaseManifest } from './campaign-manifest.js';
import { validateChunk } from './agents.js';
import { getPrimaryTraversalPlatforms } from './traversal-route.js';

// Primitivas reais usadas na validacao por fisica. A prova de Azospirillum e uma
// fase de salto simples + salto duplo (sem dash), entao esse e o repertorio que
// precisa FALHAR sem a escada e PASSAR com ela.
const SINGLE_JUMP = Object.freeze({ id: 'running-jump', requires: [] });
const DOUBLE_JUMP = Object.freeze({ id: 'running-double-jump-late', requires: ['doubleJump'] });
const GROUND_PRIMITIVES = Object.freeze([SINGLE_JUMP, DOUBLE_JUMP]);

// Topo permitido para nao empurrar o alvo para fora da tela ao eleva-lo. A prova
// vertical precisa de folga para superar o salto duplo (180px), entao o teto
// sobe um pouco mais que o das plataformas comuns.
const HIGHEST_Y = 60;
// Alcance da raiz lateral (degrau superior = plataforma de lancamento). O menor
// e ~1 salto simples; o maior cobre alem do salto duplo. requiredReach e
// procurado dentro dessa faixa pela fisica.
const MIN_LADDER_REACH = 96;
const MAX_LADDER_REACH = 340;

// Estimar pelo numero do vao nao basta: uma queda de poucos pixels alonga o
// salto e devolve a travessia ao alcance do salto duplo. Quem decide e a fisica.
function defeatsDoubleJump(previous, target) {
  return !validateChunk(previous, target, DOUBLE_JUMP, 'normal');
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// O gerador limita a subida de qualquer travessia a 112px, e o salto duplo
// alcanca 180px. Ou seja: nenhuma subida procedural jamais exige a escada de
// Azospirillum, em nenhuma seed e em nenhum tamanho de fase. O mesmo vale para a
// ponte micorrizica no eixo horizontal. A mecanica-tema da fase existia,
// funcionava, e nunca era necessaria.
//
// Este passo cria a necessidade: depois da rota pronta, eleva (ou afasta) um
// destino ate a faixa em que so a mecanica da fase resolve. O valor vem do
// manifesto, entao cada fase declara o proprio desafio e fases curtas demais
// simplesmente nao recebem nenhum.

function routePlatforms(level) {
  return getPrimaryTraversalPlatforms(level)
    .filter(platform => !platform.encounterInstanceId && !platform.reservedByTraversalEncounter);
}

function shiftFrom(level, fromX, deltaY, deltaX = 0) {
  if (!deltaY && !deltaX) return;
  // A geometria macro pertence ao desafio. Elementos apoiados nas plataformas
  // sao sincronizados uma unica vez ao final do pipeline por seu vinculo
  // explicito/logicIndex; move-los aqui por faixa de x criava deslocamentos
  // duplos e falhava quando o sprite estava fora da largura atual do bloco.
  for (const platform of level.platforms || []) {
    if (!Number.isFinite(platform.x) || platform.x < fromX) continue;
    if (deltaY && Number.isFinite(platform.y)) {
      platform.y += deltaY;
      if (Number.isFinite(platform.rootBaseY)) platform.rootBaseY += deltaY;
    }
    if (deltaX) platform.x += deltaX;
  }

  // As raizes de fundo nao carregam logicIndex. Elas pertencem ao trecho por
  // coordenada e precisam acompanhar a transformacao para nao ficarem
  // suspensas na posicao anterior.
  for (const root of level.roots || []) {
    if (!Number.isFinite(root.x) || root.x < fromX) continue;
    if (deltaY && Number.isFinite(root.y)) root.y += deltaY;
    if (deltaX) root.x += deltaX;
  }
  if (deltaX) {
    if (Number.isFinite(level.endX)) level.endX += deltaX;
    if (Number.isFinite(level.cameraMaxX)) level.cameraMaxX += deltaX;
  }
}

// --- Validacao de subrota (grafo + busca em largura) -----------------------
//
// O par "logicIndex-1 -> alvo" nao basta: o bloco imediatamente anterior pode
// ser SOLO, e Azospirillum so inocula em RAIZ. A travessia real e uma subrota
// (hospedeiro -> [solo...] -> alvo) e precisa ser validada como um grafo, com
// arestas decididas pela fisica, nao por consecutividade de logicIndex.

function reachableEdge(from, to, primitives) {
  if (!from || !to || from === to) return false;
  // validateChunk lanca do lado direito de `from` para a direita: um destino
  // inteiramente atras nunca e alcancado por essa simulacao.
  if (to.x + to.w <= from.x + 4) return false;
  return primitives.some(primitive => validateChunk(from, to, primitive, 'normal'));
}

// Monta um pequeno grafo (cada plataforma um no; aresta = uma primitiva real
// sai de uma e pousa na outra) e faz busca em largura do inicio ao alvo. Nos
// nao precisam ser consecutivos por logicIndex.
export function canTraverseSubroute({
  startPlatform,
  targetPlatform,
  platforms = [],
  additionalPlatforms = [],
  primitives = GROUND_PRIMITIVES,
} = {}) {
  if (!startPlatform || !targetPlatform) return false;
  const nodes = [...new Set([...platforms, ...additionalPlatforms, startPlatform, targetPlatform])]
    .filter(Boolean);
  const visited = new Set([startPlatform]);
  const queue = [startPlatform];
  while (queue.length) {
    const current = queue.shift();
    if (current === targetPlatform) return true;
    for (const next of nodes) {
      if (visited.has(next)) continue;
      if (!reachableEdge(current, next, primitives)) continue;
      if (next === targetPlatform) return true;
      visited.add(next);
      queue.push(next);
    }
  }
  return false;
}

// Degrau superior da raiz lateral: plataforma de lancamento diretamente acima do
// hospedeiro. A raiz nao precisa tocar o alvo; ela ergue Miguelito ate aqui.
function launchPlatform(host, reach) {
  const width = 90;
  const centerX = host.x + host.w / 2;
  return {
    x: centerX - width / 2,
    y: host.y - reach,
    w: width,
    h: 12,
    type: 'root',
    oneWay: true,
  };
}

// Procura o MENOR alcance que torna a prova solucionavel: do degrau superior, um
// salto duplo pousa no alvo. Subir mais so facilita, entao a busca ascendente
// para no primeiro alcance validado. Retorna null quando nem o alcance maximo
// resolve (alvo alto/distante demais para a escada + salto duplo).
function solveRequiredReach(host, target, config) {
  const min = clamp(config.minimumReach || MIN_LADDER_REACH, 40, MAX_LADDER_REACH);
  const max = clamp(config.maximumReach || MAX_LADDER_REACH, min, MAX_LADDER_REACH);
  for (let reach = min; reach <= max; reach += 8) {
    if (host.y - reach < HIGHEST_Y - 20) break;
    const launch = launchPlatform(host, reach);
    if (validateChunk(launch, target, DOUBLE_JUMP, 'normal')) return reach;
  }
  return null;
}

// Hospedeiro = ULTIMA plataforma de raiz anterior ao alvo, mesmo com blocos de
// solo entre os dois. Azospirillum so inocula em raiz.
export function findRootHost(route, target) {
  const before = route
    .filter(platform => platform.logicIndex < target.logicIndex)
    .sort((a, b) => b.logicIndex - a.logicIndex);
  for (const platform of before) {
    if (platform.type !== 'root') continue;
    if (platform.recovery || platform.final) continue;
    if (platform.azospirillumStructure || platform.mycorrhizaStructure) continue;
    if (platform.azospirillumLadderStep || platform.mycorrhizaIntroDestination) continue;
    const dx = target.x - (platform.x + platform.w);
    if (dx < -60) continue;      // o alvo precisa estar a frente do hospedeiro
    if (dx > 620) continue;      // longe demais para o lancamento vertical alcancar
    return platform;
  }
  return null;
}

function corridorPlatforms(route, host, target) {
  return route.filter(platform => (
    platform.logicIndex >= host.logicIndex && platform.logicIndex <= target.logicIndex
  ));
}

function candidateWindow(level, config, totalChunks, manifest) {
  // A janela acompanha o tamanho da fase: um fromChunk fixo em 9 nao sobra
  // candidato nenhum quando a fase e encurtada para 12 chunks.
  // O inicio da janela acompanha a estreia da mecanica quando o manifesto a
  // aponta: um fromChunk fixo nao sobrevive ao reescalonamento da fase.
  const debut = config.afterPresentation
    ? manifest?.presentations?.find(item => item.id === config.afterPresentation)
    : null;
  const declared = Number.isInteger(debut?.debutChunk)
    ? debut.debutChunk + 1
    : Number.isInteger(config.fromChunk) ? config.fromChunk : 0;
  const from = Math.min(declared, Math.floor(totalChunks * .4));

  // Um poder adquirido depois pode tornar o desafio trivial — o dash vence o
  // vao que so a ponte deveria vencer. Quando o manifesto aponta esse poder, a
  // janela termina antes dele, e acompanha o reescalonamento da fase.
  const blocking = config.beforeUnlock
    ? manifest?.unlockEvents?.find(event => event.feature === config.beforeUnlock)
    : null;
  const ceiling = Number.isInteger(blocking?.eventChunk)
    ? blocking.eventChunk - 1
    : totalChunks - 1;
  const to = Math.min(
    Number.isInteger(config.toChunk) ? config.toChunk : totalChunks - 1,
    ceiling,
  );
  return routePlatforms(level).filter(platform => (
    platform.logicIndex > from
    && platform.logicIndex <= to
    && platform.w >= (config.minimumWidth || 130)
    && !platform.mycorrhizaIntroDestination
    && !platform.fixedObjective
    && !platform.authoredPhaseFive
  ));
}

// Janela da prova combinada obrigatoria: derivada do SEGMENTO (p3-challenge) e
// do desbloqueio do salto duplo (afterUnlock), nunca de um fromChunk fixo. A
// demonstracao inicial de Azospirillum fica antes disso e nao entra aqui.
//
// A janela precisa sobreviver ao reescalonamento da fase (Phase Lab): em fases
// curtas o segmento encolhe, entao a busca cai para larguras menores antes de
// desistir. O piso — depois do desbloqueio do salto duplo — nunca e relaxado: e
// a ordem pedagogica (Azo -> salto duplo -> prova combinada).
function verticalCandidates(level, config, totalChunks, manifest) {
  const segment = config.segmentId
    ? (manifest?.segments || []).find(item => item.id === config.segmentId)
    : null;
  let from = Number.isInteger(segment?.from)
    ? segment.from
    : Number.isInteger(config.fromChunk) ? config.fromChunk : Math.floor(totalChunks * .6);
  if (config.afterUnlock) {
    const unlock = (manifest?.unlockEvents || []).find(event => event.feature === config.afterUnlock);
    if (Number.isInteger(unlock?.eventChunk)) from = Math.max(from, unlock.eventChunk + 1);
  }
  from = Math.min(from, Math.max(0, totalChunks - 2));
  const to = totalChunks - 1;
  const pick = minimumWidth => routePlatforms(level).filter(platform => (
    platform.logicIndex >= from
    && platform.logicIndex <= to
    && platform.w >= minimumWidth
    && !platform.mycorrhizaIntroDestination
    && !platform.fixedObjective
    && !platform.authoredPhaseFive
  ));
  for (const width of [config.minimumWidth || 130, 118, 104]) {
    const found = pick(width);
    if (found.length) return found;
  }
  return [];
}

export function applySignatureChallenge(level, phase) {
  const manifest = getPhaseManifest(phase);
  const config = manifest?.signatureChallenge;
  if (!config?.enabled) return null;

  const totalChunks = manifest.totalChunks || level.debugInfo?.length || 0;
  // Fase curta demais nao comporta o desafio sem atropelar a apresentacao.
  if (totalChunks < (config.minimumChunks || 8)) return null;

  const horizontal = config.kind === 'gap';
  if (!horizontal) return applyVerticalLaunchChallenge(level, config, manifest, totalChunks);

  const candidates = candidateWindow(level, config, totalChunks, manifest);
  if (candidates.length < 2) return null;

  const route = routePlatforms(level);
  // Prefere o meio da janela — cedo demais atropela a estreia, tarde demais o
  // jogador ja passou pela pratica sem precisar da mecanica — mas percorre os
  // vizinhos quando o alvo escolhido nao comporta a mudanca.
  const middle = Math.floor(candidates.length / 2);
  const ordered = [...candidates].sort((a, b) => (
    Math.abs(candidates.indexOf(a) - middle) - Math.abs(candidates.indexOf(b) - middle)
  ));

  for (const target of ordered) {
    const previous = route.find(platform => platform.logicIndex === target.logicIndex - 1);
    if (!previous) continue;

    // A ponte micorrizica so vale entre 325 e 340px: abaixo o salto duplo
    // vence, acima a propria ponte nao alcanca. E o dash passa nessa faixa,
    // por isso o desafio precisa ficar antes do desbloqueio dele.
    // A ponte e horizontal, e uma queda ate o destino alonga o salto. O
    // desnivel precisa ser quase nulo para o vao valer o que promete.
    if (Math.abs(target.y - previous.y) > 22) continue;

    const currentGap = target.x - (previous.x + previous.w);
    const desired = clamp(Number(config.gap) || 330, 300, 340);
    let applied = 0;
    let venceu = false;
    // Sobe o vao dentro do alcance da ponte ate a fisica confirmar que o salto
    // duplo nao vence. Acima de 340px a propria ponte deixa de alcancar.
    for (const alvo of [desired, 335, 340]) {
      if (alvo <= currentGap + applied) continue;
      const passo = alvo - (currentGap + applied);
      shiftFrom(level, target.x, 0, passo);
      applied += passo;
      if (defeatsDoubleJump(previous, target)) { venceu = true; break; }
    }
    if (venceu) return record(level, config, target, previous, false);
    // Nao deu: devolve a geometria e tenta o proximo candidato.
    if (applied) shiftFrom(level, target.x, 0, -applied);
    continue;
  }
  return null;
}

// Prova combinada OBRIGATORIA de Azospirillum: escolhe alvo na janela correta,
// caminha para tras ate a ultima raiz (o hospedeiro), eleva o alvo ate ficar
// intransponivel sem escada e valida — com uma escada virtual — que a escada
// mais o salto duplo resolvem. Registra host/alvo/corredor/requiredReach.
function applyVerticalLaunchChallenge(level, config, manifest, totalChunks) {
  const candidates = verticalCandidates(level, config, totalChunks, manifest);
  if (!candidates.length) return null;

  const route = routePlatforms(level);
  const preferred = clamp(config.preferredRise || 230, 120, config.maximumRise || 260);
  // O salto duplo alcanca ~180px na vertical. Para a prova valer, o alvo precisa
  // subir alem disso. O piso de VIABILIDADE (abaixo do qual o candidato e
  // descartado por falta de folga na tela) fica logo acima do salto duplo; a
  // subida ALVO continua sendo o preferido, so limitado pela folga real da seed.
  // A propria fisica (canTraverseSubroute) e a palavra final sobre ser vencivel
  // ou nao — subidas marginais que ainda se vencem sao rejeitadas e o proximo
  // candidato e tentado.
  const feasibilityFloor = Math.min(clamp(config.minimumRise || 200, 120, preferred), 184);

  const middle = Math.floor(candidates.length / 2);
  const ordered = [...candidates].sort((a, b) => (
    Math.abs(candidates.indexOf(a) - middle) - Math.abs(candidates.indexOf(b) - middle)
  ));

  for (const target of ordered) {
    const host = findRootHost(route, target);
    if (!host) continue;
    const corridor = corridorPlatforms(route, host, target);
    const testNodes = corridor.filter(platform => !platform.recovery);

    // Quanto o alvo pode subir sem sair da tela decide o teto real desta seed.
    const maxFeasibleRise = host.y - HIGHEST_Y;
    const maxRise = Math.min(clamp(config.maximumRise || 260, preferred, 320), maxFeasibleRise);
    if (maxRise < feasibilityFloor) continue; // sem folga para uma prova significativa

    let applied = 0;
    const raiseTo = wantedRise => {
      const currentRise = host.y - target.y;
      if (wantedRise <= currentRise) return true;
      const delta = -(wantedRise - currentRise);
      if (target.y + delta < HIGHEST_Y) return false;
      shiftFrom(level, target.x, delta);
      applied += delta;
      return true;
    };

    // Sobe ate o alvo preferido (limitado pela folga da tela) e so escala mais se
    // a fisica ainda deixar vencer sem escada. Nunca eleva alem do necessario.
    if (!raiseTo(Math.min(preferred, maxRise))) {
      if (applied) shiftFrom(level, target.x, -applied);
      continue;
    }

    let accepted = false;
    for (;;) {
      const reachableWithoutLadder = canTraverseSubroute({
        startPlatform: host,
        targetPlatform: target,
        platforms: testNodes,
        primitives: GROUND_PRIMITIVES,
      });
      if (!reachableWithoutLadder) {
        const requiredReach = solveRequiredReach(host, target, config);
        if (requiredReach != null) {
          recordVerticalLaunch(level, config, host, target, corridor, requiredReach, applied);
          accepted = true;
        }
        break;
      }
      // Ainda vencivel so com salto: sobe mais o alvo (e o sufixo) ate o teto.
      const currentRise = host.y - target.y;
      if (currentRise >= maxRise) break;
      if (!raiseTo(Math.min(maxRise, currentRise + 12))) break;
    }

    if (accepted) return level.signatureChallenge;
    if (applied) shiftFrom(level, target.x, -applied);
  }
  return null;
}

// O gerador espalha plataformas de recuperacao dentro dos vaos comuns, para
// perdoar um pulo errado. Num vao criado de proposito para exigir a mecanica da
// fase, essa gentileza desmonta o desafio: uma plataformazinha de 82px no meio
// transforma o vao de 330px em dois pulinhos que o salto duplo vence sem
// pensar. Era o caso em 12 de 12 seeds da fase 4 — o jogador atravessava a fase
// inteira sem nunca precisar da ponte, e por isso a prova final nunca
// registrava.
//
// A validacao por fisica nao pegava isso porque validateChunk monta um nivel com
// apenas as duas plataformas da travessia: o vao era medido isolado, sem o que
// havia no meio dele.
function clearRecoveryInside(level, fromX, toX) {
  let removed = 0;
  level.platforms = (level.platforms || []).filter(platform => {
    if (!platform.recovery) return true;
    const center = platform.x + platform.w / 2;
    if (center <= fromX || center >= toX) return true;
    removed++;
    return false;
  });
  return removed;
}

function record(level, config, target, previous, alreadyPresent) {
  clearRecoveryInside(level, previous.x + previous.w, target.x);
  target.signatureChallenge = config.mechanic || true;
  level.signatureChallenge = {
    mechanic: config.mechanic || null,
    kind: config.kind || 'rise',
    chunk: target.logicIndex,
    rise: Math.round(previous.y - target.y),
    gap: Math.round(target.x - (previous.x + previous.w)),
    alreadyPresent,
  };
  return level.signatureChallenge;
}

function recordVerticalLaunch(level, config, host, target, corridor, requiredReach, appliedDelta) {
  // Limpa recuperacao em TODO o corredor (host -> alvo), nao so no par
  // imediatamente anterior: um degrau de seguranca no meio criaria bypass.
  clearRecoveryInside(level, host.x + host.w, target.x);

  host.azospirillumLadderHost = true;
  host.mandatoryAzospirillumHost = true;
  host.wasRecoveryRoot = Boolean(host.recovery);
  host.recovery = false;
  target.signatureChallenge = config.mechanic || true;
  target.azospirillumLadderDestination = true;
  target.mandatoryAzospirillumTarget = true;

  const intervening = corridor.filter(platform => platform !== host && platform !== target);
  const interveningSoil = intervening.filter(platform => platform.type === 'soil');

  level.azospirillumChallenge = {
    id: `azo-challenge-${host.logicIndex}-${target.logicIndex}`,
    hostLogicIndex: host.logicIndex,
    targetLogicIndex: target.logicIndex,
    corridorStartLogicIndex: host.logicIndex,
    corridorEndLogicIndex: target.logicIndex,
    hostPlatform: host,
    targetPlatform: target,
    requiredReach,
    interveningCount: intervening.length,
    interveningSoilCount: interveningSoil.length,
    rise: Math.round(host.y - target.y),
    developed: false,
    traversed: false,
    mandatory: true,
  };

  level.signatureChallenge = {
    mechanic: config.mechanic || null,
    kind: config.kind || 'vertical-launch',
    chunk: target.logicIndex,
    hostChunk: host.logicIndex,
    rise: Math.round(host.y - target.y),
    requiredReach,
    interveningSoilCount: interveningSoil.length,
    alreadyPresent: appliedDelta === 0,
  };
  return level.signatureChallenge;
}
