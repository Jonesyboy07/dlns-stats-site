import React, { useEffect, useMemo, useState } from 'react';
import {
  interviewsGetAccess,
  interviewsGetEntry,
  interviewsList,
} from '../utils/api';

const styles = `
  .iv-wrap {
    min-height: 100vh;
    background: linear-gradient(135deg, #0b1116 0%, #0d1622 100%);
    color: #eaf2ff;
    padding: 28px 20px 48px;
    font-family: 'Segoe UI', Tahoma, sans-serif;
  }
  .iv-shell {
    max-width: 1100px;
    margin: 0 auto;
  }
  .iv-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 12px;
    margin-bottom: 18px;
  }
  .iv-head h1 {
    margin: 0;
    font-size: 2rem;
    letter-spacing: 0.3px;
  }
  .iv-sub {
    color: #9fb4cf;
    margin-top: 6px;
  }
  .iv-link {
    text-decoration: none;
    color: #071116;
    background: #5be0f3;
    border-radius: 10px;
    padding: 10px 14px;
    font-weight: 700;
  }
  .iv-controls {
    display: grid;
    grid-template-columns: 1fr 170px;
    gap: 10px;
    margin-bottom: 14px;
  }
  .iv-input, .iv-select {
    width: 100%;
    background: #13202f;
    border: 1px solid #22344a;
    color: #eaf2ff;
    border-radius: 10px;
    padding: 10px 12px;
  }
  .iv-grid {
    display: grid;
    grid-template-columns: 360px 1fr;
    gap: 14px;
  }
  .iv-list {
    max-height: calc(100vh - 220px);
    overflow: auto;
    border: 1px solid #22344a;
    border-radius: 12px;
    background: rgba(12, 20, 30, 0.88);
  }
  .iv-row {
    border: 0;
    border-bottom: 1px solid #1b2d42;
    background: transparent;
    color: inherit;
    width: 100%;
    text-align: left;
    padding: 12px;
    cursor: pointer;
  }
  .iv-row:hover { background: #162638; }
  .iv-row.active { background: #1d324a; }
  .iv-title { font-weight: 700; margin-bottom: 5px; }
  .iv-meta { color: #9fb4cf; font-size: 0.86rem; margin-bottom: 5px; }
  .iv-preview { color: #b8c9df; font-size: 0.88rem; }
  .iv-view {
    border: 1px solid #22344a;
    border-radius: 12px;
    background: rgba(12, 20, 30, 0.88);
    padding: 16px;
  }
  .iv-actions {
    display: flex;
    gap: 10px;
    margin-bottom: 12px;
  }
  .iv-btn {
    border: 1px solid #2b4661;
    background: #122334;
    color: #eaf2ff;
    border-radius: 8px;
    padding: 8px 12px;
    cursor: pointer;
    font-weight: 600;
  }
  .iv-content { line-height: 1.72; color: #eaf2ff; }
  .iv-content h1,.iv-content h2,.iv-content h3 { color: #5be0f3; }
  .iv-empty {
    color: #9fb4cf;
    padding: 16px;
    border: 1px dashed #2a4059;
    border-radius: 10px;
  }
  .iv-error {
    margin-bottom: 10px;
    background: #4a1b24;
    border: 1px solid #7c2b3a;
    color: #ffd5df;
    border-radius: 10px;
    padding: 10px 12px;
  }
  @media (max-width: 980px) {
    .iv-grid { grid-template-columns: 1fr; }
    .iv-list { max-height: 280px; }
    .iv-controls { grid-template-columns: 1fr; }
  }
`;

function initialEntryId() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] === 'interviews' && parts[1] !== 'upload') {
    return parts[1];
  }
  const qp = new URLSearchParams(window.location.search);
  return qp.get('entry') || '';
}

function formatIso(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function InterviewsPage() {
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(initialEntryId());
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [error, setError] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [canUpload, setCanUpload] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [listRes, accessRes] = await Promise.all([interviewsList(), interviewsGetAccess()]);
        const loadedEntries = Array.isArray(listRes) ? listRes : [];
        setEntries(loadedEntries);
        setCanUpload(Boolean(accessRes?.can_upload));

        if (!selectedId && loadedEntries.length > 0) {
          setSelectedId(String(loadedEntries[0].short_id || loadedEntries[0].id || ''));
        }
      } catch (err) {
        setError(err?.message || 'Failed to load interviews.');
      } finally {
        setLoadingList(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    (async () => {
      setLoadingEntry(true);
      try {
        const entry = await interviewsGetEntry(selectedId);
        setSelected(entry || null);

        const canonicalToken = String(entry?.short_id || selectedId || '');
        const newUrl = `/interviews/${canonicalToken}`;
        if (window.location.pathname !== newUrl) {
          window.history.replaceState({}, '', newUrl);
        }
      } catch (err) {
        setError(err?.message || 'Failed to load interview detail.');
      } finally {
        setLoadingEntry(false);
      }
    })();
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = [...entries];
    if (q) {
      list = list.filter((entry) =>
        String(entry.title || '').toLowerCase().includes(q)
        || String(entry.guest || '').toLowerCase().includes(q)
        || String(entry.preview || '').toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      if (sortBy === 'oldest') return String(a.created_at || '').localeCompare(String(b.created_at || ''));
      if (sortBy === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
      if (sortBy === 'guest') return String(a.guest || '').localeCompare(String(b.guest || ''));
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

    return list;
  }, [entries, search, sortBy]);

  const copyLink = async () => {
    if (!selected) return;
    const token = String(selected.short_id || selected.id || selectedId || '');
    if (!token) return;
    const url = `${window.location.origin}/interviews/${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch (_) {
      // no-op for unsupported clipboard contexts
    }
  };

  return (
    <div className="iv-wrap">
      <style>{styles}</style>
      <div className="iv-shell">
        <div className="iv-head">
          <div>
            <h1>Interviews by Sloan</h1>
            <div className="iv-sub">sioaney on Discord</div>
          </div>
          {canUpload ? <a className="iv-link" href="/interviews/upload">Manage Uploads</a> : null}
        </div>

        {error ? <div className="iv-error">{error}</div> : null}

        <div className="iv-controls">
          <input
            className="iv-input"
            type="search"
            placeholder="Search by title, guest, or snippet..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="iv-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title A-Z</option>
            <option value="guest">Guest A-Z</option>
          </select>
        </div>

        <div className="iv-grid">
          <div className="iv-list">
            {loadingList ? <div className="iv-empty">Loading interviews...</div> : null}
            {!loadingList && filtered.length === 0 ? <div className="iv-empty">No interviews match your search.</div> : null}
            {filtered.map((entry) => (
              <button
                key={entry.id}
                className={`iv-row ${selectedId === String(entry.short_id || entry.id) ? 'active' : ''}`}
                onClick={() => setSelectedId(String(entry.short_id || entry.id || ''))}
                type="button"
              >
                <div className="iv-title">{entry.title}</div>
                <div className="iv-meta">#{entry.short_id || '-'} | Guest: {entry.guest} | {formatIso(entry.created_at)} | {entry.word_count || 0} words</div>
                <div className="iv-preview">{entry.preview || 'No preview available.'}</div>
              </button>
            ))}
          </div>

          <div className="iv-view">
            {loadingEntry ? <div className="iv-empty">Loading entry...</div> : null}
            {!loadingEntry && !selected ? <div className="iv-empty">Pick an interview to read.</div> : null}
            {!loadingEntry && selected ? (
              <>
                <div className="iv-actions">
                  <button type="button" className="iv-btn" onClick={copyLink}>Copy direct link</button>
                  <a className="iv-btn" href="/interviews" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Back to list</a>
                </div>
                <h2 style={{ marginTop: 0 }}>{selected.title}</h2>
                <div className="iv-meta" style={{ marginBottom: '14px' }}>
                  Guest: {selected.guest} | Published: {formatIso(selected.created_at)}
                </div>
                <article className="iv-content" dangerouslySetInnerHTML={{ __html: selected.html || '' }} />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
