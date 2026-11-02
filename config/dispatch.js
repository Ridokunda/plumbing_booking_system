const time = require('../public/javascripts/dispatch-time');

function parseTravelGap(raw = '30') {
  if (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw) * 60000)) {
    throw new Error(
      'DISPATCH_TRAVEL_GAP_MINUTES must be a non-negative integer representable in milliseconds.',
    );
  }
  return Number(raw);
}

const travelGapMinutes = parseTravelGap(process.env.DISPATCH_TRAVEL_GAP_MINUTES ?? '30');
module.exports = { time, parseTravelGap, travelGapMinutes, timezone: 'Africa/Johannesburg' };
