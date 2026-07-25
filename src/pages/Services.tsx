import { useState } from 'react';
import { ArrowLeft, TrendingUp, Target, Shield, Users, Award, Zap, Menu, X } from 'lucide-react';
import { Logo } from '../components/Logo';
import { HeroBackground } from '../components/HeroBackground';
import { Reveal } from '../components/Reveal';

interface ServicesProps {
  onBack: () => void;
  onGetStarted: () => void;
  /** Tab to open on mount (e.g. from a Landing service card). Defaults to 'investment'. */
  initialTab?: string;
}

type ServiceTab = 'investment' | 'financial' | 'risk' | 'wealth' | 'tax' | 'alternative';

const SERVICE_TABS: ServiceTab[] = ['investment', 'financial', 'risk', 'wealth', 'tax', 'alternative'];

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
      <nav className="bg-black text-white py-5 px-6 shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <button
            onClick={onBack}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <Logo size="md" />
            <div className="text-left">
              <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.1em' }}>NIYOM WEALTH</h1>
              <p className="text-accent-soft text-xs tracking-widest">DISTRIBUTION LLP</p>
            </div>
          </button>

          <div className="hidden md:flex items-center gap-4">
            <button
              onClick={onBack}
              className="text-white hover:text-accent-soft transition-colors flex items-center gap-2 font-medium"
            >
              <ArrowLeft size={20} />
              Back
            </button>
            <button
              onClick={onGetStarted}
              className="bg-accent-soft hover:bg-accent-soft-deep text-black px-8 py-3 rounded-md font-semibold transition-all duration-300 shadow-md hover:shadow-lg"
            >
              Client Login
            </button>
          </div>

          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden text-white hover:text-accent-soft transition-colors"
          >
            {isMobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
          </button>
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
              <button
                onClick={() => {
                  onGetStarted();
                  setIsMobileMenuOpen(false);
                }}
                className="bg-accent-soft hover:bg-accent-soft-deep text-black px-4 py-3 rounded-md font-semibold transition-all duration-300"
              >
                Client Login
              </button>
            </div>
          </div>
        )}
      </nav>

      <section className="py-16 px-6 bg-gradient-to-b from-bg-raised to-bg-base">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-5xl font-bold text-text-primary mb-4" style={{ fontFamily: 'var(--font-display)' }}>
              Our <span className="text-accent">Services</span>
            </h2>
            <p className="text-xl text-text-secondary max-w-3xl mx-auto">
              Product distribution and information services to support your investment journey
            </p>
            <div className="mt-4 bg-warning/10 border border-warning/40 rounded-lg p-3 max-w-2xl mx-auto">
              <p className="text-sm text-text-primary font-semibold">
                We are not SEBI Registered Investment Advisers. Information provided is for educational purposes only and does not constitute investment advice.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3 mb-12">
            {services.map(service => {
              const ServiceIcon = service.icon;
              return (
                <button
                  key={service.id}
                  onClick={() => setActiveTab(service.id)}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all duration-300 ${
                    activeTab === service.id
                      ? 'bg-accent text-on-accent shadow-lg'
                      : 'bg-bg-elevated text-text-secondary hover:bg-bg-raised border-2 border-border'
                  }`}
                >
                  <ServiceIcon size={20} />
                  <span className="hidden sm:inline">{service.title}</span>
                </button>
              );
            })}
          </div>

          <Reveal key={activeTab} className="bg-bg-elevated rounded-2xl shadow-2xl overflow-hidden border-t-4 border-accent">
            <div data-theme="dark" className="h-80 overflow-hidden relative">
              <HeroBackground />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
              <div className="absolute bottom-0 left-0 right-0 p-8 text-white">
                <div className="flex items-center gap-4 mb-3">
                  <Icon className="w-12 h-12 text-accent-soft" />
                  <div>
                    <h3 className="text-4xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                      {activeService.title}
                    </h3>
                    <p className="text-accent-soft text-lg font-medium">{activeService.subtitle}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-8 md:p-12">
              <p className="text-text-secondary text-lg leading-relaxed mb-10 bg-bg-base p-6 rounded-lg border-l-4 border-accent">
                {activeService.description}
              </p>

              <div className="grid md:grid-cols-2 gap-10">
                <div>
                  <h4 className="text-2xl font-bold text-text-primary mb-6 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
                    <div className="w-2 h-8 bg-accent"></div>
                    What It Is
                  </h4>
                  <ul className="space-y-4">
                    {activeService.whatItIs.map((item, index) => (
                      <li key={index} className="flex gap-3 text-text-secondary leading-relaxed">
                        <span className="text-accent font-bold text-lg mt-1">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-2xl font-bold text-text-primary mb-6 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
                    <div className="w-2 h-8 bg-accent"></div>
                    How Niyom Wealth Helps
                  </h4>
                  <ul className="space-y-4">
                    {activeService.howWeHelp.map((item, index) => (
                      <li key={index} className="flex gap-3 text-text-secondary leading-relaxed">
                        <span className="text-accent font-bold text-lg mt-1">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-12 text-center">
                <button
                  onClick={onGetStarted}
                  className="bg-accent hover:bg-accent-strong text-on-accent font-bold py-4 px-10 rounded-lg transition-all duration-300 shadow-lg hover:shadow-xl text-lg"
                >
                  Get Started Today
                </button>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="bg-black text-white py-12 px-6 border-t border-accent-soft/20">
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
