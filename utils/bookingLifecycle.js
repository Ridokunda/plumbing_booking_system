function getBookingLifecycle(role, status) {
  const normalizedStatus = String(status || '').toUpperCase();
  const normalizedRole = String(role || 'customer').toLowerCase();

  const customerFlow = [
    { key: 'NEW', label: 'Requested' },
    { key: 'ASSIGNED', label: 'Assigned' },
    { key: 'IN_PROGRESS', label: 'In progress' },
    { key: 'COMPLETED', label: 'Completed' },
    { key: 'PAID', label: 'Paid' },
  ];

  const plumberFlow = [
    { key: 'ASSIGNED', label: 'Assigned' },
    { key: 'IN_PROGRESS', label: 'Working' },
    { key: 'COMPLETED', label: 'Completed' },
  ];

  const adminFlow = [
    { key: 'NEW', label: 'New request' },
    { key: 'ASSIGNED', label: 'Assigned' },
    { key: 'IN_PROGRESS', label: 'In progress' },
    { key: 'COMPLETED', label: 'Completed' },
    { key: 'DECLINED', label: 'Declined' },
  ];

  const flowByRole = {
    customer: customerFlow,
    plumber: plumberFlow,
    admin: adminFlow,
  };

  const flow = flowByRole[normalizedRole] || customerFlow;
  const statusIndex = flow.findIndex((step) => step.key === normalizedStatus);

  const steps = flow.map((step, index) => ({
    key: step.key,
    label: step.label,
    completed: statusIndex > index,
    current: statusIndex === index,
    upcoming: statusIndex < index,
  }));

  let headline = 'Track the status of this booking';
  let nextAction = 'Check back for updates.';
  let actions = [];

  if (normalizedRole === 'customer') {
    if (normalizedStatus === 'NEW') {
      headline = 'Request received';
      nextAction = 'You can still edit or cancel this request while it is waiting for assignment.';
      actions = [
        { key: 'edit', label: 'Edit request', variant: 'primary' },
        { key: 'cancel', label: 'Cancel request', variant: 'danger' },
      ];
    } else if (normalizedStatus === 'ASSIGNED') {
      headline = 'A plumber is assigned';
      nextAction = 'Wait for the plumber to start work. You will be notified of progress.';
      actions = [{ key: 'view', label: 'View details', variant: 'secondary' }];
    } else if (normalizedStatus === 'IN_PROGRESS') {
      headline = 'Work is in progress';
      nextAction = 'The assigned plumber is currently working on your request.';
      actions = [{ key: 'view', label: 'View details', variant: 'secondary' }];
    } else if (normalizedStatus === 'COMPLETED') {
      headline = 'Job completed';
      nextAction = 'Review the result, confirm completion, and proceed to payment.';
      actions = [{ key: 'pay', label: 'Pay now', variant: 'success' }];
    } else if (normalizedStatus === 'PAID') {
      headline = 'Closed and paid';
      nextAction = 'This booking is complete. Share feedback about your service.';
      actions = [{ key: 'review', label: 'Leave a review', variant: 'primary' }];
    } else if (normalizedStatus === 'DECLINED') {
      headline = 'Request declined';
      nextAction = 'You can create a new request if you still need service.';
      actions = [{ key: 'new', label: 'Create new request', variant: 'primary' }];
    } else if (normalizedStatus === 'CANCELLED') {
      headline = 'Request cancelled';
      nextAction = 'This request is closed. You can create another booking anytime.';
      actions = [{ key: 'new', label: 'Create new request', variant: 'primary' }];
    }
  }

  if (normalizedRole === 'admin') {
    if (normalizedStatus === 'NEW') {
      headline = 'Awaiting assignment';
      nextAction = 'Assign a plumber or decline this request.';
      actions = [
        { key: 'assign', label: 'Assign plumber', variant: 'primary' },
        { key: 'decline', label: 'Decline booking', variant: 'danger' },
      ];
    } else if (normalizedStatus === 'ASSIGNED') {
      headline = 'Assigned to a plumber';
      nextAction = 'Monitor the approved quote, schedule, evidence, and job progress.';
      actions = [{ key: 'view', label: 'Review booking', variant: 'secondary' }];
    } else if (normalizedStatus === 'COMPLETED') {
      headline = 'Completed and ready for payment';
      nextAction = 'Customer payment should be processed next.';
    }
  }

  if (normalizedRole === 'plumber') {
    if (normalizedStatus === 'ASSIGNED') {
      headline = 'New assigned job';
      nextAction = 'Start the work once you are on-site.';
      actions = [{ key: 'start', label: 'Start work', variant: 'primary' }];
    } else if (normalizedStatus === 'IN_PROGRESS') {
      headline = 'Working on job';
      nextAction = 'Upload progress photos and complete the job when finished.';
      actions = [{ key: 'complete', label: 'Mark complete', variant: 'success' }];
    } else if (normalizedStatus === 'COMPLETED') {
      headline = 'Job completed';
      nextAction = 'Await payment confirmation and keep records up to date.';
    }
  }

  return {
    role: normalizedRole,
    status: normalizedStatus,
    headline,
    nextAction,
    steps,
    actions,
  };
}

module.exports = { getBookingLifecycle };
