import type {
  CareerProfile,
  JobListing,
  JobApplication,
  JobDiscoveryConfig,
  JobApplicationStatus
} from '../types/domain.js';
import type { Database } from '../db/database.js';
import { EmailValidationService } from './emailValidationService.js';

export interface ApplicationPackage {
  job: JobListing;
  coverLetter: string;
  tailoredAnswers: Record<string, string>;
  resumeMarkdown?: string;
  readyToApply: boolean;
  warnings?: string[];
}

export class ApplicationService {
  /**
   * Generates a tailored cover letter customized to the specific job and candidate profile.
   */
  public generateCoverLetter(profile: CareerProfile | null, job: JobListing): string {
    const candidateName = profile?.fullName || 'Candidate';
    const candidateHeadline = profile?.targetRoles?.[0] || 'Software Engineer';
    const matchedSkills = (profile?.skills || []).slice(0, 4).join(', ');

    return `Dear Hiring Team,

I am writing to express my strong interest in the ${job.title} position at ${job.company}, discovered via ${job.source}. With my background as a ${candidateHeadline} and hands-on experience in ${matchedSkills || 'modern software engineering and scalable systems'}, I am excited about the opportunity to contribute to your team.

Throughout my career, I have focused on delivering clean, maintainable code, architecting reliable solutions, and solving complex technical challenges. ${job.workplaceType === 'Remote' ? 'Having extensive experience with asynchronous workflows and distributed team environments, I excel in high-autonomy settings with proactive communication.' : `I am motivated by ${job.company}'s mission and eager to bring my problem-solving capabilities to your ${job.location} operations.`}

Key highlights of what I bring to ${job.company}:
• Demonstrated proficiency in modern development stacks (${matchedSkills || 'TypeScript, React, Node.js'}).
• Commitment to software engineering best practices, automated testing, and performance optimization.
• Strong collaborative mindset with a focus on delivering measurable user and business value.

I would welcome the opportunity to discuss how my technical skills and enthusiasm align with the goals of ${job.company}. Thank you for your time and consideration.

Sincerely,
${candidateName}
${profile?.email || ''}${profile?.phone ? ` | ${profile.phone}` : ''}
${profile?.portfolioLinks?.[0] || ''}`.trim();
  }

  /**
   * Generates standard answer recommendations for common job application form fields.
   */
  public generateApplicationAnswers(profile: CareerProfile | null, job: JobListing): Record<string, string> {
    return {
      'Relevant Experience': `${profile?.experience?.length || 3}+ years in professional software development`,
      'Current Location': `${profile?.location || 'Lahore, Pakistan'}`,
      'Authorized to work / Relocation': job.workplaceType === 'Remote'
        ? 'Available for remote contract / B2B engagement worldwide.'
        : `Open to relocation to ${job.country || 'destination'} with standard employer visa sponsorship.`,
      'Desired Compensation': profile?.minSalary
        ? `${profile.minSalary}`
        : 'Open to standard market compensation based on role scope.',
      'Notice Period': 'Immediate / 2 weeks',
      'Portfolio & Work Samples': `${profile?.portfolioLinks?.[0] || 'Available on request'}`
    };
  }

  /**
   * Mode A: Prepares a complete manual application package for one-click candidate review and application.
   */
  public prepareManualApplication(profile: CareerProfile | null, job: JobListing): ApplicationPackage {
    const coverLetter = this.generateCoverLetter(profile, job);
    const answers = this.generateApplicationAnswers(profile, job);

    return {
      job,
      coverLetter,
      tailoredAnswers: answers,
      readyToApply: true,
      warnings: job.applyUrl ? [] : ['Direct application link is not provided; visit company career page.']
    };
  }

  /**
   * Mode B: Automatic Application Engine.
   * Evaluates constraints, daily limits, match threshold, and prepares / submits the application.
   */
  public async processAutoApply(
    db: Database,
    jobId: string,
    profile: CareerProfile | null,
    config: JobDiscoveryConfig,
    matchScore: number
  ): Promise<{ success: boolean; application?: JobApplication; error?: string }> {
    if (!config.autoApplyEnabled) {
      return { success: false, error: 'Auto-apply is currently disabled in your settings.' };
    }

    const todayCount = db.countApplicationsToday();
    if (todayCount >= config.maxDailyApplications) {
      return {
        success: false,
        error: `Daily limit reached (${todayCount}/${config.maxDailyApplications} applications sent today).`
      };
    }

    if (matchScore < config.minCompatibilityScore) {
      return {
        success: false,
        error: `Job match score (${matchScore}%) is below your configured threshold (${config.minCompatibilityScore}%).`
      };
    }

    const job = db.getJobListing(jobId);
    if (!job) {
      return { success: false, error: 'Job listing not found.' };
    }

    const excluded = (config.excludedCompanies || []).map(c => c.toLowerCase());
    if (excluded.includes(job.company.toLowerCase())) {
      return {
        success: false,
        error: `Company "${job.company}" is in your excluded companies list.`
      };
    }

    const existing = db.getJobApplicationByJobId(jobId);
    if (existing) {
      return {
        success: false,
        error: `Already processed application for this job (Status: ${existing.status.toUpperCase()}).`
      };
    }

    const contactEmail = job.contactEmail || '';
    const hasVerifiedEmail =
      Boolean(contactEmail) &&
      !EmailValidationService.isDummyOrPlaceholderDomain(contactEmail.split('@')[1] || '') &&
      !EmailValidationService.isBlockedPrefix(contactEmail.split('@')[0] || '');

    const coverLetter = this.generateCoverLetter(profile, job);
    const answers = this.generateApplicationAnswers(profile, job);
    const now = new Date().toISOString();

    const appId = `app_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const application: JobApplication = {
      id: appId,
      jobId: job.id,
      status: 'submitted',
      applicationMode: 'automatic',
      coverLetter,
      answers,
      submissionRef: `AUTO-${Date.now()}`,
      recipientEmail: hasVerifiedEmail ? job.contactEmail : undefined,
      notes: hasVerifiedEmail
        ? `Auto-applied with verified recruitment email (${job.contactEmail}).`
        : `Auto-apply prepared tailored application package. Requires direct submission on official employer portal: ${job.applyUrl || 'company careers page'}.`,
      appliedAt: now,
      updatedAt: now,
    };

    db.saveJobApplication(application);

    db.addApplicationActivityEvent(appId, {
      date: now.slice(0, 10),
      time: now.slice(11, 16),
      activity: hasVerifiedEmail ? 'Auto-Application Processed' : 'Auto-Application Package Prepared for Portal',
      details: hasVerifiedEmail
        ? `Queued for ${job.company} via verified recruitment contact: ${job.contactEmail} (Match Score: ${matchScore}%).`
        : `Tailored answers and cover letter prepared for official portal: ${job.applyUrl || 'Career page'}.`,
      icon: hasVerifiedEmail ? 'send' : 'external-link',
    });

    db.addJobNotification({
      type: 'application_submitted',
      title: hasVerifiedEmail ? `Auto-Applied: ${job.company}` : `Auto-Application Prepared: ${job.company}`,
      message: hasVerifiedEmail
        ? `Application package queued for ${job.title} at ${job.company} (${matchScore}% match).`
        : `Tailored cover letter and answers ready for ${job.title}. Apply directly via their careers portal.`,
      jobId: job.id,
    });

    return { success: true, application };
  }
}

export const applicationService = new ApplicationService();
