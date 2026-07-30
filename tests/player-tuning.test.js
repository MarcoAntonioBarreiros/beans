import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLAYER_TUNING_DEFAULTS, PLAYER_TUNING_LIMITS, PLAYER_TUNING_STORAGE_KEY,
  getPlayerTuning, initPlayerTuning, resetPlayerTuning, setPlayerTuning,
} from '../src/render/player-skin-tuning.js';
import { PLAYER_SKINS } from '../src/render/player-skins.js';

function storageStub(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_k, v) => { value = v; }, read: () => value };
}

test('o ajuste comeca no padrao e sobrevive a sessao', () => {
  const storage = storageStub();
  initPlayerTuning(storage);
  assert.deepEqual(getPlayerTuning(), PLAYER_TUNING_DEFAULTS);

  setPlayerTuning({ characterHeight: 88 });
  assert.equal(getPlayerTuning().characterHeight, 88);
  assert.match(storage.read(), /88/);

  // Uma sessao nova le o que ficou guardado.
  initPlayerTuning(storageStub(storage.read()));
  assert.equal(getPlayerTuning().characterHeight, 88);
  resetPlayerTuning();
});

test('valor fora da faixa nao vira personagem gigante nem invisivel', () => {
  initPlayerTuning(storageStub());
  const { min, max } = PLAYER_TUNING_LIMITS.characterHeight;

  setPlayerTuning({ characterHeight: 9999 });
  assert.equal(getPlayerTuning().characterHeight, max);

  setPlayerTuning({ characterHeight: 0 });
  assert.equal(getPlayerTuning().characterHeight, min);

  // Lixo no localStorage nao pode apagar o personagem.
  initPlayerTuning(storageStub('{"characterHeight":"nao e numero"}'));
  assert.equal(getPlayerTuning().characterHeight, PLAYER_TUNING_DEFAULTS.characterHeight);

  initPlayerTuning(storageStub('isto nao e json'));
  assert.deepEqual(getPlayerTuning(), PLAYER_TUNING_DEFAULTS);
  resetPlayerTuning();
});

test('restaurar volta exatamente ao padrao', () => {
  initPlayerTuning(storageStub());
  setPlayerTuning({ characterHeight: 110, runSpeedScale: 1.9 });
  assert.deepEqual(resetPlayerTuning(), PLAYER_TUNING_DEFAULTS);
});

test('a corrida ficou mais lenta do que estava', () => {
  // Historico medido: a primeira versao dava 17,5 quadros por segundo na
  // velocidade maxima e a segunda 10,8 — as duas pareceram adiantadas jogando.
  const run = PLAYER_SKINS.miguelito.states.run;
  const ritmo = Math.min(run.fps, run.motionBase + 245 * run.motionFactor);
  assert.ok(ritmo < 10.8, `ritmo de ${ritmo.toFixed(1)}fps nao e mais lento que a versao anterior`);
  assert.ok(ritmo > 5, `ritmo de ${ritmo.toFixed(1)}fps ficaria arrastado demais`);
});

test('o slider consegue chegar aos dois lados do padrao', () => {
  // Um slider cujo padrao esta no extremo da faixa so anda para um lado e nao
  // serve para achar o ponto no olho.
  for (const [chave, limite] of Object.entries(PLAYER_TUNING_LIMITS)) {
    const padrao = PLAYER_TUNING_DEFAULTS[chave];
    assert.ok(padrao > limite.min, `${chave}: o padrao precisa poder diminuir`);
    assert.ok(padrao < limite.max, `${chave}: o padrao precisa poder aumentar`);
  }
});

test('a chave de armazenamento tem versao', () => {
  // Sem versao, um ajuste guardado com outro significado voltaria como valor
  // valido depois de mudar a escala.
  assert.match(PLAYER_TUNING_STORAGE_KEY, /:v\d+$/);
});
