import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authenticate } from '../security/auth.js';
import type { Database } from '../db/database.js';
import { JobSourceService } from '../services/jobSourceService.js';
import { jobMatchingEngine } from '../services/jobMatchingEngine.js';
import { resumeService } from '../services/resumeService.js';
import { applicationService } from '../services/applicationService.js';
import { jobEmailAssistant } from '../services/jobEmailAssistant.js';
import { JobDiscoveryScheduler } from '../services/jobDiscoveryScheduler.js';
import { sendEmail, EmailNotConfiguredError, RecipientValidationError } from '../services/emailService.js';
import { EmailValidationService } from '../services/emailValidationService.js';
import { GmailSyncService } from '../services/gmailSyncService.js';
import { DocxBuilder } from '../services/docxBuilder.js';
import { jobEmailDiscoveryService } from '../services/jobEmailDiscoveryService.js';
import { applicationEmailGenerator } from '../services/applicationEmailGenerator.js';
import type {
  CareerProfile,
  JobSearchParams,
  JobDiscoveryConfig,
  JobApplication,
  JobApplicationStatus,
  StoredResume,
  GeneratedResume,
  JobApplicationEmailRecord,
  EmployerResponseRecord
} from '../types/domain.js';

export async function jobRoutes(app: FastifyInstance, options: { database: Database }): Promise<void> {
  const db = options.database;
  const jobSource = new JobSourceService(db);
  const scheduler = JobDiscoveryScheduler.getInstance(db);

  if (process.env.NODE_ENV !== 'test') {
    scheduler.start();
  }

  app.register(async (authedApp) => {
    authedApp.addHook('preHandler', authenticate);

    // ==========================================
    // 1. CAREER PROFILE
    // ==========================================
    authedApp.get('/api/career/profile', async () => {
      let profile = db.getCareerProfile('default');
      if (!profile) {
        profile = {
          id: 'prof_default',
          userId: 'default',
          fullName: 'Professional Engineer',
          email: 'engineer@example.com',
          phone: '+92 300 1234567',
          location: 'Lahore, Pakistan',
          preferredLocations: ['Remote', 'Worldwide', 'United States', 'United Arab Emirates', 'United Kingdom'],
          summary: 'Experienced Full Stack Engineer with strong foundations in TypeScript, Node.js, React, and cloud architectures.',
          skills: ['TypeScript', 'JavaScript', 'Node.js', 'React', 'REST API', 'Git', 'SQL', 'Docker'],
          professionalSkills: ['System Design', 'Agile Delivery', 'Problem Solving', 'Mentoring'],
          experience: [
            {
              title: 'Senior Software Engineer',
              company: 'Tech Solutions Global',
              startDate: '2022',
              endDate: 'Present',
              location: 'Remote',
              description: 'Architecting scalable web applications and distributed backend microservices.'
            }
          ],
          internships: [],
          education: [
            {
              degree: 'Bachelor of Science',
              field: 'Computer Science',
              institution: 'Engineering University',
              year: '2021'
            }
          ],
          certifications: [],
          projects: [],
          portfolioLinks: ['https://github.com/'],
          socialAccounts: [],
          languages: ['English', 'Urdu'],
          targetRoles: ['Full Stack Developer', 'Software Engineer', 'Backend Developer'],
          employmentTypes: ['Full-time', 'Contract'],
          remotePreference: 'Remote',
          minSalary: '$50,000',
          visaStatus: 'Open to Relocation / Remote Contractor',
          photoUrl: '',
          includePhotoInResume: true,
          updatedAt: new Date().toISOString()
        };
        db.upsertCareerProfile(profile);
      }
      return { ok: true, profile };
    });

    authedApp.put('/api/career/profile', { bodyLimit: 25 * 1024 * 1024 }, async (request) => {
      const body = request.body as Partial<CareerProfile>;
      const updated = db.upsertCareerProfile({
        ...body,
        userId: 'default',
      });
      return { ok: true, profile: updated };
    });

    // ==========================================
    // 2. PLATFORMS & DISCOVERY CONFIG
    // ==========================================
    authedApp.get('/api/career/platforms', async () => {
      const platforms = jobSource.getSupportedPlatforms();
      return { ok: true, platforms };
    });

    authedApp.get('/api/career/config', async () => {
      const config = db.getJobDiscoveryConfig();
      return { ok: true, config };
    });

    authedApp.put('/api/career/config', async (request) => {
      const body = request.body as Partial<JobDiscoveryConfig>;
      if (body.minCompatibilityScore !== undefined) {
        body.minCompatibilityScore = Math.max(0, Math.min(100, Math.round(Number(body.minCompatibilityScore))));
      }
      const updated = db.updateJobDiscoveryConfig(body);
      return { ok: true, config: updated };
    });

    // ==========================================
    // 3. JOB SEARCH & DISCOVERY
    // ==========================================
    authedApp.get('/api/career/jobs', async (request) => {
      const query = request.query as Record<string, string>;
      const profile = db.getCareerProfile();

      // Check if DB has listings; if not, trigger initial auto-discovery
      const initialCheck = db.listJobListings({ limit: 1 });
      if (initialCheck.jobs.length === 0) {
        try {
          await jobSource.syncJobsFromAllSources();
        } catch (err) {
          console.warn('Initial job discovery warning:', err);
        }
      }

      const params: JobSearchParams = {
        query: query.query || undefined,
        country: query.country || undefined,
        workplaceType: (query.workplaceType as any) || undefined,
        employmentType: (query.employmentType as any) || undefined,
        experienceLevel: (query.experienceLevel as any) || undefined,
        source: query.platform || undefined,
        minSalary: query.minSalary ? Number(query.minSalary) : undefined,
        dateFilter: (query.dateFilter as any) || undefined,
        customStartDate: query.customStartDate || undefined,
        customEndDate: query.customEndDate || undefined,
        limit: query.limit ? Number(query.limit) : 60,
        page: query.page ? Number(query.page) : 1
      };

      const { jobs, total } = db.listJobListings(params);
      const savedJobs = db.listSavedJobs();
      const savedJobIds = new Set(savedJobs.map(j => j.id));
      const apps = db.listJobApplications();
      const appliedMap = new Map(apps.map(a => [a.jobId, a]));

      // Augment each job with dynamic AI match evaluation
      const augmented = jobs.map(job => {
        const match = jobMatchingEngine.evaluate(profile, job);
        const isSaved = savedJobIds.has(job.id);
        const existingApp = appliedMap.get(job.id);

        return {
          ...job,
          matchScore: match.score,
          matchReasons: match.matchReasons,
          missingSkills: match.missingSkills,
          salaryFit: match.salaryFit,
          visaGuidance: match.visaGuidance,
          marketTips: match.marketTips,
          isSaved,
          applicationStatus: existingApp ? existingApp.status : undefined,
          applicationId: existingApp ? existingApp.id : undefined
        };
      });

      let filtered = augmented;
      if (query.savedOnly === 'true') {
        filtered = filtered.filter(j => j.isSaved);
      }
      if (query.appliedOnly === 'true') {
        filtered = filtered.filter(j => Boolean(j.applicationStatus));
      }

      filtered.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));

      return {
        ok: true,
        total: query.savedOnly === 'true' || query.appliedOnly === 'true' ? filtered.length : total,
        jobs: filtered
      };
    });

    authedApp.get('/api/career/jobs/sync-status', async () => {
      const status = scheduler.getStatus();
      return { ok: true, status };
    });

    authedApp.get('/api/career/jobs/stats', async () => {
      const stats = db.getJobDiscoveryStats();
      return { ok: true, stats };
    });

    authedApp.get('/api/career/jobs/sync-history', async (request) => {
      const query = request.query as { limit?: string };
      const limit = Number(query.limit) || 30;
      const logs = db.listJobSyncLogs(limit);
      return { ok: true, logs };
    });

    authedApp.post('/api/career/scheduler/toggle', async (request) => {
      const body = (request.body || {}) as { enabled?: boolean; intervalHours?: number };
      const config = db.getJobDiscoveryConfig();
      const newEnabled = body.enabled !== undefined ? body.enabled : !(config as any).autoSyncEnabled;
      const updated = db.updateJobDiscoveryConfig({
        autoDiscoveryIntervalHours: body.intervalHours || config.autoDiscoveryIntervalHours || 6,
        autoSyncEnabled: newEnabled,
      } as any);
      return { ok: true, config: updated, schedulerStatus: newEnabled ? 'active' : 'paused' };
    });

    authedApp.post('/api/career/jobs/sync', async () => {
      try {
        const syncResult = await scheduler.runSync('manual');
        return {
          ok: true,
          count: syncResult.totalFetched,
          newSaved: syncResult.newSaved,
          duplicatesSkipped: syncResult.duplicatesSkipped,
          sourcesChecked: syncResult.sourcesChecked,
          sourcesFailed: syncResult.sourcesFailed,
          status: scheduler.getStatus(),
          message: `Synchronized ${syncResult.totalFetched} listings (${syncResult.newSaved} new, ${syncResult.duplicatesSkipped} duplicates skipped) across ${syncResult.sourcesChecked.join(', ')}.`
        };
      } catch (err: any) {
        return {
          ok: false,
          error: err.message,
          status: scheduler.getStatus()
        };
      }
    });

    authedApp.get('/api/career/jobs/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const job = db.getJobListing(id);
      if (!job) {
        return reply.code(404).send({ ok: false, error: 'Job listing not found.' });
      }

      const profile = db.getCareerProfile();
      const match = jobMatchingEngine.evaluate(profile, job);
      const isSaved = db.isJobSaved(job.id);
      const application = db.getJobApplicationByJobId(job.id);

      return {
        ok: true,
        job: {
          ...job,
          matchScore: match.score,
          matchReasons: match.matchReasons,
          missingSkills: match.missingSkills,
          salaryFit: match.salaryFit,
          visaGuidance: match.visaGuidance,
          marketTips: match.marketTips,
          isSaved,
          application
        }
      };
    });

    authedApp.post('/api/career/jobs/:id/save', async (request) => {
      const { id } = request.params as { id: string };
      const isSaved = db.toggleSaveJob(id);
      return { ok: true, isSaved };
    });

    // ==========================================
    // 4. RESUMES & AI ANALYSIS STUDIO
    // ==========================================
    authedApp.get('/api/career/resumes', async () => {
      const resumes = db.listResumes();
      const result = resumes.map(r => ({
        ...r,
        analysis: db.getResumeAnalysis(r.id)
      }));
      return { ok: true, resumes: result };
    });

    authedApp.post('/api/career/resumes/upload', async (request, reply) => {
      let data: any;
      try {
        data = await request.file();
      } catch (err: any) {
        return reply.code(400).send({ ok: false, error: 'Multipart parsing failed: ' + (err.message || 'Invalid upload stream') });
      }

      if (!data) {
        return reply.code(400).send({ ok: false, error: 'No file uploaded.' });
      }

      const buffer = await data.toBuffer();
      const filename = data.filename || 'resume.pdf';
      const mimeType = data.mimetype || 'application/pdf';
      const ext = path.extname(filename).toLowerCase();

      // Check allowed extensions
      const allowedExts = ['.pdf', '.docx', '.doc', '.txt', '.md', '.rtf'];
      const isAllowed = allowedExts.includes(ext) ||
        mimeType.includes('pdf') ||
        mimeType.includes('word') ||
        mimeType.includes('text');

      if (!isAllowed) {
        return reply.code(400).send({
          ok: false,
          error: `Unsupported file format (${ext || mimeType}). Please upload a PDF (.pdf), Microsoft Word (.docx), or plain text (.txt) document.`
        });
      }

      if (!buffer || buffer.length === 0) {
        return reply.code(400).send({ ok: false, error: 'The uploaded file is empty.' });
      }

      if (buffer.length > 25 * 1024 * 1024) {
        return reply.code(400).send({ ok: false, error: 'File size exceeds maximum allowed limit of 25MB.' });
      }

      // Format-specific sanity check
      if (ext === '.pdf' || mimeType.includes('pdf')) {
        const header = buffer.subarray(0, 1024).toString('utf-8');
        if (!header.includes('%PDF')) {
          return reply.code(400).send({ ok: false, error: 'Corrupted or invalid PDF header. Please check the file and try again.' });
        }
      }

      const resumeId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      try {
        const filePath = await resumeService.saveResumeFile(resumeId, filename, buffer);
        const parsedText = await resumeService.extractText(buffer, mimeType, filename);
        const analysis = resumeService.analyzeResume(resumeId, parsedText);

        const storedResume: StoredResume = {
          id: resumeId,
          filename,
          filePath,
          mimeType,
          fileSize: buffer.length,
          parsedText: typeof parsedText === 'string' ? parsedText : String(parsedText || ''),
          createdAt: new Date().toISOString()
        };

        db.saveResume(storedResume);
        db.saveResumeAnalysis(analysis);

        // Auto-extract candidate skills to update profile if profile has sparse skills
        const profile = db.getCareerProfile();
        if (profile && (!profile.skills || profile.skills.length === 0) && analysis.keywordsDetected.length > 0) {
          profile.skills = analysis.keywordsDetected;
          db.upsertCareerProfile(profile);
        }

        return {
          ok: true,
          resume: storedResume,
          analysis
        };
      } catch (procErr: any) {
        request.log.error(procErr, 'Failed to process and store resume');
        return reply.code(500).send({ ok: false, error: 'Failed to process resume: ' + (procErr.message || 'Unknown processing error') });
      }
    });

    authedApp.get('/api/career/resumes/:id/file', async (request, reply) => {
      const { id } = request.params as { id: string };
      const resume = db.getResume(id);
      if (!resume) {
        return reply.code(404).send({ ok: false, error: 'Resume not found.' });
      }

      try {
        const fileBuffer = await fs.readFile(resume.filePath);
        reply.header('Content-Type', resume.mimeType || 'application/octet-stream');
        reply.header('Content-Disposition', `inline; filename="${resume.filename}"`);
        return reply.send(fileBuffer);
      } catch {
        return reply.code(404).send({ ok: false, error: 'Resume file missing from storage.' });
      }
    });

    authedApp.delete('/api/career/resumes/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const resume = db.getResume(id);
      if (!resume) {
        return reply.code(404).send({ ok: false, error: 'Resume not found.' });
      }

      await resumeService.deleteResumeFile(resume.filePath);
      const deleted = db.deleteResume(id);
      return { ok: true, deleted, id };
    });

    authedApp.post('/api/career/resumes/:id/analyze', async (request, reply) => {
      const { id } = request.params as { id: string };
      const resume = db.getResume(id);
      if (!resume) {
        return reply.code(404).send({ ok: false, error: 'Resume not found.' });
      }

      const analysis = resumeService.analyzeResume(resume.id, resume.parsedText);
      db.saveResumeAnalysis(analysis);

      return { ok: true, analysis };
    });

    authedApp.post('/api/career/resumes/generate', async (request) => {
      const body = request.body as {
        templateType?: 'software_engineering' | 'international' | 'remote_work' | 'general_professional' | 'entry_level';
        customProfile?: Partial<CareerProfile>;
      };
      const profile = db.getCareerProfile() || undefined;
      const combined = { ...profile, ...(body.customProfile || {}) };

      const generated = resumeService.generateTailoredResume(
        combined,
        body.templateType || 'software_engineering'
      );

      db.saveGeneratedResume(generated);
      return { ok: true, generatedResume: generated };
    });

    authedApp.get('/api/career/resumes/generated', async (request) => {
      const query = request.query as { resumeId?: string };
      const generatedResumes = db.listGeneratedResumes(query.resumeId);
      return { ok: true, generatedResumes };
    });

    authedApp.get('/api/career/resumes/generated/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const resume = db.getGeneratedResume(id);
      if (!resume) {
        return reply.code(404).send({ ok: false, error: 'Generated resume not found.' });
      }
      return { ok: true, generatedResume: resume };
    });

    authedApp.put('/api/career/resumes/generated/:id', { bodyLimit: 25 * 1024 * 1024 }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Partial<GeneratedResume>;
      const updated = db.updateGeneratedResume(id, body);
      if (!updated) {
        return reply.code(404).send({ ok: false, error: 'Generated resume not found.' });
      }
      return { ok: true, generatedResume: updated };
    });

    authedApp.get('/api/career/resumes/generated/:id/docx', async (request, reply) => {
      const { id } = request.params as { id: string };
      const resume = db.getGeneratedResume(id);
      if (!resume) {
        return reply.code(404).send({ ok: false, error: 'Generated resume not found.' });
      }

      const profile = db.getCareerProfile();
      const docxBuffer = await DocxBuilder.buildFromMarkdown(resume.title, resume.contentText, profile || undefined);
      const safeFilename = (resume.title || 'Resume')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_');

      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      reply.header('Content-Disposition', `attachment; filename="${safeFilename}.docx"`);
      return reply.send(docxBuffer);
    });

    // ==========================================
    // 5. APPLICATIONS & AUTO-APPLY WORKFLOW
    // ==========================================
    authedApp.get('/api/career/applications', async () => {
      const applications = db.listJobApplications();
      const stats = db.getApplicationStats();
      const todayCount = db.countApplicationsToday();
      return {
        ok: true,
        applications,
        stats,
        todayCount
      };
    });

    authedApp.post('/api/career/applications/prepare', async (request, reply) => {
      const { jobId } = request.body as { jobId: string };
      const job = db.getJobListing(jobId);
      if (!job) {
        return reply.code(404).send({ ok: false, error: 'Job not found.' });
      }

      const profile = db.getCareerProfile();
      const packageData = applicationService.prepareManualApplication(profile, job);

      return { ok: true, package: packageData };
    });

    authedApp.post('/api/career/applications/apply', async (request, reply) => {
      const body = request.body as {
        jobId: string;
        mode: 'manual' | 'automatic';
        customCoverLetter?: string;
        customAnswers?: Record<string, string>;
      };

      const job = db.getJobListing(body.jobId);
      if (!job) {
        return reply.code(404).send({ ok: false, error: 'Job listing not found.' });
      }

      const profile = db.getCareerProfile();
      const config = db.getJobDiscoveryConfig();
      const match = jobMatchingEngine.evaluate(profile, job);

      if (body.mode === 'automatic') {
        const result = await applicationService.processAutoApply(db, job.id, profile, config, match.score);
        if (!result.success) {
          return reply.code(400).send({ ok: false, error: result.error });
        }
        return { ok: true, application: result.application };
      }

      // Manual Mode
      const existing = db.getJobApplicationByJobId(job.id);
      const appId = existing?.id || `app_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const application = {
        id: appId,
        jobId: job.id,
        status: 'submitted' as JobApplicationStatus,
        applicationMode: 'manual' as const,
        coverLetter: body.customCoverLetter || applicationService.generateCoverLetter(profile, job),
        answers: body.customAnswers || applicationService.generateApplicationAnswers(profile, job),
        submissionRef: `MANUAL-${Date.now()}`,
        appliedAt: existing?.appliedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      db.saveJobApplication(application);

      db.addJobNotification({
        type: 'application_submitted',
        title: `Applied to ${job.title}`,
        message: `You recorded an application to ${job.company}.`,
        jobId: job.id
      });

      return { ok: true, application };
    });

    authedApp.patch('/api/career/applications/:id/status', async (request, reply) => {
      const { id } = request.params as { id: string };
      const { status } = request.body as { status: JobApplicationStatus };

      const updated = db.updateJobApplicationStatus(id, status);
      if (!updated) {
        return reply.code(404).send({ ok: false, error: 'Application not found.' });
      }

      return { ok: true, application: updated };
    });

    // ==========================================
    // RECIPIENT EMAIL DISCOVERY & EMAIL DRAFTING
    // ==========================================
    authedApp.get('/api/career/jobs/:id/recipient-email', async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { refresh?: string };
      const job = db.getJobListing(id);
      if (!job) {
        return reply.code(404).send({ ok: false, error: 'Job listing not found.' });
      }

      const discovery = await jobEmailDiscoveryService.discoverRecipientEmail(job, {
        bypassCache: query.refresh === 'true',
      });
      if (discovery.found && discovery.email && !job.contactEmail) {
        job.contactEmail = discovery.email;
        db.saveJobListing(job);
      }

      return {
        ok: true,
        discovery,
      };
    });

    authedApp.get('/api/career/jobs/:id/application-email', async (request, reply) => {
      const { id } = request.params as { id: string };
      const job = db.getJobListing(id);
      if (!job) {
        return reply.code(404).send({ ok: false, error: 'Job listing not found.' });
      }

      const profile = db.getCareerProfile();
      const generated = applicationEmailGenerator.generateEmail(profile, job);

      return {
        ok: true,
        email: generated,
      };
    });

    authedApp.post('/api/career/jobs/:id/render-email', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { subject?: string; body?: string };
      const job = db.getJobListing(id);
      if (!job) {
        return reply.code(404).send({ ok: false, error: 'Job listing not found.' });
      }

      const profile = db.getCareerProfile();
      const subject = body.subject?.trim() || `Application for ${job.title}`;
      const html = applicationEmailGenerator.renderHtmlFromEditedText(
        body.body || '',
        subject,
        profile,
        job,
      );

      return {
        ok: true,
        html,
      };
    });

    authedApp.get('/api/career/applications/emails', async (request) => {
      const query = request.query as { jobId?: string };
      const emails = db.listJobApplicationEmails(query.jobId);
      return { ok: true, emails };
    });

    authedApp.post('/api/career/applications/send-email', async (request, reply) => {
      const body = request.body as {
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
      };

      const job = db.getJobListing(body.jobId);
      if (!job) {
        return reply.code(404).send({ ok: false, error: 'Job listing not found.' });
      }

      if (!body.recipientEmail?.trim()) {
        return reply.code(400).send({ ok: false, error: 'Recipient email address is required.' });
      }

      const targetEmail = body.recipientEmail.trim();

      // Pre-flight recipient domain validation (check dummy domains and DNS MX reachability)
      const recipientVal = await EmailValidationService.validateRecipient(targetEmail, true);
      if (!recipientVal.valid) {
        return reply.code(400).send({
          ok: false,
          error: recipientVal.reason || `Recipient address "${targetEmail}" is unreachable or invalid.`,
          actionAdvice: recipientVal.recommendedAction || 'Please verify the recipient email address or apply directly via the company career portal.',
          isPlaceholderDomain: recipientVal.isDummyDomain,
        });
      }

      const now = new Date().toISOString();
      let deliveryStatus:
        | 'draft_created'
        | 'opened_in_gmail'
        | 'awaiting_confirmation'
        | 'sending'
        | 'sent'
        | 'accepted_by_provider'
        | 'delivery_confirmed'
        | 'failed'
        | 'bounced' = 'accepted_by_provider';
      let messageId = `msg_${Date.now()}`;
      let smtpResponseCode = '';
      let failureReason = '';
      let recommendedAction = '';

      // Prepare resume attachment if resumeId is provided
      let attachments: Array<{ filename: string; content?: Buffer; contentType?: string }> | undefined;
      let finalResumeName = body.resumeName || '';

      if (body.resumeId) {
        // 1. Check if uploaded resume
        const stored = db.getResume(body.resumeId);
        if (stored) {
          try {
            const buf = await fs.readFile(stored.filePath);
            finalResumeName = stored.filename;
            attachments = [{
              filename: stored.filename,
              content: buf,
              contentType: stored.mimeType || 'application/pdf',
            }];
          } catch (fileErr) {
            request.log.warn({ fileErr }, 'Uploaded resume file could not be read for attachment');
          }
        } else {
          // 2. Check if generated tailored resume
          const generated = db.getGeneratedResume(body.resumeId);
          if (generated) {
            try {
              const profile = db.getCareerProfile();
              const docxBuf = await DocxBuilder.buildFromMarkdown(generated.title, generated.contentText, profile || undefined);
              finalResumeName = `${(generated.title || 'Resume').replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`;
              attachments = [{
                filename: finalResumeName,
                content: docxBuf,
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              }];
            } catch (docxErr) {
              request.log.warn({ docxErr }, 'Generated resume could not be converted to docx for attachment');
            }
          }
        }
      }

      const profile = db.getCareerProfile();
      const finalHtmlBody =
        body.bodyEdited || !body.htmlBody
          ? applicationEmailGenerator.renderHtmlFromEditedText(
              body.body.trim(),
              body.subject.trim(),
              profile,
              job,
            )
          : body.htmlBody;

      try {
        const sendRes = await sendEmail({
          to: targetEmail,
          subject: body.subject.trim(),
          text: body.body.trim(),
          html: finalHtmlBody,
          replyTo: body.senderEmail?.trim() || undefined,
          attachments,
        });
        messageId = sendRes.messageId || messageId;
        smtpResponseCode = sendRes.response || '250 2.0.0 OK Handshake Accepted';
        deliveryStatus = 'accepted_by_provider';
      } catch (err: any) {
        if (err instanceof EmailNotConfiguredError) {
          deliveryStatus = 'draft_created';
          failureReason = 'SMTP credentials are not configured on the backend server.';
          recommendedAction = 'Configure SMTP credentials in your environment or use the direct Gmail compose button.';
        } else if (err instanceof RecipientValidationError) {
          return reply.code(400).send({
            ok: false,
            error: err.message,
            actionAdvice: err.actionAdvice,
          });
        } else {
          deliveryStatus = 'failed';
          failureReason = err.message || 'SMTP delivery failed';
          recommendedAction = 'Check email authentication or apply through the official company careers portal.';
        }
      }

      // 1. Update or create job_application
      const existingApp = db.getJobApplicationByJobId(job.id);
      const appId = existingApp?.id || `app_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const appStatus: JobApplicationStatus =
        deliveryStatus === 'failed'
          ? 'failed'
          : deliveryStatus === 'draft_created'
          ? 'draft_created'
          : 'accepted_by_provider';

      const application: JobApplication = {
        id: appId,
        jobId: job.id,
        status: appStatus,
        applicationMode: 'email' as const,
        resumeId: body.resumeId,
        coverLetter: body.body,
        answers: {},
        submissionRef: messageId,
        failureReason: failureReason || undefined,
        smtpResponseCode: smtpResponseCode || undefined,
        recommendedAction: recommendedAction || undefined,
        notes: `Application email ${deliveryStatus === 'accepted_by_provider' ? 'transmitted to' : 'draft prepared for'} ${targetEmail}${finalResumeName ? ` with attached resume "${finalResumeName}"` : ''}`,
        recipientEmail: targetEmail,
        senderEmail: body.senderEmail,
        emailSubject: body.subject,
        emailBody: body.body,
        sentAt: deliveryStatus === 'accepted_by_provider' ? now : undefined,
        deliveryStatus,
        appliedAt: existingApp?.appliedAt || now,
        updatedAt: now,
      };

      db.saveJobApplication(application);

      // 2. Record in job_application_emails
      const emailRecord: JobApplicationEmailRecord = {
        id: `email_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        applicationId: appId,
        jobId: job.id,
        companyName: job.company,
        jobTitle: job.title,
        recipientEmail: targetEmail,
        senderEmail: body.senderEmail,
        subject: body.subject,
        body: body.body,
        resumeId: body.resumeId,
        resumeName: finalResumeName || body.resumeName,
        sentAt: deliveryStatus === 'accepted_by_provider' ? now : '',
        deliveryStatus,
        failureReason: failureReason || undefined,
        smtpResponseCode: smtpResponseCode || undefined,
        recommendedAction: recommendedAction || undefined,
        createdAt: now,
      };
      db.saveJobApplicationEmail(emailRecord);

      // 3. Activity timeline event
      const timelineActivity =
        deliveryStatus === 'accepted_by_provider'
          ? `Application Email Accepted by Mail Server (${smtpResponseCode})`
          : deliveryStatus === 'draft_created'
          ? `Application Draft Created (SMTP Unconfigured)`
          : `Application Email Failed to Dispatch`;

      db.addApplicationActivityEvent(appId, {
        date: now.slice(0, 10),
        time: now.slice(11, 16),
        activity: timelineActivity,
        details: `Recipient: ${targetEmail} • Subject: "${body.subject}" • Attachment: ${finalResumeName || 'None'} • Message ID: ${messageId}${failureReason ? ` • Error: ${failureReason}` : ''}`,
        icon: deliveryStatus === 'accepted_by_provider' ? 'send' : deliveryStatus === 'draft_created' ? 'file-text' : 'alert-triangle',
      });

      // 4. Notification
      db.addJobNotification({
        type: 'application_submitted',
        title: deliveryStatus === 'accepted_by_provider' ? `Emailed Application to ${job.company}` : `Application Draft Saved`,
        message: deliveryStatus === 'accepted_by_provider'
          ? `Your application email for ${job.title} was accepted by Gmail SMTP for delivery to ${targetEmail}.`
          : `Draft prepared for ${job.title} at ${job.company}. Connect SMTP or dispatch via Gmail client.`,
        jobId: job.id,
      });

      return {
        ok: true,
        deliveryStatus,
        messageId,
        smtpResponseCode,
        application,
        emailRecord,
        attachedResume: finalResumeName || null,
      };
    });

    authedApp.post('/api/career/applications/:id/open-gmail', async (request, reply) => {
      const { id } = request.params as { id: string };
      const application = db.getJobApplication(id);
      if (!application) {
        return reply.code(404).send({ ok: false, error: 'Application not found.' });
      }

      const now = new Date().toISOString();
      const updatedApp: JobApplication = {
        ...application,
        status: 'opened_in_gmail',
        deliveryStatus: 'opened_in_gmail',
        updatedAt: now,
      };
      db.saveJobApplication(updatedApp);

      db.addApplicationActivityEvent(id, {
        date: now.slice(0, 10),
        time: now.slice(11, 16),
        activity: 'Opened in Gmail / Mail Client — Awaiting Send Confirmation',
        details: `Redirected user to compose window with formatted application content and pre-filled recipient.`,
        icon: 'external-link',
      });

      return { ok: true, application: updatedApp };
    });

    authedApp.post('/api/career/applications/:id/confirm-sent', async (request, reply) => {
      const { id } = request.params as { id: string };
      const application = db.getJobApplication(id);
      if (!application) {
        return reply.code(404).send({ ok: false, error: 'Application not found.' });
      }

      const now = new Date().toISOString();
      const updatedApp: JobApplication = {
        ...application,
        status: 'sent',
        deliveryStatus: 'sent',
        sentAt: application.sentAt || now,
        updatedAt: now,
      };
      db.saveJobApplication(updatedApp);

      db.addApplicationActivityEvent(id, {
        date: now.slice(0, 10),
        time: now.slice(11, 16),
        activity: 'Application Email Transmission Confirmed',
        details: `User confirmed application email was dispatched from their external mail client.`,
        icon: 'check-circle',
      });

      return { ok: true, application: updatedApp };
    });

    authedApp.post('/api/career/applications/sync-gmail', async () => {
      try {
        const summary = await GmailSyncService.syncApplicationsWithGmail(db);
        return { ok: true, summary };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Gmail synchronization encountered an error.' };
      }
    });

    authedApp.get('/api/career/applications/bounces', async () => {
      try {
        const bounces = await GmailSyncService.scanForBounces();
        return { ok: true, bounces };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Failed to scan Gmail inbox for bounces.' };
      }
    });

    authedApp.post('/api/career/applications/:id/ai-reply', async (request, reply) => {
      const { id } = request.params as { id: string };
      const { employerMessage } = request.body as { employerMessage: string };

      if (!employerMessage?.trim()) {
        return reply.code(400).send({ ok: false, error: 'Employer message is required.' });
      }

      const application = db.getJobApplication(id);
      if (!application) {
        return reply.code(404).send({ ok: false, error: 'Application not found.' });
      }

      const profile = db.getCareerProfile();
      const job = db.getJobListing(application.jobId);
      const analysis = jobEmailAssistant.analyzeAndGenerateReply(employerMessage, profile, job);

      return { ok: true, analysis };
    });

    authedApp.post('/api/career/applications/:id/log-response', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        fromEmail: string;
        subject: string;
        body: string;
        category?: EmployerResponseRecord['category'];
        userReply?: string;
      };

      const application = db.getJobApplication(id);
      if (!application) {
        return reply.code(404).send({ ok: false, error: 'Application not found.' });
      }

      const now = new Date().toISOString();
      const record = db.addEmployerResponse(id, {
        fromEmail: body.fromEmail || 'employer@company.com',
        subject: body.subject || 'Follow up on your application',
        body: body.body || '',
        receivedAt: now,
        category: body.category || 'general',
        userReply: body.userReply || undefined,
        repliedAt: body.userReply ? now : undefined,
      });

      db.addJobNotification({
        type: 'interview',
        title: `Employer Response: ${application.job?.company || 'Company'}`,
        message: `Received email response: "${body.subject || 'Application update'}"`,
        jobId: application.jobId,
      });

      return { ok: true, responseRecord: record, application: db.getJobApplication(id) };
    });

    // ==========================================
    // 6. IN-APP NOTIFICATIONS
    // ==========================================
    authedApp.get('/api/career/notifications', async () => {
      const notifications = db.listJobNotifications();
      return { ok: true, notifications };
    });

    authedApp.post('/api/career/notifications/:id/read', async (request) => {
      const { id } = request.params as { id: string };
      db.markJobNotificationRead(id);
      return { ok: true };
    });
  });
}
