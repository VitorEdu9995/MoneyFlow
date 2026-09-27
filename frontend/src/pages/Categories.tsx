import { useState, useEffect } from 'react';
import { apiExecute } from '../api';
import { Plus, Tags, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  parent_id?: string | null;
  color?: string | null;
}

export default function Categories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [isIncome, setIsIncome] = useState(false);
  const [color, setColor] = useState('#138A63');
  const [creating, setCreating] = useState(false);

  const loadCategories = () => {
    setLoading(true);
    setError(null);
    apiExecute<Category[]>('list_categories', {})
      .then(res => setCategories(res || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    try {
      await apiExecute('create_category', {
        name: name.trim(),
        is_income: isIncome,
        color,
      });

      setIsModalOpen(false);
      setName('');
      setIsIncome(false);
      loadCategories();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const incomeCategories = categories.filter(c => c.kind === 'income');
  const expenseCategories = categories.filter(c => c.kind === 'expense');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azulFluxo">Categorias</h1>
          <p className="text-sm text-textoSecundario">
            Classifique suas receitas e despesas para entender seu fluxo com clareza.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center justify-center space-x-2 bg-verdeEquilibrio hover:bg-verdeEquilibrioDark text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:ring-offset-2"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Categoria</span>
        </button>
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-textoSecundario">
          Carregando categorias...
        </div>
      )}

      {error && (
        <div className="p-4 bg-erro/10 border border-erro/20 rounded-xl text-erro text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={loadCategories} className="underline font-semibold ml-4 text-xs">
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && categories.length === 0 && (
        <div className="text-center py-16 bg-superficie rounded-xl border border-dashed border-borda shadow-suave">
          <div className="w-12 h-12 rounded-full bg-nevoa flex items-center justify-center text-azulFluxo mx-auto mb-3">
            <Tags className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-azulFluxo">Nenhuma categoria encontrada</h3>
          <p className="text-sm text-textoSecundario max-w-sm mx-auto mt-1 mb-4">
            Crie categorias personalizadas para organizar gastos diários, compromissos fixos e fontes de receita.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center space-x-2 bg-verdeEquilibrio text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-verdeEquilibrioDark transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Categoria</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Despesas */}
        <div className="bg-superficie p-6 rounded-xl border border-borda shadow-suave space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-borda">
            <div className="flex items-center space-x-2">
              <ArrowDownCircle className="w-5 h-5 text-erro" />
              <h2 className="font-bold text-base text-azulFluxo">Categorias de Despesa</h2>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-erro/10 text-erro">
              {expenseCategories.length} categorias
            </span>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {expenseCategories.length === 0 ? (
              <p className="text-xs text-textoMudo py-4 text-center">Nenhuma categoria de despesa cadastrada.</p>
            ) : (
              expenseCategories.map(cat => (
                <div
                  key={cat.id}
                  className="p-3 bg-superficieSecundaria hover:bg-nevoa rounded-lg border border-borda flex justify-between items-center transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <span
                      className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-xs"
                      style={{ backgroundColor: cat.color || '#B74747' }}
                    />
                    <span className="text-sm font-semibold text-texto">{cat.name}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Receitas */}
        <div className="bg-superficie p-6 rounded-xl border border-borda shadow-suave space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-borda">
            <div className="flex items-center space-x-2">
              <ArrowUpCircle className="w-5 h-5 text-verdeEquilibrio" />
              <h2 className="font-bold text-base text-azulFluxo">Categorias de Receita</h2>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-verdeEquilibrio/10 text-verdeEquilibrio">
              {incomeCategories.length} categorias
            </span>
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {incomeCategories.length === 0 ? (
              <p className="text-xs text-textoMudo py-4 text-center">Nenhuma categoria de receita cadastrada.</p>
            ) : (
              incomeCategories.map(cat => (
                <div
                  key={cat.id}
                  className="p-3 bg-superficieSecundaria hover:bg-nevoa rounded-lg border border-borda flex justify-between items-center transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <span
                      className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-xs"
                      style={{ backgroundColor: cat.color || '#138A63' }}
                    />
                    <span className="text-sm font-semibold text-texto">{cat.name}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modal Nova Categoria */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-azulFluxo/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-superficie border border-borda rounded-2xl max-w-md w-full p-6 space-y-5 shadow-modal">
            <div>
              <h3 className="text-lg font-bold text-azulFluxo">Criar Nova Categoria</h3>
              <p className="text-xs text-textoSecundario mt-0.5">Defina o nome, tipo e cor de identificação.</p>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Nome da Categoria
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Alimentação, Lazer, Salário"
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Tipo de Categoria
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
                  Cor de Identificação
                </label>
                <div className="flex items-center space-x-3">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border border-borda bg-transparent p-0.5 shadow-xs"
                  />
                  <span className="text-xs font-mono text-textoSecundario">{color}</span>
                </div>
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
                  {creating ? 'Salvando...' : 'Salvar Categoria'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
