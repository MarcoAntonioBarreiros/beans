import { createRandom } from './random.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function platformAt(level, chunk) {
  return (level.platforms || []).find(platform => (
    !platform.recovery && !platform.final && platform.logicIndex === chunk
  ));
}

function addExudate(level, chunk, lateral = .5) {
  const platform = platformAt(level, chunk);
  if (!platform) return;
  const duplicate = (level.exudates || []).some(item => item.logicIndex === chunk);
  if (duplicate) return;
  level.exudates.push({
    logicIndex: chunk,
    x: platform.x + platform.w * lateral,
    y: platform.y - 34,
    taken: false,
    authored: true,
  });
}

export function applyPhaseFiveTutorialGeometry(level, phase = level.campaignPhase) {
  if (phase !== 5) return level;
  const route = (level.platforms || [])
    .filter(platform => !platform.recovery && !platform.final && platform.logicIndex >= 0)
    .sort((a, b) => a.logicIndex - b.logicIndex || a.x - b.x);

  for (const platform of route) {
    platform.type = 'root';
    platform.authoredPhaseFive = true;
    platform.h = Math.max(64, platform.h || 0);
    if (platform.logicIndex <= 14) {
      platform.y = clamp(455 + Math.sin(platform.logicIndex * .72) * 34, 405, 515);
      platform.w = Math.max(platform.w, 190);
    }
  }

  // Corredor final curto: sem a limitação por ferro, a rede hifal alcança
  // Miguelito durante a travessia; com Pseudomonas, o mesmo percurso é controlável.
  const corridor = [15, 16, 17, 18, 19].map(chunk => platformAt(level, chunk)).filter(Boolean);
  corridor.forEach((platform, index) => {
    platform.y = index < 3 ? 470 - index * 18 : 442 + (index - 3) * 12;
    platform.w = index === 1 ? 210 : index < 3 ? 185 : 220;
    platform.fungalChallenge = index < 3;
    if (index === 0) {
      const previous = platformAt(level, 14);
      if (previous) platform.x = previous.x + previous.w + 110;
    } else {
      const previous = corridor[index - 1];
      platform.x = previous.x + previous.w + (index < 3 ? 148 : 92);
    }
  });

  level.exudates = (level.exudates || []).filter(item => item.logicIndex < 18);
  addExudate(level, 7, .55);
  addExudate(level, 9, .42);
  addExudate(level, 12, .5);
  addExudate(level, 13, .48);
  addExudate(level, 15, .38);

  const ironHost = platformAt(level, 8) || platformAt(level, 9);
  const interactionHost = platformAt(level, 13);
  const challengeHost = platformAt(level, 15);
  level.ironDeposits = [];
  const ironSlots = [
    { platform: ironHost, lateral: .54 },
    // O ferro do ensaio de interacao ocupa a mesma raiz e a mesma regiao do
    // foco fungico e da colonia de Pseudomonas. Nao pode depender de Azo,
    // micorriza ou de uma plataforma elevada para ser alcançado.
    { platform: interactionHost, lateral: .52 },
    { platform: challengeHost, lateral: .54 },
  ].filter(slot => slot.platform);
  for (const [index, { platform, lateral }] of ironSlots.entries()) {
    level.ironDeposits.push({
      id: `p5-authored-iron-${index}`,
      platform,
      x: platform.x + platform.w * lateral,
      y: platform.y + 28,
      stock: 7,
      maxStock: 7,
      radius: 13,
      phase: index * 1.7,
      exposed: true,
      authored: true,
    });
  }
  return level;
}

function encounterAt(level, chunk, id, source, seedValue, options = {}) {
  const platform = platformAt(level, chunk);
  if (!platform) return null;
  const random = createRandom(`${seedValue}:phase-five:${chunk}:${id}:${source}`);
  return {
    id,
    x: platform.x + platform.w * (
      Number.isFinite(options.lateral)
        ? options.lateral
        : .46 + (random() - .5) * .08
    ),
    y: platform.y - 94 - random() * 16,
    r: options.r || 150,
    territory: options.territory || 360,
    collect: false,
    logicIndex: chunk,
    source,
    requiresSeenCardId: options.requiresSeenCardId || null,
    tetherUntilSeen: false,
    authoredPhaseFive: true,
  };
}

export function applyPhaseFiveTutorialEncounters(level, encounters, phase, seedValue) {
  if (phase !== 5) return encounters;
  // Mantém apenas as duas estreias curriculares; repetições autorais abaixo
  // demonstram a interação sem ruído de comunidades procedurais extras.
  const result = encounters.filter(encounter => (
    encounter.source === 'debut'
    || !['oportunista', 'pseudomonas', 'trichoderma'].includes(encounter.id)
  ));
  const interactionSupport = encounterAt(level, 13, 'pseudomonas', 'interaction-support', seedValue, {
    r: 118,
    territory: 210,
    lateral: .52,
    requiresSeenCardId: 'organism-pseudomonas',
  });
  const interaction = encounterAt(level, 13, 'oportunista', 'interaction', seedValue, {
    r: 125,
    territory: 250,
    lateral: .52,
    requiresSeenCardId: 'organism-opportunistic-fungus',
  });
  const challenge = encounterAt(level, 16, 'oportunista', 'challenge', seedValue, {
    r: 170,
    territory: 310,
    lateral: .5,
    requiresSeenCardId: 'organism-opportunistic-fungus',
  });
  if (interactionSupport) result.push(interactionSupport);
  if (interaction) result.push(interaction);
  if (challenge) result.push(challenge);
  level.authoredEncounters = [
    interactionSupport,
    interaction,
    challenge,
  ].filter(Boolean);
  return result;
}
