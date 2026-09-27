import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiExecute } from '../api';
import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, Building2, Clock, Sparkles } from 'lucide-react';
import { formatCurrency, formatDate } from '../utils/formatters';

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [totalBalanceCents, setTotalBalanceCents] = useState(0);
  const [monthlyIncomeCents, setMonthlyIncomeCents] = useState(0);
  const [monthlyExpenseCents, setMonthlyExpenseCents] = useState(0);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      setError(null);
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

        const totalCents = accList.reduce((acc, a) => acc + (a.current_balance ?? a.opening_balance ?? 0), 0);
        setTotalBalanceCents(totalCents);

        if (summaryData) {
          const inc = summaryData.income || 0;
          const exp = summaryData.expense || 0;
          setMonthlyIncomeCents(inc);
          setMonthlyExpenseCents(exp);
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

  const netBalanceCents = monthlyIncomeCents - monthlyExpenseCents;

  return (
    <div className="space-y-8">
      {/* Cabeçalho da Página */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azulFluxo">Visão Geral</h1>
          <p className="text-sm text-textoSecundario">
            Acompanhamento sereno do seu patrimônio e fluxo de movimentações.
          </p>
        </div>
        <Link
          to="/landing"
          className="inline-flex items-center text-xs font-semibold px-3 py-1.5 rounded-lg border border-borda bg-superficie hover:bg-superficieSecundaria text-azulFluxo hover:text-azulFluxo transition-all self-start sm:self-auto shadow-suave"
          title="Ver apresentação das funcionalidades do MoneyFlow"
        >
          <Sparkles className="w-3.5 h-3.5 mr-1.5 text-verdeEquilibrio" />
          Conhecer Recursos do MoneyFlow
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-erro/10 border border-erro/20 rounded-xl text-erro text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => window.location.reload()} className="underline font-semibold ml-4 text-xs">
            Tentar novamente
          </button>
        </div>
      )}

      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Saldo Consolidado */}
        <div className="bg-superficie p-6 rounded-xl border border-borda shadow-suave hover:shadow-card transition-shadow">
          <div className="flex items-center justify-between text-textoSecundario mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">Saldo Total em Contas</span>
            <div className="w-8 h-8 rounded-lg bg-nevoa flex items-center justify-center text-azulFluxo">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-azulFluxo tracking-tight">
            {loading ? '...' : formatCurrency(totalBalanceCents, true)}
          </p>
          <div className="mt-3 flex items-center text-xs text-textoSecundario">
            <span className="font-medium text-texto">{accounts.length}</span>
            <span className="ml-1">contas ativas</span>
          </div>
        </div>

        {/* Receitas do Mês */}
        <div className="bg-superficie p-6 rounded-xl border border-borda shadow-suave hover:shadow-card transition-shadow">
          <div className="flex items-center justify-between text-textoSecundario mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">Receitas do Mês</span>
            <div className="w-8 h-8 rounded-lg bg-verdeEquilibrio/10 flex items-center justify-center text-verdeEquilibrio">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-verdeEquilibrio tracking-tight">
            {loading ? '...' : `+ ${formatCurrency(monthlyIncomeCents, true)}`}
          </p>
          <div className="mt-3 flex items-center text-xs text-textoSecundario">
            <span className="inline-block w-2 h-2 rounded-full bg-verdeEquilibrio mr-1.5"></span>
            Base caixa confirmada
          </div>
        </div>

        {/* Despesas do Mês */}
        <div className="bg-superficie p-6 rounded-xl border border-borda shadow-suave hover:shadow-card transition-shadow">
          <div className="flex items-center justify-between text-textoSecundario mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider">Despesas do Mês</span>
            <div className="w-8 h-8 rounded-lg bg-erro/10 flex items-center justify-center text-erro">
              <ArrowDownRight className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-erro tracking-tight">
            {loading ? '...' : `- ${formatCurrency(monthlyExpenseCents, true)}`}
          </p>
          <div className="mt-3 flex items-center text-xs text-textoSecundario">
            <span className="inline-block w-2 h-2 rounded-full bg-erro mr-1.5"></span>
            Resultado: {formatCurrency(netBalanceCents, true)}
          </div>
        </div>
      </div>

      {/* Grid: Contas e Últimas Movimentações */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contas Bancárias */}
        <div className="bg-superficie p-6 rounded-xl border border-borda shadow-suave space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-borda">
            <div className="flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-azulFluxo" />
              <h2 className="font-bold text-base text-azulFluxo">Minhas Contas</h2>
            </div>
            <span className="text-xs text-textoSecundario">{accounts.length} cadastradas</span>
          </div>

          {accounts.length === 0 && !loading && (
            <div className="text-center py-10 bg-superficieSecundaria rounded-lg border border-dashed border-borda">
              <p className="text-sm text-textoSecundario">Nenhuma conta cadastrada ainda.</p>
              <p className="text-xs text-textoMudo mt-1">Crie sua primeira conta no menu Contas.</p>
            </div>
          )}

          <div className="space-y-2.5">
            {accounts.slice(0, 4).map((acc) => (
              <div
                key={acc.id}
                className="flex items-center justify-between p-3.5 bg-superficieSecundaria hover:bg-nevoa rounded-lg border border-borda transition-colors"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-white border border-borda flex items-center justify-center overflow-hidden flex-shrink-0 shadow-xs">
                    {acc.institution_id ? (
                      <img
                        src={`/api/v1/catalog/logos/${acc.institution_id}`}
                        alt="Logo"
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
                  <div className="truncate">
                    <p className="text-sm font-semibold text-texto truncate">{acc.name}</p>
                    <p className="text-xs text-textoSecundario capitalize">{acc.account_type || 'Conta Corrente'}</p>
                  </div>
                </div>
                <p className="text-sm font-bold text-azulFluxo flex-shrink-0 ml-3">
                  {formatCurrency(acc.current_balance ?? acc.opening_balance ?? 0, true)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Últimas Movimentações */}
        <div className="bg-superficie p-6 rounded-xl border border-borda shadow-suave space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-borda">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-azulFluxo" />
              <h2 className="font-bold text-base text-azulFluxo">Últimas Movimentações</h2>
            </div>
            <span className="text-xs text-textoSecundario">Recentes</span>
          </div>

          {recentTransactions.length === 0 && !loading && (
            <div className="text-center py-10 bg-superficieSecundaria rounded-lg border border-dashed border-borda">
              <p className="text-sm text-textoSecundario">Nenhuma movimentação registrada.</p>
              <p className="text-xs text-textoMudo mt-1">Lançamentos recentes aparecerão aqui.</p>
            </div>
          )}

          <div className="space-y-2.5">
            {recentTransactions.map((tx, idx) => {
              const isIncome = tx.type === 'income' || (tx.amount > 0 && tx.type !== 'expense');

              return (
                <div
                  key={tx.id || idx}
                  className="flex items-center justify-between p-3.5 bg-superficieSecundaria hover:bg-nevoa rounded-lg border border-borda transition-colors"
                >
                  <div className="min-w-0 pr-3">
                    <p className="text-sm font-semibold text-texto truncate">{tx.description}</p>
                    <p className="text-xs text-textoSecundario">{formatDate(tx.transaction_date || tx.date)}</p>
                  </div>
                  <span
                    className={`text-sm font-bold flex-shrink-0 ${
                      isIncome ? 'text-verdeEquilibrio' : 'text-erro'
                    }`}
                  >
                    {isIncome ? '+ ' : '- '}
                    {formatCurrency(Math.abs(tx.amount || 0), true)}
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
