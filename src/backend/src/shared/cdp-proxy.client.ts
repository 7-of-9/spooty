import { Injectable, Logger } from '@nestjs/common';

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

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const limit = timeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    try {
      return await fetch(`${PROXY}${path}`, {
        ...init,
        signal: controller.signal,
      });
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
    try {
      const res = await this.request('/health');
      if (!res.ok) return false;
      const body = (await res.json()) as { connected?: boolean };
      return !!body.connected;
    } catch {
      return false;
    }
  }

  async tab(): Promise<{ targetId: string; sessionId: string }> {
    const res = await this.request('/tab');
    if (!res.ok) {
      throw new Error(`CDP proxy /tab ${res.status}`);
    }
    return res.json() as Promise<{ targetId: string; sessionId: string }>;
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<any> {
    const res = await this.request('/cdp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params, sessionId }),
    });
    const msg = await res.json();
    if (!res.ok) throw new Error(msg?.error || `CDP ${method} failed`);
    if (msg.error) throw new Error(JSON.stringify(msg.error));
    return msg.result ?? msg;
  }

  async evaluate(targetId: string, expression: string): Promise<any> {
    const res = await this.request('/eval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetId, expression }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error || 'CDP eval failed');
    return body.value;
  }
}
