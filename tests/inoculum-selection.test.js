import assert from 'node:assert/strict';
import test from 'node:test';

import { createInoculumSelection } from '../src/procgen/inoculum-selection.js';

function cena({ carregados = [], trichoderma = 0, exsudatos = 0 } = {}) {
  const state = {
    gameState: 'play',
    time: 0,
    player: { exudates: exsudatos },
  };
  const input = { keys: { ArrowDown: false } };
  const inoculants = {
    followerGroups() {
      const grupos = new Map();
      for (const [tipo, quantidade] of carregados) {
        grupos.set(tipo, Array.from({ length: quantidade }, (_, i) => ({ id: `${tipo}-${i}` })));
      }
      return grupos;
    },
  };
  const selection = createInoculumSelection({
    state,
    input,
    inoculants,
    trichodermaColonies: { followerCount: trichoderma },
  });
  const cicla = () => {
    input.keys.ArrowDown = true;
    selection.prepare();
    input.keys.ArrowDown = false;
    selection.prepare();
  };
  return { state, selection, cicla };
}

test('sem nada carregado nao ha selecao e ninguem responde ao E', () => {
  const { selection } = cena();
  assert.equal(selection.current, null);
  assert.equal(selection.isSelected('exudate'), false);
  assert.equal(selection.isSelected('organism', 'bacillus'), false);
});

test('a seta para baixo cicla entre os organismos carregados e o exsudato', () => {
  const { selection, cicla } = cena({
    carregados: [['bacillus', 2], ['rhizobium', 1]],
    exsudatos: 3,
  });

  assert.deepEqual(
    selection.options().map(item => item.type),
    ['bacillus', 'rhizobium', 'exudate'],
  );

  assert.equal(selection.current.type, 'bacillus');
  assert.equal(selection.isSelected('organism', 'bacillus'), true);
  assert.equal(selection.isSelected('organism', 'rhizobium'), false);
  assert.equal(selection.isSelected('exudate'), false);

  cicla();
  assert.equal(selection.current.type, 'rhizobium');
  assert.equal(selection.isSelected('organism', 'bacillus'), false);

  cicla();
  assert.equal(selection.current.type, 'exudate');
  assert.equal(selection.isSelected('exudate'), true, 'o exsudato disputa a mesma vaga');

  cicla();
  assert.equal(selection.current.type, 'bacillus', 'a lista e circular');
});

test('carregando um so item, ciclar nao muda nada', () => {
  const { selection, cicla } = cena({ carregados: [['bacillus', 1]] });
  cicla();
  assert.equal(selection.current.type, 'bacillus');
});

test('Trichoderma entra na mesma lista, sem prioridade fixa sobre as bacterias', () => {
  const { selection, cicla } = cena({
    carregados: [['pseudomonas', 1]],
    trichoderma: 2,
  });
  assert.equal(selection.current.type, 'pseudomonas');
  assert.equal(selection.isSelected('trichoderma'), false, 'antes tinha prioridade fixa; agora nao');

  cicla();
  assert.equal(selection.current.type, 'trichoderma');
  assert.equal(selection.isSelected('trichoderma'), true);
});

test('o item selecionado some da lista quando acaba, sem travar a selecao', () => {
  const { state, selection, cicla } = cena({ carregados: [['bacillus', 1]], exsudatos: 2 });
  cicla();
  assert.equal(selection.current.type, 'exudate');

  // O jogador gasta os exsudatos: a selecao cai de volta para o que sobrou.
  state.player.exudates = 0;
  assert.equal(selection.current.type, 'bacillus');
  assert.equal(selection.options().length, 1);
});

test('a contagem exibida acompanha o que esta carregado', () => {
  const { selection } = cena({ carregados: [['azospirillum', 3]], exsudatos: 1 });
  assert.equal(selection.current.count, 3);
  assert.match(selection.summary, /Azospirillum \(3\) 1\/2/);
});
