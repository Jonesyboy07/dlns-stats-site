/**
 * API wrapper for Wavebox endpoints
 */

const API_BASE = '/sounds/api';
const VO_API_BASE = '/vo/api';
const INTERVIEWS_API_BASE = '/interviews/api';

export async function fetchTree(path = '') {
  const url = new URL(`${API_BASE}/tree`, window.location.origin);
  if (path) url.searchParams.append('path', path);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch tree');
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

export async function fetchRandom() {
  const res = await fetch(`${API_BASE}/random`);
  if (!res.ok) throw new Error('Failed to fetch random');
  return res.json();
}

export async function getMe() {
  const res = await fetch(`${API_BASE}/me`);
  if (!res.ok) return { ok: false };
  const data = await res.json();
  return data;
}

export async function logout() {
  window.location.href = '/auth/logout';
}

export async function checkExists(path) {
  const url = new URL(`${API_BASE}/exists`, window.location.origin);
  url.searchParams.append('path', path);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to check exists');
  return res.json();
}

export async function uploadRecording(file, path) {
  const formData = new FormData();
  // Ensure the backend sees a valid audio extension; default to webm if unnamed
  const filename = (file && file.name) ? file.name : 'recording.webm';
  formData.append('file', file, filename);
  formData.append('path', path);
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

export async function acceptRecording(id) {
  const res = await fetch(`${API_BASE}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Accept failed');
  }
  return res.json();
}

export async function rejectRecording(id) {
  const res = await fetch(`${API_BASE}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Reject failed');
  }
  return res.json();
}

export async function getUploads() {
  // This endpoint doesn't exist yet - we'll add it to sound_viewer.py
  const res = await fetch(`${API_BASE}/uploads`);
  if (!res.ok) throw new Error('Failed to fetch uploads');
  return res.json();
}

export async function downloadAccepted() {
  const res = await fetch(`${API_BASE}/download-accepted`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Download failed');
  }
  return res.blob();
}

export async function downloadAll() {
  const res = await fetch(`${API_BASE}/download-all`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Download failed');
  }
  return res.blob();
}

export async function acceptAllPending() {
  const res = await fetch(`${API_BASE}/accept-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Accept-all failed');
  }
  return res.json();
}

export async function fetchAllStatuses() {
  const res = await fetch(`${API_BASE}/all-statuses`);
  if (!res.ok) throw new Error('Failed to fetch statuses');
  const data = await res.json();
  return data.statuses || {};
}

export async function fetchVoTasks() {
  const res = await fetch(`${VO_API_BASE}/tasks`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load VO tasks');
  return data.tasks || [];
}

export async function fetchVoContent() {
  const res = await fetch(`${VO_API_BASE}/content`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load VO content');
  return data.content || { html: '', assets: { zip: null, videos: [], artwork: [] } };
}

export async function saveVoContent(content) {
  const res = await fetch(`${VO_API_BASE}/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(content || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save VO content');
  return data.content;
}

// Progress-enabled save using XMLHttpRequest
export function saveVoContentWithProgress(content, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${VO_API_BASE}/content`);
      xhr.responseType = 'json';
      xhr.setRequestHeader('Content-Type', 'application/json');

      xhr.upload.onprogress = (e) => {
        try {
          if (onProgress) onProgress(e.loaded || 0, e.total || 0);
        } catch (_) {}
      };

      xhr.onload = () => {
        const data = xhr.response || {};
        if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
          resolve(data.content);
        } else {
          reject(new Error(data.error || 'Failed to save VO content'));
        }
      };
      xhr.onerror = () => reject(new Error('Network error while saving content'));

      xhr.send(JSON.stringify(content || {}));
    } catch (err) {
      reject(err);
    }
  });
}

export async function uploadVoFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const res = await fetch(`${VO_API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to upload file');
  return data.file;
}

// Progress-enabled upload using XMLHttpRequest
export function uploadVoFileWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${VO_API_BASE}/upload`);
      xhr.responseType = 'json';

      xhr.upload.onprogress = (e) => {
        try {
          if (onProgress) onProgress(e.loaded || 0, e.total || 0);
        } catch (_) {}
      };

      xhr.onload = () => {
        const data = xhr.response || {};
        if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
          resolve(data.file);
        } else {
          reject(new Error(data.error || 'Failed to upload file'));
        }
      };
      xhr.onerror = () => reject(new Error('Network error while uploading file'));

      const formData = new FormData();
      formData.append('file', file);
      xhr.send(formData);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Ranker API
 */
const RANK_API_BASE = '/rank/api';

export async function rankGetMe() {
  const res = await fetch(`${RANK_API_BASE}/me`);
  if (!res.ok) throw new Error('Failed to fetch me');
  return res.json();
}

export async function rankSubmit(rank) {
  const res = await fetch(`${RANK_API_BASE}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rank }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to submit rank');
  return data;
}

export async function rankListPlayers() {
  const res = await fetch(`${RANK_API_BASE}/players`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load players');
  return data;
}

export async function rankAssignTeam(id, team) {
  const res = await fetch(`${RANK_API_BASE}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, team }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to assign team');
  return data;
}

export async function rankClearAll() {
  const res = await fetch(`${RANK_API_BASE}/clear`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to clear');
  return data;
}

export async function rankRemovePlayer(id) {
  const res = await fetch(`${RANK_API_BASE}/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to remove player');
  return data;
}

/**
 * Interviews API
 */
export async function interviewsGetAccess() {
  const res = await fetch(`${INTERVIEWS_API_BASE}/access`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to check access');
  return data;
}

export async function interviewsList() {
  const res = await fetch(`${INTERVIEWS_API_BASE}/list`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load interviews');
  return data.entries || [];
}

export async function interviewsGetEntry(entryId) {
  const res = await fetch(`${INTERVIEWS_API_BASE}/entry/${encodeURIComponent(entryId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load interview');
  return data.entry || null;
}

export async function interviewsUpload({ title, guest, md_content, md_file }) {
  const formData = new FormData();
  formData.append('title', title || '');
  formData.append('guest', guest || '');
  formData.append('md_content', md_content || '');
  if (md_file) {
    formData.append('md_file', md_file, md_file.name || 'interview.md');
  }

  const res = await fetch(`${INTERVIEWS_API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to upload interview');
  return data.entry || null;
}

export async function interviewsUpdateEntry(entryId, payload) {
  const res = await fetch(`${INTERVIEWS_API_BASE}/entry/${encodeURIComponent(entryId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to update interview');
  return data.entry || null;
}

export async function interviewsDeleteEntry(entryId) {
  const res = await fetch(`${INTERVIEWS_API_BASE}/entry/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to delete interview');
  return data;
}

export async function interviewsListCustomLinks() {
  const res = await fetch(`${INTERVIEWS_API_BASE}/custom-links`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load custom links');
  return data.links || [];
}

export async function interviewsCreateCustomLink(alias, entryId) {
  const res = await fetch(`${INTERVIEWS_API_BASE}/custom-links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, entry_id: entryId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to create custom link');
  return data;
}

export async function interviewsDeleteCustomLink(alias) {
  const res = await fetch(`${INTERVIEWS_API_BASE}/custom-links/${encodeURIComponent(alias)}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to delete custom link');
  return data;
}
