import assert from 'node:assert/strict';
import test from 'node:test';

import { createMeloidogyneLifecycle } from '../src/procgen/meloidogyne-lifecycle.js';

// A femea instalada nao e alvo: nao se mata, nao se expulsa. O que ela faz e
// ovipor, envelhecer e morrer. Antes ela drenava a raiz para sempre, o que
// ensinava a infeccao como sangria eterna em vez de sequela.
function cena() {
  const root = {
    x: 200, y: 400, w: 320, h: 60, type: 'root', logicIndex: 3,
    rootHealth: 1, rootMaxHealth: 1,
  };
  const state = {
    gameState: 'play', time: 0, cameraX: 0,
    campaign: { phase: 8 },
    player: { x: 0, y: 0, w: 32, h: 48, soil: 0, hope: 0, nematodeLoad: 0 },
    level: {
      platforms: [root], particles: [],
      nematodeEggMasses: [], nematodeJuveniles: [], rootGalls: [],
    },
  };
  const system = createMeloidogyneLifecycle({ state, entities: { burst() {} } });
  system.reset();
  return { state, system, root };
}

// Instala uma femea adulta madura direto, sem esperar o ciclo inteiro.
function femeaAdulta(system, root) {
  const gall = {
    id: 'gall-teste', platform: root, x: root.x + 120, y: root.y + 18,
    generation: 0, progress: 1, age: 0, stage: 'adult-female', femaleMaturity: 1,
    eggTimer: 0, eggMassesLaid: 0, phase: 0,
    permanentPenalty: 0, adultDrain: 0, adultAnnounced: true,
    senescence: 0, dead: false,
  };
  system.galls.push(gall);
  return gall;
}

function avanca(system, segundos, passo = .5) {
  for (let t = 0; t < segundos; t += passo) system.update(passo);
}

// Antes a infestacao nascia toda nos primeiros blocos e gastava ali as geracoes,
// deixando o final da fase vazio. Os focos precisam acompanhar o tamanho dela.
function faseCom(totalChunks, meloidogyne = {}) {
  const platforms = Array.from({ length: totalChunks }, (_, i) => ({
    x: 200 + i * 300, y: 420, w: 200, h: 60, type: 'root', logicIndex: i,
    rootHealth: 1, rootMaxHealth: 1,
  }));
  const state = {
    gameState: 'play', time: 0, cameraX: 0,
    campaign: { phase: 8 },
    player: { x: 0, y: 0, w: 32, h: 48, soil: 0, hope: 0, nematodeLoad: 0 },
    level: {
      platforms, particles: [],
      nematodeEggMasses: [], nematodeJuveniles: [], rootGalls: [],
      pathogenSchedule: { meloidogyne: 2 },
      phaseProfile: Object.keys(meloidogyne).length ? { meloidogyne } : undefined,
    },
  };
  const system = createMeloidogyneLifecycle({ state, entities: { burst() {} } });
  system.reset();
  return system.eggMasses.map(m => m.platform.logicIndex).sort((a, b) => a - b);
}

test('os focos se espalham pela fase em vez de se concentrarem no comeco', () => {
  const curta = faseCom(16);
  const longa = faseCom(40);

  assert.ok(longa.length > curta.length, 'fase maior recebe mais focos');
  assert.ok(
    Math.max(...longa) >= 35,
    `o ultimo foco (${Math.max(...longa)}) precisa alcancar o fim da fase de 40 chunks`,
  );
  assert.equal(Math.min(...longa), 2, 'o primeiro foco continua no inicio da agenda do patogeno');

  // Os focos nao podem ficar amontoados num trecho so.
  const intervalos = longa.slice(1).map((chunk, i) => chunk - longa[i]);
  assert.ok(Math.min(...intervalos) >= 5, 'os focos ficam separados entre si');
});

test('o Phase Lab consegue ajustar a densidade dos focos', () => {
  const padrao = faseCom(40);
  const denso = faseCom(40, {
    focusSpacingChunks: 5, maxFoci: 8, maxGenerations: 4,
    maxSimultaneousEggMasses: 14, senescenceSeconds: 26, completedCycleScar: .06,
  });
  assert.ok(denso.length > padrao.length, 'reduzir o espacamento aumenta o numero de focos');
});

test('a femea ovipoe uma unica vez e entra em senescencia', () => {
  const { system, root } = cena();
  const femea = femeaAdulta(system, root);

  avanca(system, 2);
  assert.equal(femea.eggMassesLaid, 1, 'a femea produz a massa de ovos');

  avanca(system, 6);
  assert.ok(femea.senescence > 0, 'depois de ovipor ela envelhece');
  assert.equal(femea.eggMassesLaid, 1, 'e nao produz uma segunda massa');
});

test('a drenagem diminui durante a senescencia e chega a zero na morte', () => {
  const { system, root } = cena();
  const femea = femeaAdulta(system, root);

  avanca(system, 2);
  const drenagemViva = femea.adultDrain;
  assert.ok(drenagemViva > 0, 'a femea viva drena a raiz');

  avanca(system, 12);
  assert.ok(femea.adultDrain < drenagemViva, 'a drenagem cai conforme ela envelhece');
  assert.ok(femea.adultDrain > 0, 'mas ainda nao cessou');

  avanca(system, 40);
  assert.equal(femea.dead, true, 'a femea morre de velhice');
  assert.equal(femea.adultDrain, 0, 'e a drenagem cessa');
  assert.equal(femea.stage, 'residual-gall');
});

test('a galha e a perda de saude maxima permanecem depois da morte', () => {
  const { system, root } = cena();
  const femea = femeaAdulta(system, root);

  avanca(system, 60);
  assert.equal(femea.dead, true);
  assert.ok(system.galls.includes(femea), 'a galha nao desaparece com a femea');
  assert.ok(femea.permanentPenalty > 0, 'a sequela permanece');
  assert.ok(
    (root.rootMaxHealth ?? 1) < 1,
    'a saude maxima perdida nao volta',
  );
});

test('a femea morta nao produz nova massa de ovos', () => {
  const { system, root } = cena();
  const femea = femeaAdulta(system, root);

  avanca(system, 60);
  assert.equal(femea.dead, true);

  // A contagem global de massas pode crescer — e a geracao seguinte se
  // estabelecendo, que e o comportamento desejado. O que nao pode e esta femea
  // ovipor de novo.
  femea.eggTimer = 0;
  femea.femaleMaturity = 1;
  avanca(system, 30);

  assert.equal(femea.eggMassesLaid, 1, 'a femea morta nao ovipoe outra vez');
  const dela = system.eggMasses.filter(massa => massa.sourceGallId === femea.id);
  assert.ok(dela.length <= 1, 'ela deixou no maximo a massa unica que produziu em vida');
});

test('a linhagem pode encadear geracoes: o desafio e a populacao, nao a femea', () => {
  const { system, root } = cena();
  const femea = femeaAdulta(system, root);
  avanca(system, 2);

  // O teto antigo era duas geracoes, o que impedia a populacao de escalar e
  // tirava justamente a dificuldade que a fase quer ensinar.
  const massa = system.eggMasses.find(m => m.generation > femea.generation);
  assert.ok(massa, 'a oviposicao inicia a geracao seguinte');
  assert.ok(massa.generation >= 1);
});
