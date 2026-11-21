import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Icon, Logo, Spinner } from '../../shared/components/Icon';
import { Button } from '../../shared/components/ui';
import { fadeUp, stagger, swap } from '../../shared/motion/presets';
import { useAuth } from '../../shared/hooks/AuthProvider';
import { homeForRole } from '../../app/navigation';
import '../../styles/login.css';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (!loading && user) return <Navigate to={homeForRole(user.role)} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      const session = await login(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
      navigate(homeForRole(session.role), { replace: true });
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
        <motion.div variants={stagger} initial="hidden" animate="show">
          <motion.p className="eyebrow" variants={fadeUp}>
            Operación conectada
          </motion.p>
          <motion.h1 variants={fadeUp}>
            Tu bodega, bajo control.
            <br />
            <em>En un solo lugar.</em>
          </motion.h1>
          <motion.p className="login-lead" variants={fadeUp}>
            Entra al panel para ver ubicaciones, inventario, recepción y pedidos en tiempo real.
          </motion.p>
        </motion.div>
        <p className="login-foot">innovamf.com · OPTICLEAN</p>
      </aside>

      <div className="login-panel">
        <motion.form
          className="login-form"
          onSubmit={onSubmit}
          autoComplete="on"
          variants={fadeUp}
          initial="hidden"
          animate="show"
          aria-busy={busy}
        >
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
                className="icon-btn login-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={showPassword ? 'off' : 'on'}
                    className="login-eye-glyph"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                  >
                    <Icon name={showPassword ? 'eye-off' : 'eye'} />
                  </motion.span>
                </AnimatePresence>
              </button>
            </span>
          </label>

          <AnimatePresence initial={false}>
            {error ? (
              <motion.p
                key="error"
                className="login-error"
                role="alert"
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              >
                <Icon name="alert" />
                <span>{error}</span>
              </motion.p>
            ) : null}
          </AnimatePresence>

          <Button
            type="submit"
            variant="primary"
            size="large"
            full
            className="login-submit"
            disabled={busy}
            aria-label={busy ? 'Entrando' : undefined}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={busy ? 'busy' : 'idle'}
                className="login-submit-content"
                variants={swap}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                {busy ? <Spinner /> : 'Entrar'}
              </motion.span>
            </AnimatePresence>
          </Button>

          <p className="login-hint">
            Panel: <code>admin@innovamf.com</code> · Piso: <code>ops@innovamf.com</code>
          </p>
        </motion.form>
      </div>
    </div>
  );
}
