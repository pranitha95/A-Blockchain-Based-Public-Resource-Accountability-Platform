import type { SessionUser, SettingsUpdateInput } from '@poi/shared';
import { query, withTransaction } from '../../db/pool.js';
import { forbidden } from '../../lib/errors.js';
import { appendAuditEvent, AUDIT_ACTIONS } from '../audit/audit.service.js';
import { getEnv } from '../../config/env.js';

export interface PlatformSettings {
  publicDirectoryEnabled: boolean;
  showDemoData: boolean;
  reportFooterNote: string;
}

const DEFAULT_SETTINGS: PlatformSettings = {
  publicDirectoryEnabled: true,
  showDemoData: true,
  reportFooterNote:
    'This report describes records held by the Proof of Impact platform. Blockchain anchoring confirms that a commitment existed on-chain; it does not prove that the underlying records are true.',
};

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const result = await query<{ key: string; value: unknown }>('SELECT key, value FROM platform_settings');
  const settings: PlatformSettings = { ...DEFAULT_SETTINGS };
  for (const row of result.rows) {
    if (row.key === 'publicDirectoryEnabled' && typeof row.value === 'boolean') settings.publicDirectoryEnabled = row.value;
    if (row.key === 'showDemoData' && typeof row.value === 'boolean') settings.showDemoData = row.value;
    if (row.key === 'reportFooterNote' && typeof row.value === 'string') settings.reportFooterNote = row.value;
  }
  return settings;
}

export async function updatePlatformSettings(actor: SessionUser, input: SettingsUpdateInput): Promise<PlatformSettings> {
  if (actor.role !== 'ADMIN') throw forbidden('Only platform administrators can change platform settings');
  await withTransaction(async (client) => {
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      await client.query(
        `INSERT INTO platform_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, JSON.stringify(value), actor.id],
      );
    }
    await appendAuditEvent(client, {
      projectId: null,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: 'PLATFORM_SETTINGS',
      entityId: 'platform',
      summary: `Platform settings updated (${Object.keys(input).join(', ')})`,
      metadata: input as Record<string, unknown>,
    });
  });
  return getPlatformSettings();
}

export function publicSettings(settings: PlatformSettings) {
  return {
    publicDirectoryEnabled: settings.publicDirectoryEnabled,
    showDemoData: settings.showDemoData,
    reportFooterNote: settings.reportFooterNote,
    demoMode: getEnv().DEMO_MODE,
  };
}
