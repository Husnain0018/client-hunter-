import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../security/auth.js';
import type { Database } from '../db/database.js';
import { ClientHandlerService, clientHandlerEvents } from '../services/clientHandlerService.js';
import { BaileysManager, normalizeToInternationalWhatsApp } from '../services/baileysManager.js';
import type { ClientStage } from '../types/domain.js';

const clientStageEnum = z.enum([
  'new',
  'contacted',
  'awaiting_reply',
  'conversing',
  'follow_up_scheduled',
  'interested',
  'proposal_pending',
  'negotiating',
  'closed_won',
  'lost',
  'opted_out',
  'needs_human',
]);

const messageSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

const closeDealSchema = z.object({
  agreedServices: z.array(z.string().trim().min(1)).min(1),
  agreedPrice: z.string().trim().min(1).max(100),
  agreedTimeline: z.string().trim().min(1).max(100),
  agreedDeliverables: z.string().trim().min(1).max(1000),
  dealNotes: z.string().max(2000).optional().default(''),
  notifyUserWhatsApp: z.boolean().default(false),
  userPhoneNumber: z.string().max(40).optional(),
});

export async function clientHandlerRoutes(app: FastifyInstance, options: { database: Database }): Promise<void> {
  const service = new ClientHandlerService(options.database);

  // Wire direct Baileys real-time incoming messages to Client Handler
  const baileys = BaileysManager.getInstance(options.database);
  baileys.setMessageHandler(async (msg) => {
    await service.handleIncomingWhatsAppMessage(msg);
  });

  // Automatically check and process missed WhatsApp messages when socket becomes ready
  let missedCheckTimeout: NodeJS.Timeout | null = null;
  const scheduleMissedCheck = () => {
    if (missedCheckTimeout) clearTimeout(missedCheckTimeout);
    missedCheckTimeout = setTimeout(() => {
      void service.checkAndProcessMissedMessages().catch((err) => {
        app.log.warn({ err }, 'Failed automatic check for missed WhatsApp messages');
      });
    }, 1200);
  };

  baileys.events.on('ready', scheduleMissedCheck);
  baileys.events.on('status', (status: any) => {
    if (status?.isReady) {
      scheduleMissedCheck();
    }
  });

  if (baileys.getStatus().isReady) {
    scheduleMissedCheck();
  }

  // 1. Webhook for incoming WhatsApp messages (kept for backward compatibility)
  app.post('/api/webhooks/waha/message', async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>;
    const payload = (body.payload || body) as Record<string, unknown>;

    try {
      const res = await service.handleIncomingWebhook(payload);
      return { ok: true, ...res };
    } catch (err) {
      request.log.error(err, 'Failed to process incoming WhatsApp webhook');
      return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : 'Webhook error' });
    }
  });

  // 1b. Webhook for WhatsApp delivery & read status ACKs
  app.post('/api/webhooks/waha/ack', async (request) => {
    const body = (request.body || {}) as Record<string, unknown>;
    const payload = (body.payload || body) as Record<string, unknown>;
    const providerMessageId = String(payload.id || payload.messageId || (payload._data as any)?.id || '');
    const rawAck = payload.ack !== undefined ? payload.ack : (payload._data as any)?.ack;

    const statusMap: Record<number, any> = {
      1: 'Pending',
      2: 'Sent',
      3: 'Delivered',
      4: 'Read',
      5: 'Played',
    };

    const mapped = typeof rawAck === 'number' ? statusMap[rawAck] : undefined;
    if (providerMessageId && mapped) {
      options.database.updateWhatsAppStatusByProviderId(providerMessageId, mapped);
      const leadId = options.database.getLeadIdByProviderMessageId(providerMessageId) || undefined;
      baileys.events.emit('message_status', { providerMessageId, status: mapped, leadId });
      clientHandlerEvents.emit('message_status', { providerMessageId, status: mapped, leadId });
      return { ok: true, providerMessageId, status: mapped, leadId };
    }
    return { ok: true, ignored: true };
  });

  // Protected Client Handler Endpoints
  app.register(async (authedApp) => {
    authedApp.addHook('preHandler', authenticate);

    // List all clients with pipeline stage & stats
    authedApp.get('/api/clients', async (request) => {
      const query = request.query as { stage?: string; q?: string };
      const clients = service.listClients(query.stage, query.q);
      const stats = service.getStats();
      return { ok: true, clients, stats };
    });

    // Inspect pending missed WhatsApp messages received while offline
    authedApp.get('/api/clients/missed-messages', async () => {
      const missed = service.getMissedMessages();
      return { ok: true, count: missed.length, missed };
    });

    // Manually trigger processing of any missed WhatsApp messages
    authedApp.post('/api/clients/check-missed-messages', async () => {
      const result = await service.checkAndProcessMissedMessages();
      return { ok: true, result };
    });

    // Real-time Server-Sent Events (SSE) stream for incoming/outgoing messages & status updates
    authedApp.get('/api/clients/events', async (request, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': request.headers.origin || '*',
      });

      const writeEvent = (eventType: string, payload: unknown) => {
        try {
          if (!reply.raw.writableEnded) {
            reply.raw.write(`data: ${JSON.stringify({ type: eventType, ...(payload as object) })}\n\n`);
          }
        } catch {
          // Socket closed
        }
      };

      // Initial snapshot acknowledgment
      writeEvent('connected', {
        timestamp: new Date().toISOString(),
        stats: service.getStats(),
      });

      const onMessageReceived = (data: any) => writeEvent('message_received', { ...data, stats: service.getStats() });
      const onMessageSent = (data: any) => writeEvent('message_sent', { ...data, stats: service.getStats() });
      const onConversationUpdated = (data: any) =>
        writeEvent('conversation_updated', { ...data, stats: service.getStats() });
      const onMessageStatus = (data: any) => writeEvent('message_status', data);

      clientHandlerEvents.on('message_received', onMessageReceived);
      clientHandlerEvents.on('message_sent', onMessageSent);
      clientHandlerEvents.on('conversation_updated', onConversationUpdated);
      clientHandlerEvents.on('message_status', onMessageStatus);
      baileys.events.on('message_status', onMessageStatus);

      const heartbeat = setInterval(() => {
        try {
          if (!reply.raw.writableEnded) {
            reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
          }
        } catch {
          // Socket closed
        }
      }, 15_000);

      request.raw.on('close', () => {
        clearInterval(heartbeat);
        clientHandlerEvents.off('message_received', onMessageReceived);
        clientHandlerEvents.off('message_sent', onMessageSent);
        clientHandlerEvents.off('conversation_updated', onConversationUpdated);
        clientHandlerEvents.off('message_status', onMessageStatus);
        baileys.events.off('message_status', onMessageStatus);
      });

      await new Promise<void>((resolve) => {
        request.raw.on('close', resolve);
      });
    });

    // Link an unmatched inbound WhatsApp contact to an existing lead
    authedApp.post('/api/clients/:leadId/link-lead', async (request, reply) => {
      const { leadId } = request.params as { leadId: string };
      const parsed = z.object({
        targetLeadId: z.string().trim().min(1),
      }).safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: 'Valid targetLeadId is required.' });
      }

      try {
        const client = service.linkUnmatchedLead(leadId, parsed.data.targetLeadId);
        const stats = service.getStats();
        return { ok: true, client, stats };
      } catch (err) {
        return reply.code(400).send({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to link unmatched contact to lead.',
        });
      }
    });

    // Single client record
    authedApp.get('/api/clients/:leadId', async (request, reply) => {
      const { leadId } = request.params as { leadId: string };
      try {
        const client = service.getClient(leadId);
        return { ok: true, client };
      } catch {
        return reply.code(404).send({ ok: false, error: 'Client conversation not found.' });
      }
    });

    // Send WhatsApp message to client
    authedApp.post('/api/clients/:leadId/message', async (request, reply) => {
      const { leadId } = request.params as { leadId: string };
      const parsed = messageSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Valid text is required.' });

      try {
        const sent = await service.sendMessage(leadId, parsed.data.text, 'user');
        const client = service.getClient(leadId);
        return { ok: true, message: sent, client };
      } catch (err) {
        return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : 'Failed to send message.' });
      }
    });

    // Generate & optionally send first message
    authedApp.post('/api/clients/:leadId/first-message', async (request, reply) => {
      const { leadId } = request.params as { leadId: string };
      const autoSend = Boolean((request.body as any)?.autoSend);
      try {
        const result = await service.sendFirstMessage(leadId, autoSend);
        const client = service.getClient(leadId);
        return { ok: true, ...result, client };
      } catch (err) {
        return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : 'Failed to generate first message.' });
      }
    });

    // Generate AI response draft
    authedApp.post('/api/clients/:leadId/generate-reply', async (request, reply) => {
      const { leadId } = request.params as { leadId: string };
      const guidance = (request.body as any)?.guidance as string | undefined;
      try {
        const draft = await service.generateReplyDraft(leadId, guidance);
        return { ok: true, draft };
      } catch (err) {
        return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : 'Failed to generate reply.' });
      }
    });

    // Toggle auto-pilot
    authedApp.post('/api/clients/:leadId/autopilot', async (request, reply) => {
      const { leadId } = request.params as { leadId: string };
      const enabled = Boolean((request.body as any)?.enabled);
      try {
        const client = service.toggleAutoPilot(leadId, enabled);
        return { ok: true, client };
      } catch (err) {
        return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : 'Failed to update autopilot.' });
      }
    });

    // Update stage or notes
    authedApp.post('/api/clients/:leadId/stage', async (request, reply) => {
      const { leadId } = request.params as { leadId: string };
      const parsed = z.object({
        stage: clientStageEnum,
        dealNotes: z.string().max(2000).optional(),
      }).safeParse(request.body);

      if (!parsed.success) return reply.code(400).send({ ok: false, error: 'Valid stage is required.' });

      try {
        const client = service.updateStage(leadId, parsed.data.stage as ClientStage, parsed.data.dealNotes);
        return { ok: true, client };
      } catch (err) {
        return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : 'Failed to update stage.' });
      }
    });

    // Close deal & trigger notifications
    authedApp.post('/api/clients/:leadId/close-deal', async (request, reply) => {
      const { leadId } = request.params as { leadId: string };
      const parsed = closeDealSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid deal terms.' });

      try {
        const client = await service.closeDeal(leadId, {
          leadId,
          ...parsed.data,
        });
        return { ok: true, client };
      } catch (err) {
        return reply.code(500).send({ ok: false, error: err instanceof Error ? err.message : 'Failed to close deal.' });
      }
    });

    // Get client handler settings (notification phone and preferences)
    authedApp.get('/api/client-handler/settings', async () => {
      const phone = options.database.getSetting('deal_notification_phone') || '';
      const enabled = options.database.getSetting('deal_notifications_enabled') !== 'false';
      const whatsappStatus = BaileysManager.getInstance(options.database).getStatus();
      return {
        ok: true,
        settings: {
          dealNotificationPhone: phone,
          dealNotificationsEnabled: enabled,
        },
        whatsappReady: whatsappStatus.isReady,
        whatsappState: whatsappStatus.state,
      };
    });

    // Save client handler settings
    authedApp.post('/api/client-handler/settings', async (request, reply) => {
      const parsed = z.object({
        dealNotificationPhone: z.string().trim().max(40),
        dealNotificationsEnabled: z.boolean().optional(),
      }).safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid settings payload.' });
      }

      const rawPhone = parsed.data.dealNotificationPhone;
      let formattedPhone = '';
      if (rawPhone) {
        const cleanDigits = normalizeToInternationalWhatsApp(rawPhone);
        if (cleanDigits.length < 8 || cleanDigits.length > 15) {
          return reply.code(400).send({
            ok: false,
            error: `Invalid WhatsApp number (+${cleanDigits}). Expected 8-15 digits with country code (e.g. +923001234567).`,
          });
        }
        formattedPhone = `+${cleanDigits}`;
      }

      options.database.setSetting('deal_notification_phone', formattedPhone);
      if (parsed.data.dealNotificationsEnabled !== undefined) {
        options.database.setSetting('deal_notifications_enabled', parsed.data.dealNotificationsEnabled ? 'true' : 'false');
      }

      return {
        ok: true,
        message: formattedPhone
          ? `Notification preferences saved. Finalized deal alerts will be dispatched to ${formattedPhone}.`
          : 'Notification preferences saved.',
        settings: {
          dealNotificationPhone: formattedPhone,
          dealNotificationsEnabled: parsed.data.dealNotificationsEnabled !== false,
        },
      };
    });

    // Send test deal notification
    authedApp.post('/api/client-handler/test-notification', async (request, reply) => {
      const parsed = z.object({
        phone: z.string().trim().max(40).optional(),
      }).safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid phone number format.' });
      }

      const inputPhone = parsed.data.phone || options.database.getSetting('deal_notification_phone') || '';
      if (!inputPhone) {
        return reply.code(400).send({
          ok: false,
          error: 'Please enter a WhatsApp phone number with country code (e.g. +923001234567).',
        });
      }

      const cleanDigits = normalizeToInternationalWhatsApp(inputPhone);
      if (cleanDigits.length < 8 || cleanDigits.length > 15) {
        return reply.code(400).send({
          ok: false,
          error: `Invalid WhatsApp number (+${cleanDigits}). Expected 8-15 digits with country code (e.g. +923001234567).`,
        });
      }

      const formattedPhone = `+${cleanDigits}`;
      const baileysMgr = BaileysManager.getInstance(options.database);
      const status = baileysMgr.getStatus();

      if (!status.isReady) {
        return reply.code(400).send({
          ok: false,
          error: 'Unable to send the test message. WhatsApp is disconnected. Please open the WhatsApp connection page and scan the QR code first.',
          connectionStatus: status.state,
        });
      }

      try {
        const testText =
          `🧪 *TEST NOTIFICATION — Client Handler Deal Alert*\n\n` +
          `✅ *Your WhatsApp notification system is active and verified!*\n\n` +
          `Whenever an autonomous deal is finalized or won with a client, you will receive an executive summary here:\n` +
          `• Client Name & Contact Info\n` +
          `• Agreed Services & Deliverables\n` +
          `• Closed Price & Project Timeline\n` +
          `• Complete Conversation Context\n\n` +
          `📅 Verified At: ${new Date().toLocaleString()}\n` +
          `📱 Destination: ${formattedPhone}`;

        const sent = await baileysMgr.sendTextMessage(formattedPhone, testText);

        return {
          ok: true,
          message: `Test WhatsApp message sent successfully to ${formattedPhone}.`,
          sent: {
            providerMessageId: sent.providerMessageId,
            status: sent.status,
            phone: formattedPhone,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (err) {
        const rawErr = err instanceof Error ? err.message : 'Failed to send test notification.';
        const notRegistered = rawErr.toLowerCase().includes('not registered');
        return reply.code(400).send({
          ok: false,
          error: notRegistered
            ? `Unable to send test message: Number ${formattedPhone} is not registered on WhatsApp. Please check your country code and phone number.`
            : `Unable to send test message: ${rawErr}`,
        });
      }
    });
  });
}
