import { useState, useEffect } from 'react';
import { apiExecute } from '../api';
import { Plus, PieChart as BudgetIcon } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';

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
    setError(null);
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azulFluxo">Orçamentos Mensais</h1>
          <p className="text-sm text-textoSecundario">
            Planeje tetos de gastos para manter o equilíbrio das suas categorias.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center justify-center space-x-2 bg-verdeEquilibrio hover:bg-verdeEquilibrioDark text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:ring-offset-2"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Orçamento</span>
        </button>
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-textoSecundario">
          Carregando orçamentos do mês...
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

      {!loading && !error && budgets.length === 0 && (
        <div className="text-center py-16 bg-superficie rounded-xl border border-dashed border-borda shadow-suave">
          <div className="w-12 h-12 rounded-full bg-nevoa flex items-center justify-center text-azulFluxo mx-auto mb-3">
            <BudgetIcon className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-azulFluxo">Nenhum orçamento para este mês</h3>
          <p className="text-sm text-textoSecundario max-w-sm mx-auto mt-1 mb-4">
            Defina limites para alimentação, transporte ou lazer e acompanhe seu consumo em tempo real.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center space-x-2 bg-verdeEquilibrio text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-verdeEquilibrioDark transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Orçamento</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {budgets.map((b) => {
          const limitCents = b.amount || 0;
          const spentCents = b.spent || 0;
          const pct = Math.min(100, limitCents > 0 ? (spentCents / limitCents) * 100 : 0);
          const isOver = spentCents > limitCents;
          const isWarning = pct >= 80 && !isOver;

          return (
            <div
              key={b.id}
              className="bg-superficie p-6 rounded-xl border border-borda shadow-suave hover:shadow-card transition-all space-y-4"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-base text-azulFluxo leading-tight">{b.category_name || 'Categoria'}</h3>
                  <span className="text-xs text-textoSecundario mt-0.5 inline-block">Mês Atual</span>
                </div>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-bold tabular-nums ${
                    isOver
                      ? 'bg-erro/10 text-erro'
                      : isWarning
                      ? 'bg-atencao/10 text-atencao'
                      : 'bg-verdeEquilibrio/10 text-verdeEquilibrio'
                  }`}
                >
                  {pct.toFixed(0)}%
                </span>
              </div>

              {/* Barra de Progresso com Cantos Arredondados */}
              <div className="w-full bg-superficieSecundaria h-3 rounded-full overflow-hidden border border-borda/50 p-0.5">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    isOver ? 'bg-erro' : isWarning ? 'bg-atencao' : 'bg-verdeEquilibrio'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="flex justify-between text-xs text-textoSecundario pt-1 border-t border-borda">
                <span>Gasto: <strong className="text-texto tabular-nums">{formatCurrency(spentCents, true)}</strong></span>
                <span>Limite: <strong className="text-azulFluxo tabular-nums">{formatCurrency(limitCents, true)}</strong></span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Novo Orçamento */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-azulFluxo/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-superficie border border-borda rounded-2xl max-w-md w-full p-6 space-y-5 shadow-modal">
            <div>
              <h3 className="text-lg font-bold text-azulFluxo">Criar Orçamento Mensal</h3>
              <p className="text-xs text-textoSecundario mt-0.5">Estipule um limite financeiro para a categoria selecionada.</p>
            </div>

            <form onSubmit={handleCreateBudget} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Categoria de Despesa
                </label>
                <select
                  required
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

              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Limite Mensal (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs transition-all"
                />
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
