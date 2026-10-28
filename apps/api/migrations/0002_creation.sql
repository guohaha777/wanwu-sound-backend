CREATE TABLE sources (
 id text PRIMARY KEY CHECK(length(id)<=128), owner_id uuid REFERENCES accounts(id), catalogue boolean NOT NULL DEFAULT false,
 metadata jsonb NOT NULL, checksum char(64) NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'), bytes integer NOT NULL CHECK(bytes>0 AND bytes<=20971520),
 status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','queued','processing','ready','failed','disabled')),
 original_key text UNIQUE, original_version text, playback_key text UNIQUE, playback_checksum char(64),
 analysis jsonb, duration_ms double precision, failure text, lease_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((catalogue AND owner_id IS NULL) OR (NOT catalogue AND owner_id IS NOT NULL)),
 CHECK(status<>'ready' OR (original_key IS NOT NULL AND playback_key IS NOT NULL AND analysis IS NOT NULL AND duration_ms>0))
);
CREATE TABLE uploads (
 id uuid PRIMARY KEY, source_id text NOT NULL UNIQUE REFERENCES sources(id), temporary_key text NOT NULL UNIQUE,
 final_key text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE works (
 id text PRIMARY KEY CHECK(length(id)<=128), owner_id uuid NOT NULL REFERENCES accounts(id), title varchar(64) NOT NULL CHECK(length(title) BETWEEN 1 AND 16),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','saved')),
 arrangement jsonb NOT NULL, settings jsonb NOT NULL, saved_revision integer,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 CHECK(saved_revision IS NULL OR (saved_revision>0 AND saved_revision<=revision))
);
CREATE INDEX works_owner ON works(owner_id,updated_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE TABLE work_source_refs (
 work_id text NOT NULL REFERENCES works(id), source_id text NOT NULL REFERENCES sources(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(work_id,source_id)
);
CREATE TABLE work_snapshots (
 work_id text NOT NULL REFERENCES works(id), revision integer NOT NULL CHECK(revision>0), content jsonb NOT NULL,
 source_refs jsonb NOT NULL, rules jsonb NOT NULL, renderer_version text NOT NULL, timbre_version text NOT NULL,
 input_digest char(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(work_id,revision)
);
CREATE TABLE render_artifacts (
 id uuid PRIMARY KEY, work_id text NOT NULL, revision integer NOT NULL, input_digest char(64) NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','processing','ready','failed')), job_id uuid, lease_id uuid,
 object_key text UNIQUE, checksum char(64), bytes integer, duration_ms double precision, failure text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(work_id,revision) REFERENCES work_snapshots(work_id,revision), UNIQUE(work_id,revision),
 CHECK(status<>'ready' OR (object_key IS NOT NULL AND checksum IS NOT NULL AND bytes>0 AND duration_ms>0))
);
CREATE TABLE confirmations (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES accounts(id), kind text NOT NULL CHECK(kind IN ('library','publication')),
 target_id text NOT NULL, fingerprint char(64) NOT NULL, parameters jsonb NOT NULL, statement_version text NOT NULL,
 confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE library_entries (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES accounts(id), source_id text NOT NULL REFERENCES sources(id),
 kind text NOT NULL CHECK(kind IN ('source','sound-unit')), scope text NOT NULL CHECK(scope IN ('private','teachers')),
 unit jsonb, source_checksum char(64) NOT NULL, confirmation_id uuid NOT NULL REFERENCES confirmations(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), removed_at timestamptz, disabled_at timestamptz,
 CHECK((kind='source' AND unit IS NULL) OR (kind='sound-unit' AND unit IS NOT NULL))
);
CREATE INDEX library_active ON library_entries(scope,created_at DESC,id DESC) WHERE removed_at IS NULL AND disabled_at IS NULL;
CREATE TABLE publications (
 work_id text PRIMARY KEY REFERENCES works(id), revision integer NOT NULL, token varchar(43) NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN ('pending-render','published','revoked')), generation uuid NOT NULL,
 confirmation_id uuid NOT NULL REFERENCES confirmations(id), created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz, revoked_at timestamptz,
 FOREIGN KEY(work_id,revision) REFERENCES work_snapshots(work_id,revision)
);
CREATE TABLE content_audit (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES accounts(id), action text NOT NULL, target_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stored_objects (
 object_key text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('original','playback','render')), source_id text REFERENCES sources(id), render_id uuid REFERENCES render_artifacts(id),
 created_at timestamptz NOT NULL DEFAULT now(), collect_after timestamptz, deleted_at timestamptz
);
