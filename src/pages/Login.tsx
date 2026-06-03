import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth } from '../firebase';
import { SCHOOL_NAME, APP_NAME, SCHOOL_DOMAIN, LEGACY_DOMAIN, APP_LOGO } from '../constants';
import { Users, UserCog, Lock, Mail, Hash, Eye, EyeOff, GraduationCap, ShieldCheck, BarChart3, Bell } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

const features = [
  { icon: GraduationCap, text: 'Complete Academic Management' },
  { icon: BarChart3, text: 'Real-time Analytics & Reports' },
  { icon: ShieldCheck, text: 'Role-based Access Control' },
  { icon: Bell, text: 'Instant Notifications & Notices' },
];

export default function Login() {
  const [activeTab, setActiveTab] = useState<'student-parent' | 'staff'>('student-parent');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(true);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await setPersistence(auth, keepSignedIn ? browserLocalPersistence : browserSessionPersistence);
      const cleanId = identifier.trim().toLowerCase();
      if (activeTab === 'student-parent') {
        const primaryEmail = `${cleanId}@${SCHOOL_DOMAIN}`;
        try {
          await signInWithEmailAndPassword(auth, primaryEmail, password);
        } catch (primaryErr: any) {
          // If user not found on new domain, try legacy domain
          if (primaryErr.code === 'auth/invalid-credential' || primaryErr.code === 'auth/user-not-found') {
            const legacyEmail = `${cleanId}@${LEGACY_DOMAIN}`;
            try {
              await signInWithEmailAndPassword(auth, legacyEmail, password);
            } catch (legacyErr: any) {
              // If still failed, throw the original error or a combined one
              throw primaryErr;
            }
          } else {
            throw primaryErr;
          }
        }
      } else {
        await signInWithEmailAndPassword(auth, cleanId, password);
      }
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        setError('Email/Password sign-in is not enabled. Please enable it in the Firebase Console.');
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        setError('Invalid credentials. Please check your school number or email and password.');
      } else {
        setError(err.message || 'Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const getGoogleSignInErrorMessage = (err: any) => {
    if (err.code === 'auth/operation-not-allowed') return 'Google sign-in is not enabled. Please enable it in the Firebase Console under Auth > Sign-in method.';
    if (err.code === 'auth/unauthorized-domain') return `Domain not authorized. Add "${window.location.hostname}" to Authorized Domains in Firebase Console > Authentication > Settings.`;
    if (err.code === 'auth/account-exists-with-different-credential') return 'An account already exists with this email using a different sign-in method.';
    if (err.code === 'auth/invalid-credential') return 'Google sign-in token was invalid. Please try again.';
    if (err.code === 'auth/popup-blocked') return 'Google sign-in pop-up was blocked. Please allow pop-ups for this site and try again.';
    if (err.code === 'auth/popup-closed-by-user') return 'Google sign-in was closed before it completed. Please try again.';
    return err.message || 'Google sign-in failed. Please try again.';
  };

  useEffect(() => {
    let isMounted = true;

    const pendingError = sessionStorage.getItem('auth_no_profile_error');
    if (pendingError) {
      setError(pendingError);
      sessionStorage.removeItem('auth_no_profile_error');
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser && isMounted) setLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
    };
  }, []);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');

    try {
      if (Capacitor.isNativePlatform()) {
        // Native platforms (Android/iOS) can't open web popups. Use the native
        // Google sign-in flow, then bridge the credential into the JS SDK so the
        // rest of the app (which relies on the Firebase JS SDK) stays in sync.
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;
        if (!idToken) {
          throw new Error('Google sign-in did not return a token. Please try again.');
        }
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
      } else {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(auth, provider);
      }
      // App.tsx onAuthStateChanged handles navigation from here
    } catch (err: any) {
      console.error('Google sign-in error:', err);
      setError(getGoogleSignInErrorMessage(err));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans">
      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-[48%] xl:w-[52%] relative bg-slate-900 flex-col justify-between p-12 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900" />
          <div className="absolute top-1/4 -left-20 w-72 h-72 bg-indigo-600/20 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-10 w-96 h-96 bg-violet-600/15 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-900/30 rounded-full blur-3xl" />
        </div>

        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }} />

        <div className="relative z-10">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-16">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-900/50">
              <img src={APP_LOGO} className="w-7 h-7 object-contain" alt={APP_NAME} referrerPolicy="no-referrer" />
            </div>
            <div>
              <p className="text-white font-bold text-lg leading-none">{APP_NAME}</p>
              <p className="text-indigo-400 text-[10px] font-semibold mt-0.5 uppercase tracking-widest">ERP Platform</p>
            </div>
          </div>

          <div className="mb-12">
            <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-4">
              Your child's success,<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                now at your fingertips
              </span>
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed max-w-md">
              The official digital companion for {SCHOOL_NAME} families. Stay connected with attendance, grades, and school updates in real-time.
            </p>
          </div>

          {/* Feature list */}
          <div className="space-y-4">
            {features.map(({ icon: Icon, text }, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className="flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-indigo-400" />
                </div>
                <span className="text-slate-300 text-sm font-medium">{text}</span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 p-4 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-bold shrink-0">
              E
            </div>
            <div>
              <p className="text-white text-sm font-semibold">{SCHOOL_NAME}</p>
              <p className="text-slate-400 text-xs">administration@{SCHOOL_DOMAIN}</p>
            </div>
          </div>
          <p className="text-slate-600 text-xs mt-4">&copy; {new Date().getFullYear()} {SCHOOL_NAME}. All rights reserved.</p>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg">
              <img src={APP_LOGO} className="w-7 h-7 object-contain" alt={APP_NAME} referrerPolicy="no-referrer" />
            </div>
            <div>
              <p className="font-bold text-lg text-slate-900 leading-none">{APP_NAME}</p>
              <p className="text-indigo-600 text-[10px] font-semibold mt-0.5 uppercase tracking-widest">{SCHOOL_NAME}</p>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900">Student & Parent Portal</h2>
            <p className="text-slate-500 mt-1 text-sm">Access the academic journey of your child</p>
          </div>

          {/* Tabs */}
          <div className="flex bg-slate-100 rounded-xl p-1 mb-6">
            {[
              { key: 'student-parent', label: 'Student / Parent', icon: Users },
              { key: 'staff', label: 'Staff Portal', icon: UserCog },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => { setActiveTab(key as any); setError(''); setIdentifier(''); }}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200',
                  activeTab === key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Identifier */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                {activeTab === 'student-parent' ? 'School Number' : 'Email Address'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  {activeTab === 'student-parent'
                    ? <Hash className="h-4 w-4 text-slate-400" />
                    : <Mail className="h-4 w-4 text-slate-400" />
                  }
                </div>
                <input
                  type={activeTab === 'student-parent' ? 'text' : 'email'}
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={activeTab === 'student-parent' ? 'e.g. 1234567 or p1234567' : 'name@example.com'}
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 hover:border-slate-300 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 hover:border-slate-300 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700"
                >
                  <span className="shrink-0 mt-0.5">⚠</span>
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div
                onClick={() => setKeepSignedIn(v => !v)}
                className={cn(
                  'w-10 h-5.5 rounded-full relative transition-colors duration-200 flex-shrink-0',
                  keepSignedIn ? 'bg-indigo-600' : 'bg-slate-200',
                )}
                style={{ height: '1.375rem' }}
              >
                <span
                  className={cn(
                    'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200',
                    keepSignedIn ? 'translate-x-5' : 'translate-x-0.5',
                  )}
                />
              </div>
              <span className="text-sm text-slate-600 font-medium">Keep me signed in</span>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl shadow-sm shadow-indigo-600/20 hover:shadow-md hover:shadow-indigo-600/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </>
              ) : 'Sign In'}
            </button>
          </form>

          {/* Google Login (staff only) */}
          <AnimatePresence>
            {activeTab === 'staff' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-xs text-slate-400 font-medium">Or continue with</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>
                <button
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 font-semibold py-3 rounded-xl shadow-sm transition-all"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* How to Login */}
          <div className="mt-8 p-5 bg-white border border-slate-200 rounded-2xl shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center">
                <Lock className="w-3.5 h-3.5 text-indigo-600" />
              </div>
              <p className="text-xs font-bold text-slate-900 uppercase tracking-wider">How to login</p>
            </div>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center shrink-0 border border-slate-100 italic font-serif text-slate-400 text-xs shadow-inner">S</div>
                <div>
                  <p className="text-xs font-bold text-slate-800">Student Login</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">Enter your <span className="font-semibold text-slate-900">School Number</span> as the identifier.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center shrink-0 border border-slate-100 italic font-serif text-slate-400 text-xs shadow-inner">P</div>
                <div>
                  <p className="text-xs font-bold text-slate-800">Parent Login</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">Enter <span className="font-semibold text-indigo-600">p</span> followed by the school number (e.g., p1234567).</p>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                Contact school administration if you haven't received your credentials yet.
              </p>
            </div>
          </div>

          <p className="text-center text-xs text-slate-400 mt-6">
            &copy; {new Date().getFullYear()} {SCHOOL_NAME} &middot;{' '}
            <a href="/privacy.html" target="_blank" className="hover:text-indigo-600 transition-colors">Privacy Policy</a>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
