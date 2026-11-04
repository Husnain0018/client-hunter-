export type Priority = 'high' | 'medium' | 'low';
export type RunStatus = 'queued' | 'running' | 'done' | 'error';
export type WebsiteStatus = 'Good' | 'Needs Improvement' | 'Poor' | 'No Website' | 'Not Loading' | 'Unverified';
export type SocialStatus = 'Active' | 'Slow' | 'Inactive' | 'Not checked' | 'No public posts found';
export type WhatsAppStatus = 'Sending' | 'Pending' | 'Sent' | 'Delivered' | 'Read' | 'Played' | 'Failed' | 'Unconfirmed';
export type LocationStatus = 'Verified' | 'City Match (Unverified Locality)' | 'Mismatch';

export type BaileysConnectionState =
  | 'not_connected'
  | 'initializing'
  | 'waiting_for_qr'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'temporarily_disconnected'
  | 'session_expired'
  | 'logged_out'
  | 'connection_error'
  | 'connection_failed';

export interface BaileysAccountInfo {
  id: string;
  name?: string;
  phone?: string;
}

export interface BaileysDiagnosticEntry {
  timestamp: string;
  event: string;
  state: BaileysConnectionState;
  detail?: string;
}

export interface BaileysStatusInfo {
  state: BaileysConnectionState;
  qr?: string | null;
  account?: BaileysAccountInfo | null;
  error?: string | null;
  reconnectAttempts: number;
  lastConnectedAt?: string | null;
  isReady: boolean;
  hasSavedSession?: boolean;
  diagnostics?: BaileysDiagnosticEntry[];
}

export interface ProblemFinding {
  type: 'confirmed' | 'potential';
  category: 'website' | 'response' | 'social' | 'reputation' | 'booking' | 'information';
  title: string;
  detail: string;
  evidence?: string;
}

export interface OutreachStrategy {
  overview: string;
  problems: ProblemFinding[];
  businessImpact: string[];
  relevantServices: string[];
  solutions: Array<{
    service: string;
    howItWorks: string;
    impact: string;
    estimatedTimeline: string;
  }>;
  conversationGuidance: {
    icebreaker: string;
    discoveryQuestions: string[];
    objectionHandling: string[];
  };
  nextSteps: string[];
}

export interface CustomService {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface LeadStats {
  totalUniqueLeads: number;
  totalRuns: number;
  verifiedLeads: number;
  leadsWithEmail: number;
  leadsWithPhone: number;
  noWebsiteLeads: number;
}

export interface SearchRequest {
  userName: string;
  company: string;
  senderType?: 'auto' | 'person' | 'company';
  userEmail: string;
  userPhone?: string;
  portfolio?: string;
  services: string[];
  niche: string;
  area: string;
  country: string;
  maxLeads: number;
  checkSocial: boolean;
  emailSummary: boolean;
}

export interface Competitor {
  name: string;
  rating: number | string;
  reviews: number;
  hasWebsite: boolean;
  website?: string;
}

export interface SocialProfile {
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  youtube?: string;
  tiktok?: string;
}

export interface SocialActivity {
  status: SocialStatus;
  url: string;
  lastPost: string;
  daysInactive: number | null;
}

export interface WebsiteAudit {
  hasWebsite: boolean;
  reachable: boolean;
  score: number | null;
  status: WebsiteStatus;
  issues: string[];
  images: string[];
  techStack: string[];
  emails: string[];
  phones: string[];
  social: SocialProfile;
  title: string;
  metaDescription: string;
  httpStatus: number | null;
}

export interface Lead {
  runId: string;
  leadId: string;
  businessName: string;
  category: string;
  leadType: 'Has Website' | 'No Website';
  contactChannel: string;
  website: string;
  email: string;
  phone: string;
  whatsappLink: string;
  address: string;
  country: string;
  googleRating: number | string;
  googleReviews: number;
  googleMapsUrl: string;
  locationStatus?: LocationStatus;
  locationVerified?: boolean;
  leadScore: number;
  priority: Priority;
  estimatedDealValue: string;
  recommendedServices: string[];
  weaknesses: string[];
  analysisSummary: string;
  strategy?: OutreachStrategy;
  websiteScore: number | null;
  websiteStatus: WebsiteStatus;
  websiteIssues: string[];
  websiteImages: string[];
  techStack: string[];
  social: SocialProfile;
  socialActivity: Record<string, SocialActivity>;
  socialStatus: string;
  competitors: Competitor[];
  emailSubject: string;
  emailBodyText: string;
  emailBodyHtml: string;
  whatsappMessage: string;
  approvalStatus: 'Pending Review' | 'No Email' | 'Sent';
  emailStatus: 'Draft' | 'No Email' | 'Sent';
  responseStatus: 'No Reply' | 'Replied' | 'Won' | 'Lost';
  senderName: string;
  searchQuery: string;
  createdAt: string;
  emailSentAt: string;
  followUp1Date: string;
  followUp2Date: string;
  gmailThreadId: string;
  whatsappStatus?: WhatsAppStatus | 'Not sent';
  whatsappRunId?: string;
}

export interface RunEvent {
  seq: number;
  runId: string;
  type: 'stage' | 'lead' | 'done' | 'error';
  stage: 'start' | 'maps' | 'websites' | 'social' | 'final' | 'done';
  level: 'info' | 'warn' | 'error';
  message: string;
  payload?: unknown;
  createdAt: string;
}

export interface RunRecord {
  runId: string;
  status: RunStatus;
  request: SearchRequest;
  message: string;
  total: number;
  createdAt: string;
  completedAt: string | null;
}

export interface WhatsAppRecord {
  leadId: string;
  businessName: string;
  number: string;
  status: WhatsAppStatus;
  message: string;
  providerMessageId: string;
  savedAt: string;
  updatedAt: string;
  error: string;
}

export type ClientStage =
  | 'new'
  | 'contacted'
  | 'awaiting_reply'
  | 'conversing'
  | 'follow_up_scheduled'
  | 'interested'
  | 'proposal_pending'
  | 'negotiating'
  | 'closed_won'
  | 'lost'
  | 'opted_out'
  | 'needs_human';

export interface ConversationMessage {
  id: string;
  leadId: string;
  sender: 'client' | 'assistant' | 'user';
  text: string;
  timestamp: string;
  status: WhatsAppStatus;
  providerMessageId?: string;
  metadata?: Record<string, unknown>;
}

export interface ProjectPlanDetails {
  services: string[];
  tasks: string[];
  deliverables: string;
  duration: string;
  startDate?: string;
  deadline?: string;
  estimatedCharges: string;
  notes?: string;
}

export interface ClientConversation {
  leadId: string;
  businessName: string;
  phone: string;
  stage: ClientStage;
  autoPilot: boolean;
  agreedServices: string[];
  agreedPrice: string;
  agreedTimeline: string;
  agreedDeliverables: string;
  dealNotes: string;
  closedAt?: string | null;
  closingNotifiedAt?: string | null;
  humanInterventionReason: string;
  nextFollowUpAt?: string | null;
  followUpCount: number;
  optedOut: boolean;
  summary: string;
  identifiedRequirements?: string[];
  projectPlan?: ProjectPlanDetails;
  aiHandled?: boolean;
  lastAiAction?: string;
  nextRecommendedAction?: string;
  dealNotificationPhone?: string;
  dealNotificationStatus?: 'sent' | 'pending' | 'failed' | '';
  dealNotificationText?: string;
  dealNotificationError?: string;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  lead?: Lead;
  messages?: ConversationMessage[];
}

export interface ClientHandlerStats {
  totalClients: number;
  newLeads: number;
  contacted: number;
  awaitingReply: number;
  activeConversations: number;
  negotiating: number;
  closedWon: number;
  needsHuman: number;
  optedOut: number;
  totalIncomingMessages: number;
  totalOutgoingMessages: number;
  aiHandledCount: number;
  requirementsIdentifiedCount: number;
  projectSummariesCount: number;
}

export interface DealClosingInfo {
  leadId: string;
  businessName?: string;
  agreedServices: string[];
  agreedPrice: string;
  agreedTimeline: string;
  agreedDeliverables: string;
  dealNotes?: string;
  notifyUserWhatsApp?: boolean;
  userPhoneNumber?: string;
}

// ==========================================
// AI Job Finder & Career Assistant Types
// ==========================================

export type WorkplaceType = 'Remote' | 'Hybrid' | 'On-site';
export type EmploymentType = 'Full-time' | 'Part-time' | 'Contract' | 'Internship' | 'Freelance';
export type ExperienceLevel = 'Entry-level' | 'Mid-level' | 'Senior' | 'Lead' | 'Executive';

export type SocialPlatform =
  | 'LinkedIn'
  | 'GitHub'
  | 'GitLab'
  | 'Portfolio'
  | 'Website'
  | 'X (Twitter)'
  | 'Instagram'
  | 'Behance'
  | 'Dribbble'
  | 'Other';

export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  customPlatform?: string;
  url: string;
}

export interface JobListing {
  id: string;
  externalId: string;
  source: string;
  title: string;
  company: string;
  location: string;
  country: string;
  workplaceType: WorkplaceType;
  employmentType: EmploymentType;
  experienceLevel: ExperienceLevel;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string;
  salaryRaw?: string;
  description: string;
  shortDescription?: string;
  department?: string;
  responsibilities?: string[];
  qualifications?: string[];
  professionalSkills?: string[];
  educationRequirements?: string;
  experienceRequirements?: string;
  freshGraduatesEligible?: boolean | null;
  benefits?: string[];
  applicationInstructions?: string;
  contactEmail?: string;
  lastVerifiedAt?: string;
  skills: string[];
  requirements: string[];
  visaSponsorship?: boolean;
  relocation?: boolean;
  applyUrl: string;
  sourceUrl: string;
  postedAt: string;
  deadline?: string | null;
  isActive: boolean;
  discoveredAt: string;
  // Computed matching properties
  matchScore?: number;
  matchReasons?: string[];
  missingSkills?: string[];
  isSaved?: boolean;
  applicationStatus?: JobApplicationStatus;
}

export interface InternshipRecord {
  id?: string;
  organization: string;
  role: string;
  duration: string;
  description: string;
  skillsGained?: string[];
  certificateUrl?: string;
}

export interface EducationRecord {
  id?: string;
  institution: string;
  degree: string;
  field: string;
  year: string;
  gpa?: string;
  description?: string;
}

export interface ExperienceRecord {
  id?: string;
  title: string;
  company: string;
  location?: string;
  startDate: string;
  endDate?: string;
  current?: boolean;
  description: string;
  responsibilities?: string[];
  achievements?: string[];
  technologies?: string[];
}

export interface ProjectRecord {
  id?: string;
  name: string;
  role?: string;
  description: string;
  technologies: string[];
  link?: string;
  repoUrl?: string;
}

export interface CertificationRecord {
  id?: string;
  name: string;
  issuer?: string;
  date?: string;
  url?: string;
}

export interface LanguageRecord {
  language: string;
  proficiency: 'Native' | 'Fluent' | 'Professional' | 'Intermediate' | 'Basic';
}

export interface CareerProfile {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  photoUrl?: string;
  includePhotoInResume?: boolean;
  preferredLocations: string[];
  summary: string;
  skills: string[];
  professionalSkills?: string[];
  experience: ExperienceRecord[];
  internships?: InternshipRecord[];
  education: EducationRecord[];
  certifications: Array<CertificationRecord | string>;
  projects: ProjectRecord[];
  portfolioLinks: string[];
  socialAccounts?: SocialAccount[];
  languages: Array<LanguageRecord | string>;
  targetRoles: string[];
  employmentTypes: EmploymentType[];
  remotePreference: WorkplaceType;
  minSalary?: string;
  visaStatus: string;
  updatedAt: string;
}

export interface StoredResume {
  id: string;
  filename: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  parsedText: string;
  createdAt: string;
}

export interface ResumeAnalysis {
  id: string;
  resumeId: string;
  overallScore: number;
  summaryCritique: string;
  skillsFeedback: string;
  experienceFeedback: string;
  formattingFeedback: string;
  recommendations: Array<{
    category: 'Contact' | 'Summary' | 'Experience' | 'Skills' | 'Achievements' | 'ATS & Keywords';
    issue: string;
    recommendedImprovement: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  keywordsDetected: string[];
  missingKeywords: string[];
  internationalNotes: string[];
  createdAt: string;
}

export interface GeneratedResume {
  id: string;
  resumeId?: string;
  title: string;
  targetRole: string;
  templateType: 'software_engineering' | 'international' | 'remote_work' | 'general_professional' | 'entry_level';
  contentText: string;
  contentHtml: string;
  createdAt: string;
}

export type JobApplicationStatus =
  | 'draft'
  | 'draft_created'
  | 'ready_to_send'
  | 'ready_to_apply'
  | 'awaiting_approval'
  | 'opened_in_gmail'
  | 'awaiting_confirmation'
  | 'sending'
  | 'sent'
  | 'accepted_by_provider'
  | 'delivery_confirmed'
  | 'submitted'
  | 'awaiting_response'
  | 'under_review'
  | 'replied'
  | 'interview_invited'
  | 'interview_scheduled'
  | 'interview'
  | 'rejected'
  | 'bounced'
  | 'failed'
  | 'shortlisted'
  | 'offer_received'
  | 'offer'
  | 'accepted'
  | 'withdrawn'
  | 'requires_manual_completion';

export interface ApplicationActivityEvent {
  id: string;
  date: string;
  time: string;
  activity: string;
  details?: string;
  icon?: string;
}

export interface EmployerResponseRecord {
  id: string;
  fromEmail: string;
  subject: string;
  body: string;
  receivedAt: string;
  category: 'general' | 'info_request' | 'portfolio_request' | 'interview_invite' | 'technical_questions' | 'salary_inquiry' | 'availability_inquiry' | 'rejection' | 'document_request';
  suggestedReply?: string;
  userReply?: string;
  repliedAt?: string;
}

export interface JobApplicationEmailRecord {
  id: string;
  applicationId?: string;
  jobId: string;
  companyName: string;
  jobTitle: string;
  recipientEmail: string;
  senderEmail: string;
  subject: string;
  body: string;
  resumeId?: string;
  resumeName?: string;
  sentAt: string;
  deliveryStatus:
    | 'draft'
    | 'draft_created'
    | 'awaiting_approval'
    | 'opened_in_gmail'
    | 'awaiting_confirmation'
    | 'sending'
    | 'sent'
    | 'accepted_by_provider'
    | 'delivery_confirmed'
    | 'failed'
    | 'bounced'
    | 'rejected'
    | 'replied';
  failureReason?: string;
  smtpResponseCode?: string | number;
  bounceReason?: string;
  recommendedAction?: string;
  createdAt: string;
}

export interface JobApplication {
  id: string;
  jobId: string;
  job?: JobListing;
  status: JobApplicationStatus;
  applicationMode: 'manual' | 'automatic' | 'email';
  resumeId?: string;
  coverLetter: string;
  answers: Record<string, string>;
  submissionRef?: string;
  failureReason?: string;
  notes?: string;
  recipientEmail?: string;
  senderEmail?: string;
  emailSubject?: string;
  emailBody?: string;
  sentAt?: string;
  deliveryStatus?: string;
  smtpResponseCode?: string | number;
  bounceReason?: string;
  recommendedAction?: string;
  employerResponses?: EmployerResponseRecord[];
  activityTimeline?: ApplicationActivityEvent[];
  appliedAt: string;
  updatedAt: string;
}

export interface JobSyncStatusInfo {
  isSyncing: boolean;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  autoSyncEnabled: boolean;
  intervalHours: number;
  sourcesChecked: string[];
  sourcesFailed: string[];
  lastDiscoveredCount: number;
  lastDuplicatesSkipped: number;
  lastError: string | null;
}

export interface JobNotification {
  id: string;
  type: 'new_match' | 'deadline' | 'application_submitted' | 'action_required' | 'interview';
  title: string;
  message: string;
  jobId?: string;
  isRead: boolean;
  createdAt: string;
}

export interface JobDiscoveryConfig {
  id: string;
  autoApplyEnabled: boolean;
  maxDailyApplications: number;
  minCompatibilityScore: number;
  preferredCountries: string[];
  preferredRoles: string[];
  excludedCompanies: string[];
  enabledPlatforms: string[];
  autoDiscoveryIntervalHours: number;
  lastRunAt?: string | null;
  updatedAt: string;
}

export interface JobSearchParams {
  query?: string;
  country?: string;
  location?: string;
  role?: string;
  workplaceType?: WorkplaceType | 'all';
  employmentType?: EmploymentType | 'all';
  experienceLevel?: ExperienceLevel | 'all';
  minSalary?: number;
  maxSalary?: number;
  source?: string;
  sources?: string[];
  minScore?: number;
  postedWithinDays?: number;
  dateFilter?: 'all' | 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';
  customStartDate?: string;
  customEndDate?: string;
  savedOnly?: boolean;
  appliedOnly?: boolean;
  page?: number;
  limit?: number;
  offset?: number;
}

export interface JobSyncLogRecord {
  id: string;
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
}

export interface JobDiscoveryStats {
  totalDiscoveredToday: number;
  totalDiscoveredYesterday: number;
  totalDiscoveredThisWeek: number;
  totalDuplicatesSkipped: number;
  totalMatchingJobs: number;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  autoSyncEnabled: boolean;
  intervalHours: number;
  enabledPlatforms: string[];
}

