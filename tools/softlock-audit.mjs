#!/usr/bin/env node
// AUDITORIA DE SOFTLOCK POR SEED
// ==============================
//
// Somente leitura. Monta a fase pelo pipeline real, olha, conta e relata — não
// insere degrau, não move plataforma, não consome RNG de ninguém. É a mesma
// disciplina de `auditTraversableRoute`: quem audita não conserta.
//
// Ela existe por um motivo específico. A auditoria de travessia aceita QUALQUER
// vão impossível a partir da fase 4, com esta regra:
//
//     if (options.mycorrhizaStructuresAvailable) { aceitar; }
//     if (options.jetpackAvailable) { aceitar; }
//
// Isto é uma promessa sobre a fase inteira, não sobre o vão. Um vão de 900px sem
// nenhuma raiz colonizável de onde partir é "atravessável por ponte" só porque a
// habilidade existe. O enunciado pede para trocar isso por validação real — e
// pede, com razão, para MEDIR antes: contar quantos trechos só passam pela regra
// ampla, consertar os geradores que os produzem, e só então remover a regra.
//
// Trocar a regra sem medir tem uma consequência conhecida: os trechos que hoje
// são "intencionais" viram `ordinaryFailures`, e há caminhos no pipeline que
// reagem a falha inserindo geometria. Seria trocar um softlock silencioso por
// uma fase desmontada. Este script produz o número que falta para decidir.
//
// Uso:
//   node tools/softlock-audit.mjs                 # padrão: 50+50+20
//   node tools/softlock-audit.mjs --seeds 10      # execução rápida
//   node tools/softlock-audit.mjs --json          # saída para diff

import {
  auditTraversableRoute,
  executablePrimitives,
  generateLevel,
  isIntentionalDynamicCrossing,
} from '../src/procgen/generator.js';
import {
  ensureAzospirillumBeforeAscentGates,
  generateAzospirillumRootLadders,
} from '../src/procgen/azospirillum-root-growth.js';
import {
  auditAzospirillumGates,
  validateAndRepairAzospirillumGates,
} from '../src/procgen/azospirillum-gate-integrity.js';
import {
  clearPhaseManifestOverride,
  getPhaseManifest,
  setPhaseManifestOverride,
} from '../src/procgen/campaign-manifest.js';
import { generateCampaignEncounters } from '../src/procgen/campaign-encounters.js';
import { generateUnderdevelopedNitrogenRoots } from '../src/procgen/nitrogen-root.js';
import { getPrimaryTraversalPlatforms } from '../src/procgen/traversal-route.js';
import { synchronizeWorldBounds } from '../src/procgen/world-bounds.js';
import { canTraverseEdge } from '../src/procgen/traversal-edge-physics.js';
import {
  applyPhaseLabResources,
  buildPhaseLabManifest,
  createDefaultPhaseLabConfig,
} from '../src/procgen/phase-lab-config.js';
import {
  createPhosphateDepositAt,
  finalizePhosphateStockCapacity,
  findTransportRootFor,
} from '../src/procgen/phosphate-solubilization.js';
import { auditPlatformOccupancy } from '../src/procgen/platform-occupancy.js';
import { evaluateMycorrhizaBridgeCandidate } from '../src/procgen/mycorrhiza-bridge-feasibility.js';
import { evaluatePropulsionCrossing } from '../src/procgen/propulsion-feasibility.js';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? Number(args[index + 1]) : fallback;
};
const SEED_COUNT = value('seeds', 50);
const SHORT_SEED_COUNT = Math.max(1, Math.round(SEED_COUNT * 0.4));

// Mesma regra de `availableRouteGateKinds`: so se pede o portao cuja habilidade
// a fase liberou. A FBN nao tem habilidade associada e vale sempre.
function gateKindsFor(unlocks) {
  const byAbility = {
    azospirillumAscent: 'azospirillumRoots',
    mycorrhizaBridge: 'mycorrhizaStructures',
    phosphateWall: 'phosphateSolubilization',
    nitrogenRootGate: null,
  };
  return Object.entries(byAbility)
    .filter(([, ability]) => ability === null || Boolean(unlocks[ability]))
    .map(([kind]) => kind);
}

const seeds = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);

// --- MONTAGEM DA FASE ------------------------------------------------------
//
// Reproduz a ordem de `prepareLevel`. Não é o `prepareLevel` de verdade porque
// aquele vive em `app.js`, que só roda no navegador — é a mesma limitação que os
// testes de geração já enfrentam, e a mesma solução que eles usam.

function buildPhase(phase, seed, { unlocks, verticalPlan = null } = {}) {
  const manifest = getPhaseManifest(phase);
  // A fase 10 nasce com o plano vertical e com os portoes derivados dos
  // unlocks — e o mesmo que `prepareLevel` faz. Sem isto a auditoria montaria
  // uma fase 10 sem portao nenhum e mediria o vazio.
  const plan = verticalPlan
    ?? (phase === 10
      ? { gateKinds: gateKindsFor(unlocks) }
      : false);
  // `generateLevel` nao recebe fase nem contagem de chunks: os dois saem do
  // grafo logico interno. Isto e uma LIMITACAO conhecida desta auditoria — ela
  // audita a geometria de rota e os portoes, nao a decoracao por fase, que vive
  // em `prepareLevel` (browser). Registrado no relatorio, nao escondido.
  const level = generateLevel(seed, { verticalPlan: plan });
  const encounters = generateCampaignEncounters({
    platforms: level.platforms, phase, seedValue: seed,
  });
  level.microbeEncounters = encounters;

  ensureAzospirillumBeforeAscentGates?.({ level, phase, seedValue: seed, encounters });
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
  generateAzospirillumRootLadders({ level, phase, seedValue: seed, encounters, config: null });
  const integrity = validateAndRepairAzospirillumGates(level, {
    abilities: unlocks,
    regenerateLadders: target => generateAzospirillumRootLadders({
      level: target, phase, seedValue: seed, encounters, config: null,
    }),
  });
  // OS DEPOSITOS DE FOSFATO DA CAMPANHA.
  //
  // Faltavam aqui, e a ausencia foi cara: a auditoria relatava
  // "depositos: reais 0 | sem raiz 0" para a campanha, e eu li aquele zero como
  // "nenhum quebrado" quando ele queria dizer "nenhum medido". Um portao de
  // parede sem raiz colonizavel ao alcance passou despercebido por isso.
  //
  // Zero so significa alguma coisa quando o denominador e maior que zero.
  for (const gate of (level.routeGates || []).filter(entry => entry.kind === 'phosphateWall')) {
    createPhosphateDepositAt({
      level,
      hostPlatform: gate.host,
      logicIndex: gate.chunkIndex,
      authored: true,
      difficulty: 'phase-route-gate',
      id: `${gate.id}-deposit`,
    });
  }
  generateUnderdevelopedNitrogenRoots({
    level, phase, seedValue: seed, encounters,
    config: manifest?.nitrogenRoot,
  });
  synchronizeWorldBounds(level);
  finalizePhosphateStockCapacity(level);
  return { level, integrity, encounters };
}

// --- CLASSIFICAÇÃO DOS VÃOS ------------------------------------------------

function firstEncounterChunk(level, id) {
  const found = (level.microbeEncounters || [])
    .filter(entry => entry.id === id && Number.isInteger(entry.logicIndex))
    .map(entry => entry.logicIndex)
    .sort((left, right) => left - right)[0];
  return Number.isInteger(found) ? found : null;
}

function firstExudateAfter(level, chunk) {
  if (chunk === null) return null;
  const found = (level.exudates || [])
    .filter(entry => Number.isInteger(entry.logicIndex) && entry.logicIndex >= chunk)
    .map(entry => entry.logicIndex)
    .sort((left, right) => left - right)[0];
  return Number.isInteger(found) ? found : null;
}

/**
 * Reclassifica os vãos que a regra ampla aceitou, agora com validação real.
 *
 * Este é o número que o enunciado pede: quantos trechos existem HOJE que passam
 * só porque a habilidade está desbloqueada, e não porque a travessia é possível.
 */
function reclassifyLooseAcceptances(level, unlocks, audit) {
  const mycoChunk = firstEncounterChunk(level, 'myco');
  const exudateChunk = firstExudateAfter(level, mycoChunk);
  const route = getPrimaryTraversalPlatforms(level);
  const buckets = {
    'bridge-feasible': 0,
    'bridge-not-feasible': 0,
    'bridge-prerequisite-missing': 0,
    'propulsion-feasible': 0,
    'propulsion-not-feasible': 0,
  };
  const details = [];

  for (const crossing of audit.intentionalCrossings) {
    const loose = crossing.reason === 'bridgeableByPlayer'
      || crossing.reason === 'passableWithPropulsion';
    if (!loose) continue;
    const index = route.findIndex(platform => platform.logicIndex === crossing.nextLogicIndex);
    const next = route[index];
    const previous = route[index - 1];
    if (!next || !previous) continue;

    if (crossing.reason === 'bridgeableByPlayer') {
      const verdict = evaluateMycorrhizaBridgeCandidate({
        level, source: previous, target: next,
      });
      // Pré-requisito: a micorriza tem de ter sido apresentada, e tem de haver
      // exsudato para inoculá-la, ANTES do vão. Habilidade destravada no papel
      // e organismo inalcançável no chão não atravessam nada.
      const prerequisiteOk = mycoChunk !== null
        && exudateChunk !== null
        && mycoChunk <= previous.logicIndex
        && exudateChunk <= previous.logicIndex;
      const bucket = !verdict.feasible ? 'bridge-not-feasible'
        : !prerequisiteOk ? 'bridge-prerequisite-missing'
        : 'bridge-feasible';
      buckets[bucket]++;
      if (bucket !== 'bridge-feasible') {
        details.push({ bucket, reason: verdict.reason || 'pre-requisito', gap: crossing.gapWidth });
      }
      continue;
    }

    const verdict = evaluatePropulsionCrossing({ from: previous, to: next, unlocks });
    const bucket = verdict.feasible ? 'propulsion-feasible' : 'propulsion-not-feasible';
    buckets[bucket]++;
    if (!verdict.feasible) {
      details.push({ bucket, reason: verdict.reason, gap: crossing.gapWidth, rise: verdict.rise });
    }
  }
  return { buckets, details };
}

function auditPhosphate(level) {
  const deposits = level.phosphateDeposits || [];
  const crystals = level.crystals || [];
  const mycoChunk = firstEncounterChunk(level, 'myco');
  const exudateChunk = firstExudateAfter(level, mycoChunk);
  return {
    real: deposits.length,
    // "Falso" é o que parece depósito no mundo e não está registrado no sistema:
    // exatamente o que o Phase Lab produzia.
    fake: crystals.filter(entry => entry.phosphateDeposit && !deposits.includes(entry)).length,
    withoutRoot: deposits.filter(entry => !findTransportRootFor(level, entry)).length,
    withoutMycorrhiza: mycoChunk === null ? deposits.length : 0,
    withoutExudate: deposits.filter(entry => (
      exudateChunk === null || exudateChunk > (entry.logicIndex ?? 0)
    )).length,
  };
}

// Conflitos de ocupacao vem do registro compartilhado — o MESMO que os
// instaladores consultam antes de dar funcao a uma plataforma. Uma heuristica
// propria aqui poderia discordar de quem decide, e a auditoria mediria outra
// coisa que nao o produto.
function auditConflicts(level) {
  return auditPlatformOccupancy(level);
}

/** Raízes onde uma colônia madura de Azo NÃO conseguiria formar escada. */
function auditLadderCapableRoots(level) {
  const roots = (level.platforms || []).filter(platform => (
    platform.type === 'root' && !platform.final && !platform.recovery
    && !platform.azospirillumStructure && !platform.mycorrhizaStructure
  ));
  // Com o topo relativo (`host.y - reach`), toda raiz tem destino acima. A
  // checagem é a mesma condição de `createRuntimeLadder`.
  const RUNTIME_MIN_REACH = 96;
  const blocked = roots.filter(root => (root.y - RUNTIME_MIN_REACH) >= (root.y - 6) - 40);
  return { total: roots.length, blocked: blocked.length };
}

function auditSeed(label, phase, seed, unlocks, { verticalPlan = null } = {}) {
  const { level, integrity } = buildPhase(phase, seed, { unlocks, verticalPlan });
  const audit = auditTraversableRoute(level, unlocks, {
    mycorrhizaStructuresAvailable: Boolean(unlocks.mycorrhizaStructures),
    jetpackAvailable: Boolean(unlocks.jetpack),
  });
  const loose = reclassifyLooseAcceptances(level, unlocks, audit);
  const gates = auditAzospirillumGates(level);
  return {
    label, phase, seed,
    ordinaryOk: getPrimaryTraversalPlatforms(level).length - 1 - audit.ordinaryFailures.length,
    ordinaryFailures: audit.ordinaryFailures.length,
    gatesTotal: gates.total,
    gatesWithLadder: gates.withLadder,
    gatesWithoutLadder: gates.withoutLadder,
    gatesRepaired: integrity.repairs.length,
    gatesUndone: integrity.undone.length,
    invariantHolds: integrity.invariantHolds,
    ...loose.buckets,
    phosphate: auditPhosphate(level),
    conflicts: auditConflicts(level).length,
    ladderRoots: auditLadderCapableRoots(level),
    looseDetails: loose.details,
  };
}

function summarize(title, rows) {
  const sum = key => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const worst = key => Math.max(...rows.map(row => Number(row[key]) || 0));
  return {
    title,
    seeds: rows.length,
    ordinaryFailures: sum('ordinaryFailures'),
    seedsWithOrdinaryFailure: rows.filter(row => row.ordinaryFailures > 0).length,
    gatesTotal: sum('gatesTotal'),
    gatesWithLadder: sum('gatesWithLadder'),
    gatesWithoutLadder: sum('gatesWithoutLadder'),
    gatesRepaired: sum('gatesRepaired'),
    gatesUndone: sum('gatesUndone'),
    invariantBroken: rows.filter(row => !row.invariantHolds).length,
    bridgeFeasible: sum('bridge-feasible'),
    bridgeNotFeasible: sum('bridge-not-feasible'),
    bridgePrerequisiteMissing: sum('bridge-prerequisite-missing'),
    propulsionFeasible: sum('propulsion-feasible'),
    propulsionNotFeasible: sum('propulsion-not-feasible'),
    depositsReal: sum2(rows, 'phosphate', 'real'),
    depositsFake: sum2(rows, 'phosphate', 'fake'),
    depositsWithoutRoot: sum2(rows, 'phosphate', 'withoutRoot'),
    depositsWithoutMycorrhiza: sum2(rows, 'phosphate', 'withoutMycorrhiza'),
    depositsWithoutExudate: sum2(rows, 'phosphate', 'withoutExudate'),
    conflicts: sum('conflicts'),
    rootsBlockedForLadder: sum2(rows, 'ladderRoots', 'blocked'),
    worstOrdinaryFailures: worst('ordinaryFailures'),
  };
}

function sum2(rows, group, key) {
  return rows.reduce((total, row) => total + (Number(row[group]?.[key]) || 0), 0);
}

const CAMPAIGN_UNLOCKS = {
  doubleJump: true, dash: true, jetpack: true,
  mycorrhizaStructures: true, azospirillumRoots: true, phosphateSolubilization: true,
};

function runCampaign(phase, count, label) {
  clearPhaseManifestOverride();
  return seeds(`camp-${phase}`, count)
    .map(seed => auditSeed(label, phase, seed, CAMPAIGN_UNLOCKS));
}

function runLab(phase, count, label, mutate = null) {
  const rows = [];
  for (const seed of seeds(`lab-${phase}`, count)) {
    clearPhaseManifestOverride();
    const config = createDefaultPhaseLabConfig(phase);
    config.seed = seed;
    mutate?.(config);
    setPhaseManifestOverride(buildPhaseLabManifest(config));
    const row = auditSeedWithLab(label, phase, seed, config);
    rows.push(row);
  }
  clearPhaseManifestOverride();
  return rows;
}

function auditSeedWithLab(label, phase, seed, config) {
  const manifest = getPhaseManifest(phase);
  const { level, integrity } = buildPhase(phase, seed, { unlocks: CAMPAIGN_UNLOCKS });
  applyPhaseLabResources(level, manifest, seed);
  const audit = auditTraversableRoute(level, CAMPAIGN_UNLOCKS, {
    mycorrhizaStructuresAvailable: true,
    jetpackAvailable: true,
  });
  const loose = reclassifyLooseAcceptances(level, CAMPAIGN_UNLOCKS, audit);
  const gates = auditAzospirillumGates(level);
  return {
    label, phase, seed,
    ordinaryFailures: audit.ordinaryFailures.length,
    gatesTotal: gates.total,
    gatesWithLadder: gates.withLadder,
    gatesWithoutLadder: gates.withoutLadder,
    gatesRepaired: integrity.repairs.length,
    gatesUndone: integrity.undone.length,
    invariantHolds: integrity.invariantHolds,
    ...loose.buckets,
    phosphate: auditPhosphate(level),
    conflicts: auditConflicts(level).length,
    ladderRoots: auditLadderCapableRoots(level),
    allowedOrganisms: config.allowedOrganisms.length,
    looseDetails: loose.details,
  };
}

const reports = [];
reports.push(summarize(`campanha fase 10 (${SEED_COUNT} seeds)`, runCampaign(10, SEED_COUNT, 'campanha-10')));
reports.push(summarize(`phase lab fase 10 (${SEED_COUNT} seeds)`, runLab(10, SEED_COUNT, 'lab-10')));
for (const phase of [3, 4, 7]) {
  reports.push(summarize(
    `campanha fase ${phase} (${SHORT_SEED_COUNT} seeds)`,
    runCampaign(phase, SHORT_SEED_COUNT, `campanha-${phase}`),
  ));
}
reports.push(summarize(
  `lab 10 sem micorriza (${SHORT_SEED_COUNT} seeds)`,
  runLab(10, SHORT_SEED_COUNT, 'lab-sem-myco', config => {
    config.allowedOrganisms = config.allowedOrganisms.filter(type => type !== 'myco');
  }),
));
reports.push(summarize(
  `lab 10 sem azospirillum (${SHORT_SEED_COUNT} seeds)`,
  runLab(10, SHORT_SEED_COUNT, 'lab-sem-azo', config => {
    config.allowedOrganisms = config.allowedOrganisms.filter(type => type !== 'azospirillum');
  }),
));
reports.push(summarize(
  `lab 10 com 6 cristais (${SHORT_SEED_COUNT} seeds)`,
  runLab(10, SHORT_SEED_COUNT, 'lab-cristais', config => { config.resources.crystals = 6; }),
));
reports.push(summarize(
  `lab 10 com zero cristais (${SHORT_SEED_COUNT} seeds)`,
  runLab(10, SHORT_SEED_COUNT, 'lab-zero-cristais', config => { config.resources.crystals = 0; }),
));

if (flag('json')) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const report of reports) {
    console.log(`\n=== ${report.title} ===`);
    console.log(`  travessias ordinarias invalidas : ${report.ordinaryFailures}`
      + ` (em ${report.seedsWithOrdinaryFailure ?? 0} seeds, pior seed ${report.worstOrdinaryFailures})`);
    console.log(`  portoes de Azo                  : ${report.gatesTotal}`
      + ` | com escada ${report.gatesWithLadder} | sem escada ${report.gatesWithoutLadder}`
      + ` | reparados ${report.gatesRepaired} | desfeitos ${report.gatesUndone}`);
    console.log(`  invariante quebrada em seeds    : ${report.invariantBroken}`);
    console.log(`  ponte: viavel ${report.bridgeFeasible}`
      + ` | inviavel ${report.bridgeNotFeasible}`
      + ` | sem pre-requisito ${report.bridgePrerequisiteMissing}`);
    console.log(`  propulsao: viavel ${report.propulsionFeasible}`
      + ` | inviavel ${report.propulsionNotFeasible}`);
    console.log(`  depositos: reais ${report.depositsReal}`
      + ` | falsos ${report.depositsFake}`
      + ` | sem raiz ${report.depositsWithoutRoot}`
      + ` | sem micorriza ${report.depositsWithoutMycorrhiza}`
      + ` | sem exsudato ${report.depositsWithoutExudate}`);
    console.log(`  conflitos entre desafios        : ${report.conflicts}`);
    console.log(`  raizes sem escada possivel      : ${report.rootsBlockedForLadder}`);
  }
}
