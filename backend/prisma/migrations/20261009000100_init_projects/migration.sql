-- Generated from prisma/schema.prisma and extended with PostgreSQL CHECK constraints.
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "project_code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "priority" VARCHAR(16) NOT NULL DEFAULT 'medium',
    "start_date" DATE,
    "due_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "projects_id_positive_check" CHECK ("id" > 0),
    CONSTRAINT "projects_code_format_check" CHECK ("project_code" ~ '^PRJ-[0-9]{4}-[0-9]{4,}$'),
    CONSTRAINT "projects_name_not_blank_check" CHECK (char_length(btrim("name")) > 0),
    CONSTRAINT "projects_description_length_check" CHECK ("description" IS NULL OR char_length("description") <= 4000),
    CONSTRAINT "projects_status_check" CHECK ("status" IN ('pending', 'in_progress', 'completed', 'cancelled')),
    CONSTRAINT "projects_priority_check" CHECK ("priority" IN ('low', 'medium', 'high', 'urgent')),
    CONSTRAINT "projects_date_range_check" CHECK ("start_date" IS NULL OR "due_date" IS NULL OR "due_date" >= "start_date"),
    CONSTRAINT "projects_timestamp_order_check" CHECK ("updated_at" >= "created_at")
);

CREATE UNIQUE INDEX "projects_project_code_key" ON "projects"("project_code");
CREATE INDEX "projects_status_updated_id_idx" ON "projects"("status", "updated_at" DESC, "id" DESC);
CREATE INDEX "projects_updated_id_idx" ON "projects"("updated_at" DESC, "id" DESC);
