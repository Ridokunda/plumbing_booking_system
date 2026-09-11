const PDFDocument = require('pdfkit');

function startDocument(res, filename, title) {
  const document = new PDFDocument({ margin: 54, size: 'A4', info: { Title: title } });
  res.set({
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Type': 'application/pdf',
    'Cache-Control': 'private, no-store',
  });
  document.pipe(res);
  document.fontSize(22).fillColor('#0f7e94').text('WeFixIt');
  document.moveDown(0.25).fontSize(16).fillColor('#1f2937').text(title);
  document.moveDown();
  return document;
}

function field(document, label, value) {
  document.font('Helvetica-Bold').text(`${label}:`, { continued: true });
  document.font('Helvetica').text(` ${value ?? '—'}`);
}

function money(value, currency = 'ZAR') {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency }).format(Number(value || 0));
}

function date(value) {
  return value ? new Date(value).toLocaleString('en-ZA') : '—';
}

function streamReceipt(res, booking, receipt) {
  const document = startDocument(
    res,
    `${receipt.receiptNumber}.pdf`,
    `Receipt ${receipt.receiptNumber}`,
  );
  field(document, 'Invoice', receipt.invoiceNumber);
  field(document, 'Booking', `#${booking.idbookings}`);
  field(document, 'Service', booking.type.replaceAll('_', ' '));
  field(document, 'Payment method', receipt.paymentMethod);
  field(document, 'Paid at', date(receipt.paidAt));
  document.moveDown();
  document
    .fontSize(18)
    .font('Helvetica-Bold')
    .text(`Total paid: ${money(receipt.amount)}`);
  document
    .moveDown(2)
    .fontSize(10)
    .font('Helvetica')
    .fillColor('#4b5563')
    .text(
      'This receipt was generated from the provider-confirmed payment record stored by WeFixIt.',
    );
  document.end();
}

function streamJobCard(res, booking, notes, photos) {
  const document = startDocument(
    res,
    `job-${booking.idbookings}.pdf`,
    `Job card #${booking.idbookings}`,
  );
  field(document, 'Status', booking.status);
  field(document, 'Service', booking.type.replaceAll('_', ' '));
  field(document, 'Customer', `${booking.customer_name} ${booking.customer_surname}`);
  field(
    document,
    'Plumber',
    booking.plumber_name ? `${booking.plumber_name} ${booking.plumber_surname}` : 'Unassigned',
  );
  field(document, 'Location', booking.location);
  field(document, 'Scheduled start', date(booking.scheduled_start));
  field(document, 'Scheduled end', date(booking.scheduled_end));
  document.moveDown().font('Helvetica-Bold').text('Work requested');
  document.font('Helvetica').text(booking.description || '—');
  document.moveDown().font('Helvetica-Bold').text('Job notes');
  if (!notes.length) document.font('Helvetica').text('No notes recorded.');
  for (const note of notes) {
    document
      .font('Helvetica-Bold')
      .text(`${note.author_name} · ${date(note.created_at)} · ${note.visibility}`);
    document.font('Helvetica').text(note.note).moveDown(0.5);
  }
  document.moveDown().font('Helvetica-Bold').text('Photo evidence');
  document
    .font('Helvetica')
    .text(`${photos.length} photo record${photos.length === 1 ? '' : 's'} attached to this job.`);
  document.end();
}

module.exports = { streamReceipt, streamJobCard };
