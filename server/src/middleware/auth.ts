import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: { username: string; email?: string };
    }
  }
}

/**
 * SSOwat header auth middleware.
 *
 * In production: nginx (via YunoHost SSOwat) injects YNH_USER and YNH_EMAIL
 * headers after a user successfully authenticates via the YunoHost portal.
 * Because the Express server only binds to 127.0.0.1, only nginx can set these.
 *
 * In development (NODE_ENV !== 'production'): falls back to a mock user so
 * the frontend can be developed locally without a real YunoHost setup.
 */
export function ssowatAuth(req: Request, res: Response, next: NextFunction): void {
  const isDev = process.env.NODE_ENV !== 'production';

  const ynh_user = req.headers['ynh_user'] || req.headers['ynh-user'];
  const ynh_email = req.headers['ynh_email'] || req.headers['ynh-email'];

  if (ynh_user) {
    req.user = {
      username: String(ynh_user),
      email: ynh_email ? String(ynh_email) : undefined,
    };
    next();
    return;
  }

  if (isDev) {
    req.user = { username: 'dev-user', email: 'dev@localhost' };
    next();
    return;
  }

  res.status(403).json({
    error: 'Unauthorized',
    message: 'Please log in via the YunoHost portal to access this application.',
    portalUrl: 'https://your-yunohost-domain/yunohost/sso',
  });
}
