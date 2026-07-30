import { getActiveCampaignManifest } from './campaign-manifest.js';

// Um cartão apresentado numa fase anterior já foi ensinado. Quando a campanha
// começa direto numa fase adiantada — pelo Phase Lab ou por uma retomada — esse
// conhecimento precisa nascer registrado, do mesmo modo que
// getPersistentUnlocksBeforePhase devolve os poderes já conquistados. Sem isso o
// pool procedural da fase reapresenta Bacillus e Rhizobium como se fossem
// inéditos, e quanto mais curta a fase mais os cartões antigos dominam a cena.
//
// Isto não alcança os organismos que estreiam na fase atual: uma estreia
// continua sendo apresentada na primeira aparição, sem espera.
export function getCardsTaughtBeforePhase(phase) {
  const limit = Number(phase);
  if (!Number.isInteger(limit)) return [];

  const cards = new Set();
  for (const entry of getActiveCampaignManifest()) {
    if (!Number.isInteger(entry.phase) || entry.phase >= limit) continue;
    for (const presentation of entry.presentations || []) {
      if (presentation.cardId) cards.add(presentation.cardId);
    }
  }
  return [...cards];
}
