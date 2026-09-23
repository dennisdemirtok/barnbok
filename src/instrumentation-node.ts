import { resumeRunningJobs } from './lib/job-queue';

setTimeout(() => {
  resumeRunningJobs().catch(err => {
    console.warn('[Jobb] kunde inte ta upp jobb vid start:', err instanceof Error ? err.message : err);
  });
}, 10_000);
