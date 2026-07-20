// Twenty-Nine game engine. Pure-ish state + methods. UI layer (ui.js) drives it
// and reads state. 4 players, seats 0..3 clockwise. Teams: {0,2}=A, {1,3}=B.

const MIN_BID = 16;
const MAX_BID = 28;
const MATCH_TARGET = 6; // first team to 6 match points wins

const Game = {
  players: [],       // [{hand: [card], seat}]
  matchPoints: [0, 0], // team A, team B
  dealer: 0,
  phase: 'idle',     // idle | bidding | chooseTrump | play | roundEnd | gameOver
  turn: 0,           // whose action it is

  // bidding
  highBid: 0,
  highBidder: null,
  passed: [false, false, false, false],

  // trump
  trumpSuit: null,
  trumpRevealed: false,

  // trick state
  trickLeader: 0,
  ledSuit: null,
  plays: [],         // [{seat, card}]
  trickCount: 0,
  lastTrickWinner: null,
  roundCardPoints: [0, 0], // team card points this round
  mustPlayTrump: false,    // set when current player just revealed and holds trump

  narration: '', // short "who did what" line for the action log

  listeners: [],
  notify() { this.listeners.forEach((f) => f()); },
  onChange(f) { this.listeners.push(f); },

  pname(seat) { return 'Player ' + (seat + 1); },
  team(seat) { return seat % 2 === 0 ? 0 : 1; },
  next(seat) { return (seat + 1) % 4; },

  newGame() {
    this.matchPoints = [0, 0];
    this.dealer = Math.floor(Math.random() * 4);
    this.startRound();
  },

  startRound() {
    const deck = shuffle(makeDeck());
    this.players = [0, 1, 2, 3].map((seat) => ({ seat, hand: [] }));
    // First 4 cards each, starting left of dealer.
    let idx = 0;
    for (let round = 0; round < 4; round++) {
      for (let k = 0; k < 4; k++) {
        const seat = (this.dealer + 1 + k) % 4;
        this.players[seat].hand.push(deck[idx++]);
      }
    }
    this._deck = deck;
    this._dealIdx = idx;

    // reset per-round
    this.trumpSuit = null;
    this.trumpRevealed = false;
    this.highBid = 0;
    this.highBidder = null;
    this.passed = [false, false, false, false];
    this.trickCount = 0;
    this.lastTrickWinner = null;
    this.roundCardPoints = [0, 0];
    this.plays = [];
    this.ledSuit = null;
    this.mustPlayTrump = false;
    this.playedLog = [];               // all cards played this hand (public history)
    this.voids = [{}, {}, {}, {}];     // voids[seat][suit] = true once shown void

    this.narration = 'New hand dealt. ' + this.pname((this.dealer + 1) % 4) + ' bids first.';
    this.phase = 'bidding';
    this.turn = (this.dealer + 1) % 4; // bidding starts left of dealer
    this.notify();
  },

  // ---- Bidding ----
  activeBidders() {
    return [0, 1, 2, 3].filter((s) => !this.passed[s]);
  },

  placeBid(seat, amount) {
    if (this.phase !== 'bidding' || seat !== this.turn) return;
    if (amount < MIN_BID || amount > MAX_BID) return;
    if (amount <= this.highBid) return;
    this.highBid = amount;
    this.highBidder = seat;
    this.narration = this.pname(seat) + ' bid ' + amount + '.';
    this.advanceBidding();
  },

  passBid(seat) {
    if (this.phase !== 'bidding' || seat !== this.turn) return;
    this.passed[seat] = true;
    this.narration = this.pname(seat) + ' passed.';
    this.advanceBidding();
  },

  advanceBidding() {
    const active = this.activeBidders();
    // Bidding ends when only one active bidder remains and a bid exists,
    // or when everyone has passed.
    if (this.highBidder !== null && active.length <= 1) {
      return this.finishBidding();
    }
    if (active.length === 0) {
      // Nobody bid: force left-of-dealer to minimum.
      this.highBidder = (this.dealer + 1) % 4;
      this.highBid = MIN_BID;
      return this.finishBidding();
    }
    // move to next active player
    let s = this.turn;
    do { s = this.next(s); } while (this.passed[s]);
    this.turn = s;
    this.notify();
  },

  finishBidding() {
    this.narration = this.pname(this.highBidder) + ' won the bid at ' + this.highBid +
      ' — choosing trump.';
    this.phase = 'chooseTrump';
    this.turn = this.highBidder;
    this.notify();
  },

  // Suits available to pick as trump (must exist in bidder's first-4 hand).
  trumpChoices() {
    const suits = new Set(this.players[this.highBidder].hand.map((c) => c.suit));
    return SUITS.filter((s) => suits.has(s));
  },

  chooseTrump(suit) {
    if (this.phase !== 'chooseTrump') return;
    if (!this.trumpChoices().includes(suit)) return;
    this.trumpSuit = suit;
    // Deal remaining 4 cards each.
    let idx = this._dealIdx;
    for (let round = 0; round < 4; round++) {
      for (let k = 0; k < 4; k++) {
        const seat = (this.dealer + 1 + k) % 4;
        this.players[seat].hand.push(this._deck[idx++]);
      }
    }
    this.sortHands();
    this.narration = this.pname(this.highBidder) + ' named a trump (hidden). ' +
      this.pname((this.dealer + 1) % 4) + ' leads.';
    this.phase = 'play';
    this.trickLeader = (this.dealer + 1) % 4;
    this.turn = this.trickLeader;
    this.plays = [];
    this.ledSuit = null;
    this.notify();
  },

  sortHands() {
    for (const p of this.players) {
      p.hand.sort((a, b) => {
        if (a.suit !== b.suit) return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
        return TRICK_STRENGTH[b.rank] - TRICK_STRENGTH[a.rank];
      });
    }
  },

  // ---- Trick play ----
  hasSuit(seat, suit) {
    return this.players[seat].hand.some((c) => c.suit === suit);
  },

  hasTrump(seat) {
    return this.players[seat].hand.some((c) => c.suit === this.trumpSuit);
  },

  // Which cards the current player may legally play right now.
  legalCards(seat) {
    const hand = this.players[seat].hand;
    if (this.mustPlayTrump) {
      return hand.filter((c) => c.suit === this.trumpSuit);
    }
    if (this.ledSuit === null) return hand.slice(); // leader plays anything
    const followers = hand.filter((c) => c.suit === this.ledSuit);
    if (followers.length > 0) return followers;    // must follow suit
    return hand.slice();                            // void: play anything
  },

  // Can this player reveal trump right now? Only if they cannot follow suit,
  // trump not yet revealed, and they are following (not leading).
  canRevealTrump(seat) {
    if (this.trumpRevealed) return false;
    if (this.ledSuit === null) return false; // leader can't trigger reveal
    if (this.hasSuit(seat, this.ledSuit)) return false;
    return true;
  },

  revealTrump(seat) {
    if (!this.canRevealTrump(seat) || seat !== this.turn) return;
    this.trumpRevealed = true;
    this.narration = this.pname(seat) + ' revealed trump ' + SUIT_SYMBOL[this.trumpSuit] + '.';
    // Revealing player must play a trump this turn if they hold one.
    if (this.hasTrump(seat)) this.mustPlayTrump = true;
    this.notify();
  },

  playCard(seat, cardId) {
    if (this.phase !== 'play' || seat !== this.turn) return;
    const legal = this.legalCards(seat);
    const card = legal.find((c) => c.id === cardId);
    if (!card) return; // illegal move ignored

    // remove from hand
    const hand = this.players[seat].hand;
    hand.splice(hand.findIndex((c) => c.id === cardId), 1);

    if (this.plays.length === 0) {
      this.trickLeader = seat;
      this.ledSuit = card.suit;
    } else if (card.suit !== this.ledSuit) {
      // Public info: this seat couldn't follow, so it is void in the led suit.
      this.voids[seat][this.ledSuit] = true;
    }
    this.plays.push({ seat, card });
    this.playedLog.push({ seat, card, trick: this.trickCount });
    this.mustPlayTrump = false;

    if (this.plays.length === 4) {
      // brief pause handled by UI; resolve trick after it shows all 4 cards
      this._pendingResolve = true;
      this.notify();
      return;
    }
    this.turn = this.next(seat);
    this.notify();
  },

  resolveTrick() {
    if (!this._pendingResolve) return;
    this._pendingResolve = false;
    const winner = this.trickWinner();
    const pts = this.plays.reduce((sum, p) => sum + CARD_POINTS[p.card.rank], 0);
    this.roundCardPoints[this.team(winner)] += pts;
    this.trickCount++;
    this.lastTrickWinner = winner;
    this.narration = this.pname(winner) + ' won trick ' + this.trickCount +
      (pts ? ' (+' + pts + ' pts).' : '.');

    this.plays = [];
    this.ledSuit = null;

    if (this.trickCount === 8) {
      return this.endRound();
    }
    this.turn = winner;
    this.trickLeader = winner;
    this.notify();
  },

  trickWinner() {
    const trumpActive = this.trumpRevealed;
    let best = this.plays[0];
    for (const p of this.plays) {
      if (best === p) continue;
      best = this.stronger(best, p, trumpActive) ? best : p;
    }
    return best.seat;
  },

  // true if a is stronger than b given led suit + trump state.
  stronger(a, b, trumpActive) {
    const at = trumpActive && a.card.suit === this.trumpSuit;
    const bt = trumpActive && b.card.suit === this.trumpSuit;
    if (at && !bt) return true;
    if (bt && !at) return false;
    if (at && bt) return TRICK_STRENGTH[a.card.rank] > TRICK_STRENGTH[b.card.rank];
    // neither trump: only led suit matters
    const al = a.card.suit === this.ledSuit;
    const bl = b.card.suit === this.ledSuit;
    if (al && !bl) return true;
    if (bl && !al) return false;
    if (!al && !bl) return true; // both off-suit, keep first
    return TRICK_STRENGTH[a.card.rank] > TRICK_STRENGTH[b.card.rank];
  },

  endRound() {
    // last-trick bonus point
    this.roundCardPoints[this.team(this.lastTrickWinner)] += 1;

    const bidTeam = this.team(this.highBidder);
    const bidTeamPoints = this.roundCardPoints[bidTeam];
    const made = bidTeamPoints >= this.highBid;

    // Match scoring: first to 6. Winner of the hand gets 1 match point.
    const winnerTeam = made ? bidTeam : (1 - bidTeam);
    this.matchPoints[winnerTeam] += 1;

    this.lastResult = {
      bidTeam,
      bid: this.highBid,
      bidder: this.highBidder,
      bidTeamPoints,
      made,
      winnerTeam,
      cardPoints: this.roundCardPoints.slice(),
      trumpSuit: this.trumpSuit,
    };

    if (this.matchPoints[0] >= MATCH_TARGET || this.matchPoints[1] >= MATCH_TARGET) {
      this.phase = 'gameOver';
      this.gameWinner = this.matchPoints[0] >= MATCH_TARGET ? 0 : 1;
    } else {
      this.phase = 'roundEnd';
    }
    this.notify();
  },

  nextRound() {
    this.dealer = this.next(this.dealer);
    this.startRound();
  },

  // ---- Save / restore (plain-data snapshot; no browser deps) ----
  SNAP_FIELDS: [
    'players', 'matchPoints', 'dealer', 'phase', 'turn', 'highBid', 'highBidder',
    'passed', 'trumpSuit', 'trumpRevealed', 'trickLeader', 'ledSuit', 'plays',
    'trickCount', 'lastTrickWinner', 'roundCardPoints', 'mustPlayTrump',
    'narration', 'lastResult', 'gameWinner', '_deck', '_dealIdx',
    'playedLog', 'voids',
  ],

  snapshot() {
    const o = {};
    for (const f of this.SNAP_FIELDS) o[f] = this[f];
    return JSON.parse(JSON.stringify(o));
  },

  loadSnapshot(snap) {
    for (const f of this.SNAP_FIELDS) if (f in snap) this[f] = snap[f];
    this._pendingResolve = false;
    this.notify();
  },
};
