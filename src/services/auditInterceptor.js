import { randomUUID } from 'node:crypto';
import { redact } from '../utils/logger.js';

export function withAuditInterceptor(serviceInstance) {
  const handler = {
    get(target, propKey, receiver) {
      const origMethod = target[propKey];
      if (typeof origMethod !== 'function' || propKey === 'logAudit') {
        return Reflect.get(target, propKey, receiver);
      }

      const config = AUDIT_MAP[propKey];
      if (!config) {
        return origMethod.bind(target);
      }

      return (...args) => {
        const authContext = args[0];
        
        let oldData = null;
        if (config.getOldData) {
          try {
            oldData = config.getOldData(target, args);
          } catch (e) {
            // Ignorar erro se não achar, ex: deletar algo que já não existe
          }
        }

        const result = origMethod.apply(target, args);

        let newData = null;
        let entityId = null;
        let action = typeof config.action === 'function' ? config.action(args, result) : config.action;

        if (config.getNewData) {
          newData = config.getNewData(result, args);
        }
        if (config.getEntityId) {
          entityId = config.getEntityId(result, args);
        }
        
        // Se a exclusão resultar em arquivamento, trocar a action
        if (result && result.archived === true && action.endsWith('.delete')) {
           action = action.replace('.delete', '.archive');
        }

        let spaceId = authContext?.spaceId;
        let actorUserId = authContext?.userId;

        if (propKey === 'createSpace') {
          spaceId = result.id;
          actorUserId = args[0]?.ownerUserId;
        } else if (!authContext || typeof authContext !== 'object') {
          // If the first argument is not an auth context, fallback to result if it has spaceId
          spaceId = result?.spaceId || null;
        }

        target.logAudit({
          id: randomUUID(),
          spaceId: spaceId || null,
          actorUserId: actorUserId || null,
          action,
          entityType: config.entityType,
          entityId,
          oldData: oldData ? redact(oldData) : null,
          newData: newData ? redact(newData) : null,
          ipAddress: authContext?.ipAddress || null,
          userAgent: authContext?.userAgent || null,
        });

        return result;
      };
    }
  };

  return new Proxy(serviceInstance, handler);
}

const AUDIT_MAP = {
  createSpace: { action: 'space.create', entityType: 'spaces', getEntityId: (res) => res.id, getNewData: (res) => res },
  addMember: { action: (args, res) => res.status === 'active' && args[2] ? 'member.update_role' : 'member.add', entityType: 'space_members', getEntityId: (res) => res.id, getNewData: (res) => res },
  revokeMember: { action: 'member.revoke', entityType: 'space_members', getEntityId: (res, args) => args[1], getOldData: (tgt, args) => tgt.getMembership(args[0].spaceId, args[1]), getNewData: () => ({ status: 'revoked' }) },
  createAccount: { action: 'account.create', entityType: 'accounts', getEntityId: (res) => res.id, getNewData: (res) => res },
  updateAccount: { action: 'account.update', entityType: 'accounts', getEntityId: (res) => res.id, getOldData: (tgt, args) => tgt.getAccount(args[0], args[1]), getNewData: (res) => res },
  deleteAccount: { action: 'account.delete', entityType: 'accounts', getEntityId: (res, args) => args[1], getNewData: (res) => res.archived ? { impactTransactions: res.impact.transactionsCount } : null },
  createCategory: { action: 'category.create', entityType: 'categories', getEntityId: (res) => res.id, getNewData: (res) => res },
  updateCategory: { action: 'category.update', entityType: 'categories', getEntityId: (res) => res.id, getOldData: (tgt, args) => tgt.getCategory(args[0], args[1]), getNewData: (res) => res },
  deleteCategory: { action: 'category.delete', entityType: 'categories', getEntityId: (res, args) => args[1], getNewData: (res) => res.archived ? { txCount: res.impact.transactionsCount, childCount: res.impact.childCategoriesCount, itemCount: res.impact.purchaseItemsCount } : null },
  createCreditCard: { action: 'credit_card.create', entityType: 'credit_cards', getEntityId: (res) => res.id, getNewData: (res) => res },
  updateCreditCard: { action: 'credit_card.update', entityType: 'credit_cards', getEntityId: (res) => res.id, getOldData: (tgt, args) => tgt.getCreditCard(args[0], args[1]), getNewData: (res) => res },
  deleteCreditCard: { action: 'credit_card.delete', entityType: 'credit_cards', getEntityId: (res, args) => args[1], getNewData: (res) => res.archived ? { txCount: res.impact.transactionsCount, invoiceCount: res.impact.invoicesCount } : null },
  createTransaction: { action: 'transaction.create', entityType: 'transactions', getEntityId: (res) => res.id, getNewData: (res) => res },
  updateTransaction: { action: 'transaction.update', entityType: 'transactions', getEntityId: (res) => res.id, getOldData: (tgt, args) => tgt.getTransaction(args[0], args[1]), getNewData: (res) => res },
  deleteTransaction: { action: 'transaction.delete', entityType: 'transactions', getEntityId: (res, args) => args[1], getOldData: (tgt, args) => tgt.getTransaction(args[0], args[1]) },
  setTransactionPaid: { action: 'transaction.set_paid', entityType: 'transactions', getEntityId: (res) => res.id, getOldData: (tgt, args) => ({ paidStatus: tgt.getTransaction(args[0], args[1]).paid_status }), getNewData: (res, args) => ({ paidStatus: args[2], effective: args[3] }) },
  createTransfer: { action: 'transfer.create', entityType: 'transfers', getEntityId: (res) => res.id, getNewData: (res) => res },
  createCardTransaction: { action: (args) => `card_transaction.${args[1]}`, entityType: 'transactions', getEntityId: (res) => res.id, getNewData: (res, args) => ({ creditCardId: args[2], amount: args[3], invoiceId: res.credit_card_invoice_id }) },
  registerInvoicePayment: { action: 'invoice_payment.register', entityType: 'invoice_payments', getEntityId: (res) => res.paymentId, getNewData: (res, args) => ({ invoiceId: args[1], amount: args[2], paymentDate: args[3] }) },
  uninformInvoicePayment: { action: 'invoice_payment.uninform', entityType: 'invoice_payments', getEntityId: (res, args) => args[1]?.paymentId || null, getOldData: (tgt, args) => ({ amount: tgt.db.prepare('SELECT amount FROM invoice_payments WHERE id = ?').get(args[1]?.paymentId).amount }) },
  createInstallmentPlan: { action: 'installment_plan.create', entityType: 'installment_plans', getEntityId: (res) => res.id, getNewData: (res, args) => ({ totalAmount: args[1], installmentsCount: args[2] }) },
  createRecurrence: { action: 'recurrence.create', entityType: 'recurrences', getEntityId: (res) => res.id, getNewData: (res, args) => ({ description: args[1].description, type: args[1].type, amount: args[1].amount, frequency: args[1].frequency, startDate: args[1].startDate }) },
  promoteForecastToTransaction: { action: 'recurrence_occurrence.promote', entityType: 'recurrence_occurrences', getEntityId: (res, args) => args[2], getNewData: (res) => ({ transactionId: res.id }) },
  importLocalStorageExport: { action: 'import.create', entityType: 'import_batches', getEntityId: (res) => res.batchId, getNewData: (res) => res },
  reverseImportBatch: { action: 'import.reverse', entityType: 'import_batches', getEntityId: (res) => res.batchId, getNewData: (res) => ({ entitiesCount: res.entitiesCount }) },
  createAttributeDefinition: { action: 'attribute_definition.create', entityType: 'attribute_definitions', getEntityId: (res) => res.id, getNewData: (res, args) => ({ name: args[1].name, slug: args[1].slug, dataType: args[1].dataType, version: 1 }) },
  updateAttributeDefinition: { action: 'attribute_definition.new_version', entityType: 'attribute_definitions', getEntityId: (res) => res.id, getOldData: (tgt, args) => { const c = tgt.getAttributeDefinition(args[0], args[1]); return { id: c.id, dataType: c.data_type, version: c.version }; }, getNewData: (res, args) => ({ id: res.id, dataType: args[2].dataType, version: res.version }) },
  mergeProducts: { action: 'products.merge', entityType: 'products', getEntityId: (res) => res.id, getOldData: (tgt, args) => { const s = tgt.getProduct(args[0], args[1]); return { sourceId: s.id, sourceName: s.name }; }, getNewData: (res) => ({ targetId: res.id, targetName: res.name }) },
  createPurchaseWithItems: { action: 'purchase.create', entityType: 'purchases', getEntityId: (res) => res.id, getNewData: (res, args) => ({ netAmount: args[1].netAmount, itemsCount: res.items?.length || 0 }) },
  createItemRefund: { action: 'item_refund.create', entityType: 'item_refunds', getEntityId: (res, args) => args[1]?.id || null, getNewData: (res, args) => ({ purchaseItemId: args[1].purchaseItemId, refundQuantity: args[1].refundQuantity, refundAmount: args[1].refundAmount }) }
};
