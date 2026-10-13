-- A durable, per-UTC-year counter. The code has room for at most 23 digits in VARCHAR(32).
CREATE TABLE "project_code_counters" (
    "year" INTEGER NOT NULL,
    "last_sequence" NUMERIC(23,0) NOT NULL,

    CONSTRAINT "project_code_counters_pkey" PRIMARY KEY ("year"),
    CONSTRAINT "project_code_counters_year_check" CHECK ("year" BETWEEN 1 AND 9999),
    CONSTRAINT "project_code_counters_sequence_check" CHECK ("last_sequence" BETWEEN 1 AND 99999999999999999999999)
);

-- This one-time migration accounts for all existing codes without touching project rows.
INSERT INTO "project_code_counters" ("year", "last_sequence")
SELECT substring("project_code" from 5 for 4)::INTEGER,
       MAX(substring("project_code" from 10)::NUMERIC(23,0))
FROM "projects"
GROUP BY substring("project_code" from 5 for 4)::INTEGER;
