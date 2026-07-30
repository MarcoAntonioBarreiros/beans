// Ajuste fino da skin, mexivel em tempo de execucao.
//
// Tamanho do personagem e ritmo da corrida sao decisoes de olho, nao de
// medicao: o numero certo e o que parece certo enquanto se joga. Ficarem
// congelados no modulo obriga a editar codigo, publicar e olhar de novo a cada
// tentativa. Aqui eles ficam num objeto vivo que o Phase Lab move com sliders e
// o desenho le a cada quadro.
//
// Sao so multiplicadores e valores visuais: nada aqui toca a fisica.

export const PLAYER_TUNING_STORAGE_KEY = 'miguelito:player-tuning:v1';

export const PLAYER_TUNING_DEFAULTS = Object.freeze({
  // Altura visivel do personagem, em pixels de jogo.
  characterHeight: 72,
  // Multiplicador do ritmo da animacao de corrida.
  runSpeedScale: 1,
});

export const PLAYER_TUNING_LIMITS = Object.freeze({
  characterHeight: { min: 40, max: 120, step: 2 },
  runSpeedScale: { min: .3, max: 2, step: .05 },
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function sanitize(raw) {
  const out = { ...PLAYER_TUNING_DEFAULTS };
  for (const [key, limit] of Object.entries(PLAYER_TUNING_LIMITS)) {
    const value = Number(raw?.[key]);
    // Valor invalido ou fora da faixa nunca pode virar personagem gigante ou de
    // altura zero: cai no padrao.
    if (Number.isFinite(value)) out[key] = clamp(value, limit.min, limit.max);
  }
  return out;
}

let current = { ...PLAYER_TUNING_DEFAULTS };
let storageRef = null;

export function initPlayerTuning(storage = null) {
  storageRef = storage;
  try { current = sanitize(JSON.parse(storage?.getItem(PLAYER_TUNING_STORAGE_KEY))); } catch (_) {
    current = { ...PLAYER_TUNING_DEFAULTS };
  }
  return current;
}

export function getPlayerTuning() {
  return current;
}

export function setPlayerTuning(patch) {
  current = sanitize({ ...current, ...patch });
  try { storageRef?.setItem(PLAYER_TUNING_STORAGE_KEY, JSON.stringify(current)); } catch (_) {}
  return current;
}

export function resetPlayerTuning() {
  return setPlayerTuning(PLAYER_TUNING_DEFAULTS);
}

