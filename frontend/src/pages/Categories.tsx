import { useState, useEffect } from 'react';
import { apiExecute } from '../api';

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
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Categorias</h2>
          <p className="text-textoSecundario text-sm">Organize suas receitas e despesas por categorias.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-verdeEquilibrio text-white px-4 py-2 rounded-lg font-medium hover:bg-opacity-90 transition-all"
        >
          Nova Categoria
        </button>
      </div>

      {loading && <p className="text-textoSecundario">Carregando categorias...</p>}
      {error && <p className="text-erro mb-4">Erro: {error}</p>}

      {!loading && !error && categories.length === 0 && (
        <div className="text-center py-12 bg-superficie rounded-lg border border-[#2A2A2A]">
          <p className="text-textoSecundario">Nenhuma categoria cadastrada.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Despesas */}
        <div className="bg-superficie p-5 rounded-lg border border-[#2A2A2A]">
          <h3 className="text-lg font-bold text-erro mb-3 flex items-center">
            <span className="w-3 h-3 rounded-full bg-erro mr-2"></span>
            Despesas ({expenseCategories.length})
          </h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {expenseCategories.map(cat => (
              <div key={cat.id} className="p-3 bg-[#1A1A1A] rounded-lg border border-[#2A2A2A] flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <span
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: cat.color || '#B74747' }}
                  />
                  <span className="text-sm font-medium text-gray-200">{cat.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Receitas */}
        <div className="bg-superficie p-5 rounded-lg border border-[#2A2A2A]">
          <h3 className="text-lg font-bold text-verdeEquilibrio mb-3 flex items-center">
            <span className="w-3 h-3 rounded-full bg-verdeEquilibrio mr-2"></span>
            Receitas ({incomeCategories.length})
          </h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {incomeCategories.map(cat => (
              <div key={cat.id} className="p-3 bg-[#1A1A1A] rounded-lg border border-[#2A2A2A] flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <span
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: cat.color || '#138A63' }}
                  />
                  <span className="text-sm font-medium text-gray-200">{cat.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal Nova Categoria */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-superficie border border-[#333333] rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">Criar Nova Categoria</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Nome da Categoria</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Alimentação, Lazer, Salário"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Tipo</label>
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
                <label className="block text-sm font-medium text-textoSecundario mb-1">Cor</label>
                <div className="flex items-center space-x-3">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-10 h-10 rounded cursor-pointer border border-[#333333] bg-transparent"
                  />
                  <span className="text-xs text-gray-400">{color}</span>
                </div>
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
