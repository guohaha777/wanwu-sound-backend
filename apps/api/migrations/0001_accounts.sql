CREATE TABLE accounts (
 id uuid PRIMARY KEY, username varchar(32) NOT NULL UNIQUE,
 nickname varchar(64) NOT NULL, password_hash text NOT NULL,
 role varchar(16) NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher','admin')),
 status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
 auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (username ~ '^[a-z0-9_-]{3,32}$'), CHECK (length(nickname) BETWEEN 1 AND 64)
);
CREATE TABLE invitations (
 id uuid PRIMARY KEY, digest varchar(64) NOT NULL UNIQUE CHECK (digest ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, redeemed_by uuid REFERENCES accounts(id), redeemed_at timestamptz,
 revoked_at timestamptz,
 CHECK ((redeemed_by IS NULL) = (redeemed_at IS NULL)),
 CHECK (redeemed_at IS NULL OR revoked_at IS NULL), CHECK (expires_at > created_at)
);
CREATE TABLE sessions (
 digest varchar(64) PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
 account_id uuid REFERENCES accounts(id), auth_version integer, data jsonb NOT NULL,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL,
 CHECK ((account_id IS NULL) = (auth_version IS NULL)),
 CHECK (expires_at <= absolute_expires_at AND absolute_expires_at > created_at)
);
CREATE INDEX sessions_account_idx ON sessions(account_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE revoked_sessions (
 digest varchar(64) PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'), expires_at timestamptz NOT NULL
);
CREATE INDEX revoked_sessions_expiry_idx ON revoked_sessions(expires_at);
CREATE TABLE password_resets (
 id uuid PRIMARY KEY, digest varchar(64) NOT NULL UNIQUE CHECK (digest ~ '^[a-f0-9]{64}$'),
 account_id uuid NOT NULL REFERENCES accounts(id), created_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 used_at timestamptz, revoked_at timestamptz,
 CHECK (expires_at > created_at), CHECK (used_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX password_resets_account_idx ON password_resets(account_id);
CREATE TABLE admin_audit (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES accounts(id),
 action varchar(64) NOT NULL, target_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
