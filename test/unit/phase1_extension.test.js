import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { Roles } from '../../src/domain/authorization.js';
import { ErrorCodes, AppError } from '../../src/domain/envelope.js';
import { ExtensionToolContractRegistry } from '../../src/contracts/extensionToolRegistry.js';
import { ToolContractRegistry } from '../../src/contracts/toolRegistry.js';

function setupEnv() {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);

  const owner = service.createUser({ email: 'owner@moneyflow.dev', name: 'Owner' });
  const admin = service.createUser({ email: 'admin@moneyflow.dev', name: 'Admin' });
  const editor = service.createUser({ email: 'editor@moneyflow.dev', name: 'Editor' });
  const viewer = service.createUser({ email: 'viewer@moneyflow.dev', name: 'Viewer' });

  const space = service.createSpace({ name: 'Espaço Matriz', ownerUserId: owner.id });

  const ownerCtx = service.resolveAuthContext({ userId: owner.id, spaceId: space.id });
  service.addMember(ownerCtx, { targetUserId: admin.id, role: Roles.ADMIN });
  service.addMember(ownerCtx, { targetUserId: editor.id, role: Roles.EDITOR });
  service.addMember(ownerCtx, { targetUserId: viewer.id, role: Roles.VIEWER });

  const adminCtx = service.resolveAuthContext({ userId: admin.id, spaceId: space.id });
  const editorCtx = service.resolveAuthContext({ userId: editor.id, spaceId: space.id });
  const viewerCtx = service.resolveAuthContext({ userId: viewer.id, spaceId: space.id });

  return { service, space, ownerCtx, adminCtx, editorCtx, viewerCtx };
}

test('Extensão 1: Atributos Tipados, Obrigatoriedade e Versionamento', () => {
  const { service, adminCtx, editorCtx } = setupEnv();

  // Admin cria definição de atributo
  const attr = service.createAttributeDefinition(adminCtx, {
    targetType: 'transaction',
    name: 'Código de Barras Boleto',
    slug: 'boleto_barcode',
    dataType: 'barcode',
    isRequired: true,
  });

  assert.equal(attr.version, 1);
  assert.equal(attr.data_type, 'barcode');

  // Renomear preserva histórico e mesma versão
  const renamed = service.updateAttributeDefinition(adminCtx, attr.id, {
    name: 'Linha Digitável / Boleto',
  });
  assert.equal(renamed.version, 1);
  assert.equal(renamed.name, 'Linha Digitável / Boleto');

  // Mudar tipo de dado cria uma NOVA versão (version 2)
  const v2 = service.updateAttributeDefinition(adminCtx, attr.id, {
    dataType: 'text',
  });
  assert.equal(v2.version, 2);
  assert.equal(v2.data_type, 'text');
  assert.equal(v2.previous_version_id, attr.id);

  // Arquivar atributo impede novos lançamentos com ele
  service.archiveAttributeDefinition(adminCtx, v2.id);

  assert.throws(
    () =>
      service.setAttributeValues(editorCtx, {
        entityType: 'transaction',
        entityId: 't1',
        values: [{ definitionId: v2.id, text: '123456' }],
      }),
    (err) => err instanceof AppError && err.code === ErrorCodes.ATTRIBUTE_ARCHIVED,
  );
});

test('Extensão 2: Locais de Compra com Marca e Filial', () => {
  const { service, editorCtx, viewerCtx } = setupEnv();

  const loc = service.createPurchaseLocation(editorCtx, {
    brandName: 'Pão de Açúcar',
    branchName: 'Filial Moema',
    city: 'São Paulo',
  });

  assert.equal(loc.brand_name, 'Pão de Açúcar');
  assert.equal(loc.branch_name, 'Filial Moema');

  const list = service.listPurchaseLocations(viewerCtx);
  assert.equal(list.length, 1);
});

test('Extensão 3: Produtos por Barcode e Chave Normalizada com Proteção de Conflito', () => {
  const { service, editorCtx, adminCtx } = setupEnv();

  const p1 = service.createProduct(editorCtx, {
    name: 'Leite Integral 1L',
    barcode: '7891000100100',
    brand: 'Ninho',
    defaultUnit: 'l',
  });

  assert.equal(p1.normalized_name, 'leite integral 1l');

  // Tentativa de cadastrar produto diferente com o mesmo código de barras -> BARCODE_CONFLICT
  assert.throws(
    () =>
      service.createProduct(editorCtx, {
        name: 'Suco de Laranja',
        barcode: '7891000100100', // Mesmo barcode!
      }),
    (err) => err instanceof AppError && err.code === ErrorCodes.BARCODE_CONFLICT,
  );

  // Fusão de produtos com barcodes conflitantes é negada
  const p2 = service.createProduct(editorCtx, {
    name: 'Leite Desnatado 1L',
    barcode: '7891000200200',
    brand: 'Ninho',
  });

  assert.throws(
    () => service.mergeProducts(adminCtx, { sourceProductId: p1.id, targetProductId: p2.id }),
    (err) => err instanceof AppError && err.code === ErrorCodes.BARCODE_CONFLICT,
  );
});

test('Extensão 4: Compra-Pai com Itens-Filhos, Categorias Múltiplas e Soma Exata', () => {
  const { service, editorCtx, space } = setupEnv();

  // Cria categorias diferentes
  const catAlim = service.createCategory(editorCtx, { name: 'Alimentação', kind: 'expense' });
  const catLimp = service.createCategory(editorCtx, { name: 'Limpeza', kind: 'expense' });

  // Cria conta
  const account = service.createAccount(editorCtx, { name: 'Conta Corrente', openingBalance: 100000 });
  const loc = service.createPurchaseLocation(editorCtx, { brandName: 'Carrefour' });
  const prod = service.createProduct(editorCtx, { name: 'Detergente', brand: 'Ypê', defaultUnit: 'un' });

  const purchase = service.createPurchaseWithItems(editorCtx, {
    description: 'Compras Semanais Supermercado',
    accountId: account.id,
    locationId: loc.id,
    transactionDate: '2026-09-25',
    discountAmount: 500, // R$ 5,00 de desconto no total
    additionAmount: 200, // R$ 2,00 de taxa de entrega
    items: [
      {
        categoryId: catAlim.id,
        description: 'Picanha Bovina',
        quantity: 1.5,
        unit: 'kg',
        unitPrice: 8000, // R$ 80,00/kg -> bruto: 12000 (R$ 120,00)
        discountAmount: 0,
      },
      {
        productId: prod.id,
        categoryId: catLimp.id, // Outra categoria!
        description: 'Detergente Neutro',
        quantity: 3,
        unit: 'un',
        unitPrice: 300, // R$ 3,00 cada -> bruto: 900 (R$ 9,00)
        discountAmount: 100, // R$ 1,00 desconto no item -> líquido: 800
      },
    ],
  });

  // Subtotal = 12000 + 900 = 12900
  // Net = 12900 - 500 + 200 = 12600 (R$ 126,00)
  assert.equal(purchase.subtotal_amount, 12900);
  assert.equal(purchase.discount_amount, 500);
  assert.equal(purchase.addition_amount, 200);
  assert.equal(purchase.net_amount, 12600);
  assert.equal(purchase.items.length, 2);

  // A transação financeira associada no caixa foi debitada exatamente com o net_amount (UMA ÚNICA VEZ)
  const tx = service.getTransaction(editorCtx, purchase.transaction_id);
  assert.equal(tx.amount, 12600);
  assert.equal(tx.type, 'expense');

  // Histórico de preço foi registrado automaticamente para o Detergente
  const priceHistory = service.getPriceHistory(editorCtx, { productId: prod.id });
  assert.equal(priceHistory.length, 1);
  assert.equal(priceHistory[0].unit_price_effective, 267); // 800 centavos / 3 un = ~267 centavos
});

test('Extensão 5: Devolução/Estorno de Item Vinculado com Validação de Teto', () => {
  const { service, editorCtx } = setupEnv();
  const cat = service.createCategory(editorCtx, { name: 'Vestuário', kind: 'expense' });
  const account = service.createAccount(editorCtx, { name: 'Cartão', openingBalance: 50000 });

  const purchase = service.createPurchaseWithItems(editorCtx, {
    description: 'Compra de Roupas',
    accountId: account.id,
    transactionDate: '2026-09-25',
    items: [
      {
        categoryId: cat.id,
        description: 'Camiseta Polo',
        quantity: 2,
        unit: 'un',
        unitPrice: 10000, // R$ 100,00 cada -> total líquido 20000
      },
    ],
  });

  const item = purchase.items[0];

  // Tentativa de devolver quantidade maior que 2 -> REFUND_EXCEEDS_QUANTITY
  assert.throws(
    () =>
      service.createItemRefund(editorCtx, {
        purchaseItemId: item.id,
        refundQuantity: 3,
        refundAmount: 30000,
        refundDate: '2026-09-26',
      }),
    (err) => err instanceof AppError && err.code === ErrorCodes.REFUND_EXCEEDS_QUANTITY,
  );

  // Devolução válida de 1 unidade
  const summary = service.createItemRefund(editorCtx, {
    purchaseItemId: item.id,
    refundQuantity: 1,
    refundAmount: 10000,
    refundDate: '2026-09-26',
    reason: 'Tamanho errado',
  });

  assert.equal(summary.totalRefundedQuantity, 1);
  assert.equal(summary.totalRefundedAmount, 10000);
  assert.equal(summary.netAmountAfterRefunds, 10000); // Sobrou 10000
});

test('Extensão 6: Validação e Coexistência de Registries (62 Congelados + 15 Extensões)', () => {
  const frozen = new ToolContractRegistry();
  const extension = new ExtensionToolContractRegistry();

  // 62 continuam estritamente intactos
  assert.equal(frozen.getToolNames().length, 62);

  // Extensões adicionam 22 ferramentas (incluindo metas/cofrinhos e anexos privados)
  assert.equal(extension.getToolNames().length, 22);
  assert.equal(extension.getToolNames().includes('create_purchase_with_items'), true);
  assert.equal(extension.getToolNames().includes('create_attribute_definition'), true);
  assert.equal(extension.getToolNames().includes('get_price_history'), true);
  assert.equal(extension.getToolNames().includes('get_cashflow_sankey'), true);
  assert.equal(extension.getToolNames().includes('anexos_upload'), true);
  assert.equal(extension.getToolNames().includes('anexos_download'), true);
});
