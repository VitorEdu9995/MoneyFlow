import { AppError, ErrorCodes, errorResponse, successResponse } from '../domain/envelope.js';

export async function executeMcpHttpRequest(gateway, { method, path, body, authContext }) {
  const context = authContext || {};
  try {
    if (method !== 'POST' || path !== '/api/v1/mcp/execute') {
      throw new AppError(ErrorCodes.METHOD_NOT_ALLOWED, 'Endpoint MCP disponível apenas em POST /api/v1/mcp/execute.', 405);
    }
    if (!body || typeof body.toolName !== 'string' || typeof body.args !== 'object' || Array.isArray(body.args)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Corpo MCP inválido: toolName e args são obrigatórios.', 400);
    }

    // O contexto vem do middleware autenticado do servidor, nunca do corpo MCP.
    const result = await gateway.executeTool(body.toolName, body.args, context);
    return {
      status: 200,
      body: successResponse(result, { requestId: context.requestId || null }),
    };
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError(ErrorCodes.INTERNAL_ERROR, 'Ocorreu um erro interno no gateway MCP.', 500);
    return {
      status: appError.status,
      body: errorResponse(appError, context),
    };
  }
}
