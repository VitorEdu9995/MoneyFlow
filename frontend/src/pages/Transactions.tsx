import { useState, useEffect } from 'react';
import { apiExecute } from '../api';

export default function Transactions() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiExecute('list_transactions', {})
      .then(res => setTransactions(res || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Transações</h2>
      {loading ? (
        <p>Carregando...</p>
      ) : error ? (
        <p className="text-erro">Erro: {error}</p>
      ) : (
        <div className="bg-superficie rounded-lg border border-[#2A2A2A] overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-[#2A2A2A] text-textoSecundario">
              <tr>
                <th className="p-4">Data</th>
                <th className="p-4">Descrição</th>
                <th className="p-4">Categoria</th>
                <th className="p-4">Valor</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-textoSecundario">Nenhuma transação.</td>
                </tr>
              ) : (
                transactions.map((t, i) => (
                  <tr key={i} className="border-t border-[#2A2A2A]">
                    <td className="p-4">{t.date}</td>
                    <td className="p-4">{t.description}</td>
                    <td className="p-4"><span className="bg-[#2A2A2A] px-2 py-1 rounded text-xs">{t.category}</span></td>
                    <td className={`p-4 ${t.amount < 0 ? 'text-erro' : 'text-verdeEquilibrio'}`}>R$ {Math.abs(t.amount).toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
