export function createGameLoop({ update, render, now = () => performance.now(), raf = requestAnimationFrame }) {
  let last = now();
  let running = false;

  function frame(frameNow) {
    const dt = Math.min(.033, (frameNow - last) / 1000);
    last = frameNow;
    update(dt);
    render();
    if (running) raf(frame);
  }

  function start() {
    if (running) return;
    running = true;
    raf(frame);
  }

  function stop() {
    running = false;
  }

  function step(dt = 1 / 60) {
    update(dt);
    render();
  }

  return { start, stop, step };
}
