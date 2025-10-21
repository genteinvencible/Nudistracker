import React, { useState } from 'react';

interface AuthScreenProps {
  onUnlock: (password: string) => void;
  hasExistingData: boolean;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onUnlock, hasExistingData }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError('Por favor, ingresa una contraseña');
      return;
    }

    if (!hasExistingData) {
      // New user - require password confirmation
      if (password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres');
        return;
      }

      if (password !== confirmPassword) {
        setError('Las contraseñas no coinciden');
        return;
      }
    }

    setIsLoading(true);

    // Small delay to show loading state
    setTimeout(() => {
      onUnlock(password);
      setIsLoading(false);
    }, 100);
  };

  return (
    <div className="auth-screen">
      <div className="auth-container">
        <div className="auth-header">
          <img
            src="https://nudistainvestor.com/wp-content/uploads/2025/10/nudsita-need-you.png"
            alt="Nudistracker Logo"
            className="auth-logo"
          />
          <h1>Nudistracker</h1>
          <p className="auth-subtitle">
            {hasExistingData
              ? 'Ingresa tu contraseña para acceder'
              : 'Crea una contraseña para proteger tus datos'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-field">
            <label htmlFor="password">
              {hasExistingData ? 'Contraseña' : 'Nueva Contraseña'}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasExistingData ? 'Ingresa tu contraseña' : 'Mínimo 6 caracteres'}
              autoFocus
              disabled={isLoading}
            />
          </div>

          {!hasExistingData && (
            <div className="form-field">
              <label htmlFor="confirmPassword">Confirmar Contraseña</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repite tu contraseña"
                disabled={isLoading}
              />
            </div>
          )}

          {error && (
            <div className="auth-error">
              <span>⚠️</span> {error}
            </div>
          )}

          <button
            type="submit"
            className="button primary auth-button"
            disabled={isLoading}
          >
            {isLoading ? 'Verificando...' : (hasExistingData ? 'Desbloquear' : 'Crear y Continuar')}
          </button>
        </form>

        <div className="auth-security-notice">
          <h4>🔒 Tu privacidad está protegida</h4>
          <ul>
            <li>Tus datos se cifran con tu contraseña</li>
            <li>Nadie más puede acceder sin tu contraseña</li>
            <li>Los datos se guardan solo en este navegador</li>
            <li>⚠️ Si olvidas la contraseña, perderás todo</li>
          </ul>
        </div>

        {!hasExistingData && (
          <div className="auth-warning">
            <strong>⚠️ IMPORTANTE:</strong> Guarda tu contraseña en un lugar seguro.
            No hay forma de recuperarla si la olvidas.
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthScreen;
