import assert from 'node:assert/strict';
import test from 'node:test';

import { createBacillusBioprotection } from '../src/procgen/bacillus-bioprotection.js';
import { PHOSPHATE_SOLUBILIZATION_DEFAULTS } from '../src/procgen/campaign-manifest.js';

// Espia de canvas: registra o que foi desenhado para eu poder afirmar o que
// NAO aparece mais na tela.
function spyCanvas() {
  const calls = { text: [], rects: [], arcs: 0, gradients: 0 };
  const ctx = new Proxy({
    measureText: text => ({ width: String(text).length * 7 }),
    fillText: text => calls.text.push(String(text)),
    strokeText: text => calls.text.push(String(text)),
    fillRect: (x, y, w, h) => calls.rects.push({ x, y, w, h }),
    strokeRect: (x, y, w, h) => calls.rects.push({ x, y, w, h }),
    arc: () => { calls.arcs++; },
    ellipse: () => { calls.arcs++; },
    createRadialGradient: () => { calls.gradients++; return { addColorStop: () => {} }; },
    createLinearGradient: () => { calls.gradients++; return { addColorStop: () => {} }; },
  }, { get: (target, key) => target[key] || (() => {}) });
  return { ctx, calls };
}

function coloniaMadura() {
  const platform = { x: 0, y: 300, w: 180, h: 60 };
  const colony = {
    id: 'madura', type: 'bacillus', x: 80, y: 290, platform,
    sourceCount: 4, vigor: 1, growth: 1, authored: true, rechargeIntensity: .5,
  };
  const state = {
    time: 10,
    cameraX: 0,
    gameState: 'play',
    player: { x: 0, y: 0, w: 32, h: 48, infection: 0, soil: 0 },
    level: {
      biofilms: [], platforms: [platform],
      phaseProfile: { phosphateSolubilization: PHOSPHATE_SOLUBILIZATION_DEFAULTS },
    },
  };
  const system = createBacillusBioprotection({
    state, inoculants: { colonies: [colony] },
    ecology: { agents: [] }, entities: { burst() {} },
  });
  system.update(1);
  return { system, entry: system.entries[0] };
}

test('a reserva do Bacillus nao e mais desenhada como barra rotulada', () => {
  // Duas barras rotuladas por colonia carregavam a cena inteira — e uma colonia
  // madura nunca esta sozinha. A reserva agora se le pela difusao no solo.
  const { system, entry } = coloniaMadura();
  assert.ok(entry.antibioticReserve > 0, 'a colonia madura precisa ter reserva para o teste valer');

  const { ctx, calls } = spyCanvas();
  system.render(ctx);

  for (const proibido of ['antibiose', 'metabolitos P', 'metabolitos']) {
    assert.ok(
      !calls.text.some(text => text.toLowerCase().includes(proibido.toLowerCase())),
      `o rotulo "${proibido}" voltou a ser desenhado sobre a colonia`,
    );
  }
});

test('a reserva aparece como difusao: mais reserva, mais particulas e mais alcance', () => {
  const fraca = coloniaMadura();
  fraca.entry.antibioticReserve = .12;
  fraca.entry.phosphateMetaboliteReserve = 0;
  const espiaFraca = spyCanvas();
  fraca.system.render(espiaFraca.ctx);

  const forte = coloniaMadura();
  forte.entry.antibioticReserve = 1.25;
  forte.entry.phosphateMetaboliteReserve = 1;
  const espiaForte = spyCanvas();
  forte.system.render(espiaForte.ctx);

  assert.ok(
    espiaForte.calls.arcs > espiaFraca.calls.arcs,
    'uma reserva maior precisa render mais particulas de difusao',
  );
  assert.ok(
    espiaForte.calls.gradients > espiaFraca.calls.gradients,
    'a reserva de fosfato acrescenta o proprio halo de difusao',
  );
});

test('reserva zerada nao desenha difusao nenhuma', () => {
  // Sem isto toda colonia recem-inoculada ganharia um halo sem significado.
  const { system, entry } = coloniaMadura();
  entry.antibioticReserve = 0;
  entry.phosphateMetaboliteReserve = 0;
  const semReserva = spyCanvas();
  system.render(semReserva.ctx);

  const { system: outro, entry: cheio } = coloniaMadura();
  cheio.antibioticReserve = 1.25;
  cheio.phosphateMetaboliteReserve = 1;
  const comReserva = spyCanvas();
  outro.render(comReserva.ctx);

  assert.ok(
    comReserva.calls.gradients > semReserva.calls.gradients,
    'a difusao so deve existir quando ha reserva',
  );
});
