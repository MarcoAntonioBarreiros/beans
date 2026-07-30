import assert from 'node:assert/strict';
import test from 'node:test';

import { createPhaseLabSession } from '../src/procgen/phase-lab.js';
import { PHASE_LAB_STORAGE_KEY } from '../src/procgen/phase-lab-config.js';

// DOM minimo: o Phase Lab so precisa de localStorage e location para nascer.
// mount() exige documento de verdade, entao aqui testa-se so o boot, que e onde
// a excecao acontecia.
function janela({ armazenado = null, search = '?phaseLab=1' } = {}) {
  let guardado = armazenado;
  return {
    location: { search, href: `http://x/${search}` },
    localStorage: {
      getItem: key => (key === PHASE_LAB_STORAGE_KEY ? guardado : null),
      setItem: (key, value) => { if (key === PHASE_LAB_STORAGE_KEY) guardado = value; },
    },
  };
}

test('o Lab nasce mesmo sem nada guardado', () => {
  const session = createPhaseLabSession({ windowObject: janela() });
  assert.equal(session.enabled, true);
  assert.ok(session.config, 'precisa ter uma configuracao utilizavel');
});

test('sem o parametro na URL o Lab fica desligado, sem custo', () => {
  const session = createPhaseLabSession({ windowObject: janela({ search: '' }) });
  assert.equal(session.enabled, false);
});

test('configuracao salva corrompida nao impede o Lab de abrir', () => {
  // JSON quebrado, JSON valido sem forma de config, e config de uma fase que
  // mudou de tamanho — os tres casos reais de configuracao velha.
  for (const armazenado of [
    'isto nao e json',
    '{"phase":"nao e numero"}',
    JSON.stringify({ phase: 3, seed: 'velho', totalChunks: 40, segments: [] }),
  ]) {
    const session = createPhaseLabSession({ windowObject: janela({ armazenado }) });
    assert.equal(session.enabled, true, `armazenado ${armazenado.slice(0, 24)}: o Lab precisa abrir`);
    assert.ok(session.config, 'e com uma configuracao utilizavel');
  }
});

test('o Lab nao lanca no boot: e ferramenta de diagnostico', () => {
  // Este era o defeito. validatePhaseLabConfig valida o MANIFESTO INTEIRO, nao
  // so a fase editada, entao uma fase invalida em qualquer lugar fazia
  // applyConfig lancar tambem para a fase 1 do fallback. A excecao subia no
  // carregamento do modulo e o Phase Lab simplesmente nao aparecia — sem
  // mensagem nenhuma.
  //
  // Uma ferramenta que some justamente quando ha algo para diagnosticar e a
  // pior forma possivel de falhar.
  assert.doesNotThrow(() => {
    createPhaseLabSession({ windowObject: janela({ armazenado: JSON.stringify({ phase: 4, totalChunks: 1 }) }) });
  });
});

test('storage indisponivel nao derruba o Lab', () => {
  // Navegador com cookies bloqueados lanca ao tocar em localStorage.
  const hostil = {
    location: { search: '?phaseLab=1', href: 'http://x/?phaseLab=1' },
    get localStorage() { throw new Error('acesso negado'); },
  };
  assert.doesNotThrow(() => createPhaseLabSession({ windowObject: hostil }));
});
