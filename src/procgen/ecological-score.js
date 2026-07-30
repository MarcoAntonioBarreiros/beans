// Pontuacao ecologica agregada da fase — usada pelo objetivo da fase final
// (Ecossistema integrado). Reflete a visao do jogo: solo/raiz saudaveis, com os
// beneficos controlando deficiencias e patogenos. Soma contribuicoes
// normalizadas de: biocontrole/ISR/antibiose, saude da raiz (recuperacao) e os
// estoques de N, P e Fe. As metricas usadas comecam em zero e sobem com a acao
// do jogador (evita falso-positivo de raizes que ja nascem saudaveis).
//
// Recebe o avaliador de objetivos (createCampaignObjectiveEvaluator), que ja
// sabe ler cada metrica de mundo via worldValue — assim a pontuacao e sempre
// coerente com as condicoes que gatilham as fases.
//
// Observacao: os pesos foram calibrados para que uma fase integrada bem
// conduzida ultrapasse 1; podem ser afinados apos playtest da fase 9.

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export function computeEcologicalScore(evaluator) {
  const wv = (key) => evaluator.worldValue({ type: 'worldState', key });

  // Biocontrole / ISR / antibiose.
  const biofilms = clamp((wv('functionalBiofilmCount') || 0) / 2, 0, 1);
  const eggMasses = clamp((wv('neutralizedEggMassCount') || 0) / 1, 0, 1);
  const fungusControl = clamp(1 - (wv('opportunisticFungusVigor') ?? 1), 0, 1);

  // Saude da raiz: raizes efetivamente recuperadas (sinal de acao).
  const recoveredRoots = clamp((wv('recoveredRootCount') || 0) / 2, 0, 1);

  // Estoques.
  const nitrogen = clamp((wv('activeMatureNoduleCount') || 0) / 2, 0, 1);
  const iron = clamp(wv('pseudomonasIronReserve') || 0, 0, 1);
  const phosphorus = clamp(
    Math.max(wv('rootPhosphateStock') || 0, wv('mycorrhizalPhosphateTransported') || 0),
    0, 1,
  );

  return (
    biofilms * 0.40
    + eggMasses * 0.35
    + recoveredRoots * 0.40
    + fungusControl * 0.20
    + nitrogen * 0.15
    + iron * 0.10
    + phosphorus * 0.10
  );
}
