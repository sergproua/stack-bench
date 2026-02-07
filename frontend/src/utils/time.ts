export const formatDuration = (ms: number) => {
  if (!Number.isFinite(ms)) {
    return '—';
  }
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    if (totalSeconds < 10) {
      return `${totalSeconds.toFixed(1)}s`;
    }
    return `${Math.round(totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
};

export const isSlowDuration = (ms: number | null | undefined, thresholdMs = 1000) => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return false;
  }
  return ms > thresholdMs;
};
