ALTER TABLE offers ADD COLUMN search_text TEXT NOT NULL DEFAULT '';
ALTER TABLE offers ADD COLUMN location_normalized TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS offers_search ON offers(search_text);
CREATE INDEX IF NOT EXISTS offers_location_normalized ON offers(location_normalized);
