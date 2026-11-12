-- phase: expand
CREATE TYPE "public"."actor_type" AS ENUM('USER', 'SYSTEM', 'DAEMON', 'PRINTER');--> statement-breakpoint
CREATE TYPE "public"."attention_reason" AS ENUM('OFFLINE', 'ERROR', 'MAINTENANCE', 'JUDGE', 'SEND_FAILED', 'DAEMON_UPGRADE');--> statement-breakpoint
CREATE TYPE "public"."colour_pref" AS ENUM('EXACT', 'SIMILAR', 'ANY');--> statement-breakpoint
CREATE TYPE "public"."command_class" AS ENUM('CONTROL', 'SETPOINT', 'READ');--> statement-breakpoint
CREATE TYPE "public"."command_status" AS ENUM('QUEUED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'FAILED', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."job_outcome" AS ENUM('SEND_FAILED', 'START_FAILED', 'STOPPED_BEFORE_START', 'FAILED', 'FINISHED');--> statement-breakpoint
CREATE TYPE "public"."job_phase" AS ENUM('TRANSFERRING', 'PREPARING', 'PRINTING', 'PAUSED', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING_REVIEW', 'REJECTED', 'QUEUED', 'DISPATCHED', 'PRINTING', 'FAILED', 'PRINTED', 'READY', 'COMPLETED', 'CANCELLED', 'DISPOSED');--> statement-breakpoint
CREATE TYPE "public"."pause_reason" AS ENUM('USER', 'ERROR', 'RUNOUT');--> statement-breakpoint
CREATE TYPE "public"."printer_event_kind" AS ENUM('PAUSED', 'RESUMED', 'ERROR', 'HMS', 'CONNECTION_DOWN', 'CONNECTION_UP', 'REFILL');--> statement-breakpoint
CREATE TYPE "public"."printer_state" AS ENUM('AVAILABLE', 'WORKING', 'ATTENTION', 'CLEARING_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."process_node" AS ENUM('SUBMIT', 'REVIEW', 'QUEUE', 'PRINT', 'STORE', 'PICKUP');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('APPLICANT', 'STAFF', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."version_kind" AS ENUM('SUBMIT', 'REPLACE', 'REVISION', 'RESTORE');--> statement-breakpoint
CREATE TYPE "public"."version_state" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'REPLACED');--> statement-breakpoint
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
	"result" text DEFAULT 'OK' NOT NULL,
	"request_id" text,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "daemon_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"daemon_id" uuid NOT NULL,
	"printer_id" uuid,
	"job_id" uuid,
	"kind" text NOT NULL,
	"class" "command_class" NOT NULL,
	"payload" jsonb NOT NULL,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "command_status" DEFAULT 'QUEUED' NOT NULL,
	"result" jsonb,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "daemon_enrollments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"daemon_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daemon_enrollments_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "daemon_inbox" (
	"message_id" text PRIMARY KEY NOT NULL,
	"daemon_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daemons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"key_fingerprint" text NOT NULL,
	"protocol_version" text NOT NULL,
	"daemon_version" text NOT NULL,
	"platform" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "daemons_key_fingerprint_unique" UNIQUE("key_fingerprint")
);
--> statement-breakpoint
CREATE TABLE "file_checks" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"parser_version" text DEFAULT '1' NOT NULL,
	"plates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verdict" text,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fields" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"principal" text NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_principal_method_route_key_pk" PRIMARY KEY("principal","method","route","key")
);
--> statement-breakpoint
CREATE TABLE "order_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"node" "process_node" NOT NULL,
	"kind" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"from_status" "order_status",
	"to_status" "order_status",
	"version_n" integer,
	"job_id" uuid,
	"note" text,
	"note_visible" boolean DEFAULT false NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"kind" "version_kind" NOT NULL,
	"restored_from_id" uuid,
	"state" "version_state" DEFAULT 'PENDING' NOT NULL,
	"file_id" uuid NOT NULL,
	"plate_index" integer NOT NULL,
	"plate_count" integer NOT NULL,
	"plate_name" text DEFAULT '' NOT NULL,
	"model_id" text NOT NULL,
	"model_name" text,
	"nozzles" jsonb NOT NULL,
	"filaments" jsonb NOT NULL,
	"print_seconds" integer NOT NULL,
	"weight_grams" integer NOT NULL,
	"sliced_bed_type" text,
	"thumbnail_key" text,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parts_top_key" text,
	"parts_pick_key" text,
	"delta_seconds" integer,
	"places_back" integer,
	"counted" boolean DEFAULT false NOT NULL,
	"model_switch" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "order_versions_n" UNIQUE("order_id","n"),
	CONSTRAINT "order_versions_owner" UNIQUE("id","order_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" bigserial NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"sort_key" bigint,
	"active_version_id" uuid NOT NULL,
	"pending_version_id" uuid,
	"colour_pref" "colour_pref" DEFAULT 'SIMILAR' NOT NULL,
	"bed_type" text,
	"form_version_id" uuid,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision_count" integer DEFAULT 0 NOT NULL,
	"model_switch_count" integer DEFAULT 0 NOT NULL,
	"printer_id" uuid,
	"current_job_id" uuid,
	"bypassed_since" timestamp with time zone,
	"storage_slot" text,
	"store_photo_key" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"reprint_declined_at" timestamp with time zone,
	"reprint_declined_by" uuid,
	"reprint_declined_reason" text,
	"reprint_declined_reason_visible" boolean DEFAULT true NOT NULL,
	"files_expire_at" timestamp with time zone,
	CONSTRAINT "orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "pickup_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" uuid,
	CONSTRAINT "pickup_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "print_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attempt" integer NOT NULL,
	"phase" "job_phase" DEFAULT 'TRANSFERRING' NOT NULL,
	"phase_since" timestamp with time zone DEFAULT now() NOT NULL,
	"paused_from" "job_phase",
	"order_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"printer_id" uuid NOT NULL,
	"dispatched_by" uuid,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suggested" boolean DEFAULT false NOT NULL,
	"bypassed_order_ids" uuid[] DEFAULT '{}' NOT NULL,
	"bed_type" text,
	"mapping" jsonb NOT NULL,
	"mapping_settings_version" integer DEFAULT 0 NOT NULL,
	"safety_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"start_command_id" uuid,
	"prepared_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"outcome" "job_outcome",
	"pause_reason" "pause_reason",
	"paused_ms" bigint DEFAULT 0 NOT NULL,
	"skipped_parts" integer[] DEFAULT '{}' NOT NULL,
	"last_percent" integer,
	"end_photo_key" text,
	"end_photo_at" timestamp with time zone,
	"fail_reason" text
);
--> statement-breakpoint
CREATE TABLE "printer_errors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"printer_id" uuid NOT NULL,
	"job_id" uuid,
	"error_id" text NOT NULL,
	"channel" text NOT NULL,
	"vendor_code" text NOT NULL,
	"severity" text NOT NULL,
	"module" text,
	"message" text,
	"help_url" text,
	"blocks_job" boolean DEFAULT false NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by" text,
	"resolved_action" text,
	"resolved_by" uuid,
	"command_id" uuid,
	CONSTRAINT "printer_errors_one" UNIQUE("printer_id","error_id")
);
--> statement-breakpoint
CREATE TABLE "printer_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"printer_id" uuid NOT NULL,
	"job_id" uuid,
	"kind" "printer_event_kind" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printer_live" (
	"printer_id" uuid PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"boot_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"reconciled_seq" bigint,
	"run_seq" bigint DEFAULT 0 NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printer_reasons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"printer_id" uuid NOT NULL,
	"reason" "attention_reason" NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" uuid,
	"note" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by" uuid
);
--> statement-breakpoint
CREATE TABLE "printers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand" text NOT NULL,
	"serial" text NOT NULL,
	"name" text NOT NULL,
	"daemon_id" uuid NOT NULL,
	"host" text NOT NULL,
	"model_id" text,
	"model_name" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"open_to_applicants" boolean DEFAULT false NOT NULL,
	"state" "printer_state" DEFAULT 'ATTENTION' NOT NULL,
	"state_since" timestamp with time zone DEFAULT now() NOT NULL,
	"current_job_id" uuid,
	"external_running" boolean DEFAULT false NOT NULL,
	"bed_type" text,
	"access_code_cipher" text,
	"access_code_key_fingerprint" text,
	"access_code_set_at" timestamp with time zone,
	"starred" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printers_name_unique" UNIQUE("name"),
	CONSTRAINT "printers_brand_serial" UNIQUE("brand","serial")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"section" text PRIMARY KEY NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tray_grams" (
	"printer_id" uuid NOT NULL,
	"unit" integer NOT NULL,
	"slot" integer NOT NULL,
	"grams" integer NOT NULL,
	"unconfirmed" boolean DEFAULT true NOT NULL,
	"loaded_tag" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "tray_grams_printer_id_unit_slot_pk" PRIMARY KEY("printer_id","unit","slot")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"phone" text,
	"password_hash" text,
	"role" "role" DEFAULT 'APPLICANT' NOT NULL,
	"avatar_key" text,
	"locale" text DEFAULT 'zh-CN' NOT NULL,
	"disabled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daemon_commands" ADD CONSTRAINT "daemon_commands_daemon_id_daemons_id_fk" FOREIGN KEY ("daemon_id") REFERENCES "public"."daemons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_commands" ADD CONSTRAINT "daemon_commands_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_commands" ADD CONSTRAINT "daemon_commands_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_enrollments" ADD CONSTRAINT "daemon_enrollments_daemon_id_daemons_id_fk" FOREIGN KEY ("daemon_id") REFERENCES "public"."daemons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_enrollments" ADD CONSTRAINT "daemon_enrollments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemons" ADD CONSTRAINT "daemons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_checks" ADD CONSTRAINT "file_checks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_records" ADD CONSTRAINT "order_records_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_versions" ADD CONSTRAINT "order_versions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_versions" ADD CONSTRAINT "order_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_versions" ADD CONSTRAINT "order_versions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_reprint_declined_by_users_id_fk" FOREIGN KEY ("reprint_declined_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_codes" ADD CONSTRAINT "pickup_codes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_codes" ADD CONSTRAINT "pickup_codes_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_version_id_order_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."order_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_errors" ADD CONSTRAINT "printer_errors_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_errors" ADD CONSTRAINT "printer_errors_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_events" ADD CONSTRAINT "printer_events_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_live" ADD CONSTRAINT "printer_live_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_reasons" ADD CONSTRAINT "printer_reasons_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer_reasons" ADD CONSTRAINT "printer_reasons_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printers" ADD CONSTRAINT "printers_daemon_id_daemons_id_fk" FOREIGN KEY ("daemon_id") REFERENCES "public"."daemons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tray_grams" ADD CONSTRAINT "tray_grams_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tray_grams" ADD CONSTRAINT "tray_grams_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_by_target" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "daemon_commands_outbox" ON "daemon_commands" USING btree ("daemon_id","status");--> statement-breakpoint
CREATE INDEX "daemon_commands_by_job" ON "daemon_commands" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "files_by_uploader" ON "files" USING btree ("uploaded_by","sha256");--> statement-breakpoint
CREATE INDEX "order_records_by_order" ON "order_records" USING btree ("order_id","id");--> statement-breakpoint
CREATE INDEX "orders_queue" ON "orders" USING btree ("status","sort_key");--> statement-breakpoint
CREATE INDEX "orders_by_owner" ON "orders" USING btree ("owner_id","id");--> statement-breakpoint
CREATE INDEX "pickup_codes_by_order" ON "pickup_codes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "print_jobs_by_printer" ON "print_jobs" USING btree ("printer_id","dispatched_at","id");--> statement-breakpoint
CREATE INDEX "print_jobs_by_order" ON "print_jobs" USING btree ("order_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "print_jobs_one_per_printer" ON "print_jobs" USING btree ("printer_id") WHERE "print_jobs"."phase" <> 'ENDED';--> statement-breakpoint
CREATE UNIQUE INDEX "print_jobs_one_per_order" ON "print_jobs" USING btree ("order_id") WHERE "print_jobs"."phase" <> 'ENDED';--> statement-breakpoint
CREATE INDEX "printer_events_by_printer" ON "printer_events" USING btree ("printer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "printer_reasons_one_each" ON "printer_reasons" USING btree ("printer_id","reason",coalesce("job_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower" ON "users" USING btree (lower("username"));