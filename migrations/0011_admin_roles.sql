ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';

UPDATE admins SET role = 'admin' WHERE role IS NULL OR role = '';
