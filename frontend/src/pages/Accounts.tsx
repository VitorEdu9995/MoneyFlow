import { useState, useEffect } from 'react';
import { apiExecute } from '../api';

export default function Accounts() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiExecute('list_accounts', {})
      .then(res => setAccounts(res || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Contas</h2>
        <button className="bg-verdeEquilibrio text-white px-4 py-2 rounded hover:bg-opacity-90">Nova Conta</button>
      </div>

      {loading && <p className="text-textoSecundario">Carregando contas...</p>}
      {error && <p className="text-erro">Erro: {error}</p>}
      
      {!loading && !error && accounts.length === 0 && (
        <div className="text-center py-12 bg-superficie rounded-lg border border-[#2A2A2A]">
          <p className="text-textoSecundario">Nenhuma conta encontrada.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((acc, i) => (
          <div key={i} className="bg-superficie p-6 rounded-lg border border-[#2A2A2A] flex justify-between items-center">
            <div>
              <h3 className="font-bold text-lg">{acc.name || 'Conta Corrente'}</h3>
              <p className="text-textoSecundario text-sm">{acc.institution || 'Banco'}</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-mentaClara">R$ {(acc.balance || 0).toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
