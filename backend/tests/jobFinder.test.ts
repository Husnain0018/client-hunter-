import '@whiskeysockets/baileys';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../src/db/database.js';
import { jobMatchingEngine } from '../src/services/jobMatchingEngine.js';
import { resumeService } from '../src/services/resumeService.js';
import { applicationService } from '../src/services/applicationService.js';
import { jobEmailDiscoveryService } from '../src/services/jobEmailDiscoveryService.js';
import { applicationEmailGenerator } from '../src/services/applicationEmailGenerator.js';
import { buildApp } from '../src/server.js';
import { issueToken } from '../src/security/auth.js';
import type { CareerProfile, JobListing } from '../src/types/domain.js';

const tempFiles: string[] = [];
const tempDbs: Database[] = [];
afterEach(() => {
  for (const db of tempDbs.splice(0)) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  for (const file of tempFiles.splice(0)) {
    try {
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    } catch {
      // cleanup best effort
    }
  }
});

function createTestDb(): Database {
  const file = path.join(os.tmpdir(), `ch-test-jobfinder-${randomUUID()}.sqlite`);
  tempFiles.push(file);
  const db = new Database(file);
  tempDbs.push(db);
  return db;
}

describe('AI Job Finder & Career Assistant Backend', () => {
  it('manages career profiles and search listings in database', () => {
    const db = createTestDb();

    // 1. Profile upsert & get
    const sampleProfile: CareerProfile = {
      id: 'prof-123',
      userId: 'default',
      fullName: 'Ahmad Khan',
      email: 'ahmad@example.com',
      phone: '+92 300 9998877',
      location: 'Lahore, Pakistan',
      preferredLocations: ['Remote', 'Worldwide', 'United States'],
      summary: 'Senior TypeScript and React Developer',
      skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker'],
      experience: [
        {
          title: 'Senior Engineer',
          company: 'Nexus Tech',
          startDate: '2021',
          description: 'Architecting high-scale distributed backends'
        }
      ],
      education: [
        {
          degree: 'BS Computer Science',
          field: 'CS',
          institution: 'FAST NUCES',
          year: '2020'
        }
      ],
      certifications: [],
      projects: [],
      portfolioLinks: ['https://github.com/ahmadkhan'],
      languages: ['English', 'Urdu'],
      targetRoles: ['Full Stack Developer', 'Software Engineer'],
      employmentTypes: ['Full-time', 'Contract'],
      remotePreference: 'Remote',
      minSalary: '$70,000',
      visaStatus: 'Eligible for remote / Open to relocation',
      updatedAt: new Date().toISOString()
    };

    db.upsertCareerProfile(sampleProfile);
    const retrieved = db.getCareerProfile();
    expect(retrieved).not.toBeNull();
    expect(retrieved?.fullName).toBe('Ahmad Khan');
    expect(retrieved?.skills).toContain('TypeScript');

    // 2. Job Listing storage & search
    const job1: JobListing = {
      id: 'job-1',
      externalId: 'ext-1',
      source: 'Remote OK',
      title: 'Senior Full Stack TypeScript Engineer',
      company: 'CloudFlow Global',
      location: 'Remote',
      country: 'Worldwide',
      workplaceType: 'Remote',
      employmentType: 'Full-time',
      experienceLevel: 'Senior',
      salaryMin: 80000,
      salaryMax: 120000,
      salaryCurrency: 'USD',
      description: 'Looking for a Senior TypeScript developer proficient with React and Docker.',
      skills: ['TypeScript', 'React', 'Docker'],
      requirements: ['5+ years experience in TypeScript', 'Strong background in Node.js and React'],
      applyUrl: 'https://cloudflow.example/apply',
      sourceUrl: 'https://remoteok.com/job/1',
      postedAt: new Date().toISOString(),
      isActive: true,
      discoveredAt: new Date().toISOString()
    };

    const job2: JobListing = {
      id: 'job-2',
      externalId: 'ext-2',
      source: 'Arbeitnow',
      title: 'Python Data Scientist',
      company: 'Berlin Analytics',
      location: 'Berlin, Germany',
      country: 'Germany',
      workplaceType: 'Hybrid',
      employmentType: 'Full-time',
      experienceLevel: 'Mid-level',
      salaryMin: 60000,
      salaryMax: 75000,
      salaryCurrency: 'EUR',
      description: 'Building machine learning predictive pipelines in Python.',
      skills: ['Python', 'Pandas', 'PyTorch'],
      requirements: ['Experience with Python data modeling'],
      applyUrl: 'https://berlinanalytics.example/jobs/2',
      sourceUrl: 'https://arbeitnow.com/job/2',
      postedAt: new Date().toISOString(),
      isActive: true,
      discoveredAt: new Date().toISOString()
    };

    db.saveJobListingsBatch([job1, job2]);

    // Query all
    const allResult = db.listJobListings({ limit: 10 });
    expect(allResult.total).toBe(2);

    // Filter by query
    const tsResult = db.listJobListings({ query: 'TypeScript' });
    expect(tsResult.jobs.length).toBe(1);
    expect(tsResult.jobs[0].company).toBe('CloudFlow Global');

    // Filter by country
    const deResult = db.listJobListings({ country: 'Germany' });
    expect(deResult.jobs.length).toBe(1);
    expect(deResult.jobs[0].title).toBe('Python Data Scientist');

    // Bookmark / Save
    expect(db.isJobSaved('job-1')).toBe(false);
    db.toggleSaveJob('job-1');
    expect(db.isJobSaved('job-1')).toBe(true);

    db.close();
  });

  it('evaluates compatibility matching and market guidance accurately', () => {
    const profile: CareerProfile = {
      id: 'prof-test',
      userId: 'user-default',
      fullName: 'Sara Ali',
      email: 'sara@example.com',
      phone: '+92 312 1234567',
      location: 'Karachi, Pakistan',
      preferredLocations: ['Remote', 'Worldwide', 'United Kingdom'],
      summary: 'Frontend Engineer focused on modern React',
      skills: ['React', 'TypeScript', 'JavaScript', 'Tailwind', 'Next.js'],
      experience: [],
      education: [],
      certifications: [],
      projects: [],
      portfolioLinks: ['https://sara.dev'],
      languages: ['English'],
      targetRoles: ['Frontend Engineer', 'React Developer'],
      employmentTypes: ['Full-time'],
      remotePreference: 'Remote',
      minSalary: '$60,000',
      visaStatus: 'Open to sponsorship',
      updatedAt: new Date().toISOString()
    };

    const matchedJob: JobListing = {
      id: 'job-react',
      externalId: 'ext-react',
      source: 'Remote OK',
      title: 'Senior Frontend Engineer (React / TypeScript)',
      company: 'SaaS Worldwide',
      location: 'Remote',
      country: 'Worldwide',
      workplaceType: 'Remote',
      employmentType: 'Full-time',
      experienceLevel: 'Senior',
      salaryMin: 70000,
      salaryMax: 95000,
      salaryCurrency: 'USD',
      description: 'We are seeking a React and TypeScript engineer to build web platforms.',
      skills: ['React', 'TypeScript', 'Tailwind'],
      requirements: ['Strong React proficiency', 'TypeScript experience', 'GraphQL familiarity'],
      applyUrl: 'https://saas.example/apply',
      sourceUrl: 'https://saas.example',
      postedAt: new Date().toISOString(),
      isActive: true,
      discoveredAt: new Date().toISOString()
    };

    const match = jobMatchingEngine.evaluate(profile, matchedJob);
    expect(match.score).toBeGreaterThan(60);
    expect(match.matchReasons.some(r => r.includes('Skills match'))).toBe(true);
    expect(match.matchReasons.some(r => r.includes('Title aligns'))).toBe(true);
    expect(match.visaGuidance).toBeDefined();

    // Guidance for destination countries
    const usGuidance = jobMatchingEngine.getMarketGuidance('Pakistan', 'United States', 'On-site');
    expect(usGuidance?.visaAdvice).toContain('H-1B');

    const ukGuidance = jobMatchingEngine.getMarketGuidance('Pakistan', 'United Kingdom', 'On-site');
    expect(ukGuidance?.visaAdvice).toContain('Skilled Worker Visa');
  });

  it('critiques resume text, calculates ATS score, and generates tailored resumes', async () => {
    const resumeText = `
      John Doe
      john.doe@example.com | +1 555 123 4567 | linkedin.com/in/johndoe | github.com/johndoe
      
      Professional Summary:
      Experienced Software Engineer with over 4 years of hands-on experience building web systems.
      
      Core Technologies:
      TypeScript, React, Node.js, Express, Docker, PostgreSQL, REST APIs, Git.
      
      Experience:
      Senior Software Developer - Alpha Tech (2021 - Present)
      - Architected and engineered high-performance microservices handling 250,000+ monthly requests.
      - Optimized database queries, reducing average API response latency by 45%.
      - Led a cross-functional team of 4 engineers delivering key platform capabilities.
      
      Education:
      Bachelor of Science in Software Engineering, 2020.
    `;

    const analysis = resumeService.analyzeResume('res-test', resumeText);
    expect(analysis.overallScore).toBeGreaterThanOrEqual(70);
    expect(analysis.keywordsDetected).toContain('TypeScript');
    expect(analysis.keywordsDetected).toContain('React');
    expect(analysis.keywordsDetected).toContain('Docker');
    expect(analysis.recommendations.length).toBeGreaterThanOrEqual(0);

    // Tailored resume generation
    const generated = resumeService.generateTailoredResume(
      {
        fullName: 'John Doe',
        email: 'john.doe@example.com',
        headline: 'Senior Full Stack Engineer',
        skills: ['TypeScript', 'React', 'Node.js']
      },
      'international'
    );
    expect(generated.templateType).toBe('international');
    expect(generated.contentText).toContain('John Doe');
    expect(generated.contentText).toContain('Senior Full Stack Engineer');
    expect(generated.contentHtml).toContain('<div class="resume-container">');
  });

  it('runs application service preparation and auto-apply safety guards', async () => {
    const db = createTestDb();

    const profile: CareerProfile = {
      id: 'prof-guard',
      userId: 'default',
      fullName: 'Zainab Qureshi',
      email: 'zainab@example.com',
      phone: '+92 301 7776655',
      location: 'Islamabad, Pakistan',
      preferredLocations: ['Remote', 'Worldwide'],
      summary: 'Backend Engineer',
      skills: ['Node.js', 'PostgreSQL', 'Docker'],
      experience: [],
      education: [],
      certifications: [],
      projects: [],
      portfolioLinks: ['https://zainab.dev'],
      languages: ['English'],
      targetRoles: ['Backend Developer'],
      employmentTypes: ['Full-time'],
      remotePreference: 'Remote',
      minSalary: '$60,000',
      visaStatus: 'Remote eligible',
      updatedAt: new Date().toISOString()
    };
    db.upsertCareerProfile(profile);

    const job: JobListing = {
      id: 'job-sec',
      externalId: 'ext-sec',
      source: 'Remote OK',
      title: 'Backend Node.js Engineer',
      company: 'Fintech Hub',
      location: 'Remote',
      country: 'Worldwide',
      workplaceType: 'Remote',
      employmentType: 'Full-time',
      experienceLevel: 'Mid-level',
      description: 'Building secure payment APIs in Node.js and PostgreSQL.',
      skills: ['Node.js', 'PostgreSQL'],
      requirements: ['Node.js mastery'],
      applyUrl: 'https://fintech.example/apply',
      sourceUrl: 'https://fintech.example',
      postedAt: new Date().toISOString(),
      isActive: true,
      discoveredAt: new Date().toISOString()
    };
    db.saveJobListing(job);

    // Mode A: Preparation
    const prep = applicationService.prepareManualApplication(profile, job);
    expect(prep.readyToApply).toBe(true);
    expect(prep.coverLetter).toContain('Fintech Hub');
    expect(prep.coverLetter).toContain('Zainab Qureshi');
    expect(prep.tailoredAnswers['Current Location']).toContain('Islamabad');

    // Mode B: Auto-Apply with disabled config
    const disabledConfig = db.getJobDiscoveryConfig();
    disabledConfig.autoApplyEnabled = false;
    const failDisabled = await applicationService.processAutoApply(db, job.id, profile, disabledConfig, 85);
    expect(failDisabled.success).toBe(false);
    expect(failDisabled.error).toContain('disabled');

    // Auto-Apply with enabled config & meeting score threshold
    const enabledConfig = db.getJobDiscoveryConfig();
    enabledConfig.autoApplyEnabled = true;
    enabledConfig.minCompatibilityScore = 60;
    const successResult = await applicationService.processAutoApply(db, job.id, profile, enabledConfig, 85);
    expect(successResult.success).toBe(true);
    expect(successResult.application?.status).toBe('submitted');

    // Duplicate check guard
    const duplicateCheck = await applicationService.processAutoApply(db, job.id, profile, enabledConfig, 85);
    expect(duplicateCheck.success).toBe(false);
    expect(duplicateCheck.error).toContain('Already processed');

    db.close();
  });

  it('exposes career REST endpoints via Fastify injection', async () => {
    const db = createTestDb();
    db.saveJobListing({
      id: 'job-seed-1',
      externalId: 'ext-seed-1',
      source: 'Remote OK',
      title: 'Senior Full Stack Engineer',
      company: 'Tech Corp',
      location: 'Remote',
      country: 'Worldwide',
      workplaceType: 'Remote',
      employmentType: 'Full-time',
      experienceLevel: 'Senior',
      description: 'Senior engineer wanted',
      skills: ['TypeScript', 'React'],
      requirements: ['TypeScript'],
      applyUrl: 'https://techcorp.example/apply',
      sourceUrl: 'https://techcorp.example',
      postedAt: new Date().toISOString(),
      isActive: true,
      discoveredAt: new Date().toISOString()
    });
    const app = buildApp(db);
    const token = await issueToken();
    const authHeaders = { authorization: `Bearer ${token}` };

    // 1. Get profile
    const profileRes = await app.inject({
      method: 'GET',
      url: '/api/career/profile',
      headers: authHeaders
    });
    expect(profileRes.statusCode).toBe(200);
    const profileBody = profileRes.json();
    expect(profileBody.ok).toBe(true);
    expect(profileBody.profile).toBeDefined();

    // 2. Update profile
    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/career/profile',
      headers: authHeaders,
      payload: {
        fullName: 'Lead Engineer',
        skills: ['TypeScript', 'React', 'Node.js', 'Docker']
      }
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().profile.fullName).toBe('Lead Engineer');

    // 3. Get discovery config
    const configRes = await app.inject({
      method: 'GET',
      url: '/api/career/config',
      headers: authHeaders
    });
    expect(configRes.statusCode).toBe(200);
    expect(configRes.json().config.autoApplyEnabled).toBeDefined();

    // 4. List jobs (triggers auto-discovery if empty)
    const jobsRes = await app.inject({
      method: 'GET',
      url: '/api/career/jobs?limit=10',
      headers: authHeaders
    });
    expect(jobsRes.statusCode).toBe(200);
    const jobsBody = jobsRes.json();
    expect(jobsBody.ok).toBe(true);
    expect(Array.isArray(jobsBody.jobs)).toBe(true);

    // 5. Generate tailored resume
    const genRes = await app.inject({
      method: 'POST',
      url: '/api/career/resumes/generate',
      headers: authHeaders,
      payload: {
        templateType: 'remote_work'
      }
    });
    expect(genRes.statusCode).toBe(200);
    const genResume = genRes.json().generatedResume;
    expect(genResume.templateType).toBe('remote_work');

    // 6. Update generated resume
    const editRes = await app.inject({
      method: 'PUT',
      url: `/api/career/resumes/generated/${genResume.id}`,
      headers: authHeaders,
      payload: {
        contentText: '# Updated Resume Title\n\n## Summary\nUpdated custom summary text.',
      }
    });
    expect(editRes.statusCode).toBe(200);
    expect(editRes.json().generatedResume.contentText).toContain('Updated custom summary text.');

    // 7. Download DOCX
    const docxRes = await app.inject({
      method: 'GET',
      url: `/api/career/resumes/generated/${genResume.id}/docx`,
      headers: authHeaders,
    });
    expect(docxRes.statusCode).toBe(200);
    expect(docxRes.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(docxRes.rawPayload.length).toBeGreaterThan(100);

    // 8. Discovery stats & sync history
    const statsRes = await app.inject({
      method: 'GET',
      url: '/api/career/jobs/stats',
      headers: authHeaders,
    });
    expect(statsRes.statusCode).toBe(200);
    expect(statsRes.json().stats.totalMatchingJobs).toBeGreaterThanOrEqual(0);

    const historyRes = await app.inject({
      method: 'GET',
      url: '/api/career/jobs/sync-history',
      headers: authHeaders,
    });
    expect(historyRes.statusCode).toBe(200);
    expect(Array.isArray(historyRes.json().logs)).toBe(true);

    // 9. Scheduler toggle
    const toggleRes = await app.inject({
      method: 'POST',
      url: '/api/career/scheduler/toggle',
      headers: authHeaders,
      payload: { enabled: false },
    });
    expect(toggleRes.statusCode).toBe(200);
    expect(toggleRes.json().schedulerStatus).toBe('paused');

    // 10. Recipient Email Discovery
    const firstJob = jobsBody.jobs[0];
    if (firstJob) {
      const discRes = await app.inject({
        method: 'GET',
        url: `/api/career/jobs/${firstJob.id}/recipient-email`,
        headers: authHeaders,
      });
      expect(discRes.statusCode).toBe(200);
      expect(discRes.json().ok).toBe(true);
      expect(discRes.json().discovery).toBeDefined();

      // 11. Application Formatted Email Generator
      const appEmailRes = await app.inject({
        method: 'GET',
        url: `/api/career/jobs/${firstJob.id}/application-email`,
        headers: authHeaders,
      });
      expect(appEmailRes.statusCode).toBe(200);
      expect(appEmailRes.json().email.html).toContain('Application for');
      expect(appEmailRes.json().email.subject).toContain(firstJob.title);

      // 11b. Render Edited Email Body into Executive HTML
      const renderRes = await app.inject({
        method: 'POST',
        url: `/api/career/jobs/${firstJob.id}/render-email`,
        headers: authHeaders,
        payload: {
          subject: 'Custom Subject Line for Application',
          body: 'Dear Hiring Team,\n\nI am excited to apply for the Senior Full Stack Engineer role at Tech Corp.\n\n## Key Highlights\n- Built high-scale distributed Node.js and React platforms.\n- Reduced API latency by 45%.\n\nSincerely,\nLead Engineer',
        },
      });
      expect(renderRes.statusCode).toBe(200);
      expect(renderRes.json().ok).toBe(true);
      expect(renderRes.json().html).toContain('Custom Subject Line for Application');
      expect(renderRes.json().html).toContain('Reduced API latency by 45%');

      // 12. Send Email - Verify dummy email rejection & valid verified send
      const dummyRes = await app.inject({
        method: 'POST',
        url: '/api/career/applications/send-email',
        headers: authHeaders,
        payload: {
          jobId: firstJob.id,
          recipientEmail: 'careers@company.com',
          senderEmail: 'ahmad@example.com',
          subject: 'Application for Engineer',
          body: 'Please review my resume attached.',
          bodyEdited: true,
          resumeId: genResume.id,
        }
      });
      expect(dummyRes.statusCode).toBe(400);
      expect(dummyRes.json().error).toContain('company.com');

      const sendRes = await app.inject({
        method: 'POST',
        url: '/api/career/applications/send-email',
        headers: authHeaders,
        payload: {
          jobId: firstJob.id,
          recipientEmail: 'careers@duckduckgo.com',
          senderEmail: 'ahmad@example.com',
          subject: 'Application for Engineer',
          body: 'Please review my resume attached.',
          bodyEdited: true,
          resumeId: genResume.id,
        }
      });
      expect(sendRes.statusCode).toBe(200);
      expect(sendRes.json().attachedResume).toContain('.docx');
    }

    await app.close();
    db.close();
  }, 15000);

  it('discovers, validates, and prioritizes recruitment emails across job listings, portals, and company websites', async () => {
    // 1. SSRF guard validation
    expect(jobEmailDiscoveryService.isSafePublicUrl('https://careers.acme-tech.com/jobs')).toBe(true);
    expect(jobEmailDiscoveryService.isSafePublicUrl('http://localhost:8787/internal')).toBe(false);
    expect(jobEmailDiscoveryService.isSafePublicUrl('http://127.0.0.1/admin')).toBe(false);
    expect(jobEmailDiscoveryService.isSafePublicUrl('http://169.254.169.254/latest/meta-data')).toBe(false);

    // 2. Job listing with explicit recruitment email in description + general contact email + portal support email
    const jobWithListingEmails: JobListing = {
      id: 'job-email-1',
      externalId: 'ext-email-1',
      source: 'Arbeitnow',
      title: 'Full Stack Developer',
      company: 'NexaCloud GmbH',
      location: 'Berlin, Germany',
      country: 'Germany',
      workplaceType: 'Remote',
      employmentType: 'Full-time',
      experienceLevel: 'Mid',
      description: 'Join NexaCloud! For general inquiries contact info@nexacloud.de or send your CV directly to careers@nexacloud.de. Portal support: support@arbeitnow.com.',
      skills: ['TypeScript', 'React', 'Node.js'],
      requirements: ['3+ years experience'],
      applyUrl: 'https://www.arbeitnow.com/jobs/companies/nexacloud-gmbh/full-stack-developer-123',
      sourceUrl: 'https://www.arbeitnow.com/jobs/companies/nexacloud-gmbh/full-stack-developer-123',
      postedAt: new Date().toISOString(),
      isActive: true,
      discoveredAt: new Date().toISOString(),
    };

    const res1 = await jobEmailDiscoveryService.discoverRecipientEmail(jobWithListingEmails, { bypassCache: true });
    expect(res1.found).toBe(true);
    // Must prioritize careers@nexacloud.de over info@nexacloud.de and filter out support@arbeitnow.com
    expect(res1.email).toBe('careers@nexacloud.de');
    const altEmails = (res1.alternativeEmails || []).map((a) => a.email);
    expect(altEmails).toContain('info@nexacloud.de');
    expect(altEmails).not.toContain('support@arbeitnow.com');
    expect(res1.verificationStatus).toBe('verified');

    // 3. Job listing with obfuscated email entities & multiple contact addresses
    const jobWithObfuscatedEmails: JobListing = {
      ...jobWithListingEmails,
      id: 'job-email-obf-2',
      company: 'Ura AI GmbH',
      description: 'Contact our general desk at hello@ura-ai.de or apply directly to our recruitment team at talent&#64;ura-ai.de (privacy inquiries: privacy@ura-ai.de).',
      applyUrl: 'http://127.0.0.1:9999/portal',
      sourceUrl: 'http://127.0.0.1:9999/portal',
    };
    const resObf = await jobEmailDiscoveryService.discoverRecipientEmail(jobWithObfuscatedEmails, { bypassCache: true });
    expect(resObf.found).toBe(true);
    expect(resObf.email).toBe('talent@ura-ai.de');
    const obfAlts = (resObf.alternativeEmails || []).map((a) => a.email);
    expect(obfAlts).toContain('hello@ura-ai.de');
    expect(obfAlts).not.toContain('privacy@ura-ai.de');

    // 4. Company without publicly available email addresses -> returns not_found without guessing
    const jobWithoutEmails: JobListing = {
      id: 'job-no-email-99',
      externalId: 'ext-no-email-99',
      source: 'Arbeitnow',
      title: 'Backend Engineer',
      company: 'NonExistentStealthCorpXYZ999',
      location: 'Remote',
      country: 'Germany',
      workplaceType: 'Remote',
      employmentType: 'Full-time',
      experienceLevel: 'Senior',
      description: 'Apply exclusively via our portal.',
      skills: ['Go', 'PostgreSQL'],
      requirements: [],
      applyUrl: 'http://127.0.0.1:9999/blocked-portal',
      sourceUrl: 'http://127.0.0.1:9999/blocked-portal',
      postedAt: new Date().toISOString(),
      isActive: true,
      discoveredAt: new Date().toISOString(),
    };
    const resNotFound = await jobEmailDiscoveryService.discoverRecipientEmail(jobWithoutEmails, { bypassCache: true });
    expect(resNotFound.found).toBe(false);
    expect(resNotFound.email).toBe('');
    expect(resNotFound.verificationStatus).toBe('not_found');
    expect(Array.isArray(resNotFound.sourcesChecked)).toBe(true);
    expect(resNotFound.sourcesChecked.length).toBeGreaterThan(0);
  });

  it('generates international-standard 11-section HTML & plain-text application emails across multiple job categories', () => {
    const messyProfile: CareerProfile = {
      id: 'prof-exec-1',
      userId: 'default',
      fullName: 'Ali Husnain',
      email: 'alihusnain998899@gmail.com',
      phone: '+923106207228',
      location: 'Lahore, Pakistan',
      preferredLocations: ['Remote'],
      summary: '## Professional Summary\n\nFull Stack Developer and AI Automation Specialist with hands-on experience designing scalable web applications.\n\n\n\nExperienced in building custom REST APIs, WordPress solutions, and intelligent workflow automation.',
      targetRoles: ['Full Stack Developer', 'WordPress Developer'],
      skills: [
        'React', 'React.js', 'TypeScript', 'Node.js', 'Python', 'FastAPI', 'WordPress',
        'Elementor', 'WooCommerce', 'Docker', 'PostgreSQL', 'MongoDB', 'Tailwind CSS',
        'Responsive Web Design', 'Responsive Website Design', 'Git', 'REST APIs',
      ],
      professionalSkills: ['Problem Solving', 'Agile Delivery', 'Technical Communication'],
      employmentTypes: ['Full-time', 'Contract'],
      remotePreference: 'Remote',
      minSalary: '$4,000',
      visaStatus: 'Eligible for remote',
      education: [
        {
          institution: 'Government College University Faisalabad',
          degree: 'Bachelor of Science',
          field: 'Computer Science',
          year: '2020 - 2024',
          gpa: '3 GPA',
        },
      ],
      experience: [
        {
          company: 'Unitech Solutions',
          title: 'Full Stack Developer',
          location: 'Lahore',
          startDate: '2023',
          endDate: 'Present',
          current: true,
          description: 'Architected multi-tenant SaaS dashboards using React, TypeScript, and Node.js.\n\n\n\nAutomated lead enrichment and WhatsApp outreach pipelines.',
          responsibilities: ['Reduced page load time by 38% across client portals.'],
        },
      ],
      internships: [
        {
          organization: 'TechSoft Labs',
          role: 'Software Engineering Intern',
          duration: 'Jun 2022 - Sep 2022',
          description: 'Built responsive UI components in React and Tailwind CSS.\n\n\n\nAssisted in REST API integration and QA testing.',
          certificateUrl: 'https://certs.example.com/internship-ali-husnain',
        },
      ],
      certifications: [
        {
          name: 'Meta Front-End Developer Professional Certificate',
          issuer: 'Coursera',
          date: '2023',
          url: 'https://coursera.org/verify/META12345',
        },
      ],
      projects: [
        {
          name: 'AI Client Hunter & Job Finder Platform',
          description: 'End-to-end B2B lead discovery, WhatsApp AI agent, and automated job application suite.',
          technologies: ['TypeScript', 'React', 'Fastify', 'SQLite'],
          link: 'https://github.com/alihusnain/ai-client-hunter',
        },
      ],
      portfolioLinks: ['https://github.com/', 'https://alihusnain.dev'],
      socialAccounts: {
        linkedin: 'https://linkedin.com/in/ali-husnain',
        github: 'https://github.com/alihusnain',
      },
      languages: ['English', 'Urdu'],
      updatedAt: new Date().toISOString(),
    };

    const fullStackJob: JobListing = {
      id: 'job-cat-1',
      externalId: 'ext-cat-1',
      source: 'Remote OK',
      title: 'Senior Full Stack Developer',
      company: 'CloudScale Systems',
      location: 'Berlin, Germany',
      country: 'Germany',
      workplaceType: 'Remote',
      employmentType: 'Full-time',
      experienceLevel: 'Senior',
      description: 'Seeking a Senior Full Stack Developer experienced in TypeScript, React, Node.js, PostgreSQL, and Docker.',
      skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker'],
      requirements: ['TypeScript', 'React', 'Node.js'],
      applyUrl: 'https://cloudscale.example.com/jobs/1',
      sourceUrl: 'https://cloudscale.example.com/jobs/1',
      postedAt: new Date().toISOString(),
      isActive: true,
      discoveredAt: new Date().toISOString(),
    };

    const email1 = applicationEmailGenerator.generateEmail(messyProfile, fullStackJob);

    // Verify subject line and clean greeting
    expect(email1.subject).toBe('Application for Senior Full Stack Developer – Ali Husnain');
    expect(email1.html).toContain('Dear Hiring Team at CloudScale Systems,');

    // Verify raw markdown "## Professional Summary" is stripped
    expect(email1.html).not.toContain('## Professional Summary');
    expect(email1.text).not.toContain('## Professional Summary');

    // Verify normalized GPA ("GPA: 3" instead of "GPA: 3 GPA")
    expect(email1.html).toContain('GPA: 3');
    expect(email1.html).not.toContain('GPA: 3 GPA');

    // Verify all 11 sections are present in HTML and Plain Text
    expect(email1.html).toContain('Professional Summary');
    expect(email1.html).toContain('Education');
    expect(email1.html).toContain('Technical &amp; Professional Skills');
    expect(email1.html).toContain('Work Experience');
    expect(email1.html).toContain('Internship Experience');
    expect(email1.html).toContain('Selected Projects');
    expect(email1.html).toContain('Certifications &amp; Training');
    expect(email1.html).toContain('Professional Profiles &amp; Links');
    expect(email1.html).toContain('Sincerely,');

    // Verify clickable verification links for Internship, Project, Certification, and Social Profiles
    expect(email1.html).toContain('href="https://certs.example.com/internship-ali-husnain"');
    expect(email1.html).toContain('href="https://coursera.org/verify/META12345"');
    expect(email1.html).toContain('href="https://github.com/alihusnain/ai-client-hunter"');
    expect(email1.html).toContain('href="https://linkedin.com/in/ali-husnain"');
    // Bare https://github.com/ should be filtered out in favor of https://github.com/alihusnain
    expect(email1.html).toContain('href="https://github.com/alihusnain"');
    expect(email1.html).not.toContain('href="https://github.com/"');

    // Test Category 2: WordPress & AI Automation Specialist role
    const wpJob: JobListing = {
      ...fullStackJob,
      id: 'job-cat-2',
      title: 'WordPress & AI Automation Specialist',
      company: 'Digital Studio Munich',
      skills: ['WordPress', 'Elementor', 'WooCommerce', 'Python', 'FastAPI'],
    };
    const email2 = applicationEmailGenerator.generateEmail(messyProfile, wpJob);
    expect(email2.subject).toBe('Application for WordPress & AI Automation Specialist – Ali Husnain');
    expect(email2.html).toContain('Dear Hiring Team at Digital Studio Munich,');
    expect(email2.html).toContain('WordPress');
  });
});
