import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';

const TIMEOUT_DURATION = 15 * 60 * 1000; // 15 minutos de inactividad
const WARNING_DURATION = 2 * 60 * 1000; // Advertir 2 minutos antes

export const SessionTimeout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { signOut, user } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetTimer = () => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);

    // Clear existing timers
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);

    // Set warning timer
    warningRef.current = setTimeout(() => {
      setShowWarning(true);
    }, TIMEOUT_DURATION - WARNING_DURATION);

    // Set logout timer
    timeoutRef.current = setTimeout(async () => {
      await signOut();
      alert('Tu sesión ha expirado por inactividad. Por favor, inicia sesión nuevamente.');
    }, TIMEOUT_DURATION);
  };

  const handleActivity = () => {
    // Only reset if user is logged in
    if (user) {
      resetTimer();
    }
  };

  useEffect(() => {
    if (!user) {
      // Clear timers if user logs out
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
      setShowWarning(false);
      return;
    }

    // Start timer when user logs in
    resetTimer();

    // Activity listeners
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(event => {
      document.addEventListener(event, handleActivity);
    });

    return () => {
      // Cleanup
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
      events.forEach(event => {
        document.removeEventListener(event, handleActivity);
      });
    };
  }, [user]);

  const handleExtendSession = () => {
    resetTimer();
  };

  const handleLogoutNow = async () => {
    await signOut();
  };

  return (
    <>
      {children}
      {showWarning && (
        <div className="session-warning-overlay">
          <div className="session-warning-modal">
            <h3>⏰ Tu sesión está a punto de expirar</h3>
            <p>Tu sesión se cerrará en 2 minutos por inactividad.</p>
            <p>¿Quieres continuar trabajando?</p>
            <div className="session-warning-actions">
              <button className="button primary" onClick={handleExtendSession}>
                Sí, continuar sesión
              </button>
              <button className="button" onClick={handleLogoutNow}>
                No, cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
