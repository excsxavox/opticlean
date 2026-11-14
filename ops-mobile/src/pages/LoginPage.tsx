import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../components/Icon';
import { setSession, type AuthUser } from '../auth';

type Props = {
  user: AuthUser | null;
  onLogin: (user: AuthUser) => void;
};

export function LoginPage({ user, onLogin }: Props) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      const res = await api.login(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
      setSession(res.token, res.user);
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand-row">
          <Logo />
          <div>
            <strong>
              OPTI<span>CLEAN</span> <em>Ops</em>
            </strong>
            <small>Bodega en piso</small>
          </div>
        </div>
        <h1>Iniciar sesión</h1>
        <p className="subtle">Entra para operar recepción, pedidos y bodega.</p>
        <form onSubmit={onSubmit} autoComplete="on">
          <label className="field">
            <span>Correo</span>
            <input name="email" type="email" required autoComplete="username" placeholder="ops@innovamf.com" />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <div className="login-pass">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                autoComplete="current-password"
                placeholder="Tu contraseña"
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button type="submit" className="btn primary full" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
