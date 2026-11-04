import '@whiskeysockets/baileys';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { env } from './config/env.js';
import { Database } from './db/database.js';
import { authRoutes } from './routes/auth.js';
import { apiRoutes } from './routes/api.js';
import { clientHandlerRoutes } from './routes/clientHandler.js';
import { whatsappRoutes } from './routes/whatsappRoutes.js';
import { jobRoutes } from './routes/jobRoutes.js';
import { RunPipeline } from './services/runPipeline.js';
import { BaileysManager } from './services/baileysManager.js';
import { hasSavedSession } from './services/baileysAuthState.js';

export function buildApp(customDatabase?: Database) {
  const app = Fastify({ logger: env.NODE_ENV !== 'test', bodyLimit: 25 * 1024 * 1024 });
  const database = customDatabase || new Database(env.databasePath);
  const pipeline = new RunPipeline(database);
  app.register(helmet, { global: true, contentSecurityPolicy: false });
  app.register(cors, {
    origin: (origin, cb) => {
      // Reflect origin so all Vercel previews, production domains, and localhost work seamlessly
      cb(null, true);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Waha-Webhook-Secret'],
  });
  app.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024,
      files: 1
    }
  });
  app.register(rateLimit, { max: 600, timeWindow: '1 minute', keyGenerator: (request) => request.ip });
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 25 * 1024 * 1024 }, (_req, body: string, done) => {
    if (!body || body.trim().length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });
  app.get('/', async () => ({
    status: 'online',
    service: 'client-hunter-backend',
    message: 'Client Hunter & AI Job Finder Backend is running successfully.',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth/login',
      jobs: '/api/jobs',
      whatsapp: '/api/whatsapp/status',
      clientHandler: '/api/client-handler/conversations',
    },
  }));
  app.get('/api/health', async () => ({ ok: true, service: 'client-hunter-backend', time: new Date().toISOString() }));
  app.register(authRoutes);
  app.register(apiRoutes, { database, pipeline });
  app.register(clientHandlerRoutes, { database });
  app.register(whatsappRoutes, { database });
  app.register(jobRoutes, { database });
  app.addHook('onClose', async () => {
    try {
      database.setLastActiveTimestamp();
    } catch {}
    try {
      await BaileysManager.getInstance(database).disconnect();
    } catch {
      // ignore
    }
    try {
      const { JobDiscoveryScheduler } = await import('./services/jobDiscoveryScheduler.js');
      JobDiscoveryScheduler.getInstance(database).stop();
    } catch {
      // ignore
    }
    database.close();
  });
  return app;
}

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled Rejection:', reason);
});

if (process.env.NODE_ENV !== 'test') {
  const database = new Database(env.databasePath);
  const app = buildApp(database);
  app.ready((err) => {
    if (err) {
      console.error('FASTIFY READY ERROR:', err);
      process.exit(1);
    }
  });
  app.listen({ host: env.HOST, port: env.PORT }).then(() => {
    app.log.info(`Client Hunter backend listening on http://${env.HOST}:${env.PORT}`);

    const lastActive = database.getLastActiveTimestamp();
    if (lastActive) {
      app.log.info(`[WhatsApp] System reopened. Offline since: ${lastActive}. Checking for missed messages...`);
    }
    database.setLastActiveTimestamp();

    // Periodic heartbeat to track when the system was last online
    const heartbeat = setInterval(() => {
      try {
        database.setLastActiveTimestamp();
      } catch {}
    }, 15_000);
    heartbeat.unref();

    // Auto-resume saved WhatsApp session if credentials exist
    if (hasSavedSession(database)) {
      app.log.info('Found existing WhatsApp session, reconnecting in background...');
      BaileysManager.getInstance(database).connect().catch((err) => {
        app.log.warn({ err }, 'Background WhatsApp reconnection encountered an error');
      });
    }

    const gracefulShutdown = async (signal: string) => {
      app.log.info(`Received ${signal}, closing server and WhatsApp connection cleanly...`);
      try {
        database.setLastActiveTimestamp();
      } catch {}
      try {
        await BaileysManager.getInstance(database).destroy();
      } catch {}
      try {
        await app.close();
      } catch {}
      process.exit(0);
    };

    process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  }).catch((error) => {
    console.error('SERVER LISTEN FAILED ERROR:', error);
    app.log.error(error);
    process.exit(1);
  });
}
