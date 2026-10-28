ALTER TABLE "order_versions" ADD COLUMN "decision" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "active_version_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pending_version_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "order_versions_id_order" ON "order_versions" USING btree ("id","order_id");--> statement-breakpoint
-- A revision under review on an order that was approved before: the pending pointer, and what the
-- policy decided for it (it was kept on the order until now).
UPDATE "orders" o SET "pending_version_id" = v."id"
FROM (SELECT DISTINCT ON ("order_id") "id", "order_id" FROM "order_versions" WHERE "state" = 'pending' ORDER BY "order_id", "n" DESC) v
WHERE v."order_id" = o."id" AND o."status" = 'PENDING_REVIEW' AND o."revision" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "order_versions" a WHERE a."order_id" = o."id" AND a."state" = 'approved');--> statement-breakpoint
UPDATE "order_versions" v SET "decision" = jsonb_build_object('deltaSeconds', o."revision"->'deltaSeconds', 'placesBack', o."revision"->'placesBack', 'recalled', o."revision"->'recalled')
FROM "orders" o WHERE o."pending_version_id" = v."id";--> statement-breakpoint
-- Active: with a pending revision, the last approved version; otherwise the version the order held
-- (the newest one still in play, else the newest).
UPDATE "orders" o SET "active_version_id" = (
  SELECT v."id" FROM "order_versions" v
  WHERE v."order_id" = o."id" AND (CASE WHEN o."pending_version_id" IS NULL THEN v."state" IN ('pending', 'approved') ELSE v."state" = 'approved' END)
  ORDER BY v."n" DESC LIMIT 1
);--> statement-breakpoint
UPDATE "orders" o SET "active_version_id" = (SELECT v."id" FROM "order_versions" v WHERE v."order_id" = o."id" ORDER BY v."n" DESC LIMIT 1)
WHERE o."active_version_id" IS NULL;--> statement-breakpoint
-- Orders from before the baseline existed: the first version's print time.
UPDATE "orders" o SET "original_print_seconds" = coalesce((SELECT v."print_seconds" FROM "order_versions" v WHERE v."order_id" = o."id" AND v."n" = 1), o."print_seconds")
WHERE o."original_print_seconds" IS NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_active_version_own" FOREIGN KEY ("active_version_id","id") REFERENCES "public"."order_versions"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pending_version_own" FOREIGN KEY ("pending_version_id","id") REFERENCES "public"."order_versions"("id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pending_in_review" CHECK ("orders"."pending_version_id" is null or "orders"."status" = 'PENDING_REVIEW');--> statement-breakpoint
-- The order row is inserted before its first version, so the not-null check waits for the commit.
CREATE FUNCTION orders_active_version_set() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "active_version_id" FROM "orders" WHERE "id" = NEW."id") IS NULL THEN
    RAISE EXCEPTION 'order % has no active version', NEW."id";
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER orders_active_version_set AFTER INSERT OR UPDATE OF "active_version_id" ON "orders" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orders_active_version_set();--> statement-breakpoint
-- Versions are immutable: only the review decision may be set, once, and nothing is deleted.
CREATE FUNCTION order_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_versions rows are never deleted';
  END IF;
  IF OLD."state" <> 'pending' THEN
    RAISE EXCEPTION 'order version % is already decided', OLD."id";
  END IF;
  IF (to_jsonb(NEW) - ARRAY['state', 'decided_by', 'decided_at', 'reason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state', 'decided_by', 'decided_at', 'reason']) THEN
    RAISE EXCEPTION 'order version % is immutable; only its review decision can be set', OLD."id";
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER order_versions_immutable BEFORE UPDATE OR DELETE ON "order_versions" FOR EACH ROW EXECUTE FUNCTION order_versions_immutable();
