import { useState, useEffect } from 'react';
import { apiExecute } from '../api';
import InstitutionLogoPicker, { InstitutionItem } from '../components/InstitutionLogoPicker';

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

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Contas</h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-verdeEquilibrio text-white px-4 py-2 rounded-lg font-medium hover:bg-opacity-90 transition-all"
        >
          Nova Conta
        </button>
      </div>

      {loading && <p className="text-textoSecundario">Carregando contas...</p>}
      {error && <p className="text-erro mb-4">Erro: {error}</p>}

      {!loading && !error && accounts.length === 0 && (
        <div className="text-center py-12 bg-superficie rounded-lg border border-[#2A2A2A]">
          <p className="text-textoSecundario">Nenhuma conta encontrada.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((acc, i) => (
          <div key={acc.id || i} className="bg-superficie p-6 rounded-lg border border-[#2A2A2A] flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-[#262626] border border-[#3A3A3A] flex items-center justify-center overflow-hidden">
                {acc.institution_id ? (
                  <img
                    src={`/api/v1/catalog/logos/${acc.institution_id}`}
                    alt="Logo instituição"
                    className="w-full h-full object-contain p-1"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span className="text-xs font-bold text-gray-400">
                    {acc.name ? acc.name.slice(0, 2).toUpperCase() : 'CC'}
                  </span>
                )}
              </div>
              <div>
                <h3 className="font-bold text-lg">{acc.name || 'Conta Corrente'}</h3>
                <p className="text-textoSecundario text-sm capitalize">{acc.account_type || 'checking'}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-mentaClara">
                R$ {((acc.current_balance ?? acc.balance ?? 0) / (acc.current_balance !== undefined ? 100 : 1)).toFixed(2)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de Criação de Conta */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-superficie border border-[#333333] rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">Criar Nova Conta</h3>
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Nome da Conta</label>
                <input
                  type="text"
                  required
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Ex: Nubank Reserva, Itaú Principal"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Tipo de Conta</label>
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
                >
                  <option value="checking">Conta Corrente</option>
                  <option value="savings">Poupança</option>
                  <option value="investment">Investimento</option>
                  <option value="cash">Dinheiro em Espécie</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-textoSecundario mb-1">Saldo Inicial (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  placeholder="0,00"
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-verdeEquilibrio"
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
