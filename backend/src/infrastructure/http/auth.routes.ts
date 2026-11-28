import express from 'express';
import { assertEmailAvailable, authRequired, changePassword, createUser, login, publicUserFromRequest, requestPasswordReset, resetPasswordWithToken, type PublicUser } from '../auth/auth.js';
import { authServiceChange, authServiceEnabled, authServiceForgot, authServiceLogin, authServiceLogout, authServiceRefresh, authServiceReset } from '../auth/auth-client.js';
import { createCompany, deleteCompany } from '../../domain/admin.service.js';
import { loginBlockedFor, registerLoginFailure, registerLoginSuccess } from './login-throttle.js';
import { signupEnabled } from './env.js';

export function registerAuthRoutes(app: express.Express) {
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = String(req.body?.email ?? '');
      const password = String(req.body?.password ?? '');
      if (!email || !password) {
        res.status(400).json({ error: 'Ingresa correo y contraseña' });
        return;
      }
      const ip = req.ip || 'desconocida';
      const wait = loginBlockedFor(ip, email);
      if (wait) {
        res.set('Retry-After', String(wait));
        res.status(429).json({
          error: `Demasiados intentos fallidos. Espera ${Math.ceil(wait / 60)} minuto(s) antes de volver a intentar.`,
        });
        return;
      }
      try {
        let result: { token: string; user: PublicUser } | null = null;
        if (authServiceEnabled()) {
          try {
            const remote = await authServiceLogin(email, password, 'opticlean');
            if (remote?.token && remote.user) {
              res.json({
                token: remote.accessToken || remote.token,
                accessToken: remote.accessToken || remote.token,
                refreshToken: remote.refreshToken,
                expiresIn: remote.expiresIn,
                refreshExpiresIn: remote.refreshExpiresIn,
                user: remote.user as unknown as PublicUser,
              });
              registerLoginSuccess(ip, email);
              return;
            }
          } catch {
            /* fallback local si el microservicio falla */
          }
        }
        result = login(email, password);
        registerLoginSuccess(ip, email);
        res.json(result);
      } catch (e) {
        registerLoginFailure(ip, email);
        throw e;
      }
    } catch (e) {
      res.status(401).json({ error: e instanceof Error ? e.message : 'No autorizado' });
    }
  });

  app.get('/api/public/config', (_req, res) => {
    res.json({ signupEnabled: signupEnabled() });
  });

  /**
   * Registro de una empresa nueva: crea la empresa (tenant) y su primer administrador,
   * y devuelve la sesión iniciada. El administrador creado es de su empresa, nunca de la plataforma.
   */
  app.post('/api/auth/signup', (req, res) => {
    const ip = req.ip || 'desconocida';
    const email = String(req.body?.email ?? '');
    try {
      if (!signupEnabled()) {
        res.status(403).json({ error: 'El registro de empresas no está disponible.' });
        return;
      }
      const wait = loginBlockedFor(ip, `signup:${ip}`);
      if (wait) {
        res.set('Retry-After', String(wait));
        res.status(429).json({ error: `Demasiados registros desde esta red. Espera ${Math.ceil(wait / 60)} minuto(s).` });
        return;
      }
      // Cada intento cuenta: limita la creación masiva de empresas desde una misma IP.
      registerLoginFailure(ip, `signup:${ip}`);

      const companyName = String(req.body?.companyName ?? '').trim();
      const name = String(req.body?.name ?? '').trim();
      const password = String(req.body?.password ?? '');
      if (companyName.length < 2 || companyName.length > 80) throw new Error('El nombre de la empresa debe tener entre 2 y 80 caracteres.');
      if (!name) throw new Error('Tu nombre es obligatorio.');
      if (password.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres.');
      // Validar todo antes de crear la empresa para no dejar empresas huérfanas.
      const cleanEmail = assertEmailAvailable(email);

      const company = createCompany({ name: companyName, uniqueSlug: true });
      try {
        createUser({ email: cleanEmail, name, password, role: 'admin', companyId: company.id });
      } catch (e) {
        deleteCompany(company.id);
        throw e;
      }
      res.status(201).json({ ...login(cleanEmail, password), company });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'No se pudo completar el registro' });
    }
  });

  app.get('/api/auth/me', authRequired, (req, res) => {
    res.json({ user: publicUserFromRequest(req) });
  });

  /** Renueva access JWT con refresh token (auth-service). */
  app.post('/api/auth/refresh', async (req, res) => {
    try {
      const refreshToken = String(req.body?.refreshToken ?? '');
      if (!refreshToken) {
        res.status(400).json({ error: 'Falta refreshToken' });
        return;
      }
      if (!authServiceEnabled()) {
        res.status(503).json({ error: 'Refresh token no disponible sin auth-service.' });
        return;
      }
      const remote = await authServiceRefresh(refreshToken);
      if (!remote) {
        res.status(503).json({ error: 'Auth service no disponible' });
        return;
      }
      res.json({
        token: remote.accessToken || remote.token,
        accessToken: remote.accessToken || remote.token,
        refreshToken: remote.refreshToken,
        expiresIn: remote.expiresIn,
        refreshExpiresIn: remote.refreshExpiresIn,
        user: remote.user,
      });
    } catch (e) {
      res.status(401).json({ error: e instanceof Error ? e.message : 'No se pudo renovar la sesión' });
    }
  });

  /** Revoca refresh / cierra sesión en auth-service. */
  app.post('/api/auth/logout', async (req, res) => {
    try {
      const header = req.headers.authorization || '';
      const accessToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      const refreshToken = req.body?.refreshToken ? String(req.body.refreshToken) : undefined;
      if (authServiceEnabled()) {
        await authServiceLogout({ refreshToken, accessToken: accessToken || undefined });
      }
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  /** Cambio de contraseña (sesión activa). Prefiere auth-service. */
  app.post('/api/auth/password/change', authRequired, async (req, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword ?? '');
      const newPassword = String(req.body?.newPassword ?? '');
      if (authServiceEnabled()) {
        try {
          const header = req.headers.authorization || '';
          const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
          const remote = await authServiceChange(token, currentPassword, newPassword);
          if (remote) {
            res.json(remote);
            return;
          }
        } catch (e) {
          res.status(400).json({ error: e instanceof Error ? e.message : 'No se pudo cambiar' });
          return;
        }
      }
      res.json(changePassword(req.user!.id, currentPassword, newPassword));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'No se pudo cambiar' });
    }
  });

  /** Olvidé mi contraseña. */
  app.post('/api/auth/password/forgot', async (req, res) => {
    try {
      const email = String(req.body?.email ?? '');
      if (!email) {
        res.status(400).json({ error: 'Indica tu correo' });
        return;
      }
      if (authServiceEnabled()) {
        try {
          const remote = await authServiceForgot(email, 'opticlean');
          if (remote) {
            res.json(remote);
            return;
          }
        } catch {
          /* fallback local */
        }
      }
      res.json(requestPasswordReset(email));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'No se pudo procesar' });
    }
  });

  /** Restablecer con token del enlace. */
  app.post('/api/auth/password/reset', async (req, res) => {
    try {
      const token = String(req.body?.token ?? '');
      const newPassword = String(req.body?.newPassword ?? '');
      if (authServiceEnabled()) {
        try {
          const remote = await authServiceReset(token, newPassword, 'opticlean');
          if (remote) {
            res.json(remote);
            return;
          }
        } catch (e) {
          // Si el token es del flujo local, intentar localmente.
          try {
            res.json(resetPasswordWithToken(token, newPassword));
            return;
          } catch {
            res.status(400).json({ error: e instanceof Error ? e.message : 'No se pudo restablecer' });
            return;
          }
        }
      }
      res.json(resetPasswordWithToken(token, newPassword));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'No se pudo restablecer' });
    }
  });
}
