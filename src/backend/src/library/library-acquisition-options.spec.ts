import { expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { LibraryController } from './library.controller';

describe('web acquisition option contract', () => {
  const service = {
    download: jest.fn().mockResolvedValue({ queued: 0, skipped: 0 }),
    downloadRemaining: jest.fn().mockResolvedValue({ queued: 0, skipped: 0 }),
    downloadRequestStatus: jest.fn(),
  };
  beforeEach(() => jest.clearAllMocks());
  it('forwards depth/retry controls to focused and remaining workflows', async () => {
    const controller = new LibraryController(service as any);
    await controller.download({
      uris: ['spotify:playlist:fixture'],
      maxSearches: 25,
      networkRetries: 3,
      retryErrors: true,
    });
    expect(service.download).toHaveBeenCalledWith(
      ['spotify:playlist:fixture'],
      {
        maxSearches: 25,
        networkRetries: 3,
        retryErrors: true,
        retryMissing: false,
        retryNoCandidate: false,
      },
    );
    await controller.downloadRemaining({
      maxSearches: 50,
      networkRetries: 0,
      retryNoCandidate: true,
    });
    expect(service.downloadRemaining).toHaveBeenCalledWith({
      maxSearches: 50,
      networkRetries: 0,
      retryNoCandidate: true,
    });
  });
  it.each([
    { maxSearches: '10' },
    { maxSearches: true },
    { maxSearches: 51 },
    { networkRetries: -1 },
    { networkRetries: 1.5 },
    { retryErrors: 'true' },
    { retryMissing: 1 },
    { typo: 10 },
    { uris: 'fixture' },
  ])('rejects invalid input with400 before service calls: %j', (body) => {
    expect(() =>
      new LibraryController(service as any).download(body as any),
    ).toThrow(BadRequestException);
    expect(service.download).not.toHaveBeenCalled();
  });
  it('normal download sends no retry permission', async () => {
    await new LibraryController(service as any).download({ uris: [] });
    expect(service.download.mock.calls[0][1]).toMatchObject({
      retryErrors: false,
      retryMissing: false,
      retryNoCandidate: false,
    });
  });

  it('forwards a valid HTTP request ID separately from acquisition policy', async () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const controller = new LibraryController(service as any);
    await controller.download({ uris: ['spotify:playlist:fixture'], maxSearches: 10 }, id);
    expect(service.download).toHaveBeenCalledWith(['spotify:playlist:fixture'], expect.objectContaining({ maxSearches: 10 }), id);
    await controller.downloadRemaining({ networkRetries: 5 }, id);
    expect(service.downloadRemaining).toHaveBeenCalledWith({ networkRetries: 5 }, id);
    controller.downloadRequestStatus(id);
    expect(service.downloadRequestStatus).toHaveBeenCalledWith(id);
  });

  it.each(['', '../outside', 'not-a-uuid'])('rejects malformed request identity before service access: %j', id => {
    const controller = new LibraryController(service as any);
    expect(() => controller.download({ uris: [] }, id)).toThrow(BadRequestException);
    expect(() => controller.downloadRemaining({}, id)).toThrow(BadRequestException);
    expect(() => controller.downloadRequestStatus(id)).toThrow(BadRequestException);
    expect(service.download).not.toHaveBeenCalled();
    expect(service.downloadRemaining).not.toHaveBeenCalled();
    expect(service.downloadRequestStatus).not.toHaveBeenCalled();
  });
});
