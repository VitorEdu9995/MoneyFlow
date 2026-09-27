import { FormEvent, useEffect, useState } from 'react';
import { apiExecute } from '../api';
import { Plus, Target, PiggyBank, ArrowDownToLine, Pencil, Trash2 } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';

interface Goal {
  id: string;
  name: string;
  goal_type: 'savings' | 'spending';
  target_amount: number;
  current_amount: number;
  progress_percent: number;
  deadline: string;
  piggy_bank?: { balance: number; account_id?: string } | null;
}

interface Account {
  id: string;
  name: string;
}

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Modais
  const [openCreate, setOpenCreate] = useState(false);
  const [openDeposit, setOpenDeposit] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);

  // Forms
  const [createForm, setCreateForm] = useState({
    name: '',
    goal_type: 'savings' as 'savings' | 'spending',
    target_amount: '',
    category_id: '',
    start_date: new Date().toISOString().slice(0, 10),
    deadline: '',
  });

  const [depositForm, setDepositForm] = useState({
    sourceAccountId: '',
    amount: '',
  });

  const [editForm, setEditForm] = useState({
    name: '',
    target_amount: '',
  });

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [goalsRes, accsRes] = await Promise.all([
        apiExecute<Goal[]>('list_metas', { limit: 100, offset: 0 }).catch(() => []),
        apiExecute<Account[]>('list_accounts', {}).catch(() => []),
      ]);
      setGoals(Array.isArray(goalsRes) ? goalsRes : []);
      setAccounts(Array.isArray(accsRes) ? accsRes : []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    try {
      const amountNum = parseFloat(createForm.target_amount.replace(',', '.'));
      await apiExecute('metas_create', {
        ...createForm,
        target_amount: amountNum,
        category_id: createForm.goal_type === 'spending' ? createForm.category_id : undefined,
      });
      setOpenCreate(false);
      setCreateForm({
        name: '',
        goal_type: 'savings',
        target_amount: '',
        category_id: '',
        start_date: new Date().toISOString().slice(0, 10),
        deadline: '',
      });
      loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDeposit(e: FormEvent) {
    e.preventDefault();
    if (!selectedGoal || !depositForm.sourceAccountId || !depositForm.amount) return;

    try {
      const amountNum = parseFloat(depositForm.amount.replace(',', '.'));
      await apiExecute('cofrinho_deposit', {
        goal_id: selectedGoal.id,
        source_account_id: depositForm.sourceAccountId,
        amount: amountNum,
        date: new Date().toISOString().slice(0, 10),
      });
      setOpenDeposit(false);
      setDepositForm({ sourceAccountId: '', amount: '' });
      setSelectedGoal(null);
      loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    if (!selectedGoal || !editForm.name || !editForm.target_amount) return;

    try {
      const targetNum = parseFloat(editForm.target_amount.replace(',', '.'));
      await apiExecute('metas_update', {
        id: selectedGoal.id,
        name: editForm.name.trim(),
        target_amount: targetNum,
      });
      setOpenEdit(false);
      setSelectedGoal(null);
      loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function remove(id: string) {
    if (window.confirm('Deseja realmente excluir esta meta?')) {
      try {
        await apiExecute('metas_delete', { id });
        loadData();
      } catch (e: any) {
        setError(e.message);
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azulFluxo">Metas & Cofrinhos</h1>
          <p className="text-sm text-textoSecundario">
            Reserve recursos e acompanhe objetivos sem misturá-los ao saldo operacional do dia a dia.
          </p>
        </div>
        <button
          onClick={() => setOpenCreate(true)}
          className="inline-flex items-center justify-center space-x-2 bg-verdeEquilibrio hover:bg-verdeEquilibrioDark text-white px-4 py-2.5 rounded-lg text-sm font-semibold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio focus:ring-offset-2"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Meta</span>
        </button>
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-textoSecundario">
          Carregando metas e cofrinhos...
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

      {!loading && !error && goals.length === 0 && (
        <div className="text-center py-16 bg-superficie rounded-xl border border-dashed border-borda shadow-suave">
          <div className="w-12 h-12 rounded-full bg-nevoa flex items-center justify-center text-azulFluxo mx-auto mb-3">
            <Target className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-azulFluxo">Nenhuma meta ativa</h3>
          <p className="text-sm text-textoSecundario max-w-sm mx-auto mt-1 mb-4">
            Crie cofrinhos para viagens, reserva de emergência ou compras futuras com controle isolado.
          </p>
          <button
            onClick={() => setOpenCreate(true)}
            className="inline-flex items-center space-x-2 bg-verdeEquilibrio text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-verdeEquilibrioDark transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Primeira Meta</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {goals.map((goal) => {
          const isCofrinho = goal.goal_type === 'savings';
          const pct = Math.min(100, goal.progress_percent || 0);

          return (
            <article
              key={goal.id}
              className="bg-superficie p-6 rounded-xl border border-borda shadow-suave hover:shadow-card transition-all space-y-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-start">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-full bg-nevoa border border-borda flex items-center justify-center text-azulFluxo flex-shrink-0">
                      {isCofrinho ? <PiggyBank className="w-5 h-5 text-verdeEquilibrio" /> : <Target className="w-5 h-5 text-azulFluxo" />}
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-azulFluxo leading-tight">{goal.name}</h3>
                      <p className="text-xs text-textoSecundario mt-0.5">
                        {isCofrinho ? 'Cofrinho de Reserva' : 'Limite de Gastos'} · Prazo até {goal.deadline}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => remove(goal.id)}
                    className="p-1 text-textoMudo hover:text-erro rounded transition-colors"
                    title="Excluir meta"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Barra de Progresso */}
                <div className="mt-5 space-y-1.5">
                  <div className="w-full bg-superficieSecundaria h-3 rounded-full overflow-hidden border border-borda/50 p-0.5">
                    <div
                      className="h-full rounded-full bg-verdeEquilibrio transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-textoSecundario pt-0.5">
                    <span>{formatCurrency(goal.current_amount, true)} de {formatCurrency(goal.target_amount, true)}</span>
                    <strong className="text-azulFluxo font-bold tabular-nums">{pct.toFixed(0)}%</strong>
                  </div>
                </div>
              </div>

              {/* Ações */}
              <div className="pt-3 border-t border-borda flex items-center justify-end space-x-2">
                {goal.piggy_bank && (
                  <button
                    onClick={() => {
                      setSelectedGoal(goal);
                      setDepositForm({ sourceAccountId: accounts[0]?.id || '', amount: '' });
                      setOpenDeposit(true);
                    }}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-verdeEquilibrio/30 bg-verdeEquilibrio/10 text-verdeEquilibrioDark hover:bg-verdeEquilibrio/20 text-xs font-semibold transition-all"
                  >
                    <ArrowDownToLine className="w-3.5 h-3.5" />
                    <span>Aportar</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedGoal(goal);
                    setEditForm({ name: goal.name, target_amount: String(goal.target_amount / 100) });
                    setOpenEdit(true);
                  }}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-borda text-textoSecundario hover:text-texto hover:bg-superficieSecundaria text-xs font-semibold transition-all"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Editar</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Modal Criar Meta */}
      {openCreate && (
        <div className="fixed inset-0 bg-azulFluxo/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <form onSubmit={handleCreate} className="bg-superficie border border-borda rounded-2xl max-w-md w-full p-6 space-y-4 shadow-modal">
            <h3 className="text-lg font-bold text-azulFluxo">Nova Meta Financeira</h3>
            <div>
              <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1">Nome do Objetivo</label>
              <input
                required
                placeholder="Ex: Viagem de Férias, Reserva de Emergência"
                value={createForm.name}
                onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1">Tipo de Meta</label>
              <select
                value={createForm.goal_type}
                onChange={e => setCreateForm({ ...createForm, goal_type: e.target.value as any })}
                className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio"
              >
                <option value="savings">Cofrinho de Reserva (Poupança Isolada)</option>
                <option value="spending">Teto de Gastos (Limite)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1">Valor Alvo (R$)</label>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0,00"
                value={createForm.target_amount}
                onChange={e => setCreateForm({ ...createForm, target_amount: e.target.value })}
                className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1">Data Início</label>
                <input
                  required
                  type="date"
                  value={createForm.start_date}
                  onChange={e => setCreateForm({ ...createForm, start_date: e.target.value })}
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1">Prazo Alvo</label>
                <input
                  required
                  type="date"
                  value={createForm.deadline}
                  onChange={e => setCreateForm({ ...createForm, deadline: e.target.value })}
                  className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3 pt-3 border-t border-borda">
              <button
                type="button"
                onClick={() => setOpenCreate(false)}
                className="px-4 py-2.5 text-sm font-semibold text-textoSecundario hover:text-texto rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="bg-verdeEquilibrio hover:bg-verdeEquilibrioDark text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-sm"
              >
                Salvar Meta
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Aportar no Cofrinho (Eliminando window.prompt) */}
      {openDeposit && selectedGoal && (
        <div className="fixed inset-0 bg-azulFluxo/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <form onSubmit={handleDeposit} className="bg-superficie border border-borda rounded-2xl max-w-md w-full p-6 space-y-4 shadow-modal">
            <h3 className="text-lg font-bold text-azulFluxo">Aportar no Cofrinho</h3>
            <p className="text-xs text-textoSecundario">
              Transfira recursos de uma conta para a reserva isolada de <strong>{selectedGoal.name}</strong>.
            </p>

            <div>
              <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1">Conta de Origem</label>
              <select
                required
                value={depositForm.sourceAccountId}
                onChange={e => setDepositForm({ ...depositForm, sourceAccountId: e.target.value })}
                className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio"
              >
                <option value="">Selecione uma conta...</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1">Valor do Aporte (R$)</label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0,00"
                value={depositForm.amount}
                onChange={e => setDepositForm({ ...depositForm, amount: e.target.value })}
                className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-borda">
              <button
                type="button"
                onClick={() => setOpenDeposit(false)}
                className="px-4 py-2.5 text-sm font-semibold text-textoSecundario hover:text-texto rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="bg-verdeEquilibrio hover:bg-verdeEquilibrioDark text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-sm"
              >
                Confirmar Aporte
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Editar Meta */}
      {openEdit && selectedGoal && (
        <div className="fixed inset-0 bg-azulFluxo/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <form onSubmit={handleEdit} className="bg-superficie border border-borda rounded-2xl max-w-md w-full p-6 space-y-4 shadow-modal">
            <h3 className="text-lg font-bold text-azulFluxo">Editar Meta</h3>

            <div>
              <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1">Nome do Objetivo</label>
              <input
                required
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-texto uppercase tracking-wider mb-1">Novo Valor Alvo (R$)</label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                value={editForm.target_amount}
                onChange={e => setEditForm({ ...editForm, target_amount: e.target.value })}
                className="w-full bg-superficie border border-borda rounded-lg px-3.5 py-2.5 text-sm text-texto focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-borda">
              <button
                type="button"
                onClick={() => setOpenEdit(false)}
                className="px-4 py-2.5 text-sm font-semibold text-textoSecundario hover:text-texto rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="bg-verdeEquilibrio hover:bg-verdeEquilibrioDark text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-sm"
              >
                Salvar Alterações
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
