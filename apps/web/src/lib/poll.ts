/**
 * Run `fn` every `ms` while the tab is visible, and once more as soon as it becomes visible again.
 * Hidden tabs make no requests at all. Returns a cleanup function for useEffect.
 */
export function pollWhileVisible(fn: () => void, ms: number): () => void {
  const t = setInterval(() => {
    if (!document.hidden) fn();
  }, ms);
  const onVisible = () => {
    if (!document.hidden) fn();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(t);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
