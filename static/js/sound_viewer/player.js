// Audio control + routing
const AudioEl = document.getElementById("audio");

const Player = {
  currentList: [],
  currentIndex: -1,
  normalize: false,
  autoplay: false,

  isMP3(path){ return path?.toLowerCase().endsWith(".mp3"); },

  urlFor(path){
    // if mp3 + !normalize -> direct
    if(Player.isMP3(path) && !Player.normalize){
      return "/media/" + encodeURIComponent(path).replace(/%2F/g,"/");
    }
    // otherwise stream with normalize flag
    return "/stream/" + encodeURIComponent(path).replace(/%2F/g,"/") + "?normalize=" + (Player.normalize ? "1":"0");
  },

  playPath(path){
    const url = Player.urlFor(path);
    if(!Viz.ctx) Viz.init();

    cancelAnimationFrame(Viz.rafId);
    AudioEl.src = url;
    AudioEl.play().catch(err=>{
      Log.error("Playback error:", err);
      UI.toast("Failed to play file.");
    });

    UI.setNowPlaying(path);
    if(UI.showEQ) Viz.drawLoop();

    const idx = Player.currentList.indexOf(path);
    Player.currentIndex = idx >= 0 ? idx : -1;
    UI.closeDrawer();
  },

  toggle(){ if(AudioEl.src && !AudioEl.paused) AudioEl.pause(); else AudioEl.play().catch(()=>{}); },
  next(){
    if(!Player.currentList.length) return;
    if(Player.currentIndex < 0) Player.currentIndex = -1;
    Player.currentIndex = (Player.currentIndex + 1) % Player.currentList.length;
    Player.playPath(Player.currentList[Player.currentIndex]);
  },
  prev(){
    if(!Player.currentList.length) return;
    if(Player.currentIndex < 0) Player.currentIndex = 0;
    Player.currentIndex = (Player.currentIndex - 1 + Player.currentList.length) % Player.currentList.length;
    Player.playPath(Player.currentList[Player.currentIndex]);
  },
  seekToPct(pct){ if (!isFinite(AudioEl.duration)) return; AudioEl.currentTime = pct * AudioEl.duration; },
};

// Wire audio events to UI
AudioEl.addEventListener("timeupdate", ()=>{
  if(!UI.userSeeking && AudioEl.duration){
    UI.setProgress(AudioEl.currentTime / AudioEl.duration);
  }
  UI.setTimes(AudioEl.currentTime, AudioEl.duration);
});

AudioEl.addEventListener("loadedmetadata", ()=>{
  UI.setTimes(AudioEl.currentTime, AudioEl.duration);
});

AudioEl.addEventListener("play", ()=> UI.syncPlayState(true));
AudioEl.addEventListener("pause", ()=> UI.syncPlayState(false));

AudioEl.addEventListener("ended", ()=>{
  if(Player.autoplay) Player.next();
});
