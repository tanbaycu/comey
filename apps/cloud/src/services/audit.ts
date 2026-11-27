import { randomHex, sha256Hex } from '@comey/core';
import type { Env } from '../env.js';

export interface AuditLogInput {
  workspaceId: string;
  actorType: 'user' | 'api_key' | 'system';
  actorId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  ip?: string | null;
  meta?: Record<string, unknown>;
}

export async function recordAuditLog(env: Env, params: AuditLogInput): Promise<void> {
  try {
    const id = `aud_${randomHex(12)}`;
    const nowIso = new Date().toISOString();
    const ipHash = params.ip ? (await sha256Hex(params.ip)).slice(0, 16) : null;
    const metaJson = params.meta ? JSON.stringify(params.meta) : null;

    await env.DB.prepare(
      `INSERT INTO audit_logs (
        id, workspace_id, actor_type, actor_id, action,
        resource_type, resource_id, ip_hash, meta_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        params.workspaceId,
        params.actorType,
        params.actorId ?? null,
        params.action,
        params.resourceType ?? null,
        params.resourceId ?? null,
        ipHash,
        metaJson,
        nowIso
      )
      .run();
  } catch {
    // Audit logging must never crash primary transaction flow
  }
}
