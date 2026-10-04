import { beforeEach, describe, it, expect, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { LibraryController } from './library.controller';

describe('explicit Chrome connection boundary', () => {
  const service = {
    spotifyConnectionState: jest.fn().mockReturnValue({ state: 'disconnected', connectedAt: null }),
    connectSpotifyChrome: jest.fn().mockReturnValue({ state: 'connected', connectedAt: null }),
  };
  beforeEach(() => jest.clearAllMocks());
  it('GET is observational only', () => {
    new LibraryController(service as any).spotifyConnectionState();
    expect(service.spotifyConnectionState).toHaveBeenCalledTimes(1);
    expect(service.connectSpotifyChrome).not.toHaveBeenCalled();
  });
  it.each([undefined, {}, { confirm: 'yes' }, { confirm: true }])('rejects missing or ambiguous permission: %j', body => {
    expect(() => new LibraryController(service as any).connectSpotifyChrome(body as any)).toThrow(BadRequestException);
    expect(service.connectSpotifyChrome).not.toHaveBeenCalled();
  });
  it('forwards only the explicit one-connection action', () => {
    new LibraryController(service as any).connectSpotifyChrome({ confirm: 'allow-one-chrome-connection' });
    expect(service.connectSpotifyChrome).toHaveBeenCalledTimes(1);
  });
});
