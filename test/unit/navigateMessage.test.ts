import { describe, expect, it } from 'vitest';
import { isUriWithinWorkspace, parseNavigateMessage } from '../../src/ui/navigateMessage';

describe('navigateMessage', () => {
  it('parses valid navigate messages', () => {
    const parsed = parseNavigateMessage({
      type: 'navigate',
      fileUri: 'file:///workspace/Program.cs',
      range: { startLine: 2, startCol: 4, endLine: 2, endCol: 18 },
    });

    expect(parsed).toEqual({
      type: 'navigate',
      fileUri: 'file:///workspace/Program.cs',
      range: { startLine: 2, startCol: 4, endLine: 2, endCol: 18 },
    });
  });

  it('parses registrationId-only navigate messages', () => {
    expect(parseNavigateMessage({ type: 'navigate', registrationId: 'abc123' })).toEqual({
      type: 'navigate',
      registrationId: 'abc123',
    });
  });

  it('rejects malformed navigate messages', () => {
    expect(parseNavigateMessage(null)).toBeUndefined();
    expect(parseNavigateMessage({ type: 'update' })).toBeUndefined();
    expect(parseNavigateMessage({ type: 'navigate', fileUri: 42 })).toBeUndefined();
    expect(
      parseNavigateMessage({
        type: 'navigate',
        fileUri: 'file:///a.cs',
        range: { startLine: 0, startCol: 0, endLine: 0 },
      }),
    ).toBeUndefined();
  });

  it('checks workspace membership for file URIs', () => {
    const roots = ['D:/repo/src'];
    expect(isUriWithinWorkspace('file:///D:/repo/src/Program.cs', roots)).toBe(true);
    expect(isUriWithinWorkspace('file:///D:/other/Program.cs', roots)).toBe(false);
    expect(isUriWithinWorkspace('file:///D:/repo/src', roots)).toBe(true);
  });
});