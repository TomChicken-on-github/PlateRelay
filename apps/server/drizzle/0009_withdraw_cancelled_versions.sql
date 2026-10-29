UPDATE "orders" o
SET "active_version_id" = (
  SELECT v."id"
  FROM "order_versions" v
  WHERE v."order_id" = o."id" AND v."state" = 'approved'
  ORDER BY v."n" DESC
  LIMIT 1
)
WHERE o."status" = 'CANCELLED'
  AND EXISTS (
    SELECT 1 FROM "order_versions" v
    WHERE v."id" = o."active_version_id" AND v."state" = 'pending'
  )
  AND EXISTS (
    SELECT 1 FROM "order_versions" v
    WHERE v."order_id" = o."id" AND v."state" = 'approved'
  );--> statement-breakpoint

UPDATE "order_versions" v
SET "state" = 'withdrawn'::"version_state",
    "decided_at" = coalesce(v."decided_at", now())
FROM "orders" o
WHERE o."id" = v."order_id"
  AND o."status" = 'CANCELLED'
  AND v."state" = 'pending';
