ALTER TABLE "ApiRateLimitBucket" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ApiRateLimitBucket" FROM PUBLIC, anon, authenticated;
