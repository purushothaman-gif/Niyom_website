import { ArrowRight, Shield, Target, Zap, TrendingUp, Users, Award, Instagram, Linkedin, ChevronRight, Phone, Mail, MessageCircle, Menu, X, ChevronDown, ShieldCheck, Search, Eye, Handshake } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Logo } from '../components/Logo';
import { RegulatoryInfo } from '../components/RegulatoryInfo';
import { ThemeToggle } from '../theme/ThemeToggle';
import { HeroBackground } from '../components/HeroBackground';
import { BrandFilm } from '../components/BrandFilm';
import { Reveal } from '../components/Reveal';

interface LandingProps {
  onGetStarted: () => void;
  onViewServices: (tab?: string) => void;
  onViewLearning: () => void;
  onViewNews: () => void;
  onViewMFResearch: () => void;
  onViewCalculator: () => void;
  onNavigate: (page: string) => void;
}

export function Landing({ onViewServices, onViewLearning, onViewNews, onViewMFResearch, onViewCalculator, onNavigate }: LandingProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
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

            {/* Mobile top-bar controls — the theme toggle must live here (not
                only in the hidden md:flex desktop cluster) or phones lose the
                day/night switch entirely. */}
            <div className="md:hidden flex items-center gap-1">
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
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 px-4 rounded transition-colors"
                >
                  MF Admin
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
      <section id="home" data-theme="dark" className="relative text-white overflow-hidden min-h-[88vh] flex items-center px-5 sm:px-6 pt-12 md:pt-28 pb-16">
        {/* Original animated fintech backdrop — replaces the old stock photo. */}
        <HeroBackground />
        <div className="relative w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-8 items-center">

          {/* Left — message */}
          <div className="text-center lg:text-left">
            {/* Headline — gold emphasis on "Build Wealth" and "Confidence" */}
            <h1 className={`text-[2.5rem] leading-[1.08] sm:text-5xl md:text-6xl xl:text-7xl font-bold md:leading-[1.04] tracking-tight mb-5 sm:mb-6 ${isLoaded ? 'animate-fadeInUp animate-delay-100' : 'opacity-0'}`} style={{ fontFamily: 'var(--font-display)' }}>
              <span className="text-accent-soft">Build Wealth</span><br />
              <span className="text-white">with </span><span className="text-accent-soft">Confidence</span>
            </h1>

            {/* Sub-heading */}
            <p className={`text-base sm:text-lg md:text-xl text-gray-300 leading-relaxed mb-7 sm:mb-9 max-w-xl mx-auto lg:mx-0 ${isLoaded ? 'animate-fadeInUp animate-delay-200' : 'opacity-0'}`}>
              Premium investment solutions in Mutual Funds, Bonds, Fixed Deposits, Insurance &amp; Unlisted Shares—powered by research, transparency and personalized guidance.
            </p>

            {/* CTAs */}
            <div className={`flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-4 ${isLoaded ? 'animate-fadeInUp animate-delay-300' : 'opacity-0'}`}>
              <button
                onClick={() => window.open('/onboarding', '_blank')}
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

            {/* Trust strip — a tidy 2-col grid on phones, inline wrap from sm up. */}
            <div className={`mt-9 sm:mt-11 grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:justify-center lg:justify-start sm:gap-x-6 sm:gap-y-3 ${isLoaded ? 'animate-fadeInUp animate-delay-500' : 'opacity-0'}`}>
              {[
                { icon: Search, label: 'Research Driven' },
                { icon: Eye, label: 'Transparent Process' },
                { icon: ShieldCheck, label: 'Secure Investments' },
                { icon: Target, label: 'Goal-Based Planning' },
                { icon: Handshake, label: 'Trusted Guidance' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-start sm:items-center gap-2 min-w-0">
                  <Icon size={16} className="text-accent-soft flex-shrink-0 mt-0.5 sm:mt-0" />
                  <span className="text-sm text-gray-300 leading-snug sm:whitespace-nowrap">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right — premium wealth visual. Now shown on mobile too (the
              floating chips self-hide below md to avoid horizontal overflow),
              so phones get the branded panel instead of an empty navy void. */}
          <div className="block px-2 sm:px-0 mt-2 md:mt-0">
            <BrandFilm />
          </div>
        </div>
      </section>

      <section id="services" className="py-14 sm:py-20 px-5 sm:px-6 bg-gradient-to-b from-bg-base to-bg-raised">
        <div className="max-w-7xl mx-auto">
          <h3 className={`text-3xl sm:text-4xl font-bold text-center text-text-primary mb-4 ${isLoaded ? 'animate-fadeInUp' : 'opacity-0'}`} style={{ fontFamily: 'var(--font-display)' }}>
            Our Services
          </h3>
          <div className={`w-24 h-1 bg-accent-soft mx-auto mb-10 sm:mb-16 ${isLoaded ? 'animate-scaleIn animate-delay-200' : 'opacity-0'}`}></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {[
              { id: 'investment', icon: TrendingUp, title: 'Investment Products Distribution', desc: 'Access to mutual funds, stocks, and other investment products' },
              { id: 'financial', icon: Target, title: 'Financial Information', desc: 'Educational resources and market information to help you decide' },
              { id: 'risk', icon: Shield, title: 'Insurance Products', desc: 'Distribution of insurance solutions for asset protection' },
              { id: 'wealth', icon: Users, title: 'Documentation Assistance', desc: 'Support with paperwork for estate planning and transfers' },
              { id: 'tax', icon: Award, title: 'Tax Information', desc: 'General information on tax-efficient investment structures' },
              { id: 'alternative', icon: Zap, title: 'Alternative Products', desc: 'Distribution of secondary bonds, unlisted shares, and pre-IPO opportunities' },
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
                      onClick={() => onViewServices(service.id)}
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
      <section data-theme="dark" className="relative py-14 sm:py-20 px-5 sm:px-6 text-white overflow-hidden">
        <HeroBackground />
        <div className="relative max-w-7xl mx-auto">
          <h3 className={`text-3xl sm:text-4xl font-bold text-center mb-4 ${isLoaded ? 'animate-fadeInUp' : 'opacity-0'}`} style={{ fontFamily: 'var(--font-display)' }}>
            Why Choose <span className="text-accent-soft">Niyom Wealth</span>?
          </h3>
          <div className={`w-24 h-1 bg-accent-soft mx-auto mb-10 sm:mb-16 ${isLoaded ? 'animate-scaleIn animate-delay-200' : 'opacity-0'}`}></div>
          <div className="grid sm:grid-cols-2 gap-5 sm:gap-8">
            {[
              { title: 'Transparency', desc: 'Open and honest communication in all our interactions' },
              { title: 'Innovation', desc: 'Leveraging technology and new ideas to enhance services' },
              { title: 'Trust', desc: 'Building lasting relationships on mutual respect and integrity' },
              { title: 'Client-Centric', desc: 'Your financial goals are at the heart of everything we do' },
            ].map((value, i) => (
              <div key={i} className={`bg-white/5 backdrop-blur-sm p-6 sm:p-8 rounded-xl border-l-4 border-accent-soft hover:bg-white/10 transition-all duration-300 ${isLoaded ? `animate-slideInLeft animate-delay-${(i + 2) * 100}` : 'opacity-0'}`}>
                <h4 className="text-xl sm:text-2xl font-bold text-accent-soft mb-2 sm:mb-3" style={{ fontFamily: 'var(--font-display)' }}>{value.title}</h4>
                <p className="text-gray-300 leading-relaxed text-base sm:text-lg">{value.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gold-fill CTA with black text — pin the dark (bright) gold so the fill
          stays legible; the light theme's darker gold would kill the contrast. */}
      <section data-theme="dark" className="bg-gradient-to-br from-accent-soft to-accent-soft-deep text-black py-14 sm:py-20 px-5 sm:px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h3 className={`text-3xl sm:text-4xl font-bold mb-4 sm:mb-6 ${isLoaded ? 'animate-fadeInUp' : 'opacity-0'}`} style={{ fontFamily: 'var(--font-display)' }}>
            Ready to Take Control of Your Financial Future?
          </h3>
          <p className={`text-base sm:text-lg mb-8 sm:mb-10 text-black/80 leading-relaxed max-w-2xl mx-auto ${isLoaded ? 'animate-fadeInUp animate-delay-200' : 'opacity-0'}`}>
            Schedule a complimentary consultation to explore investment products and opportunities.
          </p>
          <button
            onClick={() => window.open('/onboarding', '_blank')}
            className={`lift press bg-black hover:bg-gray-900 text-white font-bold py-4 px-10 rounded-xl shadow-lg text-lg ${isLoaded ? 'animate-fadeInUp animate-delay-400' : 'opacity-0'}`}
          >
            Create Your Account
          </button>
        </div>
      </section>

      <footer id="contact" className="text-text-secondary" style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)' }}>
        <div className="max-w-7xl mx-auto px-5 sm:px-6 py-14 sm:py-16">
          <div className="grid grid-cols-2 lg:grid-cols-12 gap-x-6 gap-y-10 lg:gap-8">
            {/* Brand + address + social */}
            <div className="col-span-2 lg:col-span-5">
              <div className="flex items-center gap-3">
                <Logo size="sm" />
                <div>
                  <h2 className="text-lg font-bold text-text-primary" style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.08em' }}>NIYOM WEALTH</h2>
                  <p className="text-text-muted text-xs tracking-widest">DISTRIBUTION LLP</p>
                </div>
              </div>
              <p className="mt-5 text-sm leading-relaxed max-w-sm" style={{ color: 'var(--text-muted)' }}>
                Your trusted partner for wealth distribution — mutual funds, bonds, unlisted shares, insurance and more.
              </p>
              <div className="flex items-center gap-3 mt-6">
                <a href="https://www.linkedin.com/company/niyom-wealth/" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn"
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-transform duration-300 hover:scale-110"
                  style={{ background: 'rgba(200,164,93,0.12)', border: '1px solid rgba(200,164,93,0.3)' }}>
                  <Linkedin size={18} className="text-accent-soft" />
                </a>
                <a href="https://www.instagram.com/niyom_wealth?igsh=MXRvaXB2ejJ0Z2h1cA==" target="_blank" rel="noopener noreferrer" aria-label="Instagram"
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-transform duration-300 hover:scale-110"
                  style={{ background: 'rgba(200,164,93,0.12)', border: '1px solid rgba(200,164,93,0.3)' }}>
                  <Instagram size={18} className="text-accent-soft" />
                </a>
              </div>
              <div className="mt-7">
                <p className="text-xs font-semibold uppercase tracking-widest text-text-primary mb-2">Registered Office</p>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  No 126, 1st Floor, Poonamallee High Rd, Varalakshmi Nagar,<br />
                  Sentamil Nagar, Maduravoyal, Chennai, Tamil Nadu 600095
                </p>
              </div>
            </div>

            {/* Explore */}
            <div className="lg:col-span-2">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-text-primary mb-4">Explore</h3>
              <ul className="space-y-2.5 text-sm">
                <li><button onClick={() => onViewServices()} className="hover:text-accent-soft transition-colors text-left">Services</button></li>
                <li><button onClick={() => onViewLearning()} className="hover:text-accent-soft transition-colors text-left">Learning</button></li>
                <li><button onClick={() => onViewNews()} className="hover:text-accent-soft transition-colors text-left">News</button></li>
                <li><button onClick={() => onViewMFResearch()} className="hover:text-accent-soft transition-colors text-left">MF Research</button></li>
                <li><button onClick={() => onViewCalculator()} className="hover:text-accent-soft transition-colors text-left">Calculator</button></li>
              </ul>
            </div>

            {/* Legal */}
            <div className="lg:col-span-2">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-text-primary mb-4">Legal</h3>
              <ul className="space-y-2.5 text-sm">
                <li><button onClick={() => onNavigate('privacy')} className="hover:text-accent-soft transition-colors text-left">Privacy Policy</button></li>
                <li><button onClick={() => onNavigate('terms')} className="hover:text-accent-soft transition-colors text-left">Terms of Use</button></li>
                <li><button onClick={() => onNavigate('risk')} className="hover:text-accent-soft transition-colors text-left">Risk Disclosure</button></li>
                <li><button onClick={() => onNavigate('disclaimer')} className="hover:text-accent-soft transition-colors text-left">Disclaimer</button></li>
              </ul>
            </div>

            {/* Reach us */}
            <div className="col-span-2 lg:col-span-3">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-text-primary mb-4">Reach Us</h3>
              <ul className="space-y-3 text-sm">
                <li><a href="tel:+918939433113" className="flex items-center gap-2.5 hover:text-accent-soft transition-colors"><Phone size={16} className="text-accent-soft flex-shrink-0" />+91 8939433113</a></li>
                <li><a href="mailto:support@niyomwealth.com" className="flex items-center gap-2.5 hover:text-accent-soft transition-colors"><Mail size={16} className="text-accent-soft flex-shrink-0" />support@niyomwealth.com</a></li>
                <li><a href="https://wa.me/918939433113?text=Hello,%20I%20wish%20to%20get%20in%20touch%20with%20you" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 hover:text-accent-soft transition-colors"><MessageCircle size={16} className="text-accent-soft flex-shrink-0" />WhatsApp Chat</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-8" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <RegulatoryInfo />
          </div>

          <div className="mt-8 pt-6 text-center" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <p className="text-sm text-text-muted">&copy; 2025 Niyom Wealth Distribution LLP. All rights reserved.</p>
            <p className="text-xs mt-3 font-semibold text-text-secondary">
              SEBI Disclaimer: We are not SEBI Registered Investment Advisers.
            </p>
            <p className="text-xs mt-2 max-w-4xl mx-auto leading-relaxed" style={{ color: 'var(--text-faint)' }}>
              Investments in securities market are subject to market risks. Read all scheme related documents carefully before investing. We do not provide personalized investment advice. All information provided is for educational and informational purposes only. Please consult a qualified financial advisor before making investment decisions.
            </p>
          </div>
        </div>
      </footer>

      {/* Spacer so the fixed mobile action bar never overlaps the last footer
          lines when scrolled to the very bottom. */}
      <div className="h-20 md:hidden" aria-hidden="true" />

      {/* Sticky mobile action bar — a phone-native conversion pattern: the two
          primary actions (start / call) stay reachable with the thumb no matter
          how far the visitor has scrolled. Hidden from md up (desktop has the
          nav CTAs). */}
      <div
        className="md:hidden fixed inset-x-0 bottom-0 z-40 px-4 pt-3 pb-[max(0.85rem,env(safe-area-inset-bottom))]"
        style={{
          background: 'rgba(7, 21, 36, 0.9)',
          backdropFilter: 'saturate(160%) blur(14px)',
          WebkitBackdropFilter: 'saturate(160%) blur(14px)',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div className="flex items-center gap-3">
          <a
            href="tel:+918939433113"
            aria-label="Call Niyom Wealth"
            className="press flex items-center justify-center gap-2 h-12 px-5 rounded-xl font-semibold text-white flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)' }}
          >
            <Phone size={18} className="text-accent-soft" />
            Call
          </a>
          <button
            onClick={() => window.open('/onboarding', '_blank')}
            className="press flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-accent-soft hover:bg-accent-soft-deep text-black font-bold"
          >
            Start Investing <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
