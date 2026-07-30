import { resetLevel } from './data/level.js';
import { microbeCatalog, microbeEncounters } from './data/microbes.js';
import { resetPlayer } from './player.js';

export function createEntitySystem({ state, hud }) {
  function burst(x, y, color, count = 18, speed = 180) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * speed;
      state.level.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 25, life: .4 + Math.random() * .8, max: 1, r: 2 + Math.random() * 4, color });
    }
  }

  function discoverMicrobe(id, forceToast = true) {
    if (state.discoveredMicrobes.has(id)) return;
    const m = microbeCatalog[id];
    if (!m) return;
    state.discoveredMicrobes.add(id);
    state.player.soil += m.soil;
    state.player.hope += m.hope;
    const z = microbeEncounters.find(e => e.id === id);
    if (z) burst(z.x, z.y, m.color, id === 'oportunista' ? 18 : 26, id === 'oportunista' ? 130 : 175);
    if (forceToast) hud.showToast(m.title, m.desc, 4300);
    hud.updateHud();
  }

  function resetGame() {
    resetPlayer(state.player);
    resetLevel(state.level);
    state.currentCheckpoint = { x: 90, y: 500 };
    state.cameraX = 0;
    state.jumpHeldLast = false;
    state.discoveredMicrobes.clear();
    hud.setMission('Encontre Azospirillum e a rede micorrízica');
    hud.updateHud();
  }

  function respawn(manual = false) {
    const player = state.player;
    if (!manual) burst(player.x + 16, player.y + 24, '#ff6f91', 30, 240);
    player.x = state.currentCheckpoint.x;
    player.y = state.currentCheckpoint.y;
    player.vx = 0;
    player.vy = 0;
    player.airJumpAvailable = player.canDoubleJump;
    player.invuln = 1.2;
  }

  return {
    burst,
    discoverMicrobe,
    resetGame,
    respawn,
  };
}
