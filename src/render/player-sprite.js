import { getPlayerTuning } from './player-skin-tuning.js';

// Skin de sprite para o jogador.
//
// O astronauta e desenhado a mao no canvas e funciona. Esta camada nao o
// substitui: ela se oferece como alternativa e some sozinha se qualquer coisa
// der errado. Sem folha configurada, folha que nao carrega, folha com medida
// impossivel — em todos os casos isFallback() responde true e o renderer
// continua desenhando o astronauta. Trocar de skin nunca pode ser um jeito de
// ficar sem personagem.
//
// A folha e uma tira horizontal de quadros de largura igual. A largura de cada
// quadro sai de image.width / frames, entao basta declarar quantos quadros a
// tira tem.

const STATE_FALLBACK = Object.freeze({
  idle: ['idle', 'run'],
  run: ['run', 'idle'],
  jump: ['jump', 'run', 'idle'],
  fall: ['fall', 'jump', 'run', 'idle'],
  dash: ['dash', 'run', 'idle'],
  hurt: ['hurt', 'idle', 'run'],
  defeat: ['defeat', 'hurt', 'idle', 'run'],
  celebrate: ['celebrate', 'idle', 'run'],
  pulse: ['pulse', 'idle', 'run'],
  // Ainda nao existe folha propria da mochila: cai na melhor pose aerea
  // disponivel e o jato e desenhado a parte pelo renderer.
  jetpack: ['jetpack', 'jump', 'fall', 'run', 'idle'],
});

function loadSheet(definition) {
  const sheet = {
    ...definition,
    image: null,
    ready: false,
    failed: false,
  };
  if (typeof Image === 'undefined') {
    sheet.failed = true;
    return sheet;
  }
  const image = new Image();
  image.onload = () => {
    // Uma folha sem largura util e tao inutil quanto uma que nao carregou, e
    // deixar passar renderiza um quadro de largura zero — personagem invisivel.
    if (!image.naturalWidth || !image.naturalHeight) { sheet.failed = true; return; }
    sheet.image = image;
    sheet.ready = true;
  };
  image.onerror = () => { sheet.failed = true; };
  image.src = definition.src;
  return sheet;
}

export function createPlayerSprite(skin) {
  if (!skin?.states) return null;

  const sheets = new Map();
  for (const [name, definition] of Object.entries(skin.states)) {
    sheets.set(name, loadSheet({ name, frames: 1, fps: 12, loop: true, ...definition }));
  }

  // Escala: a arte se ajusta ao jogo, nunca o contrario. A fisica esta medida e
  // calibrada em 32x48 — mudar a caixa para caber num desenho invalidaria todas
  // as travessias validadas.
  //
  // O tamanho e declarado como altura do personagem em pixels de jogo, e cada
  // folha diz quanto do seu quadro o personagem ocupa (contentHeight). Sem isso
  // o Miguelito encolhia ao parar: na folha de corrida ele ocupa 347 dos 400px
  // do quadro e na de parado so 224, entao a mesma escala aplicada as duas
  // daria dois personagens de tamanhos diferentes.
  // Relogio proprio da animacao. Guarda o instante do ultimo desenho para
  // converter o tempo de jogo em dt.
  let lastTime = null;
  let lastSheet = null;
  let lastRequested = null;
  let lastDrawn = null;

  // Um dt negativo (fase reiniciou, tempo voltou a zero) ou enorme (aba ficou
  // em segundo plano) nao pode empurrar o ciclo. Nos dois casos o certo e nao
  // avancar nada neste quadro.
  function clampDelta(delta) {
    if (!Number.isFinite(delta) || delta <= 0) return 0;
    return Math.min(delta, .1);
  }

  const declaredHeight = Number(skin.characterHeight) || 0;
  const heightScale = Number(skin.heightScale) || 1;
  const offsetX = Number(skin.offsetX) || 0;
  const offsetY = Number(skin.offsetY) || 0;

  function resolve(requested) {
    const chain = STATE_FALLBACK[requested] || [requested, 'idle', 'run'];
    for (const name of chain) {
      const sheet = sheets.get(name);
      if (sheet?.ready) return sheet;
    }
    for (const sheet of sheets.values()) if (sheet.ready) return sheet;
    return null;
  }

  function stateFor(player, gameState) {
    // Chegar a raiz final congela o jogador e abre uma janela de 3,4s antes da
    // proxima fase. Antes ela nao dizia nada — parado, com a tela tremendo, a
    // vitoria parecia dano. E o momento da comemoracao, e vem antes de tudo:
    // um golpe recebido nos ultimos passos nao pode roubar a chegada.
    if (gameState === 'transition' || gameState === 'end') return 'celebrate';
    // Morrer e apanhar sao coisas diferentes: quem morreu nao se recompoe, volta
    // do checkpoint. 'respawning' entra aqui porque o jogador continua morto
    // enquanto a tela treme e ele e devolvido ao ultimo biofilme.
    if (!player.alive || gameState === 'respawning') return 'defeat';
    if (player.invuln > 0) return 'hurt';
    if (player.dashTime > 0) return 'dash';
    // A propulsao tem pose propria e vem antes de jump/fall: enquanto a mochila
    // empurra, a leitura correta e "propulsionando", nao "subindo" ou "caindo".
    if (player.jetpackActive) return 'jetpack';
    if (!player.onGround) return player.vy < 0 ? 'jump' : 'fall';
    if (Math.abs(player.vx) > 12) return 'run';
    return 'idle';
  }

  function frameIndex(sheet, player, time) {
    const frames = Math.max(1, Math.floor(sheet.frames));
    if (frames === 1) return 0;

    // A corrida acompanha a velocidade: a passada acelera junto com o
    // personagem em vez de patinar num compasso fixo. O ritmo sai da folha —
    // constante escondida aqui vira animacao rapida demais sem nada para
    // ajustar. O fps declarado e o teto.
    const escala = sheet.speedFromMotion ? (getPlayerTuning().runSpeedScale || 1) : 1;
    const rate = escala * (sheet.speedFromMotion
      ? Math.min(sheet.fps, (sheet.motionBase ?? 3) + Math.abs(player.vx) * (sheet.motionFactor ?? .032))
      : sheet.fps);

    // O quadro sai de uma fase acumulada, nao de time * rate.
    //
    // Multiplicar o tempo absoluto por um ritmo que muda faz o produto saltar:
    // aos 30 segundos de jogo, o ritmo indo de 2 para 7,4 empurra o indice de
    // 60 para 222 de um quadro para o outro. Enquanto o jogador acelera, o
    // ritmo muda a cada quadro e a animacao embaralha — era a "aceleracao no
    // inicio do movimento lateral". Com velocidade constante o ritmo para de
    // mudar e por isso a caminhada continua sempre pareceu correta.
    //
    // Somando rate * dt, mudar o ritmo muda a velocidade daqui para a frente e
    // nunca a posicao atual do ciclo.
    const dt = clampDelta(time - lastTime);
    sheet.phase = (sheet.phase || 0) + rate * dt;

    const raw = Math.floor(sheet.phase);
    if (sheet.loop === false) {
      // holdFrame trava num quadro do meio em vez de correr ate o fim. Numa
      // folha de dano os ultimos quadros sao a recuperacao: passar por eles
      // devolve o personagem ao normal enquanto ele ainda esta invulneravel, e
      // o golpe perde o peso. Parar no quadro do impacto deixa a pose de susto
      // na tela pelo tempo todo.
      const ultimo = Number.isInteger(sheet.holdFrame)
        ? Math.min(frames - 1, sheet.holdFrame)
        : frames - 1;
      return Math.min(ultimo, raw);
    }
    return ((raw % frames) + frames) % frames;
  }

  function draw(ctx, player, time, gameState = null) {
    // Guardado para o diagnostico: saber QUAL estado foi pedido e QUAL folha
    // acabou desenhando e a unica forma de distinguir "a regra nao disparou" de
    // "a folha nao carregou e caiu no fallback". Sem isso so sobra teorizar em
    // cima de print.
    lastRequested = stateFor(player, gameState);
    const sheet = resolve(lastRequested);
    lastDrawn = sheet?.name || null;
    if (!sheet) { lastTime = time; return false; }

    // Trocar de animacao recomeca o ciclo dela. Sem isto uma folha que nao
    // repete — dash, dano — voltaria congelada no ultimo quadro da vez passada.
    if (sheet !== lastSheet) {
      sheet.phase = 0;
      lastSheet = sheet;
    }

    const frames = Math.max(1, Math.floor(sheet.frames));
    const frameWidth = sheet.image.naturalWidth / frames;
    const frameHeight = sheet.image.naturalHeight;
    if (!(frameWidth > 0) || !(frameHeight > 0)) return false;

    // Quando a folha declara quanto do quadro o personagem ocupa, o desenho e
    // dimensionado para que a altura VISIVEL bata com characterHeight — assim
    // trocar de folha nao muda o tamanho do Miguelito. Sem contentHeight, cai
    // no modo antigo de escalar pela caixa.
    // O slider do Phase Lab manda; a folha so define o padrao.
    const characterHeight = getPlayerTuning().characterHeight || declaredHeight;
    const drawHeight = characterHeight && sheet.contentHeight
      ? characterHeight * (frameHeight / sheet.contentHeight)
      : player.h * heightScale;
    const drawWidth = frameWidth * (drawHeight / frameHeight);
    const index = frameIndex(sheet, player, time);
    lastTime = time;

    // O renderer ja aplicou translate para o centro do jogador e o scale do
    // facing, entao aqui basta desenhar em torno da origem.
    //
    // O alinhamento e pela linha do pe, nao pelo fundo do quadro: quase toda
    // folha exportada tem vazio embaixo do personagem, e alinhar pelo fundo faz
    // ele flutuar essa sobra inteira acima da plataforma. baseline diz em que
    // fracao da altura do quadro esta o chao.
    const footY = player.h / 2;
    const baseline = Number.isFinite(sheet.baseline) ? sheet.baseline : 1;

    // Tentei somar aqui um solavanco de 13px para cima e 9px para tras no
    // impacto, e nao dava para ver. Medindo a folha entendi por que: o proprio
    // desenho ja levanta o menino 53px do chao no quadro 3, de 400 de quadro.
    // O deslocamento sempre esteve na arte; o que faltava era ficar nele.
    const top = footY - drawHeight * baseline + offsetY;
    ctx.drawImage(
      sheet.image,
      index * frameWidth, 0, frameWidth, frameHeight,
      -drawWidth / 2 + offsetX, top, drawWidth, drawHeight,
    );
    return true;
  }

  return {
    draw,
    // Exposto para teste: a escolha de estado e regra de jogo (a chegada ganha
    // do dano) e merece ser verificada sem depender de canvas.
    stateFor,
    // Enquanto nenhuma folha estiver pronta o astronauta continua no comando.
    // Isso cobre tanto a falha permanente quanto os primeiros quadros, antes de
    // a imagem terminar de carregar.
    isFallback: () => ![...sheets.values()].some(sheet => sheet.ready),
    debug: () => ({
      pedido: lastRequested,
      desenhado: lastDrawn,
      // Pedido e desenhado diferentes significam fallback: a regra disparou mas
      // a folha nao estava pronta.
      caiuNoFallback: Boolean(lastRequested && lastDrawn && lastRequested !== lastDrawn),
      folhas: [...sheets.entries()].map(([name, sheet]) => ({
        name, src: sheet.src, ready: sheet.ready, failed: sheet.failed, frames: sheet.frames,
      })),
    }),
  };
}
