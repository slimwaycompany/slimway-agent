import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { authMiddleware, registerAuthRoutes } from './auth';
import { sessionsRouter } from './sessions';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

// Public health check
app.get('/api/health', async (_req, res) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(500).json({ ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set' });
    return;
  }
  const { error } = await createClient(url, key).rpc('ping');
  if (error) { res.status(500).json({ ok: false, error: error.message }); return; }
  res.json({ ok: true, supabase: 'ok', time: new Date().toISOString() });
});

// Auth routes (public: /api/login, /api/logout, /api/me)
registerAuthRoutes(app);

// Protect all remaining /api/* routes
const SKIP = new Set(['/api/health', '/api/login', '/api/logout', '/api/me']);
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith('/api/') || SKIP.has(req.path)) { next(); return; }
  authMiddleware(req, res, next);
});

app.use(sessionsRouter);

// Serve client
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
