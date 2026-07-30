const LABELS = Object.freeze({
  rhizobium: 'Rhizobium',
  azospirillum: 'Azospirillum',
  bacillus: 'Bacillus',
  pseudomonas: 'Pseudomonas',
  myco: 'Micorriza',
  trichoderma: 'Trichoderma',
});

// Uma unica selecao decide qual acao responde ao E.
export function createInoculumSelection({ state, input, inoculants, trichodermaColonies, entities = null }) {
  let index = 0;
  let cycleHeldLast = false;
  let lastToastAt = -Infinity;

  function options() {
    const list = [];
    for (const [type, agents] of inoculants.followerGroups()) {
      list.push({ kind: 'organism', type, count: agents.length, label: LABELS[type] || type });
    }
    const trichoderma = trichodermaColonies?.followerCount || 0;
    if (trichoderma > 0) {
      list.push({ kind: 'trichoderma', type: 'trichoderma', count: trichoderma, label: LABELS.trichoderma });
    }
    const exudates = state.player.exudates || 0;
    if (exudates > 0) list.push({ kind: 'exudate', type: 'exudate', count: exudates, label: 'Exsudato' });
    if (state.player.canPhosphateSolubilization) {
      const reserve = state.bacillusBioprotection?.solubilizerEntries
        ?.reduce((sum, entry) => sum + (entry.phosphateMetaboliteReserve || 0), 0) || 0;
      list.push({
        kind: 'phosphate-solubilization',
        type: 'phosphate-solubilization',
        count: `${Math.round(Math.min(1, reserve) * 100)}%`,
        label: 'Solubilizacao P',
      });
    }
    return list;
  }

  function current() {
    const list = options();
    if (!list.length) return null;
    if (index >= list.length) index = 0;
    return list[index];
  }

  function isSelected(kind, type) {
    const selected = current();
    if (!selected) return false;
    if (kind === 'organism') return selected.kind === 'organism' && selected.type === type;
    return selected.kind === kind;
  }

  function announce(selected) {
    if (state.time - lastToastAt < .5) return;
    if (selected.kind === 'phosphate-solubilization') {
      state.toast = 'Selecionado: Solubilizacao P — segure E perto da cepa solubilizadora e solte para disparar.';
    } else if (selected.kind === 'exudate') {
      state.toast = `Selecionado: exsudato (${selected.count}) — E lanca para capturar ou reforcar colonia.`;
    } else {
      state.toast = `Selecionado: ${selected.label} (${selected.count}) — E inocula na raiz.`;
    }
    state.toastTime = 2.4;
    lastToastAt = state.time;
  }

  function cycle() {
    const list = options();
    // Uma opção só: a seta não muda nada, então não há o que sinalizar.
    if (list.length < 2) return false;
    index = (index + 1) % list.length;
    // Depois da troca REAL do índice. `prepare` já filtra a tecla segurada, e
    // `options()` sozinho nunca chega aqui.
    entities?.interactionFx?.('uiSelectionCycle', { gain: 1, rate: 1 });
    announce(list[index]);
    return true;
  }

  function prepare() {
    if (state.gameState !== 'play') return;
    const pressed = Boolean(input.keys.ArrowDown);
    if (pressed && !cycleHeldLast) cycle();
    cycleHeldLast = pressed;
  }

  function reset() {
    index = 0;
    cycleHeldLast = false;
    lastToastAt = -Infinity;
  }

  return {
    prepare,
    reset,
    cycle,
    options,
    isSelected,
    get current() { return current(); },
    get summary() {
      const selected = current();
      if (!selected) return '';
      const total = options().length;
      const position = total > 1 ? ` ${index + 1}/${total}` : '';
      return `${selected.label} (${selected.count})${position}`;
    },
  };
}
