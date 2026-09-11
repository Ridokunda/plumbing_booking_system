async function sendEmail({ to, subject, html }) {
  if (!process.env.EMAIL_API_KEY || !process.env.EMAIL_FROM) {
    if (process.env.NODE_ENV !== 'production') console.log(`Email preview for ${to}: ${subject}`);
    return { delivered: false, preview: true };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.EMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  return { delivered: true, preview: false };
}

module.exports = { sendEmail };
