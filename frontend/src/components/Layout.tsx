import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Home, CreditCard, List, Tags, PieChart, BarChart2, Briefcase, Target } from 'lucide-react';
import logo from '../assets/logo.png';
import { getActiveSpaceId, setActiveSpaceId } from '../api';

export default function Layout() {
  const location = useLocation();
  const [currentSpace, setCurrentSpace] = useState(() => getActiveSpaceId() || 'Pessoal');

  const navItems = [
    { name: 'Dashboard', path: '/', icon: Home },
    { name: 'Contas', path: '/accounts', icon: Briefcase },
    { name: 'Cartões', path: '/credit-cards', icon: CreditCard },
    { name: 'Transações', path: '/transactions', icon: List },
    { name: 'Categorias', path: '/categories', icon: Tags },
    { name: 'Orçamentos', path: '/budgets', icon: PieChart },
    { name: 'Metas', path: '/goals', icon: Target },
    { name: 'Relatórios', path: '/reports', icon: BarChart2 },
  ];

  const handleSpaceChange = (newSpace: string) => {
    setCurrentSpace(newSpace);
    setActiveSpaceId(newSpace);
    // Dispara recarregamento suave para atualizar dados do novo espaço
    window.location.reload();
  };

  return (
    <div className="flex h-screen bg-superficie text-texto">
      {/* Sidebar */}
      <aside className="w-64 bg-superficie border-r border-[#2A2A2A] flex flex-col">
        <div className="p-4 border-b border-[#2A2A2A]">
          <img src={logo} alt="MoneyFlow Logo" className="h-8 object-contain" />
          <div className="mt-4">
            <label className="text-xs text-textoSecundario font-medium">Espaço Ativo</label>
            <select
              value={currentSpace}
              onChange={(e) => handleSpaceChange(e.target.value)}
              className="w-full mt-1 bg-[#1A1A1A] text-texto text-sm p-2 rounded-lg border border-[#2A2A2A] focus:outline-none focus:border-verdeEquilibrio"
            >
              <option value="Pessoal">Pessoal</option>
              <option value="Empresa">Empresa</option>
            </select>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center px-4 py-2 hover:bg-[#2A2A2A] transition-colors ${
                      isActive ? 'bg-[#2A2A2A] border-r-4 border-mentaClara text-mentaClara font-medium' : 'text-textoSecundario'
                    }`}
                  >
                    <Icon className="w-5 h-5 mr-3" />
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="p-4 border-t border-[#2A2A2A]">
          <div className="flex items-center">
            <div className="w-8 h-8 rounded-full bg-azulFluxo flex items-center justify-center text-mentaClara font-bold text-sm">
              V
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium">Vitor</p>
              <p className="text-xs text-textoSecundario">Owner</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8 bg-[#0D0D0D]">
        <Outlet />
      </main>
    </div>
  );
}
