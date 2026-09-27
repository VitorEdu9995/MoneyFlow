import { useState, useEffect } from 'react';
import { apiExecute } from '../api';

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
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Transações</h2>
          <p className="text-textoSecundario text-sm">Histórico e lançamentos financeiros.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-verdeEquilibrio text-white px-4 py-2 rounded-lg font-medium hover:bg-opacity-90 transition-all"
        >
          Nova Transação
        </button>
      </div>

      {loading && <p className="text-textoSecundario">Carregando transações...</p>}
      {error && <p className="text-erro mb-4">Erro: {error}</p>}

      {!loading && !error && (
        <div className="bg-superficie rounded-lg border border-[#2A2A2A] overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-[#202020] text-textoSecundario text-xs font-semibold uppercase">
              <tr>
                <th className="p-4">Data</th>
                <th className="p-4">Descrição</th>
                <th className="p-4">Categoria</th>
                <th className="p-4 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A2A2A] text-sm">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-textoSecundario">
                    Nenhuma transação encontrada.
                  </td>
                </tr>
              ) : (
                transactions.map((t, i) => {
                  const valorReais = (t.amount || 0) / 100;
                  const isRec = t.type === 'income' || (t.amount > 0 && t.type !== 'expense');

                  return (
                    <tr key={t.id || i} className="hover:bg-[#1F1F1F] transition-colors">
                      <td className="p-4 text-gray-300">{t.transaction_date || (t as any).date}</td>
                      <td className="p-4 font-medium text-white">{t.description}</td>
                      <td className="p-4">
                        <span className="bg-[#2A2A2A] text-gray-300 px-2 py-0.5 rounded text-xs">
                          {t.category_name || t.category || 'Geral'}
                        </span>
                      </td>
                      <td className={`p-4 text-right font-bold ${isRec ? 'text-verdeEquilibrio' : 'text-erro'}`}>
                        {isRec ? '+' : '-'} R$ {Math.abs(valorReais).toFixed(2)}
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
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-superficie border border-[#333333] rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">Adicionar Transação</h3>
            <form onSubmit={handleCreateTransaction} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Tipo de Lançamento</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsIncome(false)}
                    className={`py-2 text-xs font-semibold rounded-lg border transition-all ${
                      !isIncome
                        ? 'border-erro bg-erro/20 text-white'
                        : 'border-[#333333] bg-[#1A1A1A] text-gray-400'
                    }`}
                  >
                    Despesa
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsIncome(true)}
                    className={`py-2 text-xs font-semibold rounded-lg border transition-all ${
                      isIncome
                        ? 'border-verdeEquilibrio bg-verdeEquilibrio/20 text-white'
                        : 'border-[#333333] bg-[#1A1A1A] text-gray-400'
                    }`}
                  >
                    Receita
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Descrição</label>
                <input
                  type="text"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Almoço, Salário, Supermercado"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-textoSecundario mb-1">Valor (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0,00"
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-textoSecundario mb-1">Data</label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Conta Bancária</label>
                <select
                  required
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
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
                <label className="block text-sm font-medium text-textoSecundario mb-1">Categoria (Opcional)</label>
                <select
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                >
                  <option value="">Selecione uma categoria...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="bg-verdeEquilibrio text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50"
                >
                  {creating ? 'Salvando...' : 'Salvar Transação'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
