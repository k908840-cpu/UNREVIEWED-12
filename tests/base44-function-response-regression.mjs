import assert from 'node:assert/strict';
import {
  functionErrorCode,
  functionErrorData,
  functionErrorStatus,
  normalizeFunctionResponse,
} from '../src/api/functionResponse.js';

const capability = 'test-capability-is-never-a-real-secret';
const createBody = {
  room: { code: 'ABCD', status: 'lobby', mode: 'family', length: 'standard' },
  membership_capability: capability,
};
const joinBody = {
  room: { code: 'ABCD', status: 'lobby', host_session: 'alpha' },
  player: { session_id: 'bravo', nickname: 'Bravo' },
  players: [
    { session_id: 'alpha', nickname: 'Alpha' },
    { session_id: 'bravo', nickname: 'Bravo' },
  ],
  membership_capability: capability,
};

for (const [label, body] of [['create', createBody], ['join', joinBody]]) {
  for (const [shape, response] of [['direct', body], ['wrapped', { data: body }]]) {
    const data = normalizeFunctionResponse(response);
    assert.equal(data, body, `${label} ${shape} response preserves the server payload`);
    assert.equal(data.room.code, 'ABCD');
    assert.equal(data.membership_capability, capability);
  }
}

assert.deepEqual(normalizeFunctionResponse(null), {});
assert.deepEqual(normalizeFunctionResponse('unexpected'), {});

const sdkError = Object.assign(new Error('rate limited'), {
  status: 500,
  data: { error: 'Rate limit exceeded', active: 4 },
});
assert.equal(functionErrorCode(sdkError), 'Rate limit exceeded');
assert.equal(functionErrorStatus(sdkError), 500);
assert.equal(functionErrorData(sdkError).active, 4);

const axiosStyleError = Object.assign(new Error('forbidden'), {
  response: { status: 403, data: { error: 'forbidden' } },
});
assert.equal(functionErrorCode(axiosStyleError), 'forbidden');
assert.equal(functionErrorStatus(axiosStyleError), 403);

console.log('Base44 function response regressions passed.');
