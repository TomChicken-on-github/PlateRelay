ALTER TABLE "orders" DROP CONSTRAINT "orders_file_id_files_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "original_print_seconds" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "file_id";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "plate_index";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "plate_count";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "plate_name";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "printer_model";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "printer_model_id";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "nozzles";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "filaments";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "print_seconds";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "weight_grams";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "thumbnail_key";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "parts";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "parts_top_key";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "parts_pick_key";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "revision";