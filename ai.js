/**
 * @file Heuristic bot for Twenty-Nine. Pure, rule-based decisions over the
 * shared `Game` state — no network, no randomness beyond a small bidding jitter.
 *
 * Summary: given a seat, the bot decides how to **bid**, which suit to name as
 * **trump**, and which card to **play**. Play uses lightweight "card memory"
 * (`Game.playedLog`, `Game.voids`) to recognise guaranteed winners, feed point
 * cards to its partner only when safe, and ruff opponents' point tricks. It aims
 * for a strong-but-beatable game, not perfect play.
 *
 * Relies on globals from cards.js (`TRICK_STRENGTH`, `CARD_POINTS`, `RANKS`) and
 * game.js (`Game`, `MIN_BID`, `MAX_BID`).
 *
 * @typedef {{ suit: string, rank: string, id: string }} Card
 * @typedef {{ seat: number, card: Card }} Play
 * @typedef {{ G: object, seat: number, seen: Set<string> }} Memory
 */

const AI = {};

/** Per-rank weight for estimating a 4-card hand's bidding value. @type {Record<string,number>} */
const BID_WEIGHT = { J: 5, '9': 4, A: 3, '10': 2, K: 1, Q: 0.5, '8': 0, '7': 0 };

/** @param {Card} c @returns {number} trick strength (higher wins). */
function strengthOf(c) { return TRICK_STRENGTH[c.rank]; }
/** @param {Card} c @returns {number} point value of the card. */
function pointsOf(c) { return CARD_POINTS[c.rank]; }

// ---- selection helpers ----
// One generic single-pass selector replaces three near-identical pickers.
// `isBetter(a, b)` is a strict comparator: true iff `a` should be preferred
// over the current best `b`. Ties (neither strictly better) keep the earliest
// element, matching the previous stable-sort-then-[0] behaviour. O(n), no copy.

/**
 * @template T
 * @param {T[]} items
 * @param {(a: T, b: T) => boolean} isBetter
 * @returns {T|null} the preferred item, or null if `items` is empty.
 */
function pick(items, isBetter) {
  let best = null;
  for (const it of items) if (best === null || isBetter(it, best)) best = it;
  return best;
}
const lowerStrength = (a, b) => strengthOf(a) < strengthOf(b);
const lowerValue = (a, b) =>
  pointsOf(a) < pointsOf(b) || (pointsOf(a) === pointsOf(b) && strengthOf(a) < strengthOf(b));
const higherPoint = (a, b) =>
  pointsOf(a) > pointsOf(b) || (pointsOf(a) === pointsOf(b) && strengthOf(a) < strengthOf(b));
const bestWinner = (a, b) =>
  pointsOf(a) > pointsOf(b) || (pointsOf(a) === pointsOf(b) && strengthOf(a) > strengthOf(b));

/** Weakest card. @param {Card[]} cards @returns {Card|null} */
const lowestStrength = (cards) => pick(cards, lowerStrength);
/** Fewest points, then weakest — safest to discard. @param {Card[]} cards @returns {Card|null} */
const lowestValue = (cards) => pick(cards, lowerValue);
/** Most points, keeping strong cards — best to hand to partner. @param {Card[]} cards @returns {Card|null} */
const highestPoint = (cards) => pick(cards, higherPoint);

/**
 * Does card `a` beat card `b` in the current trick?
 * @param {Card} a @param {Card} b
 * @param {string} ledSuit  suit that led the trick
 * @param {boolean} trumpActive  whether trump has been revealed (active)
 * @param {string} trumpSuit
 * @returns {boolean}
 */
function beats(a, b, ledSuit, trumpActive, trumpSuit) {
  const at = trumpActive && a.suit === trumpSuit;
  const bt = trumpActive && b.suit === trumpSuit;
  if (at !== bt) return at;                       // trump beats non-trump
  if (at) return strengthOf(a) > strengthOf(b);   // both trump: higher wins
  const al = a.suit === ledSuit, bl = b.suit === ledSuit;
  if (al !== bl) return al;                        // led suit beats off-suit
  if (!al) return false;                           // both off-suit: a can't win
  return strengthOf(a) > strengthOf(b);            // both led suit: higher wins
}

/**
 * Which play is currently winning the trick so far.
 * @param {Play[]} plays @param {string} ledSuit
 * @param {boolean} trumpActive @param {string} trumpSuit
 * @returns {Play|null}
 */
function currentBest(plays, ledSuit, trumpActive, trumpSuit) {
  let best = null;
  for (const p of plays) {
    if (best === null || beats(p.card, best.card, ledSuit, trumpActive, trumpSuit)) best = p;
  }
  return best;
}

// ---- card memory (uses Game.playedLog + Game.voids) ----

/**
 * Build the set of card ids this seat can already account for (its own hand +
 * everything played this hand). Computed ONCE per decision so `outstanding` /
 * `isBoss` become cheap set lookups instead of rebuilding the set each call.
 * @param {object} G @param {number} seat @returns {Memory}
 */
function makeMemory(G, seat) {
  const seen = new Set(G.players[seat].hand.map((c) => c.id));
  for (const p of G.playedLog || []) seen.add(p.card.id);
  return { G, seat, seen };
}

/**
 * Ranks of `suit` not yet accounted for — i.e. cards that may still sit in
 * other players' hands.
 * @param {Memory} mem @param {string} suit @returns {string[]} ranks
 */
function outstanding(mem, suit) {
  const res = [];
  for (const rank of RANKS) if (!mem.seen.has(rank + '-' + suit)) res.push(rank);
  return res;
}

/**
 * Is `card` the highest of its suit still live — a guaranteed suit winner?
 * @param {Memory} mem @param {Card} card @returns {boolean}
 */
function isBoss(mem, card) {
  const s = TRICK_STRENGTH[card.rank];
  return outstanding(mem, card.suit).every((r) => TRICK_STRENGTH[r] < s);
}

/**
 * Has either opponent already shown void in `suit` (so they could ruff it)?
 * @param {object} G @param {number} seat @param {string} suit @returns {boolean}
 */
function oppVoid(G, seat, suit) {
  const v = G.voids || [{}, {}, {}, {}];
  return !!(v[(seat + 1) % 4][suit] || v[(seat + 3) % 4][suit]);
}

// ---- Bidding ----

/**
 * Estimate a 4-card hand's bidding value: weighted high cards + a small bonus
 * for a long suit (good trump potential).
 * @param {Card[]} hand @returns {number}
 */
AI.handValue = function (hand) {
  let pts = 0;
  const suitCount = {};
  for (const c of hand) {
    pts += BID_WEIGHT[c.rank];
    suitCount[c.suit] = (suitCount[c.suit] || 0) + 1;
  }
  const lens = Object.values(suitCount);
  const maxLen = lens.length ? Math.max(...lens) : 0; // guard: empty hand → 0
  const lenBonus = maxLen > 2 ? (maxLen - 2) : 0;
  return pts + lenBonus;
};

/**
 * Decide this seat's bid: raise to the minimum next bid if the hand is worth
 * it, else pass. Only 4 cards are known, so stay conservative.
 * @param {number} seat @returns {{action:'bid', amount:number}|{action:'pass'}}
 */
AI.bid = function (seat) {
  const G = Game;
  const val = AI.handValue(G.players[seat].hand);
  const jitter = Math.random() < 0.5 ? 0 : 1;              // breaks ties between bots
  let willingMax = 11 + Math.round(val * 0.55) + jitter;
  willingMax = Math.max(MIN_BID - 1, Math.min(willingMax, 23));
  const minNext = Math.max(MIN_BID, G.highBid + 1);
  if (minNext <= MAX_BID && willingMax >= minNext) return { action: 'bid', amount: minNext };
  return { action: 'pass' };
};

// ---- Trump choice ----

/**
 * Pick trump: the suit with the most cards, then most combined strength.
 * @param {number} seat @returns {string|null} trump suit
 */
AI.chooseTrump = function (seat) {
  const G = Game;
  const hand = G.players[seat].hand;
  const choices = G.trumpChoices();
  let best = null, bestScore = -1;
  for (const suit of choices) {
    const cards = hand.filter((c) => c.suit === suit);
    const score = cards.length * 4 + cards.reduce((s, c) => s + strengthOf(c), 0);
    if (score > bestScore) { bestScore = score; best = suit; }
  }
  return best;
};

// ---- Card play ----

/**
 * Choose a card (and whether to reveal trump) for this seat's turn.
 * @param {number} seat
 * @returns {{ reveal: boolean, cardId: string }}
 */
AI.play = function (seat) {
  const G = Game;
  const hand = G.players[seat].hand;
  const ledSuit = G.ledSuit;
  const trumpS = G.trumpSuit;
  const revealed = G.trumpRevealed;
  const partner = (seat + 2) % 4;
  const legal = G.legalCards(seat);
  const knowsTrump = seat === G.highBidder || revealed; // only the bidder knows trump early
  const mem = makeMemory(G, seat);                       // card memory, built once

  // ----- leading a trick -----
  if (ledSuit === null) {
    // 1) Cash a guaranteed side-suit winner that can't be ruffed.
    const sideBoss = hand.filter((c) =>
      c.suit !== trumpS && isBoss(mem, c) && !(revealed && oppVoid(G, seat, c.suit)));
    if (sideBoss.length) return { reveal: false, cardId: pick(sideBoss, bestWinner).id };
    // 2) Else lead a cheap card, preferring a suit opponents can't ruff, and
    //    avoid opening trumps (only lead trump if that's all we have).
    let side = hand.filter((c) => c.suit !== trumpS);
    if (!side.length) side = hand.slice();
    const safe = side.filter((c) => !oppVoid(G, seat, c.suit));
    return { reveal: false, cardId: lowestValue(safe.length ? safe : side).id };
  }

  // ----- following a trick -----
  const plays = G.plays;
  const best = currentBest(plays, ledSuit, revealed, trumpS);
  const partnerWinning = best && best.seat === partner;
  const isLast = plays.length === 3;                      // we play last in this trick
  const canFollow = hand.some((c) => c.suit === ledSuit);
  const trickPts = plays.reduce((s, p) => s + pointsOf(p.card), 0);
  // Safe to load points onto partner if we're last, or their card is a boss in
  // the led suit that no remaining opponent can ruff.
  const partnerSafe = best && (isLast ||
    (best.card.suit === ledSuit && isBoss(mem, best.card) && !(revealed && oppVoid(G, seat, ledSuit))));

  if (canFollow) {
    if (partnerWinning) {
      return { reveal: false, cardId: (partnerSafe ? highestPoint(legal) : lowestValue(legal)).id };
    }
    // Opponent (or nobody yet) winning: take it cheaply when it's worth taking.
    const winners = legal.filter((c) => beats(c, best.card, ledSuit, revealed, trumpS));
    if (winners.length && (isLast || trickPts > 0 || winners.some((c) => isBoss(mem, c)))) {
      return { reveal: false, cardId: lowestStrength(winners).id };
    }
    return { reveal: false, cardId: lowestValue(legal).id };
  }

  // Void in the led suit.
  if (partnerWinning) {
    return { reveal: false, cardId: (partnerSafe ? highestPoint(legal) : lowestValue(legal)).id };
  }

  // Opponent winning and we can't follow: ruff if it pays (needs trump knowledge).
  const myTrumps = hand.filter((c) => c.suit === trumpS);
  if (myTrumps.length && knowsTrump) {
    if (!revealed) {
      // Revealing forces us to play trump; only spend it on a points/last trick.
      if (trickPts >= 1 || isLast) return { reveal: true, cardId: lowestStrength(myTrumps).id };
    } else {
      const winT = myTrumps.filter((c) => beats(c, best.card, ledSuit, true, trumpS));
      if (winT.length && (trickPts >= 1 || isLast)) {
        return { reveal: false, cardId: lowestStrength(winT).id };
      }
    }
  }
  // Otherwise discard the cheapest non-trump; keep trumps in reserve.
  const nonTrump = legal.filter((c) => c.suit !== trumpS);
  return { reveal: false, cardId: lowestValue(nonTrump.length ? nonTrump : legal).id };
};
