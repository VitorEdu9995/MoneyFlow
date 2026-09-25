import test from 'node:test';
import assert from 'node:assert/strict';

import { McpGateway, OPEN_FINANCE_DISABLED_TOOLS } from '../../src/gateway/mcpGateway.js';
import { ToolContractRegistry, TOTAL_EXPECTED_TOOLS } from '../../src/contracts/toolRegistry.js';

test('McpGateway Contract: 62/62 ferramentas registradas e íntegras', () => {
  const registry = new ToolContractRegistry();
  const gateway = new McpGateway({ registry });

  const tools = gateway.getToolNames();
  assert.equal(tools.length, TOTAL_EXPECTED_TOOLS);
  assert.equal(tools.length, 62);
});

test('McpGateway Contract: 62/62 fixtures de contrato passam com retorno compatível', async () => {
  const registry = new ToolContractRegistry();
  const gateway = new McpGateway({ registry });

  const toolNames = gateway.getToolNames();

  for (const name of toolNames) {
    const fixture = registry.getFixture(name);
    assert.ok(fixture, `Fixture deve existir para ${name}`);

    const result = await gateway.executeTool(name, fixture.validCall.arguments);

    assert.equal(
      result.status,
      fixture.expectedReturnSample.status,
      `Ferramenta '${name}' retornou status '${result.status}', esperado '${fixture.expectedReturnSample.status}'`,
    );
    assert.equal(
      result.isMockFixture,
      fixture.expectedReturnSample.isMockFixture,
      `Ferramenta '${name}' isMockFixture inconsistente.`,
    );
  }
});

test('McpGateway Contract: ferramentas Open Finance retornam determinístico OPEN_FINANCE_DISABLED sem credencial', async () => {
  const gateway = new McpGateway();

  assert.equal(OPEN_FINANCE_DISABLED_TOOLS.size, 3);
  assert.ok(OPEN_FINANCE_DISABLED_TOOLS.has('get_latest_imports'));
  assert.ok(OPEN_FINANCE_DISABLED_TOOLS.has('get_bank_connections'));
  assert.ok(OPEN_FINANCE_DISABLED_TOOLS.has('get_open_finance_status'));

  for (const toolName of OPEN_FINANCE_DISABLED_TOOLS) {
    const res = await gateway.executeTool(toolName, {});
    assert.equal(res.status, 'OPEN_FINANCE_DISABLED');
    assert.ok(res.message.includes('Open Finance'));
  }
});
