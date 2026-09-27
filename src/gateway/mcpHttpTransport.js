import { AppError, ErrorCodes, errorResponse, successResponse } from '../domain/envelope.js';

export const MAX_MCP_BODY_BYTES = 28 * 1024 * 1024;

const SECURITY_ERROR_CODES = new Set([
  ErrorCodes.UNAUTHENTICATED,
  ErrorCodes.FORBIDDEN,
  ErrorCodes.INVALID_ROLE,
  ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
]);

export async function executeMcpHttpRequest(gateway, { method, path, body, authContext }) {
  const context = authContext || {};
  const startedAt = Date.now();
  let status = 500;
  let isOperationalStatusRequest = false;
  try {
    const url = new URL(path, 'http://moneyflow.local');
    if (method === 'GET' && url.pathname === '/api/v1/operations/status') {
      isOperationalStatusRequest = true;
      status = 200;
      return { status, body: successResponse(gateway.getOperationalStatus(context)) };
    }
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
      status = 200;
      return {
        status,
        body: successResponse({
          content_base64: attachment.buffer.toString('base64'),
          mime_type: attachment.mimeType,
          file_name: attachment.fileName,
          file_size: attachment.buffer.length,
        }),
      };
    }

    const lgpdExportMatch = url.pathname.match(/^\/api\/v1\/spaces\/([^/]+)\/lgpd\/export$/);
    if (method === 'GET' && lgpdExportMatch) {
      const targetSpaceId = decodeURIComponent(lgpdExportMatch[1]);
      if (targetSpaceId !== authContext?.spaceId) {
        throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Acesso negado a espaço diferente do autenticado.', 403);
      }
      if (!gateway.lgpdService) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Serviço LGPD não disponível.', 404);
      }
      const exportData = await gateway.lgpdService.exportSpaceData(authContext);
      status = 200;
      return { status, body: successResponse(exportData) };
    }

    const lgpdDeleteMatch = url.pathname.match(/^\/api\/v1\/spaces\/([^/]+)\/lgpd\/delete$/);
    if (method === 'POST' && lgpdDeleteMatch) {
      const targetSpaceId = decodeURIComponent(lgpdDeleteMatch[1]);
      if (targetSpaceId !== authContext?.spaceId) {
        throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Acesso negado a espaço diferente do autenticado.', 403);
      }
      if (!gateway.lgpdService) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Serviço LGPD não disponível.', 404);
      }
      const result = await gateway.lgpdService.deleteOrAnonymizeSpaceData(authContext, body || {});
      status = 200;
      return { status, body: successResponse(result) };
    }

    // Rotas de Catálogo de Instituições e Logos
    if (method === 'GET' && url.pathname === '/api/v1/catalog/institutions') {
      if (!gateway.catalogService) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Serviço de catálogo não disponível.', 404);
      }
      const query = url.searchParams.get('query') || '';
      const limit = Number(url.searchParams.get('limit')) || 50;
      const offset = Number(url.searchParams.get('offset')) || 0;
      const result = gateway.catalogService.searchInstitutions({
        query,
        limit,
        offset,
        spaceId: authContext?.spaceId,
      });
      status = 200;
      return { status, body: successResponse(result) };
    }

    const catalogInstMatch = url.pathname.match(/^\/api\/v1\/catalog\/institutions\/([^/]+)$/);
    if (method === 'GET' && catalogInstMatch) {
      if (!gateway.catalogService) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Serviço de catálogo não disponível.', 404);
      }
      const institutionId = decodeURIComponent(catalogInstMatch[1]);
      const result = gateway.catalogService.getInstitution(institutionId, {
        spaceId: authContext?.spaceId,
      });
      status = 200;
      return { status, body: successResponse(result) };
    }

    if (method === 'GET' && url.pathname === '/api/v1/catalog/brands') {
      if (!gateway.catalogService) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Serviço de catálogo não disponível.', 404);
      }
      const brands = gateway.catalogService.listCardBrands();
      status = 200;
      return { status, body: successResponse(brands) };
    }

    const catalogLogoMatch = url.pathname.match(/^\/api\/v1\/catalog\/logos\/([^/]+)$/);
    if (method === 'GET' && catalogLogoMatch) {
      if (!gateway.catalogService) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Serviço de catálogo não disponível.', 404);
      }
      const assetId = decodeURIComponent(catalogLogoMatch[1]);
      const logo = await gateway.catalogService.getLogoAssetContent(assetId);
      status = 200;
      return {
        status,
        headers: {
          'Content-Type': logo.mimeType,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=86400, immutable',
          'ETag': `"${logo.sha256}"`,
        },
        body: successResponse({
          asset_id: assetId,
          content_base64: logo.buffer.toString('base64'),
          mime_type: logo.mimeType,
          format: logo.format,
          sha256: logo.sha256,
        }),
      };
    }

    const catalogFavMatch = url.pathname.match(/^\/api\/v1\/catalog\/institutions\/([^/]+)\/favorite$/);
    if (method === 'POST' && catalogFavMatch) {
      if (!gateway.catalogService) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Serviço de catálogo não disponível.', 404);
      }
      if (!authContext?.spaceId) {
        throw new AppError(ErrorCodes.UNAUTHENTICATED, 'Contexto de espaço obrigatório para favoritar.', 401);
      }
      const institutionId = decodeURIComponent(catalogFavMatch[1]);
      const favorite = body?.favorite !== false;
      gateway.catalogService.toggleFavoriteInstitution(authContext.spaceId, institutionId, favorite);
      status = 200;
      return { status, body: successResponse({ success: true, institution_id: institutionId, favorite }) };
    }

    const catalogSelectMatch = url.pathname.match(/^\/api\/v1\/catalog\/institutions\/([^/]+)\/select$/);
    if (method === 'POST' && catalogSelectMatch) {
      if (!gateway.catalogService) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Serviço de catálogo não disponível.', 404);
      }
      if (!authContext?.spaceId) {
        throw new AppError(ErrorCodes.UNAUTHENTICATED, 'Contexto de espaço obrigatório para registrar seleção.', 401);
      }
      const institutionId = decodeURIComponent(catalogSelectMatch[1]);
      gateway.catalogService.recordInstitutionSelection(authContext.spaceId, institutionId);
      status = 200;
      return { status, body: successResponse({ success: true, institution_id: institutionId }) };
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
    status = 200;
    return {
      status,
      body: successResponse(result, { requestId: context.requestId || null }),
    };
  } catch (error) {
    const appError = error instanceof AppError
      ? error
      : new AppError(ErrorCodes.INTERNAL_ERROR, 'Ocorreu um erro interno no gateway MCP.', 500);
    status = appError.status;
    if (SECURITY_ERROR_CODES.has(appError.code)) {
      gateway.metrics?.recordSecurityFailure({
        category: appError.code === ErrorCodes.CROSS_SPACE_REFERENCE_DENIED ? 'idor' : 'authorization',
      });
    }
    const responseBody = errorResponse(appError, isOperationalStatusRequest ? {} : context);
    if (isOperationalStatusRequest) {
      delete responseBody.meta.spaceId;
      delete responseBody.meta.userId;
      delete responseBody.meta.requestId;
    }
    return { status, body: responseBody };
  } finally {
    gateway.metrics?.recordApiRequest({ status, latencyMs: Date.now() - startedAt });
  }
}
