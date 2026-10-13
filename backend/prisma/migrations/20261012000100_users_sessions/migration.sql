-- Add employee identities and revocable server-side sessions without touching projects.
CREATE TYPE "user_role" AS ENUM ('admin', 'manager', 'staff');
CREATE TYPE "user_status" AS ENUM ('pending_activation', 'active', 'disabled');

CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT,
    "role" "user_role" NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'pending_activation',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_name_not_blank_check" CHECK (char_length(btrim("name")) > 0),
    CONSTRAINT "users_email_canonical_check" CHECK (
        char_length("email") > 0
        AND "email" = lower(btrim("email"))
        AND "email" !~ '[[:space:]]'
    ),
    CONSTRAINT "users_active_password_check" CHECK ("status" <> 'active' OR "password_hash" IS NOT NULL),
    CONSTRAINT "users_disabled_at_check" CHECK (("status" = 'disabled') = ("disabled_at" IS NOT NULL)),
    CONSTRAINT "users_timestamp_order_check" CHECK ("updated_at" >= "created_at")
);

-- Canonicalization is enforced for every writer, including direct Prisma writes.
CREATE FUNCTION "normalize_user_email"() RETURNS TRIGGER AS $$
BEGIN
    NEW."email" := lower(btrim(NEW."email"));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_normalize_email"
BEFORE INSERT OR UPDATE OF "email" ON "users"
FOR EACH ROW EXECUTE FUNCTION "normalize_user_email"();

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "sessions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_token_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "sessions_last_seen_check" CHECK ("last_seen_at" >= "created_at"),
    CONSTRAINT "sessions_idle_expiry_check" CHECK ("idle_expires_at" > "created_at"),
    CONSTRAINT "sessions_absolute_expiry_check" CHECK ("absolute_expires_at" > "created_at"),
    CONSTRAINT "sessions_expiry_order_check" CHECK ("idle_expires_at" <= "absolute_expires_at"),
    CONSTRAINT "sessions_revoked_at_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at"),
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_revoked_idx" ON "sessions"("user_id", "revoked_at");
CREATE INDEX "sessions_idle_expires_idx" ON "sessions"("idle_expires_at");
CREATE INDEX "sessions_absolute_expires_idx" ON "sessions"("absolute_expires_at");
