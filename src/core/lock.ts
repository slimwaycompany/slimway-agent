import { supabase } from '../db/supabase';

const LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function acquireLock(job: string): Promise<boolean> {
  const now        = new Date().toISOString();
  const lockedUntil = new Date(Date.now() + LOCK_TTL_MS).toISOString();

  // Remove expired lock so the next insert can succeed
  await supabase.from('job_locks').delete().eq('job', job).lt('locked_until', now);

  // Try to insert a new lock row; unique constraint on `job` rejects concurrent attempts
  const { error } = await supabase.from('job_locks').insert({ job, locked_until: lockedUntil });

  if (error) {
    if (error.code === '23505') return false; // unique-violation — another instance holds the lock
    throw new Error(`[lock] acquireLock(${job}): ${error.message}`);
  }

  return true;
}

export async function releaseLock(job: string): Promise<void> {
  await supabase.from('job_locks').delete().eq('job', job);
}
