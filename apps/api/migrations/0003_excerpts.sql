-- Several bounded excerpts may legitimately refer to one immutable catalogue original.
ALTER TABLE sources DROP CONSTRAINT sources_original_key_key;
ALTER TABLE sources ADD COLUMN parent_id text REFERENCES sources(id);
ALTER TABLE sources ADD COLUMN selection jsonb;
ALTER TABLE sources ADD CONSTRAINT source_selection CHECK(selection IS NULL OR
 (jsonb_typeof(selection)='object' AND (selection->>'startMs')::integer>=0
  AND (selection->>'endMs')::integer-(selection->>'startMs')::integer BETWEEN 200 AND 45000));
CREATE INDEX sources_original_reference ON sources(original_key);
