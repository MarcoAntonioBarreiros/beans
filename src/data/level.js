export const enemyStartX = [790, 2340, 3510];

export function createLevel() {
  return {
    platforms: [
      { x: 0, y: 610, w: 520, h: 140 }, { x: 600, y: 570, w: 260, h: 180 }, { x: 920, y: 510, w: 250, h: 240 },
      { x: 1190, y: 610, w: 450, h: 140 }, { x: 1490, y: 490, w: 170, h: 28, type: 'root' },
      { x: 1710, y: 405, w: 160, h: 28, type: 'root' }, { x: 1925, y: 335, w: 210, h: 28, type: 'root' },
      { x: 2190, y: 610, w: 400, h: 140 }, { x: 2460, y: 500, w: 200, h: 26, type: 'root' },
      { x: 2730, y: 435, w: 190, h: 28, type: 'root' }, { x: 2990, y: 610, w: 390, h: 140 },
      { x: 3420, y: 540, w: 210, h: 210 }, { x: 3710, y: 480, w: 260, h: 270 }, { x: 4010, y: 610, w: 400, h: 140 },
      { x: 4470, y: 565, w: 420, h: 185 },
    ],
    hazards: [
      { x: 520, y: 674, w: 80, h: 46 }, { x: 860, y: 674, w: 60, h: 46 }, { x: 1640, y: 674, w: 550, h: 46 },
      { x: 2590, y: 674, w: 400, h: 46 }, { x: 3380, y: 674, w: 40, h: 46 }, { x: 3970, y: 674, w: 40, h: 46 },
      { x: 4410, y: 674, w: 60, h: 46 },
    ],
    checkpoints: [
      { x: 1140, y: 560, active: false }, { x: 2240, y: 560, active: false }, { x: 3740, y: 430, active: false },
    ],
    exudates: [
      { x: 360, y: 520, taken: false }, { x: 730, y: 495, taken: false }, { x: 1040, y: 430, taken: false },
      { x: 1560, y: 405, taken: false }, { x: 1810, y: 330, taken: false }, { x: 2500, y: 425, taken: false },
      { x: 2820, y: 360, taken: false }, { x: 3560, y: 455, taken: false }, { x: 3840, y: 395, taken: false },
    ],
    crystals: [
      { x: 3160, y: 518, w: 56, h: 92, hp: 1, broken: false }, { x: 3290, y: 530, w: 58, h: 80, hp: 1, broken: false },
      { x: 3825, y: 392, w: 54, h: 88, hp: 1, broken: false }, { x: 4240, y: 500, w: 72, h: 110, hp: 1, broken: false },
    ],
    enemies: [
      { x: 790, y: 532, w: 42, h: 38, vx: 45, left: 690, right: 840, alive: true },
      { x: 2340, y: 572, w: 44, h: 38, vx: 55, left: 2220, right: 2520, alive: true },
      { x: 3510, y: 502, w: 42, h: 38, vx: 48, left: 3440, right: 3590, alive: true },
    ],
    allies: [
      { id: 'azo', x: 1080, y: 445, r: 27, taken: false, name: 'Ari, o Azospirillum', desc: 'Azospirillum está associado ao desenvolvimento radicular. No jogo, ele libera o Impulso Radicular: pressione salto novamente no ar.' },
      { id: 'myco', x: 1370, y: 430, r: 28, taken: false, name: 'Mira, a Micorriza', desc: 'As hifas ampliam o alcance das raízes. No jogo, isso vira um impulso veloz para atravessar grandes espaços.' },
      { id: 'phos', x: 2860, y: 385, r: 28, taken: false, name: 'Sol, a Solubilizadora', desc: 'Alguns microrganismos ajudam a tornar o fósforo mais disponível. No jogo, isso vira um pulso que rompe barreiras minerais.' },
    ],
    roots: Array.from({ length: 75 }, (_, i) => ({
      x: i * 70 + Math.random() * 60,
      y: 140 + Math.random() * 500,
      len: 60 + Math.random() * 190,
      ang: -.7 + Math.random() * 1.4,
      thick: 1 + Math.random() * 3,
      layer: Math.random(),
    })),
    spores: Array.from({ length: 120 }, () => ({ x: Math.random() * 4900, y: 90 + Math.random() * 570, r: .7 + Math.random() * 2.2, s: .2 + Math.random() * .7, p: Math.random() * 6.28 })),
    particles: [],
    pulses: [],
  };
}

export function resetLevel(level) {
  level.exudates.forEach(o => { o.taken = false; });
  level.crystals.forEach(o => {
    o.broken = false;
    o.hp = 1;
  });
  level.enemies.forEach((e, i) => {
    e.alive = true;
    e.x = enemyStartX[i];
  });
  level.allies.forEach(a => { a.taken = false; });
  level.checkpoints.forEach(c => { c.active = false; });
}
