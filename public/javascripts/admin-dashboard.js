document.addEventListener('DOMContentLoaded', () => {
    const contentDiv = document.querySelector('.content');

    document.querySelectorAll('.admin-pages .link').forEach(link => {
        link.addEventListener('click', async event => {
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

    function attachEventListeners() {
        //eventlisteners for manageuser page
        const contentDiv = document.querySelector('.content');
        document.querySelectorAll('.stats a').forEach(link =>{
            link.addEventListener('click', async (event) =>{
                event.preventDefault();
                var url = '';
                linkid = event.currentTarget.id;
                switch(linkid){
                    case 'customers-link':
                        url = '/admin/managecustomers';
                        break;
                    case 'plumbers-link':
                        url = '/admin/manageplumbers'
                        break;
                    case 'stats-link':
                        url = '/admin/stats';
                        break;
                    default:
                        url = '/admin/manageusers'
                        break;
                }

                try{
                    const response = await fetch(url);
                    
                    if(response.ok){
                        const content = await response.text();
                        contentDiv.innerHTML = content;
                    }else{
                        contentDiv.innerHTML = '<p>Failure while loading content</p>';
                    }
                }catch(error){
                    contentDiv.innerHTML = '<p>Error while loading content</p>';
                    console.error('error', error);
                }
            });
        });
        const btn_adduser = document.getElementById('btn_adduser');
        if(btn_adduser){
            btn_adduser.addEventListener('click', async function(){
                try {
                    const response = await fetch('/register/registeruser');
                    if(response.ok){
                        const content = await response.text();
                        contentDiv.innerHTML = content;
                        attachEventListeners();
                    }else{
                        contentDiv.innerHTML = '<p>Failure while loading content</p>';
                    }
                } catch (error) {
                    contentDiv.innerHTML = '<p>Error while loading content</p>';
                    console.error('error', error);
                }
            });
        }
        const usertype = document.getElementById('usertype');
        if(usertype!==null){
            usertype.addEventListener('change', function() {
                var userType = this.value;
                var adminFields = document.getElementById('adminFields');
                var plumberFields = document.getElementById('plumberFields');

                adminFields.style.display = 'none';
                plumberFields.style.display = 'none';

                if (userType == '2') {
                    adminFields.style.display = 'block';
                } else if (userType == '3') {
                    plumberFields.style.display = 'block';
                }
            });
        }
         
        //eventlisteners for bookings page
        // Format booking dates
        document.querySelectorAll('.booking-date').forEach(function(el) {
            var dateStr = el.getAttribute('data-date');
            if (dateStr) {
                var date = new Date(dateStr);
                var options = { weekday: 'long', year: 'numeric', month: 'long', day: '2-digit' };
                el.textContent = date.toLocaleDateString(undefined, options);
            }
        });

        // Assign plumber functionality
        document.querySelectorAll('.assign-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var bookingId = this.getAttribute('data-booking-id');
                // Update all assign buttons with the current booking ID
                document.querySelectorAll('.assign-plumber-btn').forEach(function(assignBtn) {
                    assignBtn.setAttribute('data-booking-id', bookingId);
                });
                document.getElementById('assignModal').style.display = 'flex';
            });
        });

        // Handle assign plumber
        document.addEventListener('click', function(e) {
            if (e.target.classList.contains('assign-plumber-btn')) {
                var plumberId = e.target.getAttribute('data-plumber-id');
                var bookingId = e.target.getAttribute('data-booking-id');
                fetch('/admin/assign-booking', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: bookingId, plumber_id: plumberId })
                })
                .then(res => res.json())
                .then(result => {
                    var msgDiv = document.getElementById('message');
                    msgDiv.style.display = 'block';
                    msgDiv.textContent = result.message;
                    if(result.message && result.message.includes('assigned')) {
                        msgDiv.style.backgroundColor = '#d4edda';
                        msgDiv.style.color = '#155724';
                        msgDiv.style.border = '1px solid #c3e6cb';
                        document.getElementById('assignModal').style.display = 'none';
                        // Update status in UI
                        var card = document.querySelector(`[data-booking-id="${bookingId}"]`).closest('.booking-card');
                        card.querySelector('.status-label').textContent = 'ASSIGNED';
                        card.querySelector('.status-label').className = 'status-label status-ASSIGNED';
                        // Remove action buttons
                        var actionDiv = card.querySelector('div:last-child');
                        actionDiv.innerHTML = '<span style="color:#666; font-style:italic;">No actions available</span>';
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
        document.querySelectorAll('.decline-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var bookingId = this.getAttribute('data-booking-id');
                if (!confirm('Are you sure you want to decline this booking?')) return;
                fetch('/admin/declinebooking', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ booking_id: bookingId })
                })
                .then(res => res.json())
                .then(result => {
                    var msgDiv = document.getElementById('message');
                    msgDiv.style.display = 'block';
                    msgDiv.textContent = result.message;
                    if(result.message && result.message.includes('declined')) {
                        msgDiv.style.backgroundColor = '#d4edda';
                        msgDiv.style.color = '#155724';
                        msgDiv.style.border = '1px solid #c3e6cb';
                        // Update status in UI
                        var card = btn.closest('.booking-card');
                        card.querySelector('.status-label').textContent = 'DECLINED';
                        card.querySelector('.status-label').className = 'status-label status-DECLINED';
                        // Remove action buttons
                        var actionDiv = card.querySelector('div:last-child');
                        actionDiv.innerHTML = '<span style="color:#666; font-style:italic;">No actions available</span>';
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
        if(closeAssignModal !== null){
            closeAssignModal.addEventListener('click', function() {
                document.getElementById('assignModal').style.display = 'none';
            });
        }
        window.onclick = function(event) {
            var modal = document.getElementById('assignModal');
            if(event.target === modal) modal.style.display = 'none';
        };

        // Search and filter
        const searchInput = document.getElementById('searchInput');
        const statusFilter = document.getElementById('statusFilter');
        const bookingsGrid = document.getElementById('bookingsGrid');
        function filterBookings() {
            const searchVal = searchInput.value.toLowerCase();
            const statusVal = statusFilter.value;
            bookingsGrid.querySelectorAll('.booking-card').forEach(card => {
                const cardSearch = card.getAttribute('data-search').toLowerCase();
                const cardStatus = card.getAttribute('data-status');
                let show = cardSearch.includes(searchVal);
                if (statusVal !== 'ALL') {
                    show = show && cardStatus === statusVal;
                }
                card.style.display = show ? '' : 'none';
            });
        }
        if(searchInput !== null){
            searchInput.addEventListener('input', filterBookings);
        }
        if(statusFilter !== null){
            statusFilter.addEventListener('change', filterBookings);
        }
        
    }
}); 