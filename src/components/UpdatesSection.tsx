import React, { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile } from '../types';
import { 
  Bell, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  FileText, 
  ClipboardCheck, 
  CreditCard,
  BookOpen,
  Calendar,
  User
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface Activity {
  id: string;
  type: string;
  action: string;
  description: string;
  timestamp: any;
  userId: string;
  userName: string;
  metadata?: any;
}

interface UpdatesSectionProps {
  user: UserProfile;
  className?: string;
  maxItems?: number;
}

export default function UpdatesSection({ user, className, maxItems = 10 }: UpdatesSectionProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;

    let q;
    const activitiesRef = collection(db, 'activityLogs');

    // Tailor queries based on role to improve security and performance
    if (user.role === 'parent' && user.studentIds && user.studentIds.length > 0) {
      // Query specific to parent's students
      q = query(
        activitiesRef,
        where('metadata.studentId', 'in', user.studentIds),
        orderBy('timestamp', 'desc'),
        limit(maxItems)
      );
    } else if (user.role === 'student') {
      const studentId = user.studentId || user.uid;
      q = query(
        activitiesRef,
        where('action', 'in', [
          'Homework Assigned', 
          'Exam Marks Updated',
          'Attendance Marked',
          'Lesson Logged',
          'Created Lesson Log',
          'Updated Lesson Log',
          'Fee Record Updated'
        ]),
        where('metadata.studentId', '==', studentId),
        orderBy('timestamp', 'desc'),
        limit(maxItems)
      );
    } else if (user.role === 'teacher' && user.role === 'teacher') {
      // Teachers see their own activities or global class activities
      q = query(
        activitiesRef,
        where('action', 'in', [
          'Attendance Marked', 
          'Homework Assigned', 
          'Lesson Logged', 
          'Created Lesson Log',
          'Updated Lesson Log',
          'Leave Request Submitted',
          'Profile Updated'
        ]),
        orderBy('timestamp', 'desc'),
        limit(maxItems)
      );
    } else if (user.role === 'accounts') {
      q = query(
        activitiesRef,
        where('action', 'in', [
          'Fee Record Updated', 
          'Fee Collection', 
          'Salary Paid', 
          'Expense Added'
        ]),
        orderBy('timestamp', 'desc'),
        limit(maxItems)
      );
    } else {
      q = query(activitiesRef, orderBy('timestamp', 'desc'), limit(maxItems));
    }

    const unsub = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Activity[];
      
      setActivities(docs);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching updates:", error);
      setLoading(false);
    });

    return () => unsub();
  }, [user.uid, user.role, user.studentIds, user.classId, user.studentId, maxItems]);

  const getIcon = (action: string) => {
    const lower = action.toLowerCase();
    if (lower.includes('leave')) return <ClipboardCheck className="w-4 h-4" />;
    if (lower.includes('fee') || lower.includes('salary') || lower.includes('payment')) return <CreditCard className="w-4 h-4" />;
    if (lower.includes('homework') || lower.includes('lesson')) return <BookOpen className="w-4 h-4" />;
    if (lower.includes('exam') || lower.includes('marks')) return <FileText className="w-4 h-4" />;
    if (lower.includes('attendance')) return <CheckCircle2 className="w-4 h-4" />;
    if (lower.includes('calendar') || lower.includes('event')) return <Calendar className="w-4 h-4" />;
    return <Bell className="w-4 h-4" />;
  };

  const getIconColor = (action: string) => {
    const lower = action.toLowerCase();
    if (lower.includes('approved') || lower.includes('success')) return 'bg-emerald-50 text-emerald-600';
    if (lower.includes('rejected') || lower.includes('failed')) return 'bg-rose-50 text-rose-600';
    if (lower.includes('pending') || lower.includes('requested')) return 'bg-amber-50 text-amber-600';
    if (lower.includes('homework') || lower.includes('attendance')) return 'bg-indigo-50 text-indigo-600';
    return 'bg-slate-50 text-slate-600';
  };

  if (loading) {
    return (
      <div className={cn("bg-white rounded-3xl p-6 border border-slate-100 shadow-sm animate-pulse", className)}>
        <div className="h-6 w-32 bg-slate-100 rounded mb-6" />
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-4 mb-4">
            <div className="w-10 h-10 bg-slate-100 rounded-xl" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-slate-100 rounded w-3/4" />
              <div className="h-3 bg-slate-100 rounded w-1/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("bg-white rounded-3xl p-6 border border-slate-100 shadow-sm overflow-hidden", className)}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
            <Bell className="w-4 h-4" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Recent Updates</h2>
        </div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded-md">Live feed</span>
      </div>

      <div className="space-y-1">
        <AnimatePresence mode="popLayout">
          {activities.length > 0 ? (
            activities.map((activity, idx) => (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: idx * 0.05 }}
                className="group flex gap-4 p-3 rounded-2xl hover:bg-slate-50 transition-all border border-transparent hover:border-slate-100"
              >
                <div className={cn("shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-sm", getIconColor(activity.action))}>
                  {getIcon(activity.action)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <h3 className="text-sm font-bold text-slate-900 truncate">
                      {activity.action}
                    </h3>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium whitespace-nowrap">
                      <Clock className="w-3 h-3" />
                      {(() => {
                        if (!activity.timestamp) return format(new Date(), 'MMM dd, h:mm a');
                        const d = typeof activity.timestamp.toDate === 'function'
                          ? activity.timestamp.toDate()
                          : new Date(activity.timestamp);
                        if (!d || isNaN(d.getTime())) return format(new Date(), 'MMM dd, h:mm a');
                        const ageMs = Date.now() - d.getTime();
                        return ageMs < 60_000
                          ? format(d, 'h:mm a')
                          : ageMs < 86_400_000
                          ? formatDistanceToNow(d, { addSuffix: true })
                          : format(d, 'MMM dd, h:mm a');
                      })()}
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-1 group-hover:line-clamp-none transition-all">
                    {activity.description}
                  </p>
                  {activity.userName && (
                    <div className="flex items-center gap-1.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                       <User className="w-3 h-3 text-slate-400" />
                       <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{activity.userName}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                <Bell className="w-6 h-6 text-slate-200" />
              </div>
              <p className="text-sm font-medium text-slate-400">No recent updates found</p>
            </div>
          )}
        </AnimatePresence>
      </div>
      
      {activities.length > 0 && (
        <button className="w-full mt-4 py-2.5 text-xs font-bold text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-50 rounded-xl transition-all">
          View All Notifications
        </button>
      )}
    </div>
  );
}
