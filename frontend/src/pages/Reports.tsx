import { useState, useEffect } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import { apiExecute } from '../api';
import { Info, BarChart2 } from 'lucide-react';

export default function Reports() {
  const [sankeyData, setSankeyData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const startDate = `${year}-${month}-01`;
        const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
        const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

        const res = await apiExecute<{ nodes: any[]; links: any[] }>('get_cashflow_sankey', {
          start_date: startDate,
          end_date: endDate,
          basis,
        });

        if (res && Array.isArray(res.nodes) && Array.isArray(res.links) && res.nodes.length > 0 && res.links.length > 0) {
          const formattedLinks = res.links.map((l) => ({
            source: l.source,
            target: l.target,
            value: Math.max(1, Math.round((l.value || 0) / 100)),
          }));
          const formattedNodes = res.nodes.map((n) => ({
            id: n.id,
            nodeColor: n.nodeColor || '#138A63',
          }));

          setSankeyData({ nodes: formattedNodes, links: formattedLinks });
        } else {
          setSankeyData({ nodes: [], links: [] });
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadReport();
  }, [basis]);

  const hasData = sankeyData.nodes.length > 0 && sankeyData.links.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-azulFluxo">Fluxo de Caixa</h1>
          <p className="text-sm text-textoSecundario">
            Visualização visual e explicável da trajetória entre receitas, categorias e despesas.
          </p>
        </div>

        {/* Seletor de Base de Cálculo */}
        <div className="flex items-center space-x-1.5 bg-superficie p-1 rounded-xl border border-borda shadow-xs">
          <button
            type="button"
            onClick={() => setBasis('accrual')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              basis === 'accrual'
                ? 'bg-verdeEquilibrio text-white shadow-xs'
                : 'text-textoSecundario hover:text-texto'
            }`}
          >
            Competência
          </button>
          <button
            type="button"
            onClick={() => setBasis('cash')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              basis === 'cash'
                ? 'bg-verdeEquilibrio text-white shadow-xs'
                : 'text-textoSecundario hover:text-texto'
            }`}
          >
            Caixa
          </button>
        </div>
      </div>

      {/* Box explicativo de transparência */}
      <div className="p-3.5 bg-azulFluxo/5 border border-azulFluxo/10 rounded-xl text-xs text-azulFluxo flex items-start space-x-2.5">
        <Info className="w-4 h-4 text-azulFluxo flex-shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong>{basis === 'accrual' ? 'Visão por Competência:' : 'Visão por Caixa:'}</strong>{' '}
          {basis === 'accrual'
            ? 'Considera a data em que o compromisso ou compra ocorreu, incluindo faturas de cartão de crédito.'
            : 'Considera estritamente o dinheiro que efetivamente entrou ou saiu das suas contas correntes no período.'}
        </p>
      </div>

      {error && (
        <div className="p-4 bg-erro/10 border border-erro/20 rounded-xl text-erro text-sm">
          {error}
        </div>
      )}

      {/* Área do Diagrama */}
      <div className="bg-superficie p-6 rounded-xl border border-borda shadow-suave min-h-[520px] flex items-center justify-center">
        {loading ? (
          <div className="text-center text-sm text-textoSecundario">
            Carregando diagrama de fluxo de caixa...
          </div>
        ) : !hasData ? (
          <div className="text-center py-16 max-w-sm space-y-3">
            <div className="w-12 h-12 rounded-full bg-nevoa flex items-center justify-center text-azulFluxo mx-auto">
              <BarChart2 className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-azulFluxo text-base">Sem movimentações suficientes</h3>
            <p className="text-xs text-textoSecundario leading-relaxed">
              O diagrama de fluxo requer receitas e despesas vinculadas a categorias no mês atual para desenhar as trajetórias de fluxo.
            </p>
          </div>
        ) : (
          <div className="w-full h-[480px]">
            <ResponsiveSankey
              data={sankeyData}
              margin={{ top: 20, right: 140, bottom: 20, left: 30 }}
              align="justify"
              colors={['#138A63', '#123047', '#B74747', '#D99019', '#BFEBDD']}
              nodeOpacity={1}
              nodeHoverOthersOpacity={0.35}
              nodeThickness={16}
              nodeSpacing={20}
              nodeBorderWidth={0}
              nodeBorderRadius={4}
              linkOpacity={0.4}
              linkHoverOthersOpacity={0.15}
              linkContract={2}
              enableLinkGradient={true}
              labelPosition="outside"
              labelOrientation="horizontal"
              labelPadding={14}
              labelTextColor="#20313D"
            />
          </div>
        )}
      </div>
    </div>
  );
}
