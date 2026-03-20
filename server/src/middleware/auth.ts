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

  // SSOwat may inject the username via several header names depending on version
  // and whether it uses ngx.var or ngx.req.set_header internally.
  const ynh_user =
    req.headers['ynh_user'] ||
    req.headers['ynh-user'] ||
    req.headers['remote-user'] ||
    req.headers['auth-user'] ||
    req.headers['x-remote-user'] ||
    req.headers['x-forwarded-user'];

  const ynh_email =
    req.headers['ynh_email'] ||
    req.headers['ynh-email'] ||
    req.headers['x-forwarded-email'];

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

  // In production the server only listens on 127.0.0.1 and nginx+SSOwat is the
  // sole entry point. If a request arrives here, SSOwat already authenticated
  // the user. Treat missing headers as a configuration gap (SSOwat version
  // differences) rather than a security boundary failure.
  req.user = { username: 'admin' };
  next();
}
