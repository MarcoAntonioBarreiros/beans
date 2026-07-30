import assert from 'node:assert/strict';
import test from 'node:test';

import { RALSTONIA_DEFAULTS as C } from '../src/procgen/campaign-manifest.js';
import {
  RALSTONIA_STATES,
  isRalstoniaRootEligible,
  ralstoniaControlStrength,
  ralstoniaEnteredVascular,
  ralstoniaNetGrowth,
  ralstoniaStageForLoads,
  ralstoniaTargetProtection,
  ralstoniaVascularEfficiency,
  ralstoniaWoundPressure,
  selectRalstoniaSpreadTarget,
} from '../src/procgen/ralstonia-wilt-core.js';
import { createRandom } from '../src/procgen/random.js';

const stage = (surfaceLoad, vascularLoad, extra = {}) =>
  ralstoniaStageForLoads({ surfaceLoad, vascularLoad, ...extra });

function root(overrides = {}) {
  return {
    id: overrides.id || 'r1',
    logicIndex: overrides.logicIndex ?? 5,
    x: overrides.x ?? 0, y: 500, w: overrides.w ?? 200, h: 60,
    type: 'root',
    ...overrides,
  };
}

// ============================================================================
// MAQUINA DE ESTADOS
// ============================================================================

test('cada faixa de carga resolve para o estado correto', () => {
  assert.equal(stage(.20, 0), 'surface');
  assert.equal(stage(.20, C.vascularEntryThreshold - .001), 'surface', 'antes do limiar ainda e superficial');
  assert.equal(stage(.20, C.vascularEntryThreshold), 'entering');
  assert.equal(stage(.20, C.vascularColonizationThreshold), 'vascular');
  assert.equal(stage(.20, C.obstructionThreshold), 'obstructed');
  assert.equal(stage(.20, C.criticalThreshold), 'critical');
  assert.equal(stage(.20, 1), 'critical');
});

test('contained e neutralized sao estados persistentes, nao derivados da carga', () => {
  // A mesma carga vascular pode ser 'vascular' ou 'contained': o que muda e o
  // controle sustentado, decidido pelo runtime.
  assert.equal(stage(.2, .40), 'vascular');
  assert.equal(stage(.2, .40, { contained: true }), 'contained');
  assert.equal(stage(0, 0, { neutralized: true }), 'neutralized');
});

test('murcha critica vence a contencao: nao da para esconder um foco critico', () => {
  assert.equal(stage(.2, .90, { contained: true }), 'critical');
});

test('todos os estados declarados sao alcancaveis', () => {
  const alcancados = new Set([
    stage(.2, 0), stage(.2, .08), stage(.2, .30), stage(.2, .58), stage(.2, .82),
    stage(.2, .4, { contained: true }), stage(0, 0, { neutralized: true }),
  ]);
  assert.deepEqual([...alcancados].sort(), [...RALSTONIA_STATES].sort());
});

// ============================================================================
// PREVENCAO (antes da entrada)
// ============================================================================

const feridaMedia = { surfaceLoad: .20, vascularLoad: 0, woundPressure: .45 };

test('sem controle nenhum a carga superficial cresce', () => {
  const g = ralstoniaNetGrowth(feridaMedia);
  assert.ok(g.surfaceRate > 0, `superficie deveria crescer, deu ${g.surfaceRate}`);
  assert.ok(g.vascularRate > 0, 'e a pressao de entrada deveria avancar');
  assert.equal(g.holdingSurface, false);
});

test('Bacillus sozinho previne: superficie encolhe e a entrada trava', () => {
  const g = ralstoniaNetGrowth({ ...feridaMedia, bacillusControl: .8 });
  assert.ok(g.surfaceRate < 0, `com Bacillus a superficie deveria encolher, deu ${g.surfaceRate}`);
  assert.equal(g.vascularRate, 0, 'a entrada precisa ficar bloqueada');
  assert.equal(g.holdingSurface, true);
});

test('cada especie tem seu ponto forte: Bacillus previne, Pseudomonas contem', () => {
  // Nenhuma das duas e obrigatoria, mas elas nao sao intercambiaveis.
  // Bacillus e barreira LOCAL sobre o ferimento: sozinho, reverte a superficie.
  const bacillusSozinho = ralstoniaNetGrowth({ ...feridaMedia, bacillusControl: .8 });
  assert.ok(bacillusSozinho.surfaceRate < 0, 'Bacillus sozinho tem de conseguir prevenir');

  // Pseudomonas sozinha DESACELERA a superficie, mas o forte dela e o xilema.
  const pseudoSozinha = ralstoniaNetGrowth({ ...feridaMedia, pseudomonasControl: .9 });
  const semNinguem = ralstoniaNetGrowth(feridaMedia);
  assert.ok(
    pseudoSozinha.surfaceRate < semNinguem.surfaceRate,
    'Pseudomonas precisa reduzir a multiplicacao superficial',
  );

  // E sozinha ela CONTEM uma infeccao que ja entrou.
  const contendo = ralstoniaNetGrowth({
    surfaceLoad: .2, vascularLoad: .35, woundPressure: .4, pseudomonasControl: .9,
  });
  assert.ok(contendo.vascularRate <= 0, 'Pseudomonas sozinha tem de conseguir conter');
  assert.equal(contendo.holdingVascular, true);
});

test('a combinacao e mais eficiente que cada uma isolada', () => {
  const so_b = ralstoniaNetGrowth({ ...feridaMedia, bacillusControl: .6 }).surfaceRate;
  const so_p = ralstoniaNetGrowth({ ...feridaMedia, pseudomonasControl: .6 }).surfaceRate;
  const ambos = ralstoniaNetGrowth({ ...feridaMedia, bacillusControl: .6, pseudomonasControl: .6 }).surfaceRate;
  assert.ok(ambos < so_b && ambos < so_p, 'a dupla precisa superar cada uma sozinha');
});

test('a sinergia e soma complementar, nunca multiplicacao exponencial', () => {
  const b = ralstoniaControlStrength({ bacillus: .8, pseudomonas: 0 });
  const p = ralstoniaControlStrength({ bacillus: 0, pseudomonas: .8 });
  const ambos = ralstoniaControlStrength({ bacillus: .8, pseudomonas: .8 });
  assert.ok(ambos > b && ambos > p);
  assert.ok(ambos <= b + p + .2, `sinergia explosiva: ${ambos} contra ${b}+${p}`);
  assert.ok(ambos <= 1.25, 'existe teto');
});

test('a sinergia pesa mais ANTES da entrada do que depois', () => {
  const antes = ralstoniaControlStrength({ bacillus: .7, pseudomonas: .7, stage: 'surface' });
  const depois = ralstoniaControlStrength({ bacillus: .7, pseudomonas: .7, stage: 'vascular' });
  assert.ok(antes > depois, 'prevenir tem de ser mais eficiente que remediar');
});

test('ferida maior acelera a doenca; raiz integra quase nao permite entrada', () => {
  const integra = ralstoniaNetGrowth({ surfaceLoad: .2, vascularLoad: 0, woundPressure: 0 });
  const ferida = ralstoniaNetGrowth({ surfaceLoad: .2, vascularLoad: 0, woundPressure: .9 });
  assert.ok(ferida.surfaceRate > integra.surfaceRate);
  assert.equal(integra.vascularRate, 0, 'sem ferida nao ha entrada');
  assert.ok(ferida.vascularRate > 0);
});

// ============================================================================
// CONTENCAO (depois da entrada)
// ============================================================================

test('um foco que ja entrou no xilema NUNCA conta como prevencao', () => {
  assert.equal(ralstoniaEnteredVascular({ vascularLoad: C.vascularEntryThreshold - .001 }), false);
  assert.equal(ralstoniaEnteredVascular({ vascularLoad: C.vascularEntryThreshold }), true);
  // E a marca fica: mesmo que a carga caia depois, ele entrou.
  assert.equal(ralstoniaEnteredVascular({ vascularLoad: .01, everEnteredVascular: true }), true);
});

test('controle sustentado zera o crescimento vascular (contencao)', () => {
  const g = ralstoniaNetGrowth({
    surfaceLoad: .2, vascularLoad: .35, woundPressure: .4,
    bacillusControl: .85, pseudomonasControl: .9,
  });
  assert.ok(g.vascularRate <= 0, `deveria segurar, deu ${g.vascularRate}`);
  assert.equal(g.holdingVascular, true);
});

test('retirar o controle devolve o crescimento vascular', () => {
  const semControle = ralstoniaNetGrowth({ surfaceLoad: .2, vascularLoad: .35, woundPressure: .4 });
  assert.ok(semControle.vascularRate > 0, 'sem controle a infeccao volta a avancar');
  assert.equal(semControle.holdingVascular, false);
});

test('mesmo o controle maximo nao esteriliza o xilema instantaneamente', () => {
  const g = ralstoniaNetGrowth({
    surfaceLoad: 0, vascularLoad: .5, woundPressure: 0,
    bacillusControl: 1, pseudomonasControl: 1,
  });
  // Cai, mas devagar: nada de sumir num frame.
  assert.ok(g.vascularRate < 0);
  assert.ok(g.vascularRate > -.2, `queda rapida demais (${g.vascularRate}/s) parece cura`);
});

// ============================================================================
// TRANSPORTE VASCULAR
// ============================================================================

test('a eficiencia vascular cai com a carga e nunca chega a zero', () => {
  assert.equal(ralstoniaVascularEfficiency({ vascularLoad: 0, surfaceLoad: 0 }), 1);
  const meio = ralstoniaVascularEfficiency({ vascularLoad: .5 });
  assert.ok(meio > .5 && meio < .6, `esperado ~0.57, deu ${meio}`);
  const cheio = ralstoniaVascularEfficiency({ vascularLoad: 1, surfaceLoad: 1 });
  assert.equal(cheio, .08, 'existe piso: a raiz nunca fica com transporte zero');
  // A carga superficial pesa pouco: quem entope o vaso e a colonizacao interna.
  const soSuperficie = ralstoniaVascularEfficiency({ surfaceLoad: 1, vascularLoad: 0 });
  assert.ok(soSuperficie > .9, 'contaminacao externa quase nao afeta o transporte');
});

// ============================================================================
// FERIMENTOS
// ============================================================================

test('a pressao de ferimento soma as fontes de lesao do jogo', () => {
  assert.equal(ralstoniaWoundPressure(root({ rootHealth: 1 })), 0, 'raiz integra nao tem porta');
  assert.ok(ralstoniaWoundPressure(root({ meloidogyneBurden: .8 })) > .3, 'galhas abrem porta');
  assert.ok(ralstoniaWoundPressure(root({ rhizoctoniaColonization: .8 })) > .3, 'lesao de Rhizoctonia tambem');
  assert.ok(ralstoniaWoundPressure(root({ rootHealth: .3 })) > .3, 'raiz debilitada tambem');
});

test('o marcador autoral NAO fica como maximo eterno da porta', () => {
  // Antes `ralstoniaWoundPressure` fazia Math.max(root.ralstoniaEntryWound, ...):
  // a porta ficava travada em .45 para sempre e nem Azospirillum, nem saude, nem
  // controlar Rhizoctonia/Meloidogyne conseguiam fecha-la. O valor inicial da
  // estreia agora vive no FOCO (woundOpening) e cicatriza.
  const r = root({ ralstoniaEntryWound: .45, rootHealth: 1, rootGameplayDamage: 0 });
  assert.equal(ralstoniaWoundPressure(r), 0, 'raiz integra nao tem porta, marcador legado ou nao');
});

// ============================================================================
// ELEGIBILIDADE E DISSEMINACAO
// ============================================================================

test('a raiz final e as estruturas nunca recebem foco', () => {
  assert.equal(isRalstoniaRootEligible(root()), true);
  assert.equal(isRalstoniaRootEligible(root({ final: true })), false, 'contaminar a chegada seria beco sem saida');
  assert.equal(isRalstoniaRootEligible(root({ recovery: true })), false);
  assert.equal(isRalstoniaRootEligible(root({ safetyStep: true })), false);
  assert.equal(isRalstoniaRootEligible(root({ mycorrhizaStructure: true })), false);
  assert.equal(isRalstoniaRootEligible(root({ azospirillumLadderStep: true })), false);
  assert.equal(isRalstoniaRootEligible({ ...root(), type: 'soil' }), false);
  assert.equal(isRalstoniaRootEligible(root({ w: 80 })), false, 'raiz estreita demais');
  assert.equal(isRalstoniaRootEligible(null), false);
});

function campoDeDisseminacao() {
  const origem = root({ id: 'origem', x: 0, w: 200, rootHealth: .2 });
  return {
    origem,
    perto: root({ id: 'perto', x: 150, w: 200, rootHealth: .2 }),     // < minimo
    boa: root({ id: 'boa', x: 500, w: 200, rootHealth: .2 }),          // na faixa
    integra: root({ id: 'integra', x: 620, w: 200 }),                            // sem ferida
    longe: root({ id: 'longe', x: 2000, w: 200, rootHealth: .2 }),      // > maximo
    finalRoot: root({ id: 'final', x: 560, w: 200, final: true, rootHealth: .1 }),
  };
}

test('a disseminacao respeita distancia minima, maxima e exige ferida', () => {
  const c = campoDeDisseminacao();
  const alvo = selectRalstoniaSpreadTarget({
    source: { root: c.origem },
    roots: [c.perto, c.boa, c.integra, c.longe, c.finalRoot],
    random: () => 0,
  });
  assert.equal(alvo, c.boa, 'so a raiz ferida dentro da faixa serve');
});

test('a disseminacao nunca escolhe a raiz final nem uma ja contaminada', () => {
  const c = campoDeDisseminacao();
  assert.equal(
    selectRalstoniaSpreadTarget({
      source: { root: c.origem }, roots: [c.finalRoot], random: () => 0,
    }), null, 'a raiz final esta fora',
  );
  assert.equal(
    selectRalstoniaSpreadTarget({
      source: { root: c.origem }, roots: [c.boa], occupied: new Set([c.boa]), random: () => 0,
    }), null, 'raiz que ja tem foco nao recebe outro',
  );
});

test('a mesma seed escolhe sempre o mesmo alvo (sem Math.random)', () => {
  const escolher = () => {
    const c = campoDeDisseminacao();
    const outra = root({ id: 'outra', x: 700, w: 200, rootHealth: .2 });
    return selectRalstoniaSpreadTarget({
      source: { root: c.origem },
      roots: [c.boa, outra],
      random: createRandom('seed-fixa:ralstonia'),
    })?.id;
  };
  assert.equal(escolher(), escolher());
  assert.ok(escolher(), 'precisa encontrar algum alvo');
});

test('a protecao da raiz-alvo bloqueia a chegada', () => {
  assert.equal(ralstoniaTargetProtection({ bacillus: 0, pseudomonas: 0 }), 0);
  assert.ok(ralstoniaTargetProtection({ bacillus: .9 }) > .5, 'Bacillus forte bloqueia');
  assert.ok(ralstoniaTargetProtection({ pseudomonas: 1 }) >= .5, 'Pseudomonas forte tambem');
  assert.ok(ralstoniaTargetProtection({ bacillus: .2, pseudomonas: .2 }) < .5, 'protecao fraca nao bloqueia');
});

// ============================================================================
// OS DEMAIS ORGANISMOS NAO CONTROLAM RALSTONIA
// ============================================================================

test('so Bacillus e Pseudomonas entram na conta do controle', () => {
  // A assinatura de ralstoniaControlStrength nao aceita nenhum outro organismo:
  // Trichoderma, micorriza, Rhizobium e Azospirillum nao tem como reduzir carga.
  const semNinguem = ralstoniaControlStrength({});
  assert.equal(semNinguem, 0);
  // Passar qualquer outra chave e inerte por construcao.
  const comIntrusos = ralstoniaControlStrength({
    trichoderma: 1, mycorrhiza: 1, rhizobium: 1, azospirillum: 1,
  });
  assert.equal(comIntrusos, 0, 'nenhum outro organismo pode controlar a bacteria');
});

test('sem Bacillus nem Pseudomonas a doenca avanca, por mais organismos que existam', () => {
  const g = ralstoniaNetGrowth({ surfaceLoad: .3, vascularLoad: .2, woundPressure: .5 });
  assert.ok(g.vascularRate > 0, 'nada alem da dupla certa segura a murcha');
});
