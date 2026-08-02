import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { createGameAudio } from '../src/game-audio.js';

// SOM DO SALTO MUDO DEPOIS DO RESPAWN E DO REINÍCIO
// =================================================
//
// Sintoma: o salto tem som ao abrir o jogo, e depois de morrer ou reiniciar a
// fase fica mudo por vários segundos.
//
// CAUSA CONFIRMADA no código, não suposta. `physics.js` chamava
// `audio.canPlayJump(state.time)`, e o cooldown fazia:
//
//     if (now - lastJumpAt < 0.05) return false;
//
// `state.time` é o relógio da FASE e volta a zero no reinício
// (`simulator.js:333`), enquanto o controlador de áudio sobrevive com
// `lastJumpAt` guardado da tentativa anterior. A conta passava a comparar dois
// instantes de linhas do tempo diferentes:
//
//     lastJumpAt = 240  (tentativa anterior)
//     state.time = 0    (reinício)
//     0.1 - 240 = -239.9 < 0.05  ->  BLOQUEADO
//
// E continuava bloqueado até `state.time` reescalar os 240 segundos. Não era
// buffer recarregando, nem ducking, nem `gameOver` mascarando o salto.
//
// O conserto é o relógio: monotônico, do próprio controlador, que nunca anda
// para trás porque não pertence à fase.

// --- DUPLO DE Web Audio ----------------------------------------------------
//
// Mínimo para `createGameAudio` aceitar o ambiente. `currentTime` avança só
// quando o teste mandar: é ele que se está testando.

function audioHarness() {
  let currentTime = 0;
  const fetches = [];
  const decodes = [];
  const node = () => ({
    connect() { return node(); }, disconnect() {},
    gain: { value: 1, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
    start() {}, stop() {}, onended: null,
    buffer: null, loop: false,
    playbackRate: { value: 1, setValueAtTime() {} },
    threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
    attack: { value: 0 }, release: { value: 0 },
  });
  class FakeContext {
    constructor() { this.state = 'running'; this.destination = node(); }
    get currentTime() { return currentTime; }
    createGain() { return node(); }
    createBufferSource() { return node(); }
    createDynamicsCompressor() { return node(); }
    createMediaElementSource() { return node(); }
    decodeAudioData(buffer) { decodes.push(buffer); return Promise.resolve({ duration: 0.2 }); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  const windowRef = {
    AudioContext: FakeContext,
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {}, removeEventListener() {},
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
    fetch: url => { fetches.push(String(url)); return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); },
  };
  const documentRef = {
    createElement: () => ({
      play: () => Promise.resolve(), pause() {}, addEventListener() {}, removeEventListener() {},
      currentTime: 0, volume: 1, loop: false, src: '', preload: '', crossOrigin: '',
    }),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, head: { appendChild() {} },
  };
  const audio = createGameAudio({ documentRef, windowRef, getState: () => null, getCampaign: () => null });
  // `init()` cria o AudioContext. Sem ele o relogio monotonico cai no fallback
  // de `performance.now()`, que este duplo nao controla — e o teste mediria o
  // relogio errado, nao o codigo.
  audio.init();
  return {
    audio, fetches, decodes,
    advance(seconds) { currentTime += seconds; },
    get now() { return currentTime; },
  };
}

test('1. o primeiro salto da fase toca', () => {
  const kit = audioHarness();
  assert.equal(kit.audio.canPlayJump(), true);
});

test('2. o cooldown usa um relógio monotônico, não o da fase', () => {
  const kit = audioHarness();
  assert.equal(kit.audio.canPlayJump(), true);
  // Mesmo instante do relógio de áudio: continua bloqueado, como deve.
  assert.equal(kit.audio.canPlayJump(), false, 'o cooldown de 50ms deixou de valer');
  kit.advance(0.06);
  assert.equal(kit.audio.canPlayJump(), true, 'o cooldown não liberou depois de 60ms');
});

test('3. zerar o relógio da FASE não bloqueia o salto', () => {
  // O caso exato do defeito, agora impossível por construção: a função não
  // recebe mais o tempo do gameplay, então não há relógio reiniciável para
  // passar. Um chamador antigo que insista em passar `state.time` é ignorado.
  const kit = audioHarness();
  kit.advance(240);
  assert.equal(kit.audio.canPlayJump(240), true);
  kit.advance(0.1);
  // Reinício da fase: `state.time` volta a 0. O relógio do áudio, não.
  assert.equal(kit.audio.canPlayJump(0), true, 'o salto ficou mudo depois do reinício');
});

test('4. o primeiro salto após reiniciar a fase toca imediatamente', () => {
  const kit = audioHarness();
  // Tentativa longa: quatro minutos de jogo, muitos saltos.
  for (let minute = 0; minute < 4; minute++) {
    kit.advance(60);
    assert.equal(kit.audio.canPlayJump(), true);
  }
  // Reinício. O controlador de áudio sobrevive — é esse o ponto.
  kit.advance(0.4);
  assert.equal(
    kit.audio.canPlayJump(), true,
    'depois de quatro minutos de jogo, o primeiro salto da nova tentativa ficou mudo',
  );
});

test('5-7. respawn, checkpoint e salto duplo continuam tocando', () => {
  const kit = audioHarness();
  kit.advance(90);
  assert.equal(kit.audio.canPlayJump(), true);
  // Morte, `gameOver`, timer de respawn, volta ao `play`.
  kit.advance(2.5);
  assert.equal(kit.audio.canPlayJump(), true, 'mudo depois do respawn');
  // Salto duplo logo em seguida: passou o cooldown, é outro salto.
  kit.advance(0.2);
  assert.equal(kit.audio.canPlayJump(), true, 'o salto duplo ficou mudo');
  // Checkpoint.
  kit.advance(5);
  assert.equal(kit.audio.canPlayJump(), true, 'mudo depois do checkpoint');
});

test('8. dois pedidos no mesmo instante continuam deduplicados', () => {
  // A defesa contra repeat de teclado tinha de sobreviver ao conserto.
  const kit = audioHarness();
  assert.equal(kit.audio.canPlayJump(), true);
  assert.equal(kit.audio.canPlayJump(), false);
  assert.equal(kit.audio.canPlayJump(), false);
});

test('9. o gameplay não passa mais o relógio da fase para o áudio', () => {
  // Guarda de regressão: a assinatura antiga voltaria a acoplar o cooldown a um
  // relógio que zera, e o defeito voltaria sem nenhum teste falhar.
  const physics = readFileSync(new URL('../src/physics.js', import.meta.url), 'utf8');
  assert.ok(/canPlayJump\?\.\(\)/.test(physics), 'physics deixou de chamar canPlayJump sem argumento');
  assert.ok(
    !/canPlayJump\?\.\(state\.time\)/.test(physics),
    'physics voltou a passar state.time para o cooldown do salto',
  );
});

test('10. o cooldown do salto não lê state.time em lugar nenhum', () => {
  const audioSource = readFileSync(new URL('../src/game-audio.js', import.meta.url), 'utf8');
  const trecho = audioSource.slice(audioSource.indexOf('canPlayJump('));
  const corpo = trecho.slice(0, trecho.indexOf('},'));
  assert.ok(/monotonicAudioNow\(\)/.test(corpo), 'o cooldown deixou de usar o relógio monotônico');
  assert.ok(!/state\.time/.test(corpo), 'o cooldown voltou a depender do relógio da fase');
});

test('11. o buffer do salto não é recarregado por respawn ou reinício', () => {
  // O controlador guarda os buffers em `fxBuffers`, num Map que só o `destroy`
  // esvazia. Nem `respawn` nem o reinício da fase chamam `destroy` — o que se
  // tranca aqui é que nenhuma das duas operações passa perto do cache.
  const source = readFileSync(new URL('../src/game-audio.js', import.meta.url), 'utf8');
  const limpezas = source.split('\n')
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(entry => /fxBuffers\.(clear|delete)\(/.test(entry.line));
  for (const entry of limpezas) {
    const contexto = source.split('\n').slice(Math.max(0, entry.index - 12), entry.index).join('\n');
    assert.ok(
      /function destroy|destroyed = true/.test(contexto),
      `fxBuffers é esvaziado fora do destroy, na linha ${entry.index + 1}: ${entry.line}`,
    );
  }
});

// --- INTEGRAÇÃO ------------------------------------------------------------

test('12. integração: salto, morte, gameOver, respawn, salto imediato', () => {
  const kit = audioHarness();
  const played = [];
  const original = kit.audio.playFx.bind(kit.audio);
  kit.audio.playFx = (id, options) => { played.push(id); return original(id, options); };

  // 1 · salto com som, no meio da fase.
  kit.advance(75);
  assert.equal(kit.audio.canPlayJump(), true);
  kit.audio.playFx('playerJump', { gain: 1, rate: 1 });

  // 2 · morte e `gameOver`.
  kit.advance(0.3);
  kit.audio.playFx('gameOver', {});

  // 3 · timer de respawn corre, estado volta a `play`.
  kit.advance(2.2);

  // 4 · primeiro salto logo depois do retorno.
  assert.equal(kit.audio.canPlayJump(), true, 'o primeiro salto após o respawn foi bloqueado');
  kit.audio.playFx('playerJump', { gain: 1, rate: 1 });

  assert.equal(
    played.filter(id => id === 'playerJump').length, 2,
    `playerJump foi pedido ${played.filter(id => id === 'playerJump').length} vez(es), esperado 2`,
  );
  assert.ok(played.includes('gameOver'), 'o gameOver não chegou a ser pedido');
});

test('13. integração: salto em tempo alto, reinício com state.time = 0, salto imediato', () => {
  const kit = audioHarness();
  // Simula o gameplay: o relógio da fase e o do áudio andam juntos até o
  // reinício, e só o da fase volta a zero.
  let stateTime = 0;
  const jump = () => {
    const allowed = kit.audio.canPlayJump(stateTime);
    if (allowed) kit.audio.playFx('playerJump', { gain: 1, rate: 1 });
    return allowed;
  };
  for (let step = 0; step < 5; step++) {
    stateTime += 48;
    kit.advance(48);
    assert.equal(jump(), true);
  }
  assert.ok(stateTime > 200, 'a tentativa não ficou longa o bastante para reproduzir o caso');

  // REINÍCIO: `simulator.js` faz `state.time = 0`. O áudio segue seu relógio.
  stateTime = 0;
  kit.advance(0.35);
  assert.equal(
    jump(), true,
    `o primeiro salto da nova tentativa ficou mudo (state.time voltou a 0)`,
  );
});
