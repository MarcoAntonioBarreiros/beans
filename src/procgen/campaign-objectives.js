import {
  ensurePhaseObjectiveProgress,
  objectiveConditionId,
} from './campaign-objective-progress.js';

const OPERATORS = Object.freeze({
  '===': (actual, expected) => actual === expected,
  '!==': (actual, expected) => actual !== expected,
  '>': (actual, expected) => actual > expected,
  '>=': (actual, expected) => actual >= expected,
  '<': (actual, expected) => actual < expected,
  '<=': (actual, expected) => actual <= expected,
});

function functionalBiofilms(state, target = null) {
  return (state.level.biofilms || []).filter(film => (
    film.functional === true
    && (!target || film.platform?.objectiveTarget === target)
  ));
}

function activeNodules(state) {
  return (state.level.rhizobiumNodules || []).filter(site => (
    site.mature === true || site.stage === 'mature' || (site.fixationRate || 0) > 0.05
  ));
}

export function createCampaignObjectiveEvaluator({ state, systems = {} }) {
  function worldValue(condition) {
    const key = condition.key;
    if (
      key === 'performedDoubleJumpCount'
      || key === 'performedDashCount'
      || key === 'performedPhosphatePulseCount'
    ) {
      return ensurePhaseObjectiveProgress(state)[key];
    }
    if (key === 'reachedFinalRoot') return Boolean(state.level.goal?.completed);
    if (key === 'functionalBiofilmCount') return functionalBiofilms(state, condition.target).length;
    if (key === 'deployedExudateCount') return systems.gameplay?.deployedCloudCount || 0;
    if (key === 'bacillusColonyCount') {
      return (systems.inoculants?.colonies || []).filter(colony => colony.type === 'bacillus').length;
    }
    if (key === 'activeMatureNoduleCount') return activeNodules(state).length;
    if (key === 'totalFixationRate') {
      return (state.level.rhizobiumNodules || []).reduce((sum, site) => sum + (site.fixationRate || 0), 0);
    }
    if (key === 'visibleLateralRootCount') {
      return (state.level.azospirillumRoots || []).filter(root => (
        root.developed === true || (root.visibleProgress || 0) > .06
      )).length;
    }
    if (key === 'mandatoryAzospirillumChallengeDeveloped') {
      const challenge = state.level.azospirillumChallenge;
      // Sem desafio registrado (fase curta/edge): nao trava a fase — a
      // demonstracao de raiz lateral vale como sinal de desenvolvimento.
      if (!challenge) {
        return (state.level.azospirillumRoots || []).some(root => root.developed === true);
      }
      return challenge.developed === true;
    }
    if (key === 'mandatoryAzospirillumChallengeTraversed') {
      const challenge = state.level.azospirillumChallenge;
      if (!challenge) {
        return (ensurePhaseObjectiveProgress(state).performedDoubleJumpCount || 0) >= 1;
      }
      return challenge.traversed === true;
    }
    if (key === 'functionalMycorrhizaPathCount') {
      return (state.level.platforms || []).filter(platform => platform.mycorrhizaStructure && platform.mature !== false).length;
    }
    if (key === 'pseudomonasIronReserve') return systems.pseudomonas?.ironReserve || 0;
    if (key === 'opportunisticFungusVigor') return systems.opportunisticFungus?.controlledFungalVigor ?? 1;
    // Marco REAL de controle fungico: a rede existiu, esteve vigorosa e foi
    // mantida sob o limiar. O vigor instantaneo continua no HUD, mas nao decide
    // mais o objetivo — sem fungo em cena ele valia 0 e a fase ja nascia com o
    // requisito cumprido.
    if (key === 'controlledOpportunisticFungusCount') {
      return systems.opportunisticFungus?.controlledOpportunisticFungusCount || 0;
    }
    if (key === 'neutralizedOpportunisticFungusCount') return systems.trichoderma?.eliminatedCount || 0;
    if (key === 'neutralizedRhizoctoniaCount') return systems.trichoderma?.eliminatedCount || 0;
    if (key === 'recoveredRootCount') {
      // Uma raiz que foi danificada (wasDamaged) e voltou a >= .75 conta como
      // recuperada — sinal estavel, ao contrario do healthTrend instantaneo.
      return (state.level.platforms || []).filter(root => root.type === 'root' && root.wasDamaged === true && (root.rootHealth ?? 1) >= .75).length;
    }
    if (key === 'brokenCrystalCount') return (state.level.crystals || []).filter(crystal => crystal.broken).length;
    if (key === 'solubilizedPhosphateDepositCount') return systems.phosphate?.solubilizedDepositCount || 0;
    if (key === 'mycorrhizalPhosphateTransported') return systems.phosphate?.transportedPhosphate || 0;
    if (key === 'rootPhosphateStock') return systems.phosphate?.rootPhosphateStock || 0;
    if (key === 'neutralizedEggMassCount') return systems.meloidogyneControl?.eggMassesNeutralized || 0;
    if (key === 'preservedRootCount') {
      return (state.level.platforms || []).filter(root => root.type === 'root' && (root.rootHealth ?? 1) >= .75).length;
    }
    // Fase 9 (Ralstonia). Prevencao e contencao sao marcos acumulados pelo
    // sistema; murcha critica e uma leitura do AGORA (tem de estar zerada no
    // fim, e o jogador pode reduzir um foco critico de volta).
    if (key === 'preventedRalstoniaEntryCount') return systems.ralstonia?.preventedCount || 0;
    if (key === 'containedVascularRalstoniaCount') return systems.ralstonia?.containedCount || 0;
    if (key === 'activeCriticalRalstoniaCount') return systems.ralstonia?.criticalCount || 0;
    if (key === 'blockedRalstoniaSpreadCount') return systems.ralstonia?.blockedSpreadCount || 0;
    if (key === 'averageVascularTransport') return systems.ralstonia?.averageTransport ?? 1;
    if (key === 'preservedVascularRootCount') return systems.ralstonia?.preservedVascularRootCount || 0;
    if (key === 'ecologicalScore') return Number(state.level.ecologicalScore || 0);
    return undefined;
  }

  function conditionValue(condition) {
    if (condition.type === 'worldState') return worldValue(condition);
    if (condition.type === 'playerUnlock') return Boolean(state.campaign?.unlocks?.[condition.key]);
    return undefined;
  }

  function evaluate(testOrConditions) {
    const conditions = Array.isArray(testOrConditions)
      ? testOrConditions
      : testOrConditions?.requires || [];
      
    const progress = ensurePhaseObjectiveProgress(state);

    const results = conditions.map(condition => {
      const actual = conditionValue(condition);
      const compare = OPERATORS[condition.operator];
      const currentPassed = Boolean(compare && compare(actual, condition.value));
      
      const conditionId = objectiveConditionId(
        condition,
        progress.phaseId,
        progress.attemptId,
      );

      // Condicao AO VIVO: le o AGORA e nunca trava. Sem isso, um requisito do
      // tipo "nenhum foco critico ativo" nasce satisfeito (no frame 0 a
      // contagem e zero), trava, e a fase comeca com o objetivo verde.
      // Aceita as duas grafias: `live: true` e `latch: false`.
      if (condition.live === true || condition.latch === false) {
        progress.latchedConditions.delete(conditionId);
        return { condition, conditionId, actual, passed: currentPassed };
      }

      if (currentPassed) progress.latchedConditions.add(conditionId);

      const passed = progress.latchedConditions.has(conditionId) || currentPassed;

      return {
        condition,
        conditionId,
        actual,
        passed,
      };
    });
    return {
      passed: results.length > 0 && results.every(result => result.passed),
      results,
    };
  }

  return { evaluate, worldValue };
}
