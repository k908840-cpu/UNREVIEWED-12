// Host config persistence, [NAME] substitution, and guards for the Android client.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveRoomConfig } from '../src/game/saveRoomConfig.js';
import { fillPrompt } from '../src/lib/promptText.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(ROOT, file), 'utf8');
const httpError = (status, error) => Object.assign(new Error(`HTTP ${status}`), { status, data: error ? { error } : {} });
const noSleep = () => Promise.resolve();
const base = { code: 'ABCD', sessionId: 's1', membershipCapability: 'capability', mode: 'adult', length: 'standard', sleep: noSleep };

async function savedModeIsConfirmedBeforeContinuing() {
  const calls = [];
  const invoke = async (name, payload) => { calls.push({ name, payload }); return { room: { code: 'ABCD', mode: payload.mode, length: payload.length } }; };
  const result = await saveRoomConfig({ ...base, invoke });
  assert.equal(result.ok, true);
  assert.equal(result.room.mode, 'adult');
  assert.deepEqual(calls[0], { name: 'room', payload: { action: 'config', code: 'ABCD', sessionId: 's1', membership_capability: 'capability', mode: 'adult', length: 'standard' } });
}

async function wrappedSdkResponseRemainsSupported() {
  const result = await saveRoomConfig({
    ...base,
    invoke: async () => ({ data: { room: { code: 'ABCD', mode: 'adult', length: 'standard' } } }),
  });
  assert.equal(result.ok, true, 'the compatibility normalizer retains support for the historical wrapper');
}

async function transientFailureIsRetriedThenSucceeds() {
  let n = 0;
  const invoke = async () => {
    if (++n === 1) throw httpError(500, 'Rate limit exceeded');
    return { room: { mode: 'adult', length: 'standard' } };
  };
  const result = await saveRoomConfig({ ...base, invoke });
  assert.equal(result.ok, true);
  assert.equal(n, 2);
}

async function persistentFailureIsReportedNotSwallowed() {
  let n = 0;
  const failing = async () => { n++; throw httpError(500, 'boom'); };
  const result = await saveRoomConfig({ ...base, invoke: failing });
  assert.equal(result.ok, false, 'a failed save must not look successful');
  assert.equal(n, 2, 'one retry, then give up');
  assert.equal(result.error, 'boom');

  const network = await saveRoomConfig({ ...base, invoke: async () => { throw new Error('Network Error'); } });
  assert.equal(network.ok, false);
}

async function serverRefusalsAndUnconfirmedSavesFail() {
  let n = 0;
  const forbidden = await saveRoomConfig({ ...base, invoke: async () => { n++; throw httpError(403, 'forbidden'); } });
  assert.deepEqual([forbidden.ok, forbidden.error, n], [false, 'forbidden', 1], 'a 403 is not retried');
  const started = await saveRoomConfig({ ...base, invoke: async () => { throw httpError(409, 'in_progress'); } });
  assert.equal(started.error, 'in_progress');
  // 200 response that stored a different mode (e.g. stale server) is NOT success.
  const wrongMode = await saveRoomConfig({ ...base, invoke: async () => ({ room: { mode: 'family', length: 'standard' } }) });
  assert.deepEqual([wrongMode.ok, wrongMode.error], [false, 'config_not_saved']);
  const noRoom = await saveRoomConfig({ ...base, invoke: async () => ({}) });
  assert.equal(noRoom.ok, false);
  const missingCode = await saveRoomConfig({ ...base, code: '', invoke: async () => { throw new Error('should not be called'); } });
  assert.deepEqual([missingCode.ok, missingCode.error], [false, 'no_room']);
  const missingCapability = await saveRoomConfig({ ...base, membershipCapability: '', invoke: async () => { throw new Error('should not be called'); } });
  assert.deepEqual([missingCapability.ok, missingCapability.error], [false, 'missing_membership_capability']);
}

function nameSubstitutionIsLiteral() {
  assert.equal(fillPrompt('What would [NAME] do?', 'Sam'), 'What would Sam do?');
  assert.equal(fillPrompt('What would [NAME] do?', '$&'), 'What would $& do?', '"$&" is shown literally');
  assert.equal(fillPrompt('[NAME] vs [NAME]', "$1$'$`$$"), "$1$'$`$$ vs $1$'$`$$");
  assert.equal(fillPrompt('What would [NAME] do?', ''), 'What would [NAME] do?', 'no nickname keeps the existing [NAME] fallback');
  assert.equal(fillPrompt('What would [NAME] do?', undefined), 'What would [NAME] do?');
  assert.equal(fillPrompt(undefined, 'Sam'), '');
  assert.equal(fillPrompt('No placeholder', 'Sam'), 'No placeholder');
  assert.equal(fillPrompt('[NAME]\'s turn', 'Zoë 🎉'), 'Zoë 🎉\'s turn');
  // The old replacement would have mangled this:
  assert.notEqual('What would [NAME] do?'.replace(/\[NAME\]/g, '$&'), 'What would $& do?');
}

async function wiringIsInPlace() {
  const hostConfig = await read('src/pages/HostConfig.jsx');
  assert.match(hostConfig, /const result = await persistConfig\(mode, length\)/, 'HostConfig waits for the save');
  assert.ok(!/^\s*persistConfig\(mode, length\);/m.test(hostConfig), 'no fire-and-forget save');
  const gotoIdx = hostConfig.indexOf('goToProfile(); navigate("/profile")');
  assert.ok(hostConfig.indexOf('if (!result?.ok)') < gotoIdx && gotoIdx > 0, 'navigation happens only after a confirmed save');
  assert.match(hostConfig, /role="alert"/, 'failures are shown to the host');

  const context = await read('src/game/GameContext.jsx');
  const persist = context.slice(context.indexOf('const persistConfig'), context.indexOf('const kickPlayer'));
  assert.match(persist, /saveRoomConfig\(/);
  assert.ok(!/catch\s*\{\s*\/\*\s*non-critical/.test(persist), 'config errors are no longer swallowed');
  assert.ok(!/!isHost/.test(persist), 'host rights are decided by the server, not a stale client flag');

  for (const page of ['src/pages/Writing.jsx', 'src/pages/Rating.jsx']) {
    const source = await read(page);
    assert.match(source, /fillPrompt\(currentPrompt\?\.text, subject\?\.nickname\)/, `${page} uses fillPrompt`);
    assert.ok(!/replace\(\/\\\[NAME\\\]\/g, subject/.test(source), `${page} no longer uses a string replacement`);
  }
}

async function androidConnectionIsUntouched() {
  const client = await read('src/api/base44Client.js');
  assert.match(client, /window\.Capacitor\?\.isNativePlatform\?\.\(\) === true/);
  assert.match(client, /serverUrl: isCapacitorNative \? appBaseUrl : ''/);
  assert.match(client, /const \{ appId, token, functionsVersion, appBaseUrl \} = appParams;/);
  const capacitor = await read('capacitor.config.ts');
  assert.ok(capacitor.length > 0);
}

await savedModeIsConfirmedBeforeContinuing();
await wrappedSdkResponseRemainsSupported();
await transientFailureIsRetriedThenSucceeds();
await persistentFailureIsReportedNotSwallowed();
await serverRefusalsAndUnconfirmedSavesFail();
nameSubstitutionIsLiteral();
await wiringIsInPlace();
await androidConnectionIsUntouched();
console.log('Prompt config regressions passed.');
