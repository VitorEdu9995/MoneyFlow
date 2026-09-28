export const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'api_key',
  'content_base64',
  'file_content',
  'buffer',
  'apikey',
  'sk',
  'card_number',
  'cvv',
  'credit_card',
]);

let metricsCollector = null;

export function setMetricsCollector(collector) {
  metricsCollector = collector && typeof collector.recordRedaction === 'function' ? collector : null;
}

function recordRedaction() {
  try { metricsCollector?.recordRedaction(); } catch { /* telemetria não afeta o log */ }
}

const SK_REGEX = /sk-[a-zA-Z0-9_-]+/g;
const AIZA_REGEX = /AIza[0-9A-Za-z_-]{35}/g;
const APIKEY_QUERY_REGEX = /([?&]key=)[^&\s"']+/gi;
const TOKEN_REGEX = /Bearer\s+[a-zA-Z0-9\-\._~]+/gi;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,16}\b/g;

export function redact(obj) {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    let redactedStr = obj.replace(SK_REGEX, '[REDACTED]');
    redactedStr = redactedStr.replace(AIZA_REGEX, '[REDACTED]');
    redactedStr = redactedStr.replace(APIKEY_QUERY_REGEX, '$1[REDACTED]');
    redactedStr = redactedStr.replace(TOKEN_REGEX, 'Bearer [REDACTED]');
    redactedStr = redactedStr.replace(CREDIT_CARD_REGEX, '[REDACTED]');
    if (redactedStr !== obj) recordRedaction();
    return redactedStr;
  }

  if (typeof obj === 'object') {
    if (Array.isArray(obj)) {
      return obj.map(redact);
    }

    const redactedObj = {};
    for (const key of Object.keys(obj)) {
      const lowerKey = key.toLowerCase();
      if (
        SENSITIVE_KEYS.has(lowerKey) || 
        lowerKey.includes('token') || 
        lowerKey.includes('password') || 
        lowerKey.includes('secret') ||
        lowerKey.includes('cvv') ||
        lowerKey.includes('card_number') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('base64')
      ) {
        redactedObj[key] = '[REDACTED]';
        recordRedaction();
      } else {
        redactedObj[key] = redact(obj[key]);
      }
    }
    return redactedObj;
  }

  return obj;
}

export const logger = {
  info: (msg, data = {}) => {
    const logEntry = {
      level: 'info',
      timestamp: new Date().toISOString(),
      message: msg,
      data: redact(data),
    };
    console.log(JSON.stringify(logEntry));
  },
  error: (msg, data = {}) => {
    let errorData = data;
    if (data instanceof Error) {
      errorData = { message: data.message, stack: data.stack, ...data };
    }
    const logEntry = {
      level: 'error',
      timestamp: new Date().toISOString(),
      message: msg,
      data: redact(errorData),
    };
    console.error(JSON.stringify(logEntry));
  },
};
