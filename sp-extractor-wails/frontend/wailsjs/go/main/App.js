// @ts-check
import { EventsEmit } from '../../runtime/runtime.js';

const isDesktop = typeof window !== 'undefined' && !!(window['go'] && window['go']['main'] && window['go']['main']['App']);

function getSessionId() {
  if (typeof window === 'undefined') return 'sess_default';
  let id = sessionStorage.getItem('spextractor_session_id');
  if (!id) {
    id = 'sess_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
    sessionStorage.setItem('spextractor_session_id', id);
  }
  return id;
}

async function apiRequest(endpoint, body = null, method = 'POST') {
  const headers = {
    'Content-Type': 'application/json',
    'X-Session-ID': getSessionId(),
  };
  const options = {
    method,
    headers,
  };
  if (body !== null) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${endpoint}`, options);
  if (!res.ok) {
    const text = await res.text();
    let errMessage = text;
    try {
      const json = JSON.parse(text);
      if (json.error) errMessage = json.error;
    } catch (_) {}
    throw new Error(errMessage || `Error ${res.status}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 2000);
}

export function CancelExport() {
  if (isDesktop) return window['go']['main']['App']['CancelExport']();
  return Promise.resolve();
}

export function CancelQuery() {
  if (isDesktop) return window['go']['main']['App']['CancelQuery']();
  return apiRequest('/cancel-query', {});
}

export function Connect(arg1) {
  if (isDesktop) return window['go']['main']['App']['Connect'](arg1);
  return apiRequest('/connect', arg1);
}

export function CountObjects(arg1, arg2) {
  if (isDesktop) return window['go']['main']['App']['CountObjects'](arg1, arg2);
  return apiRequest('/count-objects', { type: arg1, term: arg2 }).then(r => r.count);
}

export function DeleteConnection(arg1) {
  if (isDesktop) return window['go']['main']['App']['DeleteConnection'](arg1);
  try {
    const list = JSON.parse(localStorage.getItem('spextractor_saved_connections') || '[]');
    const filtered = list.filter(c => !(c.dbType === arg1.dbType && c.host === arg1.host && c.port === arg1.port && c.user === arg1.user && c.database === arg1.database));
    localStorage.setItem('spextractor_saved_connections', JSON.stringify(filtered));
  } catch (_) {}
  return Promise.resolve();
}

export function Disconnect() {
  if (isDesktop) return window['go']['main']['App']['Disconnect']();
  return apiRequest('/disconnect', {});
}

export function ExecuteQuery(arg1, arg2) {
  if (isDesktop) return window['go']['main']['App']['ExecuteQuery'](arg1, arg2);
  return apiRequest('/execute-query', { sql: arg1, maxRows: arg2 });
}

export async function ExportObjects(arg1) {
  if (isDesktop) return window['go']['main']['App']['ExportObjects'](arg1);
  const objects = (arg1 && arg1.objects) || [];
  const total = objects.length;
  EventsEmit('export:progress', { current: 1, total, percent: 15, name: 'Generando scripts SQL...' });

  try {
    const res = await fetch('/api/export-zip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': getSessionId(),
      },
      body: JSON.stringify({ objects }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = errText;
      try {
        const j = JSON.parse(errText);
        if (j.error) msg = j.error;
      } catch (_) {}
      EventsEmit('export:error', { error: msg });
      throw new Error(msg);
    }

    EventsEmit('export:progress', { current: total, total, percent: 90, name: 'Descargando archivo ZIP...' });
    const blob = await res.blob();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `spextractor_export_${dateStr}.zip`;
    downloadBlob(blob, filename);

    EventsEmit('export:done', { total, outDir: 'Descargas' });
    return null;
  } catch (err) {
    EventsEmit('export:error', { error: err.message });
    throw err;
  }
}

export function GenerateInsertScript(arg1) {
  if (isDesktop) return window['go']['main']['App']['GenerateInsertScript'](arg1);
  return apiRequest('/generate-insert-script', arg1).then(r => r.script);
}

export function GenerateTableScripts(arg1, arg2) {
  if (isDesktop) return window['go']['main']['App']['GenerateTableScripts'](arg1, arg2);
  return apiRequest('/generate-table-scripts', { schema: arg1, table: arg2 });
}

export function GetDefinition(arg1) {
  if (isDesktop) return window['go']['main']['App']['GetDefinition'](arg1);
  return apiRequest('/get-definition', arg1);
}

export function GetObjectText(arg1) {
  if (isDesktop) return window['go']['main']['App']['GetObjectText'](arg1);
  return apiRequest('/get-object-text', arg1).then(r => r.text);
}

export function GetSchemaModel(arg1, arg2, arg3) {
  if (isDesktop) return window['go']['main']['App']['GetSchemaModel'](arg1, arg2, arg3);
  return apiRequest('/get-schema-model', { schema: arg1, table: arg2, depth: arg3 });
}

export function IsConnected() {
  if (isDesktop) return window['go']['main']['App']['IsConnected']();
  return apiRequest('/is-connected', null, 'GET').then(r => r.connected);
}

export function ListDatabases(arg1) {
  if (isDesktop) return window['go']['main']['App']['ListDatabases'](arg1);
  return apiRequest('/list-databases', arg1);
}

export function ListObjects(arg1, arg2, arg3) {
  if (isDesktop) return window['go']['main']['App']['ListObjects'](arg1, arg2, arg3);
  return apiRequest('/list-objects', { type: arg1, term: arg2, limit: arg3 });
}

export function LoadConnections() {
  if (isDesktop) return window['go']['main']['App']['LoadConnections']();
  try {
    const list = JSON.parse(localStorage.getItem('spextractor_saved_connections') || '[]');
    return Promise.resolve(list);
  } catch (_) {
    return Promise.resolve([]);
  }
}

export async function OpenObject(arg1) {
  if (isDesktop) return window['go']['main']['App']['OpenObject'](arg1);
  const text = await GetObjectText(arg1);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const name = `${arg1.schema ? arg1.schema + '_' : ''}${arg1.name}.sql`;
  downloadBlob(blob, name);
  return null;
}

export function PickDirectory() {
  if (isDesktop) return window['go']['main']['App']['PickDirectory']();
  return Promise.resolve('Descargas (.zip)');
}

export function SaveConnection(arg1) {
  if (isDesktop) return window['go']['main']['App']['SaveConnection'](arg1);
  try {
    const list = JSON.parse(localStorage.getItem('spextractor_saved_connections') || '[]');
    const filtered = list.filter(c => !(c.dbType === arg1.dbType && c.host === arg1.host && c.port === arg1.port && c.user === arg1.user && c.database === arg1.database));
    filtered.unshift(arg1);
    localStorage.setItem('spextractor_saved_connections', JSON.stringify(filtered.slice(0, 50)));
  } catch (_) {}
  return Promise.resolve();
}

export async function SaveObject(arg1) {
  if (isDesktop) return window['go']['main']['App']['SaveObject'](arg1);
  const text = await GetObjectText(arg1);
  const blob = new Blob([text], { type: 'text/sql;charset=utf-8' });
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = arg1.type ? arg1.type.toUpperCase() : 'SQL';
  const name = `${dateStr}_${prefix}_${arg1.schema ? arg1.schema + '_' : ''}${arg1.name}.sql`;
  downloadBlob(blob, name);
  return name;
}

export function SaveScript(arg1, arg2) {
  if (isDesktop) return window['go']['main']['App']['SaveScript'](arg1, arg2);
  const blob = new Blob([arg2 || ''], { type: 'text/sql;charset=utf-8' });
  const filename = arg1 || 'script.sql';
  downloadBlob(blob, filename);
  return Promise.resolve(filename);
}

export function SearchTables(arg1, arg2) {
  if (isDesktop) return window['go']['main']['App']['SearchTables'](arg1, arg2);
  return apiRequest('/search-tables', { term: arg1, limit: arg2 });
}
