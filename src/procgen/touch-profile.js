// QUEM É CELULAR, E QUANTO ZOOM CADA UM RECEBE
// ============================================
//
// O critério de toque já existia em `mobile-controls.js` e é o bom: ponteiro
// grosso OU (tem toque E a janela é estreita). A segunda metade é o que impede
// um notebook híbrido — que tem `maxTouchPoints > 0` e uma tela de 15" — de ser
// tratado como celular. `camera-view.js` usava uma versão mais frouxa, sem a
// checagem de largura, e por isso qualquer laptop com tela sensível cairia no
// perfil móvel. Agora os dois leem daqui.
//
// Os perfis de zoom são separados porque a necessidade é outra: no celular a
// tela é pequena e o dedo tapa parte dela, então o jogo abre mais perto (1,6×)
// e permite chegar bem mais perto ainda (2,8×). No computador o enquadramento
// atual está calibrado e não muda.

const COMPACT_VIEWPORT_QUERY = '(max-width: 900px)';
const COARSE_POINTER_QUERY = '(pointer: coarse)';

export const DESKTOP_ZOOM_PROFILE = Object.freeze({
  id: 'desktop',
  default: 1.45,
  min: 1,
  max: 1.8,
  step: .1,
});

export const TOUCH_ZOOM_PROFILE = Object.freeze({
  id: 'touch',
  default: 1.6,
  min: 1,
  max: 2.8,
  step: .1,
});

/**
 * O MESMO critério que liga os controles touch.
 *
 * Aceita a janela por parâmetro para poder ser testado sem navegador.
 */
export function isTouchDevice(windowObject = typeof window === 'undefined' ? null : window) {
  if (!windowObject) return false;
  const coarse = Boolean(windowObject.matchMedia?.(COARSE_POINTER_QUERY)?.matches);
  if (coarse) return true;
  const hasTouch = Number(windowObject.navigator?.maxTouchPoints) > 0;
  const compact = Boolean(windowObject.matchMedia?.(COMPACT_VIEWPORT_QUERY)?.matches);
  return hasTouch && compact;
}

/**
 * Perfil de zoom do aparelho. Escolhido UMA VEZ, na criação da câmera — trocar
 * de perfil no meio do jogo mudaria o enquadramento debaixo do jogador.
 */
export function zoomProfileFor(windowObject = typeof window === 'undefined' ? null : window) {
  return isTouchDevice(windowObject) ? TOUCH_ZOOM_PROFILE : DESKTOP_ZOOM_PROFILE;
}
