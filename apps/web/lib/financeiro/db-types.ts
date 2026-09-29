// ================================================================
// Tipos do módulo financeiro (migration 005), escritos à mão.
//
// Motivo: lib/database.types.ts é gerado a partir do banco e só pode
// ser regenerado depois que a migration 005 for aplicada. Quando isso
// acontecer, regenerar database.types.ts e trocar FinanceDatabase por
// Database em lib/financeiro/server.ts.
// ================================================================

type Num = number
type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type NoInsert = Record<string, never>

export type ClaimStatementOverviewRow = {
  id: string
  tenant_id: string
  insurance_plan_id: string
  plan_name: string
  statement_number: string
  emission_date: string
  item_count: Num
  items_informed: Num
  items_released: Num
  items_gloss: Num
  declared_gloss: Num | null
  divergences: Json
  file_name: string
  imported_at: string
  invoiced: Num
  paid: Num
  last_paid_on: string | null
  invoice_numbers: string | null
  financial_status: 'sem_nota' | 'nota_emitida' | 'paga'
}

export type ClaimMonthlySummaryRow = {
  tenant_id: string
  insurance_plan_id: string
  month: string
  sessions: Num
  informed: Num
  released: Num
  gloss: Num
  glossed_sessions: Num
  median_days_to_statement: Num | null
  min_days_to_statement: Num | null
  max_days_to_statement: Num | null
}

export type ClaimGlossByCodeRow = {
  tenant_id: string
  insurance_plan_id: string
  gloss_code: string
  sessions: Num
  gloss: Num
  beneficiaries: Num
}

export type InsurancePlanRow = {
  id: string
  tenant_id: string
  name: string
  operator_ans_code: string | null
  active: boolean
}

export type OperatorInvoiceRow = {
  id: string
  tenant_id: string
  insurance_plan_id: string
  statement_id: string | null
  invoice_number: string
  issue_date: string
  amount: Num
  expected_payment_date: string | null
  status: 'issued' | 'paid' | 'cancelled'
  paid_on: string | null
  paid_amount: Num | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type OperatorInvoiceInsert = {
  tenant_id: string
  insurance_plan_id: string
  statement_id?: string | null
  invoice_number: string
  issue_date: string
  amount: Num
  expected_payment_date?: string | null
  notes?: string | null
  created_by?: string | null
}

export type GlossDetailRow = {
  item_key: string
  statement_number: string
  emission_date: string
  realization_date: string
  provider_guide_number: string
  beneficiary_name: string | null
  card_last4: string | null
  card_origin_code: string | null
  informed_value: Num
  released_value: Num
  gloss_value: Num
  gloss_codes: string | null
  appeal_status: string
  recovered_value: Num | null
}

export type DuplicateBillingRow = {
  realization_date: string
  beneficiary_name: string | null
  card_last4: string | null
  sessions: Num
  guides: string
  released_value: Num
  gloss_value: Num
}

export type FinanceDatabase = {
  __InternalSupabase: { PostgrestVersion: '14.5' }
  public: {
    Tables: {
      insurance_plans: { Row: InsurancePlanRow; Insert: NoInsert; Update: NoInsert; Relationships: [] }
      operator_invoices: {
        Row: OperatorInvoiceRow
        Insert: OperatorInvoiceInsert
        Update: Partial<Pick<OperatorInvoiceRow, 'status' | 'paid_on' | 'paid_amount' | 'notes'>>
        Relationships: []
      }
      users: {
        Row: { id: string; tenant_id: string; role: string; active: boolean }
        Insert: NoInsert
        Update: NoInsert
        Relationships: []
      }
    }
    Views: {
      claim_statement_overview: { Row: ClaimStatementOverviewRow; Relationships: [] }
      claim_monthly_summary: { Row: ClaimMonthlySummaryRow; Relationships: [] }
      claim_gloss_by_code: { Row: ClaimGlossByCodeRow; Relationships: [] }
    }
    Functions: {
      has_finance_access: { Args: never; Returns: boolean }
      import_claim_statement: { Args: { p: Json }; Returns: Json }
      claim_gloss_details: { Args: { p_plan_id?: string }; Returns: GlossDetailRow[] }
      claim_duplicate_billing: { Args: { p_plan_id?: string }; Returns: DuplicateBillingRow[] }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
