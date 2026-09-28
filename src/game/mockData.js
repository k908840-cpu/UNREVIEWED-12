// Mock data for the UNREVIEWED visual prototype.

export const PRESET_AVATARS = [
  { id: "a1", emoji: "🦊", bg: "from-orange-400 to-red-500" },
  { id: "a2", emoji: "🐸", bg: "from-emerald-400 to-green-600" },
  { id: "a3", emoji: "👻", bg: "from-slate-300 to-slate-500" },
  { id: "a4", emoji: "🤡", bg: "from-fuchsia-400 to-pink-600" },
  { id: "a5", emoji: "👽", bg: "from-cyan-400 to-blue-600" },
  { id: "a6", emoji: "🦄", bg: "from-violet-400 to-purple-600" },
  { id: "a7", emoji: "💩", bg: "from-amber-500 to-yellow-700" },
  { id: "a8", emoji: "👹", bg: "from-rose-500 to-red-700" },
  { id: "a9", emoji: "🐧", bg: "from-sky-400 to-indigo-600" },
  { id: "a10", emoji: "🦖", bg: "from-lime-500 to-green-700" },
  { id: "a11", emoji: "🤠", bg: "from-amber-400 to-orange-600" },
  { id: "a12", emoji: "🧛", bg: "from-red-700 to-rose-900" },
];

// Five mock friends + the user (6 total). Photos use Unsplash portraits w/ face crop.
export const MOCK_PLAYERS = [
  {
    id: "p_sarah",
    nickname: "Sarah",
    photo: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop&crop=faces",
    isHost: false,
    isYou: false,
  },
  {
    id: "p_rahul",
    nickname: "Rahul",
    photo: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400&h=400&fit=crop&crop=faces",
    isHost: false,
    isYou: false,
  },
  {
    id: "p_alex",
    nickname: "Alex",
    photo: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=faces",
    isHost: false,
    isYou: false,
  },
  {
    id: "p_maya",
    nickname: "Maya",
    photo: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop&crop=faces",
    isHost: false,
    isYou: false,
  },
  {
    id: "p_kevin",
    nickname: "Kevin",
    photo: "https://images.unsplash.com/photo-1500648768231-9077f9c2a3c3?w=400&h=400&fit=crop&crop=faces",
    isHost: false,
    isYou: false,
  },
];

export const FAMILY_PROMPTS = [
  { id: "f1", mode: "family", category: "Hobby", text: "What completely normal hobby would become creepy if [NAME] did it?" },
  { id: "f2", mode: "family", category: "Social", text: "What's the most embarrassing thing [NAME] could yell at a wedding?" },
  { id: "f3", mode: "family", category: "Work", text: "If [NAME] hosted a children's TV show, what would it be called?" },
  { id: "f4", mode: "family", category: "Food", text: "What weird food combo would [NAME] defend with their life?" },
  { id: "f5", mode: "family", category: "Absurd", text: "What would [NAME]'s completely honest last words be?" },
  { id: "f6", mode: "family", category: "Romance", text: "What's [NAME]'s worst possible opening line on a dating app?" },
  { id: "f7", mode: "family", category: "Social", text: "What would [NAME] absolutely get arrested for?" },
  { id: "f8", mode: "family", category: "Hobby", text: "What talent does [NAME] think they have but absolutely don't?" },
  { id: "f9", mode: "family", category: "Absurd", text: "If [NAME] was a conspiracy theory, what would it be?" },
  { id: "f10", mode: "family", category: "Food", text: "What's [NAME]'s secret midnight snack shame?" },
  { id: "f11", mode: "family", category: "Work", text: "What would [NAME]'s TED talk be titled?" },
  { id: "f12", mode: "family", category: "Romance", text: "What illegal pet would [NAME] secretly keep?" },
];

export const ADULT_PROMPTS = [
  { id: "a1", mode: "adult", category: "Tech", text: "What's the worst thing [NAME] could accidentally text their boss?" },
  { id: "a2", mode: "adult", category: "Party", text: "What did [NAME] do at the party that nobody will ever speak of again?" },
  { id: "a3", mode: "adult", category: "Dark", text: "What's [NAME]'s darkest search history entry?" },
  { id: "a4", mode: "adult", category: "Absurd", text: "What would [NAME] do for a Klondike bar that they'd never admit?" },
  { id: "a5", mode: "adult", category: "Crime", text: "What's the most morally bankrupt thing [NAME] would do for $50?" },
  { id: "a6", mode: "adult", category: "Dark", text: "What's [NAME]'s worst habit that their therapist doesn't know about?" },
  { id: "a7", mode: "adult", category: "Social", text: "What would [NAME] get cancelled on the internet for?" },
  { id: "a8", mode: "adult", category: "Romance", text: "What's the most inappropriate thing [NAME] has said in bed?" },
  { id: "a9", mode: "adult", category: "Crime", text: "What crime would [NAME] commit if there were zero consequences?" },
  { id: "a10", mode: "adult", category: "Absurd", text: "What's [NAME]'s most questionable shower thought?" },
  { id: "a11", mode: "adult", category: "Party", text: "What's [NAME]'s go-to excuse for leaving a date early?" },
  { id: "a12", mode: "adult", category: "Tech", text: "What would [NAME]'s browser history reveal in court?" },
];

// Generic punchy one-liners with a hidden "quality" (1–5) that drives mock ratings.
export const ANSWER_POOL = [
  { text: "He'd promote his SoundCloud during the funeral.", q: 4.6 },
  { text: "Do it again. But louder.", q: 4.5 },
  { text: "Turn it into a 47-minute YouTube apology.", q: 4.4 },
  { text: "Demand a refund from God.", q: 4.3 },
  { text: "Cry. Immediately and without warning.", q: 4.2 },
  { text: "Post it on main. Tag nobody. Regret everything.", q: 4.1 },
  { text: "Start a podcast about it. Obviously.", q: 4.0 },
  { text: "Make it everyone else's problem.", q: 3.9 },
  { text: "Blame it on their childhood.", q: 3.8 },
  { text: "Turn it into a personality trait.", q: 3.8 },
  { text: "Insist it's a 'lifestyle brand' now.", q: 3.7 },
  { text: "Get a tattoo about it. A big one.", q: 3.6 },
  { text: "Claim they invented it.", q: 3.5 },
  { text: "Make it weird. Then weirder. Then leave.", q: 3.4 },
  { text: "Pretend they don't know you.", q: 3.3 },
  { text: "Write a LinkedIn post about resilience.", q: 3.2 },
  { text: "Apologize. To the wrong person.", q: 3.1 },
  { text: "Call their mom. She'd handle it.", q: 3.0 },
  { text: "Blame Mercury retrograde.", q: 2.9 },
  { text: "Live, laugh, lose.", q: 2.7 },
];

// Contextual comedy reaction lines. Engine picks based on result stats.
export const REACTION_LINES = {
  veryLow: [
    "The group has spoken. Unfortunately.",
    "A unanimous disaster. Beautiful, really.",
    "This answer has been reported to the authorities.",
  ],
  oneStar: [
    "Six people agreed this should never have been written.",
    "A historic low. Take a bow. Then take a seat.",
  ],
  perfect: [
    "We may have found the problem with this friend group.",
    "A perfect score. Suspicious. We're looking into it.",
    "Unanimous. The council has lost its mind.",
  ],
  predictedLowest: [
    "You know absolutely nothing about these people.",
    "Bold prediction. Catastrophically wrong.",
  ],
  closeSecond: [
    "Statistically hilarious. Emotionally devastated.",
    "A photo finish for second place. Ouch.",
  ],
  predictedCorrect: [
    "They know these people. Terrifying.",
    "Called it. We're concerned, but called it.",
  ],
  predictedWrong: [
    "Apparently {subject} doesn't know their friends.",
    "Wrong. Confidently, completely wrong.",
  ],
  midRound: [
    "Mid. Aggressively, defiantly mid.",
    "Forgettable. Like the person who wrote it.",
  ],
};

export const CHAT_SEED = [
  { id: "c1", playerId: "p_sarah", text: "who's ready to get roasted 😈", ts: Date.now() - 90000 },
  { id: "c2", playerId: "p_kevin", text: "not me that's for sure", ts: Date.now() - 75000 },
  { id: "c3", playerId: "p_maya", text: "let's gooooo", ts: Date.now() - 60000 },
];

export const FAKE_CHAT_LINES = [
  "this is gonna be brutal",
  "lol already regretting this",
  "i came here to win",
  "no mercy",
  "who picked adults only 😳",
  "my mom is in the next room",
  "rate me 5 stars or i cry",
  "i have no idea what i'm doing",
  "this prompt is illegal",
  "the timer is stressing me out",
];