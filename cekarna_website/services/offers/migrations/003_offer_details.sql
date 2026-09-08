ALTER TABLE offers ADD COLUMN salary TEXT;
ALTER TABLE offers ADD COLUMN work_duration TEXT;
ALTER TABLE offers ADD COLUMN experience TEXT;
ALTER TABLE offers ADD COLUMN qualification TEXT;
ALTER TABLE offers ADD COLUMN skills_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE offers ADD COLUMN accessible_th INTEGER;
