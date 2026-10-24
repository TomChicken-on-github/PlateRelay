CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'daemon', 'printer');--> statement-breakpoint
CREATE TYPE "public"."audit_result" AS ENUM('ok', 'failed', 'denied');--> statement-breakpoint
CREATE TYPE "public"."failure_attribution" AS ENUM('machine', 'model');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING_REVIEW', 'REJECTED', 'QUEUED', 'PRINTING', 'PRINTED_AWAITING_STORAGE', 'STORED_READY_PICKUP', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."printer_state" AS ENUM('OFFLINE', 'IDLE', 'PREPARING', 'PRINTING', 'ERROR_PAUSED', 'CLEARING_REQUIRED', 'UNMANAGED_PRINTING', 'MAINTENANCE');--> statement-breakpoint
CREATE SEQUENCE "public"."order_queue_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"result" "audit_result" DEFAULT 'ok' NOT NULL,
	"ip" text,
	"device" text
);
--> statement-breakpoint
CREATE TABLE "daemons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"network" text,
	"token_hash" text NOT NULL,
	"token_tail" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "daemons_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "external_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"key" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"fields" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status",
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" "order_status" NOT NULL,
	"owner_id" uuid NOT NULL,
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
	"form_version_id" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"queue_seq" bigint,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"reject_reason" text,
	"printer_id" uuid,
	"started_at" timestamp with time zone,
	"printed_at" timestamp with time zone,
	"error_paused_ms" bigint DEFAULT 0 NOT NULL,
	"stored_by" uuid,
	"stored_at" timestamp with time zone,
	"storage_slot" text,
	"store_photo_key" text,
	"redeemed_by" uuid,
	"redeemed_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"failed_by" uuid,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"attribution" "failure_attribution",
	"attributed_by" uuid,
	"attributed_at" timestamp with time zone,
	"retry_of" integer
);
--> statement-breakpoint
CREATE TABLE "pickup_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"order_id" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "printers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"serial" text NOT NULL,
	"ip" text NOT NULL,
	"daemon_id" uuid,
	"model" text,
	"model_id" text,
	"nozzles" jsonb,
	"storage" jsonb,
	"telemetry" jsonb,
	"state" "printer_state" DEFAULT 'OFFLINE' NOT NULL,
	"state_since" timestamp with time zone DEFAULT now() NOT NULL,
	"error" jsonb,
	"maintenance_reason" text,
	"current_order_id" integer,
	"starred" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printers_name_unique" UNIQUE("name"),
	CONSTRAINT "printers_serial_unique" UNIQUE("serial")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"builtin" boolean DEFAULT true NOT NULL,
	"permissions" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"role_id" text NOT NULL,
	CONSTRAINT "user_roles_user_id_scope_pk" PRIMARY KEY("user_id","scope")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"avatar_key" text,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daemons" ADD CONSTRAINT "daemons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stored_by_users_id_fk" FOREIGN KEY ("stored_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_failed_by_users_id_fk" FOREIGN KEY ("failed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_attributed_by_users_id_fk" FOREIGN KEY ("attributed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_codes" ADD CONSTRAINT "pickup_codes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_daemon_id_daemons_id_fk" FOREIGN KEY ("daemon_id") REFERENCES "public"."daemons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_at" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_target" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_actor" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_iss_sub" ON "external_identities" USING btree ("issuer","subject");--> statement-breakpoint
CREATE INDEX "order_events_order" ON "order_events" USING btree ("order_id","at");--> statement-breakpoint
CREATE INDEX "orders_status_queue" ON "orders" USING btree ("status","queue_seq","id");--> statement-breakpoint
CREATE INDEX "orders_owner" ON "orders" USING btree ("owner_id","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_retry_of" ON "orders" USING btree ("retry_of");--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_codes_code" ON "pickup_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "pickup_codes_order" ON "pickup_codes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower" ON "users" USING btree (lower("username"));