import test from 'node:test';
import assert from 'node:assert/strict';

import { ToolContractRegistry, TOTAL_EXPECTED_TOOLS } from '../../src/contracts/toolRegistry.js';

test('ToolContractRegistry: contém exatamente 62 ferramentas catalogadas', () => {
  const registry = new ToolContractRegistry();
  const tools = registry.getToolNames();

  assert.equal(tools.length, TOTAL_EXPECTED_TOOLS);
  assert.equal(tools.length, 62);

  // Amostragem de ferramentas dos 5 grupos
  assert.equal(tools.includes('get_account_context'), true);
  assert.equal(tools.includes('list_transactions'), true);
  assert.equal(tools.includes('create_transaction'), true);
  assert.equal(tools.includes('mass_create_transactions'), true);
  assert.equal(tools.includes('clone_budgets'), true);
  assert.equal(tools.includes('update_transactions_descriptions'), true);
});

test('ToolContractRegistry: fixtures e schemas congelados sem parâmetros inventados', () => {
  const registry = new ToolContractRegistry();

  for (const name of registry.getToolNames()) {
    const tool = registry.getTool(name);
    const fixture = registry.getFixture(name);

    assert.ok(tool.description, `Ferramenta ${name} deve possuir descrição.`);
    assert.ok(tool.inputSchema, `Ferramenta ${name} deve possuir inputSchema.`);
    assert.ok(fixture.validCall, `Fixture para ${name} deve ter validCall.`);

    // Validar os argumentos da fixture contra o schema congelado
    const validation = registry.validateArgs(name, fixture.validCall.arguments);
    assert.equal(
      validation.valid,
      true,
      `Chamada da fixture para '${name}' deve ser válida pelo schema. Erros: ${validation.errors?.join(', ')}`,
    );
  }
});

test('ToolContractRegistry: detecta parâmetros obrigatórios ausentes', () => {
  const registry = new ToolContractRegistry();

  // create_transaction requer: description, amount, date, is_income
  const result = registry.validateArgs('create_transaction', {
    description: 'Café',
    // faltando amount, date, is_income
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('amount')));
  assert.ok(result.errors.some((e) => e.includes('date')));
  assert.ok(result.errors.some((e) => e.includes('is_income')));
});
