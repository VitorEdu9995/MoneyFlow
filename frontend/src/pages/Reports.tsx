import { ResponsiveSankey } from '@nivo/sankey';

const data = {
  nodes: [
    { id: 'Salário', nodeColor: '#138A63' },
    { id: 'Freela', nodeColor: '#138A63' },
    { id: 'Total Receitas', nodeColor: '#123047' },
    { id: 'Moradia', nodeColor: '#B74747' },
    { id: 'Alimentação', nodeColor: '#B74747' },
    { id: 'Transporte', nodeColor: '#B74747' },
    { id: 'Lazer', nodeColor: '#D99019' },
    { id: 'Investimentos', nodeColor: '#BFEBDD' }
  ],
  links: [
    { source: 'Salário', target: 'Total Receitas', value: 8000 },
    { source: 'Freela', target: 'Total Receitas', value: 2000 },
    { source: 'Total Receitas', target: 'Moradia', value: 3000 },
    { source: 'Total Receitas', target: 'Alimentação', value: 1500 },
    { source: 'Total Receitas', target: 'Transporte', value: 800 },
    { source: 'Total Receitas', target: 'Lazer', value: 1200 },
    { source: 'Total Receitas', target: 'Investimentos', value: 3500 }
  ]
};

export default function Reports() {
  return (
    <div className="h-full flex flex-col">
      <h2 className="text-2xl font-bold mb-6">Relatórios (Fluxo de Caixa)</h2>
      <div className="flex-1 bg-superficie p-6 rounded-lg border border-[#2A2A2A] min-h-[500px]">
        <ResponsiveSankey
          data={data}
          margin={{ top: 40, right: 160, bottom: 40, left: 50 }}
          align="justify"
          colors={{ scheme: 'category10' }}
          nodeOpacity={1}
          nodeHoverOthersOpacity={0.3}
          nodeThickness={18}
          nodeSpacing={24}
          nodeBorderWidth={0}
          nodeBorderColor={{ from: 'color', modifiers: [ [ 'darker', 0.8 ] ] }}
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
      </div>
    </div>
  );
}
