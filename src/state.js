import { createLevel } from './data/level.js';
import { createMicrobeArt } from './data/microbes.js';
import { createPlayer } from './player.js';

export function createGameState() {
  return {
    gameState: 'intro',
    time: 0,
    cameraX: 0,
    shake: 0,
    currentCheckpoint: { x: 90, y: 500 },
    jumpHeldLast: false,
    player: createPlayer(),
    level: createLevel(),
    discoveredMicrobes: new Set(),
    microbeArt: createMicrobeArt(),
  };
}
