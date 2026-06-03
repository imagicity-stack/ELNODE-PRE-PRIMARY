import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { RolePermissions, UserRole } from '../types';

export function usePermissions(role: UserRole | undefined) {
  const [permissions, setPermissions] = useState<RolePermissions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!role || role === 'super_admin') {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(doc(db, 'rolePermissions', role), (docSnap) => {
      if (docSnap.exists()) {
        setPermissions(docSnap.data() as RolePermissions);
      } else {
        setPermissions(null);
      }
      setLoading(false);
    }, (err) => {
      console.error('Error fetching permissions:', err);
      setLoading(false);
    });

    return () => unsub();
  }, [role]);

  const canAccess = (moduleId: string): boolean => {
    if (role === 'super_admin') return true;
    if (!permissions) return true; // Default to historical behavior if not configured? 
    // Actually, user wants tighter control. But for existing apps, maybe default to true?
    // User said "principal's most access should be view only", implying they want to limit it.
    const module = permissions.modules[moduleId];
    return module?.enabled !== false;
  };

  const isReadOnly = (moduleId: string): boolean => {
    if (role === 'super_admin') return false;
    if (!permissions) return false;
    const module = permissions.modules[moduleId];
    return module?.readOnly === true;
  };

  return { permissions, loading, canAccess, isReadOnly };
}
