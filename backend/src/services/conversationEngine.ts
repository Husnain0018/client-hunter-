import { env } from '../config/env.js';
import type { Database } from '../db/database.js';
import type {
  ClientConversation,
  ClientStage,
  ConversationMessage,
  CustomService,
  Lead,
  ProjectPlanDetails,
} from '../types/domain.js';
import { generatePersonalizedWhatsAppMessage, resolveSenderIdentity } from './aiAnalyzer.js';

export interface AIResponseResult {
  replyText: string;
  detectedStage: ClientStage;
  needsHumanIntervention: boolean;
  humanInterventionReason?: string;
  isOptOut: boolean;
  dealAgreed: boolean;
  suggestedTerms?: {
    services?: string[];
    price?: string;
    timeline?: string;
    deliverables?: string;
  };
  summaryUpdate?: string;
  identifiedRequirements?: string[];
  projectPlan?: ProjectPlanDetails;
  nextRecommendedAction?: string;
}

const OPT_OUT_PATTERNS = [
  /\b(stop|unsubscribe|opt[\s-]?out|leave\s+me\s+alone|don'?t\s+(?:message|text|call)\s+(?:me|again)|not\s+interested|remove\s+(?:my\s+number|me))\b/i,
];

export function isOptOutMessage(text: string): boolean {
  return OPT_OUT_PATTERNS.some((p) => p.test(text.trim()));
}

export function extractRequirements(clientText: string, lead: Lead, existing: string[] = []): string[] {
  const reqs = new Set<string>(existing);
  const lower = clientText.toLowerCase();

  if (/(book|appointment|calendar|schedule|slot)/i.test(lower)) {
    reqs.add('Automated 24/7 online appointment booking');
  }
  if (/(whatsapp|chat|instant\s+reply|auto\s*responder|message)/i.test(lower)) {
    reqs.add('Instant WhatsApp inquiry auto-responder & routing');
  }
  if (/(website|site|landing\s+page|mobile\s+friendly|responsive)/i.test(lower)) {
    reqs.add('Modern fast mobile-responsive website');
  }
  if (/(lead|patient|customer|client|more\s+business|sales)/i.test(lower)) {
    reqs.add('Local customer acquisition & Google Maps optimization');
  }
  if (/(missed\s+call|after\s+hours|weekend)/i.test(lower)) {
    reqs.add('After-hours missed inquiry capture system');
  }

  // Fallback to verified research findings if none identified yet
  if (reqs.size === 0) {
    if (lead.strategy?.problems && lead.strategy.problems.length > 0) {
      for (const p of lead.strategy.problems.slice(0, 3)) {
        reqs.add(`Resolve: ${p.title}`);
      }
    } else if (lead.weaknesses && lead.weaknesses.length > 0) {
      for (const w of lead.weaknesses.slice(0, 2)) {
        reqs.add(`Address: ${w}`);
      }
    } else if (lead.recommendedServices && lead.recommendedServices.length > 0) {
      for (const s of lead.recommendedServices.slice(0, 2)) {
        reqs.add(`Implement: ${s}`);
      }
    }
  }

  return Array.from(reqs);
}

export function buildProjectPlan(
  lead: Lead,
  requirements: string[],
  agreedServices?: string[],
  price?: string,
  timeline?: string
): ProjectPlanDetails {
  const services = agreedServices && agreedServices.length > 0
    ? agreedServices
    : (lead.recommendedServices && lead.recommendedServices.length > 0
        ? lead.recommendedServices.slice(0, 2)
        : ['Digital Automation & Growth']);

  const duration = timeline || '1-2 weeks';
  const estimatedCharges = price || lead.estimatedDealValue || '$400 - $800';

  const tasks: string[] = [
    `Initial audit & technical configuration for ${lead.businessName}`,
    `Build and deploy ${services.join(' & ')}`,
    'Setup automated WhatsApp response & booking triggers',
    'Simulate customer test inquiries & quality assurance',
    'Staff handover and 30-day live monitoring',
  ];

  const deliverables = `${services.map((s) => `Turnkey ${s}`).join(', ')}; Complete setup, staff guide, and 30-day monitoring.`;

  return {
    services,
    tasks,
    deliverables,
    duration,
    startDate: new Date().toISOString().split('T')[0],
    deadline: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    estimatedCharges,
    notes: `Tailored project plan addressing verified opportunities for ${lead.businessName}.`,
  };
}

export class ConversationEngine {
  constructor(private readonly db: Database) {}

  /**
   * Generates a tailored first WhatsApp outreach message for a lead with personalized business research
   */
  async generateFirstMessage(leadId: string): Promise<string> {
    const lead = this.db.getLead(leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found.`);

    const isOldGeneric = lead.whatsappMessage && /We help local .* capture more client bookings with/i.test(lead.whatsappMessage);
    if (lead.whatsappMessage && lead.whatsappMessage.trim().length > 40 && !isOldGeneric) {
      return lead.whatsappMessage.trim();
    }

    const run = lead.runId ? this.db.getRun(lead.runId) : null;
    const userName = run?.request.userName || lead.senderName || 'Consultant';
    const company = run?.request.company || '';
    const senderType = run?.request.senderType || 'auto';
    const identity = resolveSenderIdentity(userName, company, senderType);

    const customServices = this.db.listCustomServices().map((s) => s.name);
    const availableServices = Array.from(new Set([
      ...(run?.request.services || []),
      ...(lead.recommendedServices || []),
      ...customServices,
    ]));

    const message = generatePersonalizedWhatsAppMessage({
      leadId: lead.leadId,
      businessName: lead.businessName,
      category: lead.category,
      niche: run?.request.niche || lead.category,
      address: lead.address,
      audit: {
        hasWebsite: lead.leadType === 'Has Website',
        score: lead.websiteScore,
        status: lead.websiteStatus,
        issues: lead.websiteIssues || [],
      },
      socialActivity: lead.socialActivity || {},
      competitors: lead.competitors || [],
      problems: lead.strategy?.problems || [],
      weaknesses: lead.weaknesses || [],
      identity,
      availableServices,
      strategy: lead.strategy,
    });

    this.db.updateLead(leadId, { whatsappMessage: message });
    return message;
  }

  /**
   * Generates the next response to an incoming client message or user trigger
   */
  async generateReply(leadId: string, userGuidance?: string, targetMessageId?: string): Promise<AIResponseResult> {
    const lead = this.db.getLead(leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found.`);

    const conv = this.db.getClientConversation(leadId);
    let messages = this.db.getConversationMessages(leadId);
    const customServices = this.db.listCustomServices();
    const run = lead.runId ? this.db.getRun(lead.runId) : null;

    const userName = run?.request.userName || lead.senderName || 'Our Team';
    const company = run?.request.company || '';
    const senderType = run?.request.senderType || 'auto';
    const identity = resolveSenderIdentity(userName, company, senderType);

    // If targetMessageId is specified, restrict history to messages up to targetMessageId
    let targetMessage: ConversationMessage | undefined;
    if (targetMessageId) {
      const idx = messages.findIndex((m) => m.id === targetMessageId);
      if (idx !== -1) {
        targetMessage = messages[idx];
        messages = messages.slice(0, idx + 1);
      }
    }

    const lastClientMessage = targetMessage || [...messages].reverse().find((m) => m.sender === 'client');
    const clientText = lastClientMessage?.text || '';

    // Step 1: Immediate opt-out check
    if (clientText && isOptOutMessage(clientText)) {
      return {
        replyText: `Thank you for letting us know. We have marked your number to not be contacted again. Have a great day!`,
        detectedStage: 'opted_out',
        needsHumanIntervention: false,
        isOptOut: true,
        dealAgreed: false,
        summaryUpdate: 'Client opted out of communications.',
      };
    }

    const existingReqs = conv?.identifiedRequirements || [];
    const identifiedRequirements = extractRequirements(clientText, lead, existingReqs);

    // Step 1b: Immediate guardrail check for unauthorized discounts or free work
    if (clientText && /(discount|half\s+price|free|guarantee|refund|cheap|special\s+deal)/i.test(clientText)) {
      return {
        replyText: `We want to make sure the pricing matches your exact clinic needs without cutting corners. Let me check with our lead strategist to see what custom package we can offer you!`,
        detectedStage: 'needs_human',
        needsHumanIntervention: true,
        humanInterventionReason: `Client inquired about custom discounts or special pricing: "${clientText.slice(0, 100)}"`,
        isOptOut: false,
        dealAgreed: false,
        identifiedRequirements,
        nextRecommendedAction: 'Review client discount/custom scope request and provide manual authorization.',
        summaryUpdate: 'Client requested discount; flagged for human intervention.',
      };
    }

    // Step 2: Try AI-powered response if OPENAI_API_KEY configured (skip live network calls during unit tests unless explicitly enabled)
    if (env.OPENAI_API_KEY && process.env.NODE_ENV !== 'test') {
      try {
        const aiResult = await this.modelConversationReply(
          lead,
          conv,
          messages,
          customServices,
          identity.displayName,
          userGuidance
        );
        if (aiResult) {
          const mergedReqs = Array.from(
            new Set([...identifiedRequirements, ...(aiResult.identifiedRequirements || [])])
          );
          const dealValue = aiResult.suggestedTerms?.price || lead.estimatedDealValue || '$400 - $800';
          const plan =
            aiResult.projectPlan ||
            (aiResult.dealAgreed || aiResult.detectedStage === 'negotiating' || aiResult.detectedStage === 'closed_won'
              ? buildProjectPlan(
                  lead,
                  mergedReqs,
                  aiResult.suggestedTerms?.services || lead.recommendedServices.slice(0, 2),
                  dealValue,
                  aiResult.suggestedTerms?.timeline || '1-2 weeks'
                )
              : conv?.projectPlan);
          return {
            ...aiResult,
            identifiedRequirements: mergedReqs,
            ...(plan ? { projectPlan: plan } : {}),
          };
        }
      } catch (err) {
        console.warn('[ConversationEngine] AI model failed, falling back to deterministic engine:', err);
      }
    }

    // Step 3: Reliable Deterministic Fallback Engine
    return this.deterministicReply(lead, conv, messages, clientText, identity.displayName, userGuidance);
  }

  /**
   * Generates a respectful, non-spammy follow-up message
   */
  async generateFollowUp(leadId: string): Promise<string> {
    const lead = this.db.getLead(leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found.`);

    const conv = this.db.getClientConversation(leadId);
    const count = (conv?.followUpCount || 0) + 1;
    const service = lead.recommendedServices[0] || 'patient appointment booking';

    if (count === 1) {
      return `Hi ${lead.businessName} team, just following up on our previous note. We recently helped a nearby practice automate their ${service} inquiries so they stopped missing weekend leads. Would you like to see a brief 60-second preview?`;
    }

    if (count === 2) {
      return `Hi ${lead.businessName} team, checking in one last time! I know how busy running ${lead.businessName} gets. If you're currently satisfied with your setup, no problem at all. Just wanted to make sure you had the option available whenever you're ready!`;
    }

    return `Hi ${lead.businessName} team, hope all is well! Feel free to reach out anytime if you ever need help with ${service}.`;
  }

  private async modelConversationReply(
    lead: Lead,
    conv: ClientConversation | null,
    messages: ConversationMessage[],
    customServices: CustomService[],
    displayName: string,
    userGuidance?: string
  ): Promise<AIResponseResult | null> {
    const conversationTranscript = messages
      .slice(-10)
      .map((m) => `${m.sender.toUpperCase()}: ${m.text}`)
      .join('\n');

    const availableServices = [
      'Website Development',
      'SEO',
      'Social Media Management',
      'AI Chatbot',
      'WhatsApp Automation',
      'CRM Automation',
      'Google Ads',
      'UGC Video Ads',
      'Branding & Design',
      ...customServices.map((s) => s.name),
    ];

    const systemPrompt = `You are a professional, polite, and persuasive Client Acquisition Specialist representing "${displayName}".
Your objective is to guide prospective local businesses from initial contact through understanding their needs, explaining solutions, addressing questions/objections, and closing deals.

CRITICAL RULES & GUARDRAILS:
1. ONLY offer services from the authorized services list: ${JSON.stringify(availableServices)}.
2. Base solutions strictly on the lead's verified public facts:
   - Business: ${lead.businessName} (${lead.category}) in ${lead.address}
   - Website Status: ${lead.websiteStatus} (Score: ${lead.websiteScore ?? 'None'})
   - Verified Weaknesses: ${JSON.stringify(lead.weaknesses)}
   - Strategy Problems & Evidence: ${JSON.stringify(lead.strategy?.problems || [])}
   - Business Impact: ${JSON.stringify(lead.strategy?.businessImpact || [])}
   - Solutions & How It Works: ${JSON.stringify(lead.strategy?.solutions || [])}
   - Recommended Services: ${JSON.stringify(lead.recommendedServices)}
   - Estimated Deal Value: ${lead.estimatedDealValue}
3. If the client asks what problems were found, what research was conducted, or why we reached out:
   Detail the exact researched problems and observed evidence clearly, transparently, and politely. Explain how our recommended solutions resolve these issues.
4. Never make unsupported claims about problems that were not verified. If the lead has no website, politely mention that a mobile-friendly site would help them capture Google Maps searchers.
5. If the client asks for discounts, unapproved custom work, or guarantees outside standard scope:
   Set "needsHumanIntervention": true, and explain why in "humanInterventionReason".
6. If the client asks to opt-out, stop, or not be contacted:
   Set "isOptOut": true, "detectedStage": "opted_out".
7. Only set "dealAgreed": true and "detectedStage": "closed_won" if the client has EXPLICITLY confirmed an agreement (e.g. "Let's proceed", "Send the contract/invoice", "Agreed on terms"). DO NOT mark closed_won if they are just expressing initial interest.
8. Tone: Professional, warm, concise (WhatsApp messages should usually be 2-4 sentences max, never huge walls of text).

Output ONLY valid JSON with keys:
{
  "replyText": string,
  "detectedStage": "contacted" | "awaiting_reply" | "conversing" | "interested" | "negotiating" | "needs_human" | "closed_won" | "opted_out",
  "needsHumanIntervention": boolean,
  "humanInterventionReason": string,
  "isOptOut": boolean,
  "dealAgreed": boolean,
  "suggestedTerms": {
    "services": string[],
    "price": string,
    "timeline": string,
    "deliverables": string
  },
  "summaryUpdate": string
}`;

    const userMessage = `Current Stage: ${conv?.stage || 'new'}
User's internal guidance: ${userGuidance || 'None'}

Conversation Transcript:
${conversationTranscript || 'No previous messages.'}

Generate the best response and stage analysis.`;

    const res = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as AIResponseResult;
    return parsed;
  }

  private deterministicReply(
    lead: Lead,
    conv: ClientConversation | null,
    messages: ConversationMessage[],
    clientText: string,
    displayName: string,
    userGuidance?: string
  ): AIResponseResult {
    const textLower = clientText.toLowerCase();
    const service = lead.recommendedServices[0] || 'digital growth';
    const dealValue = lead.estimatedDealValue || '$400 - $800';

    const existingReqs = conv?.identifiedRequirements || [];
    const identifiedRequirements = extractRequirements(clientText, lead, existingReqs);

    // 1. Opt-out detection
    if (isOptOutMessage(clientText)) {
      return {
        replyText: 'Understood. We will not contact you again. Thank you for your time!',
        detectedStage: 'opted_out',
        needsHumanIntervention: false,
        isOptOut: true,
        dealAgreed: false,
        identifiedRequirements,
        nextRecommendedAction: 'Do not contact. Respect client preference.',
        summaryUpdate: 'Client requested opt out.',
      };
    }

    // 2. High discount or custom demand requiring human review
    if (/(discount|half\s+price|free|guarantee|refund|cheap|special\s+deal)/i.test(textLower)) {
      return {
        replyText: `We want to make sure the pricing matches your exact clinic needs without cutting corners. Let me check with our lead strategist to see what custom package we can offer you!`,
        detectedStage: 'needs_human',
        needsHumanIntervention: true,
        humanInterventionReason: `Client inquired about custom discounts or special pricing: "${clientText.slice(0, 100)}"`,
        isOptOut: false,
        dealAgreed: false,
        identifiedRequirements,
        nextRecommendedAction: 'Review client discount/custom scope request and provide manual authorization.',
        summaryUpdate: 'Client requested discount; flagged for human intervention.',
      };
    }

    // 3. Explicit deal acceptance / closing criteria
    if (/(let'?s\s+do\s+it|deal|agree|sounds\s+good,?\s+let'?s\s+start|send\s+(?:the\s+)?(?:invoice|contract|agreement)|where\s+do\s+i\s+pay|ready\s+to\s+proceed|done\s+karo|start\s+kar\s*do)/i.test(textLower)) {
      const plan = buildProjectPlan(lead, identifiedRequirements, lead.recommendedServices.slice(0, 2), dealValue, '1-2 weeks');
      return {
        replyText: `Fantastic! We are thrilled to partner with ${lead.businessName}. We will prepare your kickoff onboarding for ${service} (${dealValue}, 1-2 weeks delivery). Could you confirm the best email to send over the project brief?`,
        detectedStage: 'closed_won',
        needsHumanIntervention: false,
        isOptOut: false,
        dealAgreed: true,
        identifiedRequirements,
        projectPlan: plan,
        nextRecommendedAction: 'Send project brief, confirm kickoff call, and collect onboarding details.',
        suggestedTerms: {
          services: lead.recommendedServices.slice(0, 2),
          price: dealValue,
          timeline: '1-2 weeks',
          deliverables: plan.deliverables,
        },
        summaryUpdate: 'Client agreed to proceed. Deal successfully closed!',
      };
    }

    // 4. Pricing / Cost Question
    if (/(cost|price|how\s+much|rates|charges|fee|budget|kitne|kya\s+rate|kia\s+price)/i.test(textLower)) {
      const plan = buildProjectPlan(lead, identifiedRequirements, [service], dealValue, '1-2 weeks');
      return {
        replyText: `Our typical investment for ${service} ranges around ${dealValue}, depending on the exact scope and integrations required. We include full setup, testing, and 30 days of direct support. Would you like a fast 5-minute walk-through to see what fits ${lead.businessName} best?`,
        detectedStage: 'negotiating',
        needsHumanIntervention: false,
        isOptOut: false,
        dealAgreed: false,
        identifiedRequirements,
        projectPlan: plan,
        nextRecommendedAction: 'Follow up on proposed pricing scope and offer a quick 5-min demonstration.',
        suggestedTerms: {
          services: [service],
          price: dealValue,
          timeline: '1-2 weeks',
          deliverables: `Full setup of ${service} for ${lead.businessName}`,
        },
        summaryUpdate: 'Client requested pricing details.',
      };
    }

    // 5. Research findings & Problem details inquiry (including affirmative replies to initial outreach)
    const assistantTurns = messages.filter((m) => m.sender === 'assistant' || m.sender === 'user').length;
    const isInitialAffirmative =
      assistantTurns <= 1 &&
      /^(?:yes|yeah|sure|ok|okay|haan|han|ji|g|tell\s+me|batao|batayen|yes\s+please|interested|share\s+details)[\s!.?]*$/i.test(textLower.trim());

    if (
      isInitialAffirmative ||
      /(?:\b(?:what|which)\b.*\b(?:problems?|issues?|gaps?|findings?|research|weaknesses?|areas?\s+(?:for|of)\s+improvement)\b|why\s+(?:are\s+you\s+contacting|did\s+you\s+(?:reach\s+out|message))|what\s+did\s+you\s+(?:find|notice|see|review)|review\s+details|tell\s+me\s+more\s+about\s+(?:the\s+)?(?:problems?|issues?|improvements?|research)|what\s+is\s+wrong|kia\s+masla|kya\s+issue)/i.test(textLower)
    ) {
      const problemsList = lead.strategy?.problems?.length
        ? lead.strategy.problems.slice(0, 3).map((p, i) => `${i + 1}. ${p.title} (${p.type === 'confirmed' ? 'Confirmed' : 'Opportunity'}): ${p.detail}${p.evidence ? ` (Observed: ${p.evidence})` : ''}`).join('\n')
        : (lead.weaknesses || []).slice(0, 3).map((w, i) => `${i + 1}. ${w}`).join('\n') || `Identified friction in online presence and inquiry handling.`;

      const impact = lead.strategy?.businessImpact?.[0] || 'These issues can make it harder for interested clients to find information and book appointments easily.';

      return {
        replyText: `During our review of ${lead.businessName}, we identified a few specific areas:\n\n${problemsList}\n\n${impact}\n\nWe can help you address these with practical solutions that don't disrupt your daily operations. Would you be open to a quick 5-minute call or a short overview showing how we can fix these?`,
        detectedStage: 'interested',
        needsHumanIntervention: false,
        isOptOut: false,
        dealAgreed: false,
        identifiedRequirements,
        nextRecommendedAction: 'Propose scheduling a 5-minute call or sending a solution walkthrough.',
        summaryUpdate: 'Client asked about research findings; explained identified problems in detail.',
      };
    }

    // 6. How it works / What services Question
    if (/(how\s+does\s+it\s+work|what\s+services|details|explain|portfolio|examples)/i.test(textLower)) {
      const solution = lead.strategy?.solutions?.[0]?.howItWorks ||
        `We set up a responsive online channel for ${lead.businessName} that captures inquiries from Google Maps and routes them directly to your team.`;
      return {
        replyText: `${solution} Everything is handled turn-key so your daily staff operations are uninterrupted. Would you be open to a quick call tomorrow to look at a live example?`,
        detectedStage: 'conversing',
        needsHumanIntervention: false,
        isOptOut: false,
        dealAgreed: false,
        identifiedRequirements,
        nextRecommendedAction: 'Ask about their current inquiry volume or primary objective.',
        summaryUpdate: 'Explained solution mechanics and benefits.',
      };
    }

    // 7. Objection: Already have someone or not right now
    if (/(already\s+have|not\s+now|busy|later|don'?t\s+need)/i.test(textLower)) {
      return {
        replyText: `Totally understand! Many clinic owners we work with already had basic listings, but were losing inquiries because after-hours messages went unanswered. We can keep this on file—feel free to message us whenever you would like to explore it!`,
        detectedStage: 'interested',
        needsHumanIntervention: false,
        isOptOut: false,
        dealAgreed: false,
        identifiedRequirements,
        nextRecommendedAction: 'Leave door open and schedule follow-up check-in in 7-14 days.',
        summaryUpdate: 'Handled timing/agency objection gracefully.',
      };
    }

    // 8. General positive inquiry or prompt
    return {
      replyText: `Thanks for the response! For ${lead.businessName}, focusing on ${service} is the quickest way to turn Google Maps visitors into confirmed bookings. What is your current priority this month?`,
      detectedStage: 'conversing',
      needsHumanIntervention: false,
      isOptOut: false,
      dealAgreed: false,
      identifiedRequirements,
      nextRecommendedAction: 'Clarify current business priority and propose tailored next step.',
      summaryUpdate: 'Engaged client in discovery conversation.',
    };
  }
}
