import { CdpProxyClient } from './cdp-proxy.client';

describe('CdpProxyClient timeouts', () => {
  const originalTimeout = process.env.CDP_PROXY_TIMEOUT_MS;

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
});
