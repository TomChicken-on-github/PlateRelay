-- phase: expand
-- Rules the tables cannot express on their own: version pointers that stay inside their order,
-- records that are append-only, versions that are immutable once decided.

ALTER TABLE "orders" ADD CONSTRAINT "orders_active_version_in_order" FOREIGN KEY ("active_version_id", "id") REFERENCES "order_versions" ("id", "order_id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pending_version_in_order" FOREIGN KEY ("pending_version_id", "id") REFERENCES "order_versions" ("id", "order_id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pending_only_in_review" CHECK ("pending_version_id" IS NULL OR ("status" = 'PENDING_REVIEW' AND "sort_key" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_outcome_when_ended" CHECK (("phase" = 'ENDED') = ("outcome" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_paused_from" CHECK (("phase" = 'PAUSED') = ("paused_from" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "tray_grams" ADD CONSTRAINT "tray_grams_not_negative" CHECK ("grams" >= 0);
--> statement-breakpoint
CREATE FUNCTION refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER order_records_append_only BEFORE UPDATE OR DELETE ON "order_records" FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE TRIGGER printer_events_append_only BEFORE UPDATE ON "printer_events" FOR EACH ROW EXECUTE FUNCTION refuse_change();
--> statement-breakpoint
CREATE FUNCTION order_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order versions cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  -- The only change allowed is the review decision, once.
  IF OLD.state <> 'PENDING' AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'order version % is already decided', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'state' - 'decided_by' - 'decided_at' - 'reason' - 'counted') IS DISTINCT FROM (to_jsonb(OLD) - 'state' - 'decided_by' - 'decided_at' - 'reason' - 'counted') THEN
    RAISE EXCEPTION 'order version % is immutable', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER order_versions_immutable BEFORE UPDATE OR DELETE ON "order_versions" FOR EACH ROW EXECUTE FUNCTION order_version_immutable();
