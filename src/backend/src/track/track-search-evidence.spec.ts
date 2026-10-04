import { TrackController } from './track.controller';
import { expect } from '@jest/globals';

describe('read-only candidate evidence API', () => {
  const service = { searchEvidence: jest.fn() };
  const controller = new TrackController(service as any, {} as any);
  beforeEach(() => jest.clearAllMocks());
  it('returns a report or explicit null without changing queue state', () => {
    service.searchEvidence
      .mockReturnValueOnce({ outcome: 'no-candidate' })
      .mockReturnValueOnce(null);
    expect(controller.searchEvidence('K Scope', 'The Setup')).toEqual({
      report: { outcome: 'no-candidate' },
    });
    expect(controller.searchEvidence('Vincent', 'The Plan')).toEqual({
      report: null,
    });
    expect(service.searchEvidence).toHaveBeenNthCalledWith(
      1,
      'K Scope',
      'The Setup',
      undefined,
    );
  });
  it('rejects missing, multi-value and oversized identity parameters', () => {
    for (const value of [undefined, '', '   ', ['artist'], 'x'.repeat(501)]) {
      expect(() => controller.searchEvidence(value as any, 'Song')).toThrow();
      expect(() => controller.searchEvidence('Artist', value as any)).toThrow();
    }
    expect(service.searchEvidence).not.toHaveBeenCalled();
  });
});
