export const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'api_key',
  'apikey',
  'sk',
  'card_number',
  'cvv',
  'credit_card',
]);

const SK_REGEX = /sk-[a-zA-Z0-9_-]+/g;
const TOKEN_REGEX = /Bearer\s+[a-zA-Z0-9\-\._~]+/gi;
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,16}\b/g;

export function redact(obj) {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    let redactedStr = obj.replace(SK_REGEX, '[REDACTED]');
    redactedStr = redactedStr.replace(TOKEN_REGEX, 'Bearer [REDACTED]');
    redactedStr = redactedStr.replace(CREDIT_CARD_REGEX, '[REDACTED]');
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
        lowerKey.includes('api_key')
      ) {
        redactedObj[key] = '[REDACTED]';
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
