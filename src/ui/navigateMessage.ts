export interface NavigateMessage {
  type: 'navigate';
  registrationId?: string;
  fileUri?: string;
  range?: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
}

export function parseNavigateMessage(message: unknown): NavigateMessage | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const candidate = message as Partial<NavigateMessage>;
  if (candidate.type !== 'navigate') {
    return undefined;
  }

  if (typeof candidate.registrationId === 'string') {
    return {
      type: 'navigate',
      registrationId: candidate.registrationId,
    };
  }

  if (typeof candidate.fileUri !== 'string') {
    return undefined;
  }

  const range = candidate.range;
  if (
    !range ||
    typeof range.startLine !== 'number' ||
    typeof range.startCol !== 'number' ||
    typeof range.endLine !== 'number' ||
    typeof range.endCol !== 'number'
  ) {
    return undefined;
  }

  return {
    type: 'navigate',
    fileUri: candidate.fileUri,
    range,
  };
}

export function isUriWithinWorkspace(fileUri: string, workspaceRoots: string[]): boolean {
  const normalized = fileUri
    .replace(/\\/g, '/')
    .replace(/^file:\/\/\/?/i, '')
    .toLowerCase();

  return workspaceRoots.some((root) => {
    const rootNorm = root.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
    return normalized.startsWith(`${rootNorm}/`) || normalized === rootNorm;
  });
}