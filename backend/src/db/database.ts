import fs from 'node:fs';
import path from 'node:path';
import DatabaseDriver from 'better-sqlite3';
import type {
  CareerProfile,
  ClientConversation,
  ClientHandlerStats,
  ClientStage,
  ConversationMessage,
  CustomService,
  GeneratedResume,
  JobApplication,
  JobApplicationStatus,
  JobDiscoveryConfig,
  JobListing,
  JobNotification,
  JobSearchParams,
  Lead,
  LeadStats,
  ResumeAnalysis,
  RunEvent,
  RunRecord,
  SearchRequest,
  StoredResume,
  WhatsAppRecord,
  WhatsAppStatus,
  ApplicationActivityEvent,
  EmployerResponseRecord,
  JobApplicationEmailRecord,
  JobSyncStatusInfo,
  JobDiscoveryStats,
  JobSyncLogRecord,
} from '../types/domain.js';

type StoredRun = {
  run_id: string;
  status: RunRecord['status'];
  request_json: string;
  message: string;
  total: number;
  created_at: string;
  completed_at: string | null;
};

export class Database {
  readonly db: DatabaseDriver.Database;
  private readonly statements = new Map<string, DatabaseDriver.Statement>();

  constructor(filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseDriver(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        total INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS leads (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        lead_id TEXT NOT NULL,
        domain TEXT NOT NULL DEFAULT '',
        phone_key TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL,
        UNIQUE(run_id, lead_id)
      );
      CREATE INDEX IF NOT EXISTS idx_leads_lead_id ON leads(lead_id);
      CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads(domain);
      CREATE INDEX IF NOT EXISTS idx_leads_phone_key ON leads(phone_key);
      CREATE TABLE IF NOT EXISTS run_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        stage TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_run_seq ON run_events(run_id, seq);
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        lead_id TEXT PRIMARY KEY,
        business_name TEXT NOT NULL,
        number TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL,
        provider_message_id TEXT NOT NULL DEFAULT '',
        saved_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS email_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id TEXT NOT NULL,
        to_address TEXT NOT NULL,
        subject TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        provider_id TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS custom_services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS client_conversations (
        lead_id TEXT PRIMARY KEY,
        stage TEXT NOT NULL DEFAULT 'new',
        auto_pilot INTEGER NOT NULL DEFAULT 1,
        agreed_services_json TEXT NOT NULL DEFAULT '[]',
        agreed_price TEXT NOT NULL DEFAULT '',
        agreed_timeline TEXT NOT NULL DEFAULT '',
        agreed_deliverables TEXT NOT NULL DEFAULT '',
        deal_notes TEXT NOT NULL DEFAULT '',
        closed_at TEXT,
        closing_notified_at TEXT,
        human_intervention_reason TEXT NOT NULL DEFAULT '',
        next_follow_up_at TEXT,
        follow_up_count INTEGER NOT NULL DEFAULT 0,
        opted_out INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        identified_requirements_json TEXT NOT NULL DEFAULT '[]',
        project_plan_json TEXT NOT NULL DEFAULT '{}',
        ai_handled INTEGER NOT NULL DEFAULT 0,
        last_ai_action TEXT NOT NULL DEFAULT '',
        next_recommended_action TEXT NOT NULL DEFAULT '',
        deal_notification_phone TEXT NOT NULL DEFAULT '',
        deal_notification_status TEXT NOT NULL DEFAULT '',
        deal_notification_text TEXT NOT NULL DEFAULT '',
        deal_notification_error TEXT NOT NULL DEFAULT '',
        last_message_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_client_conv_stage ON client_conversations(stage);
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Sent',
        provider_message_id TEXT NOT NULL DEFAULT '',
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conv_msgs_lead ON conversation_messages(lead_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conv_msgs_prov ON conversation_messages(provider_message_id);
      CREATE TABLE IF NOT EXISTS processed_webhooks (
        message_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS baileys_auth (
        key_id TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_baileys_auth_key ON baileys_auth(key_id);

      -- Career Profiles
      CREATE TABLE IF NOT EXISTS career_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        full_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        preferred_locations_json TEXT NOT NULL DEFAULT '[]',
        summary TEXT NOT NULL DEFAULT '',
        skills_json TEXT NOT NULL DEFAULT '[]',
        experience_json TEXT NOT NULL DEFAULT '[]',
        education_json TEXT NOT NULL DEFAULT '[]',
        certifications_json TEXT NOT NULL DEFAULT '[]',
        projects_json TEXT NOT NULL DEFAULT '[]',
        portfolio_links_json TEXT NOT NULL DEFAULT '[]',
        languages_json TEXT NOT NULL DEFAULT '[]',
        target_roles_json TEXT NOT NULL DEFAULT '[]',
        employment_types_json TEXT NOT NULL DEFAULT '[]',
        remote_preference TEXT NOT NULL DEFAULT 'Remote',
        min_salary TEXT NOT NULL DEFAULT '',
        visa_status TEXT NOT NULL DEFAULT 'Citizen / Permanent Resident',
        updated_at TEXT NOT NULL
      );

      -- Uploaded Resumes
      CREATE TABLE IF NOT EXISTS resumes (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        parsed_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- AI Resume Analyses
      CREATE TABLE IF NOT EXISTS resume_analyses (
        id TEXT PRIMARY KEY,
        resume_id TEXT NOT NULL,
        overall_score INTEGER NOT NULL,
        summary_critique TEXT NOT NULL,
        skills_feedback TEXT NOT NULL,
        experience_feedback TEXT NOT NULL,
        formatting_feedback TEXT NOT NULL,
        recommendations_json TEXT NOT NULL,
        keywords_detected_json TEXT NOT NULL,
        missing_keywords_json TEXT NOT NULL,
        international_notes_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- AI Generated & Tailored Resumes
      CREATE TABLE IF NOT EXISTS generated_resumes (
        id TEXT PRIMARY KEY,
        resume_id TEXT,
        title TEXT NOT NULL,
        target_role TEXT NOT NULL,
        template_type TEXT NOT NULL,
        content_text TEXT NOT NULL,
        content_html TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Discovered Job Listings
      CREATE TABLE IF NOT EXISTS job_listings (
        id TEXT PRIMARY KEY,
        external_id TEXT NOT NULL,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        location TEXT NOT NULL,
        country TEXT NOT NULL,
        workplace_type TEXT NOT NULL,
        employment_type TEXT NOT NULL,
        experience_level TEXT NOT NULL DEFAULT 'Mid-level',
        salary_min INTEGER,
        salary_max INTEGER,
        salary_currency TEXT DEFAULT 'USD',
        salary_raw TEXT DEFAULT '',
        description TEXT NOT NULL,
        skills_json TEXT NOT NULL DEFAULT '[]',
        requirements_json TEXT NOT NULL DEFAULT '[]',
        visa_sponsorship INTEGER DEFAULT 0,
        relocation INTEGER DEFAULT 0,
        apply_url TEXT NOT NULL,
        source_url TEXT NOT NULL,
        posted_at TEXT NOT NULL,
        deadline TEXT,
        is_active INTEGER DEFAULT 1,
        discovered_at TEXT NOT NULL,
        UNIQUE(source, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_source ON job_listings(source);
      CREATE INDEX IF NOT EXISTS idx_jobs_country ON job_listings(country);
      CREATE INDEX IF NOT EXISTS idx_jobs_workplace ON job_listings(workplace_type);
      CREATE INDEX IF NOT EXISTS idx_jobs_posted ON job_listings(posted_at);

      -- User Saved Jobs
      CREATE TABLE IF NOT EXISTS saved_jobs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE REFERENCES job_listings(id) ON DELETE CASCADE,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      -- Job Applications & Auto-Apply Records
      CREATE TABLE IF NOT EXISTS job_applications (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE REFERENCES job_listings(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'draft',
        application_mode TEXT NOT NULL DEFAULT 'manual',
        resume_id TEXT,
        cover_letter TEXT NOT NULL DEFAULT '',
        answers_json TEXT NOT NULL DEFAULT '{}',
        submission_ref TEXT NOT NULL DEFAULT '',
        failure_reason TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        applied_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_job_apps_status ON job_applications(status);

      -- Job & Application Notifications
      CREATE TABLE IF NOT EXISTS job_notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        job_id TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_job_notifs_read ON job_notifications(is_read);

      -- Automation & Discovery Preferences
      CREATE TABLE IF NOT EXISTS job_discovery_configs (
        id TEXT PRIMARY KEY DEFAULT 'default',
        auto_apply_enabled INTEGER DEFAULT 0,
        max_daily_applications INTEGER DEFAULT 5,
        min_compatibility_score INTEGER DEFAULT 75,
        preferred_countries_json TEXT NOT NULL DEFAULT '["Worldwide","Pakistan","United States","United Arab Emirates","United Kingdom","India","Canada","Australia"]',
        preferred_roles_json TEXT NOT NULL DEFAULT '["Software Engineer","Full Stack Developer","Frontend Developer","Backend Developer"]',
        excluded_companies_json TEXT NOT NULL DEFAULT '[]',
        enabled_platforms_json TEXT NOT NULL DEFAULT '["LinkedIn","Indeed","Glassdoor","Remote OK","Arbeitnow","Jobicy","We Work Remotely","Company Career Pages"]',
        auto_discovery_interval_hours INTEGER DEFAULT 6,
        last_run_at TEXT,
        updated_at TEXT NOT NULL
      );
      -- Job Discovery & Sync History Logs
      CREATE TABLE IF NOT EXISTS job_sync_logs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        trigger_type TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL DEFAULT 'success',
        sources_checked_json TEXT NOT NULL DEFAULT '[]',
        sources_failed_json TEXT NOT NULL DEFAULT '[]',
        total_fetched INTEGER NOT NULL DEFAULT 0,
        new_saved INTEGER NOT NULL DEFAULT 0,
        duplicates_skipped INTEGER NOT NULL DEFAULT 0,
        error_message TEXT DEFAULT ''
      );

      -- Job Application Emails History
      CREATE TABLE IF NOT EXISTS job_application_emails (
        id TEXT PRIMARY KEY,
        application_id TEXT,
        job_id TEXT NOT NULL,
        company_name TEXT NOT NULL,
        job_title TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        resume_id TEXT,
        resume_name TEXT,
        sent_at TEXT NOT NULL,
        delivery_status TEXT NOT NULL DEFAULT 'sent',
        failure_reason TEXT DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_job_app_emails_job ON job_application_emails(job_id);
    `);

    // Safe column migrations
    const addColumnIfNotExists = (table: string, column: string, def: string) => {
      try {
        this.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`).run();
      } catch {
        // column already exists
      }
    };

    addColumnIfNotExists('career_profiles', 'social_accounts_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfNotExists('career_profiles', 'photo_url', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('career_profiles', 'include_photo_in_resume', "INTEGER NOT NULL DEFAULT 1");
    addColumnIfNotExists('career_profiles', 'professional_skills_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfNotExists('career_profiles', 'internships_json', "TEXT NOT NULL DEFAULT '[]'");

    addColumnIfNotExists('job_listings', 'short_description', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_listings', 'department', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_listings', 'responsibilities_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfNotExists('job_listings', 'qualifications_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfNotExists('job_listings', 'professional_skills_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfNotExists('job_listings', 'education_requirements', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_listings', 'experience_requirements', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_listings', 'fresh_graduates_eligible', 'INTEGER DEFAULT 0');
    addColumnIfNotExists('job_listings', 'benefits_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfNotExists('job_listings', 'application_instructions', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_listings', 'contact_email', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_listings', 'last_verified_at', "TEXT NOT NULL DEFAULT ''");

    addColumnIfNotExists('job_applications', 'recipient_email', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_applications', 'sender_email', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_applications', 'email_subject', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_applications', 'email_body', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_applications', 'sent_at', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_applications', 'delivery_status', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('job_applications', 'employer_responses_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfNotExists('job_applications', 'activity_timeline_json', "TEXT NOT NULL DEFAULT '[]'");

    addColumnIfNotExists('job_discovery_configs', 'auto_sync_enabled', 'INTEGER DEFAULT 1');
    addColumnIfNotExists('job_discovery_configs', 'next_sync_at', 'TEXT');

    addColumnIfNotExists('client_conversations', 'identified_requirements_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfNotExists('client_conversations', 'project_plan_json', "TEXT NOT NULL DEFAULT '{}'");
    addColumnIfNotExists('client_conversations', 'ai_handled', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfNotExists('client_conversations', 'last_ai_action', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('client_conversations', 'next_recommended_action', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('client_conversations', 'deal_notification_phone', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('client_conversations', 'deal_notification_status', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('client_conversations', 'deal_notification_text', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists('client_conversations', 'deal_notification_error', "TEXT NOT NULL DEFAULT ''");

    // Reconcile historical whatsapp_messages, restore any orphaned contacted leads, and clean dropped webhook IDs
    try {
      this.reconcileWhatsAppHistoryAndConversations();
    } catch {
      // non-fatal on startup
    }
  }

  /**
   * Ensures every contacted business in `whatsapp_messages` has a valid `Lead` record in `leads`
   * and its initial outreach message recorded in `conversation_messages`, and cleans up any
   * orphaned IDs in `processed_webhooks` that were previously dropped before saving.
   */
  public reconcileWhatsAppHistoryAndConversations(): void {
    // 1. Clean processed_webhooks entries that do not correspond to any saved conversation message
    this.db.exec(`
      DELETE FROM processed_webhooks
      WHERE message_id NOT IN (
        SELECT provider_message_id FROM conversation_messages WHERE provider_message_id <> ''
      )
    `);

    // 2. Restore any contacted lead in whatsapp_messages whose lead row was deleted
    const waRows = this.db
      .prepare('SELECT * FROM whatsapp_messages ORDER BY updated_at ASC')
      .all() as Array<{
      lead_id: string;
      business_name: string;
      number: string;
      status: WhatsAppStatus;
      message: string;
      provider_message_id: string;
      saved_at: string;
      updated_at: string;
      error: string;
    }>;

    for (const wm of waRows) {
      if (!wm.lead_id) continue;
      let lead = this.getLead(wm.lead_id);
      if (!lead && wm.number && wm.business_name) {
        if (!this.getRun('restored_whatsapp_outreach')) {
          this.createRun(
            'restored_whatsapp_outreach',
            {
              userName: 'Unitech Solution',
              company: 'Unitech Solution',
              userEmail: '',
              userPhone: '',
              portfolio: '',
              services: ['WhatsApp Automation', 'Website Development', 'AI Chatbot'],
              niche: 'Restored WhatsApp Outreach',
              area: 'Pakistan',
              country: 'Pakistan',
              maxLeads: 100,
              checkSocial: false,
              emailSummary: false,
            },
            wm.saved_at || wm.updated_at || new Date().toISOString(),
          );
        }
        const cleanDigits = wm.number.replace(/\D/g, '');
        const formattedPhone = cleanDigits ? `+${cleanDigits}` : wm.number;
        const reconstructed: Lead = {
          runId: 'restored_whatsapp_outreach',
          leadId: wm.lead_id,
          businessName: wm.business_name,
          category: 'Healthcare / Local Business',
          leadType: 'No Website',
          contactChannel: 'WhatsApp',
          website: '',
          email: '',
          phone: formattedPhone,
          whatsappLink: cleanDigits ? `https://wa.me/${cleanDigits}` : '',
          address: 'Pakistan',
          country: 'Pakistan',
          googleRating: 'N/A',
          googleReviews: 0,
          googleMapsUrl: '',
          locationStatus: 'Verified',
          locationVerified: true,
          leadScore: 78,
          priority: 'high',
          estimatedDealValue: '$400 - $800',
          recommendedServices: ['WhatsApp Automation', 'Website Development', 'AI Chatbot'],
          weaknesses: [
            'Potential delays in handling patient/client WhatsApp inquiries',
            'Limited online appointment booking and automated follow-up',
          ],
          analysisSummary: `Contacted via WhatsApp (${wm.business_name}). Opportunity for automated inquiry handling, online booking, and digital presence optimization.`,
          websiteScore: null,
          websiteStatus: 'No Website',
          websiteIssues: ['No dedicated online booking portal found'],
          websiteImages: [],
          techStack: [],
          social: {},
          socialActivity: {},
          socialStatus: 'Not checked',
          competitors: [],
          emailSubject: '',
          emailBodyText: '',
          emailBodyHtml: '',
          whatsappMessage: wm.message || '',
          approvalStatus: 'Sent',
          emailStatus: 'No Email',
          responseStatus: 'No Reply',
          senderName: 'Unitech Solution',
          searchQuery: wm.business_name,
          createdAt: wm.saved_at || wm.updated_at || new Date().toISOString(),
          emailSentAt: '',
          followUp1Date: '',
          followUp2Date: '',
          gmailThreadId: '',
          whatsappStatus: wm.status,
          whatsappRunId: wm.provider_message_id || '',
        };
        this.saveLead(reconstructed);
        lead = reconstructed;
      }

      // 3. Backfill initial outreach message from whatsapp_messages into conversation_messages if missing
      if (
        wm.message &&
        wm.message.trim() &&
        ['Sent', 'Delivered', 'Read', 'Played', 'Pending'].includes(wm.status)
      ) {
        const existingMsgs = this.getConversationMessages(wm.lead_id, 50);
        const alreadyExists = existingMsgs.some(
          (m) =>
            (wm.provider_message_id && m.providerMessageId === wm.provider_message_id) ||
            m.text.trim() === wm.message.trim(),
        );
        if (!alreadyExists) {
          const msgId = `out_sync_${wm.lead_id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const createdAt = wm.saved_at || wm.updated_at || new Date().toISOString();
          this.stmt(
            `INSERT INTO conversation_messages (id, lead_id, sender, text, status, provider_message_id, metadata_json, created_at)
             VALUES (?, ?, 'user', ?, ?, ?, ?, ?)`,
          ).run(
            msgId,
            wm.lead_id,
            wm.message.trim(),
            wm.status,
            wm.provider_message_id || '',
            JSON.stringify({ type: 'initial_outreach_synced' }),
            createdAt,
          );
        }
        const existingConv = this.stmt('SELECT lead_id FROM client_conversations WHERE lead_id = ?').get(wm.lead_id);
        if (!existingConv) {
          this.upsertClientConversation(wm.lead_id, {
            stage: 'contacted',
            lastMessageAt: wm.updated_at || wm.saved_at,
          });
        }
      }
    }
  }

  private stmt(sql: string): DatabaseDriver.Statement {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }

  createRun(runId: string, request: SearchRequest, createdAt: string): void {
    this.stmt('INSERT INTO runs (run_id, status, request_json, created_at) VALUES (?, ?, ?, ?)')
      .run(runId, 'queued', JSON.stringify(request), createdAt);
  }

  getRun(runId: string): RunRecord | null {
    const row = this.stmt('SELECT * FROM runs WHERE run_id = ?').get(runId) as StoredRun | undefined;
    if (!row) return null;
    return { runId: row.run_id, status: row.status, request: JSON.parse(row.request_json) as SearchRequest, message: row.message, total: row.total, createdAt: row.created_at, completedAt: row.completed_at };
  }

  listRuns(limit = 50): RunRecord[] {
    return (this.stmt('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?').all(limit) as StoredRun[]).map((row) => ({ runId: row.run_id, status: row.status, request: JSON.parse(row.request_json) as SearchRequest, message: row.message, total: row.total, createdAt: row.created_at, completedAt: row.completed_at }));
  }

  deleteRun(runId: string): boolean {
    const transaction = this.db.transaction(() => {
      this.stmt('DELETE FROM run_events WHERE run_id = ?').run(runId);
      this.stmt('DELETE FROM leads WHERE run_id = ?').run(runId);
      const res = this.stmt('DELETE FROM runs WHERE run_id = ?').run(runId);
      return res.changes > 0;
    });
    return transaction();
  }

  updateRun(runId: string, status: RunRecord['status'], message: string, total: number, completedAt: string | null = null): void {
    this.stmt('UPDATE runs SET status = ?, message = ?, total = ?, completed_at = ? WHERE run_id = ?').run(status, message, total, completedAt, runId);
  }

  appendEvent(runId: string, event: Omit<RunEvent, 'seq' | 'runId' | 'createdAt'>): number {
    const now = new Date().toISOString();
    const result = this.stmt('INSERT INTO run_events (run_id, type, stage, level, message, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(runId, event.type, event.stage, event.level, event.message, event.payload === undefined ? null : JSON.stringify(event.payload), now);
    return Number(result.lastInsertRowid);
  }

  events(runId: string, after = 0, limit = 500): RunEvent[] {
    const rows = this.stmt('SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?').all(runId, after, limit) as Array<{ seq: number; run_id: string; type: RunEvent['type']; stage: RunEvent['stage']; level: RunEvent['level']; message: string; payload_json: string | null; created_at: string }>;
    return rows.map((row) => ({ seq: row.seq, runId: row.run_id, type: row.type, stage: row.stage, level: row.level, message: row.message, payload: row.payload_json ? JSON.parse(row.payload_json) : undefined, createdAt: row.created_at }));
  }

  saveLead(lead: Lead): void {
    const domain = (() => { try { return new URL(lead.website).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } })();
    const phoneKey = lead.phone.replace(/\D/g, '').slice(-9);
    this.stmt(`INSERT INTO leads (run_id, lead_id, domain, phone_key, data_json) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(run_id, lead_id) DO UPDATE SET data_json = excluded.data_json, domain = excluded.domain, phone_key = excluded.phone_key`)
      .run(lead.runId, lead.leadId, domain, phoneKey, JSON.stringify(lead));
  }

  findDuplicate(leadId: string, domain: string, phoneKey: string): boolean {
    const row = this.stmt(`SELECT row_id FROM leads WHERE lead_id = ? OR (? <> '' AND domain = ?) OR (? <> '' AND phone_key = ?) LIMIT 1`).get(leadId, domain, domain, phoneKey, phoneKey);
    return Boolean(row);
  }

  getAllExistingLeadIdentifiers(): { ids: Set<string>; domains: Set<string>; phones: Set<string>; names: Set<string> } {
    const rows = this.stmt('SELECT lead_id, domain, phone_key, data_json FROM leads').all() as Array<{ lead_id: string; domain: string; phone_key: string; data_json: string }>;
    const ids = new Set<string>();
    const domains = new Set<string>();
    const phones = new Set<string>();
    const names = new Set<string>();
    for (const row of rows) {
      if (row.lead_id) ids.add(row.lead_id);
      if (row.domain) domains.add(row.domain);
      if (row.phone_key) phones.add(row.phone_key);
      try {
        const lead = JSON.parse(row.data_json) as { businessName?: string };
        if (lead.businessName) {
          const norm = lead.businessName.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (norm) names.add(norm);
        }
      } catch {}
    }
    return { ids, domains, phones, names };
  }

  getStats(): LeadStats {
    const runCount = (this.stmt('SELECT COUNT(*) as c FROM runs').get() as { c: number })?.c || 0;
    const rows = this.stmt('SELECT data_json FROM leads').all() as Array<{ data_json: string }>;
    const uniqueMap = new Map<string, Lead>();
    for (const row of rows) {
      try {
        const lead = JSON.parse(row.data_json) as Lead;
        const key = lead.leadId || lead.phone || lead.website || lead.businessName;
        if (key && !uniqueMap.has(key)) {
          uniqueMap.set(key, lead);
        }
      } catch {}
    }
    const uniqueLeads = Array.from(uniqueMap.values());
    let verified = 0;
    let withEmail = 0;
    let withPhone = 0;
    let noWebsite = 0;

    for (const lead of uniqueLeads) {
      if (lead.locationVerified !== false) verified++;
      if (lead.email) withEmail++;
      if (lead.phone) withPhone++;
      if (lead.leadType === 'No Website' || !lead.website) noWebsite++;
    }

    return {
      totalUniqueLeads: uniqueLeads.length,
      totalRuns: runCount,
      verifiedLeads: verified,
      leadsWithEmail: withEmail,
      leadsWithPhone: withPhone,
      noWebsiteLeads: noWebsite,
    };
  }

  deleteLead(leadId: string): boolean {
    const result = this.stmt('DELETE FROM leads WHERE lead_id = ?').run(leadId);
    return result.changes > 0;
  }

  listCustomServices(): CustomService[] {
    const rows = this.stmt('SELECT id, name, description, created_at FROM custom_services ORDER BY created_at ASC').all() as Array<{ id: string; name: string; description: string; created_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
    }));
  }

  createCustomService(name: string, description = ''): CustomService {
    const cleanName = name.trim();
    const id = `srv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const createdAt = new Date().toISOString();
    this.stmt('INSERT INTO custom_services (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(id, cleanName, description.trim(), createdAt);
    return { id, name: cleanName, description: description.trim(), createdAt };
  }

  deleteCustomService(id: string): boolean {
    const result = this.stmt('DELETE FROM custom_services WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getLead(leadId: string): Lead | null {
    const row = this.stmt('SELECT data_json FROM leads WHERE lead_id = ? ORDER BY row_id DESC LIMIT 1').get(leadId) as { data_json: string } | undefined;
    return row ? JSON.parse(row.data_json) as Lead : null;
  }

  getRunLeads(runId: string): Lead[] {
    return (this.stmt('SELECT data_json FROM leads WHERE run_id = ? ORDER BY row_id ASC').all(runId) as Array<{ data_json: string }>).map((row) => JSON.parse(row.data_json) as Lead);
  }

  updateLead(leadId: string, patch: Partial<Lead>): Lead | null {
    const lead = this.getLead(leadId);
    if (!lead) return null;
    const updated = { ...lead, ...patch };
    this.stmt('UPDATE leads SET data_json = ? WHERE lead_id = ?').run(JSON.stringify(updated), leadId);
    return updated;
  }

  getWhatsApp(leadId: string): WhatsAppRecord | null {
    const row = this.stmt('SELECT * FROM whatsapp_messages WHERE lead_id = ?').get(leadId) as { lead_id: string; business_name: string; number: string; status: WhatsAppStatus; message: string; provider_message_id: string; saved_at: string; updated_at: string; error: string } | undefined;
    return row ? { leadId: row.lead_id, businessName: row.business_name, number: row.number, status: row.status, message: row.message, providerMessageId: row.provider_message_id, savedAt: row.saved_at, updatedAt: row.updated_at, error: row.error } : null;
  }

  reserveWhatsApp(input: { leadId: string; businessName: string; number: string; message: string; resend: boolean }): { ok: true; record: WhatsAppRecord } | { ok: false; reason: string; record: WhatsAppRecord } {
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      const existing = this.getWhatsApp(input.leadId);
      if (existing && existing.businessName.toLowerCase() !== input.businessName.toLowerCase() && existing.number !== input.number) {
        return { ok: false as const, reason: 'Lead ID conflict: it is already associated with another business and number.', record: existing };
      }
      if (existing && !input.resend) {
        const ageMs = Date.now() - Date.parse(existing.updatedAt);
        if (existing.status === 'Sending' && ageMs < 180_000) return { ok: false as const, reason: 'A WhatsApp send for this lead is already in progress.', record: existing };
        if (['Pending', 'Sent', 'Delivered', 'Read', 'Played', 'Unconfirmed'].includes(existing.status)) return { ok: false as const, reason: `A previous WhatsApp message is ${existing.status}. Check the chat before resending.`, record: existing };
      }
      this.stmt(`INSERT INTO whatsapp_messages (lead_id, business_name, number, status, message, saved_at, updated_at, error)
        VALUES (?, ?, ?, 'Sending', ?, ?, ?, '')
        ON CONFLICT(lead_id) DO UPDATE SET business_name = excluded.business_name, number = excluded.number, status = 'Sending', message = excluded.message, updated_at = excluded.updated_at, error = ''`)
        .run(input.leadId, input.businessName, input.number, input.message.slice(0, 1500), existing?.savedAt || now, now);
      return { ok: true as const, record: this.getWhatsApp(input.leadId)! };
    });
    return transaction();
  }

  updateWhatsApp(leadId: string, patch: Partial<Pick<WhatsAppRecord, 'status' | 'providerMessageId' | 'error'>>): WhatsAppRecord | null {
    const now = new Date().toISOString();
    this.stmt('UPDATE whatsapp_messages SET status = COALESCE(?, status), provider_message_id = COALESCE(?, provider_message_id), error = COALESCE(?, error), updated_at = ? WHERE lead_id = ?')
      .run(patch.status ?? null, patch.providerMessageId ?? null, patch.error ?? null, now, leadId);
    const updated = this.getWhatsApp(leadId);
    if (
      updated &&
      updated.message &&
      updated.message.trim() &&
      ['Sent', 'Delivered', 'Read', 'Played', 'Pending'].includes(updated.status)
    ) {
      const existingMsgs = this.getConversationMessages(leadId, 50);
      const alreadyLogged = existingMsgs.some(
        (m) =>
          (updated.providerMessageId && m.providerMessageId === updated.providerMessageId) ||
          m.text.trim() === updated.message.trim(),
      );
      if (!alreadyLogged) {
        const msgId = `out_wa_${leadId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.stmt(
          `INSERT INTO conversation_messages (id, lead_id, sender, text, status, provider_message_id, metadata_json, created_at)
           VALUES (?, ?, 'user', ?, ?, ?, ?, ?)`,
        ).run(
          msgId,
          leadId,
          updated.message.trim(),
          updated.status,
          updated.providerMessageId || '',
          JSON.stringify({ type: 'outreach_message' }),
          updated.savedAt || now,
        );
        this.upsertClientConversation(leadId, {
          stage: 'contacted',
          lastMessageAt: now,
        });
      } else if (updated.providerMessageId) {
        this.updateConversationMessageStatus(updated.providerMessageId, updated.status);
      }
    }
    return updated;
  }

  findWhatsAppByProviderId(providerMessageId: string): WhatsAppRecord | null {
    const row = this.stmt('SELECT lead_id FROM whatsapp_messages WHERE provider_message_id = ?').get(providerMessageId) as { lead_id: string } | undefined;
    return row ? this.getWhatsApp(row.lead_id) : null;
  }

  recordEmail(leadId: string, to: string, subject: string, providerId: string): void {
    this.stmt('INSERT INTO email_sends (lead_id, to_address, subject, sent_at, provider_id) VALUES (?, ?, ?, ?, ?)').run(leadId, to, subject, new Date().toISOString(), providerId);
  }

  /**
   * Resolves a WhatsApp Linked Identity JID (`<lid>@lid`) to a real phone number using Baileys auth mappings stored in SQLite.
   */
  resolvePhoneFromLid(rawLidOrJid: string): string | null {
    if (!rawLidOrJid) return null;
    const base = rawLidOrJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!base) return null;

    // 1. Direct reverse mapping: lid-mapping-<lid>_reverse -> "<phone>"
    const reverseRow = this.stmt('SELECT value_json FROM baileys_auth WHERE key_id = ?').get(
      `lid-mapping-${base}_reverse`,
    ) as { value_json: string } | undefined;
    if (reverseRow?.value_json) {
      try {
        const parsed = JSON.parse(reverseRow.value_json);
        const digits = String(parsed || '').replace(/\D/g, '');
        if (digits.length >= 7) return digits;
      } catch {
        const digits = reverseRow.value_json.replace(/\D/g, '');
        if (digits.length >= 7) return digits;
      }
    }

    // 2. Forward mapping scan: lid-mapping-<phone> -> "<lid>"
    const forwardRow = this.stmt(
      "SELECT key_id FROM baileys_auth WHERE key_id LIKE 'lid-mapping-%' AND key_id NOT LIKE '%_reverse' AND value_json = ? LIMIT 1",
    ).get(`"${base}"`) as { key_id: string } | undefined;
    if (forwardRow?.key_id) {
      const digits = forwardRow.key_id.replace(/^lid-mapping-/, '').replace(/\D/g, '');
      if (digits.length >= 7) return digits;
    }

    return null;
  }

  /**
   * Saves a bidirectional WhatsApp LID <-> Phone mapping in SQLite `baileys_auth` so future `@lid` messages resolve immediately.
   */
  saveLidPhoneMapping(lidOrJid: string, phoneOrJid: string): void {
    const lidDigits = (lidOrJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    let phoneDigits = (phoneOrJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    if (phoneDigits.startsWith('00')) phoneDigits = phoneDigits.slice(2);
    if (phoneDigits.startsWith('0') && (phoneDigits.length === 10 || phoneDigits.length === 11)) {
      phoneDigits = '92' + phoneDigits.slice(1);
    }
    if (!lidDigits || !phoneDigits || lidDigits === phoneDigits) return;

    this.setBaileysAuthBatch([
      { keyId: `lid-mapping-${phoneDigits}`, valueJson: JSON.stringify(lidDigits) },
      { keyId: `lid-mapping-${lidDigits}_reverse`, valueJson: JSON.stringify(phoneDigits) },
    ]);
  }

  normalizePhoneDigits(raw: string): string {
    let digits = (raw || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && (digits.length === 10 || digits.length === 11)) {
      digits = '92' + digits.slice(1);
    }
    return digits;
  }

  getLeadIdByProviderMessageId(providerMessageId: string): string | null {
    if (!providerMessageId) return null;
    const msg = this.stmt('SELECT lead_id FROM conversation_messages WHERE provider_message_id = ? LIMIT 1').get(providerMessageId) as { lead_id: string } | undefined;
    if (msg?.lead_id) return msg.lead_id;
    const wa = this.stmt('SELECT lead_id FROM whatsapp_messages WHERE provider_message_id = ? LIMIT 1').get(providerMessageId) as { lead_id: string } | undefined;
    return wa?.lead_id || null;
  }

  findLeadByPhone(rawPhone: string): Lead | null {
    if (!rawPhone) return null;

    // Step 0: If rawPhone is a @lid JID or maps to a known LID in baileys_auth, resolve the real phone number first!
    const isLid = rawPhone.toLowerCase().includes('@lid');
    const resolvedFromLid = this.resolvePhoneFromLid(rawPhone);
    const effectivePhone = resolvedFromLid || (isLid ? '' : rawPhone);

    const digits = this.normalizePhoneDigits(effectivePhone || rawPhone);
    if (!digits) return null;

    // If rawPhone was an unresolved @lid, check if any lead was explicitly created for this @lid
    if (isLid && !resolvedFromLid) {
      const lidLeadId = `Lwa_lid_${digits}`;
      const existingLidLead = this.getLead(lidLeadId);
      if (existingLidLead) return existingLidLead;

      // Also check if any lead has whatsappLink containing this LID
      const allRowsForLid = this.stmt('SELECT data_json FROM leads ORDER BY row_id DESC').all() as Array<{ data_json: string }>;
      for (const r of allRowsForLid) {
        try {
          const l = JSON.parse(r.data_json) as Lead;
          if (l.whatsappLink && l.whatsappLink.includes(digits)) return l;
        } catch {}
      }
      return null;
    }

    const key10 = digits.slice(-10);
    const key9 = digits.slice(-9);
    const key8 = digits.slice(-8);
    const key7 = digits.slice(-7);

    // 1. Direct phone_key indexed lookup in leads
    let row = this.stmt('SELECT data_json FROM leads WHERE phone_key = ? ORDER BY row_id DESC LIMIT 1').get(key9) as { data_json: string } | undefined;
    if (!row && key8) {
      row = this.stmt(`SELECT data_json FROM leads WHERE phone_key LIKE ? ORDER BY row_id DESC LIMIT 1`).get(`%${key8}`) as { data_json: string } | undefined;
    }
    if (!row && key7) {
      row = this.stmt(`SELECT data_json FROM leads WHERE phone_key LIKE ? ORDER BY row_id DESC LIMIT 1`).get(`%${key7}`) as { data_json: string } | undefined;
    }
    if (row) {
      try { return JSON.parse(row.data_json) as Lead; } catch {}
    }

    // 2. Fallback search across all leads for matching normalized digits, trailing digits, or whatsappLink
    const allRows = this.stmt('SELECT data_json FROM leads ORDER BY row_id DESC').all() as Array<{ data_json: string }>;
    for (const r of allRows) {
      try {
        const l = JSON.parse(r.data_json) as Lead;
        const leadDigits = this.normalizePhoneDigits(l.phone || '');
        const waLinkDigits = this.normalizePhoneDigits(l.whatsappLink || '');
        if (leadDigits) {
          if (
            leadDigits === digits ||
            (key10.length >= 9 && leadDigits.endsWith(key10)) ||
            leadDigits.endsWith(key9) ||
            digits.endsWith(leadDigits.slice(-9))
          ) {
            return l;
          }
          if (key7 && leadDigits.length >= 7 && (leadDigits.endsWith(key7) || digits.endsWith(leadDigits.slice(-7)))) {
            return l;
          }
        }
        if (waLinkDigits && waLinkDigits.length >= 8 && (waLinkDigits.endsWith(key9) || digits.endsWith(waLinkDigits.slice(-9)))) {
          return l;
        }
      } catch {}
    }

    // 3. Check whatsapp_messages table (in case a lead was contacted previously)
    const waRows = this.stmt('SELECT * FROM whatsapp_messages ORDER BY updated_at DESC').all() as Array<{
      lead_id: string;
      business_name: string;
      number: string;
    }>;
    for (const wm of waRows) {
      const wmDigits = this.normalizePhoneDigits(wm.number || '');
      if (wmDigits && (wmDigits === digits || wmDigits.endsWith(key9) || (key8 && wmDigits.endsWith(key8)))) {
        const existingLead = this.getLead(wm.lead_id);
        if (existingLead) return existingLead;
        // Reconcile and restore if missing
        this.reconcileWhatsAppHistoryAndConversations();
        const restored = this.getLead(wm.lead_id);
        if (restored) return restored;
      }
    }

    // 4. Fallback check in client_conversations table
    const convRows = this.stmt('SELECT lead_id FROM client_conversations ORDER BY updated_at DESC').all() as Array<{ lead_id: string }>;
    for (const c of convRows) {
      const l = this.getLead(c.lead_id);
      if (l) {
        const leadDigits = this.normalizePhoneDigits(l.phone || '');
        if (leadDigits && key7 && (leadDigits.endsWith(key7) || digits.endsWith(leadDigits.slice(-7)))) {
          return l;
        }
      }
    }

    return null;
  }

  /**
   * Creates or retrieves an inbound WhatsApp contact record when a message arrives from a phone number or JID
   * that is not yet in the `leads` table, ensuring no incoming client message is ever discarded.
   */
  getOrCreateUnmatchedWhatsAppLead(input: {
    phone?: string;
    rawJid: string;
    pushName?: string;
  }): Lead {
    const resolvedPhone =
      (input.phone ? this.normalizePhoneDigits(input.phone) : '') ||
      this.resolvePhoneFromLid(input.rawJid) ||
      (!input.rawJid.toLowerCase().includes('@lid') ? this.normalizePhoneDigits(input.rawJid) : '');

    if (resolvedPhone) {
      const existing = this.findLeadByPhone(resolvedPhone);
      if (existing) return existing;
    } else {
      const existingByJid = this.findLeadByPhone(input.rawJid);
      if (existingByJid) return existingByJid;
    }

    const lidDigits = input.rawJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    const leadId = resolvedPhone ? `Lwa_${resolvedPhone}` : `Lwa_lid_${lidDigits || Date.now()}`;
    const existingDirect = this.getLead(leadId);
    if (existingDirect) {
      if (input.pushName && existingDirect.businessName.startsWith('Unmatched WhatsApp Contact')) {
        const updated = this.updateLead(leadId, {
          businessName: `${input.pushName.trim()} (WhatsApp Inquiry)`,
        });
        if (updated) return updated;
      }
      return existingDirect;
    }

    const now = new Date().toISOString();
    const displayPhone = resolvedPhone ? `+${resolvedPhone}` : input.rawJid;
    const cleanPushName = (input.pushName || '').trim();
    const businessName = cleanPushName
      ? `${cleanPushName} (WhatsApp Inquiry)`
      : resolvedPhone
      ? `Unmatched WhatsApp Contact (+${resolvedPhone})`
      : `Unmatched WhatsApp Sender (${lidDigits.slice(0, 10)})`;

    const customServices = this.listCustomServices().map((s) => s.name);
    const defaultServices = Array.from(
      new Set(['Website Development', 'WhatsApp Automation', 'AI Chatbot', 'SEO', ...customServices]),
    ).slice(0, 4);

    // Ensure the whatsapp_inbound run exists to satisfy the leads.run_id foreign key constraint
    const existingInboundRun = this.getRun('whatsapp_inbound');
    if (!existingInboundRun) {
      this.createRun(
        'whatsapp_inbound',
        {
          userName: 'Unitech Solution',
          company: 'Unitech Solution',
          userEmail: '',
          userPhone: '',
          portfolio: '',
          services: defaultServices,
          niche: 'Inbound WhatsApp Inquiries',
          area: 'WhatsApp',
          country: 'Pakistan',
          maxLeads: 100,
          checkSocial: false,
          emailSummary: false,
        },
        now,
      );
    }

    const newLead: Lead = {
      runId: 'whatsapp_inbound',
      leadId,
      businessName,
      category: 'Inbound WhatsApp Contact',
      leadType: 'No Website',
      contactChannel: 'WhatsApp',
      website: '',
      email: '',
      phone: displayPhone,
      whatsappLink: resolvedPhone ? `https://wa.me/${resolvedPhone}` : input.rawJid,
      address: 'Inbound WhatsApp',
      country: resolvedPhone.startsWith('92') ? 'Pakistan' : 'International',
      googleRating: 'N/A',
      googleReviews: 0,
      googleMapsUrl: '',
      locationStatus: 'Verified',
      locationVerified: true,
      leadScore: 80,
      priority: 'high',
      estimatedDealValue: '$400 - $800',
      recommendedServices: defaultServices,
      weaknesses: [
        'Inbound inquiry seeking digital services, automation, or business solutions',
      ],
      analysisSummary: `Inbound WhatsApp conversation initiated by ${businessName} (${displayPhone}). Unmatched with an existing scraped lead — you can handle directly or link to an existing lead.`,
      websiteScore: null,
      websiteStatus: 'Unverified',
      websiteIssues: [],
      websiteImages: [],
      techStack: [],
      social: {},
      socialActivity: {},
      socialStatus: 'Not checked',
      competitors: [],
      emailSubject: '',
      emailBodyText: '',
      emailBodyHtml: '',
      whatsappMessage: '',
      approvalStatus: 'Pending Review',
      emailStatus: 'No Email',
      responseStatus: 'Replied',
      senderName: 'Unitech Solution',
      searchQuery: 'Inbound WhatsApp',
      createdAt: now,
      emailSentAt: '',
      followUp1Date: '',
      followUp2Date: '',
      gmailThreadId: '',
      whatsappStatus: 'Read',
      whatsappRunId: '',
    };

    this.saveLead(newLead);
    this.upsertClientConversation(leadId, {
      stage: 'conversing',
      autoPilot: true,
      summary: newLead.analysisSummary,
      lastMessageAt: now,
    });

    return newLead;
  }

  /**
   * Associates an unmatched inbound WhatsApp conversation with an existing lead record,
   * migrating all conversation messages and preserving full history.
   */
  linkUnmatchedLeadToExisting(unmatchedLeadId: string, targetLeadId: string): ClientConversation {
    const targetLead = this.getLead(targetLeadId);
    if (!targetLead) {
      throw new Error(`Target lead ${targetLeadId} not found.`);
    }
    const unmatchedLead = this.getLead(unmatchedLeadId);
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      // Move all messages from unmatchedLeadId to targetLeadId
      this.stmt('UPDATE conversation_messages SET lead_id = ? WHERE lead_id = ?').run(
        targetLeadId,
        unmatchedLeadId,
      );

      // If target lead had no phone or needed whatsappLink update, preserve it
      if (unmatchedLead?.phone && !targetLead.phone) {
        this.updateLead(targetLeadId, { phone: unmatchedLead.phone });
      }

      // Remove temporary unmatched conversation and lead row
      this.stmt('DELETE FROM client_conversations WHERE lead_id = ?').run(unmatchedLeadId);
      if (unmatchedLeadId.startsWith('Lwa_')) {
        this.stmt('DELETE FROM leads WHERE lead_id = ?').run(unmatchedLeadId);
      }

      this.upsertClientConversation(targetLeadId, {
        stage: 'conversing',
        lastMessageAt: now,
      });
    });

    tx();
    return this.getClientConversation(targetLeadId)!;
  }

  isWebhookProcessed(messageId: string): boolean {
    if (!messageId) return false;
    const row = this.stmt('SELECT message_id FROM processed_webhooks WHERE message_id = ?').get(messageId);
    return Boolean(row);
  }

  markWebhookProcessed(messageId: string): void {
    if (!messageId) return;
    const now = new Date().toISOString();
    this.stmt('INSERT OR IGNORE INTO processed_webhooks (message_id, processed_at) VALUES (?, ?)').run(messageId, now);
  }

  getConversationMessages(leadId: string, limit = 200): ConversationMessage[] {
    const rows = this.stmt(
      'SELECT id, lead_id, sender, text, status, provider_message_id, metadata_json, created_at FROM conversation_messages WHERE lead_id = ? ORDER BY created_at ASC LIMIT ?'
    ).all(leadId, limit) as Array<{
      id: string;
      lead_id: string;
      sender: 'client' | 'assistant' | 'user';
      text: string;
      status: WhatsAppStatus;
      provider_message_id: string;
      metadata_json: string | null;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      leadId: r.lead_id,
      sender: r.sender,
      text: r.text,
      status: r.status,
      providerMessageId: r.provider_message_id,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
      timestamp: r.created_at,
    }));
  }

  addConversationMessage(msg: ConversationMessage): void {
    const now = msg.timestamp || new Date().toISOString();
    // Prevent duplicate insertions for the same WhatsApp provider_message_id
    if (msg.providerMessageId && msg.providerMessageId.trim()) {
      const existing = this.stmt(
        'SELECT id FROM conversation_messages WHERE provider_message_id = ? AND lead_id = ? LIMIT 1',
      ).get(msg.providerMessageId.trim(), msg.leadId) as { id: string } | undefined;
      if (existing) {
        return;
      }
    }

    const metaJson = msg.metadata ? JSON.stringify(msg.metadata) : null;
    this.stmt(
      `INSERT OR IGNORE INTO conversation_messages (id, lead_id, sender, text, status, provider_message_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      msg.id,
      msg.leadId,
      msg.sender,
      msg.text,
      msg.status || 'Sent',
      msg.providerMessageId || '',
      metaJson,
      now
    );

    const existingConv = this.stmt('SELECT stage FROM client_conversations WHERE lead_id = ?').get(msg.leadId) as { stage: ClientStage } | undefined;
    const currentStage = existingConv?.stage || 'new';
    const advancedStages: ClientStage[] = ['interested', 'proposal_pending', 'negotiating', 'closed_won', 'needs_human', 'opted_out'];

    let nextStage: ClientStage = currentStage;
    if (!advancedStages.includes(currentStage)) {
      nextStage =
        msg.sender === 'assistant' || msg.sender === 'user'
          ? ('awaiting_reply' as ClientStage)
          : ('conversing' as ClientStage);
    } else if (msg.sender === 'client' && currentStage === 'awaiting_reply') {
      nextStage = 'conversing';
    }

    // Update conversation last_message_at and stage if needed
    this.upsertClientConversation(msg.leadId, {
      lastMessageAt: now,
      stage: nextStage,
    });
  }

  updateConversationMessageStatus(providerMessageId: string, status: WhatsAppStatus): boolean {
    if (!providerMessageId) return false;
    const res = this.stmt('UPDATE conversation_messages SET status = ? WHERE provider_message_id = ?').run(status, providerMessageId);
    return res.changes > 0;
  }

  updateConversationMessageMetadata(id: string, metadata: Record<string, unknown>): boolean {
    if (!id) return false;
    const existing = this.stmt('SELECT metadata_json FROM conversation_messages WHERE id = ?').get(id) as
      | { metadata_json: string | null }
      | undefined;
    if (!existing) return false;
    let currentMeta: Record<string, unknown> = {};
    if (existing.metadata_json) {
      try {
        currentMeta = JSON.parse(existing.metadata_json);
      } catch {
        // ignore
      }
    }
    const updatedMeta = { ...currentMeta, ...metadata };
    const res = this.stmt('UPDATE conversation_messages SET metadata_json = ? WHERE id = ?').run(
      JSON.stringify(updatedMeta),
      id
    );
    return res.changes > 0;
  }

  getUnrepliedClientMessages(leadId: string): ConversationMessage[] {
    const messages = this.getConversationMessages(leadId, 200);
    if (!messages || messages.length === 0) return [];

    // Find the index of the last assistant or user message
    let lastOutboundIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === 'assistant' || messages[i].sender === 'user') {
        lastOutboundIndex = i;
        break;
      }
    }

    // Any client messages that appear after the last outbound message are unreplied
    const unreplied: ConversationMessage[] = [];
    for (let i = lastOutboundIndex + 1; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.sender === 'client') {
        if (msg.metadata?.answered !== true) {
          unreplied.push(msg);
        }
      }
    }

    return unreplied;
  }

  setLastActiveTimestamp(ts?: string): void {
    const now = ts || new Date().toISOString();
    this.setSetting('whatsapp_last_active_at', now);
  }

  getLastActiveTimestamp(): string | null {
    return this.getSetting('whatsapp_last_active_at');
  }

  getClientConversation(leadId: string): ClientConversation | null {
    const lead = this.getLead(leadId);
    if (!lead) return null;

    const row = this.stmt('SELECT * FROM client_conversations WHERE lead_id = ?').get(leadId) as any;
    const messages = this.getConversationMessages(leadId);

    if (!row) {
      // Auto-initialize from lead record
      const wa = this.getWhatsApp(leadId);
      const initialStage: ClientStage = wa ? 'contacted' : 'new';
      const now = new Date().toISOString();
      const newConv: ClientConversation = {
        leadId,
        businessName: lead.businessName,
        phone: lead.phone,
        stage: initialStage,
        autoPilot: true,
        agreedServices: [],
        agreedPrice: '',
        agreedTimeline: '',
        agreedDeliverables: '',
        dealNotes: '',
        closedAt: null,
        closingNotifiedAt: null,
        humanInterventionReason: '',
        nextFollowUpAt: null,
        followUpCount: 0,
        optedOut: false,
        summary: lead.analysisSummary || '',
        lastMessageAt: wa?.updatedAt || lead.createdAt || now,
        createdAt: lead.createdAt || now,
        updatedAt: now,
        lead,
        messages,
      };
      this.upsertClientConversation(leadId, newConv);
      return newConv;
    }

    return {
      leadId: row.lead_id,
      businessName: lead.businessName,
      phone: lead.phone,
      stage: row.stage as ClientStage,
      autoPilot: Boolean(row.auto_pilot),
      agreedServices: JSON.parse(row.agreed_services_json || '[]'),
      agreedPrice: row.agreed_price || '',
      agreedTimeline: row.agreed_timeline || '',
      agreedDeliverables: row.agreed_deliverables || '',
      dealNotes: row.deal_notes || '',
      closedAt: row.closed_at || null,
      closingNotifiedAt: row.closing_notified_at || null,
      humanInterventionReason: row.human_intervention_reason || '',
      nextFollowUpAt: row.next_follow_up_at || null,
      followUpCount: Number(row.follow_up_count) || 0,
      optedOut: Boolean(row.opted_out),
      summary: row.summary || lead.analysisSummary || '',
      identifiedRequirements: JSON.parse(row.identified_requirements_json || '[]'),
      projectPlan: JSON.parse(row.project_plan_json || '{}'),
      aiHandled: Boolean(row.ai_handled),
      lastAiAction: row.last_ai_action || '',
      nextRecommendedAction: row.next_recommended_action || '',
      dealNotificationPhone: row.deal_notification_phone || '',
      dealNotificationStatus: row.deal_notification_status || '',
      dealNotificationText: row.deal_notification_text || '',
      dealNotificationError: row.deal_notification_error || '',
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lead,
      messages,
    };
  }

  upsertClientConversation(leadId: string, patch: Partial<ClientConversation>): ClientConversation {
    const existing = this.stmt('SELECT * FROM client_conversations WHERE lead_id = ?').get(leadId) as any;
    const now = new Date().toISOString();
    const lead = this.getLead(leadId);

    if (!existing) {
      const wa = this.getWhatsApp(leadId);
      const stage = patch.stage || (wa ? 'contacted' : 'new');
      const autoPilot = patch.autoPilot !== undefined ? (patch.autoPilot ? 1 : 0) : 1;
      const agreedServices = JSON.stringify(patch.agreedServices || []);
      const price = patch.agreedPrice || '';
      const timeline = patch.agreedTimeline || '';
      const deliverables = patch.agreedDeliverables || '';
      const notes = patch.dealNotes || '';
      const closedAt = patch.closedAt || null;
      const closingNotifiedAt = patch.closingNotifiedAt || null;
      const humanReason = patch.humanInterventionReason || '';
      const nextFollowUp = patch.nextFollowUpAt || null;
      const followUpCount = patch.followUpCount || 0;
      const optedOut = patch.optedOut ? 1 : 0;
      const summary = patch.summary || lead?.analysisSummary || '';
      const identifiedReqs = JSON.stringify(patch.identifiedRequirements || []);
      const projectPlan = JSON.stringify(patch.projectPlan || {});
      const aiHandled = patch.aiHandled ? 1 : 0;
      const lastAiAction = patch.lastAiAction || '';
      const nextRecAction = patch.nextRecommendedAction || '';
      const notifPhone = patch.dealNotificationPhone || '';
      const notifStatus = patch.dealNotificationStatus || '';
      const notifText = patch.dealNotificationText || '';
      const notifError = patch.dealNotificationError || '';
      const lastMsgAt = patch.lastMessageAt || wa?.updatedAt || lead?.createdAt || now;

      this.stmt(`
        INSERT INTO client_conversations (
          lead_id, stage, auto_pilot, agreed_services_json, agreed_price, agreed_timeline,
          agreed_deliverables, deal_notes, closed_at, closing_notified_at, human_intervention_reason,
          next_follow_up_at, follow_up_count, opted_out, summary,
          identified_requirements_json, project_plan_json, ai_handled, last_ai_action,
          next_recommended_action, deal_notification_phone, deal_notification_status,
          deal_notification_text, deal_notification_error,
          last_message_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        leadId, stage, autoPilot, agreedServices, price, timeline,
        deliverables, notes, closedAt, closingNotifiedAt, humanReason,
        nextFollowUp, followUpCount, optedOut, summary,
        identifiedReqs, projectPlan, aiHandled, lastAiAction,
        nextRecAction, notifPhone, notifStatus, notifText, notifError,
        lastMsgAt, lead?.createdAt || now, now
      );
    } else {
      const stage = patch.stage ?? existing.stage;
      const autoPilot = patch.autoPilot !== undefined ? (patch.autoPilot ? 1 : 0) : existing.auto_pilot;
      const agreedServices = patch.agreedServices !== undefined ? JSON.stringify(patch.agreedServices) : existing.agreed_services_json;
      const price = patch.agreedPrice ?? existing.agreed_price;
      const timeline = patch.agreedTimeline ?? existing.agreed_timeline;
      const deliverables = patch.agreedDeliverables ?? existing.agreed_deliverables;
      const notes = patch.dealNotes ?? existing.deal_notes;
      const closedAt = patch.closedAt !== undefined ? patch.closedAt : existing.closed_at;
      const closingNotifiedAt = patch.closingNotifiedAt !== undefined ? patch.closingNotifiedAt : existing.closing_notified_at;
      const humanReason = patch.humanInterventionReason ?? existing.human_intervention_reason;
      const nextFollowUp = patch.nextFollowUpAt !== undefined ? patch.nextFollowUpAt : existing.next_follow_up_at;
      const followUpCount = patch.followUpCount ?? existing.follow_up_count;
      const optedOut = patch.optedOut !== undefined ? (patch.optedOut ? 1 : 0) : existing.opted_out;
      const summary = patch.summary ?? existing.summary;
      const identifiedReqs = patch.identifiedRequirements !== undefined ? JSON.stringify(patch.identifiedRequirements) : (existing.identified_requirements_json || '[]');
      const projectPlan = patch.projectPlan !== undefined ? JSON.stringify(patch.projectPlan) : (existing.project_plan_json || '{}');
      const aiHandled = patch.aiHandled !== undefined ? (patch.aiHandled ? 1 : 0) : (existing.ai_handled ?? 0);
      const lastAiAction = patch.lastAiAction !== undefined ? patch.lastAiAction : (existing.last_ai_action || '');
      const nextRecAction = patch.nextRecommendedAction !== undefined ? patch.nextRecommendedAction : (existing.next_recommended_action || '');
      const notifPhone = patch.dealNotificationPhone !== undefined ? patch.dealNotificationPhone : (existing.deal_notification_phone || '');
      const notifStatus = patch.dealNotificationStatus !== undefined ? patch.dealNotificationStatus : (existing.deal_notification_status || '');
      const notifText = patch.dealNotificationText !== undefined ? patch.dealNotificationText : (existing.deal_notification_text || '');
      const notifError = patch.dealNotificationError !== undefined ? patch.dealNotificationError : (existing.deal_notification_error || '');
      const lastMsgAt = patch.lastMessageAt ?? existing.last_message_at;

      this.stmt(`
        UPDATE client_conversations SET
          stage = ?, auto_pilot = ?, agreed_services_json = ?, agreed_price = ?,
          agreed_timeline = ?, agreed_deliverables = ?, deal_notes = ?, closed_at = ?,
          closing_notified_at = ?, human_intervention_reason = ?, next_follow_up_at = ?,
          follow_up_count = ?, opted_out = ?, summary = ?,
          identified_requirements_json = ?, project_plan_json = ?, ai_handled = ?,
          last_ai_action = ?, next_recommended_action = ?, deal_notification_phone = ?,
          deal_notification_status = ?, deal_notification_text = ?, deal_notification_error = ?,
          last_message_at = ?, updated_at = ?
        WHERE lead_id = ?
      `).run(
        stage, autoPilot, agreedServices, price, timeline,
        deliverables, notes, closedAt, closingNotifiedAt, humanReason,
        nextFollowUp, followUpCount, optedOut, summary,
        identifiedReqs, projectPlan, aiHandled, lastAiAction,
        nextRecAction, notifPhone, notifStatus, notifText, notifError,
        lastMsgAt, now, leadId
      );
    }

    return this.getClientConversation(leadId)!;
  }

  listClientConversations(filterStage?: string, search?: string): ClientConversation[] {
    const leadRows = this.stmt('SELECT data_json FROM leads ORDER BY row_id DESC').all() as Array<{ data_json: string }>;
    const convRows = this.stmt('SELECT * FROM client_conversations').all() as any[];
    const convMap = new Map<string, any>();
    for (const c of convRows) {
      convMap.set(c.lead_id, c);
    }

    const uniqueLeads = new Map<string, Lead>();
    for (const r of leadRows) {
      try {
        const l = JSON.parse(r.data_json) as Lead;
        if (l.leadId && !uniqueLeads.has(l.leadId)) {
          uniqueLeads.set(l.leadId, l);
        }
      } catch {}
    }

    // Batch-load all conversation messages so every client card has its latest message preview & count
    const allMsgRows = this.stmt(
      'SELECT id, lead_id, sender, text, status, provider_message_id, metadata_json, created_at FROM conversation_messages ORDER BY created_at ASC',
    ).all() as Array<{
      id: string;
      lead_id: string;
      sender: 'client' | 'assistant' | 'user';
      text: string;
      status: WhatsAppStatus;
      provider_message_id: string;
      metadata_json: string | null;
      created_at: string;
    }>;
    const msgsByLead = new Map<string, ConversationMessage[]>();
    for (const r of allMsgRows) {
      let arr = msgsByLead.get(r.lead_id);
      if (!arr) {
        arr = [];
        msgsByLead.set(r.lead_id, arr);
      }
      arr.push({
        id: r.id,
        leadId: r.lead_id,
        sender: r.sender,
        text: r.text,
        status: r.status,
        providerMessageId: r.provider_message_id,
        metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
        timestamp: r.created_at,
      });
    }

    const result: ClientConversation[] = [];
    const q = search ? search.trim().toLowerCase() : '';

    for (const [leadId, lead] of uniqueLeads.entries()) {
      const messages = msgsByLead.get(leadId) || [];
      if (q) {
        const matchesName = lead.businessName?.toLowerCase().includes(q);
        const matchesCategory = lead.category?.toLowerCase().includes(q);
        const matchesCity = lead.address?.toLowerCase().includes(q);
        const matchesPhone = lead.phone?.toLowerCase().includes(q);
        const matchesMsg = messages.some((m) => m.text?.toLowerCase().includes(q));
        if (!matchesName && !matchesCategory && !matchesCity && !matchesPhone && !matchesMsg) continue;
      }

      const c = convMap.get(leadId);
      const wa = this.getWhatsApp(leadId);
      const hasClientReply = messages.some((m) => m.sender === 'client');
      const stage: ClientStage = c
        ? (c.stage as ClientStage)
        : hasClientReply
        ? 'conversing'
        : wa || messages.length > 0
        ? 'contacted'
        : 'new';

      if (filterStage && filterStage !== 'all' && stage !== filterStage) {
        continue;
      }

      const latestMsgTime = messages.length > 0 ? messages[messages.length - 1].timestamp : '';
      const rawLastMessageAt = c ? c.last_message_at : (wa?.updatedAt || lead.createdAt || new Date().toISOString());
      const lastMessageAt =
        latestMsgTime && new Date(latestMsgTime).getTime() > new Date(rawLastMessageAt).getTime()
          ? latestMsgTime
          : rawLastMessageAt;

      const conv: ClientConversation = {
        leadId,
        businessName: lead.businessName,
        phone: lead.phone,
        stage,
        autoPilot: c ? Boolean(c.auto_pilot) : true,
        agreedServices: c ? JSON.parse(c.agreed_services_json || '[]') : [],
        agreedPrice: c ? c.agreed_price : '',
        agreedTimeline: c ? c.agreed_timeline : '',
        agreedDeliverables: c ? c.agreed_deliverables : '',
        dealNotes: c ? c.deal_notes : '',
        closedAt: c ? c.closed_at : null,
        closingNotifiedAt: c ? c.closing_notified_at : null,
        humanInterventionReason: c ? c.human_intervention_reason : '',
        nextFollowUpAt: c ? c.next_follow_up_at : null,
        followUpCount: c ? Number(c.follow_up_count) : 0,
        optedOut: c ? Boolean(c.opted_out) : false,
        summary: c ? c.summary : (lead.analysisSummary || ''),
        identifiedRequirements: c && c.identified_requirements_json ? JSON.parse(c.identified_requirements_json) : [],
        projectPlan: c && c.project_plan_json && c.project_plan_json !== '{}' ? JSON.parse(c.project_plan_json) : null,
        aiHandled: c ? Boolean(c.ai_handled) : false,
        lastAiAction: c ? c.last_ai_action : '',
        nextRecommendedAction: c ? c.next_recommended_action : '',
        dealNotificationPhone: c ? c.deal_notification_phone : '',
        dealNotificationStatus: c ? c.deal_notification_status : '',
        dealNotificationText: c ? c.deal_notification_text : '',
        dealNotificationError: c ? c.deal_notification_error : '',
        lastMessageAt,
        createdAt: c ? c.created_at : lead.createdAt,
        updatedAt: c ? c.updated_at : lead.createdAt,
        lead,
        messages,
      };
      result.push(conv);
    }

    // Sort by most recent interaction first
    return result.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  }

  getClientHandlerStats(): ClientHandlerStats {
    const clients = this.listClientConversations();
    let newLeads = 0;
    let contacted = 0;
    let awaitingReply = 0;
    let activeConversations = 0;
    let negotiating = 0;
    let closedWon = 0;
    let needsHuman = 0;
    let optedOut = 0;
    let aiHandledCount = 0;
    let requirementsIdentifiedCount = 0;
    let projectSummariesCount = 0;

    for (const c of clients) {
      if (c.stage === 'new') newLeads++;
      else if (c.stage === 'contacted') contacted++;
      else if (c.stage === 'awaiting_reply') awaitingReply++;
      else if (c.stage === 'conversing' || c.stage === 'interested') activeConversations++;
      else if (c.stage === 'proposal_pending' || c.stage === 'negotiating') negotiating++;
      else if (c.stage === 'closed_won') closedWon++;
      else if (c.stage === 'needs_human') needsHuman++;
      else if (c.stage === 'opted_out' || c.stage === 'lost') optedOut++;

      if (c.aiHandled) aiHandledCount++;
      if (c.identifiedRequirements && c.identifiedRequirements.length > 0) requirementsIdentifiedCount++;
      if (c.projectPlan && (c.projectPlan.services?.length || c.projectPlan.deliverables)) projectSummariesCount++;
    }

    let totalIncomingMessages = 0;
    let totalOutgoingMessages = 0;
    try {
      const incomingRow = this.stmt("SELECT COUNT(*) as count FROM conversation_messages WHERE sender = 'client'").get() as any;
      totalIncomingMessages = incomingRow ? Number(incomingRow.count) : 0;
      const outgoingRow = this.stmt("SELECT COUNT(*) as count FROM conversation_messages WHERE sender IN ('assistant', 'user')").get() as any;
      totalOutgoingMessages = outgoingRow ? Number(outgoingRow.count) : 0;
    } catch {}

    return {
      totalClients: clients.length,
      newLeads,
      contacted,
      awaitingReply,
      activeConversations,
      negotiating,
      closedWon,
      needsHuman,
      optedOut,
      totalIncomingMessages,
      totalOutgoingMessages,
      aiHandledCount,
      requirementsIdentifiedCount,
      projectSummariesCount,
    };
  }

  getSetting(key: string): string | null {
    const row = this.stmt('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    const now = new Date().toISOString();
    this.stmt(
      'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(key, value, now);
  }

  getAllSettings(): Record<string, string> {
    const rows = this.stmt('SELECT key, value FROM system_settings').all() as Array<{ key: string; value: string }>;
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }

  // Baileys SQLite Auth State Storage
  getBaileysAuth(keyId: string): string | null {
    const row = this.stmt('SELECT value_json FROM baileys_auth WHERE key_id = ?').get(keyId) as { value_json: string } | undefined;
    return row ? row.value_json : null;
  }

  getBaileysAuthMultiple(keyIds: string[]): Array<{ key_id: string; value_json: string }> {
    if (keyIds.length === 0) return [];
    const placeholders = keyIds.map(() => '?').join(',');
    return this.stmt(`SELECT key_id, value_json FROM baileys_auth WHERE key_id IN (${placeholders})`).all(...keyIds) as Array<{ key_id: string; value_json: string }>;
  }

  setBaileysAuth(keyId: string, valueJson: string): void {
    const now = new Date().toISOString();
    this.stmt(`INSERT INTO baileys_auth (key_id, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key_id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`).run(keyId, valueJson, now);
  }

  setBaileysAuthBatch(items: Array<{ keyId: string; valueJson: string }>): void {
    if (items.length === 0) return;
    const now = new Date().toISOString();
    const insert = this.stmt(`INSERT INTO baileys_auth (key_id, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key_id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`);
    const tx = this.db.transaction((records: Array<{ keyId: string; valueJson: string }>) => {
      for (const r of records) {
        insert.run(r.keyId, r.valueJson, now);
      }
    });
    tx(items);
  }

  deleteBaileysAuth(keyId: string): void {
    this.stmt('DELETE FROM baileys_auth WHERE key_id = ?').run(keyId);
  }

  deleteBaileysAuthBatch(keyIds: string[]): void {
    if (keyIds.length === 0) return;
    const placeholders = keyIds.map(() => '?').join(',');
    this.stmt(`DELETE FROM baileys_auth WHERE key_id IN (${placeholders})`).run(...keyIds);
  }

  clearBaileysAuth(): void {
    this.stmt('DELETE FROM baileys_auth').run();
  }

  hasBaileysAuth(): boolean {
    const row = this.stmt("SELECT 1 FROM baileys_auth WHERE key_id = 'creds' LIMIT 1").get();
    return Boolean(row);
  }

  updateWhatsAppStatusByProviderId(providerMessageId: string, status: WhatsAppStatus, error?: string): boolean {
    if (!providerMessageId) return false;
    const row = this.findWhatsAppByProviderId(providerMessageId);
    if (row) {
      this.updateWhatsApp(row.leadId, { status, ...(error !== undefined ? { error } : {}) });
      this.updateLead(row.leadId, { whatsappStatus: status });
    }
    const updatedConvMsg = this.updateConversationMessageStatus(providerMessageId, status);
    return Boolean(row) || updatedConvMsg;
  }

  // ==========================================
  // Career Profile Methods
  // ==========================================

  getCareerProfile(userId = 'default'): CareerProfile | null {
    let row = this.stmt('SELECT * FROM career_profiles WHERE user_id = ? LIMIT 1').get(userId) as any;
    if (!row) {
      row = this.stmt('SELECT * FROM career_profiles ORDER BY updated_at DESC LIMIT 1').get() as any;
    }
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      location: row.location,
      preferredLocations: JSON.parse(row.preferred_locations_json || '[]'),
      summary: row.summary,
      skills: JSON.parse(row.skills_json || '[]'),
      professionalSkills: JSON.parse(row.professional_skills_json || '[]'),
      experience: JSON.parse(row.experience_json || '[]'),
      internships: JSON.parse(row.internships_json || '[]'),
      education: JSON.parse(row.education_json || '[]'),
      certifications: JSON.parse(row.certifications_json || '[]'),
      projects: JSON.parse(row.projects_json || '[]'),
      portfolioLinks: JSON.parse(row.portfolio_links_json || '[]'),
      socialAccounts: JSON.parse(row.social_accounts_json || '[]'),
      languages: JSON.parse(row.languages_json || '[]'),
      targetRoles: JSON.parse(row.target_roles_json || '[]'),
      employmentTypes: JSON.parse(row.employment_types_json || '[]'),
      remotePreference: row.remote_preference || 'Remote',
      minSalary: row.min_salary || '',
      visaStatus: row.visa_status || 'Citizen / Permanent Resident',
      photoUrl: row.photo_url || '',
      includePhotoInResume: row.include_photo_in_resume === undefined || row.include_photo_in_resume === null ? true : Boolean(row.include_photo_in_resume),
      updatedAt: row.updated_at,
    };
  }

  upsertCareerProfile(profile: Partial<CareerProfile> & { userId?: string }): CareerProfile {
    const userId = profile.userId || 'default';
    const existing = this.getCareerProfile(userId);
    const id = existing?.id || `profile_${Date.now()}`;
    const now = new Date().toISOString();

    const merged: CareerProfile = {
      id,
      userId,
      fullName: profile.fullName !== undefined ? profile.fullName : existing?.fullName || '',
      email: profile.email !== undefined ? profile.email : existing?.email || '',
      phone: profile.phone !== undefined ? profile.phone : existing?.phone || '',
      location: profile.location !== undefined ? profile.location : existing?.location || '',
      preferredLocations: profile.preferredLocations !== undefined ? profile.preferredLocations : existing?.preferredLocations || [],
      summary: profile.summary !== undefined ? profile.summary : existing?.summary || '',
      skills: profile.skills !== undefined ? profile.skills : existing?.skills || [],
      professionalSkills: profile.professionalSkills !== undefined ? profile.professionalSkills : existing?.professionalSkills || [],
      experience: profile.experience !== undefined ? profile.experience : existing?.experience || [],
      internships: profile.internships !== undefined ? profile.internships : existing?.internships || [],
      education: profile.education !== undefined ? profile.education : existing?.education || [],
      certifications: profile.certifications !== undefined ? profile.certifications : existing?.certifications || [],
      projects: profile.projects !== undefined ? profile.projects : existing?.projects || [],
      portfolioLinks: profile.portfolioLinks !== undefined ? profile.portfolioLinks : existing?.portfolioLinks || [],
      socialAccounts: profile.socialAccounts !== undefined ? profile.socialAccounts : existing?.socialAccounts || [],
      languages: profile.languages !== undefined ? profile.languages : existing?.languages || [],
      targetRoles: profile.targetRoles !== undefined ? profile.targetRoles : existing?.targetRoles || [],
      employmentTypes: profile.employmentTypes !== undefined ? profile.employmentTypes : existing?.employmentTypes || [],
      remotePreference: profile.remotePreference !== undefined ? profile.remotePreference : existing?.remotePreference || 'Remote',
      minSalary: profile.minSalary !== undefined ? profile.minSalary : existing?.minSalary || '',
      visaStatus: profile.visaStatus !== undefined ? profile.visaStatus : existing?.visaStatus || 'Citizen / Permanent Resident',
      photoUrl: profile.photoUrl !== undefined ? profile.photoUrl : existing?.photoUrl || '',
      includePhotoInResume: profile.includePhotoInResume !== undefined ? profile.includePhotoInResume : (existing?.includePhotoInResume ?? true),
      updatedAt: now,
    };

    this.stmt(`INSERT INTO career_profiles (
      id, user_id, full_name, email, phone, location, preferred_locations_json,
      summary, skills_json, professional_skills_json, experience_json, internships_json,
      education_json, certifications_json, projects_json, portfolio_links_json,
      social_accounts_json, languages_json, target_roles_json, employment_types_json,
      remote_preference, min_salary, visa_status, photo_url, include_photo_in_resume, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      full_name = excluded.full_name,
      email = excluded.email,
      phone = excluded.phone,
      location = excluded.location,
      preferred_locations_json = excluded.preferred_locations_json,
      summary = excluded.summary,
      skills_json = excluded.skills_json,
      professional_skills_json = excluded.professional_skills_json,
      experience_json = excluded.experience_json,
      internships_json = excluded.internships_json,
      education_json = excluded.education_json,
      certifications_json = excluded.certifications_json,
      projects_json = excluded.projects_json,
      portfolio_links_json = excluded.portfolio_links_json,
      social_accounts_json = excluded.social_accounts_json,
      languages_json = excluded.languages_json,
      target_roles_json = excluded.target_roles_json,
      employment_types_json = excluded.employment_types_json,
      remote_preference = excluded.remote_preference,
      min_salary = excluded.min_salary,
      visa_status = excluded.visa_status,
      photo_url = excluded.photo_url,
      include_photo_in_resume = excluded.include_photo_in_resume,
      updated_at = excluded.updated_at
    `).run(
      merged.id,
      merged.userId,
      merged.fullName,
      merged.email,
      merged.phone,
      merged.location,
      JSON.stringify(merged.preferredLocations),
      merged.summary,
      JSON.stringify(merged.skills),
      JSON.stringify(merged.professionalSkills),
      JSON.stringify(merged.experience),
      JSON.stringify(merged.internships),
      JSON.stringify(merged.education),
      JSON.stringify(merged.certifications),
      JSON.stringify(merged.projects),
      JSON.stringify(merged.portfolioLinks),
      JSON.stringify(merged.socialAccounts || []),
      JSON.stringify(merged.languages),
      JSON.stringify(merged.targetRoles),
      JSON.stringify(merged.employmentTypes),
      merged.remotePreference,
      merged.minSalary,
      merged.visaStatus,
      merged.photoUrl,
      merged.includePhotoInResume ? 1 : 0,
      merged.updatedAt
    );

    return merged;
  }

  // ==========================================
  // Resume & Document Storage Methods
  // ==========================================

  saveResume(resume: StoredResume): void {
    this.stmt(`INSERT INTO resumes (id, filename, file_path, mime_type, file_size, parsed_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      resume.id,
      resume.filename,
      resume.filePath,
      resume.mimeType,
      resume.fileSize,
      resume.parsedText,
      resume.createdAt
    );
  }

  getResume(id: string): StoredResume | null {
    const row = this.stmt('SELECT * FROM resumes WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      filename: row.filename,
      filePath: row.file_path,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      parsedText: row.parsed_text,
      createdAt: row.created_at,
    };
  }

  listResumes(): StoredResume[] {
    const rows = this.stmt('SELECT * FROM resumes ORDER BY created_at DESC').all() as any[];
    return rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      filePath: row.file_path,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      parsedText: row.parsed_text,
      createdAt: row.created_at,
    }));
  }

  deleteResume(id: string): boolean {
    const tx = this.db.transaction(() => {
      this.stmt('DELETE FROM resume_analyses WHERE resume_id = ?').run(id);
      this.stmt('DELETE FROM generated_resumes WHERE resume_id = ?').run(id);
      const res = this.stmt('DELETE FROM resumes WHERE id = ?').run(id);
      return res.changes > 0;
    });
    return tx();
  }

  saveResumeAnalysis(analysis: ResumeAnalysis): void {
    this.stmt(`INSERT INTO resume_analyses (
      id, resume_id, overall_score, summary_critique, skills_feedback,
      experience_feedback, formatting_feedback, recommendations_json,
      keywords_detected_json, missing_keywords_json, international_notes_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      overall_score = excluded.overall_score,
      summary_critique = excluded.summary_critique,
      skills_feedback = excluded.skills_feedback,
      experience_feedback = excluded.experience_feedback,
      formatting_feedback = excluded.formatting_feedback,
      recommendations_json = excluded.recommendations_json,
      keywords_detected_json = excluded.keywords_detected_json,
      missing_keywords_json = excluded.missing_keywords_json,
      international_notes_json = excluded.international_notes_json,
      created_at = excluded.created_at
    `).run(
      analysis.id,
      analysis.resumeId,
      analysis.overallScore,
      analysis.summaryCritique,
      analysis.skillsFeedback,
      analysis.experienceFeedback,
      analysis.formattingFeedback,
      JSON.stringify(analysis.recommendations),
      JSON.stringify(analysis.keywordsDetected),
      JSON.stringify(analysis.missingKeywords),
      JSON.stringify(analysis.internationalNotes),
      analysis.createdAt
    );
  }

  getResumeAnalysis(resumeId: string): ResumeAnalysis | null {
    const row = this.stmt('SELECT * FROM resume_analyses WHERE resume_id = ? ORDER BY created_at DESC LIMIT 1').get(resumeId) as any;
    if (!row) return null;
    return {
      id: row.id,
      resumeId: row.resume_id,
      overallScore: row.overall_score,
      summaryCritique: row.summary_critique,
      skillsFeedback: row.skills_feedback,
      experienceFeedback: row.experience_feedback,
      formattingFeedback: row.formatting_feedback,
      recommendations: JSON.parse(row.recommendations_json || '[]'),
      keywordsDetected: JSON.parse(row.keywords_detected_json || '[]'),
      missingKeywords: JSON.parse(row.missing_keywords_json || '[]'),
      internationalNotes: JSON.parse(row.international_notes_json || '[]'),
      createdAt: row.created_at,
    };
  }

  saveGeneratedResume(gen: GeneratedResume): void {
    this.stmt(`INSERT INTO generated_resumes (id, resume_id, title, target_role, template_type, content_text, content_html, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      gen.id,
      gen.resumeId || null,
      gen.title,
      gen.targetRole,
      gen.templateType,
      gen.contentText,
      gen.contentHtml,
      gen.createdAt
    );
  }

  getGeneratedResume(id: string): GeneratedResume | null {
    const row = this.stmt('SELECT * FROM generated_resumes WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      resumeId: row.resume_id,
      title: row.title,
      targetRole: row.target_role,
      templateType: row.template_type,
      contentText: row.content_text,
      contentHtml: row.content_html,
      createdAt: row.created_at,
    };
  }

  listGeneratedResumes(resumeId?: string): GeneratedResume[] {
    const sql = resumeId
      ? 'SELECT * FROM generated_resumes WHERE resume_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM generated_resumes ORDER BY created_at DESC';
    const rows = (resumeId ? this.stmt(sql).all(resumeId) : this.stmt(sql).all()) as any[];
    return rows.map((row) => ({
      id: row.id,
      resumeId: row.resume_id,
      title: row.title,
      targetRole: row.target_role,
      templateType: row.template_type,
      contentText: row.content_text,
      contentHtml: row.content_html,
      createdAt: row.created_at,
    }));
  }

  updateGeneratedResume(id: string, updates: Partial<GeneratedResume>): GeneratedResume | null {
    const existing = this.getGeneratedResume(id);
    if (!existing) return null;
    const title = updates.title !== undefined ? updates.title : existing.title;
    const targetRole = updates.targetRole !== undefined ? updates.targetRole : existing.targetRole;
    const templateType = updates.templateType !== undefined ? updates.templateType : existing.templateType;
    const contentText = updates.contentText !== undefined ? updates.contentText : existing.contentText;
    const contentHtml = updates.contentHtml !== undefined ? updates.contentHtml : existing.contentHtml;

    this.stmt(`UPDATE generated_resumes SET
      title = ?, target_role = ?, template_type = ?, content_text = ?, content_html = ?
      WHERE id = ?
    `).run(title, targetRole, templateType, contentText, contentHtml, id);

    return this.getGeneratedResume(id);
  }

  // ==========================================
  // Job Listings Methods
  // ==========================================

  saveJobListing(job: JobListing): boolean {
    const res = this.stmt(`INSERT INTO job_listings (
      id, external_id, source, title, company, location, country,
      workplace_type, employment_type, experience_level, salary_min,
      salary_max, salary_currency, salary_raw, description,
      short_description, department, responsibilities_json, qualifications_json,
      professional_skills_json, education_requirements, experience_requirements,
      fresh_graduates_eligible, benefits_json, application_instructions, contact_email,
      last_verified_at, skills_json, requirements_json, visa_sponsorship, relocation,
      apply_url, source_url, posted_at, deadline, is_active, discovered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, external_id) DO UPDATE SET
      title = excluded.title,
      company = excluded.company,
      location = excluded.location,
      country = excluded.country,
      workplace_type = excluded.workplace_type,
      employment_type = excluded.employment_type,
      experience_level = excluded.experience_level,
      salary_min = excluded.salary_min,
      salary_max = excluded.salary_max,
      salary_currency = excluded.salary_currency,
      salary_raw = excluded.salary_raw,
      description = excluded.description,
      short_description = excluded.short_description,
      department = excluded.department,
      responsibilities_json = excluded.responsibilities_json,
      qualifications_json = excluded.qualifications_json,
      professional_skills_json = excluded.professional_skills_json,
      education_requirements = excluded.education_requirements,
      experience_requirements = excluded.experience_requirements,
      fresh_graduates_eligible = excluded.fresh_graduates_eligible,
      benefits_json = excluded.benefits_json,
      application_instructions = excluded.application_instructions,
      contact_email = excluded.contact_email,
      last_verified_at = excluded.last_verified_at,
      skills_json = excluded.skills_json,
      requirements_json = excluded.requirements_json,
      visa_sponsorship = excluded.visa_sponsorship,
      relocation = excluded.relocation,
      apply_url = excluded.apply_url,
      source_url = excluded.source_url,
      posted_at = excluded.posted_at,
      deadline = excluded.deadline,
      is_active = excluded.is_active
    `).run(
      job.id,
      job.externalId,
      job.source,
      job.title,
      job.company,
      job.location,
      job.country,
      job.workplaceType,
      job.employmentType,
      job.experienceLevel || 'Mid-level',
      job.salaryMin ?? null,
      job.salaryMax ?? null,
      job.salaryCurrency || 'USD',
      job.salaryRaw || '',
      job.description,
      job.shortDescription || '',
      job.department || '',
      JSON.stringify(job.responsibilities || []),
      JSON.stringify(job.qualifications || []),
      JSON.stringify(job.professionalSkills || []),
      job.educationRequirements || '',
      job.experienceRequirements || '',
      job.freshGraduatesEligible ? 1 : 0,
      JSON.stringify(job.benefits || []),
      job.applicationInstructions || '',
      job.contactEmail || '',
      job.lastVerifiedAt || new Date().toISOString(),
      JSON.stringify(job.skills || []),
      JSON.stringify(job.requirements || []),
      job.visaSponsorship ? 1 : 0,
      job.relocation ? 1 : 0,
      job.applyUrl,
      job.sourceUrl,
      job.postedAt,
      job.deadline || null,
      job.isActive ? 1 : 0,
      job.discoveredAt || new Date().toISOString()
    );
    return res.changes > 0;
  }

  saveJobListingsBatch(jobs: JobListing[]): number {
    if (jobs.length === 0) return 0;
    let savedCount = 0;
    const tx = this.db.transaction((batch: JobListing[]) => {
      for (const j of batch) {
        if (this.saveJobListing(j)) savedCount++;
      }
    });
    tx(jobs);
    return savedCount;
  }

  getJobListing(id: string): JobListing | null {
    const row = this.stmt(`SELECT j.*,
      CASE WHEN s.job_id IS NOT NULL THEN 1 ELSE 0 END as is_saved,
      a.status as app_status
      FROM job_listings j
      LEFT JOIN saved_jobs s ON j.id = s.job_id
      LEFT JOIN job_applications a ON j.id = a.job_id
      WHERE j.id = ? LIMIT 1`).get(id) as any;
    if (!row) return null;
    return this.mapJobRow(row);
  }

  findJobBySourceAndExternalId(source: string, externalId: string): JobListing | null {
    const row = this.stmt('SELECT * FROM job_listings WHERE source = ? AND external_id = ? LIMIT 1').get(source, externalId) as any;
    if (!row) return null;
    return this.mapJobRow(row);
  }

  listJobListings(params: JobSearchParams = {}): { jobs: JobListing[]; total: number } {
    const conditions: string[] = ['j.is_active = 1'];
    const values: any[] = [];

    if (params.query?.trim()) {
      const q = `%${params.query.trim().toLowerCase()}%`;
      conditions.push('(LOWER(j.title) LIKE ? OR LOWER(j.company) LIKE ? OR LOWER(j.description) LIKE ? OR LOWER(j.skills_json) LIKE ?)');
      values.push(q, q, q, q);
    }

    if (params.country && params.country !== 'all' && params.country !== 'Worldwide') {
      conditions.push('(LOWER(j.country) = ? OR LOWER(j.location) LIKE ?)');
      values.push(params.country.toLowerCase(), `%${params.country.toLowerCase()}%`);
    }

    if (params.workplaceType && params.workplaceType !== 'all') {
      conditions.push('LOWER(j.workplace_type) = ?');
      values.push(params.workplaceType.toLowerCase());
    }

    if (params.employmentType && params.employmentType !== 'all') {
      conditions.push('LOWER(j.employment_type) = ?');
      values.push(params.employmentType.toLowerCase());
    }

    if (params.experienceLevel && params.experienceLevel !== 'all') {
      conditions.push('LOWER(j.experience_level) = ?');
      values.push(params.experienceLevel.toLowerCase());
    }

    if (params.source && params.source !== 'all') {
      conditions.push('LOWER(j.source) = ?');
      values.push(params.source.toLowerCase());
    }

    if (Array.isArray(params.sources) && params.sources.length > 0) {
      const placeholders = params.sources.map(() => '?').join(',');
      conditions.push(`j.source IN (${placeholders})`);
      values.push(...params.sources);
    }

    if (params.minSalary && params.minSalary > 0) {
      conditions.push('(j.salary_max >= ? OR j.salary_min >= ?)');
      values.push(params.minSalary, params.minSalary);
    }

    if (params.postedWithinDays && params.postedWithinDays > 0) {
      const cutoff = new Date(Date.now() - params.postedWithinDays * 24 * 60 * 60 * 1000).toISOString();
      conditions.push('j.posted_at >= ?');
      values.push(cutoff);
    }

    if (params.dateFilter) {
      if (params.dateFilter === 'today') {
        conditions.push("j.discovered_at >= date('now', 'start of day')");
      } else if (params.dateFilter === 'yesterday') {
        conditions.push("j.discovered_at >= date('now', '-1 day', 'start of day') AND j.discovered_at < date('now', 'start of day')");
      } else if (params.dateFilter === 'last7') {
        conditions.push("j.discovered_at >= date('now', '-7 days')");
      } else if (params.dateFilter === 'last30') {
        conditions.push("j.discovered_at >= date('now', '-30 days')");
      } else if (params.dateFilter === 'custom') {
        if (params.customStartDate) {
          conditions.push('j.discovered_at >= ?');
          values.push(params.customStartDate);
        }
        if (params.customEndDate) {
          conditions.push('j.discovered_at <= ?');
          values.push(params.customEndDate.includes('T') ? params.customEndDate : `${params.customEndDate}T23:59:59.999Z`);
        }
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) as total FROM job_listings j ${whereClause}`;
    const totalRow = this.stmt(countSql).get(...values) as { total: number };
    const total = totalRow?.total || 0;

    const limit = Math.min(Math.max(params.limit || 50, 1), 200);
    const page = Math.max(params.page || 1, 1);
    const offset = (page - 1) * limit;

    const dataSql = `
      SELECT j.*,
      CASE WHEN s.job_id IS NOT NULL THEN 1 ELSE 0 END as is_saved,
      a.status as app_status
      FROM job_listings j
      LEFT JOIN saved_jobs s ON j.id = s.job_id
      LEFT JOIN job_applications a ON j.id = a.job_id
      ${whereClause}
      ORDER BY j.discovered_at DESC, j.posted_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = this.stmt(dataSql).all(...values, limit, offset) as any[];
    const jobs = rows.map((r) => this.mapJobRow(r));

    return { jobs, total };
  }

  private mapJobRow(row: any): JobListing {
    return {
      id: row.id,
      externalId: row.external_id,
      source: row.source,
      title: row.title,
      company: row.company,
      location: row.location,
      country: row.country,
      workplaceType: row.workplace_type,
      employmentType: row.employment_type,
      experienceLevel: row.experience_level || 'Mid-level',
      salaryMin: row.salary_min,
      salaryMax: row.salary_max,
      salaryCurrency: row.salary_currency || 'USD',
      salaryRaw: row.salary_raw || '',
      description: row.description,
      shortDescription: row.short_description || '',
      department: row.department || '',
      responsibilities: JSON.parse(row.responsibilities_json || '[]'),
      qualifications: JSON.parse(row.qualifications_json || '[]'),
      professionalSkills: JSON.parse(row.professional_skills_json || '[]'),
      educationRequirements: row.education_requirements || '',
      experienceRequirements: row.experience_requirements || '',
      freshGraduatesEligible: row.fresh_graduates_eligible !== null ? Boolean(row.fresh_graduates_eligible) : null,
      benefits: JSON.parse(row.benefits_json || '[]'),
      applicationInstructions: row.application_instructions || '',
      contactEmail: row.contact_email || '',
      lastVerifiedAt: row.last_verified_at || row.discovered_at,
      skills: JSON.parse(row.skills_json || '[]'),
      requirements: JSON.parse(row.requirements_json || '[]'),
      visaSponsorship: Boolean(row.visa_sponsorship),
      relocation: Boolean(row.relocation),
      applyUrl: row.apply_url,
      sourceUrl: row.source_url,
      postedAt: row.posted_at,
      deadline: row.deadline || null,
      isActive: Boolean(row.is_active),
      discoveredAt: row.discovered_at,
      isSaved: Boolean(row.is_saved),
      applicationStatus: row.app_status || undefined,
    };
  }

  // ==========================================
  // Saved Jobs Methods
  // ==========================================

  toggleSaveJob(jobId: string, notes = ''): boolean {
    const existing = this.stmt('SELECT id FROM saved_jobs WHERE job_id = ?').get(jobId);
    if (existing) {
      this.stmt('DELETE FROM saved_jobs WHERE job_id = ?').run(jobId);
      return false;
    }
    const id = `saved_${Date.now()}`;
    this.stmt('INSERT INTO saved_jobs (id, job_id, notes, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      jobId,
      notes,
      new Date().toISOString()
    );
    return true;
  }

  isJobSaved(jobId: string): boolean {
    const row = this.stmt('SELECT 1 FROM saved_jobs WHERE job_id = ? LIMIT 1').get(jobId);
    return Boolean(row);
  }

  listSavedJobs(): JobListing[] {
    const rows = this.stmt(`
      SELECT j.*, 1 as is_saved, a.status as app_status
      FROM saved_jobs s
      JOIN job_listings j ON s.job_id = j.id
      LEFT JOIN job_applications a ON j.id = a.job_id
      ORDER BY s.created_at DESC
    `).all() as any[];
    return rows.map((r) => this.mapJobRow(r));
  }

  // ==========================================
  // Job Application Tracking Methods
  // ==========================================

  saveJobApplication(app: JobApplication): void {
    this.stmt(`INSERT INTO job_applications (
      id, job_id, status, application_mode, resume_id, cover_letter,
      answers_json, submission_ref, failure_reason, notes,
      recipient_email, sender_email, email_subject, email_body, sent_at,
      delivery_status, employer_responses_json, activity_timeline_json,
      applied_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      status = excluded.status,
      application_mode = excluded.application_mode,
      resume_id = excluded.resume_id,
      cover_letter = excluded.cover_letter,
      answers_json = excluded.answers_json,
      submission_ref = excluded.submission_ref,
      failure_reason = excluded.failure_reason,
      notes = excluded.notes,
      recipient_email = excluded.recipient_email,
      sender_email = excluded.sender_email,
      email_subject = excluded.email_subject,
      email_body = excluded.email_body,
      sent_at = excluded.sent_at,
      delivery_status = excluded.delivery_status,
      employer_responses_json = excluded.employer_responses_json,
      activity_timeline_json = excluded.activity_timeline_json,
      updated_at = excluded.updated_at
    `).run(
      app.id,
      app.jobId,
      app.status,
      app.applicationMode,
      app.resumeId || null,
      app.coverLetter || '',
      JSON.stringify(app.answers || {}),
      app.submissionRef || '',
      app.failureReason || '',
      app.notes || '',
      app.recipientEmail || '',
      app.senderEmail || '',
      app.emailSubject || '',
      app.emailBody || '',
      app.sentAt || '',
      app.deliveryStatus || '',
      JSON.stringify(app.employerResponses || []),
      JSON.stringify(app.activityTimeline || []),
      app.appliedAt,
      app.updatedAt
    );
  }

  getJobApplication(id: string): JobApplication | null {
    const row = this.stmt('SELECT * FROM job_applications WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapApplicationRow(row);
  }

  getJobApplicationByJobId(jobId: string): JobApplication | null {
    const row = this.stmt('SELECT * FROM job_applications WHERE job_id = ?').get(jobId) as any;
    if (!row) return null;
    return this.mapApplicationRow(row);
  }

  listJobApplications(status?: string): JobApplication[] {
    const sql = status && status !== 'all'
      ? 'SELECT * FROM job_applications WHERE status = ? ORDER BY updated_at DESC'
      : 'SELECT * FROM job_applications ORDER BY updated_at DESC';
    const rows = (status && status !== 'all' ? this.stmt(sql).all(status) : this.stmt(sql).all()) as any[];
    return rows.map((r) => this.mapApplicationRow(r));
  }

  updateJobApplicationStatus(
    id: string,
    status: JobApplicationStatus,
    extra: Partial<JobApplication> = {}
  ): JobApplication | null {
    const now = new Date().toISOString();
    const existing = this.getJobApplication(id);
    if (!existing) return null;

    const timeline = existing.activityTimeline || [];
    timeline.push({
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: now.slice(0, 10),
      time: now.slice(11, 16),
      activity: `Application status updated to ${status.replace(/_/g, ' ').toUpperCase()}`,
      details: extra.notes || undefined,
      icon: 'status',
    });

    this.stmt(`UPDATE job_applications SET
      status = ?,
      notes = COALESCE(?, notes),
      submission_ref = COALESCE(?, submission_ref),
      failure_reason = COALESCE(?, failure_reason),
      delivery_status = COALESCE(?, delivery_status),
      activity_timeline_json = ?,
      updated_at = ?
      WHERE id = ?
    `).run(
      status,
      extra.notes !== undefined ? extra.notes : null,
      extra.submissionRef !== undefined ? extra.submissionRef : null,
      extra.failureReason !== undefined ? extra.failureReason : null,
      extra.deliveryStatus !== undefined ? extra.deliveryStatus : null,
      JSON.stringify(timeline),
      now,
      id
    );
    return this.getJobApplication(id);
  }

  addApplicationActivityEvent(appId: string, event: Omit<ApplicationActivityEvent, 'id'>): void {
    const app = this.getJobApplication(appId);
    if (!app) return;
    const timeline = app.activityTimeline || [];
    timeline.push({
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ...event,
    });
    const now = new Date().toISOString();
    this.stmt('UPDATE job_applications SET activity_timeline_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(timeline),
      now,
      appId
    );
  }

  addEmployerResponse(appId: string, response: Omit<EmployerResponseRecord, 'id'>): EmployerResponseRecord | null {
    const app = this.getJobApplication(appId);
    if (!app) return null;
    const responses = app.employerResponses || [];
    const newRecord: EmployerResponseRecord = {
      id: `resp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ...response,
    };
    responses.push(newRecord);

    const now = new Date().toISOString();
    const timeline = app.activityTimeline || [];
    timeline.push({
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: response.receivedAt.slice(0, 10),
      time: response.receivedAt.slice(11, 16),
      activity: `Employer replied: "${response.subject}"`,
      details: response.body.slice(0, 120) + (response.body.length > 120 ? '...' : ''),
      icon: 'reply',
    });

    // Update status to 'replied' or relevant status
    let nextStatus = app.status;
    if (response.category === 'interview_invite') {
      nextStatus = 'interview_invited';
    } else if (response.category === 'rejection') {
      nextStatus = 'rejected';
    } else if (app.status === 'sent' || app.status === 'awaiting_response' || app.status === 'under_review') {
      nextStatus = 'replied';
    }

    this.stmt('UPDATE job_applications SET status = ?, employer_responses_json = ?, activity_timeline_json = ?, updated_at = ? WHERE id = ?').run(
      nextStatus,
      JSON.stringify(responses),
      JSON.stringify(timeline),
      now,
      appId
    );

    return newRecord;
  }

  // ==========================================
  // Application Emails History
  // ==========================================

  saveJobApplicationEmail(email: JobApplicationEmailRecord): void {
    this.stmt(`INSERT INTO job_application_emails (
      id, application_id, job_id, company_name, job_title, recipient_email,
      sender_email, subject, body, resume_id, resume_name, sent_at,
      delivery_status, failure_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      email.id,
      email.applicationId || null,
      email.jobId,
      email.companyName,
      email.jobTitle,
      email.recipientEmail,
      email.senderEmail,
      email.subject,
      email.body,
      email.resumeId || null,
      email.resumeName || null,
      email.sentAt,
      email.deliveryStatus,
      email.failureReason || '',
      email.createdAt || new Date().toISOString()
    );
  }

  listJobApplicationEmails(jobId?: string): JobApplicationEmailRecord[] {
    const sql = jobId
      ? 'SELECT * FROM job_application_emails WHERE job_id = ? ORDER BY sent_at DESC'
      : 'SELECT * FROM job_application_emails ORDER BY sent_at DESC';
    const rows = (jobId ? this.stmt(sql).all(jobId) : this.stmt(sql).all()) as any[];
    return rows.map((r) => ({
      id: r.id,
      applicationId: r.application_id || undefined,
      jobId: r.job_id,
      companyName: r.company_name,
      jobTitle: r.job_title,
      recipientEmail: r.recipient_email,
      senderEmail: r.sender_email,
      subject: r.subject,
      body: r.body,
      resumeId: r.resume_id || undefined,
      resumeName: r.resume_name || undefined,
      sentAt: r.sent_at,
      deliveryStatus: r.delivery_status || 'sent',
      failureReason: r.failure_reason || '',
      createdAt: r.created_at,
    }));
  }

  // ==========================================
  // Job Discovery & Sync History Logs
  // ==========================================

  saveJobSyncLog(log: {
    id?: string;
    startedAt: string;
    completedAt: string;
    triggerType: 'manual' | 'scheduled' | 'startup';
    status: 'success' | 'running' | 'failed';
    sourcesChecked: string[];
    sourcesFailed: string[];
    totalFetched: number;
    newSaved: number;
    duplicatesSkipped: number;
    errorMessage?: string;
  }): void {
    const id = log.id || `sync_${Date.now()}`;
    this.stmt(`INSERT INTO job_sync_logs (
      id, started_at, completed_at, trigger_type, status,
      sources_checked_json, sources_failed_json, total_fetched,
      new_saved, duplicates_skipped, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      log.startedAt,
      log.completedAt,
      log.triggerType,
      log.status,
      JSON.stringify(log.sourcesChecked || []),
      JSON.stringify(log.sourcesFailed || []),
      log.totalFetched,
      log.newSaved,
      log.duplicatesSkipped,
      log.errorMessage || ''
    );
  }

  getLatestJobSyncStatus(): JobSyncStatusInfo {
    const config = this.getJobDiscoveryConfig();
    const lastRow = this.stmt('SELECT * FROM job_sync_logs ORDER BY completed_at DESC LIMIT 1').get() as any;

    let nextSyncAt: string | null = null;
    if (config.lastRunAt && config.autoDiscoveryIntervalHours) {
      const lastMs = new Date(config.lastRunAt).getTime();
      const intervalMs = config.autoDiscoveryIntervalHours * 3600 * 1000;
      nextSyncAt = new Date(lastMs + intervalMs).toISOString();
    }

    return {
      isSyncing: false,
      lastSyncAt: lastRow?.completed_at || config.lastRunAt || null,
      nextSyncAt,
      autoSyncEnabled: (config as any).autoSyncEnabled !== false,
      intervalHours: config.autoDiscoveryIntervalHours || 6,
      sourcesChecked: lastRow ? JSON.parse(lastRow.sources_checked_json || '[]') : config.enabledPlatforms,
      sourcesFailed: lastRow ? JSON.parse(lastRow.sources_failed_json || '[]') : [],
      lastDiscoveredCount: lastRow ? lastRow.new_saved : 0,
      lastDuplicatesSkipped: lastRow ? lastRow.duplicates_skipped : 0,
      lastError: lastRow?.error_message || null,
    };
  }

  getJobDiscoveryStats(): JobDiscoveryStats {
    const todayRow = this.stmt("SELECT COUNT(*) as c FROM job_listings WHERE discovered_at >= date('now', 'start of day')").get() as any;
    const yesterdayRow = this.stmt("SELECT COUNT(*) as c FROM job_listings WHERE discovered_at >= date('now', '-1 day', 'start of day') AND discovered_at < date('now', 'start of day')").get() as any;
    const weekRow = this.stmt("SELECT COUNT(*) as c FROM job_listings WHERE discovered_at >= date('now', '-7 days')").get() as any;
    const activeRow = this.stmt("SELECT COUNT(*) as c FROM job_listings WHERE is_active = 1").get() as any;
    const skippedRow = this.stmt("SELECT COALESCE(SUM(duplicates_skipped), 0) as c FROM job_sync_logs").get() as any;
    const lastLog = this.stmt("SELECT completed_at FROM job_sync_logs ORDER BY completed_at DESC LIMIT 1").get() as any;
    const config = this.getJobDiscoveryConfig();

    let nextSyncAt: string | null = null;
    if (config.lastRunAt && config.autoDiscoveryIntervalHours) {
      const lastMs = new Date(config.lastRunAt).getTime();
      const intervalMs = config.autoDiscoveryIntervalHours * 3600 * 1000;
      nextSyncAt = new Date(lastMs + intervalMs).toISOString();
    }

    return {
      totalDiscoveredToday: todayRow?.c || 0,
      totalDiscoveredYesterday: yesterdayRow?.c || 0,
      totalDiscoveredThisWeek: weekRow?.c || 0,
      totalDuplicatesSkipped: skippedRow?.c || 0,
      totalMatchingJobs: activeRow?.c || 0,
      lastSyncAt: lastLog?.completed_at || config.lastRunAt || null,
      nextSyncAt,
      autoSyncEnabled: (config as any).autoSyncEnabled !== false,
      intervalHours: config.autoDiscoveryIntervalHours || 6,
      enabledPlatforms: config.enabledPlatforms || [],
    };
  }

  listJobSyncLogs(limit = 30): JobSyncLogRecord[] {
    const rows = this.stmt('SELECT * FROM job_sync_logs ORDER BY completed_at DESC LIMIT ?').all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      triggerType: r.trigger_type || 'manual',
      status: r.status || 'success',
      sourcesChecked: JSON.parse(r.sources_checked_json || '[]'),
      sourcesFailed: JSON.parse(r.sources_failed_json || '[]'),
      totalFetched: r.total_fetched || 0,
      newSaved: r.new_saved || 0,
      duplicatesSkipped: r.duplicates_skipped || 0,
      errorMessage: r.error_message || undefined,
    }));
  }

  getApplicationStats(): Record<string, number> {
    const rows = this.stmt('SELECT status, COUNT(*) as count FROM job_applications GROUP BY status').all() as Array<{ status: string; count: number }>;
    const stats: Record<string, number> = {
      total: 0,
      draft: 0,
      ready_to_apply: 0,
      awaiting_approval: 0,
      submitted: 0,
      requires_manual_completion: 0,
      failed: 0,
      interview: 0,
      offer: 0,
      rejected: 0,
      withdrawn: 0,
      saved_count: (this.stmt('SELECT COUNT(*) as c FROM saved_jobs').get() as any)?.c || 0,
    };

    for (const r of rows) {
      stats[r.status] = r.count;
      stats.total += r.count;
    }
    return stats;
  }

  countApplicationsToday(): number {
    const today = new Date().toISOString().slice(0, 10);
    const row = this.stmt("SELECT COUNT(*) as count FROM job_applications WHERE status = 'submitted' AND applied_at LIKE ?").get(`${today}%`) as { count: number };
    return row?.count || 0;
  }

  private mapApplicationRow(row: any): JobApplication {
    const app: JobApplication = {
      id: row.id,
      jobId: row.job_id,
      status: row.status,
      applicationMode: row.application_mode,
      resumeId: row.resume_id || undefined,
      coverLetter: row.cover_letter || '',
      answers: JSON.parse(row.answers_json || '{}'),
      submissionRef: row.submission_ref || '',
      failureReason: row.failure_reason || '',
      notes: row.notes || '',
      recipientEmail: row.recipient_email || '',
      senderEmail: row.sender_email || '',
      emailSubject: row.email_subject || '',
      emailBody: row.email_body || '',
      sentAt: row.sent_at || '',
      deliveryStatus: row.delivery_status || '',
      employerResponses: JSON.parse(row.employer_responses_json || '[]'),
      activityTimeline: JSON.parse(row.activity_timeline_json || '[]'),
      appliedAt: row.applied_at,
      updatedAt: row.updated_at,
    };
    const job = this.getJobListing(row.job_id);
    if (job) app.job = job;
    return app;
  }

  // ==========================================
  // Notifications Methods
  // ==========================================

  addJobNotification(notif: Omit<JobNotification, 'id' | 'isRead' | 'createdAt'>): JobNotification {
    const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    this.stmt('INSERT INTO job_notifications (id, type, title, message, job_id, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
      id,
      notif.type,
      notif.title,
      notif.message,
      notif.jobId || null,
      now
    );
    return {
      id,
      type: notif.type,
      title: notif.title,
      message: notif.message,
      jobId: notif.jobId,
      isRead: false,
      createdAt: now,
    };
  }

  listJobNotifications(limit = 50): JobNotification[] {
    const rows = this.stmt('SELECT * FROM job_notifications ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      jobId: r.job_id || undefined,
      isRead: Boolean(r.is_read),
      createdAt: r.created_at,
    }));
  }

  markJobNotificationRead(id: string): void {
    this.stmt('UPDATE job_notifications SET is_read = 1 WHERE id = ?').run(id);
  }

  // ==========================================
  // Job Discovery & Auto-Apply Config Methods
  // ==========================================

  getJobDiscoveryConfig(): JobDiscoveryConfig {
    const row = this.stmt('SELECT * FROM job_discovery_configs WHERE id = ? LIMIT 1').get('default') as any;
    if (!row) {
      const now = new Date().toISOString();
      const def: JobDiscoveryConfig = {
        id: 'default',
        autoApplyEnabled: false,
        maxDailyApplications: 5,
        minCompatibilityScore: 75,
        preferredCountries: ['Worldwide', 'Pakistan', 'United States', 'United Arab Emirates', 'United Kingdom', 'India', 'Canada', 'Australia'],
        preferredRoles: ['Software Engineer', 'Full Stack Developer', 'Frontend Developer', 'Backend Developer'],
        excludedCompanies: [],
        enabledPlatforms: ['LinkedIn', 'Indeed', 'Glassdoor', 'Remote OK', 'Arbeitnow', 'Jobicy', 'We Work Remotely', 'Company Career Pages'],
        autoDiscoveryIntervalHours: 6,
        lastRunAt: null,
        updatedAt: now,
      };
      this.stmt(`INSERT OR IGNORE INTO job_discovery_configs (
        id, auto_apply_enabled, max_daily_applications, min_compatibility_score,
        preferred_countries_json, preferred_roles_json, excluded_companies_json,
        enabled_platforms_json, auto_discovery_interval_hours, last_run_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'default',
        def.autoApplyEnabled ? 1 : 0,
        def.maxDailyApplications,
        def.minCompatibilityScore,
        JSON.stringify(def.preferredCountries),
        JSON.stringify(def.preferredRoles),
        JSON.stringify(def.excludedCompanies),
        JSON.stringify(def.enabledPlatforms),
        def.autoDiscoveryIntervalHours,
        def.lastRunAt || null,
        def.updatedAt
      );
      return def;
    }
    return {
      id: row.id,
      autoApplyEnabled: Boolean(row.auto_apply_enabled),
      maxDailyApplications: row.max_daily_applications,
      minCompatibilityScore:
        row.min_compatibility_score !== null && row.min_compatibility_score !== undefined
          ? Number(row.min_compatibility_score)
          : 75,
      preferredCountries: JSON.parse(row.preferred_countries_json || '[]'),
      preferredRoles: JSON.parse(row.preferred_roles_json || '[]'),
      excludedCompanies: JSON.parse(row.excluded_companies_json || '[]'),
      enabledPlatforms: JSON.parse(row.enabled_platforms_json || '[]'),
      autoDiscoveryIntervalHours: row.auto_discovery_interval_hours,
      lastRunAt: row.last_run_at || null,
      updatedAt: row.updated_at,
    };
  }

  updateJobDiscoveryConfig(config: Partial<JobDiscoveryConfig>): JobDiscoveryConfig {
    const existing = this.getJobDiscoveryConfig();
    const now = new Date().toISOString();
    const merged: JobDiscoveryConfig = {
      ...existing,
      ...config,
      minCompatibilityScore:
        config.minCompatibilityScore !== undefined
          ? Math.max(0, Math.min(100, Math.round(Number(config.minCompatibilityScore))))
          : existing.minCompatibilityScore,
      updatedAt: now,
    };
    this.stmt(`INSERT INTO job_discovery_configs (
      id, auto_apply_enabled, max_daily_applications, min_compatibility_score,
      preferred_countries_json, preferred_roles_json, excluded_companies_json,
      enabled_platforms_json, auto_discovery_interval_hours, last_run_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      auto_apply_enabled = excluded.auto_apply_enabled,
      max_daily_applications = excluded.max_daily_applications,
      min_compatibility_score = excluded.min_compatibility_score,
      preferred_countries_json = excluded.preferred_countries_json,
      preferred_roles_json = excluded.preferred_roles_json,
      excluded_companies_json = excluded.excluded_companies_json,
      enabled_platforms_json = excluded.enabled_platforms_json,
      auto_discovery_interval_hours = excluded.auto_discovery_interval_hours,
      last_run_at = excluded.last_run_at,
      updated_at = excluded.updated_at
    `).run(
      'default',
      merged.autoApplyEnabled ? 1 : 0,
      merged.maxDailyApplications,
      merged.minCompatibilityScore,
      JSON.stringify(merged.preferredCountries),
      JSON.stringify(merged.preferredRoles),
      JSON.stringify(merged.excludedCompanies),
      JSON.stringify(merged.enabledPlatforms),
      merged.autoDiscoveryIntervalHours,
      merged.lastRunAt || null,
      merged.updatedAt
    );
    return merged;
  }
}
