import { useState, useEffect } from 'react';
import { apiExecute } from '../api';
import InstitutionLogoPicker, { InstitutionItem } from '../components/InstitutionLogoPicker';
import BrandPicker from '../components/BrandPicker';

export default function CreditCards() {
  const [cards, setCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal de Criação de Cartão
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [closingDay, setClosingDay] = useState(5);
  const [dueDay, setDueDay] = useState(12);
  const [limit, setLimit] = useState('');
  const [brand, setBrand] = useState<string | null>(null);
  const [selectedInst, setSelectedInst] = useState<InstitutionItem | null>(null);
  const [creating, setCreating] = useState(false);

  const loadCards = () => {
    setLoading(true);
    apiExecute('list_credit_cards', {})
      .then(res => setCards(res || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCards();
  }, []);

  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    try {
      const parsedLimit = limit ? parseFloat(limit.replace(',', '.')) : undefined;
      await apiExecute('create_credit_card', {
        name: name.trim(),
        closing_day: Number(closingDay),
        due_day: Number(dueDay),
        credit_limit: parsedLimit,
        brand: brand || undefined,
        institution_id: selectedInst ? selectedInst.id : undefined,
      });

      setIsModalOpen(false);
      setName('');
      setLimit('');
      setBrand(null);
      setSelectedInst(null);
      loadCards();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Cartões de Crédito e Faturas</h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-verdeEquilibrio text-white px-4 py-2 rounded-lg font-medium hover:bg-opacity-90 transition-all"
        >
          Novo Cartão
        </button>
      </div>

      {loading && <p className="text-textoSecundario">Carregando cartões...</p>}
      {error && <p className="text-erro mb-4">Erro: {error}</p>}

      {!loading && !error && cards.length === 0 && (
        <div className="text-center py-12 bg-superficie rounded-lg border border-[#2A2A2A]">
          <p className="text-textoSecundario">Nenhum cartão cadastrado.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((card, i) => (
          <div key={card.id || i} className="bg-superficie p-6 rounded-lg border border-[#2A2A2A] flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-[#262626] border border-[#3A3A3A] flex items-center justify-center overflow-hidden">
                {card.institution_id ? (
                  <img
                    src={`/api/v1/catalog/logos/${card.institution_id}`}
                    alt="Logo"
                    className="w-full h-full object-contain p-1"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span className="text-xs font-bold text-gray-400">
                    {card.brand ? card.brand.slice(0, 2).toUpperCase() : 'CC'}
                  </span>
                )}
              </div>
              <div>
                <h3 className="font-bold text-lg">{card.name}</h3>
                <p className="text-textoSecundario text-xs">
                  {card.brand || 'Sem bandeira'} • Fecha dia {card.closing_day} • Vence dia {card.due_day}
                </p>
              </div>
            </div>
            {card.credit_limit && (
              <div className="text-right">
                <p className="text-xs text-textoSecundario">Limite</p>
                <p className="text-lg font-bold text-mentaClara">
                  R$ {(card.credit_limit / 100).toFixed(2)}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal de Criação de Cartão */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-superficie border border-[#333333] rounded-xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-white">Adicionar Novo Cartão</h3>
            <form onSubmit={handleCreateCard} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Nome do Cartão</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Nubank Ultravioleta, C6 Carbon"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-textoSecundario mb-1">Dia Fechamento</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    required
                    value={closingDay}
                    onChange={(e) => setClosingDay(Number(e.target.value))}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-textoSecundario mb-1">Dia Vencimento</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    required
                    value={dueDay}
                    onChange={(e) => setDueDay(Number(e.target.value))}
                    className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Limite de Crédito (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  placeholder="0,00"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                />
              </div>

              {/* Seletor de Bandeira */}
              <BrandPicker
                selectedBrand={brand}
                onSelect={(b) => setBrand(b)}
              />

              {/* Seletor de Instituição do Catálogo */}
              <InstitutionLogoPicker
                selectedInstitutionId={selectedInst?.id}
                onSelect={(inst) => {
                  setSelectedInst(inst);
                  if (inst && !name) {
                    setName(inst.popularName);
                  }
                }}
              />

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
                  {creating ? 'Salvando...' : 'Salvar Cartão'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
