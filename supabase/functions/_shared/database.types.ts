/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate after any migration:
 *
 *   npm run gen:types
 *
 * Lives here, inside supabase/functions/_shared, for one reason: the Edge
 * Function deploy bundles relative imports from the function directory, so a
 * copy anywhere outside supabase/ risks not shipping. The app reaches it
 * through src/lib/database.types.ts, which re-exports rather than duplicates —
 * two copies of a 6,600-line generated file would drift, and the drift would be
 * invisible until a query returned something the types said was impossible.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      bm_bonds: {
        Row: {
          active_status: string
          analytics: Json
          analytics_computed_at: string | null
          bond_name: string
          bse_code: string
          business_day_convention: string
          callable: boolean
          coupon_frequency: string
          coupon_rate: number | null
          coupon_type: string
          created_at: string
          created_by: string | null
          currency: string
          data_quality_score: number
          day_count_convention: string
          default_margin_type: string
          default_margin_value: number | null
          enriched_at: string | null
          exchange_listed: string
          extracted_name: string
          face_value: number | null
          first_coupon_date: string | null
          floating: boolean
          id: string
          import_raw: Json
          interest_payment_dates: string
          isin: string
          issue_date: string | null
          issue_price: number | null
          issuer_docs: Json
          issuer_id: string | null
          landing_cost: number | null
          latest_price: number | null
          listing_date: string | null
          listing_status: string
          lot_size: number | null
          maturity_date: string | null
          min_investment: number | null
          modified_by: string | null
          next_coupon_date: string | null
          nse_symbol: string
          perpetual: boolean
          previous_coupon_date: string | null
          price_updated_at: string | null
          principal_repayment_structure: string
          put_call_date: string | null
          put_call_type: string
          puttable: boolean
          rating: string
          rating_agency: string
          rating_date: string | null
          redemption_date: string | null
          redemption_schedule: Json
          redemption_value: number | null
          secured: boolean | null
          security_description: string
          security_type: string
          selling_price: number | null
          seniority: string
          series: string
          source_summary: Json
          tax_status: string
          trustee: string
          updated_at: string
          verification_status: string
        }
        Insert: {
          active_status?: string
          analytics?: Json
          analytics_computed_at?: string | null
          bond_name?: string
          bse_code?: string
          business_day_convention?: string
          callable?: boolean
          coupon_frequency?: string
          coupon_rate?: number | null
          coupon_type?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          data_quality_score?: number
          day_count_convention?: string
          default_margin_type?: string
          default_margin_value?: number | null
          enriched_at?: string | null
          exchange_listed?: string
          extracted_name?: string
          face_value?: number | null
          first_coupon_date?: string | null
          floating?: boolean
          id?: string
          import_raw?: Json
          interest_payment_dates?: string
          isin: string
          issue_date?: string | null
          issue_price?: number | null
          issuer_docs?: Json
          issuer_id?: string | null
          landing_cost?: number | null
          latest_price?: number | null
          listing_date?: string | null
          listing_status?: string
          lot_size?: number | null
          maturity_date?: string | null
          min_investment?: number | null
          modified_by?: string | null
          next_coupon_date?: string | null
          nse_symbol?: string
          perpetual?: boolean
          previous_coupon_date?: string | null
          price_updated_at?: string | null
          principal_repayment_structure?: string
          put_call_date?: string | null
          put_call_type?: string
          puttable?: boolean
          rating?: string
          rating_agency?: string
          rating_date?: string | null
          redemption_date?: string | null
          redemption_schedule?: Json
          redemption_value?: number | null
          secured?: boolean | null
          security_description?: string
          security_type?: string
          selling_price?: number | null
          seniority?: string
          series?: string
          source_summary?: Json
          tax_status?: string
          trustee?: string
          updated_at?: string
          verification_status?: string
        }
        Update: {
          active_status?: string
          analytics?: Json
          analytics_computed_at?: string | null
          bond_name?: string
          bse_code?: string
          business_day_convention?: string
          callable?: boolean
          coupon_frequency?: string
          coupon_rate?: number | null
          coupon_type?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          data_quality_score?: number
          day_count_convention?: string
          default_margin_type?: string
          default_margin_value?: number | null
          enriched_at?: string | null
          exchange_listed?: string
          extracted_name?: string
          face_value?: number | null
          first_coupon_date?: string | null
          floating?: boolean
          id?: string
          import_raw?: Json
          interest_payment_dates?: string
          isin?: string
          issue_date?: string | null
          issue_price?: number | null
          issuer_docs?: Json
          issuer_id?: string | null
          landing_cost?: number | null
          latest_price?: number | null
          listing_date?: string | null
          listing_status?: string
          lot_size?: number | null
          maturity_date?: string | null
          min_investment?: number | null
          modified_by?: string | null
          next_coupon_date?: string | null
          nse_symbol?: string
          perpetual?: boolean
          previous_coupon_date?: string | null
          price_updated_at?: string | null
          principal_repayment_structure?: string
          put_call_date?: string | null
          put_call_type?: string
          puttable?: boolean
          rating?: string
          rating_agency?: string
          rating_date?: string | null
          redemption_date?: string | null
          redemption_schedule?: Json
          redemption_value?: number | null
          secured?: boolean | null
          security_description?: string
          security_type?: string
          selling_price?: number | null
          seniority?: string
          series?: string
          source_summary?: Json
          tax_status?: string
          trustee?: string
          updated_at?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bm_bonds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_bonds_issuer_id_fkey"
            columns: ["issuer_id"]
            isOneToOne: false
            referencedRelation: "bm_issuers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_bonds_modified_by_fkey"
            columns: ["modified_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      bm_cashflow_schedule: {
        Row: {
          bond_id: string
          cf_date: string
          created_at: string
          id: string
          interest_per_100: number
          principal_per_100: number
          remark: string
          seq: number
          total_per_100: number
        }
        Insert: {
          bond_id: string
          cf_date: string
          created_at?: string
          id?: string
          interest_per_100?: number
          principal_per_100?: number
          remark?: string
          seq: number
          total_per_100?: number
        }
        Update: {
          bond_id?: string
          cf_date?: string
          created_at?: string
          id?: string
          interest_per_100?: number
          principal_per_100?: number
          remark?: string
          seq?: number
          total_per_100?: number
        }
        Relationships: [
          {
            foreignKeyName: "bm_cashflow_schedule_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_cashflow_schedule_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds_public"
            referencedColumns: ["id"]
          },
        ]
      }
      bm_corporate_actions: {
        Row: {
          action_type: string
          bond_id: string
          created_at: string
          details: Json
          ex_date: string | null
          id: string
          record_date: string | null
          source: string
        }
        Insert: {
          action_type?: string
          bond_id: string
          created_at?: string
          details?: Json
          ex_date?: string | null
          id?: string
          record_date?: string | null
          source?: string
        }
        Update: {
          action_type?: string
          bond_id?: string
          created_at?: string
          details?: Json
          ex_date?: string | null
          id?: string
          record_date?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "bm_corporate_actions_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_corporate_actions_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds_public"
            referencedColumns: ["id"]
          },
        ]
      }
      bm_coupon_schedule: {
        Row: {
          bond_id: string
          coupon_per_100: number
          created_at: string
          id: string
          outstanding_per_100: number
          pay_date: string | null
          period_end: string | null
          period_start: string | null
          scheduled_date: string | null
          seq: number
        }
        Insert: {
          bond_id: string
          coupon_per_100?: number
          created_at?: string
          id?: string
          outstanding_per_100?: number
          pay_date?: string | null
          period_end?: string | null
          period_start?: string | null
          scheduled_date?: string | null
          seq: number
        }
        Update: {
          bond_id?: string
          coupon_per_100?: number
          created_at?: string
          id?: string
          outstanding_per_100?: number
          pay_date?: string | null
          period_end?: string | null
          period_start?: string | null
          scheduled_date?: string | null
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "bm_coupon_schedule_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_coupon_schedule_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds_public"
            referencedColumns: ["id"]
          },
        ]
      }
      bm_field_provenance: {
        Row: {
          bond_id: string
          confidence: number
          field_name: string
          id: string
          is_locked: boolean
          source: string
          updated_at: string
          value: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          bond_id: string
          confidence?: number
          field_name: string
          id?: string
          is_locked?: boolean
          source?: string
          updated_at?: string
          value?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          bond_id?: string
          confidence?: number
          field_name?: string
          id?: string
          is_locked?: boolean
          source?: string
          updated_at?: string
          value?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bm_field_provenance_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_field_provenance_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_field_provenance_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      bm_holiday_calendar: {
        Row: {
          holiday_date: string
          id: string
          market: string
          name: string
        }
        Insert: {
          holiday_date: string
          id?: string
          market?: string
          name?: string
        }
        Update: {
          holiday_date?: string
          id?: string
          market?: string
          name?: string
        }
        Relationships: []
      }
      bm_issuers: {
        Row: {
          category: string
          created_at: string
          external_ids: Json
          id: string
          industry: string
          name: string
          pan: string
          sector: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          external_ids?: Json
          id?: string
          industry?: string
          name: string
          pan?: string
          sector?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          external_ids?: Json
          id?: string
          industry?: string
          name?: string
          pan?: string
          sector?: string
          updated_at?: string
        }
        Relationships: []
      }
      bm_price_history: {
        Row: {
          as_of: string
          bond_id: string
          created_at: string
          id: string
          isin: string
          price: number
          source: string
        }
        Insert: {
          as_of?: string
          bond_id: string
          created_at?: string
          id?: string
          isin: string
          price: number
          source?: string
        }
        Update: {
          as_of?: string
          bond_id?: string
          created_at?: string
          id?: string
          isin?: string
          price?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "bm_price_history_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_price_history_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds_public"
            referencedColumns: ["id"]
          },
        ]
      }
      bm_provider_log: {
        Row: {
          bond_id: string | null
          created_at: string
          error: string
          fields_returned: number
          http_status: number | null
          id: string
          isin: string
          latency_ms: number | null
          provider_id: string
          status: string
        }
        Insert: {
          bond_id?: string | null
          created_at?: string
          error?: string
          fields_returned?: number
          http_status?: number | null
          id?: string
          isin?: string
          latency_ms?: number | null
          provider_id?: string
          status?: string
        }
        Update: {
          bond_id?: string | null
          created_at?: string
          error?: string
          fields_returned?: number
          http_status?: number | null
          id?: string
          isin?: string
          latency_ms?: number | null
          provider_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bm_provider_log_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_provider_log_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds_public"
            referencedColumns: ["id"]
          },
        ]
      }
      bm_rating_history: {
        Row: {
          agency: string
          bond_id: string
          created_at: string
          id: string
          rating: string
          rating_date: string | null
          source: string
        }
        Insert: {
          agency?: string
          bond_id: string
          created_at?: string
          id?: string
          rating?: string
          rating_date?: string | null
          source?: string
        }
        Update: {
          agency?: string
          bond_id?: string
          created_at?: string
          id?: string
          rating?: string
          rating_date?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "bm_rating_history_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_rating_history_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: false
            referencedRelation: "bm_bonds_public"
            referencedColumns: ["id"]
          },
        ]
      }
      bm_verification_queue: {
        Row: {
          bond_id: string
          confidence: number
          conflicts: Json
          created_at: string
          id: string
          missing_fields: string[]
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          bond_id: string
          confidence?: number
          conflicts?: Json
          created_at?: string
          id?: string
          missing_fields?: string[]
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          bond_id?: string
          confidence?: number
          conflicts?: Json
          created_at?: string
          id?: string
          missing_fields?: string[]
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bm_verification_queue_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: true
            referencedRelation: "bm_bonds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_verification_queue_bond_id_fkey"
            columns: ["bond_id"]
            isOneToOne: true
            referencedRelation: "bm_bonds_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bm_verification_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      bse_webhook_events: {
        Row: {
          client_code: string | null
          event: string | null
          event_at: string | null
          event_type: string | null
          id: number
          mandate_id: string | null
          mem_ord_ref_id: string | null
          member_id: string | null
          msgcode: number | null
          order_id: string | null
          payload: Json
          received_at: string
          request_id: string | null
          source_ip: string | null
          sxp_reg_num: string | null
        }
        Insert: {
          client_code?: string | null
          event?: string | null
          event_at?: string | null
          event_type?: string | null
          id?: never
          mandate_id?: string | null
          mem_ord_ref_id?: string | null
          member_id?: string | null
          msgcode?: number | null
          order_id?: string | null
          payload: Json
          received_at?: string
          request_id?: string | null
          source_ip?: string | null
          sxp_reg_num?: string | null
        }
        Update: {
          client_code?: string | null
          event?: string | null
          event_at?: string | null
          event_type?: string | null
          id?: never
          mandate_id?: string | null
          mem_ord_ref_id?: string | null
          member_id?: string | null
          msgcode?: number | null
          order_id?: string | null
          payload?: Json
          received_at?: string
          request_id?: string | null
          source_ip?: string | null
          sxp_reg_num?: string | null
        }
        Relationships: []
      }
      cas_consents: {
        Row: {
          client_id: string
          consent_type: string
          created_at: string | null
          evidence: Json | null
          granted: boolean
          granted_at: string | null
          id: string
          ip: string | null
          policy_version: string
          request_id: string | null
          revoked_at: string | null
          user_agent: string | null
        }
        Insert: {
          client_id: string
          consent_type: string
          created_at?: string | null
          evidence?: Json | null
          granted?: boolean
          granted_at?: string | null
          id?: string
          ip?: string | null
          policy_version?: string
          request_id?: string | null
          revoked_at?: string | null
          user_agent?: string | null
        }
        Update: {
          client_id?: string
          consent_type?: string
          created_at?: string | null
          evidence?: Json | null
          granted?: boolean
          granted_at?: string | null
          id?: string
          ip?: string | null
          policy_version?: string
          request_id?: string | null
          revoked_at?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cas_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cas_consents_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "cas_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      cas_folios: {
        Row: {
          amc: string | null
          client_id: string | null
          created_at: string | null
          folio_number: string
          id: string
          import_id: string
          registrar: string | null
          value: number | null
        }
        Insert: {
          amc?: string | null
          client_id?: string | null
          created_at?: string | null
          folio_number: string
          id?: string
          import_id: string
          registrar?: string | null
          value?: number | null
        }
        Update: {
          amc?: string | null
          client_id?: string | null
          created_at?: string | null
          folio_number?: string
          id?: string
          import_id?: string
          registrar?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cas_folios_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cas_folios_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "cas_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      cas_imports: {
        Row: {
          cas_type: string | null
          client_id: string | null
          created_at: string | null
          created_by: string | null
          error: string | null
          file_name: string | null
          file_sha256: string | null
          folio_count: number | null
          id: string
          investor_email: string | null
          investor_name: string | null
          investor_pan: string | null
          parsed_total: number | null
          request_id: string | null
          scheme_count: number | null
          source: string
          stated_total: number | null
          statement_from: string | null
          statement_to: string | null
          status: string
          transaction_count: number | null
          variance: number | null
        }
        Insert: {
          cas_type?: string | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          file_name?: string | null
          file_sha256?: string | null
          folio_count?: number | null
          id?: string
          investor_email?: string | null
          investor_name?: string | null
          investor_pan?: string | null
          parsed_total?: number | null
          request_id?: string | null
          scheme_count?: number | null
          source?: string
          stated_total?: number | null
          statement_from?: string | null
          statement_to?: string | null
          status?: string
          transaction_count?: number | null
          variance?: number | null
        }
        Update: {
          cas_type?: string | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          file_name?: string | null
          file_sha256?: string | null
          folio_count?: number | null
          id?: string
          investor_email?: string | null
          investor_name?: string | null
          investor_pan?: string | null
          parsed_total?: number | null
          request_id?: string | null
          scheme_count?: number | null
          source?: string
          stated_total?: number | null
          statement_from?: string | null
          statement_to?: string | null
          status?: string
          transaction_count?: number | null
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cas_imports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cas_imports_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "cas_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      cas_requests: {
        Row: {
          cancelled_at: string | null
          client_id: string
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          expected_by: string | null
          failure_reason: string | null
          folio_listing: string | null
          id: string
          import_id: string | null
          include_zero_balance: boolean | null
          requested_email: string | null
          statement_from: string | null
          statement_to: string | null
          statement_type: string | null
          status: string
        }
        Insert: {
          cancelled_at?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          expected_by?: string | null
          failure_reason?: string | null
          folio_listing?: string | null
          id?: string
          import_id?: string | null
          include_zero_balance?: boolean | null
          requested_email?: string | null
          statement_from?: string | null
          statement_to?: string | null
          statement_type?: string | null
          status?: string
        }
        Update: {
          cancelled_at?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          expected_by?: string | null
          failure_reason?: string | null
          folio_listing?: string | null
          id?: string
          import_id?: string | null
          include_zero_balance?: boolean | null
          requested_email?: string | null
          statement_from?: string | null
          statement_to?: string | null
          statement_type?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cas_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cas_requests_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "cas_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      cas_schemes: {
        Row: {
          advisor_code: string | null
          amfi_code: string | null
          client_id: string | null
          cost: number | null
          created_at: string | null
          folio_id: string
          gain_absolute: number | null
          gain_percent: number | null
          id: string
          import_id: string
          is_ours: boolean | null
          isin: string | null
          name: string
          nav: number | null
          nav_date: string | null
          rta: string | null
          rta_code: string | null
          scheme_type: string | null
          units: number | null
          value: number | null
        }
        Insert: {
          advisor_code?: string | null
          amfi_code?: string | null
          client_id?: string | null
          cost?: number | null
          created_at?: string | null
          folio_id: string
          gain_absolute?: number | null
          gain_percent?: number | null
          id?: string
          import_id: string
          is_ours?: boolean | null
          isin?: string | null
          name: string
          nav?: number | null
          nav_date?: string | null
          rta?: string | null
          rta_code?: string | null
          scheme_type?: string | null
          units?: number | null
          value?: number | null
        }
        Update: {
          advisor_code?: string | null
          amfi_code?: string | null
          client_id?: string | null
          cost?: number | null
          created_at?: string | null
          folio_id?: string
          gain_absolute?: number | null
          gain_percent?: number | null
          id?: string
          import_id?: string
          is_ours?: boolean | null
          isin?: string | null
          name?: string
          nav?: number | null
          nav_date?: string | null
          rta?: string | null
          rta_code?: string | null
          scheme_type?: string | null
          units?: number | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cas_schemes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cas_schemes_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "cas_folios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cas_schemes_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "cas_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      cas_transactions: {
        Row: {
          amount: number | null
          balance_units: number | null
          client_id: string | null
          created_at: string | null
          description: string | null
          dividend_rate: number | null
          id: string
          import_id: string
          nav: number | null
          scheme_id: string
          stamp_duty: number | null
          txn_date: string
          txn_type: string | null
          units: number | null
        }
        Insert: {
          amount?: number | null
          balance_units?: number | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          dividend_rate?: number | null
          id?: string
          import_id: string
          nav?: number | null
          scheme_id: string
          stamp_duty?: number | null
          txn_date: string
          txn_type?: string | null
          units?: number | null
        }
        Update: {
          amount?: number | null
          balance_units?: number | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          dividend_rate?: number | null
          id?: string
          import_id?: string
          nav?: number | null
          scheme_id?: string
          stamp_duty?: number | null
          txn_date?: string
          txn_type?: string | null
          units?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cas_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cas_transactions_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "cas_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cas_transactions_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "cas_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      commodity_prices: {
        Row: {
          commodity: string
          created_at: string | null
          id: string
          price: number
          price_date: string
          source: string
        }
        Insert: {
          commodity: string
          created_at?: string | null
          id?: string
          price: number
          price_date: string
          source?: string
        }
        Update: {
          commodity?: string
          created_at?: string | null
          id?: string
          price?: number
          price_date?: string
          source?: string
        }
        Relationships: []
      }
      data_update_log: {
        Row: {
          data_type: string
          error_message: string | null
          id: string
          last_update: string | null
          records_updated: number | null
          source_name: string
          status: string | null
        }
        Insert: {
          data_type: string
          error_message?: string | null
          id?: string
          last_update?: string | null
          records_updated?: number | null
          source_name: string
          status?: string | null
        }
        Update: {
          data_type?: string
          error_message?: string | null
          id?: string
          last_update?: string | null
          records_updated?: number | null
          source_name?: string
          status?: string | null
        }
        Relationships: []
      }
      dsa_debit_note_counters: {
        Row: {
          last_seq: number
          month: number
          year: number
        }
        Insert: {
          last_seq?: number
          month: number
          year: number
        }
        Update: {
          last_seq?: number
          month?: number
          year?: number
        }
        Relationships: []
      }
      dsa_debit_note_events: {
        Row: {
          actor: string
          created_at: string
          debit_note_id: string
          event_type: string
          id: string
          ip: string | null
          metadata: Json
          user_agent: string | null
        }
        Insert: {
          actor?: string
          created_at?: string
          debit_note_id: string
          event_type: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
        }
        Update: {
          actor?: string
          created_at?: string
          debit_note_id?: string
          event_type?: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dsa_debit_note_events_debit_note_id_fkey"
            columns: ["debit_note_id"]
            isOneToOne: false
            referencedRelation: "dsa_debit_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      dsa_debit_note_events_deleted_backup: {
        Row: {
          actor: string
          created_at: string
          debit_note_id: string
          deleted_at: string
          event_type: string
          id: string
          ip: string | null
          metadata: Json
          user_agent: string | null
        }
        Insert: {
          actor?: string
          created_at?: string
          debit_note_id: string
          deleted_at?: string
          event_type: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
        }
        Update: {
          actor?: string
          created_at?: string
          debit_note_id?: string
          deleted_at?: string
          event_type?: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
        }
        Relationships: []
      }
      dsa_debit_note_lines: {
        Row: {
          created_at: string
          debit_note_id: string
          id: string
          payout: number
          transaction_id: string
        }
        Insert: {
          created_at?: string
          debit_note_id: string
          id?: string
          payout?: number
          transaction_id: string
        }
        Update: {
          created_at?: string
          debit_note_id?: string
          id?: string
          payout?: number
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dsa_debit_note_lines_debit_note_id_fkey"
            columns: ["debit_note_id"]
            isOneToOne: false
            referencedRelation: "dsa_debit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dsa_debit_note_lines_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "nw_deal_overall_stage"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "dsa_debit_note_lines_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "nw_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      dsa_debit_note_otps: {
        Row: {
          attempts: number
          created_at: string
          debit_note_id: string
          email: string
          expires_at: string
          id: string
          otp_hash: string
          purpose: string
          token: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          debit_note_id: string
          email: string
          expires_at: string
          id?: string
          otp_hash: string
          purpose?: string
          token: string
        }
        Update: {
          attempts?: number
          created_at?: string
          debit_note_id?: string
          email?: string
          expires_at?: string
          id?: string
          otp_hash?: string
          purpose?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "dsa_debit_note_otps_debit_note_id_fkey"
            columns: ["debit_note_id"]
            isOneToOne: false
            referencedRelation: "dsa_debit_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      dsa_debit_notes: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          debit_note_number: string
          dsa_id: string | null
          email_sent: boolean
          email_sent_at: string | null
          generated_at: string
          id: string
          month: number
          net_payable_amount: number
          paid_at: string | null
          paid_by: string | null
          payment_reference: string | null
          payout_amount: number
          pdf_snapshot: Json | null
          pdf_url: string
          secure_token: string | null
          sent_at: string | null
          sent_by: string | null
          signature_image_path: string | null
          signature_status: string
          signed_at: string | null
          signed_pdf_url: string | null
          signer_email: string | null
          signer_ip: string | null
          signer_user_agent: string | null
          status: string
          tds_amount: number
          token_expires_at: string | null
          updated_at: string
          viewed_at: string | null
          year: number
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          debit_note_number: string
          dsa_id?: string | null
          email_sent?: boolean
          email_sent_at?: string | null
          generated_at?: string
          id?: string
          month: number
          net_payable_amount?: number
          paid_at?: string | null
          paid_by?: string | null
          payment_reference?: string | null
          payout_amount?: number
          pdf_snapshot?: Json | null
          pdf_url?: string
          secure_token?: string | null
          sent_at?: string | null
          sent_by?: string | null
          signature_image_path?: string | null
          signature_status?: string
          signed_at?: string | null
          signed_pdf_url?: string | null
          signer_email?: string | null
          signer_ip?: string | null
          signer_user_agent?: string | null
          status?: string
          tds_amount?: number
          token_expires_at?: string | null
          updated_at?: string
          viewed_at?: string | null
          year: number
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          debit_note_number?: string
          dsa_id?: string | null
          email_sent?: boolean
          email_sent_at?: string | null
          generated_at?: string
          id?: string
          month?: number
          net_payable_amount?: number
          paid_at?: string | null
          paid_by?: string | null
          payment_reference?: string | null
          payout_amount?: number
          pdf_snapshot?: Json | null
          pdf_url?: string
          secure_token?: string | null
          sent_at?: string | null
          sent_by?: string | null
          signature_image_path?: string | null
          signature_status?: string
          signed_at?: string | null
          signed_pdf_url?: string | null
          signer_email?: string | null
          signer_ip?: string | null
          signer_user_agent?: string | null
          status?: string
          tds_amount?: number
          token_expires_at?: string | null
          updated_at?: string
          viewed_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "dsa_debit_notes_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dsa_debit_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dsa_debit_notes_dsa_id_fkey"
            columns: ["dsa_id"]
            isOneToOne: false
            referencedRelation: "nw_dsa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dsa_debit_notes_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dsa_debit_notes_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      dsa_debit_notes_deleted_backup: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          debit_note_number: string
          deleted_at: string
          deleted_reason: string | null
          dsa_id: string | null
          email_sent: boolean
          email_sent_at: string | null
          generated_at: string
          id: string
          month: number
          net_payable_amount: number
          paid_at: string | null
          paid_by: string | null
          payout_amount: number
          pdf_snapshot: Json | null
          pdf_url: string
          secure_token: string | null
          sent_at: string | null
          sent_by: string | null
          signature_image_path: string | null
          signature_status: string
          signed_at: string | null
          signed_pdf_url: string | null
          signer_email: string | null
          signer_ip: string | null
          signer_user_agent: string | null
          status: string
          tds_amount: number
          token_expires_at: string | null
          updated_at: string
          viewed_at: string | null
          year: number
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          debit_note_number: string
          deleted_at?: string
          deleted_reason?: string | null
          dsa_id?: string | null
          email_sent?: boolean
          email_sent_at?: string | null
          generated_at?: string
          id?: string
          month: number
          net_payable_amount?: number
          paid_at?: string | null
          paid_by?: string | null
          payout_amount?: number
          pdf_snapshot?: Json | null
          pdf_url?: string
          secure_token?: string | null
          sent_at?: string | null
          sent_by?: string | null
          signature_image_path?: string | null
          signature_status?: string
          signed_at?: string | null
          signed_pdf_url?: string | null
          signer_email?: string | null
          signer_ip?: string | null
          signer_user_agent?: string | null
          status?: string
          tds_amount?: number
          token_expires_at?: string | null
          updated_at?: string
          viewed_at?: string | null
          year: number
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          debit_note_number?: string
          deleted_at?: string
          deleted_reason?: string | null
          dsa_id?: string | null
          email_sent?: boolean
          email_sent_at?: string | null
          generated_at?: string
          id?: string
          month?: number
          net_payable_amount?: number
          paid_at?: string | null
          paid_by?: string | null
          payout_amount?: number
          pdf_snapshot?: Json | null
          pdf_url?: string
          secure_token?: string | null
          sent_at?: string | null
          sent_by?: string | null
          signature_image_path?: string | null
          signature_status?: string
          signed_at?: string | null
          signed_pdf_url?: string | null
          signer_email?: string | null
          signer_ip?: string | null
          signer_user_agent?: string | null
          status?: string
          tds_amount?: number
          token_expires_at?: string | null
          updated_at?: string
          viewed_at?: string | null
          year?: number
        }
        Relationships: []
      }
      incentive_slabs: {
        Row: {
          created_at: string | null
          id: string
          max_multiple: number | null
          min_multiple: number
          revenue_share_percentage: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          max_multiple?: number | null
          min_multiple: number
          revenue_share_percentage: number
        }
        Update: {
          created_at?: string | null
          id?: string
          max_multiple?: number | null
          min_multiple?: number
          revenue_share_percentage?: number
        }
        Relationships: []
      }
      mf_asset_class: {
        Row: {
          ambiguous: boolean
          amfi_category: string | null
          amfi_code: string | null
          asset_class: string | null
          effective_asset_class: string | null
          isin: string
          override_asset_class: string | null
          override_at: string | null
          override_by: string | null
          override_note: string | null
          scheme_name: string | null
          updated_at: string | null
        }
        Insert: {
          ambiguous?: boolean
          amfi_category?: string | null
          amfi_code?: string | null
          asset_class?: string | null
          effective_asset_class?: string | null
          isin: string
          override_asset_class?: string | null
          override_at?: string | null
          override_by?: string | null
          override_note?: string | null
          scheme_name?: string | null
          updated_at?: string | null
        }
        Update: {
          ambiguous?: boolean
          amfi_category?: string | null
          amfi_code?: string | null
          asset_class?: string | null
          effective_asset_class?: string | null
          isin?: string
          override_asset_class?: string | null
          override_at?: string | null
          override_by?: string | null
          override_note?: string | null
          scheme_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      mf_detail_cache: {
        Row: {
          created_at: string
          last_synced_at: string
          payload: Json
          scheme_code: string
        }
        Insert: {
          created_at?: string
          last_synced_at?: string
          payload: Json
          scheme_code: string
        }
        Update: {
          created_at?: string
          last_synced_at?: string
          payload?: Json
          scheme_code?: string
        }
        Relationships: []
      }
      mf_scheme_cache: {
        Row: {
          amfi_category: string | null
          category: string
          created_at: string
          current_nav: number | null
          fund_house: string
          last_synced_at: string
          launch_date: string | null
          nav_date: string | null
          return_1y: number | null
          return_3y: number | null
          return_5y: number | null
          return_6m: number | null
          return_si: number | null
          returns_error: string | null
          returns_synced_at: string | null
          scheme_code: string
          scheme_name: string
          search_name: string
        }
        Insert: {
          amfi_category?: string | null
          category?: string
          created_at?: string
          current_nav?: number | null
          fund_house?: string
          last_synced_at?: string
          launch_date?: string | null
          nav_date?: string | null
          return_1y?: number | null
          return_3y?: number | null
          return_5y?: number | null
          return_6m?: number | null
          return_si?: number | null
          returns_error?: string | null
          returns_synced_at?: string | null
          scheme_code: string
          scheme_name?: string
          search_name?: string
        }
        Update: {
          amfi_category?: string | null
          category?: string
          created_at?: string
          current_nav?: number | null
          fund_house?: string
          last_synced_at?: string
          launch_date?: string | null
          nav_date?: string | null
          return_1y?: number | null
          return_3y?: number | null
          return_5y?: number | null
          return_6m?: number | null
          return_si?: number | null
          returns_error?: string | null
          returns_synced_at?: string | null
          scheme_code?: string
          scheme_name?: string
          search_name?: string
        }
        Relationships: []
      }
      mkt_approval_events: {
        Row: {
          action: string
          actor_employee_id: string | null
          content_id: string | null
          content_no: string
          created_at: string
          id: string
          note: string
        }
        Insert: {
          action: string
          actor_employee_id?: string | null
          content_id?: string | null
          content_no: string
          created_at?: string
          id?: string
          note?: string
        }
        Update: {
          action?: string
          actor_employee_id?: string | null
          content_id?: string | null
          content_no?: string
          created_at?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "mkt_approval_events_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mkt_approval_events_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "mkt_content"
            referencedColumns: ["id"]
          },
        ]
      }
      mkt_content: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body: string
          caption: string
          category: string
          content_no: string
          content_type: string
          created_at: string
          created_by: string | null
          cta: string
          design_spec: Json
          expires_at: string | null
          generation_meta: Json
          hashtags: string[]
          headline: string
          id: string
          platform_notes: Json
          platforms: string[]
          reject_reason: string
          scheduled_publish_at: string | null
          seo_keywords: string[]
          status: string
          suggested_post_time: string
          template_id: string
          title: string
          topic: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          caption?: string
          category?: string
          content_no?: string
          content_type: string
          created_at?: string
          created_by?: string | null
          cta?: string
          design_spec?: Json
          expires_at?: string | null
          generation_meta?: Json
          hashtags?: string[]
          headline?: string
          id?: string
          platform_notes?: Json
          platforms?: string[]
          reject_reason?: string
          scheduled_publish_at?: string | null
          seo_keywords?: string[]
          status?: string
          suggested_post_time?: string
          template_id?: string
          title?: string
          topic?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          caption?: string
          category?: string
          content_no?: string
          content_type?: string
          created_at?: string
          created_by?: string | null
          cta?: string
          design_spec?: Json
          expires_at?: string | null
          generation_meta?: Json
          hashtags?: string[]
          headline?: string
          id?: string
          platform_notes?: Json
          platforms?: string[]
          reject_reason?: string
          scheduled_publish_at?: string | null
          seo_keywords?: string[]
          status?: string
          suggested_post_time?: string
          template_id?: string
          title?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mkt_content_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mkt_content_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      mkt_content_assets: {
        Row: {
          content_id: string
          created_at: string
          duration_seconds: number | null
          file_size: number | null
          height: number | null
          id: string
          kind: string
          mime_type: string
          storage_path: string
          variant: string
          width: number | null
        }
        Insert: {
          content_id: string
          created_at?: string
          duration_seconds?: number | null
          file_size?: number | null
          height?: number | null
          id?: string
          kind: string
          mime_type?: string
          storage_path: string
          variant: string
          width?: number | null
        }
        Update: {
          content_id?: string
          created_at?: string
          duration_seconds?: number | null
          file_size?: number | null
          height?: number | null
          id?: string
          kind?: string
          mime_type?: string
          storage_path?: string
          variant?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mkt_content_assets_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "mkt_content"
            referencedColumns: ["id"]
          },
        ]
      }
      mkt_content_history: {
        Row: {
          approved_at: string | null
          category: string
          content_no: string
          content_type: string
          created_at: string | null
          created_by: string | null
          delete_reason: string
          deleted_at: string
          download_count: number
          final_status: string
          hashtags: string[]
          headline: string
          platforms: string[]
          title: string
          topic: string
        }
        Insert: {
          approved_at?: string | null
          category?: string
          content_no: string
          content_type?: string
          created_at?: string | null
          created_by?: string | null
          delete_reason: string
          deleted_at?: string
          download_count?: number
          final_status?: string
          hashtags?: string[]
          headline?: string
          platforms?: string[]
          title?: string
          topic?: string
        }
        Update: {
          approved_at?: string | null
          category?: string
          content_no?: string
          content_type?: string
          created_at?: string | null
          created_by?: string | null
          delete_reason?: string
          deleted_at?: string
          download_count?: number
          final_status?: string
          hashtags?: string[]
          headline?: string
          platforms?: string[]
          title?: string
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "mkt_content_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      mkt_deletion_logs: {
        Row: {
          assets_deleted: Json
          content_no: string
          created_at: string
          deleted_by: string | null
          id: string
          reason: string
        }
        Insert: {
          assets_deleted?: Json
          content_no: string
          created_at?: string
          deleted_by?: string | null
          id?: string
          reason: string
        }
        Update: {
          assets_deleted?: Json
          content_no?: string
          created_at?: string
          deleted_by?: string | null
          id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "mkt_deletion_logs_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      mkt_downloads: {
        Row: {
          channel: string
          content_id: string | null
          content_no: string
          created_at: string
          employee_id: string
          event_type: string
          id: string
          platform: string
          variant: string
        }
        Insert: {
          channel?: string
          content_id?: string | null
          content_no: string
          created_at?: string
          employee_id: string
          event_type: string
          id?: string
          platform?: string
          variant?: string
        }
        Update: {
          channel?: string
          content_id?: string | null
          content_no?: string
          created_at?: string
          employee_id?: string
          event_type?: string
          id?: string
          platform?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "mkt_downloads_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "mkt_content"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mkt_downloads_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      mkt_lead_attributions: {
        Row: {
          campaign_source: string
          client_id: string | null
          content_no: string | null
          created_at: string
          dsa_id: string | null
          employee_id: string
          id: string
          lead_id: string | null
          platform: string
          ref_code: string
        }
        Insert: {
          campaign_source?: string
          client_id?: string | null
          content_no?: string | null
          created_at?: string
          dsa_id?: string | null
          employee_id: string
          id?: string
          lead_id?: string | null
          platform?: string
          ref_code: string
        }
        Update: {
          campaign_source?: string
          client_id?: string | null
          content_no?: string | null
          created_at?: string
          dsa_id?: string | null
          employee_id?: string
          id?: string
          lead_id?: string | null
          platform?: string
          ref_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "mkt_lead_attributions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mkt_lead_attributions_dsa_id_fkey"
            columns: ["dsa_id"]
            isOneToOne: false
            referencedRelation: "nw_dsa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mkt_lead_attributions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mkt_lead_attributions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "nw_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      mkt_referral_clicks: {
        Row: {
          content_no: string | null
          created_at: string
          dsa_id: string | null
          employee_id: string | null
          id: string
          ip_hash: string
          platform: string
          ref_code: string
          user_agent: string
        }
        Insert: {
          content_no?: string | null
          created_at?: string
          dsa_id?: string | null
          employee_id?: string | null
          id?: string
          ip_hash?: string
          platform?: string
          ref_code: string
          user_agent?: string
        }
        Update: {
          content_no?: string | null
          created_at?: string
          dsa_id?: string | null
          employee_id?: string | null
          id?: string
          ip_hash?: string
          platform?: string
          ref_code?: string
          user_agent?: string
        }
        Relationships: [
          {
            foreignKeyName: "mkt_referral_clicks_dsa_id_fkey"
            columns: ["dsa_id"]
            isOneToOne: false
            referencedRelation: "nw_dsa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mkt_referral_clicks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      mkt_referral_links: {
        Row: {
          active: boolean
          created_at: string
          dsa_id: string | null
          employee_id: string | null
          id: string
          kind: string
          label: string | null
          ref_code: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          dsa_id?: string | null
          employee_id?: string | null
          id?: string
          kind?: string
          label?: string | null
          ref_code?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          dsa_id?: string | null
          employee_id?: string | null
          id?: string
          kind?: string
          label?: string | null
          ref_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "mkt_referral_links_dsa_id_fkey"
            columns: ["dsa_id"]
            isOneToOne: false
            referencedRelation: "nw_dsa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mkt_referral_links_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      mutual_funds: {
        Row: {
          aum: number | null
          category: string | null
          created_at: string | null
          current_nav: number | null
          expense_ratio: number | null
          fund_code: string | null
          fund_house: string | null
          fund_manager: string | null
          fund_name: string
          id: string
          launch_date: string | null
          min_investment: number | null
          nav_date: string | null
          return_1y: number | null
          return_3y: number | null
          return_5y: number | null
          return_6m: number | null
          return_si: number | null
          return_ytd: number | null
          risk_level: string | null
          sub_category: string | null
          updated_at: string | null
        }
        Insert: {
          aum?: number | null
          category?: string | null
          created_at?: string | null
          current_nav?: number | null
          expense_ratio?: number | null
          fund_code?: string | null
          fund_house?: string | null
          fund_manager?: string | null
          fund_name: string
          id?: string
          launch_date?: string | null
          min_investment?: number | null
          nav_date?: string | null
          return_1y?: number | null
          return_3y?: number | null
          return_5y?: number | null
          return_6m?: number | null
          return_si?: number | null
          return_ytd?: number | null
          risk_level?: string | null
          sub_category?: string | null
          updated_at?: string | null
        }
        Update: {
          aum?: number | null
          category?: string | null
          created_at?: string | null
          current_nav?: number | null
          expense_ratio?: number | null
          fund_code?: string | null
          fund_house?: string | null
          fund_manager?: string | null
          fund_name?: string
          id?: string
          launch_date?: string | null
          min_investment?: number | null
          nav_date?: string | null
          return_1y?: number | null
          return_3y?: number | null
          return_5y?: number | null
          return_6m?: number | null
          return_si?: number | null
          return_ytd?: number | null
          risk_level?: string | null
          sub_category?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      nav_daily: {
        Row: {
          amfi_code: string | null
          created_at: string | null
          isin: string
          nav: number
          nav_date: string
          scheme_name: string | null
        }
        Insert: {
          amfi_code?: string | null
          created_at?: string | null
          isin: string
          nav: number
          nav_date: string
          scheme_name?: string | null
        }
        Update: {
          amfi_code?: string | null
          created_at?: string | null
          isin?: string
          nav?: number
          nav_date?: string
          scheme_name?: string | null
        }
        Relationships: []
      }
      nav_refresh_log: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          nav_date: string | null
          ok: boolean | null
          rows_parsed: number | null
          rows_written: number | null
          started_at: string | null
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          nav_date?: string | null
          ok?: boolean | null
          rows_parsed?: number | null
          rows_written?: number | null
          started_at?: string | null
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          nav_date?: string | null
          ok?: boolean | null
          rows_parsed?: number | null
          rows_written?: number | null
          started_at?: string | null
        }
        Relationships: []
      }
      news: {
        Row: {
          category: string | null
          content: string | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          published_at: string | null
          source: string | null
          title: string
          url: string | null
        }
        Insert: {
          category?: string | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          published_at?: string | null
          source?: string | null
          title: string
          url?: string | null
        }
        Update: {
          category?: string | null
          content?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          published_at?: string | null
          source?: string | null
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      nsdl_securities: {
        Row: {
          created_at: string
          id: string
          isin: string
          isin_status: string
          last_synced_at: string
          name: string
          nsdl_id: string
          security_name: string
          security_type: string
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          isin: string
          isin_status?: string
          last_synced_at?: string
          name?: string
          nsdl_id?: string
          security_name?: string
          security_type?: string
          source?: string
        }
        Update: {
          created_at?: string
          id?: string
          isin?: string
          isin_status?: string
          last_synced_at?: string
          name?: string
          nsdl_id?: string
          security_name?: string
          security_type?: string
          source?: string
        }
        Relationships: []
      }
      nw_activity_logs: {
        Row: {
          action: string
          client_id: string | null
          created_at: string | null
          description: string | null
          employee_id: string | null
          id: string
        }
        Insert: {
          action: string
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          employee_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          employee_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_activity_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_activity_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_alerts: {
        Row: {
          action_url: string | null
          category: string | null
          created_at: string | null
          employee_id: string | null
          id: string
          lead_id: string | null
          message: string | null
          read: boolean | null
          title: string
        }
        Insert: {
          action_url?: string | null
          category?: string | null
          created_at?: string | null
          employee_id?: string | null
          id?: string
          lead_id?: string | null
          message?: string | null
          read?: boolean | null
          title: string
        }
        Update: {
          action_url?: string | null
          category?: string | null
          created_at?: string | null
          employee_id?: string | null
          id?: string
          lead_id?: string | null
          message?: string | null
          read?: boolean | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_alerts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_alerts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "nw_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_client_bank_accounts: {
        Row: {
          account_number: string
          bank_name: string
          client_id: string
          created_at: string
          holder_name: string
          id: string
          ifsc: string
          is_primary: boolean
          label: string
          updated_at: string
        }
        Insert: {
          account_number: string
          bank_name?: string
          client_id: string
          created_at?: string
          holder_name?: string
          id?: string
          ifsc?: string
          is_primary?: boolean
          label?: string
          updated_at?: string
        }
        Update: {
          account_number?: string
          bank_name?: string
          client_id?: string
          created_at?: string
          holder_name?: string
          id?: string
          ifsc?: string
          is_primary?: boolean
          label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_client_bank_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_client_device_pins: {
        Row: {
          client_id: string
          created_at: string
          device_id: string
          device_label: string | null
          expires_at: string
          failed_attempts: number
          id: string
          last_used_at: string | null
          locked_until: string | null
          pin_hash: string
          pin_iterations: number
          pin_salt: string
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          device_id: string
          device_label?: string | null
          expires_at: string
          failed_attempts?: number
          id?: string
          last_used_at?: string | null
          locked_until?: string | null
          pin_hash: string
          pin_iterations: number
          pin_salt: string
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          device_id?: string
          device_label?: string | null
          expires_at?: string
          failed_attempts?: number
          id?: string
          last_used_at?: string | null
          locked_until?: string | null
          pin_hash?: string
          pin_iterations?: number
          pin_salt?: string
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_client_device_pins_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_client_documents: {
        Row: {
          client_id: string
          created_at: string | null
          doc_type: string
          file_name: string
          file_url: string
          id: string
          uploaded_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          doc_type: string
          file_name: string
          file_url: string
          id?: string
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          doc_type?: string
          file_name?: string
          file_url?: string
          id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_client_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_client_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_client_login_audit: {
        Row: {
          action: string
          client_id: string | null
          created_at: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          client_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          client_id?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "nw_client_login_audit_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_client_password_reset_otps: {
        Row: {
          attempts: number
          client_id: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          otp_hash: string
          used: boolean
        }
        Insert: {
          attempts?: number
          client_id?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          otp_hash: string
          used?: boolean
        }
        Update: {
          attempts?: number
          client_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          otp_hash?: string
          used?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "nw_client_password_reset_otps_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_clients: {
        Row: {
          address: string | null
          avatar_url: string | null
          bank_account: string | null
          bank_ifsc: string | null
          bank_name: string | null
          bank_verified: boolean
          bse_ucc: string | null
          bse_ucc_status: string | null
          bse_ucc_synced_at: string | null
          city: string | null
          client_auth_user_id: string | null
          client_code: string
          client_login_enabled: boolean | null
          client_password_changed: boolean | null
          cml_required: boolean
          cml_uploaded: boolean
          created_at: string | null
          demat_account: string | null
          depository: string
          dob: string | null
          dp_name: string | null
          dsa_id: string | null
          email: string | null
          employee_id: string | null
          full_name: string
          gender: string | null
          id: string
          investment_preferences: string[]
          kyc_submitted_at: string | null
          notes: string | null
          onboarding_status: string
          pan: string | null
          pan_doc_uploaded: boolean
          pan_name: string | null
          pan_verified: boolean
          phone: string | null
          phone_verified: boolean
          pincode: string | null
          portfolio_value: number | null
          sourced_via: string
          state: string | null
          updated_at: string | null
          verification_status: string
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          bank_account?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          bank_verified?: boolean
          bse_ucc?: string | null
          bse_ucc_status?: string | null
          bse_ucc_synced_at?: string | null
          city?: string | null
          client_auth_user_id?: string | null
          client_code: string
          client_login_enabled?: boolean | null
          client_password_changed?: boolean | null
          cml_required?: boolean
          cml_uploaded?: boolean
          created_at?: string | null
          demat_account?: string | null
          depository?: string
          dob?: string | null
          dp_name?: string | null
          dsa_id?: string | null
          email?: string | null
          employee_id?: string | null
          full_name: string
          gender?: string | null
          id?: string
          investment_preferences?: string[]
          kyc_submitted_at?: string | null
          notes?: string | null
          onboarding_status?: string
          pan?: string | null
          pan_doc_uploaded?: boolean
          pan_name?: string | null
          pan_verified?: boolean
          phone?: string | null
          phone_verified?: boolean
          pincode?: string | null
          portfolio_value?: number | null
          sourced_via?: string
          state?: string | null
          updated_at?: string | null
          verification_status?: string
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          bank_account?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          bank_verified?: boolean
          bse_ucc?: string | null
          bse_ucc_status?: string | null
          bse_ucc_synced_at?: string | null
          city?: string | null
          client_auth_user_id?: string | null
          client_code?: string
          client_login_enabled?: boolean | null
          client_password_changed?: boolean | null
          cml_required?: boolean
          cml_uploaded?: boolean
          created_at?: string | null
          demat_account?: string | null
          depository?: string
          dob?: string | null
          dp_name?: string | null
          dsa_id?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: string
          gender?: string | null
          id?: string
          investment_preferences?: string[]
          kyc_submitted_at?: string | null
          notes?: string | null
          onboarding_status?: string
          pan?: string | null
          pan_doc_uploaded?: boolean
          pan_name?: string | null
          pan_verified?: boolean
          phone?: string | null
          phone_verified?: boolean
          pincode?: string | null
          portfolio_value?: number | null
          sourced_via?: string
          state?: string | null
          updated_at?: string | null
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_clients_dsa_id_fkey"
            columns: ["dsa_id"]
            isOneToOne: false
            referencedRelation: "nw_dsa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_clients_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_deal_confirmation_events: {
        Row: {
          actor: string
          created_at: string
          deal_id: string
          event_type: string
          id: string
          ip: string | null
          metadata: Json
          user_agent: string | null
        }
        Insert: {
          actor?: string
          created_at?: string
          deal_id: string
          event_type: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
        }
        Update: {
          actor?: string
          created_at?: string
          deal_id?: string
          event_type?: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_deal_confirmation_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_confirmation_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_overall_stage"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_confirmation_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_payment_summary"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_confirmation_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_eligible"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_confirmation_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_pending_acceptance"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      nw_deal_confirmations: {
        Row: {
          acceptance_status: string
          accepted_at: string | null
          base_rate: number | null
          brokerage_amount: number | null
          client_id: string | null
          confirmation_number: string
          created_at: string
          deal_date: string
          email_sent_at: string | null
          email_sent_by: string | null
          email_status: string
          employee_id: string | null
          id: string
          insurance_revenue: number | null
          isin: string
          landing_cost: number | null
          notes: string
          product_type: string
          quantity: number
          rate_per_unit: number
          rejected_at: string | null
          rejection_reason: string | null
          revenue_basis_entered_at: string | null
          revenue_basis_entered_by: string | null
          revenue_basis_last_modified_at: string | null
          revenue_basis_last_modified_by: string | null
          secure_token: string | null
          security_name: string
          settlement_amount: number | null
          signature_image_path: string | null
          signed_pdf_path: string | null
          signer_email: string | null
          signer_ip: string | null
          signer_user_agent: string | null
          snap_address: string
          snap_bank_account: string
          snap_bank_ifsc: string
          snap_bank_name: string
          snap_client_name: string
          snap_demat_account: string
          snap_depository: string
          snap_dp_name: string
          snap_email: string
          snap_pan: string
          snap_phone: string
          stamp_duty: number | null
          stamp_duty_rate: number | null
          status: string
          tc_accepted_at: string | null
          token_expires_at: string | null
          trail_percent: number | null
          trail_start_date: string | null
          transaction_type: string
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          acceptance_status?: string
          accepted_at?: string | null
          base_rate?: number | null
          brokerage_amount?: number | null
          client_id?: string | null
          confirmation_number?: string
          created_at?: string
          deal_date: string
          email_sent_at?: string | null
          email_sent_by?: string | null
          email_status?: string
          employee_id?: string | null
          id?: string
          insurance_revenue?: number | null
          isin?: string
          landing_cost?: number | null
          notes?: string
          product_type?: string
          quantity?: number
          rate_per_unit?: number
          rejected_at?: string | null
          rejection_reason?: string | null
          revenue_basis_entered_at?: string | null
          revenue_basis_entered_by?: string | null
          revenue_basis_last_modified_at?: string | null
          revenue_basis_last_modified_by?: string | null
          secure_token?: string | null
          security_name?: string
          settlement_amount?: number | null
          signature_image_path?: string | null
          signed_pdf_path?: string | null
          signer_email?: string | null
          signer_ip?: string | null
          signer_user_agent?: string | null
          snap_address?: string
          snap_bank_account?: string
          snap_bank_ifsc?: string
          snap_bank_name?: string
          snap_client_name?: string
          snap_demat_account?: string
          snap_depository?: string
          snap_dp_name?: string
          snap_email?: string
          snap_pan?: string
          snap_phone?: string
          stamp_duty?: number | null
          stamp_duty_rate?: number | null
          status?: string
          tc_accepted_at?: string | null
          token_expires_at?: string | null
          trail_percent?: number | null
          trail_start_date?: string | null
          transaction_type?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          acceptance_status?: string
          accepted_at?: string | null
          base_rate?: number | null
          brokerage_amount?: number | null
          client_id?: string | null
          confirmation_number?: string
          created_at?: string
          deal_date?: string
          email_sent_at?: string | null
          email_sent_by?: string | null
          email_status?: string
          employee_id?: string | null
          id?: string
          insurance_revenue?: number | null
          isin?: string
          landing_cost?: number | null
          notes?: string
          product_type?: string
          quantity?: number
          rate_per_unit?: number
          rejected_at?: string | null
          rejection_reason?: string | null
          revenue_basis_entered_at?: string | null
          revenue_basis_entered_by?: string | null
          revenue_basis_last_modified_at?: string | null
          revenue_basis_last_modified_by?: string | null
          secure_token?: string | null
          security_name?: string
          settlement_amount?: number | null
          signature_image_path?: string | null
          signed_pdf_path?: string | null
          signer_email?: string | null
          signer_ip?: string | null
          signer_user_agent?: string | null
          snap_address?: string
          snap_bank_account?: string
          snap_bank_ifsc?: string
          snap_bank_name?: string
          snap_client_name?: string
          snap_demat_account?: string
          snap_depository?: string
          snap_dp_name?: string
          snap_email?: string
          snap_pan?: string
          snap_phone?: string
          stamp_duty?: number | null
          stamp_duty_rate?: number | null
          status?: string
          tc_accepted_at?: string | null
          token_expires_at?: string | null
          trail_percent?: number | null
          trail_start_date?: string | null
          transaction_type?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_deal_confirmations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_confirmations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_confirmations_revenue_basis_entered_by_fkey"
            columns: ["revenue_basis_entered_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_confirmations_revenue_basis_last_modified_by_fkey"
            columns: ["revenue_basis_last_modified_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_deal_email_log: {
        Row: {
          cc_recipients: string[]
          created_at: string
          deal_confirmation_id: string
          email_type: string
          id: string
          is_resend: boolean
          metadata: Json
          payment_id: string | null
          provider_message_id: string | null
          sent_at: string
          sent_by: string | null
          sent_to: string
          status: string
        }
        Insert: {
          cc_recipients?: string[]
          created_at?: string
          deal_confirmation_id: string
          email_type: string
          id?: string
          is_resend?: boolean
          metadata?: Json
          payment_id?: string | null
          provider_message_id?: string | null
          sent_at?: string
          sent_by?: string | null
          sent_to?: string
          status?: string
        }
        Update: {
          cc_recipients?: string[]
          created_at?: string
          deal_confirmation_id?: string
          email_type?: string
          id?: string
          is_resend?: boolean
          metadata?: Json
          payment_id?: string | null
          provider_message_id?: string | null
          sent_at?: string
          sent_by?: string | null
          sent_to?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_deal_email_log_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_email_log_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_overall_stage"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_email_log_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_payment_summary"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_email_log_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_eligible"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_email_log_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_pending_acceptance"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_email_log_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_email_log_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_deal_otps: {
        Row: {
          attempts: number
          created_at: string
          deal_id: string
          email: string
          expires_at: string
          id: string
          otp_hash: string
          purpose: string
          token: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          deal_id: string
          email: string
          expires_at: string
          id?: string
          otp_hash: string
          purpose: string
          token: string
        }
        Update: {
          attempts?: number
          created_at?: string
          deal_id?: string
          email?: string
          expires_at?: string
          id?: string
          otp_hash?: string
          purpose?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_deal_otps_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_otps_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_overall_stage"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_otps_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_payment_summary"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_otps_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_eligible"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_otps_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_pending_acceptance"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      nw_deal_payments: {
        Row: {
          amount: number
          amount_inr: number | null
          bank_statement_ref: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cheque_bank: string | null
          cheque_dated: string | null
          cheque_number: string | null
          created_at: string
          created_by: string | null
          currency: string
          deal_confirmation_id: string
          demand_draft_number: string | null
          direction: string
          external_ref: string | null
          fx_rate_to_inr: number | null
          id: string
          payment_date: string
          payment_mode: string
          payment_number: string
          posted_at: string | null
          posted_by: string | null
          provider: string | null
          provider_order_id: string | null
          provider_payload: Json
          provider_payment_id: string | null
          provider_signature: string | null
          provider_status: string | null
          receipt_generated_at: string | null
          receipt_generated_by: string | null
          receipt_last_emailed_at: string | null
          receipt_number: string | null
          receipt_pdf_path: string | null
          receipt_regen_count: number
          received_at: string
          received_by: string | null
          received_from_bank: string | null
          received_from_name: string
          reconciled_at: string | null
          reconciled_by: string | null
          reconciliation_status: string
          remarks: string
          reverses_payment_id: string | null
          row_version: number
          status: string
          supporting_docs: Json
          updated_at: string
          updated_by: string | null
          utr_number: string | null
          value_date: string | null
        }
        Insert: {
          amount: number
          amount_inr?: number | null
          bank_statement_ref?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cheque_bank?: string | null
          cheque_dated?: string | null
          cheque_number?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_confirmation_id: string
          demand_draft_number?: string | null
          direction?: string
          external_ref?: string | null
          fx_rate_to_inr?: number | null
          id?: string
          payment_date: string
          payment_mode: string
          payment_number: string
          posted_at?: string | null
          posted_by?: string | null
          provider?: string | null
          provider_order_id?: string | null
          provider_payload?: Json
          provider_payment_id?: string | null
          provider_signature?: string | null
          provider_status?: string | null
          receipt_generated_at?: string | null
          receipt_generated_by?: string | null
          receipt_last_emailed_at?: string | null
          receipt_number?: string | null
          receipt_pdf_path?: string | null
          receipt_regen_count?: number
          received_at?: string
          received_by?: string | null
          received_from_bank?: string | null
          received_from_name?: string
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_status?: string
          remarks?: string
          reverses_payment_id?: string | null
          row_version?: number
          status?: string
          supporting_docs?: Json
          updated_at?: string
          updated_by?: string | null
          utr_number?: string | null
          value_date?: string | null
        }
        Update: {
          amount?: number
          amount_inr?: number | null
          bank_statement_ref?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cheque_bank?: string | null
          cheque_dated?: string | null
          cheque_number?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_confirmation_id?: string
          demand_draft_number?: string | null
          direction?: string
          external_ref?: string | null
          fx_rate_to_inr?: number | null
          id?: string
          payment_date?: string
          payment_mode?: string
          payment_number?: string
          posted_at?: string | null
          posted_by?: string | null
          provider?: string | null
          provider_order_id?: string | null
          provider_payload?: Json
          provider_payment_id?: string | null
          provider_signature?: string | null
          provider_status?: string | null
          receipt_generated_at?: string | null
          receipt_generated_by?: string | null
          receipt_last_emailed_at?: string | null
          receipt_number?: string | null
          receipt_pdf_path?: string | null
          receipt_regen_count?: number
          received_at?: string
          received_by?: string | null
          received_from_bank?: string | null
          received_from_name?: string
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciliation_status?: string
          remarks?: string
          reverses_payment_id?: string | null
          row_version?: number
          status?: string
          supporting_docs?: Json
          updated_at?: string
          updated_by?: string | null
          utr_number?: string | null
          value_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_deal_payments_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_payments_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_payments_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_overall_stage"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_payments_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_payment_summary"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_payments_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_eligible"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_payments_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_pending_acceptance"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_deal_payments_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_payments_receipt_generated_by_fkey"
            columns: ["receipt_generated_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_payments_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_payments_reconciled_by_fkey"
            columns: ["reconciled_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_payments_reverses_payment_id_fkey"
            columns: ["reverses_payment_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_payments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_document_logs: {
        Row: {
          action_type: string
          client_id: string | null
          created_at: string
          document_id: string | null
          employee_id: string | null
          file_name: string | null
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          action_type?: string
          client_id?: string | null
          created_at?: string
          document_id?: string | null
          employee_id?: string | null
          file_name?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          action_type?: string
          client_id?: string | null
          created_at?: string
          document_id?: string | null
          employee_id?: string | null
          file_name?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_document_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_document_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_documents: {
        Row: {
          bank_account_id: string | null
          client_id: string
          created_at: string
          document_type: string
          employee_id: string | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          uploaded_at: string
          uploaded_by_name: string | null
        }
        Insert: {
          bank_account_id?: string | null
          client_id: string
          created_at?: string
          document_type?: string
          employee_id?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          uploaded_at?: string
          uploaded_by_name?: string | null
        }
        Update: {
          bank_account_id?: string | null
          client_id?: string
          created_at?: string
          document_type?: string
          employee_id?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          uploaded_at?: string
          uploaded_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_documents_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "nw_client_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_dsa: {
        Row: {
          address: string
          bank_account: string
          bank_doc_url: string | null
          bank_ifsc: string
          bank_name: string
          created_at: string | null
          dsa_auth_user_id: string | null
          dsa_code: string
          dsa_last_login_at: string | null
          dsa_login_enabled: boolean
          dsa_password_changed: boolean
          email: string
          employee_id: string | null
          full_name: string
          id: string
          mobile: string
          notes: string
          pan: string
          pan_doc_url: string | null
          photo_url: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          address?: string
          bank_account?: string
          bank_doc_url?: string | null
          bank_ifsc?: string
          bank_name?: string
          created_at?: string | null
          dsa_auth_user_id?: string | null
          dsa_code: string
          dsa_last_login_at?: string | null
          dsa_login_enabled?: boolean
          dsa_password_changed?: boolean
          email?: string
          employee_id?: string | null
          full_name?: string
          id?: string
          mobile?: string
          notes?: string
          pan?: string
          pan_doc_url?: string | null
          photo_url?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          address?: string
          bank_account?: string
          bank_doc_url?: string | null
          bank_ifsc?: string
          bank_name?: string
          created_at?: string | null
          dsa_auth_user_id?: string | null
          dsa_code?: string
          dsa_last_login_at?: string | null
          dsa_login_enabled?: boolean
          dsa_password_changed?: boolean
          email?: string
          employee_id?: string | null
          full_name?: string
          id?: string
          mobile?: string
          notes?: string
          pan?: string
          pan_doc_url?: string | null
          photo_url?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_dsa_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_dsa_device_pins: {
        Row: {
          created_at: string
          device_id: string
          device_label: string | null
          dsa_id: string
          expires_at: string
          failed_attempts: number
          id: string
          last_used_at: string | null
          locked_until: string | null
          pin_hash: string
          pin_iterations: number
          pin_salt: string
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_id: string
          device_label?: string | null
          dsa_id: string
          expires_at: string
          failed_attempts?: number
          id?: string
          last_used_at?: string | null
          locked_until?: string | null
          pin_hash: string
          pin_iterations: number
          pin_salt: string
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          device_label?: string | null
          dsa_id?: string
          expires_at?: string
          failed_attempts?: number
          id?: string
          last_used_at?: string | null
          locked_until?: string | null
          pin_hash?: string
          pin_iterations?: number
          pin_salt?: string
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_dsa_device_pins_dsa_id_fkey"
            columns: ["dsa_id"]
            isOneToOne: false
            referencedRelation: "nw_dsa"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_dsa_login_audit: {
        Row: {
          action: string
          actor: string
          created_at: string
          dsa_id: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor?: string
          created_at?: string
          dsa_id?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          dsa_id?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "nw_dsa_login_audit_dsa_id_fkey"
            columns: ["dsa_id"]
            isOneToOne: false
            referencedRelation: "nw_dsa"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_dsa_password_reset_otps: {
        Row: {
          attempts: number
          created_at: string
          dsa_id: string | null
          email: string
          expires_at: string
          id: string
          otp_hash: string
          used: boolean
        }
        Insert: {
          attempts?: number
          created_at?: string
          dsa_id?: string | null
          email: string
          expires_at: string
          id?: string
          otp_hash: string
          used?: boolean
        }
        Update: {
          attempts?: number
          created_at?: string
          dsa_id?: string | null
          email?: string
          expires_at?: string
          id?: string
          otp_hash?: string
          used?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "nw_dsa_password_reset_otps_dsa_id_fkey"
            columns: ["dsa_id"]
            isOneToOne: false
            referencedRelation: "nw_dsa"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_dsa_sequence: {
        Row: {
          employee_id: string
          last_seq: number
        }
        Insert: {
          employee_id: string
          last_seq?: number
        }
        Update: {
          employee_id?: string
          last_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "nw_dsa_sequence_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_employee_device_pins: {
        Row: {
          created_at: string
          device_id: string
          device_label: string | null
          employee_id: string
          expires_at: string
          failed_attempts: number
          id: string
          last_used_at: string | null
          locked_until: string | null
          pin_hash: string
          pin_iterations: number
          pin_salt: string
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_id: string
          device_label?: string | null
          employee_id: string
          expires_at: string
          failed_attempts?: number
          id?: string
          last_used_at?: string | null
          locked_until?: string | null
          pin_hash: string
          pin_iterations: number
          pin_salt: string
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          device_label?: string | null
          employee_id?: string
          expires_at?: string
          failed_attempts?: number
          id?: string
          last_used_at?: string | null
          locked_until?: string | null
          pin_hash?: string
          pin_iterations?: number
          pin_salt?: string
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_employee_device_pins_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_employee_offboarding_log: {
        Row: {
          created_at: string
          deleted_by_employee_id: string | null
          deleted_by_name: string | null
          designation: string | null
          email: string | null
          employee_code: string
          full_name: string
          id: string
          impact: Json
          joining_date: string | null
          reason: string | null
          reassigned_to_employee_id: string | null
          reassigned_to_name: string | null
          role: string | null
        }
        Insert: {
          created_at?: string
          deleted_by_employee_id?: string | null
          deleted_by_name?: string | null
          designation?: string | null
          email?: string | null
          employee_code: string
          full_name: string
          id?: string
          impact?: Json
          joining_date?: string | null
          reason?: string | null
          reassigned_to_employee_id?: string | null
          reassigned_to_name?: string | null
          role?: string | null
        }
        Update: {
          created_at?: string
          deleted_by_employee_id?: string | null
          deleted_by_name?: string | null
          designation?: string | null
          email?: string | null
          employee_code?: string
          full_name?: string
          id?: string
          impact?: Json
          joining_date?: string | null
          reason?: string | null
          reassigned_to_employee_id?: string | null
          reassigned_to_name?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_employee_offboarding_log_deleted_by_employee_id_fkey"
            columns: ["deleted_by_employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_employee_offboarding_log_reassigned_to_employee_id_fkey"
            columns: ["reassigned_to_employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_employees: {
        Row: {
          auth_user_id: string | null
          avatar_url: string | null
          created_at: string | null
          designation: string | null
          email: string
          employee_code: string
          euin: string | null
          full_name: string
          id: string
          joining_date: string | null
          password_changed: boolean
          phone: string | null
          role: string
          status: string
          updated_at: string | null
        }
        Insert: {
          auth_user_id?: string | null
          avatar_url?: string | null
          created_at?: string | null
          designation?: string | null
          email: string
          employee_code: string
          euin?: string | null
          full_name: string
          id?: string
          joining_date?: string | null
          password_changed?: boolean
          phone?: string | null
          role?: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          auth_user_id?: string | null
          avatar_url?: string | null
          created_at?: string | null
          designation?: string | null
          email?: string
          employee_code?: string
          euin?: string | null
          full_name?: string
          id?: string
          joining_date?: string | null
          password_changed?: boolean
          phone?: string | null
          role?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      nw_holdings: {
        Row: {
          avg_cost: number | null
          client_id: string
          client_price: number | null
          coupon_rate: number | null
          created_at: string | null
          current_nav: number | null
          current_value: number | null
          dsa_price: number | null
          face_value: number | null
          folio_number: string | null
          fund_house: string | null
          id: string
          insurance_revenue: number | null
          insurance_revenue_pct: number | null
          insurance_type: string | null
          insurer_name: string | null
          interest_payout_amount: number | null
          interest_payout_date: string | null
          invested_amount: number | null
          isin: string | null
          issuer_name: string | null
          landing_cost: number | null
          maturity_date: string | null
          nav_date: string | null
          nominee_name: string | null
          notes: string | null
          payout_date_pattern: string | null
          payout_frequency: string | null
          policy_number: string | null
          policy_start_date: string | null
          premium_amount: number | null
          premium_due_date: string | null
          premium_frequency: string | null
          product_name: string
          product_type: string
          purchase_nav: number | null
          quantity: number | null
          scheme_type: string | null
          sum_assured: number | null
          trail_percent: number | null
          trail_rate: number | null
          trail_start_date: string | null
          txn_date: string | null
          updated_at: string | null
        }
        Insert: {
          avg_cost?: number | null
          client_id: string
          client_price?: number | null
          coupon_rate?: number | null
          created_at?: string | null
          current_nav?: number | null
          current_value?: number | null
          dsa_price?: number | null
          face_value?: number | null
          folio_number?: string | null
          fund_house?: string | null
          id?: string
          insurance_revenue?: number | null
          insurance_revenue_pct?: number | null
          insurance_type?: string | null
          insurer_name?: string | null
          interest_payout_amount?: number | null
          interest_payout_date?: string | null
          invested_amount?: number | null
          isin?: string | null
          issuer_name?: string | null
          landing_cost?: number | null
          maturity_date?: string | null
          nav_date?: string | null
          nominee_name?: string | null
          notes?: string | null
          payout_date_pattern?: string | null
          payout_frequency?: string | null
          policy_number?: string | null
          policy_start_date?: string | null
          premium_amount?: number | null
          premium_due_date?: string | null
          premium_frequency?: string | null
          product_name: string
          product_type: string
          purchase_nav?: number | null
          quantity?: number | null
          scheme_type?: string | null
          sum_assured?: number | null
          trail_percent?: number | null
          trail_rate?: number | null
          trail_start_date?: string | null
          txn_date?: string | null
          updated_at?: string | null
        }
        Update: {
          avg_cost?: number | null
          client_id?: string
          client_price?: number | null
          coupon_rate?: number | null
          created_at?: string | null
          current_nav?: number | null
          current_value?: number | null
          dsa_price?: number | null
          face_value?: number | null
          folio_number?: string | null
          fund_house?: string | null
          id?: string
          insurance_revenue?: number | null
          insurance_revenue_pct?: number | null
          insurance_type?: string | null
          insurer_name?: string | null
          interest_payout_amount?: number | null
          interest_payout_date?: string | null
          invested_amount?: number | null
          isin?: string | null
          issuer_name?: string | null
          landing_cost?: number | null
          maturity_date?: string | null
          nav_date?: string | null
          nominee_name?: string | null
          notes?: string | null
          payout_date_pattern?: string | null
          payout_frequency?: string | null
          policy_number?: string | null
          policy_start_date?: string | null
          premium_amount?: number | null
          premium_due_date?: string | null
          premium_frequency?: string | null
          product_name?: string
          product_type?: string
          purchase_nav?: number | null
          quantity?: number | null
          scheme_type?: string | null
          sum_assured?: number | null
          trail_percent?: number | null
          trail_rate?: number | null
          trail_start_date?: string | null
          txn_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_holdings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_lead_activities: {
        Row: {
          action: string
          created_at: string
          description: string
          employee_id: string | null
          id: string
          lead_id: string
          metadata: Json
        }
        Insert: {
          action: string
          created_at?: string
          description?: string
          employee_id?: string | null
          id?: string
          lead_id: string
          metadata?: Json
        }
        Update: {
          action?: string
          created_at?: string
          description?: string
          employee_id?: string | null
          id?: string
          lead_id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "nw_lead_activities_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "nw_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_lead_assignments: {
        Row: {
          assigned_by_employee_id: string | null
          created_at: string
          from_employee_id: string | null
          id: string
          lead_id: string
          reason: string
          to_employee_id: string | null
        }
        Insert: {
          assigned_by_employee_id?: string | null
          created_at?: string
          from_employee_id?: string | null
          id?: string
          lead_id: string
          reason?: string
          to_employee_id?: string | null
        }
        Update: {
          assigned_by_employee_id?: string | null
          created_at?: string
          from_employee_id?: string | null
          id?: string
          lead_id?: string
          reason?: string
          to_employee_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_lead_assignments_assigned_by_employee_id_fkey"
            columns: ["assigned_by_employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_assignments_from_employee_id_fkey"
            columns: ["from_employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "nw_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_assignments_to_employee_id_fkey"
            columns: ["to_employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_lead_audit: {
        Row: {
          created_at: string
          employee_id: string | null
          field_name: string
          id: string
          lead_id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          field_name: string
          id?: string
          lead_id: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          field_name?: string
          id?: string
          lead_id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_lead_audit_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_audit_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "nw_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_lead_communications: {
        Row: {
          comm_type: string
          created_at: string
          direction: string
          duration_seconds: number | null
          employee_id: string | null
          id: string
          lead_id: string
          outcome: string
          remarks: string
        }
        Insert: {
          comm_type?: string
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          employee_id?: string | null
          id?: string
          lead_id: string
          outcome?: string
          remarks?: string
        }
        Update: {
          comm_type?: string
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          employee_id?: string | null
          id?: string
          lead_id?: string
          outcome?: string
          remarks?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_lead_communications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_communications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "nw_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_lead_documents: {
        Row: {
          created_at: string
          doc_type: string
          employee_id: string | null
          file_name: string
          file_path: string
          file_size: number
          id: string
          lead_id: string
          mime_type: string
          uploaded_by_name: string
        }
        Insert: {
          created_at?: string
          doc_type?: string
          employee_id?: string | null
          file_name: string
          file_path: string
          file_size?: number
          id?: string
          lead_id: string
          mime_type?: string
          uploaded_by_name?: string
        }
        Update: {
          created_at?: string
          doc_type?: string
          employee_id?: string | null
          file_name?: string
          file_path?: string
          file_size?: number
          id?: string
          lead_id?: string
          mime_type?: string
          uploaded_by_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_lead_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_documents_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "nw_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_lead_duplicate_requests: {
        Row: {
          created_at: string
          existing_lead_id: string | null
          id: string
          payload: Json
          requested_by_employee_id: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          existing_lead_id?: string | null
          id?: string
          payload?: Json
          requested_by_employee_id?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          existing_lead_id?: string | null
          id?: string
          payload?: Json
          requested_by_employee_id?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_lead_duplicate_requests_existing_lead_id_fkey"
            columns: ["existing_lead_id"]
            isOneToOne: false
            referencedRelation: "nw_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_duplicate_requests_requested_by_employee_id_fkey"
            columns: ["requested_by_employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_duplicate_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_lead_followups: {
        Row: {
          completed_at: string | null
          created_at: string
          employee_id: string | null
          id: string
          lead_id: string
          mode: string
          outcome: string
          overdue_notified_at: string | null
          priority: string
          purpose: string
          reminded_at: string | null
          reminder_minutes: number
          scheduled_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          lead_id: string
          mode?: string
          outcome?: string
          overdue_notified_at?: string | null
          priority?: string
          purpose?: string
          reminded_at?: string | null
          reminder_minutes?: number
          scheduled_at: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          lead_id?: string
          mode?: string
          outcome?: string
          overdue_notified_at?: string | null
          priority?: string
          purpose?: string
          reminded_at?: string | null
          reminder_minutes?: number
          scheduled_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_lead_followups_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "nw_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_lead_notes: {
        Row: {
          created_at: string
          employee_id: string | null
          id: string
          lead_id: string
          remarks: string
          status_at_time: string
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          id?: string
          lead_id: string
          remarks: string
          status_at_time?: string
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          id?: string
          lead_id?: string
          remarks?: string
          status_at_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_lead_notes_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_notes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "nw_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_lead_saved_views: {
        Row: {
          created_at: string
          employee_id: string
          filters: Json
          id: string
          is_shared: boolean
          name: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          filters?: Json
          id?: string
          is_shared?: boolean
          name: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          filters?: Json
          id?: string
          is_shared?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_lead_saved_views_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_lead_status_history: {
        Row: {
          created_at: string
          employee_id: string | null
          from_status: string
          id: string
          lead_id: string
          to_status: string
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          from_status?: string
          id?: string
          lead_id: string
          to_status: string
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          from_status?: string
          id?: string
          lead_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_lead_status_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_lead_status_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "nw_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_leads: {
        Row: {
          address: string
          age: number | null
          alternate_number: string
          annual_income: number | null
          assigned_at: string | null
          campaign: string
          city: string
          company_name: string
          converted_at: string | null
          converted_client_id: string | null
          created_at: string
          created_by_employee_id: string | null
          dsa_id: string | null
          email: string
          first_call_at: string | null
          first_contact_at: string | null
          id: string
          interested_product: string
          investment_capacity: number | null
          is_archived: boolean
          is_locked: boolean
          last_activity_at: string | null
          last_followup_at: string | null
          lead_code: string
          lead_name: string
          lead_origin: string
          lead_score: number
          lead_source: string
          mobile: string
          occupation: string
          owner_employee_id: string | null
          pan: string
          priority: string
          remarks: string
          score_band: string
          state: string
          status: string
          updated_at: string
        }
        Insert: {
          address?: string
          age?: number | null
          alternate_number?: string
          annual_income?: number | null
          assigned_at?: string | null
          campaign?: string
          city?: string
          company_name?: string
          converted_at?: string | null
          converted_client_id?: string | null
          created_at?: string
          created_by_employee_id?: string | null
          dsa_id?: string | null
          email?: string
          first_call_at?: string | null
          first_contact_at?: string | null
          id?: string
          interested_product?: string
          investment_capacity?: number | null
          is_archived?: boolean
          is_locked?: boolean
          last_activity_at?: string | null
          last_followup_at?: string | null
          lead_code?: string
          lead_name: string
          lead_origin: string
          lead_score?: number
          lead_source?: string
          mobile?: string
          occupation?: string
          owner_employee_id?: string | null
          pan?: string
          priority?: string
          remarks?: string
          score_band?: string
          state?: string
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string
          age?: number | null
          alternate_number?: string
          annual_income?: number | null
          assigned_at?: string | null
          campaign?: string
          city?: string
          company_name?: string
          converted_at?: string | null
          converted_client_id?: string | null
          created_at?: string
          created_by_employee_id?: string | null
          dsa_id?: string | null
          email?: string
          first_call_at?: string | null
          first_contact_at?: string | null
          id?: string
          interested_product?: string
          investment_capacity?: number | null
          is_archived?: boolean
          is_locked?: boolean
          last_activity_at?: string | null
          last_followup_at?: string | null
          lead_code?: string
          lead_name?: string
          lead_origin?: string
          lead_score?: number
          lead_source?: string
          mobile?: string
          occupation?: string
          owner_employee_id?: string | null
          pan?: string
          priority?: string
          remarks?: string
          score_band?: string
          state?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_leads_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_leads_created_by_employee_id_fkey"
            columns: ["created_by_employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_leads_dsa_id_fkey"
            columns: ["dsa_id"]
            isOneToOne: false
            referencedRelation: "nw_dsa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_leads_owner_employee_id_fkey"
            columns: ["owner_employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_login_audit: {
        Row: {
          created_at: string
          email: string
          employee_id: string | null
          event: string
          id: string
          ip_hint: string | null
        }
        Insert: {
          created_at?: string
          email?: string
          employee_id?: string | null
          event?: string
          id?: string
          ip_hint?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          employee_id?: string | null
          event?: string
          id?: string
          ip_hint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_login_audit_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_mf_recommendations: {
        Row: {
          amfi_code: string
          created_at: string
          created_by: string | null
          fund_name: string
          headline: string | null
          id: string
          is_active: boolean
          rationale: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          amfi_code: string
          created_at?: string
          created_by?: string | null
          fund_name: string
          headline?: string | null
          id?: string
          is_active?: boolean
          rationale?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          amfi_code?: string
          created_at?: string
          created_by?: string | null
          fund_name?: string
          headline?: string | null
          id?: string
          is_active?: boolean
          rationale?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_mf_recommendations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_otps: {
        Row: {
          attempts: number
          created_at: string
          expires_at: string
          id: string
          otp: string | null
          otp_hash: string | null
          phone: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          expires_at: string
          id?: string
          otp?: string | null
          otp_hash?: string | null
          phone: string
        }
        Update: {
          attempts?: number
          created_at?: string
          expires_at?: string
          id?: string
          otp?: string | null
          otp_hash?: string | null
          phone?: string
        }
        Relationships: []
      }
      nw_pan_verify_attempts: {
        Row: {
          created_at: string
          id: string
          ip: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip: string
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string
        }
        Relationships: []
      }
      nw_password_reset_logs: {
        Row: {
          created_at: string
          email: string | null
          event: string
          id: string
          ip: string | null
          metadata: Json
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          event: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          event?: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
        }
        Relationships: []
      }
      nw_password_reset_otps: {
        Row: {
          attempts: number
          created_at: string
          email: string
          employee_id: string | null
          expires_at: string
          id: string
          otp_hash: string
          used: boolean
        }
        Insert: {
          attempts?: number
          created_at?: string
          email: string
          employee_id?: string | null
          expires_at: string
          id?: string
          otp_hash: string
          used?: boolean
        }
        Update: {
          attempts?: number
          created_at?: string
          email?: string
          employee_id?: string | null
          expires_at?: string
          id?: string
          otp_hash?: string
          used?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "nw_password_reset_otps_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_payment_webhook_events: {
        Row: {
          amount: number | null
          cf_payment_id: string | null
          deal_confirmation_id: string | null
          event_at: string | null
          event_type: string | null
          id: number
          link_id: string | null
          order_id: string | null
          payload: Json
          payment_id: string | null
          payment_status: string | null
          processing_note: string | null
          processing_status: string
          provider: string
          received_at: string
          signature_verified: boolean
          source_ip: string | null
        }
        Insert: {
          amount?: number | null
          cf_payment_id?: string | null
          deal_confirmation_id?: string | null
          event_at?: string | null
          event_type?: string | null
          id?: never
          link_id?: string | null
          order_id?: string | null
          payload: Json
          payment_id?: string | null
          payment_status?: string | null
          processing_note?: string | null
          processing_status?: string
          provider?: string
          received_at?: string
          signature_verified?: boolean
          source_ip?: string | null
        }
        Update: {
          amount?: number | null
          cf_payment_id?: string | null
          deal_confirmation_id?: string | null
          event_at?: string | null
          event_type?: string | null
          id?: never
          link_id?: string | null
          order_id?: string | null
          payload?: Json
          payment_id?: string | null
          payment_status?: string | null
          processing_note?: string | null
          processing_status?: string
          provider?: string
          received_at?: string
          signature_verified?: boolean
          source_ip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_payment_webhook_events_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_payment_webhook_events_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_overall_stage"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_payment_webhook_events_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_payment_summary"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_payment_webhook_events_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_eligible"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_payment_webhook_events_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_pending_acceptance"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_payment_webhook_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_support_tickets: {
        Row: {
          assigned_employee_id: string | null
          category: string
          client_id: string
          created_at: string
          id: string
          message: string
          priority: string
          ref: string
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          assigned_employee_id?: string | null
          category?: string
          client_id: string
          created_at?: string
          id?: string
          message: string
          priority?: string
          ref?: string
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          assigned_employee_id?: string | null
          category?: string
          client_id?: string
          created_at?: string
          id?: string
          message?: string
          priority?: string
          ref?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nw_support_tickets_assigned_employee_id_fkey"
            columns: ["assigned_employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_support_tickets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_transactions: {
        Row: {
          client_id: string
          client_price: number | null
          consolidated_amount: number
          coupon_rate: number | null
          created_at: string | null
          deal_confirmation_id: string | null
          dsa_code: string | null
          dsa_id: string | null
          dsa_price: number | null
          employee_id: string | null
          face_value: number | null
          folio_number: string | null
          fund_house: string | null
          id: string
          insurance_revenue: number | null
          insurance_revenue_pct: number | null
          insurance_type: string | null
          insurer_name: string | null
          interest_payout_date: string | null
          isin: string | null
          issuer_name: string | null
          landing_cost: number | null
          nav_date: string | null
          notes: string | null
          payout_date_pattern: string | null
          payout_frequency: string | null
          per_unit_price: number | null
          policy_number: string | null
          premium_amount: number | null
          premium_frequency: string | null
          product_name: string
          product_type: string
          purchase_nav: number | null
          quantity: number | null
          scheme_type: string | null
          snapshot: Json
          sourcing_type: string
          sum_assured: number | null
          trail_percent: number | null
          trail_rate: number | null
          trail_start_date: string | null
          transfer_reference: string | null
          transfer_remarks: string | null
          transfer_stage: string | null
          transferred_at: string | null
          transferred_by: string | null
          txn_date: string
          txn_type: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          client_price?: number | null
          consolidated_amount?: number
          coupon_rate?: number | null
          created_at?: string | null
          deal_confirmation_id?: string | null
          dsa_code?: string | null
          dsa_id?: string | null
          dsa_price?: number | null
          employee_id?: string | null
          face_value?: number | null
          folio_number?: string | null
          fund_house?: string | null
          id?: string
          insurance_revenue?: number | null
          insurance_revenue_pct?: number | null
          insurance_type?: string | null
          insurer_name?: string | null
          interest_payout_date?: string | null
          isin?: string | null
          issuer_name?: string | null
          landing_cost?: number | null
          nav_date?: string | null
          notes?: string | null
          payout_date_pattern?: string | null
          payout_frequency?: string | null
          per_unit_price?: number | null
          policy_number?: string | null
          premium_amount?: number | null
          premium_frequency?: string | null
          product_name: string
          product_type: string
          purchase_nav?: number | null
          quantity?: number | null
          scheme_type?: string | null
          snapshot?: Json
          sourcing_type?: string
          sum_assured?: number | null
          trail_percent?: number | null
          trail_rate?: number | null
          trail_start_date?: string | null
          transfer_reference?: string | null
          transfer_remarks?: string | null
          transfer_stage?: string | null
          transferred_at?: string | null
          transferred_by?: string | null
          txn_date?: string
          txn_type: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          client_price?: number | null
          consolidated_amount?: number
          coupon_rate?: number | null
          created_at?: string | null
          deal_confirmation_id?: string | null
          dsa_code?: string | null
          dsa_id?: string | null
          dsa_price?: number | null
          employee_id?: string | null
          face_value?: number | null
          folio_number?: string | null
          fund_house?: string | null
          id?: string
          insurance_revenue?: number | null
          insurance_revenue_pct?: number | null
          insurance_type?: string | null
          insurer_name?: string | null
          interest_payout_date?: string | null
          isin?: string | null
          issuer_name?: string | null
          landing_cost?: number | null
          nav_date?: string | null
          notes?: string | null
          payout_date_pattern?: string | null
          payout_frequency?: string | null
          per_unit_price?: number | null
          policy_number?: string | null
          premium_amount?: number | null
          premium_frequency?: string | null
          product_name?: string
          product_type?: string
          purchase_nav?: number | null
          quantity?: number | null
          scheme_type?: string | null
          snapshot?: Json
          sourcing_type?: string
          sum_assured?: number | null
          trail_percent?: number | null
          trail_rate?: number | null
          trail_start_date?: string | null
          transfer_reference?: string | null
          transfer_remarks?: string | null
          transfer_stage?: string | null
          transferred_at?: string | null
          transferred_by?: string | null
          txn_date?: string
          txn_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_transactions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_transactions_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_confirmations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_transactions_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_overall_stage"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_transactions_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_payment_summary"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_transactions_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_eligible"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_transactions_deal_confirmation_id_fkey"
            columns: ["deal_confirmation_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_transfer_pending_acceptance"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "nw_transactions_dsa_id_fkey"
            columns: ["dsa_id"]
            isOneToOne: false
            referencedRelation: "nw_dsa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_transactions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_transactions_transferred_by_fkey"
            columns: ["transferred_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_txn_documents: {
        Row: {
          created_at: string | null
          file_name: string
          file_url: string
          id: string
          txn_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          file_name: string
          file_url: string
          id?: string
          txn_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          file_name?: string
          file_url?: string
          id?: string
          txn_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_txn_documents_txn_id_fkey"
            columns: ["txn_id"]
            isOneToOne: false
            referencedRelation: "nw_deal_overall_stage"
            referencedColumns: ["transaction_id"]
          },
          {
            foreignKeyName: "nw_txn_documents_txn_id_fkey"
            columns: ["txn_id"]
            isOneToOne: false
            referencedRelation: "nw_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_txn_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      product_rules: {
        Row: {
          min_value: number
          product_type: string
          retention_months: number
          revenue_rate: number
        }
        Insert: {
          min_value: number
          product_type: string
          retention_months: number
          revenue_rate: number
        }
        Update: {
          min_value?: number
          product_type?: string
          retention_months?: number
          revenue_rate?: number
        }
        Relationships: []
      }
      slab_rules: {
        Row: {
          id: number
          level: string
          share_percentage: number
          x_max: number | null
          x_min: number
        }
        Insert: {
          id?: number
          level: string
          share_percentage: number
          x_max?: number | null
          x_min: number
        }
        Update: {
          id?: number
          level?: string
          share_percentage?: number
          x_max?: number | null
          x_min?: number
        }
        Relationships: []
      }
    }
    Views: {
      bm_bonds_public: {
        Row: {
          active_status: string | null
          analytics: Json | null
          analytics_computed_at: string | null
          bond_name: string | null
          bse_code: string | null
          business_day_convention: string | null
          callable: boolean | null
          coupon_frequency: string | null
          coupon_rate: number | null
          coupon_type: string | null
          created_at: string | null
          currency: string | null
          data_quality_score: number | null
          day_count_convention: string | null
          enriched_at: string | null
          exchange_listed: string | null
          face_value: number | null
          first_coupon_date: string | null
          floating: boolean | null
          id: string | null
          industry: string | null
          interest_payment_dates: string | null
          isin: string | null
          issue_date: string | null
          issue_price: number | null
          issuer_docs: Json | null
          issuer_id: string | null
          issuer_name: string | null
          latest_price: number | null
          listing_date: string | null
          listing_status: string | null
          lot_size: number | null
          maturity_date: string | null
          min_investment: number | null
          next_coupon_date: string | null
          nse_symbol: string | null
          perpetual: boolean | null
          previous_coupon_date: string | null
          price_updated_at: string | null
          principal_repayment_structure: string | null
          put_call_date: string | null
          put_call_type: string | null
          puttable: boolean | null
          rating: string | null
          rating_agency: string | null
          rating_date: string | null
          redemption_date: string | null
          redemption_schedule: Json | null
          redemption_value: number | null
          sector: string | null
          secured: boolean | null
          security_description: string | null
          security_type: string | null
          selling_price: number | null
          seniority: string | null
          series: string | null
          tax_status: string | null
          trustee: string | null
          updated_at: string | null
          verification_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bm_bonds_issuer_id_fkey"
            columns: ["issuer_id"]
            isOneToOne: false
            referencedRelation: "bm_issuers"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_deal_overall_stage: {
        Row: {
          acceptance_status: string | null
          confirmation_number: string | null
          deal_id: string | null
          deal_status: string | null
          overall_stage: string | null
          payment_status: string | null
          transaction_id: string | null
          transfer_stage: string | null
        }
        Relationships: []
      }
      nw_deal_payment_summary: {
        Row: {
          confirmation_number: string | null
          deal_amount: number | null
          deal_id: string | null
          last_payment_at: string | null
          outstanding_amount: number | null
          payment_count: number | null
          payment_status: string | null
          total_paid_amount: number | null
        }
        Relationships: []
      }
      nw_deal_transfer_eligible: {
        Row: {
          accepted_at: string | null
          brokerage_amount: number | null
          client_id: string | null
          confirmation_number: string | null
          deal_date: string | null
          deal_id: string | null
          employee_id: string | null
          insurance_revenue: number | null
          isin: string | null
          landing_cost: number | null
          last_payment_at: string | null
          notes: string | null
          outstanding_amount: number | null
          payment_count: number | null
          product_type: string | null
          quantity: number | null
          rate_per_unit: number | null
          security_name: string | null
          settlement_amount: number | null
          signed_pdf_path: string | null
          signer_email: string | null
          snap_address: string | null
          snap_bank_account: string | null
          snap_bank_ifsc: string | null
          snap_bank_name: string | null
          snap_client_name: string | null
          snap_demat_account: string | null
          snap_dp_name: string | null
          snap_email: string | null
          snap_pan: string | null
          snap_phone: string | null
          stamp_duty: number | null
          total_paid_amount: number | null
          trail_percent: number | null
          trail_start_date: string | null
          transaction_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_deal_confirmations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_confirmations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_deal_transfer_pending_acceptance: {
        Row: {
          acceptance_status: string | null
          accepted_at: string | null
          brokerage_amount: number | null
          client_id: string | null
          confirmation_number: string | null
          deal_date: string | null
          deal_id: string | null
          employee_id: string | null
          insurance_revenue: number | null
          isin: string | null
          landing_cost: number | null
          last_payment_at: string | null
          notes: string | null
          outstanding_amount: number | null
          payment_count: number | null
          product_type: string | null
          quantity: number | null
          rate_per_unit: number | null
          security_name: string | null
          settlement_amount: number | null
          signed_pdf_path: string | null
          signer_email: string | null
          snap_address: string | null
          snap_bank_account: string | null
          snap_bank_ifsc: string | null
          snap_bank_name: string | null
          snap_client_name: string | null
          snap_demat_account: string | null
          snap_dp_name: string | null
          snap_email: string | null
          snap_pan: string | null
          snap_phone: string | null
          stamp_duty: number | null
          total_paid_amount: number | null
          trail_percent: number | null
          trail_start_date: string | null
          transaction_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_deal_confirmations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nw_deal_confirmations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "nw_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      nw_orphaned_holdings: {
        Row: {
          client_id: string | null
          created_at: string | null
          current_value: number | null
          full_name: string | null
          holding_id: string | null
          pan: string | null
          product_name: string | null
          product_type: string | null
          quantity: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nw_holdings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "nw_clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      bm_import_prices: { Args: { p_rows: Json }; Returns: Json }
      bm_overlay_from_import_raw: {
        Args: { p_bond_id: string }
        Returns: undefined
      }
      bm_selling_price: {
        Args: {
          p_bond_id: string
          p_margin_type: string
          p_margin_value: number
        }
        Returns: number
      }
      bm_set_fields: {
        Args: { p_bond_id: string; p_fields: Json; p_lock?: boolean }
        Returns: undefined
      }
      bm_stale_bonds: {
        Args: { p_limit?: number }
        Returns: {
          active_status: string
          analytics: Json
          analytics_computed_at: string | null
          bond_name: string
          bse_code: string
          business_day_convention: string
          callable: boolean
          coupon_frequency: string
          coupon_rate: number | null
          coupon_type: string
          created_at: string
          created_by: string | null
          currency: string
          data_quality_score: number
          day_count_convention: string
          default_margin_type: string
          default_margin_value: number | null
          enriched_at: string | null
          exchange_listed: string
          extracted_name: string
          face_value: number | null
          first_coupon_date: string | null
          floating: boolean
          id: string
          import_raw: Json
          interest_payment_dates: string
          isin: string
          issue_date: string | null
          issue_price: number | null
          issuer_docs: Json
          issuer_id: string | null
          landing_cost: number | null
          latest_price: number | null
          listing_date: string | null
          listing_status: string
          lot_size: number | null
          maturity_date: string | null
          min_investment: number | null
          modified_by: string | null
          next_coupon_date: string | null
          nse_symbol: string
          perpetual: boolean
          previous_coupon_date: string | null
          price_updated_at: string | null
          principal_repayment_structure: string
          put_call_date: string | null
          put_call_type: string
          puttable: boolean
          rating: string
          rating_agency: string
          rating_date: string | null
          redemption_date: string | null
          redemption_schedule: Json
          redemption_value: number | null
          secured: boolean | null
          security_description: string
          security_type: string
          selling_price: number | null
          seniority: string
          series: string
          source_summary: Json
          tax_status: string
          trustee: string
          updated_at: string
          verification_status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "bm_bonds"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      delete_old_news: { Args: never; Returns: number }
      mkt_company_channel_stats: {
        Args: never
        Returns: {
          active: boolean
          clicks: number
          clients: number
          copies: number
          downloads: number
          label: string
          leads: number
          ref_code: string
        }[]
      }
      mkt_content_performance: {
        Args: { p_limit?: number }
        Returns: {
          clicks: number
          clients: number
          content_no: string
          content_type: string
          copies: number
          downloads: number
          leads: number
          platforms: string[]
          status: string
          title: string
        }[]
      }
      mkt_dashboard_totals: {
        Args: never
        Returns: {
          admin_deleted_total: number
          approved_total: number
          caption_copies: number
          clients_onboarded: number
          downloads_total: number
          expired_total: number
          generated_total: number
          hashtag_copies: number
          leads_generated: number
          live_now: number
          referral_clicks: number
          rejected_total: number
        }[]
      }
      mkt_dsa_channel_stats: {
        Args: never
        Returns: {
          clicks: number
          clients: number
          dsa_code: string
          dsa_id: string
          full_name: string
          leads: number
        }[]
      }
      mkt_employee_leaderboard: {
        Args: never
        Returns: {
          avatar_url: string
          clicks: number
          clients: number
          copies: number
          downloads: number
          employee_code: string
          employee_id: string
          full_name: string
          leads: number
        }[]
      }
      mkt_generate_ref_code: { Args: never; Returns: string }
      mkt_next_content_no: { Args: never; Returns: string }
      mkt_platform_usage: {
        Args: never
        Returns: {
          content_count: number
          downloads: number
          platform: string
        }[]
      }
      mkt_set_content_status: {
        Args: { p_action: string; p_content_id: string; p_note?: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          body: string
          caption: string
          category: string
          content_no: string
          content_type: string
          created_at: string
          created_by: string | null
          cta: string
          design_spec: Json
          expires_at: string | null
          generation_meta: Json
          hashtags: string[]
          headline: string
          id: string
          platform_notes: Json
          platforms: string[]
          reject_reason: string
          scheduled_publish_at: string | null
          seo_keywords: string[]
          status: string
          suggested_post_time: string
          template_id: string
          title: string
          topic: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "mkt_content"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      nw_apply_txn_holding: {
        Args: { p_txn: Database["public"]["Tables"]["nw_transactions"]["Row"] }
        Returns: undefined
      }
      nw_assign_leads: {
        Args: { p_lead_ids: string[]; p_reason?: string; p_to_employee: string }
        Returns: number
      }
      nw_can_see_lead: { Args: { p_lead_id: string }; Returns: boolean }
      nw_check_lead_duplicate: {
        Args: {
          p_email?: string
          p_exclude_lead_id?: string
          p_mobile?: string
          p_pan?: string
        }
        Returns: {
          created_at: string
          display_name: string
          entity: string
          entity_id: string
          matched_on: string
          owner_name: string
          status: string
        }[]
      }
      nw_check_lead_duplicates_bulk: {
        Args: { p_emails?: string[]; p_mobiles?: string[]; p_pans?: string[] }
        Returns: {
          kind: string
          value: string
        }[]
      }
      nw_current_client_code: { Args: never; Returns: string }
      nw_current_dsa_id: { Args: never; Returns: string }
      nw_current_emp_is_admin: { Args: never; Returns: boolean }
      nw_current_employee_id: { Args: never; Returns: string }
      nw_delete_deal_cascade: { Args: { p_deal_id: string }; Returns: Json }
      nw_delete_lead: { Args: { p_lead_id: string }; Returns: undefined }
      nw_delete_transaction_cascade: {
        Args: { p_txn_id: string }
        Returns: Json
      }
      nw_emp_owns_dsa: { Args: { p_dsa_id: string }; Returns: boolean }
      nw_finalize_receipt: {
        Args: {
          p_generated_by: string
          p_payment_id: string
          p_receipt_path: string
        }
        Returns: {
          amount: number
          amount_inr: number | null
          bank_statement_ref: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cheque_bank: string | null
          cheque_dated: string | null
          cheque_number: string | null
          created_at: string
          created_by: string | null
          currency: string
          deal_confirmation_id: string
          demand_draft_number: string | null
          direction: string
          external_ref: string | null
          fx_rate_to_inr: number | null
          id: string
          payment_date: string
          payment_mode: string
          payment_number: string
          posted_at: string | null
          posted_by: string | null
          provider: string | null
          provider_order_id: string | null
          provider_payload: Json
          provider_payment_id: string | null
          provider_signature: string | null
          provider_status: string | null
          receipt_generated_at: string | null
          receipt_generated_by: string | null
          receipt_last_emailed_at: string | null
          receipt_number: string | null
          receipt_pdf_path: string | null
          receipt_regen_count: number
          received_at: string
          received_by: string | null
          received_from_bank: string | null
          received_from_name: string
          reconciled_at: string | null
          reconciled_by: string | null
          reconciliation_status: string
          remarks: string
          reverses_payment_id: string | null
          row_version: number
          status: string
          supporting_docs: Json
          updated_at: string
          updated_by: string | null
          utr_number: string | null
          value_date: string | null
        }
        SetofOptions: {
          from: "*"
          to: "nw_deal_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      nw_generate_confirmation_number: {
        Args: { p_employee_id: string }
        Returns: string
      }
      nw_generate_debit_note_number: {
        Args: { p_month: number; p_year: number }
        Returns: string
      }
      nw_insert_payment: {
        Args: { p_data: Json }
        Returns: {
          amount: number
          amount_inr: number | null
          bank_statement_ref: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cheque_bank: string | null
          cheque_dated: string | null
          cheque_number: string | null
          created_at: string
          created_by: string | null
          currency: string
          deal_confirmation_id: string
          demand_draft_number: string | null
          direction: string
          external_ref: string | null
          fx_rate_to_inr: number | null
          id: string
          payment_date: string
          payment_mode: string
          payment_number: string
          posted_at: string | null
          posted_by: string | null
          provider: string | null
          provider_order_id: string | null
          provider_payload: Json
          provider_payment_id: string | null
          provider_signature: string | null
          provider_status: string | null
          receipt_generated_at: string | null
          receipt_generated_by: string | null
          receipt_last_emailed_at: string | null
          receipt_number: string | null
          receipt_pdf_path: string | null
          receipt_regen_count: number
          received_at: string
          received_by: string | null
          received_from_bank: string | null
          received_from_name: string
          reconciled_at: string | null
          reconciled_by: string | null
          reconciliation_status: string
          remarks: string
          reverses_payment_id: string | null
          row_version: number
          status: string
          supporting_docs: Json
          updated_at: string
          updated_by: string | null
          utr_number: string | null
          value_date: string | null
        }
        SetofOptions: {
          from: "*"
          to: "nw_deal_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      nw_is_active_employee: { Args: { uid: string }; Returns: boolean }
      nw_lead_dashboard: { Args: never; Returns: Json }
      nw_lead_kpi_counts: {
        Args: { p_today_start: string }
        Returns: {
          converted: number
          pool: number
          today: number
          total: number
        }[]
      }
      nw_lead_process_reminders: { Args: never; Returns: undefined }
      nw_lead_score_for: {
        Args: {
          p_annual_income: number
          p_investment_capacity: number
          p_priority: string
          p_status: string
        }
        Returns: number
      }
      nw_mark_lead_converted: {
        Args: { p_client_id: string; p_lead_id: string }
        Returns: undefined
      }
      nw_merge_leads: {
        Args: { p_duplicate: string; p_primary: string }
        Returns: undefined
      }
      nw_next_lead_code: { Args: never; Returns: string }
      nw_notify_admins: {
        Args: {
          p_action_url: string
          p_category: string
          p_lead_id: string
          p_message: string
          p_title: string
        }
        Returns: undefined
      }
      nw_notify_dropped_signups: { Args: never; Returns: undefined }
      nw_partner_client_portfolio: {
        Args: { p_client_id: string }
        Returns: {
          avg_price: number
          current_value: number
          gain_loss: number
          holding_id: string
          invested_amount: number
          product_name: string
          product_type: string
          quantity: number
        }[]
      }
      nw_partner_client_transactions: {
        Args: { p_client_id: string }
        Returns: {
          amount: number
          client_price: number
          dsa_price: number
          product_name: string
          product_type: string
          quantity: number
          txn_date: string
          txn_id: string
          txn_type: string
        }[]
      }
      nw_partner_clients: {
        Args: never
        Returns: {
          city: string
          client_code: string
          client_id: string
          current_value: number
          full_name: string
          holdings_count: number
          invested_amount: number
          mobile_masked: string
          onboarding_status: string
          sourced_on: string
          verification_status: string
        }[]
      }
      nw_partner_debit_notes: {
        Args: never
        Returns: {
          created_at: string
          debit_note_number: string
          id: string
          month: number
          net_payable_amount: number
          paid_at: string
          payout_amount: number
          pdf_url: string
          signature_status: string
          signed_at: string
          signed_pdf_url: string
          status: string
          tds_amount: number
          year: number
        }[]
      }
      nw_partner_leads: {
        Args: never
        Returns: {
          city: string
          converted_client_code: string
          created_at: string
          lead_id: string
          lead_name: string
          mobile: string
          status: string
        }[]
      }
      nw_partner_mark_password_changed: { Args: never; Returns: undefined }
      nw_partner_payout_summary: {
        Args: never
        Returns: {
          awaiting_payment_net: number
          awaiting_signature_count: number
          fy_gross: number
          fy_label: string
          fy_net: number
          fy_tds: number
          latest_note_net: number
          latest_note_number: string
          latest_note_period: string
          lifetime_gross: number
          lifetime_net: number
          lifetime_tds: number
          paid_net: number
        }[]
      }
      nw_partner_profile: {
        Args: never
        Returns: {
          address: string
          bank_account_masked: string
          bank_ifsc: string
          bank_name: string
          dsa_code: string
          dsa_id: string
          email: string
          full_name: string
          login_enabled: boolean
          mobile: string
          pan_masked: string
          partner_since: string
          password_changed: boolean
          photo_url: string
          rm_avatar_url: string
          rm_email: string
          rm_mobile: string
          rm_name: string
          status: string
        }[]
      }
      nw_partner_referral: {
        Args: never
        Returns: {
          active: boolean
          clicks: number
          clients: number
          leads: number
          ref_code: string
        }[]
      }
      nw_partner_set_login_enabled: {
        Args: { p_dsa_id: string; p_enabled: boolean }
        Returns: undefined
      }
      nw_reassign_client: {
        Args: { p_client_id: string; p_reason?: string; p_to_employee: string }
        Returns: undefined
      }
      nw_recompute_portfolio_value: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      nw_request_duplicate_review: {
        Args: { p_existing_lead_id: string; p_payload?: Json }
        Returns: undefined
      }
      nw_set_asset_class: {
        Args: { p_asset_class: string; p_isin: string; p_note?: string }
        Returns: undefined
      }
      nw_stamp_duty_rate: { Args: { p_product_type: string }; Returns: number }
      nw_transfer_deal: {
        Args: {
          p_admin_id: string
          p_app_version?: string
          p_deal_id: string
          p_override_acceptance?: boolean
          p_remarks: string
        }
        Returns: Json
      }
      nw_unwind_txn_holding: {
        Args: { p_txn: Database["public"]["Tables"]["nw_transactions"]["Row"] }
        Returns: undefined
      }
      nw2_generate_client_code: {
        Args: { p_employee_id: string }
        Returns: string
      }
      nw2_generate_dsa_code: {
        Args: { p_employee_id: string }
        Returns: string
      }
      prune_news_to_cap: {
        Args: { max_per_category?: number }
        Returns: number
      }
      trigger_bond_yield_refresh: { Args: never; Returns: undefined }
      trigger_commodity_price_update: { Args: never; Returns: undefined }
      trigger_mf_returns_backfill: { Args: never; Returns: undefined }
      trigger_mf_universe_refresh: { Args: never; Returns: undefined }
      trigger_mkt_expire_content: { Args: never; Returns: undefined }
      trigger_mutual_funds_update: { Args: never; Returns: undefined }
      trigger_nav_refresh: { Args: never; Returns: undefined }
      trigger_nsdl_refresh: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
