-- Supabase Auth is the identity provider. Password values remain nullable for legacy rows only.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Ensure the generation job schema matches Prisma; IF NOT EXISTS also repairs older local schemas.
ALTER TABLE "GenerationJob" ADD COLUMN IF NOT EXISTS "requestKey" TEXT;
ALTER TABLE "GenerationJob" ADD COLUMN IF NOT EXISTS "contextFiles" JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS "GenerationJob_requestKey_key" ON "GenerationJob"("requestKey");

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GenerationJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_read_self" ON "User"
  FOR SELECT TO authenticated USING ("id" = auth.uid()::TEXT);

CREATE POLICY "project_owner_access" ON "Project"
  FOR ALL TO authenticated
  USING ("ownerId" = auth.uid()::TEXT)
  WITH CHECK ("ownerId" = auth.uid()::TEXT);

CREATE POLICY "version_owner_access" ON "Version"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = "Version"."projectId" AND p."ownerId" = auth.uid()::TEXT))
  WITH CHECK (EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = "Version"."projectId" AND p."ownerId" = auth.uid()::TEXT));

CREATE POLICY "generation_owner_access" ON "GenerationJob"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = "GenerationJob"."projectId" AND p."ownerId" = auth.uid()::TEXT))
  WITH CHECK (EXISTS (SELECT 1 FROM "Project" p WHERE p."id" = "GenerationJob"."projectId" AND p."ownerId" = auth.uid()::TEXT));

CREATE POLICY "usage_read_self" ON "Usage"
  FOR SELECT TO authenticated USING ("userId" = auth.uid()::TEXT);

CREATE POLICY "audit_read_self" ON "AuditEvent"
  FOR SELECT TO authenticated USING ("userId" = auth.uid()::TEXT);
