(() => {
  const quoteId = document.currentScript.dataset.quoteId;
  const quoteForm = document.getElementById('quoteForm');
  const quoteItems = document.getElementById('quoteItems');
  const addItem = document.getElementById('addItem');

  async function submitQuoteAction(url, payload, buttons, errorElement) {
    errorElement.hidden = true;
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || 'Unable to save the quote. Please try again.');
      location.reload();
    } catch (error) {
      errorElement.textContent = error.message || 'Unable to save the quote. Please try again.';
      errorElement.hidden = false;
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  }

  document.querySelectorAll('.quote-response').forEach((button) => {
    button.addEventListener('click', () => {
      const decision = button.dataset.decision;
      if (!confirm(`${decision === 'APPROVED' ? 'Approve' : 'Reject'} this quote?`)) return;
      submitQuoteAction(
        `/quotes/${quoteId}/respond`,
        { decision },
        [...document.querySelectorAll('.quote-response')],
        document.getElementById('quoteResponseError'),
      );
    });
  });

  addItem?.addEventListener('click', () => {
    const row = quoteItems.firstElementChild.cloneNode(true);
    row.querySelector('.item-description').value = '';
    row.querySelector('.item-quantity').value = '1';
    row.querySelector('.item-price').value = '';
    row.setAttribute('aria-label', `Line item ${quoteItems.children.length + 1}`);
    quoteItems.appendChild(row);
    row.querySelector('.item-description').focus();
    addItem.disabled = quoteItems.children.length >= 50;
  });

  quoteForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const items = [...quoteItems.querySelectorAll('.quote-item')].map((row) => ({
      description: row.querySelector('.item-description').value,
      quantity: row.querySelector('.item-quantity').value,
      unitPrice: row.querySelector('.item-price').value,
    }));
    submitQuoteAction(
      quoteForm.action,
      { items },
      [quoteForm.querySelector('[type="submit"]')],
      document.getElementById('quoteFormError'),
    );
  });
})();
