import assert from 'node:assert/strict';
import test from 'node:test';

import { generatePrimitives } from '../src/procgen/primitives.js';
import { validateChunk } from '../src/procgen/agents.js';
import { getPhaseProfile } from '../src/procgen/campaign-progression.js';

test('existe a primitiva de combo salto duplo + dash', () => {
  const combo = generatePrimitives().find(p => p.id === 'running-double-jump-dash');
  assert.ok(combo, 'a primitiva de combo precisa existir');
  assert.deepEqual([...combo.requires].sort(), ['dash', 'doubleJump']);
  // O combo deve avancar (dx) e subir (dy negativo = para cima).
  assert.ok(Math.abs(combo.displacement.x) > 0, 'o combo precisa avancar');
  assert.ok(combo.displacement.y < 0, 'o combo precisa subir');
});

test('a travessia de combo vence um vao alto E largo que o salto comum nao vence', () => {
  const primitives = generatePrimitives();
  const combo = primitives.find(p => p.id === 'running-double-jump-dash');
  const basic = primitives.find(p => p.id === 'running-jump-long');

  const from = { x: 200, y: 480, w: 160, h: 54, type: 'root', logicIndex: 0 };
  // Alvo alto e largo, dentro do alcance medido do proprio combo.
  const to = {
    x: from.x + from.w + Math.abs(combo.displacement.x) * 0.7,
    y: from.y + combo.displacement.y * 0.7,
    w: 120,
    h: 54,
    type: 'root',
    logicIndex: 1,
  };

  assert.ok(
    validateChunk(from, to, combo, 'normal'),
    'encadeando salto duplo + dash a travessia precisa fechar',
  );
  assert.ok(
    !validateChunk(from, to, basic, 'normal'),
    'um salto comum nao pode vencer o mesmo vao — senao o combo seria inutil',
  );
});

test('a fase 10 habilita combos integrados e e mais dificil', () => {
  // O gauntlet integrado passou a ser a fase 10: a 9 agora e a fase didatica da
  // Ralstonia, onde a dificuldade esta na doenca e nao na travessia.
  const profile = getPhaseProfile({ phase: 10, unlocks: { doubleJump: true, dash: true } });
  assert.ok(profile.comboRequirementChance > 0, 'a fase 10 precisa pedir combos');
  assert.ok(profile.hardChance >= 0.3, 'a fase 10 e o gauntlet integrado');

  const ralstonia = getPhaseProfile({ phase: 9, unlocks: { doubleJump: true, dash: true } });
  assert.ok(
    ralstonia.hardChance < profile.hardChance,
    'a fase da Ralstonia nao pode ser mais dura de plataforma que o gauntlet',
  );
});
