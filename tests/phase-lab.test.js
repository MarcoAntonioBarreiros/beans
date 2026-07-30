import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  clearPhaseManifestOverride,
  getPathogensAt,
  getPhaseManifest,
  getProceduralPoolAt,
  setPhaseManifestOverride,
} from '../src/procgen/campaign-manifest.js';
import {
  applyPhaseLabResources,
  buildPhaseLabManifest,
  createDefaultPhaseLabConfig,
  isPhaseLabEnabled,
  scalePhaseLabSegments,
  validatePhaseLabConfig,
} from '../src/procgen/phase-lab-config.js';
import { createPhaseLabSession } from '../src/procgen/phase-lab.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

afterEach(() => clearPhaseManifestOverride());

test('Phase Lab so e ativado explicitamente pela query string', () => {
  assert.equal(isPhaseLabEnabled({ search: '?phaseLab=1' }), true);
  assert.equal(isPhaseLabEnabled({ search: '?test=1&phaseLab=1' }), true);
  assert.equal(isPhaseLabEnabled({ search: '?phaseLab=0' }), false);
  assert.equal(isPhaseLabEnabled({ search: '' }), false);
});

test('Phase Lab da Fase 3 abre focado no Azo e respeita o pool curricular', () => {
  const phase2 = createDefaultPhaseLabConfig(2);
  const phase3 = createDefaultPhaseLabConfig(3);
  assert.equal(phase2.nitrogenRoot.enabled, true);
  assert.equal(phase3.nitrogenRoot.enabled, false);
  assert.equal(phase3.azospirillumRootLadder.enabled, true);
  assert.ok(phase3.allowedOrganisms.includes('azospirillum'));
  assert.equal(phase3.allowedOrganisms.includes('pseudomonas'), false);
  assert.equal(phase3.allowedOrganisms.includes('trichoderma'), false);
});

test('Phase Lab foca apenas os organismos novos da fase e trata cartões anteriores como conhecidos', () => {
  const config = createDefaultPhaseLabConfig(5);
  assert.deepEqual(config.allowedOrganisms.sort(), ['oportunista', 'pseudomonas']);

  const session = createPhaseLabSession({
    windowObject: {
      location: { search: '?phaseLab=1' },
      localStorage: memoryStorage(),
    },
  });
  session.api.applyConfig(config);
  const campaign = { unlocks: {} };
  session.configureCampaign(campaign);

  assert.equal(campaign.phaseLab, true);
  assert.equal(campaign.tutorialBootstrapSeen.includes('power-double-jump'), true);
  assert.equal(campaign.tutorialBootstrapSeen.includes('power-dash'), true);
  assert.equal(campaign.tutorialBootstrapSeen.includes('organism-opportunistic-fungus'), false);
});

test('configuracao altera perfil, segmentos, organismos, recursos e prova final no manifesto real', () => {
  const config = createDefaultPhaseLabConfig(5);
  config.seed = 'laboratorio-curricular';
  const previousTotal = config.totalChunks;
  config.totalChunks = 28;
  config.segments = scalePhaseLabSegments(config.segments, previousTotal, config.totalChunks);
  config.title = 'Fase experimental';
  config.theme = 'controle experimental';
  config.mission = 'Compare duas comunidades microbianas.';
  config.allowedOrganisms = ['oportunista', 'pseudomonas'];
  config.allowedPathogens = ['rhizoctonia'];
  config.resources = { exudates: 7, crystals: 2, checkpoints: 1 };
  config.nitrogenRoot = {
    enabled: true,
    count: 2,
    requiredFixationRate: .08,
    growthDurationSeconds: 6,
  };
  config.azospirillumRootLadder = {
    enabled: true,
    count: 2,
    stepCount: 5,
    verticalSpacing: 78,
    growthDurationSeconds: 4.5,
  };
  config.azospirillumNitrogen = {
    associativeRate: .012,
    rhizobiumSynergyMultiplier: 1.25,
  };
  config.mycorrhizaBridge = { horizontalOnly: true };
  config.opportunisticFungus.contaminationRate = 1.25;
  config.pseudomonasIronControl.minimumIronReserve = 1.2;
  config.finalGoal = 'Neutralizar um foco e alcancar a raiz.';
  config.finalConditions = [
    { type: 'worldState', key: 'neutralizedOpportunisticFungusCount', operator: '>=', value: 1 },
    { type: 'worldState', key: 'reachedFinalRoot', operator: '===', value: true },
  ];

  const result = validatePhaseLabConfig(config);
  assert.equal(result.valid, true, result.errors.join('\n'));
  const active = setPhaseManifestOverride(result.manifest);
  assert.equal(getPhaseManifest(5), active);
  assert.equal(active.totalChunks, 28);
  assert.equal(active.title, 'Fase experimental');
  assert.equal(active.mission, config.mission);
  assert.deepEqual(getProceduralPoolAt(5, 0), ['oportunista', 'pseudomonas']);
  assert.deepEqual(getPathogensAt(5, 0), ['rhizoctonia']);
  assert.deepEqual(active.phaseLab.resources, config.resources);
  assert.deepEqual(active.nitrogenRoot, config.nitrogenRoot);
  assert.deepEqual(active.azospirillumRootLadder, {
    ...config.azospirillumRootLadder,
    knownSkill: true,
    preserveDestinationHeight: true,
  });
  assert.deepEqual(active.azospirillumNitrogen, config.azospirillumNitrogen);
  assert.deepEqual(active.mycorrhizaBridge, config.mycorrhizaBridge);
  assert.deepEqual(active.opportunisticFungus, config.opportunisticFungus);
  assert.deepEqual(active.pseudomonasIronControl, config.pseudomonasIronControl);
  assert.equal(active.finalTest.goal, config.finalGoal);
});

test('distribuicao de recursos usa a geometria real e e deterministica por seed', () => {
  const config = createDefaultPhaseLabConfig(2);
  config.resources = { exudates: 6, crystals: 3, checkpoints: 2 };
  const manifest = buildPhaseLabManifest(config);
  const baseLevel = {
    platforms: Array.from({ length: 12 }, (_, index) => ({
      x: 100 + index * 260, y: 470 - (index % 3) * 25, w: 190, h: 60,
      type: 'root', logicIndex: index,
    })),
    exudates: [], crystals: [], checkpoints: [],
  };
  const first = applyPhaseLabResources(structuredClone(baseLevel), manifest, 'seed-fixa');
  const second = applyPhaseLabResources(structuredClone(baseLevel), manifest, 'seed-fixa');
  assert.deepEqual(first, second);
  assert.equal(first.exudates.length, 6);
  assert.equal(first.crystals.length, 3);
  assert.equal(first.checkpoints.length, 2);
  assert.ok(first.crystals.every(crystal => crystal.requiredFeature === 'phosphateSolubilization'));
  assert.ok(first.crystals.every(crystal => crystal.phosphateDeposit));
});

test('exporta uma entrada completa compativel com o formato do manifesto', () => {
  const config = createDefaultPhaseLabConfig(3);
  config.allowedOrganisms = ['azospirillum'];
  const manifest = buildPhaseLabManifest(config);
  const exported = JSON.parse(JSON.stringify(manifest));
  assert.equal(exported.id, 'phase-3');
  assert.ok(Array.isArray(exported.segments));
  assert.ok(Array.isArray(exported.presentations));
  assert.ok(Array.isArray(exported.finalTest.requires));
  assert.deepEqual(exported.phaseLab.allowedOrganisms, ['azospirillum']);
  assert.deepEqual(exported.nitrogenRoot, config.nitrogenRoot);
  assert.deepEqual(exported.azospirillumRootLadder, config.azospirillumRootLadder);
  assert.deepEqual(exported.azospirillumNitrogen, config.azospirillumNitrogen);
  assert.deepEqual(exported.mycorrhizaBridge, config.mycorrhizaBridge);
});
