// WebAudio visualizer
const Viz = {
  ctx: null,
  analyser: null,
  dataArray: null,
  rafId: 0,

  init(){
    if(Viz.ctx) return;
    Viz.ctx = new (window.AudioContext || window.webkitAudioContext)();
    Viz.analyser = Viz.ctx.createAnalyser();
    Viz.analyser.fftSize = 1024;
    Viz.dataArray = new Uint8Array(Viz.analyser.frequencyBinCount);

    const src = Viz.ctx.createMediaElementSource(AudioEl);
    const gain = Viz.ctx.createGain();
    src.connect(gain);
    gain.connect(Viz.analyser);
    Viz.analyser.connect(Viz.ctx.destination);
  },

  drawLoop(){
    const canvas = document.getElementById("eq");
    if(!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const g = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    const draw = ()=>{
      Viz.analyser.getByteFrequencyData(Viz.dataArray);
      g.clearRect(0,0,W,H);

      const bars = Math.min(96, Viz.dataArray.length);
      const gap = 2 * dpr;
      const bw = Math.max(2*dpr, (W - (bars-1)*gap) / bars);
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1DB954";

      for(let i=0;i<bars;i++){
        const idx = Math.floor(Math.pow(i / bars, 0.8) * (Viz.dataArray.length-1));
        const v = Viz.dataArray[idx] / 255;
        const hbar = v * (H-8*dpr);
        const x = i * (bw + gap);
        const y = H - hbar;

        const grad = g.createLinearGradient(0, y, 0, H);
        grad.addColorStop(0, accent);
        grad.addColorStop(1, "#7cffb5");
        g.fillStyle = grad;
        g.fillRect(x, y, bw, hbar);

        g.globalAlpha = 0.15;
        g.fillRect(x, H - 3*dpr, bw, 3*dpr);
        g.globalAlpha = 1.0;
      }
      Viz.rafId = requestAnimationFrame(draw);
    };
    draw();
  }
};
