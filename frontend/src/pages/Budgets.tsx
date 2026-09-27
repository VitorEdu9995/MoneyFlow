import { useState, useEffect } from 'react';
import { apiExecute } from '../api';

interface Budget {
  id: string;
  category_id: string;
  category_name?: string;
  amount: number; // em centavos
  spent?: number; // em centavos
  percentage?: number;
  period_month: number;
  period_year: number;
}

interface Category {
  id: string;
  name: string;
}

export default function Budgets() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [amount, setAmount] = useState('');
  const [creating, setCreating] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      const [budgetsRes, categoriesRes] = await Promise.all([
        apiExecute<any>('list_budgets', { month: currentMonth, year: currentYear }).catch(() => []),
        apiExecute<Category[]>('list_categories', { kind: 'expense' }).catch(() => []),
      ]);

      setBudgets(Array.isArray(budgetsRes) ? budgetsRes : []);
      setCategories(Array.isArray(categoriesRes) ? categoriesRes : []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryName || !amount) return;

    setCreating(true);
    try {
      const numAmount = parseFloat(amount.replace(',', '.'));
      await apiExecute('create_budget', {
        category_name: categoryName,
        amount: numAmount,
        activity_type: 'spending',
      });

      setIsModalOpen(false);
      setCategoryName('');
      setAmount('');
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
          <h2 className="text-2xl font-bold">Orçamentos</h2>
          <p className="text-textoSecundario text-sm">Defina limites de gastos mensais por categoria.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-verdeEquilibrio text-white px-4 py-2 rounded-lg font-medium hover:bg-opacity-90 transition-all"
        >
          Novo Orçamento
        </button>
      </div>

      {loading && <p className="text-textoSecundario">Carregando orçamentos...</p>}
      {error && <p className="text-erro mb-4">Erro: {error}</p>}

      {!loading && !error && budgets.length === 0 && (
        <div className="text-center py-12 bg-superficie rounded-lg border border-[#2A2A2A]">
          <p className="text-textoSecundario">Nenhum orçamento definido para este mês.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {budgets.map((b, i) => {
          const limitReais = (b.amount || 0) / 100;
          const spentReais = (b.spent || 0) / 100;
          const pct = Math.min(100, limitReais > 0 ? (spentReais / limitReais) * 100 : 0);
          const isOver = spentReais > limitReais;

          return (
            <div key={b.id || i} className="bg-superficie p-5 rounded-lg border border-[#2A2A2A] space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-base text-white">{b.category_name || 'Categoria'}</h3>
                <span className={`text-xs px-2 py-0.5 rounded font-semibold ${isOver ? 'bg-erro/20 text-erro' : 'bg-verdeEquilibrio/20 text-verdeEquilibrio'}`}>
                  {pct.toFixed(0)}%
                </span>
              </div>

              {/* Barra de Progresso */}
              <div className="w-full bg-[#2A2A2A] h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isOver ? 'bg-erro' : 'bg-verdeEquilibrio'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="flex justify-between text-xs text-textoSecundario">
                <span>Gasto: R$ {spentReais.toFixed(2)}</span>
                <span>Limite: R$ {limitReais.toFixed(2)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Novo Orçamento */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-superficie border border-[#333333] rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">Criar Orçamento Mensal</h3>
            <form onSubmit={handleCreateBudget} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Categoria de Despesa</label>
                <select
                  required
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

              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Limite Mensal (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                />
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
                  {creating ? 'Salvando...' : 'Salvar Orçamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
