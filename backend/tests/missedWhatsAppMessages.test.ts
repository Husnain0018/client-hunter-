import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../src/db/database.js';
import { BaileysManager } from '../src/services/baileysManager.js';
import { ClientHandlerService } from '../src/services/clientHandlerService.js';
import { buildApp } from '../src/server.js';
import { issueToken } from '../src/security/auth.js';
import type { Lead } from '../src/types/domain.js';

describe('Offline WhatsApp Message Detection & Processing Suite', () => {
  let db: Database;
  let service: ClientHandlerService;
  let baileys: BaileysManager;

  const dentalLead: Lead = {
    runId: 'run-offline-test',
    leadId: 'lead-dental-offline-1',
    businessName: 'Pearl Dental Surgery',
    category: 'Dental Clinic',
    leadType: 'Has Website',
    contactChannel: 'Email + Phone',
    website: 'https://pearldental.example',
    email: 'info@pearldental.example',
    phone: '+923001112233',
    whatsappLink: 'https://wa.me/923001112233',
    address: 'Faisal Town, Lahore',
    country: 'Pakistan',
    googleRating: 4.8,
    googleReviews: 42,
    locationStatus: 'Verified',
    leadScore: 88,
    priority: 'high',
    estimatedDealValue: '$600 - $900',
    recommendedServices: ['WhatsApp Automation', 'Website Development'],
    weaknesses: ['No after-hours appointment scheduling'],
    analysisSummary: 'Active local dental surgery needing automated booking.',
    strategy: {
      overview: 'Capture missed after-hours patient queries via WhatsApp.',
      problems: [
        {
          type: 'confirmed',
          category: 'booking',
          title: 'Missing after-hours booking',
          detail: 'Patients calling after 8pm cannot schedule appointments.',
        },
      ],
      businessImpact: ['Losing patient inquiries after clinic hours'],
      relevantServices: ['WhatsApp Automation'],
      solutions: [
        {
          service: 'WhatsApp Automation',
          howItWorks: 'Instant 24/7 automated appointment booking bot.',
          impact: 'Recovers lost patient bookings.',
          estimatedTimeline: '1-2 weeks',
        },
      ],
      conversationGuidance: {
        icebreaker: "Hi Pearl Dental team, reaching out from Unitech Solution.",
        discoveryQuestions: ['How do you handle patient inquiries after 8 PM?'],
        objectionHandling: ['We offer a 14-day test trial.'],
      },
      nextSteps: ['Schedule a quick demo.'],
    },
    websiteScore: 65,
    websiteStatus: 'Good',
    websiteIssues: [],
    websiteImages: [],
    techStack: ['WordPress'],
    social: {},
    socialActivity: {},
    socialStatus: '',
    competitors: [],
    emailSubject: '',
    emailBodyText: '',
    emailBodyHtml: '',
    whatsappMessage: 'Hi Pearl Dental team, we can automate your patient booking on WhatsApp.',
    approvalStatus: 'Pending Review',
    emailStatus: 'Draft',
    responseStatus: 'No Reply',
    senderName: 'Unitech Solution',
    searchQuery: 'dental clinics in faisal town',
    createdAt: new Date().toISOString(),
    emailSentAt: '',
    followUp1Date: '',
    followUp2Date: '',
    gmailThreadId: '',
  };

  const legalLead: Lead = {
    runId: 'run-offline-test',
    leadId: 'lead-legal-offline-2',
    businessName: 'Apex Legal Advocates',
    category: 'Law Firm',
    leadType: 'Has Website',
    contactChannel: 'Phone Only',
    website: 'https://apexlegal.example',
    email: '',
    phone: '+923214445566',
    whatsappLink: 'https://wa.me/923214445566',
    address: 'Mall Road, Lahore',
    country: 'Pakistan',
    googleRating: 4.6,
    googleReviews: 28,
    locationStatus: 'Verified',
    leadScore: 80,
    priority: 'high',
    estimatedDealValue: '$700 - $1200',
    recommendedServices: ['Website Development', 'SEO'],
    weaknesses: ['Outdated non-responsive website'],
    analysisSummary: 'Law firm needing modern web presence and search ranking.',
    strategy: {
      overview: 'Build high-converting mobile site and rank on Google local pack.',
      problems: [
        {
          type: 'confirmed',
          category: 'website',
          title: 'Non-responsive mobile design',
          detail: 'Pages break on smartphones.',
        },
      ],
      businessImpact: ['Losing high-value corporate clients'],
      relevantServices: ['Website Development', 'SEO'],
      solutions: [],
      conversationGuidance: { icebreaker: '', discoveryQuestions: [], objectionHandling: [] },
      nextSteps: [],
    },
    websiteScore: 40,
    websiteStatus: 'Needs Improvement',
    websiteIssues: ['Slow mobile loading'],
    websiteImages: [],
    techStack: [],
    social: {},
    socialActivity: {},
    socialStatus: '',
    competitors: [],
    emailSubject: '',
    emailBodyText: '',
    emailBodyHtml: '',
    whatsappMessage: 'Hi Apex Legal team, we can upgrade your website to modern responsive standards.',
    approvalStatus: 'Pending Review',
    emailStatus: 'Draft',
    responseStatus: 'No Reply',
    senderName: 'Unitech Solution',
    searchQuery: 'law firms in lahore',
    createdAt: new Date().toISOString(),
    emailSentAt: '',
    followUp1Date: '',
    followUp2Date: '',
    gmailThreadId: '',
  };

  beforeEach(() => {
    db = new Database(':memory:');
    service = new ClientHandlerService(db);
    baileys = new BaileysManager(db);

    baileys.setMessageHandler(async (msg) => {
      await service.handleIncomingWhatsAppMessage(msg);
    });

    db.createRun(
      'run-offline-test',
      {
        userName: 'Unitech Solution',
        company: 'Unitech Solution',
        userEmail: 'ali@example.com',
        userPhone: '+923000000000',
        portfolio: '',
        services: ['WhatsApp Automation', 'Website Development'],
        niche: 'Dental Clinic',
        area: 'Faisal Town',
        country: 'Pakistan',
        maxLeads: 10,
        checkSocial: false,
        emailSummary: false,
      },
      new Date().toISOString()
    );

    db.saveLead(dentalLead);
    db.saveLead(legalLead);
  });

  afterAll(() => {
    try {
      db.close();
    } catch {}
  });

  it('Scenario 1: Sends and receives WhatsApp messages normally while project is running', async () => {
    // Lead is initially contacted
    await service.sendMessage(dentalLead.leadId, dentalLead.whatsappMessage, 'assistant', { type: 'outreach' });
    const initialConv = service.getClient(dentalLead.leadId);
    expect(['contacted', 'awaiting_reply']).toContain(initialConv.stage);

    // Client sends an incoming message while the project is running
    const incomingResult = await service.handleIncomingWhatsAppMessage({
      id: 'live_msg_001',
      from: '923001112233',
      rawJid: '923001112233@s.whatsapp.net',
      text: 'Hi, what problems did you find on our clinic profile?',
      timestamp: new Date().toISOString(),
    });

    expect(incomingResult.handled).toBe(true);
    expect(incomingResult.leadId).toBe(dentalLead.leadId);
    expect(incomingResult.autoReplied).toBe(true);
    expect(incomingResult.replyMessage).toBeDefined();

    const messages = db.getConversationMessages(dentalLead.leadId);
    expect(messages.length).toBe(3); // Outreach + Client Inquiry + Assistant Reply
    expect(messages[1].sender).toBe('client');
    expect(messages[1].text).toContain('what problems did you find');
    expect(messages[2].sender).toBe('assistant');

    // Conversation moves to conversing / interested stage
    const updatedConv = service.getClient(dentalLead.leadId);
    expect(['conversing', 'interested']).toContain(updatedConv.stage);
  });

  it('Scenario 2 & 3: Detects and processes multiple missed WhatsApp messages after project was offline', async () => {
    // 1. Initial outreach sent while system was running (50 mins ago)
    const outreachTime = new Date(Date.now() - 50 * 60 * 1000).toISOString();
    db.addConversationMessage({
      id: 'outreach_dental_0',
      leadId: dentalLead.leadId,
      sender: 'assistant',
      text: dentalLead.whatsappMessage,
      status: 'Sent',
      timestamp: outreachTime,
    });
    db.addConversationMessage({
      id: 'outreach_legal_0',
      leadId: legalLead.leadId,
      sender: 'assistant',
      text: legalLead.whatsappMessage,
      status: 'Sent',
      timestamp: outreachTime,
    });

    // 2. Project goes OFFLINE (simulate server stopping at 10:00:00, 30 mins ago)
    const offlineTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    db.setLastActiveTimestamp(offlineTime);
    expect(db.getLastActiveTimestamp()).toBe(offlineTime);

    // 3. While offline, multiple clients send messages:
    // Pearl Dental sends Message 1 at 10:10 (20 mins ago)
    const offlineMsg1Timestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    db.addConversationMessage({
      id: 'offline_msg_dental_1',
      leadId: dentalLead.leadId,
      sender: 'client',
      text: 'Hello, how does your appointment booking automation work?',
      status: 'Read',
      providerMessageId: 'prov_offline_dental_1',
      timestamp: offlineMsg1Timestamp,
    });

    // Pearl Dental sends Message 2 at 10:15 (15 mins ago) asking about cost
    const offlineMsg2Timestamp = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    db.addConversationMessage({
      id: 'offline_msg_dental_2',
      leadId: dentalLead.leadId,
      sender: 'client',
      text: 'And what is the estimated cost and timeline for setting this up?',
      status: 'Read',
      providerMessageId: 'prov_offline_dental_2',
      timestamp: offlineMsg2Timestamp,
    });

    // Apex Legal sends Message 3 at 10:18 (12 mins ago)
    const offlineMsg3Timestamp = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    db.addConversationMessage({
      id: 'offline_msg_legal_1',
      leadId: legalLead.leadId,
      sender: 'client',
      text: 'We are looking to rebuild our law firm website. Do you offer mobile responsiveness?',
      status: 'Read',
      providerMessageId: 'prov_offline_legal_1',
      timestamp: offlineMsg3Timestamp,
    });

    // Verify unreplied messages exist before restart
    const pendingBefore = service.getMissedMessages();
    expect(pendingBefore.length).toBe(2); // Pearl Dental & Apex Legal
    const dentalPending = pendingBefore.find((p) => p.client.leadId === dentalLead.leadId);
    expect(dentalPending?.messages.length).toBe(2);

    // 4. Project REOPENS / RESTARTS:
    // checkAndProcessMissedMessages() is triggered automatically on restart/reconnect
    const scanResult = await service.checkAndProcessMissedMessages({ offlineSince: offlineTime });

    expect(scanResult.missedMessagesFound).toBe(3);
    expect(scanResult.repliesSent).toBe(3);
    expect(scanResult.details.length).toBe(3);

    // Verify Pearl Dental's messages were processed in exact chronological order
    const dentalMsgs = db.getConversationMessages(dentalLead.leadId);
    expect(dentalMsgs.length).toBe(5); // 1 Outreach + Msg1 + Msg2 + Reply1 + Reply2
    expect(scanResult.details[0].incomingMessageId).toBe('offline_msg_dental_1');
    expect(scanResult.details[1].incomingMessageId).toBe('offline_msg_dental_2');
    expect(scanResult.details[2].incomingMessageId).toBe('offline_msg_legal_1');

    const reply1 = dentalMsgs.find((m) => m.metadata?.repliedToMessageId === 'offline_msg_dental_1');
    const reply2 = dentalMsgs.find((m) => m.metadata?.repliedToMessageId === 'offline_msg_dental_2');
    expect(reply1).toBeDefined();
    expect(reply1?.sender).toBe('assistant');
    expect(reply2).toBeDefined();
    expect(reply2?.sender).toBe('assistant');

    // Context check: Reply 2 understands the conversation and references pricing/timeline
    expect(reply2?.text.length).toBeGreaterThan(20);
    expect(reply2?.text).toMatch(/(\$|timeline|week|cost|plan|setup)/i);

    // Apex Legal message was also processed and replied
    const legalMsgs = db.getConversationMessages(legalLead.leadId);
    expect(legalMsgs.length).toBe(3); // 1 Outreach + Msg3 + Reply3
    const legalReply = legalMsgs.find((m) => m.metadata?.repliedToMessageId === 'offline_msg_legal_1');
    expect(legalReply).toBeDefined();
    expect(legalReply?.sender).toBe('assistant');
    expect(legalReply?.text).toMatch(/(website|mobile|responsive|design)/i);

    // 5. Verify NO messages remain missed
    const pendingAfter = service.getMissedMessages();
    expect(pendingAfter.length).toBe(0);
  });

  it('Scenario 4 & 5: Guarantees zero duplicate replies and ignores ancient/already answered messages', async () => {
    // Run missed message check again immediately
    const secondScan = await service.checkAndProcessMissedMessages();
    expect(secondScan.missedMessagesFound).toBe(0);
    expect(secondScan.repliesSent).toBe(0);

    // Simulate WhatsApp history sync delivering an append message from 60 days ago
    const ancientRes = await service.handleIncomingWebhook({
      id: 'ancient_sync_msg_999',
      from: '923001112233',
      rawJid: '923001112233@s.whatsapp.net',
      body: 'Old message from two months ago',
      timestamp: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      isHistoryAppend: true,
      source: 'baileys',
    });
    expect(ancientRes.handled).toBe(true);
    expect(ancientRes.autoReplied).toBe(false);
    expect(ancientRes.reason).toContain('older than 30 days');

    // Seed a subsequent assistant response at 5 mins ago
    db.addConversationMessage({
      id: 'subsequent_reply_msg',
      leadId: dentalLead.leadId,
      sender: 'assistant',
      text: 'Our team already replied to this earlier.',
      status: 'Sent',
      timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });

    // Simulate WhatsApp history sync delivering a message that already has a subsequent reply
    const answeredRes = await service.handleIncomingWebhook({
      id: 'historical_already_answered',
      from: '923001112233',
      rawJid: '923001112233@s.whatsapp.net',
      body: 'Question that was already replied to earlier',
      timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      isHistoryAppend: true,
      source: 'baileys',
    });
    expect(answeredRes.handled).toBe(true);
    expect(answeredRes.autoReplied).toBe(false);
    expect(answeredRes.reason).toContain('already has a subsequent response');
  });

  it('Scenario 6: End-to-end Fastify API routes support checking and processing missed messages after restart', async () => {
    const app = buildApp(db);
    const token = await issueToken('1h');

    // Client sends missed message
    db.addConversationMessage({
      id: 'api_missed_dental_99',
      leadId: dentalLead.leadId,
      sender: 'client',
      text: 'Can we schedule a call for this Friday?',
      status: 'Read',
      providerMessageId: 'prov_api_dental_99',
      timestamp: new Date().toISOString(),
    });

    // 1. GET /api/clients/missed-messages detects the pending message
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/clients/missed-messages',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.payload);
    expect(getBody.ok).toBe(true);
    expect(getBody.count).toBeGreaterThanOrEqual(1);

    // 2. POST /api/clients/check-missed-messages processes all missed messages
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/clients/check-missed-messages',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(postRes.statusCode).toBe(200);
    const postBody = JSON.parse(postRes.payload);
    expect(postBody.ok).toBe(true);
    expect(postBody.result.repliesSent).toBeGreaterThanOrEqual(1);

    // 3. GET /api/clients/missed-messages now returns 0 pending
    const getRes2 = await app.inject({
      method: 'GET',
      url: '/api/clients/missed-messages',
      headers: { authorization: `Bearer ${token}` },
    });
    const getBody2 = JSON.parse(getRes2.payload);
    expect(getBody2.count).toBe(0);

    await app.close();
  });
});
