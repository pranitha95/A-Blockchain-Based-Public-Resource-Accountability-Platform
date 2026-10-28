import { changePasswordSchema, loginSchema, registerSchema } from '@poi/shared';
import { Router } from 'express';
import { authenticationLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { sendData } from '../../lib/http.js';
import { changePassword, login, logout, registerObserver } from './auth.service.js';

export const authRouter = Router();

authRouter.get('/me', (req, res) => {
  sendData(res, req.auth?.user ?? null);
});

authRouter.post('/register', authenticationLimiter, validateBody(registerSchema), async (req, res) => {
  const user = await registerObserver(req.body, { ip: req.ip, userAgent: req.get('user-agent') }, res);
  sendData(res, user, undefined, 201);
});

authRouter.post('/login', authenticationLimiter, validateBody(loginSchema), async (req, res) => {
  const user = await login(req.body, { ip: req.ip, userAgent: req.get('user-agent') }, res);
  sendData(res, user);
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await logout(req.auth!.sessionId, res);
  sendData(res, { loggedOut: true });
});

authRouter.post('/change-password', requireAuth, validateBody(changePasswordSchema), async (req, res) => {
  await changePassword(req.auth!.user.id, req.body, res);
  sendData(res, { changed: true });
});
