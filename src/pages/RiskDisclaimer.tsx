import { AlertTriangle } from 'lucide-react';
import {
  LegalDocumentLayout,
  LegalSection,
  LegalList,
  AlertBox,
  ContactBox
} from '../components/LegalDocumentLayout';

interface RiskDisclaimerProps {
  onClose: () => void;
}

export function RiskDisclaimer({ onClose }: RiskDisclaimerProps) {
  return (
    <LegalDocumentLayout
      title="Risk Disclosure Statement"
      subtitle="Niyom Wealth Distribution LLP"
      icon={<AlertTriangle className="w-16 h-16 text-red-600" strokeWidth={1.5} />}
      onClose={onClose}
    >
      <AlertBox type="danger">
        <p className="font-bold">
          IMPORTANT: Please read this Risk Disclosure Statement carefully before investing.
        </p>
        <p className="mt-2">
          All investments carry risks and you may lose some or all of your invested capital.
        </p>
      </AlertBox>

      <div className="mt-8">
        <LegalSection number="1" title="General Investment Risks">
          <p className="mb-4">
            All investments in financial instruments involve risks. Before making any investment decision,
            you should carefully consider the following:
          </p>
          <LegalList items={[
            <><strong>Market Risk:</strong> The value of investments can fluctuate due to changes in market conditions, economic factors, and investor sentiment.</>,
            <><strong>Loss of Capital:</strong> You may lose part or all of your invested capital. Past performance is not indicative of future results.</>,
            <><strong>No Guaranteed Returns:</strong> We do not guarantee any specific returns or investment performance.</>,
            <><strong>Volatility:</strong> Prices of securities can be volatile and may change rapidly in either direction.</>
          ]} />
        </LegalSection>

        <LegalSection number="2" title="Mutual Funds Risks">
          <AlertBox type="warning">
            <p className="font-semibold">
              Mutual fund investments are subject to market risks. Read all scheme-related documents carefully.
            </p>
          </AlertBox>
          <div className="mt-4">
            <LegalList items={[
              <><strong>NAV Fluctuation:</strong> Net Asset Value (NAV) of mutual fund units may fluctuate based on the performance of underlying securities.</>,
              <><strong>Scheme-Specific Risks:</strong> Each mutual fund scheme has its own risk profile based on investment objective, asset allocation, and management strategy.</>,
              <><strong>Sector/Thematic Funds:</strong> These carry higher concentration risk as they invest in specific sectors or themes.</>,
              <><strong>Interest Rate Risk:</strong> Debt funds are affected by changes in interest rates.</>,
              <><strong>Credit Risk:</strong> Default by issuers of debt securities can impact fund performance.</>,
              <><strong>Liquidity Risk:</strong> Some funds may face difficulty in selling securities during market stress.</>
            ]} />
          </div>
        </LegalSection>

        <LegalSection number="3" title="Unlisted Shares and Pre-IPO Investments">
          <AlertBox type="danger">
            <p className="font-bold">
              WARNING: Unlisted shares carry significantly higher risks than listed securities.
            </p>
          </AlertBox>
          <div className="mt-4">
            <LegalList items={[
              <><strong>Liquidity Risk:</strong> Unlisted shares are highly illiquid. You may not be able to sell them when you want or at your desired price.</>,
              <><strong>No Regulatory Oversight:</strong> Unlisted companies are not subject to the same disclosure and governance requirements as listed companies.</>,
              <><strong>Limited Information:</strong> Financial and operational information about unlisted companies may be limited or difficult to verify.</>,
              <><strong>Valuation Challenges:</strong> Determining fair value is difficult due to lack of market prices and limited comparables.</>,
              <><strong>IPO Uncertainty:</strong> There is no guarantee that a company will go public or be acquired.</>,
              <><strong>Lock-in Periods:</strong> Many unlisted investments have lock-in periods during which you cannot sell.</>,
              <><strong>Total Loss:</strong> The company may fail, resulting in total loss of investment.</>,
              <><strong>Dilution Risk:</strong> Your shareholding may get diluted through subsequent funding rounds.</>
            ]} />
          </div>
        </LegalSection>

        <LegalSection number="4" title="Secondary Bonds Risks">
          <LegalList items={[
            <><strong>Credit Risk:</strong> Risk of default by the bond issuer on interest or principal payments.</>,
            <><strong>Interest Rate Risk:</strong> Bond prices move inversely to interest rates. Rising rates can decrease bond values.</>,
            <><strong>Liquidity Risk:</strong> Secondary market for bonds may be illiquid, making it difficult to sell at desired prices.</>,
            <><strong>Rating Downgrade:</strong> Credit rating downgrades can significantly impact bond prices.</>,
            <><strong>Price Volatility:</strong> Bond prices can fluctuate based on market conditions and issuer creditworthiness.</>,
            <><strong>Call Risk:</strong> Callable bonds may be redeemed early by the issuer, potentially at unfavorable times for investors.</>,
            <><strong>Market Risk:</strong> Economic conditions and market sentiment can affect bond valuations.</>
          ]} />
        </LegalSection>

        <LegalSection number="5" title="Suitability and Investment Horizon">
          <p className="mb-4">Before investing, you should carefully assess:</p>
          <LegalList items={[
            <><strong>Risk Tolerance:</strong> Your ability and willingness to bear investment losses.</>,
            <><strong>Financial Situation:</strong> Your income, assets, liabilities, and liquidity needs.</>,
            <><strong>Investment Objectives:</strong> Your financial goals and time horizon.</>,
            <><strong>Knowledge and Experience:</strong> Your understanding of investment products and market dynamics.</>
          ]} />
          <AlertBox type="info">
            <p className="font-semibold mb-3">Recommended Investment Horizon:</p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Mutual Funds: Minimum 3-5 years depending on scheme type</li>
              <li>Unlisted Shares: Minimum 5-7 years or longer</li>
              <li>Bonds: Hold until maturity for predictable returns</li>
            </ul>
          </AlertBox>
        </LegalSection>

        <LegalSection number="6" title="Technology and Operational Risks">
          <LegalList items={[
            <><strong>System Failures:</strong> Technical issues may disrupt access to our platform or delay transactions.</>,
            <><strong>Cybersecurity:</strong> Risk of unauthorized access, data breaches, or cyber attacks.</>,
            <><strong>Transaction Errors:</strong> Errors in order execution or settlement may occur.</>,
            <><strong>Communication Failures:</strong> Delays or failures in communication channels may affect timely execution.</>
          ]} />
        </LegalSection>

        <LegalSection number="7" title="Regulatory and Tax Risks">
          <LegalList items={[
            <><strong>Regulatory Changes:</strong> Changes in laws and regulations may affect your investments or our services.</>,
            <><strong>Tax Implications:</strong> Investment returns are subject to taxation. Tax laws may change.</>,
            <><strong>Compliance Requirements:</strong> Failure to meet KYC or other regulatory requirements may affect your ability to invest.</>
          ]} />
          <p className="mt-4 italic text-text-secondary">
            You should consult with independent tax advisors regarding the tax implications of your investments.
          </p>
        </LegalSection>

        <LegalSection number="8" title="Concentration Risk">
          <p>
            Investing a significant portion of your portfolio in any single asset, sector, or asset class
            increases concentration risk. Diversification can help manage but not eliminate investment risk.
          </p>
        </LegalSection>

        <LegalSection number="9" title="Information and Advice">
          <AlertBox type="warning">
            <p className="font-bold mb-2">
              SEBI Compliance Notice: We are NOT SEBI Registered Investment Advisers
            </p>
            <p>
              We do not provide investment advice, portfolio management services, or personalized recommendations. We are product distributors and information service providers only.
            </p>
          </AlertBox>
          <div className="mt-4">
            <LegalList items={[
              <><strong>No Investment Advice:</strong> Information on our platform is for informational and educational purposes only and does not constitute investment advice or recommendation.</>,
              <><strong>Your Responsibility:</strong> You are solely responsible for evaluating investments and making all investment decisions independently.</>,
              <><strong>Independent Research:</strong> You must conduct your own due diligence and research before investing.</>,
              <><strong>Professional Advice:</strong> You should consult SEBI registered investment advisers or qualified financial advisors for personalized investment advice.</>,
              <><strong>Product Distribution Only:</strong> We facilitate distribution of financial products and provide general information only.</>
            ]} />
          </div>
        </LegalSection>

        <LegalSection number="10" title="No Guarantee of Performance">
          <p>
            Past performance of any investment or fund is not indicative of future results. Projected or
            targeted returns are not guaranteed. Market conditions can change rapidly and unexpectedly.
          </p>
        </LegalSection>

        <LegalSection number="11" title="Investor Responsibilities">
          <p className="mb-4">As an investor, you are responsible for:</p>
          <LegalList items={[
            'Reading and understanding all investment-related documents',
            'Assessing the suitability of investments for your circumstances',
            'Monitoring your investments regularly',
            'Keeping your contact information and bank details updated',
            'Maintaining the confidentiality of your account credentials',
            'Reporting any suspicious activity or unauthorized transactions'
          ]} />
        </LegalSection>

        <LegalSection number="12" title="Grievance Redressal">
          <p className="mb-4">
            If you have any complaints or concerns about your investments or our services, please contact:
          </p>
          <ContactBox
            company="Niyom Wealth Distribution LLP"
            email="support@niyomwealth.com"
            phone="+91 8939433113"
          />
          <p className="mt-4">
            If your complaint is not resolved satisfactorily, you may escalate it to relevant regulatory
            authorities including SEBI, stock exchanges, or the arbitration mechanism as applicable.
          </p>
        </LegalSection>

        <LegalSection number="13" title="Acknowledgment" variant="info">
          <p className="font-semibold mb-4">
            By using our services and making investments through our platform, you acknowledge that:
          </p>
          <LegalList items={[
            'You have read, understood, and accepted this Risk Disclosure Statement',
            'You understand the risks associated with your investments',
            'You are investing at your own risk and responsibility',
            'You have the financial capacity to bear potential losses',
            'You will seek independent professional advice if needed'
          ]} />
        </LegalSection>

        <AlertBox type="danger">
          <p className="text-center font-bold mb-2">
            INVEST ONLY WHAT YOU CAN AFFORD TO LOSE
          </p>
          <p className="text-center">
            Investments in securities markets are subject to market risks. There are no guaranteed returns.
          </p>
        </AlertBox>
      </div>
    </LegalDocumentLayout>
  );
}
