import { canTraverseEdge, edgeMeasurements } from './traversal-edge-physics.js';
import { executablePrimitives } from './generator.js';

// INVARIANTE: UM PORTÃO DE AZOSPIRILLUM = UMA ESCADA VÁLIDA
// =========================================================
//
// O portão de subida é geometria AUTORAL: `generateLevel` coloca o degrau 240 a
// 330px acima do hospedeiro porque a rota pediu essa altura, e só a raiz lateral
// de Azospirillum a vence. A auditoria então classifica o par como travessia
// intencional — não como falha — apoiada apenas nos metadados:
//
//     next.ascentGate && previous.ascentGateHost && mesmo ascentGateId
//
// Só que o pedido de escada correspondente podia ser DESCARTADO EM SILÊNCIO.
// Em `generateAzospirillumRootLadders` havia um `continue` seco:
//
//     if (!host || !destination || host.type !== 'root'
//         || destination.y >= host.y - 60) continue;
//
// Basta uma etapa posterior converter o hospedeiro em solo, ou mover o destino,
// para o pedido evaporar. O resultado é o pior arranjo possível: o portão
// continua na geometria, a escada não existe, e a auditoria jura que está tudo
// bem porque os metadados batem. Softlock silencioso, com atestado de saúde.
//
// Aqui a invariante passa a ser verificada e, quando quebrada, consertada. Duas
// saídas e só duas:
//
//   A. existe escada válida para aquele `ascentGateId`; ou
//   B. o portão é desfeito e o degrau vira travessia ordinária, validada pela
//      física de verdade.
//
// Nunca "portão presente, escada ausente, auditoria satisfeita".

// Espaçamento que um salto simples cobre com folga. É o mesmo alvo que
// `RUNTIME_TARGET_STEP_SPACING` persegue ao dimensionar a escada; aqui ele é o
// teto aceito na verificação, não um segundo parâmetro de projeto.
export const MAXIMUM_STEP_SPACING = 96;
// Altura que o jogador ainda vence a partir do último degrau, com salto duplo.
export const TOP_STEP_TO_DESTINATION = 190;

function platformId(platform) {
  return platform?.platformId ?? platform?.id ?? null;
}

// O empacotador do repositório só reconhece `export function` / `export const`
// no início da linha — nada de `export { x as y }` no fim do arquivo.
export function azospirillumGatePairs(level) {
  return gatePairs(level);
}

function gatePairs(level) {
  const platforms = level?.platforms || [];
  const pairs = [];
  for (const destination of platforms) {
    if (!destination.ascentGate || !destination.ascentGateId) continue;
    const host = platforms.find(candidate => (
      candidate.ascentGateHost && candidate.ascentGateId === destination.ascentGateId
    )) || null;
    pairs.push({ gateId: destination.ascentGateId, host, destination });
  }
  return pairs;
}

function ladderFor(level, gateId) {
  return (level?.azospirillumRootLadders || [])
    .find(ladder => ladder.ascentGateId === gateId) || null;
}

/**
 * Verifica um portão. Somente leitura — devolve o motivo da falha, não conserta.
 *
 * A ordem das checagens vai do barato ao caro e do estrutural ao geométrico, e
 * cada `reason` nomeia exatamente o que quebrou: numa auditoria de 50 seeds, o
 * agregado por motivo é o que diz qual gerador consertar.
 */
export function inspectAzospirillumGate(level, pair) {
  const { gateId, host, destination } = pair;
  if (!host) return { gateId, ok: false, reason: 'host-ausente' };
  if (!destination) return { gateId, ok: false, reason: 'destino-ausente' };
  if (host.type !== 'root') return { gateId, ok: false, reason: 'host-nao-e-raiz' };
  if (destination.y >= host.y - 60) return { gateId, ok: false, reason: 'destino-nao-esta-acima' };

  const ladder = ladderFor(level, gateId);
  if (!ladder) return { gateId, ok: false, reason: 'sem-escada' };
  if (ladder.host !== host) return { gateId, ok: false, reason: 'escada-em-outro-host' };
  if (ladder.destination !== destination) {
    return { gateId, ok: false, reason: 'escada-para-outro-destino' };
  }

  const steps = [...(ladder.steps || [])].sort((left, right) => right.y - left.y);
  if (!steps.length) return { gateId, ok: false, reason: 'escada-sem-degraus' };

  // Subida monotônica: cada degrau acima do anterior. Um degrau fora de ordem
  // não é uma escada, é uma pilha.
  for (let index = 1; index < steps.length; index++) {
    if (steps[index].y >= steps[index - 1].y) {
      return { gateId, ok: false, reason: 'degraus-nao-monotonicos' };
    }
  }

  // Vãos verticais: raiz→primeiro degrau, entre degraus, e último degrau→destino.
  const hostTop = host.y - 6;
  const spacings = [hostTop - steps[0].y];
  for (let index = 1; index < steps.length; index++) {
    spacings.push(steps[index - 1].y - steps[index].y);
  }
  const worst = Math.max(...spacings);
  if (worst > MAXIMUM_STEP_SPACING) {
    return { gateId, ok: false, reason: 'espacamento-alto-demais', spacing: Math.round(worst) };
  }

  const finalRise = steps[steps.length - 1].y - destination.y;
  if (finalRise > TOP_STEP_TO_DESTINATION) {
    return {
      gateId, ok: false, reason: 'ultimo-degrau-longe-do-destino',
      rise: Math.round(finalRise),
    };
  }

  // Cobertura: a escada tem de vencer o desnível pedido, não uma fração dele.
  const covered = hostTop - steps[steps.length - 1].y;
  const required = host.y - destination.y - TOP_STEP_TO_DESTINATION;
  if (covered < required) {
    return {
      gateId, ok: false, reason: 'escada-curta',
      covered: Math.round(covered), required: Math.round(required),
    };
  }

  return { gateId, ok: true, reason: null, ladderId: ladder.id };
}

/** Auditoria somente leitura de todos os portões de subida do nível. */
export function auditAzospirillumGates(level) {
  const results = gatePairs(level).map(pair => inspectAzospirillumGate(level, pair));
  return {
    total: results.length,
    withLadder: results.filter(entry => entry.ok).length,
    withoutLadder: results.filter(entry => !entry.ok).length,
    results,
  };
}

/**
 * Converte um portão em travessia ordinária.
 *
 * Último recurso, e é uma degradação HONESTA: o desafio some, mas a rota
 * continua atravessável. Melhor perder um portão numa seed do que entregar uma
 * fase onde o jogador chega ao degrau e não tem como subir.
 *
 * O destino desce até uma altura que as primitivas disponíveis vencem de fato —
 * validada com `canTraverseEdge`, sobre CÓPIAS, não com uma conta de cabeça.
 */
function undoGate(level, pair, abilities) {
  const { host, destination } = pair;
  const primitives = executablePrimitives(level, abilities);
  if (host && destination && primitives.length) {
    const original = destination.y;
    // Desce em passos até passar. O primeiro que passar é o mais alto possível:
    // preserva o máximo de relevo que a física ainda aceita.
    for (let candidate = host.y - 200; candidate <= host.y + 60; candidate += 20) {
      const probe = { ...destination, y: candidate };
      if (canTraverseEdge({ from: { ...host }, to: probe, primitives }).valid) {
        destination.y = candidate;
        break;
      }
      if (candidate + 20 > host.y + 60) destination.y = original;
    }
  }
  if (destination) {
    delete destination.ascentGate;
    delete destination.ascentGateId;
    delete destination.ascentGateRise;
    destination.azospirillumLadderDestination = false;
  }
  if (host) {
    delete host.ascentGateHost;
    delete host.ascentGateId;
    host.azospirillumLadderHost = false;
  }
  const gateId = pair.gateId;
  level.routeGates = (level.routeGates || []).filter(gate => gate.id !== gateId);
  level.ascentGates = (level.ascentGates || []).filter(gate => gate.id !== gateId);
  level.authoredAzospirillumLadderRequests =
    (level.authoredAzospirillumLadderRequests || [])
      .filter(request => request.ascentGateId !== gateId);
  return { gateId, action: 'convertido-em-travessia-ordinaria' };
}

/**
 * Valida e conserta todos os portões de subida.
 *
 * `regenerateLadders` é injetado para o módulo não depender do gerador de
 * escadas — quem chama sabe com que configuração regenerá-las. Ele é chamado no
 * MÁXIMO uma vez, e só se algum reparo estrutural foi aplicado: a geração
 * autoral usa `createRandom` com semente própria, então repeti-la é
 * determinístico e não consome o RNG de mais ninguém.
 */
export function validateAndRepairAzospirillumGates(level, {
  abilities = {},
  regenerateLadders = null,
} = {}) {
  const before = auditAzospirillumGates(level);
  const repairs = [];
  let structuralFix = false;

  for (const entry of before.results) {
    if (entry.ok) continue;
    const pair = gatePairs(level).find(candidate => candidate.gateId === entry.gateId);
    if (!pair) continue;
    // Reparo 1: promover o hospedeiro a raiz. É a causa mais comum — uma etapa
    // posterior devolveu a plataforma a solo e o pedido caiu no `continue`.
    if (pair.host && pair.host.type !== 'root') {
      pair.host.type = 'root';
      pair.host.recovery = false;
      structuralFix = true;
      repairs.push({ gateId: entry.gateId, action: 'host-promovido-a-raiz' });
    }
  }

  if (structuralFix && typeof regenerateLadders === 'function') {
    regenerateLadders(level);
  }

  const after = auditAzospirillumGates(level);
  const undone = [];
  for (const entry of after.results) {
    if (entry.ok) continue;
    const pair = gatePairs(level).find(candidate => candidate.gateId === entry.gateId);
    if (!pair) continue;
    undone.push({ ...undoGate(level, pair, abilities), reason: entry.reason });
  }

  const final = auditAzospirillumGates(level);
  // Carimbo da validação, lido pela auditoria de travessia.
  //
  // Um import direto daqui para o gerador (e do gerador para cá) fecharia um
  // ciclo, e o ponto é justamente que a classificação NÃO pode depender só de
  // metadado. Este campo é diferente dos outros: só esta função o escreve, e só
  // depois de a escada passar na inspeção. Metadado de portão qualquer gerador
  // escreve; este é um atestado.
  for (const entry of final.results) {
    const pair = gatePairs(level).find(candidate => candidate.gateId === entry.gateId);
    if (pair?.destination) pair.destination.ascentGateLadderValidated = entry.ok;
  }
  return {
    before: { total: before.total, ok: before.withLadder, broken: before.withoutLadder },
    repairs,
    undone,
    after: { total: final.total, ok: final.withLadder, broken: final.withoutLadder },
    // A invariante, verificada e não prometida: depois desta etapa, todo portão
    // que sobrou tem escada válida.
    invariantHolds: final.withoutLadder === 0,
  };
}

/** Existe escada válida para este portão? É o que a auditoria de travessia
 *  precisa perguntar antes de classificar o par como intencional. */
export function gateHasValidLadder(level, gateId) {
  const pair = gatePairs(level).find(candidate => candidate.gateId === gateId);
  if (!pair) return false;
  return inspectAzospirillumGate(level, pair).ok;
}

