// REGISTRO DE OCUPAÇÃO DE PLATAFORMA
// ==================================
//
// Cada desafio marca a plataforma que usa com um metadado próprio, e cada um
// faz isso sem olhar o que já está lá. Como as etapas rodam em sequência —
// portões, depósito de fósforo, encontros, escadas, raiz nitrogenada — uma
// plataforma pode terminar com duas funções que não convivem.
//
// A pior combinação é a raiz nitrogenada: o alvo da FBN nasce SUBDESENVOLVIDO,
// ou seja, ele é geometria que só existe depois de o jogador nodular a raiz
// hospedeira. Se essa mesma plataforma for também o destino de uma ponte ou de
// uma escada, o outro desafio aponta para algo que ainda não está lá — e
// enquanto não estiver, o vão não tem solução.
//
// O registro não conserta desafio nenhum. Ele responde uma pergunta antes da
// instalação: esta plataforma já tem função incompatível com a que eu quero
// dar? Quem pergunta escolhe outro slot; quem não pergunta continua exatamente
// como estava, porque o registro é derivado dos metadados que já existem.

export const PLATFORM_ROLES = Object.freeze([
  'alvo-fbn',
  'host-fbn',
  'host-escada',
  'destino-escada',
  'host-ponte',
  'destino-ponte',
  'host-parede-fosforo',
  'raiz-transportadora',
  'raiz-final',
  'encontro',
]);

/**
 * Pares que NÃO podem coexistir na mesma plataforma, e o motivo.
 *
 * A lista é curta de propósito. Acumular funções é normal e às vezes desejável
 * — uma raiz pode ser hospedeira de escada e transportadora de fósforo sem
 * conflito nenhum. O que não pode é uma função depender da plataforma existir
 * enquanto outra a remove, ou duas geometrias autorais disputarem o mesmo vão.
 */
export const ROLE_CONFLICTS = Object.freeze([
  // O alvo da FBN nasce ausente. Qualquer coisa que precise dele já instalado
  // aponta para o vazio até o jogador nodular o hospedeiro.
  ['alvo-fbn', 'destino-escada', 'o alvo da FBN so existe depois da nodulacao'],
  ['alvo-fbn', 'destino-ponte', 'o alvo da FBN so existe depois da nodulacao'],
  ['alvo-fbn', 'host-escada', 'o alvo da FBN nao pode hospedar escada que ainda nao tem chao'],
  ['alvo-fbn', 'host-ponte', 'o alvo da FBN nao pode ser origem de ponte'],
  ['alvo-fbn', 'host-parede-fosforo', 'deposito sobre plataforma que ainda nao existe'],
  ['alvo-fbn', 'raiz-transportadora', 'o transporte dependeria de uma raiz ausente'],
  ['alvo-fbn', 'raiz-final', 'a raiz final nao pode faltar'],
  // A raiz final encerra a fase: nada de portão pendurado nela.
  ['raiz-final', 'destino-escada', 'a raiz final nao e destino de desafio'],
  ['raiz-final', 'destino-ponte', 'a raiz final nao e destino de desafio'],
  ['raiz-final', 'host-ponte', 'a raiz final nao e origem de desafio'],
  ['raiz-final', 'host-escada', 'a raiz final nao e origem de desafio'],
  ['raiz-final', 'host-parede-fosforo', 'a raiz final nao carrega deposito'],
  // Dois portões autorais no mesmo ponto disputam o mesmo vão.
  ['destino-escada', 'destino-ponte', 'dois portoes autorais no mesmo destino'],
  ['host-escada', 'host-ponte', 'dois portoes autorais na mesma origem'],
]);

function conflictBetween(left, right) {
  for (const [a, b, reason] of ROLE_CONFLICTS) {
    if ((a === left && b === right) || (a === right && b === left)) return reason;
  }
  return null;
}

/** As funções que esta plataforma JÁ carrega, lidas dos metadados existentes.
 *  Nada de estado paralelo: a fonte da verdade continua sendo a plataforma. */
export function rolesOf(platform) {
  if (!platform) return [];
  const roles = [];
  if (platform.nitrogenGate === 'target' || platform.nitrogenRootTarget) roles.push('alvo-fbn');
  if (platform.nitrogenGate === 'host') roles.push('host-fbn');
  if (platform.ascentGateHost || platform.azospirillumLadderHost) roles.push('host-escada');
  if (platform.ascentGate || platform.azospirillumLadderDestination) roles.push('destino-escada');
  if (platform.bridgeGateHost) roles.push('host-ponte');
  if (platform.bridgeGate) roles.push('destino-ponte');
  if (platform.phosphateWallHost || platform.phosphateDepositHost) roles.push('host-parede-fosforo');
  if (platform.phosphateTransportRoot) roles.push('raiz-transportadora');
  if (platform.final) roles.push('raiz-final');
  if (platform.encounterInstanceId) roles.push('encontro');
  return roles;
}

/** Esta plataforma pode assumir mais esta função? Devolve o motivo quando não. */
export function canTakeRole(platform, role) {
  for (const existing of rolesOf(platform)) {
    const reason = conflictBetween(existing, role);
    if (reason) return { ok: false, reason, conflictsWith: existing };
  }
  return { ok: true, reason: null, conflictsWith: null };
}

/**
 * Primeiro candidato que aceita a função, na ordem em que vierem.
 *
 * Determinístico por construção: a ordem da lista é a ordem da rota, e a
 * escolha é sempre o primeiro que passa — nenhum sorteio novo, nenhum RNG
 * consumido. Trocar de slot não pode mudar o resto da fase.
 */
export function findFreeSlot(candidates, role) {
  for (const candidate of candidates || []) {
    const platform = candidate?.platform || candidate;
    if (canTakeRole(platform, role).ok) return candidate;
  }
  return null;
}

/** Todos os conflitos presentes no nível. Somente leitura, para a auditoria. */
export function auditPlatformOccupancy(level) {
  const conflicts = [];
  for (const platform of level?.platforms || []) {
    const roles = rolesOf(platform);
    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        const reason = conflictBetween(roles[i], roles[j]);
        if (reason) {
          conflicts.push({
            logicIndex: platform.logicIndex ?? null,
            platformId: platform.platformId ?? platform.id ?? null,
            roles: [roles[i], roles[j]],
            reason,
          });
        }
      }
    }
  }
  return conflicts;
}
