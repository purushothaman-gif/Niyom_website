import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface MutualFund {
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
}

function generateSampleMutualFunds(): MutualFund[] {
  return [
    {
      fund_name: "HDFC Equity Growth Fund",
      fund_code: "HDFC-EQ-001",
      category: "Equity",
      sub_category: "Large Cap",
      aum: 45000,
      expense_ratio: 1.8,
      return_1y: 18.5,
      return_3y: 22.3,
      return_5y: 19.7,
      launch_date: "2015-03-15",
      risk_level: "Moderate",
      min_investment: 500,
      fund_manager: "Prashant Jain"
    },
    {
      fund_name: "ICICI Prudential Bluechip Fund",
      fund_code: "ICICI-BC-002",
      category: "Equity",
      sub_category: "Large Cap",
      aum: 38000,
      expense_ratio: 1.75,
      return_1y: 17.2,
      return_3y: 21.5,
      return_5y: 18.9,
      launch_date: "2014-08-20",
      risk_level: "Moderate",
      min_investment: 1000,
      fund_manager: "Sankaran Naren"
    },
    {
      fund_name: "SBI Small Cap Fund",
      fund_code: "SBI-SC-003",
      category: "Equity",
      sub_category: "Small Cap",
      aum: 12000,
      expense_ratio: 2.1,
      return_1y: 25.8,
      return_3y: 28.4,
      return_5y: 24.2,
      launch_date: "2016-05-10",
      risk_level: "High",
      min_investment: 500,
      fund_manager: "R. Srinivasan"
    },
    {
      fund_name: "Axis Midcap Fund",
      fund_code: "AXIS-MC-004",
      category: "Equity",
      sub_category: "Mid Cap",
      aum: 22000,
      expense_ratio: 1.95,
      return_1y: 22.4,
      return_3y: 25.7,
      return_5y: 21.8,
      launch_date: "2015-11-25",
      risk_level: "High",
      min_investment: 1000,
      fund_manager: "Shreyash Devalkar"
    },
    {
      fund_name: "Kotak Equity Opportunities Fund",
      fund_code: "KOTAK-EO-005",
      category: "Equity",
      sub_category: "Multi Cap",
      aum: 28000,
      expense_ratio: 1.85,
      return_1y: 19.8,
      return_3y: 23.1,
      return_5y: 20.5,
      launch_date: "2014-02-18",
      risk_level: "Moderate",
      min_investment: 500,
      fund_manager: "Harsha Upadhyaya"
    },
    {
      fund_name: "Mirae Asset Large Cap Fund",
      fund_code: "MIRAE-LC-006",
      category: "Equity",
      sub_category: "Large Cap",
      aum: 32000,
      expense_ratio: 1.7,
      return_1y: 20.2,
      return_3y: 24.5,
      return_5y: 21.3,
      launch_date: "2013-09-30",
      risk_level: "Moderate",
      min_investment: 1000,
      fund_manager: "Neelesh Surana"
    },
    {
      fund_name: "HDFC Corporate Bond Fund",
      fund_code: "HDFC-CB-007",
      category: "Debt",
      sub_category: "Corporate Bond",
      aum: 15000,
      expense_ratio: 0.95,
      return_1y: 7.8,
      return_3y: 8.2,
      return_5y: 7.9,
      launch_date: "2016-07-12",
      risk_level: "Low",
      min_investment: 5000,
      fund_manager: "Anil Bamboli"
    },
    {
      fund_name: "ICICI Prudential Gilt Fund",
      fund_code: "ICICI-GILT-008",
      category: "Debt",
      sub_category: "Gilt",
      aum: 8000,
      expense_ratio: 0.85,
      return_1y: 6.5,
      return_3y: 7.1,
      return_5y: 6.8,
      launch_date: "2015-04-22",
      risk_level: "Low",
      min_investment: 5000,
      fund_manager: "Manish Banthia"
    },
    {
      fund_name: "SBI Magnum Balanced Advantage Fund",
      fund_code: "SBI-BA-009",
      category: "Hybrid",
      sub_category: "Balanced Advantage",
      aum: 18000,
      expense_ratio: 1.65,
      return_1y: 14.5,
      return_3y: 16.8,
      return_5y: 15.2,
      launch_date: "2014-10-05",
      risk_level: "Moderate",
      min_investment: 1000,
      fund_manager: "Dinesh Ahuja"
    },
    {
      fund_name: "HDFC Hybrid Equity Fund",
      fund_code: "HDFC-HE-010",
      category: "Hybrid",
      sub_category: "Aggressive Hybrid",
      aum: 25000,
      expense_ratio: 1.75,
      return_1y: 16.2,
      return_3y: 18.9,
      return_5y: 17.1,
      launch_date: "2013-12-15",
      risk_level: "Moderate",
      min_investment: 500,
      fund_manager: "Chirag Setalvad"
    },
    {
      fund_name: "Parag Parikh Flexi Cap Fund",
      fund_code: "PP-FC-011",
      category: "Equity",
      sub_category: "Flexi Cap",
      aum: 35000,
      expense_ratio: 1.92,
      return_1y: 21.5,
      return_3y: 26.8,
      return_5y: 23.4,
      launch_date: "2013-05-28",
      risk_level: "High",
      min_investment: 1000,
      fund_manager: "Rajeev Thakkar"
    },
    {
      fund_name: "UTI Nifty Index Fund",
      fund_code: "UTI-NIF-012",
      category: "Equity",
      sub_category: "Index Fund",
      aum: 42000,
      expense_ratio: 0.45,
      return_1y: 15.8,
      return_3y: 19.2,
      return_5y: 17.5,
      launch_date: "2012-01-10",
      risk_level: "Moderate",
      min_investment: 500,
      fund_manager: "Sharwan Kumar Goyal"
    },
    {
      fund_name: "DSP Tax Saver Fund",
      fund_code: "DSP-TS-013",
      category: "Equity",
      sub_category: "ELSS",
      aum: 16000,
      expense_ratio: 1.88,
      return_1y: 19.3,
      return_3y: 22.7,
      return_5y: 20.1,
      launch_date: "2014-06-18",
      risk_level: "Moderate",
      min_investment: 500,
      fund_manager: "Vinit Sambre"
    },
    {
      fund_name: "Franklin India Short Term Income Plan",
      fund_code: "FRANK-ST-014",
      category: "Debt",
      sub_category: "Short Duration",
      aum: 9000,
      expense_ratio: 0.92,
      return_1y: 7.2,
      return_3y: 7.8,
      return_5y: 7.4,
      launch_date: "2015-09-08",
      risk_level: "Low",
      min_investment: 5000,
      fund_manager: "Santosh Kamath"
    },
    {
      fund_name: "Aditya Birla Sun Life Focused Equity Fund",
      fund_code: "ABSL-FE-015",
      category: "Equity",
      sub_category: "Focused",
      aum: 14000,
      expense_ratio: 1.98,
      return_1y: 23.7,
      return_3y: 27.3,
      return_5y: 24.8,
      launch_date: "2016-02-14",
      risk_level: "High",
      min_investment: 1000,
      fund_manager: "Mahesh Patil"
    }
  ];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const funds = generateSampleMutualFunds();

    for (const fund of funds) {
      const { error: upsertError } = await supabase
        .from("mutual_funds")
        .upsert(
          { ...fund, updated_at: new Date().toISOString() },
          { onConflict: "fund_code" }
        );

      if (upsertError) {
        console.error(`Error upserting fund ${fund.fund_code}:`, upsertError);
      }
    }

    console.log(`Successfully updated ${funds.length} mutual funds`);

    return new Response(
      JSON.stringify({
        success: true,
        updated: funds.length,
        message: "Mutual funds data updated successfully"
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error in update-mutual-funds:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});