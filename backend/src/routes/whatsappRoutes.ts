import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../security/auth.js';
import type { Database } from '../db/database.js';
import { BaileysManager } from '../services/baileysManager.js';
import { clientHandlerEvents } from '../services/clientHandlerService.js';

const sendSchema = z.object({
  number: z.string().trim().min(8).max(25),
  message: z.string().trim().min(1).max(4000),
  leadId: z.string().optional(),
});

export async function whatsappRoutes(app: FastifyInstance, options: { database: Database }): Promise<void> {
  const baileys = BaileysManager.getInstance(options.database);

  app.register(async (authedApp) => {
    authedApp.addHook('preHandler', authenticate);

    // 1. Connection status
    authedApp.get('/api/whatsapp/status', async () => {
      const status = baileys.getStatus();
      if ((status.state === 'not_connected' || status.state === 'disconnected') && status.hasSavedSession) {
        // Auto-reconnect in background if saved session exists
        void baileys.connect().catch(() => {});
      }
      return { ok: true, status: baileys.getStatus() };
    });

    // 2. Real-time status & QR updates via Server-Sent Events (SSE)
    authedApp.get('/api/whatsapp/events', async (request, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': request.headers.origin || '*',
      });

      // Send initial state immediately
      reply.raw.write(`data: ${JSON.stringify(baileys.getStatus())}\n\n`);

      const onStatusUpdate = (status: unknown) => {
        try {
          reply.raw.write(`data: ${JSON.stringify(status)}\n\n`);
        } catch {
          // Socket closed
        }
      };

      baileys.events.on('status', onStatusUpdate);

      // Keepalive ping every 15s to prevent intermediary timeouts
      const pingInterval = setInterval(() => {
        try {
          reply.raw.write(': keepalive\n\n');
        } catch {
          // Socket closed
        }
      }, 15_000);

      request.raw.on('close', () => {
        clearInterval(pingInterval);
        baileys.events.off('status', onStatusUpdate);
      });

      // Prevent fastify from auto-closing the reply
      await new Promise<void>((resolve) => {
        request.raw.on('close', resolve);
      });
    });

    // 3. Connect (initialize session or generate QR)
    authedApp.post('/api/whatsapp/connect', async (request, reply) => {
      try {
        const body = (request.body as { forceNewQr?: boolean } | null) || {};
        await baileys.connect({
          forceNewQr: Boolean(body.forceNewQr),
          userInitiated: true,
        });
        const status = await baileys.waitForQrOrConnection(5500);
        return { ok: true, status };
      } catch (err) {
        return reply.code(500).send({
          ok: false,
          error: err instanceof Error ? err.message : 'Could not initiate WhatsApp connection.',
          status: baileys.getStatus(),
        });
      }
    });

    // 4. Disconnect session temporarily
    authedApp.post('/api/whatsapp/disconnect', async () => {
      await baileys.disconnect();
      return { ok: true, status: baileys.getStatus() };
    });

    // 5. Logout & wipe credentials for clean pairing
    authedApp.post('/api/whatsapp/logout', async () => {
      await baileys.logout();
      return { ok: true, status: baileys.getStatus() };
    });

    // 6. Restart/reconnect
    authedApp.post('/api/whatsapp/restart', async (request, reply) => {
      try {
        const body = (request.body as { forceNewQr?: boolean } | null) || {};
        await baileys.restart({
          forceNewQr: Boolean(body.forceNewQr),
          userInitiated: true,
        });
        const status = await baileys.waitForQrOrConnection(5500);
        return { ok: true, status };
      } catch (err) {
        return reply.code(500).send({
          ok: false,
          error: err instanceof Error ? err.message : 'Could not restart WhatsApp connection.',
          status: baileys.getStatus(),
        });
      }
    });

    // 6b. Connection diagnostics
    authedApp.get('/api/whatsapp/diagnostics', async () => {
      return {
        ok: true,
        status: baileys.getStatus(),
        diagnostics: baileys.getDiagnostics(),
      };
    });

    // 7. Direct authenticated message send
    authedApp.post('/api/whatsapp/send', async (request, reply) => {
      const parsed = sendSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: parsed.error.issues[0]?.message || 'Invalid send parameters.',
        });
      }

      try {
        const result = await baileys.sendTextMessage(parsed.data.number, parsed.data.message);
        const targetLeadId = parsed.data.leadId || options.database.findLeadByPhone(parsed.data.number)?.leadId;
        if (targetLeadId) {
          options.database.updateWhatsApp(targetLeadId, {
            status: result.status,
            providerMessageId: result.providerMessageId,
          });
          options.database.updateLead(targetLeadId, {
            whatsappStatus: result.status,
            whatsappRunId: result.providerMessageId,
          });
          const client = options.database.getClientConversation(targetLeadId);
          const convMsgs = options.database.getConversationMessages(targetLeadId);
          const lastMsg = convMsgs[convMsgs.length - 1];
          if (client && lastMsg) {
            clientHandlerEvents.emit('message_sent', {
              leadId: targetLeadId,
              message: lastMsg,
              client,
            });
          }
        }
        return { ok: true, result };
      } catch (err) {
        return reply.code(500).send({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to dispatch WhatsApp message.',
        });
      }
    });
  });
}
