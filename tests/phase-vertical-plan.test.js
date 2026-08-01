import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCampaign,
  decorateCampaignLevel,
  prepareCampaignGeneration,
} from '../src/procgen/campaign-progression.js';
import { auditTraversableRoute, generateLevel } from '../src/procgen/generator.js';
import { getPrimaryTraversalPlatforms } from '../src/procgen/traversal-route.js';
import {
  ensureAzospirillumBeforeAscentGates,
  generateAzospirillumRootLadders,
} from '../src/procgen/azospirillum-root-growth.js';
import { OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE } from '../src/procgen/optional-detour-planner.js';
import { createPhaseTenTopologyDetour } from '../src/procgen/optional-detour-topology-synthesizer.js';
import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { createPhosphateDepositAt } from '../src/procgen/phosphate-solubilization.js';
import {
  ASCENT_GATE_MINIMUM_CHUNK,
  AZO_ASCENT_RISE_RANGE,
  MYCORRHIZA_BRIDGE_GAP_RANGE,
  MYCORRHIZA_BRIDGE_MAX_DELTA,
  plannedRouteGates,
  ROUTE_GATE_KINDS,
  ROUTE_GATE_REQUIRED_ABILITY,
  createPhaseVerticalPlan,
  PHASE_SILHOUETTE_CONTRACTS,
  PHASE_SILHOUETTE_FAMILY_IDS,
  PHASE_VERTICAL_ENVELOPE,
  plannedAscentGates,
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

// A ROTA, como o próprio pipeline a define. Blocos de encontro ficam de fora
// porque vários compartilham o mesmo `logicIndex` e, contados junto, inflam a
// amplitude e escondem a serpentina — foi assim que a primeira medição desta
// silhueta enganou.
//
// As plataformas `repaired` FICAM. A primeira versão desta função as excluía
// junto com as de recuperação, e isso media a silhueta de meia fase: metade dos
// chunks (20 de 40, medido) sai de `createSafeFallback`. Foi essa exclusão que
// escondeu por tanto tempo o clamp absoluto `[250, 555]` que o fallback
// aplicava — o mesmo defeito da senoide e do `[220, 560]`.
function routePlatforms(level) {
  return getPrimaryTraversalPlatforms(level)
    .filter(platform => (
      Number.isInteger(platform.logicIndex)
      && platform.logicIndex >= 0
      && !platform.recovery
      && !platform.encounterInstanceId
    ));
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
  let climbPixels = 0;
  let dropPixels = 0;
  for (let index = 1; index < route.length; index++) {
    const delta = route[index].y - route[index - 1].y;
    if (delta < 0) climbPixels -= delta;
    else dropPixels += delta;
  }
  return {
    verticalRange: Math.max(...ys) - Math.min(...ys),
    longestRun,
    climbs,
    drops,
    climbPixels,
    dropPixels,
    stepCount: route.length - 1,
  };
}

const BASELINE = SEEDS.map(seed => silhouetteOf(phaseTen(seed)));
const PLANNED = SEEDS.map(seed => {
  const level = phaseTen(seed, { verticalPlan: true });
  return { level, silhouette: silhouetteOf(level) };
});
const GATED = SEEDS.map(seed => {
  const level = phaseTen(seed, { verticalPlan: { ascentGates: true } });
  return { seed, level, silhouette: silhouetteOf(level) };
});

// Reproduz o que `prepareLevel` faz: cada portão vira um pedido AUTORAL de
// escada. Sem isto o portão é um degrau intransponível e nada mais.
function withLadders(entry) {
  const level = entry.level;
  for (const gate of level.ascentGates || []) {
    level.authoredAzospirillumLadderRequests = [
      ...(level.authoredAzospirillumLadderRequests || []),
      {
        hostPlatform: gate.host,
        destinationPlatform: gate.destination,
        requiredReach: gate.rise,
        accessStyle: 'phase-ascent-gate',
        ascentGateId: gate.id,
      },
    ];
  }
  generateAzospirillumRootLadders({
    level,
    phase: 10,
    seedValue: entry.seed,
    encounters: generateCampaignEncounters({
      platforms: level.platforms,
      phase: 10,
      seedValue: entry.seed,
    }),
    config: null,
  });
  return level;
}

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
  assert.ok(planRun >= 5, `corrida sustentada média baixa: ${planRun.toFixed(1)}`);
});

test('silhueta - a verticalidade é visível em fração de tela, não só em passos', () => {
  // A primeira versão desta silhueta passou em "corrida sustentada" e mesmo
  // assim o jogador não viu diferença: subia 41% de uma tela ao longo de dez
  // telas de largura. Passos não são o que se vê; pixels de tela são.
  const SCREEN_HEIGHT = 720;
  const amplitude = average(PLANNED.map(entry => entry.silhouette.verticalRange));
  const baseAmplitude = average(BASELINE.map(entry => entry.verticalRange));
  assert.ok(
    amplitude >= SCREEN_HEIGHT * 0.55,
    `amplitude ${(amplitude / SCREEN_HEIGHT * 100).toFixed(0)}% de tela`,
  );
  assert.ok(
    amplitude >= baseAmplitude * 1.4,
    `amplitude ${amplitude.toFixed(0)} contra ${baseAmplitude.toFixed(0)} da clássica`,
  );
});

test('silhueta - o viés para cima diminui, medido em pixels', () => {
  // Medir em PASSOS engana: `traversalLimits` deixa cada passo descer 82-142 px
  // mas subir só 46-92, então uma rota equilibrada em pixels sempre parece
  // enviesada quando se contam passos. Foi assim que a primeira versão deste
  // teste declarou "sem viés" numa rota que sobe o dobro do que desce.
  const ratio = entries => {
    const climb = entries.reduce((sum, entry) => sum + entry.climbPixels, 0);
    const drop = entries.reduce((sum, entry) => sum + entry.dropPixels, 0);
    return climb / Math.max(1, drop);
  };
  const baseRatio = ratio(BASELINE);
  const planRatio = ratio(PLANNED.map(entry => entry.silhouette));
  assert.ok(baseRatio > 1.7, `a base deixou de ter viés: ${baseRatio.toFixed(2)}`);
  assert.ok(
    planRatio < baseRatio * 0.85,
    `viés ${planRatio.toFixed(2)} contra ${baseRatio.toFixed(2)} da clássica`,
  );
  // E descer tem de ser um evento real, não migalha: a rota planejada precisa
  // gastar bem mais pixels descendo do que a clássica.
  const baseDrop = BASELINE.reduce((sum, entry) => sum + entry.dropPixels, 0);
  const planDrop = PLANNED.reduce((sum, entry) => sum + entry.silhouette.dropPixels, 0);
  assert.ok(
    planDrop > baseDrop * 1.5,
    `descida planejada ${planDrop.toFixed(0)} contra ${baseDrop.toFixed(0)}`,
  );
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

test('portão - só existe quando pedido, e as fases de hoje não mudam', () => {
  for (const entry of PLANNED) {
    assert.deepEqual(
      entry.level.ascentGates,
      [],
      'plano sem `ascentGates` não pode criar portão',
    );
  }
  // Sem plano nenhum, nem a lista existe como efeito colateral.
  const classic = phaseTen(SEEDS[0]);
  assert.deepEqual(classic.ascentGates, []);
});

test('portão - sobe além do salto duplo, senão a escada é decoração', () => {
  // Se um portão coubesse num salto duplo (teto prático de 92 px por passo em
  // `traversalLimits`), o jogador passaria por cima e a escada de Azospirillum
  // viraria enfeite. É esta a única razão de o portão existir.
  const [minimumRise, maximumRise] = AZO_ASCENT_RISE_RANGE;
  let total = 0;
  for (const entry of GATED) {
    for (const gate of entry.level.ascentGates || []) {
      total++;
      assert.ok(
        gate.rise >= minimumRise && gate.rise <= maximumRise,
        `${entry.seed}: subida ${gate.rise}px fora de ${minimumRise}-${maximumRise}`,
      );
      assert.ok(gate.rise > 92, `${entry.seed}: portão saltável (${gate.rise}px)`);
      assert.ok(
        gate.chunkIndex >= ASCENT_GATE_MINIMUM_CHUNK,
        `${entry.seed}: portão em c${gate.chunkIndex}, antes do primeiro checkpoint`,
      );
      // A geometria REAL tem de bater com o pedido. As duas tentativas
      // anteriores morreram justamente aqui: `stabilizeGeometry` esmagava a
      // subida em 92 px e `createSafeFallback` devolvia a plataforma a
      // `previous.y ± 42` — o degrau saía ABAIXO do hospedeiro.
      assert.equal(
        Math.round(gate.host.y - gate.destination.y),
        gate.rise,
        `${entry.seed}: geometria do portão reescrita depois de criada`,
      );
      assert.ok(gate.destination.ascentGate, `${entry.seed}: destino sem marca`);
      assert.ok(gate.host.ascentGateHost, `${entry.seed}: hospedeiro sem marca`);
      assert.equal(gate.host.type, 'root', `${entry.seed}: hospedeiro não é raiz`);
    }
  }
  assert.ok(total >= 24, `apenas ${total} portões em ${SEEDS.length} seeds`);
});

test('portão - cada um recebe a escada que o abre', () => {
  for (const entry of GATED) {
    const gates = entry.level.ascentGates || [];
    if (!gates.length) continue;
    const level = withLadders(entry);
    const ladders = (level.azospirillumRootLadders || [])
      .filter(ladder => ladder.accessStyle === 'phase-ascent-gate');
    assert.equal(
      ladders.length,
      gates.length,
      `${entry.seed}: ${gates.length} portões e ${ladders.length} escadas`,
    );
    for (const ladder of ladders) {
      assert.ok(ladder.steps.length >= 3, `${entry.seed}: escada com ${ladder.steps.length} degraus`);
      // O espaçamento tem de caber no salto simples (96 px), senão a escada
      // madura ainda deixa o jogador preso.
      const spacing = (ladder.startY - ladder.endY) / (ladder.steps.length + 1);
      assert.ok(spacing <= 96, `${entry.seed}: degraus a ${spacing.toFixed(0)}px`);
    }
  }
});

test('portão - a auditoria o lê como travessia intencional, não como falha', () => {
  for (const entry of GATED) {
    const gates = entry.level.ascentGates || [];
    if (!gates.length) continue;
    const audit = auditTraversableRoute(entry.level, { doubleJump: true, dash: true }, {});
    for (const gate of gates) {
      const asFailure = audit.ordinaryFailures
        .some(failure => failure.nextLogicIndex === gate.destinationLogicIndex);
      assert.equal(asFailure, false, `${entry.seed}: portão c${gate.chunkIndex} lido como falha`);
    }
    const recognized = audit.intentionalCrossings
      .filter(crossing => crossing.mechanic === 'azospirillumAscentGate');
    assert.ok(
      recognized.length >= 1,
      `${entry.seed}: nenhum portão reconhecido entre ${audit.intentionalCrossings.length} travessias`,
    );
  }
});

test('portão - o Azospirillum está disponível ANTES do primeiro portão', () => {
  // No playtest o portão apareceu antes de qualquer Azospirillum na rota: a
  // fase só destravou porque o jogador seguiu adiante, achou a colônia e
  // VOLTOU. Isso é softlock com passos extras. A regra é a que ele enunciou —
  // o desafio aparece no ponto em que o Azo já está disponível, ou depois.
  let checked = 0;
  for (const entry of GATED) {
    const gates = entry.level.ascentGates || [];
    if (!gates.length) continue;
    const encounters = ensureAzospirillumBeforeAscentGates({
      level: entry.level,
      encounters: generateCampaignEncounters({
        platforms: entry.level.platforms,
        phase: 10,
        seedValue: entry.seed,
      }),
      seedValue: entry.seed,
      phase: 10,
    });
    const firstAzospirillum = encounters
      .filter(encounter => encounter.id === 'azospirillum' && Number.isInteger(encounter.logicIndex))
      .map(encounter => encounter.logicIndex)
      .sort((left, right) => left - right)[0];
    const firstGate = Math.min(...gates.map(gate => gate.chunkIndex));
    assert.ok(
      Number.isInteger(firstAzospirillum),
      `${entry.seed}: portão em c${firstGate} sem nenhum Azospirillum na fase`,
    );
    assert.ok(
      firstAzospirillum < firstGate,
      `${entry.seed}: Azo em c${firstAzospirillum} e portão em c${firstGate}`,
    );
    checked++;
  }
  assert.ok(checked >= 8, `só ${checked} seeds com portão para conferir`);
});

test('portão - a rota opcional não encosta no degrau', () => {
  // O degrau é primário e fica ALTO de propósito. `primaryClearanceOf` só
  // media a primária que passa por BAIXO da opcional, então o degrau caía num
  // `continue` e nunca era medido: no playtest a rota opcional apareceu colada
  // nele, com 67 px de folga onde o contrato pede 270.
  let gatesWithDetour = 0;
  for (const entry of GATED.slice(0, 8)) {
    const gates = entry.level.ascentGates || [];
    if (!gates.length) continue;
    const level = entry.level;
    createPhaseTenTopologyDetour({
      level,
      phase: 10,
      seedValue: entry.seed,
      abilities: ['doubleJump', 'dash', 'phosphateSolubilization', 'mycorrhizaStructures'],
    });
    const optional = (level.platforms || [])
      .filter(platform => platform.routeScope === 'optional');
    if (!optional.length) continue;
    gatesWithDetour++;
    for (const gate of gates) {
      const step = gate.destination;
      for (const platform of optional) {
        const overlapsX = platform.x < step.x + step.w && platform.x + platform.w > step.x;
        if (!overlapsX) continue;
        const separation = platform.y >= step.y
          ? platform.y - (step.y + step.h)
          : step.y - (platform.y + platform.h);
        assert.ok(
          separation >= OPTIONAL_DETOUR_MIN_PRIMARY_CLEARANCE,
          `${entry.seed}: opcional a ${Math.round(separation)}px do degrau c${gate.chunkIndex}`,
        );
      }
    }
  }
  assert.ok(gatesWithDetour >= 1, 'nenhuma seed produziu portão e desvio juntos');
});

test('portão - a verticalidade sobe de verdade, em fração de tela', () => {
  const SCREEN_HEIGHT = 720;
  const amplitude = average(GATED.map(entry => entry.silhouette.verticalRange));
  const planAmplitude = average(PLANNED.map(entry => entry.silhouette.verticalRange));
  assert.ok(
    amplitude >= SCREEN_HEIGHT * 0.7,
    `amplitude ${(amplitude / SCREEN_HEIGHT * 100).toFixed(0)}% de tela`,
  );
  assert.ok(
    amplitude > planAmplitude * 1.1,
    `portões ${amplitude.toFixed(0)}px contra ${planAmplitude.toFixed(0)}px sem eles`,
  );
});

test('portão - a rota continua auditável e sem falha comum', () => {
  for (const entry of GATED) {
    const audit = auditTraversableRoute(entry.level, { doubleJump: true, dash: true }, {});
    assert.notEqual(audit, null, `${entry.seed}: auditoria não executou`);
    assert.notEqual(audit.valid, false, `${entry.seed}: rota intraversável`);
  }
});

test('silhueta - o fallback respeita o envelope do plano', () => {
  // O TERCEIRO clamp absoluto do gerador: `createSafeFallback` prendia o Y em
  // [250, 555]. Como ~17 dos 40 chunks caem nele, era o fallback que achatava
  // a silhueta — e, com portão, teleportava a rota 316 px para baixo no chunk
  // seguinte, desfazendo a escada num passo.
  let above = 0;
  for (const entry of GATED) {
    for (const platform of entry.level.platforms || []) {
      if (!platform.repaired) continue;
      assert.ok(
        platform.y >= PHASE_VERTICAL_ENVELOPE.top,
        `${entry.seed}: fallback acima do envelope (${platform.y})`,
      );
      if (platform.y < 250) above++;
    }
  }
  assert.ok(above >= 8, `nenhum fallback acompanhou a rota acima de 250 (${above})`);
});

test('portão - o plano não põe dois portões colados', () => {
  for (const seed of SEEDS) {
    const plan = createPhaseVerticalPlan({ seedValue: seed, phase: 10, totalChunks: 40 });
    const gates = plannedAscentGates(plan);
    assert.ok(gates.length <= 6, `${seed}: ${gates.length} portões numa fase só`);
    for (let index = 1; index < gates.length; index++) {
      assert.ok(
        gates[index].chunkIndex - gates[index - 1].chunkIndex >= 3,
        `${seed}: portões a menos de 3 chunks`,
      );
    }
  }
});


const ALL_GATES = SEEDS.map(seed => {
  const level = phaseTen(seed, { verticalPlan: { gateKinds: ROUTE_GATE_KINDS } });
  return { seed, level };
});

test('portão - os três tipos convivem; o Azo SOMA, não substitui', () => {
  // Foi exatamente isto que faltou na primeira rodada: só a escada entrou na
  // rota principal, e o jogador reportou "todos os desafios viraram Azo".
  const counts = new Map();
  let seedsWithTwoKinds = 0;
  for (const entry of ALL_GATES) {
    const kinds = new Set((entry.level.routeGates || []).map(gate => gate.kind));
    if (kinds.size >= 2) seedsWithTwoKinds++;
    for (const kind of kinds) counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  for (const kind of ROUTE_GATE_KINDS) {
    assert.ok(
      (counts.get(kind) || 0) >= 3,
      `${kind} apareceu em só ${counts.get(kind) || 0} de ${SEEDS.length} seeds`,
    );
  }
  assert.ok(
    seedsWithTwoKinds >= SEEDS.length * 0.5,
    `só ${seedsWithTwoKinds} seeds com dois tipos ou mais`,
  );
});

test('portão - a ponte cabe no que o runtime de micorriza aceita', () => {
  // `findBridgeTarget` recusa alvo com vão < 58 ou |dy| > 68 quando a fase roda
  // em `horizontalOnly` — que é o caso da 10. Um vão fora disso produziria um
  // portão que a ponte nunca fecha.
  let bridges = 0;
  for (const entry of ALL_GATES) {
    for (const gate of (entry.level.routeGates || []).filter(g => g.kind === 'mycorrhizaBridge')) {
      bridges++;
      const gap = Math.round(gate.destination.x - (gate.host.x + gate.host.w));
      const dy = Math.abs(gate.destination.y - gate.host.y);
      assert.ok(
        gap >= MYCORRHIZA_BRIDGE_GAP_RANGE[0] && gap <= MYCORRHIZA_BRIDGE_GAP_RANGE[1],
        `${entry.seed}: vão ${gap}px fora da faixa`,
      );
      // Vão máximo saltável medido: 430 a 480 px. Abaixo disso a ponte é enfeite.
      assert.ok(gap > 490, `${entry.seed}: vão ${gap}px é saltável`);
      assert.ok(dy <= MYCORRHIZA_BRIDGE_MAX_DELTA, `${entry.seed}: desnível ${dy}px passa do teto da ponte`);
      assert.ok(gate.host.bridgeGateHost, `${entry.seed}: hospedeiro sem marca`);
    }
  }
  assert.ok(bridges >= 8, `só ${bridges} pontes em ${SEEDS.length} seeds`);
});

test('portão - a parede de fosfato fecha mesmo a passagem', () => {
  let walls = 0;
  for (const entry of ALL_GATES) {
    for (const gate of (entry.level.routeGates || []).filter(g => g.kind === 'phosphateWall')) {
      walls++;
      // A parede não muda a rota: hospedeiro e destino são a mesma plataforma.
      assert.equal(gate.host, gate.destination, `${entry.seed}: parede deslocou a rota`);
      assert.ok(gate.host.phosphateWallGate, `${entry.seed}: hospedeiro sem marca`);
      const deposit = createPhosphateDepositAt({
        level: entry.level,
        hostPlatform: gate.host,
        logicIndex: gate.chunkIndex,
        authored: true,
        id: `${gate.id}-deposit`,
      });
      assert.ok(deposit, `${entry.seed}: depósito não criado`);
      // 190 px derrota o salto duplo (~175 px de alcance prático).
      assert.ok(deposit.h >= 190, `${entry.seed}: parede de ${deposit.h}px é saltável`);
      assert.ok(
        deposit.x >= gate.host.x && deposit.x + deposit.w <= gate.host.x + gate.host.w + 8,
        `${entry.seed}: depósito fora do hospedeiro`,
      );
    }
  }
  assert.ok(walls >= 4, `só ${walls} paredes em ${SEEDS.length} seeds`);
});

test('portão - sem a habilidade, o tipo correspondente não é pedido', () => {
  // A regra que vale para a escada vale para os três: um portão sem a
  // habilidade que o abre é softlock, não desafio.
  for (const kind of ROUTE_GATE_KINDS) {
    assert.ok(ROUTE_GATE_REQUIRED_ABILITY[kind], `${kind} sem habilidade declarada`);
    const others = ROUTE_GATE_KINDS.filter(entry => entry !== kind);
    for (const seed of SEEDS.slice(0, 6)) {
      const level = phaseTen(seed, { verticalPlan: { gateKinds: others } });
      assert.equal(
        (level.routeGates || []).filter(gate => gate.kind === kind).length,
        0,
        `${seed}: ${kind} apareceu sem ser pedido`,
      );
    }
  }
});

test('portão - a auditoria reconhece a ponte como travessia intencional', () => {
  for (const entry of ALL_GATES) {
    const bridges = (entry.level.routeGates || []).filter(g => g.kind === 'mycorrhizaBridge');
    if (!bridges.length) continue;
    const audit = auditTraversableRoute(entry.level, { doubleJump: true, dash: true }, {});
    for (const gate of bridges) {
      const asFailure = audit.ordinaryFailures
        .some(failure => failure.nextLogicIndex === gate.destinationLogicIndex);
      assert.equal(asFailure, false, `${entry.seed}: ponte c${gate.chunkIndex} lida como falha`);
    }
    assert.ok(
      audit.intentionalCrossings.some(crossing => crossing.mechanic === 'mycorrhizaBridgeGate'),
      `${entry.seed}: nenhuma ponte reconhecida`,
    );
  }
});

test('portão - dois portões nunca ficam colados', () => {
  for (const seed of SEEDS) {
    const plan = createPhaseVerticalPlan({ seedValue: seed, phase: 10, totalChunks: 40 });
    const gates = plannedRouteGates(plan);
    for (let index = 1; index < gates.length; index++) {
      assert.ok(
        gates[index].chunkIndex - gates[index - 1].chunkIndex >= 3,
        `${seed}: portões a menos de 3 chunks (${gates[index - 1].mechanic}/${gates[index].mechanic})`,
      );
    }
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
