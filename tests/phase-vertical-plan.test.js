import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { auditTraversableRoute, generateLevel } from '../src/procgen/generator.js';
import {
  createPhaseVerticalPlan,
  PHASE_SILHOUETTE_CONTRACTS,
  PHASE_SILHOUETTE_FAMILY_IDS,
  PHASE_VERTICAL_ENVELOPE,
  validatePhaseVerticalPlan,
  verticalBandAt,
} from '../src/procgen/phase-vertical-plan.js';

const SEEDS = Object.freeze(Array.from(
  { length: 16 },
  (_, index) => `silhueta-${index + 1}:fase-10`,
));

function phaseTen(seed, { verticalPlan = false } = {}) {
  const campaign = createCampaign(seed.split(':')[0]);
  campaign.phase = 10;
  for (const feature of Object.keys(campaign.unlocks)) {
    campaign.unlocks[feature] = true;
  }
  const profile = prepareCampaignGeneration(campaign);
  const level = generateLevel(seed, {
    referenceScreenWorldWidth: 1280,
    referenceScreenWorldHeight: 720,
    verticalPlan,
  });
  return decorateCampaignLevel(level, campaign, profile);
}

// Só as plataformas do percurso: raízes de recuperação e blocos de encontro
// compartilham `logicIndex` e, contadas junto, inflam a amplitude e escondem a
// serpentina — foi assim que a primeira medição desta silhueta enganou.
function routePlatforms(level) {
  return (level.platforms || [])
    .filter(platform => (
      Number.isInteger(platform.logicIndex)
      && platform.logicIndex >= 0
      && !platform.recovery
      && !platform.repaired
      && !platform.encounterInstanceId
    ))
    .sort((left, right) => left.logicIndex - right.logicIndex || left.x - right.x);
}

function silhouetteOf(level) {
  const route = routePlatforms(level);
  const ys = route.map(platform => platform.y);
  let longestRun = 0;
  let run = 0;
  let sign = 0;
  let climbs = 0;
  let drops = 0;
  for (let index = 1; index < route.length; index++) {
    const delta = route[index].y - route[index - 1].y;
    const current = Math.abs(delta) < 26 ? 0 : Math.sign(delta);
    if (current < 0) climbs++;
    else if (current > 0) drops++;
    if (current !== 0 && current === sign) run++;
    else {
      sign = current;
      run = current === 0 ? 0 : 1;
    }
    longestRun = Math.max(longestRun, run);
  }
  return {
    verticalRange: Math.max(...ys) - Math.min(...ys),
    longestRun,
    climbs,
    drops,
    stepCount: route.length - 1,
  };
}

const BASELINE = SEEDS.map(seed => silhouetteOf(phaseTen(seed)));
const PLANNED = SEEDS.map(seed => {
  const level = phaseTen(seed, { verticalPlan: true });
  return { level, silhouette: silhouetteOf(level) };
});

const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;

test('silhueta - o plano é determinístico e respeita os contratos', () => {
  for (const seed of SEEDS) {
    const plan = createPhaseVerticalPlan({ seedValue: seed, phase: 10, totalChunks: 40 });
    assert.ok(plan, `${seed}: plano não gerado`);
    assert.deepEqual(
      validatePhaseVerticalPlan(plan),
      [],
      `${seed}: plano fora do contrato`,
    );
    const twin = createPhaseVerticalPlan({ seedValue: seed, phase: 10, totalChunks: 40 });
    assert.equal(twin.signature, plan.signature, `${seed}: plano não determinístico`);

    // As zonas cobrem todos os chunks, sem buraco e sem sobreposição.
    let expected = 0;
    for (const zone of plan.zones) {
      assert.equal(zone.fromChunk, expected, `${seed}: buraco antes de ${zone.id}`);
      assert.ok(zone.toChunk >= zone.fromChunk, `${seed}: zona vazia ${zone.id}`);
      expected = zone.toChunk + 1;
    }
    assert.equal(expected, 40, `${seed}: zonas não cobrem a fase`);

    // A faixa nunca sai do envelope.
    for (let index = 0; index < 40; index++) {
      const band = verticalBandAt(plan, index);
      assert.ok(band.top >= PHASE_VERTICAL_ENVELOPE.top, `${seed}: faixa acima do envelope`);
      assert.ok(band.bottom <= PHASE_VERTICAL_ENVELOPE.bottom, `${seed}: faixa abaixo do envelope`);
      assert.ok(band.top < band.bottom, `${seed}: faixa invertida`);
    }
  }
});

test('silhueta - todas as famílias produzem planos válidos', () => {
  const seen = new Set();
  for (const familyId of PHASE_SILHOUETTE_FAMILY_IDS) {
    for (const seed of SEEDS.slice(0, 6)) {
      const plan = createPhaseVerticalPlan({
        seedValue: seed,
        phase: 10,
        totalChunks: 40,
        familyId,
      });
      assert.ok(plan, `${familyId}/${seed}: plano não gerado`);
      assert.equal(plan.familyId, familyId);
      assert.deepEqual(validatePhaseVerticalPlan(plan), [], `${familyId}/${seed}`);
      seen.add(familyId);
    }
  }
  assert.equal(seen.size, PHASE_SILHOUETTE_FAMILY_IDS.length);
  assert.ok(seen.size >= 6, `apenas ${seen.size} famílias de silhueta`);
});

test('silhueta - a rota planejada sustenta a direção por mais passos', () => {
  const baseRun = average(BASELINE.map(entry => entry.longestRun));
  const planRun = average(PLANNED.map(entry => entry.silhouette.longestRun));
  // A queixa não era falta de amplitude — era serpentina. A métrica que importa
  // é quantos passos a rota mantém na mesma direção.
  assert.ok(
    planRun >= baseRun + 1,
    `corrida sustentada: ${planRun.toFixed(1)} planejada contra ${baseRun.toFixed(1)} clássica`,
  );
  assert.ok(planRun >= 3.8, `corrida sustentada média baixa: ${planRun.toFixed(1)}`);
});

test('silhueta - o viés para cima desaparece', () => {
  const ratio = entries => {
    const climbs = entries.reduce((sum, entry) => sum + entry.climbs, 0);
    const drops = entries.reduce((sum, entry) => sum + entry.drops, 0);
    return climbs / Math.max(1, drops);
  };
  const baseRatio = ratio(BASELINE);
  const planRatio = ratio(PLANNED.map(entry => entry.silhouette));
  // A rota clássica sobe cerca de duas vezes mais passos do que desce; o plano
  // precisa aproximar isso de 1 sem inverter para o outro lado.
  assert.ok(baseRatio > 1.5, `a base deixou de ter viés: ${baseRatio.toFixed(2)}`);
  assert.ok(
    planRatio < 1.45 && planRatio > 0.7,
    `viés planejado fora de faixa: ${planRatio.toFixed(2)}`,
  );
  assert.ok(planRatio < baseRatio, 'o plano não reduziu o viés');
});

test('silhueta - a física da rota continua válida com o plano', () => {
  for (const [index, entry] of PLANNED.entries()) {
    const audit = auditTraversableRoute(entry.level, { doubleJump: true, dash: true }, {});
    assert.notEqual(audit, null, `${SEEDS[index]}: auditoria não executou`);
    assert.notEqual(audit.valid, false, `${SEEDS[index]}: rota planejada intraversável`);
    assert.ok(
      entry.silhouette.stepCount > 10,
      `${SEEDS[index]}: rota curta demais para avaliar`,
    );
  }
});

test('silhueta - sem plano a geração é byte a byte a de hoje', () => {
  for (const seed of SEEDS.slice(0, 8)) {
    const withoutOption = generateLevel(seed, {
      referenceScreenWorldWidth: 1280,
      referenceScreenWorldHeight: 720,
    });
    const explicitlyOff = generateLevel(seed, {
      referenceScreenWorldWidth: 1280,
      referenceScreenWorldHeight: 720,
      verticalPlan: false,
    });
    const geometry = level => (level.platforms || [])
      .map(platform => `${platform.x},${platform.y},${platform.w},${platform.h}`)
      .join('|');
    assert.equal(geometry(explicitlyOff), geometry(withoutOption), `${seed}: fallback divergiu`);
    assert.equal(withoutOption.verticalPlan, null);
    assert.equal(withoutOption.verticalPlanRequested, false);
  }
});

test('silhueta - o fallback é declarado, nunca silencioso', () => {
  // Um plano impossível tem de virar fallback VISÍVEL. Sem isso, um bug que
  // derrubasse a silhueta sempre passaria por "variedade" durante semanas.
  const plan = createPhaseVerticalPlan({
    seedValue: 'curta',
    phase: 10,
    totalChunks: 4,
  });
  assert.equal(plan, null, 'fase curta demais deveria recusar o plano');

  const level = phaseTen(SEEDS[0], { verticalPlan: true });
  assert.equal(level.verticalPlanRequested, true);
  assert.ok(level.verticalPlan, 'plano pedido e não entregue sem motivo');
  assert.deepEqual(level.verticalPlanViolations, []);
  assert.ok(
    PHASE_SILHOUETTE_CONTRACTS.minimumSustainedRun >= 3,
    'contrato de corrida sustentada afrouxado',
  );
});
