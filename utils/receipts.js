const fs = require('fs');
const path = require('path');

const storePath = path.join(__dirname, '..', 'data', 'receipts.json');

function ensureStore() {
  const directory = path.dirname(storePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, '[]', 'utf8');
  }
}

function readReceipts() {
  try {
    ensureStore();
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeReceipts(receipts) {
  ensureStore();
  fs.writeFileSync(storePath, JSON.stringify(receipts, null, 2), 'utf8');
}

function buildReceiptNumber() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const random = Math.round(Math.random() * 1e6).toString().padStart(6, '0');
  return `RCPT-${stamp}-${random}`;
}

function getReceiptForBooking(bookingId, userId) {
  if (!bookingId || !userId) {
    return null;
  }

  return readReceipts().find(
    receipt => String(receipt.bookingId) === String(bookingId) && String(receipt.userId) === String(userId)
  ) || null;
}

function getReceiptsForUser(userId) {
  if (!userId) {
    return [];
  }

  return readReceipts()
    .filter(receipt => String(receipt.userId) === String(userId))
    .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
}

function getReceiptById(receiptId, userId) {
  if (!receiptId || !userId) {
    return null;
  }

  return readReceipts().find(
    receipt => receipt.id === receiptId && String(receipt.userId) === String(userId)
  ) || null;
}

function createReceipt({ bookingId, userId, plumberId = null, amount = 0, serviceType = null, description = null, paymentMethod = 'SIMULATED' }) {
  if (!bookingId || !userId) {
    return null;
  }

  const existing = getReceiptForBooking(bookingId, userId);
  if (existing) {
    return existing;
  }

  const receipts = readReceipts();
  const receipt = {
    id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
    receiptNumber: buildReceiptNumber(),
    bookingId: String(bookingId),
    userId: String(userId),
    plumberId: plumberId === null || plumberId === undefined ? null : String(plumberId),
    amount: Number.isFinite(Number(amount)) ? Number(amount) : 0,
    serviceType: serviceType || null,
    description: description || null,
    paymentMethod,
    paidAt: new Date().toISOString()
  };

  receipts.push(receipt);
  writeReceipts(receipts);

  return receipt;
}

module.exports = {
  createReceipt,
  getReceiptForBooking,
  getReceiptsForUser,
  getReceiptById
};
