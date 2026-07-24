import { useEffect, useState } from 'react';
import { TrendingUp, Filter, Search, ArrowLeft, RefreshCw, BarChart3, IndianRupee, Menu, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Logo } from '../components/Logo';

interface MutualFund {
  id: string;
  fund_name: string;
  fund_code: string;
  category: string;
  sub_category: string;
  aum: number;
  expense_ratio: number;
  return_1y: number;
  return_3y: number;
  return_5y: number;
  launch_date: string;
  risk_level: string;
  min_investment: number;
  fund_manager: string;
  updated_at: string;
}

interface MFResearchProps {
  onBack: () => void;
}

export default function MFResearch({ onBack }: MFResearchProps) {
  const [funds, setFunds] = useState<MutualFund[]>([]);
  const [filteredFunds, setFilteredFunds] = useState<MutualFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'return_1y' | 'return_3y' | 'return_5y' | 'aum'>('return_1y');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const categories = ['all', 'Equity', 'Debt', 'Hybrid'];

  useEffect(() => {
    fetchFunds();
    refreshFunds();

    const interval = setInterval(() => {
      refreshFunds();
    }, 24 * 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    applyFilters();
  }, [funds, selectedCategory, searchTerm, sortBy]);

  const fetchFunds = async () => {
    try {
      const { data, error } = await supabase
        .from('mutual_funds')
        .select('*')
        .order('return_1y', { ascending: false });

      if (error) throw error;

      setFunds(data || []);
    } catch (error) {
      console.error('Error fetching funds:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshFunds = async () => {
    setRefreshing(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/update-mutual-funds`, {
        method: 'POST',
      });

      if (response.ok) {
        await fetchFunds();
      }
    } catch (error) {
      console.error('Error refreshing funds:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...funds];

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(fund => fund.category === selectedCategory);
    }

    if (searchTerm) {
      filtered = filtered.filter(fund =>
        fund.fund_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        fund.fund_manager.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    filtered.sort((a, b) => {
      const aValue = a[sortBy] || 0;
      const bValue = b[sortBy] || 0;
      return Number(bValue) - Number(aValue);
    });

    setFilteredFunds(filtered);
  };

  const getRiskColor = (risk: string) => {
    const colors: { [key: string]: string } = {
      'Low': 'bg-green-100 text-green-800',
      'Moderate': 'bg-yellow-100 text-yellow-800',
      'High': 'bg-red-100 text-red-800',
    };
    return colors[risk] || 'bg-bg-raised text-text-primary';
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <nav className="bg-black shadow-lg border-b border-accent-soft/20 sticky top-0 z-50 relative">
        <div className="max-w-7xl mx-auto px-6 py-5 flex justify-between items-center">
          <button
            onClick={onBack}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <Logo size="md" />
            <div className="text-left">
              <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>MF Research</h1>
              <p className="text-accent-soft text-xs tracking-wider">NIYOM WEALTH</p>
            </div>
          </button>

          <button
            onClick={onBack}
            className="hidden md:flex items-center gap-2 bg-accent-soft hover:bg-accent-soft-deep text-black px-5 py-2.5 rounded-lg transition-all duration-300 font-semibold shadow-md"
          >
            <ArrowLeft size={18} />
            Back to Home
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
                className="flex items-center gap-2 bg-accent-soft hover:bg-accent-soft-deep text-black px-4 py-3 rounded-lg transition-all duration-300 font-semibold"
              >
                <ArrowLeft size={18} />
                Back to Home
              </button>
            </div>
          </div>
        )}
      </nav>

      <div className="max-w-7xl mx-auto p-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-4xl font-bold text-text-primary flex items-center gap-3">
                <BarChart3 className="w-10 h-10 text-blue-600" />
                Mutual Fund Information
              </h2>
              <p className="text-text-secondary mt-2">View and compare mutual fund performance data for your reference</p>
            </div>
            <button
              onClick={refreshFunds}
              disabled={refreshing}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Updating...' : 'Update Data'}
            </button>
          </div>

          <div className="bg-bg-elevated rounded-2xl shadow-sm p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted w-5 h-5" />
                <input
                  type="text"
                  placeholder="Search by fund name or manager..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-border-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="relative">
                <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted w-5 h-5" />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-border-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-bg-elevated"
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category === 'all' ? 'All Categories' : category}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <TrendingUp className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted w-5 h-5" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="w-full pl-10 pr-4 py-3 border border-border-strong rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-bg-elevated"
                >
                  <option value="return_1y">Sort by 1Y Returns</option>
                  <option value="return_3y">Sort by 3Y Returns</option>
                  <option value="return_5y">Sort by 5Y Returns</option>
                  <option value="aum">Sort by AUM</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {filteredFunds.length === 0 ? (
          <div className="bg-bg-elevated rounded-2xl shadow-sm p-12 text-center">
            <BarChart3 className="w-16 h-16 text-text-muted mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-text-primary mb-2">No funds found</h3>
            <p className="text-text-secondary">Try adjusting your filters or search terms</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {filteredFunds.map((fund) => (
              <div
                key={fund.id}
                className="bg-bg-elevated rounded-2xl shadow-sm p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-bold text-text-primary">{fund.fund_name}</h3>
                      <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                        {fund.category}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getRiskColor(fund.risk_level)}`}>
                        {fund.risk_level} Risk
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-text-secondary">
                      <span className="flex items-center gap-1">
                        <IndianRupee className="w-4 h-4" />
                        Min: {formatCurrency(fund.min_investment)}
                      </span>
                      <span>•</span>
                      <span>Fund Manager: {fund.fund_manager}</span>
                      <span>•</span>
                      <span>AUM: ₹{(fund.aum / 100).toFixed(0)} Cr</span>
                      <span>•</span>
                      <span>Expense: {fund.expense_ratio}%</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border">
                  <div className="text-center">
                    <p className="text-sm text-text-secondary mb-1">1 Year Return</p>
                    <p className={`text-2xl font-bold ${fund.return_1y >= 15 ? 'text-green-600' : 'text-text-primary'}`}>
                      {fund.return_1y}%
                    </p>
                  </div>
                  <div className="text-center border-x border-border">
                    <p className="text-sm text-text-secondary mb-1">3 Year Return</p>
                    <p className={`text-2xl font-bold ${fund.return_3y >= 18 ? 'text-green-600' : 'text-text-primary'}`}>
                      {fund.return_3y}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-text-secondary mb-1">5 Year Return</p>
                    <p className={`text-2xl font-bold ${fund.return_5y >= 15 ? 'text-green-600' : 'text-text-primary'}`}>
                      {fund.return_5y}%
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-text-secondary">
                      <span className="font-medium">Sub-Category:</span> {fund.sub_category}
                    </div>
                    <div className="text-sm text-text-secondary">
                      <span className="font-medium">Launch Date:</span> {new Date(fund.launch_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-900 font-semibold mb-2">
              Disclaimer: We are not SEBI Registered Investment Advisers
            </p>
            <p className="text-sm text-yellow-900">
              The information provided is for educational and informational purposes only. This does not constitute investment advice or a recommendation to buy/sell any mutual fund. Past performance is not indicative of future results. Please consult a qualified financial advisor before making investment decisions. Mutual fund investments are subject to market risks. Read all scheme-related documents carefully before investing.
            </p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Auto-Update:</strong> Mutual fund data is automatically refreshed every 24 hours to keep you updated with the latest performance metrics.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}