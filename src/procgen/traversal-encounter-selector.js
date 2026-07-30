import { getPhaseManifest } from './campaign-manifest.js';
import { createRandom } from './random.js';

const MIN_SPACING = 5;

function reservedByAuthor(chunk) {
  return Boolean(
    chunk.isSkillIntro
    || chunk.allyId
    || chunk.isCheckpoint
    || chunk.isPathogenDebut
    || chunk.hasEnemy
    || chunk.unlockFeature
    || chunk.reservedByAuthor
    || chunk.reservedByTraversalEncounter
  );
}

function eligibleChunks(logic, manifest) {
  const integrated = manifest?.segments?.find(segment => segment.id === 'p10-integrated');
  if (!integrated) return [];
  const lastAllowed = Math.min(integrated.to, logic.length - 5);
  return logic.filter(chunk => (
    chunk.index >= Math.max(5, integrated.from)
    && chunk.index <= lastAllowed
    && !reservedByAuthor(chunk)
  ));
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function clearanceFromProtectedChunks(logic, chunkIndex) {
  let left = chunkIndex - 5;
  let right = logic.length - 4 - chunkIndex;
  for (let index = chunkIndex - 1; index >= 5; index--) {
    if (!reservedByAuthor(logic[index])) continue;
    left = chunkIndex - index - 1;
    break;
  }
  for (let index = chunkIndex + 1; index <= logic.length - 5; index++) {
    if (!reservedByAuthor(logic[index])) continue;
    right = index - chunkIndex - 1;
    break;
  }
  return Math.max(0, Math.min(left, right));
}

export function selectTraversalEncounters({
  logic,
  phase,
  seedValue,
  suppressTowerSafeFall = false,
}) {
  const stats = {
    planned: 0,
    created: 0,
    fallbacks: 0,
    rejected: 0,
    reasons: {},
    minimumSpacing: null,
    towerSuppressedForOptionalDetourPlaytest: false,
  };
  if (phase !== 10) return { plans: [], stats };
  if (suppressTowerSafeFall) {
    stats.towerSuppressedForOptionalDetourPlaytest = true;
    return { plans: [], stats };
  }

  const manifest = getPhaseManifest(phase);
  const candidates = eligibleChunks(logic, manifest);
  if (candidates.length < 2) {
    stats.rejected = 2;
    stats.reasons.insufficientEligibleChunks = 2;
    return { plans: [], stats };
  }

  const random = createRandom(`${seedValue}:traversal-encounters:p${phase}`);
  const shuffled = shuffle(candidates, random);
  let pair = null;
  for (let left = 0; left < shuffled.length && !pair; left++) {
    for (let right = left + 1; right < shuffled.length; right++) {
      if (Math.abs(shuffled[left].index - shuffled[right].index) < MIN_SPACING) continue;
      pair = [shuffled[left], shuffled[right]].sort((a, b) => a.index - b.index);
      break;
    }
  }
  if (!pair) {
    stats.rejected = 2;
    stats.reasons.minimumSpacingUnavailable = 2;
    return { plans: [], stats };
  }

  // Preserva exatamente a escolha determinística da torre feita pelo seletor
  // anterior: o sorteio decidia em qual membro do par ela ficava. O outro
  // membro recebia o fork simétrico; agora simplesmente permanece disponível
  // para a rota procedural normal.
  const towerPairIndex = random() < .5 ? 1 : 0;
  const chunk = pair[towerPairIndex];
  const templateId = 'tower-safe-fall-01';
  chunk.traversalEncounterId = templateId;
  chunk.reservedByTraversalEncounter = true;
  const plans = [{
    templateId,
    logicIndex: chunk.index,
    encounterInstanceId: `p${phase}-${templateId}-${chunk.index}`,
    templateSeed: `${seedValue}:p${phase}:${templateId}:${chunk.index}`,
  }];
  stats.planned = plans.length;
  stats.minimumSpacing = Math.abs(pair[1].index - pair[0].index);
  return { plans, stats };
}
