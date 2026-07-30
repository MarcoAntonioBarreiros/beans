function platformAt(level, chunk) {
  return (level.platforms || []).find(platform => (
    !platform.recovery && !platform.final && platform.logicIndex === chunk
  ));
}

function configureIntroRoute(level) {
  const route = [0, 1, 2, 3].map(chunk => platformAt(level, chunk));
  if (route.some(platform => !platform)) return;

  const widths = [220, 240, 180, 220];
  const heights = [470, 458, 446, 454];
  route.forEach((platform, index) => {
    platform.type = 'root';
    platform.w = Math.max(platform.w, widths[index]);
    platform.h = Math.max(platform.h || 0, 68);
    platform.y = heights[index];
    platform.authoredPhaseSixIntro = true;
    if (index > 0) {
      const previous = route[index - 1];
      platform.x = previous.x + previous.w + 72;
    }
  });
}

function installRecruitmentExudate(level) {
  const host = platformAt(level, 2);
  if (!host) return;
  level.exudates = (level.exudates || []).filter(exudate => (
    !Number.isInteger(exudate.logicIndex) || exudate.logicIndex > 3
  ));
  level.exudates.push({
    id: 'p6-trichoderma-recruitment-exudate',
    logicIndex: 2,
    x: host.x + host.w * .52,
    y: host.y - 34,
    taken: false,
    authored: true,
    authoredPhaseSixIntro: true,
  });
}

export function applyPhaseSixTutorialGeometry(level, phase = level.campaignPhase) {
  if (phase !== 6) return level;
  configureIntroRoute(level);
  installRecruitmentExudate(level);

  // A abertura usa um único foco, o de estreia. Focos procedurais voltam a
  // aparecer normalmente no trecho de prática a partir do chunk 11.
  level.enemies = (level.enemies || []).filter(enemy => (
    enemy.logicIndex >= 11
    || (enemy.type === 'rhizoctonia' && enemy.logicIndex === 1 && enemy.debut)
  ));
  level.phaseSixTutorial = {
    rhizoctoniaChunk: 1,
    exudateChunk: 2,
    trichodermaChunk: 3,
    proceduralResumeChunk: 11,
  };
  return level;
}

export function applyPhaseSixTutorialEncounters(level, encounters, phase = level.campaignPhase) {
  if (phase !== 6) return encounters;
  const result = (encounters || []).filter(encounter => (
    encounter.logicIndex >= 11
    || (
      encounter.source === 'debut'
      && encounter.id === 'trichoderma'
      && encounter.logicIndex === 3
    )
  ));
  const debut = result.find(encounter => (
    encounter.source === 'debut' && encounter.id === 'trichoderma'
  ));
  const host = platformAt(level, 3);
  if (debut && host) {
    debut.x = host.x + host.w / 2;
    debut.y = host.y - 104;
    debut.r = 145;
    debut.territory = 320;
    debut.authoredPhaseSixIntro = true;
  }
  return result;
}
