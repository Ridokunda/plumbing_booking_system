(() => {
  const forms = [...document.querySelectorAll('[data-payment-form]')];
  const feedback = document.getElementById('payment-error');
  const progress = document.getElementById('payment-progress');
  let pending = false;

  forms.forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (pending) return;
      pending = true;
      feedback.hidden = true;
      progress.textContent =
        form.dataset.mode === 'simulation'
          ? 'Processing demo payment...'
          : 'Opening secure card checkout...';
      progress.hidden = false;
      const controls = forms.flatMap((item) => [...item.querySelectorAll('button, select')]);
      const states = controls.map((control) => control.disabled);
      controls.forEach((control) => {
        control.disabled = true;
      });
      form.setAttribute('aria-busy', 'true');

      try {
        const payload = { booking_id: Number(form.elements.booking_id.value) };
        if (form.dataset.mode === 'simulation') payload.outcome = form.elements.outcome.value;
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || !data.success)
          throw new Error(data.message || 'Unable to process the payment. Please try again.');
        window.location.assign(data.url);
      } catch (error) {
        feedback.textContent = error.message || 'Unable to process the payment. Please try again.';
        feedback.hidden = false;
        progress.hidden = true;
        controls.forEach((control, index) => {
          control.disabled = states[index];
        });
        form.removeAttribute('aria-busy');
        pending = false;
      }
    });
  });
})();
