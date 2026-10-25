ALTER TABLE "daemons" ADD COLUMN "public_key" text;--> statement-breakpoint
ALTER TABLE "daemons" ADD COLUMN "key_id" text;--> statement-breakpoint
ALTER TABLE "daemons" ADD COLUMN "key_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "access_code_cipher" text;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "access_code_key_id" text;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "access_code_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "printers" ADD COLUMN "access_code_delivered_at" timestamp with time zone;