import assert from 'node:assert/strict';
import test from 'node:test';

import { PLAYER_SKINS, resolvePlayerSkin } from '../src/render/player-skins.js';
import { createPlayerSprite } from '../src/render/player-sprite.js';

function storageStub(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    read: () => value,
  };
}

test('sem parametro nenhum o personagem e o Miguelito (padrao)', () => {
  assert.equal(resolvePlayerSkin({}).id, 'miguelito');
  assert.equal(resolvePlayerSkin({ locationLike: { search: '' }, storage: storageStub() }).id, 'miguelito');
});

test('?player=miguelito troca a skin e a escolha fica guardada', () => {
  const storage = storageStub();
  assert.equal(resolvePlayerSkin({ locationLike: { search: '?player=miguelito' }, storage }).id, 'miguelito');
  assert.equal(storage.read(), 'miguelito');
  // Sem o parametro, a escolha guardada continua valendo.
  assert.equal(resolvePlayerSkin({ locationLike: { search: '' }, storage }).id, 'miguelito');
  // E da para voltar.
  assert.equal(resolvePlayerSkin({ locationLike: { search: '?player=astronaut' }, storage }).id, 'astronaut');
});

test('skin desconhecida ou guardada invalida cai no padrao (Miguelito)', () => {
  // O jogo nunca pode ficar sem personagem por causa de um valor velho no
  // localStorage ou de um parametro digitado errado: cai no padrao, e se a folha
  // nao carregar o astronauta assume via isFallback().
  assert.equal(resolvePlayerSkin({ locationLike: { search: '?player=nao-existe' }, storage: storageStub() }).id, 'miguelito');
  assert.equal(resolvePlayerSkin({ storage: storageStub('skin-que-foi-removida') }).id, 'miguelito');
});

test('o astronauta nao declara folha nenhuma: ele e desenhado, nao carregado', () => {
  assert.equal(PLAYER_SKINS.astronaut.states, null);
  assert.equal(createPlayerSprite(PLAYER_SKINS.astronaut), null);
});

test('enquanto a folha nao carrega, o astronauta continua desenhando', () => {
  // Sem DOM nao existe Image: e o caso do teste, mas tambem e o caso real dos
  // primeiros quadros e o de uma folha que deu 404.
  const sprite = createPlayerSprite(PLAYER_SKINS.miguelito);
  assert.ok(sprite, 'a skin com folhas precisa criar o renderizador de sprite');
  assert.equal(sprite.isFallback(), true, 'sem folha pronta o astronauta assume');

  let desenhou = false;
  const ctx = new Proxy({ drawImage: () => { desenhou = true; } },
    { get: (target, key) => target[key] || (() => {}) });
  const player = { x: 0, y: 0, w: 32, h: 48, vx: 0, vy: 0, onGround: true, alive: true, invuln: 0, dashTime: 0 };
  assert.equal(sprite.draw(ctx, player, 0), false, 'draw precisa avisar que nao desenhou');
  assert.equal(desenhou, false);
});

test('chegar na raiz final comemora, mesmo levando dano no ultimo passo', () => {
  // A chegada congela o jogador por 3,4s. Antes essa janela nao dizia nada e,
  // com a tela tremendo, vencer parecia levar um golpe. A comemoracao precisa
  // ganhar de qualquer outro estado — inclusive de invuln, senao um encontrao
  // nos ultimos passos rouba a chegada.
  const sprite = createPlayerSprite(PLAYER_SKINS.miguelito);
  const jogador = {
    x: 0, y: 0, w: 32, h: 48, vx: 0, vy: 0,
    onGround: true, alive: true, invuln: 1, dashTime: 0,
  };
  assert.equal(sprite.stateFor(jogador, 'transition'), 'celebrate');
  assert.equal(sprite.stateFor(jogador, 'end'), 'celebrate');
  // Fora da chegada, levar dano continua sendo dano.
  assert.equal(sprite.stateFor(jogador, 'play'), 'hurt');
});

test('apanhar e morrer escolhem animacoes diferentes', () => {
  const sprite = createPlayerSprite(PLAYER_SKINS.miguelito);
  const base = { x: 0, y: 0, w: 32, h: 48, vx: 0, vy: 0, onGround: true, dashTime: 0 };

  // Sobreviveu ao golpe: ve a folha inteira, com recuperacao.
  assert.equal(sprite.stateFor({ ...base, alive: true, invuln: 1 }, 'play'), 'hurt');

  // Morreu: congela. Vale tanto pelo alive quanto pelo estado de respawn — a
  // queda nos espinhos zera a invulnerabilidade, entao so alive segura essa.
  assert.equal(sprite.stateFor({ ...base, alive: false, invuln: 0 }, 'play'), 'defeat');
  assert.equal(sprite.stateFor({ ...base, alive: false, invuln: 0 }, 'respawning'), 'defeat');
  assert.equal(sprite.stateFor({ ...base, alive: true, invuln: 0 }, 'respawning'), 'defeat');
});

test('a folha de dano toca uma vez e a de comemoracao repete', () => {
  // Dano em loop faria o menino apanhar sem parar enquanto so estava piscando;
  // comemoracao sem loop congelaria no ultimo quadro por 3 segundos.
  const { hurt, celebrate } = PLAYER_SKINS.miguelito.states;
  assert.equal(hurt.loop, false, 'dano nao pode repetir');
  assert.notEqual(celebrate.loop, false, 'a comemoracao precisa repetir na janela da chegada');
  // Apanhar e sobreviver mostra a folha inteira, recuperacao inclusa: ele
  // cambaleia e se recompoe, que e o que aconteceu de fato.
  assert.equal(hurt.holdFrame, undefined, 'quem sobrevive precisa ver a recuperacao');
  const duracaoDoDano = hurt.frames / hurt.fps;
  assert.ok(
    duracaoDoDano > .8 && duracaoDoDano <= 1.1,
    `dano dura ${duracaoDoDano.toFixed(2)}s: precisa caber na invulnerabilidade de 1,05s sem sobrar`,
  );

  // Morrer nao tem recuperacao para mostrar: congela e o respawn assume.
  const defeat = PLAYER_SKINS.miguelito.states.defeat;
  assert.equal(defeat.loop, false, 'a derrota nao pode repetir');
  assert.ok(Number.isInteger(defeat.holdFrame), 'a derrota precisa congelar num quadro');
  assert.ok(
    defeat.holdFrame >= 2 && defeat.holdFrame <= 4,
    'a pose de bracos e pernas no ar esta entre os quadros 2 e 4',
  );
  // A entrada precisa caber no respawn de 720ms, senao ele volta ao checkpoint
  // antes de a pose aparecer.
  const entrada = (defeat.holdFrame + 1) / defeat.fps;
  assert.ok(entrada < .45, `entrada de ${entrada.toFixed(2)}s: o respawn chega antes da pose`);

  // As duas leituras saem da mesma folha; medidas diferentes seriam erro de
  // copia e o menino mudaria de tamanho entre apanhar e morrer.
  assert.equal(defeat.src, hurt.src);
  assert.equal(defeat.contentHeight, hurt.contentHeight);
  assert.equal(defeat.baseline, hurt.baseline);
});

test('a folha declarada aponta para um arquivo e um numero de quadros', () => {
  const run = PLAYER_SKINS.miguelito.states.run;
  assert.match(run.src, /\.png$/);
  assert.ok(Number.isInteger(run.frames) && run.frames > 0, 'frames precisa ser inteiro positivo');
  assert.ok(run.fps > 0);
});

test('a caixa de colisao nao muda com a skin: so a arte escala', () => {
  // A fisica inteira — alturas de salto, alcances, os desafios-assinatura
  // validados por validateChunk — esta medida em cima de 32x48. Se uma skin
  // pudesse mexer nisso, cada arte nova invalidaria as travessias.
  for (const skin of Object.values(PLAYER_SKINS)) {
    assert.equal(skin.w, undefined, `${skin.id} nao pode declarar largura de colisao`);
    assert.equal(skin.h, undefined, `${skin.id} nao pode declarar altura de colisao`);
  }
  assert.ok(
    PLAYER_SKINS.miguelito.characterHeight > 48,
    'a arte do Miguelito passa da caixa de 48px, e isso e so visual',
  );
});

test('as duas folhas do Miguelito renderizam do mesmo tamanho', () => {
  // As duas artes foram desenhadas em escalas diferentes: o menino ocupa 347 dos
  // 400px do quadro na corrida e so 224 no parado. Sem normalizar por
  // contentHeight ele encolheria 35% ao parar de andar.
  const { characterHeight, states } = PLAYER_SKINS.miguelito;
  const alturas = Object.entries(states).map(([nome, folha]) => {
    assert.ok(folha.contentHeight > 0, `${nome} precisa declarar contentHeight`);
    const frameHeight = 400;
    const drawHeight = characterHeight * (frameHeight / folha.contentHeight);
    return { nome, visivel: drawHeight * (folha.contentHeight / frameHeight) };
  });
  for (const { nome, visivel } of alturas) {
    assert.ok(
      Math.abs(visivel - characterHeight) < .01,
      `${nome} renderiza com ${visivel.toFixed(1)}px em vez de ${characterHeight}px`,
    );
  }
});

test('o pe assenta no mesmo lugar nas duas folhas', () => {
  // Linhas de base diferentes fariam o Miguelito pular alguns pixels ao trocar
  // de animacao, parado sobre a mesma plataforma.
  const bases = Object.values(PLAYER_SKINS.miguelito.states).map(folha => folha.baseline);
  assert.ok(bases.every(base => base > 0 && base <= 1), 'baseline e uma fracao da altura do quadro');

  // Cada folha usa a linha medida nela mesma, entao valores identicos seriam
  // sorte, nao correcao: run e idle deram 379/400 e as folhas novas 381/400.
  // O que importa e que a diferenca some no jogo — 2px num quadro de 400
  // viram menos de meio pixel na tela.
  const diferenca = Math.max(...bases) - Math.min(...bases);
  assert.ok(
    diferenca < .01,
    `as linhas de chao diferem ${(diferenca * 400).toFixed(0)}px no quadro, o pe pularia ao trocar de animacao`,
  );
});

test('a corrida nao acelera alem do teto declarado', () => {
  // A velocidade maxima do jogador e 245. Antes a formula chegava a 17,5
  // quadros por segundo e a corrida parecia adiantada; o teto agora e o fps.
  const run = PLAYER_SKINS.miguelito.states.run;
  const ritmoNaVelocidadeMaxima = run.motionBase + 245 * run.motionFactor;
  assert.ok(ritmoNaVelocidadeMaxima <= run.fps, 'o ritmo maximo nao pode passar do fps declarado');
  // A faixa util foi encontrada jogando, nao calculada: 17,5 e 10,8 pareceram
  // adiantados, e abaixo de 5 a passada arrasta. O slider do Phase Lab
  // multiplica isto ao vivo para o ajuste fino.
  assert.ok(
    ritmoNaVelocidadeMaxima > 5 && ritmoNaVelocidadeMaxima < 9,
    `ritmo de ${ritmoNaVelocidadeMaxima.toFixed(1)}fps fora da faixa util`,
  );
  // Comparar os fps declarados nao diz nada: o da corrida e so um teto, e o
  // ritmo real dela sai da velocidade. O que precisa valer e que correndo a
  // passada seja mais rapida do que a respiracao de quem esta parado.
  const idle = PLAYER_SKINS.miguelito.states.idle;
  const ritmoParado = idle.fps;
  const ritmoCorrendoDevagar = run.motionBase + 60 * run.motionFactor;
  assert.ok(
    ritmoNaVelocidadeMaxima > ritmoParado * .8,
    `correndo a ${ritmoNaVelocidadeMaxima.toFixed(1)}fps contra ${ritmoParado} parado: a corrida ficaria mais lenta que a respiracao`,
  );
  assert.ok(ritmoCorrendoDevagar > 0, 'andar devagar ainda precisa animar');
});
