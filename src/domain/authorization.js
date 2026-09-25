/**
 * Matriz de papéis, permissões e regras de autorização server-side (ECO-61).
 *
 * Papéis suportados:
 * - owner: controle total do espaço, gestão de membros, alteração e exclusão do espaço.
 * - admin: gestão de dados financeiros, categorias, contas e convite/gestão de editores e viewers.
 * - editor: criação e alteração de transações, contas, categorias e orçamentos (sem gerir membros nem configurações do espaço).
 * - viewer: somente leitura (consultas, relatórios, auditoria permitida). Deny-by-default para qualquer mutação.
 */

import { AppError, ErrorCodes } from './envelope.js';

export const Roles = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  EDITOR: 'editor',
  VIEWER: 'viewer',
});

export const Permissions = Object.freeze({
  // Espaço e membros
  SPACE_READ: 'space:read',
  SPACE_UPDATE: 'space:update',
  SPACE_DELETE: 'space:delete',
  MEMBERS_MANAGE: 'members:manage',
  MEMBERS_READ: 'members:read',

  // Entidades financeiras (leitura)
  FINANCE_READ: 'finance:read',
  REPORTS_READ: 'reports:read',
  AUDIT_READ: 'audit:read',

  // Entidades financeiras (escrita)
  TRANSACTIONS_WRITE: 'transactions:write',
  ACCOUNTS_WRITE: 'accounts:write',
  CARDS_WRITE: 'cards:write',
  CATEGORIES_WRITE: 'categories:write',
  BUDGETS_WRITE: 'budgets:write',

  // Extensão Fase 1: Compras, Itens, Locais e Histórico
  PURCHASES_WRITE: 'purchases:write',
  PURCHASES_READ: 'purchases:read',
  LOCATIONS_WRITE: 'locations:write',
  PRODUCTS_WRITE: 'products:write',
  REFUNDS_WRITE: 'refunds:write',

  // Definições de Atributos e Mesclagens Administrativas
  ATTRIBUTE_DEFINITIONS_MANAGE: 'attributes:manage',
  PRODUCTS_MERGE: 'products:merge',
  LOCATIONS_MERGE: 'locations:merge',
});

const ROLE_PERMISSIONS = {
  [Roles.OWNER]: [
    Permissions.SPACE_READ,
    Permissions.SPACE_UPDATE,
    Permissions.SPACE_DELETE,
    Permissions.MEMBERS_MANAGE,
    Permissions.MEMBERS_READ,
    Permissions.FINANCE_READ,
    Permissions.REPORTS_READ,
    Permissions.AUDIT_READ,
    Permissions.TRANSACTIONS_WRITE,
    Permissions.ACCOUNTS_WRITE,
    Permissions.CARDS_WRITE,
    Permissions.CATEGORIES_WRITE,
    Permissions.BUDGETS_WRITE,
    Permissions.PURCHASES_WRITE,
    Permissions.PURCHASES_READ,
    Permissions.LOCATIONS_WRITE,
    Permissions.PRODUCTS_WRITE,
    Permissions.REFUNDS_WRITE,
    Permissions.ATTRIBUTE_DEFINITIONS_MANAGE,
    Permissions.PRODUCTS_MERGE,
    Permissions.LOCATIONS_MERGE,
  ],
  [Roles.ADMIN]: [
    Permissions.SPACE_READ,
    Permissions.SPACE_UPDATE,
    Permissions.MEMBERS_MANAGE,
    Permissions.MEMBERS_READ,
    Permissions.FINANCE_READ,
    Permissions.REPORTS_READ,
    Permissions.AUDIT_READ,
    Permissions.TRANSACTIONS_WRITE,
    Permissions.ACCOUNTS_WRITE,
    Permissions.CARDS_WRITE,
    Permissions.CATEGORIES_WRITE,
    Permissions.BUDGETS_WRITE,
    Permissions.PURCHASES_WRITE,
    Permissions.PURCHASES_READ,
    Permissions.LOCATIONS_WRITE,
    Permissions.PRODUCTS_WRITE,
    Permissions.REFUNDS_WRITE,
    Permissions.ATTRIBUTE_DEFINITIONS_MANAGE,
    Permissions.PRODUCTS_MERGE,
    Permissions.LOCATIONS_MERGE,
  ],
  [Roles.EDITOR]: [
    Permissions.SPACE_READ,
    Permissions.MEMBERS_READ,
    Permissions.FINANCE_READ,
    Permissions.REPORTS_READ,
    Permissions.TRANSACTIONS_WRITE,
    Permissions.ACCOUNTS_WRITE,
    Permissions.CARDS_WRITE,
    Permissions.CATEGORIES_WRITE,
    Permissions.BUDGETS_WRITE,
    Permissions.PURCHASES_WRITE,
    Permissions.PURCHASES_READ,
    Permissions.LOCATIONS_WRITE,
    Permissions.PRODUCTS_WRITE,
    Permissions.REFUNDS_WRITE,
  ],
  [Roles.VIEWER]: [
    Permissions.SPACE_READ,
    Permissions.MEMBERS_READ,
    Permissions.FINANCE_READ,
    Permissions.REPORTS_READ,
    Permissions.PURCHASES_READ,
  ],
};

/**
 * Verifica se um papel possui uma determinada permissão.
 * Implementa DENY-BY-DEFAULT estrito para papéis inválidos ou nulos.
 *
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
export function hasPermission(role, permission) {
  if (!role || typeof role !== 'string') return false;
  const perms = ROLE_PERMISSIONS[role.toLowerCase()];
  if (!perms) return false;
  return perms.includes(permission);
}

/**
 * Valida o contexto de autorização da requisição.
 * Lança AppError se não autenticado, se membro inativo/inexistente ou sem permissão.
 *
 * @param {object} authContext
 * @param {string} [requiredPermission]
 * @throws {AppError}
 */
export function requireAuthorization(authContext, requiredPermission) {
  if (!authContext || !authContext.userId) {
    throw new AppError(
      ErrorCodes.UNAUTHENTICATED,
      'Autenticação necessária para acessar este recurso.',
      401,
    );
  }

  if (!authContext.spaceId) {
    throw new AppError(
      ErrorCodes.FORBIDDEN,
      'Espaço de trabalho não especificado no contexto da requisição.',
      403,
    );
  }

  if (!authContext.membership || authContext.membership.status !== 'active') {
    throw new AppError(
      ErrorCodes.FORBIDDEN,
      'Usuário não possui acesso ativo a este espaço de trabalho.',
      403,
    );
  }

  const role = authContext.membership.role;
  if (!Object.values(Roles).includes(role)) {
    throw new AppError(
      ErrorCodes.INVALID_ROLE,
      `Papel de acesso '${role}' é inválido.`,
      403,
    );
  }

  if (requiredPermission) {
    if (!hasPermission(role, requiredPermission)) {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        `Ação negada: o papel '${role}' não possui a permissão necessária '${requiredPermission}'.`,
        403,
      );
    }
  }
}
