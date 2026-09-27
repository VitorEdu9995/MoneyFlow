import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { AttachmentService } from '../../src/services/attachmentService.js';
import { McpGateway } from '../../src/gateway/mcpGateway.js';
import { executeMcpHttpRequest } from '../../src/gateway/mcpHttpTransport.js';
import { createRateLimiter, clearRateLimitStore } from '../../src/gateway/httpRateLimiter.js';
import { OperationalMetrics } from '../../src/observability/operationalMetrics.js';
import { logger, setMetricsCollector } from '../../src/utils/logger.js';

function createEnvironment({ metrics = new OperationalMetrics() } = {}) {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const owner = service.createUser({ name: 'Owner', email: 'owner@metrics.test' });
  const viewer = service.createUser({ name: 'Viewer', email: 'viewer@metrics.test' });
  const space = service.createSpace({ name: 'Metrics', ownerUserId: owner.id });
  const ownerContext = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  service.addMember(ownerContext, { targetUserId: viewer.id, role: 'viewer' });
  const attachmentService = new AttachmentService(db, service, { metrics });
  const gateway = new McpGateway({ service, attachmentService, metrics });
  return {
    db,
    service,
    metrics,
    gateway,
    owner: ownerContext,
    viewer: service.resolveAuthContext({ userId: viewer.id, spaceId: space.id }),
  };
}

test('métricas operacionais agregam uso, latência e alertas sem dados sensíveis', () => {
  const metrics = new OperationalMetrics({
    alertThresholds: { rateLimit: 1, serverError: 1, idor: 1, redaction: 1, storageFailure: 1 },
    now: () => 1000,
  });

  metrics.recordApiRequest({ method: 'POST', path: '/api/v1/mcp/execute?token=segredo', status: 500, latencyMs: 32 });
  metrics.recordRateLimit({ scope: 'user_ip' });
  metrics.recordSecurityFailure({ category: 'idor' });
  metrics.recordRedaction({ source: 'logger' });
  metrics.recordStorageUsage({ attachments: 2, bytes: 2048 });
  metrics.recordStorageFailure();

  const snapshot = metrics.snapshot();
  assert.deepEqual(snapshot.api, {
    requests: 1,
    errors4xx: 0,
    errors5xx: 1,
    errorRate: 1,
    latencyMs: { count: 1, average: 32, max: 32 },
  });
  assert.deepEqual(snapshot.storage, { attachments: 2, bytes: 2048, failures: 1 });
  assert.equal(snapshot.rateLimits.userIp, 1);
  assert.equal(snapshot.security.idor, 1);
  assert.equal(snapshot.redactions, 1);
  assert.deepEqual(snapshot.alerts.map((alert) => alert.type).sort(), [
    'idor', 'rate_limit', 'redaction', 'server_error', 'storage_failure',
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /segredo|token/i);
});

test('logs, rate limit e anexos alimentam métricas por injeção sem registrar conteúdo', async () => {
  clearRateLimitStore();
  const metrics = new OperationalMetrics({ alertThresholds: { rateLimit: 1, redaction: 1 } });
  setMetricsCollector(metrics);
  logger.info('evento', { token: 'não pode aparecer' });

  const middleware = createRateLimiter({ userIpLimit: 1, windowMs: 1000, metrics });
  const response = { setHeader() {}, end() {} };
  const request = { headers: { 'x-forwarded-for': '127.0.0.1' }, url: '/api/test' };
  middleware(request, response, () => {});
  middleware(request, response, () => {});

  const { gateway, owner } = createEnvironment({ metrics });
  const result = await gateway.executeTool('anexos_upload', {
    entity_type: 'transaction', entity_id: 'tx-1', file_name: 'nota.pdf',
    declared_mime_type: 'application/pdf', content_base64: Buffer.from('%PDF-1.7').toString('base64'),
  }, owner);

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.rateLimits.userIp, 1);
  assert.equal(snapshot.storage.attachments, 1);
  assert.equal(snapshot.storage.bytes, result.data.fileSize);
  assert.equal(snapshot.auditEvents, 1);
  assert.ok(snapshot.redactions >= 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /não pode aparecer|JVBER/);
});

test('endpoint operacional exige AUDIT_READ, retorna health e contabiliza falhas de autorização', async () => {
  const metrics = new OperationalMetrics({ alertThresholds: { idor: 1 } });
  const { gateway, owner, viewer } = createEnvironment({ metrics });

  const denied = await executeMcpHttpRequest(gateway, {
    method: 'GET', path: '/api/v1/operations/status?token=nunca', authContext: viewer,
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'FORBIDDEN');
  assert.doesNotMatch(JSON.stringify(denied.body), /viewer@metrics\.test|spaceId|userId/i);

  const allowed = await executeMcpHttpRequest(gateway, {
    method: 'GET', path: '/api/v1/operations/status', authContext: owner,
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.ok, true);
  assert.equal(allowed.body.data.health.status, 'ok');
  assert.equal(allowed.body.data.metrics.security.authorization, 1);
  assert.doesNotMatch(JSON.stringify(allowed.body), /owner@metrics\.test|nunca|token/i);
});

test('transporte HTTP classifica tentativa cross-space como alerta IDOR sem reter identificadores', async () => {
  const metrics = new OperationalMetrics({ alertThresholds: { idor: 1 } });
  const { service, gateway, owner } = createEnvironment({ metrics });
  const otherOwner = service.createUser({ name: 'Other', email: 'other@metrics.test' });
  const otherSpace = service.createSpace({ name: 'Other space', ownerUserId: otherOwner.id });
  const otherContext = service.resolveAuthContext({ userId: otherOwner.id, spaceId: otherSpace.id });
  const otherAccount = service.createAccount(otherContext, { name: 'Conta privada' });

  const response = await executeMcpHttpRequest(gateway, {
    method: 'POST',
    path: '/api/v1/mcp/execute',
    authContext: owner,
    body: {
      toolName: 'create_transaction',
      args: { description: 'Tentativa', amount: 1, date: '2026-09-27', is_income: false, account_name: otherAccount.id },
    },
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'CROSS_SPACE_REFERENCE_DENIED');
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.security.idor, 1);
  assert.deepEqual(snapshot.alerts.map(({ type }) => type), ['idor']);
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(otherAccount.id));
});
