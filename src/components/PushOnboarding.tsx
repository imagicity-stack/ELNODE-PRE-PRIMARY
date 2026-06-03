import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bell, GraduationCap, Wallet, Megaphone, CalendarDays, X } from 'lucide-react';
import { UserProfile } from '../types';
import { requestPushPermission, registerForPush } from '../services/pushNotificationService';

const STORAGE_KEY = 'push_onboarding_done';

export function shouldShowPushOnboarding(): boolean {
  return !localStorage.getItem(STORAGE_KEY);
}

const PERKS = [
  { icon: GraduationCap, color: 'text-violet-600', bg: 'bg-violet-50', text: 'Exam schedules & results' },
  { icon: Wallet,        color: 'text-emerald-600', bg: 'bg-emerald-50', text: 'Fee due reminders' },
  { icon: Megaphone,     color: 'text-indigo-600',  bg: 'bg-indigo-50',  text: 'School notices & updates' },
  { icon: CalendarDays,  color: 'text-amber-600',   bg: 'bg-amber-50',   text: 'Events & holidays' },
];

export default function PushOnboarding({
  user,
  onDone,
}: {
  user: UserProfile;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    onDone();
  };

  const enable = async () => {
    setLoading(true);
    const granted = await requestPushPermission();
    if (granted) await registerForPush(user);
    localStorage.setItem(STORAGE_KEY, '1');
    setLoading(false);
    onDone();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={dismiss}
        />

        {/* Sheet */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 60 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          className="relative z-10 w-full max-w-sm mx-4 mb-6 sm:mb-0 bg-white rounded-3xl shadow-2xl overflow-hidden"
        >
          {/* Dismiss */}
          <button
            onClick={dismiss}
            className="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Header illustration */}
          <div className="bg-gradient-to-br from-indigo-600 to-violet-600 pt-8 pb-6 px-6 flex flex-col items-center">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', delay: 0.15 }}
              className="w-16 h-16 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center mb-4"
            >
              <Bell className="w-8 h-8 text-white" />
            </motion.div>
            <h2 className="text-xl font-bold text-white text-center">Stay in the loop</h2>
            <p className="text-indigo-200 text-sm text-center mt-1">
              Get instant alerts for things that matter.
            </p>
          </div>

          {/* Perks */}
          <div className="px-6 pt-5 pb-4 space-y-3">
            {PERKS.map(({ icon: Icon, color, bg, text }, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.07 }}
                className="flex items-center gap-3"
              >
                <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <span className="text-sm text-slate-700 font-medium">{text}</span>
              </motion.div>
            ))}
          </div>

          {/* Actions */}
          <div className="px-6 pb-6 pt-2 space-y-2">
            <button
              onClick={enable}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-2xl shadow-sm shadow-indigo-600/30 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : <Bell className="w-4 h-4" />}
              {loading ? 'Enabling…' : 'Enable Notifications'}
            </button>
            <button
              onClick={dismiss}
              className="w-full py-2.5 text-sm text-slate-500 font-medium hover:text-slate-700 transition-colors"
            >
              Not now
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
