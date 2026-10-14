/**
 * The live four-player smoke test and the QA runner must never contact the
 * real Base44 backend unless the operator opts in explicitly.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.UNREVIEWED_QA_LIVE_MULTIPLAYER;
delete env.UNREVIEWED_QA_MULTIPLAYER;

// 1. The smoke script refuses to start without opt-in (exit 2, before importing
//    a browser or touching the network). A bogus base URL proves nothing is contacted.
const run = spawnSync(process.execPath, ['tests/multiplayer-smoke.mjs'], {
  cwd: ROOT, env: { ...env, UNREVIEWED_BASE_URL: 'http://127.0.0.1:9' }, encoding: 'utf8', timeout: 20000,
});
assert.equal(run.status, 2, `smoke script must refuse without opt-in (status ${run.status}, stderr: ${run.stderr})`);
assert.match(run.stderr, /UNREVIEWED_QA_LIVE_MULTIPLAYER=1/);

// 2. The QA runner only launches it when the variable is exactly "1", and passes
//    the opt-in through explicitly.
const qa = await readFile(path.join(ROOT, 'tests/android-qa.mjs'), 'utf8');
assert.match(qa, /process\.env\.UNREVIEWED_QA_LIVE_MULTIPLAYER !== "1"/, 'runner must default to skipping the live test');
assert.doesNotMatch(qa, /UNREVIEWED_QA_MULTIPLAYER === "0"/, 'the old opt-out (run by default) must be gone');
const skipBranch = qa.slice(qa.indexOf('UNREVIEWED_QA_LIVE_MULTIPLAYER !== "1"'));
assert.ok(skipBranch.indexOf('skip(') < skipBranch.indexOf('runNodeTest("live-multiplayer-smoke"'), 'the skip branch must come before the live launch');

// 3. Nothing else in the default npm scripts reaches the live backend.
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
for (const [name, cmd] of Object.entries(pkg.scripts)) {
  assert.doesNotMatch(cmd, /multiplayer-smoke/, `npm script "${name}" must not run the live smoke test directly`);
}
console.log('Live-test opt-in regression passed.');
