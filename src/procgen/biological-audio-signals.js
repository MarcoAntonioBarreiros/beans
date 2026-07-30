// Sinais de controle para o áudio
// ================================
//
// Bacillus e Pseudomonas atuam em mais lugares do que o fungo oportunista: a
// Rhizoctonia e a Ralstonia também são contidas por eles, e esses sistemas já
// calculam a pressão exercida. O que não existia era um lugar onde o áudio
// pudesse LER essa pressão sem que cada sistema conhecesse o áudio.
//
// Este módulo é só um quadro de avisos. Ele não decide nada, não calcula nada e
// não altera nenhum valor de gameplay — quem publica já terminou o cálculo, e
// quem lê só transforma número em som. Se este arquivo for removido, o jogo
// continua idêntico e fica apenas mais mudo.
//
// Os sinais são POR QUADRO: quem publica precisa republicar todo quadro em que a
// pressão continua existindo. Um sinal que parou de ser republicado expira
// sozinho, e é assim que o loop para quando o controle termina.

const SIGNAL_TTL_SECONDS = 0.25;

function registry(state) {
  if (!state.biologicalAudioSignals) {
    state.biologicalAudioSignals = {
      bacillusAntibiosis: new Map(),
      pseudomonasSuppression: new Map(),
    };
  }
  return state.biologicalAudioSignals;
}

// `kind` é 'bacillusAntibiosis' ou 'pseudomonasSuppression'.
export function publishControlSignal(state, kind, signal) {
  if (!state || !signal || !signal.colonyId) return;
  const mapa = registry(state)[kind];
  if (!mapa) return;
  const chave = `${signal.colonyId}:${signal.targetId ?? '-'}`;
  const anterior = mapa.get(chave);
  // O mesmo alvo pode receber pressão de fontes diferentes no mesmo quadro;
  // vale a maior, como em todo o resto do controle.
  if (anterior && anterior.at === state.time && anterior.pressure >= signal.pressure) return;
  mapa.set(chave, {
    colonyId: signal.colonyId,
    targetId: signal.targetId ?? null,
    targetType: signal.targetType || 'desconhecido',
    pressure: Number.isFinite(signal.pressure) ? signal.pressure : 0,
    x: signal.x,
    y: signal.y,
    at: state.time,
  });
}

// Pressão externa (fora do fungo oportunista) sobre uma colônia, neste quadro.
export function externalControlPressure(state, kind, colonyId) {
  const mapa = state?.biologicalAudioSignals?.[kind];
  if (!mapa || !mapa.size) return 0;
  let maior = 0;
  for (const signal of mapa.values()) {
    if (signal.colonyId !== colonyId) continue;
    if (state.time - signal.at > SIGNAL_TTL_SECONDS) continue;
    if (signal.pressure > maior) maior = signal.pressure;
  }
  return maior;
}

// Existe algum alvo realmente sendo controlado por esta colônia agora?
export function hasExternalControlTarget(state, kind, colonyId) {
  return externalControlPressure(state, kind, colonyId) > 0;
}

export function clearControlSignals(state) {
  if (!state?.biologicalAudioSignals) return;
  state.biologicalAudioSignals.bacillusAntibiosis.clear();
  state.biologicalAudioSignals.pseudomonasSuppression.clear();
}
