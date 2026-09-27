import { AppError, ErrorCodes, errorResponse, successResponse } from '../domain/envelope.js';

export const MAX_MCP_BODY_BYTES = 28 * 1024 * 1024;

export async function executeMcpHttpRequest(gateway, { method, path, body, authContext }) {
  const context = authContext || {};
  try {
    const url = new URL(path, 'http://moneyflow.local');
    const temporaryDownload = url.pathname.match(/^\/api\/v1\/attachments\/([^/]+)\/download$/);
    if (method === 'GET' && temporaryDownload) {
      const token = url.searchParams.get('token');
      if (!gateway.attachmentService || !token) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found.', 404);
      }
      const attachment = await gateway.attachmentService.downloadAttachmentByToken(
        authContext,
        decodeURIComponent(temporaryDownload[1]),
        token,
      );
      return {
        status: 200,
        body: successResponse({
          content_base64: attachment.buffer.toString('base64'),
          mime_type: attachment.mimeType,
          file_name: attachment.fileName,
          file_size: attachment.buffer.length,
        }),
      };
    }
    if (method !== 'POST' || path !== '/api/v1/mcp/execute') {
      throw new AppError(ErrorCodes.METHOD_NOT_ALLOWED, 'Endpoint MCP disponível apenas em POST /api/v1/mcp/execute.', 405);
    }
    if (!body || typeof body.toolName !== 'string' || typeof body.args !== 'object' || Array.isArray(body.args)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Corpo MCP inválido: toolName e args são obrigatórios.', 400);
    }
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_MCP_BODY_BYTES) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Corpo MCP excede o limite permitido.', 413);
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
