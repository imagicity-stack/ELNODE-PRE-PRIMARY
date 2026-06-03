import { Capacitor } from '@capacitor/core';
import { getApp } from 'firebase/app';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile } from '../types';
import { audienceTokensForUser } from './notificationCenterService';

export type PushPermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

// Web Push (VAPID) certificate public key — Firebase Console ▸ Project Settings ▸
// Cloud Messaging ▸ Web configuration ▸ "Web Push certificates". Required for
// browser/PWA push; without it web push is silently disabled.
const VAPID_KEY = (import.meta as any).env?.VITE_FCM_VAPID_KEY || '';

// ─── Audience token sync ────────────────────────────────────────────────────
// Stores the precomputed audience tokens on the user doc so the send-push API
// can query users by audience without composite indexes.
export async function syncAudienceTokens(user: UserProfile): Promise<void> {
  try {
    const tokens = audienceTokensForUser(user);
    await updateDoc(doc(db, 'users', user.uid), {
      audienceTokens: tokens,
      updatedAt: new Date().toISOString(),
    });
    console.info('[push] audienceTokens synced for', user.uid, tokens);
  } catch (e) {
    console.warn('[push] Failed to sync audience tokens:', e);
  }
}

// ─── Permission helpers ─────────────────────────────────────────────────────
export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  // Web / PWA path
  if (!Capacitor.isNativePlatform()) {
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
      return 'unsupported';
    }
    const p = Notification.permission;
    return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
  }
  // Native path
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === 'granted') return 'granted';
    if (receive === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unsupported';
  }
}

export async function requestPushPermission(): Promise<boolean> {
  // Web / PWA path
  if (!Capacitor.isNativePlatform()) {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    try {
      const res = await Notification.requestPermission();
      return res === 'granted';
    } catch {
      return false;
    }
  }
  // Native path
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { receive } = await PushNotifications.requestPermissions();
    return receive === 'granted';
  } catch {
    return false;
  }
}

// ─── Web (PWA) registration ───────────────────────────────────────────────────
// Registers the FCM service worker, retrieves a web push token, and stores it on
// the user's fcmTokens array (the same field the send-push API queries).
async function registerWebPush(user: UserProfile): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
    console.warn('[push] Web push not supported in this environment');
    return;
  }
  if (Notification.permission !== 'granted') {
    console.info('[push] Notification permission not granted:', Notification.permission);
    return;
  }
  if (!VAPID_KEY) {
    console.warn('[push] VITE_FCM_VAPID_KEY is not set — web push notifications are disabled. Set this in Vercel env vars from Firebase Console > Project Settings > Cloud Messaging > Web Push certificates.');
    return;
  }
  console.info('[push] Starting web push registration for uid:', user.uid);
  try {
    const { isSupported, getMessaging, getToken, onMessage } = await import('firebase/messaging');
    const supported = await isSupported().catch(() => false);
    if (!supported) {
      console.warn('[push] Firebase Messaging not supported in this browser');
      return;
    }

    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
    console.info('[push] Service worker registered:', swReg.scope);

    const messaging = getMessaging(getApp());
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (token) {
      console.info('[push] FCM token obtained, storing in Firestore…');
      await updateDoc(doc(db, 'users', user.uid), { fcmTokens: arrayUnion(token) });
      console.info('[push] FCM token stored successfully. Push notifications are active.');
    } else {
      console.warn('[push] getToken returned empty — push not registered. Check VAPID key matches Firebase Console.');
    }

    // Foreground messages: in-app NotificationCenter already reflects these via a
    // Firestore listener, so we just store the nav link for click handling.
    onMessage(messaging, (payload) => {
      const link = payload?.data?.link;
      if (link) sessionStorage.setItem('push_nav_link', link);
    });
  } catch (e) {
    console.error('[push] Web push registration failed:', e);
  }
}

// ─── Registration ───────────────────────────────────────────────────────────
// Registers for FCM, saves the token, and sets up notification listeners.
// Safe to call multiple times — Capacitor deduplicates listener registration.
export async function registerForPush(user: UserProfile): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    await registerWebPush(user);
    return;
  }
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    PushNotifications.addListener('registration', async (token) => {
      try {
        await updateDoc(doc(db, 'users', user.uid), { fcmTokens: arrayUnion(token.value) });
      } catch (e) {
        console.warn('[push] Failed to store native FCM token:', e);
      }
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.warn('FCM registration error:', err);
    });

    // Foreground: the in-app NotificationCenter already shows via Firestore
    // real-time listener — no duplicate toast needed.
    PushNotifications.addListener('pushNotificationReceived', (_n) => {});

    // Background/quit: store link for App to navigate after mount
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const link = action.notification.data?.link;
      if (link) {
        sessionStorage.setItem('push_nav_link', link);
        window.dispatchEvent(new CustomEvent('push_navigate', { detail: { link } }));
      }
    });

    await PushNotifications.register();
  } catch (e) {
    console.warn('Push registration failed:', e);
  }
}

export async function removeFcmToken(uid: string, token: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), { fcmTokens: arrayRemove(token) });
  } catch {}
}
