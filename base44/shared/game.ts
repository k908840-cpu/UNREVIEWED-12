// Shared game logic used by the room backend function.
// All round state is authoritative — clients render this state, they never
// generate their own subject, prompt, answers, ratings, or scores.

import { activePlayers } from './rooms.ts';

export const PHASE_DURATIONS: Record<string, number> = {
  reveal: 5,
  writing: 30,
  rating: 10,
  prediction: 20,
};

export const LENGTH_CYCLES: Record<string, number> = {
  quick: 2,
  standard: 4,
  party: 5,
  endless: 6,
};

const rid = () => Math.random().toString(36).slice(2, 9);

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build a shuffled subject order: complete cycles, no back-to-back repeat
// between the last subject of one cycle and the first of the next.
export function buildSubjectOrder(playerIds: string[], cycles: number): string[] {
  const order: string[] = [];
  let last: string | null = null;
  for (let c = 0; c < cycles; c++) {
    const cycle = shuffle(playerIds);
    if (last && cycle[0] === last) {
      const swapIdx = cycle.findIndex((id) => id !== last);
      if (swapIdx > 0) [cycle[0], cycle[swapIdx]] = [cycle[swapIdx], cycle[0]];
    }
    cycle.forEach((id) => order.push(id));
    last = cycle[cycle.length - 1];
  }
  return order;
}

const FAMILY_FALLBACK = [
  { id: 'fb_f1', text: "What completely normal hobby would become creepy if [NAME] did it?", category: 'Hobby' },
  { id: 'fb_f2', text: "What's the most embarrassing thing [NAME] could yell at a wedding?", category: 'Social' },
  { id: 'fb_f3', text: "If [NAME] hosted a children's TV show, what would it be called?", category: 'Work' },
  { id: 'fb_f4', text: "What weird food combo would [NAME] defend with their life?", category: 'Food' },
  { id: 'fb_f5', text: "What would [NAME]'s completely honest last words be?", category: 'Absurd' },
  { id: 'fb_f6', text: "What's [NAME]'s worst possible opening line on a dating app?", category: 'Romance' },
];

const ADULT_FALLBACK = [
  { id: 'fb_a1', text: "What's the worst thing [NAME] could accidentally text their boss?", category: 'Tech' },
  { id: 'fb_a2', text: "What did [NAME] do at the party that nobody will ever speak of again?", category: 'Party' },
  { id: 'fb_a3', text: "What's [NAME]'s darkest search history entry?", category: 'Dark' },
  { id: 'fb_a4', text: "What would [NAME] do for a Klondike bar that they'd never admit?", category: 'Absurd' },
  { id: 'fb_a5', text: "What's the most morally bankrupt thing [NAME] would do for $50?", category: 'Crime' },
  { id: 'fb_a6', text: "What would [NAME] get cancelled on the internet for?", category: 'Social' },
];

export async function selectPrompt(
  base44: any,
  mode: string,
  usedIds: string[],
  lastCategory: string | null,
  subjectSeenCategories: string[],
): Promise<{ id: string; text: string; category: string }> {
  let pool: any[] = [];
  try {
    const rows = await base44.asServiceRole.entities.Prompt.filter({ mode, active: true });
    pool = (rows || []).map((r: any) => ({
      id: r.prompt_key || r.id,
      text: r.text,
      category: r.category || 'General',
    }));
  } catch { /* use fallback */ }

  if (!pool.length) pool = mode === 'adult' ? ADULT_FALLBACK : FAMILY_FALLBACK;

  const usedSet = new Set(usedIds);
  let candidates = pool.filter((p) => !usedSet.has(p.id));
  if (!candidates.length) candidates = pool.slice();

  const varied = candidates.filter((p) => p.category !== lastCategory);
  if (varied.length) candidates = varied;

  if (subjectSeenCategories.length) {
    const fresh = candidates.filter((p) => !subjectSeenCategories.includes(p.category));
    if (fresh.length) candidates = fresh;
  }

  if (!candidates.length) candidates = pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function computeResults(
  answers: any[],
  ratings: Record<string, Record<string, number>>,
  prediction: string | null,
  subjectId: string,
  prompt: any,
) {
  const ranked = answers.map((ans) => {
    const rmap = ratings[ans.id] || {};
    const vals = Object.values(rmap);
    const sum = vals.reduce((a: number, b: number) => a + b, 0);
    const count = vals.length;
    const avg = count ? sum / count : 0;
    const c5 = vals.filter((v: number) => v === 5).length;
    const c4 = vals.filter((v: number) => v === 4).length;
    return { id: ans.id, author: ans.author, text: ans.text, avg, count, c5, c4 };
  });

  ranked.sort((a, b) => b.avg - a.avg || b.c5 - a.c5 || b.c4 - a.c4);

  // Assign places with ties sharing the same placement
  const withPlace: any[] = [];
  let i = 0;
  while (i < ranked.length) {
    const group = [ranked[i]];
    let j = i + 1;
    while (j < ranked.length && ranked[j].avg === ranked[i].avg && ranked[j].c5 === ranked[i].c5 && ranked[j].c4 === ranked[i].c4) {
      group.push(ranked[j]);
      j++;
    }
    const place = i + 1;
    group.forEach((g) => withPlace.push({ ...g, place }));
    i = j;
  }

  const points: Record<string, number> = {};
  withPlace.forEach((r) => {
    if (r.place === 1) points[r.author] = (points[r.author] || 0) + 2;
    else if (r.place === 2) points[r.author] = (points[r.author] || 0) + 1;
  });
  const predictedTop = !!(prediction && withPlace[0] && prediction === withPlace[0].id);
  if (predictedTop) points[subjectId] = (points[subjectId] || 0) + 1;

  return { ranked: withPlace, points, prediction, predictedTop, subjectId, prompt };
}

export function deadlinePassed(gs: any, now: number): boolean {
  if (!gs.phase_deadline) return false;
  return Date.parse(gs.phase_deadline) <= now;
}

// Should the current phase auto-advance? (deadline expired OR all eligible
// players have submitted their answer/rating/prediction)
export function shouldAdvance(gs: any, activeIds: Set<string>, now: number): boolean {
  const phase = gs.phase;
  if (deadlinePassed(gs, now)) return true;

  if (phase === 'reveal') return false;

  if (phase === 'writing') {
    const eligible = [...activeIds].filter((id) => id !== gs.current_subject);
    if (eligible.length === 0) return false;
    const submitted = new Set((gs.answers || []).map((a: any) => a.author));
    return eligible.every((id) => submitted.has(id));
  }

  if (phase === 'rating') {
    const currentAnswer = (gs.answers || [])[gs.rating_index];
    if (!currentAnswer) return true;
    const eligible = [...activeIds].filter((id) => id !== gs.current_subject && id !== currentAnswer.author);
    if (eligible.length === 0) return false;
    const rated = new Set(Object.keys((gs.ratings || {})[currentAnswer.id] || {}));
    return eligible.every((id) => rated.has(id));
  }

  if (phase === 'prediction') {
    if ((gs.answers || []).length === 0) return false;
    return gs.prediction !== null;
  }

  return false;
}

// Advance the game state to the next phase / answer / round.
export async function doAdvance(base44: any, gs: any, activeIds: Set<string>, now: number): Promise<any> {
  const phase = gs.phase;
  const isoAhead = (secs: number) => new Date(now + secs * 1000).toISOString();

  if (phase === 'reveal') {
    return { ...gs, phase: 'writing', phase_deadline: isoAhead(PHASE_DURATIONS.writing), phase_duration: PHASE_DURATIONS.writing, answers: [], ratings: {} };
  }

  if (phase === 'writing') {
    const answers = gs.answers || [];
    if (answers.length === 0) {
      return { ...gs, phase: 'prediction', prediction: null, rating_index: 0, phase_deadline: isoAhead(PHASE_DURATIONS.prediction), phase_duration: PHASE_DURATIONS.prediction };
    }
    return { ...gs, phase: 'rating', rating_index: 0, phase_deadline: isoAhead(PHASE_DURATIONS.rating), phase_duration: PHASE_DURATIONS.rating };
  }

  if (phase === 'rating') {
    const nextIndex = gs.rating_index + 1;
    const answers = gs.answers || [];
    if (nextIndex < answers.length) {
      return { ...gs, rating_index: nextIndex, phase_deadline: isoAhead(PHASE_DURATIONS.rating), phase_duration: PHASE_DURATIONS.rating };
    }
    return { ...gs, phase: 'prediction', prediction: null, phase_deadline: isoAhead(PHASE_DURATIONS.prediction), phase_duration: PHASE_DURATIONS.prediction };
  }

  if (phase === 'prediction') {
    const results = computeResults(gs.answers || [], gs.ratings || {}, gs.prediction, gs.current_subject, gs.current_prompt);
    const newScores = { ...(gs.scores || {}) };
    Object.entries(results.points).forEach(([pid, pts]) => { newScores[pid] = (newScores[pid] || 0) + (pts as number); });
    return { ...gs, phase: 'results', results, scores: newScores, round_history: [...(gs.round_history || []), results], phase_deadline: null, phase_duration: 0 };
  }

  if (phase === 'results') {
    return { ...gs, phase: 'leaderboard', phase_deadline: null, phase_duration: 0 };
  }

  if (phase === 'leaderboard') {
    const nextRound = gs.round_index + 1;
    const totalRounds = (gs.subject_order || []).length;

    const startNextRound = async (subjectOrder: string[], roundIdx: number) => {
      const nextSubject = subjectOrder[roundIdx];
      const seenCats = (gs.subject_categories || {})[nextSubject] || [];
      const prompt = await selectPrompt(base44, gs.mode, gs.used_prompts || [], gs.current_prompt?.category || null, seenCats);
      return {
        ...gs,
        subject_order: subjectOrder,
        round_index: roundIdx,
        current_subject: nextSubject,
        current_prompt: { id: prompt.id, text: prompt.text, category: prompt.category },
        phase: 'reveal',
        phase_deadline: isoAhead(PHASE_DURATIONS.reveal),
        phase_duration: PHASE_DURATIONS.reveal,
        answers: [],
        ratings: {},
        prediction: null,
        results: null,
        used_prompts: [...(gs.used_prompts || []), prompt.id],
        subject_categories: { ...(gs.subject_categories || {}), [nextSubject]: [...seenCats, prompt.category] },
      };
    };

    if (nextRound < totalRounds) {
      return await startNextRound(gs.subject_order, nextRound);
    }

    if (gs.length === 'endless') {
      const playerIds = [...activeIds];
      const newOrder = buildSubjectOrder(playerIds, LENGTH_CYCLES.endless);
      const extendedOrder = [...(gs.subject_order || []), ...newOrder];
      return await startNextRound(extendedOrder, nextRound);
    }

    return { ...gs, phase: 'finished', phase_deadline: null, phase_duration: 0 };
  }

  return gs;
}

// Check if the phase should auto-advance and do so. Returns the (possibly
// updated) room record.
export async function tryAdvance(base44: any, Room: any, room: any, players: any[], now: number): Promise<any> {
  const gs = room.game_state;
  if (!gs) return room;
  const active = activePlayers(players, now);
  const activeIds = new Set(active.map((p) => p.session_id));
  if (!shouldAdvance(gs, activeIds, now)) return room;
  const newGs = await doAdvance(base44, gs, activeIds, now);
  if (!newGs || newGs === gs) return room;
  return await Room.update(room.id, { game_state: newGs });
}