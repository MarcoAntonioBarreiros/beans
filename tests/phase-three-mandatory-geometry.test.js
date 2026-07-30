import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import {
  getPersistentUnlocksBeforePhase,
  getPhaseManifest,
} from '../src/procgen/campaign-manifest.js';
import {
  campaignPhaseSeed,
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import {
  auditTraversableRoute,
  insertDebugSafetySteps,
  generateLevel,
  isInsideAzospirillumChallengeCorridor,
} from '../src/procgen/generator.js';
import { generateUnderdevelopedNitrogenRoots } from '../src/procgen/nitrogen-root.js';
import { createRouteAnchorRegistry } from '../src/procgen/route-geometry.js';
import {
  applySignatureChallenge,
  canTraverseSubroute,
  findRootHost,
} from '../src/procgen/signature-challenge.js';
import { generateAzospirillumRootLadders } from '../src/procgen/azospirillum-root-growth.js';

const SINGLE = { id: 'running-jump', requires: [] };
const DOUBLE = { id: 'running-double-jump-late', requires: ['doubleJump'] };
// Sem nitrogenio a escada alcanca 96px; o maximo declarado e 340px.
const MAX_REACH = 340;

function route(level) {
  return (level.platforms || [])
    .filter(p => !p.recovery && !p.final && Number.isInteger(p.logicIndex))
    .sort((a, b) => a.logicIndex - b.logicIndex || a.x - b.x);
}

// Mesma sequencia de prepareLevel(), sem DOM/canvas nem Phase Lab.
function prepareFaseTres(seedName, { withAnchors = false } = {}) {
  const campaign = createCampaign(seedName, { storage: null });
  campaign.phase = 3;
  Object.assign(campaign.unlocks, getPersistentUnlocksBeforePhase(3));
  const profile = prepareCampaignGeneration(campaign);
  const seedValue = campaignPhaseSeed(campaign);

  let level = generateLevel(seedValue);
  level = decorateCampaignLevel(level, campaign, profile);

  const anchors = withAnchors ? createRouteAnchorRegistry(level) : null;
  anchors?.capture();

  applySignatureChallenge(level, campaign.phase);

  level.microbeEncounters = generateCampaignEncounters({
    platforms: level.platforms, phase: campaign.phase, seedValue,
  }).concat(level.authoredEncounters || []);

  const antesDaEscada = new Map((level.platforms || []).map(p => [
    p, { x: p.x, y: p.y, w: p.w, h: p.h },
  ]));

  generateAzospirillumRootLadders({
    level, phase: campaign.phase, seedValue,
    encounters: level.microbeEncounters,
    config: getPhaseManifest(campaign.phase).azospirillumRootLadder,
  });
  generateUnderdevelopedNitrogenRoots({
    level, phase: campaign.phase, seedValue,
    encounters: level.microbeEncounters,
    config: getPhaseManifest(campaign.phase).nitrogenRoot,
  });

  const safetySteps = insertDebugSafetySteps(level, {
    doubleJump: Boolean(campaign.unlocks.doubleJump),
    dash: Boolean(campaign.unlocks.dash),
  });
  anchors?.capture();
  anchors?.synchronize();

  return { level, campaign, anchors, antesDaEscada, safetySteps };
}

function corridorNodes(level, challenge) {
  return route(level).filter(p => (
    p.logicIndex >= challenge.corridorStartLogicIndex
    && p.logicIndex <= challenge.corridorEndLogicIndex
  ));
}

function launchStep(challenge) {
  const host = challenge.hostPlatform;
  return {
    x: host.x + host.w / 2 - 45,
    y: host.y - challenge.requiredReach,
    w: 90, h: 12, type: 'root', oneWay: true,
  };
}

// --- FASE 13-A: geometria em 100+ seeds ---------------------------------------

test('100 seeds da fase 3: a prova obrigatoria e valida, exclusiva e solucionavel', () => {
  const SEEDS = 100;
  const falhas = [];
  let comSolo = 0;

  for (let s = 0; s < SEEDS; s++) {
    const { level } = prefixo(s);
    const c = level.azospirillumChallenge;
    if (!c) { falhas.push(`seed ${s}: nenhum desafio obrigatorio`); continue; }

    const rota = route(level);
    const host = c.hostPlatform;
    const target = c.targetPlatform;

    // Exatamente um desafio obrigatorio.
    const marcados = rota.filter(p => p.mandatoryAzospirillumTarget);
    if (marcados.length !== 1) falhas.push(`seed ${s}: ${marcados.length} alvos marcados`);

    // Host e raiz de rota, nao recuperacao, anterior ao alvo.
    if (host.type !== 'root') falhas.push(`seed ${s}: host nao e raiz (${host.type})`);
    if (host.recovery) falhas.push(`seed ${s}: host e recuperacao`);
    if (!(c.targetLogicIndex > c.hostLogicIndex)) falhas.push(`seed ${s}: alvo nao vem depois do host`);

    // O alvo esta depois do desbloqueio do salto duplo (ordem pedagogica).
    const djUnlock = getPhaseManifest(3).unlockEvents.find(e => e.feature === 'doubleJump')?.eventChunk;
    if (Number.isInteger(djUnlock) && c.targetLogicIndex <= djUnlock) {
      falhas.push(`seed ${s}: alvo no chunk ${c.targetLogicIndex} vem antes do salto duplo (${djUnlock})`);
    }

    // Solo entre host e alvo e PERMITIDO e nao invalida a seed.
    if (c.interveningSoilCount > 0) comSolo++;

    // Sem escada: inalcancavel (inclui solo e recuperacao do corredor).
    const nos = corridorNodes(level, c);
    const recuperacaoNoCorredor = (level.platforms || []).filter(p => (
      p.recovery && p.x + p.w / 2 > host.x + host.w && p.x + p.w / 2 < target.x
    ));
    if (canTraverseSubroute({
      startPlatform: host, targetPlatform: target,
      platforms: nos, additionalPlatforms: recuperacaoNoCorredor,
      primitives: [SINGLE, DOUBLE],
    })) falhas.push(`seed ${s}: alvo alcancavel SEM a raiz lateral`);

    // Com a escada no requiredReach + salto duplo: alcancavel.
    if (!canTraverseSubroute({
      startPlatform: launchStep(c), targetPlatform: target,
      platforms: [launchStep(c)], primitives: [DOUBLE],
    })) falhas.push(`seed ${s}: alvo inalcancavel MESMO com a escada`);

    // requiredReach dentro do maximo.
    if (!(c.requiredReach <= MAX_REACH)) falhas.push(`seed ${s}: requiredReach ${c.requiredReach} > ${MAX_REACH}`);

    // Nenhuma recovery/safetyStep restou no corredor criando bypass.
    if (recuperacaoNoCorredor.length) {
      falhas.push(`seed ${s}: ${recuperacaoNoCorredor.length} plataformas de recuperacao no corredor`);
    }

    // A rota DEPOIS do alvo continua atravessavel (o desafio nao pode deixar o
    // resto da fase pendurado).
    const depois = rota.filter(p => p.logicIndex > c.targetLogicIndex);
    if (depois.length) {
      const primeiroDepois = depois[0];
      if (!canTraverseSubroute({
        startPlatform: target, targetPlatform: primeiroDepois,
        platforms: [target, primeiroDepois], primitives: [SINGLE, DOUBLE],
      })) falhas.push(`seed ${s}: a rota depois do alvo ficou intransponivel`);
    }
  }

  assert.deepEqual(falhas.slice(0, 12), [], `${falhas.length} falhas em ${SEEDS} seeds`);
  // Nota honesta sobre a cobertura: a busca prefere o meio da janela, e nessas
  // 100 seeds o candidato do meio sempre teve uma RAIZ como bloco anterior —
  // entao o caminho "solo entre host e alvo" nao e exercitado aqui. Ele e
  // coberto pelos fixtures e pelo teste de pipeline logo abaixo, que forca a
  // geometria. Este assert documenta a contagem em vez de fingir cobertura.
  assert.ok(comSolo >= 0, `seeds com solo intermediario: ${comSolo}/${SEEDS}`);
});

// Pipeline COMPLETO com solo entre hospedeiro e alvo. A seed procedural raramente
// cai nesse caso, entao a geometria e montada de proposito: na janela do desafio
// so existe um candidato largo o bastante, e o bloco imediatamente anterior a ele
// e SOLO. applySignatureChallenge tem de escolher a raiz de tras como hospedeiro,
// aceitar o solo no meio e registrar o corredor inteiro.
test('pipeline: applySignatureChallenge aceita solo entre hospedeiro e alvo', () => {
  const manifest = getPhaseManifest(3);
  const platforms = [];
  let x = 100;
  for (let index = 0; index <= manifest.totalChunks - 1; index++) {
    // Estreitas demais para virar candidato, exceto o alvo escolhido.
    const alvo = index === 20;
    const w = alvo ? 190 : 90;
    // 18 = raiz hospedeira, 19 = SOLO intermediario.
    const type = index === 19 ? 'soil' : 'root';
    platforms.push({ logicIndex: index, x, y: 500, w, h: 60, type });
    // Vaos curtos: o desafio precisa vir da ALTURA (a escada), nao da distancia.
    x += w + 60;
  }
  const level = { platforms, roots: [], primitives: [] };

  const challenge = applySignatureChallenge(level, 3);
  assert.ok(challenge, 'o desafio precisa ser criado mesmo com solo antes do alvo');

  const c = level.azospirillumChallenge;
  assert.ok(c, 'level.azospirillumChallenge precisa ser registrado');
  assert.equal(c.targetLogicIndex, 20, 'o unico candidato largo e o alvo');
  assert.equal(c.hostLogicIndex, 18, 'o hospedeiro e a raiz ANTES do solo, nao o solo');
  assert.equal(c.hostPlatform.type, 'root');
  assert.equal(c.interveningSoilCount, 1, 'o solo intermediario e contabilizado, nao removido');

  // O bloco de solo continua na rota principal, intacto e ainda solo.
  const soil = platforms.find(p => p.logicIndex === 19);
  assert.ok(level.platforms.includes(soil), 'o solo da rota principal nao pode ser removido');
  assert.equal(soil.type, 'soil', 'o solo nao pode ser convertido em raiz');

  // E a prova continua valendo: inalcancavel sem escada (mesmo pisando no solo),
  // alcancavel com a escada no requiredReach.
  const corridor = corridorNodes(level, c);
  assert.equal(
    canTraverseSubroute({
      startPlatform: c.hostPlatform, targetPlatform: c.targetPlatform,
      platforms: corridor, primitives: [SINGLE, DOUBLE],
    }),
    false,
    'o solo intermediario nao pode virar trampolim que vence a prova',
  );
  assert.equal(
    canTraverseSubroute({
      startPlatform: launchStep(c), targetPlatform: c.targetPlatform,
      platforms: [launchStep(c)], primitives: [DOUBLE],
    }),
    true,
    'com a escada no requiredReach o alvo e alcancavel',
  );
});

const cache = new Map();
function prefixo(s) {
  if (!cache.has(s)) cache.set(s, prepareFaseTres(`mandatory-geometry-${s}`));
  return cache.get(s);
}

// --- FASE 13-A (fixtures deliberadas) -----------------------------------------

function lancamento(host, reach) {
  return { x: host.x + host.w / 2 - 45, y: host.y - reach, w: 90, h: 12, type: 'root', oneWay: true };
}

test('fixture: root -> soil -> alvo alto continua valido (o solo nao invalida)', () => {
  const host = { logicIndex: 0, x: 100, y: 500, w: 200, h: 60, type: 'root' };
  const soil = { logicIndex: 1, x: 340, y: 500, w: 150, h: 60, type: 'soil' };
  const target = { logicIndex: 2, x: 520, y: 270, w: 190, h: 58, type: 'root' };

  // Sem escada: inalcancavel, mesmo usando o solo intermediario como trampolim.
  assert.equal(
    canTraverseSubroute({
      startPlatform: host, targetPlatform: target,
      platforms: [host, soil, target], primitives: [SINGLE, DOUBLE],
    }),
    false,
  );
  // Com a escada (raiz lateral como plataforma de lancamento) + salto duplo:
  // alcancavel. A raiz nao toca o alvo — ela so ergue Miguelito.
  assert.equal(
    canTraverseSubroute({
      startPlatform: lancamento(host, 150), targetPlatform: target,
      platforms: [lancamento(host, 150)], primitives: [DOUBLE],
    }),
    true,
  );
});

test('fixture: root -> soil -> soil -> alvo alto (dois blocos de solo no meio)', () => {
  const host = { logicIndex: 0, x: 100, y: 500, w: 200, h: 60, type: 'root' };
  const soil1 = { logicIndex: 1, x: 320, y: 500, w: 100, h: 60, type: 'soil' };
  const soil2 = { logicIndex: 2, x: 440, y: 500, w: 100, h: 60, type: 'soil' };
  const target = { logicIndex: 3, x: 560, y: 270, w: 190, h: 58, type: 'root' };

  assert.equal(
    canTraverseSubroute({
      startPlatform: host, targetPlatform: target,
      platforms: [host, soil1, soil2, target], primitives: [SINGLE, DOUBLE],
    }),
    false,
    'nem com dois trampolins de solo o salto duplo vence a subida',
  );

  // O hospedeiro e a RAIZ, nao o solo mais proximo: findRootHost caminha para
  // tras por cima dos dois blocos de solo.
  assert.equal(findRootHost([host, soil1, soil2, target], target), host);

  // E a partir dela a escada resolve.
  assert.equal(
    canTraverseSubroute({
      startPlatform: lancamento(host, 240), targetPlatform: target,
      platforms: [lancamento(host, 240)], primitives: [DOUBLE],
    }),
    true,
    'do topo da escada sobre a raiz o salto duplo alcanca o alvo',
  );
});

test('fixture: alvo alcancavel sem Azo e alvo inalcancavel mesmo no alcance maximo', () => {
  const host = { logicIndex: 0, x: 100, y: 500, w: 200, h: 60, type: 'root' };

  // (6) Alvo baixo demais: o salto duplo resolve sozinho — candidato invalido,
  // e o motivo de o desafio elevar o alvo antes de aceita-lo.
  const facil = { logicIndex: 1, x: 420, y: 440, w: 190, h: 58, type: 'root' };
  assert.equal(
    canTraverseSubroute({
      startPlatform: host, targetPlatform: facil,
      platforms: [host, facil], primitives: [SINGLE, DOUBLE],
    }),
    true,
    'um alvo baixo e vencido sem Azospirillum — precisa ser rejeitado/elevado',
  );

  // (7) Alvo longe demais: nem no alcance maximo a escada resolve — candidato
  // rejeitado, e a busca tenta o proximo.
  const impossivel = { logicIndex: 1, x: 1400, y: 240, w: 190, h: 58, type: 'root' };
  assert.equal(
    canTraverseSubroute({
      startPlatform: lancamento(host, 340), targetPlatform: impossivel,
      platforms: [lancamento(host, 340)], primitives: [DOUBLE],
    }),
    false,
    'nem no alcance maximo o alvo distante e alcancavel',
  );
});

test('fixture: um degrau solido no corredor cria bypass — por isso ele e removido', () => {
  const host = { logicIndex: 0, x: 100, y: 500, w: 200, h: 60, type: 'root' };
  const target = { logicIndex: 1, x: 560, y: 280, w: 190, h: 58, type: 'root' };
  const bypass = { logicIndex: 1, x: 340, y: 400, w: 110, h: 54, type: 'root' };

  assert.equal(
    canTraverseSubroute({ startPlatform: host, targetPlatform: target, platforms: [host, target], primitives: [SINGLE, DOUBLE] }),
    false,
    'sem o bypass o alvo e inalcancavel',
  );
  assert.equal(
    canTraverseSubroute({ startPlatform: host, targetPlatform: target, platforms: [host, bypass, target], primitives: [SINGLE, DOUBLE] }),
    true,
    'com um apoio solido no meio o desafio se desmonta — e o motivo de limpar o corredor',
  );
});

test('fixture: plataforma de recuperacao nao cria bypass — ela nasce desligada', () => {
  // Protecao dupla desde que as plataformas de seguranca foram desligadas de
  // vez: mesmo que uma sobrasse dentro do corredor, ela nao sustenta ninguem, e
  // por isso nao vence a prova. A limpeza do corredor continua existindo como
  // primeira barreira; esta e a segunda.
  const host = { logicIndex: 0, x: 100, y: 500, w: 200, h: 60, type: 'root' };
  const target = { logicIndex: 1, x: 560, y: 280, w: 190, h: 58, type: 'root' };
  const recuperacao = { logicIndex: 1, x: 340, y: 400, w: 110, h: 54, type: 'root', recovery: true };

  assert.equal(
    canTraverseSubroute({
      startPlatform: host, targetPlatform: target,
      platforms: [host, recuperacao, target], primitives: [SINGLE, DOUBLE],
    }),
    false,
    'uma plataforma de recuperacao desligada nao pode servir de degrau',
  );
});

// --- FASE 12: a ferramenta de debug nao insere degrau no corredor ------------

test('insertDebugSafetySteps nao insere degrau de seguranca dentro do corredor', () => {
  for (let s = 0; s < 30; s++) {
    const { level, safetySteps } = prefixo(s);
    const c = level.azospirillumChallenge;
    assert.ok(c, `seed ${s}: sem desafio`);
    for (const step of safetySteps || []) {
      const centro = step.x + step.w / 2;
      assert.ok(
        centro <= c.hostPlatform.x + c.hostPlatform.w || centro >= c.targetPlatform.x,
        `seed ${s}: degrau de seguranca inserido dentro do corredor`,
      );
    }
  }
});

test('o helper de corredor so cobre o trecho registrado', () => {
  const level = {
    azospirillumChallenge: { corridorStartLogicIndex: 5, corridorEndLogicIndex: 8 },
  };
  const p = index => ({ logicIndex: index });
  assert.equal(isInsideAzospirillumChallengeCorridor(level, p(5), p(6)), true);
  assert.equal(isInsideAzospirillumChallengeCorridor(level, p(7), p(8)), true);
  assert.equal(isInsideAzospirillumChallengeCorridor(level, p(4), p(5)), false, 'entrada do corredor nao e corredor');
  assert.equal(isInsideAzospirillumChallengeCorridor(level, p(8), p(9)), false, 'saida do corredor nao e corredor');
  assert.equal(isInsideAzospirillumChallengeCorridor({}, p(5), p(6)), false, 'sem desafio, sem supressao');
});

// --- FASE 13-B: propriedades da geometria ------------------------------------

test('generateAzospirillumRootLadders nao altera x/y/w/h de nenhuma plataforma', () => {
  for (let s = 0; s < 25; s++) {
    const { level, antesDaEscada } = prefixo(s);
    for (const [platform, antes] of antesDaEscada) {
      if (!(level.platforms || []).includes(platform)) continue; // recovery limpa e legitima
      for (const key of ['x', 'y', 'w', 'h']) {
        assert.equal(
          platform[key], antes[key],
          `seed ${s}: plataforma logicIndex ${platform.logicIndex} mudou ${key} depois da escada`,
        );
      }
    }
  }
});

test('checkpoints, exsudatos e pickups mantem o offset relativo a plataforma', () => {
  for (let s = 0; s < 20; s++) {
    const { level, anchors } = prepareFaseTres(`offsets-${s}`, { withAnchors: true });
    let checados = 0;
    for (const [entity, anchor] of anchors.anchors) {
      if (!(level.platforms || []).includes(anchor.platform)) continue;
      assert.equal(
        entity.x, anchor.platform.x + anchor.offsetX,
        `seed ${s}: ${anchor.name} perdeu o offset horizontal`,
      );
      assert.equal(
        entity.y, anchor.platform.y + anchor.offsetY,
        `seed ${s}: ${anchor.name} perdeu o offset vertical`,
      );
      checados++;
    }
    assert.ok(checados > 0, `seed ${s}: nenhuma entidade ancorada exercitada`);
  }
});
