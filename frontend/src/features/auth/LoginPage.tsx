import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Logo } from '../../shared/components/Icon';
import { useAuth } from '../../shared/hooks/AuthProvider';
import '../../styles/login.css';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (!loading && user) return <Navigate to="/bodega" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      await login(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
      navigate('/bodega', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <aside className="login-aside">
        <div className="login-brand">
          <Logo />
          <span>
            OPTI<span>CLEAN</span> <em>AI</em>
          </span>
        </div>
        <div>
          <p className="eyebrow">Operación conectada</p>
          <h1>
            Tu bodega, bajo control.
            <br />
            <em>En un solo lugar.</em>
          </h1>
          <p className="login-lead">
            Entra al panel para ver ubicaciones, inventario, recepción y pedidos en tiempo real.
          </p>
        </div>
        <p className="login-foot">innovamf.com · OPTICLEAN</p>
      </aside>
      <div className="login-panel">
        <form className="login-form" onSubmit={onSubmit} autoComplete="on">
          <div className="login-mark" aria-hidden>
            <Logo />
          </div>
          <h2>Iniciar sesión</h2>
          <p className="login-muted">Usa tu cuenta de operación OptiClean.</p>
          <label className="field">
            <span>Correo electrónico</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="admin@innovamf.com"
            />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <span className="login-password">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                minLength={8}
                placeholder="Tu contraseña"
              />
              <button
                type="button"
                className="login-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </span>
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button type="submit" className="btn primary login-submit" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
          <p className="login-hint">
            Panel: <code>admin@innovamf.com</code> · Piso:{' '}
            <code>ops@innovamf.com</code>
          </p>
        </form>
      </div>
    </div>
  );
}
