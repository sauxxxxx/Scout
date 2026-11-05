ALTER TABLE finder_searches ADD COLUMN map_bounds_json TEXT;
ALTER TABLE finder_results ADD COLUMN latitude REAL;
ALTER TABLE finder_results ADD COLUMN longitude REAL;
