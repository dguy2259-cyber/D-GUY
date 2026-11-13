ALTER TABLE "Project"
  ADD COLUMN "autoRecoveryEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE "RuntimeRecoverySession" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceVersionId" TEXT NOT NULL,
  "errorSignature" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stackTrace" TEXT,
  "sourceFile" TEXT,
  "line" INTEGER,
  "column" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'detected',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "RuntimeRecoverySession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RuntimeRecoveryAttempt" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'generating',
  "sourceVersionId" TEXT NOT NULL,
  "candidateVersionId" TEXT,
  "generationJobId" TEXT,
  "failureReason" TEXT,
  "validation" JSONB NOT NULL DEFAULT '{}',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "RuntimeRecoveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RuntimeRecoverySession_projectId_createdAt_idx"
  ON "RuntimeRecoverySession"("projectId", "createdAt");
CREATE INDEX "RuntimeRecoverySession_projectId_errorSignature_createdAt_idx"
  ON "RuntimeRecoverySession"("projectId", "errorSignature", "createdAt");
CREATE INDEX "RuntimeRecoverySession_projectId_status_updatedAt_idx"
  ON "RuntimeRecoverySession"("projectId", "status", "updatedAt");
CREATE UNIQUE INDEX "RuntimeRecoveryAttempt_sessionId_attemptNumber_key"
  ON "RuntimeRecoveryAttempt"("sessionId", "attemptNumber");
CREATE INDEX "RuntimeRecoveryAttempt_sessionId_startedAt_idx"
  ON "RuntimeRecoveryAttempt"("sessionId", "startedAt");
CREATE INDEX "RuntimeRecoveryAttempt_generationJobId_idx"
  ON "RuntimeRecoveryAttempt"("generationJobId");

ALTER TABLE "RuntimeRecoverySession"
  ADD CONSTRAINT "RuntimeRecoverySession_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RuntimeRecoveryAttempt"
  ADD CONSTRAINT "RuntimeRecoveryAttempt_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "RuntimeRecoverySession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RuntimeRecoverySession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RuntimeRecoveryAttempt" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "runtime_recovery_owner_access" ON "RuntimeRecoverySession"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "RuntimeRecoverySession"."projectId"
      AND p."ownerId" = auth.uid()::TEXT
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."id" = "RuntimeRecoverySession"."projectId"
      AND p."ownerId" = auth.uid()::TEXT
  ));

CREATE POLICY "runtime_recovery_attempt_owner_access" ON "RuntimeRecoveryAttempt"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "RuntimeRecoverySession" s
    JOIN "Project" p ON p."id" = s."projectId"
    WHERE s."id" = "RuntimeRecoveryAttempt"."sessionId"
      AND p."ownerId" = auth.uid()::TEXT
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "RuntimeRecoverySession" s
    JOIN "Project" p ON p."id" = s."projectId"
    WHERE s."id" = "RuntimeRecoveryAttempt"."sessionId"
      AND p."ownerId" = auth.uid()::TEXT
  ));
