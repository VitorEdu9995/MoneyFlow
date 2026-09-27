import { useState, useEffect } from 'react';
import { apiExecute } from '../api';
import InstitutionLogoPicker, { InstitutionItem } from '../components/InstitutionLogoPicker';
import BrandPicker from '../components/BrandPicker';
import { Plus, CreditCard as CardIcon, Calendar } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';

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
    setError(null);
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azulFluxo">Cartões de Crédito</h1>
          <p className="text-sm text-textoSecundario">
            Acompanhe limites, datas de fechamento e vencimento de suas faturas.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center justify-center space-x-2 bg-verdeEquilibrio hover:bg-verdeEquilibrioDark text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:ring-offset-2"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Cartão</span>
        </button>
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-textoSecundario">
          Carregando cartões cadastrados...
        </div>
      )}

      {error && (
        <div className="p-4 bg-erro/10 border border-erro/20 rounded-xl text-erro text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={loadCards} className="underline font-semibold ml-4 text-xs">
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && cards.length === 0 && (
        <div className="text-center py-16 bg-superficie rounded-xl border border-dashed border-borda shadow-suave">
          <div className="w-12 h-12 rounded-full bg-nevoa flex items-center justify-center text-azulFluxo mx-auto mb-3">
            <CardIcon className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-azulFluxo">Nenhum cartão cadastrado</h3>
          <p className="text-sm text-textoSecundario max-w-sm mx-auto mt-1 mb-4">
            Adicione seus cartões para acompanhar compras, limites e conciliação por competência.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center space-x-2 bg-verdeEquilibrio text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-verdeEquilibrioDark transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar Cartão</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {cards.map((card) => (
          <div
            key={card.id}
            className="bg-superficie p-6 rounded-xl border border-borda shadow-suave hover:shadow-card transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center space-x-3.5">
                <div className="w-11 h-11 rounded-full bg-nevoa border border-borda flex items-center justify-center overflow-hidden shadow-xs flex-shrink-0">
                  {card.institution_id ? (
                    <img
                      src={`/api/v1/catalog/logos/${card.institution_id}`}
                      alt="Logo cartão"
                      className="w-full h-full object-contain p-1"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span className="text-xs font-bold text-azulFluxo">
                      {card.brand ? card.brand.slice(0, 2).toUpperCase() : 'CC'}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-base text-azulFluxo leading-tight">{card.name}</h3>
                  <span className="text-xs text-textoSecundario font-medium mt-0.5 inline-block">
                    {card.brand || 'Sem bandeira'}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex items-center space-x-4 text-xs text-textoSecundario">
                <div className="flex items-center space-x-1">
                  <Calendar className="w-3.5 h-3.5 text-textoMudo" />
                  <span>Fecha dia <strong>{card.closing_day}</strong></span>
                </div>
                <span>•</span>
                <div>
                  <span>Vence dia <strong>{card.due_day}</strong></span>
                </div>
              </div>
            </div>

            {card.credit_limit && (
              <div className="mt-6 pt-4 border-t border-borda flex justify-between items-baseline">
                <span className="text-xs text-textoSecundario font-medium">Limite de Crédito</span>
                <p className="text-lg font-bold text-azulFluxo tabular-nums">
                  {formatCurrency(card.credit_limit, true)}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal de Criação de Cartão */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-azulFluxo/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-superficie border border-borda rounded-2xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-modal">
            <div>
              <h3 className="text-lg font-bold text-azulFluxo">Adicionar Novo Cartão</h3>
              <p className="text-xs text-textoSecundario mt-0.5">Cadastre o cartão para controle de faturas e compras.</p>
            </div>

            <form onSubmit={handleCreateCard} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Nome do Cartão
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Nubank Ultravioleta, C6 Carbon"
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                    Dia Fechamento
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    required
                    value={closingDay}
                    onChange={(e) => setClosingDay(Number(e.target.value))}
                    className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                    Dia Vencimento
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    required
                    value={dueDay}
                    onChange={(e) => setDueDay(Number(e.target.value))}
                    className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Limite de Crédito (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  placeholder="0,00"
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs transition-all"
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
