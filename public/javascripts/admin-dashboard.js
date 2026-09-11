document.addEventListener('DOMContentLoaded', () => {
  const contentDiv = document.querySelector('.content');

  document.addEventListener('click', async (event) => {
    const pageLink = event.target.closest('.admin-page-link');
    if (pageLink) {
      event.preventDefault();
      const response = await fetch(pageLink.href);
      if (response.ok) {
        contentDiv.innerHTML = await response.text();
        attachEventListeners();
      }
      return;
    }
    const verificationButton = event.target.closest('.approve-plumber, .reject-plumber');
    if (verificationButton) {
      const status = verificationButton.classList.contains('approve-plumber')
        ? 'APPROVED'
        : 'REJECTED';
      const response = await fetch(
        `/admin/plumbers/${verificationButton.dataset.id}/verification`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      );
      const result = await response.json();
      if (!response.ok) return alert(result.message);
      const html = await fetch('/admin/manageplumbers').then((value) => value.text());
      contentDiv.innerHTML = html;
      attachEventListeners();
    }
    const statusButton = event.target.closest('.user-status');
    if (statusButton) {
      const response = await fetch(`/admin/users/${statusButton.dataset.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusButton.dataset.status }),
      });
      const result = await response.json();
      if (!response.ok) return alert(result.message);
      const path =
        statusButton.dataset.role === 'customer'
          ? '/admin/managecustomers'
          : '/admin/manageplumbers';
      const html = await fetch(path).then((value) => value.text());
      contentDiv.innerHTML = html;
      attachEventListeners();
    }
  });

  document.querySelectorAll('.admin-pages .link').forEach((link) => {
    link.addEventListener('click', async (event) => {
      event.preventDefault();

      const linkid = event.target.id;
      let url = '';

      if (linkid === 'user-management-link') {
        url = '/admin/manageusers';
      } else if (linkid === 'bookings-link') {
        url = '/admin/bookings';
      } else if (linkid === 'stats-link') {
        url = '/admin/stats';
      }

      try {
        const response = await fetch(url);

        if (response.ok) {
          const content = await response.text();
          contentDiv.innerHTML = content;
          attachEventListeners();
        } else {
          contentDiv.innerHTML = '<p>Failure while loading content</p>';
        }
      } catch (error) {
        contentDiv.innerHTML = '<p>Error while loading content</p>';
        console.error('error', error);
      }
    });
  });

  // Load default page (Dashboard Analytics)
  const defaultUrl = '/admin/stats';
  fetch(defaultUrl)
    .then((response) => {
      if (response.ok) {
        return response.text();
      } else {
        throw new Error('Failed to load default content');
      }
    })
    .then((content) => {
      contentDiv.innerHTML = content;
      attachEventListeners();
    })
    .catch((error) => {
      contentDiv.innerHTML = '<p>Error loading default content</p>';
      console.error(error);
    });

  function attachEventListeners() {
    //eventlisteners for manageuser page
    const contentDiv = document.querySelector('.content');
    document.querySelectorAll('.stats a, .stats-container a').forEach((link) => {
      link.addEventListener('click', async (event) => {
        event.preventDefault();
        var url = '';
        const linkid = event.currentTarget.id;
        switch (linkid) {
          case 'customers-link':
            url = '/admin/managecustomers';
            break;
          case 'plumbers-link':
            url = '/admin/manageplumbers';
            break;
          case 'stats-link':
            url = '/admin/stats';
            break;
          default:
            url = '/admin/manageusers';
            break;
        }

        try {
          const response = await fetch(url);

          if (response.ok) {
            const content = await response.text();
            contentDiv.innerHTML = content;
          } else {
            contentDiv.innerHTML = '<p>Failure while loading content</p>';
          }
        } catch (error) {
          contentDiv.innerHTML = '<p>Error while loading content</p>';
          console.error('error', error);
        }
      });
    });
    const btn_adduser = document.getElementById('btn_adduser');
    if (btn_adduser) {
      btn_adduser.addEventListener('click', async function () {
        try {
          const response = await fetch('/register/registeruser');
          if (response.ok) {
            const content = await response.text();
            contentDiv.innerHTML = content;
            attachEventListeners();
          } else {
            contentDiv.innerHTML = '<p>Failure while loading content</p>';
          }
        } catch (error) {
          contentDiv.innerHTML = '<p>Error while loading content</p>';
          console.error('error', error);
        }
      });
    }
    const usertype = document.getElementById('usertype');
    if (usertype !== null) {
      usertype.addEventListener('change', function () {
        var userType = this.value;
        var adminFields = document.getElementById('adminFields');
        var plumberFields = document.getElementById('plumberFields');

        if (adminFields) adminFields.style.display = 'none';
        if (plumberFields) plumberFields.style.display = 'none';

        if (userType === '2' && adminFields) {
          adminFields.style.display = 'block';
        } else if (userType === '3' && plumberFields) {
          plumberFields.style.display = 'block';
        }
      });
    }

    //eventlisteners for bookings page
    // Format booking dates
    document.querySelectorAll('.booking-date').forEach(function (el) {
      var dateStr = el.getAttribute('data-date');
      if (dateStr) {
        var date = new Date(dateStr);
        var options = { weekday: 'long', year: 'numeric', month: 'long', day: '2-digit' };
        el.textContent = date.toLocaleDateString(undefined, options);
      }
    });

    // Assign plumber functionality
    document.querySelectorAll('.assign-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var bookingId = this.getAttribute('data-booking-id');
        // Update all assign buttons with the current booking ID
        document.querySelectorAll('.assign-plumber-btn').forEach(function (assignBtn) {
          assignBtn.setAttribute('data-booking-id', bookingId);
        });
        document.getElementById('assignModal').style.display = 'flex';
      });
    });

    // Handle assign plumber
    document.addEventListener('click', function (e) {
      if (e.target.classList.contains('assign-plumber-btn')) {
        var plumberId = e.target.getAttribute('data-plumber-id');
        var bookingId = e.target.getAttribute('data-booking-id');
        const startsAt = document.getElementById('scheduleStart')?.value;
        const endsAt = document.getElementById('scheduleEnd')?.value;
        if (!startsAt || !endsAt) return alert('Choose a start and end time.');
        fetch('/admin/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_id: bookingId,
            plumber_id: plumberId,
            starts_at: startsAt,
            ends_at: endsAt,
          }),
        })
          .then((res) => res.json())
          .then((result) => {
            var msgDiv = document.getElementById('message');
            msgDiv.style.display = 'block';
            msgDiv.textContent = result.message;
            if (result.success) {
              msgDiv.style.backgroundColor = '#d4edda';
              msgDiv.style.color = '#155724';
              msgDiv.style.border = '1px solid #c3e6cb';
              document.getElementById('assignModal').style.display = 'none';
              // Update status in UI
              var card = document
                .querySelector(`[data-booking-id="${bookingId}"]`)
                .closest('.booking-card');
              card.querySelector('.status-label').textContent = 'ASSIGNED';
              card.querySelector('.status-label').className = 'status-label status-ASSIGNED';
              // Remove action buttons
              var actionDiv = card.querySelector('div:last-child');
              actionDiv.innerHTML =
                '<span style="color:#666; font-style:italic;">No actions available</span>';
            } else {
              msgDiv.style.backgroundColor = '#f8d7da';
              msgDiv.style.color = '#721c24';
              msgDiv.style.border = '1px solid #f5c6cb';
            }
          })
          .catch(() => {
            var msgDiv = document.getElementById('message');
            msgDiv.style.display = 'block';
            msgDiv.textContent = 'An error occurred. Please try again.';
            msgDiv.style.backgroundColor = '#f8d7da';
            msgDiv.style.color = '#721c24';
            msgDiv.style.border = '1px solid #f5c6cb';
          });
      }
    });

    // Decline booking functionality
    document.querySelectorAll('.decline-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var bookingId = this.getAttribute('data-booking-id');
        const reason = prompt('Why is this booking being declined?');
        if (!reason || reason.trim().length < 5) return;
        fetch('/admin/declinebooking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_id: bookingId, reason: reason.trim() }),
        })
          .then((res) => res.json())
          .then((result) => {
            var msgDiv = document.getElementById('message');
            msgDiv.style.display = 'block';
            msgDiv.textContent = result.message;
            if (result.message && result.message.includes('declined')) {
              msgDiv.style.backgroundColor = '#d4edda';
              msgDiv.style.color = '#155724';
              msgDiv.style.border = '1px solid #c3e6cb';
              // Update status in UI
              var card = btn.closest('.booking-card');
              card.querySelector('.status-label').textContent = 'DECLINED';
              card.querySelector('.status-label').className = 'status-label status-DECLINED';
              // Remove action buttons
              var actionDiv = card.querySelector('div:last-child');
              actionDiv.innerHTML =
                '<span style="color:#666; font-style:italic;">No actions available</span>';
            } else {
              msgDiv.style.backgroundColor = '#f8d7da';
              msgDiv.style.color = '#721c24';
              msgDiv.style.border = '1px solid #f5c6cb';
            }
          })
          .catch(() => {
            var msgDiv = document.getElementById('message');
            msgDiv.style.display = 'block';
            msgDiv.textContent = 'An error occurred. Please try again.';
            msgDiv.style.backgroundColor = '#f8d7da';
            msgDiv.style.color = '#721c24';
            msgDiv.style.border = '1px solid #f5c6cb';
          });
      });
    });

    // Close assign modal
    const closeAssignModal = document.getElementById('closeAssignModal');
    if (closeAssignModal !== null) {
      closeAssignModal.addEventListener('click', function () {
        document.getElementById('assignModal').style.display = 'none';
      });
    }
    window.onclick = function (event) {
      var modal = document.getElementById('assignModal');
      if (event.target === modal) modal.style.display = 'none';
    };

    // Search and filter
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');
    const bookingsGrid = document.getElementById('bookingsGrid');
    function filterBookings() {
      if (!bookingsGrid) return;
      const search = (searchInput?.value || '').toLowerCase();
      const status = statusFilter?.value || 'ALL';
      bookingsGrid.querySelectorAll('.booking-card').forEach((card) => {
        const matchesSearch = (card.dataset.search || '').toLowerCase().includes(search);
        const matchesStatus = status === 'ALL' || card.dataset.status === status;
        card.style.display = matchesSearch && matchesStatus ? '' : 'none';
      });
    }
    function filterBookings() {
      const searchVal = searchInput.value.toLowerCase();
      const statusVal = statusFilter.value;
      bookingsGrid.querySelectorAll('.booking-card').forEach((card) => {
        const cardSearch = card.getAttribute('data-search').toLowerCase();
        const cardStatus = card.getAttribute('data-status');
        let show = cardSearch.includes(searchVal);
        if (statusVal !== 'ALL') {
          show = show && cardStatus === statusVal;
        }
        card.style.display = show ? '' : 'none';
      });
    }
    if (searchInput !== null) {
      searchInput.addEventListener('input', filterBookings);
    }
    if (statusFilter !== null) {
      statusFilter.addEventListener('change', filterBookings);
    }
  }
});
