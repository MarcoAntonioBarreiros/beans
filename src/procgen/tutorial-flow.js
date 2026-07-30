import {
  getActiveCampaignManifest,
  getPresentationById,
  getSegmentAt,
  tutorialPacing,
} from './campaign-manifest.js';
import { getTutorialCard } from './tutorial-registry.js';

function findPresentation(triggerId) {
  for (const phase of getActiveCampaignManifest()) {
    const presentation = phase.presentations.find(entry => entry.triggerIds.includes(triggerId));
    if (presentation) return { phase: phase.phase, presentation };
  }
  return { phase: null, presentation: null };
}

function allPageIndexes(card) {
  return card.pages.map((_, index) => index);
}

function pageIndexesForTrigger(card, presentation, triggerId) {
  if (!presentation?.pageUnlocks) return allPageIndexes(card);
  return presentation.pageUnlocks.find(entry => entry.triggerId === triggerId)?.pages || [];
}

function normalizePages(source = {}) {
  const pages = new Map();
  for (const [cardId, indexes] of Object.entries(source || {})) {
    const card = getTutorialCard(cardId);
    if (!card || !Array.isArray(indexes)) continue;
    const valid = indexes.filter(index => Number.isInteger(index) && index >= 0 && index < card.pages.length);
    if (valid.length) pages.set(cardId, new Set(valid));
  }
  return pages;
}

function minimumSpatialDistance(visibleWorldWidth) {
  const width = Number.isFinite(visibleWorldWidth) ? visibleWorldWidth : 0;
  return Math.max(
    tutorialPacing.minimumWorldDistance,
    width * tutorialPacing.distanceViewportFactor,
  );
}

export function createTutorialFlow({ seen = [], unlocked = [], pages = {} } = {}) {
  const seenCards = new Set(seen.filter(id => getTutorialCard(id)));
  const unlockedCards = new Set(unlocked.filter(id => getTutorialCard(id)));
  const unlockedPages = normalizePages(pages);
  let lastAutomaticPresentation = null;

  for (const cardId of unlockedPages.keys()) unlockedCards.add(cardId);

  function pagesFor(cardId) {
    const card = getTutorialCard(cardId);
    if (!card) return [];
    const indexes = unlockedPages.get(cardId);
    if (indexes?.size) return [...indexes].sort((a, b) => a - b);
    return unlockedCards.has(cardId) ? allPageIndexes(card) : [];
  }

  function reveal(cardId, indexes) {
    const card = getTutorialCard(cardId);
    if (!card) return [];
    const target = unlockedPages.get(cardId) || new Set();
    const added = [];
    for (const index of indexes) {
      if (!Number.isInteger(index) || index < 0 || index >= card.pages.length || target.has(index)) continue;
      target.add(index);
      added.push(index);
    }
    if (target.size) unlockedPages.set(cardId, target);
    unlockedCards.add(cardId);
    return added;
  }

  function revealAll(cardId) {
    const card = getTutorialCard(cardId);
    return card ? reveal(cardId, allPageIndexes(card)) : [];
  }

  function prerequisitesMet(presentation) {
    return (presentation?.prerequisitePresentationIds || []).every(id => {
      const prerequisite = getPresentationById(id);
      return prerequisite && seenCards.has(prerequisite.cardId);
    });
  }

  function diagnoseUnexpectedFirstAppearance(expectedPhase, presentation, context) {
    if (!presentation || !Number.isInteger(context.phase) || !Number.isInteger(context.chunkIndex)) return null;
    const segment = getSegmentAt(context.phase, context.chunkIndex);
    if (context.phase === expectedPhase && segment?.id === presentation.moduleId) return null;
    return {
      phase: context.phase,
      chunkIndex: context.chunkIndex,
      expectedPhase,
      expectedModuleId: presentation.moduleId,
      actualModuleId: segment?.id || null,
      presentationId: presentation.id,
      cardId: presentation.cardId,
      organismType: context.organismType || null,
      worldX: Number.isFinite(context.worldX) ? context.worldX : null,
      source: context.organismSource || null,
    };
  }

  function spatialGate(context) {
    if (!lastAutomaticPresentation) return { allowed: true, distance: Infinity, elapsed: Infinity };
    const worldX = Number.isFinite(context.worldX) ? context.worldX : lastAutomaticPresentation.worldX;
    const nowSeconds = Number.isFinite(context.nowSeconds) ? context.nowSeconds : lastAutomaticPresentation.at;
    const distance = Math.abs(worldX - lastAutomaticPresentation.worldX);
    const elapsed = Math.max(0, nowSeconds - lastAutomaticPresentation.at);
    return {
      allowed: distance >= minimumSpatialDistance(context.visibleWorldWidth)
        || elapsed >= tutorialPacing.fallbackSeconds,
      distance,
      elapsed,
    };
  }

  function handle(triggerId, context = {}) {
    const { phase: expectedPhase, presentation } = findPresentation(triggerId);
    const cardId = presentation?.cardId || triggerId;
    const card = getTutorialCard(cardId);
    if (!card) return { handled: false, open: false, reason: 'unknown-card', cardId };

    const force = context.force === true;
    const tutorialMode = context.tutorialMode || 'guided';
    const isPrimaryTrigger = !presentation || triggerId === presentation.autoOpenTrigger;
    const mandatoryFirstAppearance = Boolean(
      presentation?.policy === 'mandatory-first-appearance'
      && isPrimaryTrigger
      && context.source === tutorialPacing.firstAppearanceEvent
      && !seenCards.has(cardId)
    );

    if (tutorialMode === 'disabled' && !force) {
      return { handled: false, open: false, reason: 'disabled', cardId };
    }
    if (!force && !prerequisitesMet(presentation)) {
      return { handled: false, open: false, reason: 'prerequisite', cardId };
    }

    const pagesAdded = reveal(cardId, pageIndexesForTrigger(card, presentation, triggerId));
    const alreadySeen = seenCards.has(cardId);
    let open = false;
    let reason = pagesAdded.length ? 'guide-updated' : 'already-recorded';

    if (context.panelOpen) {
      reason = 'panel-open';
    } else if (force) {
      open = true;
      reason = 'forced';
    } else if (!isPrimaryTrigger) {
      if (presentation?.derivedTriggerBehavior === 'open-in-guided'
        && tutorialMode === 'guided'
        && !alreadySeen) {
        open = true;
        reason = 'derived-guided';
      } else {
        reason = 'guide-only';
      }
    } else if (presentation?.policy === 'mandatory-first-appearance') {
      if (mandatoryFirstAppearance) {
        open = true;
        reason = 'mandatory-first-appearance';
      } else {
        reason = alreadySeen ? 'already-seen' : 'proximity-required';
      }
    } else if (alreadySeen) {
      reason = 'already-seen';
    } else if (tutorialMode === 'silent' || presentation?.policy === 'silent-only') {
      reason = 'silent';
    } else {
      const bypassSpatialGate = presentation?.policy === 'event-immediate';
      const gate = bypassSpatialGate ? { allowed: true } : spatialGate(context);
      if (gate.allowed) {
        open = true;
        reason = bypassSpatialGate ? 'event-immediate' : 'guided';
      } else {
        reason = 'spatial-suppression';
      }
    }

    if (open && context.affectsPacing !== false) {
      lastAutomaticPresentation = {
        cardId,
        worldX: Number.isFinite(context.worldX) ? context.worldX : 0,
        at: Number.isFinite(context.nowSeconds) ? context.nowSeconds : 0,
      };
    }

    const diagnostic = mandatoryFirstAppearance
      ? diagnoseUnexpectedFirstAppearance(expectedPhase, presentation, context)
      : null;

    return {
      handled: pagesAdded.length > 0 || open || mandatoryFirstAppearance,
      open,
      reason,
      triggerId,
      cardId,
      presentationId: presentation?.id || null,
      pagesAdded,
      unlockedPages: pagesFor(cardId),
      mandatoryFirstAppearance,
      diagnostic,
    };
  }

  function markSeen(cardId) {
    if (!getTutorialCard(cardId)) return false;
    unlockedCards.add(cardId);
    seenCards.add(cardId);
    return true;
  }

  function clear() {
    seenCards.clear();
    unlockedCards.clear();
    unlockedPages.clear();
    lastAutomaticPresentation = null;
  }

  function snapshot() {
    return {
      seen: [...seenCards],
      unlocked: [...unlockedCards],
      pages: Object.fromEntries(
        [...unlockedPages.entries()].map(([cardId, indexes]) => [cardId, [...indexes].sort((a, b) => a - b)]),
      ),
    };
  }

  return {
    handle,
    markSeen,
    revealAll,
    pagesFor,
    snapshot,
    clear,
    hasSeen: cardId => seenCards.has(cardId),
    isUnlocked: cardId => unlockedCards.has(cardId),
    get discoveredCount() { return unlockedCards.size; },
  };
}
