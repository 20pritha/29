// Card model for Twenty-Nine.
// Deck: 32 cards (7,8,9,10,J,Q,K,A in 4 suits).
// Trick rank (high -> low): J, 9, A, 10, K, Q, 8, 7
// Points: J=3, 9=2, A=1, 10=1, others=0. Total 28 + 1 for last trick = 29.

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];

const SUIT_SYMBOL = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const SUIT_COLOR = {
  spades: 'black',
  clubs: 'black',
  hearts: 'red',
  diamonds: 'red',
};

const RANKS = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];

// Higher number = stronger in a trick.
const TRICK_STRENGTH = {
  '7': 0,
  '8': 1,
  Q: 2,
  K: 3,
  '10': 4,
  A: 5,
  '9': 6,
  J: 7,
};

const CARD_POINTS = {
  J: 3,
  '9': 2,
  A: 1,
  '10': 1,
  K: 0,
  Q: 0,
  '8': 0,
  '7': 0,
};

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, id: rank + '-' + suit });
    }
  }
  return deck;
}

/**
 * Fisher-Yates shuffle. Accepts an injectable RNG so deals are reproducible
 * from a seed (needed for replays and "prove this deal was fair").
 * @param {Array} deck
 * @param {() => number} [rng] uniform [0,1) source; defaults to Math.random
 */
function shuffle(deck, rng) {
  const rand = rng || Math.random;
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deterministic PRNG (mulberry32) — same seed always yields the same sequence.
 * @param {number} seed @returns {() => number}
 */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cardLabel(card) {
  return card.rank + SUIT_SYMBOL[card.suit];
}
