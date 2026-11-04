import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Database } from '../db/database.js';
import type {
  ClientConversation,
  ClientHandlerStats,
  ClientStage,
  ConversationMessage,
  DealClosingInfo,
  Lead,
  ProjectPlanDetails,
  WhatsAppStatus,
} from '../types/domain.js';
import { ConversationEngine, isOptOutMessage } from './conversationEngine.js';
import { BaileysManager, type IncomingBaileysMessage, normalizeToInternationalWhatsApp } from './baileysManager.js';

export const clientHandlerEvents = new EventEmitter();
clientHandlerEvents.setMaxListeners(100);

export function buildDealSummaryNotification(info: {
  businessName: string;
  phone: string;
  agreedServices: string[];
  agreedPrice: string;
  agreedTimeline: string;
  agreedDeliverables: string;
  identifiedRequirements?: string[];
  notes?: string;
}): string {
  const servicesStr = info.agreedServices.length > 0 ? info.agreedServices.join(', ') : 'Custom Business Solutions';
  const reqsStr =
    info.identifiedRequirements && info.identifiedRequirements.length > 0
      ? `\n📋 Identified Requirements:\n${info.identifiedRequirements.map((r) => `• ${r}`).join('\n')}\n`
      : '';

  return (
    `🎉 DEAL CLOSED - CLIENT HANDLER REPORT 🎉\n\n` +
    `🏢 Business: ${info.businessName}\n` +
    `📞 Phone: ${info.phone}\n` +
    `🛠 Services Agreed: ${servicesStr}\n` +
    `💰 Final Price: ${info.agreedPrice || 'Agreed as discussed'}\n` +
    `⏱ Timeline: ${info.agreedTimeline || '1-2 weeks'}\n` +
    `📦 Key Deliverables: ${info.agreedDeliverables || 'Comprehensive implementation and setup'}\n` +
    reqsStr +
    (info.notes ? `📝 Deal Notes: ${info.notes}\n\n` : '\n') +
    `🚀 Next Steps: Initiate project onboarding, schedule kick-off, and review client requirements.\n\n` +
    `✨ Handled autonomously by WhatsApp Client Handler.`
  );
}

export class ClientHandlerService {
  readonly engine: ConversationEngine;

  constructor(private readonly db: Database) {
    this.engine = new ConversationEngine(db);
  }

  /**
   * Retrieves all client conversations with search and filter
   */
  listClients(stage?: string, search?: string): ClientConversation[] {
    return this.db.listClientConversations(stage, search);
  }

  /**
   * Retrieves single client with conversation history
   */
  getClient(leadId: string): ClientConversation {
    const conv = this.db.getClientConversation(leadId);
    if (!conv) throw new Error(`Client conversation for lead ${leadId} not found.`);
    return conv;
  }

  /**
   * Sends an outbound message to a client (user manual or AI approved)
   */
  async sendMessage(
    leadId: string,
    text: string,
    sender: 'assistant' | 'user' = 'user',
    metadata?: Record<string, unknown>
  ): Promise<ConversationMessage> {
    const lead = this.db.getLead(leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found.`);
    if (!lead.phone) throw new Error(`Lead ${lead.businessName} has no phone number on file.`);

    const conv = this.db.getClientConversation(leadId);
    if (conv?.optedOut) {
      throw new Error(`Cannot send message: ${lead.businessName} has opted out of communication.`);
    }

    const cleanText = text.trim();
    if (!cleanText) throw new Error('Message text cannot be empty.');

    const msgId = `msg_${Date.now()}_${randomUUID().slice(0, 8)}`;
    let providerMessageId = '';
    let status: WhatsAppStatus = 'Sent';

    try {
      const baileys = BaileysManager.getInstance(this.db);
      if (baileys.getStatus().isReady) {
        const sent = await baileys.sendTextMessage(lead.phone, cleanText);
        providerMessageId = sent.providerMessageId;
        status = sent.status;
      } else if (process.env.NODE_ENV === 'test') {
        providerMessageId = `sim_${Date.now()}`;
        status = 'Sent';
      } else {
        throw new Error('WhatsApp is not connected. Open the WhatsApp page and scan the QR code to connect.');
      }
    } catch (err) {
      if (process.env.NODE_ENV === 'test') {
        providerMessageId = `sim_${Date.now()}`;
        status = 'Sent';
      } else {
        throw err;
      }
    }

    const message: ConversationMessage = {
      id: msgId,
      leadId,
      sender,
      text: cleanText,
      timestamp: new Date().toISOString(),
      status,
      providerMessageId,
      metadata,
    };

    this.db.addConversationMessage(message);

    // Update conversation record stage to awaiting_reply
    const nextStage: ClientStage = conv?.stage === 'new' ? 'contacted' : conv?.stage === 'closed_won' ? 'closed_won' : 'awaiting_reply';
    const updatedConv = this.db.upsertClientConversation(leadId, {
      stage: nextStage,
      lastMessageAt: message.timestamp,
    });

    clientHandlerEvents.emit('message_sent', {
      leadId,
      message,
      client: updatedConv,
    });

    return message;
  }

  /**
   * Generates and optionally sends the first outreach message
   */
  async sendFirstMessage(leadId: string, autoSend = false): Promise<{ messageText: string; sentMessage?: ConversationMessage }> {
    const text = await this.engine.generateFirstMessage(leadId);
    if (autoSend) {
      const sent = await this.sendMessage(leadId, text, 'assistant', { type: 'first_outreach' });
      return { messageText: text, sentMessage: sent };
    }
    return { messageText: text };
  }

  /**
   * Generates an AI reply draft without automatically dispatching it
   */
  async generateReplyDraft(leadId: string, userGuidance?: string) {
    return this.engine.generateReply(leadId, userGuidance);
  }

  /**
   * Toggles auto-pilot mode for a specific client
   */
  toggleAutoPilot(leadId: string, enabled: boolean): ClientConversation {
    const updated = this.db.upsertClientConversation(leadId, { autoPilot: enabled });
    clientHandlerEvents.emit('conversation_updated', { leadId, client: updated });
    return updated;
  }

  /**
   * Updates stage or notes for a client
   */
  updateStage(leadId: string, stage: ClientStage, dealNotes?: string): ClientConversation {
    const updated = this.db.upsertClientConversation(leadId, {
      stage,
      ...(dealNotes !== undefined ? { dealNotes } : {}),
      ...(stage !== 'needs_human' ? { humanInterventionReason: '' } : {}),
    });
    clientHandlerEvents.emit('conversation_updated', { leadId, client: updated });
    return updated;
  }

  /**
   * Links an unmatched inbound WhatsApp contact to an existing lead
   */
  linkUnmatchedLead(unmatchedLeadId: string, targetLeadId: string): ClientConversation {
    const updated = this.db.linkUnmatchedLeadToExisting(unmatchedLeadId, targetLeadId);
    clientHandlerEvents.emit('conversation_updated', {
      leadId: targetLeadId,
      unmatchedLeadId,
      client: updated,
    });
    return updated;
  }

  /**
   * Handles incoming WhatsApp webhook events (Baileys & WAHA) with deduplication,
   * LID-to-Phone resolution, unmatched contact creation, and two-way AI auto-pilot.
   */
  async handleIncomingWebhook(payload: Record<string, unknown>): Promise<{
    handled: boolean;
    reason?: string;
    leadId?: string;
    autoReplied?: boolean;
    replyMessage?: string;
    unmatchedContact?: boolean;
  }> {
    const rawId = typeof payload.id === 'string' ? payload.id : String((payload.id as any)?._serialized || (payload._data as any)?.id || '');
    const messageId = rawId || (payload.messageId as string) || '';

    // Step 1: Check webhook deduplication BEFORE processing, but only mark processed AFTER saving
    if (messageId && this.db.isWebhookProcessed(messageId)) {
      return { handled: true, reason: 'Duplicate webhook message ignored.' };
    }

    const fromRaw =
      typeof payload.from === 'string'
        ? payload.from
        : String((payload._data as any)?.from || (payload as any)?.rawJid || '');
    const rawJid = typeof payload.rawJid === 'string' ? payload.rawJid : fromRaw;
    const pushName = typeof payload.pushName === 'string' ? payload.pushName : '';
    const messageType = typeof payload.messageType === 'string' ? payload.messageType : 'text';
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : undefined;
    const isHistoryAppend = payload.isHistoryAppend === true;
    const msgTimestamp =
      typeof payload.timestamp === 'string' && payload.timestamp
        ? payload.timestamp
        : new Date().toISOString();

    const text =
      typeof payload.body === 'string'
        ? payload.body.trim()
        : typeof (payload as any)?.text === 'string'
        ? ((payload as any).text as string).trim()
        : '';

    // Step 2: Handle outbound messages from self (e.g. sent from user's WhatsApp mobile app)
    const fromMe = payload.fromMe === true || (payload._data as any)?.fromMe === true;
    if (fromMe) {
      if (payload.source === 'baileys' && fromRaw && text) {
        const matchedLead =
          this.db.findLeadByPhone(fromRaw) || (rawJid ? this.db.findLeadByPhone(rawJid) : null);
        if (matchedLead) {
          const existingMsgs = this.db.getConversationMessages(matchedLead.leadId);
          const alreadySaved = messageId && existingMsgs.some((m) => m.providerMessageId === messageId);
          if (!alreadySaved) {
            const selfMsg: ConversationMessage = {
              id: `out_phone_${Date.now()}_${randomUUID().slice(0, 8)}`,
              leadId: matchedLead.leadId,
              sender: 'user',
              text,
              timestamp: msgTimestamp,
              status: 'Sent',
              providerMessageId: messageId,
              metadata: {
                source: 'whatsapp_mobile_device',
                rawJid,
                messageType,
                ...(attachments ? { attachments } : {}),
              },
            };
            this.db.addConversationMessage(selfMsg);
            if (messageId) this.db.markWebhookProcessed(messageId);
            const updatedConv = this.db.getClientConversation(matchedLead.leadId);
            clientHandlerEvents.emit('message_sent', {
              leadId: matchedLead.leadId,
              message: selfMsg,
              client: updatedConv,
            });
            return {
              handled: true,
              leadId: matchedLead.leadId,
              autoReplied: false,
              reason: 'Synced outbound message sent from WhatsApp phone.',
            };
          }
        }
      }
      if (messageId) this.db.markWebhookProcessed(messageId);
      return { handled: true, reason: 'Outbound message from self ignored.' };
    }

    if (!fromRaw || !text) {
      return { handled: false, reason: 'Missing sender phone or message body.' };
    }

    // Step 3: Match phone or JID to existing lead; if no match exists, create an Unmatched Inbound WhatsApp Lead so no message is ever lost
    let lead =
      this.db.findLeadByPhone(fromRaw) || (rawJid ? this.db.findLeadByPhone(rawJid) : null);
    let unmatchedContact = false;

    if (!lead) {
      lead = this.db.getOrCreateUnmatchedWhatsAppLead({
        phone: fromRaw,
        rawJid: rawJid || fromRaw,
        pushName,
      });
      unmatchedContact = true;
    }

    const leadId = lead.leadId;
    const incomingMsg: ConversationMessage = {
      id: `in_${Date.now()}_${randomUUID().slice(0, 8)}`,
      leadId,
      sender: 'client',
      text,
      timestamp: msgTimestamp,
      status: 'Read',
      providerMessageId: messageId,
      metadata: {
        rawJid,
        resolvedPhone: fromRaw,
        ...(pushName ? { pushName } : {}),
        messageType,
        ...(attachments ? { attachments } : {}),
        ...(unmatchedContact ? { unmatchedContact: true } : {}),
      },
    };

    // Save incoming message and mark webhook processed atomically
    this.db.addConversationMessage(incomingMsg);
    if (messageId) {
      this.db.markWebhookProcessed(messageId);
    }

    clientHandlerEvents.emit('message_received', {
      leadId,
      message: incomingMsg,
      client: this.db.getClientConversation(leadId),
    });

    // Step 4: Check Opt-Out
    if (isOptOutMessage(text)) {
      const updatedOptOut = this.db.upsertClientConversation(leadId, {
        stage: 'opted_out',
        optedOut: true,
        summary: 'Client opted out of communications.',
        lastMessageAt: incomingMsg.timestamp,
      });
      clientHandlerEvents.emit('conversation_updated', { leadId, client: updatedOptOut });
      return { handled: true, leadId, reason: 'Client opted out.', unmatchedContact };
    }

    // Step 5: Check if this message was already answered in conversation or is ancient
    const msgAgeMs = Date.now() - new Date(msgTimestamp).getTime();
    if (msgAgeMs > 30 * 24 * 60 * 60 * 1000) {
      const updatedHistory = this.db.upsertClientConversation(leadId, {
        stage: 'conversing',
        lastMessageAt: incomingMsg.timestamp,
      });
      clientHandlerEvents.emit('conversation_updated', { leadId, client: updatedHistory });
      return {
        handled: true,
        leadId,
        autoReplied: false,
        unmatchedContact,
        reason: 'Ancient message older than 30 days synced without auto-reply.',
      };
    }

    const convMsgs = this.db.getConversationMessages(leadId);
    const hasSubsequentReply = convMsgs.some(
      (m) =>
        (m.sender === 'assistant' || m.sender === 'user') &&
        new Date(m.timestamp).getTime() >= new Date(msgTimestamp).getTime()
    );
    if (hasSubsequentReply) {
      const updatedHistory = this.db.upsertClientConversation(leadId, {
        stage: 'conversing',
        lastMessageAt: incomingMsg.timestamp,
      });
      clientHandlerEvents.emit('conversation_updated', { leadId, client: updatedHistory });
      return {
        handled: true,
        leadId,
        autoReplied: false,
        unmatchedContact,
        reason: 'Historical message already has a subsequent response in thread.',
      };
    }

    // Step 6: Check Auto-Pilot
    const conv = this.db.getClientConversation(leadId);
    if (!conv?.autoPilot) {
      const updatedManual = this.db.upsertClientConversation(leadId, {
        stage: 'conversing',
        lastMessageAt: incomingMsg.timestamp,
      });
      clientHandlerEvents.emit('conversation_updated', { leadId, client: updatedManual });
      return {
        handled: true,
        leadId,
        autoReplied: false,
        unmatchedContact,
        reason: 'Auto-pilot disabled; conversation updated for human reply.',
      };
    }

    // Step 7: Generate AI Reply & Dispatch safely
    try {
      const aiResult = await this.engine.generateReply(leadId);

      // If human intervention is required, pause and escalate
      if (aiResult.needsHumanIntervention) {
        const updatedHuman = this.db.upsertClientConversation(leadId, {
          stage: 'needs_human',
          humanInterventionReason:
            aiResult.humanInterventionReason || 'AI flagged request requiring human authorization.',
          identifiedRequirements: aiResult.identifiedRequirements || conv.identifiedRequirements,
          summary: aiResult.summaryUpdate || conv.summary,
          lastMessageAt: incomingMsg.timestamp,
        });
        clientHandlerEvents.emit('conversation_updated', { leadId, client: updatedHuman });
        return {
          handled: true,
          leadId,
          autoReplied: false,
          unmatchedContact,
          reason: 'Flagged for human intervention.',
        };
      }

      // If deal closure agreed via AI
      if (aiResult.dealAgreed && aiResult.suggestedTerms) {
        await this.sendMessage(leadId, aiResult.replyText, 'assistant', { type: 'deal_closing' });
        const now = new Date().toISOString();
        const updatedConv = this.db.upsertClientConversation(leadId, {
          stage: 'closed_won',
          agreedServices: aiResult.suggestedTerms.services || lead.recommendedServices,
          agreedPrice: aiResult.suggestedTerms.price || lead.estimatedDealValue || '',
          agreedTimeline: aiResult.suggestedTerms.timeline || '1-2 weeks',
          agreedDeliverables: aiResult.suggestedTerms.deliverables || '',
          identifiedRequirements: aiResult.identifiedRequirements || conv.identifiedRequirements,
          projectPlan: aiResult.projectPlan || conv.projectPlan,
          aiHandled: true,
          lastAiAction: 'Deal closed via auto-pilot',
          nextRecommendedAction: aiResult.nextRecommendedAction || 'Onboard client & review project brief',
          closedAt: now,
          summary: aiResult.summaryUpdate || 'Deal agreed and closed via automated conversation.',
          lastMessageAt: now,
        });

        // Automatically send owner notification
        await this.sendDealClosingNotificationToUser(leadId, {
          leadId,
          businessName: lead.businessName,
          agreedServices: updatedConv.agreedServices,
          agreedPrice: updatedConv.agreedPrice,
          agreedTimeline: updatedConv.agreedTimeline,
          agreedDeliverables: updatedConv.agreedDeliverables,
          dealNotes: updatedConv.dealNotes,
          notifyUserWhatsApp: true,
        });

        clientHandlerEvents.emit('conversation_updated', {
          leadId,
          client: this.db.getClientConversation(leadId),
        });

        return {
          handled: true,
          leadId,
          autoReplied: true,
          unmatchedContact,
          replyMessage: aiResult.replyText,
        };
      }

      // Normal automatic response
      const sent = await this.sendMessage(leadId, aiResult.replyText, 'assistant', {
        stageDetected: aiResult.detectedStage,
        repliedToMessageId: incomingMsg.id,
        repliedToProviderId: messageId,
      });

      this.db.updateConversationMessageMetadata(incomingMsg.id, {
        answered: true,
        answeredAt: new Date().toISOString(),
        replyMessageId: sent.id,
      });

      const updatedNormal = this.db.upsertClientConversation(leadId, {
        stage: aiResult.detectedStage,
        summary: aiResult.summaryUpdate || conv.summary,
        identifiedRequirements: aiResult.identifiedRequirements || conv.identifiedRequirements,
        projectPlan: aiResult.projectPlan || conv.projectPlan,
        aiHandled: true,
        lastAiAction: `Replied: ${aiResult.replyText.slice(0, 60)}...`,
        nextRecommendedAction: aiResult.nextRecommendedAction || '',
        lastMessageAt: sent.timestamp,
      });

      clientHandlerEvents.emit('conversation_updated', { leadId, client: updatedNormal });

      return {
        handled: true,
        leadId,
        autoReplied: true,
        unmatchedContact,
        replyMessage: aiResult.replyText,
      };
    } catch (err) {
      // Even if sending the AI reply fails (e.g. WhatsApp temporarily disconnected),
      // keep the incoming message saved and update the conversation state for retry/visibility.
      const errMsg = err instanceof Error ? err.message : String(err);
      const updatedErr = this.db.upsertClientConversation(leadId, {
        stage: 'conversing',
        lastAiAction: `AI reply pending (WhatsApp send error: ${errMsg.slice(0, 80)})`,
        lastMessageAt: incomingMsg.timestamp,
      });
      clientHandlerEvents.emit('conversation_updated', { leadId, client: updatedErr });
      return {
        handled: true,
        leadId,
        autoReplied: false,
        unmatchedContact,
        reason: `Incoming message saved; auto-reply deferred: ${errMsg}`,
      };
    }
  }

  /**
   * Directly handles incoming WhatsApp messages dispatched from Baileys
   */
  async handleIncomingWhatsAppMessage(msg: IncomingBaileysMessage): Promise<{
    handled: boolean;
    reason?: string;
    leadId?: string;
    autoReplied?: boolean;
    replyMessage?: string;
    unmatchedContact?: boolean;
  }> {
    return this.handleIncomingWebhook({
      id: msg.id,
      from: msg.from,
      rawJid: msg.rawJid || msg.from,
      pushName: msg.pushName,
      body: msg.text,
      fromMe: Boolean(msg.fromMe),
      timestamp: msg.timestamp,
      messageType: msg.messageType,
      attachments: msg.attachments,
      isHistoryAppend: msg.isHistoryAppend,
      source: 'baileys',
    });
  }

  /**
   * Sends structured Deal Closed notification to configured owner phone
   */
  async sendDealClosingNotificationToUser(
    leadId: string,
    dealInfo: DealClosingInfo
  ): Promise<{ sent: boolean; error?: string }> {
    const lead = this.db.getLead(leadId);
    const conv = this.db.getClientConversation(leadId);

    const ownerPhone =
      dealInfo.userPhoneNumber ||
      conv?.dealNotificationPhone ||
      this.db.getSetting('deal_notification_phone') ||
      '';

    if (!ownerPhone) {
      return { sent: false, error: 'No owner WhatsApp notification phone number configured in settings.' };
    }

    const cleanOwnerPhone = normalizeToInternationalWhatsApp(ownerPhone);
    const notifText = buildDealSummaryNotification({
      businessName: dealInfo.businessName || lead?.businessName || 'Valued Client',
      phone: lead?.phone || '',
      agreedServices: dealInfo.agreedServices || conv?.agreedServices || lead?.recommendedServices || [],
      agreedPrice: dealInfo.agreedPrice || conv?.agreedPrice || lead?.estimatedDealValue || '',
      agreedTimeline: dealInfo.agreedTimeline || conv?.agreedTimeline || '1-2 weeks',
      agreedDeliverables: dealInfo.agreedDeliverables || conv?.agreedDeliverables || 'Comprehensive service setup',
      identifiedRequirements: conv?.identifiedRequirements,
      notes: dealInfo.dealNotes || conv?.dealNotes,
    });

    try {
      const baileys = BaileysManager.getInstance(this.db);
      if (baileys.getStatus().isReady) {
        await baileys.sendTextMessage(cleanOwnerPhone, notifText);
      }
      const now = new Date().toISOString();
      this.db.upsertClientConversation(leadId, {
        closingNotifiedAt: now,
        dealNotificationPhone: cleanOwnerPhone,
        dealNotificationStatus: 'sent',
        dealNotificationText: notifText,
        dealNotificationError: '',
      });
      return { sent: true };
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.db.upsertClientConversation(leadId, {
        dealNotificationPhone: cleanOwnerPhone,
        dealNotificationStatus: 'failed',
        dealNotificationText: notifText,
        dealNotificationError: errorMsg,
      });
      return { sent: false, error: errorMsg };
    }
  }

  /**
   * Finalizes deal, logs agreed deliverables, and triggers notification
   */
  async closeDeal(leadId: string, dealInfo: DealClosingInfo): Promise<ClientConversation> {
    const lead = this.db.getLead(leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found.`);

    const conv = this.db.getClientConversation(leadId);
    if (!conv) throw new Error(`Conversation ${leadId} not found.`);

    const now = new Date().toISOString();
    const updated = this.db.upsertClientConversation(leadId, {
      stage: 'closed_won',
      agreedServices: dealInfo.agreedServices || lead.recommendedServices,
      agreedPrice: dealInfo.agreedPrice || lead.estimatedDealValue || '',
      agreedTimeline: dealInfo.agreedTimeline || '2 weeks',
      agreedDeliverables: dealInfo.agreedDeliverables || 'Full service implementation',
      dealNotes: dealInfo.dealNotes || conv.dealNotes || '',
      closedAt: conv.closedAt || now,
    });

    // Send Deal-Closed Notification if requested
    if (dealInfo.notifyUserWhatsApp) {
      await this.sendDealClosingNotificationToUser(leadId, dealInfo);
    }

    return this.db.getClientConversation(leadId)!;
  }

  /**
   * Aggregates stats for dashboard
   */
  getStats(): ClientHandlerStats {
    return this.db.getClientHandlerStats();
  }

  /**
   * Retrieves all currently pending unreplied messages across active client conversations
   */
  getMissedMessages(): Array<{ client: ClientConversation; messages: ConversationMessage[] }> {
    const clients = this.listClients();
    const missed: Array<{ client: ClientConversation; messages: ConversationMessage[] }> = [];
    for (const client of clients) {
      if (!client.autoPilot || client.optedOut) continue;
      if (client.stage === 'opted_out' || client.stage === 'needs_human') continue;

      const unreplied = this.db.getUnrepliedClientMessages(client.leadId);
      if (unreplied.length > 0) {
        missed.push({ client, messages: unreplied });
      }
    }
    return missed;
  }

  /**
   * Automatically checks for any WhatsApp messages received while offline or unreplied,
   * reads them, retrieves previous conversation context and client data, and generates
   * and sends an appropriate AI reply in chronological order, with duplicate protection.
   */
  async checkAndProcessMissedMessages(options?: {
    offlineSince?: string;
  }): Promise<{
    checkedConversations: number;
    missedMessagesFound: number;
    repliesSent: number;
    details: Array<{
      leadId: string;
      businessName: string;
      phone: string;
      incomingMessageId: string;
      incomingText: string;
      replyText: string;
    }>;
  }> {
    const clients = this.listClients();
    const result = {
      checkedConversations: clients.length,
      missedMessagesFound: 0,
      repliesSent: 0,
      details: [] as Array<{
        leadId: string;
        businessName: string;
        phone: string;
        incomingMessageId: string;
        incomingText: string;
        replyText: string;
      }>,
    };

    const allPending: Array<{ client: ClientConversation; msg: ConversationMessage }> = [];
    for (const client of clients) {
      if (!client.autoPilot || client.optedOut) continue;
      if (client.stage === 'opted_out' || client.stage === 'needs_human') continue;

      const unreplied = this.db.getUnrepliedClientMessages(client.leadId);
      if (!unreplied || unreplied.length === 0) continue;

      for (const msg of unreplied) {
        allPending.push({ client, msg });
      }
    }

    // Sort all missed messages chronologically across clients so they are processed in exact historical sequence
    allPending.sort((a, b) => new Date(a.msg.timestamp).getTime() - new Date(b.msg.timestamp).getTime());

    for (const { client, msg } of allPending) {
      result.missedMessagesFound++;

      if (isOptOutMessage(msg.text)) {
        this.updateStage(client.leadId, 'opted_out');
        this.db.updateConversationMessageMetadata(msg.id, { answered: true });
        if (msg.providerMessageId) this.db.markWebhookProcessed(msg.providerMessageId);
        continue;
      }

        try {
          const aiResult = await this.engine.generateReply(client.leadId, undefined, msg.id);

          if (aiResult.needsHumanIntervention) {
            this.db.upsertClientConversation(client.leadId, {
              stage: 'needs_human',
              humanInterventionReason:
                aiResult.humanInterventionReason || 'AI flagged request requiring human authorization.',
              lastMessageAt: msg.timestamp,
            });
            this.db.updateConversationMessageMetadata(msg.id, {
              answered: true,
              flaggedHuman: true,
            });
            if (msg.providerMessageId) this.db.markWebhookProcessed(msg.providerMessageId);
            continue;
          }

          // Send AI reply with reference to the missed message
          const sent = await this.sendMessage(client.leadId, aiResult.replyText, 'assistant', {
            repliedToMessageId: msg.id,
            repliedToProviderId: msg.providerMessageId,
            type: 'offline_catchup_reply',
          });

          // Mark client message as answered in SQLite so it can never be answered again
          this.db.updateConversationMessageMetadata(msg.id, {
            answered: true,
            answeredAt: new Date().toISOString(),
            replyMessageId: sent.id,
          });
          if (msg.providerMessageId) {
            this.db.markWebhookProcessed(msg.providerMessageId);
          }

          const currentConv = this.db.getClientConversation(client.leadId);
          const nextStage = aiResult.detectedStage || 'conversing';
          this.db.upsertClientConversation(client.leadId, {
            stage: nextStage,
            summary: aiResult.summaryUpdate || currentConv?.summary || client.summary,
            identifiedRequirements:
              aiResult.identifiedRequirements || currentConv?.identifiedRequirements || client.identifiedRequirements,
            projectPlan: aiResult.projectPlan || currentConv?.projectPlan || client.projectPlan,
            aiHandled: true,
            lastAiAction: `Replied to missed message: ${aiResult.replyText.slice(0, 60)}...`,
            nextRecommendedAction: aiResult.nextRecommendedAction || '',
            lastMessageAt: sent.timestamp,
          });

          result.repliesSent++;
          result.details.push({
            leadId: client.leadId,
            businessName: client.businessName || '',
            phone: client.phone || '',
            incomingMessageId: msg.id,
            incomingText: msg.text,
            replyText: aiResult.replyText,
          });
        } catch (err) {
          console.warn(`[ClientHandler] Could not send reply to missed message ${msg.id}:`, err);
        }
      }

    return result;
  }
}
