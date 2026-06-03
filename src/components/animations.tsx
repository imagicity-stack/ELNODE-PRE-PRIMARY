import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { CheckCircle2 } from 'lucide-react';
import { APP_NAME, SCHOOL_NAME, APP_LOGO } from '../constants';

// ─── Performance notes ────────────────────────────────────────────────────────
// All animations here use only `transform` and `opacity` so they run on the
// compositor thread (GPU) and never trigger layout/paint of the rest of the
// page. We also respect `prefers-reduced-motion` for accessibility and to be a
// good citizen on low-end Android.

// ─── App Splash (first-mount only) ────────────────────────────────────────────
// Shown once when the app boots, before the auth screen mounts. Auto-dismisses
// after ~750ms. After that it's unmounted entirely — no idle cost.

interface AppSplashProps {
  onDone: () => void;
  duration?: number; // ms — total time on screen before fading out
}

export function AppSplash({ onDone, duration = 1100 }: AppSplashProps) {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) { onDone(); return; }
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [onDone, duration, reduced]);

  if (reduced) return null;

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[100] bg-gradient-to-br from-indigo-600 via-blue-700 to-indigo-800 flex items-center justify-center"
    >
      {/* Soft radial glow behind the logo */}
      <motion.div
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1.6, opacity: 0.35 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
        className="absolute w-72 h-72 rounded-full bg-white/30 blur-3xl pointer-events-none"
      />

      <div className="relative flex flex-col items-center">
        <motion.img
          src={APP_LOGO}
          alt={APP_NAME}
          initial={{ scale: 0.5, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 18, delay: 0.05 }}
          className="w-24 h-24 object-contain drop-shadow-2xl"
        />
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
          className="mt-4 text-center"
        >
          <p className="text-white font-black text-2xl tracking-tight">{APP_NAME}</p>
          <p className="text-indigo-200 text-xs font-semibold mt-1 tracking-wide">{SCHOOL_NAME}</p>
        </motion.div>

        {/* Loading dots */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.55 }}
          className="mt-8 flex gap-1.5"
        >
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-white/70"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
            />
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}

// ─── Payment Success Celebration ──────────────────────────────────────────────
// Full-screen success overlay. Renders only while `show` is true. Auto-fires
// `onDismiss` after `duration` ms or when the user taps. ~1.5s total feel.

interface PaymentSuccessProps {
  show: boolean;
  amount?: number;
  message?: string;
  onDismiss: () => void;
  duration?: number;
}

const CONFETTI_COLORS = ['#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c'];

function ConfettiBurst() {
  // ~24 particles — enough to feel celebratory, light enough to stay 60fps
  const particles = useMemo(() => Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * Math.PI * 2;
    const distance = 120 + Math.random() * 90;
    return {
      id: i,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 0.1,
      rotate: (Math.random() - 0.5) * 720,
      size: 6 + Math.random() * 6,
    };
  }), []);

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {particles.map(p => (
        <motion.span
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0 }}
          animate={{ x: p.dx, y: p.dy, opacity: 0, rotate: p.rotate, scale: 1 }}
          transition={{ duration: 1, delay: p.delay, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'absolute',
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: p.id % 3 === 0 ? '50%' : '2px',
          }}
        />
      ))}
    </div>
  );
}

export function PaymentSuccess({ show, amount, message, onDismiss, duration = 1800 }: PaymentSuccessProps) {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [show, duration, onDismiss]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onDismiss}
          className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center px-6"
        >
          <motion.div
            initial={{ scale: 0.7, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
            className="relative bg-white rounded-3xl px-8 py-7 shadow-2xl max-w-sm w-full text-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {!reduced && <ConfettiBurst />}

            {/* Expanding ripple behind the tick */}
            {!reduced && (
              <motion.div
                initial={{ scale: 0, opacity: 0.5 }}
                animate={{ scale: 3.2, opacity: 0 }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
                className="absolute left-1/2 top-12 -translate-x-1/2 w-20 h-20 rounded-full bg-emerald-400 pointer-events-none"
              />
            )}

            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.05 }}
              className="relative mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-300"
            >
              <CheckCircle2 className="w-12 h-12 text-white" strokeWidth={2.5} />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.25 }}
              className="relative mt-5"
            >
              <p className="text-2xl font-black text-slate-900">Payment Recorded</p>
              {amount != null && (
                <p className="mt-1 text-3xl font-black text-emerald-600 tabular-nums">
                  ₹{amount.toLocaleString('en-IN')}
                </p>
              )}
              {message && <p className="mt-2 text-sm text-slate-500">{message}</p>}
            </motion.div>

            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55 }}
              onClick={onDismiss}
              className="relative mt-5 text-xs font-semibold text-slate-400 hover:text-slate-600 active:scale-95 transition-all"
            >
              Tap anywhere to dismiss
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Mobile Page Entry ────────────────────────────────────────────────────────
// Wrap a mobile screen's outer div with this to get a subtle slide-up + fade
// on mount. ~250ms, GPU-only. No animation on desktop (md:hidden screens
// already mount/unmount fresh per route).

interface MobilePageEnterProps {
  children: React.ReactNode;
  className?: string;
  /** Direction the screen slides in from. Defaults to 'right' (forward nav feel). */
  from?: 'right' | 'bottom' | 'fade';
}

export function MobilePageEnter({ children, className, from = 'right' }: MobilePageEnterProps) {
  const reduced = useReducedMotion();

  const initial = reduced
    ? { opacity: 1 }
    : from === 'right'  ? { opacity: 0, x: 24 }
    : from === 'bottom' ? { opacity: 0, y: 16 }
    : { opacity: 0 };

  return (
    <motion.div
      initial={initial}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Staggered List ───────────────────────────────────────────────────────────
// Wrap a list container; each direct child animates in with a small delay.
// Only the first ~15 items animate to avoid long lists feeling sluggish.

interface StaggeredListProps {
  children: React.ReactNode;
  className?: string;
  /** Per-item delay in seconds. Default 0.035 = subtle and quick. */
  staggerDelay?: number;
  /** Max children that get animated (rest just appear). Default 15. */
  maxAnimated?: number;
}

export function StaggeredList({ children, className, staggerDelay = 0.035, maxAnimated = 15 }: StaggeredListProps) {
  const reduced = useReducedMotion();
  const items = React.Children.toArray(children);

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <div className={className}>
      {items.map((child, i) => {
        const shouldAnimate = i < maxAnimated;
        if (!shouldAnimate) return child;
        return (
          <motion.div
            key={(child as any)?.key ?? i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * staggerDelay, ease: [0.32, 0.72, 0, 1] }}
          >
            {child}
          </motion.div>
        );
      })}
    </div>
  );
}
