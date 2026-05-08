// Bootstrap
(async function(){
  // Apply appearance prefs
  Prefs.apply();

  // Initialize UI & Player flags
  UI.init();

  // Volume default
  AudioEl.volume = parseFloat(document.getElementById("volume").value);

  // Initial data fetch/render
  await UI.refresh();

  // Hook search
  UI.searchEl.addEventListener("input", ()=> UI.applySearch());

  // Log helpful info
  Log.info("Ready. Preferences:", Prefs.state);
})();
