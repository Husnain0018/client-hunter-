import React, { useEffect, useState, useRef } from 'react';
import {
  Briefcase,
  Search,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  Globe,
  Building2,
  DollarSign,
  MapPin,
  FileText,
  Upload,
  Send,
  RefreshCw,
  Sliders,
  Bookmark,
  ExternalLink,
  ShieldCheck,
  Check,
  Copy,
  Plus,
  Trash2,
  X,
  Bell,
  TrendingUp,
  FileCheck,
  Laptop,
  Compass,
  ArrowRight,
  Filter,
  CheckCheck,
  Star,
  Mail,
  Bot,
  History,
  Layers,
  Inbox,
  Save
} from 'lucide-react';
import { api } from '../api/client';
import { MultiItemEditor } from '../components/MultiItemEditor';
import { SocialAccountsEditor } from '../components/SocialAccountsEditor';
import { JobDetailsModal, formatTimeAgo, formatDateTime, getSourceBadgeStyle } from '../components/JobDetailsModal';
import { EmailApplicationModal } from '../components/EmailApplicationModal';
import { AiEmailAssistantModal } from '../components/AiEmailAssistantModal';
import { ApplicationTimelineModal } from '../components/ApplicationTimelineModal';
import { SyncStatusCard } from '../components/SyncStatusCard';
import { ApplicationEmailHistoryModal } from '../components/ApplicationEmailHistoryModal';
import { CandidatePhotoEditor } from '../components/CandidatePhotoEditor';
import { ExperienceEditor } from '../components/ExperienceEditor';
import { InternshipsEditor } from '../components/InternshipsEditor';
import { EducationEditor } from '../components/EducationEditor';
import { ProjectsEditor } from '../components/ProjectsEditor';
import { CertificationsEditor } from '../components/CertificationsEditor';
import { LanguagesEditor } from '../components/LanguagesEditor';
import { ResumeStudio } from '../components/ResumeStudio';
import { SyncHistoryModal } from '../components/SyncHistoryModal';
import type {
  JobListing,
  CareerProfile,
  StoredResume,
  ResumeAnalysis,
  GeneratedResume,
  JobApplication,
  JobApplicationStatus,
  JobDiscoveryConfig,
  JobNotification,
  PlatformStatus,
  WorkplaceType,
  EmploymentType,
  JobSyncStatusInfo,
  JobDiscoveryStats,
  JobApplicationEmailRecord
} from '../types';

interface JobFinderPageProps {
  onBackToProspecting?: () => void;
}

type ActiveTab = 'jobs' | 'tracker' | 'resume' | 'profile' | 'auto-apply' | 'notifications';

const COUNTRIES = [
  { code: 'all', label: 'All Regions', flag: '🌐' },
  { code: 'Worldwide', label: 'Remote / Worldwide', flag: '🌍' },
  { code: 'Pakistan', label: 'Pakistan', flag: '🇵🇰' },
  { code: 'United States', label: 'United States', flag: '🇺🇸' },
  { code: 'United Arab Emirates', label: 'UAE / Dubai', flag: '🇦🇪' },
  { code: 'United Kingdom', label: 'United Kingdom', flag: '🇬🇧' },
  { code: 'India', label: 'India', flag: '🇮🇳' },
  { code: 'Canada', label: 'Canada', flag: '🇨🇦' },
  { code: 'Australia', label: 'Australia', flag: '🇦🇺' },
  { code: 'Germany', label: 'Germany', flag: '🇩🇪' },
];

export const JobFinderPage: React.FC<JobFinderPageProps> = ({ onBackToProspecting }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('jobs');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Core Data
  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [config, setConfig] = useState<JobDiscoveryConfig | null>(null);
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [appStats, setAppStats] = useState<Record<string, number>>({});
  const [todayAppsCount, setTodayAppsCount] = useState(0);
  const [resumes, setResumes] = useState<StoredResume[]>([]);
  const [activeAnalysis, setActiveAnalysis] = useState<ResumeAnalysis | null>(null);
  const [generatedResume, setGeneratedResume] = useState<GeneratedResume | null>(null);
  const [notifications, setNotifications] = useState<JobNotification[]>([]);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [selectedWorkplace, setSelectedWorkplace] = useState<string>('all');
  const [selectedEmployment, setSelectedEmployment] = useState<string>('all');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'last7' | 'last30'>('all');
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [showAppliedOnly, setShowAppliedOnly] = useState(false);

  // Modals & New Features State
  const [activeJobModal, setActiveJobModal] = useState<JobListing | null>(null);
  const [applyPackageModal, setApplyPackageModal] = useState<{
    job: JobListing;
    coverLetter: string;
    answers: Record<string, string>;
  } | null>(null);
  const [emailAppModalJob, setEmailAppModalJob] = useState<JobListing | null>(null);
  const [timelineApp, setTimelineApp] = useState<JobApplication | null>(null);
  const [aiAssistantApp, setAiAssistantApp] = useState<JobApplication | null>(null);
  const [emailHistoryModalOpen, setEmailHistoryModalOpen] = useState(false);
  const [syncHistoryModalOpen, setSyncHistoryModalOpen] = useState(false);
  const [applicationEmails, setApplicationEmails] = useState<JobApplicationEmailRecord[]>([]);
  const [syncStatus, setSyncStatus] = useState<JobSyncStatusInfo | null>(null);
  const [discoveryStats, setDiscoveryStats] = useState<JobDiscoveryStats | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileLastSaved, setProfileLastSaved] = useState<string | null>(null);
  const [previewResume, setPreviewResume] = useState<StoredResume | null>(null);

  // Resume Upload & Generator
  const [uploadingResume, setUploadingResume] = useState(false);
  const [selectedResumeTemplate, setSelectedResumeTemplate] = useState('software_engineering');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSyncingGmail, setIsSyncingGmail] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSyncGmail = async () => {
    setIsSyncingGmail(true);
    try {
      const res = await api.syncGmailApplications();
      if (res.ok && res.summary) {
        const { bouncesDetected, bouncesApplied, sentConfirmed, repliesDetected } = res.summary;
        showToast(
          'success',
          `Gmail synchronized: ${bouncesDetected} bounce notices checked (${bouncesApplied} updated), ${sentConfirmed} confirmed sent, ${repliesDetected} replies detected.`
        );
        const [updatedApps, updatedNotifs] = await Promise.all([
          api.getJobApplications().catch(() => null),
          api.getJobNotifications().catch(() => null),
        ]);
        if (updatedApps?.ok) {
          setApplications(updatedApps.applications);
          setAppStats(updatedApps.stats);
          setTodayAppsCount(updatedApps.todayCount);
        }
        if (updatedNotifs?.ok) {
          setNotifications(updatedNotifs.notifications);
        }
      } else {
        showToast('error', res.error || 'Failed to sync with Gmail.');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Gmail sync failed.');
    } finally {
      setIsSyncingGmail(false);
    }
  };

  const showToast = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Initial Load
  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [profRes, confRes, platRes, notifRes, appsRes, resRes, syncRes, emailsRes, statsRes] = await Promise.all([
        api.getCareerProfile().catch(() => null),
        api.getJobDiscoveryConfig().catch(() => null),
        api.getJobPlatforms().catch(() => null),
        api.getJobNotifications().catch(() => null),
        api.getJobApplications().catch(() => null),
        api.getResumes().catch(() => null),
        api.getJobSyncStatus().catch(() => null),
        api.getApplicationEmails().catch(() => null),
        api.getJobDiscoveryStats().catch(() => null),
      ]);

      if (profRes?.ok) setProfile(profRes.profile);
      if (confRes?.ok) setConfig(confRes.config);
      if (platRes?.ok) setPlatforms(platRes.platforms);
      if (notifRes?.ok) setNotifications(notifRes.notifications);
      if (syncRes?.ok) setSyncStatus(syncRes.status);
      if (emailsRes?.ok) setApplicationEmails(emailsRes.emails);
      if (statsRes?.ok) setDiscoveryStats(statsRes.stats);
      if (appsRes?.ok) {
        setApplications(appsRes.applications);
        setAppStats(appsRes.stats);
        setTodayAppsCount(appsRes.todayCount);
      }
      if (resRes?.ok && resRes.resumes.length > 0) {
        setResumes(resRes.resumes);
        if (resRes.resumes[0].analysis) {
          setActiveAnalysis(resRes.resumes[0].analysis);
        }
      }

      await fetchJobs();
    } catch (err: any) {
      showToast('error', err.message || 'Failed to initialize career dashboard.');
    } finally {
      setLoading(false);
    }
  };

  const fetchJobs = async () => {
    try {
      const res = await api.getJobs({
        query: searchQuery || undefined,
        country: selectedCountry !== 'all' ? selectedCountry : undefined,
        workplaceType: selectedWorkplace !== 'all' ? selectedWorkplace : undefined,
        employmentType: selectedEmployment !== 'all' ? selectedEmployment : undefined,
        platform: selectedPlatform !== 'all' ? selectedPlatform : undefined,
        dateFilter: dateFilter !== 'all' ? dateFilter : undefined,
        savedOnly: showSavedOnly || undefined,
        appliedOnly: showAppliedOnly || undefined,
      });

      if (res.ok) {
        setJobs(res.jobs);
        setTotalJobs(res.total);
      }
    } catch (err: any) {
      console.warn('Jobs fetch error:', err);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [selectedCountry, selectedWorkplace, selectedEmployment, selectedPlatform, dateFilter, showSavedOnly, showAppliedOnly]);

  const handleSyncJobs = async () => {
    setSyncing(true);
    try {
      const res = await api.syncJobs();
      if (res.ok) {
        showToast('success', res.message || 'Live vacancies synchronized successfully.');
        if (res.status) setSyncStatus(res.status);
      } else {
        showToast('error', res.error || 'Sync encountered an error.');
      }
      await fetchJobs();
      const [statusRes, statsRes] = await Promise.all([
        api.getJobSyncStatus().catch(() => null),
        api.getJobDiscoveryStats().catch(() => null),
      ]);
      if (statusRes?.ok) setSyncStatus(statusRes.status);
      if (statsRes?.ok) setDiscoveryStats(statsRes.stats);
    } catch (err: any) {
      showToast('error', err.message || 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleScheduler = async (enabled: boolean, intervalHours?: number) => {
    try {
      const res = await api.toggleJobScheduler({ enabled, intervalHours });
      if (res.ok) {
        showToast('success', enabled ? 'Job Discovery Scheduler activated!' : 'Job Discovery Scheduler paused.');
        const [statsRes, statusRes] = await Promise.all([
          api.getJobDiscoveryStats().catch(() => null),
          api.getJobSyncStatus().catch(() => null),
        ]);
        if (statsRes?.ok) setDiscoveryStats(statsRes.stats);
        if (statusRes?.ok) setSyncStatus(statusRes.status);
      }
    } catch (err: any) {
      showToast('error', 'Failed to toggle scheduler: ' + (err.message || 'Unknown error'));
    }
  };

  const handleToggleSaveJob = async (jobId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await api.toggleSaveJob(jobId);
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, isSaved: res.isSaved } : j))
      );
      showToast('success', res.isSaved ? 'Job bookmarked!' : 'Job removed from bookmarks.');
    } catch (err: any) {
      showToast('error', 'Could not save job.');
    }
  };

  const handleOpenQuickApply = async (job: JobListing, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await api.prepareJobApplication(job.id);
      if (res.ok) {
        setApplyPackageModal({
          job,
          coverLetter: res.package.coverLetter,
          answers: res.package.tailoredAnswers,
        });
      }
    } catch (err: any) {
      showToast('error', 'Failed to prepare application package.');
    }
  };

  const handleExecuteManualApply = async () => {
    if (!applyPackageModal) return;
    try {
      const res = await api.submitJobApplication({
        jobId: applyPackageModal.job.id,
        mode: 'manual',
        customCoverLetter: applyPackageModal.coverLetter,
        customAnswers: applyPackageModal.answers,
      });
      if (res.ok) {
        showToast('success', `Application recorded for ${applyPackageModal.job.company}!`);
        setJobs((prev) =>
          prev.map((j) =>
            j.id === applyPackageModal.job.id
              ? { ...j, applicationStatus: 'submitted', applicationId: res.application.id }
              : j
          )
        );
        const updatedApps = await api.getJobApplications();
        if (updatedApps.ok) {
          setApplications(updatedApps.applications);
          setAppStats(updatedApps.stats);
          setTodayAppsCount(updatedApps.todayCount);
        }
        setApplyPackageModal(null);
      }
    } catch (err: any) {
      showToast('error', err.message || 'Failed to submit application.');
    }
  };

  const handleExecuteAutoApply = async (jobId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await api.submitJobApplication({
        jobId,
        mode: 'automatic',
      });
      if (res.ok) {
        showToast('success', `Auto-applied successfully!`);
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId ? { ...j, applicationStatus: 'submitted', applicationId: res.application.id } : j
          )
        );
        const updatedApps = await api.getJobApplications();
        if (updatedApps.ok) {
          setApplications(updatedApps.applications);
          setAppStats(updatedApps.stats);
          setTodayAppsCount(updatedApps.todayCount);
        }
      }
    } catch (err: any) {
      showToast('error', err.message || 'Auto-apply could not be executed.');
    }
  };

  const handleUpdateApplicationStatus = async (appId: string, status: JobApplicationStatus) => {
    try {
      const res = await api.updateApplicationStatus(appId, status);
      if (res.ok) {
        setApplications((prev) =>
          prev.map((a) => (a.id === appId ? { ...a, status } : a))
        );
        showToast('success', `Status updated to ${status.toUpperCase()}`);
        const updatedApps = await api.getJobApplications();
        if (updatedApps.ok) setAppStats(updatedApps.stats);
      }
    } catch (err: any) {
      showToast('error', 'Failed to update status.');
    }
  };

  const handleResumeFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingResume(true);
    try {
      const res = await api.uploadResume(file);
      if (res.ok) {
        setResumes((prev) => [res.resume, ...prev]);
        setActiveAnalysis(res.analysis);
        showToast('success', `Resume parsed! ATS Score: ${res.analysis.overallScore}%`);
        const profRes = await api.getCareerProfile();
        if (profRes.ok) setProfile(profRes.profile);
      }
    } catch (err: any) {
      showToast('error', err.message || 'Resume upload failed.');
    } finally {
      setUploadingResume(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteResume = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this uploaded resume?')) return;
    try {
      const res = await api.deleteResume(id);
      if (res.ok) {
        setResumes((prev) => prev.filter((r) => r.id !== id));
        if (activeAnalysis?.resumeId === id) {
          setActiveAnalysis(null);
        }
        showToast('success', 'Resume permanently deleted.');
      }
    } catch (err: any) {
      showToast('error', 'Failed to delete resume: ' + (err.message || 'Unknown error'));
    }
  };

  const handleAnalyzeResume = async (id: string) => {
    try {
      const res = await api.analyzeResume(id);
      if (res.ok && res.analysis) {
        setActiveAnalysis(res.analysis);
        showToast('success', `ATS Evaluation updated: ${res.analysis.overallScore}%`);
      }
    } catch (err: any) {
      showToast('error', 'Analysis failed: ' + (err.message || 'Unknown error'));
    }
  };

  const handleGenerateResume = async () => {
    setLoading(true);
    try {
      const res = await api.generateTailoredResume(selectedResumeTemplate);
      if (res.ok) {
        setGeneratedResume(res.generatedResume);
        showToast('success', `Generated ${res.generatedResume.title}!`);
      }
    } catch (err: any) {
      showToast('error', 'Failed to generate tailored resume.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async (e?: React.SyntheticEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!profile) return;
    setProfileSaving(true);
    try {
      const res = await api.updateCareerProfile(profile);
      if (res.ok) {
        setProfile(res.profile);
        const timeStr = new Date().toLocaleTimeString();
        setProfileLastSaved(timeStr);
        showToast('success', `Career profile saved permanently to database at ${timeStr}!`);
        await fetchJobs();
      }
    } catch (err: any) {
      showToast('error', 'Failed to save profile: ' + (err.message || 'Unknown error'));
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    try {
      const res = await api.updateJobDiscoveryConfig(config);
      if (res.ok) {
        setConfig(res.config);
        showToast('success', 'Auto-apply configuration saved!');
      }
    } catch (err: any) {
      showToast('error', 'Failed to save settings.');
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="job-finder-page" style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Toast Notification */}
      {feedback && (
        <div style={{
          position: 'fixed',
          top: 20,
          right: 20,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: feedback.type === 'success' ? '#ecfdf5' : '#fef2f2',
          border: `1px solid ${feedback.type === 'success' ? '#10b981' : '#ef4444'}`,
          color: feedback.type === 'success' ? '#065f46' : '#991b1b',
          padding: '12px 18px',
          borderRadius: 12,
          boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
          fontSize: 13,
          fontWeight: 600,
        }}>
          {feedback.type === 'success' ? <CheckCircle2 size={18} color="#10b981" /> : <AlertCircle size={18} color="#ef4444" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Hero Header Banner */}
      <section style={{
        background: 'radial-gradient(circle at 80% 10%, rgba(99, 102, 241, 0.45), transparent 45%), linear-gradient(135deg, #0f172a 0%, #1e1b4b 60%, #312e81 100%)',
        color: '#ffffff',
        padding: '36px 24px 28px',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div style={{ maxWidth: 1240, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 20 }}>
            <div>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderRadius: 999,
                background: 'rgba(99, 102, 241, 0.25)',
                border: '1px solid rgba(129, 140, 248, 0.4)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: '#c7d2fe',
                marginBottom: 10
              }}>
                <Sparkles size={12} />
                Global AI Career Engine
              </div>
              <h1 style={{ fontSize: '32px', fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.025em', lineHeight: 1.15 }}>
                AI Job Finder & Career Assistant
              </h1>
              <p style={{ margin: 0, color: '#cbd5e1', fontSize: '14px', maxWidth: 640, lineHeight: 1.5 }}>
                Discover real-time tech vacancies worldwide, audit your resume against ATS algorithms, and auto-apply with compatibility matching.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {onBackToProspecting && (
                <button
                  type="button"
                  onClick={onBackToProspecting}
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.2)',
                    padding: '8px 16px',
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  ← Back to Prospecting
                </button>
              )}

              <button
                type="button"
                onClick={handleSyncJobs}
                disabled={syncing}
                style={{
                  background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: syncing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 4px 14px rgba(6, 182, 212, 0.4)',
                  opacity: syncing ? 0.7 : 1
                }}
              >
                <RefreshCw size={14} className={syncing ? 'spin' : ''} />
                {syncing ? 'Synchronizing...' : 'Sync Live Jobs'}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('notifications')}
                style={{
                  position: 'relative',
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.2)',
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer'
                }}
              >
                <Bell size={16} />
                {unreadCount > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    background: '#ef4444',
                    color: '#fff',
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '1px 5px',
                    lineHeight: 1
                  }}>
                    {unreadCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 12,
            marginTop: 24,
            paddingTop: 20,
            borderTop: '1px solid rgba(255,255,255,0.12)'
          }}>
            {[
              { label: 'Active Vacancies', val: totalJobs, icon: Briefcase, color: '#38bdf8' },
              { label: 'Applications Sent', val: applications.length, icon: Send, color: '#818cf8' },
              { label: 'In Interview', val: appStats.interview || 0, icon: Star, color: '#34d399' },
              { label: 'Offers Received', val: appStats.offer || 0, icon: CheckCheck, color: '#fbbf24' },
              { label: 'Today Dispatched', val: `${todayAppsCount}/${config?.maxDailyApplications || 5}`, icon: Clock, color: '#c084fc' },
            ].map((m, i) => {
              const Icon = m.icon;
              return (
                <div key={i} style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10
                }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.1)',
                    display: 'grid',
                    placeItems: 'center',
                    color: m.color
                  }}>
                    <Icon size={16} />
                  </div>
                  <div>
                    <strong style={{ fontSize: '18px', display: 'block', lineHeight: 1.1, color: '#fff' }}>
                      {m.val}
                    </strong>
                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>{m.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Modern Navigation Tabs Bar */}
      <nav style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        position: 'sticky',
        top: 64,
        zIndex: 20,
        boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
      }}>
        <div style={{
          maxWidth: 1240,
          margin: '0 auto',
          padding: '0 20px',
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          scrollbarWidth: 'none'
        }}>
          {[
            { id: 'jobs', label: 'Explore Opportunities', icon: Briefcase, count: totalJobs },
            { id: 'tracker', label: 'Application Pipeline', icon: TrendingUp, count: applications.length },
            { id: 'resume', label: 'Resume Studio & ATS', icon: FileCheck },
            { id: 'profile', label: 'Candidate Profile', icon: Compass },
            { id: 'auto-apply', label: 'Auto-Apply & Sources', icon: Sliders },
            { id: 'notifications', label: 'Alerts', icon: Bell, count: unreadCount },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as ActiveTab)}
                style={{
                  background: isSelected ? '#f1f5f9' : 'transparent',
                  color: isSelected ? '#4338ca' : '#64748b',
                  border: 'none',
                  borderBottom: isSelected ? '3px solid #4f46e5' : '3px solid transparent',
                  padding: '14px 16px',
                  fontSize: '13px',
                  fontWeight: isSelected ? 700 : 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon size={15} color={isSelected ? '#4f46e5' : '#94a3b8'} />
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span style={{
                    background: isSelected ? '#e0e7ff' : '#f1f5f9',
                    color: isSelected ? '#4338ca' : '#64748b',
                    padding: '2px 7px',
                    borderRadius: 999,
                    fontSize: '11px',
                    fontWeight: 700
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main Container */}
      <main style={{ maxWidth: 1240, margin: '0 auto', padding: '24px 20px 48px' }}>
        {/* ======================================================== */}
        {/* TAB 1: EXPLORE OPPORTUNITIES                             */}
        {/* ======================================================== */}
        {activeTab === 'jobs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Live Job Discovery Sync Status & Scheduler Controls */}
            <SyncStatusCard
              status={syncStatus}
              stats={discoveryStats}
              syncing={syncing}
              onSyncManual={handleSyncJobs}
              onToggleScheduler={handleToggleScheduler}
              onViewHistory={() => setSyncHistoryModalOpen(true)}
            />

            {/* Discovery Date Filters */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              overflowX: 'auto',
              paddingBottom: 4,
              scrollbarWidth: 'none'
            }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', marginRight: 4 }}>
                <Clock size={14} /> Discovery Period:
              </span>
              {[
                { id: 'all', label: 'All Listings' },
                { id: 'today', label: "🔥 Today's Discoveries" },
                { id: 'yesterday', label: '⚡ Yesterday' },
                { id: 'last7', label: '📅 Last 7 Days' },
                { id: 'last30', label: '🗓️ Last 30 Days' },
              ].map((d) => {
                const isSelected = dateFilter === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDateFilter(d.id as any)}
                    style={{
                      background: isSelected ? '#1e293b' : '#ffffff',
                      color: isSelected ? '#ffffff' : '#334155',
                      border: isSelected ? '1px solid #0f172a' : '1px solid #cbd5e1',
                      padding: '5px 14px',
                      borderRadius: 999,
                      fontSize: '11px',
                      fontWeight: isSelected ? 700 : 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      boxShadow: isSelected ? '0 2px 6px rgba(0,0,0,0.15)' : 'none',
                    }}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>

            {/* Quick Country Pills */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              overflowX: 'auto',
              paddingBottom: 4,
              scrollbarWidth: 'none'
            }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', marginRight: 4 }}>
                <Globe size={14} /> Destination:
              </span>
              {COUNTRIES.map((c) => {
                const isSelected = selectedCountry === c.code;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => setSelectedCountry(c.code)}
                    style={{
                      background: isSelected ? '#3b82f6' : '#ffffff',
                      color: isSelected ? '#ffffff' : '#334155',
                      border: isSelected ? '1px solid #2563eb' : '1px solid #cbd5e1',
                      padding: '6px 14px',
                      borderRadius: 999,
                      fontSize: '12px',
                      fontWeight: isSelected ? 700 : 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap',
                      boxShadow: isSelected ? '0 2px 8px rgba(59, 130, 246, 0.3)' : '0 1px 2px rgba(0,0,0,0.03)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>{c.flag}</span>
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Search and Advanced Filters Card */}
            <div style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 16,
              padding: '18px 20px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.03)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16
            }}>
              {/* Search Bar Input */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && fetchJobs()}
                    placeholder="Search by job title, skill (TypeScript, React, Node.js, Docker), or company name..."
                    style={{
                      width: '100%',
                      padding: '12px 14px 12px 40px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: '14px',
                      color: '#1e293b',
                      outline: 'none',
                      background: '#f8fafc'
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={fetchJobs}
                  style={{
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    padding: '12px 22px',
                    borderRadius: 10,
                    fontSize: '13px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <Search size={14} /> Search
                </button>
              </div>

              {/* Secondary Filter Dropdowns */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 12,
                paddingTop: 14,
                borderTop: '1px solid #f1f5f9'
              }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>
                    Workplace Type
                  </label>
                  <select
                    value={selectedWorkplace}
                    onChange={(e) => setSelectedWorkplace(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '12px', background: '#fff' }}
                  >
                    <option value="all">Any Workplace</option>
                    <option value="Remote">Remote Only</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="On-site">On-site</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>
                    Employment Type
                  </label>
                  <select
                    value={selectedEmployment}
                    onChange={(e) => setSelectedEmployment(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '12px', background: '#fff' }}
                  >
                    <option value="all">Any Employment</option>
                    <option value="Full-time">Full-time</option>
                    <option value="Contract">Contract</option>
                    <option value="Internship">Internship</option>
                    <option value="Freelance">Freelance</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>
                    Platform Source
                  </label>
                  <select
                    value={selectedPlatform}
                    onChange={(e) => setSelectedPlatform(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '12px', background: '#fff' }}
                  >
                    <option value="all">All Sources</option>
                    <option value="Remote OK">Remote OK</option>
                    <option value="Arbeitnow">Arbeitnow</option>
                    <option value="Jobicy">Jobicy</option>
                    <option value="LinkedIn">LinkedIn</option>
                    <option value="Company Careers">Company Careers</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setShowSavedOnly(!showSavedOnly)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: showSavedOnly ? '1px solid #f43f5e' : '1px solid #cbd5e1',
                      background: showSavedOnly ? '#fff1f2' : '#ffffff',
                      color: showSavedOnly ? '#e11d48' : '#475569',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6
                    }}
                  >
                    <Bookmark size={14} className={showSavedOnly ? 'fill-current' : ''} />
                    <span>Saved Bookmarks</span>
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setShowAppliedOnly(!showAppliedOnly)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: showAppliedOnly ? '1px solid #6366f1' : '1px solid #cbd5e1',
                      background: showAppliedOnly ? '#eef2ff' : '#ffffff',
                      color: showAppliedOnly ? '#4f46e5' : '#475569',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6
                    }}
                  >
                    <Send size={14} />
                    <span>Applied Only</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Jobs List Grid */}
            {loading && jobs.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '48px', textAlign: 'center' }}>
                <RefreshCw size={24} color="#6366f1" className="spin" style={{ margin: '0 auto 12px' }} />
                <p style={{ fontSize: '14px', color: '#64748b', fontWeight: 600, margin: 0 }}>Discovering and scoring matching vacancies...</p>
              </div>
            ) : jobs.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '48px', textAlign: 'center' }}>
                <Briefcase size={36} color="#94a3b8" style={{ margin: '0 auto 12px' }} />
                <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 6px', color: '#1e293b' }}>No matching vacancies found</h3>
                <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px' }}>Try switching destination countries or click below to synchronize live job feeds.</p>
                <button
                  type="button"
                  onClick={handleSyncJobs}
                  style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Sync Active Job Feeds
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
                {jobs.map((job) => {
                  const score = typeof job.matchScore === 'number' ? job.matchScore : 50;
                  const isHigh = score >= 75;
                  const isMid = score >= 55 && score < 75;

                  return (
                    <div
                      key={job.id}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 16,
                        padding: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                        transition: 'box-shadow 0.2s ease, transform 0.15s ease'
                      }}
                    >
                      <div>
                        {/* Top Metadata Row */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                            <span style={{
                              ...getSourceBadgeStyle(job.source),
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 6
                            }}>
                              {job.source}
                            </span>
                            <span style={{
                              background: job.workplaceType === 'Remote' ? '#ecfdf5' : '#f0f9ff',
                              color: job.workplaceType === 'Remote' ? '#047857' : '#0369a1',
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 6,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}>
                              <Laptop size={12} />
                              {job.workplaceType}
                            </span>
                            <span style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Clock size={12} color="#94a3b8" />
                              Posted {formatTimeAgo(job.postedAt)}
                            </span>
                            {job.discoveredAt && (
                              <span style={{ fontSize: '10.5px', color: '#0284c7', background: '#f0f9ff', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                                Discovered {formatTimeAgo(job.discoveredAt)}
                              </span>
                            )}
                            <span style={{ fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <MapPin size={12} color="#94a3b8" />
                              {job.country || job.location}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => handleToggleSaveJob(job.id, e)}
                            style={{
                              background: job.isSaved ? '#ffe4e6' : '#f8fafc',
                              color: job.isSaved ? '#e11d48' : '#94a3b8',
                              border: '1px solid #e2e8f0',
                              borderRadius: 8,
                              width: 30,
                              height: 30,
                              display: 'grid',
                              placeItems: 'center',
                              cursor: 'pointer'
                            }}
                          >
                            <Bookmark size={14} />
                          </button>
                        </div>

                        {/* Job Title and Company */}
                        <h3
                          onClick={() => setActiveJobModal(job)}
                          style={{
                            fontSize: '16px',
                            fontWeight: 800,
                            color: '#0f172a',
                            margin: '0 0 4px',
                            cursor: 'pointer',
                            lineHeight: 1.3
                          }}
                        >
                          {job.title}
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', color: '#64748b', marginBottom: 14 }}>
                          <span style={{ fontWeight: 600, color: '#334155' }}>{job.company}</span>
                          <span>•</span>
                          <span>{job.employmentType}</span>
                        </div>

                        {/* AI Match Box */}
                        <div style={{
                          background: '#f8fafc',
                          border: '1px solid #edf2f7',
                          borderRadius: 12,
                          padding: '12px',
                          marginBottom: 14
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: 5 }}>
                              <Sparkles size={13} color="#6366f1" /> Compatibility Match
                            </span>
                            <span style={{
                              background: isHigh ? '#dcfce7' : isMid ? '#e0f2fe' : '#fef3c7',
                              color: isHigh ? '#15803d' : isMid ? '#0369a1' : '#b45309',
                              fontSize: '11px',
                              fontWeight: 800,
                              padding: '2px 8px',
                              borderRadius: 999
                            }}>
                              {score}% Match
                            </span>
                          </div>

                          {job.matchReasons && job.matchReasons.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {job.matchReasons.slice(0, 2).map((reason, idx) => (
                                <div key={idx} style={{ fontSize: '11px', color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Check size={12} color="#10b981" />
                                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{reason}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {job.missingSkills && job.missingSkills.length > 0 && (
                            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600 }}>Missing:</span>
                              {job.missingSkills.map((ms, i) => (
                                <span key={i} style={{ background: '#fee2e2', color: '#991b1b', fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: 4 }}>
                                  {ms}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Salary and Visa Info */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#64748b', marginBottom: 14 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, color: '#0f766e' }}>
                            <DollarSign size={13} color="#0f766e" />
                            {job.salaryRaw || (job.salaryMin ? `$${job.salaryMin.toLocaleString()} - $${(job.salaryMax || 0).toLocaleString()}` : 'Competitive / Standard')}
                          </span>
                          {job.visaGuidance && (
                            <span style={{ fontSize: '11px', color: '#4338ca', fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {job.visaGuidance.split(':')[0]}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Action Buttons Footer */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => setActiveJobModal(job)}
                          style={{
                            background: '#f8fafc',
                            color: '#334155',
                            border: '1px solid #cbd5e1',
                            padding: '8px 12px',
                            borderRadius: 8,
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          View Details
                        </button>

                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => setEmailAppModalJob(job)}
                            style={{
                              background: '#f0fdf4',
                              color: '#15803d',
                              border: '1px solid #bbf7d0',
                              padding: '8px 12px',
                              borderRadius: 8,
                              fontSize: '12px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                          >
                            <Mail size={13} /> Apply via Email
                          </button>

                          {job.applicationStatus ? (
                            <span style={{
                              background: '#ecfdf5',
                              color: '#059669',
                              border: '1px solid #a7f3d0',
                              padding: '6px 12px',
                              borderRadius: 8,
                              fontSize: '11px',
                              fontWeight: 800,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4
                            }}>
                              <CheckCircle2 size={13} />
                              {job.applicationStatus.toUpperCase()}
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={(e) => handleOpenQuickApply(job, e)}
                                style={{
                                  background: '#ffffff',
                                  color: '#4338ca',
                                  border: '1px solid #c7d2fe',
                                  padding: '8px 12px',
                                  borderRadius: 8,
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4
                                }}
                              >
                                <FileText size={13} /> Quick Apply
                              </button>

                              <button
                                type="button"
                                onClick={(e) => handleExecuteAutoApply(job.id, e)}
                                style={{
                                  background: 'linear-gradient(135deg, #4f46e5, #06b6d4)',
                                  color: '#ffffff',
                                  border: 'none',
                                  padding: '8px 14px',
                                  borderRadius: 8,
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  boxShadow: '0 2px 6px rgba(79, 70, 229, 0.3)'
                                }}
                              >
                                <Sparkles size={13} /> Auto-Apply
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: APPLICATION TRACKER PIPELINE                      */}
        {/* ======================================================== */}
        {activeTab === 'tracker' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Overview Counters */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12
            }}>
              {[
                { label: 'Total Tracked', val: applications.length, color: '#4f46e5' },
                { label: 'Submitted', val: appStats.submitted || 0, color: '#0ea5e9' },
                { label: 'Interviews Scheduled', val: appStats.interview || 0, color: '#10b981' },
                { label: 'Offers Extended', val: appStats.offer || 0, color: '#f59e0b' },
                { label: 'Rejected', val: appStats.rejected || 0, color: '#ef4444' },
                { label: 'Ready to Apply', val: appStats.ready_to_apply || 0, color: '#8b5cf6' },
              ].map((m, i) => (
                <div key={i} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px', textAlign: 'center' }}>
                  <strong style={{ fontSize: '22px', color: m.color, display: 'block', lineHeight: 1.1 }}>{m.val}</strong>
                  <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{m.label}</span>
                </div>
              ))}
            </div>

            {/* Applications Table Card */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TrendingUp size={18} color="#4f46e5" /> Active Application Pipeline
                </h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={handleSyncGmail}
                    disabled={isSyncingGmail}
                    style={{
                      background: '#eff6ff',
                      color: '#1d4ed8',
                      border: '1px solid #bfdbfe',
                      padding: '8px 14px',
                      borderRadius: 8,
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: isSyncingGmail ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                    title="Scan Gmail for bounce notices, delivery failures, and employer replies"
                  >
                    <RefreshCw size={14} className={isSyncingGmail ? 'spin' : ''} />
                    {isSyncingGmail ? 'Checking Gmail…' : 'Sync with Gmail (Check Bounces)'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setEmailHistoryModalOpen(true)}
                    style={{
                      background: '#f8fafc',
                      color: '#334155',
                      border: '1px solid #cbd5e1',
                      padding: '8px 14px',
                      borderRadius: 8,
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    <Inbox size={14} color="#6366f1" /> Sent Emails Archive ({applicationEmails.length})
                  </button>
                </div>
              </div>

              {applications.length === 0 ? (
                <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  No applications recorded yet. Search vacancies and apply or click Auto-Apply to manage your applications here.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {applications.map((app) => (
                    <div
                      key={app.id}
                      style={{
                        padding: '16px',
                        borderRadius: 12,
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 260 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: '14px', color: '#0f172a' }}>{app.job?.title || 'Job Opportunity'}</strong>
                          <span style={{ fontSize: '13px', color: '#64748b' }}>• {app.job?.company || 'Company'}</span>
                          <span style={{ background: '#e0e7ff', color: '#4338ca', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
                            {app.applicationMode.toUpperCase()}
                          </span>
                          {app.deliveryStatus && (
                            <span style={{
                              background:
                                app.deliveryStatus === 'bounced' || app.status === 'bounced' || app.status === 'failed'
                                  ? '#fee2e2'
                                  : app.deliveryStatus === 'opened_in_gmail' || app.status === 'opened_in_gmail'
                                  ? '#fef3c7'
                                  : app.deliveryStatus === 'accepted_by_provider'
                                  ? '#eff6ff'
                                  : '#ecfdf5',
                              color:
                                app.deliveryStatus === 'bounced' || app.status === 'bounced' || app.status === 'failed'
                                  ? '#b91c1c'
                                  : app.deliveryStatus === 'opened_in_gmail' || app.status === 'opened_in_gmail'
                                  ? '#b45309'
                                  : app.deliveryStatus === 'accepted_by_provider'
                                  ? '#1d4ed8'
                                  : '#047857',
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 999
                            }}>
                              ● {app.deliveryStatus === 'accepted_by_provider' ? 'ACCEPTED BY SMTP' : app.deliveryStatus.toUpperCase().replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                        {app.failureReason && (
                          <div style={{ marginTop: 4, fontSize: '11px', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={12} />
                            <span><strong>Delivery Note:</strong> {app.failureReason}</span>
                          </div>
                        )}
                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: 4, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span>Date: {new Date(app.appliedAt).toLocaleDateString()}</span>
                          {app.recipientEmail && (
                            <span style={{ color: '#0f766e', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Mail size={11} /> To: {app.recipientEmail}
                            </span>
                          )}
                          {app.submissionRef && <span>• Ref: {app.submissionRef}</span>}
                          {app.job?.applyUrl && (
                            <a href={app.job.applyUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2 }}>
                              Job Link <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => setTimelineApp(app)}
                          style={{
                            background: '#ffffff',
                            color: '#334155',
                            border: '1px solid #cbd5e1',
                            padding: '6px 10px',
                            borderRadius: 8,
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          <History size={12} color="#6366f1" /> Timeline ({app.activityTimeline?.length || 0})
                        </button>

                        <button
                          type="button"
                          onClick={() => setAiAssistantApp(app)}
                          style={{
                            background: '#eef2ff',
                            color: '#4338ca',
                            border: '1px solid #c7d2fe',
                            padding: '6px 10px',
                            borderRadius: 8,
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          <Bot size={12} /> AI Email Assistant
                        </button>

                        <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', marginLeft: 4 }}>Status:</label>
                        <select
                          value={app.status}
                          onChange={(e) => handleUpdateApplicationStatus(app.id, e.target.value as JobApplicationStatus)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid #cbd5e1',
                            fontSize: '12px',
                            fontWeight: 700,
                            background: '#fff',
                            color: '#1e293b'
                          }}
                        >
                          <option value="draft">Draft</option>
                          <option value="draft_created">Draft Created</option>
                          <option value="ready_to_send">Ready to Send</option>
                          <option value="ready_to_apply">Ready to Apply</option>
                          <option value="awaiting_approval">Awaiting Approval</option>
                          <option value="opened_in_gmail">Opened in Gmail</option>
                          <option value="awaiting_confirmation">Awaiting Send Confirmation</option>
                          <option value="accepted_by_provider">Accepted by SMTP</option>
                          <option value="sent">Email Sent</option>
                          <option value="delivery_confirmed">Delivery Confirmed</option>
                          <option value="submitted">Submitted / In Progress</option>
                          <option value="bounced">Bounced / Rejected</option>
                          <option value="failed">Delivery Failed</option>
                          <option value="awaiting_response">Awaiting Response</option>
                          <option value="under_review">Under Review</option>
                          <option value="replied">Employer Replied</option>
                          <option value="interview_invited">Interview Invited</option>
                          <option value="interview">Interview Scheduled</option>
                          <option value="shortlisted">Shortlisted</option>
                          <option value="offer">Offer Received 🎉</option>
                          <option value="accepted">Offer Accepted</option>
                          <option value="rejected">Rejected</option>
                          <option value="withdrawn">Withdrawn</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: RESUME STUDIO & ATS DIAGNOSTIC                    */}
        {/* ======================================================== */}
        {activeTab === 'resume' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Upload Box */}
            <div style={{
              background: '#ffffff',
              border: '2px dashed #cbd5e1',
              borderRadius: 16,
              padding: '40px 24px',
              textAlign: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
            }}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleResumeFileUpload}
                accept=".pdf,.docx,.doc,.txt"
                style={{ display: 'none' }}
              />
              <Upload size={36} color="#6366f1" style={{ margin: '0 auto 12px' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>
                Upload Resume for Instant AI Analysis & ATS Scoring
              </h3>
              <p style={{ fontSize: '13px', color: '#64748b', maxWidth: 500, margin: '0 auto 16px', lineHeight: 1.5 }}>
                Supports PDF, DOCX, and TXT. Evaluates contact information, quantified impact metrics, ATS formatting, and extracted technical skills.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingResume}
                style={{
                  background: '#4f46e5',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 24px',
                  borderRadius: 10,
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: uploadingResume ? 'not-allowed' : 'pointer'
                }}
              >
                {uploadingResume ? 'Analyzing Resume...' : 'Choose Resume File'}
              </button>
            </div>

            {/* Saved & Uploaded Resumes List */}
            {resumes.length > 0 && (
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '20px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                  <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileText size={16} color="#4f46e5" /> Saved & Uploaded Resumes ({resumes.length})
                  </h4>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    Retained permanently for ATS diagnostic scoring and email attachments
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {resumes.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: '12px 16px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ background: '#e0e7ff', color: '#4338ca', width: 38, height: 38, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '11px' }}>
                          {r.filename.endsWith('.docx') ? 'DOCX' : r.filename.endsWith('.pdf') ? 'PDF' : 'FILE'}
                        </div>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{r.filename}</div>
                          <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <span>Size: {(r.fileSize / 1024).toFixed(0)} KB</span>
                            <span>•</span>
                            <span>Uploaded: {new Date(r.createdAt).toLocaleDateString()}</span>
                            <span>•</span>
                            <span style={{ color: '#16a34a', fontWeight: 600 }}>Stored & Available</span>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => setPreviewResume(r)}
                          style={{
                            background: '#eff6ff',
                            color: '#2563eb',
                            border: '1px solid #bfdbfe',
                            padding: '6px 12px',
                            borderRadius: 6,
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <FileText size={13} /> Preview Content
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAnalyzeResume(r.id)}
                          style={{
                            background: '#f0fdf4',
                            color: '#16a34a',
                            border: '1px solid #bbf7d0',
                            padding: '6px 12px',
                            borderRadius: 6,
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Sparkles size={13} /> ATS Critique
                        </button>

                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            background: '#f8fafc',
                            color: '#475569',
                            border: '1px solid #cbd5e1',
                            padding: '6px 12px',
                            borderRadius: 6,
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Replace
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteResume(r.id)}
                          title="Delete Resume"
                          style={{
                            background: '#fef2f2',
                            color: '#dc2626',
                            border: '1px solid #fecaca',
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Diagnostic Scorecard */}
            {activeAnalysis && (
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, borderBottom: '1px solid #f1f5f9', marginBottom: 20 }}>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FileCheck size={20} color="#10b981" /> ATS Diagnostic Scorecard
                    </h3>
                    <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>Evaluated against modern Applicant Tracking System parsers</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '28px', fontWeight: 900, color: '#10b981', lineHeight: 1 }}>{activeAnalysis.overallScore}/100</div>
                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>ATS Score</span>
                  </div>
                </div>

                {/* Section Feedback Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 20 }}>
                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#4338ca', margin: '0 0 6px', textTransform: 'uppercase' }}>Executive Summary</h4>
                    <p style={{ fontSize: '12px', color: '#334155', margin: 0, lineHeight: 1.5 }}>{activeAnalysis.summaryCritique}</p>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#4338ca', margin: '0 0 6px', textTransform: 'uppercase' }}>Experience & Quantifiable Metrics</h4>
                    <p style={{ fontSize: '12px', color: '#334155', margin: 0, lineHeight: 1.5 }}>{activeAnalysis.experienceFeedback}</p>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#4338ca', margin: '0 0 6px', textTransform: 'uppercase' }}>Technical Skills Portfolio</h4>
                    <p style={{ fontSize: '12px', color: '#334155', margin: 0, lineHeight: 1.5 }}>{activeAnalysis.skillsFeedback}</p>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '14px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#4338ca', margin: '0 0 6px', textTransform: 'uppercase' }}>Formatting & Parser Readability</h4>
                    <p style={{ fontSize: '12px', color: '#334155', margin: 0, lineHeight: 1.5 }}>{activeAnalysis.formattingFeedback}</p>
                  </div>
                </div>

                {/* Priority Improvements */}
                {activeAnalysis.recommendations && activeAnalysis.recommendations.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', marginBottom: 10 }}>Priority Action Items</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {activeAnalysis.recommendations.map((rec, idx) => (
                        <div key={idx} style={{ background: '#f8fafc', padding: '12px', borderRadius: 10, border: '1px solid #e2e8f0', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <span style={{
                            background: rec.priority === 'high' ? '#fee2e2' : '#fef3c7',
                            color: rec.priority === 'high' ? '#991b1b' : '#92400e',
                            fontSize: '10px',
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: 4,
                            textTransform: 'uppercase'
                          }}>
                            {rec.priority}
                          </span>
                          <div>
                            <strong style={{ fontSize: '12px', color: '#0f172a', display: 'block' }}>{rec.issue}</strong>
                            <span style={{ fontSize: '12px', color: '#64748b' }}>{rec.recommendedImprovement}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Extracted and Missing Keywords */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>Extracted Technical Keywords:</span>
                    {activeAnalysis.keywordsDetected.map((kw, i) => (
                      <span key={i} style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 999 }}>
                        {kw}
                      </span>
                    ))}
                  </div>

                  {activeAnalysis.missingKeywords.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b' }}>Recommended Missing Keywords:</span>
                      {activeAnalysis.missingKeywords.map((mkw, i) => (
                        <span key={i} style={{ background: '#fef3c7', color: '#92400e', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 999 }}>
                          +{mkw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* AI Tailored Resume Studio with Live Section Editing, PDF & Word DOCX Downloads */}
            <ResumeStudio profile={profile} />
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: CAREER PROFILE                                    */}
        {/* ======================================================== */}
        {activeTab === 'profile' && profile && (
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '28px', boxShadow: '0 4px 16px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Header & Save Indicator */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingBottom: 16, borderBottom: '1px solid #f1f5f9' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Compass size={20} color="#2563eb" /> Candidate Career Profile & Professional CV Data
                </h3>
                <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                  Permanently stored in database. Powers ATS matching, cover letters, and tailored Word/PDF resumes.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {profileLastSaved && (
                  <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle2 size={14} /> Saved at {profileLastSaved}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={profileSaving}
                  style={{
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    padding: '10px 24px',
                    borderRadius: 8,
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: profileSaving ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 2px 8px rgba(37,99,235,0.25)',
                  }}
                >
                  {profileSaving ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
                  {profileSaving ? 'Saving to Database…' : 'Save Profile Changes'}
                </button>
              </div>
            </div>

            {/* 1. Professional Photograph */}
            <CandidatePhotoEditor
              photoUrl={profile.photoUrl || ''}
              includePhotoInResume={profile.includePhotoInResume ?? true}
              fullName={profile.fullName || ''}
              onChangePhoto={(url) => setProfile({ ...profile, photoUrl: url })}
              onChangeIncludeInResume={(include) => setProfile({ ...profile, includePhotoInResume: include })}
            />

            {/* 2. Personal Contact Information */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px' }}>
              <h4 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                Personal Contact & Work Preferences
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: 4 }}>Full Name *</label>
                  <input
                    type="text"
                    value={profile.fullName}
                    onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: 4 }}>Primary Email *</label>
                  <input
                    type="email"
                    value={profile.email}
                    onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: 4 }}>Phone / WhatsApp</label>
                  <input
                    type="text"
                    value={profile.phone}
                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: 4 }}>Current City & Country</label>
                  <input
                    type="text"
                    value={profile.location}
                    onChange={(e) => setProfile({ ...profile, location: e.target.value })}
                    placeholder="e.g. Lahore, Pakistan"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: 4 }}>Preferred Workplace</label>
                  <select
                    value={profile.remotePreference}
                    onChange={(e) => setProfile({ ...profile, remotePreference: e.target.value as WorkplaceType })}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                  >
                    <option value="Remote">Remote Only</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="On-site">On-site</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: 4 }}>Minimum Desired Salary</label>
                  <input
                    type="text"
                    value={profile.minSalary || ''}
                    onChange={(e) => setProfile({ ...profile, minSalary: e.target.value })}
                    placeholder="e.g. $60,000 / year"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: 4 }}>Visa / Relocation Status</label>
                  <input
                    type="text"
                    value={profile.visaStatus || ''}
                    onChange={(e) => setProfile({ ...profile, visaStatus: e.target.value })}
                    placeholder="e.g. Open to Relocation / Remote Contractor"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                  />
                </div>
              </div>
            </div>

            {/* 3. Target Job Roles */}
            <MultiItemEditor
              label="Target Job Roles"
              description="Add roles you are qualified for and actively seeking (e.g. Full Stack Engineer, AI Automation Specialist). Type freely with spaces and commas, then press Enter or click '+ Add'."
              items={profile.targetRoles || []}
              onChange={(newRoles) => setProfile({ ...profile, targetRoles: newRoles })}
              placeholder="e.g. Senior Frontend Engineer"
            />

            {/* 4. Preferred Target Locations */}
            <MultiItemEditor
              label="Preferred Locations & Work Hubs"
              description="Target countries, cities, or remote markets (e.g. Remote / Worldwide, United States, Dubai, London)."
              items={profile.preferredLocations || []}
              onChange={(newLocs) => setProfile({ ...profile, preferredLocations: newLocs })}
              placeholder="e.g. Remote / Worldwide"
            />

            {/* 5. Technical Skills Portfolio */}
            <MultiItemEditor
              label="Technical Skills & Competencies"
              description="Languages, frameworks, databases, and DevOps tools. Type freely or click chips to edit/delete."
              items={profile.skills || []}
              onChange={(newSkills) => setProfile({ ...profile, skills: newSkills })}
              placeholder="e.g. React, TypeScript, Node.js, Fastify, Docker, PostgreSQL"
            />

            {/* 6. Professional & Leadership Skills */}
            <MultiItemEditor
              label="Professional, Management & Leadership Skills"
              description="Core soft skills, agile ceremonies, system architecture, cross-functional collaboration, mentorship."
              items={profile.professionalSkills || []}
              onChange={(newProf) => setProfile({ ...profile, professionalSkills: newProf })}
              placeholder="e.g. System Architecture, Agile Delivery, Team Leadership, Problem Solving"
            />

            {/* 7. Work Experience Editor */}
            <ExperienceEditor
              experience={profile.experience || []}
              onChange={(newExp) => setProfile({ ...profile, experience: newExp })}
            />

            {/* 8. Internships & Practical Training */}
            <InternshipsEditor
              internships={profile.internships || []}
              onChange={(newInterns) => setProfile({ ...profile, internships: newInterns })}
            />

            {/* 9. Education & Degrees */}
            <EducationEditor
              education={profile.education || []}
              onChange={(newEdu) => setProfile({ ...profile, education: newEdu })}
            />

            {/* 10. Featured Projects */}
            <ProjectsEditor
              projects={profile.projects || []}
              onChange={(newProj) => setProfile({ ...profile, projects: newProj })}
            />

            {/* 11. Certifications & Credentials */}
            <CertificationsEditor
              certifications={profile.certifications || []}
              onChange={(newCerts) => setProfile({ ...profile, certifications: newCerts })}
            />

            {/* 12. Languages & Fluency */}
            <LanguagesEditor
              languages={profile.languages || []}
              onChange={(newLang) => setProfile({ ...profile, languages: newLang })}
            />

            {/* 13. Social Media & Professional Networking Accounts */}
            <SocialAccountsEditor
              accounts={profile.socialAccounts || []}
              onChange={(newAccounts) => setProfile({ ...profile, socialAccounts: newAccounts })}
            />

            {/* 14. Professional Summary */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                Professional Executive Summary
              </label>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 10px' }}>
                A compelling summary highlighting your strengths, core tech stack, and unique value proposition.
              </p>
              <textarea
                rows={4}
                value={profile.summary}
                onChange={(e) => setProfile({ ...profile, summary: e.target.value })}
                style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '13px', lineHeight: 1.6, background: '#fff' }}
              />
            </div>

            {/* Bottom Save Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
              <div>
                {profileLastSaved ? (
                  <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle2 size={16} /> All profile changes permanently saved to database ({profileLastSaved})
                  </span>
                ) : (
                  <span style={{ fontSize: '13px', color: '#64748b' }}>
                    Click button to save changes directly to persistent SQLite storage.
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={profileSaving}
                style={{
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  padding: '12px 28px',
                  borderRadius: 10,
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: profileSaving ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 2px 10px rgba(37,99,235,0.3)',
                }}
              >
                {profileSaving ? <RefreshCw size={16} className="spin" /> : <Save size={16} />}
                {profileSaving ? 'Saving Changes…' : 'Save Profile Updates'}
              </button>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 5: AUTO-APPLY & PLATFORM CONFIG                      */}
        {/* ======================================================== */}
        {activeTab === 'auto-apply' && config && (
          <form onSubmit={handleSaveConfig} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sliders size={18} color="#4f46e5" /> Auto-Apply & Job Platform Feeds
              </h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                Configure autonomous application safeguards, daily limits, and connected job sources.
              </p>
            </div>

            {/* Master Switch */}
            <div style={{ background: '#f8fafc', padding: '18px', borderRadius: 12, border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '14px', color: '#0f172a', display: 'block' }}>Autonomous Auto-Apply Engine</strong>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Automatically queue and apply to listings meeting your minimum score threshold</span>
              </div>
              <input
                type="checkbox"
                checked={config.autoApplyEnabled}
                onChange={(e) => setConfig({ ...config, autoApplyEnabled: e.target.checked })}
                style={{ width: 22, height: 22, cursor: 'pointer' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  Daily Application Limit: <strong style={{ color: '#4f46e5' }}>{config.maxDailyApplications} applications/day</strong>
                </label>
                <input
                  type="range"
                  min="1"
                  max="25"
                  value={config.maxDailyApplications}
                  onChange={(e) => setConfig({ ...config, maxDailyApplications: Number(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                    Minimum Match Threshold: <strong style={{ color: '#4f46e5' }}>{config.minCompatibilityScore}% compatibility</strong>
                  </label>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>Full 0–100% Control</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={config.minCompatibilityScore ?? 50}
                  onChange={(e) => setConfig({ ...config, minCompatibilityScore: Number(e.target.value) })}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8', marginTop: 3 }}>
                  <span>0% (All Jobs)</span>
                  <span>25%</span>
                  <span>50%</span>
                  <span>75%</span>
                  <span>100% (Exact Fit)</span>
                </div>
              </div>
            </div>

            {/* Automatic Background Job Discovery Sync */}
            <div style={{ background: '#f8fafc', padding: '18px', borderRadius: 12, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: '14px', color: '#0f172a', display: 'block' }}>Automatic Background Feed Synchronization</strong>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>Periodically query Arbeitnow, Jobicy, Remote OK, and verified career boards automatically</span>
                </div>
                <input
                  type="checkbox"
                  checked={config.autoSyncEnabled !== false}
                  onChange={(e) => setConfig({ ...config, autoSyncEnabled: e.target.checked })}
                  style={{ width: 22, height: 22, cursor: 'pointer' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  Periodic Discovery Frequency:
                </label>
                <select
                  value={config.autoDiscoveryIntervalHours || 1}
                  onChange={(e) => setConfig({ ...config, autoDiscoveryIntervalHours: Number(e.target.value) })}
                  style={{ width: '100%', maxWidth: 320, padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
                >
                  <option value={0.5}>Every 30 Minutes (Rapid Discovery)</option>
                  <option value={1}>Every 1 Hour (Standard Recommended)</option>
                  <option value={3}>Every 3 Hours</option>
                  <option value={6}>Every 6 Hours</option>
                  <option value={12}>Every 12 Hours</option>
                  <option value={24}>Every 24 Hours (Daily)</option>
                </select>
              </div>
            </div>

            {/* Excluded Companies with MultiItemEditor */}
            <MultiItemEditor
              label="Excluded Companies (Never Auto-Apply)"
              description="Add company names that should be permanently blocked from automatic job applications."
              items={config.excludedCompanies || []}
              onChange={(newEx) => setConfig({ ...config, excludedCompanies: newEx })}
              placeholder="e.g. Current Employer, Competitor Inc"
            />

            {/* Platforms Overview */}
            <div>
              <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', marginBottom: 10 }}>Connected Platforms & Feeds</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                {platforms.map((p) => (
                  <div key={p.id} style={{ background: '#f8fafc', padding: '12px', borderRadius: 10, border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>{p.name}</strong>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>{p.category}</span>
                    </div>
                    <span style={{ background: '#ecfdf5', color: '#059669', fontSize: '10px', fontWeight: 800, padding: '2px 8px', borderRadius: 999 }}>
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 8, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >
                Save Settings
              </button>
            </div>
          </form>
        )}

        {/* ======================================================== */}
        {/* TAB 6: NOTIFICATIONS / ALERTS                            */}
        {/* ======================================================== */}
        {activeTab === 'notifications' && (
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.02)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={18} color="#4f46e5" /> System Alerts & Activity Feed
            </h3>

            {notifications.length === 0 ? (
              <div style={{ padding: '36px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                No notifications right now. Activity and high-compatibility matches will appear here.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {notifications.map((n) => (
                  <div key={n.id} style={{ padding: '14px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>{n.title}</strong>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>{n.message}</span>
                      <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginTop: 4 }}>{new Date(n.createdAt).toLocaleString()}</span>
                    </div>

                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.markJobNotificationRead(n.id);
                          setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item)));
                        }}
                        style={{ background: '#e0e7ff', color: '#4338ca', border: 'none', padding: '4px 10px', borderRadius: 6, fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Mark Read
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ======================================================== */}
      {/* MODAL: COMPREHENSIVE JOB DETAILS & SOURCE POSTING DATA   */}
      {/* ======================================================== */}
      {activeJobModal && (
        <JobDetailsModal
          job={activeJobModal}
          onClose={() => setActiveJobModal(null)}
          onQuickApply={(j: JobListing) => {
            setActiveJobModal(null);
            handleOpenQuickApply(j);
          }}
          onEmailApply={(j: JobListing) => {
            setActiveJobModal(null);
            setEmailAppModalJob(j);
          }}
        />
      )}

      {/* ======================================================== */}
      {/* MODAL: QUICK APPLY / COVER LETTER & ANSWERS              */}
      {/* ======================================================== */}
      {applyPackageModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
          background: 'rgba(15, 23, 42, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            maxWidth: 680,
            width: '100%',
            maxHeight: '85vh',
            overflowY: 'auto',
            padding: 24,
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottom: '1px solid #e2e8f0' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '0 0 2px' }}>
                  Application Package: {applyPackageModal.job.title}
                </h3>
                <span style={{ fontSize: '12px', color: '#64748b' }}>{applyPackageModal.job.company}</span>
              </div>
              <button
                type="button"
                onClick={() => setApplyPackageModal(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} color="#64748b" />
              </button>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>Tailored Cover Letter</label>
                <button
                  type="button"
                  onClick={() => copyText(applyPackageModal.coverLetter, 'cl')}
                  style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '4px 10px', borderRadius: 6, fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  {copiedId === 'cl' ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                  {copiedId === 'cl' ? 'Copied' : 'Copy Text'}
                </button>
              </div>
              <textarea
                rows={7}
                value={applyPackageModal.coverLetter}
                onChange={(e) => setApplyPackageModal({ ...applyPackageModal, coverLetter: e.target.value })}
                style={{ width: '100%', padding: '12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: '12px', lineHeight: 1.5, background: '#f8fafc' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: 8 }}>Recommended Form Answers</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                {Object.entries(applyPackageModal.answers).map(([k, v]) => (
                  <div key={k} style={{ padding: '8px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                    <div>
                      <strong style={{ color: '#64748b' }}>{k}: </strong>
                      <span style={{ color: '#1e293b' }}>{v}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText(v, k)}
                      style={{ background: '#fff', border: '1px solid #cbd5e1', padding: '3px 8px', borderRadius: 6, fontSize: '10px', cursor: 'pointer' }}
                    >
                      {copiedId === k ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, borderTop: '1px solid #e2e8f0', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {applyPackageModal.job.applyUrl && (
                  <a
                    href={applyPackageModal.job.applyUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: '12px', color: '#2563eb', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    Open Employer Portal <ExternalLink size={13} />
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const targetJob = applyPackageModal.job;
                    setApplyPackageModal(null);
                    setEmailAppModalJob(targetJob);
                  }}
                  style={{
                    background: '#f0fdf4',
                    color: '#15803d',
                    border: '1px solid #bbf7d0',
                    padding: '8px 14px',
                    borderRadius: 8,
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Mail size={13} /> Apply via Email (Auto-Discover HR Inbox)
                </button>
              </div>

              <button
                type="button"
                onClick={handleExecuteManualApply}
                style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 8, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >
                Confirm Application & Mark As Submitted
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: DIRECT EMAIL APPLICATION & PRE-SEND REVIEW        */}
      {/* ======================================================== */}
      {emailAppModalJob && (
        <EmailApplicationModal
          job={emailAppModalJob}
          profile={profile}
          resumes={resumes}
          onClose={() => setEmailAppModalJob(null)}
          onSuccess={() => {
            fetchJobs();
            api.getJobApplications().then((r) => {
              if (r.ok) {
                setApplications(r.applications);
                setAppStats(r.stats);
                setTodayAppsCount(r.todayCount);
              }
            });
            api.getApplicationEmails().then((r) => {
              if (r.ok) setApplicationEmails(r.emails);
            });
          }}
        />
      )}

      {/* ======================================================== */}
      {/* MODAL: AI EMAIL RESPONSE ASSISTANT                       */}
      {/* ======================================================== */}
      {aiAssistantApp && (
        <AiEmailAssistantModal
          application={aiAssistantApp}
          onClose={() => setAiAssistantApp(null)}
          onResponseLogged={(updatedApp) => {
            setApplications((prev) =>
              prev.map((a) => (a.id === updatedApp.id ? updatedApp : a))
            );
            api.getJobApplications().then((r) => {
              if (r.ok) setAppStats(r.stats);
            });
          }}
        />
      )}

      {/* ======================================================== */}
      {/* MODAL: APPLICATION REAL-TIME ACTIVITY TIMELINE           */}
      {/* ======================================================== */}
      {timelineApp && (
        <ApplicationTimelineModal
          application={timelineApp}
          onClose={() => setTimelineApp(null)}
        />
      )}

      {/* ======================================================== */}
      {/* MODAL: RESUME PREVIEW                                    */}
      {/* ======================================================== */}
      {previewResume && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewResume(null);
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 16,
              maxWidth: 720,
              width: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '18px 24px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#f8fafc',
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
                  {previewResume.filename}
                </h3>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  {(previewResume.fileSize / 1024).toFixed(0)} KB • Uploaded {new Date(previewResume.createdAt).toLocaleString()}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <a
                  href={api.getResumeFileUrl(previewResume.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    background: '#eff6ff',
                    color: '#2563eb',
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: '12px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <ExternalLink size={13} /> Open Original File
                </a>

                <button
                  type="button"
                  onClick={() => setPreviewResume(null)}
                  style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: '#64748b' }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div style={{ padding: '24px' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                Extracted Text & ATS Parser Output
              </h4>
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '16px',
                  maxHeight: '50vh',
                  overflowY: 'auto',
                }}
              >
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '12px', color: '#1e293b', lineHeight: 1.6 }}>
                  {previewResume.parsedText || 'No text extracted from document.'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: APPLICATION SENT EMAIL HISTORY LOG                */}
      {/* ======================================================== */}
      {emailHistoryModalOpen && (
        <ApplicationEmailHistoryModal
          emails={applicationEmails}
          onClose={() => setEmailHistoryModalOpen(false)}
        />
      )}

      {/* ======================================================== */}
      {/* MODAL: JOB DISCOVERY ACTIVITY & SYNC AUDIT LOG           */}
      {/* ======================================================== */}
      <SyncHistoryModal
        isOpen={syncHistoryModalOpen}
        onClose={() => setSyncHistoryModalOpen(false)}
        stats={discoveryStats}
      />
    </div>
  );
};
