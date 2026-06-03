import { useEffect, useRef, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

const THRESHOLD = 72;   // px of pull needed to trigger refresh
const MAX_RESIST = 110; // maximum visual travel (rubber-band ceiling)

// Rubber-band easing: pull gets harder the further you go
function rubberBand(delta: number): number {
  return Math.min(MAX_RESIST, delta * (1 - delta / (2.4 * MAX_RESIST)));
}

export function usePullToRefresh(
  scrollRef: React.RefObject<HTMLElement | null>,
  onRefresh: () => void,
) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startY    = useRef(0);
  const active    = useRef(false);
  const isRefresh = useRef(false);
  const pullYRef  = useRef(0); // mirror of state for use inside listeners

  const triggerRefresh = useCallback(() => {
    if (isRefresh.current) return;
    isRefresh.current = true;
    setRefreshing(true);
    onRefresh();
    setTimeout(() => {
      isRefresh.current = false;
      setRefreshing(false);
      setPullY(0);
      pullYRef.current = 0;
    }, 1000);
  }, [onRefresh]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop <= 0 && !isRefresh.current) {
        startY.current = e.touches[0].clientY;
        active.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active.current) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        active.current = false;
        setPullY(0);
        pullYRef.current = 0;
        return;
      }
      const y = rubberBand(delta);
      pullYRef.current = y;
      setPullY(y);
    };

    const onTouchEnd = () => {
      if (!active.current) return;
      active.current = false;
      if (pullYRef.current >= THRESHOLD) {
        triggerRefresh();
      } else {
        setPullY(0);
        pullYRef.current = 0;
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove',  onTouchMove,  { passive: true });
    el.addEventListener('touchend',   onTouchEnd,   { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
    };
  }, [scrollRef, triggerRefresh]);

  return { pullY, refreshing };
}

// ── Visual indicator ──────────────────────────────────────────────────────────

export function PullIndicator({ pullY, refreshing }: { pullY: number; refreshing: boolean }) {
  const progress  = Math.min(pullY / THRESHOLD, 1);
  const visible   = pullY > 6 || refreshing;

  if (!visible) return null;

  return (
    <>
      <style>{`
        @keyframes ptr-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: 'var(--paper)',
            border: '1px solid var(--line)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.10)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: refreshing ? 1 : progress,
            transform: `scale(${refreshing ? 1 : 0.55 + progress * 0.45})`,
            transition: refreshing ? 'none' : 'opacity 0.08s, transform 0.08s',
          }}
        >
          <RefreshCw
            size={16}
            style={{
              color: 'var(--accent)',
              transform: refreshing ? undefined : `rotate(${progress * 220}deg)`,
              animation: refreshing ? 'ptr-spin 0.65s linear infinite' : 'none',
              transition: refreshing ? 'none' : 'transform 0.08s',
            }}
          />
        </div>
      </div>
    </>
  );
}
