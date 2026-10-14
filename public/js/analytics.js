(function () {
  var KEY = 'dlns_analytics_optout';
  var nav = navigator;

  function optedOut() {
    try {
      if (localStorage.getItem(KEY) === '1') return true;
    } catch (e) {}
    return nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.globalPrivacyControl === true;
  }

  window.dlnsAnalytics = {
    isOptedOut: optedOut,
    setOptOut: function (v) {
      try {
        if (v) localStorage.setItem(KEY, '1');
        else localStorage.removeItem(KEY);
      } catch (e) {}
      return fetch(v ? '/api/a/optout' : '/api/a/optin', { method: 'POST', credentials: 'same-origin' }).catch(function () {});
    },
  };

  var last = null;
  function hit() {
    if (optedOut()) return;
    var p = location.pathname;
    if (p === last) return;
    last = p;
    var body = JSON.stringify({ p: p, r: document.referrer || '' });
    if (nav.sendBeacon && nav.sendBeacon('/api/a/hit', new Blob([body], { type: 'application/json' }))) return;
    fetch('/api/a/hit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
  }

  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () {
      var r = orig.apply(this, arguments);
      setTimeout(hit, 0);
      return r;
    };
  });
  window.addEventListener('popstate', function () { setTimeout(hit, 0); });
  hit();
})();
