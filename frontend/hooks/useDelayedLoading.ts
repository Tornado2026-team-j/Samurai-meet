import { useEffect, useRef, useState } from "react";

export const DEFAULT_LOADING_DELAY_MS = 200;
export const DEFAULT_MIN_LOADING_MS = 200;

export type DelayedLoadingOptions = {
  delayMs?: number;
  minimumVisibleMs?: number;
};

export type DelayedLoadingPhase = "hidden" | "pending" | "visible";

type DelayedLoadingPhaseInput = {
  loading: boolean;
  loadingStartedAt: number | null;
  visibleSince: number | null;
  now: number;
  delayMs?: number;
  minimumVisibleMs?: number;
};

export function getDelayedLoadingPhase({
  loading,
  loadingStartedAt,
  visibleSince,
  now,
  delayMs = DEFAULT_LOADING_DELAY_MS,
  minimumVisibleMs = DEFAULT_MIN_LOADING_MS,
}: DelayedLoadingPhaseInput): DelayedLoadingPhase {
  const delay = Math.max(0, delayMs);
  const minimumVisible = Math.max(0, minimumVisibleMs);

  if (visibleSince !== null) {
    return loading || now - visibleSince < minimumVisible ? "visible" : "hidden";
  }
  if (!loading) return "hidden";
  if (loadingStartedAt === null || now - loadingStartedAt < delay) return "pending";
  return "visible";
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer !== null) clearTimeout(timer);
}

/**
 * Keeps transient loading states out of the UI while still making slower
 * loads visible long enough to feel intentional.
 */
export function useDelayedLoading(
  loading: boolean,
  { delayMs = DEFAULT_LOADING_DELAY_MS, minimumVisibleMs = DEFAULT_MIN_LOADING_MS }: DelayedLoadingOptions = {},
): boolean {
  const [visible, setVisible] = useState(false);
  const loadingStartedAtRef = useRef<number | null>(null);
  const visibleSinceRef = useRef<number | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  useEffect(() => {
    if (loading) {
      if (visibleSinceRef.current === null) {
        loadingStartedAtRef.current ??= Date.now();
        showTimerRef.current = setTimeout(() => {
          showTimerRef.current = null;
          if (!loadingRef.current || visibleSinceRef.current !== null) return;
          visibleSinceRef.current = Date.now();
          setVisible(true);
        }, Math.max(0, delayMs));
      }
    } else {
      loadingStartedAtRef.current = null;
      if (visibleSinceRef.current === null) {
        setVisible(false);
      } else {
        const remaining = Math.max(
          0,
          minimumVisibleMs - (Date.now() - visibleSinceRef.current),
        );
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null;
          visibleSinceRef.current = null;
          setVisible(false);
        }, remaining);
      }
    }

    return () => {
      clearTimer(showTimerRef.current);
      clearTimer(hideTimerRef.current);
      showTimerRef.current = null;
      hideTimerRef.current = null;
    };
  }, [delayMs, loading, minimumVisibleMs]);

  return visible;
}
