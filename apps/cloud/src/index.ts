import { createApp } from './app.js';
import type { Env } from './env.js';
import { handleInboundEmail } from './handlers/emailWorker.js';
import { runScheduledMaintenance } from './services/cron.js';

export const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    await handleInboundEmail(message, env, ctx);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      runScheduledMaintenance(env).then((summary) => {
        console.log(JSON.stringify({ level: 'info', event: 'cron_maintenance', summary }));
      })
    );
  },
};
