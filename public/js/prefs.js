// Local preferences (persisted via localStorage)
const store = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem(k) ?? JSON.stringify(d)); }catch{ return d; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
};

const Prefs = {
  state: {
    accent: store.get("accent", "#1DB954"),
    surface: store.get("surface", "#111214"),
    radius: store.get("radius", 16),
    density: store.get("density", 1),
    eqDefault: store.get("eqDefault", false),
    autoplayDefault: store.get("autoplayDefault", false),
    normalizeDefault: store.get("normalizeDefault", false),
  },
  apply(){
    document.documentElement.style.setProperty("--accent", Prefs.state.accent);
    document.documentElement.style.setProperty("--surface", Prefs.state.surface);
    document.documentElement.style.setProperty("--radius", Prefs.state.radius + "px");
    document.documentElement.style.setProperty("--density", Prefs.state.density);
  },
  save(){
    Object.entries(Prefs.state).forEach(([k,v])=> store.set(k, v));
  }
};
