import type {
  BaileysStatusInfo,
  ClientConversation,
  ClientHandlerStats,
  ClientStage,
  ConversationMessage,
  CustomService,
  DealClosingInfo,
  Lead,
  LeadStats,
  Run,
  RunEvent,
  SearchForm,
  CareerProfile,
  JobListing,
  StoredResume,
  ResumeAnalysis,
  GeneratedResume,
  JobApplication,
  JobApplicationStatus,
  JobNotification,
  JobDiscoveryConfig,
  PlatformStatus,
  JobSyncStatusInfo,
  JobApplicationEmailRecord,
  EmployerResponseRecord,
  JobDiscoveryStats,
  JobSyncLogRecord,
} from '../types';

const API = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? 'https://client-hunter-1-dql2.onrender.com' : 'http://127.0.0.1:8787')
).replace(/\/$/, '');
const TOKEN_KEY = 'client-hunter-token';
const REMEMBERED_KEY = 'client-hunter-access-code';

type AuthListener = (token: string | null, reason?: string) => void;
const authListeners = new Set<AuthListener>();

export function onAuthChange(listener: AuthListener): () => void {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

function notifyAuth(token: string | null, reason?: string): void {
  for (const listener of authListeners) {
    try {
      listener(token, reason);
    } catch (err) {
      console.error('Auth listener error:', err);
    }
  }
}

let isReauthenticating: Promise<boolean> | null = null;

async function attemptSilentReauth(): Promise<boolean> {
  const rememberedCode = localStorage.getItem(REMEMBERED_KEY);
  if (!rememberedCode) return false;

  if (isReauthenticating) {
    return isReauthenticating;
  }

  isReauthenticating = (async () => {
    try {
      const response = await fetch(`${API}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: rememberedCode }),
      });
      const data = await response.json();
      if (response.ok && data?.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
        notifyAuth(data.token);
        return true;
      }
    } catch {
      // Network or connection issue
    }
    return false;
  })().finally(() => {
    isReauthenticating = null;
  });

  return isReauthenticating;
}

async function request<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...init, headers });
  } catch (netErr) {
    if (!isRetry && (!init.method || init.method === 'GET')) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return request<T>(path, init, true);
    }
    throw netErr;
  }

  const text = await response.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: `Server returned HTTP ${response.status}.` }; }

  if (!response.ok) {
    const parsedBody = body as any;
    let errorMsg = `Request failed (HTTP ${response.status}).`;
    if (parsedBody && typeof parsedBody === 'object') {
      if (typeof parsedBody.error === 'string' && parsedBody.error && parsedBody.error !== 'Not Found' && parsedBody.error !== 'Bad Request' && parsedBody.error !== 'Internal Server Error') {
        errorMsg = parsedBody.error;
      } else if (typeof parsedBody.message === 'string' && parsedBody.message) {
        errorMsg = parsedBody.message;
      } else if (typeof parsedBody.error === 'string' && parsedBody.error) {
        errorMsg = parsedBody.error;
      }
    }

    // Handle 401 Unauthorized / Expired / Invalid session
    if (response.status === 401 && !path.startsWith('/api/auth/session') && !isRetry) {
      const reauthSuccess = await attemptSilentReauth();
      if (reauthSuccess) {
        return request<T>(path, init, true);
      }

      // Re-authentication failed or unavailable: wipe stale session
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REMEMBERED_KEY);
      notifyAuth(null, errorMsg);
    }

    throw new Error(errorMsg);
  }
  return body as T;
}

export const api = {
  get token(): string | null { return localStorage.getItem(TOKEN_KEY); },
  get hasRememberedCode(): boolean { return Boolean(localStorage.getItem(REMEMBERED_KEY)); },
  onAuthChange,
  async login(accessCode: string, remember = true): Promise<void> {
    const result = await request<{ token: string }>('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ accessCode }),
    });
    localStorage.setItem(TOKEN_KEY, result.token);
    if (remember) {
      localStorage.setItem(REMEMBERED_KEY, accessCode);
    } else {
      localStorage.removeItem(REMEMBERED_KEY);
    }
    notifyAuth(result.token);
  },
  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REMEMBERED_KEY);
    notifyAuth(null);
  },
  async refreshSession(): Promise<boolean> {
    if (!localStorage.getItem(TOKEN_KEY)) return false;
    try {
      const result = await request<{ ok: boolean; token: string }>('/api/auth/refresh', {
        method: 'POST',
      });
      if (result.token) {
        localStorage.setItem(TOKEN_KEY, result.token);
        notifyAuth(result.token);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  },
  startRun(form: SearchForm, sheet?: { sheetId: string; tab: string }): Promise<{ runId: string }> { return request('/api/runs', { method: 'POST', body: JSON.stringify({ ...form, sheetId: sheet?.sheetId, sheetTab: sheet?.tab }) }); },
  getRun(runId: string): Promise<{ run: Run; leads: Lead[] }> { return request(`/api/runs/${encodeURIComponent(runId)}`); },
  getEvents(runId: string, after: number): Promise<{ events: RunEvent[]; run: Run }> { return request(`/api/runs/${encodeURIComponent(runId)}/events?after=${after}`); },
  listRuns(): Promise<{ runs: Run[] }> { return request('/api/runs'); },
  async deleteRun(runId: string): Promise<{ ok: boolean; runId: string; stats: LeadStats }> {
    try {
      return await request(`/api/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
    } catch {
      return await request(`/api/runs/${encodeURIComponent(runId)}/delete`, { method: 'POST', body: '{}' });
    }
  },
  getStats(): Promise<{ ok: boolean; stats: LeadStats }> { return request('/api/leads/stats'); },
  async deleteLead(leadId: string): Promise<{ ok: boolean; leadId: string; stats: LeadStats }> {
    try {
      return await request(`/api/leads/${encodeURIComponent(leadId)}`, { method: 'DELETE' });
    } catch {
      return await request(`/api/leads/${encodeURIComponent(leadId)}/delete`, { method: 'POST', body: '{}' });
    }
  },
  getServices(): Promise<{ ok: boolean; predefined: string[]; custom: CustomService[] }> { return request('/api/services'); },
  addCustomService(name: string, description?: string): Promise<{ ok: boolean; service: CustomService }> { return request('/api/services', { method: 'POST', body: JSON.stringify({ name, description }) }); },
  async deleteCustomService(id: string): Promise<{ ok: boolean; id: string }> {
    try {
      return await request(`/api/services/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      return await request(`/api/services/${encodeURIComponent(id)}/delete`, { method: 'POST', body: '{}' });
    }
  },
  connectSheet(sheetUrl: string): Promise<{ sheet: { sheetId: string; tab: string; title: string; url: string; headers: string } }> { return request('/api/integrations/sheets/connect', { method: 'POST', body: JSON.stringify({ sheetUrl }) }); },
  sendEmail(leadId: string, body: { to: string; subject: string; html: string; text: string; replyTo?: string }): Promise<{ sentAt: string }> { return request(`/api/leads/${encodeURIComponent(leadId)}/email`, { method: 'POST', body: JSON.stringify(body) }); },
  sendWhatsApp(leadId: string, body: { businessName: string; number: string; message: string; resend: boolean }): Promise<{ record: { status: string; providerMessageId?: string } }> { return request(`/api/leads/${encodeURIComponent(leadId)}/whatsapp`, { method: 'POST', body: JSON.stringify(body) }); },

  // Client Handler Methods
  listClients(stage?: string, q?: string): Promise<{ ok: boolean; clients: ClientConversation[]; stats: ClientHandlerStats }> {
    const params = new URLSearchParams();
    if (stage && stage !== 'all') params.set('stage', stage);
    if (q) params.set('q', q);
    const qs = params.toString();
    return request(`/api/clients${qs ? `?${qs}` : ''}`);
  },
  getClient(leadId: string): Promise<{ ok: boolean; client: ClientConversation }> {
    return request(`/api/clients/${encodeURIComponent(leadId)}`);
  },
  sendClientMessage(leadId: string, text: string): Promise<{ ok: boolean; message: ConversationMessage; client: ClientConversation }> {
    return request(`/api/clients/${encodeURIComponent(leadId)}/message`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },
  sendFirstMessage(leadId: string, autoSend = false): Promise<{ ok: boolean; messageText: string; sentMessage?: ConversationMessage; client: ClientConversation }> {
    return request(`/api/clients/${encodeURIComponent(leadId)}/first-message`, {
      method: 'POST',
      body: JSON.stringify({ autoSend }),
    });
  },
  generateClientReply(leadId: string, guidance?: string): Promise<{ ok: boolean; draft: any }> {
    return request(`/api/clients/${encodeURIComponent(leadId)}/generate-reply`, {
      method: 'POST',
      body: JSON.stringify({ guidance }),
    });
  },
  toggleAutopilot(leadId: string, enabled: boolean): Promise<{ ok: boolean; client: ClientConversation }> {
    return request(`/api/clients/${encodeURIComponent(leadId)}/autopilot`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  },
  updateClientStage(leadId: string, stage: ClientStage, dealNotes?: string): Promise<{ ok: boolean; client: ClientConversation }> {
    return request(`/api/clients/${encodeURIComponent(leadId)}/stage`, {
      method: 'POST',
      body: JSON.stringify({ stage, dealNotes }),
    });
  },
  closeDeal(leadId: string, dealInfo: DealClosingInfo): Promise<{ ok: boolean; client: ClientConversation }> {
    return request(`/api/clients/${encodeURIComponent(leadId)}/close-deal`, {
      method: 'POST',
      body: JSON.stringify(dealInfo),
    });
  },
  linkUnmatchedClientToLead(
    unmatchedLeadId: string,
    targetLeadId: string
  ): Promise<{ ok: boolean; client: ClientConversation; stats: ClientHandlerStats }> {
    return request(`/api/clients/${encodeURIComponent(unmatchedLeadId)}/link-lead`, {
      method: 'POST',
      body: JSON.stringify({ targetLeadId }),
    });
  },
  subscribeToClientEvents(onEvent: (event: any) => void): () => void {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: any = null;
    let isClosed = false;

    function connect() {
      if (isClosed) return;
      try {
        const curToken = localStorage.getItem(TOKEN_KEY) || '';
        const url = `${API}/api/clients/events?token=${encodeURIComponent(curToken)}`;
        eventSource = new EventSource(url);

        eventSource.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            onEvent(data);
          } catch {
            // ignore malformed SSE payloads
          }
        };

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          if (!isClosed) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(connect, 3000);
          }
        };
      } catch {
        if (!isClosed) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(connect, 5000);
        }
      }
    }

    connect();

    return () => {
      isClosed = true;
      clearTimeout(reconnectTimeout);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  },
  getClientHandlerSettings(): Promise<{
    ok: boolean;
    settings: { dealNotificationPhone: string; dealNotificationsEnabled?: boolean };
    whatsappReady?: boolean;
    whatsappState?: string;
  }> {
    return request('/api/client-handler/settings');
  },
  saveClientHandlerSettings(
    dealNotificationPhone: string,
    dealNotificationsEnabled?: boolean
  ): Promise<{
    ok: boolean;
    message?: string;
    settings: { dealNotificationPhone: string; dealNotificationsEnabled?: boolean };
  }> {
    return request('/api/client-handler/settings', {
      method: 'POST',
      body: JSON.stringify({ dealNotificationPhone, dealNotificationsEnabled }),
    });
  },
  testClientHandlerNotification(phone?: string): Promise<{
    ok: boolean;
    message?: string;
    sent?: { providerMessageId: string; status: string; phone: string; timestamp: string };
    error?: string;
  }> {
    return request('/api/client-handler/test-notification', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
  },

  // Direct Baileys WhatsApp Connection Methods
  getWhatsAppStatus(): Promise<{ ok: boolean; status: BaileysStatusInfo }> {
    return request('/api/whatsapp/status');
  },
  connectWhatsApp(options?: { forceNewQr?: boolean }): Promise<{ ok: boolean; status: BaileysStatusInfo }> {
    return request('/api/whatsapp/connect', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  },
  disconnectWhatsApp(): Promise<{ ok: boolean; status: BaileysStatusInfo }> {
    return request('/api/whatsapp/disconnect', { method: 'POST', body: '{}' });
  },
  logoutWhatsApp(): Promise<{ ok: boolean; status: BaileysStatusInfo }> {
    return request('/api/whatsapp/logout', { method: 'POST', body: '{}' });
  },
  restartWhatsApp(options?: { forceNewQr?: boolean }): Promise<{ ok: boolean; status: BaileysStatusInfo }> {
    return request('/api/whatsapp/restart', {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  },
  subscribeWhatsAppEvents(onUpdate: (status: BaileysStatusInfo) => void): () => void {
    const token = localStorage.getItem(TOKEN_KEY) || '';
    const sseUrl = `${API}/api/whatsapp/events?token=${encodeURIComponent(token)}`;
    let eventSource: EventSource | null = null;
    let pollInterval: any = null;
    let isClosed = false;

    const startPolling = (intervalMs = 2000) => {
      if (pollInterval || isClosed) return;
      pollInterval = setInterval(async () => {
        try {
          const res = await request<{ ok: boolean; status: BaileysStatusInfo }>('/api/whatsapp/status');
          if (res?.status) onUpdate(res.status);
        } catch {
          // ignore transient poll failure
        }
      }, intervalMs);
    };

    // Always run a 2-second status sync alongside SSE so QR codes and state transitions
    // are guaranteed to appear immediately even if SSE is buffered or interrupted.
    startPolling(2000);

    try {
      eventSource = new EventSource(sseUrl);
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as BaileysStatusInfo;
          onUpdate(data);
        } catch {
          // ignore
        }
      };
      eventSource.onerror = () => {
        startPolling(2000);
      };
    } catch {
      startPolling(2000);
    }

    return () => {
      isClosed = true;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };
  },

  // ==========================================
  // AI Job Finder & Career Assistant
  // ==========================================
  getCareerProfile: () => request<{ ok: boolean; profile: CareerProfile }>('/api/career/profile'),

  updateCareerProfile: (profile: Partial<CareerProfile>) =>
    request<{ ok: boolean; profile: CareerProfile }>('/api/career/profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    }),

  getJobDiscoveryConfig: () => request<{ ok: boolean; config: JobDiscoveryConfig }>('/api/career/config'),

  updateJobDiscoveryConfig: (config: Partial<JobDiscoveryConfig>) =>
    request<{ ok: boolean; config: JobDiscoveryConfig }>('/api/career/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  getJobPlatforms: () => request<{ ok: boolean; platforms: PlatformStatus[] }>('/api/career/platforms'),

  getJobs: (params?: {
    query?: string;
    country?: string;
    workplaceType?: string;
    employmentType?: string;
    experienceLevel?: string;
    platform?: string;
    minSalary?: number;
    dateFilter?: string;
    customStartDate?: string;
    customEndDate?: string;
    savedOnly?: boolean;
    appliedOnly?: boolean;
    limit?: number;
    page?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          searchParams.append(key, String(val));
        }
      });
    }
    const queryStr = searchParams.toString();
    return request<{ ok: boolean; total: number; jobs: JobListing[] }>(`/api/career/jobs${queryStr ? `?${queryStr}` : ''}`);
  },

  getJobDiscoveryStats: () =>
    request<{ ok: boolean; stats: JobDiscoveryStats }>('/api/career/jobs/stats'),

  getJobSyncHistory: (limit = 30) =>
    request<{ ok: boolean; logs: JobSyncLogRecord[] }>(`/api/career/jobs/sync-history?limit=${limit}`),

  toggleJobScheduler: (payload: { enabled?: boolean; intervalHours?: number }) =>
    request<{ ok: boolean; config: JobDiscoveryConfig; schedulerStatus: 'active' | 'paused' }>('/api/career/scheduler/toggle', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  syncJobs: () =>
    request<{
      ok: boolean;
      count: number;
      newSaved: number;
      duplicatesSkipped: number;
      sourcesChecked: string[];
      sourcesFailed: string[];
      status: JobSyncStatusInfo;
      message: string;
      error?: string;
    }>('/api/career/jobs/sync', { method: 'POST' }),

  getJobSyncStatus: () => request<{ ok: boolean; status: JobSyncStatusInfo }>('/api/career/jobs/sync-status'),

  getJobDetails: (id: string) => request<{ ok: boolean; job: JobListing }>(`/api/career/jobs/${id}`),

  toggleSaveJob: (id: string) => request<{ ok: boolean; isSaved: boolean }>(`/api/career/jobs/${id}/save`, { method: 'POST' }),

  getResumes: () => request<{ ok: boolean; resumes: StoredResume[] }>('/api/career/resumes'),

  uploadResume: async (file: File) => {
    const token = localStorage.getItem(TOKEN_KEY);
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API}/api/career/resumes/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to upload resume');
    return data as { ok: boolean; resume: StoredResume; analysis: ResumeAnalysis };
  },

  analyzeResume: (id: string) => request<{ ok: boolean; analysis: ResumeAnalysis }>(`/api/career/resumes/${id}/analyze`, { method: 'POST' }),

  generateTailoredResume: (templateType: string, customProfile?: Partial<CareerProfile>) =>
    request<{ ok: boolean; generatedResume: GeneratedResume }>('/api/career/resumes/generate', {
      method: 'POST',
      body: JSON.stringify({ templateType, customProfile }),
    }),

  getGeneratedResumes: (resumeId?: string) =>
    request<{ ok: boolean; generatedResumes: GeneratedResume[] }>(`/api/career/resumes/generated${resumeId ? `?resumeId=${resumeId}` : ''}`),

  getGeneratedResume: (id: string) =>
    request<{ ok: boolean; generatedResume: GeneratedResume }>(`/api/career/resumes/generated/${id}`),

  updateGeneratedResume: (id: string, updates: Partial<GeneratedResume>) =>
    request<{ ok: boolean; generatedResume: GeneratedResume }>(`/api/career/resumes/generated/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  deleteResume: (id: string) =>
    request<{ ok: boolean; deleted: boolean }>(`/api/career/resumes/${id}`, { method: 'DELETE' }),

  getResumeFileUrl: (id: string) => {
    const token = localStorage.getItem(TOKEN_KEY);
    return `${API}/api/career/resumes/${id}/file${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },

  getGeneratedResumeDocxUrl: (id: string) => {
    const token = localStorage.getItem(TOKEN_KEY);
    return `${API}/api/career/resumes/generated/${id}/docx${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },

  downloadGeneratedResumeDocx: async (id: string, filename = 'Resume.docx') => {
    const token = localStorage.getItem(TOKEN_KEY);
    const url = `${API}/api/career/resumes/generated/${id}/docx${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error(`Failed to download DOCX: HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  },

  getJobRecipientEmail: (jobId: string, refresh = false) =>
    request<{
      ok: boolean;
      discovery: {
        found: boolean;
        email: string;
        source: string;
        sourceUrl?: string;
        companyName?: string;
        companyWebsite?: string;
        verificationStatus: 'verified' | 'publicly_listed' | 'unverified' | 'not_found';
        verificationLabel?: string;
        emailType?: 'recruitment' | 'hr' | 'company_contact' | 'general';
        portalUrl?: string;
        originalListingUrl?: string;
        sourcesChecked?: string[];
        alternativeEmails?: Array<{
          email: string;
          source: string;
          sourceUrl: string;
          emailType: 'recruitment' | 'hr' | 'company_contact' | 'general';
        }>;
        notes?: string;
      };
    }>(`/api/career/jobs/${jobId}/recipient-email${refresh ? '?refresh=true' : ''}`),

  getJobApplicationEmail: (jobId: string) =>
    request<{
      ok: boolean;
      email: {
        subject: string;
        html: string;
        text: string;
        matchedSkills?: string[];
        recipientGreeting?: string;
      };
    }>(`/api/career/jobs/${jobId}/application-email`),

  renderJobApplicationEmail: (jobId: string, payload: { subject: string; body: string }) =>
    request<{
      ok: boolean;
      html: string;
    }>(`/api/career/jobs/${jobId}/render-email`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getJobApplications: () =>
    request<{ ok: boolean; applications: JobApplication[]; stats: Record<string, number>; todayCount: number }>('/api/career/applications'),

  prepareJobApplication: (jobId: string) =>
    request<{
      ok: boolean;
      package: {
        job: JobListing;
        coverLetter: string;
        tailoredAnswers: Record<string, string>;
        readyToApply: boolean;
        warnings?: string[];
      };
    }>('/api/career/applications/prepare', {
      method: 'POST',
      body: JSON.stringify({ jobId }),
    }),

  submitJobApplication: (payload: {
    jobId: string;
    mode: 'manual' | 'automatic';
    customCoverLetter?: string;
    customAnswers?: Record<string, string>;
  }) =>
    request<{ ok: boolean; application: JobApplication }>('/api/career/applications/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  sendApplicationEmail: (payload: {
    jobId: string;
    recipientEmail: string;
    senderEmail: string;
    subject: string;
    body: string;
    htmlBody?: string;
    bodyEdited?: boolean;
    resumeId?: string;
    resumeName?: string;
    recipientEmailSource?: string;
  }) =>
    request<{
      ok: boolean;
      deliveryStatus: JobApplicationEmailRecord['deliveryStatus'];
      application: JobApplication;
      emailRecord: JobApplicationEmailRecord;
      attachedResume?: string | null;
    }>('/api/career/applications/send-email', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getApplicationEmails: (jobId?: string) =>
    request<{ ok: boolean; emails: JobApplicationEmailRecord[] }>(`/api/career/applications/emails${jobId ? `?jobId=${jobId}` : ''}`),

  getAiEmailReply: (applicationId: string, employerMessage: string) =>
    request<{
      ok: boolean;
      analysis: {
        category: string;
        categoryLabel: string;
        sentiment: string;
        keyPoints: string[];
        suggestedReply: string;
        actionItems: string[];
      };
    }>(`/api/career/applications/${applicationId}/ai-reply`, {
      method: 'POST',
      body: JSON.stringify({ employerMessage }),
    }),

  logEmployerResponse: (
    applicationId: string,
    payload: {
      fromEmail: string;
      subject: string;
      body: string;
      category?: string;
      userReply?: string;
    }
  ) =>
    request<{
      ok: boolean;
      responseRecord: EmployerResponseRecord;
      application: JobApplication;
    }>(`/api/career/applications/${applicationId}/log-response`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateApplicationStatus: (id: string, status: JobApplicationStatus) =>
    request<{ ok: boolean; application: JobApplication }>(`/api/career/applications/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  openGmailApplication: (id: string) =>
    request<{ ok: boolean; application: JobApplication }>(`/api/career/applications/${id}/open-gmail`, {
      method: 'POST',
    }),

  confirmSentApplication: (id: string) =>
    request<{ ok: boolean; application: JobApplication }>(`/api/career/applications/${id}/confirm-sent`, {
      method: 'POST',
    }),

  syncGmailApplications: () =>
    request<{
      ok: boolean;
      summary?: {
        bouncesDetected: number;
        bouncesApplied: number;
        sentConfirmed: number;
        repliesDetected: number;
        details: string[];
      };
      error?: string;
    }>('/api/career/applications/sync-gmail', {
      method: 'POST',
    }),

  getBounces: () =>
    request<{ ok: boolean; bounces: any[] }>('/api/career/applications/bounces'),

  getJobNotifications: () => request<{ ok: boolean; notifications: JobNotification[] }>('/api/career/notifications'),

  markJobNotificationRead: (id: string) => request<{ ok: boolean }>(`/api/career/notifications/${id}/read`, { method: 'POST' }),
};

export const client = api;
