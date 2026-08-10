/**
 * Lightweight storage hygiene so free-tier Neon (512MB) does not fill from
 * reject observations. Safe to call every org cycle — no VACUUM FULL.
 */
import { query } from './db.js';

let lastPruneAt = 0;
const MIN_INTERVAL_MS = 30 * 60 * 1000; // at most once per 30 minutes process-wide

export async function lightStorageHygiene({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastPruneAt < MIN_INTERVAL_MS) return { skipped: true };
  lastPruneAt = now;

  const result = { observations: 0, traces: 0, debug_debug: 0 };
  try {
    // Reject observations older than 3 days (dashboard keep/surfaced untouched)
    const obs = await query(`
      DELETE FROM ai_observations WHERE id IN (
        SELECT o.id FROM ai_observations o
        JOIN ai_traces t ON t.id = o.trace_id
        WHERE t.decision IN ('rejected_irrelevant','suppressed_low_quality')
          AND t.post_id IS NULL
          AND o.created_at < NOW() - INTERVAL '3 days'
        LIMIT 2000
      )
    `);
    result.observations = obs.rowCount || 0;

    // Cap reject traces per org (keep latest 80)
    const traces = await query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY org_id ORDER BY created_at DESC
        ) rn
        FROM ai_traces
        WHERE decision IN ('rejected_irrelevant','suppressed_low_quality')
          AND post_id IS NULL
      )
      DELETE FROM ai_traces WHERE id IN (SELECT id FROM ranked WHERE rn > 80 LIMIT 1500)
    `);
    result.traces = traces.rowCount || 0;

    try {
      const ped = await query(`
        DELETE FROM prompt_execution_debug WHERE id IN (
          SELECT id FROM prompt_execution_debug
          ORDER BY executed_at ASC NULLS FIRST
          LIMIT 3000
        )
        AND (
          SELECT count(*) FROM prompt_execution_debug
        ) > 5000
      `);
      result.prompt_debug = ped.rowCount || 0;
    } catch {
      // table may lack executed_at or not exist
    }
  } catch (err) {
    console.warn('[storage-hygiene]', err.message);
    return { ...result, error: err.message };
  }

  if (result.observations || result.traces || result.prompt_debug) {
    console.log('[storage-hygiene]', result);
  }
  return result;
}
