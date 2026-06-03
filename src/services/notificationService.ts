import { auth, db } from '../firebase';
import { collection, query, where, onSnapshot, limit, orderBy } from 'firebase/firestore';

export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('This browser does not support notifications.');
    return false;
  }

  console.log('Current notification permission:', Notification.permission);
  
  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    console.log('Notification permission result:', permission);
    return permission === 'granted';
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    return false;
  }
}

export function showLocalNotification(title: string, options?: NotificationOptions) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    // Check if we are in a mobile environment or desktop
    // PWAs can show notifications via service worker or direct Notification API
    // Direct API works if the tab is active or in background (depending on browser)
    const notification = new Notification(title, {
      icon: '/logo high res tp-01.png',
      badge: '/logo high res tp-01.png',
      ...options
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

// Function to start listening for global notifications (like notices)
export function startNotificationListeners(
  userId: string,
  role: string,
  classIds: string[] = [],
  onNotify?: (title: string, body: string, type: 'info' | 'success') => void
) {
  // We want to try starting listeners even if browser notification permission isn't granted,
  // because we'll also use UI toasts now.
  
  const handleNotify = (title: string, body: string, type: 'info' | 'success' = 'info', tag: string) => {
    // 1. Show browser notification if allowed
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      showLocalNotification(title, { body, tag });
    }
    // 2. Show UI toast via callback
    if (onNotify) {
      onNotify(title, body, type);
    }
  };

  // Listen for new notices
  const noticesQuery = query(
    collection(db, 'notices'),
    where('targetRoles', 'array-contains', role),
    orderBy('createdAt', 'desc'),
    limit(1)
  );

  let initialLoad = true;
  const unsubscribeNotices = onSnapshot(noticesQuery, (snapshot) => {
    if (initialLoad) {
      initialLoad = false;
      return;
    }

    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const notice = change.doc.data();
        handleNotify(
          'New Notice: ' + notice.title, 
          notice.content?.substring(0, 100) + (notice.content?.length > 100 ? '...' : ''),
          'info',
          'new-notice'
        );
      }
    });
  });

  // Listen for fee requests (if student)
  let unsubscribeFees = () => {};
  if (role === 'student') {
    const feesQuery = query(
      collection(db, 'feeRequests'),
      where('studentId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    let initialFeesLoad = true;
    unsubscribeFees = onSnapshot(feesQuery, (snapshot) => {
      if (initialFeesLoad) {
        initialFeesLoad = false;
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const fee = change.doc.data();
          handleNotify(
            'New Fee Request', 
            `A new fee request of ₹${fee.totalAmount} has been generated.`,
            'info',
            'new-fee'
          );
        }
      });
    });
  }

  // Listen for homework (if student)
  let unsubscribeHomework = () => {};
  if (role === 'student' || role === 'parent') {
    const homeworkQuery = query(
      collection(db, 'homework'),
      orderBy('dueDate', 'desc'),
      limit(1)
    );

    let initialHwLoad = true;
    unsubscribeHomework = onSnapshot(homeworkQuery, (snapshot) => {
      if (initialHwLoad) {
        initialHwLoad = false;
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const hw = change.doc.data();
          handleNotify(
            'New Homework Assigned', 
            `Homework for ${hw.subjectId} due on ${new Date(hw.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}.`,
            'info',
            'new-homework'
          );
        }
      });
    });
  }

  // Listen for lesson logs (diary updates) — scoped to the user's own class(es) only.
  // Without classIds (e.g. unlinked student) we skip the listener entirely instead of
  // broadcasting every diary update school-wide.
  let unsubscribeLessonLogs = () => {};
  if ((role === 'student' || role === 'parent') && classIds.length > 0) {
    // Firestore `in` supports up to 30 values; clamp to be safe.
    const scopedClassIds = classIds.slice(0, 30);
    const lessonLogsQuery = query(
      collection(db, 'lessonLogs'),
      where('classId', 'in', scopedClassIds),
      orderBy('updatedAt', 'desc'),
      limit(1)
    );

    let initialLessonLoad = true;
    unsubscribeLessonLogs = onSnapshot(lessonLogsQuery, (snapshot) => {
      if (initialLessonLoad) {
        initialLessonLoad = false;
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const log = change.doc.data();
          handleNotify(
            'Diary Update: ' + (log.topic || 'New entry'),
            `New classwork/homework logged for your class.`,
            'success',
            'lesson-log-' + change.doc.id
          );
        }
      });
    }, () => { /* silent: missing index or denied — skip notifications */ });
  }

  return () => {
    unsubscribeNotices();
    unsubscribeFees();
    unsubscribeHomework();
    unsubscribeLessonLogs();
  };
}
