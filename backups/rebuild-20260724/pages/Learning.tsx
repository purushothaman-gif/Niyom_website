import { ArrowLeft, TrendingUp, PiggyBank, Shield, FileText, Building, Sparkles, ChevronDown, ChevronUp, Menu, X, RefreshCw, ExternalLink } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Logo } from '../components/Logo';
import { supabase } from '../lib/supabase';

interface CommodityPrice {
  price_date: string;
  price: number;
  commodity: string;
}

function useCommodityPrices() {
  const [goldPrices, setGoldPrices] = useState<CommodityPrice[]>([]);
  const [silverPrices, setSilverPrices] = useState<CommodityPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchPrices = async () => {
    setLoading(true);
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const monthStart = `${year}-${month}-01`;
    const monthEnd = `${year}-${month}-31`;

    const { data } = await supabase
      .from('commodity_prices')
      .select('price_date, price, commodity')
      .gte('price_date', monthStart)
      .lte('price_date', monthEnd)
      .order('price_date', { ascending: true });

    if (data) {
      setGoldPrices(data.filter(r => r.commodity === 'gold'));
      setSilverPrices(data.filter(r => r.commodity === 'silver'));
      setLastUpdated(new Date().toLocaleTimeString('en-IN'));
    }
    setLoading(false);
  };

  useEffect(() => { fetchPrices(); }, []);

  return { goldPrices, silverPrices, loading, lastUpdated, refetch: fetchPrices };
}

interface LearningProps {
  onBack: () => void;
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function LearningSection({ title, icon, children }: SectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-bg-elevated rounded-xl shadow-lg overflow-hidden border border-border hover:shadow-xl transition-all duration-300">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-8 py-6 flex items-center justify-between bg-gradient-to-r from-black to-gray-900 text-white hover:from-gray-900 hover:to-black transition-all duration-300"
      >
        <div className="flex items-center gap-4">
          <div className="bg-accent-soft p-3 rounded-full">
            {icon}
          </div>
          <h3 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {title}
          </h3>
        </div>
        {isOpen ? <ChevronUp size={28} /> : <ChevronDown size={28} />}
      </button>
      {isOpen && (
        <div className="px-8 py-6 bg-bg-base">
          {children}
        </div>
      )}
    </div>
  );
}

function formatPrice(price: number, commodity: string) {
  return '₹' + price.toLocaleString('en-IN') + (commodity === 'gold' ? ' /10g' : ' /kg');
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function getMonthName() {
  return new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function PriceTable({ prices, commodity }: { prices: CommodityPrice[]; commodity: 'gold' | 'silver' }) {
  if (prices.length === 0) {
    return <p className="text-text-muted text-sm italic">No price data available for this month.</p>;
  }

  const latest = prices[prices.length - 1];
  const first = prices[0];
  const change = latest.price - first.price;
  const changePct = ((change / first.price) * 100).toFixed(2);
  const isPositive = change >= 0;

  return (
    <div>
      {/* Latest price banner */}
      <div className={`mb-4 p-4 rounded-lg border-l-4 ${commodity === 'gold' ? 'bg-gradient-to-r from-yellow-50 to-yellow-100 border-yellow-500' : 'bg-gradient-to-r from-gray-100 to-gray-200 border-gray-500'}`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className={`font-bold text-xl ${commodity === 'gold' ? 'text-yellow-900' : 'text-text-primary'}`}>
              Latest MCX Price: {formatPrice(latest.price, commodity)}
            </p>
            <p className={`text-sm mt-0.5 ${commodity === 'gold' ? 'text-yellow-700' : 'text-text-secondary'}`}>
              As of {formatDate(latest.price_date)}, 2026 (MCX {commodity === 'gold' ? 'Gold Futures – 24K' : 'Silver Futures – 999 Purity'})
            </p>
          </div>
          <span className={`text-sm font-semibold px-3 py-1 rounded-full ${isPositive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {isPositive ? '+' : ''}{changePct}% MTD
          </span>
        </div>
      </div>

      {/* Daily price table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className={`${commodity === 'gold' ? 'bg-yellow-50' : 'bg-bg-raised'}`}>
              <th className="text-left px-4 py-2 font-semibold text-text-secondary">Date</th>
              <th className="text-right px-4 py-2 font-semibold text-text-secondary">MCX Price</th>
              <th className="text-right px-4 py-2 font-semibold text-text-secondary">Change</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((row, i) => {
              const prev = prices[i - 1];
              const dayChange = prev ? row.price - prev.price : 0;
              const dayPct = prev ? ((dayChange / prev.price) * 100).toFixed(2) : null;
              return (
                <tr key={row.price_date} className={`border-t border-border-subtle ${i % 2 === 0 ? 'bg-bg-elevated' : 'bg-bg-base'} hover:bg-opacity-80 transition-colors`}>
                  <td className="px-4 py-2 text-text-secondary font-medium">{formatDate(row.price_date)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-text-primary">{formatPrice(row.price, commodity)}</td>
                  <td className={`px-4 py-2 text-right text-xs font-medium ${dayChange > 0 ? 'text-green-600' : dayChange < 0 ? 'text-red-600' : 'text-text-muted'}`}>
                    {dayPct !== null ? `${dayChange > 0 ? '+' : ''}${dayPct}%` : '–'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CommoditiesSection() {
  const { goldPrices, silverPrices, loading, lastUpdated, refetch } = useCommodityPrices();

  return (
    <div className="space-y-6">
      {/* Header with refresh + MCX link */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h4 className="text-xl font-bold text-text-primary">Daily MCX Prices — {getMonthName()}</h4>
          {lastUpdated && <p className="text-xs text-text-muted mt-0.5">Last fetched: {lastUpdated}</p>}
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://www.mcxindia.com/market-data/spot-market-prices"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-900 underline underline-offset-2"
          >
            <ExternalLink size={14} /> MCX India
          </a>
          <button
            onClick={refetch}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm bg-bg-raised hover:bg-bg-raised text-text-secondary px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={24} className="animate-spin text-accent mr-3" />
          <span className="text-text-secondary">Fetching MCX prices…</span>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Gold */}
          <div className="bg-bg-elevated p-6 rounded-lg shadow-md">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
              <h5 className="font-bold text-lg text-accent">Gold (per 10g)</h5>
            </div>
            <PriceTable prices={goldPrices} commodity="gold" />
          </div>
          {/* Silver */}
          <div className="bg-bg-elevated p-6 rounded-lg shadow-md">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full bg-gray-500"></div>
              <h5 className="font-bold text-lg text-accent">Silver (per kg)</h5>
            </div>
            <PriceTable prices={silverPrices} commodity="silver" />
          </div>
        </div>
      )}

      {/* Historical summary */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-bg-elevated p-6 rounded-lg shadow-md">
          <h5 className="font-bold text-lg text-accent mb-3">Gold — Historical Ranges</h5>
          <ul className="space-y-1.5 text-text-secondary text-sm">
            <li><strong>2019:</strong> ₹31,000 – ₹38,000 per 10g</li>
            <li><strong>2020:</strong> ₹40,000 – ₹56,200 per 10g</li>
            <li><strong>2021:</strong> ₹44,000 – ₹50,000 per 10g</li>
            <li><strong>2022:</strong> ₹47,000 – ₹55,000 per 10g</li>
            <li><strong>2023:</strong> ₹55,000 – ₹65,000 per 10g</li>
            <li><strong>2024:</strong> ₹63,000 – ₹79,000 per 10g</li>
            <li><strong>2025:</strong> ₹78,000 – ₹1,32,000 per 10g</li>
            <li><strong>2026 (Jan–May):</strong> ₹1,28,000 – ₹1,78,500 per 10g</li>
          </ul>
        </div>
        <div className="bg-bg-elevated p-6 rounded-lg shadow-md">
          <h5 className="font-bold text-lg text-accent mb-3">Silver — Historical Ranges</h5>
          <ul className="space-y-1.5 text-text-secondary text-sm">
            <li><strong>2019:</strong> ₹34,000 – ₹49,000 per kg</li>
            <li><strong>2020:</strong> ₹35,000 – ₹77,000 per kg</li>
            <li><strong>2021:</strong> ₹56,000 – ₹77,000 per kg</li>
            <li><strong>2022:</strong> ₹55,000 – ₹74,000 per kg</li>
            <li><strong>2023:</strong> ₹62,000 – ₹80,000 per kg</li>
            <li><strong>2024:</strong> ₹72,000 – ₹1,00,000 per kg</li>
            <li><strong>2025:</strong> ₹87,000 – ₹1,10,000 per kg</li>
            <li><strong>2026 (Jan–May):</strong> ₹2,00,000 – ₹3,39,000 per kg</li>
          </ul>
        </div>
      </div>

      {/* Key factors */}
      <div>
        <h4 className="text-xl font-bold text-text-primary mb-3">Key Factors Driving Price Changes</h4>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-bg-elevated p-5 rounded-lg shadow-md">
            <h5 className="font-bold text-accent mb-2">Inflation & Currency Weakness</h5>
            <p className="text-text-secondary">Rising inflation and weakening rupee increased demand for gold and silver as safe-haven assets.</p>
          </div>
          <div className="bg-bg-elevated p-5 rounded-lg shadow-md">
            <h5 className="font-bold text-accent mb-2">Global Economic Uncertainty</h5>
            <p className="text-text-secondary">COVID-19 pandemic, geopolitical tensions, and economic slowdowns drove investors to precious metals.</p>
          </div>
          <div className="bg-bg-elevated p-5 rounded-lg shadow-md">
            <h5 className="font-bold text-accent mb-2">Central Bank Policies</h5>
            <p className="text-text-secondary">Low interest rates and quantitative easing increased precious metal attractiveness over bonds.</p>
          </div>
          <div className="bg-bg-elevated p-5 rounded-lg shadow-md">
            <h5 className="font-bold text-accent mb-2">Industrial Demand</h5>
            <p className="text-text-secondary">Growing use in electronics, solar panels, and technology sectors boosted silver demand.</p>
          </div>
        </div>
      </div>

      <p className="text-xs text-text-muted italic">
        Prices are MCX futures-based and updated daily. For live quotes visit{' '}
        <a href="https://www.mcxindia.com" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">mcxindia.com</a>.
      </p>
    </div>
  );
}

export function Learning({ onBack }: LearningProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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

          <button
            onClick={onBack}
            className="hidden md:flex bg-accent-soft hover:bg-accent-soft-deep text-black px-8 py-3 rounded-md font-semibold transition-all duration-300 shadow-md hover:shadow-lg items-center gap-2"
          >
            <ArrowLeft size={20} /> Back to Home
          </button>

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
                className="flex items-center gap-2 bg-accent-soft hover:bg-accent-soft-deep text-black px-4 py-3 rounded-md font-semibold transition-all duration-300"
              >
                <ArrowLeft size={20} /> Back to Home
              </button>
            </div>
          </div>
        )}
      </nav>

      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-5xl font-bold text-text-primary mb-4" style={{ fontFamily: 'var(--font-display)' }}>
              Financial <span className="text-accent">Education Center</span>
            </h2>
            <div className="w-32 h-1 bg-accent mx-auto mb-6"></div>
            <p className="text-xl text-text-secondary max-w-3xl mx-auto leading-relaxed">
              Educational resources about investment concepts and financial products. Learn to make your own informed financial decisions.
            </p>
            <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4 max-w-2xl mx-auto">
              <p className="text-sm text-yellow-900 font-semibold">
                Disclaimer: All content is for educational purposes only and does not constitute investment advice. We are not SEBI Registered Investment Advisers. Please consult a qualified financial advisor for personalized guidance.
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <LearningSection
              title="Commodities: Gold & Silver"
              icon={<Sparkles className="w-6 h-6 text-black" />}
            >
              <CommoditiesSection />
            </LearningSection>

            <LearningSection
              title="Mutual Funds"
              icon={<TrendingUp className="w-6 h-6 text-black" />}
            >
              <div className="space-y-4">
                <p className="text-text-secondary text-lg leading-relaxed">
                  A mutual fund pools money from many investors to invest in stocks, bonds, or other securities. Professional fund managers handle the investments.
                </p>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-accent">
                    <h5 className="font-bold text-lg text-text-primary mb-2">Equity Funds</h5>
                    <p className="text-text-secondary">Invest primarily in stocks. Higher risk but potential for higher returns. Best for long-term goals (5+ years).</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-accent">
                    <h5 className="font-bold text-lg text-text-primary mb-2">Debt Funds</h5>
                    <p className="text-text-secondary">Invest in bonds and fixed-income securities. Lower risk, stable returns. Suitable for short to medium-term goals.</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-accent">
                    <h5 className="font-bold text-lg text-text-primary mb-2">Hybrid Funds</h5>
                    <p className="text-text-secondary">Mix of equity and debt. Balanced risk-return profile. Good for moderate risk-takers seeking diversification.</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-accent">
                    <h5 className="font-bold text-lg text-text-primary mb-2">Index Funds</h5>
                    <p className="text-text-secondary">Track a market index like Nifty 50 or Sensex. Low cost, passive investment matching market performance.</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-accent">
                    <h5 className="font-bold text-lg text-text-primary mb-2">ELSS (Tax Saving)</h5>
                    <p className="text-text-secondary">Equity-linked savings schemes with tax benefits under Section 80C. 3-year lock-in period.</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-accent">
                    <h5 className="font-bold text-lg text-text-primary mb-2">Liquid Funds</h5>
                    <p className="text-text-secondary">Invest in very short-term instruments. Highest liquidity with minimal risk. Alternative to savings accounts.</p>
                  </div>
                </div>
              </div>
            </LearningSection>

            <LearningSection
              title="Fixed Deposits"
              icon={<PiggyBank className="w-6 h-6 text-black" />}
            >
              <div className="space-y-4">
                <p className="text-text-secondary text-lg leading-relaxed">
                  Fixed Deposits (FDs) are time deposits where you invest a lump sum for a fixed period at a predetermined interest rate. They offer guaranteed returns and capital protection.
                </p>

                <div className="bg-bg-elevated p-6 rounded-lg shadow-md">
                  <h5 className="font-bold text-lg text-text-primary mb-3">Key Features</h5>
                  <ul className="space-y-2 text-text-secondary">
                    <li><strong>Interest Rates:</strong> Typically 5-7% per annum for bank FDs, 7-9% for corporate FDs</li>
                    <li><strong>Tenure:</strong> 7 days to 10 years (flexible options)</li>
                    <li><strong>Safety:</strong> Bank FDs insured up to ₹5 lakh by DICGC</li>
                    <li><strong>Premature Withdrawal:</strong> Allowed with penalty (usually 0.5-1% reduction in interest)</li>
                    <li><strong>Loan Facility:</strong> Can avail loans up to 90% of FD value</li>
                    <li><strong>Tax:</strong> Interest income taxable as per your income tax slab</li>
                  </ul>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-green-50 to-green-100 p-5 rounded-lg shadow-md">
                    <h5 className="font-bold text-green-800 mb-2">Advantages</h5>
                    <ul className="text-text-secondary space-y-1 text-sm">
                      <li>• Guaranteed returns</li>
                      <li>• Low risk investment</li>
                      <li>• Flexible tenure options</li>
                      <li>• Regular income through interest</li>
                    </ul>
                  </div>
                  <div className="bg-gradient-to-br from-red-50 to-red-100 p-5 rounded-lg shadow-md">
                    <h5 className="font-bold text-red-800 mb-2">Limitations</h5>
                    <ul className="text-text-secondary space-y-1 text-sm">
                      <li>• Returns may not beat inflation</li>
                      <li>• Tax on interest income</li>
                      <li>• Penalty on premature withdrawal</li>
                      <li>• Lower liquidity compared to mutual funds</li>
                    </ul>
                  </div>
                </div>
              </div>
            </LearningSection>

            <LearningSection
              title="Insurance"
              icon={<Shield className="w-6 h-6 text-black" />}
            >
              <div className="space-y-4">
                <p className="text-text-secondary text-lg leading-relaxed">
                  Insurance provides financial protection against unforeseen events. It's a risk management tool that secures your family's future and assets.
                </p>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-blue-500">
                    <h5 className="font-bold text-lg text-text-primary mb-2">Term Life Insurance</h5>
                    <p className="text-text-secondary mb-3">Pure protection plan with high coverage at low premiums. No maturity benefit. Best for income protection.</p>
                    <p className="text-sm text-blue-600 font-semibold">Example: ₹1 crore cover for ₹10,000-15,000 annual premium (30-year-old)</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-purple-500">
                    <h5 className="font-bold text-lg text-text-primary mb-2">Endowment Plans</h5>
                    <p className="text-text-secondary mb-3">Combination of insurance and savings. Returns premium with bonus at maturity. Lower coverage, higher premiums.</p>
                    <p className="text-sm text-purple-600 font-semibold">Returns: 5-6% typically, with guaranteed benefits</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-green-500">
                    <h5 className="font-bold text-lg text-text-primary mb-2">ULIPs</h5>
                    <p className="text-text-secondary mb-3">Unit Linked Insurance Plans combine insurance with market-linked investments. Flexible and transparent.</p>
                    <p className="text-sm text-green-600 font-semibold">Lock-in: 5 years, potential for market-linked returns</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-red-500">
                    <h5 className="font-bold text-lg text-text-primary mb-2">Health Insurance</h5>
                    <p className="text-text-secondary mb-3">Covers medical expenses, hospitalization, and treatments. Essential for managing healthcare costs.</p>
                    <p className="text-sm text-red-600 font-semibold">Coverage: ₹5-25 lakh typically recommended per family</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-yellow-600">
                    <h5 className="font-bold text-lg text-text-primary mb-2">Critical Illness Insurance</h5>
                    <p className="text-text-secondary mb-3">Lump sum payout on diagnosis of specified critical illnesses like cancer, heart attack, stroke.</p>
                    <p className="text-sm text-yellow-700 font-semibold">Covers 30-40 critical illnesses typically</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-indigo-500">
                    <h5 className="font-bold text-lg text-text-primary mb-2">Motor & Property Insurance</h5>
                    <p className="text-text-secondary mb-3">Protects vehicles and property from damage, theft, or loss. Mandatory for vehicles in India.</p>
                    <p className="text-sm text-indigo-600 font-semibold">Third-party mandatory, comprehensive recommended</p>
                  </div>
                </div>
              </div>
            </LearningSection>

            <LearningSection
              title="Secondary Bonds"
              icon={<FileText className="w-6 h-6 text-black" />}
            >
              <div className="space-y-4">
                <p className="text-text-secondary text-lg leading-relaxed">
                  Secondary bonds are debt securities traded in the secondary market after their initial issuance. They offer fixed income with varying risk-return profiles.
                </p>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md">
                    <h5 className="font-bold text-lg text-accent mb-2">Government Securities (G-Secs)</h5>
                    <p className="text-text-secondary mb-2">Issued by Government of India. Virtually zero default risk. Returns: 6.5-7.5% typically.</p>
                    <p className="text-sm text-text-secondary"><strong>Best for:</strong> Conservative investors seeking safety</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md">
                    <h5 className="font-bold text-lg text-accent mb-2">Corporate Bonds (AAA-Rated)</h5>
                    <p className="text-text-secondary mb-2">Issued by top-rated companies. Low risk with better returns than G-Secs. Returns: 7.5-9%.</p>
                    <p className="text-sm text-text-secondary"><strong>Examples:</strong> HDFC, Reliance, TCS bonds</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md">
                    <h5 className="font-bold text-lg text-accent mb-2">Tax-Free Bonds</h5>
                    <p className="text-text-secondary mb-2">Issued by government entities. Interest income exempt from tax. Returns: 5-6% (tax-free).</p>
                    <p className="text-sm text-text-secondary"><strong>Issuers:</strong> NHAI, IRFC, PFC, REC</p>
                  </div>

                  <div className="bg-bg-elevated p-6 rounded-lg shadow-md">
                    <h5 className="font-bold text-lg text-accent mb-2">High-Yield Bonds</h5>
                    <p className="text-text-secondary mb-2">Lower-rated bonds (BB and below) offering higher returns. Higher risk. Returns: 10-14%.</p>
                    <p className="text-sm text-text-secondary"><strong>Risk:</strong> Higher default probability, suitable for experienced investors</p>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-lg shadow-md">
                  <h5 className="font-bold text-lg text-blue-900 mb-3">Key Benefits of Secondary Bonds</h5>
                  <ul className="space-y-2 text-text-secondary">
                    <li>• <strong>Price Discovery:</strong> Market-driven pricing allows entry/exit at different price points</li>
                    <li>• <strong>Liquidity:</strong> Can sell before maturity in secondary market</li>
                    <li>• <strong>Higher Yields:</strong> Often better returns than fixed deposits</li>
                    <li>• <strong>Capital Appreciation:</strong> Bond prices may rise if interest rates fall</li>
                    <li>• <strong>Diversification:</strong> Different issuers and ratings for portfolio balance</li>
                  </ul>
                </div>
              </div>
            </LearningSection>

            <LearningSection
              title="Unlisted & Pre-IPO Shares"
              icon={<Building className="w-6 h-6 text-black" />}
            >
              <div className="space-y-6">
                <div className="bg-gradient-to-r from-accent-soft to-accent-soft-deep p-6 rounded-lg shadow-lg text-black">
                  <h4 className="text-2xl font-bold mb-3">What Are Unlisted & Pre-IPO Shares?</h4>
                  <p className="text-lg leading-relaxed">
                    <strong>Unlisted Shares:</strong> Equity shares of companies not listed on stock exchanges. Traded privately through dealers or platforms.
                  </p>
                  <p className="text-lg leading-relaxed mt-2">
                    <strong>Pre-IPO Shares:</strong> Shares of companies planning to go public soon, offered to investors before the IPO at a discount to expected listing price.
                  </p>
                </div>

                <div>
                  <h4 className="text-2xl font-bold text-text-primary mb-4">Historical Success Stories (Last 5-10 Years)</h4>

                  <div className="space-y-4">
                    <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-green-500">
                      <h5 className="font-bold text-xl text-text-primary mb-2">Zomato (Food Delivery)</h5>
                      <div className="grid md:grid-cols-2 gap-4 mt-3">
                        <div>
                          <p className="text-text-secondary"><strong>Pre-IPO Price (2021):</strong> ₹60-70 per share</p>
                          <p className="text-text-secondary"><strong>IPO Price (July 2021):</strong> ₹76 per share</p>
                          <p className="text-text-secondary"><strong>Listing Price:</strong> ₹116 per share</p>
                          <p className="text-text-secondary"><strong>Current Range (2024):</strong> ₹160-280 per share</p>
                        </div>
                        <div className="bg-green-50 p-4 rounded">
                          <p className="text-green-800 font-semibold">Pre-IPO to Listing: 66% gain</p>
                          <p className="text-green-800 font-semibold">Pre-IPO to Current: 250-330% gain</p>
                          <p className="text-sm text-text-secondary mt-2">Early investors saw exceptional returns as company established market dominance.</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-green-500">
                      <h5 className="font-bold text-xl text-text-primary mb-2">Paytm (Fintech)</h5>
                      <div className="grid md:grid-cols-2 gap-4 mt-3">
                        <div>
                          <p className="text-text-secondary"><strong>Pre-IPO Price (2021):</strong> ₹1,850-2,000 per share</p>
                          <p className="text-text-secondary"><strong>IPO Price (Nov 2021):</strong> ₹2,150 per share</p>
                          <p className="text-text-secondary"><strong>Listing Price:</strong> ₹1,950 per share</p>
                          <p className="text-text-secondary"><strong>Current Range (2024):</strong> ₹400-900 per share</p>
                        </div>
                        <div className="bg-red-50 p-4 rounded">
                          <p className="text-red-800 font-semibold">Pre-IPO to Listing: -10% loss</p>
                          <p className="text-red-800 font-semibold">Pre-IPO to Current: -55 to -78% loss</p>
                          <p className="text-sm text-text-secondary mt-2">Cautionary tale of overvaluation and market sentiment.</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-green-500">
                      <h5 className="font-bold text-xl text-text-primary mb-2">Nykaa (E-commerce Beauty)</h5>
                      <div className="grid md:grid-cols-2 gap-4 mt-3">
                        <div>
                          <p className="text-text-secondary"><strong>Pre-IPO Price (2021):</strong> ₹800-900 per share</p>
                          <p className="text-text-secondary"><strong>IPO Price (Oct 2021):</strong> ₹1,125 per share</p>
                          <p className="text-text-secondary"><strong>Listing Price:</strong> ₹2,001 per share</p>
                          <p className="text-text-secondary"><strong>Current Range (2024):</strong> ₹160-210 per share</p>
                        </div>
                        <div className="bg-yellow-50 p-4 rounded">
                          <p className="text-yellow-800 font-semibold">Pre-IPO to Listing: 122% gain</p>
                          <p className="text-yellow-800 font-semibold">Pre-IPO to Current: -76 to -82% loss</p>
                          <p className="text-sm text-text-secondary mt-2">Spectacular listing, but long-term performance challenged by market correction.</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-green-500">
                      <h5 className="font-bold text-xl text-text-primary mb-2">PolicyBazaar/PB Fintech</h5>
                      <div className="grid md:grid-cols-2 gap-4 mt-3">
                        <div>
                          <p className="text-text-secondary"><strong>Pre-IPO Price (2021):</strong> ₹750-850 per share</p>
                          <p className="text-text-secondary"><strong>IPO Price (Nov 2021):</strong> ₹980 per share</p>
                          <p className="text-text-secondary"><strong>Listing Price:</strong> ₹1,150 per share</p>
                          <p className="text-text-secondary"><strong>Current Range (2024):</strong> ₹1,300-1,800 per share</p>
                        </div>
                        <div className="bg-green-50 p-4 rounded">
                          <p className="text-green-800 font-semibold">Pre-IPO to Listing: 35-53% gain</p>
                          <p className="text-green-800 font-semibold">Pre-IPO to Current: 53-140% gain</p>
                          <p className="text-sm text-text-secondary mt-2">Solid performer with strong fundamentals and market position.</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-blue-500">
                      <h5 className="font-bold text-xl text-text-primary mb-2">Unlisted Giants (Still Private)</h5>
                      <div className="space-y-3 mt-3">
                        <div className="bg-blue-50 p-4 rounded">
                          <p className="font-bold text-blue-900">BYJU'S</p>
                          <p className="text-text-secondary"><strong>Trading Range (2020-2022):</strong> ₹300-700 per share</p>
                          <p className="text-text-secondary"><strong>Peak Valuation:</strong> ₹1,80,000 crore (2022)</p>
                          <p className="text-text-secondary"><strong>Current Status:</strong> Facing significant challenges, valuation dropped ~90%</p>
                        </div>

                        <div className="bg-blue-50 p-4 rounded">
                          <p className="font-bold text-blue-900">OYO Rooms</p>
                          <p className="text-text-secondary"><strong>Unlisted Price Range (2019-2023):</strong> ₹120-200 per share</p>
                          <p className="text-text-secondary"><strong>Status:</strong> Filed for IPO multiple times, still unlisted</p>
                          <p className="text-text-secondary">Volatile valuations based on funding rounds and business performance</p>
                        </div>

                        <div className="bg-blue-50 p-4 rounded">
                          <p className="font-bold text-blue-900">Flipkart (acquired by Walmart)</p>
                          <p className="text-text-secondary"><strong>Pre-Acquisition Trading:</strong> ₹80-150 per share (2015-2018)</p>
                          <p className="text-text-secondary"><strong>Acquisition (2018):</strong> ₹1,31,000 crore valuation</p>
                          <p className="text-text-secondary">Early unlisted investors made 10-20x returns through acquisition</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-bg-elevated p-6 rounded-lg shadow-md border-l-4 border-accent">
                      <h5 className="font-bold text-xl text-text-primary mb-2">Premium Unlisted Opportunities</h5>
                      <div className="space-y-3 mt-3">
                        <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 rounded">
                          <p className="font-bold text-amber-900">NSE (National Stock Exchange of India)</p>
                          <p className="text-text-secondary"><strong>Type:</strong> Stock Exchange Infrastructure</p>
                          <p className="text-text-secondary"><strong>Unlisted Price Range (Feb 2026):</strong> ₹1,980 - ₹2,120 per share</p>
                          <p className="text-text-secondary"><strong>52-Week Range:</strong> ₹1,650 - ₹2,470 per share</p>
                          <p className="text-text-secondary"><strong>Business:</strong> India's largest stock exchange by market cap, handling billions in daily transactions</p>
                          <p className="text-text-secondary"><strong>Key Highlights:</strong> Monopolistic position, strong revenue from transaction fees, regulatory backing</p>
                          <p className="text-sm text-amber-800 mt-2"><strong>Investment Appeal:</strong> Stable cash flows, essential infrastructure, potential IPO in future</p>
                        </div>

                        <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 rounded">
                          <p className="font-bold text-amber-900">Chennai Super Kings (CSK) - IPL Franchise</p>
                          <p className="text-text-secondary"><strong>Type:</strong> Sports & Entertainment</p>
                          <p className="text-text-secondary"><strong>Unlisted Price Range (Feb 2026):</strong> ₹240 - ₹271 per share</p>
                          <p className="text-text-secondary"><strong>Face Value:</strong> ₹0.10 per share | <strong>Lot Size:</strong> 100 shares</p>
                          <p className="text-text-secondary"><strong>Business:</strong> Premier IPL cricket franchise with massive fan following and brand value</p>
                          <p className="text-text-secondary"><strong>Key Highlights:</strong> 5x IPL champions, strong revenue from broadcasting, sponsorships, merchandise</p>
                          <p className="text-text-secondary"><strong>Financials:</strong> Annual revenue ₹500-600 crores, consistent profitability</p>
                          <p className="text-sm text-amber-800 mt-2"><strong>Investment Appeal:</strong> Growing sports industry, expanding IPL ecosystem, brand loyalty</p>
                        </div>

                        <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 rounded">
                          <p className="font-bold text-amber-900">MSEI (Metropolitan Stock Exchange of India)</p>
                          <p className="text-text-secondary"><strong>Type:</strong> Stock Exchange</p>
                          <p className="text-text-secondary"><strong>Unlisted Price Range (Feb 2026):</strong> ₹5.20 - ₹5.44 per share</p>
                          <p className="text-text-secondary"><strong>52-Week Range:</strong> ₹2.00 - ₹9.00 per share | <strong>Face Value:</strong> ₹1.00</p>
                          <p className="text-text-secondary"><strong>Business:</strong> National-level stock exchange recognized by SEBI, trading platform for equity, derivatives, debt, and currency</p>
                          <p className="text-text-secondary"><strong>Key Highlights:</strong> SEBI recognized, Liquidity Enhancement Scheme launched in Jan 2026, technology-driven operations</p>
                          <p className="text-sm text-amber-800 mt-2"><strong>Investment Appeal:</strong> Smaller player with growth potential, lower entry price, improving operations</p>
                        </div>

                        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded border-2 border-blue-300">
                          <p className="font-bold text-blue-900 text-lg mb-2">Why These Are Unique Opportunities</p>
                          <ul className="text-text-secondary space-y-1 text-sm">
                            <li>• <strong>Infrastructure Assets:</strong> Stock exchanges have regulated monopolies with consistent revenue</li>
                            <li>• <strong>Sports Boom:</strong> IPL franchises benefit from India's cricket obsession and growing sports economy</li>
                            <li>• <strong>Limited Supply:</strong> Very few shares available in secondary market, creating scarcity value</li>
                            <li>• <strong>Institutional Interest:</strong> These attract HNI and institutional investors seeking alternative assets</li>
                            <li>• <strong>Future Listing Potential:</strong> NSE and sports franchises may go public, offering exit opportunities</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-lg shadow-lg">
                    <h4 className="text-xl font-bold text-green-900 mb-4">Advantages</h4>
                    <ul className="space-y-3 text-text-primary">
                      <li className="flex items-start gap-2">
                        <span className="text-green-600 font-bold">•</span>
                        <span><strong>High Growth Potential:</strong> Access to fast-growing companies before public listing</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-600 font-bold">•</span>
                        <span><strong>Listing Gains:</strong> Potential for significant returns on IPO listing day</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-600 font-bold">•</span>
                        <span><strong>Discounted Entry:</strong> Pre-IPO shares typically offered 10-30% below expected IPO price</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-600 font-bold">•</span>
                        <span><strong>Exclusive Access:</strong> Invest in companies not available to general public</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-600 font-bold">•</span>
                        <span><strong>Portfolio Diversification:</strong> Add unique assets different from listed stocks</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-600 font-bold">•</span>
                        <span><strong>Long-term Wealth Creation:</strong> Early-stage investments can multiply several times</span>
                      </li>
                    </ul>
                  </div>

                  <div className="bg-gradient-to-br from-red-50 to-red-100 p-6 rounded-lg shadow-lg">
                    <h4 className="text-xl font-bold text-red-900 mb-4">Risks & Challenges</h4>
                    <ul className="space-y-3 text-text-primary">
                      <li className="flex items-start gap-2">
                        <span className="text-red-600 font-bold">•</span>
                        <span><strong>Low Liquidity:</strong> Difficult to sell until IPO or finding willing buyers</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-red-600 font-bold">•</span>
                        <span><strong>IPO Uncertainty:</strong> No guarantee company will go public or timeline may extend</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-red-600 font-bold">•</span>
                        <span><strong>Valuation Risk:</strong> Overpriced shares may fall post-listing (like Paytm, Nykaa)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-red-600 font-bold">•</span>
                        <span><strong>Limited Information:</strong> Less disclosure compared to listed companies</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-red-600 font-bold">•</span>
                        <span><strong>Lock-in Periods:</strong> May have holding restrictions even after listing</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-red-600 font-bold">•</span>
                        <span><strong>Regulatory Risks:</strong> Unregulated market with potential fraud risks</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-red-600 font-bold">•</span>
                        <span><strong>High Minimum Investment:</strong> Typically requires ₹2-10 lakh minimum</span>
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-black to-gray-900 p-8 rounded-lg shadow-xl text-white">
                  <h4 className="text-2xl font-bold mb-4 text-accent-soft">Investment Recommendation</h4>
                  <div className="space-y-3 text-lg">
                    <p>✓ <strong>Allocation:</strong> Limit to 5-10% of total investment portfolio</p>
                    <p>✓ <strong>Research:</strong> Thoroughly evaluate company fundamentals, growth prospects, and valuation</p>
                    <p>✓ <strong>Diversification:</strong> Don't put all eggs in one basket; spread across multiple opportunities</p>
                    <p>✓ <strong>Timeframe:</strong> Have patience for 2-5 years; not suitable for short-term needs</p>
                    <p>✓ <strong>Professional Advice:</strong> Consult wealth advisors for due diligence and access</p>
                    <p>✓ <strong>Only for HNIs:</strong> Better suited for high-net-worth individuals with risk appetite</p>
                  </div>
                </div>
              </div>
            </LearningSection>
          </div>

          <div className="mt-16 bg-gradient-to-br from-accent-soft to-accent-soft-deep p-10 rounded-xl shadow-2xl text-center">
            <h3 className="text-3xl font-bold text-black mb-4" style={{ fontFamily: 'var(--font-display)' }}>
              Need More Information?
            </h3>
            <p className="text-lg text-black/80 mb-6 max-w-2xl mx-auto">
              Contact us to learn more about available investment products and services. For investment advice, please consult a SEBI registered investment adviser.
            </p>
            <button
              onClick={onBack}
              className="bg-black hover:bg-gray-900 text-white font-bold py-4 px-10 rounded-md transition-all duration-300 shadow-lg hover:shadow-xl text-lg"
            >
              Contact Us
            </button>
          </div>
        </div>
      </section>

      <footer className="bg-black text-white py-8 px-6 border-t border-accent-soft/20">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-text-muted">&copy; 2025 Niyom Wealth Distribution LLP. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
