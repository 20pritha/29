# Twenty-Nine — rules as implemented

**Purpose of this document:** the engine implements *one* variant of 29. The game has many
regional variations, and an implementation that quietly picks the "wrong" one will feel broken
to players who grew up with a different table. **Hand this page to experienced 29 players and
have them tick or correct every line.** Do not treat the code as the source of truth.

Rule version: `GAME_VERSION = 1` (stored with every saved match, so old replays stay interpretable).
Configurable knobs live in the `RULES` object at the top of [game.js](game.js).

---

## 1. Cards

- 32-card deck: **7, 8, 9, 10, J, Q, K, A** in four suits (2–6 removed).
- Trick-taking rank, high → low: **J, 9, A, 10, K, Q, 8, 7**.
- Card points: **J = 3, 9 = 2, A = 1, 10 = 1**; K, Q, 8, 7 = 0.
- Total 28 in cards **+ 1 for winning the last trick = 29**.

☐ Correct?  ☐ Our table ranks differently: ______________

## 2. Deal

- Four players, fixed partnerships: seats 0+2 vs seats 1+3 (partners sit opposite).
- Dealer rotates one seat each hand.
- **4 cards each**, then bidding, then **4 more** (8 total).
- Deal starts with the player to the dealer's left.

☐ Correct?  ☐ Our table deals: ______________

## 3. Bidding

- Range **16 to 28** (`RULES.minBid` / `RULES.maxBid`).
- Bidding opens with the player left of the dealer and moves clockwise.
- Each bid must be strictly higher than the current high bid; otherwise pass.
- A player who passes is out of the auction for that hand.
- Bidding ends when only one bidder remains.
- **If everyone passes:** the player left of the dealer is forced to the minimum bid
  (`RULES.onAllPass = 'forceMinBid'`). Set it to `'redeal'` to throw the hand in instead.

☐ Correct?  ☐ Our table: ______________

## 4. Trump

- The winning bidder chooses trump **from a suit they hold** in their first four cards.
- Trump is **kept secret** and is **not active** until revealed — before the reveal, a trump-suit
  card is just an ordinary card of that suit and cannot win a trick it doesn't lead.
- **Reveal:** a player who cannot follow the led suit may ask for trump to be revealed.
  Once revealed it is face-up and active for the rest of the hand.
- After revealing, the player who asked **must play a trump if they hold one**.
- Once revealed, the highest trump played wins the trick.

☐ Correct?  ☐ Our table reveals differently: ______________

## 5. Play

- The player left of the dealer leads the first trick.
- **Must follow the led suit if able.** If void, any card may be played.
- Highest card of the led suit wins, unless trump is active and trumped — then highest trump wins.
- Trick winner leads the next trick. Eight tricks per hand.

☐ Correct?

## 6. Scoring

- Each team totals the card points it captured, plus **1 for the last trick** (`RULES.lastTrickBonus`).
- The bidding team **makes** its contract if its total ≥ its bid; otherwise it is **set**.
- **Match scoring:** the side that wins the hand takes **1 match point** (bidding team if they made
  it, defenders if they set it). First to **6 match points** (`RULES.matchTarget`) wins the match.

☐ Correct?  ☐ Our table scores: ______________

---

## Deliberately NOT implemented

These are real variants that exist in the wild. None of them are in the engine today. Each needs a
decision before it is added, and adding any that change scoring requires bumping `GAME_VERSION`.

| Variant | Status | Note |
|---|---|---|
| **Marriage / Jodi** (K+Q of trump) | ✗ not implemented | Common bonus; often reduces the effective bid |
| **Pair bonus** | ✗ not implemented | |
| **Double / Redouble** | ✗ not implemented | Defenders raising the stakes |
| **7th-card trump peek** (double-or-nothing) | ✗ not implemented | Bidder sets trump from a specific card; failing doubles the loss |
| **Reverse bidding** | ✗ not implemented | |
| **Bid steps / minimum raise > 1** | ✗ not implemented | Engine allows any raise of +1 |
| **Redeal conditions** (weak hand, no honours) | partial | Only "everyone passed", via `RULES.onAllPass` |
| **Alternative match targets** (e.g. play to 100 points) | partial | `RULES.matchTarget` is match points, not cumulative card points |
| **Trump reveal timing variants** (bidder may reveal at will) | ✗ not implemented | Reveal is only triggered by a player who cannot follow |
| **6-player / 8-card variants** | ✗ not implemented | Engine is fixed at 4 players |

---

## How to verify

1. Sit with 2–3 experienced players from the target region (India / Bangladesh / Nepal).
2. Walk each numbered section above and mark the boxes.
3. For anything marked wrong, decide: change the default, or expose it in `RULES`.
4. If a change affects scoring or play legality, **bump `GAME_VERSION`** so archived matches
   still replay under the rules they were played with.
