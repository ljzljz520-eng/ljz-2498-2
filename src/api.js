// 极简 fetch 封装
const j = (r) => r.json().then((b) => ({ ok: r.ok, status: r.status, body: b }));

export const api = {
  capabilities: () => fetch('/api/capabilities').then(j),
  sanitize: (html) => fetch('/api/sanitize', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html }),
  }).then(j),
  paste: (html, actor = 'editor-a') => fetch('/api/paste', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html, actor }),
  }).then(j),
  drafts: () => fetch('/api/drafts').then(j),
  draft: (id) => fetch(`/api/drafts/${id}`).then(j),
  saveDraft: (id, draft, actor, snapshotLabel) => fetch(`/api/drafts/${id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draft, actor, snapshotLabel }),
  }).then(j),
  migrate: (id, actor) => fetch(`/api/drafts/${id}/migrate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor }),
  }).then(j),
  restore: (id, snapshotId, actor) => fetch(`/api/drafts/${id}/snapshots/${snapshotId}/restore`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor }),
  }).then(j),
  covers: () => fetch('/api/covers').then(j),
  swapCover: (id, coverId, expectedVersion, actor) => fetch(`/api/drafts/${id}/cover`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ coverId, expectedVersion, actor }),
  }).then(j),
  assets: () => fetch('/api/assets').then(j),
  setAssetStatus: (id, status, actor = 'admin') => fetch(`/api/assets/${id}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, actor }),
  }).then(j),
  validate: (id, extra = {}) => fetch(`/api/drafts/${id}/validate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(extra),
  }).then(j),
  render: (id) => fetch(`/api/drafts/${id}/render`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
  }).then(j),
  previewImage: (id, actor = 'editor-a') => fetch(`/api/drafts/${id}/preview-image`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor }),
  }).then(j),
  exportDraft: (id, actor = 'editor-a') => fetch(`/api/drafts/${id}/export`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor }),
  }).then(j),
  audit: () => fetch('/api/audit').then(j),
};
