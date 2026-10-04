import { CdpProxyClient } from './cdp-proxy.client';
import { describe, it, expect, jest, afterEach, beforeEach } from '@jest/globals';

describe('CdpProxyClient timeouts', () => {
  const originalTimeout = process.env.CDP_PROXY_TIMEOUT_MS;
  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalTimeout === undefined) delete process.env.CDP_PROXY_TIMEOUT_MS;
    else process.env.CDP_PROXY_TIMEOUT_MS = originalTimeout;
  });

  it('returns unhealthy instead of hanging on a half-open bridge', async () => {
    jest.useFakeTimers();
    process.env.CDP_PROXY_TIMEOUT_MS = '100';
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const client = new CdpProxyClient();

    const pending = client.healthy();
    await jest.advanceTimersByTimeAsync(101);

    expect(await pending).toBe(false);
  });

  it('fails a bridge operation with a bounded, useful timeout error', async () => {
    jest.useFakeTimers();
    process.env.CDP_PROXY_TIMEOUT_MS = '100';
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const client = new CdpProxyClient();

    const pending = client.tab().then(
      () => null,
      (error) => error as Error,
    );
    await jest.advanceTimersByTimeAsync(101);

    expect((await pending)?.message).toBe(
      'CDP proxy /tab timed out after 100ms',
    );
  });

  it('bounds a stalled health response body, not just the headers', async () => {
    jest.useFakeTimers();
    process.env.CDP_PROXY_TIMEOUT_MS = '100';
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
      new Response(new ReadableStream({ start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
      } })),
    );
    const result = new CdpProxyClient().connectionState();
    await jest.advanceTimersByTimeAsync(101);
    expect((await result).state).toBe('unavailable');
  });

  it('reads health without connecting and does not expose session/endpoint metadata', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      connected: false, connecting: false, endpoint: 'private endpoint', pid: 123, connectedAt: 'stale time',
    })));
    expect(await new CdpProxyClient().connectionState()).toEqual({ state: 'disconnected', connectedAt: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/health$/);
  });

  it('shares concurrent explicitly requested connections and never starts Spotify or download work', async () => {
    let connected = false;
    let finish!: () => void;
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/health')) return new Response(JSON.stringify({ connected, connecting: false, connectedAt: connected ? '2026-09-15T00:00:00Z' : null }));
      if (String(url).endsWith('/connect')) {
        await new Promise<void>(resolve => { finish = resolve; });
        connected = true;
        return new Response(JSON.stringify({ connected: true }));
      }
      throw new Error('Unexpected endpoint');
    });
    const client = new CdpProxyClient();
    const a = client.connectOnce();
    const b = client.connectOnce();
    expect(a).toBe(b);
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    finish();
    expect((await a).state).toBe('connected');
    await b;
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0][1]?.body).toBe(JSON.stringify({ confirm: 'allow-one-chrome-connection' }));
  });

  it.each([true, false])('does not request another connection when connected=%s or approval is pending', async (connected) => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ connected, connecting: !connected })));
    expect((await new CdpProxyClient().connectOnce()).state).toBe(connected ? 'connected' : 'connecting');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not POST a connection when the existing bridge is unavailable', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(new CdpProxyClient().connectOnce()).rejects.toThrow(/bridge is unavailable/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry a denied or failed connection', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async url =>
      String(url).endsWith('/health')
        ? new Response(JSON.stringify({ connected: false, connecting: false }))
        : new Response(JSON.stringify({ error: 'denied' }), { status: 503 }),
    );
    await expect(new CdpProxyClient().connectOnce()).rejects.toThrow(/No automatic retry/);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});
