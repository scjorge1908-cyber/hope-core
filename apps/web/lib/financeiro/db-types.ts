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

// migration 010 — o que a Unimed fez com cada guia (guia do prestador)
export type ClaimStatusPorGuiaRow = {
  guia: string
  sessoes: Num
  informado: Num
  liberado: Num
  glosado: Num
  codigos_glosa: string | null
  demonstrativos: string | null
  ultima_emissao: string | null
  datas_sessao: string | null
}

// migration 010 — divergências planilhas × Unimed
export type GuiaDivergenciaRow = {
  tipo: 'ok_glosado' | 'pago_sem_ok' | 'falta_faturada'
  spreadsheet_id: string
  psicologa: string | null
  guia: string
  paciente: string
  datas_planilha: string | null
  status_planilha: string
  mes: Num | null
  ano: Num | null
  informado: Num
  liberado: Num
  glosado: Num
  codigos_glosa: string | null
  demonstrativos: string | null
  datas_unimed: string | null
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
  // migration 011 — agenda de recebimentos
  short_name?: string | null
  payment_days?: Num | null
  payment_base?: 'envio' | 'liberacao' | 'nf' | null
  payment_business_day?: boolean
  display_order?: Num | null
}

// migration 011 — agenda de recebimentos e pagamentos
export type CashflowItemRow = {
  id: string
  tenant_id: string
  kind: 'entrada' | 'saida'
  insurance_plan_id: string | null
  category: string
  source: 'orizon' | 'manual'
  external_ref: string | null
  protocol: string | null
  guide_type: string | null
  guide_count: Num | null
  reference_date: string | null
  released_at: string | null
  origin_status: string | null
  amount: Num
  expected_date: string
  status: 'previsto' | 'realizado' | 'glosado' | 'cancelado'
  realized_date: string | null
  realized_amount: Num | null
  realized_source: 'manual' | 'banco' | null
  description: string | null
  import_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CashflowItemInsert = {
  tenant_id: string
  kind: 'entrada' | 'saida'
  insurance_plan_id?: string | null
  category: string
  source: 'manual'
  amount: number
  expected_date: string
  description?: string | null
  created_by?: string | null
}

export type CashflowCalendarRow = {
  id: string
  tenant_id: string
  origem: 'item' | 'nota_fiscal'
  kind: 'entrada' | 'saida'
  insurance_plan_id: string | null
  category: string
  category_order: Num
  source: 'orizon' | 'manual' | 'nf'
  external_ref: string | null
  reference_date: string | null
  amount: Num
  expected_date: string
  calendar_date: string
  status: 'previsto' | 'realizado' | 'glosado'
  realized_date: string | null
  realized_amount: Num | null
  description: string | null
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

export type LegacySyncStatusRow = {
  spreadsheet_id: string
  nome: string | null
  total_linhas: Num
  ultima_sincronizacao: string | null
  ultimo_erro: string | null
}

export type FinanceDatabase = {
  __InternalSupabase: { PostgrestVersion: '14.5' }
  public: {
    Tables: {
      insurance_plans: {
        Row: InsurancePlanRow
        Insert: NoInsert
        Update: Partial<Pick<InsurancePlanRow, 'payment_days' | 'payment_base' | 'payment_business_day'>>
        Relationships: []
      }
      bank_holidays: { Row: { day: string; name: string }; Insert: NoInsert; Update: NoInsert; Relationships: [] }
      cashflow_items: {
        Row: CashflowItemRow
        Insert: CashflowItemInsert
        Update: Partial<Pick<CashflowItemRow, 'status' | 'realized_date' | 'realized_amount' | 'realized_source' | 'amount' | 'expected_date' | 'description'>>
        Relationships: []
      }
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
      cashflow_calendar: { Row: CashflowCalendarRow; Relationships: [] }
    }
    Functions: {
      has_finance_access: { Args: never; Returns: boolean }
      import_claim_statement: { Args: { p: Json }; Returns: Json }
      claim_gloss_details: { Args: { p_plan_id?: string }; Returns: GlossDetailRow[] }
      claim_duplicate_billing: { Args: { p_plan_id?: string }; Returns: DuplicateBillingRow[] }
      // migration 008 — ponte das planilhas
      legacy_rpa_base: { Args: never; Returns: Json }
      legacy_sync_status: { Args: never; Returns: LegacySyncStatusRow[] }
      // migration 010 — Registro de Guias
      legacy_registro_espelhar: { Args: { p: Json }; Returns: Json }
      claim_status_por_guias: { Args: { p_guias: string[] }; Returns: ClaimStatusPorGuiaRow[] }
      guia_divergencias: { Args: never; Returns: GuiaDivergenciaRow[] }
      // migration 011 — agenda de recebimentos
      import_orizon_lotes: { Args: { p: Json }; Returns: Json }
      // migration 012 — painel de gestão
      painel_gestao: { Args: never; Returns: Json }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
