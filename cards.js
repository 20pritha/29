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

function shuffle(deck) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardLabel(card) {
  return card.rank + SUIT_SYMBOL[card.suit];
}
