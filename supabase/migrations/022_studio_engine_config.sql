-- Studio workstation config for hassle-free engine provisioning.
-- After Google login, engine-provision returns these env keys to the local engine.
-- Artists never paste AWS/MinIO secrets.

CREATE TABLE IF NOT EXISTS studio_engine_config (
  studio_id UUID PRIMARY KEY,
  storage_provider TEXT NOT NULL DEFAULT 'hybrid',
  aws_region TEXT,
  aws_access_key_id TEXT,
  aws_secret_access_key TEXT,
  aws_s3_bucket_name TEXT,
  hybrid_endpoint TEXT,
  hybrid_bucket TEXT,
  hybrid_access_key TEXT,
  hybrid_secret_key TEXT,
  hybrid_region TEXT DEFAULT 'us-east-1',
  web_origins TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

-- Optional FK when studios table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'studios'
  ) THEN
    BEGIN
      ALTER TABLE studio_engine_config
        ADD CONSTRAINT studio_engine_config_studio_id_fkey
        FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

ALTER TABLE studio_engine_config ENABLE ROW LEVEL SECURITY;

-- Studio admins can read their studio config (service role used by edge for writes/reads)
DROP POLICY IF EXISTS "studio_engine_config_member_select" ON studio_engine_config;
CREATE POLICY "studio_engine_config_member_select"
  ON studio_engine_config FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM studio_members sm
      WHERE sm.studio_id = studio_engine_config.studio_id
        AND sm.user_id = auth.uid()
    )
  );

GRANT SELECT ON studio_engine_config TO authenticated;
GRANT ALL ON studio_engine_config TO service_role;
