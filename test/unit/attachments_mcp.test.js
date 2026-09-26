import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { McpGateway } from '../../src/gateway/mcpGateway.js';
import { executeMcpHttpRequest } from '../../src/gateway/mcpHttpTransport.js';

test('MCP anexos: upload/download trafegam em base64, aplicam autorização e retornam envelope do gateway', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const owner = service.createUser({ name: 'Owner', email: 'owner@mcp.test' });
  const space = service.createSpace({ name: 'S1', ownerUserId: owner.id });
  const context = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const gateway = new McpGateway({ service });
  const content = Buffer.from('%PDF-1.7\nconteudo').toString('base64');

  assert.ok(gateway.getToolNames().includes('anexos_upload'));
  assert.ok(gateway.getToolNames().includes('anexos_download'));

  const upload = await gateway.executeTool('anexos_upload', {
    entity_type: 'transaction',
    entity_id: 'transaction-1',
    file_name: 'nota.PDF',
    declared_mime_type: 'application/pdf',
    content_base64: content,
  }, context);
  assert.equal(upload.status, 'ok');
  assert.equal(upload.data.realMimeType, 'application/pdf');

  const download = await gateway.executeTool('anexos_download', {
    attachment_id: upload.data.id,
  }, context);
  assert.equal(download.status, 'ok');
  assert.equal(download.data.content_base64, content);
});

test('MCP HTTP: POST /api/v1/mcp/execute usa contexto server-side e envelope AppError', async () => {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);
  const owner = service.createUser({ name: 'Owner', email: 'owner@transport.test' });
  const space = service.createSpace({ name: 'S1', ownerUserId: owner.id });
  const context = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  const gateway = new McpGateway({ service });
  const content = Buffer.from('%PDF-1.7\ntransport').toString('base64');

  const response = await executeMcpHttpRequest(gateway, {
    method: 'POST',
    path: '/api/v1/mcp/execute',
    body: {
      toolName: 'anexos_upload',
      args: {
        entity_type: 'transaction', entity_id: 'tx-1', file_name: 'transport.pdf',
        declared_mime_type: 'application/pdf', content_base64: content,
      },
      authContext: { spaceId: 'não-confiável' },
    },
    authContext: context,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.data.fileName, 'transport.pdf');

  const invalidMethod = await executeMcpHttpRequest(gateway, {
    method: 'GET', path: '/api/v1/mcp/execute', body: {}, authContext: context,
  });
  assert.equal(invalidMethod.status, 405);
  assert.equal(invalidMethod.body.ok, false);
  assert.equal(invalidMethod.body.error.code, 'METHOD_NOT_ALLOWED');
});
