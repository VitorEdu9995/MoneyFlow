import { FormEvent, useEffect, useState } from 'react';
import { apiExecute } from '../api';

type Goal = { id: string; name: string; goal_type: 'savings' | 'spending'; target_amount: number; current_amount: number; progress_percent: number; deadline: string; piggy_bank?: { balance: number } | null };
const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', goal_type: 'savings', target_amount: '', category_id: '', start_date: new Date().toISOString().slice(0, 10), deadline: '' });
  const load = () => apiExecute('list_metas', { limit: 100, offset: 0 }).then(setGoals).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      await apiExecute('metas_create', { ...form, target_amount: Number(form.target_amount), category_id: form.goal_type === 'spending' ? form.category_id : undefined });
      setOpen(false); setForm({ ...form, name: '', target_amount: '', category_id: '' }); load();
    } catch (e: any) { setError(e.message); }
  }
  async function remove(id: string) { if (window.confirm('Excluir esta meta?')) { await apiExecute('metas_delete', { id }); load(); } }
  async function deposit(goal: Goal) {
    const sourceAccountId = window.prompt('ID da conta de origem:');
    const amount = window.prompt('Valor do aporte (R$):');
    if (!sourceAccountId || !amount) return;
    try { await apiExecute('cofrinho_deposit', { goal_id: goal.id, source_account_id: sourceAccountId, amount: Number(amount), date: new Date().toISOString().slice(0, 10) }); load(); }
    catch (e: any) { setError(e.message); }
  }
  async function edit(goal: Goal) {
    const name = window.prompt('Nome da meta:', goal.name);
    const target = window.prompt('Valor alvo (R$):', String(goal.target_amount / 100));
    if (!name || !target) return;
    try { await apiExecute('metas_update', { id: goal.id, name, target_amount: Number(target) }); load(); }
    catch (e: any) { setError(e.message); }
  }
  return <div>
    <div className="flex justify-between items-center mb-6"><div><h2 className="text-2xl font-bold">Metas</h2><p className="text-textoSecundario">Acompanhe objetivos e cofrinhos sem misturá-los ao patrimônio.</p></div><button onClick={() => setOpen(true)} className="bg-verdeEquilibrio text-white px-4 py-2 rounded">Nova meta</button></div>
    {error && <p className="text-erro mb-4">Erro: {error}</p>}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{goals.map(goal => <article key={goal.id} className="bg-superficie p-5 rounded-lg border border-[#2A2A2A]">
      <div className="flex justify-between gap-3"><div><h3 className="font-bold text-lg">{goal.name}</h3><p className="text-sm text-textoSecundario">{goal.goal_type === 'savings' ? 'Cofrinho' : 'Limite de gasto'} · até {goal.deadline}</p></div><button onClick={() => remove(goal.id)} className="text-erro text-sm">Excluir</button></div>
      <div className="mt-4 h-2 bg-[#2A2A2A] rounded"><div className="h-2 rounded bg-mentaClara" style={{ width: `${Math.min(goal.progress_percent, 100)}%` }} /></div>
      <div className="flex justify-between mt-2 text-sm"><span>{money(goal.current_amount)} de {money(goal.target_amount)}</span><strong>{goal.progress_percent.toFixed(0)}%</strong></div>
      <div className="mt-3 flex gap-2">{goal.piggy_bank && <button onClick={() => deposit(goal)} className="text-sm border border-mentaClara text-mentaClara px-3 py-1 rounded">Aportar</button>}<button onClick={() => edit(goal)} className="text-sm border border-[#555] px-3 py-1 rounded">Editar</button></div>
    </article>)}</div>
    {!goals.length && !error && <div className="bg-superficie p-8 rounded-lg text-textoSecundario">Nenhuma meta criada.</div>}
    {open && <div className="fixed inset-0 bg-black/60 grid place-items-center p-4"><form onSubmit={create} className="bg-superficie border border-[#2A2A2A] rounded-lg p-6 w-full max-w-md space-y-3"><h3 className="text-xl font-bold">Criar meta</h3><input required placeholder="Nome" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full p-2 rounded bg-[#202020]" /><select value={form.goal_type} onChange={e => setForm({ ...form, goal_type: e.target.value })} className="w-full p-2 rounded bg-[#202020]"><option value="savings">Cofrinho</option><option value="spending">Gasto por categoria</option></select>{form.goal_type === 'spending' && <input required placeholder="ID da categoria" value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })} className="w-full p-2 rounded bg-[#202020]" />}<input required type="number" min="0.01" step="0.01" placeholder="Valor alvo (R$)" value={form.target_amount} onChange={e => setForm({ ...form, target_amount: e.target.value })} className="w-full p-2 rounded bg-[#202020]" /><label className="block text-sm">Início<input required type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="w-full p-2 rounded bg-[#202020]" /></label><label className="block text-sm">Prazo<input required type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} className="w-full p-2 rounded bg-[#202020]" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)}>Cancelar</button><button className="bg-verdeEquilibrio text-white px-4 py-2 rounded">Salvar</button></div></form></div>}
  </div>;
}
