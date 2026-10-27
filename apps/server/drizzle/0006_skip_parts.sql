ALTER TABLE "order_versions" ADD COLUMN "parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "order_versions" ADD COLUMN "parts_top_key" text;--> statement-breakpoint
ALTER TABLE "order_versions" ADD COLUMN "parts_pick_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "parts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "parts_top_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "parts_pick_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "skipped_parts" jsonb DEFAULT '[]'::jsonb NOT NULL;