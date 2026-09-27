/**
 * Cliente HTTP para a API e Gateway MCP do MoneyFlow.
 */

export interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    status: number;
    details?: any;
  };
  meta?: {
    requestId?: string | null;
    timestamp?: string;
  };
}

export const getAuthToken = () => {
  return localStorage.getItem('token') || 'dummy-token';
};

export const getActiveSpaceId = () => {
  return localStorage.getItem('active_space_id') || '';
};

export const setActiveSpaceId = (spaceId: string) => {
  localStorage.setItem('active_space_id', spaceId);
};

export const apiExecute = async <T = any>(tool: string, args: Record<string, any> = {}): Promise<T> => {
  const token = getAuthToken();
  const spaceId = getActiveSpaceId();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  if (spaceId) {
    headers['X-Space-Id'] = spaceId;
  }

  const response = await fetch('/api/v1/mcp/execute', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      toolName: tool,
      args,
    }),
  });

  const envelope: ApiResponse = await response.json();

  if (!envelope.ok) {
    throw new Error(envelope.error?.message || `Erro ao executar ${tool}`);
  }

  // O resultado da ferramenta MCP vem empacotado em { status: 'ok', data: resultData }
  const toolResult = envelope.data;
  if (toolResult && typeof toolResult === 'object' && 'data' in toolResult) {
    return toolResult.data as T;
  }

  return toolResult as T;
};

export const apiFetch = async <T = any>(path: string, options: RequestInit = {}): Promise<T> => {
  const token = getAuthToken();
  const spaceId = getActiveSpaceId();

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    ...(options.headers as Record<string, string> || {}),
  };

  if (spaceId) {
    headers['X-Space-Id'] = spaceId;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const envelope: ApiResponse = await response.json();

  if (!envelope.ok) {
    throw new Error(envelope.error?.message || `Erro na requisição ${path}`);
  }

  return envelope.data as T;
};
