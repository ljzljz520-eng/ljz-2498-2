const EDITOR_KEY = 'mp-editor-id';
export const editorId = localStorage.getItem(EDITOR_KEY) ||
  (() => { const id = 'editor-' + Math.random().toString(36).slice(2, 8); localStorage.setItem(EDITOR_KEY, id); return id; })();

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-editor-id': editorId,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, details: data.details });
  return data;
}

export const api = {
  capabilities: () => request('/api/capabilities'),
  sanitize: (html) => request('/api/sanitize', { method: 'POST', body: { html } }),
  createDocument: (title) => request('/api/documents', { method: 'POST', body: { title } }),
  getDocument: (id) => request(`/api/documents/${id}`),
  saveDocument: (id, content) => request(`/api/documents/${id}`, { method: 'PUT', body: content }),
  versions: (id) => request(`/api/documents/${id}/versions`),
  restoreVersion: (id, v) => request(`/api/documents/${id}/versions/${v}/restore`, { method: 'POST' }),
  recoverLegacy: (title, html) => request('/api/documents/legacy/recover', { method: 'POST', body: { title, html } }),
  listAssets: (kind) => request(`/api/assets${kind ? `?kind=${kind}` : ''}`),
  setAuth: (id, authorized, note) => request(`/api/assets/${id}/authorization`, { method: 'POST', body: { authorized, note } }),
  uploadAsset: (payload) => request('/api/assets', { method: 'POST', body: payload }),
  coverLock: (id) => request(`/api/documents/${id}/cover/lock`, { method: 'POST' }),
  coverUnlock: (id) => request(`/api/documents/${id}/cover/lock`, { method: 'DELETE' }),
  coverCandidates: (id) => request(`/api/documents/${id}/cover/candidates`),
  addCoverCandidate: (id, assetId, label) => request(`/api/documents/${id}/cover/candidates`, { method: 'POST', body: { assetId, label } }),
  selectCover: (id, assetId, expectedVersion, candidateId) =>
    request(`/api/documents/${id}/cover/select`, { method: 'POST', body: { assetId, expectedVersion, candidateId } }),
  preflight: (id) => request(`/api/documents/${id}/preflight`),
  doExport: (id, warningAck) => request(`/api/documents/${id}/export`, { method: 'POST', body: { warningAck } }),
  getExport: (jobId) => request(`/api/exports/${jobId}`),
  preview: (id, viewport) => request(`/api/documents/${id}/preview/${viewport}`),
};
