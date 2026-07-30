export function createInput({ target = window, document, onRespawn, onToggleSound } = {}) {
  const keys = Object.create(null);
  const listeners = [];

  const keydown = e => {
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyR') onRespawn?.(true);
    if (e.code === 'KeyM') onToggleSound?.();
  };
  const keyup = e => {
    keys[e.code] = false;
  };

  target.addEventListener('keydown', keydown);
  target.addEventListener('keyup', keyup);
  listeners.push([target, 'keydown', keydown], [target, 'keyup', keyup]);

  document?.querySelectorAll('.touch button').forEach(btn => {
    const k = btn.dataset.key;
    const down = e => {
      e.preventDefault();
      keys[k] = true;
    };
    const up = e => {
      e.preventDefault();
      keys[k] = false;
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    listeners.push([btn, 'pointerdown', down], [btn, 'pointerup', up], [btn, 'pointercancel', up], [btn, 'pointerleave', up]);
  });

  return {
    keys,
    press(code) {
      keys[code] = true;
    },
    release(code) {
      keys[code] = false;
    },
    clear() {
      Object.keys(keys).forEach(code => { keys[code] = false; });
    },
    destroy() {
      listeners.forEach(([node, type, fn]) => node.removeEventListener(type, fn));
    },
  };
}
