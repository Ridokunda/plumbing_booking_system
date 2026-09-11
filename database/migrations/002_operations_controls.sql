CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  actor_id INT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(100) NULL,
  metadata JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity_type, entity_id, created_at),
  KEY idx_audit_actor (actor_id, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(idusers) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reschedule_requests (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  requested_by INT NOT NULL,
  proposed_start DATETIME NOT NULL,
  proposed_end DATETIME NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED','WITHDRAWN') NOT NULL DEFAULT 'PENDING',
  reviewed_by INT NULL,
  response_note VARCHAR(500) NULL,
  responded_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reschedule_booking_status (booking_id, status, created_at),
  CONSTRAINT fk_reschedule_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings) ON DELETE CASCADE,
  CONSTRAINT fk_reschedule_requester FOREIGN KEY (requested_by) REFERENCES users(idusers),
  CONSTRAINT fk_reschedule_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(idusers) ON DELETE SET NULL,
  CONSTRAINT chk_reschedule_window CHECK (proposed_end > proposed_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS disputes (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  opened_by INT NOT NULL,
  category ENUM('QUALITY','DAMAGE','BILLING','CONDUCT','OTHER') NOT NULL,
  description VARCHAR(2000) NOT NULL,
  status ENUM('OPEN','INVESTIGATING','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  resolution VARCHAR(2000) NULL,
  handled_by INT NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_disputes_status_created (status, created_at),
  KEY idx_disputes_booking (booking_id),
  CONSTRAINT fk_dispute_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings),
  CONSTRAINT fk_dispute_opener FOREIGN KEY (opened_by) REFERENCES users(idusers),
  CONSTRAINT fk_dispute_handler FOREIGN KEY (handled_by) REFERENCES users(idusers) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refunds (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_id INT NOT NULL,
  requested_by INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('REQUESTED','APPROVED','REJECTED','PROCESSING','REFUNDED','FAILED') NOT NULL DEFAULT 'REQUESTED',
  processed_by INT NULL,
  provider_refund_id VARCHAR(255) NULL,
  response_note VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_refunds_booking_status (booking_id, status, created_at),
  CONSTRAINT fk_refund_booking FOREIGN KEY (booking_id) REFERENCES bookings(idbookings),
  CONSTRAINT fk_refund_requester FOREIGN KEY (requested_by) REFERENCES users(idusers),
  CONSTRAINT fk_refund_processor FOREIGN KEY (processed_by) REFERENCES users(idusers) ON DELETE SET NULL,
  CONSTRAINT chk_refund_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

