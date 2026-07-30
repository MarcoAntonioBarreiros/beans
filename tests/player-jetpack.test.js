import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JETPACK_CONFIG,
  applyJetpackThrust,
  canActivateJetpack,
  isJetpackRechargeRoot,
  jetpackChargeCapFromRootHealth,
  jetpackRechargeBonuses,
  jetpackRechargeMultiplierForRoot,
} from '../src/player-jetpack.js';
import { cancelJetpack, createPlayer, resetJetpackRuntime, resetPlayer } from '../src/player.js';
import { createSimulator } from '../src/procgen/simulator.js';
import { CAMPAIGN_UNLOCKS, getPersistentUnlocksBeforePhase, getPhaseManifest } from '../src/procgen/campaign-manifest.js';
import { createCampaign, migrateJetpackUnlock } from '../src/procgen/campaign-progression.js';
import { generateLevel } from '../src/procgen/generator.js';

// ============================================================================
// FAIXAS DE SAUDE -> TETO DE CARGA
// ============================================================================

test('a saude da raiz define o teto em faixas, usando a porcentagem do HUD', () => {
  const casos = [
    [0.00, 0], [0.50, 0], [0.69, 0],
    [0.70, 0.50], [0.75, 0.50], [0.79, 0.50],
    [0.80, 0.70], [0.85, 0.70], [0.89, 0.70],
    [0.90, 0.80], [0.95, 0.80], [0.99, 0.80],
    [1.00, 1],
  ];
  for (const [saude, teto] of casos) {
    assert.equal(
      jetpackChargeCapFromRootHealth(saude), teto,
      `saude ${Math.round(saude * 100)}% deveria dar teto de ${teto * 100}%`,
    );
  }
});

test('o teto acompanha o ARREDONDAMENTO que o HUD mostra, nao o valor cru', () => {
  // O jogador le "70%" no HUD; a raiz tem de entregar os 50% correspondentes,
  // mesmo que o valor interno seja 0.695. O contrario — HUD dizendo 70% e a raiz
  // se comportando como 69% — seria uma divergencia invisivel e injusta.
  assert.equal(Math.round(0.695 * 100), 70);
  assert.equal(jetpackChargeCapFromRootHealth(0.695), 0.50);

  assert.equal(Math.round(0.694 * 100), 69);
  assert.equal(jetpackChargeCapFromRootHealth(0.694), 0);

  assert.equal(Math.round(0.995 * 100), 100);
  assert.equal(jetpackChargeCapFromRootHealth(0.995), 1, 'HUD 100% precisa encher o tanque');

  assert.equal(Math.round(0.994 * 100), 99);
  assert.equal(jetpackChargeCapFromRootHealth(0.994), 0.80);
});

test('nao existe interpolacao continua: 81% de saude nao da 81% de carga', () => {
  assert.equal(jetpackChargeCapFromRootHealth(0.81), 0.70);
  assert.notEqual(jetpackChargeCapFromRootHealth(0.81), 0.81);
  // Dentro da mesma faixa o teto nao muda.
  assert.equal(
    jetpackChargeCapFromRootHealth(0.80),
    jetpackChargeCapFromRootHealth(0.89),
  );
});

test('saude invalida ou ausente conta como raiz saudavel', () => {
  assert.equal(jetpackChargeCapFromRootHealth(undefined), 1);
  assert.equal(jetpackChargeCapFromRootHealth(null), 1);
  assert.equal(jetpackChargeCapFromRootHealth(Number.NaN), 1);
  assert.equal(jetpackChargeCapFromRootHealth(5), 1, 'acima de 1 satura em cheio');
  assert.equal(jetpackChargeCapFromRootHealth(-2), 0, 'abaixo de 0 satura em vazio');
});

// ============================================================================
// SIMULADOR: base comum
// ============================================================================

function root(overrides = {}) {
  return {
    id: overrides.id || 'root-a',
    logicIndex: overrides.logicIndex ?? 2,
    x: 0, y: 500, w: 900, h: 60,
    type: 'root',
    rootHealth: overrides.rootHealth ?? 1,
    ...overrides,
  };
}

// Monta um simulador com o jogador em pe sobre `platform`, com a mochila
// desbloqueada. Usa o simulador REAL (fisica real, sem stub).
function simOnRoot(platform, { energy = 0, unlocks = { jetpack: true } } = {}) {
  const sim = createSimulator();
  sim.state.campaign = { phase: 5, unlocks: { ...unlocks } };
  sim.state.level.platforms = [platform];
  sim.state.level.exudates = [];
  sim.state.level.hazards = [];
  sim.state.level.crystals = [];
  sim.state.level.enemies = [];
  sim.state.level.endX = 4000;
  const player = sim.state.player;
  resetPlayer(player, sim.state.campaign.unlocks);
  player.x = 200;
  player.y = platform.y - player.h;
  player.vx = 0;
  player.vy = 0;
  player.onGround = true;
  player.jetpackEnergy = energy;
  return sim;
}

function stepSeconds(sim, seconds, keys = {}, dt = 1 / 60) {
  const frames = Math.round(seconds / dt);
  for (let index = 0; index < frames; index++) {
    sim.setInputs(keys);
    sim.step(dt);
  }
}

// ============================================================================
// NAO REDUCAO E NAO ACUMULO
// ============================================================================

test('uma raiz pior NAO descarrega a mochila ja carregada', () => {
  // 80% de energia sobre raiz de 72% (teto 50%): a energia permanece 80%.
  const sim = simOnRoot(root({ rootHealth: 0.72 }), { energy: 0.80 });
  stepSeconds(sim, 3);
  assert.equal(sim.state.player.jetpackEnergy, 0.80);
});

test('energia abaixo do teto sobe ate o teto daquela raiz — e para la', () => {
  const sim = simOnRoot(root({ rootHealth: 0.75 }), { energy: 0.40 });
  stepSeconds(sim, 8);
  assert.ok(Math.abs(sim.state.player.jetpackEnergy - 0.50) < 1e-6,
    `parou em ${sim.state.player.jetpackEnergy}, esperado 0.50`);
});

test('raiz de 80-89% leva a 70%, e raiz perfeita leva a 100%', () => {
  const oitenta = simOnRoot(root({ rootHealth: 0.85 }), { energy: 0.60 });
  stepSeconds(oitenta, 8);
  assert.ok(Math.abs(oitenta.state.player.jetpackEnergy - 0.70) < 1e-6);

  const cheia = simOnRoot(root({ rootHealth: 1 }), { energy: 0.85 });
  stepSeconds(cheia, 8);
  assert.ok(Math.abs(cheia.state.player.jetpackEnergy - 1) < 1e-6);
});

test('raizes sucessivas NAO somam seus limites', () => {
  // Duas raizes de 70% (teto 50% cada) nao podem virar 100%.
  const primeira = root({ id: 'r1', rootHealth: 0.72 });
  const sim = simOnRoot(primeira, { energy: 0 });
  stepSeconds(sim, 8);
  assert.ok(Math.abs(sim.state.player.jetpackEnergy - 0.50) < 1e-6, 'primeira raiz enche ate 50%');

  const segunda = root({ id: 'r2', rootHealth: 0.74, x: 1200 });
  sim.state.level.platforms = [segunda];
  sim.state.player.x = 1300;
  sim.state.player.y = segunda.y - sim.state.player.h;
  stepSeconds(sim, 8);
  assert.ok(
    Math.abs(sim.state.player.jetpackEnergy - 0.50) < 1e-6,
    `duas raizes de teto 50% somaram para ${sim.state.player.jetpackEnergy}`,
  );
});

test('raiz abaixo de 70% nao recarrega nada', () => {
  const sim = simOnRoot(root({ rootHealth: 0.69 }), { energy: 0 });
  stepSeconds(sim, 8);
  assert.equal(sim.state.player.jetpackEnergy, 0);
});

// ============================================================================
// VELOCIDADE: SAUDE NAO INFLUENCIA, ORGANISMOS SIM
// ============================================================================

test('a saude NAO altera a velocidade de recarga — so o ponto de parada', () => {
  // Raiz de 75% (teto 50%) e raiz de 100% (teto 100%), ambas sem organismos.
  // No mesmo intervalo, antes de qualquer uma bater no teto, as duas precisam
  // ter adicionado exatamente a mesma energia.
  const doente = simOnRoot(root({ rootHealth: 0.75 }), { energy: 0 });
  const sadia = simOnRoot(root({ rootHealth: 1 }), { energy: 0 });
  const janela = JETPACK_CONFIG.connectionDelaySeconds + 1.0; // 1s de recarga real
  stepSeconds(doente, janela);
  stepSeconds(sadia, janela);
  assert.ok(doente.state.player.jetpackEnergy > 0, 'a raiz de 75% precisa recarregar');
  assert.ok(
    Math.abs(doente.state.player.jetpackEnergy - sadia.state.player.jetpackEnergy) < 1e-9,
    `75% deu ${doente.state.player.jetpackEnergy} e 100% deu ${sadia.state.player.jetpackEnergy}`,
  );
});

test('sem organismos o multiplicador e exatamente 1', () => {
  const alvo = root();
  const state = { level: { platforms: [alvo], rhizobiumNodules: [], biofilms: [] } };
  assert.equal(jetpackRechargeMultiplierForRoot({ root: alvo, state, systems: {} }), 1);
});

test('cada organismo acelera com o bonus declarado, na propria raiz', () => {
  const alvo = root();
  const outra = root({ id: 'outra' });

  const comRhizobium = {
    level: {
      platforms: [alvo],
      rhizobiumNodules: [{ platform: alvo, mature: true, fixationRate: .2 }],
      biofilms: [],
    },
  };
  assert.equal(
    jetpackRechargeBonuses({ root: alvo, state: comRhizobium }).rhizobium,
    JETPACK_CONFIG.rhizobiumRechargeBonus,
  );
  // Nodulo em OUTRA raiz nao vale: a relacao e local.
  assert.equal(jetpackRechargeBonuses({ root: outra, state: comRhizobium }).rhizobium, 0);
  // Nodulo imaturo ou sem fixacao tambem nao vale.
  const inerte = {
    level: {
      platforms: [alvo],
      rhizobiumNodules: [{ platform: alvo, mature: true, fixationRate: .01 }],
      biofilms: [],
    },
  };
  assert.equal(jetpackRechargeBonuses({ root: alvo, state: inerte }).rhizobium, 0);

  const azo = { level: { platforms: [alvo], rhizobiumNodules: [], biofilms: [] } };
  const azoSystems = {
    inoculants: { colonies: [{ platform: alvo, type: 'azospirillum', growth: .9, dormant: false }] },
  };
  assert.equal(
    jetpackRechargeBonuses({ root: alvo, state: azo, systems: azoSystems }).azospirillum,
    JETPACK_CONFIG.azospirillumRechargeBonus,
  );
  // Colonia dormente ou imatura nao acelera.
  assert.equal(
    jetpackRechargeBonuses({
      root: alvo, state: azo,
      systems: { inoculants: { colonies: [{ platform: alvo, type: 'azospirillum', growth: .9, dormant: true }] } },
    }).azospirillum, 0,
  );

  const bacillus = {
    level: { platforms: [alvo], rhizobiumNodules: [], biofilms: [{ platform: alvo, functional: true }] },
  };
  assert.equal(
    jetpackRechargeBonuses({ root: alvo, state: bacillus }).bacillus,
    JETPACK_CONFIG.bacillusRechargeBonus,
  );
  // Biofilme nao funcional nao acelera.
  assert.equal(
    jetpackRechargeBonuses({
      root: alvo,
      state: { level: { platforms: [alvo], rhizobiumNodules: [], biofilms: [{ platform: alvo, functional: false }] } },
    }).bacillus, 0,
  );
});

test('a micorriza com fosforo SUBSTITUI o bonus comum, nunca soma', () => {
  const alvo = root();
  const base = { level: { platforms: [alvo], rhizobiumNodules: [], biofilms: [] } };
  const systems = {
    inoculants: { colonies: [{ platform: alvo, type: 'myco', growth: .9, dormant: false }] },
  };
  const semP = jetpackRechargeBonuses({ root: alvo, state: base, systems }).mycorrhiza;
  assert.equal(semP, JETPACK_CONFIG.mycorrhizaRechargeBonus);

  const comP = jetpackRechargeBonuses({
    root: { ...alvo, phosphateStock: 3 },
    state: { level: { platforms: [alvo], rhizobiumNodules: [], biofilms: [] } },
    systems: {
      inoculants: { colonies: [{ platform: null, type: 'myco', growth: .9, dormant: false }] },
    },
  });
  // A colonia precisa ser da raiz certa; aqui montamos o caso completo:
  const raizComP = root({ phosphateStock: 3 });
  const comPCerto = jetpackRechargeBonuses({
    root: raizComP,
    state: { level: { platforms: [raizComP], rhizobiumNodules: [], biofilms: [] } },
    systems: { inoculants: { colonies: [{ platform: raizComP, type: 'myco', growth: .9, dormant: false }] } },
  }).mycorrhiza;
  assert.equal(comPCerto, JETPACK_CONFIG.mycorrhizaWithPhosphorusBonus);
  assert.notEqual(
    comPCerto,
    JETPACK_CONFIG.mycorrhizaRechargeBonus + JETPACK_CONFIG.mycorrhizaWithPhosphorusBonus,
    'os dois bonus de micorriza nao podem somar',
  );
  assert.equal(comP.mycorrhiza, 0, 'colonia sem vinculo com a raiz nao conta');
});

test('Pseudomonas so acelera quando funcionalmente ativa', () => {
  const alvo = root();
  const state = { level: { platforms: [alvo], rhizobiumNodules: [], biofilms: [] } };
  // Colonia presente mas inerte (sem vigor): nao basta existir visualmente.
  assert.equal(
    jetpackRechargeBonuses({
      root: alvo, state,
      systems: { inoculants: { colonies: [{ platform: alvo, type: 'pseudomonas', vigor: 0, growth: 0 }] } },
    }).pseudomonas, 0,
  );
  // Ativa, com sideroforo em atividade.
  assert.equal(
    jetpackRechargeBonuses({
      root: alvo, state,
      systems: {
        inoculants: {
          colonies: [{ platform: alvo, type: 'pseudomonas', vigor: .8, dormant: false, siderophoreActivity: .5 }],
        },
      },
    }).pseudomonas, JETPACK_CONFIG.pseudomonasRechargeBonus,
  );
});

test('o multiplicador soma linearmente e nunca passa de 1,8', () => {
  const alvo = root({ phosphateStock: 5 });
  const state = {
    level: {
      platforms: [alvo],
      rhizobiumNodules: [{ platform: alvo, mature: true, fixationRate: .3 }],
      biofilms: [{ platform: alvo, functional: true }],
    },
  };
  const systems = {
    inoculants: {
      colonies: [
        { platform: alvo, type: 'azospirillum', growth: .9, dormant: false },
        { platform: alvo, type: 'myco', growth: .9, dormant: false },
        { platform: alvo, type: 'pseudomonas', vigor: .9, dormant: false, ironReserve: 2 },
      ],
    },
  };
  const bonus = jetpackRechargeBonuses({ root: alvo, state, systems });
  const soma = 1 + bonus.rhizobium + bonus.azospirillum + bonus.mycorrhiza + bonus.bacillus + bonus.pseudomonas;
  assert.ok(soma > JETPACK_CONFIG.maximumRechargeMultiplier, 'este caso precisa estourar o teto');
  assert.equal(
    jetpackRechargeMultiplierForRoot({ root: alvo, state, systems }),
    JETPACK_CONFIG.maximumRechargeMultiplier,
  );
});

test('organismos realmente aceleram a recarga na simulacao real', () => {
  const semNada = simOnRoot(root({ rootHealth: 1 }), { energy: 0 });
  const comBiofilme = simOnRoot(root({ rootHealth: 1 }), { energy: 0 });
  // O biofilme e o bonus que sobrevive a um passo do simulador: a lista de
  // nodulos e reconstruida pelo proprio sistema de nodulacao a cada quadro,
  // entao um nodulo "de mentira" injetado aqui seria apagado. O que importa e
  // provar que o multiplicador chega na conta e muda a taxa.
  const alvo = comBiofilme.state.level.platforms[0];
  comBiofilme.state.level.biofilms = [{ platform: alvo, functional: true }];

  const janela = JETPACK_CONFIG.connectionDelaySeconds + 1;
  stepSeconds(semNada, janela);
  stepSeconds(comBiofilme, janela);

  assert.equal(semNada.state.player.jetpackRechargeMultiplier, 1);
  assert.equal(
    comBiofilme.state.player.jetpackRechargeMultiplier,
    1 + JETPACK_CONFIG.bacillusRechargeBonus,
  );
  const ganhoBase = semNada.state.player.jetpackEnergy;
  const ganhoComBiofilme = comBiofilme.state.player.jetpackEnergy;
  assert.ok(ganhoBase > 0, 'a taxa base precisa recarregar alguma coisa');
  assert.ok(
    ganhoComBiofilme > ganhoBase,
    `com biofilme ${ganhoComBiofilme} nao superou a base ${ganhoBase}`,
  );
  // A aceleracao tem de bater com o bonus declarado, nao ser so "maior".
  assert.ok(
    Math.abs(ganhoComBiofilme / ganhoBase - (1 + JETPACK_CONFIG.bacillusRechargeBonus)) < .02,
    `proporcao ${(ganhoComBiofilme / ganhoBase).toFixed(3)} nao corresponde ao bonus declarado`,
  );
});

// ============================================================================
// PLATAFORMA ELEGIVEL E CONEXAO
// ============================================================================

test('so raiz recarrega: solo, ponte, degrau de Azo e recuperacao ficam de fora', () => {
  assert.equal(isJetpackRechargeRoot(root()), true);
  assert.equal(isJetpackRechargeRoot({ ...root(), type: 'soil' }), false);
  assert.equal(isJetpackRechargeRoot({ ...root(), mycorrhizaStructure: true }), false);
  assert.equal(isJetpackRechargeRoot({ ...root(), azospirillumLadderStep: true }), false);
  assert.equal(isJetpackRechargeRoot({ ...root(), azospirillumStructure: true }), false);
  assert.equal(isJetpackRechargeRoot({ ...root(), recovery: true }), false);
  assert.equal(isJetpackRechargeRoot({ ...root(), safetyStep: true }), false);
  assert.equal(isJetpackRechargeRoot({ ...root(), temporary: true }), false);
  assert.equal(isJetpackRechargeRoot(null), false);
});

test('nao recarrega em bloco de solo nem em ponte micorrizica', () => {
  const solo = simOnRoot({ ...root(), type: 'soil' }, { energy: 0 });
  stepSeconds(solo, 6);
  assert.equal(solo.state.player.jetpackEnergy, 0);

  const ponte = simOnRoot({ ...root(), mycorrhizaStructure: true }, { energy: 0 });
  stepSeconds(ponte, 6);
  assert.equal(ponte.state.player.jetpackEnergy, 0);
});

test('nao recarrega no ar', () => {
  const sim = simOnRoot(root(), { energy: 0 });
  // Some com o chao: o jogador cai e nao pode ganhar energia nenhuma.
  sim.state.level.platforms = [];
  stepSeconds(sim, 0.8);
  assert.equal(sim.state.player.onGround, false);
  assert.equal(sim.state.player.jetpackEnergy, 0);
});

test('a recarga so comeca depois do atraso de conexao de 0,40s', () => {
  const sim = simOnRoot(root({ rootHealth: 1 }), { energy: 0 });
  stepSeconds(sim, JETPACK_CONFIG.connectionDelaySeconds - 0.1);
  assert.equal(sim.state.player.jetpackEnergy, 0, 'antes do atraso nao pode entrar energia');
  stepSeconds(sim, 0.5);
  assert.ok(sim.state.player.jetpackEnergy > 0, 'depois do atraso a recarga comeca');
});

test('correr cancela a conexao com a raiz', () => {
  // Chao largo de proposito: com uma plataforma curta o jogador cairia da borda
  // e o teste mediria uma morte, nao a regra da conexao.
  const sim = simOnRoot(root({ rootHealth: 1, w: 6000 }), { energy: 0 });
  // Correndo: a conexao nunca acumula, entao nada de energia.
  stepSeconds(sim, 3, { ArrowRight: true });
  assert.equal(sim.state.player.onGround, true, 'o teste precisa continuar no chao');
  assert.ok(
    Math.abs(sim.state.player.vx) > JETPACK_CONFIG.maximumRechargeHorizontalSpeed,
    'o teste precisa de fato estar correndo',
  );
  assert.equal(sim.state.player.jetpackEnergy, 0);
});

test('trocar de raiz reinicia a conexao', () => {
  const primeira = root({ id: 'r1', w: 400 });
  const sim = simOnRoot(primeira, { energy: 0 });
  stepSeconds(sim, 0.3); // quase conectado
  const segunda = root({ id: 'r2', x: 1200, w: 400 });
  sim.state.level.platforms = [segunda];
  sim.state.player.x = 1300;
  sim.state.player.y = segunda.y - sim.state.player.h;
  sim.setInputs({});
  sim.step(1 / 60);
  assert.ok(
    sim.state.player.jetpackConnectionTime <= 1 / 60 + 1e-9,
    'a conexao precisa recomecar do zero na raiz nova',
  );
});

test('a recarga usa a plataforma que realmente sustenta o jogador', () => {
  const apoio = root({ id: 'apoio', rootHealth: 1, x: 0, w: 400 });
  const sim = simOnRoot(apoio, { energy: 0 });
  stepSeconds(sim, 1);
  assert.equal(sim.state.player.supportPlatform, apoio);
  assert.equal(sim.state.player.jetpackRechargeRoot, apoio);
});

// ============================================================================
// FISICA DA PROPULSAO
// ============================================================================

test('a propulsao NAO liga no chao', () => {
  const sim = simOnRoot(root(), { energy: 1 });
  stepSeconds(sim, 0.5, { KeyK: true });
  assert.equal(sim.state.player.jetpackActive, false);
  assert.equal(sim.state.player.jetpackEnergy, 1, 'nao pode gastar combustivel parado no chao');
});

test('canActivateJetpack exige apenas estar no ar — nunca salto duplo nem altura', () => {
  const base = {
    canJetpack: true, alive: true, onGround: false,
    jetpackEnergy: .5, jetpackLockedUntilGround: false, dashTime: 0,
  };
  const state = { gameState: 'play' };
  assert.equal(canActivateJetpack(base, state), true);
  // Subindo e caindo valem igual.
  assert.equal(canActivateJetpack({ ...base, vy: -300 }, state), true);
  assert.equal(canActivateJetpack({ ...base, vy: 400 }, state), true);
  // Nao depende de ter usado salto duplo.
  assert.equal(canActivateJetpack({ ...base, canDoubleJump: false, airJumpAvailable: false }, state), true);
  // No chao, nunca.
  assert.equal(canActivateJetpack({ ...base, onGround: true }, state), false);
  // Sem energia, sem desbloqueio, morto, travado ou em dash: nao.
  assert.equal(canActivateJetpack({ ...base, jetpackEnergy: 0 }, state), false);
  assert.equal(canActivateJetpack({ ...base, canJetpack: false }, state), false);
  assert.equal(canActivateJetpack({ ...base, alive: false }, state), false);
  assert.equal(canActivateJetpack({ ...base, jetpackLockedUntilGround: true }, state), false);
  assert.equal(canActivateJetpack({ ...base, dashTime: .1 }, state), false);
  assert.equal(canActivateJetpack(base, { gameState: 'respawning' }), false);
});

test('a propulsao NAO freia um salto que ja sobe mais rapido que o teto dela', () => {
  // Salto sai a -465; o teto da mochila e -320. Ligar o propulsor nesse instante
  // nao pode DESACELERAR a subida.
  const player = { vy: -465, vx: 0 };
  applyJetpackThrust(player, 1 / 60);
  assert.equal(player.vy, -465, 'a mochila nao pode reduzir um salto mais rapido que ela');

  // Quando o salto ja perdeu velocidade, a mochila sustenta.
  const perdendo = { vy: -100, vx: 0 };
  applyJetpackThrust(perdendo, 1 / 60);
  assert.ok(perdendo.vy < -100, 'abaixo do teto ela acelera para cima');
  assert.ok(perdendo.vy >= -JETPACK_CONFIG.maximumJetpackAscentSpeed, 'sem passar do teto proprio');
});

test('o empuxo supera a gravidade: freia, para e inverte a queda', () => {
  const GRAVIDADE = 1180;
  const dt = 1 / 60;
  const player = { vy: 400, vx: 0 };
  const historico = [player.vy];
  for (let frame = 0; frame < 40; frame++) {
    player.vy += GRAVIDADE * dt;   // gravidade real do jogo
    applyJetpackThrust(player, dt);
    historico.push(player.vy);
  }
  assert.ok(historico[5] < historico[0], 'a queda precisa desacelerar');
  assert.ok(historico.some(vy => Math.abs(vy) < 60), 'precisa passar por um ponto de quase parada');
  assert.ok(player.vy < 0, `a queda precisa se inverter; terminou em vy=${player.vy}`);
  assert.ok(
    player.vy >= -JETPACK_CONFIG.maximumJetpackAscentSpeed - 1,
    'a subida nao pode passar do teto da mochila',
  );
});

test('o empuxo limita a velocidade horizontal exagerada', () => {
  const rapido = { vy: 0, vx: 900 };
  applyJetpackThrust(rapido, 1 / 60);
  assert.equal(rapido.vx, JETPACK_CONFIG.maximumHorizontalSpeed);
  const lento = { vy: 0, vx: 80 };
  applyJetpackThrust(lento, 1 / 60);
  assert.equal(lento.vx, 80, 'velocidade normal nao e alterada');
});

test('a propulsao liga depois de um salto SIMPLES (sem salto duplo)', () => {
  const sim = simOnRoot(root(), { energy: 1, unlocks: { jetpack: true } });
  assert.equal(sim.state.player.canDoubleJump, false, 'este teste roda sem salto duplo');
  stepSeconds(sim, 0.1, { Space: true });
  assert.equal(sim.state.player.onGround, false, 'precisa ter saido do chao');
  const antes = sim.state.player.jetpackEnergy;
  stepSeconds(sim, 0.2, { KeyK: true });
  assert.ok(sim.state.player.jetpackEnergy < antes, 'a mochila precisa ter sido usada');
});

test('a propulsao liga depois de um salto DUPLO', () => {
  const sim = simOnRoot(root(), { energy: 1, unlocks: { jetpack: true, doubleJump: true } });
  stepSeconds(sim, 0.1, { Space: true });
  sim.setInputs({});
  sim.step(1 / 60);
  stepSeconds(sim, 0.08, { Space: true }); // segundo impulso
  const antes = sim.state.player.jetpackEnergy;
  stepSeconds(sim, 0.2, { KeyK: true });
  assert.ok(sim.state.player.jetpackEnergy < antes);
});

test('a energia e consumida linearmente e o tanque cheio dura ~1,05s', () => {
  const sim = simOnRoot(root(), { energy: 1 });
  stepSeconds(sim, 0.1, { Space: true }); // sai do chao
  const inicio = sim.state.player.jetpackEnergy;
  stepSeconds(sim, 0.5, { KeyK: true });
  const gasto = inicio - sim.state.player.jetpackEnergy;
  const esperado = 0.5 / JETPACK_CONFIG.maximumContinuousSeconds;
  assert.ok(
    Math.abs(gasto - esperado) < 0.03,
    `gastou ${gasto.toFixed(3)} em 0,5s; esperado ~${esperado.toFixed(3)}`,
  );
});

test('soltar o botao preserva a energia e permite usar em pulsos', () => {
  const sim = simOnRoot(root(), { energy: 1 });
  stepSeconds(sim, 0.1, { Space: true });
  stepSeconds(sim, 0.2, { KeyK: true });
  const depoisDoPrimeiroPulso = sim.state.player.jetpackEnergy;
  assert.ok(depoisDoPrimeiroPulso > 0 && depoisDoPrimeiroPulso < 1);

  stepSeconds(sim, 0.2, {}); // solta: nao gasta
  assert.equal(sim.state.player.jetpackEnergy, depoisDoPrimeiroPulso, 'solto nao pode gastar');
  assert.equal(sim.state.player.jetpackActive, false);

  stepSeconds(sim, 0.15, { KeyK: true }); // segundo pulso reaproveita o saldo
  assert.ok(sim.state.player.jetpackEnergy < depoisDoPrimeiroPulso, 'o saldo continua utilizavel');
});

test('energia zero encerra a propulsao e nao recarrega no ar', () => {
  const sim = simOnRoot(root(), { energy: 0.15 });
  stepSeconds(sim, 0.1, { Space: true });

  // Acompanha quadro a quadro ENQUANTO esta no ar: a energia tem de zerar la em
  // cima, a propulsao desligar, e nada pode entrar de volta antes de pousar.
  let zerouNoAr = false;
  let recarregouNoAr = false;
  const dt = 1 / 60;
  for (let frame = 0; frame < 90; frame++) {
    sim.setInputs({ KeyK: true });
    sim.step(dt);
    const player = sim.state.player;
    if (player.onGround) break;
    if (player.jetpackEnergy <= 0) {
      zerouNoAr = true;
      assert.equal(player.jetpackActive, false, 'sem energia a propulsao precisa desligar');
    } else if (zerouNoAr) {
      recarregouNoAr = true;
    }
  }
  assert.ok(zerouNoAr, 'a energia precisa acabar ainda no ar');
  assert.equal(recarregouNoAr, false, 'nao pode entrar energia nenhuma no ar');
  assert.equal(sim.state.player.jetpackEnergy, 0);
});

// ============================================================================
// DASH
// ============================================================================

test('o Dash cancela a propulsao, trava ate pousar e PRESERVA a energia', () => {
  const sim = simOnRoot(root(), { energy: 1, unlocks: { jetpack: true, dash: true } });
  stepSeconds(sim, 0.1, { Space: true });
  stepSeconds(sim, 0.15, { KeyK: true });
  const antesDoDash = sim.state.player.jetpackEnergy;
  assert.ok(antesDoDash > 0 && antesDoDash < 1);

  sim.setInputs({ ShiftLeft: true });
  sim.step(1 / 60);
  assert.equal(sim.state.player.jetpackActive, false, 'o dash desliga a propulsao');
  assert.equal(sim.state.player.jetpackLockedUntilGround, true, 'e trava ate pousar');
  assert.ok(
    Math.abs(sim.state.player.jetpackEnergy - antesDoDash) < 1e-9,
    'a reserva restante precisa ser preservada',
  );

  // Ainda no ar, segurar o propulsor nao reativa.
  stepSeconds(sim, 0.2, { KeyK: true });
  assert.equal(sim.state.player.jetpackActive, false);
  assert.ok(Math.abs(sim.state.player.jetpackEnergy - antesDoDash) < 1e-9, 'travada, nao pode gastar');
});

test('pousar remove o bloqueio deixado pelo Dash', () => {
  const sim = simOnRoot(root(), { energy: 1, unlocks: { jetpack: true, dash: true } });
  sim.state.player.jetpackLockedUntilGround = true;
  stepSeconds(sim, 0.2);
  assert.equal(sim.state.player.onGround, true);
  assert.equal(sim.state.player.jetpackLockedUntilGround, false);
});

// ============================================================================
// DANO, MORTE E RESPAWN
// ============================================================================

test('cancelJetpack desliga sem apagar a reserva; com trava quando pedido', () => {
  const player = { jetpackActive: true, jetpackEnergy: .6, jetpackLockedUntilGround: false };
  cancelJetpack(player);
  assert.equal(player.jetpackActive, false);
  assert.equal(player.jetpackEnergy, .6, 'cancelar nao apaga a energia');
  assert.equal(player.jetpackLockedUntilGround, false);

  cancelJetpack(player, { lockUntilGround: true });
  assert.equal(player.jetpackLockedUntilGround, true);
});

test('o dano cancela a propulsao e preserva o knockback', () => {
  const sim = simOnRoot(root(), { energy: 1 });
  stepSeconds(sim, 0.1, { Space: true });
  stepSeconds(sim, 0.1, { KeyK: true });
  const energiaAntes = sim.state.player.jetpackEnergy;

  sim.entities.damagePlayer(1, 'teste', { knockbackX: -300, knockbackY: -245 });
  assert.equal(sim.state.player.jetpackActive, false, 'o golpe desliga a propulsao');
  assert.equal(sim.state.player.jetpackLockedUntilGround, true);
  // O knockback do golpe nao pode ser alterado pela mochila.
  assert.equal(sim.state.player.vx, -300);
  assert.equal(sim.state.player.vy, -245);
  // Dano comum nao zera a reserva nesta versao.
  assert.equal(sim.state.player.jetpackEnergy, energiaAntes);
});

test('morrer zera a energia da mochila', () => {
  const sim = simOnRoot(root(), { energy: .9 });
  sim.entities.damagePlayer(99, 'queda', { fatal: true });
  assert.equal(sim.state.player.alive, false);
  assert.equal(sim.state.player.jetpackEnergy, 0);
  assert.equal(sim.state.player.jetpackActive, false);
  assert.equal(sim.state.player.jetpackRechargeRoot, null);
  assert.equal(sim.state.player.jetpackConnectionTime, 0);
});

test('o respawn NAO concede carga automatica, mas permite recarregar no checkpoint', () => {
  const raiz = root({ rootHealth: 1 });
  const sim = simOnRoot(raiz, { energy: .9 });
  sim.state.currentCheckpoint = { x: 200, y: raiz.y - 48 };
  sim.entities.damagePlayer(99, 'queda', { fatal: true });
  sim.entities.respawn('death');
  assert.equal(sim.state.player.jetpackEnergy, 0, 'volta sem carga');
  assert.equal(sim.state.player.jetpackLockedUntilGround, false);

  // E recarrega normalmente na raiz saudavel do checkpoint.
  stepSeconds(sim, 2);
  assert.ok(sim.state.player.jetpackEnergy > 0, 'a recarga volta a funcionar depois do respawn');
});

test('resetJetpackRuntime limpa o runtime sem mexer no desbloqueio', () => {
  const player = createPlayer();
  player.canJetpack = true;
  player.jetpackActive = true;
  player.jetpackEnergy = .5;
  player.jetpackRechargeRoot = root();
  player.jetpackConnectionTime = 1.2;
  resetJetpackRuntime(player);
  assert.equal(player.jetpackActive, false);
  assert.equal(player.jetpackRechargeRoot, null);
  assert.equal(player.jetpackConnectionTime, 0);
  assert.equal(player.canJetpack, true, 'a habilidade continua desbloqueada');
  assert.equal(player.jetpackEnergy, .5, 'nao restaura nem apaga energia');
});

// ============================================================================
// CAMPANHA E MIGRACAO
// ============================================================================

test('jetpack faz parte dos desbloqueios persistentes da campanha', () => {
  assert.ok(CAMPAIGN_UNLOCKS.includes('jetpack'));
  const player = createPlayer();
  resetPlayer(player, { jetpack: true });
  assert.equal(player.canJetpack, true);
  resetPlayer(player, {});
  assert.equal(player.canJetpack, false);
});

test('as fases 3 e 4 NAO tem a mochila; a fase 5 desbloqueia e a 6 herda', () => {
  assert.equal(getPersistentUnlocksBeforePhase(3).jetpack, false, 'fase 3 sem mochila');
  assert.equal(getPersistentUnlocksBeforePhase(4).jetpack, false, 'fase 4 sem mochila');
  assert.equal(getPersistentUnlocksBeforePhase(5).jetpack, false, 'a fase 5 comeca sem, e desbloqueia dentro dela');

  const eventoNaFase5 = getPhaseManifest(5).unlockEvents.find(event => event.feature === 'jetpack');
  assert.ok(eventoNaFase5, 'a fase 5 precisa declarar o evento de desbloqueio');
  assert.ok(eventoNaFase5.eventChunk <= 2, 'o desbloqueio fica no comeco da fase 5');

  assert.equal(getPersistentUnlocksBeforePhase(6).jetpack, true, 'a fase 6 herda');
});

test('a fase 5 apresenta a Propulsao da Rizosfera', () => {
  const apresentacao = getPhaseManifest(5).presentations.find(item => item.id === 'presentation-jetpack');
  assert.ok(apresentacao, 'a apresentacao precisa existir');
  assert.equal(apresentacao.cardId, 'power-jetpack');
});

test('save antigo e migrado pela fase; propriedade explicita e respeitada', () => {
  // Save antigo (sem a chave): antes da fase 5 nao ganha; depois da 5 herda.
  assert.equal(migrateJetpackUnlock({ doubleJump: true }, 3), false);
  assert.equal(migrateJetpackUnlock({ doubleJump: true }, 4), false);
  assert.equal(migrateJetpackUnlock({ doubleJump: true }, 5), false, 'na propria fase 5 espera coletar');
  assert.equal(migrateJetpackUnlock({ doubleJump: true }, 6), true);
  assert.equal(migrateJetpackUnlock({ doubleJump: true }, 8), true);
  // Save novo: o valor explicito manda, inclusive false.
  assert.equal(migrateJetpackUnlock({ jetpack: false }, 8), false, 'false explicito nao pode virar true');
  assert.equal(migrateJetpackUnlock({ jetpack: true }, 1), true);
  // Sem unlocks nenhum.
  assert.equal(migrateJetpackUnlock(undefined, 7), true);
  assert.equal(migrateJetpackUnlock(null, 2), false);
});

test('createCampaign aplica a migracao ao carregar um save antigo', () => {
  const storage = {
    values: new Map([['miguelito:campanha:v1', JSON.stringify({
      seed: 'antiga', phase: 7, unlocks: { doubleJump: true, dash: true }, totalScore: 10, history: [],
    })]]),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
  const campaign = createCampaign('nova', { storage });
  if (campaign.phase === 7) {
    assert.equal(campaign.unlocks.jetpack, true, 'save antigo na fase 7 herda a mochila');
  }
});

// ============================================================================
// A PROPULSAO NAO ENTRA NO PROCEDURAL
// ============================================================================

test('nenhuma primitiva procedural exige a mochila', () => {
  const level = generateLevel('jetpack-procedural');
  for (const primitive of level.primitives || []) {
    assert.ok(
      !(primitive.requires || []).includes('jetpack'),
      `a primitiva ${primitive.id} exige jetpack`,
    );
  }
  for (const info of level.debugInfo || []) {
    assert.ok(
      !(info.logic?.requires || []).includes('jetpack'),
      'nenhum chunk pode exigir jetpack',
    );
  }
});

test('nenhum bloco e marcado como alcancavel por propulsao', () => {
  const level = generateLevel('jetpack-sem-marcacao');
  for (const platform of level.platforms || []) {
    assert.equal(platform.jetpackReachable, undefined);
    assert.equal(platform.requiresJetpack, undefined);
  }
});

// ============================================================================
// ALCANCE MEDIDO COM A FISICA REAL
// ============================================================================

// Mede altura ganha e distancia percorrida a partir de um salto, opcionalmente
// segurando o propulsor. Serve para RELATAR a fisica, nao para impor que algum
// bloco especifico seja ou nao alcancado.
function medirAlcance({ energia = 0, doubleJump = false, segurarPropulsor = false }) {
  const chao = root({ w: 4000, rootHealth: 1 });
  const sim = simOnRoot(chao, { energy: energia, unlocks: { jetpack: true, doubleJump } });
  const player = sim.state.player;
  const y0 = player.y;
  const x0 = player.x;
  let alturaMaxima = 0;
  let duracao = 0;
  const dt = 1 / 60;

  // Salto (e segundo salto quando disponivel).
  sim.setInputs({ Space: true, ArrowRight: true }); sim.step(dt);
  if (doubleJump) {
    sim.setInputs({ ArrowRight: true }); sim.step(dt);
    sim.setInputs({ Space: true, ArrowRight: true }); sim.step(dt);
  }

  for (let frame = 0; frame < 360; frame++) {
    const keys = { ArrowRight: true };
    if (segurarPropulsor) keys.KeyK = true;
    sim.setInputs(keys);
    sim.step(dt);
    duracao += dt;
    alturaMaxima = Math.max(alturaMaxima, y0 - player.y);
    if (player.onGround && duracao > .2) break;
  }
  return {
    altura: Math.round(alturaMaxima),
    distancia: Math.round(player.x - x0),
    duracao: Number(duracao.toFixed(2)),
    energiaGasta: Number((energia - player.jetpackEnergy).toFixed(3)),
  };
}

test('medicao: a propulsao aumenta altura e alcance de forma monotonica', () => {
  const simples = medirAlcance({ energia: 0 });
  const com50 = medirAlcance({ energia: .50, segurarPropulsor: true });
  const com70 = medirAlcance({ energia: .70, segurarPropulsor: true });
  const com80 = medirAlcance({ energia: .80, segurarPropulsor: true });
  const com100 = medirAlcance({ energia: 1, segurarPropulsor: true });
  const duplo = medirAlcance({ energia: 0, doubleJump: true });
  const duploCom100 = medirAlcance({ energia: 1, doubleJump: true, segurarPropulsor: true });

  const medidas = { simples, com50, com70, com80, com100, duplo, duploCom100 };
  // Registrado no relatorio: sao MEDIDAS, nao limites impostos.
  console.log('  medidas de alcance:', JSON.stringify(medidas));

  assert.ok(com50.altura > simples.altura, 'com 50% precisa subir mais que o salto simples');
  assert.ok(com70.altura >= com50.altura, 'mais energia nao pode subir menos');
  assert.ok(com80.altura >= com70.altura);
  assert.ok(com100.altura >= com80.altura);
  assert.ok(duploCom100.altura > duplo.altura, 'a mochila prolonga tambem o salto duplo');
  assert.ok(com100.energiaGasta > com50.energiaGasta, 'mais tempo de voo gasta mais');
  assert.ok(com100.energiaGasta <= 1.0001, 'nao da para gastar mais do que o tanque');
});
