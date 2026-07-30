const ACTION_COUNTER_KEYS = Object.freeze([
  'performedDoubleJumpCount',
  'performedDashCount',
  'performedPhosphatePulseCount',
]);

const ACTION_COUNTER_SET = new Set(ACTION_COUNTER_KEYS);

function currentPhaseId(state) {
  return state?.campaign?.phase ?? state?.level?.campaignPhase ?? null;
}

function normalizedAttemptId(value, fallback = 1) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function createEmptyObjectiveProgress({ phaseId = null, attemptId = 0 } = {}) {
  return {
    phaseId,
    attemptId: normalizedAttemptId(attemptId, 0),
    latchedConditions: new Set(),
    performedDoubleJumpCount: 0,
    performedDashCount: 0,
    performedPhosphatePulseCount: 0,
  };
}

export function resetPhaseObjectiveProgress(state, {
  phaseId = currentPhaseId(state),
  attemptId = null,
} = {}) {
  if (!state.level) state.level = {};
  const previousAttemptId = normalizedAttemptId(state.level.objectiveProgress?.attemptId, 0);
  state.level.objectiveProgress = createEmptyObjectiveProgress({
    phaseId,
    attemptId: attemptId ?? previousAttemptId + 1,
  });
  return state.level.objectiveProgress;
}

export function ensurePhaseObjectiveProgress(state) {
  if (!state.level) state.level = {};
  const phaseId = currentPhaseId(state);
  const progress = state.level.objectiveProgress;
  if (!progress || progress.phaseId !== phaseId) {
    return resetPhaseObjectiveProgress(state, { phaseId });
  }

  if (!(progress.latchedConditions instanceof Set)) {
    progress.latchedConditions = new Set(
      Array.isArray(progress.latchedConditions) ? progress.latchedConditions : [],
    );
  }
  progress.attemptId = normalizedAttemptId(progress.attemptId);
  for (const key of ACTION_COUNTER_KEYS) {
    progress[key] = Number.isFinite(progress[key]) && progress[key] >= 0 ? progress[key] : 0;
  }
  return progress;
}

export function objectiveConditionId(condition, phaseId, attemptId) {
  return JSON.stringify([
    phaseId ?? '',
    attemptId ?? '',
    condition?.type ?? '',
    condition?.key ?? '',
    condition?.target ?? '',
    condition?.operator ?? '',
    condition?.value ?? '',
  ]);
}

export function recordPhaseObjectiveAction(state, key, amount = 1) {
  if (!ACTION_COUNTER_SET.has(key) || !Number.isFinite(amount) || amount <= 0) return false;
  const progress = ensurePhaseObjectiveProgress(state);
  progress[key] += amount;
  return true;
}

export function objectiveProgressSnapshot(state) {
  const progress = ensurePhaseObjectiveProgress(state);
  return {
    phaseId: progress.phaseId,
    attemptId: progress.attemptId,
    performedDoubleJumpCount: progress.performedDoubleJumpCount,
    performedDashCount: progress.performedDashCount,
    performedPhosphatePulseCount: progress.performedPhosphatePulseCount,
  };
}
