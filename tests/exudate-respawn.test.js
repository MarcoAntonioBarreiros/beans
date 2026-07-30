import assert from 'node:assert/strict';
import test from 'node:test';

import { restoreExudatesAhead } from '../src/procgen/simulator.js';

function fase() {
  return {
    exudates: [
      { x: 100, taken: true },   // ja vencido, ficou para tras
      { x: 400, taken: true },   // exatamente no ponto de retorno
      { x: 900, taken: true },   // adiante
      { x: 1500, taken: false }, // adiante e ainda intacto
    ],
  };
}

test('o exsudato adiante do retorno volta a existir', () => {
  const level = fase();
  const devolvidos = restoreExudatesAhead(level, 400);
  assert.equal(devolvidos, 2, 'os dois consumidos adiante precisam voltar');
  assert.deepEqual(level.exudates.map(e => e.taken), [true, false, false, false]);
});

test('o trecho ja vencido nao vira fonte infinita', () => {
  // Sem isto, bastaria morrer de proposito para recolher os mesmos exsudatos
  // sem parar, e a penalidade da morte deixaria de existir.
  const level = fase();
  restoreExudatesAhead(level, 400);
  assert.equal(level.exudates[0].taken, true, 'o que ficou para tras continua consumido');
});

test('morrer no comeco devolve a fase inteira', () => {
  const level = fase();
  assert.equal(restoreExudatesAhead(level, 0), 3);
  assert.ok(level.exudates.every(e => !e.taken));
});

test('a fase 3 deixa de poder ficar sem recurso nenhum adiante', () => {
  // O bloqueio relatado: duas secoes exigindo nitrogenio e escada, e o estoque
  // acabando antes da segunda. Depois de morrer, o trecho a frente precisa ter
  // com que ser resolvido.
  const level = {
    exudates: [
      { x: 200, taken: true }, { x: 800, taken: true },
      { x: 1400, taken: true }, { x: 2000, taken: true },
    ],
  };
  restoreExudatesAhead(level, 700);
  const adiante = level.exudates.filter(e => e.x >= 700 && !e.taken);
  assert.equal(adiante.length, 3, 'todo exsudato adiante do checkpoint precisa estar disponivel');
});

test('nao quebra com fase sem exsudatos nem com dado torto', () => {
  assert.equal(restoreExudatesAhead(null, 0), 0);
  assert.equal(restoreExudatesAhead({}, 0), 0);
  assert.equal(restoreExudatesAhead({ exudates: [] }, 0), 0);
  // Exsudato sem posicao nao pode ser devolvido no lugar errado: fica como esta.
  const level = { exudates: [{ taken: true }, { x: Number.NaN, taken: true }] };
  assert.equal(restoreExudatesAhead(level, 0), 0);
});
