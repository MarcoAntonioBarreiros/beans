import { createSimulator } from './simulator.js';

const FPS = 60;
const DT = 1 / FPS;

export function validateChunk(fromPlatform, toPlatform, primitive, agentType = 'normal') {
  const sim = createSimulator();
  const validationEnd = Math.max(toPlatform.x + toPlatform.w + 600, 6000);

  sim.state.level.platforms = [fromPlatform, toPlatform];
  sim.state.level.hazards = [];
  sim.state.level.endX = validationEnd;
  sim.state.level.cameraMaxX = Math.max(0, validationEnd - 1280);
  sim.state.player.x = fromPlatform.x + fromPlatform.w - 52;
  sim.state.player.y = fromPlatform.y - 48;
  sim.state.player.onGround = true;
  sim.state.player.canDoubleJump = primitive.requires.includes('doubleJump');
  sim.state.player.airJumpAvailable = primitive.requires.includes('doubleJump');
  sim.state.player.canDash = primitive.requires.includes('dash');

  let jumpTiming = 0;
  if (agentType === 'conservative') jumpTiming = -5;
  else if (agentType === 'error-early') jumpTiming = -9;
  else if (agentType === 'error-late') jumpTiming = 4;

  const isDash = primitive.id.includes('dash');
  const isDouble = primitive.id.includes('double');
  const isControlledDrop = primitive.id === 'controlled-drop';
  let frames = 0;
  let phase = 'approach';
  let hasDoubleJumped = false;
  let hasDashed = false;
  let airFrames = 0;
  let releaseFrames = 0;

  while (frames < 360) {
    let keys = {};

    if (phase === 'approach') {
      keys = { ArrowRight: true };
      const jumpLine = fromPlatform.x + fromPlatform.w - 36 + jumpTiming * 3;
      if (sim.state.player.x >= jumpLine) {
        phase = isControlledDrop ? 'airborne' : 'jump';
      }
    } else if (phase === 'jump') {
      keys = { ArrowRight: true, Space: true };
      releaseFrames = 0;
      phase = 'airborne';
    } else {
      keys = isControlledDrop && !sim.state.player.onGround
        ? { ArrowLeft: true }
        : { ArrowRight: true };
      airFrames++;
      releaseFrames++;

      if (isDouble && !hasDoubleJumped && releaseFrames > 6 && sim.state.player.vy >= -105) {
        keys = { ArrowRight: true, Space: true };
        hasDoubleJumped = true;
        releaseFrames = 0;
      }
      if (isDash && !hasDashed && airFrames > 9 && sim.state.player.vy >= -90) {
        keys = { ArrowRight: true, ShiftLeft: true };
        hasDashed = true;
      }
    }

    sim.setInputs(keys);
    sim.step(DT);
    frames++;

    const p = sim.state.player;
    if (
      p.onGround
      && p.x + p.w > toPlatform.x + 4
      && p.x < toPlatform.x + toPlatform.w - 4
      && Math.abs(p.y - (toPlatform.y - 48)) < 12
    ) return true;

    if (p.x > toPlatform.x + toPlatform.w + 180) return false;
    if (p.y > Math.max(fromPlatform.y, toPlatform.y) + 220) return false;
  }

  return false;
}
