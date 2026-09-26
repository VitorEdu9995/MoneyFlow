import test from 'node:test';
import assert from 'node:assert';
import { redact, logger } from '../../src/utils/logger.js';

test('redact should mask sensitive strings', () => {
  const input = 'Here is my sk-1234567890abcdef and my token Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const expected = 'Here is my [REDACTED] and my token Bearer [REDACTED]';
  assert.strictEqual(redact(input), expected);
});

test('redact should mask sensitive keys in objects', () => {
  const input = {
    password: 'supersecret',
    user: 'john',
    token: 'Bearer something',
    card_number: '1234-5678-9012-3456',
    cvv: '123',
    nested: {
      api_key: 'sk-999',
      safe: 'data'
    }
  };
  
  const result = redact(input);
  assert.strictEqual(result.password, '[REDACTED]');
  assert.strictEqual(result.user, 'john');
  assert.strictEqual(result.token, '[REDACTED]');
  assert.strictEqual(result.card_number, '[REDACTED]');
  assert.strictEqual(result.cvv, '[REDACTED]');
  assert.strictEqual(result.nested.api_key, '[REDACTED]');
  assert.strictEqual(result.nested.safe, 'data');
});

test('logger info should log to console with redaction', (t) => {
  const originalLog = console.log;
  let logOutput = '';
  console.log = (msg) => { logOutput = msg; };

  logger.info('Test message', { password: 'secretpassword', sk: 'sk-abc' });
  
  console.log = originalLog;

  const parsed = JSON.parse(logOutput);
  assert.strictEqual(parsed.message, 'Test message');
  assert.strictEqual(parsed.data.password, '[REDACTED]');
  // Also check if sk works if we had it as a key
});
