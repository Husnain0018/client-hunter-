import {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  makeWASocket,
  proto,
  type ConnectionState,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import EventEmitter from 'node:events';
import pino from 'pino';
import type { Database } from '../db/database.js';
import type {
  BaileysAccountInfo,
  BaileysConnectionState,
  BaileysDiagnosticEntry,
  BaileysStatusInfo,
  WhatsAppStatus,
} from '../types/domain.js';
import {
  clearStoredAuthState,
  hasSavedSession,
  initPersistentAuthState,
} from './baileysAuthState.js';

const pinoLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' });

export interface IncomingAttachmentInfo {
  type: 'image' | 'video' | 'audio' | 'voice' | 'document' | 'location' | 'contact' | 'sticker';
  mimeType?: string;
  fileName?: string;
  caption?: string;
}

export interface IncomingBaileysMessage {
  id: string;
  from: string;
  rawJid?: string;
  text: string;
  timestamp?: string;
  pushName?: string;
  messageType?: string;
  attachments?: IncomingAttachmentInfo[];
  fromMe?: boolean;
  isHistoryAppend?: boolean;
}

export type IncomingMessageHandler = (msg: IncomingBaileysMessage) => Promise<void>;

const MAX_RECONNECT_ATTEMPTS = 6;
const MAX_QR_HANDSHAKE_RETRIES = 3;
const FALLBACK_WA_VERSION: [number, number, number] = [2, 3000, 1052342146];

let cachedWaVersion: [number, number, number] | null = null;
let cachedWaVersionFetchedAt = 0;

async function resolveWaWebVersion(): Promise<[number, number, number]> {
  if (process.env.NODE_ENV === 'test') {
    return FALLBACK_WA_VERSION;
  }
  const now = Date.now();
  if (cachedWaVersion && now - cachedWaVersionFetchedAt < 6 * 60 * 60 * 1000) {
    return cachedWaVersion;
  }
  try {
    const result = await Promise.race([
      fetchLatestWaWebVersion({}),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
    ]);
    if (result && Array.isArray(result.version) && result.version.length === 3) {
      cachedWaVersion = result.version as [number, number, number];
      cachedWaVersionFetchedAt = now;
      return cachedWaVersion;
    }
  } catch {
    // Use fallback on network error
  }
  return cachedWaVersion || FALLBACK_WA_VERSION;
}

export function normalizeToInternationalWhatsApp(raw: string): string {
  let digits = (raw || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  // Standard national prefix 0 (Pakistan 03xx, 055, 042, etc. - 10 to 11 digits)
  if (digits.startsWith('0') && (digits.length === 10 || digits.length === 11)) {
    digits = '92' + digits.slice(1);
  }
  return digits;
}

export class BaileysManager {
  private static instance: BaileysManager | null = null;

  private state: BaileysConnectionState = 'not_connected';
  private qr: string | null = null;
  private account: BaileysAccountInfo | null = null;
  private error: string | null = null;
  private reconnectAttempts = 0;
  private qrRetryCount = 0;
  private lastConnectedAt: string | null = null;

  private sock: WASocket | null = null;
  private connectingPromise: Promise<BaileysStatusInfo> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private intentionalDisconnect = false;
  private activeAttemptHadSavedSession = false;
  private userInitiatedConnect = false;
  private pairingInProgress = false;

  private clearAuthFn: (() => void) | null = null;
  private messageHandler: IncomingMessageHandler | null = null;
  private diagnostics: BaileysDiagnosticEntry[] = [];

  readonly events = new EventEmitter();

  constructor(private readonly db: Database) {
    this.events.setMaxListeners(100);
    if (hasSavedSession(this.db)) {
      this.state = 'disconnected';
      this.activeAttemptHadSavedSession = true;
    }
  }

  static getInstance(db: Database): BaileysManager {
    if (!BaileysManager.instance) {
      BaileysManager.instance = new BaileysManager(db);
    }
    return BaileysManager.instance;
  }

  setMessageHandler(handler: IncomingMessageHandler): void {
    this.messageHandler = handler;
  }

  private recordDiagnostic(event: string, detail?: string): void {
    const entry: BaileysDiagnosticEntry = {
      timestamp: new Date().toISOString(),
      event,
      state: this.state,
      detail,
    };
    this.diagnostics.push(entry);
    if (this.diagnostics.length > 50) {
      this.diagnostics.shift();
    }
    pinoLogger.info(entry, 'WhatsApp connection diagnostic');
  }

  getDiagnostics(): BaileysDiagnosticEntry[] {
    return [...this.diagnostics];
  }

  getStatus(): BaileysStatusInfo {
    const saved = hasSavedSession(this.db);
    return {
      state: this.state,
      qr: this.qr,
      account: this.account,
      error: this.error,
      reconnectAttempts: this.reconnectAttempts,
      lastConnectedAt: this.lastConnectedAt,
      isReady: this.state === 'connected' && Boolean(this.sock),
      hasSavedSession: saved,
      diagnostics: this.diagnostics.slice(-15),
    };
  }

  private emitStatus(): void {
    this.events.emit('status', this.getStatus());
  }

  /**
   * Waits until a QR code is generated, the session connects, or a terminal error occurs
   * (up to timeoutMs). Used by HTTP connect/restart endpoints so the caller gets the QR
   * immediately in the HTTP response as well as via SSE.
   */
  async waitForQrOrConnection(timeoutMs = 6000): Promise<BaileysStatusInfo> {
    if (
      process.env.NODE_ENV === 'test' ||
      (this.state === 'waiting_for_qr' && Boolean(this.qr)) ||
      this.state === 'connected' ||
      this.state === 'connection_failed' ||
      this.state === 'connection_error'
    ) {
      return this.getStatus();
    }

    return new Promise<BaileysStatusInfo>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.events.off('status', onStatus);
          resolve(this.getStatus());
        }
      }, timeoutMs);

      const onStatus = (status: BaileysStatusInfo) => {
        if (settled) return;
        if (
          (status.state === 'waiting_for_qr' && Boolean(status.qr)) ||
          status.state === 'connected' ||
          status.state === 'connection_failed' ||
          status.state === 'connection_error' ||
          status.state === 'session_expired'
        ) {
          settled = true;
          clearTimeout(timer);
          this.events.off('status', onStatus);
          resolve(status);
        }
      };

      this.events.on('status', onStatus);
    });
  }

  async connect(options?: { forceNewQr?: boolean; userInitiated?: boolean }): Promise<BaileysStatusInfo> {
    if (this.state === 'connected' && this.sock && !options?.forceNewQr) {
      return this.getStatus();
    }

    if (options?.userInitiated) {
      this.userInitiatedConnect = true;
      this.qrRetryCount = 0;
    }

    // If an active connection attempt is already in flight and we're not forcing a fresh QR reset,
    // return the in-flight promise to prevent conflicting duplicate sockets.
    if (this.connectingPromise && !options?.forceNewQr) {
      return this.connectingPromise;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.intentionalDisconnect = false;

    const shouldForceFresh =
      Boolean(options?.forceNewQr) ||
      this.state === 'session_expired' ||
      this.state === 'logged_out';

    if (shouldForceFresh && !this.pairingInProgress) {
      clearStoredAuthState(this.db);
      this.account = null;
      this.qr = null;
      this.reconnectAttempts = 0;
    }

    const hasSession = hasSavedSession(this.db);
    this.activeAttemptHadSavedSession = hasSession;
    this.state = hasSession ? 'connecting' : 'initializing';
    if (!options?.userInitiated && this.error?.includes('Generating a new QR code')) {
      // Preserve informational notice while auto-generating QR after expired session
    } else {
      this.error = null;
    }
    this.recordDiagnostic(
      hasSession ? 'connecting_saved_session' : 'initializing_qr_pairing',
      hasSession ? 'Restoring saved WhatsApp session' : 'Initializing fresh Baileys socket for QR pairing',
    );
    this.emitStatus();

    this.connectingPromise = (async () => {
      try {
        // Clean up any stale socket gracefully
        if (this.sock) {
          try {
            this.sock.ev.removeAllListeners('connection.update');
            this.sock.ev.removeAllListeners('creds.update');
            this.sock.ev.removeAllListeners('messages.upsert');
            this.sock.ev.removeAllListeners('messages.update');
            this.sock.ev.removeAllListeners('contacts.upsert');
            this.sock.ev.removeAllListeners('contacts.update');
            this.sock.ev.removeAllListeners('chats.upsert');
            this.sock.end(undefined);
          } catch {
            // ignore
          }
          this.sock = null;
          if (process.env.NODE_ENV !== 'test') {
            await new Promise((r) => setTimeout(r, 400));
          }
        }

        const [authResult, version] = await Promise.all([
          initPersistentAuthState(this.db, {
            forceFresh: (shouldForceFresh || !hasSession) && !this.pairingInProgress,
          }),
          resolveWaWebVersion(),
        ]);

        const { state, saveCreds, clearAuthState } = authResult;
        this.clearAuthFn = clearAuthState;

        const sock = makeWASocket({
          version,
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
          },
          logger: pinoLogger,
          printQRInTerminal: false,
          browser: Browsers.ubuntu('Chrome'),
          syncFullHistory: false,
          markOnlineOnConnect: false,
          connectTimeoutMs: 60_000,
          defaultQueryTimeoutMs: 60_000,
          keepAliveIntervalMs: 25_000,
          retryRequestDelayMs: 500,
          maxMsgRetryCount: 5,
        });

        this.sock = sock;

        sock.ev.on('creds.update', async () => {
          try {
            await saveCreds();
          } catch (err) {
            pinoLogger.error({ err }, 'Failed to persist Baileys credentials');
          }
        });

        sock.ev.on('connection.update', (update) => {
          this.handleConnectionUpdate(update);
        });

        sock.ev.on('messages.upsert', (upsert) => {
          void this.handleMessagesUpsert(upsert);
        });

        sock.ev.on('messages.update', (updates) => {
          void this.handleMessagesUpdate(updates);
        });

        sock.ev.on('contacts.upsert', (contacts) => {
          this.handleContactsOrChatsLidSync(contacts as any[]);
        });

        sock.ev.on('contacts.update', (contacts) => {
          this.handleContactsOrChatsLidSync(contacts as any[]);
        });

        sock.ev.on('chats.upsert', (chats) => {
          this.handleContactsOrChatsLidSync(chats as any[]);
        });

        sock.ev.on('messaging-history.set', async (history) => {
          try {
            if (history.contacts?.length || history.chats?.length) {
              this.handleContactsOrChatsLidSync([...(history.contacts || []), ...(history.chats || [])]);
            }
            if (history.messages && history.messages.length > 0) {
              await this.handleMessagesUpsert({
                messages: history.messages,
                type: 'append',
              });
            }
          } catch (err) {
            pinoLogger.error({ err }, 'Error processing Baileys messaging-history.set event');
          }
        });

        try {
          (sock.ev as any).on('lid-mapping.update', (mapping: any) => {
            if (mapping?.lid && mapping?.pn) {
              this.db.saveLidPhoneMapping(String(mapping.lid), String(mapping.pn));
            }
          });
        } catch {
          // Optional event in Baileys v7
        }

        return this.getStatus();
      } catch (err) {
        pinoLogger.error({ err }, 'Error during Baileys socket initialization');
        this.state = 'connection_failed';
        this.error = err instanceof Error ? err.message : 'Could not initialize WhatsApp connection.';
        this.recordDiagnostic('socket_init_error', this.error);
        this.emitStatus();
        throw err;
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  private handleConnectionUpdate(update: Partial<ConnectionState>): void {
    const { connection, lastDisconnect, qr, isNewLogin } = update;

    if (isNewLogin) {
      this.pairingInProgress = true;
      this.activeAttemptHadSavedSession = true;
      this.qr = null;
      this.state = 'connecting';
      this.error = null;
      this.recordDiagnostic('qr_scanned_authenticated', 'QR code scanned on phone; finalizing pairing');
      this.emitStatus();
    }

    if (qr) {
      const isRefresh = Boolean(this.qr);
      this.qr = qr;
      this.state = 'waiting_for_qr';
      this.error = null;
      this.recordDiagnostic(
        isRefresh ? 'qr_refreshed' : 'qr_generated',
        `Live pairing QR ${isRefresh ? 'rotated' : 'generated'} (${qr.length} chars)`,
      );
      this.emitStatus();
    }

    if (connection === 'connecting') {
      if (this.state !== 'waiting_for_qr') {
        this.state = this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting';
        this.emitStatus();
      }
    } else if (connection === 'open') {
      this.state = 'connected';
      this.qr = null;
      this.error = null;
      this.reconnectAttempts = 0;
      this.qrRetryCount = 0;
      this.pairingInProgress = false;
      this.userInitiatedConnect = false;
      this.activeAttemptHadSavedSession = true;
      this.lastConnectedAt = new Date().toISOString();

      const user = this.sock?.user;
      if (user) {
        const rawPhone = jidNormalizedUser(user.id).replace(/\D/g, '');
        this.account = {
          id: user.id,
          name: user.name || (user as any).notify || 'WhatsApp Account',
          phone: rawPhone ? `+${rawPhone}` : undefined,
        };
      }
      this.recordDiagnostic('connected', `Connected as ${this.account?.phone || this.account?.id || 'device'}`);
      this.emitStatus();
      this.events.emit('ready', this.getStatus());
    } else if (connection === 'close') {
      this.handleConnectionClose(lastDisconnect);
    }
  }

  private handleConnectionClose(lastDisconnect: { error?: Error | Boom; date?: Date } | undefined): void {
    const boomError = lastDisconnect?.error as Boom | undefined;
    const statusCode = boomError?.output?.statusCode;
    const errorMessage = lastDisconnect?.error?.message || 'Connection closed';

    pinoLogger.warn({ statusCode, message: errorMessage }, 'Baileys connection closed');

    if (this.intentionalDisconnect) {
      this.state = 'disconnected';
      this.qr = null;
      this.recordDiagnostic('disconnected_intentionally', 'User or server requested disconnect');
      this.emitStatus();
      return;
    }

    const isLoggedOut = statusCode === DisconnectReason.loggedOut;
    const isReplaced = statusCode === DisconnectReason.connectionReplaced;
    const isRestartRequired = statusCode === DisconnectReason.restartRequired;
    const hadSavedSession = this.activeAttemptHadSavedSession || hasSavedSession(this.db);

    if (isRestartRequired) {
      this.recordDiagnostic('restart_required', 'Baileys requested immediate restart after pairing');
      this.reconnectTimer = setTimeout(() => void this.connect(), 500);
      return;
    }

    if (isLoggedOut) {
      // Always clear invalid/unlinked credentials immediately so they never block future QR generation
      if (this.clearAuthFn) {
        this.clearAuthFn();
      } else {
        clearStoredAuthState(this.db);
      }
      this.activeAttemptHadSavedSession = false;
      this.pairingInProgress = false;
      this.account = null;

      if (hadSavedSession) {
        if (this.userInitiatedConnect) {
          // User clicked Connect/Reconnect and their old stored session was unlinked on phone:
          // Clear expired state and immediately start a clean pairing process to generate a fresh QR code!
          this.userInitiatedConnect = false;
          this.state = 'initializing';
          this.qr = null;
          this.error = 'Previous WhatsApp session was unlinked on your phone. Generating a new QR code to connect...';
          this.recordDiagnostic(
            'session_expired_auto_qr',
            'Saved session was revoked on phone; cleared stale credentials and starting fresh QR pairing',
          );
          this.emitStatus();
          this.reconnectTimer = setTimeout(() => {
            void this.connect({ forceNewQr: true });
          }, 300);
          return;
        }

        // Session expired while running in background
        this.state = 'session_expired';
        this.qr = null;
        this.error =
          'WhatsApp session expired or was unlinked on your phone. Click Connect WhatsApp to generate a new QR code.';
        this.recordDiagnostic('session_expired', 'Existing session unlinked on phone; cleared expired credentials');
        this.emitStatus();
        return;
      }

      // No saved session existed: 401 occurred during initial registration/QR handshake.
      // Never misclassify an unregistered handshake failure as "session_expired".
      if (this.qrRetryCount < MAX_QR_HANDSHAKE_RETRIES) {
        this.qrRetryCount++;
        this.state = 'initializing';
        this.qr = null;
        this.error = null;
        this.recordDiagnostic(
          'qr_handshake_retry',
          `Registration handshake rejected (401); retrying fresh QR generation (${this.qrRetryCount}/${MAX_QR_HANDSHAKE_RETRIES})`,
        );
        this.emitStatus();
        this.reconnectTimer = setTimeout(() => {
          void this.connect({ forceNewQr: true });
        }, 800);
      } else {
        this.state = 'connection_failed';
        this.qr = null;
        this.error =
          'Could not generate a WhatsApp QR code after multiple attempts. Please click Connect WhatsApp to try again.';
        this.recordDiagnostic('connection_failed', 'Exhausted registration handshake retries');
        this.emitStatus();
      }
      return;
    }

    if (isReplaced) {
      this.state = 'temporarily_disconnected';
      this.qr = null;
      this.error = 'WhatsApp session momentarily replaced or conflicted. Reconnecting cleanly...';
      this.recordDiagnostic('connection_replaced', 'Session replaced; reconnecting in 3s');
      this.emitStatus();
      this.reconnectTimer = setTimeout(() => void this.connect(), 3000);
      return;
    }

    // If no saved session exists (unregistered socket for QR pairing), handle QR timeout / handshake drops
    if (!hadSavedSession && !this.pairingInProgress) {
      if (statusCode === DisconnectReason.timedOut && this.qr !== null) {
        if (this.qrRetryCount < MAX_QR_HANDSHAKE_RETRIES) {
          this.qrRetryCount++;
          this.recordDiagnostic(
            'qr_cycle_refresh',
            `QR rotation cycle ended; generating fresh QR session (${this.qrRetryCount}/${MAX_QR_HANDSHAKE_RETRIES})`,
          );
          this.reconnectTimer = setTimeout(() => {
            void this.connect({ forceNewQr: true });
          }, 500);
        } else {
          this.state = 'disconnected';
          this.qr = null;
          this.error = 'QR code expired before it was scanned. Click Connect WhatsApp to generate a new QR code.';
          this.recordDiagnostic('qr_timeout', 'QR code scan timed out');
          this.emitStatus();
        }
        return;
      }

      if (this.qrRetryCount < MAX_QR_HANDSHAKE_RETRIES) {
        this.qrRetryCount++;
        this.state = 'initializing';
        this.recordDiagnostic(
          'qr_init_retry',
          `Socket closed (${statusCode || 'unknown'}) during QR setup; retrying (${this.qrRetryCount}/${MAX_QR_HANDSHAKE_RETRIES})`,
        );
        this.emitStatus();
        this.reconnectTimer = setTimeout(() => {
          void this.connect({ forceNewQr: true });
        }, 1000);
      } else {
        this.state = 'connection_failed';
        this.qr = null;
        this.error = `Could not establish WhatsApp QR connection (${errorMessage}). Click Connect WhatsApp to retry.`;
        this.recordDiagnostic('connection_failed', errorMessage);
        this.emitStatus();
      }
      return;
    }

    // Transient disconnect on an authenticated session: schedule automatic reconnection with exponential backoff
    this.scheduleReconnect(errorMessage);
  }

  private scheduleReconnect(errorMessage?: string): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Exponential backoff: 2s, 3s, 5s, 8s, 15s... max 60s
    const delayMs = Math.min(2000 * Math.pow(1.5, Math.min(this.reconnectAttempts, 8)), 60_000);
    this.reconnectAttempts++;
    this.state = this.reconnectAttempts > 3 ? 'temporarily_disconnected' : 'reconnecting';
    this.error = `Connection lost${errorMessage ? ` (${errorMessage})` : ''}. Reconnecting in ${Math.round(delayMs / 1000)}s (attempt ${this.reconnectAttempts})...`;
    this.recordDiagnostic('reconnecting', `Scheduled reconnect attempt ${this.reconnectAttempts} in ${Math.round(delayMs / 1000)}s`);
    this.emitStatus();

    this.reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delayMs);
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.userInitiatedConnect = false;
    this.pairingInProgress = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignore
      }
      this.sock = null;
    }

    this.state = 'disconnected';
    this.qr = null;
    this.error = null;
    this.recordDiagnostic('disconnected', 'Disconnected socket while preserving any saved credentials');
    this.emitStatus();
  }

  async logout(): Promise<void> {
    this.intentionalDisconnect = true;
    this.userInitiatedConnect = false;
    this.pairingInProgress = false;
    this.activeAttemptHadSavedSession = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        try {
          this.sock.end(undefined);
        } catch {
          // ignore
        }
      }
      this.sock = null;
    }

    if (this.clearAuthFn) {
      this.clearAuthFn();
    } else {
      clearStoredAuthState(this.db);
    }

    this.state = 'logged_out';
    this.qr = null;
    this.account = null;
    this.error = null;
    this.reconnectAttempts = 0;
    this.qrRetryCount = 0;
    this.recordDiagnostic('logged_out', 'Logged out and cleared saved session credentials');
    this.emitStatus();
  }

  async destroy(): Promise<void> {
    this.intentionalDisconnect = true;
    this.userInitiatedConnect = false;
    this.pairingInProgress = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.end(undefined);
      } catch {
        // ignore
      }
      this.sock = null;
    }
  }

  async restart(options?: { forceNewQr?: boolean; userInitiated?: boolean }): Promise<BaileysStatusInfo> {
    const wasExpiredOrLoggedOut =
      Boolean(options?.forceNewQr) ||
      this.state === 'session_expired' ||
      this.state === 'logged_out' ||
      !hasSavedSession(this.db);
    await this.disconnect();
    this.reconnectAttempts = 0;
    this.qrRetryCount = 0;
    return this.connect({
      forceNewQr: wasExpiredOrLoggedOut,
      userInitiated: options?.userInitiated ?? true,
    });
  }

  async sendTextMessage(
    numberOrJid: string,
    text: string
  ): Promise<{ providerMessageId: string; status: WhatsAppStatus }> {
    if (this.state !== 'connected' || !this.sock) {
      throw new Error('WhatsApp is not connected. Open the WhatsApp page and scan the QR code to connect.');
    }

    const cleanText = text.trim();
    if (!cleanText) {
      throw new Error('Message text cannot be empty.');
    }

    // Support sending to @lid contacts (resolving to phone number if known, or sending directly to @lid)
    const isLidTarget = numberOrJid.toLowerCase().includes('@lid');
    const resolvedFromLid = isLidTarget ? this.db.resolvePhoneFromLid(numberOrJid) : null;
    const effectiveInput = resolvedFromLid || numberOrJid;

    if (isLidTarget && !resolvedFromLid) {
      const targetLidJid = jidNormalizedUser(numberOrJid);
      const sent = await this.sock.sendMessage(targetLidJid, { text: cleanText });
      const providerMessageId = sent?.key?.id || `baileys_${Date.now()}`;
      return {
        providerMessageId,
        status: 'Sent',
      };
    }

    const cleanDigits = normalizeToInternationalWhatsApp(effectiveInput);
    if (cleanDigits.length < 8 || cleanDigits.length > 15) {
      throw new Error(`Invalid WhatsApp number +${cleanDigits}. Expected 8-15 digits with country code.`);
    }

    // Verify WhatsApp registration and capture any LID mapping returned by WhatsApp
    let targetJid = `${cleanDigits}@s.whatsapp.net`;
    try {
      const results = await this.sock.onWhatsApp(cleanDigits);
      if (Array.isArray(results) && results.length > 0) {
        const found = results[0] as any;
        if (found && !found.exists) {
          throw new Error(`Number +${cleanDigits} is not registered on WhatsApp.`);
        }
        if (found?.jid) {
          targetJid = found.jid;
        }
        if (found?.lid) {
          this.db.saveLidPhoneMapping(String(found.lid), cleanDigits);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('not registered')) {
        throw err;
      }
      // Transient verification issue; fallback to default JID
    }

    const sent = await this.sock.sendMessage(targetJid, { text: cleanText });
    const providerMessageId = sent?.key?.id || `baileys_${Date.now()}`;

    // Proactively query and save LID mapping for this contact so replies via @lid match seamlessly
    try {
      const lidRepo = (this.sock as any).signalRepository?.lidMapping;
      if (lidRepo && typeof lidRepo.getLIDForPN === 'function') {
        const lidJid = await lidRepo.getLIDForPN(targetJid);
        if (lidJid) {
          this.db.saveLidPhoneMapping(String(lidJid), cleanDigits);
        }
      }
    } catch {
      // ignore
    }

    return {
      providerMessageId,
      status: 'Sent',
    };
  }

  private handleContactsOrChatsLidSync(items: any[]): void {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof item.id === 'string' ? item.id : '';
      const lid = typeof item.lid === 'string' ? item.lid : '';
      const phone = typeof item.phoneNumber === 'string' ? item.phoneNumber : '';

      if (lid && id.includes('@s.whatsapp.net')) {
        this.db.saveLidPhoneMapping(lid, id);
      } else if (id.includes('@lid') && phone) {
        this.db.saveLidPhoneMapping(id, phone);
      } else if (lid && phone) {
        this.db.saveLidPhoneMapping(lid, phone);
      }
    }
  }

  /**
   * Unwraps nested WhatsApp message containers (ephemeral, viewOnce, documentWithCaption, editedMessage)
   * and extracts clean text, messageType, and attachment metadata for all supported WhatsApp message types.
   */
  public extractIncomingContent(rawMessage: proto.IMessage | null | undefined): {
    text: string;
    messageType: string;
    attachments: IncomingAttachmentInfo[];
    isNonChatProtocol: boolean;
  } {
    if (!rawMessage) {
      return { text: '', messageType: 'unknown', attachments: [], isNonChatProtocol: true };
    }

    let content: proto.IMessage = rawMessage;
    for (let depth = 0; depth < 6; depth++) {
      if (content.ephemeralMessage?.message) {
        content = content.ephemeralMessage.message;
      } else if (content.viewOnceMessage?.message) {
        content = content.viewOnceMessage.message;
      } else if (content.viewOnceMessageV2?.message) {
        content = content.viewOnceMessageV2.message;
      } else if (content.viewOnceMessageV2Extension?.message) {
        content = content.viewOnceMessageV2Extension.message;
      } else if (content.documentWithCaptionMessage?.message) {
        content = content.documentWithCaptionMessage.message;
      } else if (content.editedMessage?.message) {
        content = content.editedMessage.message;
      } else if (content.protocolMessage?.editedMessage) {
        content = content.protocolMessage.editedMessage;
      } else if (content.deviceSentMessage?.message) {
        content = content.deviceSentMessage.message;
      } else {
        break;
      }
    }

    // Ignore pure protocol/system messages (key distribution, history sync notifications, reactions-only)
    if (
      (content.protocolMessage && !content.protocolMessage.editedMessage) ||
      content.senderKeyDistributionMessage ||
      content.reactionMessage ||
      content.keepInChatMessage
    ) {
      // Only skip if there is no actual conversation/media alongside senderKeyDistributionMessage
      const hasActualMessage =
        Boolean(content.conversation) ||
        Boolean(content.extendedTextMessage) ||
        Boolean(content.imageMessage) ||
        Boolean(content.videoMessage) ||
        Boolean(content.audioMessage) ||
        Boolean(content.documentMessage) ||
        Boolean(content.locationMessage) ||
        Boolean(content.contactMessage) ||
        Boolean(content.buttonsResponseMessage) ||
        Boolean(content.listResponseMessage) ||
        Boolean(content.templateButtonReplyMessage) ||
        Boolean(content.interactiveResponseMessage);
      if (!hasActualMessage) {
        return { text: '', messageType: 'protocol', attachments: [], isNonChatProtocol: true };
      }
    }

    const attachments: IncomingAttachmentInfo[] = [];

    if (typeof content.conversation === 'string' && content.conversation.trim()) {
      const txt = content.conversation.trim();
      return {
        text: txt,
        messageType: /https?:\/\//i.test(txt) ? 'link' : 'text',
        attachments,
        isNonChatProtocol: false,
      };
    }

    if (content.extendedTextMessage?.text && content.extendedTextMessage.text.trim()) {
      const txt = content.extendedTextMessage.text.trim();
      const isLink =
        /https?:\/\//i.test(txt) ||
        Boolean(content.extendedTextMessage.matchedText || (content.extendedTextMessage as any).canonicalUrl);
      return {
        text: txt,
        messageType: isLink ? 'link' : 'text',
        attachments,
        isNonChatProtocol: false,
      };
    }

    if (content.imageMessage) {
      const caption = (content.imageMessage.caption || '').trim();
      attachments.push({
        type: 'image',
        mimeType: content.imageMessage.mimetype || 'image/jpeg',
        caption: caption || undefined,
      });
      return {
        text: caption || '[📷 Image received]',
        messageType: 'image',
        attachments,
        isNonChatProtocol: false,
      };
    }

    if (content.documentMessage) {
      const caption = (content.documentMessage.caption || '').trim();
      const fileName = content.documentMessage.fileName || content.documentMessage.title || 'Document';
      attachments.push({
        type: 'document',
        mimeType: content.documentMessage.mimetype || 'application/octet-stream',
        fileName,
        caption: caption || undefined,
      });
      return {
        text: caption ? `[📄 ${fileName}] ${caption}` : `[📄 Document received: ${fileName}]`,
        messageType: 'document',
        attachments,
        isNonChatProtocol: false,
      };
    }

    if (content.audioMessage) {
      const isVoice = Boolean(content.audioMessage.ptt);
      const secs = content.audioMessage.seconds ? ` (${content.audioMessage.seconds}s)` : '';
      attachments.push({
        type: isVoice ? 'voice' : 'audio',
        mimeType: content.audioMessage.mimetype || 'audio/ogg',
      });
      return {
        text: isVoice ? `[🎤 Voice note received${secs}]` : `[🎵 Audio message received${secs}]`,
        messageType: isVoice ? 'voice' : 'audio',
        attachments,
        isNonChatProtocol: false,
      };
    }

    if (content.videoMessage) {
      const caption = (content.videoMessage.caption || '').trim();
      attachments.push({
        type: 'video',
        mimeType: content.videoMessage.mimetype || 'video/mp4',
        caption: caption || undefined,
      });
      return {
        text: caption || '[🎥 Video received]',
        messageType: 'video',
        attachments,
        isNonChatProtocol: false,
      };
    }

    if (content.locationMessage) {
      const locName =
        content.locationMessage.name ||
        content.locationMessage.address ||
        `${content.locationMessage.degreesLatitude ?? ''}, ${content.locationMessage.degreesLongitude ?? ''}`;
      attachments.push({ type: 'location', caption: locName });
      return {
        text: `[📍 Location shared: ${locName}]`,
        messageType: 'location',
        attachments,
        isNonChatProtocol: false,
      };
    }

    if (content.stickerMessage) {
      attachments.push({ type: 'sticker', mimeType: content.stickerMessage.mimetype || 'image/webp' });
      return {
        text: '[Sticker received]',
        messageType: 'sticker',
        attachments,
        isNonChatProtocol: false,
      };
    }

    if (content.contactMessage) {
      const name = content.contactMessage.displayName || 'Contact Card';
      attachments.push({ type: 'contact', caption: name });
      return {
        text: `[👤 Contact shared: ${name}]`,
        messageType: 'contact',
        attachments,
        isNonChatProtocol: false,
      };
    }

    if (content.contactsArrayMessage) {
      const contacts = content.contactsArrayMessage.contacts || [];
      const first = contacts[0]?.displayName || 'Contacts';
      attachments.push({ type: 'contact', caption: `${first} (${contacts.length})` });
      return {
        text: `[👤 Contact card(s) shared: ${first}]`,
        messageType: 'contact',
        attachments,
        isNonChatProtocol: false,
      };
    }

    const interactiveText =
      content.buttonsResponseMessage?.selectedDisplayText ||
      content.buttonsResponseMessage?.selectedButtonId ||
      content.listResponseMessage?.title ||
      content.listResponseMessage?.description ||
      content.templateButtonReplyMessage?.selectedDisplayText ||
      content.templateButtonReplyMessage?.selectedId ||
      content.interactiveResponseMessage?.body?.text ||
      '';

    if (interactiveText.trim()) {
      return {
        text: interactiveText.trim(),
        messageType: 'interactive',
        attachments,
        isNonChatProtocol: false,
      };
    }

    return { text: '', messageType: 'unknown', attachments: [], isNonChatProtocol: true };
  }

  /**
   * Resolves a Baileys WAMessageKey to a normalized phone number and JID,
   * automatically translating Baileys v7 `@lid` JIDs via `remoteJidAlt`, `participantAlt`, `senderPn`,
   * `sock.signalRepository.lidMapping`, and `baileys_auth` reverse LID mappings.
   */
  public async resolveMessageSender(key: proto.IMessageKey & Record<string, any>): Promise<{
    phoneDigits: string;
    normalizedJid: string;
    rawRemoteJid: string;
  }> {
    const rawRemoteJid = String(key.remoteJid || '');
    const remoteJidAlt = String(key.remoteJidAlt || key.senderPn || key.participantAlt || '');

    // Persist LID <-> Phone mapping whenever both are present on the message key
    if (rawRemoteJid.endsWith('@lid') && remoteJidAlt.includes('@s.whatsapp.net')) {
      this.db.saveLidPhoneMapping(rawRemoteJid, remoteJidAlt);
    } else if (rawRemoteJid.includes('@s.whatsapp.net') && remoteJidAlt.endsWith('@lid')) {
      this.db.saveLidPhoneMapping(remoteJidAlt, rawRemoteJid);
    }

    // 1. If either rawRemoteJid or remoteJidAlt is a phone JID (@s.whatsapp.net), extract phone directly
    if (rawRemoteJid.includes('@s.whatsapp.net')) {
      const norm = jidNormalizedUser(rawRemoteJid);
      const digits = normalizeToInternationalWhatsApp(norm.split('@')[0]);
      return { phoneDigits: digits, normalizedJid: norm, rawRemoteJid };
    }

    if (remoteJidAlt.includes('@s.whatsapp.net')) {
      const norm = jidNormalizedUser(remoteJidAlt);
      const digits = normalizeToInternationalWhatsApp(norm.split('@')[0]);
      return { phoneDigits: digits, normalizedJid: norm, rawRemoteJid };
    }

    // 2. If rawRemoteJid is a @lid JID, resolve via SQLite baileys_auth or Baileys signalRepository.lidMapping
    if (rawRemoteJid.endsWith('@lid')) {
      let resolvedPhone = this.db.resolvePhoneFromLid(rawRemoteJid);
      if (!resolvedPhone && this.sock) {
        try {
          const lidRepo = (this.sock as any).signalRepository?.lidMapping;
          if (lidRepo && typeof lidRepo.getPNForLID === 'function') {
            const pnJid = await lidRepo.getPNForLID(rawRemoteJid);
            if (pnJid) {
              resolvedPhone = normalizeToInternationalWhatsApp(String(pnJid).split('@')[0]);
              if (resolvedPhone) {
                this.db.saveLidPhoneMapping(rawRemoteJid, resolvedPhone);
              }
            }
          }
        } catch {
          // ignore
        }
      }

      if (resolvedPhone) {
        const clean = normalizeToInternationalWhatsApp(resolvedPhone);
        return {
          phoneDigits: clean,
          normalizedJid: `${clean}@s.whatsapp.net`,
          rawRemoteJid,
        };
      }
    }

    const normalizedJid = jidNormalizedUser(rawRemoteJid);
    const fallbackDigits = normalizedJid.split('@')[0].replace(/\D/g, '');
    return {
      phoneDigits: fallbackDigits,
      normalizedJid,
      rawRemoteJid,
    };
  }

  private async handleMessagesUpsert(upsert: {
    messages: proto.IWebMessageInfo[];
    type: string;
  }): Promise<void> {
    const isHistoryAppend = upsert.type && upsert.type.toLowerCase() !== 'notify';

    // Sort chronologically so multiple missed messages from offline periods are processed in order
    const sortedMessages = [...(upsert.messages || [])].sort((a, b) => {
      const tsA = Number(a.messageTimestamp || 0);
      const tsB = Number(b.messageTimestamp || 0);
      return tsA - tsB;
    });

    for (const msg of sortedMessages) {
      if (!msg.key || !msg.message) continue;

      const rawRemoteJid = msg.key.remoteJid || '';
      // Filter out status broadcasts, broadcast lists, newsletters, and group chats
      if (
        !rawRemoteJid ||
        rawRemoteJid === 'status@broadcast' ||
        rawRemoteJid.endsWith('@broadcast') ||
        rawRemoteJid.endsWith('@g.us') ||
        rawRemoteJid.endsWith('@newsletter')
      ) {
        continue;
      }

      const messageId = msg.key.id || '';
      if (!messageId) continue;

      // Idempotent processing check (check only; let messageHandler mark processed AFTER saving)
      if (this.db.isWebhookProcessed(messageId)) continue;

      const extracted = this.extractIncomingContent(msg.message);
      if (extracted.isNonChatProtocol || !extracted.text.trim()) continue;

      const { phoneDigits, normalizedJid } = await this.resolveMessageSender(
        msg.key as proto.IMessageKey & Record<string, any>,
      );

      // Ignore self-chat messages sent to own WhatsApp number/LID
      const ownPhone = (this.account?.phone || '').replace(/\D/g, '');
      const ownIdDigits = (this.account?.id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
      if (msg.key.fromMe) {
        // If fromMe is true and it's to our own number/LID, skip
        if (
          (ownPhone && phoneDigits === ownPhone) ||
          (ownIdDigits && phoneDigits === ownIdDigits) ||
          rawRemoteJid.includes(ownIdDigits || '___none___')
        ) {
          continue;
        }
      }

      const timestamp = msg.messageTimestamp
        ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
        : new Date().toISOString();

      const pushName =
        (!msg.key.fromMe && (msg.pushName || (msg as any).verifiedBizName)) || undefined;

      const payload = {
        id: messageId,
        from: phoneDigits,
        rawJid: normalizedJid,
        text: extracted.text,
        timestamp,
        pushName: pushName ? String(pushName).trim() : undefined,
        messageType: extracted.messageType,
        attachments: extracted.attachments.length > 0 ? extracted.attachments : undefined,
        fromMe: Boolean(msg.key.fromMe),
        isHistoryAppend: Boolean(isHistoryAppend),
      };

      this.recordDiagnostic(
        msg.key.fromMe ? 'outbound_phone_message_synced' : 'incoming_message_received',
        `Msg ${messageId} (${extracted.messageType}) ${msg.key.fromMe ? 'to' : 'from'} ${phoneDigits || normalizedJid}`,
      );

      if (this.messageHandler) {
        try {
          await this.messageHandler(payload);
        } catch (err) {
          pinoLogger.error({ err, messageId }, 'Failed in incoming WhatsApp message handler');
        }
      }

      this.events.emit('incoming_message', payload);
    }
  }

  private async handleMessagesUpdate(
    updates: Array<{ key: proto.IMessageKey; update: { status?: proto.WebMessageInfo.Status | null } }>
  ): Promise<void> {
    for (const item of updates) {
      const id = item.key.id;
      if (!id || item.update.status === undefined || item.update.status === null) continue;

      const statusMap: Record<number, WhatsAppStatus> = {
        [proto.WebMessageInfo.Status.ERROR]: 'Failed',
        [proto.WebMessageInfo.Status.PENDING]: 'Pending',
        [proto.WebMessageInfo.Status.SERVER_ACK]: 'Sent',
        [proto.WebMessageInfo.Status.DELIVERY_ACK]: 'Delivered',
        [proto.WebMessageInfo.Status.READ]: 'Read',
        [proto.WebMessageInfo.Status.PLAYED]: 'Played',
      };

      const mapped = statusMap[item.update.status];
      if (mapped) {
        this.db.updateWhatsAppStatusByProviderId(id, mapped);
        const leadId = this.db.getLeadIdByProviderMessageId(id) || undefined;
        this.events.emit('message_status', { providerMessageId: id, status: mapped, leadId });
      }
    }
  }
}
