// In-memory record of what the last pricing cycle did with each item, so the
// dashboard can show why an item was or was not updated. The pricer and the web
// UI run in the same process, so a plain module-level Map is enough. It resets on
// restart and fills again on the first cycle.

const statusByName = new Map();

// status: 'updated' | 'rejected' | 'swing-held' | 'swing-confirmed' | 'error'
function recordStatus(name, status, reason = '') {
  statusByName.set(name, { status, reason, at: Date.now() });
}

function getStatus(name) {
  return statusByName.get(name) || null;
}

// Turn the pricer's long multi-line error messages into something that fits in
// a table cell.
function shortReason(message) {
  const msg = String(message || '').replace(/\s+/g, ' ');
  const known = [
    [/buying for too much/i, 'Buy above bptf sanity band'],
    [/selling for too cheap/i, 'Sell below bptf sanity band'],
    [/not enough buy listings/i, 'Not enough buy listings'],
    [/not enough sell listings/i, 'Not enough sell listings'],
    [/not enough listings/i, 'Not enough listings'],
    [/Not enough listings after filtering/i, 'Too few listings after outlier filter'],
    [/not priced on bptf/i, 'No bptf baseline'],
    [/Issue with BPTF baseline/i, 'No bptf baseline'],
  ];
  for (const [pattern, label] of known) {
    if (pattern.test(msg)) {
      return label;
    }
  }
  return msg.replace(/^Error:\s*/, '').replace(/\| UPDATING PRICES \|:\s*/g, '').slice(0, 120);
}

module.exports = { recordStatus, getStatus, shortReason };
