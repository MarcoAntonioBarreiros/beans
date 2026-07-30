export function createAudioController({ document, getPlayer }) {
  let muted = false;
  let audio = null;

  function toggleSound() {
    muted = !muted;
    const soundBtn = document.getElementById('soundBtn');
    if (soundBtn) soundBtn.textContent = muted ? '×' : '♫';
    if (audio?.master) audio.master.gain.setTargetAtTime(muted ? 0 : .3, audio.ctx.currentTime, .04);
  }

  function initAudio() {
    if (audio) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const master = ac.createGain();
    master.gain.value = .3;
    master.connect(ac.destination);
    audio = { ctx: ac, master, step: 0, next: ac.currentTime + .05, timer: null };
    const noiseBuffer = ac.createBuffer(1, ac.sampleRate * .12, ac.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    audio.noise = noiseBuffer;
    audio.timer = setInterval(scheduleAudio, 40);
  }

  function tone(freq, t, dur = .09, type = 'sine', gain = .08) {
    if (!audio || muted) return;
    const o = audio.ctx.createOscillator();
    const g = audio.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(audio.master);
    o.start(t);
    o.stop(t + dur + .02);
  }

  function toneNow(freq, dur = .09, type = 'sine', gain = .08) {
    if (!audio || muted) return;
    tone(freq, audio.ctx.currentTime, dur, type, gain);
  }

  function drum(t, kind = 'kick') {
    if (!audio || muted) return;
    const ac = audio.ctx;
    if (kind === 'kick') {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(45, t + .16);
      g.gain.setValueAtTime(.18, t);
      g.gain.exponentialRampToValueAtTime(.001, t + .18);
      o.connect(g).connect(audio.master);
      o.start(t);
      o.stop(t + .2);
    } else {
      const s = ac.createBufferSource();
      const g = ac.createGain();
      const f = ac.createBiquadFilter();
      s.buffer = audio.noise;
      f.type = 'highpass';
      f.frequency.value = 1400;
      g.gain.setValueAtTime(.09, t);
      g.gain.exponentialRampToValueAtTime(.001, t + .1);
      s.connect(f).connect(g).connect(audio.master);
      s.start(t);
      s.stop(t + .12);
    }
  }

  function scheduleAudio() {
    if (!audio) return;
    const player = getPlayer();
    const ac = audio.ctx;
    const sp = .125;
    while (audio.next < ac.currentTime + .12) {
      const s = audio.step % 16;
      const t = audio.next;
      if (s === 0 || s === 8) drum(t, 'kick');
      if (s === 4 || s === 12) drum(t, 'snare');
      if (player.canDash && [0, 3, 6, 8, 11, 14].includes(s)) tone([82, 98, 110, 123][(s / 3 | 0) % 4], t, .1, 'square', .035);
      if (player.canPhosphateSolubilization && [0, 2, 4, 6, 8, 10, 12, 14].includes(s)) tone([164, 196, 220, 247][(s / 2 | 0) % 4], t, .06, 'sawtooth', .018);
      audio.step++;
      audio.next += sp;
    }
  }

  return {
    initAudio,
    toggleSound,
    toneNow,
    isMuted: () => muted,
    get audio() {
      return audio;
    },
  };
}
