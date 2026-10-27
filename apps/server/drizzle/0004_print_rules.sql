CREATE TYPE "public"."colour_pref" AS ENUM('exact', 'similar', 'any');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "colour_pref" "colour_pref" DEFAULT 'similar' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "bed_type" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "original_print_seconds" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "revision_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "model_switch_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "revision" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "skipped_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "trays" jsonb;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "bed_type" text;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "open_to_contestants" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Printers added before this switch existed keep taking orders; new ones start closed.
UPDATE "printers" SET "open_to_contestants" = true;--> statement-breakpoint
UPDATE "orders" SET "original_print_seconds" = "print_seconds";
