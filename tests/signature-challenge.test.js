import assert from 'node:assert/strict';
import test from 'node:test';

import { generateLevel } from '../src/procgen/generator.js';
import { validateChunk } from '../src/procgen/agents.js';
import { applyPhaseFourMycorrhizaIntro } from '../src/procgen/phase-four-mycorrhiza-intro.js';
import { applySignatureChallenge, canTraverseSubroute } from '../src/procgen/signature-challenge.js';

const SINGLE = { id: 'running-jump', requires: [] };
const DOUBLE = { id: 'running-double-jump-late', requires: ['doubleJump'] };
import { getPhaseManifest, setPhaseManifestOverride, clearPhaseManifestOverride } from '../src/procgen/campaign-manifest.js';
import {
  buildPhaseLabManifest, createDefaultPhaseLabConfig, scalePhaseLabSegments,
} from '../src/procgen/phase-lab-config.js';
import {
  campaignPhaseSeed, createCampaign, decorateCampaignLevel, prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';

function gera(phase, seedName, totalChunks = null) {
  if (totalChunks) {
    const base = createDefaultPhaseLabConfig(phase);
    setPhaseManifestOverride(buildPhaseLabManifest({
      ...base,
      totalChunks,
      segments: scalePhaseLabSegments(base.segments, base.totalChunks, totalChunks),
    }));
  }
  const campaign = createCampaign(seedName, { storage: null });
  campaign.phase = phase;
  const profile = prepareCampaignGeneration(campaign);
  let level = generateLevel(campaignPhaseSeed(campaign));
  applyPhaseFourMycorrhizaIntro(level, phase, getPhaseManifest(phase).mycorrhizaBridge);
  level = decorateCampaignLevel(level, campaign, profile);
  const challenge = applySignatureChallenge(level, phase);
  return { level, challenge };
}

test('o gerador procedural sozinho nunca exige a escada', () => {
  // O teto de traversalLimits e 112px e o salto duplo alcanca 180px. Este teste
  // documenta a razao de o desafio-assinatura existir: sem ele, a mecanica-tema
  // da fase esta disponivel e nunca e necessaria.
  const { level } = gera(3, 'sem-desafio-assinatura');
  const rota = level.platforms
    .filter(p => !p.recovery && !p.final && Number.isInteger(p.logicIndex) && !p.signatureChallenge)
    .sort((a, b) => a.logicIndex - b.logicIndex);
  let maiorProcedural = 0;
  for (const p of rota) {
    const prev = rota.find(q => q.logicIndex === p.logicIndex - 1);
    if (prev) maiorProcedural = Math.max(maiorProcedural, prev.y - p.y);
  }
  assert.ok(
    maiorProcedural <= 120,
    `subida procedural de ${Math.round(maiorProcedural)}px deveria ficar no teto do gerador`,
  );
  clearPhaseManifestOverride();
});

function corridorNodes(level, challenge) {
  return level.platforms
    .filter(p => (
      !p.recovery && !p.final && Number.isInteger(p.logicIndex)
      && p.logicIndex >= challenge.hostLogicIndex
      && p.logicIndex <= challenge.targetLogicIndex
    ))
    .sort((a, b) => a.logicIndex - b.logicIndex);
}

test('a prova obrigatoria de Azospirillum aparece em toda seed e em todo tamanho de fase', () => {
  // Nao ha mais uma "maior subida" medida por logicIndex-1: o bloco anterior ao
  // alvo pode ser SOLO. A prova e registrada em level.azospirillumChallenge com
  // hospedeiro (ultima raiz), alvo e requiredReach.
  for (const total of [12, 16, 20, 25, 30, 40]) {
    for (let s = 0; s < 6; s++) {
      const { level, challenge } = gera(3, `assinatura-${total}-${s}`, total);
      assert.ok(challenge, `fase de ${total} chunks, seed ${s}: nenhum desafio criado`);
      assert.equal(challenge.mechanic, 'azospirillumRoots');
      const c = level.azospirillumChallenge;
      assert.ok(c, `fase de ${total} chunks, seed ${s}: sem level.azospirillumChallenge`);
      assert.equal(c.hostPlatform.type, 'root', 'o hospedeiro precisa ser uma raiz');
      assert.ok(!c.hostPlatform.recovery, 'o hospedeiro nao pode ser plataforma de recuperacao');
      assert.ok(c.targetLogicIndex > c.hostLogicIndex, 'o alvo vem depois do hospedeiro');
      assert.ok(c.requiredReach <= 340, `requiredReach ${c.requiredReach} passa do maximo`);
    }
  }
  clearPhaseManifestOverride();
});

test('a prova e inatingivel sem a raiz lateral e atingivel com ela + salto duplo', () => {
  for (const total of [12, 20, 40]) {
    for (let s = 0; s < 4; s++) {
      const { level } = gera(3, `solucionavel-${total}-${s}`, total);
      const c = level.azospirillumChallenge;
      assert.ok(c);
      const corridor = corridorNodes(level, c);
      // SEM escada (so salto simples + duplo, incluindo os blocos de solo do
      // corredor): o alvo tem de ser inalcancavel.
      assert.ok(
        !canTraverseSubroute({
          startPlatform: c.hostPlatform,
          targetPlatform: c.targetPlatform,
          platforms: corridor,
          primitives: [SINGLE, DOUBLE],
        }),
        `${total}/${s}: o alvo e alcancavel sem a raiz lateral`,
      );
      // COM a escada no requiredReach (degrau superior = plataforma de
      // lancamento) + salto duplo: o alvo passa a ser alcancavel.
      const launch = {
        x: c.hostPlatform.x + c.hostPlatform.w / 2 - 45,
        y: c.hostPlatform.y - c.requiredReach,
        w: 90, h: 12, type: 'root', oneWay: true,
      };
      assert.ok(
        canTraverseSubroute({
          startPlatform: launch,
          targetPlatform: c.targetPlatform,
          platforms: [launch],
          primitives: [DOUBLE],
        }),
        `${total}/${s}: nem com a escada no requiredReach o alvo e alcancavel`,
      );
    }
  }
  clearPhaseManifestOverride();
});

// A ponte micorrizica so vale entre 325 e 340px: abaixo o salto duplo vence,
// acima ela nao alcanca. E o dash vence essa faixa, entao o desafio precisa
// cair antes do desbloqueio dele.
test('o desafio da ponte derrota o salto duplo e cabe no alcance da ponte', () => {
  const DUPLO = { id: 'running-double-jump-late', requires: ['doubleJump'] };
  for (const total of [20, 30, 40]) {
    for (let s = 0; s < 4; s++) {
      const { level, challenge } = gera(4, `ponte-${total}-${s}`, total);
      assert.ok(challenge, `fase de ${total} chunks, seed ${s}: nenhum desafio criado`);
      assert.equal(challenge.mechanic, 'mycorrhizaStructures');
      assert.ok(
        challenge.gap <= 340,
        `vao de ${challenge.gap}px passa do alcance da ponte`,
      );

      const rota = level.platforms
        .filter(p => !p.recovery && !p.final && Number.isInteger(p.logicIndex))
        .sort((a, b) => a.logicIndex - b.logicIndex);
      const alvo = rota.find(p => p.logicIndex === challenge.chunk);
      const anterior = rota.find(p => p.logicIndex === challenge.chunk - 1);
      assert.ok(
        alvo && anterior && !validateChunk(anterior, alvo, DUPLO, 'normal'),
        `o salto duplo vence o vao de ${challenge.gap}px e o desafio nao exige a ponte`,
      );
    }
  }
  clearPhaseManifestOverride();
});

test('o desafio da ponte fica antes do Dash, que venceria o vao sozinho', () => {
  for (const total of [20, 40]) {
    const { challenge } = gera(4, `antes-do-dash-${total}`, total);
    const dash = getPhaseManifest(4).unlockEvents.find(e => e.feature === 'dash')?.eventChunk;
    assert.ok(challenge, 'desafio criado');
    assert.ok(
      !Number.isInteger(dash) || challenge.chunk < dash,
      `desafio no chunk ${challenge.chunk} cai depois do Dash (chunk ${dash})`,
    );
  }
  clearPhaseManifestOverride();
});

// Este teste existe por causa de um furo no metodo dos outros: validateChunk
// monta um nivel com APENAS as duas plataformas da travessia, entao ele mede o
// vao isolado e nao enxerga o que existe no meio dele. O gerador espalha
// plataformas de recuperacao dentro dos vaos para perdoar pulos errados, e uma
// delas caia dentro do desafio em 12 de 12 seeds da fase 4: o vao de 330px
// virava dois pulinhos, o salto duplo passava, a ponte nunca era necessaria e a
// prova final nunca registrava. Aqui a verificacao e feita no nivel inteiro.
test('nenhuma recuperacao sobra dentro do corredor do desafio, em nenhuma fase', () => {
  for (const phase of [3, 4]) {
    for (let s = 0; s < 8; s++) {
      const { level, challenge } = gera(phase, `vao-limpo-${phase}-${s}`);
      assert.ok(challenge, `fase ${phase}, seed ${s}: nenhum desafio criado`);

      const rota = level.platforms
        .filter(p => !p.recovery && !p.final && Number.isInteger(p.logicIndex))
        .sort((a, b) => a.logicIndex - b.logicIndex);

      let inicio;
      let fim;
      if (phase === 3) {
        // Corredor = hospedeiro -> alvo. Blocos de SOLO da rota principal podem
        // ficar no meio (sao intencionais); apenas plataformas de recuperacao
        // nao podem criar bypass.
        const c = level.azospirillumChallenge;
        assert.ok(c);
        inicio = c.hostPlatform.x + c.hostPlatform.w;
        fim = c.targetPlatform.x;
      } else {
        const alvo = rota.find(p => p.logicIndex === challenge.chunk);
        const anterior = rota.find(p => p.logicIndex === challenge.chunk - 1);
        assert.ok(alvo && anterior);
        inicio = anterior.x + anterior.w;
        fim = alvo.x;
      }

      const recuperacaoDentro = level.platforms.filter(p => {
        if (!p.recovery) return false;
        const centro = p.x + p.w / 2;
        return centro > inicio + 2 && centro < fim - 2;
      });
      assert.deepEqual(
        recuperacaoDentro.map(p => Math.round(p.x)), [],
        `fase ${phase}, seed ${s}: sobrou recuperacao dentro do corredor do desafio`,
      );
    }
  }
  clearPhaseManifestOverride();
});

test('fase curta demais nao recebe o desafio, em vez de gerar geometria impossivel', () => {
  const base = getPhaseManifest(3);
  const curta = { ...JSON.parse(JSON.stringify(base)), totalChunks: 6 };
  assert.ok(
    (curta.signatureChallenge?.minimumChunks || 0) > 6,
    'a fase de 6 chunks fica abaixo do minimo declarado',
  );
});
