import { ArrowRight, Shield, Target, Zap, TrendingUp, Users, Award, Instagram, Linkedin, ChevronRight, Phone, Mail, MessageCircle, Menu, X, ChevronDown, MapPin, ShieldCheck, Search, Eye, Handshake } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Logo } from '../components/Logo';
import { RegulatoryInfo } from '../components/RegulatoryInfo';
import { ThemeToggle } from '../theme/ThemeToggle';
import { HeroBackground } from '../components/HeroBackground';
import { HeroShowcase } from '../components/HeroShowcase';
import { Reveal } from '../components/Reveal';

interface LandingProps {
  onGetStarted: () => void;
  onViewServices: () => void;
  onViewLearning: () => void;
  onViewNews: () => void;
  onViewMFResearch: () => void;
  onViewCalculator: () => void;
  onViewUnlisted: () => void;
  onViewBonds: () => void;
  onNavigate: (page: string) => void;
}

export function Landing({ onViewServices, onViewLearning, onViewNews, onViewMFResearch, onViewCalculator, onNavigate }: LandingProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isInvestDropdownOpen, setIsInvestDropdownOpen] = useState(false);
  const [isEmployeeDropdownOpen, setIsEmployeeDropdownOpen] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-bg-base">
      {/* Frosted-glass sticky nav — translucent navy over a blur so content
          scrolls softly beneath it. Falls back to solid navy where backdrop
          blur is unsupported. */}
      <nav
        className={`text-white sticky top-0 z-50 ${isLoaded ? 'animate-fadeIn' : 'opacity-0'}`}
        style={{
          background: 'rgba(7, 21, 36, 0.72)',
          backdropFilter: 'saturate(160%) blur(14px)',
          WebkitBackdropFilter: 'saturate(160%) blur(14px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
        }}
      >
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center px-6 py-5">
            <button
              onClick={() => scrollToSection('home')}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            >
              <Logo size="md" className={isLoaded ? 'animate-scaleIn' : 'opacity-0'} />
              <div className="text-left">
                <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.1em' }}>NIYOM WEALTH</h1>
                <p className="text-accent-soft text-xs tracking-widest">DISTRIBUTION LLP</p>
              </div>
            </button>

            <div className="hidden md:flex items-center gap-3">
              <ThemeToggle variant="icon" />
              <div className="relative">
                <button
                  onMouseEnter={() => setIsEmployeeDropdownOpen(true)}
                  onMouseLeave={() => setIsEmployeeDropdownOpen(false)}
                  className={`bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-md font-semibold transition-all duration-300 shadow-md hover:shadow-lg flex items-center gap-2 ${isLoaded ? 'animate-slideDown animate-delay-200' : 'opacity-0'}`}
                >
                  Employee Login
                  <ChevronDown size={16} className={`transition-transform duration-200 ${isEmployeeDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {isEmployeeDropdownOpen && (
                  <div
                    onMouseEnter={() => setIsEmployeeDropdownOpen(true)}
                    onMouseLeave={() => setIsEmployeeDropdownOpen(false)}
                    className="absolute top-full right-0 mt-0 bg-black border border-accent-soft/20 rounded-md shadow-lg min-w-[160px] z-50"
                  >
                    <button
                      onClick={() => window.open('https://www.zoho.com/people/login.html', '_blank')}
                      className="w-full text-left px-4 py-3 text-white hover:text-accent-soft hover:bg-bg-elevated/5 transition-colors duration-200 first:rounded-t-md"
                    >
                      HRM
                    </button>
                    <button
                      onClick={() => { window.location.href = '/crm'; }}
                      className="w-full text-left px-4 py-3 text-white hover:text-accent-soft hover:bg-bg-elevated/5 transition-colors duration-200"
                    >
                      CRM
                    </button>
                    <button
                      onClick={() => { window.open('/mf-admin', '_blank'); }}
                      className="w-full text-left px-4 py-3 text-white hover:text-accent-soft hover:bg-bg-elevated/5 transition-colors duration-200 last:rounded-b-md"
                    >
                      MF Admin
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => window.open('/client-login', '_blank')}
                className={`lift press bg-accent-soft hover:bg-accent-soft-deep text-black px-8 py-3 rounded-xl font-semibold shadow-md ${isLoaded ? 'animate-slideDown animate-delay-200' : 'opacity-0'}`}
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

          <div className="hidden md:flex items-center justify-center gap-8 px-6 pb-4 border-t border-accent-soft/20">
            <button
              onClick={() => scrollToSection('home')}
              className={`text-white hover:text-accent-soft font-medium transition-colors duration-300 py-3 ${isLoaded ? 'animate-slideDown animate-delay-300' : 'opacity-0'}`}
            >
              Home
            </button>
            <button
              onClick={() => scrollToSection('services')}
              className={`text-white hover:text-accent-soft font-medium transition-colors duration-300 py-3 ${isLoaded ? 'animate-slideDown animate-delay-350' : 'opacity-0'}`}
            >
              Services
            </button>
            <button
              onClick={onViewLearning}
              className={`text-white hover:text-accent-soft font-medium transition-colors duration-300 py-3 ${isLoaded ? 'animate-slideDown animate-delay-400' : 'opacity-0'}`}
            >
              Learning
            </button>
            <button
              onClick={onViewNews}
              className={`text-white hover:text-accent-soft font-medium transition-colors duration-300 py-3 ${isLoaded ? 'animate-slideDown animate-delay-450' : 'opacity-0'}`}
            >
              News
            </button>
            <button
              onClick={onViewMFResearch}
              className={`text-white hover:text-accent-soft font-medium transition-colors duration-300 py-3 ${isLoaded ? 'animate-slideDown animate-delay-500' : 'opacity-0'}`}
            >
              MF Research
            </button>
            <button
              onClick={onViewCalculator}
              className={`text-white hover:text-accent-soft font-medium transition-colors duration-300 py-3 ${isLoaded ? 'animate-slideDown animate-delay-550' : 'opacity-0'}`}
            >
              Calculator
            </button>
            <div className="relative">
              <button
                onMouseEnter={() => setIsInvestDropdownOpen(true)}
                onMouseLeave={() => setIsInvestDropdownOpen(false)}
                className={`text-white hover:text-accent-soft font-medium transition-colors duration-300 py-3 flex items-center gap-1 ${isLoaded ? 'animate-slideDown animate-delay-600' : 'opacity-0'}`}
              >
                Invest Now
                <ChevronDown size={16} className={`transition-transform duration-200 ${isInvestDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {isInvestDropdownOpen && (
                <div
                  onMouseEnter={() => setIsInvestDropdownOpen(true)}
                  onMouseLeave={() => setIsInvestDropdownOpen(false)}
                  className="absolute top-full left-0 mt-0 bg-black border border-accent-soft/20 rounded-md shadow-lg min-w-[200px] z-50"
                >
                  <button
                    onClick={() => onNavigate('mutual-funds')}
                    className="w-full text-left px-4 py-3 text-white hover:text-accent-soft hover:bg-bg-elevated/5 transition-colors duration-200 first:rounded-t-md"
                  >
                    Mutual Funds
                  </button>
                  <button
                    onClick={() => onNavigate('primary-bonds')}
                    className="w-full text-left px-4 py-3 text-white hover:text-accent-soft hover:bg-bg-elevated/5 transition-colors duration-200"
                  >
                    Primary Bonds
                  </button>
                  <button
                    onClick={() => onNavigate('fixed-deposits')}
                    className="w-full text-left px-4 py-3 text-white hover:text-accent-soft hover:bg-bg-elevated/5 transition-colors duration-200"
                  >
                    Fixed Deposits
                  </button>
                  <button
                    onClick={() => onNavigate('insurance')}
                    className="w-full text-left px-4 py-3 text-white hover:text-accent-soft hover:bg-bg-elevated/5 transition-colors duration-200 last:rounded-b-md"
                  >
                    Insurance
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => scrollToSection('contact')}
              className={`text-white hover:text-accent-soft font-medium transition-colors duration-300 py-3 ${isLoaded ? 'animate-slideDown animate-delay-650' : 'opacity-0'}`}
            >
              Contact
            </button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 bg-black border-t border-accent-soft/20 shadow-lg">
            <div className="flex flex-col p-4 space-y-3">
              <button
                onClick={() => {
                  scrollToSection('home');
                  setIsMobileMenuOpen(false);
                }}
                className="text-white hover:text-accent-soft font-medium py-3 px-4 text-left hover:bg-bg-elevated/5 rounded transition-colors"
              >
                Home
              </button>
              <button
                onClick={() => {
                  scrollToSection('services');
                  setIsMobileMenuOpen(false);
                }}
                className="text-white hover:text-accent-soft font-medium py-3 px-4 text-left hover:bg-bg-elevated/5 rounded transition-colors"
              >
                Services
              </button>
              <button
                onClick={() => {
                  onViewLearning();
                  setIsMobileMenuOpen(false);
                }}
                className="text-white hover:text-accent-soft font-medium py-3 px-4 text-left hover:bg-bg-elevated/5 rounded transition-colors"
              >
                Learning
              </button>
              <button
                onClick={() => {
                  onViewNews();
                  setIsMobileMenuOpen(false);
                }}
                className="text-white hover:text-accent-soft font-medium py-3 px-4 text-left hover:bg-bg-elevated/5 rounded transition-colors"
              >
                News
              </button>
              <button
                onClick={() => {
                  onViewMFResearch();
                  setIsMobileMenuOpen(false);
                }}
                className="text-white hover:text-accent-soft font-medium py-3 px-4 text-left hover:bg-bg-elevated/5 rounded transition-colors"
              >
                MF Research
              </button>
              <button
                onClick={() => {
                  onViewCalculator();
                  setIsMobileMenuOpen(false);
                }}
                className="text-white hover:text-accent-soft font-medium py-3 px-4 text-left hover:bg-bg-elevated/5 rounded transition-colors"
              >
                Calculator
              </button>
              <div className="border-t border-accent-soft/20 my-2 pt-2">
                <div className="text-accent-soft text-xs uppercase tracking-wider px-4 py-2 font-semibold">Employee Login</div>
                <button
                  onClick={() => { window.open('https://www.zoho.com/people/login.html', '_blank'); setIsMobileMenuOpen(false); }}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 px-4 rounded mb-2 transition-colors"
                >
                  HRM
                </button>
                <button
                  onClick={() => { window.location.href = '/crm'; }}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 px-4 rounded mb-2 transition-colors"
                >
                  CRM
                </button>
                <button
                  onClick={() => { window.open('/mf-admin', '_blank'); setIsMobileMenuOpen(false); }}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 px-4 rounded mb-3 transition-colors"
                >
                  MF Admin
                </button>
                <button
                  onClick={() => {
                    window.open('/client-login', '_blank');
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full bg-accent-soft hover:bg-accent-soft-deep text-black font-semibold py-3 px-4 rounded mb-3 transition-colors"
                >
                  Client Login
                </button>
              </div>
              <div className="border-t border-accent-soft/20 my-2 pt-2">
                <div className="text-accent-soft text-xs uppercase tracking-wider px-4 py-2 font-semibold">Invest Now</div>
                <button
                  onClick={() => {
                    onNavigate('mutual-funds');
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full text-white hover:text-accent-soft font-medium py-3 px-6 text-left hover:bg-bg-elevated/5 rounded transition-colors"
                >
                  Mutual Funds
                </button>
                <button
                  onClick={() => {
                    onNavigate('primary-bonds');
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full text-white hover:text-accent-soft font-medium py-3 px-6 text-left hover:bg-bg-elevated/5 rounded transition-colors"
                >
                  Primary Bonds
                </button>
                <button
                  onClick={() => {
                    onNavigate('fixed-deposits');
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full text-white hover:text-accent-soft font-medium py-3 px-6 text-left hover:bg-bg-elevated/5 rounded transition-colors"
                >
                  Fixed Deposits
                </button>
                <button
                  onClick={() => {
                    onNavigate('insurance');
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full text-white hover:text-accent-soft font-medium py-3 px-6 text-left hover:bg-bg-elevated/5 rounded transition-colors"
                >
                  Insurance
                </button>
              </div>
              <button
                onClick={() => {
                  scrollToSection('contact');
                  setIsMobileMenuOpen(false);
                }}
                className="text-white hover:text-accent-soft font-medium py-3 px-4 text-left hover:bg-bg-elevated/5 rounded transition-colors"
              >
                Contact
              </button>
              <button
                onClick={() => {
                  window.open('/client-login', '_blank');
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

      {/* Inherently dark: the animated network backdrop renders in navy + gold,
          so it pins the dark token set regardless of the active theme —
          otherwise the light theme's dark-on-light gold would render muted. */}
      <section id="home" data-theme="dark" className="relative text-white overflow-hidden min-h-[92vh] flex items-start px-6 pt-24 md:pt-28 pb-16">
        {/* Original animated fintech backdrop — replaces the old stock photo. */}
        <HeroBackground />
        <div className="relative w-full max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 lg:gap-8 items-center">

          {/* Left — message */}
          <div className="text-center lg:text-left">
            {/* Headline — gold emphasis on "Build Wealth" and "Confidence" */}
            <h1 className={`text-5xl md:text-6xl xl:text-7xl font-bold leading-[1.04] tracking-tight mb-6 ${isLoaded ? 'animate-fadeInUp animate-delay-100' : 'opacity-0'}`} style={{ fontFamily: 'var(--font-display)' }}>
              <span className="text-accent-soft">Build Wealth</span><br />
              <span className="text-white">with </span><span className="text-accent-soft">Confidence</span>
            </h1>

            {/* Sub-heading */}
            <p className={`text-lg md:text-xl text-gray-300 leading-relaxed mb-9 max-w-xl mx-auto lg:mx-0 ${isLoaded ? 'animate-fadeInUp animate-delay-200' : 'opacity-0'}`}>
              Premium investment solutions in Mutual Funds, Bonds, Fixed Deposits, Insurance &amp; Unlisted Shares—powered by research, transparency and personalized guidance.
            </p>

            {/* CTAs */}
            <div className={`flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-4 ${isLoaded ? 'animate-fadeInUp animate-delay-300' : 'opacity-0'}`}>
              <button
                onClick={() => window.open('/client-login', '_blank')}
                className="cta-glow press bg-accent-soft hover:bg-accent-soft-deep text-black font-bold py-4 px-9 rounded-xl flex items-center gap-2.5 text-lg w-full sm:w-auto justify-center"
              >
                Start Investing <ArrowRight size={20} />
              </button>
              <button
                onClick={() => scrollToSection('services')}
                className="group press font-semibold py-4 px-7 rounded-xl text-lg transition-colors w-full sm:w-auto"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)' }}
              >
                <span className="relative inline-block">
                  Explore Investment Solutions
                  <span className="absolute left-0 -bottom-0.5 h-px w-full origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" style={{ background: 'var(--accent-soft)' }} />
                </span>
              </button>
            </div>

            {/* Trust strip */}
            <div className={`mt-11 flex flex-wrap justify-center lg:justify-start gap-x-6 gap-y-3 ${isLoaded ? 'animate-fadeInUp animate-delay-500' : 'opacity-0'}`}>
              {[
                { icon: Search, label: 'Research Driven' },
                { icon: Eye, label: 'Transparent Process' },
                { icon: ShieldCheck, label: 'Secure Investments' },
                { icon: Target, label: 'Goal-Based Planning' },
                { icon: Handshake, label: 'Trusted Guidance' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <Icon size={16} className="text-accent-soft flex-shrink-0" />
                  <span className="text-sm text-gray-300 whitespace-nowrap">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right — premium wealth visual */}
          <div className="hidden md:block">
            <HeroShowcase />
          </div>
        </div>
      </section>

      <section id="services" className="py-20 px-6 bg-gradient-to-b from-bg-base to-bg-raised">
        <div className="max-w-7xl mx-auto">
          <h3 className={`text-4xl font-bold text-center text-text-primary mb-4 ${isLoaded ? 'animate-fadeInUp' : 'opacity-0'}`} style={{ fontFamily: 'var(--font-display)' }}>
            Our Services
          </h3>
          <div className={`w-24 h-1 bg-accent-soft mx-auto mb-16 ${isLoaded ? 'animate-scaleIn animate-delay-200' : 'opacity-0'}`}></div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: TrendingUp, title: 'Investment Products Distribution', desc: 'Access to mutual funds, stocks, and other investment products' },
              { icon: Target, title: 'Financial Information', desc: 'Educational resources and market information to help you decide' },
              { icon: Shield, title: 'Insurance Products', desc: 'Distribution of insurance solutions for asset protection' },
              { icon: Users, title: 'Documentation Assistance', desc: 'Support with paperwork for estate planning and transfers' },
              { icon: Award, title: 'Tax Information', desc: 'General information on tax-efficient investment structures' },
              { icon: Zap, title: 'Alternative Products', desc: 'Distribution of secondary bonds, unlisted shares, and pre-IPO opportunities' },
            ].map((service, i) => (
              <Reveal key={i} delay={(i % 3) * 90}>
                <div className="lift group bg-bg-elevated rounded-xl overflow-hidden border border-border-subtle h-full flex flex-col" style={{ boxShadow: 'var(--shadow-card)' }}>
                  {/* Branded gradient panel + icon — original artwork in place of
                      the old stock thumbnail. */}
                  <div
                    className="relative h-40 overflow-hidden flex items-center justify-center"
                    style={{ background: 'linear-gradient(150deg, #081B33 0%, #10284D 55%, #16345C 100%)' }}
                  >
                    <div className="absolute inset-0 hb-grid opacity-70" />
                    <div
                      className="absolute -right-6 -top-6 w-28 h-28 rounded-full"
                      style={{ background: 'radial-gradient(circle, rgba(200,164,93,0.28), transparent 70%)', filter: 'blur(8px)' }}
                    />
                    <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
                      style={{ background: 'rgba(200,164,93,0.12)', border: '1px solid rgba(200,164,93,0.35)' }}>
                      <service.icon className="w-8 h-8 text-accent-soft" />
                    </div>
                  </div>
                  <div className="p-6 flex flex-col flex-1">
                    <h4 className="text-xl font-bold text-text-primary mb-3" style={{ fontFamily: 'var(--font-display)' }}>{service.title}</h4>
                    <p className="text-text-secondary leading-relaxed mb-4 flex-1">{service.desc}</p>
                    <button
                      onClick={onViewServices}
                      className="w-full bg-text-primary text-bg-elevated hover:bg-accent hover:text-on-accent font-semibold py-3 px-4 rounded-lg transition-all duration-300 flex items-center justify-center gap-2 group"
                    >
                      View Details <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Inherently dark (animated backdrop) — pin the dark token set. */}
      <section data-theme="dark" className="relative py-20 px-6 text-white overflow-hidden">
        <HeroBackground />
        <div className="relative max-w-7xl mx-auto">
          <h3 className={`text-4xl font-bold text-center mb-4 ${isLoaded ? 'animate-fadeInUp' : 'opacity-0'}`} style={{ fontFamily: 'var(--font-display)' }}>
            Why Choose <span className="text-accent-soft">Niyom Wealth</span>?
          </h3>
          <div className={`w-24 h-1 bg-accent-soft mx-auto mb-16 ${isLoaded ? 'animate-scaleIn animate-delay-200' : 'opacity-0'}`}></div>
          <div className="grid md:grid-cols-2 gap-8">
            {[
              { title: 'Transparency', desc: 'Open and honest communication in all our interactions' },
              { title: 'Innovation', desc: 'Leveraging technology and new ideas to enhance services' },
              { title: 'Trust', desc: 'Building lasting relationships on mutual respect and integrity' },
              { title: 'Client-Centric', desc: 'Your financial goals are at the heart of everything we do' },
            ].map((value, i) => (
              <div key={i} className={`bg-white/5 backdrop-blur-sm p-8 rounded-xl border-l-4 border-accent-soft hover:bg-white/10 transition-all duration-300 ${isLoaded ? `animate-slideInLeft animate-delay-${(i + 2) * 100}` : 'opacity-0'}`}>
                <h4 className="text-2xl font-bold text-accent-soft mb-3" style={{ fontFamily: 'var(--font-display)' }}>{value.title}</h4>
                <p className="text-gray-300 leading-relaxed text-lg">{value.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gold-fill CTA with black text — pin the dark (bright) gold so the fill
          stays legible; the light theme's darker gold would kill the contrast. */}
      <section data-theme="dark" className="bg-gradient-to-br from-accent-soft to-accent-soft-deep text-black py-20 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h3 className={`text-4xl font-bold mb-6 ${isLoaded ? 'animate-fadeInUp' : 'opacity-0'}`} style={{ fontFamily: 'var(--font-display)' }}>
            Ready to Take Control of Your Financial Future?
          </h3>
          <p className={`text-lg mb-10 text-black/80 leading-relaxed max-w-2xl mx-auto ${isLoaded ? 'animate-fadeInUp animate-delay-200' : 'opacity-0'}`}>
            Schedule a complimentary consultation to explore investment products and opportunities.
          </p>
          <button
            onClick={() => window.open('/client-login', '_blank')}
            className={`lift press bg-black hover:bg-gray-900 text-white font-bold py-4 px-10 rounded-xl shadow-lg text-lg ${isLoaded ? 'animate-fadeInUp animate-delay-400' : 'opacity-0'}`}
          >
            Create Your Account
          </button>
        </div>
      </section>

      <section id="contact" className="py-20 px-6 bg-bg-base">
        <div className="max-w-4xl mx-auto">
          <h3 className="text-4xl font-bold text-center text-text-primary mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            Get in Touch
          </h3>
          <div className="w-24 h-1 bg-accent-soft mx-auto mb-16"></div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className={`bg-gradient-to-br from-black to-gray-900 rounded-xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300 group ${isLoaded ? 'animate-fadeInUp animate-delay-100' : 'opacity-0'}`}>
              <div className="flex items-center gap-4 mb-4">
                <div className="bg-accent-soft p-4 rounded-full group-hover:scale-110 transition-transform duration-300">
                  <Phone className="w-8 h-8 text-black" />
                </div>
                <h4 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
                  Phone
                </h4>
              </div>
              <a
                href="tel:+918939433113"
                className="text-accent-soft hover:text-white text-xl font-medium transition-colors duration-300 block"
              >
                +91 8939433113
              </a>
            </div>

            <div className={`bg-gradient-to-br from-black to-gray-900 rounded-xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300 group ${isLoaded ? 'animate-fadeInUp animate-delay-300' : 'opacity-0'}`}>
              <div className="flex items-center gap-4 mb-4">
                <div className="bg-accent-soft p-4 rounded-full group-hover:scale-110 transition-transform duration-300">
                  <Mail className="w-8 h-8 text-black" />
                </div>
                <h4 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
                  Email
                </h4>
              </div>
              <a
                href="mailto:support@niyomwealth.com"
                className="text-accent-soft hover:text-white text-xl font-medium transition-colors duration-300 block break-words"
              >
                support@niyomwealth.com
              </a>
            </div>

            <div className={`bg-gradient-to-br from-black to-gray-900 rounded-xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300 group ${isLoaded ? 'animate-fadeInUp animate-delay-500' : 'opacity-0'}`}>
              <div className="flex items-center gap-4 mb-4">
                <div className="bg-accent-soft p-4 rounded-full group-hover:scale-110 transition-transform duration-300">
                  <MessageCircle className="w-8 h-8 text-black" />
                </div>
                <h4 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
                  WhatsApp
                </h4>
              </div>
              <a
                href="https://wa.me/918939433113?text=Hello,%20I%20wish%20to%20get%20in%20touch%20with%20you"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-soft hover:text-white text-xl font-medium transition-colors duration-300 block"
              >
                +91 8939433113
              </a>
            </div>
          </div>

          <div className={`lift mt-8 bg-gradient-to-br from-black to-gray-900 rounded-xl p-8 shadow-xl ${isLoaded ? 'animate-fadeInUp animate-delay-500' : 'opacity-0'}`}>
            <div className="flex items-start gap-4">
              <div className="bg-accent-soft p-4 rounded-full shrink-0">
                <MapPin className="w-8 h-8 text-black" />
              </div>
              <div>
                <h4 className="text-2xl font-bold text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                  Our Office
                </h4>
                <a
                  href="https://www.google.com/maps/search/?api=1&query=No+126+Poonamallee+High+Road+Maduravoyal+Chennai+600095"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-soft hover:text-white text-lg leading-relaxed transition-colors duration-300 block"
                >
                  No 126, 1st Floor, Poonamallee High Rd, Varalakshmi Nagar,<br />
                  Sentamil Nagar, Maduravoyal, Chennai,<br />
                  Greater Chennai, Tamil Nadu 600095
                </a>
              </div>
            </div>
          </div>

          <div className="mt-12 text-center">
            <p className="text-text-secondary text-lg leading-relaxed max-w-2xl mx-auto">
              We're here to answer your questions and help you achieve your financial goals. Reach out to us via phone, email, or WhatsApp, and our team will get back to you promptly.
            </p>
          </div>
        </div>
      </section>

      <footer className="bg-black text-white py-12 px-6 border-t border-accent-soft/20">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div className="flex flex-col items-center md:items-start gap-3">
              <Logo size="sm" />
              <div>
                <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.1em' }}>NIYOM WEALTH</h2>
                <p className="text-text-muted text-sm mt-1">Distribution LLP</p>
              </div>
            </div>

            <div className="text-center md:text-left">
              <h3 className="text-lg font-semibold text-accent-soft mb-4">Legal</h3>
              <div className="flex flex-col space-y-2">
                <button
                  onClick={() => onNavigate('privacy')}
                  className="text-text-muted hover:text-accent-soft transition-colors text-left"
                >
                  Privacy Policy
                </button>
                <button
                  onClick={() => onNavigate('terms')}
                  className="text-text-muted hover:text-accent-soft transition-colors text-left"
                >
                  Terms of Use
                </button>
                <button
                  onClick={() => onNavigate('risk')}
                  className="text-text-muted hover:text-accent-soft transition-colors text-left"
                >
                  Risk Disclosure
                </button>
                <button
                  onClick={() => onNavigate('disclaimer')}
                  className="text-text-muted hover:text-accent-soft transition-colors text-left"
                >
                  Disclaimer
                </button>
              </div>
            </div>

            <div className="text-center md:text-left">
              <h3 className="text-lg font-semibold text-accent-soft mb-4">Connect With Us</h3>
              <div className="flex flex-col space-y-3">
                <a
                  href="https://www.linkedin.com/company/niyom-wealth/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-text-muted hover:text-accent-soft transition-colors justify-center md:justify-start group"
                >
                  <Linkedin size={20} className="group-hover:scale-110 transition-transform duration-300" />
                  <span>LinkedIn</span>
                </a>
                <a
                  href="https://www.instagram.com/niyom_wealth?igsh=MXRvaXB2ejJ0Z2h1cA=="
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-text-muted hover:text-accent-soft transition-colors justify-center md:justify-start group"
                >
                  <Instagram size={20} className="group-hover:scale-110 transition-transform duration-300" />
                  <span>Instagram</span>
                </a>
              </div>
            </div>
          </div>

          <RegulatoryInfo />

          <div className="text-center text-text-muted pt-8 border-t border-gray-800">
            <p className="text-sm">&copy; 2025 Niyom Wealth Distribution LLP. All rights reserved.</p>
            <p className="text-xs mt-3 text-yellow-400 font-semibold">
              SEBI Disclaimer: We are not SEBI Registered Investment Advisers.
            </p>
            <p className="text-xs mt-2 text-text-muted">
              Investments in securities market are subject to market risks. Read all scheme related documents carefully before investing. We do not provide personalized investment advice. All information provided is for educational and informational purposes only. Please consult a qualified financial advisor before making investment decisions.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
