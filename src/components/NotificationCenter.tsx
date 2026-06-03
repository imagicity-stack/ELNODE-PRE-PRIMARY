import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell, BellOff, Check, X, GraduationCap, Wallet, Megaphone, CalendarDays,
} from 'lucide-react';
import { AppNotification, UserProfile } from '../types';
import {
  subscribeFeed, subscribeReadState, markAllRead, dismissNotification, NOTIFICATION_CATEGORIES,
} from '../services/notificationCenterService';
import { requestNotificationPermission } from '../services/notificationService';
import { registerForPush } from '../services/pushNotificationService';
import { cn } from '../lib/utils';

const CATEGORY_ICON: Record<string, any> = {
  GraduationCap, Wallet, Megaphone, CalendarDays, Bell,
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function NotificationCenter({ user }: { user: UserProfile }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [lastReadAt, setLastReadAt] = useState('1970-01-01T00:00:00.000Z');
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const notifSupported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState(notifSupported ? Notification.permission : 'denied');

  useEffect(() => {
    const unsubFeed = subscribeFeed(user, setItems, () => {});
    const unsubState = subscribeReadState(user.uid, (s) => {
      setLastReadAt(s.lastReadAt);
      setDismissedIds(s.dismissedIds);
    });
    return () => { unsubFeed(); unsubState(); };
  }, [user.uid]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const visible = useMemo(
    () => items.filter((n) => !dismissedIds.includes(n.id)),
    [items, dismissedIds]
  );

  const unreadCount = useMemo(
    () => visible.filter((n) => n.createdAt > lastReadAt).length,
    [visible, lastReadAt]
  );

  const openPanel = () => {
    setOpen(true);
    if (unreadCount > 0) markAllRead(user.uid).catch(() => {});
  };

  const handleEnableNotifications = async () => {
    const granted = await requestNotificationPermission();
    if (notifSupported) setPermission(Notification.permission);
    // Register an FCM web-push token so server-sent pushes can reach this device
    // (in-app listeners were already running; this enables background delivery).
    if (granted) registerForPush(user).catch(() => {});
  };

  const onItemClick = (n: AppNotification) => {
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-rose-500 rounded-full border-2 border-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-[min(92vw,380px)] max-h-[70vh] bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div>
                <p className="text-sm font-bold text-slate-900">Notifications</p>
                <p className="text-[11px] text-slate-400">{visible.length} total · {unreadCount} unread</p>
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={() => markAllRead(user.uid)}
                    className="text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg flex items-center gap-1"
                  >
                    <Check className="w-3 h-3" /> Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Permission banner (web only, when not yet granted) */}
            {notifSupported && permission === 'default' && (
              <button
                onClick={handleEnableNotifications}
                className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 text-amber-800 text-xs font-semibold border-b border-amber-100 hover:bg-amber-100"
              >
                <Bell className="w-4 h-4 shrink-0" />
                Enable browser notifications for instant alerts
              </button>
            )}
            {notifSupported && permission === 'denied' && (
              <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 text-slate-500 text-[11px] border-b border-slate-100">
                <BellOff className="w-3.5 h-3.5 shrink-0" />
                Browser notifications are blocked. Enable them in settings.
              </div>
            )}

            {/* List */}
            <div className="overflow-y-auto flex-1">
              {visible.length === 0 ? (
                <div className="py-12 text-center px-6">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
                    <Bell className="w-7 h-7 text-slate-300" />
                  </div>
                  <p className="text-sm font-bold text-slate-700">You're all caught up</p>
                  <p className="text-xs text-slate-400 mt-1">New notifications will appear here.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {visible.map((n) => {
                    const cat = NOTIFICATION_CATEGORIES[n.category] || NOTIFICATION_CATEGORIES.general;
                    const Icon = CATEGORY_ICON[cat.icon] || Bell;
                    const isUnread = n.createdAt > lastReadAt;
                    return (
                      <div
                        key={n.id}
                        onClick={() => onItemClick(n)}
                        className={cn(
                          'group flex gap-3 px-4 py-3 transition-colors',
                          n.link && 'cursor-pointer',
                          isUnread ? 'bg-indigo-50/40 hover:bg-indigo-50/70' : 'hover:bg-slate-50'
                        )}
                      >
                        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', cat.bg)}>
                          <Icon className={cn('w-4 h-4', cat.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-2">
                            <p className="text-sm font-bold text-slate-900 leading-snug flex-1">{n.title}</p>
                            {n.priority === 'high' && (
                              <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded shrink-0">URGENT</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-slate-400">{timeAgo(n.createdAt)}</span>
                            {isUnread && <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full" />}
                          </div>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismissNotification(user.uid, n.id); }}
                          className="self-start p-1 rounded-md text-slate-300 hover:text-slate-500 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Dismiss"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
