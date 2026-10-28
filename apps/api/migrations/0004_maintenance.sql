ALTER TABLE uploads ADD COLUMN temporary_deleted_at timestamptz;
ALTER TABLE stored_objects ADD COLUMN gc_checked_at timestamptz;
CREATE TABLE maintenance_runs (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('garbage-collection','backup','restore-drill')),
 status text NOT NULL CHECK(status IN ('running','pass','failed')), counts jsonb NOT NULL DEFAULT '{}',
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX objects_pending_collection ON stored_objects(collect_after,created_at) WHERE deleted_at IS NULL;
CREATE TABLE runtime_status (
 component text PRIMARY KEY CHECK(component IN ('media-worker')), seen_at timestamptz NOT NULL DEFAULT now()
);
