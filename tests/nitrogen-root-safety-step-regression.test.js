// Regressão: nenhuma plataforma é inserida embaixo da raiz nitrogenada
// =====================================================================
//
// O bug da imagem: na fase 2, a raiz nitrogenada subdesenvolvida aparecia com um
// bloco grande sólido embaixo dela. O portão da FBN — que deveria exigir formar o
// nódulo na raiz anterior — era atravessável sem nódulo nenhum.
//
// Causa: `enforceTraversableRoute()` rodava DEPOIS de
// `generateUnderdevelopedNitrogenRoots()`. A raiz nitrogenada remove de propósito
// a plataforma-alvo do array (`removeGapPlatforms`), a rotina lia esse vão
// intencional como uma falha do gerador e inseria um `safetyStep` no meio dele —
// exatamente onde a raiz pequena é desenhada.
//
// Este arquivo monta o pipeline completo da campanha (o mesmo de `prepareLevel()`
// em app.js, sem DOM nem canvas) e verifica que:
//   1. nenhuma fase produz safetyStep;
//   2. o portão da raiz nitrogenada fica vazio antes do desenvolvimento;
//   3. a auditoria não altera o nível;
//   4. a própria raiz devolve a passagem ao crescer.

import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import {
  AZOSPIRILLUM_ROOT_LADDER_DEFAULTS,
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
  generateLevel,
  insertDebugSafetySteps,
  isIntentionalDynamicCrossing,
} from '../src/procgen/generator.js';
import {
  createNitrogenRootDevelopment,
  generateUnderdevelopedNitrogenRoots,
  nitrogenRootVisualBounds,
} from '../src/procgen/nitrogen-root.js';
import { generateAzospirillumRootLadders } from '../src/procgen/azospirillum-root-growth.js';
import { applySignatureChallenge } from '../src/procgen/signature-challenge.js';
import { applyPhaseFourMycorrhizaIntro } from '../src/procgen/phase-four-mycorrhiza-intro.js';
import {
  applyPhaseFiveTutorialEncounters,
  applyPhaseFiveTutorialGeometry,
} from '../src/procgen/phase-five-tutorial.js';
import {
  applyPhaseSixTutorialEncounters,
  applyPhaseSixTutorialGeometry,
} from '../src/procgen/phase-six-tutorial.js';
import { applyPhaseSevenPhosphateGeometry } from '../src/procgen/phosphate-solubilization.js';
import { applyPhaseOneVerticalSlice } from '../src/procgen/phase-one-vertical-slice.js';
import { createRouteAnchorRegistry } from '../src/procgen/route-geometry.js';

const TOTAL_PHASES = 10;

// Mesma sequência de prepareLevel(), sem DOM/canvas nem Phase Lab.
function preparePhase(phase, seedName) {
  const campaign = createCampaign(seedName, { storage: null });
  campaign.phase = phase;
  Object.assign(campaign.unlocks, getPersistentUnlocksBeforePhase(phase));
  const profile = prepareCampaignGeneration(campaign);
  const seed = campaignPhaseSeed(campaign);
  const manifest = getPhaseManifest(phase);

  let level = generateLevel(seed);
  applyPhaseFourMycorrhizaIntro(level, phase, manifest?.mycorrhizaBridge);
  applyPhaseFiveTutorialGeometry(level, phase);
  applyPhaseSixTutorialGeometry(level, phase);
  level = decorateCampaignLevel(level, campaign, profile);
  applyPhaseOneVerticalSlice(level, phase);

  const anchors = createRouteAnchorRegistry(level);
  anchors.capture();

  applySignatureChallenge(level, phase);
  applyPhaseSevenPhosphateGeometry(level, phase, manifest?.phosphateSolubilization);

  level.microbeEncounters = generateCampaignEncounters({
    platforms: level.platforms, phase, seedValue: seed,
  }).concat(level.authoredEncounters || []);
  level.microbeEncounters = applyPhaseFiveTutorialEncounters(
    level, level.microbeEncounters, phase, seed,
  );
  level.microbeEncounters = applyPhaseSixTutorialEncounters(
    level, level.microbeEncounters, phase,
  );

  const declared = manifest?.azospirillumRootLadder;
  const contextual = phase >= 5 && campaign.unlocks.azospirillumRoots
    ? {
        ...AZOSPIRILLUM_ROOT_LADDER_DEFAULTS,
        count: 2, knownSkill: true, preserveDestinationHeight: true,
      }
    : null;
  generateAzospirillumRootLadders({
    level, phase, seedValue: seed,
    encounters: level.microbeEncounters,
    config: declared?.enabled === false ? null : declared || contextual,
  });
  generateUnderdevelopedNitrogenRoots({
    level, phase, seedValue: seed,
    encounters: level.microbeEncounters,
    config: manifest?.nitrogenRoot,
  });

  // Fotografa TUDO antes da auditoria: ela não pode muder nada.
  const before = geometrySnapshot(level);

  const audit = auditTraversableRoute(
    level,
    { doubleJump: Boolean(campaign.unlocks?.doubleJump), dash: Boolean(campaign.unlocks?.dash) },
    {
      abilitiesUnlockedDuringPhase: Object.fromEntries(
        (manifest?.unlockEvents || [])
          .filter(event => event.feature === 'doubleJump' || event.feature === 'dash')
          .map(event => [event.feature, true]),
      ),
      mycorrhizaStructuresAvailable: Boolean(campaign.unlocks?.mycorrhizaStructures)
        || (manifest?.unlockEvents || []).some(e => e.feature === 'mycorrhizaStructures'),
      jetpackAvailable: Boolean(campaign.unlocks?.jetpack)
        || (manifest?.unlockEvents || []).some(e => e.feature === 'jetpack'),
    },
  );

  const after = geometrySnapshot(level);
  anchors.capture();
  anchors.synchronize();

  return { level, campaign, seed, audit, before, after };
}

function geometrySnapshot(level) {
  return {
    platformCount: (level.platforms || []).length,
    platforms: (level.platforms || []).map(p => (
      `${p.logicIndex}:${Math.round(p.x)}:${Math.round(p.y)}:${Math.round(p.w)}:${Math.round(p.h)}`
    )).join('|'),
    checkpoints: (level.checkpoints || []).map(c => `${Math.round(c.x)}:${Math.round(c.y)}`).join('|'),
    exudates: (level.exudates || []).map(e => `${Math.round(e.x)}:${Math.round(e.y)}`).join('|'),
    encounters: (level.microbeEncounters || []).map(e => `${e.id}:${Math.round(e.x)}:${Math.round(e.y)}`).join('|'),
    bridges: (level.platforms || []).filter(p => p.mycorrhizaStructure)
      .map(p => `${Math.round(p.x)}:${Math.round(p.w)}`).join('|'),
    ladders: (level.azospirillumRoots || []).map(l => (
      `${Math.round(l.startX ?? 0)}:${Math.round(l.startY ?? 0)}:${Math.round(l.endX ?? 0)}:${Math.round(l.endY ?? 0)}`
    )).join('|'),
  };
}

// Plataformas cujo centro cai dentro do portão da raiz nitrogenada.
function platformsInsideGate(level, root) {
  return (level.platforms || []).filter(platform => {
    const center = platform.x + platform.w / 2;
    return center > root.leftPlatform.x + root.leftPlatform.w
      && center < root.rightPlatform.x;
  });
}

function overlapsRootDrawing(platform, bounds) {
  return platform.x < bounds.x + bounds.w
    && platform.x + platform.w > bounds.x
    && platform.y < bounds.y + bounds.h + 40
    && platform.y + platform.h > bounds.y - 40;
}

// ---------------------------------------------------------------------------
// 1. O CASO EXATO DA IMAGEM
// ---------------------------------------------------------------------------

test('fase 2: o portão da raiz nitrogenada nasce vazio, sem bloco embaixo do desenho', () => {
  const problemas = [];
  let comRoot = 0;
  for (let i = 0; i < 25; i++) {
    const { level } = preparePhase(2, `imagem-${i}`);
    for (const root of level.nitrogenRoots || []) {
      comRoot++;
      const bounds = nitrogenRootVisualBounds(root, 0);
      const dentro = platformsInsideGate(level, root);

      for (const platform of dentro) {
        if (platform.safetyStep) {
          problemas.push(`seed ${i}: safetyStep dentro do portão (#${platform.logicIndex})`);
        }
        if (platform.recovery) {
          problemas.push(`seed ${i}: recovery dentro do portão (#${platform.logicIndex})`);
        }
        if (platform === root.targetPlatform) {
          problemas.push(`seed ${i}: a plataforma-alvo original voltou ao array`);
        }
        if (!platform.recovery && !platform.nitrogenRootCollider) {
          problemas.push(`seed ${i}: plataforma comum de apoio dentro do portão (#${platform.logicIndex})`);
        }
        if (overlapsRootDrawing(platform, bounds)) {
          problemas.push(`seed ${i}: plataforma sobreposta ao desenho da raiz subdesenvolvida`);
        }
      }

      // Nenhum collider antes do crescimento.
      assert.equal(root.collider, null, 'a raiz nasce sem collider próprio');
      assert.equal(root.progress, 0);
      assert.equal(root.developed, false);
      assert.equal(root.stage, 'underdeveloped');
      assert.equal(
        (level.platforms || []).some(p => p.nitrogenRootCollider), false,
        'nenhum nitrogenRootCollider existe antes do crescimento',
      );
    }
  }
  assert.ok(comRoot > 0, 'as seeds precisam produzir raiz nitrogenada');
  assert.deepEqual(problemas, [], problemas.slice(0, 6).join('\n'));
});

test('a auditoria classifica o portão da FBN como travessia intencional', () => {
  let vistos = 0;
  for (let i = 0; i < 25; i++) {
    const { level, audit } = preparePhase(2, `classifica-${i}`);
    if (!(level.nitrogenRoots || []).length) continue;
    const doNitrogenio = audit.intentionalCrossings.filter(c => c.mechanic === 'nitrogenRoot');
    if (!doNitrogenio.length) continue;
    vistos++;
    for (const crossing of doNitrogenio) {
      assert.equal(crossing.expectedBlockedUntilDeveloped, true);
      assert.ok(Number.isInteger(crossing.previousLogicIndex));
      assert.ok(Number.isInteger(crossing.nextLogicIndex));
    }
    // E nunca aparece como falha comum.
    assert.equal(
      audit.ordinaryFailures.some(f => {
        const root = level.nitrogenRoots[0];
        return f.previousLogicIndex === root.hostLogicIndex;
      }),
      false,
      'o portão da FBN não pode ser lido como falha comum',
    );
  }
  assert.ok(vistos > 0, 'alguma seed precisa registrar o portão da FBN na auditoria');
});

test('isIntentionalDynamicCrossing reconhece o portão por metadados, não por fase', () => {
  const left = { logicIndex: 4, x: 0, y: 500, w: 200, h: 60, type: 'root' };
  const right = { logicIndex: 6, x: 900, y: 500, w: 200, h: 60, type: 'root' };
  const target = { logicIndex: 5, x: 420, y: 500, w: 200, h: 60, type: 'root' };
  const level = {
    platforms: [left, right],
    nitrogenRoots: [{
      id: 'nitrogen-root-5-0',
      leftPlatform: left, rightPlatform: right, targetPlatform: target,
      hostLogicIndex: 4, targetLogicIndex: 5, blockedGapWidth: 700,
    }],
  };
  const verdict = isIntentionalDynamicCrossing(level, left, right);
  assert.equal(verdict?.mechanic, 'nitrogenRoot');
  assert.equal(verdict.expectedBlockedUntilDeveloped, true);
  assert.equal(verdict.nitrogenRootId, 'nitrogen-root-5-0');

  // Sem os metadados, o mesmo par não é intencional.
  assert.equal(isIntentionalDynamicCrossing({ platforms: [left, right] }, left, right), null);
});

// ---------------------------------------------------------------------------
// 2. DESENVOLVIMENTO: a própria raiz devolve a passagem
// ---------------------------------------------------------------------------

function nitrogenBench(level, campaign) {
  const state = {
    time: 0,
    gameState: 'play',
    campaign,
    level,
    player: { x: 0, y: 0, w: 26, h: 34, soil: 20, hope: 20, onGround: true },
    toast: '', toastTime: 0,
    discoveredMicrobes: new Set(),
  };
  const gameplay = createNitrogenRootDevelopment({
    state,
    entities: { burst() {}, damagePlayer() {} },
  });
  return { state, gameplay };
}

test('ao desenvolver, a raiz cria apenas o próprio collider e devolve a passagem', () => {
  let testadas = 0;
  for (let i = 0; i < 25 && testadas < 6; i++) {
    const { level, campaign } = preparePhase(2, `cresce-${i}`);
    const root = (level.nitrogenRoots || [])[0];
    if (!root) continue;
    testadas++;

    const { state, gameplay } = nitrogenBench(level, campaign);
    const plataformasAntes = level.platforms.length;

    // Nódulo maduro com FBN suficiente na raiz hospedeira.
    level.rhizobiumNodules = [{
      platform: root.hostPlatform,
      mature: true,
      stage: 'mature',
      fixationRate: root.requiredFixationRate * 3,
      x: root.hostPlatform.x + root.hostPlatform.w / 2,
      surfaceY: root.hostPlatform.y,
    }];

    for (let frame = 0; frame < 60 * (root.growthDurationSeconds + 4); frame++) {
      state.time += 1 / 60;
      gameplay.update(1 / 60);
    }

    assert.equal(root.progress, 1, 'a raiz completa o crescimento');
    assert.equal(root.developed, true);
    assert.ok(root.collider, 'criou o collider próprio');
    assert.equal(root.collider.nitrogenRootCollider, true);
    assert.equal(root.collider.nitrogenRootId, root.id);
    assert.equal(level.platforms.includes(root.collider), true);

    // Exatamente UM bloco novo, e nenhum safetyStep.
    assert.equal(
      level.platforms.length, plataformasAntes + 1,
      'só o collider da própria raiz entra no array',
    );
    assert.equal(level.platforms.some(p => p.safetyStep), false);

    // Nenhum par sobreposto dentro do portão.
    const dentro = platformsInsideGate(level, root);
    assert.equal(dentro.length, 1, 'um único bloco no portão: o collider da raiz');
    assert.equal(dentro[0], root.collider);
  }
  assert.ok(testadas > 0, 'alguma seed precisa ter raiz nitrogenada');
});

// ---------------------------------------------------------------------------
// 3. 100 SEEDS DA FASE 2
// ---------------------------------------------------------------------------

test('100 seeds da fase 2: zero safetyStep, zero sobreposição', { timeout: 240000 }, () => {
  let comRoot = 0;
  let safetySteps = 0;
  let sobreposicoes = 0;
  let colliderPrematuro = 0;
  const problemas = [];

  for (let i = 0; i < 100; i++) {
    const { level } = preparePhase(2, `fase2-100-${i}`);
    safetySteps += (level.platforms || []).filter(p => p.safetyStep).length;
    for (const root of level.nitrogenRoots || []) {
      comRoot++;
      if (root.collider) colliderPrematuro++;
      if (root.developed !== false) problemas.push(`seed ${i}: raiz não nasce subdesenvolvida`);
      const bounds = nitrogenRootVisualBounds(root, 0);
      for (const platform of platformsInsideGate(level, root)) {
        if (platform.safetyStep || platform.recovery) {
          problemas.push(`seed ${i}: bloco ativo no portão`);
        }
        if (overlapsRootDrawing(platform, bounds)) sobreposicoes++;
      }
    }
  }

  console.log(
    `    fase 2 / 100 seeds: ${comRoot} raízes nitrogenadas, `
    + `safetySteps=${safetySteps}, sobreposições=${sobreposicoes}, colliders prematuros=${colliderPrematuro}`,
  );
  assert.ok(comRoot >= 80, `esperava raiz nitrogenada na maioria das seeds, veio ${comRoot}`);
  assert.equal(safetySteps, 0, 'nenhum safetyStep no pipeline publicado');
  assert.equal(sobreposicoes, 0, 'nenhuma plataforma sobreposta ao desenho da raiz');
  assert.equal(colliderPrematuro, 0, 'nenhum collider antes do crescimento');
  assert.deepEqual(problemas, [], problemas.slice(0, 6).join('\n'));
});

// ---------------------------------------------------------------------------
// 4. 100 SEEDS DE CADA FASE
// ---------------------------------------------------------------------------

test('100 seeds de cada fase: nenhum safetyStep e a auditoria não altera nada', { timeout: 900000 }, () => {
  const problemas = [];
  const resumo = [];

  for (let phase = 1; phase <= TOTAL_PHASES; phase++) {
    let safetySteps = 0;
    let mudou = 0;
    let intencionais = 0;
    let falhasComuns = 0;

    for (let i = 0; i < 100; i++) {
      const { level, audit, before, after } = preparePhase(phase, `todas-${phase}-${i}`);
      safetySteps += (level.platforms || []).filter(p => p.safetyStep).length;
      intencionais += audit.intentionalCrossings.length;
      falhasComuns += audit.ordinaryFailures.length;

      // A auditoria não pode inserir, mover nem redimensionar nada.
      if (before.platformCount !== after.platformCount) {
        problemas.push(`f${phase} seed ${i}: contagem de plataformas mudou na auditoria`);
        mudou++;
      }
      for (const chave of ['platforms', 'checkpoints', 'exudates', 'encounters', 'bridges', 'ladders']) {
        if (before[chave] !== after[chave]) {
          problemas.push(`f${phase} seed ${i}: ${chave} mudou na auditoria`);
          mudou++;
          break;
        }
      }
    }

    resumo.push(
      `    fase ${String(phase).padStart(2)}: safetySteps=${safetySteps} `
      + `alterações=${mudou} travessias intencionais=${intencionais} falhas comuns=${falhasComuns}`,
    );
    if (safetySteps !== 0) problemas.push(`f${phase}: ${safetySteps} safetyStep no pipeline`);
  }

  console.log(resumo.join('\n'));
  assert.deepEqual(problemas, [], problemas.slice(0, 8).join('\n'));
});

// ---------------------------------------------------------------------------
// 5. DESAFIOS TEMÁTICOS SEGUEM INTACTOS
// ---------------------------------------------------------------------------

test('nenhum desafio temático recebe plataforma substituta', { timeout: 240000 }, () => {
  const problemas = [];
  for (const phase of [1, 3, 4]) {
    for (let i = 0; i < 40; i++) {
      const { level } = preparePhase(phase, `tematico-${phase}-${i}`);
      if ((level.platforms || []).some(p => p.safetyStep)) {
        problemas.push(`f${phase} seed ${i}: safetyStep presente`);
      }

      // Fase 3: nenhum bloco dentro do corredor obrigatório de Azospirillum.
      const desafio = level.azospirillumChallenge;
      if (desafio) {
        // Só bloco ATIVO conta: com `recoveryPlatformsDisabled` toda recovery
        // é invisível e não sólida, então ela não neutraliza desafio nenhum.
        // O que não pode existir é safetyStep ou plataforma comum de apoio.
        const intrusos = (level.platforms || []).filter(p => (
          (p.safetyStep || (!p.recovery && p.nitrogenRootCollider !== true && p.soilBlock === true))
          && Number.isInteger(p.logicIndex)
          && p.logicIndex >= desafio.corridorStartLogicIndex
          && p.logicIndex <= desafio.corridorEndLogicIndex
        ));
        if (intrusos.length) problemas.push(`f3 seed ${i}: ${intrusos.length} bloco(s) no corredor de Azo`);
      }

      // Fase 4: a ponte micorrízica não recebe plataforma substituta ao lado.
      for (const bridge of (level.platforms || []).filter(p => p.mycorrhizaStructure)) {
        const substituto = (level.platforms || []).some(p => (
          p !== bridge
          && p.safetyStep === true
          && p.x < bridge.x + bridge.w && p.x + p.w > bridge.x
        ));
        if (substituto) problemas.push(`f${phase} seed ${i}: bloco no vão da micorriza`);
      }
    }
  }
  assert.deepEqual(problemas, [], problemas.slice(0, 6).join('\n'));
});

// ---------------------------------------------------------------------------
// 6. A FERRAMENTA DE DEBUG CONTINUA EXISTINDO, MAS SÓ SOB PEDIDO
// ---------------------------------------------------------------------------

test('insertDebugSafetySteps só age quando chamada explicitamente', () => {
  const { level } = preparePhase(2, 'debug-tool');
  assert.equal((level.platforms || []).filter(p => p.safetyStep).length, 0);

  const antes = level.platforms.length;
  const inseridos = insertDebugSafetySteps(level, { doubleJump: false, dash: false });
  // Pode ou não haver falha comum nesta seed; o que importa é que só a chamada
  // explícita insere, e que ela nunca toca no portão da raiz nitrogenada.
  assert.equal(level.platforms.length, antes + inseridos.length);
  for (const root of level.nitrogenRoots || []) {
    for (const step of inseridos) {
      const center = step.x + step.w / 2;
      assert.ok(
        center <= root.leftPlatform.x + root.leftPlatform.w || center >= root.rightPlatform.x,
        'nem a ferramenta de debug entra no portão da FBN',
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 7. RECOVERY DESLIGADA: invisível, não sólida, sem exceção
// ---------------------------------------------------------------------------

test('com recoveryPlatformsDisabled, safetyStep residual não é desenhado nem sólido', async () => {
  const { createPlatformVisuals } = await import('../src/procgen/platform-visuals.js');
  const { isPlatformSolidForPresentation } = await import('../src/procgen/tutorial-presentation.js')
    .then(mod => ({ isPlatformSolidForPresentation: mod.isPlatformSolidForPresentation || mod.default }))
    .catch(() => ({ isPlatformSolidForPresentation: null }));

  const residual = {
    id: 'residual', type: 'root', logicIndex: 5,
    x: 400, y: 500, w: 120, h: 54,
    recovery: true, safetyStep: true,
  };
  const promovida = {
    id: 'promovida', type: 'root', logicIndex: 6,
    x: 700, y: 500, w: 200, h: 60,
    recovery: false, azospirillumLadderHost: true,
  };

  const state = {
    time: 0, cameraX: 0, recoveryPlatformsDisabled: true,
    player: { x: 420, y: 400, w: 26, h: 34, vy: 200, vx: 0, onGround: false, deaths: 0 },
    level: { platforms: [residual, promovida], hazards: [], exudates: [] },
  };

  // Render: nenhuma das rotinas de desenho pode tocar na residual.
  const desenhadas = [];
  const visuals = createPlatformVisuals({ state });
  const ctx = new Proxy({
    measureText: text => ({ width: String(text).length * 7 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    rect: (x, y, w) => desenhadas.push(Math.round(x)),
    fillRect: (x, y, w) => desenhadas.push(Math.round(x)),
    roundRect: (x, y, w) => desenhadas.push(Math.round(x)),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  visuals.drawWorld(ctx);

  const tocouResidual = desenhadas.some(x => x >= residual.x - 2 && x <= residual.x + residual.w);
  const tocouPromovida = desenhadas.some(x => x >= promovida.x - 2 && x <= promovida.x + promovida.w);
  assert.equal(tocouResidual, false, 'safetyStep residual não é desenhado');
  assert.equal(tocouPromovida, true, 'a plataforma promovida (recovery=false) continua desenhada');

  if (isPlatformSolidForPresentation) {
    assert.equal(isPlatformSolidForPresentation(residual, state), false);
    assert.equal(isPlatformSolidForPresentation(promovida, state), true);
  }
});

test('a física não sustenta safetyStep quando as recovery estão desligadas', async () => {
  const { createSimulator } = await import('../src/procgen/simulator.js');

  const residual = {
    id: 'residual', type: 'root', logicIndex: 5,
    x: 400, y: 500, w: 200, h: 54, recovery: true, safetyStep: true,
  };
  const sim = createSimulator();
  assert.equal(sim.state.recoveryPlatformsDisabled, true, 'o toggle nasce ligado');
  sim.state.level.platforms = [residual];
  sim.state.level.hazards = [];
  sim.state.player.x = residual.x + 40;
  sim.state.player.y = residual.y - 120;
  sim.state.player.vy = 0;
  sim.state.player.onGround = false;

  for (let frame = 0; frame < 90; frame++) sim.step(1 / 60);
  assert.equal(sim.state.player.onGround, false, 'atravessou o degrau residual');
  assert.ok(sim.state.player.y > residual.y, 'caiu abaixo dele');

  // A mesma plataforma promovida (recovery = false) volta a sustentar.
  const promovida = { ...residual, recovery: false };
  const sim2 = createSimulator();
  sim2.state.level.platforms = [promovida];
  sim2.state.level.hazards = [];
  sim2.state.player.x = promovida.x + 40;
  sim2.state.player.y = promovida.y - 120;
  sim2.state.player.vy = 0;
  sim2.state.player.onGround = false;
  for (let frame = 0; frame < 90; frame++) sim2.step(1 / 60);
  assert.equal(sim2.state.player.onGround, true, 'promovida sustenta normalmente');
});
