import { useState, useEffect } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import { apiExecute } from '../api';

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
          // Converte valores de centavos para reais para o diagrama
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
    <div className="h-full flex flex-col space-y-4">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold">Relatórios (Fluxo de Caixa)</h2>
          <p className="text-textoSecundario text-sm">Visualização explicável de entradas, categorias e saídas.</p>
        </div>

        {/* Seletor de Base */}
        <div className="flex items-center space-x-2 bg-[#1A1A1A] p-1 rounded-lg border border-[#2A2A2A]">
          <button
            type="button"
            onClick={() => setBasis('accrual')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              basis === 'accrual' ? 'bg-verdeEquilibrio text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Competência
          </button>
          <button
            type="button"
            onClick={() => setBasis('cash')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              basis === 'cash' ? 'bg-verdeEquilibrio text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Caixa
          </button>
        </div>
      </div>

      {loading && <p className="text-textoSecundario">Carregando relatório de fluxo de caixa...</p>}
      {error && <p className="text-erro">Erro: {error}</p>}

      <div className="flex-1 bg-superficie p-6 rounded-lg border border-[#2A2A2A] min-h-[500px] flex items-center justify-center">
        {!loading && !hasData ? (
          <div className="text-center space-y-2 py-12">
            <p className="text-textoSecundario font-medium">Nenhum dado de fluxo de caixa no mês selecionado.</p>
            <p className="text-xs text-gray-500">Cadastre receitas e despesas com categorias para gerar o diagrama Sankey.</p>
          </div>
        ) : (
          <ResponsiveSankey
            data={sankeyData}
            margin={{ top: 40, right: 160, bottom: 40, left: 50 }}
            align="justify"
            colors={{ scheme: 'category10' }}
            nodeOpacity={1}
            nodeHoverOthersOpacity={0.3}
            nodeThickness={18}
            nodeSpacing={24}
            nodeBorderWidth={0}
            nodeBorderColor={{ from: 'color', modifiers: [['darker', 0.8]] }}
            nodeBorderRadius={3}
            linkOpacity={0.5}
            linkHoverOthersOpacity={0.1}
            linkContract={3}
            enableLinkGradient={true}
            labelPosition="outside"
            labelOrientation="vertical"
            labelPadding={16}
            labelTextColor="#FFFFFF"
          />
        )}
      </div>
    </div>
  );
}
