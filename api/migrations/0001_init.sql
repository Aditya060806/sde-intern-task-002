CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL CONSTRAINT members_home_fk REFERENCES homes (id) ON DELETE CASCADE,
  name TEXT NOT NULL CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0),
  position INTEGER NOT NULL CONSTRAINT members_position_non_negative CHECK (position >= 0),
  CONSTRAINT members_home_position_unique UNIQUE (home_id, position),
  CONSTRAINT members_id_home_unique UNIQUE (id, home_id)
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL CONSTRAINT bills_home_fk REFERENCES homes (id) ON DELETE CASCADE,
  title TEXT NOT NULL CONSTRAINT bills_title_not_blank CHECK (length(trim(title)) > 0),
  total_cents INTEGER NOT NULL CONSTRAINT bills_total_positive_integer
    CHECK (typeof(total_cents) = 'integer' AND total_cents > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT bills_id_home_unique UNIQUE (id, home_id)
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CONSTRAINT shares_amount_non_negative_integer
    CHECK (typeof(amount_cents) = 'integer' AND amount_cents >= 0),
  paid_at TEXT,
  idempotency_key TEXT,
  CONSTRAINT shares_bill_fk FOREIGN KEY (bill_id, home_id)
    REFERENCES bills (id, home_id) ON DELETE CASCADE,
  CONSTRAINT shares_member_fk FOREIGN KEY (member_id, home_id)
    REFERENCES members (id, home_id) ON DELETE CASCADE,
  CONSTRAINT shares_bill_member_unique UNIQUE (bill_id, member_id),
  CONSTRAINT shares_paid_has_key CHECK ((paid_at IS NULL) = (idempotency_key IS NULL))
);

CREATE INDEX shares_member_unpaid_idx ON shares (member_id) WHERE paid_at IS NULL;
