-- Preserve the registration and Google account display name on the D-GUY profile.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fullName" TEXT;
