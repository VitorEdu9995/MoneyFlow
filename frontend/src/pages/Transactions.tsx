import { useState, useEffect } from 'react';
import { apiExecute } from '../api';
import { Plus, ListFilter, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatCurrency, formatDate } from '../utils/formatters';

interface Transaction {
  id: string;
  description: string;
  amount: number; // em centavos
  transaction_date: string;
  type?: string;
  category_name?: string;
  category?: string;
  account_name?: string;
}

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal Nova Transação
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [isIncome, setIsIncome] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [txs, accs, cats] = await Promise.all([
        apiExecute<any>('list_transactions', { per_page: 50 }).catch(() => []),
        apiExecute<any[]>('list_accounts', {}).catch(() => []),
        apiExecute<any[]>('list_categories', {}).catch(() => []),
      ]);

      setTransactions(Array.isArray(txs) ? txs : (txs?.transactions || []));
      setAccounts(Array.isArray(accs) ? accs : []);
      setCategories(Array.isArray(cats) ? cats : []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description || !amount || !accountId) return;

    setCreating(true);
    try {
      const numAmount = parseFloat(amount.replace(',', '.'));
      await apiExecute('create_transaction', {
        description: description.trim(),
        amount: numAmount,
        date,
        is_income: isIncome,
        account_id: accountId,
        category_name: categoryName || undefined,
      });

      setIsModalOpen(false);
      setDescription('');
      setAmount('');
      setCategoryName('');
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azulFluxo">Movimentações</h1>
          <p className="text-sm text-textoSecundario">
            Histórico completo de receitas, despesas e lançamentos financeiros.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center justify-center space-x-2 bg-verdeEquilibrio hover:bg-verdeEquilibrioDark text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:ring-offset-2"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Movimentação</span>
        </button>
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-textoSecundario">
          Carregando movimentações...
        </div>
      )}

      {error && (
        <div className="p-4 bg-erro/10 border border-erro/20 rounded-xl text-erro text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={loadData} className="underline font-semibold ml-4 text-xs">
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="bg-superficie rounded-xl border border-borda shadow-suave overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-superficieSecundaria text-textoSecundario text-xs font-semibold uppercase tracking-wider border-b border-borda">
              <tr>
                <th className="py-3.5 px-4 font-semibold">Data</th>
                <th className="py-3.5 px-4 font-semibold">Descrição</th>
                <th className="py-3.5 px-4 font-semibold">Categoria</th>
                <th className="py-3.5 px-4 text-right font-semibold">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda text-sm">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-16 text-center text-textoSecundario">
                    <ListFilter className="w-8 h-8 mx-auto text-textoMudo mb-2" />
                    <p className="font-semibold text-azulFluxo">Nenhuma movimentação encontrada</p>
                    <p className="text-xs text-textoMudo mt-1">Clique em "Nova Movimentação" para registrar receitas ou despesas.</p>
                  </td>
                </tr>
              ) : (
                transactions.map((t, i) => {
                  const isRec = t.type === 'income' || (t.amount > 0 && t.type !== 'expense');

                  return (
                    <tr key={t.id || i} className="hover:bg-nevoa/60 transition-colors">
                      <td className="py-3.5 px-4 text-textoSecundario font-medium tabular-nums whitespace-nowrap">
                        {formatDate(t.transaction_date || (t as any).date)}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-texto">
                        {t.description}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-superficieSecundaria border border-borda text-textoSecundario">
                          {t.category_name || t.category || 'Geral'}
                        </span>
                      </td>
                      <td
                        className={`py-3.5 px-4 text-right font-bold tabular-nums whitespace-nowrap ${
                          isRec ? 'text-verdeEquilibrio' : 'text-erro'
                        }`}
                      >
                        <span className="inline-flex items-center space-x-1">
                          {isRec ? <ArrowUpRight className="w-3.5 h-3.5 inline mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 inline mr-0.5" />}
                          <span>{formatCurrency(Math.abs(t.amount || 0), true)}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Nova Transação */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-azulFluxo/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-superficie border border-borda rounded-2xl max-w-md w-full p-6 space-y-5 shadow-modal">
            <div>
              <h3 className="text-lg font-bold text-azulFluxo">Nova Movimentação</h3>
              <p className="text-xs text-textoSecundario mt-0.5">Registre uma receita ou despesa no seu fluxo financeiro.</p>
            </div>

            <form onSubmit={handleCreateTransaction} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Tipo de Movimentação
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsIncome(false)}
                    className={`py-2.5 text-xs font-semibold rounded-lg border transition-all ${
                      !isIncome
                        ? 'border-erro bg-erro/10 text-erro ring-1 ring-erro'
                        : 'border-borda bg-superficie text-textoSecundario hover:bg-superficieSecundaria'
                    }`}
                  >
                    Despesa
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsIncome(true)}
                    className={`py-2.5 text-xs font-semibold rounded-lg border transition-all ${
                      isIncome
                        ? 'border-verdeEquilibrio bg-verdeEquilibrio/10 text-verdeEquilibrio ring-1 ring-verdeEquilibrio'
                        : 'border-borda bg-superficie text-textoSecundario hover:bg-superficieSecundaria'
                    }`}
                  >
                    Receita
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Descrição
                </label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Supermercado, Aluguel, Consultoria"
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                    Valor (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0,00"
                    className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                    Data
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Conta Bancária
                </label>
                <select
                  required
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs cursor-pointer transition-all"
                >
                  <option value="">Selecione uma conta...</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Categoria (Opcional)
                </label>
                <select
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs cursor-pointer transition-all"
                >
                  <option value="">Selecione uma categoria...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-borda">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 text-sm text-textoSecundario font-semibold hover:text-texto rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="bg-verdeEquilibrio hover:bg-verdeEquilibrioDark text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  {creating ? 'Salvando...' : 'Salvar Movimentação'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
