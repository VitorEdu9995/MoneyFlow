import { Outlet, Link, useLocation } from 'react-router-dom';
import { Home, CreditCard, List, Tags, PieChart, BarChart2, Briefcase } from 'lucide-react';
import logo from '../assets/logo.png';

export default function Layout() {
  const location = useLocation();
  const navItems = [
    { name: 'Dashboard', path: '/', icon: Home },
    { name: 'Contas', path: '/accounts', icon: Briefcase },
    { name: 'Cartões', path: '/credit-cards', icon: CreditCard },
    { name: 'Transações', path: '/transactions', icon: List },
    { name: 'Categorias', path: '/categories', icon: Tags },
    { name: 'Orçamentos', path: '/budgets', icon: PieChart },
    { name: 'Relatórios', path: '/reports', icon: BarChart2 },
  ];

  return (
    <div className="flex h-screen bg-superficie text-texto">
      {/* Sidebar */}
      <aside className="w-64 bg-superficie border-r border-[#2A2A2A] flex flex-col">
        <div className="p-4 border-b border-[#2A2A2A]">
          <img src={logo} alt="MoneyFlow Logo" className="h-8" />
          <div className="mt-4">
            <label className="text-sm text-textoSecundario">Espaço</label>
            <select className="w-full mt-1 bg-superficie text-texto p-2 rounded border border-[#2A2A2A]">
              <option>Pessoal</option>
              <option>Empresa</option>
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
                    className={`flex items-center px-4 py-2 hover:bg-[#2A2A2A] transition-colors ${isActive ? 'bg-[#2A2A2A] border-r-4 border-mentaClara text-mentaClara' : 'text-textoSecundario'}`}
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
            <div className="w-8 h-8 rounded-full bg-azulFluxo flex items-center justify-center text-mentaClara font-bold">V</div>
            <div className="ml-3">
              <p className="text-sm font-medium">Vitor</p>
              <p className="text-xs text-textoSecundario">Admin</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
