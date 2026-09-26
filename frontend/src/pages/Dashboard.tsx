export default function Dashboard() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-superficie p-6 rounded-lg border border-[#2A2A2A]">
          <h3 className="text-textoSecundario mb-2">Saldo Total</h3>
          <p className="text-3xl font-bold text-mentaClara">R$ 15.430,00</p>
        </div>
        <div className="bg-superficie p-6 rounded-lg border border-[#2A2A2A]">
          <h3 className="text-textoSecundario mb-2">Receitas (Mês)</h3>
          <p className="text-3xl font-bold text-verdeEquilibrio">+ R$ 5.200,00</p>
        </div>
        <div className="bg-superficie p-6 rounded-lg border border-[#2A2A2A]">
          <h3 className="text-textoSecundario mb-2">Despesas (Mês)</h3>
          <p className="text-3xl font-bold text-erro">- R$ 2.150,00</p>
        </div>
      </div>
    </div>
  );
}
