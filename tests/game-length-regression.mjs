import assert from 'node:assert/strict';
import {
  LENGTH_CYCLES,
  PHASE_DURATIONS,
  buildSubjectOrder,
  doAdvance,
} from '../base44/shared/game.ts';

const players = ['alpha', 'bravo', 'charlie', 'delta'];
const active = new Set(players);
const now = Date.parse('2026-10-12T00:00:00.000Z');
const base44 = {
  asServiceRole: {
    entities: {
      Prompt: {
        filter: async ({ mode, active: isActive }) => {
          assert.equal(isActive, true);
          return [{ prompt_key: `${mode}-prompt`, text: `${mode} prompt`, category: 'Test' }];
        },
      },
    },
  },
};

assert.deepEqual(LENGTH_CYCLES, { quick: 2, standard: 4, party: 5, endless: 6 });

for (const [length, cycles] of Object.entries(LENGTH_CYCLES)) {
  const order = buildSubjectOrder(players, cycles);
  assert.equal(order.length, players.length * cycles, `${length} creates one subject turn per player per cycle`);
  for (const player of players) {
    assert.equal(order.filter((id) => id === player).length, cycles, `${length} gives ${player} exactly ${cycles} subject turns`);
  }
  for (let index = 1; index < order.length; index += 1) {
    assert.notEqual(order[index], order[index - 1], `${length} never repeats a subject back-to-back`);
  }
}

const standardOrder = buildSubjectOrder(players, LENGTH_CYCLES.standard);
assert.equal(standardOrder.length, 16, 'four-player Standard has sixteen total rounds');

const movingToRoundTwo = await doAdvance(base44, {
  status: 'playing', mode: 'family', length: 'standard', round_index: 0,
  subject_order: standardOrder, current_subject: standardOrder[0],
  current_prompt: { id: 'family-prompt', text: 'family prompt', category: 'Test' },
  used_prompts: ['family-prompt'], subject_categories: {}, answers: [], ratings: {},
  prediction: null, results: {}, scores: {}, round_history: [], phase: 'leaderboard',
}, active, now);
assert.equal(movingToRoundTwo.phase, 'reveal', 'a non-final leaderboard advances to a reveal');
assert.equal(movingToRoundTwo.round_index, 1, 'the next round increments exactly once');
assert.equal(movingToRoundTwo.current_subject, standardOrder[1], 'the server-selected subject order controls Round 2');
assert.equal(movingToRoundTwo.phase_duration, PHASE_DURATIONS.reveal);

const finished = await doAdvance(base44, {
  ...movingToRoundTwo,
  phase: 'leaderboard',
  round_index: standardOrder.length - 1,
}, active, now);
assert.equal(finished.phase, 'finished', 'the final Standard leaderboard completes the game');
assert.equal(finished.phase_deadline, null, 'the finished game has no dangling deadline');

const endlessOrder = buildSubjectOrder(players, LENGTH_CYCLES.endless);
const extended = await doAdvance(base44, {
  status: 'playing', mode: 'adult', length: 'endless', round_index: endlessOrder.length - 1,
  subject_order: endlessOrder, current_subject: endlessOrder.at(-1),
  current_prompt: { id: 'adult-prompt', text: 'adult prompt', category: 'Test' },
  used_prompts: ['adult-prompt'], subject_categories: {}, answers: [], ratings: {},
  prediction: null, results: {}, scores: {}, round_history: [], phase: 'leaderboard',
}, active, now);
assert.equal(extended.phase, 'reveal', 'Endless never ends at its initial plan boundary');
assert.equal(extended.round_index, endlessOrder.length, 'Endless begins the next planned round');
assert.equal(extended.subject_order.length, endlessOrder.length * 2, 'Endless appends a complete additional cycle plan');

console.log('Game length regressions passed.');
