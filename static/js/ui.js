// UI wiring, DOM, drawer, settings, search, progress bar
const $ = (sel) => document.querySelector(sel);

const UI = {
  // Elements
  treeEl: $("#tree"),
  searchEl: $("#search"),
  drawerBtn: $("#drawerBtn"),
  sidebar: $("#sidebar"),
  backdrop: $("#backdrop"),
  nowTitle: $("#now-title"),
  nowPath: $("#now-path"),
  miniName: $("#mini-name"),
  playBtn: $("#btn-play"),
  pPlayBtn: $("#p-play"),
  stopBtn: $("#p-stop"),
  fabPlay: $("#fab-play"),
  fabRandom: $("#fab-random"),
  randomBtn: $("#btn-random"),
  prevBtn: $("#btn-prev"),
  nextBtn: $("#btn-next"),
  volumeEl: $("#volume"),
  seek: $("#seek"),
  fill: $("#fill"),
  curEl: $("#cur"),
  durEl: $("#dur"),
  normalizeToggle: $("#normalizeToggle"),
  autoplayToggle: $("#autoplayToggle"),
  eqToggle: $("#btn-eq-toggle"),
  eqContainer: $("#eq-container"),
  settingsBtn: $("#settingsBtn"),
  settingsPanel: $("#settingsPanel"),
  statFolders: $("#stat-folders"),
  statFiles: $("#stat-files"),
  statSize: $("#stat-size"),
  userSeeking: false,
  showEQ: false,

  init() {
    // Apply prefs to toggles
    UI.showEQ = !!Prefs.state.eqDefault;
    UI.eqContainer.style.display = UI.showEQ ? "block" : "none";
    UI.eqToggle.textContent = UI.showEQ ? "Hide EQ" : "Show EQ";
    UI.autoplayToggle.checked = !!Prefs.state.autoplayDefault;
    UI.normalizeToggle.checked = !!Prefs.state.normalizeDefault;

    Player.autoplay = UI.autoplayToggle.checked;
    Player.normalize = UI.normalizeToggle.checked;

    // Drawer
    UI.drawerBtn?.addEventListener("click", () => UI.openDrawer());
    UI.backdrop?.addEventListener("click", () => UI.closeDrawer());

    // Settings
    UI.settingsBtn.addEventListener("click", () => {
      UI.settingsPanel.classList.toggle("open");
      $("#accentPicker").value = Prefs.state.accent;
      $("#surfacePicker").value = Prefs.state.surface;
      $("#radiusRange").value = Prefs.state.radius;
      $("#radiusVal").textContent = Prefs.state.radius;
      $("#densityRange").value = Prefs.state.density;
      $("#densityVal").textContent = (+Prefs.state.density).toFixed(2);
    });
    $("#accentPicker").addEventListener("input", (e) => { Prefs.state.accent = e.target.value; Prefs.apply(); Prefs.save(); });
    $("#surfacePicker").addEventListener("input", (e) => { Prefs.state.surface = e.target.value; Prefs.apply(); Prefs.save(); });
    $("#radiusRange").addEventListener("input", (e) => { Prefs.state.radius = +e.target.value; $("#radiusVal").textContent = Prefs.state.radius; Prefs.apply(); Prefs.save(); });
    $("#densityRange").addEventListener("input", (e) => { Prefs.state.density = +e.target.value; $("#densityVal").textContent = (+Prefs.state.density).toFixed(2); Prefs.apply(); Prefs.save(); });
    $("#eqDefault").addEventListener("change", (e) => { Prefs.state.eqDefault = e.target.checked; Prefs.save(); });
    $("#autoplayDefault").addEventListener("change", (e) => { Prefs.state.autoplayDefault = e.target.checked; Prefs.save(); UI.autoplayToggle.checked = Prefs.state.autoplayDefault; Player.autoplay = UI.autoplayToggle.checked; });
    $("#normalizeDefault").addEventListener("change", (e) => { Prefs.state.normalizeDefault = e.target.checked; Prefs.save(); UI.normalizeToggle.checked = Prefs.state.normalizeDefault; Player.normalize = UI.normalizeToggle.checked; });

    // Behavior toggles in header
    UI.normalizeToggle.addEventListener("change", () => {
      Player.normalize = UI.normalizeToggle.checked;
      // re-play current to apply pipeline change
      if (Player.currentIndex >= 0 && Player.currentIndex < Player.currentList.length) {
        Player.playPath(Player.currentList[Player.currentIndex]);
      }
    });
    UI.autoplayToggle.addEventListener("change", () => { Player.autoplay = UI.autoplayToggle.checked; });

    // Volume
    UI.volumeEl.addEventListener("input", () => AudioEl.volume = parseFloat(UI.volumeEl.value));

    // Seek
    UI.seek.addEventListener("pointerdown", (e) => { UI.userSeeking = true; UI._seekToEvent(e); });
    UI.seek.addEventListener("pointermove", (e) => { if (UI.userSeeking) UI._seekToEvent(e); });
    window.addEventListener("pointerup", () => UI.userSeeking = false);

    // Buttons
    UI.playBtn?.addEventListener("click", () => Player.toggle());
    UI.pPlayBtn?.addEventListener("click", () => Player.toggle());
    UI.fabPlay?.addEventListener("click", () => Player.toggle());
    UI.stopBtn?.addEventListener("click", () => { AudioEl.pause(); AudioEl.currentTime = 0; });
    UI.randomBtn?.addEventListener("click", () => UI.randomPlay());
    UI.fabRandom?.addEventListener("click", () => UI.randomPlay());
    UI.prevBtn?.addEventListener("click", () => Player.prev());
    UI.nextBtn?.addEventListener("click", () => Player.next());

    // Keyboard
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); UI.searchEl.focus(); UI.searchEl.select();
      }
      if (e.key === " ") { e.preventDefault(); Player.toggle(); }
      if (e.key.toLowerCase() === "n") { Player.next(); }
      if (e.key.toLowerCase() === "p") { Player.prev(); }
      if (e.key.toLowerCase() === "r") { UI.randomPlay(); }
    });

    // EQ toggle
    UI.eqToggle.addEventListener("click", () => {
      UI.showEQ = !UI.showEQ;
      UI.eqContainer.style.display = UI.showEQ ? "block" : "none";
      UI.eqToggle.textContent = UI.showEQ ? "Hide EQ" : "Show EQ";
      if (UI.showEQ) {
        if (!Viz.ctx) Viz.init();
        cancelAnimationFrame(Viz.rafId);
        Viz.drawLoop();
      } else {
        cancelAnimationFrame(Viz.rafId);
      }
    });
  },

  _seekToEvent(e) {
    const rect = UI.seek.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    Player.seekToPct(pct);
  },

  async refresh() {
    const rootTree = await API.tree(""); // Load only root folder
    UI.renderRoot(rootTree);
    const stats = await API.stats();
    UI.statFolders.textContent = stats.folders;
    UI.statFiles.textContent = stats.files;
    UI.statSize.textContent = stats.human_size;
  },

  renderRoot(root) {
    UI.treeEl.innerHTML = "";
    UI.treeEl.appendChild(UI._createFolderNode(root));
  },

  _createFolderNode(node) {
    const wrap = document.createElement("details");
    wrap.className = "node";
    const summary = document.createElement("summary");
    summary.className = "folder";
    summary.innerHTML = `<span style="opacity:.6;width:16px;text-align:center;">▸</span><span class="folder-name">${node.name || "sounds"}</span>`;
    
    let loaded = false;
    wrap.addEventListener("toggle", async () => {
      if (wrap.open && !loaded) {
        const data = await API.tree(node.path || "");
        data.children.forEach(ch => {
          if (ch.type === "file") wrap.appendChild(UI._createFileNode(ch));
          else wrap.appendChild(UI._createFolderNode(ch));
        });
        
        // Update player list
        Player.currentList = UI._collectFiles(UI.treeEl);
        loaded = true;
      }
    });

    wrap.appendChild(summary);
    return wrap;
  },

  _createFileNode(node) {
    const el = document.createElement("div");
    el.className = "file";
    el.title = node.name;
    el.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" stroke="#cfcfcf" stroke-width="2"/>
      </svg>
      <span class="file-name">${node.name}</span>
      <span class="meta">${(node.size/1024).toFixed(0)} KB</span>
      <span class="play" data-path="${node.path}">Play</span>`;
    el.querySelector(".play").addEventListener("click", () => Player.playPath(node.path));
    return el;
  },

  _collectFiles(root) {
    return [...root.querySelectorAll(".file .play")].map(el => el.dataset.path);
  },

  applySearch() {
    const q = (UI.searchEl.value || "").toLowerCase().trim();
    const files = UI._collectFiles(UI.treeEl);
    Player.currentList = q ? files.filter(p => p.toLowerCase().includes(q)) : files;
    if (!Player.currentList.length) Player.currentIndex = -1;
  },

  setNowPlaying(path) {
    const name = (path || "").split("/").pop() || "—";
    UI.nowTitle.textContent = name;
    UI.nowPath.textContent = path || "—";
    UI.miniName.textContent = name;
  },

  setProgress(pct) {
    UI.fill.style.width = (pct * 100).toFixed(2) + "%";
  },

  setTimes(cur, dur) {
    const hhmmss = (t) => {
      if (!isFinite(t)) return "0:00";
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      return `${m}:${s.toString().padStart(2, "0")}`;
    };
    UI.curEl.textContent = hhmmss(cur);
    UI.durEl.textContent = hhmmss(dur);
  },

  syncPlayState(isPlaying) {
    if (UI.playBtn) UI.playBtn.textContent = isPlaying ? "⏸ Pause" : "▶︎ Play";
    if (UI.pPlayBtn) UI.pPlayBtn.textContent = isPlaying ? "⏸" : "▶︎";
    if (UI.fabPlay) UI.fabPlay.textContent = isPlaying ? "⏸" : "▶";
  },

  async randomPlay() {
    try {
      const r = await API.random();
      if (r.ok && r.path) Player.playPath(r.path);
      else UI.toast("No audio files found.");
    } catch (e) {
      Log.error("Random error:", e);
      UI.toast("Failed to pick a random track.");
    }
  },

  openDrawer() {
    UI.sidebar.classList.add("open");
    UI.backdrop.classList.add("show");
    UI.drawerBtn.setAttribute("aria-expanded", "true");
  },

  closeDrawer() {
    UI.sidebar.classList.remove("open");
    UI.backdrop.classList.remove("show");
    UI.drawerBtn.setAttribute("aria-expanded", "false");
  },

  toast(msg) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.position = "fixed";
    t.style.bottom = "88px";
    t.style.left = "50%";
    t.style.transform = "translateX(-50%)";
    t.style.background = "rgba(0,0,0,.85)";
    t.style.color = "white";
    t.style.padding = "10px 14px";
    t.style.borderRadius = "12px";
    t.style.border = "1px solid var(--line)";
    t.style.zIndex = 200;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
  }
};
