(function () {
  const OFFSET = 2 * 60 * 60 * 1000;
  function dateKey(value = new Date()) {
    return new Date(new Date(value).getTime() + OFFSET).toISOString().slice(0, 10);
  }
  function validDate(value) {
    return (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
    );
  }
  function shiftDate(value, days) {
    return new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  }
  function inputValue(value) {
    return new Date(new Date(value).getTime() + OFFSET).toISOString().slice(0, 16);
  }
  function parseInput(value, original = null) {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
      !validDate(value.slice(0, 10)) ||
      Number(value.slice(11, 13)) > 23 ||
      Number(value.slice(14)) > 59
    )
      return null;
    // Existing visits can contain seconds that datetime-local controls do not show.
    // Saving an untouched field must retain the original instant, not round it down.
    if (original && !Number.isNaN(Date.parse(original)) && inputValue(original) === value) {
      return new Date(original).toISOString();
    }
    return new Date(value + ':00+02:00').toISOString();
  }
  function range(date, view) {
    if (!validDate(date) || !['day', 'week'].includes(view))
      throw new Error('Choose a valid date and day/week view.');
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    const first = view === 'week' ? shiftDate(date, -((weekday + 6) % 7)) : date;
    const last = shiftDate(first, view === 'week' ? 7 : 1);
    return {
      first,
      last,
      start: new Date(first + 'T00:00:00+02:00'),
      end: new Date(last + 'T00:00:00+02:00'),
    };
  }
  const api = { dateKey, validDate, shiftDate, inputValue, parseInput, range };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DispatchTime = api;
})();
