import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ShieldCheck,
  Layers,
  PieChart,
  Target,
  Wallet,
  ChevronDown,
  Sparkles,
  TrendingUp,
  BarChart3,
  Lock,
  Calendar,
  Check,
  Building2,
  DollarSign
} from 'lucide-react';
import logo from '../assets/logo.png';

export default function LandingPage() {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [selectedRegime, setSelectedRegime] = useState<'caixa' | 'competencia'>('caixa');

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  const banks = [
    { name: 'Nubank', ispb: '18236120', color: '#820AD1', code: 'NU' },
    { name: 'Itaú Unibanco', ispb: '60701190', color: '#EC7000', code: 'IT' },
    { name: 'Banco Inter', ispb: '00416968', color: '#FF7A00', code: 'IN' },
    { name: 'Bradesco', ispb: '60746948', color: '#CC092F', code: 'BR' },
    { name: 'Banco do Brasil', ispb: '00000000', color: '#F8D117', code: 'BB' },
    { name: 'Santander', ispb: '90400888', color: '#EC0000', code: 'SAN' },
    { name: 'C6 Bank', ispb: '31872495', color: '#242424', code: 'C6' },
    { name: 'Caixa Econômica', ispb: '00360305', color: '#005CA9', code: 'CEF' },
    { name: 'BTG Pactual', ispb: '30306294', color: '#001E62', code: 'BTG' },
    { name: 'PicPay', ispb: '22896431', color: '#11C76F', code: 'PIC' }
  ];

  const cardBrands = ['Mastercard', 'Visa', 'Elo', 'American Express', 'Hipercard'];

  const features = [
    {
      icon: Layers,
      title: 'Múltiplos Espaços Independentes',
      subtitle: 'Isolamento estrito multi-tenant',
      description:
        'Gerencie suas finanças Pessoais, Empresariais (PJ) ou de Projetos Familiares no mesmo aplicativo, com separação criptográfica e sem misturar um único centavo.',
      tag: 'Segregação Total'
    },
    {
      icon: Building2,
      title: '150+ Bancos & Cartões Canônicos',
      subtitle: 'Padronização oficial brasileira',
      description:
        'Catálogo homologado com mais de 150 instituições financeiras nacionais, logos em SVG de alta definição, código ISPB e suporte a todas as principais bandeiras de crédito.',
      tag: 'Catálogo ADR-0002'
    },
    {
      icon: PieChart,
      title: 'Orçamentos & Tetos Preventivos',
      subtitle: 'Controle sem ansiedade ou julgamento',
      description:
        'Defina limites claros por categoria e acompanhe barras de progresso serenas. O MoneyFlow alerta preventivamente ao atingir 80% do teto, sem sermões ou lições de moral.',
      tag: 'Sem Julgamentos'
    },
    {
      icon: Target,
      title: 'Metas & Cofrinhos com Previsibilidade',
      subtitle: 'Planejamento com metas reais',
      description:
        'Crie objetivos para reserva de emergência, viagens ou aquisições. Vincule depósitos a contas reais e acompanhe o percentual concluído e o tempo restante estimado.',
      tag: 'Crescimento Real'
    },
    {
      icon: BarChart3,
      title: 'Fluxo de Caixa Visual (Sankey)',
      subtitle: 'De onde vem e para onde vai seu dinheiro',
      description:
        'Diagrama visual interativo conectando receitas, contas bancárias e categorias de despesa. Alterne instantaneamente entre Regime de Caixa e Competência com total fidelidade.',
      tag: 'Visão Sem Ruído'
    },
    {
      icon: ShieldCheck,
      title: 'Segurança & Privacidade LGPD',
      subtitle: 'Seus dados sob o seu controle',
      description:
        'Conformidade integral com a LGPD: ferramentas nativas de exportação completa em JSON canônico, direito ao esquecimento e backups criptografados com AES-256-GCM.',
      tag: 'Privacidade Nativa'
    }
  ];

  const faqs = [
    {
      question: 'O que diferencia o MoneyFlow de outros aplicativos financeiros?',
      answer:
        'O MoneyFlow foi concebido sob a filosofia de clareza e previsibilidade: ele substitui gráficos poluídos e notificações punitivas por uma experiência serena. Além disso, todos os cálculos são armazenados em centavos inteiros (eliminando qualquer erro de arredondamento), oferece suporte a 150+ instituições financeiras brasileiras e permite alternar entre o Regime de Caixa e de Competência com transparência contábil real.'
    },
    {
      question: 'Como funciona a diferença entre Regime de Caixa e Regime de Competência?',
      answer:
        'No Regime de Caixa, o MoneyFlow calcula as entradas e saídas no exato dia em que o dinheiro sai ou entra na sua conta (como o pagamento da fatura do cartão). No Regime de Competência, os lançamentos são contabilizados no dia em que a compra foi realizada. O MoneyFlow reconcilia ambos sem duplicar valores nem causar ilusão de saldo.'
    },
    {
      question: 'Posso usar para finanças da minha empresa e para as minhas contas pessoais?',
      answer:
        'Sim! Com a arquitetura de "Espaços" (Spaces), você pode criar um espaço para suas contas pessoais e outro para sua empresa (PJ). As transações, contas bancárias, cartões, relatórios e orçamentos ficam 100% segregados e nunca se misturam.'
    },
    {
      question: 'O MoneyFlow cobra mensalidade ou comercializa meus dados?',
      answer:
        'Não! O MoneyFlow é centrado na privacidade do usuário e não comercializa dados para seguradoras ou instituições financeiras. O sistema atende rigorosamente à LGPD, oferecendo ferramentas para você auditar, exportar ou apagar seus dados quando desejar.'
    },
    {
      question: 'Como é tratada a segurança das minhas informações?',
      answer:
        'Os dados são protegidos com criptografia de ponta a ponta (AES-256-GCM com derivação de chave Scrypt), banco de dados com integridade transacional ACID no SQLite e trilha de auditoria completa.'
    }
  ];

  return (
    <div className="min-h-screen bg-nevoa text-texto antialiased selection:bg-mentaClara selection:text-azulFluxo">
      {/* 1. Header / Navbar Institucional */}
      <header className="sticky top-0 z-50 bg-azulFluxo/95 backdrop-blur-md border-b border-white/10 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src={logo} alt="MoneyFlow Logo" className="h-10 w-auto object-contain" />
            <div>
              <span className="font-bold text-xl tracking-tight text-white block leading-tight">MoneyFlow</span>
              <span className="text-[11px] text-mentaClara font-medium tracking-wide">
                Seu dinheiro, em fluxo claro
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-white/80">
            <a href="#features" className="hover:text-mentaClara transition-colors">
              Funcionalidades
            </a>
            <a href="#banks" className="hover:text-mentaClara transition-colors">
              150+ Bancos
            </a>
            <a href="#regimes" className="hover:text-mentaClara transition-colors">
              Caixa vs Competência
            </a>
            <a href="#security" className="hover:text-mentaClara transition-colors">
              Segurança & LGPD
            </a>
            <a href="#faq" className="hover:text-mentaClara transition-colors">
              FAQ
            </a>
          </nav>

          <div className="flex items-center space-x-4">
            <Link
              to="/"
              className="inline-flex items-center px-5 py-2.5 rounded-lg text-sm font-semibold bg-verdeEquilibrio text-white hover:bg-verdeEquilibrioDark transition-all shadow-sm hover:shadow-card active:scale-[0.98]"
            >
              Acessar Painel
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </div>
        </div>
      </header>

      {/* 2. Hero Section */}
      <section className="relative pt-16 pb-20 md:pt-24 md:pb-32 overflow-hidden bg-gradient-to-b from-azulFluxo via-azulFluxo/95 to-azulFluxo text-white">
        {/* Efeito sutil de iluminação */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-verdeEquilibrio/15 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-white/10 text-mentaClara text-xs font-semibold uppercase tracking-wider mb-6 border border-white/15">
              <Sparkles className="w-3.5 h-3.5 text-mentaClara" />
              <span>Gestão Financeira Serena & Inteligente</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.15] text-white">
              Seu dinheiro, em <span className="text-mentaClara underline decoration-verdeEquilibrio decoration-wavy decoration-2">fluxo claro</span>.
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-white/80 leading-relaxed font-normal">
              Substitua a ansiedade financeira pela clareza no presente e previsibilidade no futuro.
              Controle contas, cartões, metas e orçamentos sem julgamento moral e com total precisão em centavos.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/"
                className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 rounded-xl text-base font-semibold bg-verdeEquilibrio text-white hover:bg-verdeEquilibrioDark transition-all shadow-card hover:shadow-modal group"
              >
                Abrir Plataforma MoneyFlow
                <ArrowRight className="w-5 h-5 ml-2.5 transition-transform group-hover:translate-x-1" />
              </Link>
              <a
                href="#features"
                className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3.5 rounded-xl text-base font-medium bg-white/10 text-white hover:bg-white/20 transition-all border border-white/20"
              >
                Conhecer Todas as Funcionalidades
              </a>
            </div>

            {/* Badges de Destaque */}
            <div className="mt-12 pt-8 border-t border-white/10 grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 text-mentaClara">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-white/60 font-medium">Instituições</p>
                  <p className="text-sm font-bold text-white">150+ Bancos Homologados</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 text-mentaClara">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-white/60 font-medium">Privacidade</p>
                  <p className="text-sm font-bold text-white">100% Compatível LGPD</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 text-mentaClara">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-white/60 font-medium">Segurança</p>
                  <p className="text-sm font-bold text-white">Criptografia AES-256</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 text-mentaClara">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-white/60 font-medium">Cálculos Reais</p>
                  <p className="text-sm font-bold text-white">Precisão em Centavos</p>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Preview Mockup */}
          <div className="mt-16 max-w-5xl mx-auto rounded-2xl p-2 bg-gradient-to-b from-white/20 to-white/5 border border-white/20 shadow-2xl">
            <div className="rounded-xl bg-superficie text-texto overflow-hidden shadow-modal border border-borda">
              {/* Mockup Header */}
              <div className="bg-superficieSecundaria px-6 py-4 border-b border-borda flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="w-3 h-3 rounded-full bg-erro/60" />
                  <span className="w-3 h-3 rounded-full bg-atencao/60" />
                  <span className="w-3 h-3 rounded-full bg-verdeEquilibrio/60" />
                  <span className="text-xs font-medium text-textoSecundario ml-3">
                    MoneyFlow / Espaço Pessoal / Visão Geral
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs px-2.5 py-1 rounded bg-verdeEquilibrio/10 text-verdeEquilibrio font-semibold">
                    Em tempo real
                  </span>
                </div>
              </div>

              {/* Mockup Content */}
              <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-3 gap-6 bg-nevoa/40">
                {/* KPI Saldo */}
                <div className="bg-superficie p-5 rounded-xl border border-borda shadow-suave">
                  <p className="text-xs font-semibold uppercase text-textoSecundario">Saldo Consolidado</p>
                  <p className="text-2xl font-bold text-texto mt-1 tabular-nums">R$ 18.450,20</p>
                  <p className="text-xs font-medium text-verdeEquilibrio mt-2 flex items-center">
                    <TrendingUp className="w-3.5 h-3.5 mr-1" />
                    +12,4% em relação ao mês anterior
                  </p>
                </div>

                {/* KPI Receitas */}
                <div className="bg-superficie p-5 rounded-xl border border-borda shadow-suave">
                  <p className="text-xs font-semibold uppercase text-textoSecundario">Receitas do Mês</p>
                  <p className="text-2xl font-bold text-verdeEquilibrio mt-1 tabular-nums">R$ 9.800,00</p>
                  <p className="text-xs text-textoSecundario mt-2">Salário + Rendimentos de Aplicação</p>
                </div>

                {/* KPI Despesas */}
                <div className="bg-superficie p-5 rounded-xl border border-borda shadow-suave">
                  <p className="text-xs font-semibold uppercase text-textoSecundario">Despesas Previstas</p>
                  <p className="text-2xl font-bold text-erro mt-1 tabular-nums">R$ 4.312,80</p>
                  <p className="text-xs text-textoSecundario mt-2">Dentro de 68% do teto planejado</p>
                </div>

                {/* Mockup: Contas Ativas com Logos */}
                <div className="md:col-span-2 bg-superficie p-5 rounded-xl border border-borda shadow-suave">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-bold text-texto">Contas Conectadas</h2>
                    <span className="text-xs text-textoSecundario">3 contas ativas</span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-superficieSecundaria border border-borda/70">
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 rounded-lg bg-[#820AD1] text-white flex items-center justify-center font-bold text-xs">
                          NU
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-texto">Nubank Conta</p>
                          <p className="text-xs text-textoSecundario">Corrente • Reserva Líquida</p>
                        </div>
                      </div>
                      <p className="text-sm font-bold text-texto tabular-nums">R$ 11.230,00</p>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-superficieSecundaria border border-borda/70">
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 rounded-lg bg-[#EC7000] text-white flex items-center justify-center font-bold text-xs">
                          IT
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-texto">Itaú Personnalité</p>
                          <p className="text-xs text-textoSecundario">Corrente • Movimentação Principal</p>
                        </div>
                      </div>
                      <p className="text-sm font-bold text-texto tabular-nums">R$ 5.920,20</p>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-superficieSecundaria border border-borda/70">
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 rounded-lg bg-[#FF7A00] text-white flex items-center justify-center font-bold text-xs">
                          IN
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-texto">Banco Inter</p>
                          <p className="text-xs text-textoSecundario">Investimentos • CDB 100% CDI</p>
                        </div>
                      </div>
                      <p className="text-sm font-bold text-texto tabular-nums">R$ 1.300,00</p>
                    </div>
                  </div>
                </div>

                {/* Mockup: Meta em Andamento */}
                <div className="bg-superficie p-5 rounded-xl border border-borda shadow-suave flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-sm font-bold text-texto">Meta em Foco</h2>
                      <span className="text-xs font-semibold text-verdeEquilibrio bg-verdeEquilibrio/10 px-2 py-0.5 rounded">
                        75%
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-texto">Reserva de Emergência</p>
                    <p className="text-xs text-textoSecundario mt-0.5">Alvo: R$ 20.000,00</p>

                    <div className="w-full bg-nevoa rounded-full h-2.5 mt-4 overflow-hidden border border-borda">
                      <div className="bg-verdeEquilibrio h-2.5 rounded-full w-[75%]" />
                    </div>

                    <p className="text-xs text-textoSecundario mt-3">
                      Saldo acumulado: <strong className="text-texto tabular-nums">R$ 15.000,00</strong>
                    </p>
                  </div>

                  <div className="pt-4 border-t border-borda mt-4">
                    <p className="text-[11px] text-textoMudo">
                      Previsão de conclusão: <span className="font-semibold text-texto">Dezembro / 2026</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Seção Marquee / Instituições Bancárias & Bandeiras */}
      <section id="banks" className="py-14 bg-superficie border-y border-borda">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-textoSecundario mb-8">
            Homologado para mais de 150 instituições financeiras e principais bandeiras do Brasil
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {banks.map((bank) => (
              <div
                key={bank.ispb}
                className="flex items-center space-x-3 p-3.5 rounded-xl bg-superficieSecundaria border border-borda/70 hover:border-bordaHover transition-all shadow-suave"
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs text-white shadow-sm flex-shrink-0"
                  style={{ backgroundColor: bank.color }}
                >
                  {bank.code}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-texto truncate">{bank.name}</p>
                  <p className="text-[10px] text-textoMudo">ISPB {bank.ispb.substring(0, 5)}...</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 pt-6 border-t border-borda/60 flex flex-wrap items-center justify-center gap-6 text-xs text-textoSecundario">
            <span className="font-semibold text-texto">Bandeiras suportadas:</span>
            {cardBrands.map((brand) => (
              <span key={brand} className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-md bg-nevoa font-medium text-texto">
                <Check className="w-3.5 h-3.5 text-verdeEquilibrio" />
                <span>{brand}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Funcionalidades Principais */}
      <section id="features" className="py-20 md:py-28 bg-nevoa">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-verdeEquilibrio">
              Funcionalidades Completas
            </h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-texto mt-2 tracking-tight">
              Tudo o que você precisa para uma visão financeira sem ruído
            </p>
            <p className="mt-4 text-base sm:text-lg text-textoSecundario">
              Construído de ponta a ponta seguindo as diretrizes oficiais de clareza, previsibilidade e estabilidade.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((item, idx) => {
              const Icon = item.icon;
              return (
                <div
                  key={idx}
                  className="bg-superficie p-8 rounded-2xl border border-borda shadow-suave hover:shadow-card transition-all flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between mb-5">
                      <div className="w-12 h-12 rounded-xl bg-azulFluxo/5 group-hover:bg-azulFluxo group-hover:text-mentaClara text-azulFluxo flex items-center justify-center transition-colors">
                        <Icon className="w-6 h-6" />
                      </div>
                      <span className="text-[11px] font-semibold tracking-wide uppercase px-2.5 py-1 rounded bg-superficieSecundaria text-textoSecundario border border-borda">
                        {item.tag}
                      </span>
                    </div>

                    <h3 className="text-xl font-bold text-texto group-hover:text-azulFluxo transition-colors">
                      {item.title}
                    </h3>
                    <p className="text-xs font-semibold text-verdeEquilibrio mt-1">
                      {item.subtitle}
                    </p>
                    <p className="mt-3 text-sm text-textoSecundario leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  <div className="pt-6 border-t border-borda/60 mt-6 flex items-center text-xs font-semibold text-azulFluxo group-hover:text-verdeEquilibrio transition-colors">
                    <span>Saber mais</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1.5 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. Caixa vs Competência: Diferencial Educativo */}
      <section id="regimes" className="py-20 md:py-28 bg-superficie border-t border-borda">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-verdeEquilibrio">
                Transparência Contábil & Clareza
              </span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-texto mt-2 tracking-tight">
                Regime de Caixa vs Competência: Acabe com a ilusão financeira
              </h2>
              <p className="mt-4 text-base text-textoSecundario leading-relaxed">
                Você já teve a sensação de que tinha dinheiro na conta, mas a fatura do cartão consumiu tudo no mês seguinte?
                Ou comprou parcelado e perdeu a noção do teto de gastos?
              </p>
              <p className="mt-3 text-base text-textoSecundario leading-relaxed">
                O MoneyFlow resolve esse dilema separando a visão de liquidez diária do compromisso assumido:
              </p>

              <div className="mt-8 space-y-4">
                <div
                  onClick={() => setSelectedRegime('caixa')}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    selectedRegime === 'caixa'
                      ? 'border-azulFluxo bg-azulFluxo/5 shadow-suave'
                      : 'border-borda bg-superficieSecundaria hover:border-bordaHover'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-sm text-texto flex items-center">
                      <Wallet className="w-4 h-4 mr-2 text-azulFluxo" />
                      Regime de Caixa (Disponibilidade Real)
                    </h3>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-azulFluxo/10 text-azulFluxo">
                      {selectedRegime === 'caixa' ? 'Selecionado' : 'Clique para ver'}
                    </span>
                  </div>
                  <p className="text-xs text-textoSecundario mt-2">
                    Mostra a saída ou entrada no momento exato em que o dinheiro sai ou cai no seu saldo bancário.
                    Essencial para garantir que você não fique no cheque especial.
                  </p>
                </div>

                <div
                  onClick={() => setSelectedRegime('competencia')}
                  className={`p-4 rounded-xl border transition-all cursor-pointer ${
                    selectedRegime === 'competencia'
                      ? 'border-verdeEquilibrio bg-verdeEquilibrio/5 shadow-suave'
                      : 'border-borda bg-superficieSecundaria hover:border-bordaHover'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-sm text-texto flex items-center">
                      <Calendar className="w-4 h-4 mr-2 text-verdeEquilibrio" />
                      Regime de Competência (Fato Gerador)
                    </h3>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-verdeEquilibrio/10 text-verdeEquilibrio">
                      {selectedRegime === 'competencia' ? 'Selecionado' : 'Clique para ver'}
                    </span>
                  </div>
                  <p className="text-xs text-textoSecundario mt-2">
                    Registra as compras no dia em que foram efetuadas, permitindo saber exatamente quanto custou o seu mês,
                    mesmo que a fatura só vença no próximo mês.
                  </p>
                </div>
              </div>
            </div>

            {/* Simulação Visual do Sankey / Gráfico de Fluxo */}
            <div className="bg-azulFluxo text-white p-8 rounded-2xl shadow-modal border border-white/10 relative overflow-hidden">
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <div>
                  <p className="text-xs text-mentaClara font-semibold uppercase">Visão Demonstrativa</p>
                  <p className="text-lg font-bold text-white">
                    {selectedRegime === 'caixa' ? 'Fluxo no Regime de Caixa' : 'Fluxo no Regime de Competência'}
                  </p>
                </div>
                <span className="text-xs bg-white/10 px-3 py-1 rounded-full font-mono text-mentaClara">
                  {selectedRegime === 'caixa' ? 'Data Pagto.' : 'Data Compra'}
                </span>
              </div>

              <div className="py-6 space-y-4 font-mono text-xs">
                <div className="p-3 bg-white/5 rounded-lg border border-white/10 flex justify-between items-center">
                  <span className="text-white/80">Salário & Rendimentos</span>
                  <span className="text-mentaClara font-bold tabular-nums">+ R$ 8.500,00</span>
                </div>

                <div className="flex justify-center text-mentaClara/50 text-xs">
                  ↓ fluxo distribuído para contas e cartões
                </div>

                {selectedRegime === 'caixa' ? (
                  <div className="space-y-2">
                    <div className="p-3 bg-white/5 rounded-lg border border-white/10 flex justify-between items-center">
                      <span className="text-white/80">Pagamento de Fatura Nubank</span>
                      <span className="text-erro font-bold tabular-nums">- R$ 2.450,00</span>
                    </div>
                    <div className="p-3 bg-white/5 rounded-lg border border-white/10 flex justify-between items-center">
                      <span className="text-white/80">Aluguel & Contas Fixas (Débito)</span>
                      <span className="text-erro font-bold tabular-nums">- R$ 2.800,00</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="p-3 bg-white/5 rounded-lg border border-white/10 flex justify-between items-center">
                      <span className="text-white/80">Compras de Mercado (Cartão)</span>
                      <span className="text-erro font-bold tabular-nums">- R$ 1.620,00</span>
                    </div>
                    <div className="p-3 bg-white/5 rounded-lg border border-white/10 flex justify-between items-center">
                      <span className="text-white/80">Assinaturas & Lazer (Cartão)</span>
                      <span className="text-erro font-bold tabular-nums">- R$ 830,00</span>
                    </div>
                    <div className="p-3 bg-white/5 rounded-lg border border-white/10 flex justify-between items-center">
                      <span className="text-white/80">Aluguel & Contas Fixas</span>
                      <span className="text-erro font-bold tabular-nums">- R$ 2.800,00</span>
                    </div>
                  </div>
                )}

                <div className="p-4 bg-verdeEquilibrio/20 rounded-lg border border-verdeEquilibrio/40 flex justify-between items-center text-sm font-bold">
                  <span className="text-white">Resultado do Mês</span>
                  <span className="text-mentaClara tabular-nums">
                    {selectedRegime === 'caixa' ? '+ R$ 3.250,00 (Caixa Líquido)' : '+ R$ 3.250,00 (Economia Real)'}
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-white/60 text-center italic">
                * No MoneyFlow, você nunca é pego de surpresa. O motor Sankey mapeia nós e links sem duplicações.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Segurança e LGPD */}
      <section id="security" className="py-20 md:py-28 bg-nevoa">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-superficie rounded-3xl p-8 md:p-14 border border-borda shadow-card">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
              <div>
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-verdeEquilibrio/10 text-verdeEquilibrio text-xs font-semibold uppercase mb-4">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Privacidade sem Concessões</span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-texto tracking-tight">
                  Seus dados financeiros pertencem exclusivamente a você.
                </h2>
                <p className="mt-4 text-base text-textoSecundario leading-relaxed">
                  Não vendemos informações para birôs de crédito, não emitimos anúncios direcionados e não aplicamos algoritmos que manipulam suas decisões.
                </p>

                <div className="mt-8 space-y-4">
                  <div className="flex items-start space-x-3.5">
                    <div className="w-6 h-6 rounded-full bg-verdeEquilibrio/10 text-verdeEquilibrio flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-texto">Direito à Portabilidade Completa</h3>
                      <p className="text-xs text-textoSecundario mt-0.5">
                        Exporte todo o seu histórico em formato estruturado (JSON canônico padronizado) a qualquer momento.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3.5">
                    <div className="w-6 h-6 rounded-full bg-verdeEquilibrio/10 text-verdeEquilibrio flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-texto">Direito ao Esquecimento (Eliminação Total)</h3>
                      <p className="text-xs text-textoSecundario mt-0.5">
                        Exclua seu espaço ou todos os dados com um único comando auditável, sem retenções ocultas.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3.5">
                    <div className="w-6 h-6 rounded-full bg-verdeEquilibrio/10 text-verdeEquilibrio flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-texto">Backups Criptografados AES-256-GCM</h3>
                      <p className="text-xs text-textoSecundario mt-0.5">
                        Seus dados são protegidos por criptografia de padrão militar com chaves derivadas por Scrypt.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-superficieSecundaria p-8 rounded-2xl border border-borda text-center">
                <div className="w-16 h-16 rounded-2xl bg-azulFluxo text-mentaClara mx-auto flex items-center justify-center mb-6 shadow-sm">
                  <Lock className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-texto">Auditoria Criptográfica</h3>
                <p className="text-xs text-textoSecundario mt-2 max-w-sm mx-auto">
                  Cada movimentação registra logs imutáveis com checksum sha256 e assinatura de integridade no banco de dados.
                </p>

                <div className="mt-8 pt-6 border-t border-borda/80 flex items-center justify-center space-x-6 text-xs text-textoSecundario font-medium">
                  <span className="flex items-center">
                    <Check className="w-4 h-4 text-verdeEquilibrio mr-1" />
                    ISO 27001 Ready
                  </span>
                  <span className="flex items-center">
                    <Check className="w-4 h-4 text-verdeEquilibrio mr-1" />
                    LGPD Art. 18
                  </span>
                  <span className="flex items-center">
                    <Check className="w-4 h-4 text-verdeEquilibrio mr-1" />
                    Zero Rastreadores
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Perguntas Frequentes (FAQ) */}
      <section id="faq" className="py-20 md:py-28 bg-superficie border-t border-borda">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-verdeEquilibrio">
              Tire Suas Dúvidas
            </h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-texto mt-2 tracking-tight">
              Perguntas Frequentes
            </p>
            <p className="mt-3 text-base text-textoSecundario">
              Respostas transparentes sobre o funcionamento, filosofia e segurança do MoneyFlow.
            </p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, index) => {
              const isOpen = activeFaq === index;
              return (
                <div
                  key={index}
                  className="rounded-xl border border-borda bg-superficie shadow-suave overflow-hidden transition-all"
                >
                  <button
                    onClick={() => toggleFaq(index)}
                    className="w-full px-6 py-4 text-left flex items-center justify-between text-base font-bold text-texto hover:text-azulFluxo transition-colors"
                  >
                    <span>{faq.question}</span>
                    <ChevronDown
                      className={`w-5 h-5 text-textoSecundario transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-verdeEquilibrio' : ''
                      }`}
                    />
                  </button>

                  {isOpen && (
                    <div className="px-6 pb-5 pt-1 text-sm text-textoSecundario leading-relaxed border-t border-borda/60 bg-superficieSecundaria/40">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 8. Call to Action Final */}
      <section className="py-20 bg-azulFluxo text-white relative overflow-hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            Pronto para transformar sua relação com o dinheiro?
          </h2>
          <p className="mt-5 text-base sm:text-lg text-white/80 max-w-2xl mx-auto leading-relaxed">
            Abra o MoneyFlow agora mesmo e tenha clareza absoluta sobre suas receitas, contas e metas em menos de 2 minutos.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/"
              className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 rounded-xl text-base font-semibold bg-verdeEquilibrio text-white hover:bg-verdeEquilibrioDark transition-all shadow-card hover:shadow-modal"
            >
              Começar Agora no Painel
              <ArrowRight className="w-5 h-5 ml-2.5" />
            </Link>
          </div>

          <p className="text-xs text-mentaClara/70 mt-6">
            Nenhum cartão de crédito necessário • 100% de controle sobre seus dados
          </p>
        </div>
      </section>

      {/* 9. Rodapé Institucional */}
      <footer className="bg-azulFluxo/95 border-t border-white/10 text-white/70 py-12 text-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center space-x-3">
            <img src={logo} alt="MoneyFlow Logo" className="h-8 object-contain" />
            <div>
              <span className="font-bold text-white text-base leading-tight block">MoneyFlow</span>
              <span className="text-xs text-mentaClara font-normal">Seu dinheiro, em fluxo claro</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-white/70">
            <Link to="/" className="hover:text-mentaClara transition-colors">
              Painel Financeiro
            </Link>
            <a href="#features" className="hover:text-mentaClara transition-colors">
              Funcionalidades
            </a>
            <a href="#banks" className="hover:text-mentaClara transition-colors">
              Catálogo de Bancos
            </a>
            <a href="#security" className="hover:text-mentaClara transition-colors">
              Privacidade & LGPD
            </a>
            <a href="#faq" className="hover:text-mentaClara transition-colors">
              Dúvidas
            </a>
          </div>

          <div className="text-xs text-white/50 text-center md:text-right">
            <p>© {new Date().getFullYear()} MoneyFlow. Todos os direitos reservados.</p>
            <p className="text-[11px] text-white/40 mt-0.5">Precisão em centavos • Multi-tenant por Espaço</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
