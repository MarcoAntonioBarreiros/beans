import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  DESKTOP_ZOOM_PROFILE,
  TOUCH_ZOOM_PROFILE,
  isTouchDevice,
  zoomProfileFor,
} from '../src/procgen/touch-profile.js';

// CARTÃO TUTORIAL NO CELULAR E PERFIL DE ZOOM PRÓPRIO
// ===================================================
//
// O cartão quebrava em celular, e pior em paisagem: título, corpo, tópicos,
// ciclo e as setas de navegação disputavam o mesmo espaço, e o texto que não
// coubesse ficava inalcançável.
//
// A causa foi MEDIDA no navegador antes de qualquer edição. A área de papel
// (`.tutorial-paper-content`) tem altura FIXA — uma fração da arte — com três
// linhas de grid onde a primeira e a terceira são `auto`. Sem `overflow`, as
// linhas automáticas cresciam para fora da folha. Em 360x640: caixa de 133px,
// bloco do ciclo terminando 133px ABAIXO dela e 130px por cima das setas, com a
// região rolável esmagada a ZERO. Vinte das vinte e quatro combinações
// (4 cartões longos x 6 resoluções) estavam nesse estado; só o desktop passava.
//
// Estes testes guardam o contrato do conserto. A verificação de pixels fica no
// navegador — aqui está o que não pode regredir em silêncio.

const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const CSS = source('src/procgen/tutorial-overlay.css');

// Recorta um bloco de regra pelo seletor, para as asserções não pegarem
// declarações de outro lugar do arquivo.
function regra(seletor, apartirDe = 0) {
  const inicio = CSS.indexOf(seletor, apartirDe);
  assert.notEqual(inicio, -1, `seletor ausente: ${seletor}`);
  const abre = CSS.indexOf('{', inicio);
  const fecha = CSS.indexOf('}', abre);
  return CSS.slice(abre, fecha);
}

// --- PERFIS DE ZOOM ---------------------------------------------------------

function janela({ coarse = false, touchPoints = 0, compact = false } = {}) {
  return {
    navigator: { maxTouchPoints: touchPoints },
    matchMedia(query) {
      if (query.includes('pointer: coarse')) return { matches: coarse };
      if (query.includes('max-width: 900px')) return { matches: compact };
      return { matches: false };
    },
  };
}

test('perfil desktop mantem padrao 1,45 e maximo 1,8', () => {
  assert.equal(DESKTOP_ZOOM_PROFILE.default, 1.45);
  assert.equal(DESKTOP_ZOOM_PROFILE.min, 1);
  assert.equal(DESKTOP_ZOOM_PROFILE.max, 1.8);
  assert.equal(DESKTOP_ZOOM_PROFILE.step, .1);
  assert.equal(zoomProfileFor(janela()), DESKTOP_ZOOM_PROFILE);
});

test('perfil movel comeca em 1,6 e permite ate 2,8', () => {
  assert.equal(TOUCH_ZOOM_PROFILE.default, 1.6);
  assert.equal(TOUCH_ZOOM_PROFILE.min, 1);
  assert.equal(TOUCH_ZOOM_PROFILE.max, 2.8);
  assert.equal(TOUCH_ZOOM_PROFILE.step, .1);
  assert.equal(zoomProfileFor(janela({ coarse: true })), TOUCH_ZOOM_PROFILE);
});

test('notebook hibrido nao vira celular so por ter toque', () => {
  // Tela sensivel numa janela larga continua sendo computador. Era exatamente o
  // que a camera errava: ela olhava so `maxTouchPoints`.
  assert.equal(isTouchDevice(janela({ touchPoints: 10, compact: false })), false);
  assert.equal(zoomProfileFor(janela({ touchPoints: 10, compact: false })), DESKTOP_ZOOM_PROFILE);
  // Com toque E janela estreita, e celular.
  assert.equal(isTouchDevice(janela({ touchPoints: 5, compact: true })), true);
  // Ponteiro grosso basta, em qualquer largura.
  assert.equal(isTouchDevice(janela({ coarse: true, compact: false })), true);
});

test('a camera usa o MESMO criterio dos controles touch', () => {
  const camera = source('src/procgen/camera-view.js');
  const controles = source('src/procgen/mobile-controls.js');
  assert.match(camera, /from '\.\/touch-profile\.js'/);
  assert.match(controles, /from '\.\/touch-profile\.js'/);
  // E nenhum dos dois reimplementa o criterio por conta propria.
  assert.ok(!/maxTouchPoints > 0 && compactTouchViewport/.test(controles));
  // O perfil e escolhido UMA vez, na criacao.
  assert.match(camera, /const profile = zoomProfileFor\(windowObject\);/);
});

test('reset volta ao padrao do PERFIL, nao a um valor global', () => {
  const camera = source('src/procgen/camera-view.js');
  const reset = regraDe(camera, 'function resetZoom()');
  assert.ok(reset.includes('profile.default'), 'resetZoom tem que usar o perfil');
  // As constantes globais sumiram (CINEMATIC_MIN_ZOOM nao conta: e da cena
  // final, nao do perfil do jogador).
  assert.ok(!/\bDEFAULT_ZOOM\b|(?<!CINEMATIC_)\bMIN_ZOOM\b|\bMAX_ZOOM\b|\bZOOM_STEP\b/.test(camera));
  // Simulacao do contrato: desktop volta a 1,45; celular volta a 1,6.
  assert.equal(zoomProfileFor(janela()).default, 1.45);
  assert.equal(zoomProfileFor(janela({ coarse: true })).default, 1.6);
});

function regraDe(fonte, marca) {
  const i = fonte.indexOf(marca);
  assert.notEqual(i, -1, `trecho ausente: ${marca}`);
  const abre = fonte.indexOf('{', i);
  return fonte.slice(abre, fonte.indexOf('\n  }', abre));
}

test('a cinematica continua podendo passar do minimo do jogador', () => {
  const camera = source('src/procgen/camera-view.js');
  assert.match(camera, /const CINEMATIC_MIN_ZOOM = \.22;/);
  // O piso da cinematica e menor que o minimo de QUALQUER perfil de jogador.
  assert.ok(.22 < DESKTOP_ZOOM_PROFILE.min);
  assert.ok(.22 < TOUCH_ZOOM_PROFILE.min);
  // E `setCinematic` usa esse piso, nao o do perfil.
  assert.match(camera, /clamp\(value, CINEMATIC_MIN_ZOOM, profile\.max\)/);
});

test('o readout nao nasce com valor fixo no HTML', () => {
  const html = source('index.html');
  const botao = html.slice(html.indexOf('data-camera-readout'));
  const conteudo = botao.slice(botao.indexOf('>') + 1, botao.indexOf('</button>'));
  assert.equal(conteudo.trim(), '', 'o HTML nao pode carimbar 1.45x');
  // Quem escreve e o refreshReadout, com o alvo atual.
  assert.match(source('src/procgen/camera-view.js'), /readout\.textContent = `\$\{targetZoom\.toFixed\(2\)\}×`/);
});

// --- LAYOUT DO CARTÃO -------------------------------------------------------

test('a folha do cartao contem o que cresce, em vez de deixar vazar', () => {
  const paper = regra('.tutorial-panel--card .tutorial-paper-content');
  assert.ok(paper.includes('overflow: hidden'), 'sem contencao o ciclo cai sobre as setas');
  assert.ok(paper.includes('min-height: 0'));
  assert.ok(paper.includes('min-width: 0'));
  // Quatro regioes distintas: cabecalho, pagina e ciclo em linhas proprias do
  // grid; o rodape e absoluto, fora da folha.
  assert.match(paper, /grid-template-rows:\s*minmax\(0, auto\)\s*minmax\(0, 1fr\)\s*minmax\(0, auto\)/);
  const footer = regra('.tutorial-panel--card .tutorial-nav-image');
  assert.ok(footer.includes('position: absolute'));
});

test('a regiao rolavel aceita o gesto do dedo', () => {
  const scroll = regra('.tutorial-panel--card .tutorial-page-scroll');
  assert.ok(scroll.includes('overflow-y: auto'));
  assert.ok(scroll.includes('overflow-x: hidden'));
  assert.ok(scroll.includes('touch-action: pan-y'), 'a sobreposicao declara touch-action: none');
  assert.ok(scroll.includes('overscroll-behavior: contain'));
  assert.ok(scroll.includes('-webkit-overflow-scrolling: touch'));
  // E a sobreposicao continua bloqueando o arrasto da pagina por tras.
  assert.ok(regra('.tutorial-overlay {').includes('touch-action: none'));
});

test('em celular em pe quem rola e a folha inteira, com o cabecalho preso', () => {
  const bloco = CSS.slice(CSS.indexOf('@media (max-width: 560px) and (orientation: portrait)'));
  assert.ok(bloco.includes('overflow-y: auto'), 'a folha vira o scroller');
  assert.ok(bloco.includes('touch-action: pan-y'));
  assert.ok(bloco.includes('position: sticky'), 'o nome do organismo nao pode sair da vista');
  // Um scroller so: o miolo para de rolar por dentro do que ja rola por fora.
  assert.ok(bloco.includes('overflow: visible !important'));
});

test('a tipografia acompanha o tamanho do cartao', () => {
  // O cartao encolhe com a tela; pisos em px de desktop travavam a tipografia
  // dentro de uma folha tres vezes menor. Todo tamanho de texto do cartao usa
  // `clamp` com unidade de container.
  const escopo = CSS.slice(CSS.indexOf('.tutorial-panel--card .tutorial-title'));
  for (const seletor of [
    '.tutorial-panel--card .tutorial-title',
    '.tutorial-panel--card .tutorial-subtitle',
    '.tutorial-panel--card .tutorial-page-title',
    '.tutorial-panel--card .tutorial-page-body',
    '.tutorial-panel--card .tutorial-page-points',
    '.tutorial-panel--card .tutorial-cycle-step',
    '.tutorial-panel--card .tutorial-page-counter',
  ]) {
    const bloco = regra(seletor);
    assert.match(bloco, /font-size: clamp\([^)]*cqw[^)]*\)/, `${seletor} sem clamp em cqw`);
  }
  // O piso do titulo desceu de 26px: em 360x640 o cartao inteiro tem 345px.
  assert.match(escopo, /font-size: clamp\(15px, 4\.2cqw, 50px\)/);
  // E o container de consulta existe.
  assert.ok(regra('.tutorial-panel--card .tutorial-card-view').includes('container-type: inline-size'));
});

test('o ciclo quebra em varias linhas e nao estoura na horizontal', () => {
  const ciclo = regra('.tutorial-panel--card .tutorial-cycle {');
  assert.ok(ciclo.includes('flex-wrap: wrap'));
  const passo = regra('.tutorial-panel--card .tutorial-cycle-step');
  assert.ok(passo.includes('white-space: nowrap'), 'o nome da etapa nao quebra no meio');
});

test('a area util do cartao cresce em tela pequena, e o desktop fica como estava', () => {
  const padrao = regra('.tutorial-panel--card .tutorial-card-view');
  assert.ok(padrao.includes('--paper-width: 58%'), 'desktop inalterado');
  assert.ok(padrao.includes('--paper-height: 51.5%'), 'desktop inalterado');
  const pequeno = CSS.slice(CSS.indexOf('@media (max-width: 900px), (max-height: 560px)'));
  assert.match(pequeno, /--paper-width: 62%/);
  assert.match(pequeno, /--paper-height: 60%/);
});

test('no celular o texto do papel escurece (mantendo o matiz) e o titulo desce', () => {
  // Desktop mantem o verde medio aprovado.
  assert.ok(regra('.tutorial-panel--card .tutorial-title').includes('#5f8739'), 'desktop inalterado');
  const pequeno = CSS.slice(CSS.indexOf('@media (max-width: 900px), (max-height: 560px)'));
  // No creme (#eddab8) o verde medio perdia contraste: mobile usa um verde mais escuro.
  assert.match(pequeno, /\.tutorial-title[\s\S]*?#435f28/, 'titulo do papel nao escureceu no mobile');
  assert.match(pequeno, /\.tutorial-cycle-link[\s\S]*?#4e612d/, 'link do ciclo nao escureceu no mobile');
  // Titulo um pouco mais baixo dentro da folha.
  assert.match(pequeno, /\.tutorial-panel--card \.tutorial-title \{ margin-top: \.38em/, 'titulo nao desceu');
});

test('trocar de pagina devolve a rolagem ao topo', () => {
  const manager = source('src/procgen/tutorial-manager.js');
  assert.match(manager, /const pageScroll = mount\.querySelector\('\.tutorial-page-scroll'\);/);
  const render = manager.slice(manager.indexOf('function renderCard()'), manager.indexOf('const finalPage'));
  assert.ok(render.includes('pageScroll.scrollTop = 0'), 'a rolagem da pagina anterior vazava para a seguinte');
});
