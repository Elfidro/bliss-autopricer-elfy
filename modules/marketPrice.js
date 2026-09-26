// Which sell listing is "the market" for an item.
//
// Shared by the pricer (what to sell at, and the ceiling for real bids) and the
// accuracy dashboard (what the pricer is judged against), so the two never
// disagree about where the ask is.

// Index of the ask to price against. `asks` is ascending, in metal.
//
// The lowest ask is the market price unless it is an isolated undercut: a
// single listing more than `gap` (a fraction) below the next one, e.g. 1.66 ref
// when everyone else asks 4.11+. Copying that would sell the item at a mislisted
// or dumped price, and it also hid every real bid, since bids above the "ask"
// are dropped as being for a painted/spelled variant. A listing is only ever
// skipped while at least two asks remain above it, so with one or two asks the
// lowest is always used.
//
// Time-based protection is the price swing guard; this rule only looks at the
// shape of the current market. It replaced a check that compared each ask to
// the pricer's own recent sell prices, which anchored a wrong price to itself:
// once an item sold at 40 ref, the 1.44 ref asks were "outliers" and the one
// 40 ref listing was not.
function chooseAskIndex(asks, gap = 0.25) {
  const g = Number.isFinite(gap) ? gap : 0.25;
  let i = 0;
  while (i < asks.length - 2 && asks[i] < asks[i + 1] * (1 - g)) {
    i++;
  }
  return i;
}

module.exports = { chooseAskIndex };
