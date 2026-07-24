export interface AuthUser {
  id: string;
  email: string;
}

export interface CRMUser {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'employee';
  level: string;
  monthly_salary: number;
  auth_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface Deal {
  id: string;
  employee_id: string;
  product_type: 'mutual_funds' | 'insurance' | 'fixed_deposits' | 'bonds' | 'unlisted_shares' | 'primary_bonds' | 'other';
  amount: number;
  revenue: number;
  status: 'pending' | 'closed' | 'cancelled';
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncentiveSlab {
  id: string;
  min_multiple: number;
  max_multiple: number | null;
  revenue_share_percentage: number;
  created_at: string;
}

export interface EmployeeMetrics {
  total_revenue: number;
  x_multiple: number;
  incentive_amount: number;
  product_categories: number;
}
