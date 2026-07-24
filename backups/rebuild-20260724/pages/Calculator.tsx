import { useState } from 'react';
import { Calculator, TrendingUp, PiggyBank, Target, Home, ArrowLeft, Menu, X } from 'lucide-react';
import { Logo } from '../components/Logo';

type CalculatorType = 'sip' | 'lumpsum' | 'retirement' | 'goal';

interface CalculatorProps {
  onBack: () => void;
}

export default function CalculatorPage({ onBack }: CalculatorProps) {
  const [activeCalculator, setActiveCalculator] = useState<CalculatorType>('sip');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [sipAmount, setSipAmount] = useState(5000);
  const [sipRate, setSipRate] = useState(12);
  const [sipYears, setSipYears] = useState(10);

  const [lumpsum, setLumpsum] = useState(100000);
  const [lumpsumRate, setLumpsumRate] = useState(12);
  const [lumpsumYears, setLumpsumYears] = useState(10);

  const [currentAge, setCurrentAge] = useState(30);
  const [retirementAge, setRetirementAge] = useState(60);
  const [monthlyExpense, setMonthlyExpense] = useState(50000);
  const [expectedReturn, setExpectedReturn] = useState(12);

  const [goalAmount, setGoalAmount] = useState(1000000);
  const [goalYears, setGoalYears] = useState(5);
  const [goalRate, setGoalRate] = useState(12);

  const calculateSIP = () => {
    const monthlyRate = sipRate / 12 / 100;
    const months = sipYears * 12;
    const futureValue = sipAmount * (((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate));
    const invested = sipAmount * months;
    const returns = futureValue - invested;
    return { futureValue, invested, returns };
  };

  const calculateLumpsum = () => {
    const futureValue = lumpsum * Math.pow(1 + lumpsumRate / 100, lumpsumYears);
    const returns = futureValue - lumpsum;
    return { futureValue, invested: lumpsum, returns };
  };

  const calculateRetirement = () => {
    const yearsToRetirement = retirementAge - currentAge;
    const monthlyRate = expectedReturn / 12 / 100;
    const inflationRate = 6;

    const futureExpense = monthlyExpense * Math.pow(1 + inflationRate / 100, yearsToRetirement);
    const requiredCorpus = (futureExpense * 12 * 25);

    const monthlySIP = requiredCorpus / (((Math.pow(1 + monthlyRate, yearsToRetirement * 12) - 1) / monthlyRate) * (1 + monthlyRate));

    return { requiredCorpus, monthlySIP, yearsToRetirement };
  };

  const calculateGoal = () => {
    const monthlyRate = goalRate / 12 / 100;
    const months = goalYears * 12;
    const monthlySIP = goalAmount / (((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate));
    const totalInvested = monthlySIP * months;
    const returns = goalAmount - totalInvested;
    return { monthlySIP, totalInvested, returns };
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const sipResult = calculateSIP();
  const lumpsumResult = calculateLumpsum();
  const retirementResult = calculateRetirement();
  const goalResult = calculateGoal();

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
              <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Niyom Calculator</h1>
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
          <h2 className="text-4xl font-bold text-text-primary flex items-center gap-3 mb-2">
            <Calculator className="w-10 h-10 text-blue-600" />
            Financial Calculators
          </h2>
          <p className="text-text-secondary">Educational tools to understand investment projections</p>
          <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-900 font-semibold">
              Disclaimer: These calculators are for educational and illustrative purposes only. Results are projections based on assumed rates of return and do not guarantee actual performance. We are not SEBI Registered Investment Advisers. Please consult a qualified financial advisor for personalized financial planning.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <button
            onClick={() => setActiveCalculator('sip')}
            className={`p-4 rounded-xl transition-all ${
              activeCalculator === 'sip'
                ? 'bg-blue-600 text-white shadow-lg scale-105'
                : 'bg-bg-elevated text-text-secondary hover:bg-bg-base shadow'
            }`}
          >
            <TrendingUp className="w-8 h-8 mx-auto mb-2" />
            <p className="font-semibold">SIP Calculator</p>
          </button>
          <button
            onClick={() => setActiveCalculator('lumpsum')}
            className={`p-4 rounded-xl transition-all ${
              activeCalculator === 'lumpsum'
                ? 'bg-blue-600 text-white shadow-lg scale-105'
                : 'bg-bg-elevated text-text-secondary hover:bg-bg-base shadow'
            }`}
          >
            <PiggyBank className="w-8 h-8 mx-auto mb-2" />
            <p className="font-semibold">Lumpsum Calculator</p>
          </button>
          <button
            onClick={() => setActiveCalculator('retirement')}
            className={`p-4 rounded-xl transition-all ${
              activeCalculator === 'retirement'
                ? 'bg-blue-600 text-white shadow-lg scale-105'
                : 'bg-bg-elevated text-text-secondary hover:bg-bg-base shadow'
            }`}
          >
            <Home className="w-8 h-8 mx-auto mb-2" />
            <p className="font-semibold">Retirement Planner</p>
          </button>
          <button
            onClick={() => setActiveCalculator('goal')}
            className={`p-4 rounded-xl transition-all ${
              activeCalculator === 'goal'
                ? 'bg-blue-600 text-white shadow-lg scale-105'
                : 'bg-bg-elevated text-text-secondary hover:bg-bg-base shadow'
            }`}
          >
            <Target className="w-8 h-8 mx-auto mb-2" />
            <p className="font-semibold">Goal Planner</p>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-bg-elevated rounded-2xl shadow-lg p-8">
            {activeCalculator === 'sip' && (
              <div>
                <h3 className="text-2xl font-bold text-text-primary mb-6">SIP Calculator</h3>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Monthly Investment: {formatCurrency(sipAmount)}
                    </label>
                    <input
                      type="range"
                      min="500"
                      max="100000"
                      step="500"
                      value={sipAmount}
                      onChange={(e) => setSipAmount(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Expected Return Rate: {sipRate}% p.a.
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="30"
                      step="0.5"
                      value={sipRate}
                      onChange={(e) => setSipRate(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Time Period: {sipYears} Years
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="30"
                      step="1"
                      value={sipYears}
                      onChange={(e) => setSipYears(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeCalculator === 'lumpsum' && (
              <div>
                <h3 className="text-2xl font-bold text-text-primary mb-6">Lumpsum Calculator</h3>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      One-time Investment: {formatCurrency(lumpsum)}
                    </label>
                    <input
                      type="range"
                      min="10000"
                      max="10000000"
                      step="10000"
                      value={lumpsum}
                      onChange={(e) => setLumpsum(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Expected Return Rate: {lumpsumRate}% p.a.
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="30"
                      step="0.5"
                      value={lumpsumRate}
                      onChange={(e) => setLumpsumRate(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Time Period: {lumpsumYears} Years
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="30"
                      step="1"
                      value={lumpsumYears}
                      onChange={(e) => setLumpsumYears(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeCalculator === 'retirement' && (
              <div>
                <h3 className="text-2xl font-bold text-text-primary mb-6">Retirement Planner</h3>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Current Age: {currentAge} Years
                    </label>
                    <input
                      type="range"
                      min="18"
                      max="60"
                      step="1"
                      value={currentAge}
                      onChange={(e) => setCurrentAge(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Retirement Age: {retirementAge} Years
                    </label>
                    <input
                      type="range"
                      min="50"
                      max="70"
                      step="1"
                      value={retirementAge}
                      onChange={(e) => setRetirementAge(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Monthly Expense Today: {formatCurrency(monthlyExpense)}
                    </label>
                    <input
                      type="range"
                      min="10000"
                      max="200000"
                      step="5000"
                      value={monthlyExpense}
                      onChange={(e) => setMonthlyExpense(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Expected Return: {expectedReturn}% p.a.
                    </label>
                    <input
                      type="range"
                      min="6"
                      max="18"
                      step="0.5"
                      value={expectedReturn}
                      onChange={(e) => setExpectedReturn(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeCalculator === 'goal' && (
              <div>
                <h3 className="text-2xl font-bold text-text-primary mb-6">Goal Planner</h3>

                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Target Amount: {formatCurrency(goalAmount)}
                    </label>
                    <input
                      type="range"
                      min="100000"
                      max="10000000"
                      step="50000"
                      value={goalAmount}
                      onChange={(e) => setGoalAmount(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Time to Achieve: {goalYears} Years
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="25"
                      step="1"
                      value={goalYears}
                      onChange={(e) => setGoalYears(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Expected Return: {goalRate}% p.a.
                    </label>
                    <input
                      type="range"
                      min="6"
                      max="20"
                      step="0.5"
                      value={goalRate}
                      onChange={(e) => setGoalRate(Number(e.target.value))}
                      className="w-full h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-lg p-8 text-white">
            <h3 className="text-2xl font-bold mb-6">Results</h3>

            {activeCalculator === 'sip' && (
              <div className="space-y-6">
                <div className="bg-bg-elevated/10 backdrop-blur-sm rounded-xl p-6">
                  <p className="text-blue-200 text-sm mb-2">Total Investment</p>
                  <p className="text-4xl font-bold">{formatCurrency(sipResult.invested)}</p>
                </div>
                <div className="bg-bg-elevated/10 backdrop-blur-sm rounded-xl p-6">
                  <p className="text-blue-200 text-sm mb-2">Estimated Returns</p>
                  <p className="text-4xl font-bold">{formatCurrency(sipResult.returns)}</p>
                </div>
                <div className="bg-bg-elevated/20 backdrop-blur-sm rounded-xl p-6 border-2 border-white/30">
                  <p className="text-blue-100 text-sm mb-2">Future Value</p>
                  <p className="text-5xl font-bold">{formatCurrency(sipResult.futureValue)}</p>
                </div>
                <div className="text-sm text-blue-100 mt-4">
                  By investing {formatCurrency(sipAmount)} monthly for {sipYears} years at {sipRate}% annual returns
                </div>
              </div>
            )}

            {activeCalculator === 'lumpsum' && (
              <div className="space-y-6">
                <div className="bg-bg-elevated/10 backdrop-blur-sm rounded-xl p-6">
                  <p className="text-blue-200 text-sm mb-2">Initial Investment</p>
                  <p className="text-4xl font-bold">{formatCurrency(lumpsumResult.invested)}</p>
                </div>
                <div className="bg-bg-elevated/10 backdrop-blur-sm rounded-xl p-6">
                  <p className="text-blue-200 text-sm mb-2">Estimated Returns</p>
                  <p className="text-4xl font-bold">{formatCurrency(lumpsumResult.returns)}</p>
                </div>
                <div className="bg-bg-elevated/20 backdrop-blur-sm rounded-xl p-6 border-2 border-white/30">
                  <p className="text-blue-100 text-sm mb-2">Future Value</p>
                  <p className="text-5xl font-bold">{formatCurrency(lumpsumResult.futureValue)}</p>
                </div>
                <div className="text-sm text-blue-100 mt-4">
                  By investing {formatCurrency(lumpsum)} one-time for {lumpsumYears} years at {lumpsumRate}% annual returns
                </div>
              </div>
            )}

            {activeCalculator === 'retirement' && (
              <div className="space-y-6">
                <div className="bg-bg-elevated/10 backdrop-blur-sm rounded-xl p-6">
                  <p className="text-blue-200 text-sm mb-2">Years to Retirement</p>
                  <p className="text-4xl font-bold">{retirementResult.yearsToRetirement} Years</p>
                </div>
                <div className="bg-bg-elevated/10 backdrop-blur-sm rounded-xl p-6">
                  <p className="text-blue-200 text-sm mb-2">Required Corpus</p>
                  <p className="text-4xl font-bold">{formatCurrency(retirementResult.requiredCorpus)}</p>
                </div>
                <div className="bg-bg-elevated/20 backdrop-blur-sm rounded-xl p-6 border-2 border-white/30">
                  <p className="text-blue-100 text-sm mb-2">Monthly SIP Needed</p>
                  <p className="text-5xl font-bold">{formatCurrency(retirementResult.monthlySIP)}</p>
                </div>
                <div className="text-sm text-blue-100 mt-4">
                  To maintain {formatCurrency(monthlyExpense)}/month lifestyle after retirement (assuming 6% inflation)
                </div>
              </div>
            )}

            {activeCalculator === 'goal' && (
              <div className="space-y-6">
                <div className="bg-bg-elevated/10 backdrop-blur-sm rounded-xl p-6">
                  <p className="text-blue-200 text-sm mb-2">Target Amount</p>
                  <p className="text-4xl font-bold">{formatCurrency(goalAmount)}</p>
                </div>
                <div className="bg-bg-elevated/20 backdrop-blur-sm rounded-xl p-6 border-2 border-white/30">
                  <p className="text-blue-100 text-sm mb-2">Monthly SIP Required</p>
                  <p className="text-5xl font-bold">{formatCurrency(goalResult.monthlySIP)}</p>
                </div>
                <div className="bg-bg-elevated/10 backdrop-blur-sm rounded-xl p-6">
                  <p className="text-blue-200 text-sm mb-2">Total Investment</p>
                  <p className="text-4xl font-bold">{formatCurrency(goalResult.totalInvested)}</p>
                </div>
                <div className="bg-bg-elevated/10 backdrop-blur-sm rounded-xl p-6">
                  <p className="text-blue-200 text-sm mb-2">Estimated Returns</p>
                  <p className="text-4xl font-bold">{formatCurrency(goalResult.returns)}</p>
                </div>
                <div className="text-sm text-blue-100 mt-4">
                  To achieve {formatCurrency(goalAmount)} in {goalYears} years at {goalRate}% annual returns
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800">
            <strong>Disclaimer:</strong> These calculations are for illustrative purposes only and do not guarantee actual returns. Actual investment returns may vary based on market conditions.
          </p>
        </div>
      </div>
    </div>
  );
}