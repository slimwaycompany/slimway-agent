import { Application } from 'express';
import { handleUpdate } from '../telegram/bot';

export function mountTelegramRoute(app: Application): void {
  const secret = process.env.TG_WEBHOOK_SECRET ?? '';

  app.post('/tg/webhook', (req, res) => {
    if (!secret || req.headers['x-telegram-bot-api-secret-token'] !== secret) {
      res.status(401).end();
      return;
    }
    res.status(200).end(); // respond immediately — Telegram retries unconfirmed updates
    handleUpdate(req.body as Record<string, unknown>).catch(e =>
      console.error('[tg] handleUpdate error:', (e as Error).message),
    );
  });
}
