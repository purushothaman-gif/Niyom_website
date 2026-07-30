import { useState } from 'react';
import { ArrowLeft, TrendingUp, Target, Shield, Users, Award, Zap, Menu, X, LogIn } from 'lucide-react';
import { Logo } from '../components/Logo';
import { HeroBackground } from '../components/HeroBackground';
import { Reveal } from '../components/Reveal';
import { ThemeToggle } from '../theme/ThemeToggle';
import { LoginMenu, LOGIN_PORTALS } from '../components/LoginMenu';

interface ServicesProps {
  onBack: () => void;
  onGetStarted: () => void;
  /** Tab to open on mount (e.g. from a Landing service card). Defaults to 'investment'. */
  initialTab?: string;
}

type ServiceTab = 'investment' | 'financial' | 'risk' | 'wealth' | 'tax' | 'alternative';

const SERVICE_TABS: ServiceTab[] = ['investment', 'financial', 'risk', 'wealth', 'tax', 'alternative'];

/** Short tab labels — full titles are too long for a mobile pill row. */
const TAB_LABELS: Record<ServiceTab, string> = {
  investment: 'Investments',
  financial: 'Information',
  risk: 'Insurance',
  wealth: 'Documentation',
  tax: 'Tax',
  alternative: 'Alternatives',
};

export function Services({ onBack, onGetStarted, initialTab }: ServicesProps) {
  const [activeTab, setActiveTab] = useState<ServiceTab>(
    SERVICE_TABS.includes(initialTab as ServiceTab) ? (initialTab as ServiceTab) : 'investment'
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const services = [
    {
      id: 'investment' as ServiceTab,
      icon: TrendingUp,
      title: 'Investment Products Distribution',
      subtitle: 'Access to Quality Investment Products',
      description: 'We facilitate distribution of a wide range of investment products to help you build your portfolio. All investment decisions remain yours.',
      whatItIs: [
        'Distribution of mutual funds, stocks, bonds, and other investment products',
        'Access to diversified investment options across asset classes',
        'Platform to execute your investment decisions',
        'Transaction support and documentation assistance',
        'Access to alternative investment products'
      ],
      howWeHelp: [
        'Provide access to a curated list of investment products and opportunities',
        'Share research reports and market information for your evaluation',
        'Facilitate smooth execution of your investment transactions',
        'Offer general information on tax implications of different products',
        'Support with ongoing transaction and documentation needs'
      ]
    },
    {
      id: 'financial' as ServiceTab,
      icon: Target,
      title: 'Financial Information Services',
      subtitle: 'Educational Resources for Informed Decisions',
      description: 'We provide educational resources and general financial information to help you understand investment concepts and make your own informed decisions.',
      whatItIs: [
        'Educational content on investment concepts and market dynamics',
        'General information on goal-based investing approaches',
        'Cash flow and budgeting calculators for your use',
        'Information on debt management strategies',
        'Resources on emergency fund planning and liquidity'
      ],
      howWeHelp: [
        'Provide educational materials on financial planning principles',
        'Share general information templates and frameworks',
        'Offer calculators and tools for your self-assessment',
        'Connect you with relevant financial information resources',
        'Facilitate access to professional advisors when needed'
      ]
    },
    {
      id: 'risk' as ServiceTab,
      icon: Shield,
      title: 'Insurance Products Distribution',
      subtitle: 'Access to Protection Solutions',
      description: 'We distribute insurance products from leading providers to help you protect your assets and family. All decisions on coverage remain yours.',
      whatItIs: [
        'Distribution of life insurance products',
        'Health insurance policy options',
        'Critical illness and disability insurance products',
        'Property and casualty insurance distribution',
        'Access to various insurance providers'
      ],
      howWeHelp: [
        'Provide information on different insurance product options',
        'Facilitate distribution of insurance products from authorized providers',
        'Assist with policy documentation and application process',
        'Support with claims documentation and procedures',
        'Share general information on insurance planning'
      ]
    },
    {
      id: 'wealth' as ServiceTab,
      icon: Users,
      title: 'Documentation Assistance',
      subtitle: 'Support for Transfer Documentation',
      description: 'We provide assistance with documentation and paperwork related to wealth transfer. Legal and tax advice should be obtained from qualified professionals.',
      whatItIs: [
        'General information on estate planning documentation',
        'Referrals to legal professionals for will and trust structuring',
        'Documentation support for succession planning',
        'Information on charitable giving options',
        'Resources on intergenerational wealth transfer'
      ],
      howWeHelp: [
        'Provide general information on estate planning processes',
        'Connect you with qualified legal and tax professionals',
        'Assist with documentation and paperwork procedures',
        'Share educational resources on transfer planning',
        'Support coordination with your professional advisors'
      ]
    },
    {
      id: 'tax' as ServiceTab,
      icon: Award,
      title: 'Tax Information Services',
      subtitle: 'General Tax-Related Information',
      description: 'We provide general information on tax aspects of investments. For personalized tax advice, please consult a qualified Chartered Accountant or tax professional.',
      whatItIs: [
        'General information on tax-efficient investment products',
        'Educational content on income tax implications of investments',
        'Information on capital gains tax for different asset classes',
        'Resources on available deductions and exemptions',
        'General awareness on tax-saving investment options'
      ],
      howWeHelp: [
        'Share general information on tax aspects of investment products',
        'Provide educational resources on tax-efficient investing',
        'Refer you to qualified tax professionals for personalized advice',
        'Offer information on tax-saving investment schemes',
        'Support with tax-related documentation for investments'
      ]
    },
    {
      id: 'alternative' as ServiceTab,
      icon: Zap,
      title: 'Alternative Product Distribution',
      subtitle: 'Access to Alternative Opportunities',
      description: 'We facilitate distribution of alternative investment products. These carry higher risks and require careful evaluation by investors.',
      whatItIs: [
        'Distribution of secondary market bonds',
        'Access to unlisted equity opportunities',
        'Pre-IPO shares of select companies',
        'Information on AIFs (Alternative Investment Funds)',
        'Real estate investment product distribution'
      ],
      howWeHelp: [
        'Provide access to alternative investment product opportunities',
        'Share available research and information on these products',
        'Facilitate transaction execution for eligible investors',
        'Provide documentation support for alternative investments',
        'Share educational content on risks and characteristics of alternative products'
      ]
    }
  ];

  const activeService = services.find(s => s.id === activeTab) || services[0];
  const Icon = activeService.icon;

  return (
    <div className="min-h-screen bg-bg-base">
      <nav className="bg-black text-white py-4 sm:py-5 px-5 sm:px-6 shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 sm:gap-3 min-w-0 hover:opacity-80 transition-opacity"
          >
            <Logo size="sm" className="sm:hidden" />
            <Logo size="md" className="hidden sm:block" />
            <div className="text-left min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold tracking-tight truncate" style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.1em' }}>NIYOM WEALTH</h1>
              <p className="text-accent-soft text-[10px] sm:text-xs tracking-widest">DISTRIBUTION LLP</p>
            </div>
          </button>

          <div className="hidden md:flex items-center gap-4">
            <ThemeToggle variant="icon" />
            <button
              onClick={onBack}
              className="text-white hover:text-accent-soft transition-colors flex items-center gap-2 font-medium"
            >
              <ArrowLeft size={20} />
              Back
            </button>
            {/* Was labelled "Client Login" but wired to onGetStarted, i.e. it
                opened the signup flow. Now a real portal chooser, matching the
                other public headers; signup stays on the "Get Started Today"
                CTA further down the page. */}
            <LoginMenu triggerClassName="px-8 py-3 shadow-md" />
          </div>

          <div className="md:hidden flex items-center gap-1 flex-shrink-0">
            <ThemeToggle variant="icon" />
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="text-white hover:text-accent-soft transition-colors p-1"
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {isMobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
            </button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 bg-black border-t border-accent-soft/20 shadow-lg z-50">
            <div className="flex flex-col p-4 space-y-3">
              <button
                onClick={() => {
                  onBack();
                  setIsMobileMenuOpen(false);
                }}
                className="text-white hover:text-accent-soft font-medium py-3 px-4 text-left hover:bg-bg-elevated/5 rounded transition-colors flex items-center gap-2"
              >
                <ArrowLeft size={20} />
                Back
              </button>
              {/* Both portals laid out directly — a sheet has the room, so no
                  dropdown. Same LOGIN_PORTALS source as the desktop menu. */}
              <div className="border-t border-accent-soft/20 pt-3 space-y-2">
                <div className="flex items-center gap-2 px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-soft/80">
                  <LogIn size={13} />
                  Choose your portal
                </div>
                {LOGIN_PORTALS.map(({ label, hint, icon: Icon, href }) => (
                  <button
                    key={label}
                    onClick={() => {
                      window.open(href, '_blank');
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:border-accent-soft/40 hover:bg-accent-soft/10"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft/10 text-accent-soft ring-1 ring-inset ring-accent-soft/20">
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-white">{label}</span>
                      <span className="block text-[11px] text-white/45">{hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </nav>

      <section className="py-10 sm:py-16 px-5 sm:px-6 bg-gradient-to-b from-bg-raised to-bg-base">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="text-4xl sm:text-5xl font-bold text-text-primary mb-3 sm:mb-4" style={{ fontFamily: 'var(--font-display)' }}>
              Our <span className="text-accent">Services</span>
            </h2>
            <p className="text-base sm:text-xl text-text-secondary max-w-3xl mx-auto">
              Product distribution and information services to support your investment journey
            </p>
          </div>

          {/* Tab strip — a horizontal scroll row of labelled pills on mobile
              (icon-only tabs left visitors guessing), wrapping centred from sm up. */}
          <div className="flex sm:flex-wrap sm:justify-center gap-2.5 sm:gap-3 mb-8 sm:mb-12 overflow-x-auto sm:overflow-visible -mx-5 px-5 sm:mx-0 sm:px-0 pb-1 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {services.map(service => {
              const ServiceIcon = service.icon;
              return (
                <button
                  key={service.id}
                  onClick={() => setActiveTab(service.id)}
                  className={`flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-lg font-semibold text-sm sm:text-base whitespace-nowrap flex-shrink-0 transition-all duration-300 ${
                    activeTab === service.id
                      ? 'bg-accent text-on-accent shadow-lg'
                      : 'bg-bg-elevated text-text-secondary hover:bg-bg-raised border-2 border-border'
                  }`}
                >
                  <ServiceIcon size={18} className="flex-shrink-0" />
                  <span className="sm:hidden">{TAB_LABELS[service.id]}</span>
                  <span className="hidden sm:inline">{service.title}</span>
                </button>
              );
            })}
          </div>

          <Reveal key={activeTab} className="bg-bg-elevated rounded-2xl shadow-2xl overflow-hidden border-t-4 border-accent">
            <div data-theme="dark" className="h-52 sm:h-80 overflow-hidden relative">
              <HeroBackground />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
              <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8 text-white">
                <div className="flex items-center gap-3 sm:gap-4 mb-3">
                  <Icon className="w-9 h-9 sm:w-12 sm:h-12 text-accent-soft flex-shrink-0" />
                  <div className="min-w-0">
                    <h3 className="text-2xl sm:text-4xl font-bold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
                      {activeService.title}
                    </h3>
                    <p className="text-accent-soft text-sm sm:text-lg font-medium">{activeService.subtitle}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 sm:p-8 md:p-12">
              <p className="text-text-secondary text-base sm:text-lg leading-relaxed mb-8 sm:mb-10 bg-bg-base p-5 sm:p-6 rounded-lg border-l-4 border-accent">
                {activeService.description}
              </p>

              <div className="grid md:grid-cols-2 gap-8 md:gap-10">
                <div>
                  <h4 className="text-xl sm:text-2xl font-bold text-text-primary mb-4 sm:mb-6 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
                    <div className="w-2 h-7 sm:h-8 bg-accent"></div>
                    What It Is
                  </h4>
                  <ul className="space-y-3.5 sm:space-y-4">
                    {activeService.whatItIs.map((item, index) => (
                      <li key={index} className="flex gap-3 text-text-secondary leading-relaxed">
                        <span className="text-accent font-bold text-lg mt-1">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-xl sm:text-2xl font-bold text-text-primary mb-4 sm:mb-6 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
                    <div className="w-2 h-7 sm:h-8 bg-accent"></div>
                    How Niyom Wealth Helps
                  </h4>
                  <ul className="space-y-3.5 sm:space-y-4">
                    {activeService.howWeHelp.map((item, index) => (
                      <li key={index} className="flex gap-3 text-text-secondary leading-relaxed">
                        <span className="text-accent font-bold text-lg mt-1">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-10 sm:mt-12 text-center">
                <button
                  onClick={onGetStarted}
                  className="w-full sm:w-auto bg-accent hover:bg-accent-strong text-on-accent font-bold py-4 px-10 rounded-lg transition-all duration-300 shadow-lg hover:shadow-xl text-lg"
                >
                  Get Started Today
                </button>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <div className="px-5 sm:px-6 pb-8">
        <p className="max-w-3xl mx-auto text-center text-xs text-text-muted leading-relaxed">
          We are not SEBI Registered Investment Advisers. Information provided is for educational purposes only and does not constitute investment advice.
        </p>
      </div>

      <footer className="bg-black text-white py-10 sm:py-12 px-5 sm:px-6 border-t border-accent-soft/20">
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Logo size="sm" />
            <div>
              <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.1em' }}>NIYOM WEALTH</h2>
            </div>
          </div>
          <p className="text-text-muted">&copy; 2025 Niyom Wealth Distribution LLP. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
