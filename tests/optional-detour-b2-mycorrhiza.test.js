import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HARD_MYCORRHIZA_GAP_MODULE } from '../src/procgen/optional-detour-modules.js';
import { createMycorrhizaStructures } from '../src/procgen/mycorrhiza-structures.js';
import { createRandom } from '../src/procgen/random.js';

const dummyPrimaryRoute = [{ x: 0, w: 5000, logicIndex: 1 }];

test('PARTE T - Teste 1: Exsudato sem colônia de micorriza não cria ponte', () => {
  const context = {
    slotLeft: 1000,
    slotRight: 2300,
    allocatedSpan: 1300,
    slotIndex: 0,
    detourId: 'test-detour',
    primaryRoute: dummyPrimaryRoute,
    random: createRandom('seed-test-1'),
  };
  const geom = HARD_MYCORRHIZA_GAP_MODULE.buildGeometry(context);
  assert.equal(geom.structures.length, 0, 'Geração não deve criar pontes prontas');

  const source = geom.platforms.find(p => p.mycorrhizaBridgeSource);
  const target = geom.platforms.find(p => p.mycorrhizaBridgeTarget);
  assert.ok(source && target);

  const cloud = {
    id: 'cloud-1',
    x: source.x + source.w - 10,
    y: source.y - 15,
    radius: 80,
    life: 9.0,
    maxLife: 10.0,
  };

  const state = {
    gameState: 'play',
    level: {
      platforms: [...geom.platforms],
      exudateClouds: [cloud],
      campaignPhase: 10,
    },
    campaign: { phase: 10 },
  };

  const entities = {
    audio: { play() {}, startLoop() {}, stopGroup() {} },
    burst() {},
  };

  const inoculants = { colonies: [] }; // Sem colônia
  const sys = createMycorrhizaStructures({ state, entities, inoculants });

  sys.update(0.1);
  assert.equal(sys.structures.length, 0, 'Sem colônia não deve criar ponte');
});

test('PARTE T - Teste 2: Colônia imatura (< 0.68) não cria ponte', () => {
  const context = {
    slotLeft: 1000,
    slotRight: 2300,
    allocatedSpan: 1300,
    slotIndex: 0,
    detourId: 'test-detour-2',
    primaryRoute: dummyPrimaryRoute,
    random: createRandom('seed-test-2'),
  };
  const geom = HARD_MYCORRHIZA_GAP_MODULE.buildGeometry(context);
  const source = geom.platforms.find(p => p.mycorrhizaBridgeSource);

  const cloud = {
    id: 'cloud-2',
    x: source.x + source.w - 10,
    y: source.y - 15,
    radius: 80,
    life: 9.0,
    maxLife: 10.0,
  };

  const state = {
    gameState: 'play',
    level: {
      platforms: [...geom.platforms],
      exudateClouds: [cloud],
      campaignPhase: 10,
    },
    campaign: { phase: 10 },
  };

  const entities = {
    audio: { play() {}, startLoop() {}, stopGroup() {} },
    burst() {},
  };

  const inoculants = {
    colonies: [{
      type: 'myco',
      platform: source,
      growth: 0.5, // imatura
      vigor: 1.0,
      dormant: false,
    }],
  };

  const sys = createMycorrhizaStructures({ state, entities, inoculants });

  sys.update(0.1);
  assert.equal(sys.structures.length, 0, 'Colônia imatura não deve criar ponte');
});

test('PARTE T - Teste 3: Colônia madura (>= 0.68) + exsudato cria ponte conectando origem ao destino autoral', () => {
  const context = {
    slotLeft: 1000,
    slotRight: 2300,
    allocatedSpan: 1300,
    slotIndex: 0,
    detourId: 'test-detour-3',
    primaryRoute: dummyPrimaryRoute,
    random: createRandom('seed-test-3'),
  };
  const geom = HARD_MYCORRHIZA_GAP_MODULE.buildGeometry(context);
  const source = geom.platforms.find(p => p.mycorrhizaBridgeSource);
  const target = geom.platforms.find(p => p.mycorrhizaBridgeTarget);

  const cloud = {
    id: 'cloud-3',
    x: source.x + source.w - 10,
    y: source.y - 15,
    radius: 80,
    life: 9.0,
    maxLife: 10.0,
  };

  const state = {
    gameState: 'play',
    level: {
      platforms: [...geom.platforms],
      exudateClouds: [cloud],
      campaignPhase: 10,
    },
    campaign: { phase: 10 },
  };

  const entities = {
    audio: { play() {}, startLoop() {}, stopGroup() {} },
    burst() {},
  };

  const inoculants = {
    colonies: [{
      type: 'myco',
      platform: source,
      growth: 1.0, // madura
      vigor: 1.0,
      dormant: false,
    }],
  };

  const sys = createMycorrhizaStructures({ state, entities, inoculants });

  sys.update(0.1);
  assert.equal(sys.structures.length, 1, 'Colônia madura + exsudato deve criar exatamente 1 ponte');
  assert.equal(sys.structures[0].source, source);
  assert.equal(sys.structures[0].target, target, 'A ponte deve conectar ao destino autoral preferencial');
});

test('PARTE T - Teste 4: Alvo concorrente mais próximo é ignorado em favor do destino autoral strict', () => {
  const context = {
    slotLeft: 1000,
    slotRight: 2300,
    allocatedSpan: 1300,
    slotIndex: 0,
    detourId: 'test-detour-4',
    primaryRoute: dummyPrimaryRoute,
    random: createRandom('seed-test-4'),
  };
  const geom = HARD_MYCORRHIZA_GAP_MODULE.buildGeometry(context);
  const source = geom.platforms.find(p => p.mycorrhizaBridgeSource);
  const target = geom.platforms.find(p => p.mycorrhizaBridgeTarget);

  const competingPlatform = {
    id: 'competing-target',
    platformId: 'competing-target',
    x: source.x + source.w + 100,
    y: source.y,
    w: 150,
    h: 54,
    type: 'root',
  };

  const cloud = {
    id: 'cloud-4',
    x: source.x + source.w - 10,
    y: source.y - 15,
    radius: 80,
    life: 9.0,
    maxLife: 10.0,
  };

  const state = {
    gameState: 'play',
    level: {
      platforms: [source, competingPlatform, target],
      exudateClouds: [cloud],
      campaignPhase: 10,
    },
    campaign: { phase: 10 },
  };

  const entities = {
    audio: { play() {}, startLoop() {}, stopGroup() {} },
    burst() {},
  };

  const inoculants = {
    colonies: [{
      type: 'myco',
      platform: source,
      growth: 1.0,
      vigor: 1.0,
      dormant: false,
    }],
  };

  const sys = createMycorrhizaStructures({ state, entities, inoculants });

  sys.update(0.1);
  assert.equal(sys.structures.length, 1);
  assert.equal(sys.structures[0].target, target, 'A ponte deve ignorar o concorrente e ancorar no destino autoral preferencial');
});

test('PARTE T - Teste 5: Intentional gap permanece vazio e travessia regular é bloqueada', () => {
  const context = {
    slotLeft: 1000,
    slotRight: 2300,
    allocatedSpan: 1300,
    slotIndex: 0,
    detourId: 'test-detour-5',
    primaryRoute: dummyPrimaryRoute,
    random: createRandom('seed-test-5'),
  };
  const geom = HARD_MYCORRHIZA_GAP_MODULE.buildGeometry(context);
  assert.equal(geom.regularTraversalBlocked, true, 'regularTraversalBlocked deve ser true');

  const source = geom.platforms.find(p => p.mycorrhizaBridgeSource);
  const target = geom.platforms.find(p => p.mycorrhizaBridgeTarget);
  const gap = geom.intentionalGaps[0];

  assert.ok(gap && gap.kind === 'mycorrhiza-bridge-gap');
  for (const p of geom.platforms) {
    if (p === source || p === target) continue;
    const inside = p.x < gap.bounds.right && p.x + p.w > gap.bounds.left &&
                   p.y < gap.bounds.bottom && p.y + p.h > gap.bounds.top;
    assert.equal(inside, false, 'Nenhuma plataforma pode invadir o vão da micorriza');
  }
});

test('PARTE T - Teste 6: Determinismo - mesma seed gera variante, gap e slots idênticos', () => {
  const contextA = {
    slotLeft: 1000,
    slotRight: 2300,
    allocatedSpan: 1300,
    slotIndex: 0,
    detourId: 'test-detour-6',
    primaryRoute: dummyPrimaryRoute,
    random: createRandom('seed-fixed-12345'),
  };
  const geomA = HARD_MYCORRHIZA_GAP_MODULE.buildGeometry(contextA);

  const contextB = {
    slotLeft: 1000,
    slotRight: 2300,
    allocatedSpan: 1300,
    slotIndex: 0,
    detourId: 'test-detour-6',
    primaryRoute: dummyPrimaryRoute,
    random: createRandom('seed-fixed-12345'),
  };
  const geomB = HARD_MYCORRHIZA_GAP_MODULE.buildGeometry(contextB);

  assert.equal(geomA.mycorrhizaVariant, geomB.mycorrhizaVariant);
  assert.equal(geomA.mycorrhizaGapWidth, geomB.mycorrhizaGapWidth);
  assert.equal(geomA.mycorrhizaVerticalDelta, geomB.mycorrhizaVerticalDelta);
});
