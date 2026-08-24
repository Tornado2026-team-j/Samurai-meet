ALTER TABLE photos ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE photos ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS server_wrapped_image_key TEXT;

ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_size_bytes_check;
ALTER TABLE photos ADD CONSTRAINT photos_size_bytes_check CHECK (size_bytes >= 0);
