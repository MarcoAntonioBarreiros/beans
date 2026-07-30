import { clamp } from './core/math.js';

export function getHudDom(document) {
  return {
    intro: document.getElementById('intro'),
    hud: document.getElementById('hud'),
    end: document.getElementById('end'),
    missionText: document.getElementById('missionText'),
    soilMeter: document.getElementById('soilMeter'),
    hopeMeter: document.getElementById('hopeMeter'),
    microbeCount: document.getElementById('microbeCount'),
    jumpCard: document.getElementById('jumpCard'),
    dashCard: document.getElementById('dashCard'),
    pulseCard: document.getElementById('pulseCard'),
    toast: document.getElementById('toast'),
    prompt: document.getElementById('prompt'),
    finalSoil: document.getElementById('finalSoil'),
    finalMicrobes: document.getElementById('finalMicrobes'),
  };
}

export function createHud({ dom, state }) {
  let toastTimer = null;

  function showToast(title, body, ms = 3600) {
    dom.toast.querySelector('b').textContent = title;
    dom.toast.querySelector('span').textContent = body;
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), ms);
  }

  function setMission(txt) {
    dom.missionText.textContent = txt;
  }

  function updateHud() {
    const player = state.player;
    dom.soilMeter.style.width = clamp(player.soil, 0, 100) + '%';
    dom.hopeMeter.style.width = clamp(player.hope, 0, 100) + '%';
    dom.jumpCard.classList.toggle('active', player.canDoubleJump);
    dom.dashCard.classList.toggle('active', player.canDash);
    dom.pulseCard.classList.toggle('active', player.canPhosphateSolubilization);
    dom.microbeCount.textContent = state.discoveredMicrobes.size;
  }

  function showPlay() {
    dom.intro.classList.add('hidden');
    dom.end.classList.add('hidden');
    dom.hud.classList.remove('hidden');
  }

  function showIntro() {
    dom.hud.classList.add('hidden');
    dom.end.classList.add('hidden');
    dom.intro.classList.remove('hidden');
  }

  function showEnd() {
    dom.hud.classList.add('hidden');
    dom.end.classList.remove('hidden');
    dom.finalSoil.textContent = Math.round(clamp(state.player.soil, 0, 100)) + '%';
    dom.finalMicrobes.textContent = state.discoveredMicrobes.size + '/8';
  }

  function updatePrompt() {
    if (state.gameState !== 'play') return;
    const allies = state.level.allies;
    const player = state.player;
    const nearMyco = !allies[0].taken && Math.abs(player.x - allies[0].x) < 150;
    const nearPhos = !allies[1].taken && Math.abs(player.x - allies[1].x) < 150;
    dom.prompt.textContent = nearMyco ? 'Aproxime-se da rede micorrízica' : nearPhos ? 'Aproxime-se da colônia solubilizadora' : '';
    dom.prompt.classList.toggle('show', nearMyco || nearPhos);
  }

  return {
    showToast,
    setMission,
    updateHud,
    showPlay,
    showIntro,
    showEnd,
    updatePrompt,
  };
}
