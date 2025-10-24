// Fetch helpers + small logger to console
const API = {
  async tree(path = "") {
    const q = path ? `?path=${encodeURIComponent(path)}` : "";
    return fetch(`/sounds/api/tree${q}`).then(r => r.json());
  },
  async stats() {
    return fetch(`/sounds/api/stats`).then(r => r.json());
  },
  async random() {
    return fetch(`/sounds/api/random`).then(r => r.json());
  }
};

const Log = {
  info: (...a) => console.log("[Wavebox]", ...a),
  warn: (...a) => console.warn("[Wavebox]", ...a),
  error: (...a) => console.error("[Wavebox]", ...a),
};
