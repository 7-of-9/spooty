import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export interface ChromeConnectionState {
  state: 'connected' | 'connecting' | 'disconnected' | 'unavailable';
  connectedAt: string | null;
}

const PROXY = process.env.CDP_PROXY_URL || 'http://127.0.0.1:17331';
const DEFAULT_TIMEOUT_MS = 35_000;

function timeoutMs(): number {
  const configured = Number(process.env.CDP_PROXY_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 100
    ? Math.floor(configured)
    : DEFAULT_TIMEOUT_MS;
}

@Injectable()
export class CdpProxyClient {
  private readonly logger = new Logger(CdpProxyClient.name);
  private connectionAttempt: Promise<ChromeConnectionState> | null = null;

  private async request(
    path: string,
    init: RequestInit = {},
    limit = timeoutMs(),
  ): Promise<{ response: Response; body: any }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    try {
      const response = await fetch(`${PROXY}${path}`, {
        ...init,
        signal: controller.signal,
      });
      // Keep the deadline through the response body too, not only headers.
      return { response, body: await response.json() };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`CDP proxy ${path} timed out after ${limit}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async healthy(): Promise<boolean> {
    return (await this.connectionState()).state === 'connected';
  }

  async connectionState(): Promise<ChromeConnectionState> {
    try {
      const { response, body } = await this.request('/health', {}, Math.min(timeoutMs(), 3000));
      if (!response.ok || typeof body?.connected !== 'boolean') throw new Error('Invalid bridge health');
      return {
        state: body.connected ? 'connected' : body.connecting ? 'connecting' : 'disconnected',
        connectedAt: body.connected && typeof body.connectedAt === 'string' ? body.connectedAt : null,
      };
    } catch {
      return { state: 'unavailable', connectedAt: null };
    }
  }

  /** Called only by the explicit, scope-confirmed user action. Never by health,
   * sync, timers, startup, or failure recovery. No retry operator belongs here. */
  connectOnce(): Promise<ChromeConnectionState> {
    if (this.connectionAttempt) return this.connectionAttempt;
    this.connectionAttempt = this.requestOneConnection().finally(() => {
      this.connectionAttempt = null;
    });
    return this.connectionAttempt;
  }

  private async requestOneConnection(): Promise<ChromeConnectionState> {
    const before = await this.connectionState();
    if (before.state === 'connected' || before.state === 'connecting') return before;
    if (before.state === 'unavailable') throw new ServiceUnavailableException('Chrome bridge is unavailable. Start the existing bridge; no Chrome connection was requested.');
    try {
      const { response, body } = await this.request('/connect', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'allow-one-chrome-connection' }),
      }, 125000);
      if (!response.ok || body?.connected !== true) throw new Error('Chrome did not accept the connection');
      return await this.connectionState();
    } catch {
      throw new ServiceUnavailableException('Chrome connection was not completed. No automatic retry will be made.');
    }
  }

  async tab(): Promise<{ targetId: string; sessionId: string }> {
    const { response, body } = await this.request('/tab');
    if (!response.ok) {
      throw new Error(`CDP proxy /tab ${response.status}`);
    }
    return body;
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<any> {
    const { response, body: msg } = await this.request('/cdp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params, sessionId }),
    });
    if (!response.ok) throw new Error(msg?.error || `CDP ${method} failed`);
    if (msg.error) throw new Error(JSON.stringify(msg.error));
    return msg.result ?? msg;
  }

  async evaluate(targetId: string, expression: string): Promise<any> {
    const { response, body } = await this.request('/eval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId, expression }),
    });
    if (!response.ok) throw new Error(body?.error || 'CDP eval failed');
    return body.value;
  }
}
