// Tiny WebAudio synth — no asset files, no network. Lazily created on first
// user gesture (browsers block audio before that). No-ops if unavailable
// (e.g. headless test env with no AudioContext).

const Sound = {
  ctx: null,
  enabled: true,

  init() {
    if (this.ctx) return;
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
  },

  blip(freq, dur = 0.08, type = 'sine', gain = 0.06) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    g.connect(this.ctx.destination);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur);
  },

  card() { this.blip(330, 0.07, 'triangle', 0.05); },
  deal() { this.blip(240, 0.05, 'sine', 0.035); },
  bid() { this.blip(440, 0.06, 'square', 0.035); },
  reveal() { this.blip(392, 0.05, 'sine', 0.05); setTimeout(() => this.blip(587, 0.1, 'sine', 0.05), 70); },
  win() { this.blip(523, 0.09, 'sine', 0.06); setTimeout(() => this.blip(659, 0.12, 'sine', 0.06), 90); },
  lose() { this.blip(196, 0.2, 'sawtooth', 0.045); },

  setEnabled(v) { this.enabled = v; },
};
