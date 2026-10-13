-- Nullable by design: existing projects remain visible without rewriting rows.
ALTER TABLE "projects" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
