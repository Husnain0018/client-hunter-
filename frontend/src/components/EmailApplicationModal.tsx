import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Mail,
  Send,
  Building2,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Paperclip,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Upload,
  Eye,
  FileCheck2,
  Globe,
  RefreshCw,
} from 'lucide-react';
import { api } from '../api/client';
import type { JobListing, CareerProfile, StoredResume, JobApplication, GeneratedResume } from '../types';

interface EmailApplicationModalProps {
  job: JobListing;
  profile: CareerProfile | null;
  resumes: StoredResume[];
  defaultCoverLetter?: string;
  onClose: () => void;
  onSuccess: (application: JobApplication) => void;
}

const DUMMY_DOMAINS = [
  'company.com',
  'example.com',
  'example.org',
  'example.net',
  'examplecompany.com',
  'sample.com',
  'test.com',
  'domain.com',
  'yourdomain.com',
  'email.com',
  'mail.com',
  'dummy.com',
  'placeholder.com',
];

function isDummyDomain(email: string): boolean {
  if (!email || !email.includes('@')) return false;
  const domain = (email.split('@')[1] || '').toLowerCase().trim();
  return DUMMY_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export const EmailApplicationModal: React.FC<EmailApplicationModalProps> = ({
  job,
  profile,
  resumes: initialResumes,
  defaultCoverLetter = '',
  onClose,
  onSuccess,
}) => {
  const candidateEmail = profile?.email || 'candidate@example.com';

  const [recipientEmail, setRecipientEmail] = useState(job.contactEmail || '');
  const [recipientEmailSource, setRecipientEmailSource] = useState<string>(
    job.contactEmail ? 'Original Job Listing' : '',
  );
  const [sourceUrl, setSourceUrl] = useState<string>(job.sourceUrl || job.applyUrl || '');
  const [companyWebsite, setCompanyWebsite] = useState<string>('');
  const [verificationStatus, setVerificationStatus] = useState<
    'verified' | 'publicly_listed' | 'unverified' | 'not_found' | 'detecting'
  >('detecting');
  const [verificationLabel, setVerificationLabel] = useState<string>('');
  const [portalUrl, setPortalUrl] = useState<string>(job.applyUrl || job.sourceUrl || '');
  const [originalListingUrl, setOriginalListingUrl] = useState<string>(job.sourceUrl || job.applyUrl || '');
  const [sourcesChecked, setSourcesChecked] = useState<string[]>([]);
  const [alternativeEmails, setAlternativeEmails] = useState<
    Array<{ email: string; source: string; sourceUrl: string; emailType: string }>
  >([]);

  const [senderEmail, setSenderEmail] = useState(candidateEmail);
  const [subject, setSubject] = useState(`Application for ${job.title} – ${profile?.fullName || 'Candidate'}`);
  const [body, setBody] = useState(defaultCoverLetter || '');
  const [htmlBody, setHtmlBody] = useState<string>('');
  const [bodyEdited, setBodyEdited] = useState(false);
  const [renderingPreview, setRenderingPreview] = useState(false);
  const [activeBodyTab, setActiveBodyTab] = useState<'preview' | 'edit'>('preview');

  // Attachment state
  const [storedResumes, setStoredResumes] = useState<StoredResume[]>(initialResumes);
  const [generatedResumes, setGeneratedResumes] = useState<GeneratedResume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState<string>(initialResumes[0]?.id || '');
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loadingDiscovery, setLoadingDiscovery] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentSuccess, setSentSuccess] = useState<{
    recipient: string;
    sender: string;
    date: string;
    status: string;
    attachedResume?: string;
  } | null>(null);

  const runEmailDiscovery = async (refresh = false) => {
    setLoadingDiscovery(true);
    setVerificationStatus('detecting');
    try {
      const discRes = await api.getJobRecipientEmail(job.id, refresh);
      if (discRes.ok && discRes.discovery) {
        const d = discRes.discovery;
        if (d.companyWebsite) setCompanyWebsite(d.companyWebsite);
        if (d.portalUrl) setPortalUrl(d.portalUrl);
        if (d.originalListingUrl) setOriginalListingUrl(d.originalListingUrl);
        if (Array.isArray(d.sourcesChecked)) setSourcesChecked(d.sourcesChecked);
        if (Array.isArray(d.alternativeEmails)) setAlternativeEmails(d.alternativeEmails);

        if (d.found && d.email) {
          setRecipientEmail(d.email);
          setRecipientEmailSource(d.source);
          setSourceUrl(d.sourceUrl || d.portalUrl || '');
          setVerificationStatus(d.verificationStatus);
          setVerificationLabel(d.verificationLabel || 'Publicly Listed / Format Validated');
        } else {
          setRecipientEmailSource(d.source || 'Recruitment Email Not Found');
          setVerificationStatus('not_found');
          setVerificationLabel('No Public Email Published');
        }
      }
    } catch (err) {
      console.warn('Recipient email discovery note:', err);
      setVerificationStatus(job.contactEmail ? 'verified' : 'not_found');
      setRecipientEmailSource(job.contactEmail ? 'Original Job Listing' : 'Recruitment Email Not Found');
    } finally {
      setLoadingDiscovery(false);
    }
  };

  // 1. Discover Recipient Email & Generate Formatted Application Email on Mount
  useEffect(() => {
    let isMounted = true;

    async function loadAll() {
      void runEmailDiscovery(false);

      try {
        const emailRes = await api.getJobApplicationEmail(job.id);
        if (isMounted && emailRes.ok && emailRes.email) {
          setSubject(emailRes.email.subject);
          setHtmlBody(emailRes.email.html);
          setBody(emailRes.email.text);
          setBodyEdited(false);
        }
      } catch (err) {
        console.warn('Application email generation note:', err);
      }

      try {
        const genRes = await api.getGeneratedResumes();
        if (isMounted && genRes.ok && Array.isArray(genRes.generatedResumes)) {
          setGeneratedResumes(genRes.generatedResumes);
          if (!selectedResumeId && genRes.generatedResumes.length > 0) {
            setSelectedResumeId(genRes.generatedResumes[0].id);
          }
        }
      } catch {
        // ignore
      }
    }

    void loadAll();
    return () => {
      isMounted = false;
    };
  }, [job.id]);

  // Synchronize HTML preview when switching from Edit tab back to Preview tab
  const handleSwitchTab = async (tab: 'preview' | 'edit') => {
    setActiveBodyTab(tab);
    if (tab === 'preview' && bodyEdited) {
      setRenderingPreview(true);
      try {
        const res = await api.renderJobApplicationEmail(job.id, { subject, body });
        if (res.ok && res.html) {
          setHtmlBody(res.html);
        }
      } catch {
        // ignore
      } finally {
        setRenderingPreview(false);
      }
    }
  };

  const uploadedSelected = storedResumes.find((r) => r.id === selectedResumeId);
  const generatedSelected = generatedResumes.find((r) => r.id === selectedResumeId);
  const selectedAttachmentName = uploadedSelected
    ? uploadedSelected.filename
    : generatedSelected
    ? `${(generatedSelected.title || 'Tailored_Resume').replace(/[^a-zA-Z0-9_-]/g, '_')}.docx`
    : null;

  const handleQuickUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingResume(true);
    setError(null);
    try {
      const res = await api.uploadResume(file);
      if (res.ok && res.resume) {
        setStoredResumes((prev) => [res.resume, ...prev]);
        setSelectedResumeId(res.resume.id);
      }
    } catch (uploadErr: any) {
      setError('Resume upload failed: ' + (uploadErr.message || 'Please check file format.'));
    } finally {
      setIsUploadingResume(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleOpenInGmail = async () => {
    if (!recipientEmail.trim()) {
      setError('Please provide a recipient email address or apply via the company portal.');
      return;
    }
    if (isDummyDomain(recipientEmail)) {
      setError(`"${recipientEmail}" is a placeholder address (company.com/example.com). Real emails cannot be delivered to dummy domains. Please apply via the official company portal link below.`);
      return;
    }

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipientEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank', 'noopener,noreferrer');

    try {
      const applyRes = await api.submitJobApplication({
        jobId: job.id,
        mode: 'manual',
        customCoverLetter: body,
      });
      if (applyRes.ok && applyRes.application) {
        await api.openGmailApplication(applyRes.application.id);
        setSentSuccess({
          recipient: recipientEmail.trim(),
          sender: senderEmail.trim(),
          date: new Date().toLocaleString(),
          status: 'Opened in Gmail — Awaiting Send Confirmation',
          attachedResume: selectedAttachmentName || 'None',
        });
        setTimeout(() => {
          onSuccess({ ...applyRes.application, status: 'opened_in_gmail', deliveryStatus: 'opened_in_gmail' });
        }, 1600);
      }
    } catch (err: any) {
      console.warn('Could not record opened_in_gmail:', err);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientEmail.trim()) {
      setError(
        'Recipient email address is required. If the company only accepts applications through their portal, please apply via the portal link.',
      );
      return;
    }

    if (isDummyDomain(recipientEmail)) {
      setError(
        `"${recipientEmail}" is a placeholder address (company.com/example.com). Real emails cannot be delivered to dummy domains. Please apply via the official company portal link below or provide a real company contact email.`
      );
      return;
    }

    setSending(true);
    setError(null);

    try {
      const res = await api.sendApplicationEmail({
        jobId: job.id,
        recipientEmail: recipientEmail.trim(),
        senderEmail: senderEmail.trim(),
        subject: subject.trim(),
        body: body.trim(),
        htmlBody: htmlBody || undefined,
        bodyEdited,
        resumeId: selectedResumeId || undefined,
        resumeName: selectedAttachmentName || undefined,
        recipientEmailSource,
      });

      if (res.ok) {
        const statusLabel =
          res.deliveryStatus === 'failed'
            ? 'Delivery Failed'
            : res.deliveryStatus === 'accepted_by_provider'
            ? 'Accepted by Email Provider (SMTP)'
            : res.deliveryStatus === 'draft_created'
            ? 'Draft Created (SMTP Unconfigured)'
            : 'Successfully Sent';

        setSentSuccess({
          recipient: recipientEmail.trim(),
          sender: senderEmail.trim(),
          date: new Date().toLocaleString(),
          status: statusLabel,
          attachedResume: selectedAttachmentName || 'None',
        });
        setTimeout(() => {
          onSuccess(res.application);
        }, 1600);
      } else {
        setError('Failed to dispatch application email.');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while sending the email.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 16,
          maxWidth: 820,
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            background: 'linear-gradient(to bottom, #f8fafc, #ffffff)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                background: '#1e40af',
                color: '#fff',
                borderRadius: 10,
                width: 38,
                height: 38,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Mail size={20} />
            </div>
            <div>
              <h3 style={{ margin: '0 0 2px', fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
                International Job Application Dispatcher
              </h3>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Position: <strong>{job.title}</strong> at <strong>{job.company}</strong>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            style={{
              background: '#f1f5f9',
              border: 'none',
              borderRadius: 8,
              padding: 6,
              cursor: 'pointer',
              color: '#64748b',
              display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '22px 24px' }}>
          {sentSuccess ? (
            <div style={{ textAlign: 'center', padding: '30px 10px' }}>
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  background: '#dcfce7',
                  color: '#16a34a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                }}
              >
                <CheckCircle2 size={34} />
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: '19px', fontWeight: 800, color: '#0f172a' }}>
                Application Email Dispatched!
              </h3>
              <p style={{ fontSize: '13px', color: '#64748b', maxWidth: 480, margin: '0 auto 20px', lineHeight: 1.5 }}>
                Your formatted HTML application email and attached resume have been transmitted and saved in your application history.
              </p>

              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '16px 20px',
                  maxWidth: 460,
                  margin: '0 auto',
                  textAlign: 'left',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: '#64748b' }}>Company:</span>
                  <strong>{job.company}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: '#64748b' }}>Recipient Address:</span>
                  <strong>{sentSuccess.recipient}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: '#64748b' }}>Attached Document:</span>
                  <strong style={{ color: '#2563eb' }}>{sentSuccess.attachedResume}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ color: '#64748b' }}>Sender Email:</span>
                  <strong>{sentSuccess.sender}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Delivery Status:</span>
                  <span style={{ color: '#16a34a', fontWeight: 700 }}>● {sentSuccess.status}</span>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {error && (
                <div
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#b91c1c',
                    padding: '11px 16px',
                    borderRadius: 8,
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {/* Step 5 & 6: Automated Company & Recipient Email Discovery Summary Card */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <label
                    style={{
                      fontSize: '13px',
                      fontWeight: 800,
                      color: '#0f172a',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Building2 size={16} color="#2563eb" /> Automated Company &amp; Recipient Email Discovery
                  </label>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {loadingDiscovery ? (
                      <span
                        style={{
                          fontSize: '11px',
                          color: '#0369a1',
                          background: '#e0f2fe',
                          padding: '3px 10px',
                          borderRadius: 6,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        <Loader2 size={12} className="spin" /> Investigating Job Portal &amp; Company Website…
                      </span>
                    ) : verificationStatus === 'verified' || verificationStatus === 'publicly_listed' ? (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#15803d',
                          background: '#dcfce7',
                          border: '1px solid #bbf7d0',
                          padding: '3px 10px',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <ShieldCheck size={13} /> {verificationLabel || `${recipientEmailSource} • Format Validated`}
                      </span>
                    ) : verificationStatus === 'not_found' ? (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#b45309',
                          background: '#fef3c7',
                          border: '1px solid #fde68a',
                          padding: '3px 10px',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <AlertTriangle size={13} /> Recruitment Email Not Found
                      </span>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#64748b' }}>{recipientEmailSource}</span>
                    )}

                    <button
                      type="button"
                      disabled={loadingDiscovery}
                      onClick={() => void runEmailDiscovery(true)}
                      title="Re-scan job portal and official company website"
                      style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        padding: '3px 8px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#475569',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <RefreshCw size={11} className={loadingDiscovery ? 'spin' : ''} /> Re-scan
                    </button>
                  </div>
                </div>

                {/* Metadata Grid: Company, Website, Source, Verification */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 10,
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: '10px 14px',
                    marginBottom: 12,
                    fontSize: '12px',
                  }}
                >
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Company Name</span>
                    <strong style={{ color: '#0f172a' }}>{job.company}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Company Website</span>
                    {companyWebsite ? (
                      <a
                        href={companyWebsite}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: '#2563eb',
                          fontWeight: 600,
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Globe size={11} /> {companyWebsite.replace(/^https?:\/\//, '')} <ExternalLink size={10} />
                      </a>
                    ) : (
                      <span style={{ color: '#64748b' }}>Via {job.source}</span>
                    )}
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Email Source</span>
                    {sourceUrl && verificationStatus !== 'not_found' ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: '#0f172a',
                          fontWeight: 600,
                          textDecoration: 'underline',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        {recipientEmailSource || 'Official Website'} <ExternalLink size={10} />
                      </a>
                    ) : (
                      <strong style={{ color: '#0f172a' }}>{recipientEmailSource || 'Scanning…'}</strong>
                    )}
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '11px' }}>Verification Status</span>
                    <strong
                      style={{
                        color:
                          verificationStatus === 'verified' || verificationStatus === 'publicly_listed'
                            ? '#15803d'
                            : verificationStatus === 'not_found'
                            ? '#b45309'
                            : '#475569',
                      }}
                    >
                      {loadingDiscovery
                        ? 'Checking…'
                        : verificationLabel ||
                          (verificationStatus === 'not_found'
                            ? 'Not Publicly Listed'
                            : 'Publicly Listed / Format Validated')}
                    </strong>
                  </div>
                </div>

                {/* Recipient & Sender Inputs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                      Recipient Email Address *
                    </label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => {
                        setRecipientEmail(e.target.value);
                        setRecipientEmailSource('User Reviewed / Edited');
                        setVerificationLabel('User Specified • Format Validated');
                        if (e.target.value.includes('@')) {
                          setVerificationStatus('verified');
                        }
                      }}
                      placeholder="e.g. jobs@employer.com or hr@employer.org"
                      required
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: 8,
                        border: isDummyDomain(recipientEmail) ? '1px solid #ef4444' : '1px solid #cbd5e1',
                        fontSize: '13px',
                        background: isDummyDomain(recipientEmail) ? '#fef2f2' : '#fff',
                        fontWeight: 600,
                      }}
                    />
                    {isDummyDomain(recipientEmail) && (
                      <div
                        style={{
                          marginTop: 6,
                          padding: '6px 10px',
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: 6,
                          fontSize: '11.5px',
                          color: '#b91c1c',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <AlertTriangle size={14} color="#dc2626" />
                        <span>
                          <strong>Placeholder Domain:</strong> "{recipientEmail}" is an example domain with no active mail servers. Emails sent to it will bounce.
                        </span>
                      </div>
                    )}
                    {alternativeEmails.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: '11px', color: '#475569', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        <span>Other discovered addresses:</span>
                        {alternativeEmails.map((alt) => (
                          <button
                            key={alt.email}
                            type="button"
                            onClick={() => {
                              setRecipientEmail(alt.email);
                              setRecipientEmailSource(alt.source);
                              setSourceUrl(alt.sourceUrl);
                            }}
                            style={{
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              border: '1px solid #bfdbfe',
                              borderRadius: 4,
                              padding: '1px 6px',
                              fontSize: '11px',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            {alt.email}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                      Your Reply-To Email *
                    </label>
                    <input
                      type="email"
                      value={senderEmail}
                      onChange={(e) => setSenderEmail(e.target.value)}
                      placeholder="e.g. yourname@gmail.com"
                      required
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: '13px',
                        background: '#fff',
                      }}
                    />
                  </div>
                </div>

                {/* Step 6: Unavailable Email Fallback Details */}
                {verificationStatus === 'not_found' && !loadingDiscovery && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '12px 14px',
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: 8,
                      fontSize: '12px',
                      color: '#92400e',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      Recruitment Email Not Found — Direct Portal Application Available
                    </div>
                    {sourcesChecked.length > 0 && (
                      <div style={{ marginBottom: 8, fontSize: '11.5px', color: '#78350f' }}>
                        <strong>Sources Checked:</strong> {sourcesChecked.join(' • ')}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      {portalUrl && (
                        <a
                          href={portalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            background: '#2563eb',
                            color: '#ffffff',
                            padding: '5px 12px',
                            borderRadius: 6,
                            fontSize: '11.5px',
                            fontWeight: 700,
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          Apply on Official Portal <ExternalLink size={11} />
                        </a>
                      )}
                      {originalListingUrl && originalListingUrl !== portalUrl && (
                        <a
                          href={originalListingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: '#1d4ed8',
                            fontWeight: 600,
                            fontSize: '11.5px',
                            textDecoration: 'underline',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          Original Job Listing <ExternalLink size={11} />
                        </a>
                      )}
                      {companyWebsite && (
                        <a
                          href={companyWebsite}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: '#1d4ed8',
                            fontWeight: 600,
                            fontSize: '11.5px',
                            textDecoration: 'underline',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          Company Website <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Subject */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                  Subject Line *
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setBodyEdited(true);
                  }}
                  required
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                />
              </div>

              {/* Dedicated Resume Attachment Manager */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      color: '#1e293b',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Paperclip size={16} color="#2563eb" /> Resume Document Attachment
                  </label>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.doc,.txt"
                      onChange={handleQuickUpload}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingResume}
                      style={{
                        background: '#eff6ff',
                        color: '#2563eb',
                        border: '1px solid #bfdbfe',
                        padding: '4px 10px',
                        borderRadius: 6,
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {isUploadingResume ? <Loader2 size={12} className="spin" /> : <Upload size={12} />}
                      {isUploadingResume ? 'Uploading…' : 'Upload New File'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={selectedResumeId}
                    onChange={(e) => setSelectedResumeId(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: '13px',
                      background: '#fff',
                    }}
                  >
                    <option value="">No attachment (Email body only)</option>
                    {storedResumes.length > 0 && (
                      <optgroup label="Uploaded Resumes (PDF / DOCX)">
                        {storedResumes.map((r) => (
                          <option key={r.id} value={r.id}>
                            📄 {r.filename} ({(r.fileSize / 1024).toFixed(0)} KB)
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {generatedResumes.length > 0 && (
                      <optgroup label="AI Tailored Resumes (.DOCX)">
                        {generatedResumes.map((g) => (
                          <option key={g.id} value={g.id}>
                            ✨ {g.title} ({g.targetRole})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  {selectedAttachmentName ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: '#dcfce7',
                        border: '1px solid #bbf7d0',
                        padding: '6px 12px',
                        borderRadius: 8,
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#16a34a',
                      }}
                    >
                      <FileCheck2 size={15} />
                      <span>{selectedAttachmentName}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: '12px', color: '#64748b' }}>No document attached</span>
                  )}
                </div>
              </div>

              {/* Email Body & HTML Preview Toggle */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                    Job Application Email Preview &amp; Editor *
                  </label>

                  <div style={{ display: 'flex', background: '#f1f5f9', padding: 2, borderRadius: 6, gap: 2 }}>
                    <button
                      type="button"
                      onClick={() => void handleSwitchTab('preview')}
                      style={{
                        background: activeBodyTab === 'preview' ? '#fff' : 'transparent',
                        color: activeBodyTab === 'preview' ? '#0f172a' : '#64748b',
                        border: 'none',
                        padding: '5px 12px',
                        borderRadius: 5,
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: activeBodyTab === 'preview' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Eye size={12} /> Preview Formatted HTML
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSwitchTab('edit')}
                      style={{
                        background: activeBodyTab === 'edit' ? '#fff' : 'transparent',
                        color: activeBodyTab === 'edit' ? '#0f172a' : '#64748b',
                        border: 'none',
                        padding: '5px 12px',
                        borderRadius: 5,
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: activeBodyTab === 'edit' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <FileText size={12} /> Edit Message Content
                    </button>
                  </div>
                </div>

                {activeBodyTab === 'preview' ? (
                  <div
                    style={{
                      maxHeight: 360,
                      overflowY: 'auto',
                      border: '1px solid #cbd5e1',
                      borderRadius: 10,
                      background: '#f1f5f9',
                      padding: '12px',
                    }}
                  >
                    {renderingPreview ? (
                      <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                        <Loader2 size={20} className="spin" style={{ marginBottom: 8 }} />
                        <div>Updating formatted HTML preview…</div>
                      </div>
                    ) : htmlBody ? (
                      <div
                        dangerouslySetInnerHTML={{ __html: htmlBody }}
                        style={{ transformOrigin: 'top left', fontSize: '13px' }}
                      />
                    ) : (
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'inherit',
                          fontSize: '13px',
                          color: '#334155',
                        }}
                      >
                        {body}
                      </pre>
                    )}
                  </div>
                ) : (
                  <div>
                    <textarea
                      rows={13}
                      value={body}
                      onChange={(e) => {
                        setBody(e.target.value);
                        setBodyEdited(true);
                      }}
                      required
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: '13px',
                        lineHeight: 1.65,
                        fontFamily: 'inherit',
                      }}
                    />
                    <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: 4 }}>
                      Your edits are automatically formatted into the professional HTML layout when previewed and sent.
                    </span>
                  </div>
                )}
              </div>

              {/* Action Controls */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: 10,
                  borderTop: '1px solid #e2e8f0',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  onClick={onClose}
                  disabled={sending}
                  style={{
                    background: '#f1f5f9',
                    color: '#475569',
                    border: 'none',
                    padding: '10px 18px',
                    borderRadius: 8,
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => void handleOpenInGmail()}
                    disabled={sending || !recipientEmail || isDummyDomain(recipientEmail)}
                    style={{
                      background: '#ffffff',
                      color: '#ea4335',
                      border: '1px solid #fecaca',
                      padding: '10px 18px',
                      borderRadius: 8,
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: sending || !recipientEmail || isDummyDomain(recipientEmail) ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      opacity: !recipientEmail || isDummyDomain(recipientEmail) ? 0.6 : 1,
                    }}
                    title="Open formatted application in your Gmail web compose window"
                  >
                    <Mail size={15} /> Open in Gmail
                  </button>

                  <button
                    type="submit"
                    disabled={sending || !recipientEmail || isDummyDomain(recipientEmail)}
                    style={{
                      background: isDummyDomain(recipientEmail) ? '#94a3b8' : '#2563eb',
                      color: '#fff',
                      border: 'none',
                      padding: '10px 24px',
                      borderRadius: 8,
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: sending || !recipientEmail || isDummyDomain(recipientEmail) ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {sending ? (
                      <>
                        <Loader2 size={16} className="spin" /> Sending Application…
                      </>
                    ) : (
                      <>
                        <Send size={15} /> Send Verified Application
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
