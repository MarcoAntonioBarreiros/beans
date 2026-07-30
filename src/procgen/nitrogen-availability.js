import {
  getPhaseManifest,
  NITROGEN_AVAILABILITY_DEFAULTS,
} from './campaign-manifest.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function phaseConfig(state) {
  const phase = state?.campaign?.phase ?? state?.level?.campaignPhase;
  return {
    ...NITROGEN_AVAILABILITY_DEFAULTS,
    ...(getPhaseManifest(phase)?.nitrogenAvailability || {}),
  };
}

function activeAzospirillum(colony) {
  return Boolean(
    colony?.type === 'azospirillum'
    && colony.platform?.type === 'root'
    && (colony.growth ?? 0) >= 0.68
    && (colony.vigor ?? 0) > 0.05
    && colony.dormant !== true,
  );
}

function activeRhizobiumColony(colony) {
  return Boolean(
    colony?.type === 'rhizobium'
    && colony.platform?.type === 'root'
    && (colony.growth ?? 0) >= 0.68
    && (colony.vigor ?? 0) > 0.045
    && colony.dormant !== true,
  );
}

function currentColonies(state) {
  return state?.beneficialInoculants?.colonies
    || state?.level?.beneficialColonies
    || [];
}

function linkedFunctionalRhizobium(site, colonies) {
  const linked = site?.colony;
  if (!linked) return null;
  const current = colonies.find(colony => (
    colony === linked
    || (linked.id != null && colony?.id === linked.id)
  ));
  return activeRhizobiumColony(current) ? current : null;
}

export function getNitrogenAvailability({
  state,
  azospirillumNitrogen = state?.azospirillumNitrogen,
} = {}) {
  const config = phaseConfig(state);
  const colonies = currentColonies(state);
  const activeAzo = colonies.filter(activeAzospirillum);
  const associativeRaw = activeAzo.reduce((sum, colony) => {
    const storedRate = Number(colony.associativeNitrogenRate);
    if (Number.isFinite(storedRate) && storedRate > 0) return sum + storedRate;
    // O agregado do runtime continua sendo aceito somente como fallback para o
    // primeiro quadro após restaurar um estado antigo sem taxa por colônia.
    return sum;
  }, 0);
  const fallbackAssociative = activeAzo.length && associativeRaw <= 0
    ? Math.max(0, Number(azospirillumNitrogen?.associativeNitrogenRate) || 0)
    : associativeRaw;

  const activeSites = (state?.level?.rhizobiumNodules || []).filter(site => (
    Boolean(site?.mature || site?.stage === 'mature-nodule')
    && (Number(site?.fixationRate) || 0) > 0
    && linkedFunctionalRhizobium(site, colonies)
  ));
  const symbioticRaw = activeSites.reduce(
    (sum, site) => sum + Math.max(0, Number(site.fixationRate) || 0),
    0,
  );

  // Preserva a escala histórica (taxa / 5) e acrescenta somente o teto exigido
  // para a contribuição associativa. A sinergia já está em fixationRate.
  const associativeFractionPerReference = (
    config.associativeReferenceRate / config.symbioticReferenceRate
  );
  const associativeFraction = Math.min(
    config.maximumAssociativeFraction,
    (fallbackAssociative / config.associativeReferenceRate)
      * associativeFractionPerReference,
  );
  const symbioticFraction = clamp(
    symbioticRaw / config.symbioticReferenceRate,
    0,
    1,
  );
  const totalFraction = clamp(associativeFraction + symbioticFraction, 0, 1);

  return {
    associativeRaw: fallbackAssociative,
    symbioticRaw,
    associativeFraction,
    symbioticFraction,
    totalFraction,
    percent: totalFraction * 100,
    activeAzospirillumColonies: activeAzo.length,
    activeNodules: activeSites.length,
  };
}
