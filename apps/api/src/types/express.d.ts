import type { SessionUser } from '@poi/shared';

declare global {
  namespace Express {
    interface Request {
      auth: {
        user: SessionUser;
        sessionId: string;
        csrfTokenHash: string;
      } | null;
      requestId: string;
    }
  }
}

export {};
