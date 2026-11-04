import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../security/auth.js';
import { cleanEmailHtml, cleanText, normalizePhone, validEmail } from '../security/sanitize.js';
import { Database } from '../db/database.js';
import { RunPipeline } from '../services/runPipeline.js';
import { sendEmail, EmailNotConfiguredError } from '../services/emailService.js';
import { connectSheet } from '../services/googleSheetsSync.js';
import { BaileysManager } from '../services/baileysManager.js';
import { clientHandlerEvents } from '../services/clientHandlerService.js';

const requestSchema = z.object({
  userName: z.string().trim().min(1).max(120),
  company: z.string().trim().max(120).default(''),
  senderType: z.enum(['auto', 'person', 'company']).optional().default('auto'),
  userEmail: z.string().email().max(200),
  userPhone: z.string().max(80).optional().default(''),
  portfolio: z.string().max(500).optional().default(''),
  services: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  niche: z.string().trim().min(2).max(120),
  area: z.string().trim().min(2).max(120),
  country: z.string().trim().min(2).max(120),
  maxLeads: z.number().int().min(1).max(100).default(20),
  checkSocial: z.boolean().default(false),
  emailSummary: z.boolean().default(false),
  sheetId: z.string().optional(),
  sheetTab: z.string().max(100).optional(),
});

const emailSchema = z.object({ to: z.string().email(), subject: z.string().trim().min(1).max(150), html: z.string().max(150_000).optional().default(''), text: z.string().max(150_000).optional().default(''), replyTo: z.string().email().optional() });
const whatsappSchema = z.object({ businessName: z.string().trim().min(1).max(120), number: z.string().trim().min(8).max(40), message: z.string().trim().min(1).max(1500), resend: z.boolean().default(false) });

export interface ApiRouteOptions {
  database: Database;
  pipeline: RunPipeline;
}

export async function apiRoutes(app: FastifyInstance, options: ApiRouteOptions): Promise<void> {
  const { database, pipeline } = options;
  app.addHook('preHandler', authenticate);

  app.get('/api/runs', async () => ({ ok: true, runs: database.listRuns().map((run) => ({ ...run, leads: database.getRunLeads(run.runId) })) }));

  app.get('/api/leads/stats', async () => {
    return { ok: true, stats: database.getStats() };
  });

  const deleteLeadHandler = async (request: any, reply: any) => {
    const leadId = String((request.params as { leadId: string }).leadId);
    const deleted = database.deleteLead(leadId);
    if (!deleted) return reply.code(404).send({ ok: false, error: 'Lead not found.' });
    return { ok: true, leadId, stats: database.getStats() };
  };

  app.delete('/api/leads/:leadId', deleteLeadHandler);
  app.post('/api/leads/:leadId/delete', deleteLeadHandler);

  app.get('/api/services', async () => {
    const PREDEFINED = [
      'Website Development',
      'SEO',
      'Social Media Management',
      'AI Chatbot',
      'WhatsApp Automation',
      'CRM Automation',
      'Google Ads',
      'UGC Video Ads',
      'Branding & Design',
    ];
    return { ok: true, predefined: PREDEFINED, custom: database.listCustomServices() };
  });

  app.post('/api/services', async (request, reply) => {
    const schema = z.object({
      name: z.string().trim().min(2).max(80),
      description: z.string().trim().max(300).optional().default(''),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid service name.' });
    const created = database.createCustomService(parsed.data.name, parsed.data.description);
    return reply.code(201).send({ ok: true, service: created });
  });

  const deleteServiceHandler = async (request: any, reply: any) => {
    const id = String((request.params as { id: string }).id);
    const deleted = database.deleteCustomService(id);
    if (!deleted) return reply.code(404).send({ ok: false, error: 'Custom service not found.' });
    return { ok: true, id };
  };

  app.delete('/api/services/:id', deleteServiceHandler);
  app.post('/api/services/:id/delete', deleteServiceHandler);

  app.post('/api/runs', async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid search request.' });
    const data = { ...parsed.data, company: parsed.data.company.trim() };
    const runId = pipeline.start(data, data.sheetId ? { sheetId: data.sheetId, tab: data.sheetTab || 'Sheet1' } : undefined);
    return reply.code(202).send({ ok: true, runId });
  });

  app.get('/api/runs/:runId', async (request, reply) => {
    const runId = String((request.params as { runId: string }).runId);
    const run = database.getRun(runId);
    if (!run) return reply.code(404).send({ ok: false, error: 'Run not found.' });
    const leads = database.getRunLeads(runId);
    return { ok: true, run: { ...run, leads }, leads };
  });

  const deleteRunHandler = async (request: any, reply: any) => {
    const runId = String((request.params as { runId: string }).runId);
    const deleted = database.deleteRun(runId);
    if (!deleted) return reply.code(404).send({ ok: false, error: 'Saved search not found.' });
    return { ok: true, runId, stats: database.getStats() };
  };

  app.delete('/api/runs/:runId', deleteRunHandler);
  app.post('/api/runs/:runId/delete', deleteRunHandler);

  app.get('/api/runs/:runId/events', async (request, reply) => {
    const params = request.params as { runId: string };
    if (!database.getRun(params.runId)) return reply.code(404).send({ ok: false, error: 'Run not found.' });
    const after = Math.max(0, Number((request.query as { after?: string }).after || 0));
    return { ok: true, events: database.events(params.runId, Number.isFinite(after) ? after : 0), run: database.getRun(params.runId) };
  });

  app.post('/api/integrations/sheets/connect', async (request, reply) => {
    const parsed = z.object({ sheetUrl: z.string().trim().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'A Google Sheet URL is required.' });
    try { return { ok: true, sheet: await connectSheet(parsed.data.sheetUrl) }; } catch (error) { return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : 'Google Sheet could not be connected.' }); }
  });

  app.post('/api/leads/:leadId/email', async (request, reply) => {
    const leadId = String((request.params as { leadId: string }).leadId);
    const lead = database.getLead(leadId);
    if (!lead) return reply.code(404).send({ ok: false, error: 'Lead not found.' });
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success || !validEmail(parsed.data.to)) return reply.code(400).send({ ok: false, error: 'Email details are invalid.' });
    try {
      const result = await sendEmail({ to: parsed.data.to, subject: cleanText(parsed.data.subject, 150), html: cleanEmailHtml(parsed.data.html || `<div>${cleanText(parsed.data.text, 150_000).replace(/\n/g, '<br>')}</div>`), text: parsed.data.text || '', replyTo: parsed.data.replyTo });
      database.recordEmail(leadId, parsed.data.to, parsed.data.subject, result.messageId);
      database.updateLead(leadId, { emailStatus: 'Sent', approvalStatus: 'Sent', emailSentAt: new Date().toISOString(), gmailThreadId: result.messageId, responseStatus: lead.responseStatus === 'No Reply' ? 'No Reply' : lead.responseStatus });
      return { ok: true, sentAt: new Date().toISOString(), providerId: result.messageId };
    } catch (error) {
      if (error instanceof EmailNotConfiguredError) return reply.code(503).send({ ok: false, error: error.message });
      return reply.code(502).send({ ok: false, error: error instanceof Error ? error.message : 'Email could not be sent.' });
    }
  });

  app.post('/api/leads/:leadId/whatsapp', async (request, reply) => {
    const leadId = String((request.params as { leadId: string }).leadId);
    const lead = database.getLead(leadId);
    if (!lead) return reply.code(404).send({ ok: false, error: 'Lead not found.' });
    const parsed = whatsappSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.issues[0]?.message || 'WhatsApp details are invalid.' });
    let number = normalizePhone(parsed.data.number);
    if (number.startsWith('0') && !number.startsWith('00')) {
      const dial = { pakistan: '92', india: '91', usa: '1', 'united states': '1', canada: '1', uk: '44', 'united kingdom': '44' }[lead.country.toLowerCase() as 'pakistan'] || '';
      if (dial) number = `${dial}${number.slice(1)}`;
    }
    if (!/^\d{8,15}$/.test(number)) return reply.code(400).send({ ok: false, error: 'WhatsApp number must contain 8–15 digits including the country code.' });
    const reservation = database.reserveWhatsApp({ leadId, businessName: parsed.data.businessName, number, message: parsed.data.message, resend: parsed.data.resend });
    if (!reservation.ok) return reply.code(409).send({ ok: false, error: reservation.reason, record: reservation.record });
    try {
      const baileys = BaileysManager.getInstance(database);
      const result = await baileys.sendTextMessage(number, parsed.data.message);
      const record = database.updateWhatsApp(leadId, { status: result.status, providerMessageId: result.providerMessageId });
      database.updateLead(leadId, { whatsappStatus: result.status, whatsappRunId: result.providerMessageId });

      // Real-time broadcast to Client Handler SSE stream
      const client = database.getClientConversation(leadId);
      const convMsgs = database.getConversationMessages(leadId);
      const lastMsg = convMsgs[convMsgs.length - 1];
      if (client && lastMsg) {
        clientHandlerEvents.emit('message_sent', {
          leadId,
          message: lastMsg,
          client,
        });
      }

      return { ok: true, record };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WhatsApp could not be sent.';
      const unconfirmed = /unconfirmed|without a trackable/i.test(message);
      const record = database.updateWhatsApp(leadId, { status: unconfirmed ? 'Unconfirmed' : 'Failed', error: message });
      database.updateLead(leadId, { whatsappStatus: unconfirmed ? 'Unconfirmed' : 'Failed' });
      return reply.code(unconfirmed ? 502 : 400).send({ ok: false, error: message, record });
    }
  });

  app.get('/api/leads/:leadId/whatsapp', async (request, reply) => {
    const leadId = String((request.params as { leadId: string }).leadId);
    const record = database.getWhatsApp(leadId);
    return { ok: true, record: record || { status: 'Not sent', leadId } };
  });
}
