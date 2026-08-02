// VALIDADOR COMPARTILHADO DA PONTE MICORRÍZICA
// ============================================
//
// A auditoria de rota tinha uma regra de uma linha:
//
//     if (options.mycorrhizaStructuresAvailable) { aceitar qualquer falha; }
//
// Isso é uma afirmação sobre a FASE, não sobre o vão. Da fase 4 em diante,
// qualquer buraco intransponível vira "travessia intencional" — inclusive um
// vão de 900px, inclusive um vão cujo lado de partida é solo onde micorriza
// nenhuma se instala. Softlock com carimbo de aprovado.
//
// Aqui a pergunta muda de "o jogador tem a habilidade?" para "esta ponte pode
// ser construída?". As regras são as MESMAS do runtime — extraídas de
// `findBridgeTarget`, não reescritas de memória. Os números moram neste arquivo
// e o runtime passa a importá-los, para não existir um 58 aqui e outro lá.

/** Vão horizontal mínimo. Abaixo disto não é vão, é degrau — e a hifa não faz
 *  ponte sobre coisa que se atravessa a pé. */
export const BRIDGE_MINIMUM_GAP = 58;
/** Desnível máximo com `horizontalOnly` ligado (a configuração de campanha). */
export const BRIDGE_MAX_VERTICAL_HORIZONTAL_ONLY = 68;
/** Desnível máximo quando a ponte pode inclinar. */
export const BRIDGE_MAX_VERTICAL_FREE = 105;
/** Comprimento que `buildBridgeGeometry` ainda cobre: ela divide a distância em
 *  no máximo 8 segmentos de 58px. Acima disso os segmentos esticam e a ponte
 *  deixa de ter colisor contínuo. */
export const BRIDGE_MAXIMUM_SPAN = 58 * 8;

export function horizontalGapBetween(source, target) {
  if (target.x >= source.x + source.w) return target.x - (source.x + source.w);
  if (source.x >= target.x + target.w) return source.x - (target.x + target.w);
  return 0;
}

/** A micorriza consegue se instalar nesta plataforma e partir dela? */
export function isColonizableBridgeSource(platform) {
  return Boolean(
    platform
    && platform.type === 'root'
    && !platform.final
    && !platform.recovery
    && !platform.mycorrhizaStructure
    && !platform.azospirillumStructure,
  );
}

/**
 * Esta ponte é construível?
 *
 * Devolve sempre um veredito com MOTIVO, nunca só um booleano: numa auditoria de
 * cinquenta seeds, o agregado por motivo é o que diz qual gerador consertar.
 * "Não é viável" não ajuda ninguém; "o desnível passa de 68 em 41 dos 47 casos"
 * aponta para o gerador de silhueta.
 *
 * `strictTarget` reproduz `strictPreferredMycorrhizaTarget`: quando a rota
 * declara um alvo obrigatório, chegar em OUTRO lugar não conta como sucesso.
 */
export function evaluateMycorrhizaBridgeCandidate({
  level = null,
  source,
  target,
  config = null,
  direction = null,
  strictTarget = null,
} = {}) {
  const fail = (reason, extra = {}) => ({ feasible: false, reason, ...extra });
  if (!source) return fail('origem-ausente');
  if (!target) return fail('destino-ausente');
  if (source === target) return fail('destino-igual-a-origem');
  if (!isColonizableBridgeSource(source)) return fail('origem-nao-colonizavel');
  if (target.final) return fail('destino-e-raiz-final');
  if (target.recovery) return fail('destino-e-recuperacao');
  if (target.mycorrhizaStructure || target.azospirillumStructure) {
    return fail('destino-e-estrutura-temporaria');
  }

  const sourceCenter = source.x + source.w / 2;
  const targetCenter = target.x + target.w / 2;
  const heading = direction ?? Math.sign(targetCenter - sourceCenter) ?? 1;
  if ((targetCenter - sourceCenter) * heading <= 0) return fail('direcao-errada');

  const gap = horizontalGapBetween(source, target);
  if (gap < BRIDGE_MINIMUM_GAP) return fail('vao-curto-demais', { gap });

  const horizontalOnly = config?.horizontalOnly !== false;
  const maximumVertical = horizontalOnly
    ? BRIDGE_MAX_VERTICAL_HORIZONTAL_ONLY
    : BRIDGE_MAX_VERTICAL_FREE;
  const dy = Math.abs(target.y - source.y);
  if (dy > maximumVertical) return fail('desnivel-alto-demais', { dy, maximumVertical });

  // Alvo obrigatório declarado pela rota: chegar em outro lugar não serve.
  const preferredId = source.preferredMycorrhizaTargetId || null;
  const strict = strictTarget ?? Boolean(source.strictPreferredMycorrhizaTarget);
  if (preferredId && strict) {
    const targetId = target.platformId ?? target.id ?? null;
    if (targetId !== preferredId) return fail('alvo-preferencial-nao-atendido', { preferredId });
  }

  // Comprimento que a geometria da ponte ainda sustenta.
  const span = Math.hypot(
    (target.x + 12) - (source.x + source.w - 12),
    (target.y - 7) - (source.y - 7),
  );
  if (span > BRIDGE_MAXIMUM_SPAN) return fail('vao-longo-demais', { span, max: BRIDGE_MAXIMUM_SPAN });

  // Conflito com outro portão: o destino já é peça de outro desafio, e a ponte
  // encostar nele desmonta os dois.
  if (target.ascentGate || target.nitrogenGate === 'target') {
    return fail('destino-ocupado-por-outro-portao');
  }

  return { feasible: true, reason: null, gap, dy, span };
}

/** O melhor alvo de ponte a partir desta origem, se existir. Mesma pontuação do
 *  runtime — perto pesa mais, desnível pesa o dobro, raiz ganha bônus. */
export function bestMycorrhizaBridgeTarget({ level, source, config = null, direction = null }) {
  let best = null;
  for (const target of level?.platforms || []) {
    const verdict = evaluateMycorrhizaBridgeCandidate({
      level, source, target, config, direction,
    });
    if (!verdict.feasible) continue;
    const score = verdict.gap + verdict.dy * 2.2 + (target.type === 'root' ? -12 : 0);
    if (!best || score < best.score) best = { target, score, ...verdict };
  }
  return best;
}
