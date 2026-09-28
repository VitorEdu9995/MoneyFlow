import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Home, CreditCard, List, Tags, PieChart, BarChart2, Briefcase, Target, ExternalLink, Settings as SettingsIcon } from 'lucide-react';
import logo from '../assets/logo.png';
import { getActiveSpaceId, setActiveSpaceId } from '../api';

export default function Layout() {
  const location = useLocation();
  const [currentSpace, setCurrentSpace] = useState(() => getActiveSpaceId() || 'Pessoal');

  const navItems = [
    { name: 'Visão Geral', path: '/', icon: Home },
    { name: 'Contas', path: '/accounts', icon: Briefcase },
    { name: 'Cartões', path: '/credit-cards', icon: CreditCard },
    { name: 'Movimentações', path: '/transactions', icon: List },
    { name: 'Categorias', path: '/categories', icon: Tags },
    { name: 'Orçamentos', path: '/budgets', icon: PieChart },
    { name: 'Metas', path: '/goals', icon: Target },
    { name: 'Fluxo de Caixa', path: '/reports', icon: BarChart2 },
    { name: 'Configurações', path: '/settings', icon: SettingsIcon },
  ];

  const handleSpaceChange = (newSpace: string) => {
    setCurrentSpace(newSpace);
    setActiveSpaceId(newSpace);
    window.location.reload();
  };

  return (
    <div className="flex h-screen bg-nevoa text-texto antialiased">
      {/* Sidebar - Azul Fluxo (#123047) conforme Manual de Marca */}
      <aside className="w-64 bg-azulFluxo text-white flex flex-col shadow-card z-10 flex-shrink-0">
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <img src={logo} alt="MoneyFlow Logo" className="h-8 object-contain" />
            <div>
              <span className="font-bold text-lg tracking-tight text-white block leading-tight">MoneyFlow</span>
              <span className="text-[10px] text-mentaClara font-medium">Seu dinheiro, em fluxo claro</span>
            </div>
          </div>

          <div className="mt-5">
            <label htmlFor="space-selector" className="text-xs font-semibold text-mentaClara/90 uppercase tracking-wider block mb-1">
              Espaço Ativo
            </label>
            <select
              id="space-selector"
              value={currentSpace}
              onChange={(e) => handleSpaceChange(e.target.value)}
              className="w-full bg-white/10 text-white text-sm px-3 py-2 rounded-lg border border-white/20 focus:outline-none focus:ring-2 focus:ring-verdeEquilibrio cursor-pointer transition-all"
            >
              <option value="Pessoal" className="bg-azulFluxo text-white">Espaço Pessoal</option>
              <option value="Empresa" className="bg-azulFluxo text-white">Espaço Empresarial</option>
            </select>
          </div>
        </div>

        {/* Menu de Navegação */}
        <nav className="flex-1 overflow-y-auto py-4 px-3" aria-label="Navegação Principal">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-white/15 text-mentaClara border-l-4 border-mentaClara shadow-sm'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-4 h-4 mr-3 flex-shrink-0" />
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Link para Apresentação do Sistema / Landing Page */}
        <div className="px-3 py-2 border-t border-white/10">
          <Link
            to="/landing"
            className="flex items-center justify-between text-xs text-mentaClara/80 hover:text-mentaClara hover:bg-white/10 px-3 py-2 rounded-lg transition-all"
            title="Conheça a visão geral e todas as funcionalidades do MoneyFlow"
          >
            <span className="flex items-center">
              <ExternalLink className="w-3.5 h-3.5 mr-2 text-mentaClara" />
              Conheça o MoneyFlow
            </span>
            <span className="text-[10px] bg-mentaClara/20 text-mentaClara px-1.5 py-0.5 rounded font-mono font-medium">
              Apresentação
            </span>
          </Link>
        </div>

        {/* Perfil do Usuário */}
        <div className="p-4 border-t border-white/10 bg-black/10">
          <div className="flex items-center">
            <div className="w-9 h-9 rounded-full bg-verdeEquilibrio flex items-center justify-center text-white font-bold text-sm shadow-sm">
              V
            </div>
            <div className="ml-3">
              <p className="text-sm font-semibold text-white leading-tight">Vitor</p>
              <p className="text-xs text-mentaClara/80">Administrador</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Área Principal de Conteúdo */}
      <main className="flex-1 overflow-y-auto p-6 md:p-8 bg-nevoa">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
