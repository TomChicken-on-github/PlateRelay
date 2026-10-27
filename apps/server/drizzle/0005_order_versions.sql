CREATE TYPE "public"."version_state" AS ENUM('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TABLE "order_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"n" integer NOT NULL,
	"kind" text NOT NULL,
	"restored_from" integer,
	"state" "version_state" NOT NULL,
	"file_id" uuid NOT NULL,
	"plate_index" integer NOT NULL,
	"plate_count" integer NOT NULL,
	"plate_name" text DEFAULT '' NOT NULL,
	"printer_model" text,
	"printer_model_id" text NOT NULL,
	"nozzles" jsonb NOT NULL,
	"filaments" jsonb NOT NULL,
	"print_seconds" integer NOT NULL,
	"weight_grams" real NOT NULL,
	"thumbnail_key" text,
	"counted" boolean DEFAULT false NOT NULL,
	"switched" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "order_versions" ADD CONSTRAINT "order_versions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_versions" ADD CONSTRAINT "order_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_versions" ADD CONSTRAINT "order_versions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_versions_n" ON "order_versions" USING btree ("order_id","n");--> statement-breakpoint
-- Orders from before versions existed get their current file as version 1.
INSERT INTO "order_versions" ("order_id", "n", "kind", "state", "file_id", "plate_index", "plate_count", "plate_name", "printer_model", "printer_model_id", "nozzles", "filaments", "print_seconds", "weight_grams", "thumbnail_key", "created_at")
SELECT "id", 1, 'submit', CASE "status" WHEN 'PENDING_REVIEW' THEN 'pending'::version_state WHEN 'REJECTED' THEN 'rejected'::version_state ELSE 'approved'::version_state END,
  "file_id", "plate_index", "plate_count", "plate_name", "printer_model", "printer_model_id", "nozzles", "filaments", "print_seconds", "weight_grams", "thumbnail_key", "submitted_at"
FROM "orders";
