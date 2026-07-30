// Catalogo de skins do jogador.
//
// "astronaut" nao tem folha: e o desenho a mao que sempre existiu, e continua
// sendo o padrao. Nenhuma skin nova pode tira-lo do caminho — ele e a rede de
// seguranca de todas as outras.
//
// Para experimentar o Miguelito: ?player=miguelito
// Para voltar:                    ?player=astronaut
// A escolha fica guardada, entao da para testar varias fases sem repetir o
// parametro.

export const PLAYER_SKIN_STORAGE_KEY = 'miguelito:player-skin:v1';

export const PLAYER_SKINS = Object.freeze({
  astronaut: Object.freeze({
    id: 'astronaut',
    label: 'Astronauta (desenhado)',
    states: null,
  }),

  miguelito: Object.freeze({
    id: 'miguelito',
    label: 'Miguelito (sprites)',
    // Altura visivel do personagem em pixels de jogo. A caixa de colisao
    // continua 32x48 — cabeca e mochila passam dela, como em quase todo
    // personagem de plataforma. Este e o numero para mexer se ele parecer
    // pequeno ou grande demais; nada aqui altera a fisica.
    characterHeight: 64,
    offsetX: 0,
    // Medido quadro a quadro, o pe ficava de 1 a 3px acima da plataforma. Esses
    // 2px encostam o passo mais baixo no chao; a variacao que sobra e o balanco
    // natural da corrida, nao erro de encaixe.
    offsetY: 2,
    states: Object.freeze({
      run: Object.freeze({
        src: 'assets/miguelito/run.png',
        // Medido na folha: 2560x400, oito quadros de exatamente 320px.
        frames: 8,
        // Teto do ritmo. O ponto foi caindo a cada teste jogando: 17,5 quadros
        // por segundo na velocidade maxima (245), depois 10,8, depois 7,4 — e
        // ainda parecia adiantado. Agora 1,5 + 245*0,016 da ~5,4. O slider do
        // Phase Lab multiplica isso ao vivo para o ajuste fino.
        fps: 6,
        speedFromMotion: true,
        motionBase: 1.5,
        motionFactor: .016,
        // O pe mais baixo da folha esta na linha 379 de 400: sobra 20px de
        // vazio embaixo. Sem isto o personagem flutua essa sobra inteira.
        baseline: 379 / 400,
        // Quanto do quadro o personagem ocupa. Serve para as duas folhas
        // renderizarem do mesmo tamanho, apesar de a arte ter sido desenhada em
        // escalas diferentes.
        contentHeight: 347,
      }),
      idle: Object.freeze({
        src: 'assets/miguelito/idle.png',
        frames: 8,
        // Respiracao, nao caminhada: devagar de proposito.
        fps: 6,
        baseline: 379 / 400,
        // Nesta folha o menino foi desenhado bem menor: 224 dos 400px, contra
        // 347 na corrida. Sem normalizar, ele encolheria ao parar de andar.
        contentHeight: 224,
      }),
      // Levar dano e morrer sao duas leituras diferentes da MESMA folha, e
      // tratar as duas como uma so foi o erro das rodadas anteriores.
      //
      // hurt: o menino apanhou e continua de pe. A folha corre inteira, com os
      // quadros de recuperacao (4 a 7), no ritmo original. Ele apanha, cambaleia
      // e se recompoe — que e o que de fato aconteceu.
      hurt: Object.freeze({
        src: 'assets/miguelito/hurt.png',
        frames: 8,
        // 8 quadros a 8fps dao 1s, dentro da invulnerabilidade de 1,05s: a
        // recuperacao termina junto com a protecao.
        fps: 8,
        loop: false,
        // Aqui a base varia 53px porque o personagem sai do chao no empurrao.
        // A referencia e o quadro mais baixo, onde ele esta apoiado.
        baseline: 381 / 400,
        contentHeight: 329,
      }),
      // defeat: acabaram os coracoes, ou caiu nos espinhos. Nao ha recuperacao
      // para mostrar — ele nao se recompoe, ele volta do checkpoint. Entra
      // rapido e congela no quadro 4, que fica na tela ate o respawn.
      defeat: Object.freeze({
        src: 'assets/miguelito/hurt.png',
        frames: 8,
        // Rapido so ate chegar la: 5 quadros a 24fps sao ~208ms de entrada, e o
        // respawn leva 720ms — sobra meio segundo de pose congelada.
        fps: 24,
        loop: false,
        holdFrame: 4,
        baseline: 381 / 400,
        contentHeight: 329,
      }),
      // Repete durante os 3,4s entre chegar na raiz final e a proxima fase.
      celebrate: Object.freeze({
        src: 'assets/miguelito/celebrate.png',
        frames: 8,
        fps: 6,
        baseline: 381 / 400,
        contentHeight: 337,
      }),
      // Quando as outras folhas chegarem, e so descomentar e ajustar frames:
      // idle:      { src: 'assets/miguelito/idle.png', frames: 4, fps: 6 },
      // jump:      { src: 'assets/miguelito/jump.png', frames: 4, fps: 10, loop: false },
      // dash:      { src: 'assets/miguelito/dash.png', frames: 3, fps: 14, loop: false },
      // hurt:      { src: 'assets/miguelito/hurt.png', frames: 3, fps: 10, loop: false },
      // celebrate: { src: 'assets/miguelito/celebrate.png', frames: 6, fps: 10 },
      // pulse:     { src: 'assets/miguelito/pulse.png', frames: 5, fps: 12, loop: false },
    }),
  }),
});

export function resolvePlayerSkin({ locationLike = null, storage = null } = {}) {
  const requested = new URLSearchParams(locationLike?.search || '').get('player');
  if (requested && PLAYER_SKINS[requested]) {
    try { storage?.setItem(PLAYER_SKIN_STORAGE_KEY, requested); } catch (_) {}
    return PLAYER_SKINS[requested];
  }
  let saved = null;
  try { saved = storage?.getItem(PLAYER_SKIN_STORAGE_KEY); } catch (_) {}
  // Um valor guardado que nao existe mais no catalogo nao pode deixar o jogo
  // sem personagem: cai no astronauta.
  // Miguelito e o padrao em todo browser (antes exigia preferencia salva, entao
  // so aparecia onde ja tinha sido ativado). O astronauta continua como rede de
  // seguranca automatica: se qualquer folha nao carregar, createPlayerSprite()
  // .isFallback() volta true e o renderer desenha o astronauta.
  return PLAYER_SKINS[saved] || PLAYER_SKINS.miguelito;
}
