// Disseminação da Ralstonia — regras puras
// ========================================
//
// A disseminação é a terceira lição da fase 9: uma infecção vascular ativa
// libera exsudato bacteriano, esse exsudato viaja pelo solo e tenta colonizar
// OUTRA raiz. O jogador vê o aviso, tem alguns segundos e pode proteger o alvo.
//
// Tudo aqui é puro. O runtime cuida do tempo, do desenho e dos avisos; as
// decisões (quem pode disseminar, para onde, se a chegada é bloqueada) moram
// neste módulo para poderem ser testadas sem montar um nível.
//
// Nenhuma função aqui chama Math.random: o sorteio do alvo recebe um `random`
// determinístico derivado da seed da fase, do id do foco e do número do evento.

// O bundler do projeto traduz `import { A, B }` numa desestruturação simples.
// Nada de `import { X as Y }` nem de `export { X }`.
import { RALSTONIA_DEFAULTS } from './campaign-manifest.js';
import { isRalstoniaRootEligible, ralstoniaWoundPressure } from './ralstonia-wilt-core.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

export const RALSTONIA_SPREAD_STATES = Object.freeze([
  'warning', 'traveling', 'arrived', 'blocked', 'completed',
]);

// Um foco pode abrir um evento de disseminação?
//
// Exige infecção vascular REAL e ativa. Foco pendente (longe do jogador),
// neutralizado, contido ou apenas superficial nunca dissemina — assim o
// jogador não é punido por algo que aconteceu fora da tela.
//
// `pedagogicalSpread` é a exceção controlada da estreia: quando o jogador
// alcança a região da terceira lição, o runtime marca UM foco vascular para
// abrir o evento didático mesmo que ele esteja abaixo do limiar ou já contido.
export function canRalstoniaFocusSpread(focus, {
  config = RALSTONIA_DEFAULTS,
  activeEventForFocus = false,
  maximumGeneration = null,
} = {}) {
  if (!focus) return false;
  if (focus.activationState !== 'active') return false;
  if (focus.neutralized) return false;
  if (activeEventForFocus) return false;

  const generationCap = Number.isFinite(maximumGeneration)
    ? maximumGeneration
    : config.maximumSpreadGeneration;
  if (finite(focus.spreadGeneration) >= generationCap) return false;

  const budget = config.maximumSpreadEventsPerFocus + (focus.spreadBudgetBonus || 0);
  if (finite(focus.spreadEventsUsed) >= budget) return false;

  if (focus.pedagogicalSpread === true) {
    // Ainda exige que a bactéria esteja DENTRO do vaso: sem xilema colonizado
    // não existe exsudato bacteriano para disseminar.
    return Boolean(focus.everEnteredVascular);
  }

  if (focus.contained) return false;
  return clamp(finite(focus.vascularLoad), 0, 1) >= config.spreadTriggerThreshold;
}

// Raiz que pode RECEBER um evento. Além da elegibilidade estrutural do núcleo,
// exclui raiz já ocupada por foco, raiz já visada por outro evento e raiz
// completamente íntegra (bactéria chega e não coloniza).
export function isRalstoniaSpreadTargetEligible(root, {
  source = null,
  config = RALSTONIA_DEFAULTS,
  occupiedRoots = new Set(),
  targetedRoots = new Set(),
} = {}) {
  if (!isRalstoniaRootEligible(root)) return false;
  if (root === source) return false;
  if (occupiedRoots.has(root) || targetedRoots.has(root)) return false;
  if (!source) return false;

  const distance = Math.abs(
    (root.x + root.w / 2) - (source.x + source.w / 2),
  );
  if (distance < config.minimumSpreadDistance) return false;
  if (distance > config.maximumSpreadDistance) return false;

  // Porta real: lesão sustentada pela raiz agora, ou uma porta já aberta.
  return ralstoniaSpreadOpening(root) > 0.12;
}

// Porta de entrada da raiz-alvo no momento da consulta. Usa o maior entre a
// lesão que a raiz sustenta e uma porta já registrada por um foco anterior.
export function ralstoniaSpreadOpening(root) {
  if (!root) return 0;
  return clamp(
    Math.max(
      ralstoniaWoundPressure(root),
      finite(root.ralstoniaWoundOpening),
      // Lesão suscetível criada proceduralmente quando a raiz-alvo reservada
      // nasceu íntegra. É moderada e cicatrizável: Azospirillum, recuperação da
      // saúde, Bacillus ou Pseudomonas fecham/protegem essa porta.
      finite(root.ralstoniaExposureWound),
    ),
    0, 1,
  );
}

// Escolha do alvo. Determinística: o `random` vem de fora.
export function chooseRalstoniaSpreadTarget({
  sourceRoot,
  roots = [],
  config = RALSTONIA_DEFAULTS,
  random = () => 0.5,
  occupiedRoots = new Set(),
  targetedRoots = new Set(),
} = {}) {
  if (!sourceRoot) return null;
  const candidates = roots.filter(root => isRalstoniaSpreadTargetEligible(root, {
    source: sourceRoot, config, occupiedRoots, targetedRoots,
  }));
  if (!candidates.length) return null;

  // Prefere adiante na rota — o jogador ainda vai passar por lá e pode defender
  // — e, entre os que estão adiante, a raiz mais aberta.
  const ordered = candidates.slice().sort((a, b) => {
    const aheadA = a.x > sourceRoot.x ? 0 : 1;
    const aheadB = b.x > sourceRoot.x ? 0 : 1;
    if (aheadA !== aheadB) return aheadA - aheadB;
    const openingDelta = ralstoniaSpreadOpening(b) - ralstoniaSpreadOpening(a);
    if (Math.abs(openingDelta) > 1e-6) return openingDelta;
    // Desempate estável para a mesma seed sempre dar o mesmo alvo.
    return (a.logicIndex ?? 0) - (b.logicIndex ?? 0) || a.x - b.x;
  });

  const pool = ordered.slice(0, Math.min(2, ordered.length));
  return pool[Math.min(pool.length - 1, Math.floor(clamp(random(), 0, .999) * pool.length))];
}

// Proteção da raiz-alvo na CHEGADA. Recalculada no momento exato, para o
// jogador poder correr até lá durante o aviso e ainda salvar a raiz.
export function ralstoniaArrivalProtection({
  bacillus = 0,
  pseudomonas = 0,
  azospirillumClosure = 0,
  rootHealth = 1,
  opening = 1,
  config = RALSTONIA_DEFAULTS,
} = {}) {
  const b = clamp(finite(bacillus), 0, 1);
  const p = clamp(finite(pseudomonas), 0, 1);
  const azo = clamp(finite(azospirillumClosure), 0, 1);
  const health = clamp(finite(rootHealth, 1), 0, 1);
  const door = clamp(finite(opening), 0, 1);

  // Controle direto: barreira física + supressão.
  const direct = clamp(b * .7 + p * .5, 0, 1);
  // Proteção indireta: porta fechando e tecido recuperado.
  const indirect = clamp(azo * .45 + Math.max(0, health - .6) * .9, 0, 1);
  const protection = clamp(direct + indirect * (1 - direct * .5), 0, 1);

  // A porta cicatrizada bloqueia por si: a bactéria chega e não encontra entrada.
  const sealed = door <= config.woundColonizationLimit;
  return {
    protection,
    direct,
    indirect,
    sealed,
    blocked: sealed || protection >= config.spreadTargetProtectionThreshold,
  };
}
