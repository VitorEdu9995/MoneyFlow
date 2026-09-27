/**
 * Envelopes padronizados de resposta e erro para o MoneyFlow (ECO-61).
 *
 * Garante consistência de erros auditáveis, códigos estáveis e
 * negação por padrão sem vazamento de existência de recursos (anti-IDOR / timing).
 */

export const ErrorCodes = Object.freeze({
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  SPACE_NOT_FOUND: 'SPACE_NOT_FOUND',
  INVALID_ROLE: 'INVALID_ROLE',
  LAST_OWNER_CANNOT_LEAVE: 'LAST_OWNER_CANNOT_LEAVE',
  CROSS_SPACE_REFERENCE_DENIED: 'CROSS_SPACE_REFERENCE_DENIED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  OPEN_FINANCE_DISABLED: 'OPEN_FINANCE_DISABLED',
  ATTRIBUTE_ARCHIVED: 'ATTRIBUTE_ARCHIVED',
  ATTRIBUTE_TYPE_IMMUTABLE: 'ATTRIBUTE_TYPE_IMMUTABLE',
  BARCODE_CONFLICT: 'BARCODE_CONFLICT',
  PURCHASE_SUM_MISMATCH: 'PURCHASE_SUM_MISMATCH',
  REFUND_EXCEEDS_QUANTITY: 'REFUND_EXCEEDS_QUANTITY',
  REFUND_EXCEEDS_AMOUNT: 'REFUND_EXCEEDS_AMOUNT',
  // Extensão Fase 2 (ECO-62): núcleo financeiro persistido
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  OCCURRENCE_ALREADY_PROMOTED: 'OCCURRENCE_ALREADY_PROMOTED',
  IMPORT_INVALID_PAYLOAD: 'IMPORT_INVALID_PAYLOAD',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

export class AppError extends Error {
  /**
   * @param {string} code - Código estável (ex: FORBIDDEN, NOT_FOUND)
   * @param {string} message - Mensagem amigável em PT-BR
   * @param {number} [status=400] - Status HTTP correspondente
   * @param {object} [details=null] - Detalhes adicionais / validações
   */
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Cria envelope de sucesso consistente.
 * @template T
 * @param {T} data
 * @param {object} [meta={}]
 * @returns {{ ok: true, data: T, meta: object }}
 */
export function successResponse(data, meta = {}) {
  return {
    ok: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

/**
 * Cria envelope de erro auditável consistente.
 * @param {AppError|Error|string} error
 * @param {object} [context={}]
 * @returns {{ ok: false, error: { code: string, message: string, details?: any }, meta: object }}
 */
export function errorResponse(error, context = {}) {
  const code = error?.code || ErrorCodes.INTERNAL_ERROR;
  const message = error?.message || 'Ocorreu um erro interno no servidor.';
  const details = error?.details || null;

  return {
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    meta: {
      timestamp: new Date().toISOString(),
      spaceId: context.spaceId || null,
      userId: context.userId || null,
      requestId: context.requestId || null,
    },
  };
}
