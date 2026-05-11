ALTER TABLE broadcasts ADD COLUMN target_filter TEXT;
ALTER TABLE broadcasts ADD COLUMN target_count INTEGER;
ALTER TABLE broadcasts ADD COLUMN ok_count INTEGER;
ALTER TABLE broadcasts ADD COLUMN failed_count INTEGER;
