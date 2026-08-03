import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { hyphalWorldBounds } from '../src/procgen/world-bounds.js';
import { createHyphalNetwork, updateHyphalNetwork } from '../src/procgen/hyphal-growth.js';
import { H } from '../src/core/constants.js';

// LIMITES VERTICAIS DAS HIFAS
// ===========================
//
// Micorriza, Trichoderma e o fungo oportunista prendiam as pontas em faixas
// absolutas — [58, H-48], [54, H-48], [48, H-48] — escritas quando o mundo tinha
// UMA tela de altura. Na Fase 10 a rota principal sobe para Y negativo: a
// colônia de micorriza fica lá em cima, e a primeira ponta da hifa era jogada de
// volta para y=58 no primeiro quadro. Daí o salto visível entre o esporo e a
// hifa, e a ponta morrendo logo em seguida por sair dos limites.
//
// O teto passa a sair da geometria; o piso continua absoluto de propósito,
// porque embaixo estão os hazards.

const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

const FASE_PLANA = { geometryTopY: 141, geometryBottomY: 620, endX: 4900 };
const FASE_ALTA = { geometryTopY: -187, geometryBottomY: 640, endX: 5200 };

// --- 1..3 · O HELPER --------------------------------------------------------

test('fase plana produz exatamente a faixa antiga', () => {
  // O conserto nao pode mexer onde nada estava quebrado: com a geometria dentro
  // da tela historica, o numero e o mesmo de antes.
  assert.equal(hyphalWorldBounds(FASE_PLANA, { topMargin: 58 }).minY, 58);
  assert.equal(hyphalWorldBounds(FASE_PLANA, { topMargin: 54 }).minY, 54);
  assert.equal(hyphalWorldBounds(FASE_PLANA, { topMargin: 48 }).minY, 48);
});

test('fase com rota alta abre o teto acompanhando a geometria', () => {
  const micorriza = hyphalWorldBounds(FASE_ALTA, { topMargin: 58 });
  const trichoderma = hyphalWorldBounds(FASE_ALTA, { topMargin: 54 });
  assert.ok(micorriza.minY < -180, `teto ficou em ${micorriza.minY}`);
  assert.equal(micorriza.minY, FASE_ALTA.geometryTopY - 130);
  // Todos os sistemas ganham o mesmo teto quando a geometria manda.
  assert.equal(micorriza.minY, trichoderma.minY);
});

test('o piso continua protegendo a zona letal', () => {
  for (const nivel of [FASE_PLANA, FASE_ALTA, null, { geometryBottomY: 5000 }]) {
    const bounds = hyphalWorldBounds(nivel);
    assert.equal(bounds.maxY, H - 48, 'o piso nao acompanha a geometria');
  }
  // Nem com margem propria o piso vira a base do mundo.
  assert.equal(hyphalWorldBounds(FASE_ALTA, { bottomMargin: 72 }).maxY, H - 72);
});

// --- 4..6 · A HIFA DE FATO CRESCE PARA CIMA ---------------------------------

function crescer(origemY, bounds, segundos = 3) {
  const rede = createHyphalNetwork({
    kind: 'mycorrhiza', x: 900, y: origemY, angle: -Math.PI / 2, seed: 1.1,
    maxBranches: 6, maxPoints: 200,
  });
  const inicio = { x: rede.x, y: rede.y };
  for (let t = 0; t < segundos; t += 1 / 60) {
    updateHyphalNetwork(rede, 1 / 60, { time: t, bounds, growthScale: 2 });
  }
  // A geometria da rede vive nos `points` de cada ponta.
  const pontos = rede.tips.flatMap(tip => tip.points || []);
  return { rede, inicio, topo: Math.min(...pontos.map(p => p.y)), pontos };
}

test('a origem da hifa e a origem da colonia, sem salto', () => {
  const origem = -120;
  const { rede, inicio } = crescer(origem, hyphalWorldBounds(FASE_ALTA, { topMargin: 58 }));
  assert.equal(inicio.y, origem);
  // O primeiro ponto desenhado nasce na propria origem.
  const primeiro = rede.tips[0].points[0];
  assert.ok(Math.abs(primeiro.y - origem) < 1, `primeiro ponto em ${primeiro.y}, colonia em ${origem}`);
});

test('a ponta cresce acima de Y=54 quando a geometria permite', () => {
  const { topo } = crescer(-120, hyphalWorldBounds(FASE_ALTA, { topMargin: 58 }));
  assert.ok(topo < 54, `a ponta parou em ${topo}`);
  assert.ok(topo < -120, 'a hifa tem que ter subido acima da colonia');
});

test('com a faixa antiga a hifa simplesmente nao saia da colonia', () => {
  // O defeito relatado, reproduzido. Com a colonia em Y negativo o clamp
  // absoluto puxa a ponta para 58 no primeiro quadro e, no mesmo quadro,
  // `tip.y <= bounds.minY` a desativa. A rede fica com o ponto semente e mais
  // nada: o esporo aparece sozinho, e a hifa nunca sai dele.
  const antiga = { minX: 8, maxX: 6000, minY: 58, maxY: H - 48 };
  const { pontos, rede } = crescer(-120, antiga);
  assert.equal(pontos.length, 1, `a rede antiga cresceu ${pontos.length} pontos`);
  assert.equal(pontos[0].y, -120);
  assert.ok(rede.tips.every(tip => !tip.active), 'a ponta morre no primeiro quadro');

  // Com a faixa derivada da geometria a rede cresce, e cresce a partir do
  // proprio esporo — sem salto entre um e outro.
  const { pontos: agora } = crescer(-120, hyphalWorldBounds(FASE_ALTA, { topMargin: 58 }));
  assert.ok(agora.length > 20, `a rede nova tem ${agora.length} pontos`);
  // Continuidade: o ponto seguinte ao esporo nasce colado nele. (A rede sobe
  // bem mais alto que isso — o que nao pode existir e o BURACO entre o esporo
  // e o comeco da hifa.)
  const semente = agora[0];
  const vizinho = Math.min(...agora.slice(1).map(p => Math.hypot(p.x - semente.x, p.y - semente.y)));
  assert.ok(vizinho < 40, `o primeiro trecho comeca a ${vizinho.toFixed(1)}px do esporo`);
});

test('Trichoderma alcanca alvo em Y negativo', () => {
  const bounds = hyphalWorldBounds(FASE_ALTA, { topMargin: 54 });
  const alvo = { x: 1000, y: -240 };
  const rede = createHyphalNetwork({
    kind: 'trichoderma', x: 900, y: -60, angle: Math.atan2(alvo.y + 60, alvo.x - 900),
    seed: .4, maxBranches: 8, maxPoints: 260,
  });
  let contato = false;
  for (let t = 0; t < 5; t += 1 / 60) {
    updateHyphalNetwork(rede, 1 / 60, {
      time: t, bounds, growthScale: 2.2,
      targetProvider: () => ({ ...alvo, radius: 26 }),
      onContact: () => { contato = true; },
      onFirstContact: () => { contato = true; },
    });
  }
  assert.ok(contato, 'a hifa nao chegou ao alvo em Y negativo');
});

// --- 7..10 · NENHUM CLAMP ABSOLUTO SOBROU NAS HIFAS -------------------------

test('todos os chamadores de updateHyphalNetwork consultam o helper', () => {
  for (const arquivo of ['src/procgen/mycorrhiza-growth.js', 'src/procgen/trichoderma-growth.js']) {
    const code = source(arquivo);
    assert.match(code, /hyphalWorldBounds\(state\.level/, `${arquivo} nao usa o helper`);
    assert.ok(!/minY: 5[48]/.test(code), `${arquivo} ainda tem clamp absoluto`);
  }
});

test('nenhum modulo de hifa mantem faixa absoluta em runtime', () => {
  const modulos = [
    'src/procgen/mycorrhiza-growth.js',
    'src/procgen/trichoderma-growth.js',
    'src/procgen/trichoderma-colonies.js',
    'src/procgen/opportunistic-fungus.js',
  ];
  for (const arquivo of modulos) {
    const code = source(arquivo);
    // Nenhum `clamp(..., <numero>, H - <numero>)` sobrando para posicao vertical.
    const sobras = [...code.matchAll(/clamp\([^,)]+,\s*\d+,\s*H - \d+\)/g)].map(m => m[0]);
    assert.deepEqual(sobras, [], `${arquivo}: ${sobras.join(' | ')}`);
    assert.match(code, /hyphalWorldBounds/, `${arquivo} nao consulta o helper`);
  }
  // O proprio `hyphal-growth` deriva do nivel quando ele e informado.
  assert.match(source('src/procgen/hyphal-growth.js'), /options\.level \? hyphalWorldBounds\(options\.level\)/);
});

test('o helper e unico — nao ha uma segunda copia da regra', () => {
  const bounds = source('src/procgen/world-bounds.js');
  assert.equal((bounds.match(/export function hyphalWorldBounds/g) || []).length, 1);
  // E ele vive junto do irmao que ja fazia o mesmo para os demais organismos.
  assert.match(bounds, /export function organismVerticalBounds/);
});

test('a faixa acompanha o comprimento real da fase, nao um 6500 fixo', () => {
  assert.equal(hyphalWorldBounds({ endX: 5200 }).maxX, 5192);
  assert.equal(hyphalWorldBounds({ endX: 3000 }).maxX, 2992);
  // Sem nivel, o antigo padrao continua valendo.
  assert.equal(hyphalWorldBounds(null).maxX, 6492);
});
