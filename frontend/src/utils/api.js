/**
 * API wrappers used by active React pages.
 */

const INTERVIEWS_API_BASE = '/interviews/api';

export async function logout() {
  window.location.href = '/auth/logout';
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
