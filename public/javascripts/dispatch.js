/* global DispatchTime, URLSearchParams */
(function () {
  const time = DispatchTime;
  const $id = (id) => document.getElementById(id);
  const controls = {
    date: $id('dispatch-date'),
    view: $id('dispatch-view'),
    plumber: $id('dispatch-plumber'),
  };
  const query = new URL(window.location.href).searchParams;
  const state = {
    data: null,
    records: new Map(),
    unassignedPage: 1,
    overduePage: 1,
    request: 0,
    editing: null,
    saving: false,
    availability: { key: null, request: 0, loading: false, slots: [], error: null },
  };
  controls.date.value = time.validDate(query.get('date')) ? query.get('date') : time.dateKey();
  controls.view.value = query.get('view') === 'week' ? 'week' : 'day';
  let initialBooking = /^\d+$/.test(query.get('booking_id') || '') ? query.get('booking_id') : null;
  let desiredPlumber = /^\d+$/.test(query.get('plumber_id') || '') ? query.get('plumber_id') : '';
  const clock = (value) =>
    new Intl.DateTimeFormat('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
  const dateLabel = (value) =>
    new Intl.DateTimeFormat('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(value + 'T12:00:00+02:00'));
  const fullTime = (value) =>
    value ? `${dateLabel(time.dateKey(value))}, ${clock(value)} SAST` : 'Not scheduled';
  const name = (p) => `${p.name} ${p.surname}`;
  const service = (value) => value.replace(/_/g, ' ');
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, action, className = 'dispatch-button secondary') {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }
  function option(select, value, label) {
    const node = el('option', '', label);
    node.value = value;
    select.append(node);
    return node;
  }
  const shownPlumbers = () =>
    state.data.plumbers.filter(
      (p) => !controls.plumber.value || String(p.idusers) === controls.plumber.value,
    );
  const visitsOn = (day, plumberId) => {
    const r = time.range(day, 'day');
    return state.data.bookings.filter(
      (b) =>
        b.idPlumber === plumberId &&
        new Date(b.scheduled_start) < r.end &&
        new Date(b.scheduled_end) > r.start,
    );
  };
  function visitCard(booking) {
    const overdue =
      ['ASSIGNED', 'IN_PROGRESS'].includes(booking.status) &&
      new Date(booking.scheduled_end) < new Date(state.data.server_now);
    const card = button(
      '',
      () => openVisit(booking),
      `calendar-visit ${booking.status}${overdue ? ' is-overdue' : ''}`,
    );
    card.setAttribute(
      'aria-label',
      `Visit ${booking.idbookings}, ${booking.customer_name}, ${fullTime(booking.scheduled_start)}, ${booking.status}`,
    );
    card.append(
      el(
        'span',
        '',
        `${clock(booking.scheduled_start)}–${clock(booking.scheduled_end)} · #${booking.idbookings}`,
      ),
      el('strong', '', `${booking.customer_name} ${booking.customer_surname}`),
      el('span', '', service(booking.type)),
      el('span', '', booking.status.replace(/_/g, ' ')),
    );
    if (overdue) card.append(el('span', 'visit-warning', 'Overdue'));
    if (booking.travel_conflict)
      card.append(el('span', 'visit-warning', 'Travel gap needs attention'));
    if (booking.pending_reschedule)
      card.append(el('span', 'visit-warning', 'Reschedule review pending'));
    card.title = `${booking.location}\n${booking.description}`;
    return card;
  }
  function defaultStart(day) {
    const morning = time.parseInput(day + 'T08:00');
    const next = Math.ceil((new Date(state.data.server_now).getTime() + 60000) / 1800000) * 1800000;
    return new Date(Math.max(new Date(morning).getTime(), next)).toISOString();
  }
  function canAdd(day, plumber) {
    return plumber.assignable && day >= time.dateKey(state.data.server_now);
  }
  function drawDay(container, plumbers) {
    const scroll = el('div', 'dispatch-scroll');
    const grid = el('div', 'dispatch-day');
    grid.style.setProperty('--plumbers', plumbers.length);
    grid.style.setProperty('--grid-width', `${60 + plumbers.length * 170}px`);
    grid.append(el('div', 'day-title', 'SAST'));
    for (const plumber of plumbers) {
      const heading = el('div', 'day-title', name(plumber));
      heading.append(
        el('small', '', plumber.assignable ? 'Verified team member' : 'Existing visits · inactive'),
      );
      grid.append(heading);
    }
    const axis = el('div', 'day-time-axis');
    for (let hour = 0; hour < 24; hour++) {
      const label = el('span', 'day-time-label', `${String(hour).padStart(2, '0')}:00`);
      label.style.top = `${hour * 96 + 4}px`;
      axis.append(label);
    }
    grid.append(axis);
    const r = time.range(state.data.date, 'day');
    const top = (value) => ((new Date(value) - r.start) / 60000) * 1.6;
    for (const plumber of plumbers) {
      const lane = el('div', 'day-lane');
      for (const slot of state.data.availability.filter((a) => a.plumber_id === plumber.idusers)) {
        const first = Math.max(0, top(slot.starts_at));
        const last = Math.min(2304, top(slot.ends_at));
        if (last <= first) continue;
        const block = el(
          'div',
          `availability-block${slot.availability_type === 'UNAVAILABLE' ? ' blocked' : ''}`,
        );
        block.style.top = `${first}px`;
        block.style.height = `${last - first}px`;
        lane.append(block);
      }
      for (let slot = 0; slot < 48; slot++) {
        const startsAt = new Date(r.start.getTime() + slot * 1800000).toISOString();
        const node = button('', () => openVisit(null, plumber.idusers, startsAt), 'day-slot');
        node.style.top = `${slot * 48}px`;
        node.setAttribute('aria-label', `Schedule ${name(plumber)} at ${clock(startsAt)} SAST`);
        node.disabled =
          !plumber.assignable ||
          new Date(startsAt) <= new Date(state.data.server_now) ||
          !state.data.availability.some(
            (a) =>
              a.plumber_id === plumber.idusers &&
              a.availability_type === 'AVAILABLE' &&
              new Date(a.starts_at) <= new Date(startsAt) &&
              new Date(a.ends_at) > new Date(startsAt),
          ) ||
          state.data.availability.some(
            (a) =>
              a.plumber_id === plumber.idusers &&
              a.availability_type === 'UNAVAILABLE' &&
              new Date(a.starts_at) <= new Date(startsAt) &&
              new Date(a.ends_at) > new Date(startsAt),
          );
        lane.append(node);
      }
      const visits = visitsOn(state.data.date, plumber.idusers);
      // Allocate visual lanes even for inherited overlaps; no event hides another.
      const ends = [];
      const placements = visits.map((booking) => {
        let column = ends.findIndex((end) => end <= new Date(booking.scheduled_start).getTime());
        if (column < 0) column = ends.length;
        ends[column] = new Date(booking.scheduled_end).getTime();
        return { booking, column };
      });
      for (const { booking, column } of placements) {
        const start = Math.max(0, top(booking.scheduled_start));
        const end = Math.min(2304, top(booking.scheduled_end));
        if (state.data.travel_gap_minutes && end < 2304) {
          const block = el('div', 'travel-block', `${state.data.travel_gap_minutes}m travel`);
          block.style.top = `${end}px`;
          block.style.height = `${Math.min(2304 - end, state.data.travel_gap_minutes * 1.6)}px`;
          lane.append(block);
        }
        const card = visitCard(booking);
        card.style.top = `${start}px`;
        card.style.height = `${Math.max(end - start, 24)}px`;
        if (ends.length > 1) {
          card.style.left = `calc(${(column * 100) / ends.length}% + 4px)`;
          card.style.width = `calc(${100 / ends.length}% - 8px)`;
        }
        lane.append(card);
      }
      grid.append(lane);
    }
    scroll.append(grid);
    container.append(scroll);
    scroll.scrollTop = Math.max(
      0,
      (state.data.date === time.dateKey(state.data.server_now)
        ? Number(time.inputValue(state.data.server_now).slice(11, 13)) - 1
        : 7) * 96,
    );
  }
  function drawWeek(container, plumbers, days) {
    const scroll = el('div', 'dispatch-scroll');
    const grid = el('div', 'dispatch-week');
    grid.append(el('div', 'week-heading', 'TEAM / SAST'));
    for (const day of days)
      grid.append(
        el(
          'div',
          `week-heading${day === time.dateKey(state.data.server_now) ? ' is-today' : ''}`,
          dateLabel(day),
        ),
      );
    for (const plumber of plumbers) {
      grid.append(
        el('div', 'week-plumber', name(plumber) + (plumber.assignable ? '' : ' · inactive')),
      );
      for (const day of days) {
        const cell = el('div', 'week-cell');
        const r = time.range(day, 'day');
        const availability = state.data.availability.filter(
          (a) =>
            a.plumber_id === plumber.idusers &&
            new Date(a.starts_at) < r.end &&
            new Date(a.ends_at) > r.start,
        );
        cell.append(
          el(
            'p',
            'week-availability',
            availability.length
              ? availability
                  .map(
                    (a) =>
                      `${a.availability_type === 'AVAILABLE' ? 'Available' : 'Unavailable'} ${clock(new Date(Math.max(new Date(a.starts_at), r.start)))}–${clock(new Date(Math.min(new Date(a.ends_at), r.end)))}`,
                  )
                  .join(' · ')
              : 'No availability set',
          ),
        );
        for (const booking of visitsOn(day, plumber.idusers)) cell.append(visitCard(booking));
        const add = button(
          '+ Plan visit',
          () => openVisit(null, plumber.idusers, defaultStart(day)),
          'week-add',
        );
        add.disabled = !canAdd(day, plumber);
        cell.append(add);
        grid.append(cell);
      }
    }
    scroll.append(grid);
    container.append(scroll);
  }
  function drawAgenda(container, plumbers, days) {
    const agenda = el('div', 'dispatch-mobile');
    for (const day of days) {
      const section = el('section', 'agenda-day');
      section.append(el('h3', '', dateLabel(day)));
      for (const plumber of plumbers) {
        section.append(el('h4', 'agenda-plumber', name(plumber)));
        const visits = visitsOn(day, plumber.idusers);
        for (const booking of visits) section.append(visitCard(booking));
        if (!visits.length) section.append(el('p', 'week-availability', 'No scheduled visits'));
        const r = time.range(day, 'day');
        for (const slot of state.data.availability.filter(
          (a) =>
            a.plumber_id === plumber.idusers &&
            new Date(a.starts_at) < r.end &&
            new Date(a.ends_at) > r.start,
        )) {
          section.append(
            el(
              'p',
              'week-availability',
              `${slot.availability_type === 'AVAILABLE' ? 'Available' : 'Unavailable'} ${clock(slot.starts_at)}–${clock(slot.ends_at)}`,
            ),
          );
        }
        const add = button(
          '+ Plan visit',
          () => openVisit(null, plumber.idusers, defaultStart(day)),
          'week-add',
        );
        add.disabled = !canAdd(day, plumber);
        section.append(add);
      }
      agenda.append(section);
    }
    container.append(agenda);
  }
  function drawQueue(key) {
    const queue = state.data[key];
    const container = $id(`${key}-items`);
    container.replaceChildren();
    $id(`${key}-count`).textContent = queue.total;
    for (const booking of queue.items) {
      const card = el('article', 'queue-card');
      card.append(
        el('span', 'queue-id', `#${booking.idbookings} · ${booking.status.replace(/_/g, ' ')}`),
        el('h3', '', `${booking.customer_name} ${booking.customer_surname}`),
        el('p', '', service(booking.type)),
        el('p', '', booking.location),
      );
      card.append(
        el(
          'p',
          '',
          key === 'unassigned'
            ? `Preferred: ${booking.preferred_dates.map(dateLabel).join(', ')}`
            : `Planned end: ${fullTime(booking.scheduled_end)}`,
        ),
      );
      if (booking.pending_reschedule)
        card.append(el('p', '', 'Customer reschedule review pending'));
      card.append(
        button(booking.editable ? 'Plan visit →' : 'View visit →', () => openVisit(booking)),
      );
      container.append(card);
    }
    if (!queue.items.length)
      container.append(
        el(
          'p',
          'dispatch-empty',
          key === 'unassigned' ? 'All requests are planned.' : 'No overdue jobs.',
        ),
      );
    const pages = $id(`${key}-pages`);
    pages.replaceChildren();
    const previous = button('Previous', () => {
      state[`${key}Page`]--;
      load();
    });
    previous.disabled = queue.page <= 1;
    const next = button('Next', () => {
      state[`${key}Page`]++;
      load();
    });
    next.disabled = queue.page >= queue.pages;
    pages.append(previous, el('span', '', `${queue.page} / ${queue.pages}`), next);
    state[`${key}Page`] = queue.page;
  }
  function draw() {
    const data = state.data;
    state.records = new Map(
      [
        ...data.bookings,
        ...data.unassigned.items,
        ...data.overdue.items,
        ...(data.selected_booking ? [data.selected_booking] : []),
      ].map((b) => [b.idbookings, b]),
    );
    const selected = controls.plumber.value || desiredPlumber;
    controls.plumber.replaceChildren();
    option(controls.plumber, '', 'All plumbers');
    for (const plumber of data.plumbers)
      option(
        controls.plumber,
        plumber.idusers,
        name(plumber) + (plumber.assignable ? '' : ' · inactive'),
      );
    controls.plumber.value = selected;
    desiredPlumber = '';
    $id('dispatch-period').textContent =
      data.view === 'day'
        ? dateLabel(data.date)
        : `${dateLabel(data.range.from)} – ${dateLabel(time.shiftDate(data.range.to, -1))}`;
    $id('dispatch-settings').textContent =
      `SAST · Africa/Johannesburg · ${data.travel_gap_minutes}-minute minimum travel gap`;
    const container = $id('dispatch-calendar');
    container.replaceChildren();
    const plumbers = shownPlumbers();
    const days = Array.from({ length: data.view === 'week' ? 7 : 1 }, (_, i) =>
      time.shiftDate(data.range.from, i),
    );
    if (!plumbers.length)
      container.append(
        el(
          'p',
          'dispatch-empty',
          'No approved plumbers or existing visits yet. Approve a plumber from User management to begin.',
        ),
      );
    else {
      if (data.view === 'day') drawDay(container, plumbers);
      else drawWeek(container, plumbers, days);
      drawAgenda(container, plumbers, days);
    }
    drawQueue('unassigned');
    drawQueue('overdue');
  }
  async function load() {
    const request = ++state.request;
    const params = new URLSearchParams({
      date: controls.date.value,
      view: controls.view.value,
      unassigned_page: state.unassignedPage,
      overdue_page: state.overduePage,
    });
    if (controls.plumber.value || desiredPlumber)
      params.set('plumber_id', controls.plumber.value || desiredPlumber);
    if (initialBooking) params.set('booking_id', initialBooking);
    $id('dispatch-error').hidden = true;
    $id('dispatch-status').textContent = 'Loading dispatch…';
    $id('dispatch-calendar').setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`/admin/dispatch/data?${params}`, {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load dispatch.');
      if (request !== state.request) return;
      state.data = data;
      draw();
      $id('dispatch-status').textContent =
        `Updated ${clock(data.server_now)} SAST · Click a visit or an available time to plan.`;
      if (initialBooking && data.selected_booking) {
        initialBooking = null;
        openVisit(data.selected_booking);
      }
    } catch (error) {
      if (request !== state.request) return;
      $id('dispatch-error').hidden = false;
      $id('dispatch-error').querySelector('span').textContent = error.message;
      $id('dispatch-status').textContent = state.data
        ? 'Showing the last loaded schedule. Refresh before assigning.'
        : 'The schedule could not be loaded.';
    } finally {
      if (request === state.request) $id('dispatch-calendar').setAttribute('aria-busy', 'false');
    }
  }
  async function loadVisitAvailability(plumberId, date) {
    const availability = state.availability;
    const request = ++availability.request;
    availability.loading = true;
    availability.error = null;
    try {
      const response = await fetch(`/admin/plumbers/${plumberId}/availability?date=${date}`, {
        headers: { Accept: 'application/json' },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to check working hours.');
      if (request === availability.request) availability.slots = result.availability;
    } catch (error) {
      if (request === availability.request) availability.error = error.message;
    } finally {
      if (request === availability.request) {
        availability.loading = false;
        updateVisitAvailability();
      }
    }
  }
  function updateVisitAvailability(force = false) {
    const panel = $id('visit-availability');
    const status = $id('visit-availability-status');
    const windows = $id('visit-availability-windows');
    const refresh = $id('visit-availability-refresh');
    const availability = state.availability;
    const plumberId = Number($id('visit-plumber').value);
    const readonly = state.editing && !state.editing.editable;
    const start = time.parseInput(
      $id('visit-start').value,
      state.editing?.expected_schedule.starts_at,
    );
    const end = time.parseInput($id('visit-end').value, state.editing?.expected_schedule.ends_at);
    panel.hidden = Boolean(readonly);
    panel.dataset.state = 'pending';
    windows.replaceChildren();
    $id('visit-save').disabled = true;
    refresh.disabled = state.saving;
    if (readonly) return;
    if (!plumberId || !start || !end || new Date(end) <= new Date(start)) {
      availability.key = null;
      availability.request++;
      availability.loading = false;
      refresh.disabled = true;
      status.textContent = plumberId
        ? 'Choose a valid start and later end time to check working hours.'
        : 'Choose a plumber to see their working hours.';
      return;
    }
    const date = time.dateKey(start);
    const key = `${plumberId}:${date}`;
    if (force || availability.key !== key) {
      availability.key = key;
      loadVisitAvailability(plumberId, date);
    }
    if (availability.loading) {
      status.textContent = 'Checking working hours…';
      refresh.disabled = true;
      return;
    }
    if (availability.error) {
      panel.dataset.state = 'error';
      status.textContent = 'Could not check working hours. Refresh working hours to try again.';
      return;
    }
    const day = time.range(date, 'day');
    const shownEnd = new Date(Math.max(day.end.getTime(), new Date(end).getTime()));
    const slots = availability.slots.filter(
      (slot) => new Date(slot.starts_at) < shownEnd && new Date(slot.ends_at) > day.start,
    );
    for (const slot of slots)
      windows.append(
        el(
          'li',
          '',
          `${slot.availability_type === 'AVAILABLE' ? 'Available' : 'Unavailable'}: ${fullTime(slot.starts_at)} – ${fullTime(slot.ends_at)}`,
        ),
      );
    const covered = slots.some(
      (slot) =>
        slot.availability_type === 'AVAILABLE' &&
        new Date(slot.starts_at) <= new Date(start) &&
        new Date(slot.ends_at) >= new Date(end),
    );
    const blocked = slots.some(
      (slot) =>
        slot.availability_type === 'UNAVAILABLE' &&
        new Date(slot.starts_at) < new Date(end) &&
        new Date(slot.ends_at) > new Date(start),
    );
    panel.dataset.state = covered && !blocked ? 'available' : 'unavailable';
    if (blocked) {
      status.textContent =
        'This visit overlaps an unavailable period. Choose another time or plumber.';
    } else if (!covered) {
      status.textContent = slots.some((slot) => slot.availability_type === 'AVAILABLE')
        ? 'The whole visit must fit inside one available window. Adjust the visit time or choose another plumber.'
        : `No available working hours are recorded for ${dateLabel(date)}. Ask this plumber to add hours under My availability, then refresh working hours here.`;
    } else {
      status.textContent =
        'This visit fits the recorded working hours. Travel gaps are checked when saving.';
    }
    $id('visit-save').disabled = state.saving || !state.editing || !covered || blocked;
  }
  function chooseBooking() {
    const booking = state.records.get(Number($id('visit-booking').value));
    state.editing = booking || null;
    const readonly = booking && !booking.editable;
    $id('dispatch-dialog-title').textContent = readonly
      ? 'Visit details'
      : booking?.status === 'ASSIGNED'
        ? 'Update visit'
        : 'Schedule a visit';
    $id('visit-details').textContent = booking
      ? `${booking.customer_name} ${booking.customer_surname} · ${service(booking.type)}\n${booking.location}\n${booking.description}\nPreferred: ${booking.preferred_dates.map(dateLabel).join(', ')}${booking.pending_reschedule ? '\nReview the customer’s pending reschedule request in Operations cases before editing.' : ''}`
      : 'Choose a request from the current unassigned page.';
    if (booking?.scheduled_start)
      $id('visit-start').value = time.inputValue(booking.scheduled_start);
    if (booking?.scheduled_end) $id('visit-end').value = time.inputValue(booking.scheduled_end);
    if (booking?.idPlumber) $id('visit-plumber').value = String(booking.idPlumber);
    for (const id of ['visit-plumber', 'visit-start', 'visit-end'])
      $id(id).disabled = Boolean(readonly);
    $id('visit-save').hidden = Boolean(readonly);
    $id('visit-case').hidden = !booking?.pending_reschedule;
    $id('visit-record').hidden = !booking;
    if (booking) $id('visit-record').href = `/jobs/${booking.idbookings}`;
    $id('visit-error').hidden = true;
    updateVisitAvailability();
  }
  function openVisit(booking = null, plumberId = null, startsAt = null) {
    if (!state.data) return;
    const select = $id('visit-booking');
    select.replaceChildren();
    option(select, '', 'Choose a request…');
    const choices = new Map(state.data.unassigned.items.map((b) => [b.idbookings, b]));
    if (booking) choices.set(booking.idbookings, booking);
    for (const item of choices.values())
      option(
        select,
        item.idbookings,
        `#${item.idbookings} · ${item.customer_name} ${item.customer_surname} · ${service(item.type)}`,
      );
    select.value = booking ? String(booking.idbookings) : '';
    select.disabled = Boolean(booking && !['NEW', 'PENDING'].includes(booking.status));
    const plumbers = $id('visit-plumber');
    plumbers.replaceChildren();
    option(plumbers, '', 'Choose a verified plumber…');
    for (const plumber of state.data.plumbers) {
      if (plumber.assignable || plumber.idusers === booking?.idPlumber) {
        const node = option(
          plumbers,
          plumber.idusers,
          name(plumber) + (plumber.assignable ? '' : ' · inactive'),
        );
        node.disabled = !plumber.assignable;
      }
    }
    plumbers.value = plumberId ? String(plumberId) : '';
    const start = startsAt || defaultStart(state.data.date);
    $id('visit-start').value = time.inputValue(start);
    $id('visit-end').value = time.inputValue(new Date(new Date(start).getTime() + 3600000));
    $id('visit-gap').textContent =
      `Leave at least ${state.data.travel_gap_minutes} minutes between this plumber’s visits. Visit times must fit their availability.`;
    state.availability.key = null;
    chooseBooking();
    $id('dispatch-dialog').showModal();
  }
  $id('visit-booking').addEventListener('change', chooseBooking);
  for (const id of ['visit-plumber', 'visit-start', 'visit-end'])
    $id(id).addEventListener('change', () => updateVisitAvailability());
  $id('visit-availability-refresh').addEventListener('click', () => updateVisitAvailability(true));
  $id('dispatch-close').addEventListener('click', () => {
    if (!state.saving) $id('dispatch-dialog').close();
  });
  $id('dispatch-dialog').addEventListener('cancel', (event) => {
    if (state.saving) event.preventDefault();
  });
  $id('dispatch-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.saving || !state.editing) return;
    updateVisitAvailability();
    if ($id('visit-save').disabled) return;
    const start = time.parseInput(
      $id('visit-start').value,
      state.editing.expected_schedule.starts_at,
    );
    const end = time.parseInput($id('visit-end').value, state.editing.expected_schedule.ends_at);
    const error = $id('visit-error');
    error.hidden = true;
    if (!start || !end || new Date(end) <= new Date(start)) {
      error.textContent = 'Choose a valid start and later end time.';
      error.hidden = false;
      return;
    }
    state.saving = true;
    $id('visit-save').disabled = true;
    $id('visit-save').textContent = 'Saving…';
    try {
      const response = await fetch('/admin/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          booking_id: state.editing.idbookings,
          plumber_id: Number($id('visit-plumber').value),
          starts_at: start,
          ends_at: end,
          expected_schedule: state.editing.expected_schedule,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not save this visit.');
      $id('dispatch-dialog').close();
      await load();
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    } finally {
      state.saving = false;
      $id('visit-save').textContent = 'Save visit';
      updateVisitAvailability();
    }
  });
  for (const [id, direction] of [
    ['dispatch-prev', -1],
    ['dispatch-next', 1],
  ])
    $id(id).addEventListener('click', () => {
      controls.date.value = time.shiftDate(
        controls.date.value,
        direction * (controls.view.value === 'week' ? 7 : 1),
      );
      load();
    });
  $id('dispatch-today').addEventListener('click', () => {
    controls.date.value = time.dateKey();
    load();
  });
  for (const node of [controls.date, controls.view, controls.plumber])
    node.addEventListener('change', () => {
      state.overduePage = 1;
      load();
    });
  for (const id of ['dispatch-refresh', 'dispatch-retry']) $id(id).addEventListener('click', load);
  load();
})();
