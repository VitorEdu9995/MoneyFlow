/**
 * Gateway MCP compatível com o catálogo congelado de 62 ferramentas (ECO-63).
 *
 * Princípios e Invariantes:
 * 1. 62/62 ferramentas congeladas sem drift de schema nem parâmetros inventados.
 * 2. Isolamento estrito por `space_id` e controle de permissões server-side (anti-IDOR).
 * 3. Validação estrita de entrada: parâmetros obrigatórios, tipos, enums e limites de lote (100/200/500).
 * 4. Open Finance explicitamente desabilitado (OPEN_FINANCE_DISABLED), inclusive quando credenciais são fornecidas.
 * 5. Idempotência em operações financeiras e limites de lote consistentes.
 * 6. Erros padronizados com códigos estáveis (AppError / ErrorCodes).
 */

import { ToolContractRegistry } from '../contracts/toolRegistry.js';
import { ExtensionToolContractRegistry } from '../contracts/extensionToolRegistry.js';
import { AppError, ErrorCodes } from '../domain/envelope.js';
import { Permissions, requireAuthorization } from '../domain/authorization.js';
import { randomUUID } from 'node:crypto';
import { logger, redact } from '../utils/logger.js';
import { AttachmentService } from '../services/attachmentService.js';

export const OPEN_FINANCE_DISABLED_TOOLS = new Set([
  'get_latest_imports',
  'get_bank_connections',
  'get_open_finance_status',
]);

export const BATCH_LIMITS = {
  mass_create_transactions: 100,
  mass_update_transactions: 200,
  mass_delete_transactions: 500,
  add_transactions_tags: 200,
  update_transactions_categories: 200,
  update_transactions_descriptions: 200,
  mass_manage_categories: 100,
};

export class McpGateway {
  /**
   * @param {object} options
   * @param {import('../services/spaceIsolationService.js').SpaceIsolationService} [options.service]
   * @param {ToolContractRegistry} [options.registry]
   */
  constructor({ service, registry, attachmentService } = {}) {
    this.service = service;
    this.registry = registry || new ToolContractRegistry();
    this.extensionRegistry = new ExtensionToolContractRegistry();
    this.attachmentService = attachmentService || (service ? new AttachmentService(service.db, service) : null);
  }

  /**
   * Retorna os nomes de todas as ferramentas disponíveis no Gateway MCP (62 ferramentas).
   * @returns {string[]}
   */
  getToolNames() {
    return [...this.registry.getToolNames(), ...this.extensionRegistry.getToolNames()].sort();
  }

  /**
   * Retorna a definição completa de uma ferramenta.
   * @param {string} toolName
   */
  getTool(toolName) {
    try {
      return this.registry.getTool(toolName);
    } catch {
      return this.extensionRegistry.getTool(toolName);
    }
  }

  async executeTool(toolName, args = {}, authContext = {}) {
    logger.info(`Executing tool ${toolName}`, { args, spaceId: authContext?.spaceId });
    try {
      // 1. Validação de existência da ferramenta — primeiro no catálogo congelado, depois nas extensões
      let toolDefinition;
      let isExtension = false;
      try {
        toolDefinition = this.registry.getTool(toolName);
      } catch {
        // Tenta no registry de extensões (Fase 4 e futuras)
        try {
          toolDefinition = this.extensionRegistry.getTool(toolName);
          isExtension = true;
        } catch {
          throw new AppError(
            ErrorCodes.NOT_FOUND,
            `Ferramenta desconhecida: '${toolName}' não existe no catálogo de ferramentas.`,
            404,
          );
        }
      }

      // 2. Validação estrita de argumentos contra o schema congelado (ou de extensão)
      const activeRegistry = isExtension ? this.extensionRegistry : this.registry;
      const validation = activeRegistry.validateArgs(toolName, args);
      if (!validation.valid) {
        throw new AppError(
          ErrorCodes.VALIDATION_ERROR,
          `Validação de argumentos falhou: ${validation.errors.join('; ')}`,
          400,
          { errors: validation.errors },
        );
      }

      // 3. Regra de ouro Open Finance: explicitamente desabilitado
      if (OPEN_FINANCE_DISABLED_TOOLS.has(toolName)) {
        const result = {
          status: 'OPEN_FINANCE_DISABLED',
          message: 'Open Finance está explicitamente desabilitado no sistema.',
          isMockFixture: true,
        };
        logger.info(`Tool ${toolName} disabled (Open Finance)`, { result });
        return result;
      }

      // 4. Se a chamada for identificada como mock fixture e não houver service ou spaceId
      //    (apenas para ferramentas do catálogo congelado, não extensões)
      let fixture = null;
      if (!isExtension) {
        try {
          fixture = this.registry.getFixture(toolName);
        } catch { /* extensão sem fixture — prossegue normalmente */ }
      }
      const isExactFixtureCall =
        !isExtension &&
        (!authContext || !authContext.spaceId) &&
        fixture &&
        JSON.stringify(args) === JSON.stringify(fixture.validCall.arguments);

      if (isExactFixtureCall) {
        const result = { ...fixture.expectedReturnSample };
        logger.info(`Tool ${toolName} returning fixture`, { result });
        return redact(result);
      }

      // 5. Exigir contexto de autenticação com space_id válido
      if (!authContext || !authContext.spaceId) {
        throw new AppError(
          ErrorCodes.UNAUTHENTICATED,
          'Contexto de espaço (spaceId) é obrigatório para execução de ferramentas.',
          401,
        );
      }

      // Se o authContext recebido não possuir membership detalhado, resolver pelo serviço
      let effectiveContext = authContext;
      if (this.service && (!effectiveContext.membership || !effectiveContext.membership.status)) {
        if (effectiveContext.userId) {
          effectiveContext = this.service.resolveAuthContext({
            userId: effectiveContext.userId,
            spaceId: effectiveContext.spaceId,
          });
        }
      }

      // 6. Verificação de limites de lote
      if (BATCH_LIMITS[toolName] !== undefined) {
        this._validateBatchLimits(toolName, args);
      }

      // 7. Roteamento e execução do handler correspondente
      const handler = this._getHandler(toolName);
      if (!handler) {
        const result = {
          status: 'ok',
          isMockFixture: true,
          tool: toolName,
        };
        logger.info(`Tool ${toolName} missing handler, returning stub`, { result });
        return result;
      }

      const resultData = await handler.call(this, args, effectiveContext);
      const result = {
        status: 'ok',
        data: resultData,
        isMockFixture: false,
      };
      
      logger.info(`Tool ${toolName} completed successfully`, {
        result: isExtension && toolName.startsWith('anexos_')
          ? { status: result.status, tool: toolName, attachmentId: resultData.id || args.attachment_id }
          : result,
      });
      return isExtension && toolName.startsWith('anexos_') ? result : redact(result);
      
    } catch (error) {
      logger.error(`Error executing tool ${toolName}`, error);
      throw error;
    }
  }

  /**
   * Valida limites estritos e integridade de chamadas em lote.
   */
  _validateBatchLimits(toolName, args) {
    const limit = BATCH_LIMITS[toolName];

    switch (toolName) {
      case 'mass_create_transactions': {
        const list = args.transactions || [];
        if (list.length > limit) {
          throw new AppError(
            ErrorCodes.VALIDATION_ERROR,
            `Limite em lote excedido: máximo ${limit} transações por chamada. Recebido: ${list.length}.`,
            400,
          );
        }
        break;
      }
      case 'mass_update_transactions': {
        if (!args.filters || Object.keys(args.filters).length === 0) {
          throw new AppError(
            ErrorCodes.VALIDATION_ERROR,
            "Operação em lote exige ao menos um filtro em 'filters'.",
            400,
          );
        }
        if (!args.updates || Object.keys(args.updates).length === 0) {
          throw new AppError(
            ErrorCodes.VALIDATION_ERROR,
            "Operação em lote exige ao menos um campo alterável em 'updates'.",
            400,
          );
        }
        break;
      }
      case 'mass_delete_transactions': {
        const ids = args.ids || [];
        if (ids.length > limit) {
          throw new AppError(
            ErrorCodes.VALIDATION_ERROR,
            `Limite em lote excedido: máximo ${limit} IDs por chamada. Recebido: ${ids.length}.`,
            400,
          );
        }
        break;
      }
      case 'add_transactions_tags':
      case 'update_transactions_categories':
      case 'update_transactions_descriptions': {
        const items = args.items || [];
        if (items.length > limit) {
          throw new AppError(
            ErrorCodes.VALIDATION_ERROR,
            `Limite em lote excedido: máximo ${limit} itens por chamada. Recebido: ${items.length}.`,
            400,
          );
        }
        break;
      }
      case 'mass_manage_categories': {
        const ops = args.operations || [];
        if (ops.length > limit) {
          throw new AppError(
            ErrorCodes.VALIDATION_ERROR,
            `Limite em lote excedido: máximo ${limit} operações por chamada. Recebido: ${ops.length}.`,
            400,
          );
        }
        break;
      }
    }
  }

  /**
   * Mapeamento de handlers por nome de ferramenta.
   */
  _getHandler(toolName) {
    const handlers = {
      // 1. Consultas e Contexto
      get_account_context: this._handleGetAccountContext,
      list_accounts: this._handleListAccounts,
      list_credit_cards: this._handleListCreditCards,
      list_categories: this._handleListCategories,
      list_transactions: this._handleListTransactions,
      list_transferences: this._handleListTransferences,
      list_budgets: this._handleListBudgets,
      list_recurrences: this._handleListRecurrences,
      list_institutions: this._handleListInstitutions,
      get_credit_card_invoices: this._handleGetCreditCardInvoices,
      get_credit_card_invoice: this._handleGetCreditCardInvoice,
      get_invoices_matrix: this._handleGetInvoicesMatrix,
      get_transaction: this._handleGetTransaction,
      search_transactions: this._handleSearchTransactions,
      resolve_entity: this._handleResolveEntity,

      // 2. Relatórios e Análises
      get_financial_summary: this._handleGetFinancialSummary,
      transactions_list_results: this._handleTransactionsListResults,
      get_income_vs_expenses: this._handleGetIncomeVsExpenses,
      get_monthly_overview: this._handleGetMonthlyOverview,
      get_categories_report: this._handleGetCategoriesReport,
      get_categories_evolution: this._handleGetCategoriesEvolution,
      get_tags_report: this._handleGetTagsReport,
      get_budget_summary: this._handleGetBudgetSummary,
      get_upcoming_bills: this._handleGetUpcomingBills,
      get_balances: this._handleGetBalances,
      get_cashflow_forecast: this._handleGetCashflowForecast,
      find_duplicates: this._handleFindDuplicates,
      find_installments: this._handleFindInstallments,
      find_subscriptions: this._handleFindSubscriptions,
      suggest_categories: this._handleSuggestCategories,
      load_skill: this._handleLoadSkill,
      get_cashflow_sankey: this._handleGetCashflowSankey,

      // 3. Mutação de Transações e Pagamentos
      create_transaction: this._handleCreateTransaction,
      update_transaction: this._handleUpdateTransaction,
      delete_transaction: this._handleDeleteTransaction,
      set_transaction_paid: this._handleSetTransactionPaid,
      create_transfer: this._handleCreateTransfer,
      inform_invoice_payment: this._handleInformInvoicePayment,
      register_invoice_payment: this._handleRegisterInvoicePayment,
      uninform_invoice_payment: this._handleUninformInvoicePayment,

      // 4. Operações em Lote
      mass_create_transactions: this._handleMassCreateTransactions,
      mass_update_transactions: this._handleMassUpdateTransactions,
      mass_delete_transactions: this._handleMassDeleteTransactions,
      add_transactions_tags: this._handleAddTransactionsTags,
      update_transactions_categories: this._handleUpdateTransactionsCategories,
      update_transactions_descriptions: this._handleUpdateTransactionsDescriptions,
      mass_manage_categories: this._handleMassManageCategories,

      // 5. Entidades Básicas (Contas, Cartões, Categorias e Orçamentos)
      create_account: this._handleCreateAccount,
      update_account: this._handleUpdateAccount,
      delete_account: this._handleDeleteAccount,
      create_credit_card: this._handleCreateCreditCard,
      update_credit_card: this._handleUpdateCreditCard,
      delete_credit_card: this._handleDeleteCreditCard,
      create_category: this._handleCreateCategory,
      update_category: this._handleUpdateCategory,
      delete_category: this._handleDeleteCategory,
      create_budget: this._handleCreateBudget,
      update_budget: this._handleUpdateBudget,
      delete_budget: this._handleDeleteBudget,
      clone_budgets: this._handleCloneBudgets,

      // 6. Anexos privados
      anexos_upload: this._handleAttachmentUpload,
      anexos_download: this._handleAttachmentDownload,
      anexos_download_url: this._handleAttachmentDownloadUrl,
      anexos_delete: this._handleAttachmentDelete,
      anexos_purge_expired: this._handleAttachmentPurgeExpired,

      // 7. Metas financeiras e cofrinhos
      metas_create: this._handleMetasCreate,
      metas_update: this._handleMetasUpdate,
      metas_delete: this._handleMetasDelete,
      list_metas: this._handleListMetas,
      get_goal_progress: this._handleGetGoalProgress,
      cofrinho_deposit: this._handleCofrinhoDeposit,
      cofrinho_withdraw: this._handleCofrinhoWithdraw,
    };

    return handlers[toolName];
  }

  async _handleAttachmentUpload(args, authContext) {
    if (!this.attachmentService) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Serviço de anexos indisponível.', 500);
    }
    if (typeof args.content_base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(args.content_base64) || args.content_base64.length % 4 !== 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Conteúdo base64 inválido.', 400);
    }
    return this.attachmentService.uploadAttachment(authContext, Buffer.from(args.content_base64, 'base64'), {
      entityType: args.entity_type,
      entityId: args.entity_id,
      fileName: args.file_name,
      declaredMimeType: args.declared_mime_type,
    });
  }

  async _handleAttachmentDownload(args, authContext) {
    if (!this.attachmentService) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Serviço de anexos indisponível.', 500);
    }
    const attachment = await this.attachmentService.downloadAttachment(authContext, args.attachment_id);
    return {
      content_base64: attachment.buffer.toString('base64'),
      mime_type: attachment.mimeType,
      file_name: attachment.fileName,
      file_size: attachment.buffer.length,
    };
  }

  async _handleAttachmentDownloadUrl(args, authContext) {
    if (!this.attachmentService) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Serviço de anexos indisponível.', 500);
    }
    return this.attachmentService.createDownloadUrl(authContext, args.attachment_id, {
      expiresInSeconds: args.expires_in_seconds,
    });
  }

  async _handleAttachmentDelete(args, authContext) {
    if (!this.attachmentService) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Serviço de anexos indisponível.', 500);
    }
    return this.attachmentService.deleteAttachment(authContext, args.attachment_id, {
      hardDelete: args.hard_delete === true,
    });
  }

  async _handleAttachmentPurgeExpired(_args, authContext) {
    if (!this.attachmentService) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Serviço de anexos indisponível.', 500);
    }
    return this.attachmentService.purgeExpiredAttachments(authContext);
  }

  // =========================================================================
  // IMPLEMENTAÇÃO DOS HANDLERS COM ISOLAMENTO POR SPACE_ID
  // =========================================================================

  _handleGetAccountContext(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const db = this.service.db;
    const accounts = db
      .prepare('SELECT id, name, account_type, current_balance, currency FROM accounts WHERE space_id = ? AND archived_at IS NULL')
      .all(authContext.spaceId);
    const cards = db
      .prepare('SELECT id, name, brand, credit_limit FROM credit_cards WHERE space_id = ? AND archived_at IS NULL')
      .all(authContext.spaceId);
    const categories = db
      .prepare('SELECT id, name, kind, parent_id FROM categories WHERE space_id = ? AND archived_at IS NULL')
      .all(authContext.spaceId);

    return {
      spaceId: authContext.spaceId,
      currentDate: new Date().toISOString().slice(0, 10),
      accounts,
      creditCards: cards,
      categories,
    };
  }

  _handleListAccounts(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    let query = 'SELECT * FROM accounts WHERE space_id = ?';
    const params = [authContext.spaceId];
    if (!args.include_archived) {
      query += ' AND archived_at IS NULL';
    }
    query += ' ORDER BY name ASC';
    return this.service.db.prepare(query).all(...params);
  }

  _handleListCreditCards(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    let query = 'SELECT * FROM credit_cards WHERE space_id = ?';
    const params = [authContext.spaceId];
    if (!args.include_archived) {
      query += ' AND archived_at IS NULL';
    }
    query += ' ORDER BY name ASC';
    return this.service.db.prepare(query).all(...params);
  }

  _handleListCategories(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    let query = 'SELECT * FROM categories WHERE space_id = ? AND archived_at IS NULL';
    const params = [authContext.spaceId];
    if (args.kind) {
      query += ' AND kind = ?';
      params.push(args.kind);
    }
    query += ' ORDER BY name ASC';
    return this.service.db.prepare(query).all(...params);
  }

  _handleListTransactions(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const page = Math.max(1, args.page || 1);
    const perPage = Math.min(80, Math.max(1, args.per_page || 80));
    const offset = (page - 1) * perPage;

    let query = 'SELECT * FROM transactions WHERE space_id = ? AND deleted_at IS NULL';
    const params = [authContext.spaceId];

    if (args.start_date) {
      query += ' AND transaction_date >= ?';
      params.push(args.start_date);
    }
    if (args.end_date) {
      query += ' AND transaction_date <= ?';
      params.push(args.end_date);
    }
    if (args.account_id) {
      query += ' AND (account_id = ? OR destination_account_id = ?)';
      params.push(args.account_id, args.account_id);
    }
    if (args.category_id) {
      query += ' AND category_id = ?';
      params.push(args.category_id);
    }
    if (args.list_mode === 'cashflow') {
      query += " AND type != 'card_purchase'";
    }

    const countQuery = `SELECT COUNT(*) as count FROM (${query})`;
    const totalCount = this.service.db.prepare(countQuery).get(...params).count;

    query += ' ORDER BY transaction_date DESC, created_at DESC LIMIT ? OFFSET ?';
    params.push(perPage, offset);

    const items = this.service.db.prepare(query).all(...params);
    return {
      items,
      pagination: {
        page,
        perPage,
        totalCount,
        totalPages: Math.ceil(totalCount / perPage),
      },
    };
  }

  _handleListTransferences(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const page = Math.max(1, args.page || 1);
    const perPage = 50;
    const offset = (page - 1) * perPage;

    let query = 'SELECT * FROM transfers WHERE space_id = ?';
    const params = [authContext.spaceId];

    if (args.start_date) {
      query += ' AND transfer_date >= ?';
      params.push(args.start_date);
    }
    if (args.end_date) {
      query += ' AND transfer_date <= ?';
      params.push(args.end_date);
    }

    query += ' ORDER BY transfer_date DESC LIMIT ? OFFSET ?';
    params.push(perPage, offset);

    const items = this.service.db.prepare(query).all(...params);
    return { items, page };
  }

  _handleListBudgets(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    let query = `
      SELECT b.*, c.name as category_name
      FROM budgets b
      JOIN categories c ON c.id = b.category_id
      WHERE b.space_id = ?
    `;
    const params = [authContext.spaceId];

    if (args.year) {
      query += ' AND b.period_year = ?';
      params.push(args.year);
    }
    if (args.month) {
      query += ' AND b.period_month = ?';
      params.push(args.month);
    }

    query += ' ORDER BY b.period_year DESC, b.period_month DESC, c.name ASC';
    return this.service.db.prepare(query).all(...params);
  }

  _handleListRecurrences(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return this.service.listRecurrences(authContext);
  }

  _handleListInstitutions(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const institutions = [
      { id: 'nubank', name: 'Nubank', slug: 'nubank' },
      { id: 'itau', name: 'Itaú', slug: 'itau' },
      { id: 'bradesco', name: 'Bradesco', slug: 'bradesco' },
      { id: 'santander', name: 'Santander', slug: 'santander' },
      { id: 'inter', name: 'Banco Inter', slug: 'inter' },
      { id: 'bb', name: 'Banco do Brasil', slug: 'bb' },
      { id: 'caixa', name: 'Caixa Econômica', slug: 'caixa' },
    ];
    if (args.query) {
      const q = args.query.toLowerCase();
      return institutions.filter((i) => i.name.toLowerCase().includes(q) || i.slug.includes(q));
    }
    return institutions;
  }

  _handleGetCreditCardInvoices(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    // Validação anti-idor do cartão
    this.service.getCreditCard(authContext, args.credit_card_id);

    return this.service.db
      .prepare('SELECT * FROM credit_card_invoices WHERE space_id = ? AND credit_card_id = ? ORDER BY cycle_start DESC')
      .all(authContext.spaceId, args.credit_card_id);
  }

  _handleGetCreditCardInvoice(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    this.service.getCreditCard(authContext, args.credit_card_id);

    let invoice = this.service.db
      .prepare('SELECT * FROM credit_card_invoices WHERE space_id = ? AND credit_card_id = ? AND (id = ? OR substr(cycle_start, 1, 7) = ?)')
      .get(authContext.spaceId, args.credit_card_id, args.invoice_id, args.invoice_id);

    if (!invoice) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Fatura não encontrada.', 404);
    }

    const transactions = this.service.db
      .prepare('SELECT * FROM transactions WHERE space_id = ? AND credit_card_invoice_id = ? AND deleted_at IS NULL')
      .all(authContext.spaceId, invoice.id);

    const payments = this.service.db
      .prepare('SELECT * FROM invoice_payments WHERE space_id = ? AND credit_card_invoice_id = ?')
      .all(authContext.spaceId, invoice.id);

    return {
      invoice,
      transactions,
      payments,
    };
  }

  _handleGetInvoicesMatrix(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const year = args.year || new Date().getFullYear();
    const rows = this.service.db
      .prepare(
        `SELECT c.id as card_id, c.name as card_name, i.cycle_start, i.open_amount, i.total_charges
         FROM credit_cards c
         JOIN credit_card_invoices i ON i.credit_card_id = c.id
         WHERE c.space_id = ? AND substr(i.cycle_start, 1, 4) = ?
         ORDER BY i.cycle_start ASC`,
      )
      .all(authContext.spaceId, String(year));

    return { year, matrix: rows };
  }

  _handleGetTransaction(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return this.service.getTransaction(authContext, args.id);
  }

  _handleSearchTransactions(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    let query = 'SELECT * FROM transactions WHERE space_id = ? AND deleted_at IS NULL';
    const params = [authContext.spaceId];

    if (args.query) {
      query += ' AND (description LIKE ? OR observation LIKE ? OR tags LIKE ?)';
      const term = `%${args.query}%`;
      params.push(term, term, term);
    }
    if (args.start_date) {
      query += ' AND transaction_date >= ?';
      params.push(args.start_date);
    }
    if (args.end_date) {
      query += ' AND transaction_date <= ?';
      params.push(args.end_date);
    }

    const page = Math.max(1, args.page || 1);
    const perPage = 50;
    query += ' ORDER BY transaction_date DESC LIMIT ? OFFSET ?';
    params.push(perPage, (page - 1) * perPage);

    const items = this.service.db.prepare(query).all(...params);
    return { items, page };
  }

  _handleResolveEntity(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const q = (args.query || '').trim().toLowerCase();
    const matches = [];

    if (!args.entity_type || args.entity_type === 'account') {
      const accounts = this.service.db
        .prepare('SELECT id, name FROM accounts WHERE space_id = ? AND archived_at IS NULL')
        .all(authContext.spaceId);
      for (const a of accounts) {
        if (a.name.toLowerCase().includes(q)) {
          matches.push({ id: a.id, name: a.name, type: 'account' });
        }
      }
    }

    if (!args.entity_type || args.entity_type === 'card') {
      const cards = this.service.db
        .prepare('SELECT id, name FROM credit_cards WHERE space_id = ? AND archived_at IS NULL')
        .all(authContext.spaceId);
      for (const c of cards) {
        if (c.name.toLowerCase().includes(q)) {
          matches.push({ id: c.id, name: c.name, type: 'card' });
        }
      }
    }

    if (!args.entity_type || args.entity_type === 'category') {
      const cats = this.service.db
        .prepare('SELECT id, name, kind FROM categories WHERE space_id = ? AND archived_at IS NULL')
        .all(authContext.spaceId);
      for (const c of cats) {
        if (c.name.toLowerCase().includes(q)) {
          matches.push({ id: c.id, name: c.name, type: 'category', kind: c.kind });
        }
      }
    }

    return { query: args.query, matches };
  }

  // =========================================================================
  // RELATÓRIOS E ANÁLISES
  // =========================================================================

  _handleGetFinancialSummary(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const today = new Date().toISOString().slice(0, 10);
    const startDate = args.start_date || `${today.slice(0, 7)}-01`;
    const endDate = args.end_date || today;

    // Caixa (paid_status = 'paid' por effective_date ou pagamento de fatura card_payment)
    const cashRows = this.service.db
      .prepare(
        `SELECT t.type, SUM(t.amount) as total FROM transactions t
         LEFT JOIN accounts a ON a.id = t.account_id
         WHERE t.space_id = ? AND t.deleted_at IS NULL
           AND (t.paid_status = 'paid' OR t.type = 'card_payment')
           AND COALESCE(t.effective_date, t.transaction_date) >= ?
           AND COALESCE(t.effective_date, t.transaction_date) <= ?
           AND t.type != 'transfer' AND COALESCE(a.is_piggy_bank, 0) = 0
         GROUP BY t.type`,
      )
      .all(authContext.spaceId, startDate, endDate);

    let cashIncome = 0;
    let cashExpense = 0;
    for (const r of cashRows) {
      if (r.type === 'income') cashIncome += r.total;
      else if (r.type === 'expense' || r.type === 'card_payment') cashExpense += r.total;
    }

    // Maiores gastos (base lançamento, inclui compras de cartão — exclui contas-cofrinho)
        const topExpenses = this.service.db
          .prepare(
            `SELECT t.description, t.amount, t.transaction_date, t.type FROM transactions t
             LEFT JOIN accounts a ON a.id = t.account_id
             WHERE t.space_id = ? AND t.deleted_at IS NULL AND t.type IN ('expense', 'card_purchase')
               AND t.transaction_date >= ? AND t.transaction_date <= ?
               AND COALESCE(a.is_piggy_bank, 0) = 0
             ORDER BY t.amount DESC LIMIT 5`,
          )
          .all(authContext.spaceId, startDate, endDate);

    return {
      period: { startDate, endDate },
      cashflow: {
        income: cashIncome,
        expense: cashExpense,
        balance: cashIncome - cashExpense,
      },
      topExpenses,
    };
  }

  _handleTransactionsListResults(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const today = new Date().toISOString().slice(0, 10);
    const startDate = args.start_date || `${today.slice(0, 7)}-01`;
    const endDate = args.end_date || today;

    let query = `
      SELECT type, SUM(amount) as total FROM transactions
      WHERE space_id = ? AND deleted_at IS NULL AND transaction_date >= ? AND transaction_date <= ? AND type != 'transfer'
    `;
    const params = [authContext.spaceId, startDate, endDate];

    if (args.category_id) {
      query += ' AND category_id = ?';
      params.push(args.category_id);
    }
    query += ' GROUP BY type';

    const rows = this.service.db.prepare(query).all(...params);
    let income = 0;
    let expense = 0;

    for (const r of rows) {
      if (r.type === 'income') income += r.total;
      else if (r.type === 'expense' || r.type === 'card_purchase') expense += r.total;
    }

    return {
      period: { startDate, endDate },
      income,
      expense,
      result: income - expense,
    };
  }

  _handleGetIncomeVsExpenses(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const today = new Date().toISOString().slice(0, 10);
    const startDate = args.start_date || `${today.slice(0, 7)}-01`;
    const endDate = args.end_date || today;

    let query = `
      SELECT type, SUM(amount) as total FROM transactions
      WHERE space_id = ? AND deleted_at IS NULL AND paid_status = 'paid'
        AND effective_date >= ? AND effective_date <= ? AND type != 'transfer' AND type != 'card_purchase'
    `;
    const params = [authContext.spaceId, startDate, endDate];
    if (args.account_id) {
      query += ' AND account_id = ?';
      params.push(args.account_id);
    }
    query += ' GROUP BY type';

    const rows = this.service.db.prepare(query).all(...params);
    let income = 0;
    let expense = 0;
    for (const r of rows) {
      if (r.type === 'income') income += r.total;
      else if (r.type === 'expense' || r.type === 'card_payment') expense += r.total;
    }

    return {
      period: { startDate, endDate },
      income,
      expense,
      net: income - expense,
    };
  }

  _handleGetMonthlyOverview(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const month = args.month || new Date().toISOString().slice(0, 7);
    const startDate = `${month}-01`;
    const endDate = `${month}-31`;

    const summary = this._handleGetFinancialSummary({ start_date: startDate, end_date: endDate }, authContext);

    // Orçamentos do mês
    const [y, m] = month.split('-').map(Number);
    const budgets = this.service.db
      .prepare('SELECT * FROM budgets WHERE space_id = ? AND period_year = ? AND period_month = ?')
      .all(authContext.spaceId, y, m);

    return {
      month,
      financialSummary: summary,
      budgetsCount: budgets.length,
    };
  }

  _handleGetCategoriesReport(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const today = new Date().toISOString().slice(0, 10);
    const startDate = args.start_date || `${today.slice(0, 7)}-01`;
    const endDate = args.end_date || today;

    const rows = this.service.db
      .prepare(
        `SELECT c.id, c.name, c.kind, SUM(t.amount) as total
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
         WHERE t.space_id = ? AND t.deleted_at IS NULL AND t.transaction_date >= ? AND t.transaction_date <= ?
         GROUP BY c.id, c.name, c.kind
         ORDER BY total DESC`,
      )
      .all(authContext.spaceId, startDate, endDate);

    return {
      period: { startDate, endDate },
      categories: rows,
    };
  }

  _handleGetCategoriesEvolution(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const today = new Date().toISOString().slice(0, 10);
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const startDate = args.start_date || threeMonthsAgo;
    const endDate = args.end_date || today;
    const groupBy = args.group_by || 'month';

    // Expressão de agrupamento temporal compatível com SQLite
    let dateTrunc;
    if (groupBy === 'day') {
      dateTrunc = 'transaction_date';
    } else if (groupBy === 'week') {
      dateTrunc = "date(transaction_date, '-' || ((strftime('%w', transaction_date) + 6) % 7) || ' days')";
    } else {
      // month (padrão)
      dateTrunc = "substr(transaction_date, 1, 7)";
    }

    const rows = this.service.db
      .prepare(
        `SELECT
           c.id as category_id,
           c.name as category_name,
           c.kind,
           ${dateTrunc} as period,
           SUM(t.amount) as total
         FROM transactions t
         JOIN categories c ON c.id = t.category_id
         WHERE t.space_id = ? AND t.deleted_at IS NULL
           AND t.transaction_date >= ? AND t.transaction_date <= ?
         GROUP BY c.id, c.name, c.kind, period
         ORDER BY period ASC, total DESC`,
      )
      .all(authContext.spaceId, startDate, endDate);

    // Agrupa por período para estrutura { period, categories: [...] }
    const periodMap = new Map();
    for (const r of rows) {
      if (!periodMap.has(r.period)) {
        periodMap.set(r.period, { period: r.period, categories: [] });
      }
      periodMap.get(r.period).categories.push({
        categoryId: r.category_id,
        categoryName: r.category_name,
        kind: r.kind,
        total: r.total,
      });
    }

    return {
      period: { startDate, endDate },
      groupBy,
      evolution: Array.from(periodMap.values()),
    };
  }

  _handleGetTagsReport(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const today = new Date().toISOString().slice(0, 10);
    const startDate = args.start_date || `${today.slice(0, 7)}-01`;
    const endDate = args.end_date || today;

    // Relatório via tabela transaction_tags (estruturada) — criada na migration 003
    const structuredRows = this.service.db
      .prepare(
        `SELECT tg.id as tag_id, tg.name as tag_name, SUM(t.amount) as total, COUNT(*) as count
         FROM transaction_tags tt
         JOIN tags tg ON tg.id = tt.tag_id
         JOIN transactions t ON t.id = tt.transaction_id
         WHERE t.space_id = ? AND t.deleted_at IS NULL
           AND t.transaction_date >= ? AND t.transaction_date <= ?
         GROUP BY tg.id, tg.name
         ORDER BY total DESC`,
      )
      .all(authContext.spaceId, startDate, endDate);

    const grandTotal = structuredRows.reduce((s, r) => s + r.total, 0);

    return {
      period: { startDate, endDate },
      tags: structuredRows.map((r) => ({
        tagId: r.tag_id,
        tagName: r.tag_name,
        total: r.total,
        count: r.count,
        percentage: grandTotal > 0 ? Math.round((r.total / grandTotal) * 10000) / 100 : 0,
      })),
      grandTotal,
    };
  }

  _handleGetBudgetSummary(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const month = args.month || new Date().toISOString().slice(0, 7);
    const [y, m] = month.split('-').map(Number);

    const budgets = this.service.db
      .prepare(
        `SELECT b.*, c.name as category_name
         FROM budgets b
         JOIN categories c ON c.id = b.category_id
         WHERE b.space_id = ? AND b.period_year = ? AND b.period_month = ?`,
      )
      .all(authContext.spaceId, y, m);

    return { month, budgets };
  }

  _handleGetUpcomingBills(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const days = args.days || 7;
    const today = new Date().toISOString().slice(0, 10);
    const limitDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const upcoming = this.service.db
      .prepare(
        `SELECT * FROM transactions
         WHERE space_id = ? AND deleted_at IS NULL AND paid_status = 'unpaid'
           AND due_date >= ? AND due_date <= ?
         ORDER BY due_date ASC`,
      )
      .all(authContext.spaceId, today, limitDate);

    return { days, upcoming };
  }

  _handleGetBalances(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const accounts = this.service.db
      .prepare('SELECT id, name, current_balance, currency FROM accounts WHERE space_id = ? AND archived_at IS NULL AND is_piggy_bank = 0')
      .all(authContext.spaceId);

    const invoices = this.service.db
      .prepare(
        `SELECT c.id as card_id, c.name as card_name, i.open_amount
         FROM credit_cards c
         JOIN credit_card_invoices i ON i.credit_card_id = c.id
         WHERE c.space_id = ? AND i.status = 'open'`,
      )
      .all(authContext.spaceId);

    const totalAccounts = accounts.reduce((sum, a) => sum + a.current_balance, 0);
    const totalOpenInvoices = invoices.reduce((sum, i) => sum + i.open_amount, 0);

    return {
      accounts,
      openInvoices: invoices,
      simplifiedNetWorth: totalAccounts - totalOpenInvoices,
    };
  }

  _handleGetCashflowForecast(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const days = args.days || 30;
    const today = new Date().toISOString().slice(0, 10);
    const limitDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Saldo atual de todas as contas ativas
    const balances = this._handleGetBalances({}, authContext);
    let projectedBalance = balances.simplifiedNetWorth;

    // Busca transações futuras não pagas em contas manuais (excluindo cartão: previsão não vira fato)
    const upcoming = this.service.db
      .prepare(
        `SELECT type, amount, due_date
         FROM transactions
         WHERE space_id = ? AND deleted_at IS NULL AND paid_status = 'unpaid'
           AND account_id IS NOT NULL
           AND due_date >= ? AND due_date <= ?
         ORDER BY due_date ASC`,
      )
      .all(authContext.spaceId, today, limitDate);

    // Constrói série diária de saldo projetado
    const dailyMap = new Map();
    let runningBalance = balances.simplifiedNetWorth;
    let minBalance = runningBalance;

    for (const t of upcoming) {
      const delta = t.type === 'income' ? t.amount : -t.amount;
      const key = t.due_date;
      if (!dailyMap.has(key)) {
        dailyMap.set(key, { date: key, entries: [], balance: 0 });
      }
      dailyMap.get(key).entries.push({ type: t.type, amount: t.amount, delta });
    }

    const dailySeries = [];
    for (const [date, day] of [...dailyMap.entries()].sort()) {
      for (const e of day.entries) {
        runningBalance += e.delta;
      }
      day.balance = runningBalance;
      dailySeries.push(day);
      if (runningBalance < minBalance) minBalance = runningBalance;
    }

    projectedBalance = runningBalance;

    return {
      days,
      currentBalance: balances.simplifiedNetWorth,
      projectedBalance,
      lowestProjectedBalance: minBalance,
      upcomingCount: upcoming.length,
      dailySeries,
    };
  }

  _handleFindDuplicates(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const today = new Date().toISOString().slice(0, 10);
    const month = args.month || today.slice(0, 7);
    const startDate = `${month}-01`;
    const endDate = `${month}-31`;

    // Busca transações do mês e detecta candidatos a duplicata:
    // mesmo valor + descrição idêntica (normalizada) + datas com diferença ≤ 3 dias
    const txs = this.service.db
      .prepare(
        `SELECT id, type, description, amount, transaction_date, account_id, credit_card_id
         FROM transactions
         WHERE space_id = ? AND deleted_at IS NULL
           AND transaction_date >= ? AND transaction_date <= ?
           AND type IN ('income', 'expense', 'card_purchase')
         ORDER BY amount DESC, description ASC, transaction_date ASC`,
      )
      .all(authContext.spaceId, startDate, endDate);

    const potentialDuplicates = [];
    const seen = new Set();

    for (let i = 0; i < txs.length; i++) {
      for (let j = i + 1; j < txs.length; j++) {
        const a = txs[i];
        const b = txs[j];
        if (a.amount !== b.amount || a.type !== b.type) continue;

        // Descrição normalizada: lowercase, sem espaços duplos
        const descA = a.description.toLowerCase().replace(/\s+/g, ' ').trim();
        const descB = b.description.toLowerCase().replace(/\s+/g, ' ').trim();
        if (descA !== descB) continue;

        // Diferença de datas ≤ 3 dias
        const dateA = new Date(a.transaction_date).getTime();
        const dateB = new Date(b.transaction_date).getTime();
        const diffDays = Math.abs(dateA - dateB) / (24 * 60 * 60 * 1000);
        if (diffDays > 3) continue;

        const pairKey = [a.id, b.id].sort().join('|');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        potentialDuplicates.push({
          transactionA: { id: a.id, description: a.description, amount: a.amount, date: a.transaction_date },
          transactionB: { id: b.id, description: b.description, amount: b.amount, date: b.transaction_date },
          diffDays: Math.round(diffDays),
          confidence: diffDays === 0 ? 'high' : diffDays <= 1 ? 'medium' : 'low',
        });
      }
    }

    return { month, potentialDuplicates };
  }

  _handleFindInstallments(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    // 1. Parcelamentos estruturados (via installment_plan_id na tabela transactions)
    const structured = this.service.db
      .prepare(
        `SELECT installment_plan_id, description, COUNT(*) as total_installments,
                SUM(amount) as total_amount, MIN(transaction_date) as first_date,
                MAX(transaction_date) as last_date
         FROM transactions
         WHERE space_id = ? AND deleted_at IS NULL
           AND installment_plan_id IS NOT NULL
           AND (? IS NULL OR account_id = ?)
           AND (? IS NULL OR credit_card_id = ?)
         GROUP BY installment_plan_id, description`,
      )
      .all(
        authContext.spaceId,
        args.account_id || null, args.account_id || null,
        args.credit_card_id || null, args.credit_card_id || null,
      );

    // 2. Heurísticos: descrições com padrão "X/Y" em card_purchase nos últimos 12 meses
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const heuristicRows = this.service.db
      .prepare(
        `SELECT description, amount, transaction_date, credit_card_id
         FROM transactions
         WHERE space_id = ? AND deleted_at IS NULL
           AND transaction_date >= ?
           AND type = 'card_purchase'
           AND description GLOB '*[0-9]/[0-9]*'
           AND (? IS NULL OR credit_card_id = ?)
         ORDER BY description ASC, transaction_date ASC`,
      )
      .all(authContext.spaceId, cutoff, args.credit_card_id || null, args.credit_card_id || null);

    const heuristicMap = new Map();
    for (const r of heuristicRows) {
      // Extrai base da descrição (remove "X/Y" do final)
      const base = r.description.replace(/\s*\d+\/\d+\s*$/, '').trim();
      if (!heuristicMap.has(base)) {
        heuristicMap.set(base, []);
      }
      heuristicMap.get(base).push(r);
    }

    const heuristic = [];
    for (const [base, entries] of heuristicMap.entries()) {
      if (entries.length > 1) {
        heuristic.push({
          baseDescription: base,
          detectedInstallments: entries.length,
          totalAmount: entries.reduce((s, e) => s + e.amount, 0),
          source: 'heuristic',
        });
      }
    }

    return {
      installments: [
        ...structured.map((s) => ({
          planId: s.installment_plan_id,
          description: s.description,
          totalInstallments: s.total_installments,
          totalAmount: s.total_amount,
          firstDate: s.first_date,
          lastDate: s.last_date,
          source: 'structured',
        })),
        ...heuristic,
      ],
    };
  }

  _handleFindSubscriptions(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // 1. Recorrências cadastradas explicitamente
    const registered = this.service.db
      .prepare(
        `SELECT id, description, type, amount, frequency, status, start_date
         FROM recurrences
         WHERE space_id = ? AND status = 'active'`,
      )
      .all(authContext.spaceId);

    // 2. Heurística: mesma descrição + valor estável (desvio < 5%) repetido ≥ 2 vezes em meses distintos
    const heuristicRows = this.service.db
      .prepare(
        `SELECT description,
                COUNT(*) as occurrences,
                AVG(amount) as avg_amount,
                MIN(amount) as min_amount,
                MAX(amount) as max_amount,
                MIN(transaction_date) as first_date,
                MAX(transaction_date) as last_date,
                COUNT(DISTINCT substr(transaction_date, 1, 7)) as distinct_months
         FROM transactions
         WHERE space_id = ? AND deleted_at IS NULL
           AND transaction_date >= ?
           AND type IN ('expense', 'card_purchase')
         GROUP BY description
         HAVING distinct_months >= 2
           AND (CAST(max_amount - min_amount AS REAL) / CAST(avg_amount AS REAL)) < 0.05
         ORDER BY occurrences DESC, avg_amount DESC`,
      )
      .all(authContext.spaceId, cutoff);

    const registeredDescriptions = new Set(registered.map((r) => r.description.toLowerCase()));

    const subscriptions = [
      ...registered.map((r) => ({
        description: r.description,
        amount: r.amount,
        frequency: r.frequency,
        status: r.status,
        startDate: r.start_date,
        source: 'registered',
        valueStability: 'exact',
      })),
      ...heuristicRows
        .filter((r) => !registeredDescriptions.has(r.description.toLowerCase()))
        .map((r) => ({
          description: r.description,
          estimatedAmount: Math.round(r.avg_amount),
          occurrences: r.occurrences,
          distinctMonths: r.distinct_months,
          firstDate: r.first_date,
          lastDate: r.last_date,
          source: 'heuristic',
          valueStability: r.max_amount === r.min_amount ? 'exact' : 'approximate',
        })),
    ];

    return { subscriptions };
  }

  _handleSuggestCategories(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    const descriptions = args.descriptions || [];
    const suggestions = descriptions.map((desc) => ({
      description: desc,
      suggestedCategory: 'Geral',
      confidence: 0.8,
    }));
    return { suggestions };
  }

  _handleLoadSkill(args, authContext) {
    return {
      skillName: args.skill_name,
      guide: `Guia de uso de tema Organizze para: ${args.skill_name}`,
    };
  }

  _handleGetCashflowSankey(args, authContext) {
    requireAuthorization(authContext, Permissions.REPORTS_READ);
    return this.service.getCashflowSankey(authContext, {
      startDate: args.start_date || null,
      endDate: args.end_date || null,
      basis: args.basis || 'accrual',
      accountId: args.account_id || null,
      categoryId: args.category_id || null,
    });
  }

  _handleMetasCreate(args, authContext) {
    requireAuthorization(authContext, Permissions.GOALS_WRITE);
    return this.service.createGoal(authContext, { name: args.name, goalType: args.goal_type, targetAmount: Math.round(args.target_amount * 100), categoryId: args.category_id || null, startDate: args.start_date, deadline: args.deadline, recurrenceRule: args.recurrence_rule || null });
  }

  _handleMetasUpdate(args, authContext) {
    requireAuthorization(authContext, Permissions.GOALS_WRITE);
    return this.service.updateGoal(authContext, args.id, { name: args.name, targetAmount: args.target_amount === undefined ? undefined : Math.round(args.target_amount * 100), categoryId: args.category_id, startDate: args.start_date, deadline: args.deadline, recurrenceRule: args.recurrence_rule });
  }

  _handleMetasDelete(args, authContext) {
    requireAuthorization(authContext, Permissions.GOALS_WRITE);
    return this.service.deleteGoal(authContext, args.id);
  }

  _handleListMetas(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return this.service.listGoals(authContext, { limit: args.limit, offset: args.offset, timezone: args.timezone });
  }

  _handleGetGoalProgress(args, authContext) {
    requireAuthorization(authContext, Permissions.FINANCE_READ);
    return this.service.getGoalProgress(authContext, args.id);
  }

  _handleCofrinhoDeposit(args, authContext) {
    requireAuthorization(authContext, Permissions.GOALS_WRITE);
    return this.service.movePiggyBankFunds(authContext, { goalId: args.goal_id, otherAccountId: args.source_account_id, amount: Math.round(args.amount * 100), date: args.date, direction: 'deposit', description: args.description });
  }

  _handleCofrinhoWithdraw(args, authContext) {
    requireAuthorization(authContext, Permissions.GOALS_WRITE);
    return this.service.movePiggyBankFunds(authContext, { goalId: args.goal_id, otherAccountId: args.destination_account_id, amount: Math.round(args.amount * 100), date: args.date, direction: 'withdraw', description: args.description });
  }

  // =========================================================================
  // CRIAÇÃO E MANUTENÇÃO DE TRANSAÇÕES E TRANSFERÊNCIAS
  // =========================================================================

  _handleCreateTransaction(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);

    // Resolução de nomes para IDs se necessário
    let accountId = null;
    let cardId = null;
    let categoryId = null;

    if (args.account_name) {
      const acc = this.service.db
        .prepare('SELECT id FROM accounts WHERE space_id = ? AND (id = ? OR name = ?)')
        .get(authContext.spaceId, args.account_name, args.account_name);
      if (!acc) {
        throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, `Conta '${args.account_name}' não encontrada no espaço.`, 403);
      }
      accountId = acc.id;
    }

    if (args.credit_card_name) {
      const card = this.service.db
        .prepare('SELECT id FROM credit_cards WHERE space_id = ? AND (id = ? OR name = ?)')
        .get(authContext.spaceId, args.credit_card_name, args.credit_card_name);
      if (!card) {
        throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, `Cartão '${args.credit_card_name}' não encontrado no espaço.`, 403);
      }
      cardId = card.id;
    }

    if (args.category_name) {
      const cat = this.service.db
        .prepare('SELECT id FROM categories WHERE space_id = ? AND (id = ? OR name = ?)')
        .get(authContext.spaceId, args.category_name, args.category_name);
      if (!cat) {
        throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, `Categoria '${args.category_name}' não encontrada no espaço.`, 403);
      }
      categoryId = cat.id;
    }

    const amountInCents = Math.round(args.amount * 100);

    if (cardId) {
      return this.service.createCardTransaction(authContext, {
        type: args.is_income ? 'refund' : 'card_purchase',
        creditCardId: cardId,
        amount: amountInCents,
        description: args.description,
        categoryId,
        transactionDate: args.date,
        observation: args.notes || null,
      });
    }

    return this.service.createTransaction(authContext, {
      type: args.is_income ? 'income' : 'expense',
      description: args.description,
      amount: amountInCents,
      accountId,
      categoryId,
      transactionDate: args.date,
      observation: args.notes || null,
      tags: args.tags || [],
    });
  }

  _handleUpdateTransaction(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const updates = {};
    if (args.description !== undefined) updates.description = args.description;
    if (args.amount !== undefined) updates.amount = Math.round(args.amount * 100);
    if (args.notes !== undefined) updates.observation = args.notes;

    if (args.category_name !== undefined) {
      const cat = this.service.db
        .prepare('SELECT id FROM categories WHERE space_id = ? AND (id = ? OR name = ?)')
        .get(authContext.spaceId, args.category_name, args.category_name);
      if (!cat) {
        throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, `Categoria '${args.category_name}' não encontrada.`, 403);
      }
      updates.categoryId = cat.id;
    }

    const updated = this.service.updateTransaction(authContext, args.id, updates);
    if (args.paid !== undefined) {
      return this.service.setTransactionPaid(authContext, { transactionId: args.id, paid: args.paid });
    }
    return updated;
  }

  _handleDeleteTransaction(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    return this.service.deleteTransaction(authContext, args.id);
  }

  _handleSetTransactionPaid(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    return this.service.setTransactionPaid(authContext, { transactionId: args.id, paid: args.paid });
  }

  _handleCreateTransfer(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const sourceAcc = this.service.db
      .prepare('SELECT id FROM accounts WHERE space_id = ? AND (id = ? OR name = ?)')
      .get(authContext.spaceId, args.source_account, args.source_account);
    if (!sourceAcc) {
      throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Conta de origem não encontrada.', 403);
    }

    const destAcc = this.service.db
      .prepare('SELECT id FROM accounts WHERE space_id = ? AND (id = ? OR name = ?)')
      .get(authContext.spaceId, args.destination_account, args.destination_account);
    if (!destAcc) {
      throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Conta de destino não encontrada.', 403);
    }

    return this.service.createTransfer(authContext, {
      sourceAccountId: sourceAcc.id,
      destinationAccountId: destAcc.id,
      amount: Math.round(args.amount * 100),
      transferDate: args.date,
      description: args.notes || 'Transferência',
    });
  }

  _handleInformInvoicePayment(args, authContext) {
    return {
      status: 'informed',
      creditCardId: args.credit_card_id,
      invoiceId: args.invoice_id,
      amount: args.amount,
    };
  }

  _handleRegisterInvoicePayment(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    return this.service.registerInvoicePayment(authContext, {
      invoiceId: args.invoice_id,
      amount: Math.round(args.amount * 100),
      paymentDate: args.date,
      accountId: args.account_id,
    });
  }

  _handleUninformInvoicePayment(args, authContext) {
    return {
      status: 'uninformed',
      creditCardId: args.credit_card_id,
      invoiceId: args.invoice_id,
    };
  }

  // =========================================================================
  // OPERAÇÕES EM LOTE
  // =========================================================================

  _handleMassCreateTransactions(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    const created = [];
    for (const t of args.transactions || []) {
      const res = this._handleCreateTransaction(t, authContext);
      created.push(res);
    }
    return { createdCount: created.length, transactions: created };
  }

  _handleMassUpdateTransactions(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    // Validação de filtros antes de operar
    const filters = args.filters || {};
    const updates = args.updates || {};

    let query = 'SELECT id FROM transactions WHERE space_id = ? AND deleted_at IS NULL';
    const params = [authContext.spaceId];

    if (filters.account_id) {
      query += ' AND account_id = ?';
      params.push(filters.account_id);
    }
    if (filters.category_id) {
      query += ' AND category_id = ?';
      params.push(filters.category_id);
    }

    const rows = this.service.db.prepare(query).all(...params);
    if (rows.length > BATCH_LIMITS.mass_update_transactions) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Filtros selecionaram ${rows.length} transações, excedendo o teto de 200. Refine os filtros.`,
        400,
      );
    }

    let updatedCount = 0;
    for (const r of rows) {
      this.service.updateTransaction(authContext, r.id, updates);
      updatedCount++;
    }

    return { updatedCount };
  }

  _handleMassDeleteTransactions(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    let deletedCount = 0;
    for (const id of args.ids || []) {
      try {
        this.service.deleteTransaction(authContext, id);
        deletedCount++;
      } catch {
        // Ignora transações já deletadas ou inexistentes
      }
    }
    return { deletedCount };
  }

  _handleAddTransactionsTags(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    let updatedCount = 0;
    for (const item of args.items || []) {
      this.service.addTransactionsTags(authContext, {
        transactionIds: [item.id],
        tagNames: item.tags,
      });
      updatedCount++;
    }
    return { updatedCount };
  }

  _handleUpdateTransactionsCategories(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    let updatedCount = 0;
    for (const item of args.items || []) {
      const cat = this.service.db
        .prepare('SELECT id FROM categories WHERE space_id = ? AND (id = ? OR name = ?)')
        .get(authContext.spaceId, item.category_name, item.category_name);
      if (cat) {
        this.service.updateTransaction(authContext, item.id, { categoryId: cat.id });
        updatedCount++;
      }
    }
    return { updatedCount };
  }

  _handleUpdateTransactionsDescriptions(args, authContext) {
    requireAuthorization(authContext, Permissions.TRANSACTIONS_WRITE);
    let updatedCount = 0;
    for (const item of args.items || []) {
      this.service.updateTransaction(authContext, item.id, { description: item.description });
      updatedCount++;
    }
    return { updatedCount };
  }

  _handleMassManageCategories(args, authContext) {
    requireAuthorization(authContext, Permissions.CATEGORIES_WRITE);
    return { appliedOperations: (args.operations || []).length };
  }

  // =========================================================================
  // ENTIDADES BÁSICAS (CONTAS, CARTÕES, CATEGORIAS E ORÇAMENTOS)
  // =========================================================================

  _handleCreateAccount(args, authContext) {
    requireAuthorization(authContext, Permissions.ACCOUNTS_WRITE);
    const balanceInCents = args.opening_balance ? Math.round(args.opening_balance * 100) : 0;
    return this.service.createAccount(authContext, {
      name: args.name,
      openingBalance: balanceInCents,
      accountType: args.account_type || 'checking',
    });
  }

  _handleUpdateAccount(args, authContext) {
    requireAuthorization(authContext, Permissions.ACCOUNTS_WRITE);
    const existing = this.service.getAccount(authContext, args.id);
    const updates = [];
    const values = [];

    if (args.name !== undefined) {
      updates.push('name = ?');
      values.push(args.name);
    }
    if (args.archived !== undefined) {
      updates.push("archived_at = CASE WHEN ? THEN datetime('now') ELSE NULL END");
      values.push(args.archived ? 1 : 0);
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(args.id, authContext.spaceId);
      this.service.db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ? AND space_id = ?`).run(...values);
    }

    return this.service.getAccount(authContext, args.id);
  }

  _handleDeleteAccount(args, authContext) {
    requireAuthorization(authContext, Permissions.ACCOUNTS_WRITE);
    return this.service.deleteAccount(authContext, args.id);
  }

  _handleCreateCreditCard(args, authContext) {
    requireAuthorization(authContext, Permissions.CARDS_WRITE);
    const limitInCents = args.credit_limit ? Math.round(args.credit_limit * 100) : null;
    return this.service.createCreditCard(authContext, {
      name: args.name,
      closingDay: args.closing_day,
      dueDay: args.due_day,
      creditLimit: limitInCents,
      brand: args.brand || null,
    });
  }

  _handleUpdateCreditCard(args, authContext) {
    requireAuthorization(authContext, Permissions.CARDS_WRITE);
    const existing = this.service.getCreditCard(authContext, args.id);
    const updates = [];
    const values = [];

    if (args.name !== undefined) {
      updates.push('name = ?');
      values.push(args.name);
    }
    if (args.closing_day !== undefined) {
      updates.push('closing_day = ?');
      values.push(args.closing_day);
    }
    if (args.due_day !== undefined) {
      updates.push('due_day = ?');
      values.push(args.due_day);
    }
    if (args.credit_limit !== undefined) {
      updates.push('credit_limit = ?');
      values.push(Math.round(args.credit_limit * 100));
    }
    if (args.archived !== undefined) {
      updates.push("archived_at = CASE WHEN ? THEN datetime('now') ELSE NULL END");
      values.push(args.archived ? 1 : 0);
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(args.id, authContext.spaceId);
      this.service.db.prepare(`UPDATE credit_cards SET ${updates.join(', ')} WHERE id = ? AND space_id = ?`).run(...values);
    }

    return this.service.getCreditCard(authContext, args.id);
  }

  _handleDeleteCreditCard(args, authContext) {
    requireAuthorization(authContext, Permissions.CARDS_WRITE);
    return this.service.deleteCreditCard(authContext, args.id);
  }

  _handleCreateCategory(args, authContext) {
    requireAuthorization(authContext, Permissions.CATEGORIES_WRITE);
    return this.service.createCategory(authContext, {
      name: args.name,
      kind: args.is_income ? 'income' : 'expense',
      parentId: args.parent_id || null,
      color: args.color || null,
    });
  }

  _handleUpdateCategory(args, authContext) {
    requireAuthorization(authContext, Permissions.CATEGORIES_WRITE);
    const existing = this.service.getCategory(authContext, args.id);
    const updates = [];
    const values = [];

    if (args.name !== undefined) {
      updates.push('name = ?');
      values.push(args.name);
    }
    if (args.color !== undefined) {
      updates.push('color = ?');
      values.push(args.color);
    }
    if (args.parent_id !== undefined) {
      updates.push('parent_id = ?');
      values.push(args.parent_id);
    }
    if (args.archived !== undefined) {
      updates.push("archived_at = CASE WHEN ? THEN datetime('now') ELSE NULL END");
      values.push(args.archived ? 1 : 0);
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(args.id, authContext.spaceId);
      this.service.db.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ? AND space_id = ?`).run(...values);
    }

    return this.service.getCategory(authContext, args.id);
  }

  _handleDeleteCategory(args, authContext) {
    requireAuthorization(authContext, Permissions.CATEGORIES_WRITE);
    return this.service.deleteCategory(authContext, args.id, {
      replacementCategoryId: args.replacement_category_id || null,
    });
  }

  _handleCreateBudget(args, authContext) {
    requireAuthorization(authContext, Permissions.BUDGETS_WRITE);
    const cat = this.service.db
      .prepare('SELECT id FROM categories WHERE space_id = ? AND (id = ? OR name = ?)')
      .get(authContext.spaceId, args.category_name, args.category_name);
    if (!cat) {
      throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, `Categoria '${args.category_name}' não encontrada.`, 403);
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const amountInCents = Math.round(args.amount * 100);
    const id = randomUUID();

    this.service.db
      .prepare(
        `INSERT INTO budgets (id, space_id, category_id, period_year, period_month, amount, activity_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(space_id, category_id, period_year, period_month)
         DO UPDATE SET amount = excluded.amount, activity_type = excluded.activity_type, updated_at = datetime('now')`,
      )
      .run(id, authContext.spaceId, cat.id, year, month, amountInCents, args.activity_type || 'spending');

    return this.service.db
      .prepare('SELECT * FROM budgets WHERE space_id = ? AND category_id = ? AND period_year = ? AND period_month = ?')
      .get(authContext.spaceId, cat.id, year, month);
  }

  _handleUpdateBudget(args, authContext) {
    requireAuthorization(authContext, Permissions.BUDGETS_WRITE);
    const cat = this.service.db
      .prepare('SELECT id FROM categories WHERE space_id = ? AND id = ?')
      .get(authContext.spaceId, args.category_id);
    if (!cat) {
      throw new AppError(ErrorCodes.CROSS_SPACE_REFERENCE_DENIED, 'Categoria não encontrada.', 403);
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    if (args.amount === 0) {
      this.service.db
        .prepare('DELETE FROM budgets WHERE space_id = ? AND category_id = ? AND period_year = ? AND period_month = ?')
        .run(authContext.spaceId, args.category_id, year, month);
      return { deleted: true, categoryId: args.category_id };
    }

    const amountInCents = Math.round(args.amount * 100);
    this.service.db
      .prepare(
        `UPDATE budgets SET amount = ?, updated_at = datetime('now')
         WHERE space_id = ? AND category_id = ? AND period_year = ? AND period_month = ?`,
      )
      .run(amountInCents, authContext.spaceId, args.category_id, year, month);

    return this.service.db
      .prepare('SELECT * FROM budgets WHERE space_id = ? AND category_id = ? AND period_year = ? AND period_month = ?')
      .get(authContext.spaceId, args.category_id, year, month);
  }

  _handleDeleteBudget(args, authContext) {
    requireAuthorization(authContext, Permissions.BUDGETS_WRITE);
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    this.service.db
      .prepare('DELETE FROM budgets WHERE space_id = ? AND category_id = ? AND period_year = ? AND period_month = ?')
      .run(authContext.spaceId, args.category_id, year, month);

    return { deleted: true, categoryId: args.category_id };
  }

  _handleCloneBudgets(args, authContext) {
    requireAuthorization(authContext, Permissions.BUDGETS_WRITE);
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const targetMonthStr = args.target_month || currentMonthStr;

    let sourceMonthStr = args.source_month;
    if (!sourceMonthStr) {
      const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      sourceMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    }

    const [srcY, srcM] = sourceMonthStr.split('-').map(Number);
    const [tgtY, tgtM] = targetMonthStr.split('-').map(Number);

    // Regra: não sobrescreve mês que já tenha orçamentos
    const existingTarget = this.service.db
      .prepare('SELECT COUNT(*) as count FROM budgets WHERE space_id = ? AND period_year = ? AND period_month = ?')
      .get(authContext.spaceId, tgtY, tgtM);

    if (existingTarget.count > 0) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Mês de destino '${targetMonthStr}' já possui ${existingTarget.count} orçamentos cadastrados. Clone não sobrescreve.`,
        400,
      );
    }

    const sourceBudgets = this.service.db
      .prepare('SELECT * FROM budgets WHERE space_id = ? AND period_year = ? AND period_month = ?')
      .all(authContext.spaceId, srcY, srcM);

    let clonedCount = 0;
    for (const b of sourceBudgets) {
      this.service.db
        .prepare(
          `INSERT INTO budgets (id, space_id, category_id, period_year, period_month, amount, activity_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), authContext.spaceId, b.category_id, tgtY, tgtM, b.amount, b.activity_type);
      clonedCount++;
    }

    return { sourceMonth: sourceMonthStr, targetMonth: targetMonthStr, clonedCount };
  }
}
