-- The audit log only grows: refuse UPDATE, DELETE and TRUNCATE (brief §0.7).
CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();--> statement-breakpoint
-- Preset roles so foreign keys hold before the first start; permissions are rewritten from PRESET_ROLES on every start.
INSERT INTO "roles" ("id", "name", "builtin", "permissions") VALUES
  ('user', 'User', true, '{}'),
  ('staff', 'Staff', true, '{}'),
  ('builder', 'Builder', true, '{}'),
  ('coreteam', 'Coreteam', true, '{}');--> statement-breakpoint
-- Request form version 1: the default 打印原因 field.
INSERT INTO "form_versions" ("fields") VALUES ('[{"id":"reason","label":"打印原因","type":"textarea","required":true}]');
