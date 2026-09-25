import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, runMigrations } from '../../src/db/index.js';
import { SpaceIsolationService } from '../../src/services/spaceIsolationService.js';
import { Roles } from '../../src/domain/authorization.js';
import { ErrorCodes, AppError } from '../../src/domain/envelope.js';

function setupEnvironment() {
  const db = createDatabase(':memory:');
  runMigrations(db);
  const service = new SpaceIsolationService(db);

  // Criar 2 usuários
  const user1 = service.createUser({ email: 'user1@moneyflow.dev', name: 'User 1' });
  const user2 = service.createUser({ email: 'user2@moneyflow.dev', name: 'User 2' });

  // user1 cria space1 (onde é owner)
  const space1 = service.createSpace({ name: 'Espaço Pessoal 1', ownerUserId: user1.id });

  // user2 cria space2 (onde é owner)
  const space2 = service.createSpace({ name: 'Espaço Pessoal 2', ownerUserId: user2.id });

  return { service, user1, user2, space1, space2 };
}

test('Isolamento Multi-espaço: usuário só acessa espaços dos quais é membro ativo', () => {
  const { service, user1, space2 } = setupEnvironment();

  // user1 tenta resolver contexto no space2 (do qual não é membro) -> FORBIDDEN
  assert.throws(
    () => service.resolveAuthContext({ userId: user1.id, spaceId: space2.id }),
    (err) => err instanceof AppError && err.code === ErrorCodes.FORBIDDEN,
  );
});

test('Adversarial 1: Troca de space_id no payload e Anti-IDOR', () => {
  const { service, user1, user2, space1, space2 } = setupEnvironment();
  const authContext1 = service.resolveAuthContext({ userId: user1.id, spaceId: space1.id });

  // user1 cria conta no space1
  const account1 = service.createAccount(authContext1, { name: 'Conta Principal Space 1' });

  // Se user2 tentar consultar a conta criada no space1 usando contexto do space2 -> 404 NOT_FOUND (anti-IDOR)
  const authContextUser2 = service.resolveAuthContext({ userId: user2.id, spaceId: space2.id });

  assert.throws(
    () => service.getAccount(authContextUser2, account1.id),
    (err) => err instanceof AppError && err.code === ErrorCodes.NOT_FOUND,
  );
});

test('Adversarial 2: Viewer tentando mutar (criar conta, cartão, transação) -> FORBIDDEN', () => {
  const { service, user1, user2, space1 } = setupEnvironment();
  const ownerContext = service.resolveAuthContext({ userId: user1.id, spaceId: space1.id });

  // Adiciona user2 como viewer no space1
  service.addMember(ownerContext, { targetUserId: user2.id, role: Roles.VIEWER });

  const viewerContext = service.resolveAuthContext({ userId: user2.id, spaceId: space1.id });

  // Tentativa de criar conta como viewer
  assert.throws(
    () => service.createAccount(viewerContext, { name: 'Conta Não Autorizada' }),
    (err) => err instanceof AppError && err.code === ErrorCodes.FORBIDDEN,
  );

  // Tentativa de criar transação como viewer
  assert.throws(
    () =>
      service.createTransaction(viewerContext, {
        type: 'expense',
        description: 'Gasto Viewer',
        amount: 5000,
        transactionDate: '2026-09-25',
      }),
    (err) => err instanceof AppError && err.code === ErrorCodes.FORBIDDEN,
  );
});

test('Adversarial 3: Último owner saindo do espaço -> LAST_OWNER_CANNOT_LEAVE', () => {
  const { service, user1, space1 } = setupEnvironment();
  const ownerContext = service.resolveAuthContext({ userId: user1.id, spaceId: space1.id });

  // user1 é o único owner. Tentar revogar a si mesmo
  assert.throws(
    () => service.removeMember(ownerContext, { targetUserId: user1.id }),
    (err) => err instanceof AppError && err.code === ErrorCodes.LAST_OWNER_CANNOT_LEAVE,
  );
});

test('Adversarial 4: Membro revogado durante requisições é imediatamente bloqueado', () => {
  const { service, user1, user2, space1 } = setupEnvironment();
  const ownerContext = service.resolveAuthContext({ userId: user1.id, spaceId: space1.id });

  // Adiciona user2 como editor
  service.addMember(ownerContext, { targetUserId: user2.id, role: Roles.EDITOR });

  // user2 resolve contexto com sucesso
  const editorContext = service.resolveAuthContext({ userId: user2.id, spaceId: space1.id });
  assert.ok(editorContext);

  // Agora owner revoga user2
  service.removeMember(ownerContext, { targetUserId: user2.id });

  // Em novo request, user2 é bloqueado imediatamente
  assert.throws(
    () => service.resolveAuthContext({ userId: user2.id, spaceId: space1.id }),
    (err) => err instanceof AppError && err.code === ErrorCodes.FORBIDDEN,
  );
});

test('Adversarial 5: Referência entre espaços (Cross-Space Reference) é negada', () => {
  const { service, user1, user2, space1, space2 } = setupEnvironment();
  const authContext1 = service.resolveAuthContext({ userId: user1.id, spaceId: space1.id });
  const authContext2 = service.resolveAuthContext({ userId: user2.id, spaceId: space2.id });

  // Conta criada no space1
  const accountSpace1 = service.createAccount(authContext1, { name: 'Conta Space 1' });

  // user2 no space2 tenta vincular em seu cartão a conta que pertence ao space1
  assert.throws(
    () =>
      service.createCreditCard(authContext2, {
        name: 'Cartão Space 2',
        closingDay: 10,
        dueDay: 20,
        paymentAccountId: accountSpace1.id, // ID de outro espaço!
      }),
    (err) => err instanceof AppError && err.code === ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
  );

  // user2 tenta criar transação no space2 apontando para conta do space1
  assert.throws(
    () =>
      service.createTransaction(authContext2, {
        type: 'expense',
        description: 'Tentativa Cross-Space',
        amount: 1000,
        transactionDate: '2026-09-25',
        accountId: accountSpace1.id, // ID de outro espaço!
      }),
    (err) => err instanceof AppError && err.code === ErrorCodes.CROSS_SPACE_REFERENCE_DENIED,
  );
});

test('Auditoria mínima append-only registra criação e mutações', () => {
  const { service, user1, space1 } = setupEnvironment();
  const authContext = service.resolveAuthContext({ userId: user1.id, spaceId: space1.id });

  service.createAccount(authContext, { name: 'Conta Investimento' });

  const logs = service.getAuditLogs(authContext);
  assert.ok(logs.length >= 2); // space.create e account.create

  const accountLog = logs.find((l) => l.action === 'account.create');
  assert.ok(accountLog);
  assert.equal(accountLog.space_id, space1.id);
  assert.equal(accountLog.actor_user_id, user1.id);
  assert.equal(accountLog.entity_type, 'accounts');
});
