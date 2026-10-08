import { supabase } from '../db/supabase';

const LOCK_TTL_SECONDS = 600; // 10 minutes

export async function acquireLock(job: string, ttlSeconds = LOCK_TTL_SECONDS): Promise<boolean> {
  const { data, error } = await supabase.rpc('try_lock', {
    p_job:         job,
    p_ttl_seconds: ttlSeconds,
  });
  if (error) throw new Error(`[lock] try_lock(${job}): ${error.message}`);
  return data === true;
}

export async function releaseLock(job: string): Promise<void> {
  const { error } = await supabase.rpc('release_lock', { p_job: job });
  if (error) console.error(`[lock] release_lock(${job}): ${error.message}`);
}
