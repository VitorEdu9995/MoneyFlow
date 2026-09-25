import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Roles,
  Permissions,
  hasPermission,
  requireAuthorization,
} from '../../src/domain/authorization.js';
import { ErrorCodes, AppError } from '../../src/domain/envelope.js';

test('Matriz de autorização: permissões específicas por papel', () => {
  // Owner tem tudo
  assert.equal(hasPermission(Roles.OWNER, Permissions.SPACE_DELETE), true);
  assert.equal(hasPermission(Roles.OWNER, Permissions.MEMBERS_MANAGE), true);
  assert.equal(hasPermission(Roles.OWNER, Permissions.TRANSACTIONS_WRITE), true);
  assert.equal(hasPermission(Roles.OWNER, Permissions.FINANCE_READ), true);

  // Admin gerencia finanças e membros (mas não deleta espaço)
  assert.equal(hasPermission(Roles.ADMIN, Permissions.SPACE_DELETE), false);
  assert.equal(hasPermission(Roles.ADMIN, Permissions.MEMBERS_MANAGE), true);
  assert.equal(hasPermission(Roles.ADMIN, Permissions.TRANSACTIONS_WRITE), true);
  assert.equal(hasPermission(Roles.ADMIN, Permissions.FINANCE_READ), true);

  // Editor gerencia finanças mas não membros nem configurações de espaço
  assert.equal(hasPermission(Roles.EDITOR, Permissions.MEMBERS_MANAGE), false);
  assert.equal(hasPermission(Roles.EDITOR, Permissions.SPACE_UPDATE), false);
  assert.equal(hasPermission(Roles.EDITOR, Permissions.TRANSACTIONS_WRITE), true);
  assert.equal(hasPermission(Roles.EDITOR, Permissions.ACCOUNTS_WRITE), true);
  assert.equal(hasPermission(Roles.EDITOR, Permissions.FINANCE_READ), true);

  // Viewer é estritamente somente leitura (deny-by-default para mutações)
  assert.equal(hasPermission(Roles.VIEWER, Permissions.TRANSACTIONS_WRITE), false);
  assert.equal(hasPermission(Roles.VIEWER, Permissions.ACCOUNTS_WRITE), false);
  assert.equal(hasPermission(Roles.VIEWER, Permissions.CARDS_WRITE), false);
  assert.equal(hasPermission(Roles.VIEWER, Permissions.MEMBERS_MANAGE), false);
  assert.equal(hasPermission(Roles.VIEWER, Permissions.FINANCE_READ), true);
  assert.equal(hasPermission(Roles.VIEWER, Permissions.REPORTS_READ), true);
});

test('Deny-by-default para papéis desconhecidos, vazios ou nulos', () => {
  assert.equal(hasPermission(null, Permissions.FINANCE_READ), false);
  assert.equal(hasPermission(undefined, Permissions.FINANCE_READ), false);
  assert.equal(hasPermission('', Permissions.FINANCE_READ), false);
  assert.equal(hasPermission('hacker', Permissions.FINANCE_READ), false);
  assert.equal(hasPermission('guest', Permissions.FINANCE_READ), false);
});

test('requireAuthorization: validação de usuário e contexto', () => {
  // Sem autenticação
  assert.throws(
    () => requireAuthorization(null),
    (err) => err instanceof AppError && err.code === ErrorCodes.UNAUTHENTICATED,
  );

  // Sem spaceId
  assert.throws(
    () => requireAuthorization({ userId: 'u1' }),
    (err) => err instanceof AppError && err.code === ErrorCodes.FORBIDDEN,
  );

  // Sem membership ativo
  assert.throws(
    () => requireAuthorization({ userId: 'u1', spaceId: 's1', membership: { status: 'suspended' } }),
    (err) => err instanceof AppError && err.code === ErrorCodes.FORBIDDEN,
  );

  // Papel inválido
  assert.throws(
    () => requireAuthorization({ userId: 'u1', spaceId: 's1', membership: { status: 'active', role: 'invalido' } }),
    (err) => err instanceof AppError && err.code === ErrorCodes.INVALID_ROLE,
  );

  // Viewer tentando mutar
  assert.throws(
    () =>
      requireAuthorization(
        { userId: 'u1', spaceId: 's1', membership: { status: 'active', role: Roles.VIEWER } },
        Permissions.TRANSACTIONS_WRITE,
      ),
    (err) => err instanceof AppError && err.code === ErrorCodes.FORBIDDEN,
  );

  // Owner com permissão válida passa sem erro
  assert.doesNotThrow(() =>
    requireAuthorization(
      { userId: 'u1', spaceId: 's1', membership: { status: 'active', role: Roles.OWNER } },
      Permissions.TRANSACTIONS_WRITE,
    ),
  );
});
