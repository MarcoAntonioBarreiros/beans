import { W } from '../core/constants.js';
import { drawWorldLabel } from '../procgen/world-label.js';
import { lerp } from '../core/math.js';
import { microbeCatalog, microbeEncounters } from '../data/microbes.js';
import { drawRoamingBacillusSprite } from './bacillus-sprite.js';

// A campanha procedural nao usa mais a cena decorativa fixa do inicio: ela
// colocava, em toda fase, uma colonia de rhizobium (bacterias + arco marrom cor
// de plataforma) e uma micorriza (halo) sem funcao de gameplay, no mesmo lugar.
// Os encontros funcionais vem de campaign-encounters.js, nao desta lista.
const proceduralSceneryEncounters = [];

export function getMicrobeSceneEncounters(state = {}) {
  return state.proceduralCampaign === true ? proceduralSceneryEncounters : microbeEncounters;
}

export function createMicrobeRenderer({ ctx, state, entities }) {
  function drawAnimatedFlag(x, y, a, len, color, phase, width = 1, spread = 0) {
    const time = state.time;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 1; i <= 8; i++) {
      const u = i / 8;
      const aa = a + spread;
      const wave = Math.sin(time * 5.2 - i * .78 + phase) * (3 + u * 7);
      const px = x + Math.cos(aa) * len * u + Math.cos(aa + Math.PI / 2) * wave;
      const py = y + Math.sin(aa) * len * u + Math.sin(aa + Math.PI / 2) * wave;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawOrganicBacterium(x, y, a, s, color, phase, kind = 'rod', microState = 0) {
    const time = state.time;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(s, s);
    ctx.shadowBlur = 12;
    ctx.shadowColor = color;
    const g = ctx.createLinearGradient(-14, -5, 14, 5);
    g.addColorStop(0, '#173f43');
    g.addColorStop(.5, color);
    g.addColorStop(1, '#102d33');
    ctx.fillStyle = g;
    ctx.beginPath();
    if (kind === 'curved') {
      ctx.moveTo(-14, 2);
      ctx.bezierCurveTo(-9, -8, 8, -9, 15, -1);
      ctx.bezierCurveTo(10, 7, -5, 9, -14, 2);
      ctx.closePath();
    } else {
      const h = kind === 'thin' ? 7.5 : 9.5;
      const w = kind === 'short' ? 22 : 29;
      ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = .7;
    if (kind === 'thin') {
      ctx.beginPath();
      ctx.moveTo(-10, -2.7);
      ctx.lineTo(9, -2.7);
      ctx.stroke();
    } else {
      for (let k = -8; k <= 8; k += 4) {
        ctx.beginPath();
        ctx.moveTo(k, -3.7);
        ctx.lineTo(k, 3.7);
        ctx.stroke();
      }
    }
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = 'rgba(245,255,250,.42)';
      ctx.beginPath();
      ctx.arc(-7 + k * 4.5, Math.sin(time * 1.5 + phase + k) * 1.4, .9, 0, Math.PI * 2);
      ctx.fill();
    }
    if (microState > 0) {
      ctx.fillStyle = `rgba(232,213,255,${.5 + .5 * microState})`;
      ctx.beginPath();
      ctx.ellipse(2, 0, 4, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBacteriumWithFlags(x, y, a, s, color, phase, kind, flagMode, microState = 0) {
    const rearX = x - Math.cos(a) * 14 * s;
    const rearY = y - Math.sin(a) * 14 * s;
    if (flagMode === 'single') drawAnimatedFlag(rearX, rearY, a + Math.PI, 46 * s, 'rgba(210,255,236,.68)', phase, 1);
    if (flagMode === 'tuft') for (let i = 0; i < 4; i++) drawAnimatedFlag(rearX, rearY, a + Math.PI, 42 * s, 'rgba(210,255,236,.58)', phase + i * .7, .8, (i - 1.5) * .12);
    if (flagMode === 'multi') for (let i = 0; i < 3; i++) drawAnimatedFlag(rearX, rearY, a + Math.PI, 40 * s, 'rgba(210,255,236,.56)', phase + i * .9, .8, (i - 1) * .18);
    if (flagMode === 'peri') for (let i = 0; i < 5; i++) {
      const ba = a + i / 5 * Math.PI * 2;
      const px = x + Math.cos(ba) * 5 * s;
      const py = y + Math.sin(ba) * 5 * s;
      drawAnimatedFlag(px, py, ba, 20 * s, 'rgba(210,255,236,.48)', phase + i, .65);
    }
    drawOrganicBacterium(x, y, a, s, color, phase, kind, microState);
  }

  function drawProceduralBranch(x, y, branch, color, width = 1.7, coilTarget = null) {
    const time = state.time;
    const a = branch.a;
    const len = branch.len;
    const wave = Math.sin(time * 1.7 + branch.p) * 10;
    const x1 = x + Math.cos(a) * len * .34;
    const y1 = y + Math.sin(a) * len * .34;
    const x2 = x + Math.cos(a) * len * .68 + Math.cos(a + Math.PI / 2) * (branch.bend + wave) * .45;
    const y2 = y + Math.sin(a) * len * .68 + Math.sin(a + Math.PI / 2) * (branch.bend + wave) * .45;
    let ex = x + Math.cos(a) * len + Math.cos(a + Math.PI / 2) * (branch.bend + wave);
    let ey = y + Math.sin(a) * len + Math.sin(a + Math.PI / 2) * (branch.bend + wave);
    if (coilTarget) {
      ex = lerp(ex, coilTarget.x, .35);
      ey = lerp(ey, coilTarget.y, .35);
    }
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 7;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x1, y1, x2, y2, ex, ey);
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (branch.branch) {
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.quadraticCurveTo(x2 + Math.cos(a + .8) * 32, y2 + Math.sin(a + .8) * 32, x2 + Math.cos(a + .65) * 55, y2 + Math.sin(a + .65) * 55);
      ctx.lineWidth = width * .72;
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = .42 + .24 * Math.sin(time * 4 + branch.p);
    ctx.beginPath();
    ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawEncounterLabel(z) {
    const player = state.player;
    const px = player.x + 16;
    const py = player.y + 24;
    if (Math.hypot(z.x - px, z.y - py) > 220) return;
    const m = microbeCatalog[z.id];
    const known = state.discoveredMicrobes.has(z.id);
    const label = known ? m.name : 'Sinal biológico';
    drawWorldLabel(ctx, z.x, z.y + 42, label, {
      color: known ? '#effff6' : '#c0d3cb',
      font: '800 13px Inter,system-ui',
      glow: known ? 12 : 7,
    });
  }

  function drawRhizobiumScene(z) {
    const { time, microbeArt } = state;
    ctx.strokeStyle = 'rgba(221,173,111,.55)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(z.x - 150, z.y + 80);
    ctx.quadraticCurveTo(z.x - 45, z.y - 25, z.x + 75, z.y - 5);
    ctx.stroke();
    microbeArt.rhizobium.forEach((c, i) => {
      const orbit = Math.sin(time * .85 + c.p) * 12;
      const x = z.x + c.x + orbit;
      const y = z.y + c.y + Math.cos(time * .7 + c.p) * 8;
      const aa = c.a + Math.sin(time * 1.5 + c.p) * .28;
      drawBacteriumWithFlags(x, y, aa, c.s, '#79e8dc', c.p, 'rod', 'multi');
      if (i % 5 === 0) {
        ctx.strokeStyle = 'rgba(213,175,255,.25)';
        ctx.beginPath();
        ctx.arc(x, y, 12 + Math.sin(time * 2 + c.p) * 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  function drawMycorrhizaScene(z) {
    const { time, microbeArt } = state;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    microbeArt.myco.forEach(b => drawProceduralBranch(z.x - 35, z.y + 55, b, 'rgba(214,175,255,.74)', 1.7));
    ctx.restore();
    for (let i = 0; i < 7; i++) {
      const a = time * .38 + i / 7 * Math.PI * 2;
      const r = 36 + Math.sin(time + i) * 8;
      ctx.fillStyle = i % 2 ? '#ffd176' : '#7ef0c2';
      ctx.globalAlpha = .65;
      ctx.beginPath();
      ctx.arc(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r * .55, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBacillusScene(z) {
    const { time, microbeArt } = state;
    ctx.fillStyle = 'rgba(112,229,214,.07)';
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(z.x + Math.cos(a) * 55, z.y + Math.sin(a) * 35, 30 + Math.sin(time + i) * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    microbeArt.bacillus.forEach(c => {
      const bx = z.x + c.x;
      const by = z.y + c.y + Math.sin(time + c.p) * 5;
      if (!drawRoamingBacillusSprite(ctx, bx, by, 38 * c.s, time, c.p)) {
        drawBacteriumWithFlags(bx, by, c.a + Math.sin(time * .8 + c.p) * .15, c.s, '#70e5d6', c.p, 'short', 'peri', c.spore ? .9 : 0);
      }
    });
  }

  function drawPhosScene(z) {
    const { time, microbeArt } = state;
    const dissolve = .45 + .22 * Math.sin(time * .35);
    ctx.save();
    ctx.translate(z.x, z.y + 24);
    ctx.fillStyle = '#64758a';
    ctx.strokeStyle = '#ffd176';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-35, 22);
    ctx.lineTo(-25, -24);
    ctx.lineTo(0, -40);
    ctx.lineTo(31, -18);
    ctx.lineTo(38, 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    microbeArt.phos.forEach((c, i) => {
      const a = c.a + time * .08;
      const r = c.r;
      const x = z.x + Math.cos(a) * r;
      const y = z.y + Math.sin(a) * r * .55;
      drawBacteriumWithFlags(x, y, a + Math.PI / 2, c.s, '#8db8ff', c.p, 'short', 'multi');
      if (i % 3 === 0) {
        ctx.fillStyle = '#ffd176';
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#ffd176';
        ctx.beginPath();
        ctx.arc(z.x + Math.cos(a + .4) * r * .62, z.y + Math.sin(a + .4) * r * .4, 2.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });
    ctx.strokeStyle = `rgba(117,234,223,${.25 + dissolve * .2})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(z.x, z.y + 8, 65 + Math.sin(time) * 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawOpportunistScene(z) {
    const { time, microbeArt } = state;
    ctx.fillStyle = 'rgba(255,130,151,.13)';
    ctx.beginPath();
    ctx.arc(z.x, z.y + 25, 47 + Math.sin(time * 1.7) * 5, 0, Math.PI * 2);
    ctx.fill();
    microbeArt.opportunist.forEach(b => drawProceduralBranch(z.x + 100, z.y - 20, b, 'rgba(255,130,151,.78)', 2));
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + time * .2;
      ctx.fillStyle = 'rgba(213,175,255,.65)';
      ctx.beginPath();
      ctx.arc(z.x + Math.cos(a) * 38, z.y + 15 + Math.sin(a) * 28, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTrichodermaScene(z) {
    const { time, microbeArt } = state;
    microbeArt.tricho.forEach(b => drawProceduralBranch(z.x - 105, z.y + 15, b, 'rgba(141,240,168,.8)', 1.8, { x: z.x + 10, y: z.y + 15 }));
    for (let i = 0; i < 5; i++) {
      const r = 18 + i * 9;
      const alpha = .12 + .08 * Math.sin(time * 2 + i);
      ctx.strokeStyle = `rgba(186,246,111,${alpha})`;
      ctx.beginPath();
      ctx.arc(z.x + 10, z.y + 15, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawAzospirillumScene(z) {
    const { time, microbeArt } = state;
    ctx.strokeStyle = '#d99a6a';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(z.x - 145, z.y + 70);
    ctx.quadraticCurveTo(z.x - 10, z.y + 55, z.x + 125, z.y + 15);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(z.x - 20, z.y + 54);
    ctx.quadraticCurveTo(z.x + 40, z.y - 5, z.x + 85, z.y - 55);
    ctx.stroke();
    microbeArt.azospirillum.forEach(c => drawBacteriumWithFlags(z.x + c.x, z.y + c.y, c.a + Math.sin(time + c.p) * .18, c.s, '#72e8dd', c.p, 'curved', 'single'));
    ctx.strokeStyle = 'rgba(199,165,255,.38)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(z.x + 30, z.y + 20, 18 + i * 12 + Math.sin(time * 2 + i) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawPseudomonasScene(z) {
    const { time, microbeArt } = state;
    ctx.save();
    ctx.translate(z.x + 15, z.y + 25);
    ctx.fillStyle = '#667388';
    ctx.strokeStyle = '#ffd176';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-25, 18);
    ctx.lineTo(-18, -19);
    ctx.lineTo(8, -30);
    ctx.lineTo(30, -8);
    ctx.lineTo(24, 20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    microbeArt.pseudomonas.forEach((c, i) => {
      const x = z.x + c.x;
      const y = z.y + c.y;
      drawBacteriumWithFlags(x, y, c.a + Math.sin(time * .9 + c.p) * .15, c.s, '#66f0dc', c.p, 'thin', 'tuft');
      if (i % 3 === 0) {
        const a = time * .45 + c.p;
        const r = 14 + Math.sin(time + c.p) * 4;
        ctx.fillStyle = '#b9f36f';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#b9f36f';
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });
    for (let i = 0; i < 5; i++) {
      const a = time * .55 + i * 1.2;
      ctx.fillStyle = '#ffd176';
      ctx.beginPath();
      ctx.arc(z.x + 15 + Math.cos(a) * (38 - i * 3), z.y + 25 + Math.sin(a) * (25 - i), 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMicrobeEcosystems() {
    for (const z of getMicrobeSceneEncounters(state)) {
      if (z.x - state.cameraX < -260 || z.x - state.cameraX > W + 260) continue;
      if (z.id === 'rhizobium') drawRhizobiumScene(z);
      else if (z.id === 'myco') drawMycorrhizaScene(z);
      else if (z.id === 'bacillus') drawBacillusScene(z);
      else if (z.id === 'phos') drawPhosScene(z);
      else if (z.id === 'oportunista') drawOpportunistScene(z);
      else if (z.id === 'trichoderma') drawTrichodermaScene(z);
      else if (z.id === 'azospirillum') drawAzospirillumScene(z);
      else if (z.id === 'pseudomonas') drawPseudomonasScene(z);
      if (!z.decorative) drawEncounterLabel(z);
    }
  }

  function discoverVisibleEncounters() {
    const player = state.player;
    getMicrobeSceneEncounters(state).forEach(z => {
      if (z.decorative || z.collect || state.discoveredMicrobes.has(z.id)) return;
      if (Math.hypot(z.x - (player.x + 16), z.y - (player.y + 24)) < z.r) entities.discoverMicrobe(z.id, true);
    });
  }

  return {
    drawOrganicBacterium,
    drawBacteriumWithFlags,
    drawMicrobeEcosystems,
    discoverVisibleEncounters,
  };
}
