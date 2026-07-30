import { createSimulator } from './simulator.js';

const FPS = 60;
const DT = 1 / FPS;

export function generatePrimitives() {
  const sim = createSimulator();
  const primitives = [];

  function simulateMovement(id, setupInput, jumpSequence, requires = []) {
    sim.reset();
    sim.state.level.platforms = [
      { x: -5000, y: 500, w: 10000, h: 100 }, // Floor
    ];
    sim.state.player.x = 0;
    sim.state.player.y = 452; // Floor y - player height (500 - 48 = 452)
    sim.state.player.canDoubleJump = requires.includes('doubleJump');
    sim.state.player.canDash = requires.includes('dash');

    // Setup (e.g. running to gain speed)
    let setupFrames = setupInput(sim);
    let startX = sim.state.player.x;
    let startY = sim.state.player.y;
    let startVelX = sim.state.player.vx;

    // Execute sequence
    let frames = 0;
    let seqIndex = 0;
    let maxDx = 0;
    let maxDy = 0;
    
    // Track if we leave the ground
    let leftGround = false;

    while (frames < 300) { // Max 5 seconds
      const inputs = seqIndex < jumpSequence.length ? jumpSequence[seqIndex] : jumpSequence[jumpSequence.length - 1];
      sim.setInputs(inputs);
      sim.step(DT);
      frames++;
      seqIndex++;

      const dx = sim.state.player.x - startX;
      const dy = sim.state.player.y - startY;

      if (!sim.state.player.onGround) {
        leftGround = true;
        if (Math.abs(dx) > Math.abs(maxDx)) maxDx = dx;
        if (dy < maxDy) maxDy = dy; // dy is negative upwards
      } else if (leftGround) {
        // Landed
        maxDx = dx;
        break;
      }
    }

    primitives.push({
      id,
      requires,
      startVelocity: { x: startVelX, y: 0 },
      displacement: { x: maxDx, y: maxDy },
      duration: frames * DT,
      landingVelocity: { x: sim.state.player.vx, y: sim.state.player.vy },
      recommendedLandingWidth: 64, // Default safety margin
      timingToleranceMs: 100, // Est.
      classification: id.includes('long') || id.includes('dash') ? 'comfortable' : 'comfortable' // Default
    });
  }

  const none = {};
  const right = { ArrowRight: true };
  const jump = { ArrowRight: true, Space: true };
  const rightDash = { ArrowRight: true, ShiftLeft: true };

  const shortJumpSeq = Array(5).fill(jump).concat(Array(60).fill(right));
  const longJumpSeq = Array(20).fill(jump).concat(Array(60).fill(right));

  // Salto parado curto
  simulateMovement('standing-jump-short', 
    () => { return 0; }, 
    shortJumpSeq
  );

  // Salto parado longo
  simulateMovement('standing-jump-long', 
    () => { return 0; }, 
    longJumpSeq
  );

  // Salto correndo curto
  simulateMovement('running-jump-short', 
    (s) => { 
      s.setInputs(right); 
      for(let i=0; i<60; i++) s.step(DT); 
      return 60; 
    }, 
    shortJumpSeq
  );

  // Salto correndo longo
  simulateMovement('running-jump-long', 
    (s) => { 
      s.setInputs(right); 
      for(let i=0; i<60; i++) s.step(DT); 
      return 60; 
    }, 
    longJumpSeq
  );

  // Salto duplo precoce
  const doubleJumpEarlySeq = Array(15).fill(jump)
    .concat(Array(5).fill(right)) // let go of jump
    .concat(Array(15).fill(jump)) // jump again
    .concat(Array(60).fill(right));

  simulateMovement('running-double-jump-early', 
    (s) => { s.setInputs(right); for(let i=0; i<60; i++) s.step(DT); return 60; }, 
    doubleJumpEarlySeq,
    ['doubleJump']
  );

  // Salto duplo tardio
  const doubleJumpLateSeq = Array(15).fill(jump)
    .concat(Array(25).fill(right)) // let go of jump, wait longer
    .concat(Array(15).fill(jump)) // jump again
    .concat(Array(60).fill(right));

  simulateMovement('running-double-jump-late', 
    (s) => { s.setInputs(right); for(let i=0; i<60; i++) s.step(DT); return 60; }, 
    doubleJumpLateSeq,
    ['doubleJump']
  );

  // Dash no solo
  simulateMovement('ground-dash', 
    (s) => { s.setInputs(right); for(let i=0; i<10; i++) s.step(DT); return 10; }, 
    [rightDash].concat(Array(60).fill(right)),
    ['dash']
  );

  // Air dash tardio
  const airDashSeq = Array(20).fill(jump)
    .concat(Array(20).fill(right))
    .concat([rightDash])
    .concat(Array(60).fill(right));

  simulateMovement('air-dash',
    (s) => { s.setInputs(right); for(let i=0; i<60; i++) s.step(DT); return 60; },
    airDashSeq,
    ['dash']
  );

  // Combo integrado (fase final): salto -> salto duplo -> air-dash. Encadeia as
  // duas mecanicas ja desbloqueadas para vencer vaos altos E largos, que nenhuma
  // primitiva isolada alcanca. O agente de validacao (agents.js) usa 'double' e
  // 'dash' no id para acionar as duas habilidades.
  const doubleJumpDashSeq = Array(15).fill(jump)
    .concat(Array(10).fill(right)) // solta o salto
    .concat(Array(15).fill(jump))  // salto duplo
    .concat(Array(8).fill(right))  // sobe um pouco
    .concat([rightDash])           // air-dash no apice
    .concat(Array(60).fill(right));

  simulateMovement('running-double-jump-dash',
    (s) => { s.setInputs(right); for(let i=0; i<60; i++) s.step(DT); return 60; },
    doubleJumpDashSeq,
    ['doubleJump', 'dash']
  );

  return primitives;
}
