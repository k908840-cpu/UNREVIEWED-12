// In-memory stand-in for the Base44 SDK, used to run the REAL room handler
// (base44/functions/room/entry.ts) offline. Every entity operation is counted.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

let loaderRegistered = false;
function registerSdkAlias() {
  if (loaderRegistered) return;
  loaderRegistered = true;
  // The handler imports the Deno-style specifier npm:@base44/sdk@x.y.z.
  register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('npm:@base44/sdk')) {
    return { url: 'data:text/javascript,' + encodeURIComponent('export const createClientFromRequest = (req) => globalThis.__fakeBase44(req);'), format: 'module', shortCircuit: true };
  }
  return next(specifier, context);
}`), import.meta.url);
}

const matches = (row, q) => Object.entries(q || {}).every(([k, v]) => row[k] === v);
const getPath = (obj, dotted) => dotted.split('.').reduce((cur, k) => (cur == null ? cur : cur[k]), obj);
function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  keys.slice(0, -1).forEach((k) => { if (cur[k] === undefined || cur[k] === null) cur[k] = {}; cur = cur[k]; });
  cur[keys.at(-1)] = value;
}

/**
 * @param {{ now?: () => number }} options  clock used for created_date and presence stamps
 */
export function createFakeBase44({ now = () => Date.now() } = {}) {
  const entityOps = {};
  const presenceWrites = new Map(); // session_id -> timestamps of last_seen writes
  const tables = { Room: [], RoomPlayer: [], Prompt: [] };
  let idSeq = 0;

  const countOp = (name, method) => { const key = `${name}.${method}`; entityOps[key] = (entityOps[key] || 0) + 1; };
  const isPlayerRow = (row) => row && row.room_code !== undefined && row.session_id !== undefined;
  const notePresence = (row, patch) => {
    if (isPlayerRow(row) && patch && Object.hasOwn(patch, 'last_seen')) {
      const list = presenceWrites.get(row.session_id) || [];
      list.push(now());
      presenceWrites.set(row.session_id, list);
    }
  };
  function applyUpdate(row, update) {
    if (Object.keys(update).some((k) => k.startsWith('$'))) {
      if (update.$push) for (const [p, v] of Object.entries(update.$push)) setPath(row, p, [...(getPath(row, p) || []), structuredClone(v)]);
      if (update.$set) for (const [p, v] of Object.entries(update.$set)) setPath(row, p, structuredClone(v));
      notePresence(row, update.$set);
    } else {
      Object.assign(row, structuredClone(update));
      notePresence(row, update);
    }
  }
  function entity(name) {
    return {
      async filter(q) { countOp(name, 'filter'); return tables[name].filter((r) => matches(r, q)).map((r) => structuredClone(r)); },
      async create(data) {
        countOp(name, 'create');
        const row = { id: `${name}-${++idSeq}`, created_date: new Date(now()).toISOString(), ...structuredClone(data) };
        tables[name].push(row);
        notePresence(row, data);
        return structuredClone(row);
      },
      async update(id, patch) {
        countOp(name, 'update');
        const row = tables[name].find((r) => r.id === id);
        if (!row) throw new Error(`${name} ${id} not found`);
        applyUpdate(row, patch);
        return structuredClone(row);
      },
      async updateMany(q, update) {
        countOp(name, 'updateMany');
        const hit = tables[name].filter((r) => matches(r, q));
        hit.forEach((r) => applyUpdate(r, update));
        return { updated: hit.length };
      },
      async delete(id) { countOp(name, 'delete'); tables[name] = tables[name].filter((r) => r.id !== id); return { ok: true }; },
      async deleteMany(q) { countOp(name, 'deleteMany'); tables[name] = tables[name].filter((r) => !matches(r, q)); return { ok: true }; },
    };
  }
  const entities = { Room: entity('Room'), RoomPlayer: entity('RoomPlayer'), Prompt: entity('Prompt') };
  globalThis.__fakeBase44 = () => ({ asServiceRole: { entities } });

  return {
    tables,
    entityOps,
    presenceWrites,
    totalOps: () => Object.values(entityOps).reduce((a, b) => a + b, 0),
    resetOps: () => { Object.keys(entityOps).forEach((k) => delete entityOps[k]); },
  };
}

/** Imports the real room handler with the SDK alias installed. */
export async function loadRoomHandler(backendPath) {
  registerSdkAlias();
  const mod = await import(pathToFileURL(backendPath).href);
  return mod.default;
}

/** Calls the handler like Base44 would and returns { status, data }. */
export async function callHandler(handler, body) {
  const res = await handler(new Request('http://local/functions/room', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
