import {
  ECOLOGY_ROAMING_TYPES,
  MVP_EXCLUDED_PATHOGENS,
  PATHOGEN_SYSTEMS,
  NITROGEN_ROOT_DEFAULTS,
  AZOSPIRILLUM_ROOT_LADDER_DEFAULTS,
  AZOSPIRILLUM_NITROGEN_DEFAULTS,
  MYCORRHIZA_BRIDGE_DEFAULTS,
  OPPORTUNISTIC_FUNGUS_DEFAULTS,
  PSEUDOMONAS_IRON_CONTROL_DEFAULTS,
  PHOSPHATE_SOLUBILIZATION_DEFAULTS,
  MELOIDOGYNE_DEFAULTS,
  RALSTONIA_DEFAULTS,
  campaignManifest,
  getProceduralPoolAt,
  validateCampaignManifest,
} from './campaign-manifest.js';
import { createRandom } from './random.js';

export const PHASE_LAB_STORAGE_KEY = 'miguelito:phase-lab:v4';
export const PHASE_LAB_MAX_RESOURCES = 100;

const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function isPhaseLabEnabled(locationLike = globalThis.location) {
  try {
    return new URLSearchParams(locationLike?.search || '').get('phaseLab') === '1';
  } catch (_) {
    return false;
  }
}

export function productionPhaseManifest(phase) {
  return campaignManifest.find(entry => entry.phase === Number(phase)) || null;
}

export function scalePhaseLabSegments(segments, oldTotal, newTotal) {
  const source = clone(segments || []);
  if (!source.length || oldTotal === newTotal) return source;
  const ratio = (newTotal - 1) / Math.max(1, oldTotal - 1);
  return source.map((segment, index) => {
    const next = source[index + 1];
    const from = index === 0 ? 0 : clamp(Math.round(segment.from * ratio), 0, newTotal - 1);
    const to = next
      ? clamp(Math.round(next.from * ratio) - 1, from, newTotal - 1)
      : newTotal - 1;
    return { ...segment, from, to };
  });
}

export function createDefaultPhaseLabConfig(phase = 1) {
  const base = productionPhaseManifest(phase) || productionPhaseManifest(1);
  const phaseOrganisms = [...new Set(
    base.presentations
      .flatMap(presentation => presentation.roamingTypes || [presentation.roamingType])
      .filter(Boolean),
  )];
  return {
    phase: base.phase,
    seed: `phase-lab-${base.phase}`,
    totalChunks: base.totalChunks,
    title: base.title,
    theme: base.theme,
    mission: base.mission,
    segments: clone(base.segments),
    // O ensaio nasce somente com os organismos que participam da mec??nica
    // nova da fase. Organismos j?? conhecidos continuam dispon??veis no
    // seletor, mas n??o invadem o teste focado por padr??o.
    allowedOrganisms: phaseOrganisms.length
      ? phaseOrganisms
      : getProceduralPoolAt(base.phase, 0).filter(type => (
          base.presentations.some(presentation => presentation.roamingType === type)
        )),
    allowedPathogens: base.pathogenDebuts.map(entry => entry.pathogen)
      .filter(type => !MVP_EXCLUDED_PATHOGENS.includes(type)),
    resources: {
      exudates: null,
      crystals: null,
      checkpoints: null,
    },
    nitrogenRoot: {
      ...(base.nitrogenRoot || NITROGEN_ROOT_DEFAULTS),
      // O laborat??rio abre cada fase focado em sua mec??nica nova. A raiz de
      // FBN continua dispon??vel manualmente nas fases posteriores, mas n??o
      // antecede por padr??o o ensaio da escada de Azospirillum na Fase 3.
      enabled: base.phase === 2
        && (base.nitrogenRoot?.enabled ?? NITROGEN_ROOT_DEFAULTS.enabled),
    },
    azospirillumRootLadder: {
      ...(base.azospirillumRootLadder || AZOSPIRILLUM_ROOT_LADDER_DEFAULTS),
      // A Fase 4 fica reservada ?? estreia da micorriza. Da Fase 5 em diante,
      // a habilidade j?? aprendida pode responder a desn??veis naturais, sem
      // criar nem deslocar plataformas para for??ar uma recapitula????o.
      enabled: base.phase === 3
        ? (base.azospirillumRootLadder?.enabled ?? true)
        : base.phase >= 5,
      knownSkill: base.phase >= 5,
      preserveDestinationHeight: base.phase >= 5,
    },
    azospirillumNitrogen: {
      ...(base.azospirillumNitrogen || AZOSPIRILLUM_NITROGEN_DEFAULTS),
    },
    mycorrhizaBridge: {
      ...(base.mycorrhizaBridge || MYCORRHIZA_BRIDGE_DEFAULTS),
    },
    opportunisticFungus: {
      ...(base.opportunisticFungus || OPPORTUNISTIC_FUNGUS_DEFAULTS),
    },
    pseudomonasIronControl: {
      ...(base.pseudomonasIronControl || PSEUDOMONAS_IRON_CONTROL_DEFAULTS),
    },
    phosphateSolubilization: {
      ...(base.phosphateSolubilization || PHOSPHATE_SOLUBILIZATION_DEFAULTS),
    },
    meloidogyne: {
      ...(base.meloidogyne || MELOIDOGYNE_DEFAULTS),
    },
    ralstonia: {
      ...(base.ralstonia || RALSTONIA_DEFAULTS),
    },
    finalGoal: base.finalTest.goal,
    finalConditions: clone(base.finalTest.requires),
  };
}

function remapToSegment(value, oldSegment, newSegment, maxChunk) {
  if (!newSegment) return clamp(value, 0, maxChunk);
  if (!oldSegment || oldSegment.to === oldSegment.from) return newSegment.from;
  const progress = clamp((value - oldSegment.from) / (oldSegment.to - oldSegment.from), 0, 1);
  return clamp(Math.round(newSegment.from + progress * (newSegment.to - newSegment.from)), 0, maxChunk);
}

function normalizeResourceCount(value) {
  if (value === null || value === '' || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? clamp(Math.round(number), 0, PHASE_LAB_MAX_RESOURCES) : null;
}

export function buildPhaseLabManifest(config) {
  const base = productionPhaseManifest(config?.phase);
  if (!base) throw new RangeError(`Fase inexistente: ${config?.phase}.`);
  const totalChunks = clamp(Math.round(Number(config.totalChunks) || base.totalChunks), 3, 120);
  const segments = clone(config.segments || base.segments);
  const oldSegments = new Map(base.segments.map(segment => [segment.id, segment]));
  const newSegments = new Map(segments.map(segment => [segment.id, segment]));
  const maxChunk = totalChunks - 1;
  const presentations = base.presentations.map(presentation => {
    const oldSegment = oldSegments.get(presentation.moduleId);
    const newSegment = newSegments.get(presentation.moduleId);
    let debutChunk = remapToSegment(presentation.debutChunk, oldSegment, newSegment, maxChunk);
    const next = { ...clone(presentation), debutChunk };
    if (Number.isInteger(presentation.poolFromChunk)) {
      debutChunk = Math.min(debutChunk, Math.max(0, maxChunk - 1));
      next.debutChunk = debutChunk;
      const globallyMapped = Math.round(presentation.poolFromChunk * maxChunk / Math.max(1, base.totalChunks - 1));
      next.poolFromChunk = clamp(Math.max(debutChunk + 1, globallyMapped), 0, maxChunk);
    }
    return next;
  });
  const unlockEvents = base.unlockEvents.map(event => ({
    ...clone(event),
    eventChunk: remapToSegment(
      event.eventChunk,
      oldSegments.get(event.afterModule),
      newSegments.get(event.afterModule),
      maxChunk,
    ),
  }));
  const pathogenDebuts = base.pathogenDebuts.map(debut => ({
    ...clone(debut),
    fromChunk: clamp(Math.round(debut.fromChunk * maxChunk / Math.max(1, base.totalChunks - 1)), 0, maxChunk),
  }));
  const allowedOrganisms = [...new Set(config.allowedOrganisms || [])]
    .filter(type => ECOLOGY_ROAMING_TYPES.includes(type));
  const allowedPathogens = [...new Set(config.allowedPathogens || [])]
    .filter(type => PATHOGEN_SYSTEMS.includes(type) && !MVP_EXCLUDED_PATHOGENS.includes(type));
  const nitrogenRootInput = config.nitrogenRoot || base.nitrogenRoot || NITROGEN_ROOT_DEFAULTS;
  const nitrogenRoot = {
    ...(base.nitrogenRoot || NITROGEN_ROOT_DEFAULTS),
    enabled: base.phase >= 2 && Boolean(nitrogenRootInput.enabled),
    count: clamp(Math.round(Number(nitrogenRootInput.count) || 0), 0, 8),
    requiredFixationRate: Number(nitrogenRootInput.requiredFixationRate),
    growthDurationSeconds: Number(nitrogenRootInput.growthDurationSeconds),
  };
  const ladderInput = config.azospirillumRootLadder
    || base.azospirillumRootLadder
    || AZOSPIRILLUM_ROOT_LADDER_DEFAULTS;
  const azospirillumRootLadder = {
    ...(base.azospirillumRootLadder || AZOSPIRILLUM_ROOT_LADDER_DEFAULTS),
    enabled: base.phase >= 3 && Boolean(ladderInput.enabled),
    count: clamp(Math.round(Number(ladderInput.count) || 0), 0, 8),
    stepCount: clamp(Math.round(Number(ladderInput.stepCount) || 0), 2, 10),
    verticalSpacing: clamp(Number(ladderInput.verticalSpacing), 45, 110),
    growthDurationSeconds: Number(ladderInput.growthDurationSeconds),
    knownSkill: Boolean(ladderInput.knownSkill || base.phase >= 5),
    preserveDestinationHeight: Boolean(ladderInput.preserveDestinationHeight || base.phase >= 5),
  };
  const nitrogenInput = config.azospirillumNitrogen
    || base.azospirillumNitrogen
    || AZOSPIRILLUM_NITROGEN_DEFAULTS;
  const azospirillumNitrogen = {
    associativeRate: Number(nitrogenInput.associativeRate),
    rhizobiumSynergyMultiplier: Number(nitrogenInput.rhizobiumSynergyMultiplier),
  };
  const bridgeInput = config.mycorrhizaBridge
    || base.mycorrhizaBridge
    || MYCORRHIZA_BRIDGE_DEFAULTS;
  const mycorrhizaBridge = {
    ...(base.mycorrhizaBridge || MYCORRHIZA_BRIDGE_DEFAULTS),
    horizontalOnly: Boolean(bridgeInput.horizontalOnly),
  };
  const fungusInput = config.opportunisticFungus
    || base.opportunisticFungus
    || OPPORTUNISTIC_FUNGUS_DEFAULTS;
  const opportunisticFungus = Object.fromEntries(
    Object.keys(OPPORTUNISTIC_FUNGUS_DEFAULTS).map(key => [key, Number(fungusInput[key])]),
  );
  const ironInput = config.pseudomonasIronControl
    || base.pseudomonasIronControl
    || PSEUDOMONAS_IRON_CONTROL_DEFAULTS;
  const pseudomonasIronControl = Object.fromEntries(
    Object.keys(PSEUDOMONAS_IRON_CONTROL_DEFAULTS).map(key => [key, Number(ironInput[key])]),
  );
  const phosphateInput = config.phosphateSolubilization
    || base.phosphateSolubilization
    || PHOSPHATE_SOLUBILIZATION_DEFAULTS;
  const phosphateSolubilization = Object.fromEntries(
    Object.keys(PHOSPHATE_SOLUBILIZATION_DEFAULTS).map(key => [key, Number(phosphateInput[key])]),
  );
  // A pressao do nematoide e o coracao da fase 8: precisa ser calibravel aqui.
  const meloidogyneInput = config.meloidogyne || base.meloidogyne || MELOIDOGYNE_DEFAULTS;
  const meloidogyne = Object.fromEntries(
    Object.keys(MELOIDOGYNE_DEFAULTS).map(key => [key, Number(meloidogyneInput[key])]),
  );

  // A doenca vascular e o coracao da fase 9: precisa ser calibravel aqui.
  const ralstoniaInput = config.ralstonia || base.ralstonia || RALSTONIA_DEFAULTS;
  const ralstonia = Object.fromEntries(
    Object.keys(RALSTONIA_DEFAULTS).map(key => [
      key,
      typeof RALSTONIA_DEFAULTS[key] === 'boolean'
        ? Boolean(ralstoniaInput[key])
        : Number.isFinite(Number(ralstoniaInput[key]))
          ? Number(ralstoniaInput[key])
          : RALSTONIA_DEFAULTS[key],
    ]),
  );

  return {
    ...clone(base),
    totalChunks,
    title: String(config.title || base.title).trim(),
    theme: String(config.theme || base.theme).trim(),
    mission: String(config.mission || base.mission).trim(),
    segments,
    presentations,
    unlockEvents,
    pathogenDebuts,
    nitrogenRoot,
    azospirillumRootLadder,
    azospirillumNitrogen,
    mycorrhizaBridge,
    opportunisticFungus,
    pseudomonasIronControl,
    phosphateSolubilization,
    meloidogyne,
    ralstonia,
    finalTest: {
      ...clone(base.finalTest),
      goal: String(config.finalGoal || base.finalTest.goal).trim(),
      requires: clone(config.finalConditions || base.finalTest.requires).map(condition => (
        base.phase === 5 && condition.key === 'pseudomonasIronReserve'
          ? { ...condition, value: pseudomonasIronControl.minimumIronReserve }
          : base.phase === 5 && condition.key === 'opportunisticFungusVigor'
            ? { ...condition, value: pseudomonasIronControl.minimumFungalVigor }
            : condition
      )),
    },
    phaseLab: {
      seed: String(config.seed || `phase-lab-${base.phase}`),
      allowedOrganisms,
      allowedPathogens,
      resources: {
        exudates: normalizeResourceCount(config.resources?.exudates),
        crystals: normalizeResourceCount(config.resources?.crystals),
        checkpoints: normalizeResourceCount(config.resources?.checkpoints),
      },
    },
  };
}

export function validatePhaseLabConfig(config) {
  const errors = [];
  let phaseManifest = null;
  try {
    phaseManifest = buildPhaseLabManifest(config);
  } catch (error) {
    return { valid: false, errors: [error.message], manifest: null };
  }
  const manifest = campaignManifest.map(entry => entry.phase === phaseManifest.phase ? phaseManifest : entry);
  errors.push(...validateCampaignManifest({ manifest }));
  for (const [name, value] of Object.entries(phaseManifest.phaseLab.resources)) {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > PHASE_LAB_MAX_RESOURCES)) {
      errors.push(`Quantidade invalida para o recurso ${name}.`);
    }
  }
  return { valid: errors.length === 0, errors, manifest: phaseManifest };
}

function routePlatforms(level) {
  return (level.platforms || []).filter(platform => !platform.recovery && !platform.final);
}

function distributedPlatform(platforms, index, count, rnd) {
  if (!platforms.length) return null;
  const bucket = Math.floor(index * platforms.length / Math.max(1, count));
  const span = Math.max(1, Math.ceil(platforms.length / Math.max(1, count)));
  return platforms[Math.min(platforms.length - 1, bucket + Math.floor(rnd() * span))];
}

export function applyPhaseLabResources(level, phaseManifest, seedValue) {
  const resources = phaseManifest?.phaseLab?.resources;
  if (!resources) return level;
  const platforms = routePlatforms(level);
  const rnd = createRandom(`${seedValue}:phase-lab-resources`);

  if (resources.exudates !== null) {
    level.exudates = Array.from({ length: resources.exudates }, (_, index) => {
      const platform = distributedPlatform(platforms, index, resources.exudates, rnd);
      return {
        logicIndex: platform?.logicIndex ?? -1,
        x: (platform?.x || 100) + 30 + rnd() * Math.max(1, (platform?.w || 120) - 60),
        y: (platform?.y || 500) - 28 - rnd() * 14,
        taken: false,
      };
    });
  }
  if (resources.checkpoints !== null) {
    level.checkpoints = Array.from({ length: resources.checkpoints }, (_, index) => {
      const platform = distributedPlatform(platforms, index, resources.checkpoints, rnd);
      return {
        x: (platform?.x || 100) + (platform?.w || 120) / 2,
        y: (platform?.y || 500) - 10,
        active: false,
      };
    });
  }
  if (resources.crystals !== null) {
    level.crystals = Array.from({ length: resources.crystals }, (_, index) => {
      const platform = distributedPlatform(platforms.slice(1), index, resources.crystals, rnd) || platforms[0];
      const width = 56;
      const height = 110;
      return {
        logicIndex: platform?.logicIndex ?? -1,
        requiredFeature: 'phosphateSolubilization',
        phosphateDeposit: true,
        remainingPhosphate: 1,
        initialPhosphate: 1,
        x: (platform?.x || 160) + Math.max(5, (platform?.w || 140) - width - 5),
        y: (platform?.y || 500) - height,
        w: width,
        h: height,
        hp: 1,
        broken: false,
      };
    });
  }
  return level;
}
