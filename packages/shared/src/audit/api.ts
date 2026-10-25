export const AUDIT_ACTOR_TYPES = ["user", "system", "daemon", "printer"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_RESULTS = ["ok", "failed", "denied"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export interface AuditLogView {
  id: number;
  /** ISO timestamp. */
  at: string;
  actorType: AuditActorType;
  actorId: string | null;
  /** Role is the account's current role, not a historical snapshot. */
  actor: { id: string | null; name: string; role: string | null } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  /** Human-readable business object, resolved without exposing account-management APIs. */
  target: { name: string } | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  result: AuditResult;
  ip: string | null;
  device: string | null;
}

export interface AuditListQuery {
  actorId?: string;
  /** Case-insensitive literal substring of the user's current display name. */
  actorName?: string;
  actorType?: AuditActorType;
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: AuditResult;
  /** Inclusive ISO timestamp bounds. */
  from?: string;
  to?: string;
  limit?: number;
  /** Strict descending-ID cursor. */
  beforeId?: number;
}
