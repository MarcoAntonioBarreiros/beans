import assert from 'node:assert/strict';
import test from 'node:test';

import { validateChunk } from '../src/procgen/agents.js';
import { createSimulator } from '../src/procgen/simulator.js';
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
import { generateLevel } from '../src/procgen/generator.js';
import {
  createAzospirillumRootGrowth,
  generateAzospirillumRootLadders,
} from '../src/procgen/azospirillum-root-growth.js';
import { createAzospirillumNitrogen } from '../src/procgen/azospirillum-nitrogen.js';
import { createMycorrhizaStructures } from '../src/procgen/mycorrhiza-structures.js';
import { applyPhaseFourMycorrhizaIntro } from '../src/procgen/phase-four-mycorrhiza-intro.js';

const LADDER_CONFIG = {
  enabled: true,
  count: 1,
  stepCount: 4,
  verticalSpacing: 85,
  growthDurationSeconds: 3,
};

const NORMAL_JUMP = { id: 'running-jump-long', requires: [] };
const DOUBLE_JUMP = { id: 'running-double-jump', requires: ['doubleJump'] };

function validateVerticalStep(fromPlatform, toPlatform) {
  const from = { ...fromPlatform };
  const to = { ...toPlatform };
  const sim = createSimulator();
  sim.state.level.platforms = [from, to];
  sim.state.level.hazards = [];
  sim.state.level.endX = Math.max(to.x + to.w + 600, 2400);
  sim.state.level.cameraMaxX = Math.max(0, sim.state.level.endX - 1280);
  sim.state.player.x = Math.max(
    from.x + 4,
    Math.min(
      from.x + from.w - sim.state.player.w - 4,
      to.x + to.w / 2 - sim.state.player.w / 2,
    ),
  );
  sim.state.player.y = from.y - sim.state.player.h;
  sim.state.player.onGround = true;
  sim.state.player.canDoubleJump = false;

  for (let frame = 0; frame < 240; frame++) {
    const deltaX = to.x + to.w / 2
      - (sim.state.player.x + sim.state.player.w / 2);
    const keys = frame === 0
      ? { Space: true }
      : Math.abs(deltaX) > 5
        ? deltaX > 0 ? { ArrowRight: true } : { ArrowLeft: true }
        : {};
    sim.setInputs(keys);
    sim.step(1 / 60);
    const player = sim.state.player;
    if (
      player.onGround
      && player.x + player.w > to.x + 3
      && player.x < to.x + to.w - 3
      && Math.abs(player.y - (to.y - player.h)) < 12
    ) return true;
    if (player.y > 720) return false;
  }
  return false;
}

function ladderFixture() {
  const platforms = [
    { x: 100, y: 500, w: 190, h: 60, type: 'root', logicIndex: 4 },
    { x: 380, y: 510, w: 185, h: 58, type: 'soil', logicIndex: 6 },
    { x: 650, y: 525, w: 190, h: 62, type: 'soil', logicIndex: 8 },
    { x: 930, y: 540, w: 210, h: 64, type: 'root', logicIndex: 9 },
    { x: 1240, y: 515, w: 195, h: 60, type: 'root', logicIndex: 10 },
    { x: 1525, y: 525, w: 205, h: 60, type: 'root', logicIndex: 11 },
    { x: 1150, y: 600, w: 88, h: 30, type: 'root', logicIndex: 10, recovery: true },
  ];
  return {
    platforms,
    exudates: [{ logicIndex: 6, x: 470, y: 470, taken: false }],
    allies: [], crystals: [], enemies: [], checkpoints: [],
    azospirillumRootLadders: [], azospirillumRoots: [], particles: [],
  };
}

function createFixtureLadder() {
  const level = ladderFixture();
  const [ladder] = generateAzospirillumRootLadders({
    level,
    phase: 3,
    seedValue: 'ladder-fixture',
    encounters: [{ id: 'azospirillum', logicIndex: 4, x: 180, y: 410 }],
    config: LADDER_CONFIG,
  });
  assert.ok(ladder, 'a fixture deve produzir uma escada');
  return { level, ladder };
}

test('desafio de Azo so e reservado depois de Azo, exsudato e raiz colonizavel', () => {
  const withoutAzo = ladderFixture();
  assert.deepEqual(generateAzospirillumRootLadders({
    level: withoutAzo, phase: 3, seedValue: 'without-azo', encounters: [], config: LADDER_CONFIG,
  }), []);

  const level = ladderFixture();
  level.exudates = [];
  const [ladder] = generateAzospirillumRootLadders({
    level,
    phase: 3,
    seedValue: 'authored-prerequisite',
    encounters: [{ id: 'azospirillum', logicIndex: 4, x: 180, y: 410 }],
    config: LADDER_CONFIG,
  });
  assert.ok(ladder);
  assert.ok(level.exudates.some(exudate => exudate.azospirillumLadderPrerequisite));
  assert.ok(ladder.sourceAzospirillumLogicIndex < ladder.sourceExudateLogicIndex);
  assert.ok(ladder.sourceExudateLogicIndex < ladder.hostLogicIndex);
  assert.equal(ladder.host.type, 'root');
  assert.equal(ladder.host.wasRecoveryRoot, true);
  assert.equal(ladder.host.recovery, false);
  assert.equal(ladder.destination.y, ladder.originalDestinationY);
  assert.equal(ladder.blockedRise, ladder.host.y - ladder.destination.y);
  assert.ok(ladder.hostLogicIndex <= 12);
  assert.equal(level.platforms.some(platform => platform.azospirillumRootWall), false);
});

// A escada deixou de ser recurso do nivel e virou efeito da inoculacao: nasce
// em qualquer raiz onde a colonia de Azo amadurece, sem hospedeiro pre-marcado.
function runtimeLadderScene({ nitrogen = 0, platforms = [] } = {}) {
  const host = { x: 400, y: 500, w: 220, h: 60, type: 'root', logicIndex: 4 };
  const level = {
    platforms: [host, ...platforms],
    azospirillumRootLadders: [],
    azospirillumRoots: [],
    rhizobiumNodules: nitrogen ? [{ fixationRate: nitrogen }] : [],
    particles: [],
  };
  const inoculants = { colonies: [] };
  const state = {
    gameState: 'play', time: 0, level, cameraX: 0,
    player: { soil: 0, hope: 0 },
  };
  const runtime = createAzospirillumRootGrowth({
    state, inoculants, entities: { burst() {} },
  });
  runtime.reset();
  return { state, level, host, inoculants, runtime };
}

test('inocular Azo em qualquer raiz faz nascer a escada, sem hospedeiro marcado', () => {
  const scene = runtimeLadderScene();
  scene.runtime.update(1);
  assert.equal(scene.level.azospirillumRootLadders.length, 0, 'sem colonia nao nasce nada');

  scene.inoculants.colonies.push({
    id: 'azo-livre', type: 'azospirillum', platform: scene.host,
    growth: 1, vigor: 1, dormant: false, x: scene.host.x + 60,
  });
  scene.runtime.update(.1);

  const [ladder] = scene.level.azospirillumRootLadders;
  assert.ok(ladder, 'a colonia madura cria a escada na propria raiz inoculada');
  assert.equal(ladder.host, scene.host);
  assert.equal(scene.host.azospirillumLadderHost, undefined, 'nenhuma marcacao previa');
  assert.ok(ladder.endY < ladder.startY, 'a raiz lateral sobe, nunca desce');
  assert.equal(ladder.destination, null, 'sem bloco alcancavel ela sobe reta');
  assert.equal(Math.round(ladder.endX), Math.round(ladder.startX), 'subida reta e vertical');

  // Uma segunda passada nao duplica a escada da mesma raiz.
  scene.runtime.update(.1);
  assert.equal(scene.level.azospirillumRootLadders.length, 1);
});

test('os degraus nunca ficam empilhados, seja a escada curta ou longa', () => {
  // Um numero fixo de degraus empilhava tudo quase encostado quando o alcance
  // era pequeno. O espacamento precisa continuar subivel nos dois extremos.
  for (const nitrogen of [0, 2, 6, 40]) {
    const scene = runtimeLadderScene({ nitrogen });
    scene.inoculants.colonies.push({
      id: `azo-${nitrogen}`, type: 'azospirillum', platform: scene.host,
      growth: 1, vigor: 1, dormant: false, x: scene.host.x,
    });
    scene.runtime.update(.1);

    const ladder = scene.level.azospirillumRootLadders[0];
    const alturas = [ladder.startY, ...ladder.steps.map(step => step.y), ladder.endY];
    for (let i = 1; i < alturas.length; i++) {
      const vao = alturas[i - 1] - alturas[i];
      assert.ok(
        vao >= 28,
        `N=${nitrogen}: degraus a ${Math.round(vao)}px ficam empilhados`,
      );
      assert.ok(
        vao <= 96,
        `N=${nitrogen}: degraus a ${Math.round(vao)}px passam do salto simples`,
      );
    }
  }
});

test('o estoque de nitrogenio decide a altura, e um bloco proximo decide a inclinacao', () => {
  const pobre = runtimeLadderScene({ nitrogen: 0 });
  pobre.inoculants.colonies.push({
    id: 'azo-pobre', type: 'azospirillum', platform: pobre.host,
    growth: 1, vigor: 1, dormant: false, x: pobre.host.x,
  });
  pobre.runtime.update(.1);
  const alturaPobre = pobre.level.azospirillumRootLadders[0].startY
    - pobre.level.azospirillumRootLadders[0].endY;

  const rico = runtimeLadderScene({ nitrogen: 40 });
  rico.inoculants.colonies.push({
    id: 'azo-rico', type: 'azospirillum', platform: rico.host,
    growth: 1, vigor: 1, dormant: false, x: rico.host.x,
  });
  rico.runtime.update(.1);
  const alturaRica = rico.level.azospirillumRootLadders[0].startY
    - rico.level.azospirillumRootLadders[0].endY;

  assert.ok(alturaRica > alturaPobre + 100, `estoque cheio (${alturaRica}px) deve superar o vazio (${alturaPobre}px)`);

  // Com um bloco alcancavel acima e ao lado, a escada inclina em direcao a ele.
  const comAlvo = runtimeLadderScene({
    nitrogen: 40,
    platforms: [{ x: 700, y: 300, w: 200, h: 50, type: 'root', logicIndex: 5 }],
  });
  comAlvo.inoculants.colonies.push({
    id: 'azo-alvo', type: 'azospirillum', platform: comAlvo.host,
    growth: 1, vigor: 1, dormant: false, x: comAlvo.host.x,
  });
  comAlvo.runtime.update(.1);
  const dirigida = comAlvo.level.azospirillumRootLadders[0];
  assert.ok(dirigida.destination, 'existindo bloco no alcance, ele vira destino');
  assert.ok(dirigida.endX > dirigida.startX, 'a escada inclina para o bloco');
  assert.ok(dirigida.endY < dirigida.startY, 'mas continua subindo');
});

test('escada cresce apenas com colonia de Azo na raiz e cada degrau so colide em 100%', () => {
  const { level, ladder } = createFixtureLadder();
  const inoculants = { colonies: [] };
  const state = {
    gameState: 'play', time: 0, level,
    player: { soil: 0, hope: 0 }, cameraX: 0,
  };
  const runtime = createAzospirillumRootGrowth({
    state,
    inoculants,
    entities: { burst() {} },
  });
  runtime.reset();
  runtime.update(10);
  assert.equal(ladder.progress, 0);
  assert.equal(runtime.platformCount, 0);

  inoculants.colonies.push({
    id: 'azo-colony', type: 'azospirillum', platform: ladder.host,
    growth: 1, vigor: 1, dormant: false, x: ladder.host.x + ladder.host.w - 45,
  });
  runtime.update(2.99);
  assert.ok(ladder.progress > .99 && ladder.progress < 1);
  assert.equal(ladder.developed, false);
  for (const step of ladder.steps) {
    assert.equal(Boolean(step.collider), step.progress >= 1);
  }
  assert.equal(ladder.steps.at(-1).collider, null);

  runtime.update(.01);
  assert.equal(ladder.progress, 1);
  assert.equal(ladder.developed, true);
  assert.equal(ladder.steps.every(step => step.mature && step.collider), true);
  assert.equal(runtime.platformCount, LADDER_CONFIG.stepCount);

  inoculants.colonies.length = 0;
  runtime.update(30);
  assert.equal(ladder.progress, 1);
  assert.equal(ladder.steps.every(step => step.collider), true);
});

test('primeira escada adapta os degraus ao bloco superior sem mover a rota', () => {
  const { ladder } = createFixtureLadder();
  const route = [
    ladder.host,
    ...ladder.steps.map(step => ({
      x: step.centerX - step.targetWidth / 2,
      y: step.y,
      w: step.targetWidth,
      h: step.targetHeight,
      type: 'root',
      oneWay: true,
    })),
    ladder.destination,
  ];
  assert.ok(Math.abs(ladder.endX - ladder.startX) < ladder.blockedRise);
  assert.ok(ladder.steps.every((step, index) => index === 0 || step.y < ladder.steps[index - 1].y));
  assert.equal(ladder.destination.y, ladder.originalDestinationY);
  for (let index = 0; index < route.length - 1; index++) {
    assert.equal(
      validateVerticalStep(route[index], route[index + 1]),
      true,
      `salto normal deve subir o degrau ${index} da escada`,
    );
  }
  assert.equal(validateChunk(ladder.destination, ladder.following, NORMAL_JUMP), true);
});

test('degraus maduros atravessam de baixo para cima e colidem somente na queda', () => {
  const { level, ladder } = createFixtureLadder();
  const inoculants = {
    colonies: [{
      id: 'azo-colony', type: 'azospirillum', platform: ladder.host,
      growth: 1, vigor: 1, dormant: false, x: ladder.host.x + ladder.host.w / 2,
    }],
  };
  const state = {
    gameState: 'play', time: 0, level,
    player: { soil: 0, hope: 0 }, cameraX: 0,
  };
  const runtime = createAzospirillumRootGrowth({ state, inoculants, entities: { burst() {} } });
  runtime.reset();
  runtime.update(3);
  const collider = ladder.steps[0].collider;
  assert.equal(collider.oneWay, true);

  const sim = createSimulator();
  sim.state.level.platforms = [collider];
  sim.state.level.hazards = [];
  sim.state.level.endX = 2400;
  sim.state.player.x = collider.x + collider.w / 2 - sim.state.player.w / 2;
  sim.state.player.y = collider.y + 20;
  sim.state.player.onGround = true;
  let crossedFromBelow = false;
  let landedFromAbove = false;
  for (let frame = 0; frame < 180; frame++) {
    sim.setInputs(frame === 0 ? { Space: true } : {});
    sim.step(1 / 60);
    const player = sim.state.player;
    if (player.vy < 0 && player.y + player.h < collider.y) crossedFromBelow = true;
    if (
      crossedFromBelow
      && player.onGround
      && Math.abs(player.y - (collider.y - player.h)) < 2
    ) {
      landedFromAbove = true;
      break;
    }
  }
  assert.equal(crossedFromBelow, true);
  assert.equal(landedFromAbove, true);
});

test('geracao da escada permanece deterministica em multiplas seeds da Fase 3', () => {
  for (let index = 0; index < 12; index++) {
    const snapshot = () => {
      const campaign = createCampaign(`azo-deterministic-${index}`);
      campaign.phase = 3;
      Object.assign(campaign.unlocks, getPersistentUnlocksBeforePhase(3));
      const profile = prepareCampaignGeneration(campaign);
      const seedValue = campaignPhaseSeed(campaign);
      const level = decorateCampaignLevel(generateLevel(seedValue), campaign, profile);
      const encounters = generateCampaignEncounters({ platforms: level.platforms, phase: 3, seedValue });
      const ladders = generateAzospirillumRootLadders({
        level,
        phase: 3,
        seedValue,
        encounters,
        config: getPhaseManifest(3).azospirillumRootLadder,
      });
      for (const ladder of ladders) {
        const route = [
          ladder.host,
          ...ladder.steps.map(step => ({
            x: step.centerX - step.targetWidth / 2,
            y: step.y,
            w: step.targetWidth,
            h: step.targetHeight,
            type: 'root',
            oneWay: true,
          })),
          ladder.destination,
        ];
        assert.ok(
          Math.abs(ladder.endX - ladder.startX) <= 390,
          `seed ${index}: destino precisa permanecer dentro do alcance lateral`,
        );
        assert.ok(ladder.hostLogicIndex <= 12, `seed ${index} nao deve adiar o alvo de Azo`);
        assert.equal(
          ladder.destination.y,
          ladder.originalDestinationY,
          `seed ${index}: a escada nao pode reposicionar o destino`,
        );
        for (let routeIndex = 0; routeIndex < route.length - 1; routeIndex++) {
          assert.equal(
            validateVerticalStep(route[routeIndex], route[routeIndex + 1]),
            true,
            `seed ${index} deve manter atravessável o trecho ${routeIndex}`,
          );
        }
        assert.equal(
          validateChunk(ladder.destination, ladder.following, NORMAL_JUMP)
            || validateChunk(ladder.destination, ladder.following, DOUBLE_JUMP),
          true,
          `seed ${index} deve preservar a rota posterior com o salto duplo já desbloqueado`,
        );
      }
      return ladders.map(ladder => ({
        host: ladder.hostLogicIndex,
        destination: ladder.destinationLogicIndex,
        azo: ladder.sourceAzospirillumLogicIndex,
        exudate: ladder.sourceExudateLogicIndex,
        blockedRise: ladder.blockedRise,
        endpoints: [ladder.startX, ladder.startY, ladder.endX, ladder.endY],
        steps: ladder.steps.map(step => [step.centerX, step.y]),
      }));
    };
    const first = snapshot();
    assert.deepEqual(first, snapshot());
    assert.equal(first.length, 1);
    assert.ok(first[0].azo < first[0].exudate);
    assert.ok(first[0].exudate < first[0].host);
  }
});

test('Fase 4 usa a propria estreia da micorriza para desbloquear a primeira ponte obrigatoria', () => {
  const campaign = createCampaign('phase-lab-4');
  campaign.phase = 4;
  campaign.unlocks = getPersistentUnlocksBeforePhase(4);
  const profile = prepareCampaignGeneration(campaign);
  const seedValue = campaignPhaseSeed(campaign);
  const rawLevel = generateLevel(seedValue);
  const intro = applyPhaseFourMycorrhizaIntro(
    rawLevel,
    4,
    getPhaseManifest(4).mycorrhizaBridge,
  );
  const level = decorateCampaignLevel(rawLevel, campaign, profile);
  const encounters = generateCampaignEncounters({ platforms: level.platforms, phase: 4, seedValue });
  const ladders = generateAzospirillumRootLadders({
    level,
    phase: 4,
    seedValue,
    encounters,
    config: getPhaseManifest(4).azospirillumRootLadder,
  });

  assert.ok(intro);
  assert.equal(intro.source.logicIndex, 3);
  assert.equal(intro.target.logicIndex, 4);
  assert.equal(intro.source.type, 'root');
  assert.equal(intro.gap, 325);
  assert.equal(validateChunk(intro.source, intro.target, DOUBLE_JUMP), false);

  // A licao da micorriza e protegida pela geometria, nao por proibir a escada:
  // a travessia da estreia e horizontal (vao grande, desnivel pequeno) e a
  // escada de Azo e vertical, so considerando destinos bem acima do hospedeiro.
  // Assim a habilidade da Fase 3 continua existindo aqui sem resolver a prova.
  assert.ok(intro.verticalOffset < 60, 'a estreia da micorriza precisa ser horizontal');
  assert.ok(
    ladders.every(ladder => ladder.destination !== intro.target),
    'nenhuma escada pode vencer a travessia que estreia a micorriza',
  );
  assert.ok(
    ladders.every(ladder => ladder.host !== intro.source),
    'a raiz que ancora a estreia da micorriza nao vira hospedeira de escada',
  );

  // Cartao e poder pertencem a MESMA micorriza — e ela e o organismo da
  // ecologia, nao um item de coleta a parte. Enquanto o poder morava num ally,
  // o jogador podia ver e capturar a micorriza sem nunca ligar a mecanica da
  // ponte, e ai nenhuma ponte se formava na fase inteira.
  const mycorrhiza = encounters.filter(zone => zone.id === 'myco' && zone.source === 'debut');
  assert.equal(mycorrhiza.length, 1, 'cartao e poder devem pertencer a mesma micorriza');
  assert.equal(mycorrhiza[0].logicIndex, 3);
  assert.equal(mycorrhiza[0].cardId, 'organism-mycorrhiza');
  assert.equal(mycorrhiza[0].unlockFeature, 'mycorrhizaStructures');
  assert.equal(
    level.allies.filter(ally => ally.id === 'myco').length, 0,
    'o item de coleta da micorriza nao pode voltar',
  );
});

test('Azo fornece N associativo pequeno, nao cria nodulo e so potencializa Rhizobium no mesmo sistema', () => {
  const rootA = { type: 'root', rootSystemId: 'system-a' };
  const rootB = { type: 'root', rootSystemId: 'system-b' };
  const colony = {
    id: 'azo-1', type: 'azospirillum', platform: rootA,
    growth: 1, vigor: 1, rechargeIntensity: 1, dormant: false,
  };
  const site = {
    id: 'nodule-1', platform: rootB, mature: true,
    stage: 'mature-nodule', fixationRate: .2,
  };
  const state = {
    gameState: 'play', campaign: { phase: 3 },
    level: { campaignPhase: 3, rhizobiumNodules: [site] },
    player: { soil: 0, hope: 0 }, toast: '', toastTime: 0,
  };
  const inoculants = { colonies: [colony] };
  const nitrogen = createAzospirillumNitrogen({ state, inoculants });
  nitrogen.update(1);
  assert.equal(state.level.rhizobiumNodules.length, 1, 'Azo nao deve criar nodulos');
  assert.ok(nitrogen.associativeNitrogenRate > 0);
  assert.ok(nitrogen.associativeNitrogenRate < site.fixationRate);
  assert.equal(site.fixationRate, .2);
  assert.equal(site.azospirillumSynergyActive, false);

  rootB.rootSystemId = 'system-a';
  nitrogen.update(1);
  assert.equal(site.fixationRate, .24);
  assert.equal(site.azospirillumSynergyActive, true);
  assert.equal(state.toast, 'Co-inoculação: FBN potencializada');

  colony.dormant = true;
  nitrogen.update(1);
  assert.equal(site.fixationRate, .2);
  assert.equal(site.azospirillumSynergyActive, false);
});

// Este caminho — com sistema de inoculantes ligado — nao era exercitado por
// nenhum teste, e por isso um ReferenceError nele passou direto e so aparecia
// como congelamento em jogo, engolido pelo catch do loop principal.
function cenaPonte({ colonies = [] } = {}) {
  const origem = { x: 200, y: 400, w: 200, h: 60, type: 'root', logicIndex: 3 };
  const destino = { x: 520, y: 400, w: 200, h: 60, type: 'root', logicIndex: 4 };
  const state = {
    gameState: 'play',
    time: 0,
    cameraX: 0,
    campaign: { phase: 4 },
    player: { soil: 0, hope: 0 },
    level: {
      platforms: [origem, destino],
      exudateClouds: [{
        id: 'nuvem', x: origem.x + origem.w - 16, y: origem.y - 18,
        radius: 95, maxLife: 10, life: 9,
      }],
      particles: [],
    },
  };
  const structures = createMycorrhizaStructures({
    state, entities: { burst() {} },
  });
  return { state, structures, origem, destino };
}

test('a ponte exige colonia de micorriza inoculada e nao quebra o loop sem ela', () => {
  const semColonia = cenaPonte();
  semColonia.structures.setInoculants({ colonies: [] });
  // O que importa aqui e nao lancar: um erro neste ponto congela o jogo inteiro.
  assert.doesNotThrow(() => semColonia.structures.update(.8));
  assert.equal(semColonia.structures.bridgeCount, 0, 'exsudato solto nao cria ponte');

  const comColonia = cenaPonte();
  comColonia.structures.setInoculants({
    colonies: [{
      type: 'myco', platform: comColonia.origem,
      growth: 1, vigor: 1, dormant: false,
    }],
  });
  assert.doesNotThrow(() => comColonia.structures.update(.8));
  assert.equal(comColonia.structures.bridgeCount, 1, 'com micorriza madura na origem, a ponte nasce');

  const imatura = cenaPonte();
  imatura.structures.setInoculants({
    colonies: [{
      type: 'myco', platform: imatura.origem,
      growth: .2, vigor: 1, dormant: false,
    }],
  });
  imatura.structures.update(.8);
  assert.equal(imatura.structures.bridgeCount, 0, 'colonia ainda imatura nao sustenta ponte');
});

test('micorriza gera somente pontes predominantemente horizontais', () => {
  const source = { x: 100, y: 500, w: 200, h: 60, type: 'root', logicIndex: 4 };
  const target = { x: 430, y: 520, w: 210, h: 60, type: 'root', logicIndex: 5 };
  const upper = { x: 210, y: 245, w: 180, h: 55, type: 'root', logicIndex: 6 };
  const cloud = { id: 'myco-cloud', x: 282, y: 475, radius: 95, maxLife: 10, life: 9 };
  const state = {
    gameState: 'play', time: 0, cameraX: 0,
    campaign: { phase: 4 }, player: { soil: 0, hope: 0, canDash: false },
    level: { campaignPhase: 4, platforms: [source, target, upper], exudateClouds: [cloud] },
  };
  const structures = createMycorrhizaStructures({ state, entities: { burst() {} } });
  structures.update(.8);
  assert.equal(structures.structureCount, 1);
  assert.equal(structures.ladderCount, 0);
  assert.equal(structures.bridgeCount, 1);
  assert.equal(structures.structures.every(structure => structure.type === 'bridge'), true);
  assert.equal(structures.structures.every(structure => Math.abs(structure.end.y - structure.start.y) <= 68), true);
  assert.equal(state.player.canDash, false, 'a ponte deve funcionar antes do desbloqueio do Dash');
});

test('seed padrao do Phase Lab 4 forma a ponte antes do Dash', () => {
  const campaign = createCampaign('phase-lab-4');
  campaign.phase = 4;
  campaign.unlocks = getPersistentUnlocksBeforePhase(4);
  const profile = prepareCampaignGeneration(campaign);
  const seedValue = campaignPhaseSeed(campaign);
  const rawLevel = generateLevel(seedValue);
  applyPhaseFourMycorrhizaIntro(rawLevel, 4, getPhaseManifest(4).mycorrhizaBridge);
  const level = decorateCampaignLevel(rawLevel, campaign, profile);
  const source = level.platforms.find(platform => !platform.recovery && platform.logicIndex === 3);
  assert.ok(source, 'a seed padrao deve conter a raiz do desbloqueio micorrizico');

  const cloud = {
    id: 'phase-lab-4-cloud',
    x: source.x + source.w - 20,
    y: source.y - 20,
    radius: 95,
    maxLife: 10,
    life: 9,
  };
  level.exudateClouds = [cloud];
  const state = {
    gameState: 'play', time: 0, cameraX: 0,
    campaign: { phase: 4 },
    player: { soil: 0, hope: 0, canDash: false },
    level,
  };
  const structures = createMycorrhizaStructures({ state, entities: { burst() {} } });
  structures.update(.8);

  assert.equal(structures.bridgeCount, 1);
  assert.equal(structures.structures[0].source.logicIndex, 3);
  assert.equal(structures.structures[0].target.logicIndex, 4);
  assert.ok(Math.abs(structures.structures[0].end.y - structures.structures[0].start.y) <= 68);
  assert.equal(state.player.canDash, false);
});
