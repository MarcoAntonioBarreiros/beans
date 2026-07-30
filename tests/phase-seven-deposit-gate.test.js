import assert from 'node:assert/strict';
import test from 'node:test';

import { generateLevel } from '../src/procgen/generator.js';
import { createSimulator } from '../src/procgen/simulator.js';
import { applyPhaseSevenPhosphateGeometry } from '../src/procgen/phosphate-solubilization.js';
import { PHOSPHATE_SOLUBILIZATION_DEFAULTS, setPhaseManifestOverride, clearPhaseManifestOverride } from '../src/procgen/campaign-manifest.js';
import {
  buildPhaseLabManifest, createDefaultPhaseLabConfig, scalePhaseLabSegments,
} from '../src/procgen/phase-lab-config.js';
import {
  campaignPhaseSeed, createCampaign, decorateCampaignLevel, prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';

const DT = 1 / 60;

// Na fase 7 o jogador ja tem salto duplo e dash. O agente abaixo tenta transpor
// o deposito com os dois, variando o ponto de salto: se qualquer tentativa
// passar, o deposito nao exige a solubilizacao e vira cenario.
function transpoePulando(altura, { gap = 150, antecipacao = 140, largura = 58 } = {}) {
  const origem = { x: 200, y: 500, w: 260, h: 60, type: 'root', logicIndex: 0 };
  const destino = { x: origem.x + origem.w + gap, y: 500, w: 260, h: 60, type: 'root', logicIndex: 1 };
  const deposito = { x: origem.x + origem.w - 64, y: origem.y - altura, w: largura, h: altura, broken: false };

  const sim = createSimulator();
  sim.state.level.platforms = [origem, destino];
  sim.state.level.crystals = [deposito];
  sim.state.level.hazards = [];
  sim.state.level.endX = destino.x + destino.w + 600;
  Object.assign(sim.state.player, {
    x: origem.x + 20, y: origem.y - 48, onGround: true,
    canDoubleJump: true, airJumpAvailable: true, canDash: true,
  });

  let frames = 0;
  let noAr = false;
  let saltouDeNovo = false;
  let deuDash = false;
  let framesNoAr = 0;
  let desdeOSalto = 0;
  while (frames < 420) {
    const player = sim.state.player;
    const keys = { ArrowRight: true };
    if (!noAr) {
      if (player.x >= deposito.x - antecipacao) { keys.Space = true; noAr = true; desdeOSalto = 0; }
    } else {
      framesNoAr++;
      desdeOSalto++;
      if (!saltouDeNovo && desdeOSalto > 5 && player.vy >= -105) {
        keys.Space = true; saltouDeNovo = true; desdeOSalto = 0;
      }
      if (!deuDash && framesNoAr > 8 && player.vy >= -90) { keys.ShiftLeft = true; deuDash = true; }
    }
    sim.setInputs(keys);
    sim.step(DT);
    frames++;
    if (player.onGround && player.x > deposito.x + deposito.w + 4) return true;
    if (player.y > 760) return false;
  }
  return false;
}

function geraFaseSete(seedName, totalChunks) {
  const base = createDefaultPhaseLabConfig(7);
  setPhaseManifestOverride(buildPhaseLabManifest({
    ...base,
    totalChunks,
    segments: scalePhaseLabSegments(base.segments, base.totalChunks, totalChunks),
  }));
  const campaign = createCampaign(seedName, { storage: null });
  campaign.phase = 7;
  const profile = prepareCampaignGeneration(campaign);
  let level = generateLevel(campaignPhaseSeed(campaign));
  level = decorateCampaignLevel(level, campaign, profile);
  applyPhaseSevenPhosphateGeometry(level, 7, PHOSPHATE_SOLUBILIZATION_DEFAULTS);
  return level;
}

test('a altura declarada do deposito derrota salto duplo com dash', () => {
  const altura = PHOSPHATE_SOLUBILIZATION_DEFAULTS.depositHeight;
  for (const gap of [110, 150, 190, 230]) {
    for (const antecipacao of [80, 110, 140, 170, 200, 230]) {
      for (const largura of [58, 74]) {
        assert.equal(
          transpoePulando(altura, { gap, antecipacao, largura }), false,
          `deposito de ${altura}px transposto pulando (vao ${gap}, salto a ${antecipacao}px, largura ${largura})`,
        );
      }
    }
  }
});

test('a altura antiga era transponivel: e por isso que ela mudou', () => {
  // Documenta a medicao. 150px era o valor anterior e o deposito nao exigia
  // nada do jogador para seguir adiante.
  assert.ok(transpoePulando(150), 'o deposito de 150px deveria ser transponivel');
  assert.ok(transpoePulando(170), 'o deposito de 170px deveria ser transponivel');
});

test('o deposito aberto libera a passagem', () => {
  // Sem isso a fase seria intransponivel: solubilizar precisa abrir a rota.
  const altura = PHOSPHATE_SOLUBILIZATION_DEFAULTS.depositHeight;
  const origem = { x: 200, y: 500, w: 260, h: 60, type: 'root', logicIndex: 0 };
  const destino = { x: origem.x + origem.w + 150, y: 500, w: 260, h: 60, type: 'root', logicIndex: 1 };
  const sim = createSimulator();
  sim.state.level.platforms = [origem, destino];
  sim.state.level.crystals = [{ x: origem.x + origem.w - 64, y: origem.y - altura, w: 58, h: altura, broken: true }];
  sim.state.level.hazards = [];
  sim.state.level.endX = destino.x + destino.w + 600;
  Object.assign(sim.state.player, {
    x: origem.x + 20, y: origem.y - 48, onGround: true,
    canDoubleJump: true, airJumpAvailable: true, canDash: true,
  });
  let frames = 0;
  let noAr = false;
  while (frames < 420) {
    const player = sim.state.player;
    const keys = { ArrowRight: true };
    if (!noAr && player.x >= origem.x + origem.w - 40) { keys.Space = true; noAr = true; }
    sim.setInputs(keys);
    sim.step(DT);
    frames++;
    if (player.onGround && player.x > destino.x) { assert.ok(true); return; }
    if (player.y > 760) break;
  }
  assert.fail('o deposito solubilizado continua fechando a rota');
});

test('a fase 7 monta colonia, deposito e raiz-alvo em todo tamanho', () => {
  // Indices fixos faziam a fase inteira sumir quando encurtada — sem raiz-alvo o
  // finalTest fica inalcancavel e a fase trava.
  for (const total of [8, 10, 12, 16, 24, 40]) {
    for (let s = 0; s < 5; s++) {
      const level = geraFaseSete(`p7-${total}-${s}`, total);
      const [deposito] = level.phosphateDeposits || [];
      assert.ok(deposito, `fase de ${total} chunks, seed ${s}: sem deposito de fosfato`);
      assert.equal(deposito.h, PHOSPHATE_SOLUBILIZATION_DEFAULTS.depositHeight);
      assert.equal(
        (level.authoredBeneficialColonies || []).filter(colony => colony.type === 'bacillus').length,
        1,
        `fase de ${total} chunks: sem colonia solubilizadora`,
      );
      const alvo = level.platforms.filter(platform => platform.phosphateTarget);
      assert.equal(alvo.length, 1, `fase de ${total} chunks: sem raiz-alvo do fosforo`);
    }
  }
  clearPhaseManifestOverride();
});

test('a ordem colonia -> deposito -> raiz sobrevive ao encurtamento', () => {
  for (const total of [8, 12, 16, 40]) {
    const level = geraFaseSete(`p7-ordem-${total}`, total);
    const colonia = level.authoredBeneficialColonies[0].platform;
    const [deposito] = level.phosphateDeposits;
    const alvo = level.platforms.find(platform => platform.phosphateTarget);
    assert.ok(colonia.x < deposito.x, `fase de ${total} chunks: colonia depois do deposito`);
    assert.ok(deposito.x < alvo.x, `fase de ${total} chunks: deposito depois da raiz-alvo`);
  }
  clearPhaseManifestOverride();
});
