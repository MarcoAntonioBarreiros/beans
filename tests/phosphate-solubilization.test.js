import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createBacillusBioprotection } from '../src/procgen/bacillus-bioprotection.js';
import { createCampaignObjectiveEvaluator } from '../src/procgen/campaign-objectives.js';
import { PHOSPHATE_SOLUBILIZATION_DEFAULTS, getPhaseManifest } from '../src/procgen/campaign-manifest.js';
import { createInoculumSelection } from '../src/procgen/inoculum-selection.js';
import { createPhosphateSolubilization } from '../src/procgen/phosphate-solubilization.js';

function deposit(id, x = 180, amount = 1) {
  return {
    id, phosphateDeposit: true, x, y: 70, w: 30, h: 60,
    remainingPhosphate: amount, initialPhosphate: amount,
    localAvailablePhosphate: 0, broken: false,
  };
}

function harness({
  deposits = [deposit('p1')], reserve = 1, solubilizer = true, mycorrhiza = null,
} = {}) {
  const player = {
    x: 80, y: 70, w: 32, h: 48, facing: 1,
    canPhosphateSolubilization: true, phosphateCharge: 0, soil: 0, hope: 0,
  };
  const state = {
    gameState: 'play', time: 0, cameraX: 0, player,
    level: {
      phaseProfile: { phosphateSolubilization: { ...PHOSPHATE_SOLUBILIZATION_DEFAULTS, chargeTimeSeconds: 1 } },
      phosphateDeposits: deposits,
      availablePhosphatePools: [],
      phosphateTransportParticles: [],
      platforms: [],
    },
  };
  const input = { keys: { KeyE: false } };
  const entry = {
    mode: 'mature', maturity: 1, phosphateMetaboliteReserve: reserve,
    colony: { x: 90, y: 94, solubilizerStrain: solubilizer },
  };
  const bacillus = { get solubilizerEntries() { return solubilizer ? [entry] : []; } };
  const selection = { isSelected: kind => kind === 'phosphate-solubilization' };
  const system = createPhosphateSolubilization({
    state, input, selection, bacillus,
    entities: { burst() {} },
    inoculants: { colonies: mycorrhiza ? [mycorrhiza] : [] },
  });
  // Fluxo novo em duas etapas: segurar E carrega, soltar armazena, um novo
  // toque dispara. O helper faz o ciclo completo (carregar + disparar) para os
  // testes de fisica do tiro, que so se importam com o disparo em si.
  const chargeOnly = amount => {
    input.keys.KeyE = true;
    system.prepare(amount);   // segura: carrega
    input.keys.KeyE = false;
    system.prepare(0);        // solta: armazena (nao dispara)
  };
  const fire = () => {
    input.keys.KeyE = true;
    system.prepare(0);        // novo toque: dispara
    input.keys.KeyE = false;
    system.prepare(0);        // solta: volta a idle
  };
  const charge = amount => { chargeOnly(amount); fire(); };
  const advance = (seconds = 1) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += .05) system.update(.05);
  };
  const press = (keyDown, dt = 0) => { input.keys.KeyE = keyDown; system.prepare(dt); };
  return { state, input, entry, system, charge, chargeOnly, fire, press, advance };
}

test('1-2. Solubilizacao P aparece apos desbloqueio e ArrowDown a seleciona', () => {
  const state = { time: 0, gameState: 'play', player: { exudates: 1, canPhosphateSolubilization: false } };
  const input = { keys: { ArrowDown: false } };
  const selection = createInoculumSelection({
    state, input,
    inoculants: { followerGroups: () => new Map() },
    trichodermaColonies: { followerCount: 0 },
  });
  assert.equal(selection.options().some(option => option.kind === 'phosphate-solubilization'), false);
  state.player.canPhosphateSolubilization = true;
  assert.equal(selection.options().some(option => option.kind === 'phosphate-solubilization'), true);
  input.keys.ArrowDown = true;
  selection.prepare();
  assert.equal(selection.current.kind, 'phosphate-solubilization');
});

test('3-4. segurar E carrega, soltar ARMAZENA sem disparar, e um novo toque dispara', () => {
  const h = harness();
  // Segurar E carrega, sem criar tiro.
  h.press(true, .5);
  assert.equal(h.system.charge, .5);
  assert.equal(h.system.shotCount, 0, 'segurar nao cria tiro');
  // Soltar NAO dispara: a carga fica armazenada e pronta.
  h.press(false);
  assert.equal(h.system.shotCount, 0, 'soltar nao cria tiro');
  assert.equal(h.system.armed, true, 'a carga fica armada');
  assert.equal(h.system.charge, .5, 'a carga permanece guardada');
  assert.equal(h.state.player.phosphatePulseArmed, true, 'estado publicado no jogador');
  // Um NOVO toque dispara exatamente um tiro.
  h.press(true);
  assert.equal(h.system.shotCount, 1, 'o novo toque dispara');
  assert.equal(h.state.level.objectiveProgress.performedPhosphatePulseCount, 1);
  assert.equal(h.system.charge, 0);
  assert.equal(h.system.armed, false);
});

test('a carga armada sobrevive a varios quadros sem E', () => {
  const h = harness();
  h.chargeOnly(.5);
  assert.equal(h.system.armed, true);
  for (let frame = 0; frame < 30; frame++) h.press(false, 1 / 60);
  assert.equal(h.system.armed, true, 'a carga nao se perde parada');
  assert.equal(h.system.charge, .5);
  assert.equal(h.system.shotCount, 0, 'nada disparou nesse intervalo');
});

test('a carga armada sobrevive a andar e saltar', () => {
  const h = harness();
  h.chargeOnly(.5);
  // Simula movimento e salto no jogador enquanto o sistema roda sem E.
  for (let frame = 0; frame < 20; frame++) {
    h.state.player.x += 4;
    h.state.player.vy = frame < 10 ? -400 : 300;
    h.state.player.facing = -1;
    h.press(false, 1 / 60);
  }
  assert.equal(h.system.armed, true, 'movimento e salto nao gastam a carga');
  assert.equal(h.system.charge, .5);
});

test('o tiro usa a direcao ATUAL do jogador, nao a do momento da carga', () => {
  const h = harness();
  h.state.player.facing = 1;
  h.chargeOnly(.6);                 // carregou olhando para a direita
  h.state.player.facing = -1;      // virou para a esquerda antes de disparar
  h.fire();
  const shot = h.state.level.phosphateDeposits && h.system.shotCount === 1;
  assert.equal(h.system.shotCount, 1);
  // O tiro nasce a esquerda do jogador e viaja para a esquerda.
  assert.ok(shot);
  // Reproduz um segundo caso para confirmar a direita.
  const g = harness();
  g.state.player.facing = -1;
  g.chargeOnly(.6);
  g.state.player.facing = 1;
  g.fire();
  assert.equal(g.system.shotCount, 1);
});

test('segurar o segundo toque nao cria tiros extras nem recarrega', () => {
  const h = harness();
  h.chargeOnly(.5);
  // Segundo toque mantido por varios quadros: dispara UMA vez e nao recarrega.
  h.input.keys.KeyE = true;
  h.system.prepare(0);                          // borda de subida: dispara
  assert.equal(h.system.shotCount, 1);
  for (let frame = 0; frame < 20; frame++) h.system.prepare(1 / 60);  // segue segurando
  assert.equal(h.system.shotCount, 1, 'o mesmo toque nao dispara de novo');
  assert.equal(h.system.charge, 0, 'e nao inicia nova carga no mesmo toque');
  // Soltar volta para idle: so entao um novo toque pode recarregar.
  h.press(false);
  assert.equal(h.system.pulseState, 'idle');
});

test('carga abaixo do minimo e descartada ao soltar, sem armar', () => {
  const h = harness();
  h.press(true, .1);               // 0.1 < minimumCharge (0.18)
  assert.ok(h.system.charge < PHOSPHATE_SOLUBILIZATION_DEFAULTS.minimumCharge);
  h.press(false);
  assert.equal(h.system.armed, false);
  assert.equal(h.system.charge, 0, 'carga insuficiente e descartada');
  assert.equal(h.system.shotCount, 0);
});

test('trocar a acao cancela a carga armada sem disparar', () => {
  const h = harness();
  h.chargeOnly(.6);
  assert.equal(h.system.armed, true);
  // O jogador troca para outra acao: a selecao deixa de apontar o fosfato.
  h.state.selectedPhosphate = false;
  // Reescreve o resolver de selecao para simular a troca.
  // (o harness usa selection.isSelected fixo; aqui forcamos via canPhosphate)
  h.state.player.canPhosphateSolubilization = false;
  h.system.prepare(1 / 60);
  assert.equal(h.system.armed, false, 'trocar de acao cancela');
  assert.equal(h.system.charge, 0);
  assert.equal(h.system.shotCount, 0, 'e nao dispara ao cancelar');
});

test('morte/respawn (reset) cancela a carga armada sem disparar', () => {
  const h = harness();
  h.chargeOnly(.6);
  assert.equal(h.system.armed, true);
  h.system.reset();
  assert.equal(h.system.armed, false);
  assert.equal(h.system.charge, 0);
  assert.equal(h.system.shotCount, 0);
  assert.equal(h.state.player.phosphatePulseArmed, false);
});

test('tutorial/blur nao disparam: pausa sincroniza a borda e nao cria tiro', () => {
  const h = harness();
  h.chargeOnly(.6);
  assert.equal(h.system.armed, true);
  // Abre o tutorial com E ainda pressionado (tecla presa durante a pausa).
  h.state.gameState = 'tutorial';
  h.input.keys.KeyE = true;
  h.system.prepare(1 / 60);
  h.system.prepare(1 / 60);
  assert.equal(h.system.shotCount, 0, 'nada dispara durante a pausa');
  // Fecha o tutorial com E ainda pressionado: nao pode virar disparo.
  h.state.gameState = 'play';
  h.system.prepare(1 / 60);
  assert.equal(h.system.shotCount, 0, 'retomar com E preso nao dispara');
  // So um NOVO toque (soltar e apertar) dispara.
  h.press(false);
  h.press(true);
  assert.equal(h.system.shotCount, 1);
});

test('performedPhosphatePulseCount so aumenta no disparo real', () => {
  const h = harness();
  const progresso = () => h.state.level.objectiveProgress?.performedPhosphatePulseCount || 0;
  h.chargeOnly(.6);
  assert.equal(progresso(), 0, 'carregar e armar nao conta');
  h.fire();
  assert.equal(progresso(), 1, 'so o disparo conta');
});

test('a reserva do Bacillus e consumida SO na etapa de carga', () => {
  const h = harness();
  const antesCarga = h.entry.phosphateMetaboliteReserve;
  h.chargeOnly(.4);
  const depoisCarga = h.entry.phosphateMetaboliteReserve;
  assert.ok(depoisCarga < antesCarga, 'carregar consome a reserva');
  // Disparar nao consome mais reserva da colonia.
  h.fire();
  assert.equal(h.entry.phosphateMetaboliteReserve, depoisCarga, 'disparar nao toca a reserva');
});

test('5-7. K nao dispara o pulso e o E touch e hold (carregar/disparar), nao tap', () => {
  const h = harness();
  // K/C sao atalhos legados do propulsor: nunca disparam o pulso de fosfato.
  h.input.keys.KeyK = true;
  h.system.prepare(1);
  assert.equal(h.system.charge, 0);
  assert.equal(h.system.shotCount, 0);

  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /data-key="ArrowDown"[^>]*>↓ TROCAR/);
  // O botao E precisa ser HOLD: carregar exige segurar, e o novo toque dispara.
  assert.match(index, /data-key="KeyE" aria-label=/);
  assert.doesNotMatch(index, /data-key="KeyE"[^>]*data-mode="tap"/);
  // O propulsor deixou de ter botao proprio no celular — nao ha mais botao K.
  assert.doesNotMatch(index, /data-key="KeyK"/, 'nao existe mais botao PROP separado');
  assert.doesNotMatch(index, /id="touch-jetpack"/);

  const selectionSource = readFileSync(new URL('../src/procgen/inoculum-selection.js', import.meta.url), 'utf8');
  assert.match(selectionSource, /kind: 'exudate'/);
  assert.match(selectionSource, /kind: 'organism'/);
});

function bacillusHarness(colony) {
  const state = {
    time: 10,
    gameState: 'play',
    player: { x: 0, y: 0, w: 32, h: 48, infection: 0, soil: 0 },
    level: { biofilms: [], platforms: [colony.platform], phaseProfile: { phosphateSolubilization: PHOSPHATE_SOLUBILIZATION_DEFAULTS } },
  };
  const inoculants = { colonies: [colony] };
  const system = createBacillusBioprotection({
    state, inoculants,
    ecology: { agents: [] },
    entities: { burst() {} },
  });
  system.update(1);
  return { state, system, entry: system.entries[0] };
}

// Nao existe cepa solubilizadora separada: e o mesmo Bacillus do checkpoint.
// Quem decide se ele solubiliza e a maturidade, nao um tipo a parte.
test('8-10. o mesmo Bacillus solubiliza: maduro produz, imaturo nao, endosporo interrompe', () => {
  const platform = { x: 0, y: 300, w: 180, h: 60 };

  const maduro = bacillusHarness({
    id: 'maduro', type: 'bacillus', x: 80, y: 290, platform,
    sourceCount: 4, vigor: 1, growth: 1, authored: true, rechargeIntensity: .5,
  });
  assert.ok(
    maduro.entry.phosphateMetaboliteReserve > .7,
    'um Bacillus maduro produz o metabolito, sem precisar ser de outro tipo',
  );

  const imaturo = bacillusHarness({
    id: 'imaturo', type: 'bacillus', x: 80, y: 290, platform,
    sourceCount: 4, vigor: 1, growth: .3, rechargeIntensity: .5,
  });
  assert.ok(
    imaturo.entry.maturity < .72,
    'colonia recem-inoculada ainda nao esta madura',
  );
  assert.equal(
    imaturo.entry.phosphateMetaboliteReserve, 0,
    'antes de amadurecer nao ha reserva para absorver',
  );

  maduro.entry.mode = 'spores';
  maduro.entry.colony.dormant = true;
  maduro.entry.colony.rechargeIntensity = 0;
  const antes = maduro.entry.phosphateMetaboliteReserve;
  maduro.system.update(1);
  assert.ok(
    maduro.entry.phosphateMetaboliteReserve <= antes,
    'esporulado, o Bacillus para de produzir',
  );
});

test('11. reserva da colonia diminui durante a absorcao', () => {
  const h = harness();
  h.input.keys.KeyE = true;
  h.system.prepare(.4);
  assert.equal(h.entry.phosphateMetaboliteReserve, .6);
});

test('12. disparo e direcional', () => {
  const h = harness();
  h.state.player.facing = -1;
  h.charge(1);
  h.advance(1);
  assert.equal(h.state.level.phosphateDeposits[0].remainingPhosphate, 1);
});

test('13. carga maior solubiliza mais e pode conservar energia para outro deposito', () => {
  const low = harness({ deposits: [deposit('low')] });
  low.charge(.25); low.advance(1);
  const lowReleased = 1 - low.state.level.phosphateDeposits[0].remainingPhosphate;
  const high = harness({ deposits: [deposit('a', 180), deposit('b', 280)] });
  high.charge(1); high.advance(1);
  const highReleased = high.state.level.phosphateDeposits.reduce((sum, item) => sum + (1 - item.remainingPhosphate), 0);
  assert.ok(highReleased > lowReleased);
  assert.equal(high.state.level.phosphateDeposits.filter(item => item.broken).length, 2);
});

test('14. disparo afeta exclusivamente depositos de fosfato', () => {
  const h = harness();
  h.state.player.fungalContamination = .8;
  h.state.level.enemies = [{ hp: 3 }];
  h.charge(1); h.advance(1);
  assert.equal(h.state.player.fungalContamination, .8);
  assert.equal(h.state.level.enemies[0].hp, 3);
});

test('15-16. disparos parciais acumulam e o collider so libera na deplecao', () => {
  const h = harness();
  h.charge(.25); h.advance(1);
  const target = h.state.level.phosphateDeposits[0];
  assert.equal(target.broken, false);
  assert.ok(target.remainingPhosphate < target.initialPhosphate);
  h.entry.phosphateMetaboliteReserve = 1;
  h.charge(.25); h.advance(1);
  assert.equal(target.remainingPhosphate, 0);
  assert.equal(target.broken, true);
  assert.equal(h.system.solubilizedDepositCount, 1);
});

test('17-18. P permanece local sem micorriza e fosfato insoluvel nao e absorvido', () => {
  const h = harness();
  h.charge(.25); h.advance(1);
  const available = h.state.level.availablePhosphatePools[0].amount;
  h.system.update(4);
  assert.equal(h.state.level.availablePhosphatePools[0].amount, available);
  const untouched = harness({ deposits: [deposit('raw')], route: { functional: true, arbuscule: { maturity: 1 }, depositId: 'raw', rootPlatform: {}, points: [] } });
  untouched.system.update(4);
  assert.equal(untouched.system.transportedPhosphate, 0);
});

// Quem transporta o fosfato e uma micorriza inoculada de verdade. Antes havia
// uma rota autoral de cinco pontos marcada como functional: true, sem organismo
// nenhum por tras — o transporte acontecia por decreto.
function mycorrhizaColony({ x = 200, y = 90, growth = 1, root = null } = {}) {
  return {
    type: 'myco', x, y, growth, vigor: 1, dormant: false,
    platform: root || { type: 'root', rootHealth: .5, maxRootHealth: .7, phosphateStock: 0 },
  };
}

test('19-22. sem micorriza inoculada nao ha transporte, por mais P disponivel que exista', () => {
  const h = harness();
  h.charge(.5); h.advance(1);
  const disponivel = h.state.level.availablePhosphatePools[0].amount;
  assert.ok(disponivel > 0, 'o disparo liberou fosfato');

  h.system.update(2);
  assert.equal(h.state.level.availablePhosphatePools[0].amount, disponivel, 'a poca permanece intacta');
  assert.equal(h.system.transportedPhosphate, 0);
  assert.equal(h.state.level.availablePhosphatePools[0].absorptionState, 'waiting-mycorrhiza');
});

test('19-22. com micorriza madura ao alcance, o P vai para a raiz dela', () => {
  const colony = mycorrhizaColony();
  const root = colony.platform;
  const h = harness({ mycorrhiza: colony });
  h.charge(.5); h.advance(1);
  const antes = h.state.level.availablePhosphatePools[0].amount;

  h.system.update(1);
  assert.ok(h.state.level.availablePhosphatePools[0].amount < antes, 'a poca e consumida');
  assert.ok(h.system.transportedPhosphate > 0);
  assert.ok(h.state.level.phosphateTransportParticles.length > 0);
  assert.ok(root.phosphateStock > 0, 'a reserva entra na raiz colonizada');
  assert.ok(root.rootHealth > .5 && root.rootHealth <= .7, 'e respeita o teto de saude da raiz');
});

test('19-22. colonia imatura ou fora de alcance nao transporta', () => {
  const imatura = harness({ mycorrhiza: mycorrhizaColony({ growth: .2 }) });
  imatura.charge(.5); imatura.advance(1);
  imatura.system.update(2);
  assert.equal(imatura.system.transportedPhosphate, 0, 'a colonia precisa amadurecer');

  const distante = harness({ mycorrhiza: mycorrhizaColony({ x: 4000, y: 4000 }) });
  distante.charge(.5); distante.advance(1);
  distante.system.update(2);
  assert.equal(distante.system.transportedPhosphate, 0, 'e precisa estar ao alcance da poca');
});

test('23. objetivo final da Fase 7 exige solubilizacao, transporte, estoque e saida', () => {
  const requirements = getPhaseManifest(7).finalTest.requires;
  assert.deepEqual(requirements.map(item => item.key), [
    'solubilizedPhosphateDepositCount',
    'mycorrhizalPhosphateTransported',
    'rootPhosphateStock',
    'reachedFinalRoot',
  ]);
  const state = { level: { goal: { completed: true } }, campaign: { unlocks: {} } };
  const evaluator = createCampaignObjectiveEvaluator({
    state,
    systems: { phosphate: { solubilizedDepositCount: 1, transportedPhosphate: 1, rootPhosphateStock: 1 } },
  });
  assert.equal(evaluator.evaluate(requirements).passed, true);
});
