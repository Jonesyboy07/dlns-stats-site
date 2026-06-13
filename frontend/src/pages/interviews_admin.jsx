import React, { useEffect, useMemo, useState } from 'react';
import {
  interviewsDeleteEntry,
  interviewsGetAccess,
  interviewsGetEntry,
  interviewsList,
  interviewsUpdateEntry,
  interviewsUpload,
} from '../utils/api';

const styles = `
  .ia-wrap {
    min-height: 100vh;
    background: linear-gradient(130deg, #0f1219 0%, #151425 100%);
    color: #f2f5ff;
    padding: 24px 20px 48px;
    font-family: 'Segoe UI', Tahoma, sans-serif;
  }
  .ia-shell { max-width: 1200px; margin: 0 auto; }
  .ia-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    margin-bottom: 14px;
  }
  .ia-head h1 { margin: 0; }
  .ia-link {
    text-decoration: none;
    color: #0a1220;
    background: #7ef0b0;
    border-radius: 10px;
    padding: 10px 14px;
    font-weight: 700;
  }
  .ia-grid {
    display: grid;
    grid-template-columns: 360px 1fr;
    gap: 14px;
  }
  .ia-panel {
    border: 1px solid #2e3153;
    border-radius: 12px;
    background: rgba(17, 20, 34, 0.9);
    padding: 14px;
  }
  .ia-list { max-height: calc(100vh - 220px); overflow: auto; }
  .ia-item {
    width: 100%;
    text-align: left;
    background: #1a1e34;
    border: 1px solid #2e3153;
    border-radius: 10px;
    color: #f2f5ff;
    padding: 10px;
    margin-bottom: 8px;
    cursor: pointer;
  }
  .ia-item.active { background: #243052; border-color: #4a5ea0; }
  .ia-meta { color: #b8bfe0; font-size: 0.84rem; margin-top: 4px; }
  .ia-form { display: grid; gap: 10px; }
  .ia-input, .ia-text, .ia-file {
    width: 100%;
    background: #12162a;
    border: 1px solid #2e3153;
    color: #f2f5ff;
    border-radius: 10px;
    padding: 10px 12px;
  }
  .ia-text {
    min-height: 300px;
    resize: vertical;
    font-family: Consolas, 'Courier New', monospace;
    line-height: 1.55;
  }
  .ia-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .ia-actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .ia-btn {
    border: 1px solid #3b4577;
    border-radius: 10px;
    padding: 9px 12px;
    color: #f2f5ff;
    background: #202a48;
    cursor: pointer;
    font-weight: 700;
  }
  .ia-btn.primary { background: #6edca6; color: #07181f; border-color: #6edca6; }
  .ia-btn.warn { background: #e96e7f; color: #22050b; border-color: #e96e7f; }
  .ia-info {
    color: #b8bfe0;
    font-size: 0.88rem;
  }
  .ia-alert {
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  .ia-alert.error { background: #511f2f; border: 1px solid #8a2f49; color: #ffdce5; }
  .ia-alert.ok { background: #1f4c39; border: 1px solid #2d7e5b; color: #d8ffec; }
  .ia-preview {
    border: 1px solid #2e3153;
    border-radius: 10px;
    background: #0f1525;
    padding: 12px;
    line-height: 1.7;
    margin-top: 10px;
  }
  @media (max-width: 1000px) {
    .ia-grid { grid-template-columns: 1fr; }
    .ia-list { max-height: 260px; }
    .ia-row { grid-template-columns: 1fr; }
  }
`;

function formatIso(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}


function titleFromFilename(filename) {
  const base = String(filename || '').replace(/\.md$/i, '');
  const clean = base.replace(/[_-]+/g, ' ').trim();
  if (!clean) return 'Interview';
  return clean.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function InterviewsAdminPage() {
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState('');
  const [guest, setGuest] = useState('');
  const [mdContent, setMdContent] = useState('');
  const [mdFile, setMdFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [okMessage, setOkMessage] = useState('');
  const [canUpload, setCanUpload] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [access, list] = await Promise.all([interviewsGetAccess(), interviewsList()]);
        setCanUpload(Boolean(access?.can_upload));
        setEntries(Array.isArray(list) ? list : []);
      } catch (err) {
        setError(err?.message || 'Failed to load admin data.');
      }
    })();
  }, []);

  const stats = useMemo(() => {
    const words = mdContent.trim() ? mdContent.trim().split(/\s+/).filter(Boolean).length : 0;
    return { words, chars: mdContent.length };
  }, [mdContent]);

  const clearForm = () => {
    setSelectedId('');
    setTitle('');
    setGuest('');
    setMdContent('');
    setMdFile(null);
  };

  const refreshList = async (preserveSelection = true) => {
    const list = await interviewsList();
    setEntries(Array.isArray(list) ? list : []);
    if (preserveSelection && selectedId) {
      const stillExists = (list || []).some((entry) => entry.id === selectedId);
      if (!stillExists) clearForm();
    }
  };

  const selectEntry = async (entryId) => {
    setError('');
    setOkMessage('');
    setBusy(true);
    try {
      const full = await interviewsGetEntry(entryId);
      setSelectedId(entryId);
      setTitle(full?.title || '');
      setGuest(full?.guest || '');
      setMdContent(full?.markdown || '');
      setMdFile(null);
    } catch (err) {
      setError(err?.message || 'Failed to load interview.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    setError('');
    setOkMessage('');

    if (!mdFile && !title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!mdFile && !guest.trim()) {
      setError('Guest is required.');
      return;
    }
    if (!mdFile && !mdContent.trim()) {
      setError('Add markdown text or upload a .md file.');
      return;
    }

    setBusy(true);
    try {
      const created = await interviewsUpload({
        title: title.trim(),
        guest: guest.trim(),
        md_content: mdContent,
        md_file: mdFile,
      });
      await refreshList(false);
      if (created?.id) {
        await selectEntry(created.id);
      }
      setOkMessage('Interview published.');
    } catch (err) {
      setError(err?.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedId) {
      setError('Select an interview to update.');
      return;
    }

    setError('');
    setOkMessage('');
    setBusy(true);
    try {
      await interviewsUpdateEntry(selectedId, {
        title: title.trim(),
        guest: guest.trim(),
        md_content: mdContent,
      });
      await refreshList();
      setOkMessage('Interview updated.');
    } catch (err) {
      setError(err?.message || 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) {
      setError('Select an interview to delete.');
      return;
    }
    if (!window.confirm('Delete this interview? This removes the markdown file too.')) return;

    setError('');
    setOkMessage('');
    setBusy(true);
    try {
      await interviewsDeleteEntry(selectedId);
      await refreshList(false);
      clearForm();
      setOkMessage('Interview deleted.');
    } catch (err) {
      setError(err?.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!canUpload) {
    return (
      <div className="ia-wrap">
        <style>{styles}</style>
        <div className="ia-shell">
          <h1>Interviews Admin</h1>
          <div className="ia-alert error">You do not have permission to manage interviews.</div>
          <a className="ia-link" href="/auth/login">Login with Discord</a>
        </div>
      </div>
    );
  }

  return (
    <div className="ia-wrap">
      <style>{styles}</style>
      <div className="ia-shell">
        <div className="ia-head">
          <h1>Interviews Admin</h1>
          <a className="ia-link" href="/interviews">View Public Page</a>
        </div>

        {error ? <div className="ia-alert error">{error}</div> : null}
        {okMessage ? <div className="ia-alert ok">{okMessage}</div> : null}

        <div className="ia-grid">
          <div className="ia-panel">
            <div style={{ marginBottom: '10px', fontWeight: 700 }}>Existing Interviews</div>
            <div className="ia-list">
              {entries.length === 0 ? <div className="ia-info">No interviews yet.</div> : null}
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  className={`ia-item ${entry.id === selectedId ? 'active' : ''}`}
                  type="button"
                  onClick={() => selectEntry(entry.id)}
                  disabled={busy}
                >
                  <div style={{ fontWeight: 700 }}>{entry.title}</div>
                  <div className="ia-meta">Guest: {entry.guest}</div>
                  <div className="ia-meta">{formatIso(entry.created_at)} | {entry.word_count || 0} words</div>
                </button>
              ))}
            </div>
          </div>

          <div className="ia-panel">
            <div style={{ marginBottom: '10px', fontWeight: 700 }}>
              {selectedId ? 'Edit Interview' : 'Create Interview'}
            </div>
            <div className="ia-form">
              <div className="ia-row">
                <input className="ia-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
                <input className="ia-input" value={guest} onChange={(e) => setGuest(e.target.value)} placeholder="Guest" />
              </div>

              <input
                className="ia-file"
                type="file"
                accept=".md,text/markdown,text/plain"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setMdFile(file);
                  if (file && !title.trim()) {
                    setTitle(titleFromFilename(file.name));
                  }
                }}
              />
              <div className="ia-info">Optional file upload. For direct .md uploads, title/guest can be left blank and defaults will be applied.</div>

              <textarea
                className="ia-text"
                value={mdContent}
                onChange={(e) => setMdContent(e.target.value)}
                placeholder="# Interview title\n\nWrite markdown here..."
              />

              <div className="ia-info">{stats.words} words | {stats.chars} characters</div>

              <div className="ia-actions">
                <button className="ia-btn" type="button" onClick={() => setMdContent((prev) => `${prev}${prev ? '\n\n' : ''}## Questions\n- Q:\n- A:`)}>
                  Insert Q&A scaffold
                </button>
                <button className="ia-btn" type="button" onClick={() => setMdContent((prev) => `${prev}${prev ? '\n\n' : ''}---\n\n> End of interview.`)}>
                  Insert footer
                </button>
                <button className="ia-btn" type="button" onClick={clearForm} disabled={busy}>Clear</button>
              </div>

              <div className="ia-actions">
                <button className="ia-btn primary" type="button" onClick={handleCreate} disabled={busy}>Publish New</button>
                <button className="ia-btn" type="button" onClick={handleUpdate} disabled={busy || !selectedId}>Save Changes</button>
                <button className="ia-btn warn" type="button" onClick={handleDelete} disabled={busy || !selectedId}>Delete</button>
              </div>

              <div className="ia-preview" dangerouslySetInnerHTML={{ __html: (mdContent || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br />') }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
