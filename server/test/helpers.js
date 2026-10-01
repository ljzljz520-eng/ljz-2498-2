import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { useDbFile } from '../src/store.js';
import { createApp } from '../src/app.js';

export function useTempData() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mpa-test-'));
  config.paths.dataDir = dir + '/';
  config.paths.uploadsDir = dir + '/uploads/';
  config.paths.exportsDir = dir + '/exports/';
  config.paths.previewsDir = dir + '/previews/';
  config.paths.dbFile = dir + '/db.json';
  useDbFile(dir + '/db.json');
  return dir;
}

export async function startServer() {
  useTempData();
  const app = await createApp();
  return await new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ base: `http://127.0.0.1:${port}`, server });
    });
  });
}

export async function api(base, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* noop */ }
  return { status: res.status, body: json };
}
