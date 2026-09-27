import { useState, useEffect } from 'react';
import { apiExecute } from '../api';
import { ArrowUpRight, ArrowDownRight, Wallet, CreditCard } from 'lucide-react';

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [totalBalance, setTotalBalance] = useState(0);
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [monthlyExpense, setMonthlyExpense] = useState(0);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      try {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const startDate = `${year}-${month}-01`;
        const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
        const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

        const [accountsData, summaryData, transactionsData] = await Promise.all([
          apiExecute<any[]>('list_accounts', {}).catch(() => []),
          apiExecute<any>('get_financial_summary', { start_date: startDate, end_date: endDate }).catch(() => null),
          apiExecute<any[]>('list_transactions', { per_page: 5 }).catch(() => []),
        ]);

        const accList = Array.isArray(accountsData) ? accountsData : [];
        setAccounts(accList);

        // Saldo total de todas as contas ativas em centavos
        const totalCents = accList.reduce((acc, a) => acc + (a.current_balance || a.opening_balance || 0), 0);
        setTotalBalance(totalCents / 100);

        if (summaryData) {
          // summaryData.income e expense em centavos ou reais
          const inc = (summaryData.income || 0) / (summaryData.income > 1000 ? 100 : 1);
          const exp = (summaryData.expense || 0) / (summaryData.expense > 1000 ? 100 : 1);
          setMonthlyIncome(inc);
          setMonthlyExpense(exp);
        }

        const txList = Array.isArray(transactionsData) ? transactionsData : [];
        setRecentTransactions(txList.slice(0, 5));
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="text-textoSecundario text-sm">Visão geral consolidada do seu patrimônio e fluxo de caixa.</p>
      </div>

      {error && <p className="text-erro mb-2">Erro ao carregar dados: {error}</p>}

      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Saldo Total */}
        <div className="bg-superficie p-6 rounded-xl border border-[#2A2A2A] space-y-2">
          <div className="flex items-center justify-between text-textoSecundario">
            <span className="text-sm font-medium">Saldo em Contas</span>
            <Wallet className="w-5 h-5 text-mentaClara" />
          </div>
          <p className="text-3xl font-extrabold text-white">
            {loading ? '...' : `R$ ${totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          </p>
          <span className="text-xs text-textoSecundario">{accounts.length} contas cadastradas</span>
        </div>

        {/* Receitas do Mês */}
        <div className="bg-superficie p-6 rounded-xl border border-[#2A2A2A] space-y-2">
          <div className="flex items-center justify-between text-textoSecundario">
            <span className="text-sm font-medium">Receitas (Mês Atual)</span>
            <ArrowUpRight className="w-5 h-5 text-verdeEquilibrio" />
          </div>
          <p className="text-3xl font-extrabold text-verdeEquilibrio">
            {loading ? '...' : `+ R$ ${monthlyIncome.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          </p>
          <span className="text-xs text-textoSecundario">Base caixa</span>
        </div>

        {/* Despesas do Mês */}
        <div className="bg-superficie p-6 rounded-xl border border-[#2A2A2A] space-y-2">
          <div className="flex items-center justify-between text-textoSecundario">
            <span className="text-sm font-medium">Despesas (Mês Atual)</span>
            <ArrowDownRight className="w-5 h-5 text-erro" />
          </div>
          <p className="text-3xl font-extrabold text-erro">
            {loading ? '...' : `- R$ ${monthlyExpense.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          </p>
          <span className="text-xs text-textoSecundario">Base caixa</span>
        </div>
      </div>

      {/* Contas e Transações Recentes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Minhas Contas */}
        <div className="bg-superficie p-6 rounded-xl border border-[#2A2A2A] space-y-4">
          <h3 className="font-bold text-lg text-white">Contas Bancárias</h3>
          {accounts.length === 0 && !loading && (
            <p className="text-sm text-textoSecundario">Nenhuma conta cadastrada ainda.</p>
          )}
          <div className="space-y-3">
            {accounts.slice(0, 4).map((acc) => (
              <div key={acc.id} className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg border border-[#2A2A2A]">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-full bg-[#262626] border border-[#3A3A3A] flex items-center justify-center overflow-hidden">
                    {acc.institution_id ? (
                      <img
                        src={`/api/v1/catalog/logos/${acc.institution_id}`}
                        alt="Logo"
                        className="w-full h-full object-contain p-0.5"
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
                    <p className="text-sm font-semibold text-white">{acc.name}</p>
                    <p className="text-xs text-textoSecundario capitalize">{acc.account_type || 'checking'}</p>
                  </div>
                </div>
                <p className="text-sm font-bold text-mentaClara">
                  R$ {(((acc.current_balance ?? acc.opening_balance ?? 0) / 100)).toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Transações Recentes */}
        <div className="bg-superficie p-6 rounded-xl border border-[#2A2A2A] space-y-4">
          <h3 className="font-bold text-lg text-white">Últimas Transações</h3>
          {recentTransactions.length === 0 && !loading && (
            <p className="text-sm text-textoSecundario">Nenhuma transação registrada.</p>
          )}
          <div className="space-y-3">
            {recentTransactions.map((tx, idx) => {
              const amountReais = (tx.amount || 0) / 100;
              const isIncome = tx.type === 'income' || (tx.amount > 0 && tx.type !== 'expense');

              return (
                <div key={tx.id || idx} className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg border border-[#2A2A2A]">
                  <div>
                    <p className="text-sm font-semibold text-white">{tx.description}</p>
                    <p className="text-xs text-textoSecundario">{tx.transaction_date || tx.date}</p>
                  </div>
                  <span className={`text-sm font-bold ${isIncome ? 'text-verdeEquilibrio' : 'text-erro'}`}>
                    {isIncome ? '+' : '-'} R$ {Math.abs(amountReais).toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
