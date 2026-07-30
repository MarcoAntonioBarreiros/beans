import assert from 'node:assert/strict';
import test from 'node:test';

import { computeEcologicalScore } from '../src/procgen/ecological-score.js';

// Avaliador falso que imita createCampaignObjectiveEvaluator.worldValue:
// devolve o valor mapeado quando existe e undefined para chaves ausentes
// (assim opportunisticFungusVigor cai no default 1, como no avaliador real).
function fakeEvaluator(values) {
  return {
    worldValue(condition) {
      return condition.key in values ? values[condition.key] : undefined;
    },
  };
}

test('solo intocado nao fecha o objetivo ecologico da fase final', () => {
  const score = computeEcologicalScore(fakeEvaluator({}));
  assert.equal(score, 0);
  assert.ok(score < 1, 'sem nenhuma acao ecologica a fase 9 nao pode desbloquear');
});

test('fase integrada bem conduzida ultrapassa a pontuacao minima (>= 1)', () => {
  // Acoes tipicas da fase 9 (Ecossistema integrado): formar biofilmes,
  // neutralizar massa de ovos de Meloidogyne e recuperar raizes danificadas.
  const score = computeEcologicalScore(fakeEvaluator({
    functionalBiofilmCount: 2,
    neutralizedEggMassCount: 1,
    recoveredRootCount: 2,
  }));
  assert.ok(score >= 1, `pontuacao ${score.toFixed(2)} deveria fechar o objetivo`);
});

test('uma unica frente ecologica nao basta para fechar a fase', () => {
  // Guarda contra o objetivo passar sem manejo integrado.
  const soBiofilme = computeEcologicalScore(fakeEvaluator({ functionalBiofilmCount: 9 }));
  assert.ok(soBiofilme < 1, `so biofilme (${soBiofilme.toFixed(2)}) nao pode fechar sozinho`);
});

test('os estoques de N, P e Fe contribuem para a pontuacao', () => {
  const base = computeEcologicalScore(fakeEvaluator({ functionalBiofilmCount: 2 }));
  const comEstoques = computeEcologicalScore(fakeEvaluator({
    functionalBiofilmCount: 2,
    activeMatureNoduleCount: 2,
    pseudomonasIronReserve: 1,
    rootPhosphateStock: 1,
  }));
  assert.ok(comEstoques > base, 'N/P/Fe precisam somar na pontuacao ecologica');
});

test('o controle do fungo oportunista (ISR/antibiose) soma na pontuacao', () => {
  const semControle = computeEcologicalScore(fakeEvaluator({
    functionalBiofilmCount: 1,
    opportunisticFungusVigor: 1,
  }));
  const comControle = computeEcologicalScore(fakeEvaluator({
    functionalBiofilmCount: 1,
    opportunisticFungusVigor: 0.1,
  }));
  assert.ok(comControle > semControle, 'reduzir o vigor do fungo precisa somar');
});
