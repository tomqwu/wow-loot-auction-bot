import type { Db } from '../db';
import type { AuditLogRow } from '../db/types';

export interface AuditEntry {
  action: string;
  actorUserId: string;
  auctionId?: number | null;
  payload?: unknown;
  nowMs?: number;
}

export function logAudit(db: Db, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_log (action, actor_user_id, auction_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    entry.action,
    entry.actorUserId,
    entry.auctionId ?? null,
    entry.payload === undefined ? null : JSON.stringify(entry.payload),
    entry.nowMs ?? Date.now()
  );
}

export function getAuditLog(db: Db, auctionId: number): AuditLogRow[] {
  return db
    .prepare('SELECT * FROM audit_log WHERE auction_id = ? ORDER BY id ASC')
    .all(auctionId) as AuditLogRow[];
}
