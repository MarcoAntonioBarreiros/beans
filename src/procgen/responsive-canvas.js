import { H, W } from '../core/constants.js';

export function calculateResponsiveCanvasSize(
  viewportWidth,
  viewportHeight,
  logicalHeight = H,
) {
  const width = Number(viewportWidth);
  const height = Number(viewportHeight);
  const safeLogicalHeight = Math.max(1, Math.round(Number(logicalHeight) || H));
  if (!(width > 0) || !(height > 0)) {
    return { width: W, height: safeLogicalHeight, aspectRatio: W / H };
  }

  const aspectRatio = width / height;
  return {
    width: Math.max(1, Math.round(safeLogicalHeight * aspectRatio)),
    height: safeLogicalHeight,
    aspectRatio,
  };
}

function measuredViewport(canvas, windowObject) {
  const rect = canvas?.getBoundingClientRect?.();
  const width = rect?.width
    || windowObject?.visualViewport?.width
    || windowObject?.innerWidth
    || W;
  const height = rect?.height
    || windowObject?.visualViewport?.height
    || windowObject?.innerHeight
    || H;
  return { width, height };
}

export function createResponsiveCanvas({
  canvas,
  windowObject = typeof window === 'undefined' ? null : window,
} = {}) {
  if (!canvas) throw new Error('createResponsiveCanvas requer um canvas');

  let scheduled = false;
  let lastViewportWidth = 0;
  let lastViewportHeight = 0;

  function sync() {
    scheduled = false;
    const viewport = measuredViewport(canvas, windowObject);
    const next = calculateResponsiveCanvasSize(viewport.width, viewport.height);
    const changed = canvas.width !== next.width || canvas.height !== next.height;
    if (changed) {
      canvas.width = next.width;
      canvas.height = next.height;
    }
    lastViewportWidth = viewport.width;
    lastViewportHeight = viewport.height;
    return changed;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    const requestFrame = windowObject?.requestAnimationFrame?.bind(windowObject);
    if (requestFrame) requestFrame(sync);
    else sync();
  }

  sync();
  windowObject?.addEventListener?.('resize', schedule, { passive: true });
  windowObject?.addEventListener?.('orientationchange', schedule, { passive: true });
  windowObject?.visualViewport?.addEventListener?.('resize', schedule, { passive: true });

  return {
    sync,
    schedule,
    destroy() {
      windowObject?.removeEventListener?.('resize', schedule);
      windowObject?.removeEventListener?.('orientationchange', schedule);
      windowObject?.visualViewport?.removeEventListener?.('resize', schedule);
    },
    diagnostics() {
      return {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        viewportWidth: lastViewportWidth,
        viewportHeight: lastViewportHeight,
        aspectRatio: canvas.width / Math.max(1, canvas.height),
      };
    },
  };
}
