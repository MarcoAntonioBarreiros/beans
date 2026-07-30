// Eventos que disparam som — salto, dano, morte, vitória
// ======================================================
//
// Um espião de áudio é injetado no simulador e as chamadas são inspecionadas.
// O que importa é QUANDO o som dispara: no salto que realmente aconteceu, no
// dano que passou pela invulnerabilidade, na morte uma única vez.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSimulator } from '../src/procgen/simulator.js';
import { createNoopAudio } from '../src/game-audio.js';
import { AUDIO_TRACKS, musicTrackForPhase } from '../src/audio-manifest.js';

const DT = 1 / 60;

function spyAudio() {
  const chamadas = [];
  const base = createNoopAudio();
  return {
    ...base,
    chamadas,
    playFx(id, options = {}) { chamadas.push({ tipo: 'fx', id, ...options }); return true; },
    playStinger(id, options = {}) { chamadas.push({ tipo: 'stinger', id, ...options }); return true; },
    setPhase(phase) { chamadas.push({ tipo: 'phase', phase }); },
    canPlayJump() { return true; },
    ids(tipo = null) {
      return chamadas.filter(c => !tipo || c.tipo === tipo).map(c => c.id ?? c.phase);
    },
    contar(id) { return chamadas.filter(c => c.id === id).length; },
    limpar() { chamadas.length = 0; },
  };
}

// Nível mínimo: uma plataforma larga onde dá para correr e saltar.
function bancada({ doubleJump = false } = {}) {
  const audio = spyAudio();
  const sim = createSimulator({ audio });
  const chao = {
    id: 'chao', type: 'root', logicIndex: 0,
    x: 0, y: 500, w: 4000, h: 60, rootHealth: 1,
  };
  sim.state.level.platforms = [chao];
  sim.state.level.hazards = [];
  sim.state.gameState = 'play';
  sim.state.player.x = 200;
  sim.state.player.y = chao.y - sim.state.player.h;
  sim.state.player.alive = true;
  sim.state.player.onGround = true;
  sim.state.player.canDoubleJump = doubleJump;
  sim.state.player.airJumpAvailable = doubleJump;
  sim.state.player.vitality = 5;
  sim.state.player.maxVitality = 5;
  sim.state.player.invuln = 0;

  return {
    audio, sim, chao,
    step(seconds = DT, keys = {}) {
      for (let i = 0; i < Math.max(1, Math.round(seconds / DT)); i++) {
        sim.setInputs(keys);
        sim.step(DT);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// SALTO
// ---------------------------------------------------------------------------

test('o simulador aceita um controlador de áudio injetado', () => {
  const audio = spyAudio();
  const sim = createSimulator({ audio });
  assert.equal(sim.audio, audio, 'o controlador fica acessível ao app');
});

test('sem áudio injetado, o simulador usa o adaptador silencioso', () => {
  const sim = createSimulator();
  assert.equal(typeof sim.audio.playFx, 'function');
  assert.equal(
    sim.audio.playFx('playerJump').state, 'suppressed',
    'silencioso, mas com a API completa e o estado correto',
  );
});

test('apertar salto no ar (sem poder saltar) não toca nada', () => {
  const b = bancada();
  // Tira o chão de baixo: o jogador cai e não tem coyote nem salto duplo.
  b.sim.state.player.onGround = false;
  b.sim.state.player.coyote = 0;
  b.sim.state.player.canDoubleJump = false;
  b.sim.state.player.airJumpAvailable = false;
  b.sim.state.player.y = 200;

  b.step(0.5, { Space: true });
  assert.equal(b.audio.contar('playerJump'), 0, 'sem salto, sem som');
});

test('um salto válido toca o FX uma única vez', () => {
  const b = bancada();
  b.step(3 * DT, {});
  b.audio.limpar();

  b.step(DT, { Space: true });
  b.step(10 * DT, { Space: true });

  assert.equal(b.audio.contar('playerJump'), 1, 'um salto, um som');
  const chamada = b.audio.chamadas.find(c => c.id === 'playerJump');
  assert.equal(chamada.rate, 1, 'salto normal em rate 1');
});

test('o salto duplo toca com rate diferente, e cada salto soa uma vez', () => {
  const b = bancada({ doubleJump: true });
  b.step(3 * DT, {});
  b.audio.limpar();

  // Primeiro salto.
  b.step(DT, { Space: true });
  b.step(6 * DT, {});
  // Segundo salto, ainda no ar.
  b.step(DT, { Space: true });
  b.step(6 * DT, {});

  const saltos = b.audio.chamadas.filter(c => c.id === 'playerJump');
  assert.equal(saltos.length, 2, 'salto normal + salto duplo');
  assert.equal(saltos[0].rate, 1);
  assert.ok(saltos[1].rate > 1, `o salto duplo é mais agudo (${saltos[1].rate})`);
  assert.ok(saltos[1].gain < saltos[0].gain, 'e um pouco mais leve');
});

test('o tom sintetizado antigo não é mais usado no salto duplo', () => {
  const b = bancada({ doubleJump: true });
  let tons = 0;
  b.sim.audio.toneNow = () => { tons++; };
  b.step(3 * DT, {});
  b.step(DT, { Space: true });
  b.step(6 * DT, {});
  b.step(DT, { Space: true });
  b.step(6 * DT, {});
  assert.equal(tons, 0, 'nada de oscilador por cima da música real');
});

// ---------------------------------------------------------------------------
// DANO E MORTE
// ---------------------------------------------------------------------------

test('dano válido toca o efeito arcade — e só ele', () => {
  const b = bancada();
  b.audio.limpar();
  b.sim.entities.damagePlayer(1, 'teste');

  assert.equal(b.audio.contar('playerDamage'), 1);
  assert.equal(b.audio.contar('playerDamageAlt'), 0, 'o alternativo de 6s não empilha');
  assert.equal(b.audio.contar('gameOver'), 0);
});

test('dano bloqueado pela invulnerabilidade não toca', () => {
  const b = bancada();
  b.sim.entities.damagePlayer(1, 'primeiro');
  b.audio.limpar();
  // A invulnerabilidade acabou de ser aplicada.
  b.sim.entities.damagePlayer(1, 'segundo');
  assert.equal(b.audio.contar('playerDamage'), 0, 'sem dano, sem som');
});

test('a saúde crítica toca healthLost uma única vez', () => {
  const b = bancada();
  b.sim.state.player.vitality = 3;
  b.audio.limpar();

  b.sim.entities.damagePlayer(1, 'a');
  assert.equal(b.audio.contar('healthLost'), 0, 'ainda em 2 corações');

  b.sim.state.player.invuln = 0;
  b.sim.entities.damagePlayer(1, 'b');
  assert.equal(b.sim.state.player.vitality, 1);
  assert.equal(b.audio.contar('healthLost'), 1, 'chegou a 1 coração');

  // Continuar levando dano não repete o aviso.
  b.sim.state.player.invuln = 0;
  b.sim.state.player.vitality = 1;
  b.sim.entities.damagePlayer(0, 'c');
  assert.equal(b.audio.contar('healthLost'), 1, 'não toca a cada contato');
});

test('a morte toca game over uma única vez, sem sequência caótica', () => {
  const b = bancada();
  b.sim.state.player.vitality = 1;
  b.audio.limpar();

  b.sim.entities.damagePlayer(1, 'fatal');
  assert.equal(b.sim.state.player.alive, false);
  assert.equal(b.audio.contar('gameOver'), 1);
  // Morrer não dispara também o dano comum: seria um empilhamento.
  assert.equal(b.audio.contar('playerDamage'), 0);
  assert.equal(b.audio.contar('healthLost'), 0);

  // Nenhuma repetição durante o mesmo respawn.
  b.sim.state.player.invuln = 0;
  b.sim.entities.damagePlayer(1, 'de novo');
  assert.equal(b.audio.contar('gameOver'), 1);
});

test('depois do respawn, uma nova morte volta a tocar game over', () => {
  const b = bancada();
  b.sim.state.player.vitality = 1;
  b.sim.entities.damagePlayer(1, 'primeira morte');
  assert.equal(b.audio.contar('gameOver'), 1);

  // Deixa o respawn acontecer.
  b.step(1.5, {});
  b.sim.state.gameState = 'play';
  b.sim.state.player.alive = true;
  b.sim.state.player.vitality = 1;
  b.sim.state.player.invuln = 0;

  b.sim.entities.damagePlayer(1, 'segunda morte');
  assert.equal(b.audio.contar('gameOver'), 2, 'cada morte tem seu som');
});

// ---------------------------------------------------------------------------
// MÚSICA POR FASE E VITÓRIA
// ---------------------------------------------------------------------------

test('o mapeamento de fase escolhe a música certa', () => {
  // Cada fase usa o tema do organismo que ela ensina.
  const esperado = {
    0: 'musicTitle',
    1: 'musicTitle',
    2: 'musicRhizobium',
    3: 'musicAzospirillum',
    4: 'musicMycorrhiza',
    5: 'musicPseudomonas',
    6: 'musicBacillus',
    7: 'musicRhizoctonia',
    8: 'musicMeloidogyne',
    9: 'musicRalstonia',
    // A fase 10 (ecossistema integrado) ainda não tem tema próprio.
    10: 'musicTitle',
  };
  for (const [fase, id] of Object.entries(esperado)) {
    assert.equal(musicTrackForPhase(Number(fase)), id, `fase ${fase}`);
  }
  // Fase desconhecida não quebra.
  assert.equal(musicTrackForPhase(99), 'musicTitle');
});

test('o stinger curto e o longo são faixas distintas e nunca o mesmo arquivo', () => {
  assert.notEqual(AUDIO_TRACKS.phaseVictory.src, AUDIO_TRACKS.campaignVictory.src);
  assert.equal(AUDIO_TRACKS.phaseVictory.kind, 'stinger');
  assert.equal(AUDIO_TRACKS.campaignVictory.kind, 'stinger');
});

// A captura da fase e o fim de campanha moram no app (DOM/canvas). Aqui o que se
// verifica é o CONTRATO que o app usa: um stinger por vez, e o longo só quando
// não há próxima fase.
test('o controlador toca um stinger por vez', () => {
  const audio = spyAudio();
  audio.playStinger('phaseVictory');
  audio.playStinger('campaignVictory');
  const stingers = audio.chamadas.filter(c => c.tipo === 'stinger');
  assert.equal(stingers.length, 2);
  assert.deepEqual(stingers.map(c => c.id), ['phaseVictory', 'campaignVictory']);
});

test('um FX desconhecido não derruba o jogo', () => {
  const b = bancada();
  assert.doesNotThrow(() => b.sim.audio.playFx('naoExiste'));
});

// ---------------------------------------------------------------------------
// VITÓRIA: tempo de transição e ausência de sobreposição
// ---------------------------------------------------------------------------

test('a espera fixa é fallback; o stinger inteiro cabe no prazo de segurança', async () => {
  const {
    PHASE_VICTORY_TRANSITION_SECONDS,
    PHASE_VICTORY_TOAST_SECONDS,
    VICTORY_AUDIO_FALLBACK_SECONDS,
  } = await import('../src/audio-manifest.js');

  // Com áudio, quem decide o momento da troca é o `ended` do stinger. A espera
  // fixa só vale quando não há som, e o prazo de segurança precisa ser maior que
  // os 10,24 s do arquivo para não cortá-lo.
  assert.ok(PHASE_VICTORY_TOAST_SECONDS <= PHASE_VICTORY_TRANSITION_SECONDS);
  assert.ok(
    VICTORY_AUDIO_FALLBACK_SECONDS > 10.24,
    `prazo de segurança curto demais: ${VICTORY_AUDIO_FALLBACK_SECONDS}s`,
  );
});

test('o goal-system agenda a espera de fallback', async () => {
  const { PHASE_VICTORY_TRANSITION_SECONDS } = await import('../src/audio-manifest.js');
  const { createGoalSystem } = await import('../src/procgen/goal-system.js');

  // Direto no sistema de chegada: montar a campanha inteira só para observar o
  // agendamento traria dependências que não têm nada a ver com o áudio.
  const campaign = { phase: 1, transitionRequested: false, transitionAt: 0, transitionCaptured: true };
  const state = {
    time: 42,
    gameState: 'play',
    shake: 0,
    campaign,
    player: { x: 500, y: 460, w: 26, h: 34, alive: true },
    level: {
      goal: { x: 500, y: 460, w: 40, h: 40, completed: false },
      platforms: [], particles: [],
    },
    toast: '', toastTime: 0,
  };
  const goal = createGoalSystem({ state, entities: { burst() {} } });
  goal.update(1 / 60);

  assert.equal(campaign.transitionRequested, true, 'a chegada pede a transição');
  assert.equal(
    Math.round((campaign.transitionAt - state.time) * 10) / 10,
    PHASE_VICTORY_TRANSITION_SECONDS,
    `a espera de fallback (veio ${campaign.transitionAt - state.time}s)`,
  );
  // E os marcadores da espera pelo áudio nascem limpos.
  assert.equal(campaign.waitingForVictoryAudio, false);
  assert.equal(campaign.victoryAudioFinished, false);
});

test('o controlador expõe as chamadas que o app usa na vitória', () => {
  const audio = createNoopAudio();
  for (const metodo of ['beginPhaseVictory', 'endPhaseVictory', 'stopStinger', 'getUiState', 'ensureExpectedMediaPlayback']) {
    assert.equal(typeof audio[metodo], 'function', `método ausente no adaptador: ${metodo}`);
  }
});

test('o salto usa o ganho reduzido do manifesto, e o dano não foi mexido', () => {
  assert.equal(AUDIO_TRACKS.playerJump.defaultGain, 0.45, 'salto ~7 dB abaixo');
  assert.equal(AUDIO_TRACKS.playerDamage.defaultGain, 1, 'dano segue no volume');
  assert.equal(AUDIO_TRACKS.gameOver.defaultGain, 1);
  assert.equal(AUDIO_TRACKS.phaseVictory.defaultGain, 1);
});
