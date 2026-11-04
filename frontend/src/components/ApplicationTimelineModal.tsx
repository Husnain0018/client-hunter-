import React from 'react';
import {
  X,
  Clock,
  Send,
  Mail,
  CheckCircle2,
  Calendar,
  Building2,
  AlertCircle,
  MessageCircle,
  FileText
} from 'lucide-react';
import type { JobApplication } from '../types';

interface ApplicationTimelineModalProps {
  application: JobApplication;
  onClose: () => void;
}

export const ApplicationTimelineModal: React.FC<ApplicationTimelineModalProps> = ({
  application,
  onClose,
}) => {
  const timeline = application.activityTimeline || [];
  const responses = application.employerResponses || [];

  return (
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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 16,
          maxWidth: 640,
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #e2e8f0',
            background: 'linear-gradient(to bottom, #f8fafc, #ffffff)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h3 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              Application Activity Timeline
            </h3>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {application.job?.company} — {application.job?.title}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: '#64748b', display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px' }}>
          {/* Email Info Strip if sent via email */}
          {application.recipientEmail && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', marginBottom: 20, fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#64748b' }}>Recipient:</span>
                <strong style={{ color: '#0f172a' }}>{application.recipientEmail}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#64748b' }}>Sender:</span>
                <strong style={{ color: '#0f172a' }}>{application.senderEmail || 'Authorized Account'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#64748b' }}>Delivery Status:</span>
                <strong
                  style={{
                    color:
                      application.status === 'failed' || application.status === 'bounced' || application.status === 'rejected'
                        ? '#dc2626'
                        : application.status === 'opened_in_gmail' || application.status === 'awaiting_confirmation' || application.status === 'draft_created'
                        ? '#d97706'
                        : application.status === 'accepted_by_provider'
                        ? '#2563eb'
                        : '#16a34a',
                  }}
                >
                  ● {application.deliveryStatus || application.status.replace(/_/g, ' ').toUpperCase()}
                </strong>
              </div>

              {application.failureReason && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#b91c1c', fontSize: '11.5px' }}>
                  <strong>Failure / Bounce Details:</strong> {application.failureReason}
                  {application.recommendedAction && (
                    <div style={{ marginTop: 4, color: '#991b1b' }}>
                      <strong>Recommended Action:</strong> {application.recommendedAction}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Timeline List */}
          <div style={{ position: 'relative', paddingLeft: 24 }}>
            {/* Timeline vertical bar */}
            <div
              style={{
                position: 'absolute',
                top: 8,
                bottom: 8,
                left: 7,
                width: 2,
                background: '#e2e8f0',
              }}
            />

            {timeline.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic', padding: '12px 0' }}>
                No activity events recorded yet.
              </div>
            ) : (
              timeline.map((act, idx) => (
                <div key={act.id || idx} style={{ position: 'relative', marginBottom: 20 }}>
                  {/* Timeline dot */}
                  <div
                    style={{
                      position: 'absolute',
                      left: -24,
                      top: 2,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: idx === timeline.length - 1 ? '#2563eb' : '#94a3b8',
                      border: '3px solid #fff',
                      boxShadow: '0 0 0 1px #cbd5e1',
                    }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
                      {act.activity}
                    </span>
                    <span style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={11} /> {act.date} {act.time}
                    </span>
                  </div>

                  {act.details && (
                    <div style={{ fontSize: '12px', color: '#64748b', background: '#f8fafc', padding: '6px 10px', borderRadius: 6, marginTop: 4 }}>
                      {act.details}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Received Employer Responses */}
          {responses.length > 0 && (
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mail size={15} color="#4f46e5" /> Received Employer Messages ({responses.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {responses.map((resp) => (
                  <div key={resp.id} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <strong style={{ color: '#1e3a8a' }}>{resp.subject}</strong>
                      <span style={{ color: '#64748b', fontSize: '11px' }}>{new Date(resp.receivedAt).toLocaleString()}</span>
                    </div>
                    <div style={{ color: '#475569', marginBottom: 6 }}>From: {resp.fromEmail}</div>
                    <div style={{ color: '#1e293b', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{resp.body}</div>
                    {resp.userReply && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #bfdbfe', fontSize: '11px', color: '#0369a1' }}>
                        <strong>Your Reply:</strong> {resp.userReply}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
