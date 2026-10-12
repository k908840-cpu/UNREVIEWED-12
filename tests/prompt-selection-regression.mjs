import assert from 'node:assert/strict';
import {
  ADULT_FALLBACK,
  FAMILY_FALLBACK,
  selectPrompt,
} from '../base44/shared/game.ts';

assert.equal(FAMILY_FALLBACK.length, 24, 'Family fallback remains a substantial mixed-age collection');
assert.equal(ADULT_FALLBACK.length, 24, 'Adults fallback provides a distinct adults-only collection');
assert.ok(FAMILY_FALLBACK.every((prompt) => prompt.id.startsWith('fb_f')));
assert.ok(ADULT_FALLBACK.every((prompt) => prompt.id.startsWith('fb_a')));

let filterArguments;
const databasePrompts = [
  { prompt_key: 'adult-1', mode: 'adult', text: 'Adult database prompt', category: 'Dating' },
];
const fakeBase44 = {
  asServiceRole: {
    entities: {
      Prompt: {
        filter: async (filter) => {
          filterArguments = filter;
          return databasePrompts;
        },
      },
    },
  },
};

const fromAdultDatabase = await selectPrompt(fakeBase44, 'adult', [], null, []);
assert.deepEqual(filterArguments, { mode: 'adult', active: true }, 'backend requests only active prompts for the selected mode');
assert.equal(fromAdultDatabase.id, 'adult-1');
assert.equal(fromAdultDatabase.text, 'Adult database prompt');

const filterCalls = [];
const categoryBase44 = {
  asServiceRole: {
    entities: {
      Prompt: {
        filter: async (filter) => {
          filterCalls.push(filter);
          return [
            { prompt_key: 'used', mode: 'adult', text: 'Already used', category: 'Party' },
            { prompt_key: 'repeat-category', mode: 'adult', text: 'Same category', category: 'Party' },
            { prompt_key: 'fresh', mode: 'adult', text: 'Fresh category', category: 'Exes' },
          ];
        },
      },
    },
  },
};
const varied = await selectPrompt(categoryBase44, 'adult', ['used'], 'Party', []);
assert.equal(varied.id, 'fresh', 'selection avoids used prompts and the previous category when alternatives exist');
assert.deepEqual(filterCalls[0], { mode: 'adult', active: true });

const unavailableDatabase = {
  asServiceRole: { entities: { Prompt: { filter: async () => { throw new Error('database unavailable'); } } } },
};
const adultFallback = await selectPrompt(unavailableDatabase, 'adult', [], null, []);
const familyFallback = await selectPrompt(unavailableDatabase, 'family', [], null, []);
assert.ok(ADULT_FALLBACK.some((prompt) => prompt.id === adultFallback.id), 'adult fallback never crosses into Family prompts');
assert.ok(FAMILY_FALLBACK.some((prompt) => prompt.id === familyFallback.id), 'family fallback never crosses into Adults prompts');
assert.ok(!FAMILY_FALLBACK.some((prompt) => prompt.id === adultFallback.id));
assert.ok(!ADULT_FALLBACK.some((prompt) => prompt.id === familyFallback.id));

console.log('Prompt selection regressions passed.');
