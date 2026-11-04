import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Award,
  Bell,
  Bot,
  Briefcase,
  Building2,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  FileText,
  Flame,
  Globe,
  Layers,
  Lightbulb,
  Loader2,
  MapPin,
  MessageCircle,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Phone,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Star,
  Target,
  Trophy,
  User,
  Wrench,
  X,
  XCircle,
  Zap
} from 'lucide-react';
import { api } from '../api/client';
import type { ClientConversation, ClientHandlerStats, ClientStage, ConversationMessage } from '../types';

interface ClientHandlerPageProps {
  onBackToProspecting?: () => void;
  userPhoneDefault?: string;
}

const STAGE_LABELS: Record<ClientStage, { label: string; color: string; bg: string }> = {
  new: { label: 'New Lead', color: '#4f46e5', bg: 'rgba(99, 102, 241, 0.12)' },
  contacted: { label: 'Contacted', color: '#0284c7', bg: 'rgba(14, 165, 233, 0.12)' },
  awaiting_reply: { label: 'Awaiting Reply', color: '#7c3aed', bg: 'rgba(139, 92, 246, 0.12)' },
  conversing: { label: 'Active Chat', color: '#059669', bg: 'rgba(16, 185, 129, 0.12)' },
  follow_up_scheduled: { label: 'Follow-Up Due', color: '#d97706', bg: 'rgba(245, 158, 11, 0.14)' },
  interested: { label: 'Interested', color: '#059669', bg: 'rgba(16, 185, 129, 0.16)' },
  proposal_pending: { label: 'Proposal Sent', color: '#d97706', bg: 'rgba(245, 158, 11, 0.14)' },
  negotiating: { label: 'Negotiating', color: '#ea580c', bg: 'rgba(234, 88, 12, 0.14)' },
  closed_won: { label: 'Deal Closed 🎉', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.15)' },
  lost: { label: 'Lost', color: '#64748b', bg: 'rgba(100, 116, 139, 0.14)' },
  opted_out: { label: 'Opted Out', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.14)' },
  needs_human: { label: 'Needs Human ⚠️', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.14)' },
};

function getInitials(name: string): string {
  if (!name) return 'CL';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function formatShortTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDateDivider(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export const ClientHandlerPage: React.FC<ClientHandlerPageProps> = ({
  onBackToProspecting,
  userPhoneDefault = '',
}) => {
  const [clients, setClients] = useState<ClientConversation[]>([]);
  const [stats, setStats] = useState<ClientHandlerStats | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<ClientConversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [aiDraft, setAiDraft] = useState<any | null>(null);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'research' | 'plan' | 'close'>('chat');
  const [errorNotice, setErrorNotice] = useState<string>('');
  const [successNotice, setSuccessNotice] = useState<string>('');
  const [copiedPlan, setCopiedPlan] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Independent Sidebar Collapse & Expand State (Desktop)
  const [isLeftCollapsed, setIsLeftCollapsed] = useState<boolean>(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);

  // Responsive mobile column switcher ('list' | 'chat' | 'details')
  const [mobileColumn, setMobileColumn] = useState<'list' | 'chat' | 'details'>('chat');

  // Collapsible sections in the right-hand Client Details Panel (all open by default so no info is hidden)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    dealStatus: true,
    businessInfo: true,
    locationInfo: true,
    webSocial: true,
    conversationSummary: true,
    problemsFindings: true,
    recommendedSolutions: true,
  });

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Owner Notification Settings State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ownerNotifPhone, setOwnerNotifPhone] = useState('');
  const [dealNotifsEnabled, setDealNotifsEnabled] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);
  const [modalFeedback, setModalFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);

  // Deal Closer Form State
  const [closingPrice, setClosingPrice] = useState('');
  const [closingTimeline, setClosingTimeline] = useState('1-2 weeks');
  const [closingDeliverables, setClosingDeliverables] = useState('');
  const [closingServices, setClosingServices] = useState<string[]>([]);
  const [closingNotes, setClosingNotes] = useState('');
  const [notifyUserPhone, setNotifyUserPhone] = useState(userPhoneDefault);
  const [notifyUserToggle, setNotifyUserToggle] = useState(Boolean(userPhoneDefault));
  const [closingBusy, setClosingBusy] = useState(false);

  // Unmatched contact linking state & chat scroll refs
  const [linkTargetLeadId, setLinkTargetLeadId] = useState('');
  const [linkingBusy, setLinkingBusy] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const selectedLeadIdRef = useRef<string | null>(null);
  const prevScrolledLeadRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef<number>(0);
  selectedLeadIdRef.current = selectedLeadId;

  const copyFieldValue = (val: string, label: string) => {
    void navigator.clipboard?.writeText(val);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const validatePhoneInput = (phone: string): { valid: boolean; digits: string; error?: string } => {
    const digits = phone.replace(/\D/g, '');
    if (!digits) {
      return { valid: false, digits: '', error: 'Please enter a WhatsApp phone number with country code.' };
    }
    if (digits.length < 8 || digits.length > 15) {
      return {
        valid: false,
        digits,
        error: `Invalid number length (${digits.length} digits). Standard international phone numbers require 8-15 digits with country code (e.g. +923001234567).`
      };
    }
    return { valid: true, digits };
  };

  const loadNotificationSettings = async () => {
    try {
      const res = await api.getClientHandlerSettings();
      if (res.ok) {
        if (res.settings.dealNotificationPhone) {
          setOwnerNotifPhone(res.settings.dealNotificationPhone);
          if (!userPhoneDefault) {
            setNotifyUserPhone(res.settings.dealNotificationPhone);
            setNotifyUserToggle(true);
          }
        }
        if (res.settings.dealNotificationsEnabled !== undefined) {
          setDealNotifsEnabled(res.settings.dealNotificationsEnabled);
        }
        if (res.whatsappReady !== undefined) {
          setWaConnected(res.whatsappReady);
        }
      }
    } catch {
      // ignore
    }
  };

  // Fetch settings on mount
  useEffect(() => {
    loadNotificationSettings();
  }, []);

  const handleOpenSettingsModal = async () => {
    setModalFeedback(null);
    setSettingsOpen(true);
    await loadNotificationSettings();
    api.getWhatsAppStatus().then((r) => {
      if (r.ok) setWaConnected(r.status.isReady);
    }).catch(() => {});
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setModalFeedback(null);
    setErrorNotice('');

    const trimmed = ownerNotifPhone.trim();
    if (trimmed) {
      const val = validatePhoneInput(trimmed);
      if (!val.valid) {
        setSavingSettings(false);
        setModalFeedback({ type: 'error', message: val.error! });
        return;
      }
    }

    try {
      const res = await api.saveClientHandlerSettings(trimmed, dealNotifsEnabled);
      if (res.ok) {
        const savedPhone = res.settings.dealNotificationPhone;
        setModalFeedback({
          type: 'success',
          message: res.message || 'Notification preferences saved successfully in database!'
        });
        setSuccessNotice('✅ Owner WhatsApp notification preferences saved!');
        if (savedPhone) {
          setOwnerNotifPhone(savedPhone);
          setNotifyUserPhone(savedPhone);
        }
        setNotifyUserToggle(dealNotifsEnabled);
      } else {
        const errMsg = (res as any).error || 'Failed to save settings.';
        setModalFeedback({ type: 'error', message: errMsg });
      }
    } catch (err: any) {
      setModalFeedback({
        type: 'error',
        message: err?.message || 'Failed to save settings.'
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestNotification = async () => {
    setTestingNotif(true);
    setModalFeedback(null);
    setErrorNotice('');

    const trimmed = ownerNotifPhone.trim();
    const val = validatePhoneInput(trimmed);
    if (!val.valid) {
      setTestingNotif(false);
      setModalFeedback({ type: 'error', message: val.error! });
      return;
    }

    try {
      const res = await api.testClientHandlerNotification(trimmed);
      if (res.ok) {
        const target = res.sent?.phone || trimmed;
        const msg = res.message || `Test WhatsApp message sent successfully to ${target}!`;
        setModalFeedback({ type: 'success', message: `✅ ${msg}` });
        setSuccessNotice(`🧪 ${msg}`);
      } else {
        const errorText = res.error || 'Failed to dispatch test notification.';
        setModalFeedback({ type: 'error', message: `⚠️ ${errorText}` });
      }
    } catch (err: any) {
      const errorText = err?.message || 'Failed to dispatch test notification.';
      setModalFeedback({ type: 'error', message: `⚠️ ${errorText}` });
    } finally {
      setTestingNotif(false);
    }
  };

  // Load clients list
  const loadClients = async (silent = false) => {
    if (!silent) setLoadingList(true);
    setErrorNotice('');
    try {
      const res = await api.listClients(stageFilter, searchQuery);
      setClients(res.clients);
      setStats(res.stats);
      if (!selectedLeadId && res.clients.length > 0) {
        setSelectedLeadId(res.clients[0].leadId);
      }
    } catch (err: any) {
      setErrorNotice(err?.message || 'Failed to load client conversations.');
    } finally {
      if (!silent) setLoadingList(false);
    }
  };

  useEffect(() => {
    void loadClients();
  }, [stageFilter]);

  // Client-side instant filtering for smooth search UX (while preserving Enter key server search)
  const displayedClients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      return (
        c.businessName?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.lead?.category?.toLowerCase().includes(q) ||
        c.lead?.address?.toLowerCase().includes(q) ||
        c.summary?.toLowerCase().includes(q)
      );
    });
  }, [clients, searchQuery]);

  // Load single client conversation
  useEffect(() => {
    if (!selectedLeadId) return;
    let isMounted = true;
    setLoadingChat(true);
    setAiDraft(null);
    setErrorNotice('');

    api.getClient(selectedLeadId)
      .then((res) => {
        if (!isMounted) return;
        setSelectedClient(res.client);
        setMessages(res.client.messages || []);
        // Seed closer state from lead defaults
        if (res.client.lead) {
          setClosingServices(res.client.agreedServices?.length ? res.client.agreedServices : res.client.lead.recommendedServices);
          setClosingPrice(res.client.agreedPrice || res.client.lead.estimatedDealValue || '$500');
          setClosingDeliverables(res.client.agreedDeliverables || `Full setup and deployment of ${res.client.lead.recommendedServices.slice(0, 2).join(' & ')}`);
          setClosingTimeline(res.client.agreedTimeline || '1-2 weeks');
          setClosingNotes(res.client.dealNotes || '');
        }
      })
      .catch((err: any) => {
        if (isMounted) setErrorNotice(err?.message || 'Failed to load chat history.');
      })
      .finally(() => {
        if (isMounted) setLoadingChat(false);
      });

    return () => { isMounted = false; };
  }, [selectedLeadId]);

  // Smart auto-scroll: only scroll to bottom when switching clients or when new messages arrive
  // (Never force-jump to the bottom when the user is reading older messages during background sync)
  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;

    const leadChanged = prevScrolledLeadRef.current !== selectedLeadId;
    const msgAdded = messages.length > prevMsgCountRef.current;

    if (leadChanged || msgAdded) {
      container.scrollTop = container.scrollHeight;
    }

    prevScrolledLeadRef.current = selectedLeadId;
    prevMsgCountRef.current = messages.length;
  }, [messages.length, selectedLeadId, loadingChat]);

  // Real-time SSE listener for incoming/outgoing WhatsApp messages & delivery receipts
  useEffect(() => {
    const unsubscribe = api.subscribeToClientEvents((evt) => {
      if (!evt || typeof evt !== 'object') return;
      if (evt.stats) {
        setStats(evt.stats);
      }

      if (evt.type === 'message_received' || evt.type === 'message_sent' || evt.type === 'conversation_updated') {
        const updatedClient = evt.client as ClientConversation | undefined;
        if (updatedClient) {
          setClients((prev) => {
            const exists = prev.some((c) => c.leadId === updatedClient.leadId);
            const next = exists
              ? prev.map((c) => (c.leadId === updatedClient.leadId ? { ...c, ...updatedClient } : c))
              : [updatedClient, ...prev];
            return [...next].sort((a, b) =>
              (b.lastMessageAt || b.updatedAt || '').localeCompare(a.lastMessageAt || a.updatedAt || '')
            );
          });

          if (selectedLeadIdRef.current === updatedClient.leadId) {
            setSelectedClient(updatedClient);
            if (updatedClient.messages) {
              setMessages(updatedClient.messages);
            } else if (evt.message) {
              const incomingMsg = evt.message as ConversationMessage;
              setMessages((prev) => {
                const already = prev.some(
                  (m) =>
                    m.id === incomingMsg.id ||
                    (m.providerMessageId && m.providerMessageId === incomingMsg.providerMessageId)
                );
                return already ? prev : [...prev, incomingMsg];
              });
            }
          }
        }
        void loadClients(true);
      } else if (evt.type === 'message_status' && evt.providerMessageId && evt.status) {
        setMessages((prev) =>
          prev.map((m) => (m.providerMessageId === evt.providerMessageId ? { ...m, status: evt.status } : m))
        );
        setSelectedClient((prev) => {
          if (!prev || (evt.leadId && prev.leadId !== evt.leadId)) return prev;
          return {
            ...prev,
            messages: prev.messages?.map((m) =>
              m.providerMessageId === evt.providerMessageId ? { ...m, status: evt.status } : m
            ),
          };
        });
      }
    });
    return () => unsubscribe();
  }, [stageFilter]);

  // Periodic fallback sync every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      void loadClients(true);
      if (selectedLeadId) {
        api.getClient(selectedLeadId).then((res) => {
          setSelectedClient(res.client);
          setMessages(res.client.messages || []);
        }).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [selectedLeadId]);

  // Link an unmatched inbound WhatsApp contact to an existing lead
  const handleLinkUnmatchedLead = async () => {
    if (!selectedLeadId || !linkTargetLeadId || linkingBusy) return;
    setLinkingBusy(true);
    setErrorNotice('');
    try {
      const res = await api.linkUnmatchedClientToLead(selectedLeadId, linkTargetLeadId);
      if (res.ok && res.client) {
        setStats(res.stats);
        setSelectedLeadId(res.client.leadId);
        setSelectedClient(res.client);
        setMessages(res.client.messages || []);
        setLinkTargetLeadId('');
        setSuccessNotice(`✅ Linked incoming WhatsApp messages to ${res.client.businessName}!`);
        void loadClients(true);
      }
    } catch (err: any) {
      setErrorNotice(err?.message || 'Failed to link contact to lead.');
    } finally {
      setLinkingBusy(false);
    }
  };

  // Send message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedLeadId || !inputMessage.trim() || sendingMsg) return;
    setSendingMsg(true);
    setErrorNotice('');
    try {
      const res = await api.sendClientMessage(selectedLeadId, inputMessage.trim());
      setMessages((prev) => {
        const already = prev.some(
          (m) =>
            m.id === res.message.id ||
            (m.providerMessageId && m.providerMessageId === res.message.providerMessageId)
        );
        return already ? prev : [...prev, res.message];
      });
      setSelectedClient(res.client);
      setInputMessage('');
      setAiDraft(null);
      void loadClients(true);
    } catch (err: any) {
      setErrorNotice(err?.message || 'Failed to send WhatsApp message.');
    } finally {
      setSendingMsg(false);
    }
  };

  // Generate First Outreach
  const handlePrepareFirstMessage = async () => {
    if (!selectedLeadId) return;
    setGeneratingAi(true);
    setErrorNotice('');
    try {
      const res = await api.sendFirstMessage(selectedLeadId, false);
      setInputMessage(res.messageText);
      setSuccessNotice('First personalized outreach message prepared from lead research! Review and send.');
    } catch (err: any) {
      setErrorNotice(err?.message || 'Failed to prepare first message.');
    } finally {
      setGeneratingAi(false);
    }
  };

  // Generate AI Response Draft
  const handleGenerateAiReply = async (guidance?: string) => {
    if (!selectedLeadId || generatingAi) return;
    setGeneratingAi(true);
    setErrorNotice('');
    try {
      const res = await api.generateClientReply(selectedLeadId, guidance);
      setAiDraft(res.draft);
      if (res.draft.replyText) {
        setInputMessage(res.draft.replyText);
      }
    } catch (err: any) {
      setErrorNotice(err?.message || 'Failed to generate AI response.');
    } finally {
      setGeneratingAi(false);
    }
  };

  // Toggle Auto-Pilot
  const handleToggleAutopilot = async () => {
    if (!selectedLeadId || !selectedClient) return;
    const nextVal = !selectedClient.autoPilot;
    try {
      const res = await api.toggleAutopilot(selectedLeadId, nextVal);
      setSelectedClient(res.client);
      void loadClients(true);
    } catch (err: any) {
      setErrorNotice(err?.message || 'Failed to toggle autopilot.');
    }
  };

  // Update Stage Manually
  const handleStageChange = async (newStage: ClientStage) => {
    if (!selectedLeadId) return;
    try {
      const res = await api.updateClientStage(selectedLeadId, newStage);
      setSelectedClient(res.client);
      void loadClients(true);
    } catch (err: any) {
      setErrorNotice(err?.message || 'Failed to change stage.');
    }
  };

  // Close Deal Action
  const handleCloseDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLeadId) return;
    setClosingBusy(true);
    setErrorNotice('');
    try {
      const res = await api.closeDeal(selectedLeadId, {
        leadId: selectedLeadId,
        agreedServices: closingServices,
        agreedPrice: closingPrice,
        agreedTimeline: closingTimeline,
        agreedDeliverables: closingDeliverables,
        dealNotes: closingNotes,
        notifyUserWhatsApp: notifyUserToggle,
        userPhoneNumber: notifyUserPhone,
      });
      setSelectedClient(res.client);
      setSuccessNotice('🎉 Deal closed successfully! Deliverables and terms logged.');
      void loadClients(true);
      setActiveTab('chat');
    } catch (err: any) {
      setErrorNotice(err?.message || 'Failed to close deal.');
    } finally {
      setClosingBusy(false);
    }
  };

  return (
    <div className="ch-page">
      {/* Upper Header & Statistics Section — Matching AI Job Finder & Prospecting */}
      <section className="ch-hero">
        <div className="ch-hero-inner">
          <div className="ch-hero-top">
            <div>
              <div className="ch-hero-eyebrow">
                <Sparkles size={12} />
                Autonomous WhatsApp &amp; Deal Studio
              </div>
              <h1 className="ch-hero-title">AI Client Handler Studio</h1>
              <p className="ch-hero-subtitle">
                Autonomous WhatsApp conversations, lead-researched outreach, objection handling &amp; deal closing.
              </p>
            </div>

            <div className="ch-hero-actions">
              {onBackToProspecting && (
                <button
                  type="button"
                  onClick={onBackToProspecting}
                  className="ch-hero-btn"
                >
                  ← Back to Prospecting
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleOpenSettingsModal()}
                className="ch-hero-btn"
              >
                <Settings size={14} />
                Notification Settings
              </button>
              <button
                type="button"
                onClick={() => void loadClients()}
                className="ch-hero-btn primary"
              >
                <RefreshCw size={14} className={loadingList ? 'spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          {/* Pipeline Metrics Counters */}
          {stats && (
            <>
              <div className="ch-stats-grid">
                {[
                  { label: 'Total Prospects', value: stats.totalClients, icon: Building2, color: '#38bdf8' },
                  { label: 'New / Ready', value: stats.newLeads, icon: Flame, color: '#818cf8' },
                  { label: 'Awaiting Reply', value: stats.awaitingReply, icon: Clock, color: '#c084fc' },
                  { label: 'Active Chats', value: stats.activeConversations, icon: MessageCircle, color: '#34d399' },
                  { label: 'In Negotiation', value: stats.negotiating, icon: DollarSign, color: '#fbbf24' },
                  { label: 'Deals Closed', value: stats.closedWon, icon: Trophy, color: '#4ade80', highlight: true },
                  { label: 'Needs Attention', value: stats.needsHuman, icon: ShieldAlert, color: '#f87171', alert: stats.needsHuman > 0 },
                ].map((m, idx) => {
                  const Icon = m.icon;
                  return (
                    <div
                      key={idx}
                      className={`ch-stat-card ${m.highlight ? 'highlight' : ''} ${m.alert ? 'alert' : ''}`}
                    >
                      <div className="ch-stat-icon" style={{ color: m.color }}>
                        <Icon size={17} />
                      </div>
                      <div className="ch-stat-meta">
                        <strong style={{ color: m.alert ? '#fca5a5' : m.highlight ? '#86efac' : '#ffffff' }}>
                          {m.value}
                        </strong>
                        <span>{m.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Operational Autonomous Handling Metrics Bar */}
              <div className="ch-engine-bar">
                <span className="ch-engine-badge">
                  <Zap size={14} color="#fbbf24" /> Autonomous Engine:
                </span>
                <span><strong>{stats.totalIncomingMessages ?? 0}</strong> Incoming Messages</span>
                <span className="ch-engine-dot">•</span>
                <span><strong>{stats.totalOutgoingMessages ?? 0}</strong> Outgoing Sent</span>
                <span className="ch-engine-dot">•</span>
                <span><strong>{stats.aiHandledCount ?? 0}</strong> Auto-Handled</span>
                <span className="ch-engine-dot">•</span>
                <span><strong>{stats.requirementsIdentifiedCount ?? 0}</strong> Requirements Discovered</span>
                <span className="ch-engine-dot">•</span>
                <span><strong>{stats.projectSummariesCount ?? 0}</strong> Project Plans Built</span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Owner WhatsApp Notification Settings Modal */}
      {settingsOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--modal-backdrop)',
            zIndex: 9999,
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              background: 'var(--surface)',
              color: 'var(--ink)',
              borderRadius: 16,
              maxWidth: 500,
              width: '100%',
              padding: 24,
              border: '1px solid var(--line)',
              boxShadow: 'var(--shadow)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bell size={20} color="var(--primary)" />
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--ink)' }}>
                  Deal Notification Settings
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
              >
                <XCircle size={18} />
              </button>
            </div>

            {/* WhatsApp Live Status Indicator */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: waConnected ? 'var(--emerald-soft)' : 'var(--amber-soft)',
                border: `1px solid ${waConnected ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)'}`,
                color: waConnected ? 'var(--emerald)' : 'var(--amber)',
                padding: '9px 12px',
                borderRadius: 10,
                fontSize: '12px',
                fontWeight: 700,
                marginBottom: 14,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: waConnected ? '#10b981' : '#f59e0b',
                  }}
                />
                WhatsApp Status: {waConnected ? 'Connected & Ready' : 'Disconnected (Scan QR on WhatsApp tab)'}
              </span>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 14px' }}>
              Whenever an autonomous deal is finalized or won through WhatsApp, the AI will automatically dispatch a comprehensive executive deal summary report to this number.
            </p>

            {/* Master Notification Toggle */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                padding: '10px 14px',
                marginBottom: 14,
              }}
            >
              <div>
                <strong style={{ fontSize: '13px', color: 'var(--ink)', display: 'block' }}>
                  Deal Won Notifications
                </strong>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  Send notification summary when deal closes
                </span>
              </div>
              <input
                type="checkbox"
                checked={dealNotifsEnabled}
                onChange={(e) => setDealNotifsEnabled(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
            </div>

            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink-2)', display: 'block', marginBottom: 6 }}>
              Owner WhatsApp Phone Number (with Country Code)
            </label>
            <input
              type="text"
              value={ownerNotifPhone}
              onChange={(e) => {
                setOwnerNotifPhone(e.target.value);
                if (modalFeedback) setModalFeedback(null);
              }}
              placeholder="+923001234567 or 923001234567"
              style={{
                width: '100%',
                fontSize: '14px',
                padding: '10px 12px',
                marginBottom: 6,
                borderRadius: 10,
                border: '1px solid var(--line)',
              }}
            />
            <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: 16 }}>
              Include full country code without local trunk prefixes (e.g., +923001234567, +15552345678, +447911123456).
            </span>

            {/* In-Modal Feedback Alert */}
            {modalFeedback && (
              <div
                style={{
                  background:
                    modalFeedback.type === 'success'
                      ? 'var(--emerald-soft)'
                      : modalFeedback.type === 'error'
                      ? 'var(--danger-soft)'
                      : 'var(--soft)',
                  border: `1px solid ${
                    modalFeedback.type === 'success'
                      ? 'rgba(16,185,129,0.35)'
                      : modalFeedback.type === 'error'
                      ? 'rgba(239,68,68,0.35)'
                      : 'rgba(99,102,241,0.35)'
                  }`,
                  color:
                    modalFeedback.type === 'success'
                      ? 'var(--emerald)'
                      : modalFeedback.type === 'error'
                      ? 'var(--danger)'
                      : 'var(--primary)',
                  padding: '10px 14px',
                  borderRadius: 10,
                  fontSize: '12px',
                  lineHeight: 1.45,
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                {modalFeedback.type === 'success' ? (
                  <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                ) : (
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                )}
                <span style={{ flex: 1 }}>{modalFeedback.message}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void handleTestNotification()}
                disabled={testingNotif || !ownerNotifPhone.trim()}
                className="service-chip"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '12px', padding: '8px 12px' }}
              >
                {testingNotif ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                Send Test WhatsApp
              </button>
              <button
                type="button"
                onClick={() => void handleSaveSettings()}
                disabled={savingSettings}
                style={{
                  background: 'var(--primary)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '12px',
                  padding: '8px 16px',
                  borderRadius: 10,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {savingSettings ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lower Workspace: Three-Column Client Management */}
      <div className="ch-workspace">
        {errorNotice && (
          <div className="ch-notice error">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{errorNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorNotice('')}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {successNotice && (
          <div className="ch-notice success">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
              <span>{successNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessNotice('')}
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Responsive Mobile View Switcher (visible on smaller screens <= 1050px) */}
        <div className="ch-mobile-switcher" role="tablist" aria-label="Workspace columns">
          <button
            type="button"
            className={`ch-mobile-tab ${mobileColumn === 'list' ? 'active' : ''}`}
            onClick={() => setMobileColumn('list')}
          >
            <Building2 size={14} />
            Clients &amp; Leads ({displayedClients.length})
          </button>
          <button
            type="button"
            className={`ch-mobile-tab ${mobileColumn === 'chat' ? 'active' : ''}`}
            onClick={() => setMobileColumn('chat')}
          >
            <MessageCircle size={14} />
            Communications
          </button>
          <button
            type="button"
            className={`ch-mobile-tab ${mobileColumn === 'details' ? 'active' : ''}`}
            onClick={() => setMobileColumn('details')}
          >
            <FileText size={14} />
            Intelligence &amp; Details
          </button>
        </div>

        <div
          className={`ch-three-col-grid ${isLeftCollapsed ? 'left-collapsed' : ''} ${
            isRightCollapsed ? 'right-collapsed' : ''
          }`}
        >
          {/* =================================================================
              COLUMN 1: CLIENTS AND LEADS (LEFT PANEL)
             ================================================================= */}
          {isLeftCollapsed ? (
            <aside
              className={`ch-collapsed-rail ${mobileColumn !== 'list' ? 'mobile-hidden' : ''}`}
              onClick={() => setIsLeftCollapsed(false)}
              title="Click to expand Clients & Leads panel"
            >
              <button
                type="button"
                className="ch-rail-expand-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsLeftCollapsed(false);
                }}
                aria-label="Expand Clients and Leads panel"
              >
                <PanelLeftOpen size={16} />
              </button>
              <span className="ch-rail-count">{displayedClients.length}</span>
              <span className="ch-rail-label">Clients &amp; Leads</span>
            </aside>
          ) : (
            <aside className={`ch-panel ${mobileColumn !== 'list' ? 'mobile-hidden' : ''}`}>
              <div className="ch-list-header">
                <div className="ch-list-title-row">
                  <h3>
                    <Building2 size={16} color="var(--primary)" />
                    Clients &amp; Leads
                    <span className="ch-list-count">{displayedClients.length}</span>
                  </h3>
                  <button
                    type="button"
                    className="ch-panel-toggle-btn desktop-only"
                    onClick={() => setIsLeftCollapsed(true)}
                    title="Collapse Clients & Leads panel to widen conversation area"
                  >
                    <PanelLeftClose size={14} />
                    <span>Hide</span>
                  </button>
                </div>

                {/* Search Input */}
                <div className="ch-search-wrapper">
                  <Search size={14} className="ch-search-icon" />
                  <input
                    type="text"
                    className="ch-search-input"
                    placeholder="Search client name, phone, area..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void loadClients();
                    }}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="ch-search-clear"
                      onClick={() => {
                        setSearchQuery('');
                        void loadClients(true);
                      }}
                      title="Clear search"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Stage Filter Pills */}
                <div className="ch-filter-pills">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'new', label: 'New' },
                    { id: 'conversing', label: 'Active' },
                    { id: 'awaiting_reply', label: 'Awaiting' },
                    { id: 'negotiating', label: 'Negotiating' },
                    { id: 'closed_won', label: 'Closed' },
                    { id: 'needs_human', label: 'Action Due' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setStageFilter(f.id)}
                      className={`ch-filter-pill ${stageFilter === f.id ? 'active' : ''}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Independently Scrollable Client Roster */}
              <div className="ch-client-list-scroll">
                {loadingList && clients.length === 0 ? (
                  <div className="ch-empty-state" style={{ padding: '40px 16px' }}>
                    <Loader2 size={24} className="spin" style={{ margin: '0 auto 8px', color: 'var(--primary)' }} />
                    <p>Loading client directory...</p>
                  </div>
                ) : displayedClients.length === 0 ? (
                  <div className="ch-empty-state" style={{ padding: '40px 16px' }}>
                    <div className="ch-empty-icon">
                      <Building2 size={24} />
                    </div>
                    <h4>No clients found</h4>
                    <p>
                      {searchQuery
                        ? 'No records match your current search filter.'
                        : 'Run a search in Prospecting & Leads to populate prospective clients.'}
                    </p>
                  </div>
                ) : (
                  displayedClients.map((c) => {
                    const stageInfo = STAGE_LABELS[c.stage] || STAGE_LABELS.new;
                    const isSelected = selectedLeadId === c.leadId;
                    const lastMsg = c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;
                    const hasUnreadAttention =
                      (lastMsg && lastMsg.sender === 'client') || c.stage === 'needs_human';
                    const timeLabel = formatShortTime(lastMsg?.timestamp || c.lastMessageAt || c.updatedAt);

                    return (
                      <div
                        key={c.leadId}
                        onClick={() => {
                          setSelectedLeadId(c.leadId);
                          setMobileColumn('chat');
                        }}
                        className={`ch-client-item ${isSelected ? 'selected' : ''} ${hasUnreadAttention ? 'has-unread' : ''}`}
                      >
                        <div className="ch-client-top">
                          <div className="ch-client-avatar">{getInitials(c.businessName)}</div>
                          <div className="ch-client-title-box">
                            <div className="ch-client-name-row">
                              <strong className="ch-client-name" title={c.businessName}>
                                {c.businessName}
                              </strong>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                {hasUnreadAttention && (
                                  <span
                                    className="ch-unread-dot"
                                    title={
                                      c.stage === 'needs_human'
                                        ? 'Human attention required'
                                        : 'Latest message from client (awaiting reply)'
                                    }
                                  />
                                )}
                                {timeLabel && <span className="ch-client-time">{timeLabel}</span>}
                              </div>
                            </div>

                            <div className="ch-client-badges">
                              <span
                                className="ch-stage-pill"
                                style={{ color: stageInfo.color, background: stageInfo.bg }}
                              >
                                {stageInfo.label}
                              </span>
                              {c.phone && <span className="ch-phone-tag">{c.phone}</span>}
                              {c.autoPilot && (
                                <span className="ch-autopilot-tag" title="Autonomous AI auto-pilot enabled">
                                  <Bot size={11} /> AI
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <p className="ch-msg-preview">
                          {lastMsg ? (
                            <>
                              <span
                                className={`sender-tag ${
                                  lastMsg.sender === 'client'
                                    ? 'client'
                                    : lastMsg.sender === 'assistant'
                                    ? 'ai'
                                    : ''
                                }`}
                              >
                                {lastMsg.sender === 'client'
                                  ? '💬 Client:'
                                  : lastMsg.sender === 'assistant'
                                  ? '🤖 AI:'
                                  : 'You:'}
                              </span>{' '}
                              {lastMsg.text}
                            </>
                          ) : (
                            c.summary || 'Awaiting initial outreach message.'
                          )}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </aside>
          )}

          {/* =================================================================
              COLUMN 2: CLIENT COMMUNICATIONS (MIDDLE PANEL)
             ================================================================= */}
          <section className={`ch-panel ${mobileColumn !== 'chat' ? 'mobile-hidden' : ''}`}>
            {selectedClient ? (
              <>
                {/* Conversation Top Header */}
                <div className="ch-chat-header">
                  <div className="ch-chat-identity">
                    {isLeftCollapsed && (
                      <button
                        type="button"
                        className="ch-panel-toggle-btn desktop-only"
                        onClick={() => setIsLeftCollapsed(false)}
                        title="Expand Clients & Leads sidebar"
                      >
                        <PanelLeftOpen size={14} />
                        <span>Clients</span>
                      </button>
                    )}
                    <div className="ch-chat-avatar">{getInitials(selectedClient.businessName)}</div>
                    <div className="ch-chat-title">
                      <div className="ch-chat-title-row">
                        <h2 title={selectedClient.businessName}>{selectedClient.businessName}</h2>
                        {selectedClient.lead?.googleMapsUrl && (
                          <a
                            href={selectedClient.lead.googleMapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="View on Google Maps"
                            style={{ display: 'inline-flex', color: 'var(--primary)', flexShrink: 0 }}
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                      <div className="ch-chat-sub">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Phone size={11} /> {selectedClient.phone || 'No phone number'}
                        </span>
                        {selectedClient.lead?.category && (
                          <span>• {selectedClient.lead.category}</span>
                        )}
                        {selectedClient.lead?.address && (
                          <span>• {selectedClient.lead.address.split(',')[0]}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Stage Selector, Auto-Pilot & Sidebar Controls */}
                  <div className="ch-chat-controls">
                    <select
                      value={selectedClient.stage}
                      onChange={(e) => void handleStageChange(e.target.value as ClientStage)}
                      className="ch-stage-select"
                      aria-label="Conversation Stage"
                      style={{
                        color: STAGE_LABELS[selectedClient.stage]?.color || 'var(--ink)',
                      }}
                    >
                      {Object.entries(STAGE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => void handleToggleAutopilot()}
                      className={`ch-autopilot-btn ${selectedClient.autoPilot ? 'active' : ''}`}
                      title={
                        selectedClient.autoPilot
                          ? 'Auto-Pilot is ON: AI replies automatically'
                          : 'Auto-Pilot is OFF: Manual approval required'
                      }
                    >
                      <Bot size={14} />
                      {selectedClient.autoPilot ? 'Auto-Pilot: ON' : 'Auto-Pilot: OFF'}
                    </button>

                    {isRightCollapsed && (
                      <button
                        type="button"
                        className="ch-panel-toggle-btn desktop-only"
                        onClick={() => setIsRightCollapsed(false)}
                        title="Expand Client Intelligence & Details sidebar"
                      >
                        <span>Details</span>
                        <PanelRightOpen size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* 6-Stage Autonomous Lifecycle Tracker */}
                <div className="ch-lifecycle-strip">
                  {[
                    { num: 1, label: 'Outreach' },
                    { num: 2, label: 'Requirements' },
                    { num: 3, label: 'Solutions' },
                    { num: 4, label: 'Negotiation' },
                    { num: 5, label: 'Project Plan' },
                    { num: 6, label: 'Deal Finalized 🎉' },
                  ].map((stg) => {
                    const currentNum = (() => {
                      switch (selectedClient.stage) {
                        case 'new':
                        case 'contacted':
                        case 'awaiting_reply':
                          return 1;
                        case 'conversing':
                          return 2;
                        case 'interested':
                          return 3;
                        case 'negotiating':
                          return 4;
                        case 'proposal_pending':
                          return 5;
                        case 'closed_won':
                          return 6;
                        default:
                          return 2;
                      }
                    })();
                    const isPassed = currentNum > stg.num;
                    const isCurrent = currentNum === stg.num;

                    return (
                      <div
                        key={stg.num}
                        className={`ch-lifecycle-step ${isCurrent ? 'current' : ''} ${isPassed ? 'passed' : ''}`}
                      >
                        <span className="ch-lifecycle-dot">
                          {isPassed ? <Check size={11} /> : stg.num}
                        </span>
                        <span>{stg.label}</span>
                        {stg.num < 6 && <ArrowRight size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    );
                  })}
                </div>

                {/* AI Handled Action & Next Recommended Step Banner */}
                {(selectedClient.aiHandled || selectedClient.nextRecommendedAction) && (
                  <div className="ch-banner ai-info">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Bot size={14} />
                      <strong>Autonomous Status:</strong>{' '}
                      {selectedClient.lastAiAction || 'Handled automatically by AI'}
                    </span>
                    {selectedClient.nextRecommendedAction && (
                      <span
                        style={{
                          background: 'rgba(139, 92, 246, 0.16)',
                          padding: '2px 8px',
                          borderRadius: 6,
                          fontWeight: 700,
                        }}
                      >
                        🎯 Next: {selectedClient.nextRecommendedAction}
                      </span>
                    )}
                  </div>
                )}

                {/* Deal Notification Delivery Banner */}
                {selectedClient.dealNotificationStatus && (
                  <div
                    className={`ch-banner ${
                      selectedClient.dealNotificationStatus === 'sent' ? 'success' : 'danger'
                    }`}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Bell size={13} />
                      <strong>Owner WhatsApp Notification:</strong>{' '}
                      {selectedClient.dealNotificationStatus === 'sent'
                        ? `Executive summary dispatched to +${selectedClient.dealNotificationPhone}`
                        : `Delivery issue: ${selectedClient.dealNotificationError || 'Failed to dispatch'}`}
                    </span>
                    {selectedClient.closingNotifiedAt && (
                      <span style={{ opacity: 0.8 }}>
                        {new Date(selectedClient.closingNotifiedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                )}

                {/* Human Intervention Alert Banner */}
                {selectedClient.stage === 'needs_human' && (
                  <div className="ch-banner danger">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <ShieldAlert size={16} style={{ flexShrink: 0 }} />
                      <div>
                        <strong>Human Intervention Requested:</strong>{' '}
                        {selectedClient.humanInterventionReason ||
                          'AI paused to prevent unapproved commitments.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleStageChange('conversing')}
                      style={{
                        fontSize: '11px',
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: 'var(--surface)',
                        border: '1px solid currentColor',
                        color: 'inherit',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Clear &amp; Resume
                    </button>
                  </div>
                )}

                {/* Deal Closed Banner */}
                {selectedClient.stage === 'closed_won' && (
                  <div className="ch-banner success">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Trophy size={16} style={{ flexShrink: 0 }} />
                      <div>
                        <strong>Deal Closed!</strong> Agreed Services:{' '}
                        {selectedClient.agreedServices.join(', ') || 'Custom Solution'}. Price:{' '}
                        {selectedClient.agreedPrice || 'Agreed'}. Deliverables:{' '}
                        {selectedClient.agreedDeliverables}.
                      </div>
                    </div>
                  </div>
                )}

                {/* Opted Out Banner */}
                {selectedClient.optedOut && (
                  <div className="ch-banner danger">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <XCircle size={14} />
                      Client has opted out. Messaging is locked to respect opt-out preferences.
                    </span>
                  </div>
                )}

                {/* Unmatched Inbound Contact — Link to Existing Lead Banner */}
                {(selectedClient.leadId.startsWith('Lwa_') ||
                  selectedClient.lead?.runId === 'whatsapp_inbound' ||
                  selectedClient.lead?.runId === 'run-whatsapp-inbound') && (
                  <div className="ch-banner info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <User size={14} style={{ flexShrink: 0 }} />
                      <span>
                        <strong>Inbound WhatsApp Contact:</strong> Associate this conversation with an existing lead:
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <select
                        value={linkTargetLeadId}
                        onChange={(e) => setLinkTargetLeadId(e.target.value)}
                        style={{
                          width: 'auto',
                          padding: '4px 8px',
                          fontSize: '11px',
                          borderRadius: 6,
                          border: '1px solid var(--line-strong)',
                          background: 'var(--surface)',
                          color: 'var(--ink)',
                          maxWidth: 220,
                        }}
                      >
                        <option value="">Select existing lead...</option>
                        {clients
                          .filter((c) => c.leadId !== selectedClient.leadId && !c.leadId.startsWith('Lwa_'))
                          .map((c) => (
                            <option key={c.leadId} value={c.leadId}>
                              {c.businessName} ({c.phone || 'No phone'})
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        disabled={!linkTargetLeadId || linkingBusy}
                        onClick={() => void handleLinkUnmatchedLead()}
                        style={{
                          fontSize: '11px',
                          padding: '5px 10px',
                          borderRadius: 6,
                          background: 'var(--primary)',
                          color: '#fff',
                          border: 'none',
                          fontWeight: 700,
                          cursor: linkTargetLeadId ? 'pointer' : 'not-allowed',
                          opacity: linkTargetLeadId ? 1 : 0.6,
                        }}
                      >
                        {linkingBusy ? 'Linking...' : 'Link to Lead'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Independently Scrollable WhatsApp Messages Stream */}
                <div ref={chatScrollRef} className="ch-messages-stream">
                  {loadingChat ? (
                    <div className="ch-empty-state">
                      <Loader2 size={24} className="spin" style={{ margin: '0 auto 8px', color: 'var(--primary)' }} />
                      <p>Loading conversation history...</p>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="ch-empty-state">
                      <div className="ch-empty-icon">
                        <MessageCircle size={26} />
                      </div>
                      <h4>Start WhatsApp Conversation</h4>
                      <p style={{ marginBottom: 16 }}>
                        No messages exchanged yet. The AI can draft a personalized outreach message using verified research for{' '}
                        <strong>{selectedClient.businessName}</strong>.
                      </p>
                      <button
                        type="button"
                        onClick={handlePrepareFirstMessage}
                        disabled={generatingAi}
                        className="ch-send-btn"
                        style={{ margin: '0 auto' }}
                      >
                        {generatingAi ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                        Prepare First Message
                      </button>
                    </div>
                  ) : (
                    messages.map((m, idx) => {
                      const isClient = m.sender === 'client';
                      const isAi = m.sender === 'assistant';
                      const msgType = (m.metadata as any)?.messageType as string | undefined;

                      // Render date divider when day changes between messages
                      const prevMsg = idx > 0 ? messages[idx - 1] : null;
                      const currDateStr = formatDateDivider(m.timestamp);
                      const prevDateStr = prevMsg ? formatDateDivider(prevMsg.timestamp) : '';
                      const showDateDivider = currDateStr && currDateStr !== prevDateStr;

                      return (
                        <React.Fragment key={m.id}>
                          {showDateDivider && (
                            <div className="ch-date-divider">
                              <span>{currDateStr}</span>
                            </div>
                          )}
                          <div className={`ch-msg-row ${isClient ? 'incoming' : 'outgoing'}`}>
                            <div className={`ch-msg-sender ${isClient ? 'client' : isAi ? 'ai' : 'user'}`}>
                              {isClient ? (
                                <>
                                  <User size={11} />
                                  <span>{selectedClient.businessName} (Client)</span>
                                </>
                              ) : isAi ? (
                                <>
                                  <Bot size={11} />
                                  <span>AI Client Handler</span>
                                </>
                              ) : (
                                <>
                                  <User size={11} />
                                  <span>You</span>
                                </>
                              )}
                              {msgType && msgType !== 'text' && (
                                <span
                                  style={{
                                    background: 'var(--surface-3)',
                                    color: 'var(--ink-2)',
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    fontSize: '9px',
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  {msgType}
                                </span>
                              )}
                            </div>

                            <div className={`ch-msg-bubble ${isClient ? 'client' : isAi ? 'ai' : 'user'}`}>
                              {m.text}
                            </div>

                            <div className="ch-msg-meta">
                              <span>
                                {new Date(m.timestamp).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {!isClient && (
                                <span
                                  title={
                                    m.status === 'Read' || m.status === 'Played'
                                      ? 'Read by client'
                                      : m.status === 'Delivered'
                                      ? 'Delivered to client device'
                                      : m.status === 'Sent'
                                      ? 'Sent to WhatsApp server'
                                      : m.status === 'Sending' || m.status === 'Pending'
                                      ? 'Sending message...'
                                      : m.status === 'Failed'
                                      ? 'Delivery failed'
                                      : `WhatsApp status: ${m.status}`
                                  }
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                >
                                  {m.status === 'Read' || m.status === 'Played' ? (
                                    <CheckCheck size={13} style={{ color: '#0ea5e9' }} />
                                  ) : m.status === 'Delivered' ? (
                                    <CheckCheck size={13} style={{ color: '#94a3b8' }} />
                                  ) : m.status === 'Sent' ? (
                                    <Check size={13} style={{ color: '#94a3b8' }} />
                                  ) : m.status === 'Sending' || m.status === 'Pending' ? (
                                    <Clock size={12} style={{ color: '#94a3b8', opacity: 0.8 }} />
                                  ) : m.status === 'Failed' ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#ef4444', fontSize: '11px', fontWeight: 600 }}>
                                      <AlertCircle size={12} /> Failed
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setInputMessage(m.text);
                                        }}
                                        title="Click to paste message into input and retry"
                                        style={{
                                          background: 'rgba(239, 68, 68, 0.15)',
                                          border: '1px solid rgba(239, 68, 68, 0.3)',
                                          color: '#ef4444',
                                          borderRadius: 4,
                                          padding: '1px 5px',
                                          fontSize: '10px',
                                          cursor: 'pointer',
                                          marginLeft: 3,
                                        }}
                                      >
                                        <RefreshCw size={9} style={{ display: 'inline', marginRight: 2 }} /> Retry
                                      </button>
                                    </span>
                                  ) : (
                                    <Check size={13} style={{ color: '#94a3b8' }} />
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })
                  )}
                </div>

                {/* AI Draft Suggestion Banner */}
                {aiDraft && (
                  <div className="ch-banner ai-info" style={{ borderTop: '1px solid var(--line)', borderBottom: 'none' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <Sparkles size={15} style={{ marginTop: 1, flexShrink: 0 }} />
                      <div>
                        <strong>AI Proposed Stage:</strong>{' '}
                        {STAGE_LABELS[aiDraft.detectedStage as ClientStage]?.label || aiDraft.detectedStage}
                        {aiDraft.summaryUpdate && <span> • {aiDraft.summaryUpdate}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAiDraft(null)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'inherit',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: 700,
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Quick AI Prompt Actions */}
                <div className="ch-quick-actions">
                  <button
                    type="button"
                    onClick={() =>
                      handleGenerateAiReply('Explain how our recommended service solves their specific problem')
                    }
                    disabled={generatingAi || selectedClient.optedOut}
                    className="ch-quick-chip"
                  >
                    ✨ Explain Solution
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleGenerateAiReply(
                        'Address pricing, explain typical package range, and offer discovery walk-through'
                      )
                    }
                    disabled={generatingAi || selectedClient.optedOut}
                    className="ch-quick-chip"
                  >
                    💰 Discuss Pricing
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleGenerateAiReply('Handle hesitation or objection politely and emphasize zero risk')
                    }
                    disabled={generatingAi || selectedClient.optedOut}
                    className="ch-quick-chip"
                  >
                    🛡️ Address Objection
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleGenerateAiReply('Summarize proposed terms and invite them to finalize kickoff date')
                    }
                    disabled={generatingAi || selectedClient.optedOut}
                    className="ch-quick-chip"
                  >
                    🏆 Propose Agreement
                  </button>
                </div>

                {/* Message Composer */}
                <form onSubmit={handleSendMessage} className="ch-composer">
                  <div className="ch-composer-input">
                    <textarea
                      rows={2}
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      placeholder={
                        selectedClient.optedOut
                          ? 'Client has opted out.'
                          : 'Type your WhatsApp message, or click AI Reply to draft...'
                      }
                      disabled={selectedClient.optedOut || sendingMsg}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleSendMessage();
                        }
                      }}
                    />
                  </div>

                  <div className="ch-composer-btns">
                    <button
                      type="button"
                      onClick={() => void handleGenerateAiReply()}
                      disabled={generatingAi || selectedClient.optedOut}
                      title="Generate context-aware AI reply using lead research"
                      className="ch-ai-btn"
                    >
                      {generatingAi ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
                      AI Reply
                    </button>

                    <button
                      type="submit"
                      disabled={sendingMsg || !inputMessage.trim() || selectedClient.optedOut}
                      className="ch-send-btn"
                    >
                      {sendingMsg ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                      Send
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="ch-empty-state">
                <div className="ch-empty-icon">
                  <MessageSquare size={26} />
                </div>
                <h4>No Conversation Selected</h4>
                <p>Select a client or prospect from the left column to view WhatsApp messages and manage outreach.</p>
              </div>
            )}
          </section>

          {/* =================================================================
              COLUMN 3: CLIENT INTELLIGENCE AND DETAILS (RIGHT PANEL)
             ================================================================= */}
          {isRightCollapsed ? (
            <aside
              className={`ch-collapsed-rail ${mobileColumn !== 'details' ? 'mobile-hidden' : ''}`}
              onClick={() => setIsRightCollapsed(false)}
              title="Click to expand Client Intelligence & Details panel"
            >
              <button
                type="button"
                className="ch-rail-expand-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsRightCollapsed(false);
                }}
                aria-label="Expand Client Intelligence and Details panel"
              >
                <PanelRightOpen size={16} />
              </button>
              <span className="ch-rail-label">Client Intelligence</span>
            </aside>
          ) : (
            <aside className={`ch-panel ${mobileColumn !== 'details' ? 'mobile-hidden' : ''}`}>
              <div className="ch-details-header">
                <div className="ch-details-title-row">
                  <h3>
                    <Layers size={15} color="var(--primary)" />
                    Client Intelligence &amp; Details
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {selectedClient?.lead?.priority && (
                      <span
                        className="ch-stage-pill"
                        style={{
                          background:
                            selectedClient.lead.priority === 'high'
                              ? 'var(--emerald-soft)'
                              : 'var(--soft)',
                          color:
                            selectedClient.lead.priority === 'high'
                              ? 'var(--emerald)'
                              : 'var(--primary)',
                          textTransform: 'capitalize',
                        }}
                      >
                        {selectedClient.lead.priority}
                      </span>
                    )}
                    <button
                      type="button"
                      className="ch-panel-toggle-btn desktop-only"
                      onClick={() => setIsRightCollapsed(true)}
                      title="Collapse Client Intelligence & Details panel to widen conversation area"
                    >
                      <span>Hide</span>
                      <PanelRightClose size={14} />
                    </button>
                  </div>
                </div>

                {/* Drawer Mode Tabs */}
                <div className="ch-details-tabs">
                  <button
                    type="button"
                    onClick={() => setActiveTab('chat')}
                    className={`ch-details-tab ${activeTab === 'chat' ? 'active' : ''}`}
                  >
                    🔍 Details
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('plan')}
                    className={`ch-details-tab ${activeTab === 'plan' ? 'active' : ''}`}
                  >
                    📋 Project Plan
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('close')}
                    className={`ch-details-tab ${activeTab === 'close' ? 'active' : ''}`}
                  >
                    🏆 Close Deal
                  </button>
                </div>
              </div>

              {/* Independently Scrollable Client Intelligence & Details Container */}
              <div className="ch-details-scroll">
                {!selectedClient ? (
                  <div className="ch-empty-state">
                    <div className="ch-empty-icon">
                      <Building2 size={24} />
                    </div>
                    <h4>Client Details Unavailable</h4>
                    <p>Select a client from the list to inspect business research, requirements, and deal status.</p>
                  </div>
                ) : activeTab === 'chat' ? (
                  <>
                    {/* SECTION 1: Deal Status & Opportunity Score */}
                    <div className="ch-detail-section">
                      <button
                        type="button"
                        className="ch-detail-section-header"
                        onClick={() => toggleSection('dealStatus')}
                      >
                        <span className="ch-detail-section-title">
                          <Award size={14} />
                          Deal Status &amp; Opportunity
                        </span>
                        <ChevronDown
                          size={15}
                          style={{
                            transform: openSections.dealStatus ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease',
                            color: 'var(--muted)',
                          }}
                        />
                      </button>
                      {openSections.dealStatus && (
                        <div className="ch-detail-section-body">
                          <div className="ch-score-banner">
                            <div className="ch-score-box">
                              <span className="ch-score-label">Opportunity Score</span>
                              <div className="ch-score-val" style={{ color: 'var(--primary)' }}>
                                {selectedClient.lead?.leadScore ?? 75}/100
                              </div>
                            </div>
                            <div className="ch-score-box" style={{ textAlign: 'right' }}>
                              <span className="ch-score-label">Est. Deal Value</span>
                              <div className="ch-score-val" style={{ color: 'var(--emerald)', fontSize: '15px' }}>
                                {selectedClient.agreedPrice ||
                                  selectedClient.lead?.estimatedDealValue ||
                                  '$400 - $800'}
                              </div>
                            </div>
                          </div>

                          <div className="ch-kv-grid">
                            <div className="ch-kv-row">
                              <span className="ch-kv-label">Current Stage</span>
                              <span
                                className="ch-stage-pill"
                                style={{
                                  color: (STAGE_LABELS[selectedClient.stage] || STAGE_LABELS.new).color,
                                  background: (STAGE_LABELS[selectedClient.stage] || STAGE_LABELS.new).bg,
                                }}
                              >
                                {(STAGE_LABELS[selectedClient.stage] || STAGE_LABELS.new).label}
                              </span>
                            </div>
                            <div className="ch-kv-row">
                              <span className="ch-kv-label">AI Auto-Pilot</span>
                              <span className="ch-kv-val">
                                {selectedClient.autoPilot ? 'Active (Autonomous)' : 'Paused (Manual)'}
                              </span>
                            </div>
                            <div className="ch-kv-row">
                              <span className="ch-kv-label">Follow-Ups Sent</span>
                              <span className="ch-kv-val">{selectedClient.followUpCount ?? 0}</span>
                            </div>
                            {selectedClient.agreedTimeline && (
                              <div className="ch-kv-row">
                                <span className="ch-kv-label">Agreed Timeline</span>
                                <span className="ch-kv-val">{selectedClient.agreedTimeline}</span>
                              </div>
                            )}
                            {selectedClient.agreedDeliverables && (
                              <div className="ch-kv-row">
                                <span className="ch-kv-label">Deliverables</span>
                                <span className="ch-kv-val">{selectedClient.agreedDeliverables}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* SECTION 2: Business Overview & Contact Information */}
                    <div className="ch-detail-section">
                      <button
                        type="button"
                        className="ch-detail-section-header"
                        onClick={() => toggleSection('businessInfo')}
                      >
                        <span className="ch-detail-section-title">
                          <Building2 size={14} />
                          Business &amp; Contact Info
                        </span>
                        <ChevronDown
                          size={15}
                          style={{
                            transform: openSections.businessInfo ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease',
                            color: 'var(--muted)',
                          }}
                        />
                      </button>
                      {openSections.businessInfo && (
                        <div className="ch-detail-section-body">
                          <div className="ch-kv-grid">
                            <div className="ch-kv-row">
                              <span className="ch-kv-label">Business</span>
                              <span className="ch-kv-val">{selectedClient.businessName}</span>
                            </div>
                            {selectedClient.lead?.category && (
                              <div className="ch-kv-row">
                                <span className="ch-kv-label">Category</span>
                                <span className="ch-kv-val">{selectedClient.lead.category}</span>
                              </div>
                            )}
                            {selectedClient.lead?.leadType && (
                              <div className="ch-kv-row">
                                <span className="ch-kv-label">Lead Type</span>
                                <span className="ch-kv-val">{selectedClient.lead.leadType}</span>
                              </div>
                            )}
                            {selectedClient.lead?.contactChannel && (
                              <div className="ch-kv-row">
                                <span className="ch-kv-label">Best Channel</span>
                                <span className="ch-kv-val">{selectedClient.lead.contactChannel}</span>
                              </div>
                            )}
                            <div className="ch-kv-row">
                              <span className="ch-kv-label">WhatsApp</span>
                              <span className="ch-kv-val" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                {selectedClient.phone || selectedClient.lead?.phone || 'Not listed'}
                                {(selectedClient.phone || selectedClient.lead?.phone) && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      copyFieldValue(
                                        selectedClient.phone || selectedClient.lead?.phone || '',
                                        'phone'
                                      )
                                    }
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      padding: 2,
                                      cursor: 'pointer',
                                      color: copiedField === 'phone' ? 'var(--emerald)' : 'var(--muted)',
                                    }}
                                    title="Copy phone number"
                                  >
                                    {copiedField === 'phone' ? <Check size={12} /> : <Copy size={12} />}
                                  </button>
                                )}
                              </span>
                            </div>
                            <div className="ch-kv-row">
                              <span className="ch-kv-label">Email</span>
                              <span className="ch-kv-val" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                {selectedClient.lead?.email || 'No verified email'}
                                {selectedClient.lead?.email && (
                                  <button
                                    type="button"
                                    onClick={() => copyFieldValue(selectedClient.lead?.email || '', 'email')}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      padding: 2,
                                      cursor: 'pointer',
                                      color: copiedField === 'email' ? 'var(--emerald)' : 'var(--muted)',
                                    }}
                                    title="Copy email"
                                  >
                                    {copiedField === 'email' ? <Check size={12} /> : <Copy size={12} />}
                                  </button>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* SECTION 3: Business Location & Google Presence */}
                    <div className="ch-detail-section">
                      <button
                        type="button"
                        className="ch-detail-section-header"
                        onClick={() => toggleSection('locationInfo')}
                      >
                        <span className="ch-detail-section-title">
                          <MapPin size={14} />
                          Location &amp; Google Presence
                        </span>
                        <ChevronDown
                          size={15}
                          style={{
                            transform: openSections.locationInfo ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease',
                            color: 'var(--muted)',
                          }}
                        />
                      </button>
                      {openSections.locationInfo && (
                        <div className="ch-detail-section-body">
                          <div className="ch-kv-grid">
                            <div className="ch-kv-row">
                              <span className="ch-kv-label">Address</span>
                              <span className="ch-kv-val">
                                {selectedClient.lead?.address || 'Address not specified'}
                              </span>
                            </div>
                            {selectedClient.lead?.country && (
                              <div className="ch-kv-row">
                                <span className="ch-kv-label">Country</span>
                                <span className="ch-kv-val">{selectedClient.lead.country}</span>
                              </div>
                            )}
                            {selectedClient.lead?.locationStatus && (
                              <div className="ch-kv-row">
                                <span className="ch-kv-label">Verification</span>
                                <span className="ch-kv-val">{selectedClient.lead.locationStatus}</span>
                              </div>
                            )}
                            {selectedClient.lead?.googleRating !== null &&
                              selectedClient.lead?.googleRating !== undefined && (
                                <div className="ch-kv-row">
                                  <span className="ch-kv-label">Google Rating</span>
                                  <span
                                    className="ch-kv-val"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  >
                                    <Star size={12} color="#f59e0b" fill="#f59e0b" />
                                    {selectedClient.lead.googleRating} ({selectedClient.lead.googleReviews ?? 0}{' '}
                                    reviews)
                                  </span>
                                </div>
                              )}
                            {selectedClient.lead?.googleMapsUrl && (
                              <div className="ch-kv-row">
                                <span className="ch-kv-label">Google Maps</span>
                                <span className="ch-kv-val">
                                  <a
                                    href={selectedClient.lead.googleMapsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  >
                                    Open Maps Listing <ExternalLink size={11} />
                                  </a>
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* SECTION 4: Website & Social Media Links */}
                    <div className="ch-detail-section">
                      <button
                        type="button"
                        className="ch-detail-section-header"
                        onClick={() => toggleSection('webSocial')}
                      >
                        <span className="ch-detail-section-title">
                          <Globe size={14} />
                          Website &amp; Social Media
                        </span>
                        <ChevronDown
                          size={15}
                          style={{
                            transform: openSections.webSocial ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease',
                            color: 'var(--muted)',
                          }}
                        />
                      </button>
                      {openSections.webSocial && (
                        <div className="ch-detail-section-body">
                          <div className="ch-kv-grid">
                            <div className="ch-kv-row">
                              <span className="ch-kv-label">Website</span>
                              <span className="ch-kv-val">
                                {selectedClient.lead?.website ? (
                                  <a
                                    href={
                                      selectedClient.lead.website.startsWith('http')
                                        ? selectedClient.lead.website
                                        : `https://${selectedClient.lead.website}`
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  >
                                    {selectedClient.lead.website} <ExternalLink size={11} />
                                  </a>
                                ) : (
                                  'No website detected'
                                )}
                              </span>
                            </div>
                            {selectedClient.lead?.websiteScore !== null &&
                              selectedClient.lead?.websiteScore !== undefined && (
                                <div className="ch-kv-row">
                                  <span className="ch-kv-label">Health Score</span>
                                  <span className="ch-kv-val">{selectedClient.lead.websiteScore}/100</span>
                                </div>
                              )}
                            {selectedClient.lead?.websiteStatus && (
                              <div className="ch-kv-row">
                                <span className="ch-kv-label">Audit Status</span>
                                <span className="ch-kv-val">{selectedClient.lead.websiteStatus}</span>
                              </div>
                            )}
                            {selectedClient.lead?.techStack && selectedClient.lead.techStack.length > 0 && (
                              <div className="ch-kv-row">
                                <span className="ch-kv-label">Tech Stack</span>
                                <span className="ch-kv-val">{selectedClient.lead.techStack.join(', ')}</span>
                              </div>
                            )}
                            {selectedClient.lead?.socialStatus && (
                              <div className="ch-kv-row">
                                <span className="ch-kv-label">Social Presence</span>
                                <span className="ch-kv-val">{selectedClient.lead.socialStatus}</span>
                              </div>
                            )}
                          </div>

                          {/* Social Profile Links */}
                          {selectedClient.lead?.social &&
                            Object.entries(selectedClient.lead.social).some(([, url]) => Boolean(url)) && (
                              <div className="ch-tag-list">
                                {Object.entries(selectedClient.lead.social).map(([platform, url]) =>
                                  url ? (
                                    <a
                                      key={platform}
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="ch-tag"
                                      style={{ textDecoration: 'none', textTransform: 'capitalize' }}
                                    >
                                      {platform} <ExternalLink size={10} />
                                    </a>
                                  ) : null
                                )}
                              </div>
                            )}

                          {/* Website Technical Issues */}
                          {selectedClient.lead?.websiteIssues && selectedClient.lead.websiteIssues.length > 0 && (
                            <div>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  color: 'var(--muted)',
                                  display: 'block',
                                  marginBottom: 4,
                                }}
                              >
                                Website Audit Issues:
                              </span>
                              <ul className="ch-bullet-list">
                                {selectedClient.lead.websiteIssues.map((issue, idx) => (
                                  <li key={idx}>{issue}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* SECTION 5: Conversation Summary & Client Requirements */}
                    <div className="ch-detail-section">
                      <button
                        type="button"
                        className="ch-detail-section-header"
                        onClick={() => toggleSection('conversationSummary')}
                      >
                        <span className="ch-detail-section-title">
                          <MessageSquare size={14} />
                          Summary &amp; Client Requirements
                        </span>
                        <ChevronDown
                          size={15}
                          style={{
                            transform: openSections.conversationSummary ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease',
                            color: 'var(--muted)',
                          }}
                        />
                      </button>
                      {openSections.conversationSummary && (
                        <div className="ch-detail-section-body">
                          {selectedClient.summary && (
                            <div className="ch-summary-box">
                              <strong>Conversation Summary:</strong> {selectedClient.summary}
                            </div>
                          )}

                          {selectedClient.lead?.analysisSummary && (
                            <div className="ch-summary-box">
                              <strong>Strategist Overview:</strong> {selectedClient.lead.analysisSummary}
                            </div>
                          )}

                          <div>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                color: 'var(--muted)',
                                display: 'block',
                                marginBottom: 6,
                              }}
                            >
                              Identified Client Requirements:
                            </span>
                            {selectedClient.identifiedRequirements &&
                            selectedClient.identifiedRequirements.length > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {selectedClient.identifiedRequirements.map((req, idx) => (
                                  <div key={idx} className="ch-req-item">
                                    <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                                    <span>{req}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--muted)' }}>
                                Requirements are automatically extracted as the client replies.
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* SECTION 6: Identified Business Problems & Research Findings */}
                    <div className="ch-detail-section">
                      <button
                        type="button"
                        className="ch-detail-section-header"
                        onClick={() => toggleSection('problemsFindings')}
                      >
                        <span className="ch-detail-section-title">
                          <Target size={14} />
                          Problems &amp; Research Findings
                        </span>
                        <ChevronDown
                          size={15}
                          style={{
                            transform: openSections.problemsFindings ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease',
                            color: 'var(--muted)',
                          }}
                        />
                      </button>
                      {openSections.problemsFindings && (
                        <div className="ch-detail-section-body">
                          {selectedClient.lead?.strategy?.problems &&
                          selectedClient.lead.strategy.problems.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {selectedClient.lead.strategy.problems.map((p, idx) => (
                                <div
                                  key={idx}
                                  className={`ch-problem-card ${p.type === 'confirmed' ? 'confirmed' : ''}`}
                                >
                                  <div className="ch-problem-head">
                                    <strong>{p.title}</strong>
                                    <span
                                      className={`ch-problem-badge ${
                                        p.type === 'confirmed' ? 'confirmed' : 'potential'
                                      }`}
                                    >
                                      {p.type === 'confirmed' ? 'Confirmed' : 'Potential'}
                                    </span>
                                  </div>
                                  <div style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>{p.detail}</div>
                                  {p.evidence && (
                                    <div style={{ color: 'var(--muted)', fontSize: '10.5px', marginTop: 4 }}>
                                      Evidence: {p.evidence}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : selectedClient.lead?.weaknesses && selectedClient.lead.weaknesses.length > 0 ? (
                            <ul className="ch-bullet-list">
                              {selectedClient.lead.weaknesses.map((w, idx) => (
                                <li key={idx}>{w}</li>
                              ))}
                            </ul>
                          ) : (
                            <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--muted)' }}>
                              No verified technical weaknesses recorded for this lead.
                            </p>
                          )}

                          {selectedClient.lead?.strategy?.businessImpact &&
                            selectedClient.lead.strategy.businessImpact.length > 0 && (
                              <div style={{ marginTop: 4 }}>
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    color: 'var(--muted)',
                                    display: 'block',
                                    marginBottom: 4,
                                  }}
                                >
                                  Potential Business Impact:
                                </span>
                                <ul className="ch-bullet-list">
                                  {selectedClient.lead.strategy.businessImpact.map((impact, idx) => (
                                    <li key={idx}>{impact}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                        </div>
                      )}
                    </div>

                    {/* SECTION 7: Recommended Services & Proposed Solutions */}
                    <div className="ch-detail-section">
                      <button
                        type="button"
                        className="ch-detail-section-header"
                        onClick={() => toggleSection('recommendedSolutions')}
                      >
                        <span className="ch-detail-section-title">
                          <Lightbulb size={14} />
                          Recommended Services &amp; Solutions
                        </span>
                        <ChevronDown
                          size={15}
                          style={{
                            transform: openSections.recommendedSolutions ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease',
                            color: 'var(--muted)',
                          }}
                        />
                      </button>
                      {openSections.recommendedSolutions && (
                        <div className="ch-detail-section-body">
                          {selectedClient.lead?.recommendedServices &&
                          selectedClient.lead.recommendedServices.length > 0 ? (
                            <div className="ch-tag-list">
                              {selectedClient.lead.recommendedServices.map((s) => (
                                <span key={s} className="ch-tag">
                                  {s}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--muted)' }}>
                              Custom digital growth &amp; automation package.
                            </p>
                          )}

                          {selectedClient.lead?.strategy?.solutions &&
                            selectedClient.lead.strategy.solutions.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                                {selectedClient.lead.strategy.solutions.map((sol, idx) => (
                                  <div key={idx} className="ch-problem-card">
                                    <div className="ch-problem-head">
                                      <strong>{sol.service}</strong>
                                      {sol.estimatedTimeline && (
                                        <span className="ch-problem-badge potential">{sol.estimatedTimeline}</span>
                                      )}
                                    </div>
                                    <div style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>
                                      {sol.howItWorks}
                                    </div>
                                    {sol.impact && (
                                      <div style={{ color: 'var(--emerald)', fontSize: '11px', marginTop: 5, fontWeight: 600 }}>
                                        Expected Impact: {sol.impact}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  </>
                ) : activeTab === 'plan' ? (
                  /* TAB: Project Plan & Scope */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: 'var(--primary)' }}>
                        Project Plan &amp; Scope
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          const text =
                            `Project Plan: ${selectedClient.businessName}\n` +
                            `Services: ${selectedClient.projectPlan?.services.join(', ') || selectedClient.lead?.recommendedServices.join(', ')}\n` +
                            `Estimated Investment: ${selectedClient.projectPlan?.estimatedCharges || selectedClient.lead?.estimatedDealValue || '$500'}\n` +
                            `Timeline: ${selectedClient.projectPlan?.duration || '1-2 weeks'}\n` +
                            `Deliverables: ${selectedClient.projectPlan?.deliverables || 'Full turnkey setup'}\n` +
                            (selectedClient.identifiedRequirements?.length
                              ? `Identified Requirements:\n${selectedClient.identifiedRequirements.map((r) => `• ${r}`).join('\n')}\n`
                              : '') +
                            (selectedClient.projectPlan?.tasks?.length
                              ? `Scope of Work:\n${selectedClient.projectPlan.tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
                              : '');
                          void navigator.clipboard.writeText(text);
                          setCopiedPlan(true);
                          setTimeout(() => setCopiedPlan(false), 2000);
                        }}
                        className="ch-quick-chip"
                      >
                        {copiedPlan ? <Check size={12} color="var(--emerald)" /> : <Copy size={12} />}
                        {copiedPlan ? 'Copied!' : 'Copy Plan'}
                      </button>
                    </div>

                    {/* Requirements Section */}
                    <div className="ch-detail-section">
                      <div className="ch-detail-section-header" style={{ cursor: 'default' }}>
                        <span className="ch-detail-section-title">
                          <CheckCircle2 size={14} />
                          Identified Client Requirements
                        </span>
                      </div>
                      <div className="ch-detail-section-body">
                        {selectedClient.identifiedRequirements &&
                        selectedClient.identifiedRequirements.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {selectedClient.identifiedRequirements.map((req, idx) => (
                              <div key={idx} className="ch-req-item">
                                <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
                                <span>{req}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--muted)' }}>
                            Requirements will be automatically recognized as the client converses.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Plan Details Card */}
                    <div className="ch-detail-section">
                      <div className="ch-detail-section-header" style={{ cursor: 'default' }}>
                        <span className="ch-detail-section-title">
                          <Briefcase size={14} />
                          Commercial Terms &amp; Deliverables
                        </span>
                      </div>
                      <div className="ch-detail-section-body">
                        <div className="ch-kv-grid">
                          <div className="ch-kv-row">
                            <span className="ch-kv-label">Investment</span>
                            <strong style={{ fontSize: '14px', color: 'var(--emerald)' }}>
                              {selectedClient.projectPlan?.estimatedCharges ||
                                selectedClient.lead?.estimatedDealValue ||
                                '$400 - $800'}
                            </strong>
                          </div>
                          <div className="ch-kv-row">
                            <span className="ch-kv-label">Duration</span>
                            <strong style={{ fontSize: '12px', color: 'var(--ink)' }}>
                              {selectedClient.projectPlan?.duration || '1-2 weeks'}
                            </strong>
                          </div>
                        </div>
                        <div className="ch-summary-box">
                          <strong>Key Deliverables:</strong>{' '}
                          {selectedClient.projectPlan?.deliverables ||
                            `Complete setup of ${
                              selectedClient.lead?.recommendedServices?.slice(0, 2).join(' & ') ||
                              'digital services'
                            } with direct support.`}
                        </div>
                      </div>
                    </div>

                    {/* Scope of Work / Tasks */}
                    {selectedClient.projectPlan?.tasks && selectedClient.projectPlan.tasks.length > 0 && (
                      <div className="ch-detail-section">
                        <div className="ch-detail-section-header" style={{ cursor: 'default' }}>
                          <span className="ch-detail-section-title">
                            <Wrench size={14} />
                            Execution Roadmap &amp; Tasks
                          </span>
                        </div>
                        <div className="ch-detail-section-body">
                          <ol className="ch-bullet-list">
                            {selectedClient.projectPlan.tasks.map((t, idx) => (
                              <li key={idx}>{t}</li>
                            ))}
                          </ol>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* TAB: Close Deal Form */
                  <form onSubmit={handleCloseDeal} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="ch-summary-box" style={{ borderColor: 'rgba(16, 185, 129, 0.35)' }}>
                      <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 800, color: 'var(--emerald)' }}>
                        Close Deal &amp; Log Terms
                      </h3>
                      <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--muted)' }}>
                        Confirm agreed deliverables, pricing, and optionally send a celebration alert to your WhatsApp.
                      </p>
                    </div>

                    <div className="ch-detail-section">
                      <div className="ch-detail-section-body">
                        <div>
                          <label
                            style={{
                              fontSize: '11.5px',
                              fontWeight: 700,
                              color: 'var(--ink-2)',
                              display: 'block',
                              marginBottom: 6,
                            }}
                          >
                            Agreed Services
                          </label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {selectedClient.lead?.recommendedServices?.map((srv) => (
                              <label
                                key={srv}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  fontSize: '12px',
                                  color: 'var(--ink-2)',
                                  cursor: 'pointer',
                                  margin: 0,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={closingServices.includes(srv)}
                                  onChange={(e) => {
                                    if (e.target.checked) setClosingServices([...closingServices, srv]);
                                    else setClosingServices(closingServices.filter((s) => s !== srv));
                                  }}
                                  style={{ width: 15, height: 15 }}
                                />
                                {srv}
                              </label>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label
                            style={{
                              fontSize: '11.5px',
                              fontWeight: 700,
                              color: 'var(--ink-2)',
                              display: 'block',
                              marginBottom: 4,
                            }}
                          >
                            Finalized Deal Price ($)
                          </label>
                          <input
                            type="text"
                            value={closingPrice}
                            onChange={(e) => setClosingPrice(e.target.value)}
                            placeholder="e.g. $600/month or $1,200"
                            required
                            style={{ fontSize: '12px', padding: '8px 10px' }}
                          />
                        </div>

                        <div>
                          <label
                            style={{
                              fontSize: '11.5px',
                              fontWeight: 700,
                              color: 'var(--ink-2)',
                              display: 'block',
                              marginBottom: 4,
                            }}
                          >
                            Agreed Timeline
                          </label>
                          <input
                            type="text"
                            value={closingTimeline}
                            onChange={(e) => setClosingTimeline(e.target.value)}
                            placeholder="e.g. 1-2 weeks"
                            required
                            style={{ fontSize: '12px', padding: '8px 10px' }}
                          />
                        </div>

                        <div>
                          <label
                            style={{
                              fontSize: '11.5px',
                              fontWeight: 700,
                              color: 'var(--ink-2)',
                              display: 'block',
                              marginBottom: 4,
                            }}
                          >
                            Confirmed Deliverables
                          </label>
                          <textarea
                            rows={2}
                            value={closingDeliverables}
                            onChange={(e) => setClosingDeliverables(e.target.value)}
                            placeholder="e.g. Mobile-friendly website, WhatsApp booking bot setup"
                            required
                            style={{ fontSize: '12px', padding: '8px 10px' }}
                          />
                        </div>

                        {/* WhatsApp Notification Option */}
                        <div
                          style={{
                            background: 'var(--emerald-soft)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            borderRadius: 10,
                            padding: 10,
                          }}
                        >
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              fontSize: '12px',
                              color: 'var(--emerald)',
                              fontWeight: 700,
                              cursor: 'pointer',
                              margin: 0,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={notifyUserToggle}
                              onChange={(e) => setNotifyUserToggle(e.target.checked)}
                              style={{ width: 15, height: 15 }}
                            />
                            Send Deal Alert to my WhatsApp
                          </label>
                          {notifyUserToggle && (
                            <input
                              type="text"
                              value={notifyUserPhone}
                              onChange={(e) => setNotifyUserPhone(e.target.value)}
                              placeholder="e.g. +923001234567"
                              style={{ fontSize: '11.5px', padding: '7px 10px', marginTop: 8 }}
                            />
                          )}
                        </div>

                        <button
                          type="submit"
                          disabled={closingBusy || closingServices.length === 0}
                          style={{
                            background: 'linear-gradient(135deg, #10b981, #059669)',
                            color: '#fff',
                            fontWeight: 800,
                            fontSize: '12.5px',
                            padding: '10px 14px',
                            borderRadius: 10,
                            border: 'none',
                            cursor: closingBusy || closingServices.length === 0 ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                            opacity: closingBusy || closingServices.length === 0 ? 0.6 : 1,
                          }}
                        >
                          {closingBusy ? <Loader2 size={14} className="spin" /> : <Trophy size={14} />}
                          Confirm Deal &amp; Notify
                        </button>
                      </div>
                    </div>
                  </form>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};
