CREATE TABLE IF NOT EXISTS users (
  idusers INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  surname VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password VARCHAR(255) NOT NULL,
  usertype TINYINT NOT NULL DEFAULT 1,
  phone VARCHAR(30) NULL,
  address VARCHAR(500) NULL,
  profile_picture VARCHAR(500) NULL,
  email_verified_at DATETIME NULL,
  account_status ENUM('PENDING','ACTIVE','SUSPENDED','DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (idusers),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role_status (usertype, account_status),
  CONSTRAINT chk_users_role CHECK (usertype IN (1,2,3))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_sessions (
  session_id VARCHAR(128) NOT NULL,
  data MEDIUMTEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (session_id),
  KEY idx_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plumber_profiles (
  user_id INT NOT NULL,
  license_number VARCHAR(100) NULL,
  years_experience TINYINT NULL,
  service_area VARCHAR(255) NULL,
  skills JSON NULL,
  verification_status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  verified_by INT NULL,
  verified_at DATETIME NULL,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_plumber_license (license_number),
  CONSTRAINT fk_plumber_user FOREIGN KEY (user_id) REFERENCES users(idusers) ON DELETE CASCADE,
  CONSTRAINT fk_plumber_verifier FOREIGN KEY (verified_by) REFERENCES users(idusers) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS account_tokens (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  purpose ENUM('VERIFY_EMAIL','RESET_PASSWORD') NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_token_hash (token_hash),
  KEY idx_account_tokens_user (user_id, purpose, expires_at),
  CONSTRAINT fk_account_token_user FOREIGN KEY (user_id) REFERENCES users(idusers) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bookings (
  idbookings INT NOT NULL AUTO_INCREMENT,
  idUser INT NOT NULL,
  idPlumber INT NULL,
  type VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  location VARCHAR(500) NOT NULL,
  date_start DATE NOT NULL,
  scheduled_start DATETIME NULL,
  scheduled_end DATETIME NULL,
  status ENUM('NEW','PENDING','ASSIGNED','IN_PROGRESS','COMPLETED','PAID','CANCELLED','DECLINED') NOT NULL DEFAULT 'NEW',
  amount DECIMAL(12,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ZAR',
  before_photo VARCHAR(500) NULL,
  after_photo VARCHAR(500) NULL,
  cancellation_reason VARCHAR(500) NULL,
  decline_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (idbookings),
  KEY idx_bookings_customer (idUser, created_at),
  KEY idx_bookings_plumber_schedule (idPlumber, scheduled_start, scheduled_end),
  KEY idx_bookings_status (status, created_at),
  CONSTRAINT fk_booking_customer FOREIGN KEY (idUser) REFERENCES users(idusers),
  CONSTRAINT fk_booking_plumber FOREIGN KEY (idPlumber) REFERENCES users(idusers) ON DELETE SET NULL,
  CONSTRAINT chk_booking_schedule CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end > scheduled_start),
  CONSTRAINT chk_booking_amount CHECK (amount IS NULL OR amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_dates (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  date_start DATE NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_preferred_date (booking_id, date_start),
  KEY idx_booking_dates_date (date_start),
  CONSTRAINT fk_booking_date_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_status_history (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NOT NULL,
  changed_by INT NOT NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_status_history_booking (booking_id, created_at),
  CONSTRAINT fk_status_history_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings) ON DELETE CASCADE,
  CONSTRAINT fk_status_history_user FOREIGN KEY (changed_by) REFERENCES users(idusers)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plumber_availability (
  id BIGINT NOT NULL AUTO_INCREMENT,
  plumber_id INT NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  availability_type ENUM('AVAILABLE','UNAVAILABLE') NOT NULL DEFAULT 'AVAILABLE',
  PRIMARY KEY (id),
  KEY idx_availability_plumber_time (plumber_id, starts_at, ends_at),
  CONSTRAINT fk_availability_plumber FOREIGN KEY (plumber_id) REFERENCES users(idusers) ON DELETE CASCADE,
  CONSTRAINT chk_availability_time CHECK (ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotes (
  idquote INT NOT NULL AUTO_INCREMENT,
  quote_number VARCHAR(40) NOT NULL,
  booking_id INT NOT NULL,
  created_by INT NOT NULL,
  status ENUM('DRAFT','SENT','APPROVED','REJECTED','EXPIRED') NOT NULL DEFAULT 'DRAFT',
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'ZAR',
  expires_at DATETIME NULL,
  customer_responded_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (idquote),
  UNIQUE KEY uq_quote_number (quote_number),
  KEY idx_quotes_booking (booking_id, status),
  CONSTRAINT fk_quote_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings) ON DELETE CASCADE,
  CONSTRAINT fk_quote_creator FOREIGN KEY (created_by) REFERENCES users(idusers)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quote_items (
  id BIGINT NOT NULL AUTO_INCREMENT,
  quote_id INT NOT NULL,
  description VARCHAR(500) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_quote_item_quote FOREIGN KEY (quote_id) REFERENCES quotes(idquote) ON DELETE CASCADE,
  CONSTRAINT chk_quote_item_values CHECK (quantity > 0 AND unit_price >= 0 AND line_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_notes (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  author_id INT NOT NULL,
  visibility ENUM('INTERNAL','CUSTOMER') NOT NULL DEFAULT 'INTERNAL',
  note TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_job_notes_booking (booking_id, created_at),
  CONSTRAINT fk_job_note_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings) ON DELETE CASCADE,
  CONSTRAINT fk_job_note_author FOREIGN KEY (author_id) REFERENCES users(idusers)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS booking_photos (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  uploaded_by INT NOT NULL,
  photo_type ENUM('BEFORE','PROGRESS','AFTER') NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  caption VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_booking_photos_booking (booking_id, created_at),
  CONSTRAINT fk_booking_photo_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings) ON DELETE CASCADE,
  CONSTRAINT fk_booking_photo_user FOREIGN KEY (uploaded_by) REFERENCES users(idusers)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS completion_confirmations (
  booking_id INT NOT NULL,
  customer_id INT NOT NULL,
  signature_name VARCHAR(200) NOT NULL,
  confirmed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (booking_id),
  CONSTRAINT fk_completion_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings),
  CONSTRAINT fk_completion_customer FOREIGN KEY (customer_id) REFERENCES users(idusers)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  booking_id INT NULL,
  type VARCHAR(80) NOT NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_user_unread (user_id, read_at, created_at),
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(idusers) ON DELETE CASCADE,
  CONSTRAINT fk_notification_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  idinvoice INT NOT NULL AUTO_INCREMENT,
  invoice_number VARCHAR(40) NOT NULL,
  booking_id INT NOT NULL,
  customer_id INT NOT NULL,
  plumber_id INT NULL,
  service_type VARCHAR(100) NULL,
  description TEXT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'ZAR',
  status ENUM('PENDING','PAID','VOID','REFUNDED') NOT NULL DEFAULT 'PENDING',
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (idinvoice),
  UNIQUE KEY uq_invoice_number (invoice_number),
  UNIQUE KEY uq_invoice_booking (booking_id),
  CONSTRAINT fk_invoice_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings),
  CONSTRAINT fk_invoice_customer FOREIGN KEY (customer_id) REFERENCES users(idusers),
  CONSTRAINT fk_invoice_plumber FOREIGN KEY (plumber_id) REFERENCES users(idusers) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_receipts (
  idreceipt INT NOT NULL AUTO_INCREMENT,
  receipt_number VARCHAR(60) NOT NULL,
  invoice_id INT NOT NULL,
  booking_id INT NOT NULL,
  customer_id INT NOT NULL,
  plumber_id INT NULL,
  provider VARCHAR(40) NOT NULL DEFAULT 'SIMULATED',
  provider_payment_id VARCHAR(255) NULL,
  payment_method VARCHAR(40) NOT NULL,
  amount_paid DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ZAR',
  paid_at DATETIME NOT NULL,
  notes VARCHAR(500) NULL,
  PRIMARY KEY (idreceipt),
  UNIQUE KEY uq_receipt_number (receipt_number),
  UNIQUE KEY uq_receipt_booking (booking_id),
  UNIQUE KEY uq_provider_payment (provider, provider_payment_id),
  CONSTRAINT fk_receipt_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(idinvoice),
  CONSTRAINT fk_receipt_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings),
  CONSTRAINT fk_receipt_customer FOREIGN KEY (customer_id) REFERENCES users(idusers),
  CONSTRAINT fk_receipt_plumber FOREIGN KEY (plumber_id) REFERENCES users(idusers) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reviews (
  idreview INT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  customer_id INT NOT NULL,
  plumber_id INT NOT NULL,
  rating TINYINT NOT NULL,
  comment VARCHAR(1500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (idreview),
  UNIQUE KEY uq_review_booking (booking_id),
  KEY idx_reviews_plumber (plumber_id, created_at),
  CONSTRAINT fk_review_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings),
  CONSTRAINT fk_review_customer FOREIGN KEY (customer_id) REFERENCES users(idusers),
  CONSTRAINT fk_review_plumber FOREIGN KEY (plumber_id) REFERENCES users(idusers),
  CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contact_messages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(30) NULL,
  email VARCHAR(254) NOT NULL,
  message VARCHAR(2000) NOT NULL,
  status ENUM('NEW','IN_PROGRESS','RESOLVED','SPAM') NOT NULL DEFAULT 'NEW',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contact_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

