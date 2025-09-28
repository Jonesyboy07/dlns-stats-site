document.addEventListener('DOMContentLoaded', () => {
  // Convert UTC ISO timestamps to user's local date & 12-hour time (AM/PM)
  const times = document.querySelectorAll('time.dt[datetime]');
  times.forEach(t => {
    try {
      const iso = t.getAttribute('datetime');
      if (!iso) return;
      const d = /^\d+(\.\d+)?$/.test(iso) ? new Date(parseFloat(iso) * 1000) : new Date(iso);
      if (isNaN(d.getTime())) return;
      const fmt = new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: 'short', day: '2-digit',
        hour: 'numeric', minute: '2-digit', hour12: true
      });
      t.textContent = fmt.format(d);
      t.title = `Local: ${d.toString()}\nSource: ${iso}`;
    } catch (e) { /* noop */ }
  });

  // Small logger helpers
  const log = (...a) => console.info('[DLNS]', ...a);
  const warn = (...a) => console.warn('[DLNS]', ...a);
  const err = (...a) => console.error('[DLNS]', ...a);

  // Hero name mapping - we'll fetch this from the server
  let heroNames = {};
  const loadHeroNames = async () => {
    try {
      const response = await fetch('/db/heroes', { headers: { 'Accept': 'application/json' } });
      if (response.ok) {
        heroNames = await response.json();
        log('Loaded hero names:', Object.keys(heroNames).length);
      } else {
        warn('Heroes fetch non-OK:', response.status, response.statusText);
      }
    } catch (e) {
      warn('Could not load hero names:', e);
    }
  };
  const getHeroName = (heroId) => {
    if (!heroId && heroId !== 0) return 'Unknown';
    return heroNames[heroId] || `Hero ${heroId}`;
  };
  loadHeroNames();

  const formatDuration = (s) => {
    s = parseInt(s || 0, 10);
    if (!Number.isFinite(s) || s < 0) return '-';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };
  const teamName = (t) => t === 0 ? 'Amber' : (t === 1 ? 'Sapphire' : 'Unknown');

  const applyLocalTimeTo = (root) => {
    root.querySelectorAll('time.dt[datetime]').forEach(t => {
      try {
        const iso = t.getAttribute('datetime');
        if (!iso) return;
        const d = /^\d+(\.\d+)?$/.test(iso) ? new Date(parseFloat(iso) * 1000) : new Date(iso);
        if (isNaN(d.getTime())) return;
        const fmt = new Intl.DateTimeFormat(undefined, {
          year: 'numeric', month: 'short', day: '2-digit',
          hour: 'numeric', minute: '2-digit', hour12: true
        });
        t.textContent = fmt.format(d);
        t.title = `Local: ${d.toString()}\nSource: ${iso}`;
      } catch (_) {}
    });
  };

  const parsePaged = (data, fallbackPer = 20) => {
    const items = Array.isArray(data.matches) ? data.matches
      : Array.isArray(data.items) ? data.items
      : Array.isArray(data.data) ? data.data : [];
    const per = parseInt(data.per_page ?? data.limit ?? fallbackPer, 10) || fallbackPer;
    const total = parseInt(data.total ?? data.total_count ?? data.count ?? 0, 10) || 0;
    let pageCount = parseInt(data.total_pages ?? data.page_count ?? data.pages ?? 0, 10) || 0;
    if (!pageCount && total && per) pageCount = Math.ceil(total / per);
    const unknownTotal = pageCount === 0;
    const hasNextFlag = !!(data.has_next ?? data.hasMore ?? data.has_more ?? data.next_page ?? data.nextUrl);
    const hasPrevFlag = !!(data.has_prev ?? data.hasPrevious ?? data.has_previous ?? data.prev_page ?? data.prevUrl);
    return { items, per, total, pageCount, unknownTotal, hasNextFlag, hasPrevFlag };
  };

  // ========================
  // Home Page Pagination
  // ========================
  const matchesTable = document.getElementById('matchesTable');
  const pager = document.getElementById('pager');
  const pageStat = document.getElementById('pageStat');
  const homeFilters = document.getElementById('homeFilters');

  const getHomeFilterValues = () => {
    const form = homeFilters ? homeFilters.querySelector('form[data-filter-form]') : null;
    const params = new URLSearchParams();
    if (form) {
      const order = (form.querySelector('[name="order"]')?.value || '').toString();
      const team = (form.querySelector('[name="team"]')?.value || '').toString();
      const game_mode = (form.querySelector('[name="game_mode"]')?.value || '').toString();
      const match_mode = (form.querySelector('[name="match_mode"]')?.value || '').toString();
      if (order) params.set('order', order);
      if (team) params.set('team', team);
      if (game_mode) params.set('game_mode', game_mode);
      if (match_mode) params.set('match_mode', match_mode);
    }
    return params;
  };

  const homeState = { page: 1, per: 20, totalPages: 1, unknownTotal: false };

  const updateHomePager = (opts = {}) => {
    if (!pager) return;
    const prevBtn = pager.querySelector('button[data-page="prev"]');
    const nextBtn = pager.querySelector('button[data-page="next"]');
    const hasNext = opts.hasNext ?? (!homeState.unknownTotal ? homeState.page < homeState.totalPages : true);
    const hasPrev = opts.hasPrev ?? (homeState.page > 1);

    if (prevBtn) prevBtn.disabled = !hasPrev;
    if (nextBtn) nextBtn.disabled = !hasNext;

    if (pageStat) {
      pageStat.textContent = homeState.unknownTotal || homeState.totalPages <= 1
        ? `Page ${homeState.page}`
        : `Page ${homeState.page} / ${homeState.totalPages}`;
    }
  };

  const renderHomeRows = (rows) => {
    if (!matchesTable) return;
    let tbody = matchesTable.querySelector('tbody');
    if (!tbody) {
      tbody = document.createElement('tbody');
      matchesTable.appendChild(tbody);
    }
    tbody.innerHTML = '';
    if (!rows.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="4">No matches yet.</td>`;
      tbody.appendChild(tr);
      return;
    }
    rows.forEach(m => {
      const started = m.start_time || m.created_at;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><a class="chip-button" href="/matches/${m.match_id}">${m.match_id}</a></td>
        <td>${formatDuration(m.duration_s)}</td>
        <td><span class="${m.winning_team === 0 ? 'team-amber' : (m.winning_team === 1 ? 'team-sapphire' : '')}">${teamName(m.winning_team)}</span></td>
        <td><time class="dt" datetime="${started}">${String(started).slice(0,10)}</time></td>
      `;
      tbody.appendChild(tr);
    });
    applyLocalTimeTo(matchesTable);
  };

  const fetchHomePage = async (page = 1, scrollTop = true) => {
    if (!matchesTable) return;
    const params = getHomeFilterValues();
    params.set('page', String(page));
    params.set('per_page', String(homeState.per));
    params.set('_ts', Date.now().toString()); // cache-bust
    const url = `/db/matches/latest/paged?${params.toString()}`;

    log('Home fetch ->', url);
    try {
      const resp = await fetch(url, { headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' } });
      if (!resp.ok) {
        warn('Home fetch non-OK:', resp.status, resp.statusText);
        return;
      }
      const data = await resp.json();
      const parsed = parsePaged(data, homeState.per);

      renderHomeRows(parsed.items);

      // Trust requested page
      homeState.page = Math.max(1, page);
      homeState.per = parsed.per;
      homeState.totalPages = Math.max(1, parsed.pageCount || 1);
      homeState.unknownTotal = parsed.unknownTotal;

      const hasNext = parsed.unknownTotal ? (parsed.items.length === parsed.per) : (homeState.page < homeState.totalPages);
      const hasPrev = homeState.page > 1;
      updateHomePager({ hasNext, hasPrev });

      log('Home fetch ok:', { page: homeState.page, totalPages: homeState.totalPages, items: parsed.items.length, unknownTotal: homeState.unknownTotal });

      if (scrollTop) {
        const rect = matchesTable.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          matchesTable.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    } catch (e) {
      err('Home fetch error:', e);
    }
  };
  console.log({ "before pager init": { matchesTable, pager } });
  if (matchesTable && pager && !pager.dataset.bound) {
    console.log('Binding home pager');
    pager.dataset.bound = '1';
    const prevBtn = pager.querySelector('button[data-page="prev"]');
    const nextBtn = pager.querySelector('button[data-page="next"]');
    console.log({ prevBtn, nextBtn });
    prevBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      const target = Math.max(1, homeState.page - 1);
      log('Home prev click:', { from: homeState.page, to: target });
      fetchHomePage(target);
    });
    nextBtn?.addEventListener('click', (e) => {
      
      e.preventDefault();
      // If total is known, clamp; if unknown, allow advancing
      const target = homeState.unknownTotal ? (homeState.page + 1) : Math.min(homeState.totalPages, homeState.page + 1);
      log('Home next click:', { from: homeState.page, to: target });
      if (target !== homeState.page) fetchHomePage(target);
    });

    // Filters
    const form = homeFilters ? homeFilters.querySelector('form[data-filter-form]') : null;
    if (form) {
      form.addEventListener('change', () => { log('Home filters change -> page 1'); fetchHomePage(1, true); });
      form.addEventListener('submit', (e) => { e.preventDefault(); log('Home filters submit -> page 1'); fetchHomePage(1, true); homeFilters?.setAttribute('aria-hidden', 'true'); });
    }

    // Kick off initial load (will also normalize server-rendered table)
    fetchHomePage(1, false);
    log('Home pager initialized');
  }

  // ========================
  // User Page Pagination
  // ========================
  const userTable = document.getElementById('userMatchesTable');
  const userPager = document.getElementById('userPager');
  const userPageStat = document.getElementById('userPageStat');
  const userFilters = document.getElementById('userFilters');

  const getUserFilterValues = () => {
    const form = userFilters ? userFilters.querySelector('form[data-filter-form]') : null;
    const params = new URLSearchParams();
    if (form) {
      const order = (form.querySelector('[name="order"]')?.value || '').toString();
      const res = (form.querySelector('[name="res"]')?.value || '').toString();
      const team = (form.querySelector('[name="team"]')?.value || '').toString();
      if (order) params.set('order', order);
      if (res) params.set('res', res);
      if (team) params.set('team', team);
    }
    return params;
  };

  const userState = { userId: null, page: 1, per: 20, totalPages: 1, unknownTotal: false };

  const updateUserPager = (opts = {}) => {
    if (!userPager) return;
    const prevBtn = userPager.querySelector('button[data-page="prev"]');
    const nextBtn = userPager.querySelector('button[data-page="next"]');
    const hasNext = opts.hasNext ?? (!userState.unknownTotal ? userState.page < userState.totalPages : true);
    const hasPrev = opts.hasPrev ?? (userState.page > 1);

    if (prevBtn) prevBtn.disabled = !hasPrev;
    if (nextBtn) nextBtn.disabled = !hasNext;

    if (userPageStat) {
      userPageStat.textContent = userState.unknownTotal || userState.totalPages <= 1
        ? `Page ${userState.page}`
        : `Page ${userState.page} / ${userState.totalPages}`;
    }
  };

  const renderUserRows = (rows) => {
    if (!userTable) return;
    let tbody = userTable.querySelector('tbody');
    if (!tbody) {
      tbody = document.createElement('tbody');
      userTable.appendChild(tbody);
    }
    tbody.innerHTML = '';
    if (!rows.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="10">No matches found for this user.</td>`;
      tbody.appendChild(tr);
      return;
    }
    rows.forEach(m => {
      const tr = document.createElement('tr');
      const when = m.start_time || m.created_at;
      tr.innerHTML = `
        <td><a href="/matches/${m.match_id}">${m.match_id}</a></td>
        <td><span class="${m.team === 0 ? 'team-amber' : (m.team === 1 ? 'team-sapphire' : '')}">${teamName(m.team)}</span></td>
        <td>${getHeroName(m.hero_id)}</td>
        <td>${m.result === 'Win' ? '<span class="badge win">Win</span>' : (m.result === 'Loss' ? '<span class="badge loss">Loss</span>' : '<span class="badge neutral">-</span>')}</td>
        <td>${(m.kills||0)}/${(m.deaths||0)}/${(m.assists||0)}</td>
        <td>${(m.creep_kills||0)}/${(m.last_hits||0)}/${(m.denies||0)}</td>
        <td>${(m.shots_hit||0)}/${(m.shots_missed||0)}</td>
        <td>${m.player_damage || 0}</td>
        <td>${m.player_healing || 0}</td>
        <td><time class="dt" datetime="${when}">${String(when).slice(0,10)}</time></td>
      `;
      tbody.appendChild(tr);
    });
    applyLocalTimeTo(userTable);
  };

  const fetchUserPage = async (page = 1, scrollTop = true) => {
    if (!userTable || !userState.userId) return;
    const params = getUserFilterValues();
    params.set('page', String(page));
    params.set('per_page', String(userState.per));
    params.set('_ts', Date.now().toString());
    // const url = `/db/matches/user/${userState.userId}/paged?${params.toString()}`;
    const url = `/db/users/${userState.userId}/matches/paged?${params.toString()}`;

    log('User fetch ->', url);
    try {
      const resp = await fetch(url, { headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' } });
      if (!resp.ok) {
        warn('User fetch non-OK:', resp.status, resp.statusText);
        return;
      }
      const data = await resp.json();
      const parsed = parsePaged(data, userState.per);

      renderUserRows(parsed.items);

      // Trust requested page
      userState.page = Math.max(1, page);
      userState.per = parsed.per;
      userState.totalPages = Math.max(1, parsed.pageCount || 1);
      userState.unknownTotal = parsed.unknownTotal;

      const hasNext = parsed.unknownTotal ? (parsed.items.length === parsed.per) : (userState.page < userState.totalPages);
      const hasPrev = userState.page > 1;

      updateUserPager({ hasNext, hasPrev });

      log('User fetch ok:', { userId: userState.userId, page: userState.page, totalPages: userState.totalPages, items: parsed.items.length, unknownTotal: userState.unknownTotal });

      if (scrollTop) {
        const rect = userTable.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          userTable.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    } catch (e) {
      err('User fetch error:', e);
    }
  };

  if (userTable && userPager && !userPager.dataset.bound) {
    userPager.dataset.bound = '1';
    // Determine user id
    const fromAttr = userTable.getAttribute('data-user-id');
    const fromPath = (location.pathname.split('/')[2] || '').trim();
    userState.userId = fromAttr || fromPath || null;
    log('User pager init - userId:', userState.userId);

    const prevBtn = userPager.querySelector('button[data-page="prev"]');
    const nextBtn = userPager.querySelector('button[data-page="next"]');

    prevBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!userState.userId) return;
      const target = Math.max(1, userState.page - 1);
      log('User prev click:', { from: userState.page, to: target });
      if (target !== userState.page) fetchUserPage(target);
    });
    nextBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!userState.userId) return;
      const target = userState.unknownTotal ? (userState.page + 1) : Math.min(userState.totalPages, userState.page + 1);
      log('User next click:', { from: userState.page, to: target });
      if (target !== userState.page) fetchUserPage(target);
    });

    // Filters
    const form = userFilters ? userFilters.querySelector('form[data-filter-form]') : null;
    if (form) {
      form.addEventListener('change', () => { if (userState.userId) { log('User filters change -> page 1'); fetchUserPage(1, true); } });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (userState.userId) {
          log('User filters submit -> page 1');
          fetchUserPage(1, true);
          userFilters?.setAttribute('aria-hidden', 'true');
        }
      });
    }

    if (userState.userId) fetchUserPage(1, false);
  }

  // Autosuggest search remains unchanged
  const enhanceSearch = (input) => {
    if (!input) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'suggest-wrapper';
    wrapper.style.position = 'relative';
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(wrapper);

    const list = document.createElement('ul');
    list.className = 'suggest-list';
    list.style.position = 'absolute';
    list.style.top = '100%';
    list.style.left = '0';
    list.style.right = '0';
    list.style.zIndex = '20';
    list.style.listStyle = 'none';
    list.style.margin = '4px 0 0 0';
    list.style.padding = '0';
    list.style.background = 'var(--pico-background-color, #fff)';
    list.style.border = '1px solid var(--pico-muted-border-color, #e5e7eb)';
    list.style.borderRadius = '6px';
    list.style.boxShadow = '0 8px 20px rgba(0,0,0,0.08)';
    list.style.overflow = 'hidden';
    list.style.display = 'none';
    wrapper.appendChild(list);

    let idx = -1;
    let entries = [];
    let controller = null;

    const render = () => {
      list.innerHTML = '';
      entries.forEach((e, i) => {
        const li = document.createElement('li');
        li.style.margin = '0';
        li.style.padding = '8px 10px';
        li.style.cursor = 'pointer';
        li.style.background = i === idx ? 'var(--pico-muted-border-color, #f3f4f6)' : 'transparent';
        li.textContent = e.text;
        li.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          window.location.href = e.url;
        });
        list.appendChild(li);
      });
      list.style.display = entries.length ? 'block' : 'none';
    };

    const fetchSuggest = async (q) => {
      if (controller) controller.abort();
      controller = new AbortController();
      try {
        const resp = await fetch(`/db/search/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!resp.ok) return;
        const data = await resp.json();
        entries = Array.isArray(data.results) ? data.results : [];
        idx = -1;
        render();
      } catch (_) { /* ignore */ }
    };

    let debounce = null;
    input.addEventListener('input', (e) => {
      const q = input.value.trim();
      if (!q) { entries = []; idx = -1; render(); return; }
      clearTimeout(debounce);
      debounce = setTimeout(() => fetchSuggest(q), 120);
    });

    input.addEventListener('keydown', (e) => {
      if (!entries.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % entries.length; render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + entries.length) % entries.length; render(); }
      else if (e.key === 'Enter') {
        if (idx >= 0 && idx < entries.length) { e.preventDefault(); window.location.href = entries[idx].url; }
      } else if (e.key === 'Escape') { entries = []; idx = -1; render(); }
    });

    document.addEventListener('click', (ev) => {
      if (!wrapper.contains(ev.target)) { entries = []; idx = -1; render(); }
    });
  };

  document.querySelectorAll('input[type="search"][name="q"]').forEach(enhanceSearch);
});