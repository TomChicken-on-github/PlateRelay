ALTER TABLE "orders" ADD COLUMN "group_id" uuid;--> statement-breakpoint
-- Plates uploaded together so far share their file.
UPDATE "orders" SET "group_id" = "file_id";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "split_from" integer;--> statement-breakpoint
CREATE INDEX "orders_group" ON "orders" USING btree ("group_id");
