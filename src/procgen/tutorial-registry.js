import { gameplayTutorialCards } from './tutorial-cards-gameplay.js';
import { organismTutorialCards } from './tutorial-cards-organisms.js';
import { structureTutorialCards } from './tutorial-cards-structures.js';

export const tutorialCards = Object.freeze({
  ...gameplayTutorialCards,
  ...organismTutorialCards,
  ...structureTutorialCards,
});

export const tutorialCardIds = Object.freeze(Object.keys(tutorialCards));

export function getTutorialCard(id) {
  return tutorialCards[id] || null;
}
