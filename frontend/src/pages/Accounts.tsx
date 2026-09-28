import { useState, useEffect } from 'react';
import { apiExecute } from '../api';
import InstitutionLogoPicker, { type InstitutionItem } from '../components/InstitutionLogoPicker';
import { Plus, Building2 } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';

export default function Accounts() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estado do Modal de Nova Conta
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState('checking');
  const [openingBalance, setOpeningBalance] = useState('');
  const [selectedInst, setSelectedInst] = useState<InstitutionItem | null>(null);
  const [creating, setCreating] = useState(false);

  const loadAccounts = () => {
    setLoading(true);
    setError(null);
    apiExecute('list_accounts', {})
      .then(res => setAccounts(res || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountName.trim()) return;

    setCreating(true);
    try {
      const balance = parseFloat(openingBalance.replace(',', '.')) || 0;
      await apiExecute('create_account', {
        name: accountName.trim(),
        account_type: accountType,
        opening_balance: balance,
        institution_id: selectedInst ? selectedInst.id : undefined,
      });

      setIsModalOpen(false);
      setAccountName('');
      setOpeningBalance('');
      setSelectedInst(null);
      loadAccounts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const getAccountTypeLabel = (type: string) => {
    switch (type) {
      case 'checking': return 'Conta Corrente';
      case 'savings': return 'Poupança';
      case 'investment': return 'Investimento';
      case 'cash': return 'Dinheiro em Espécie';
      default: return 'Conta';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azulFluxo">Contas Bancárias</h1>
          <p className="text-sm text-textoSecundario">
            Organize suas contas, carteiras e saldos de instituições financeiras.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center justify-center space-x-2 bg-verdeEquilibrio hover:bg-verdeEquilibrioDark text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:ring-offset-2"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Conta</span>
        </button>
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-textoSecundario">
          Carregando contas cadastradas...
        </div>
      )}

      {error && (
        <div className="p-4 bg-erro/10 border border-erro/20 rounded-xl text-erro text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={loadAccounts} className="underline font-semibold ml-4 text-xs">
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && accounts.length === 0 && (
        <div className="text-center py-16 bg-superficie rounded-xl border border-dashed border-borda shadow-suave">
          <div className="w-12 h-12 rounded-full bg-nevoa flex items-center justify-center text-azulFluxo mx-auto mb-3">
            <Building2 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-azulFluxo">Nenhuma conta cadastrada</h3>
          <p className="text-sm text-textoSecundario max-w-sm mx-auto mt-1 mb-4">
            Cadastre suas contas bancárias para começar a controlar receitas, despesas e transferências.
          </p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center space-x-2 bg-verdeEquilibrio text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-verdeEquilibrioDark transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar Conta</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {accounts.map((acc) => (
          <div
            key={acc.id}
            className="bg-superficie p-6 rounded-xl border border-borda shadow-suave hover:shadow-card transition-all flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3.5">
                <div className="w-11 h-11 rounded-full bg-nevoa border border-borda flex items-center justify-center overflow-hidden shadow-xs flex-shrink-0">
                  {acc.institution_id ? (
                    <img
                      src={`/api/v1/catalog/logos/${acc.institution_id}`}
                      alt="Logo banco"
                      className="w-full h-full object-contain p-1"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span className="text-xs font-bold text-azulFluxo">
                      {acc.name ? acc.name.slice(0, 2).toUpperCase() : 'CC'}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-base text-azulFluxo leading-tight">{acc.name}</h3>
                  <span className="text-xs text-textoSecundario font-medium mt-0.5 inline-block">
                    {getAccountTypeLabel(acc.account_type)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-borda flex justify-between items-baseline">
              <span className="text-xs text-textoSecundario font-medium">Saldo Atual</span>
              <p className="text-xl font-bold text-azulFluxo tabular-nums">
                {formatCurrency(acc.current_balance ?? acc.opening_balance ?? 0, true)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de Criação de Conta */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-azulFluxo/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-superficie border border-borda rounded-2xl max-w-md w-full p-6 space-y-5 shadow-modal">
            <div>
              <h3 className="text-lg font-bold text-azulFluxo">Criar Nova Conta</h3>
              <p className="text-xs text-textoSecundario mt-0.5">Informe os detalhes da sua conta financeira.</p>
            </div>

            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Nome da Conta
                </label>
                <input
                  type="text"
                  required
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Ex: Nubank Reserva, Itaú Principal"
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Tipo de Conta
                </label>
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs cursor-pointer transition-all"
                >
                  <option value="checking">Conta Corrente</option>
                  <option value="savings">Poupança</option>
                  <option value="investment">Investimento</option>
                  <option value="cash">Dinheiro em Espécie</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1.5">
                  Saldo Inicial (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  placeholder="0,00"
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:border-verdeEquilibrio shadow-xs transition-all"
                />
              </div>

              {/* Seletor de Instituição do Catálogo */}
              <InstitutionLogoPicker
                selectedInstitutionId={selectedInst?.id}
                onSelect={(inst) => {
                  setSelectedInst(inst);
                  if (inst && !accountName) {
                    setAccountName(inst.popularName);
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
                  {creating ? 'Salvando...' : 'Salvar Conta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
