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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          admin_block: boolean
          admin_block_until: string | null
          admin_notes: string | null
          attachment_card_path: string | null
          attachment_guide_path: string | null
          attachment_rg_path: string | null
          cid_code: string | null
          created_at: string
          deleted_at: string | null
          id: string
          insurance_card_number: string | null
          insurance_plan_id: string | null
          patient_id: string
          physician_crm: string | null
          physician_name: string | null
          professional_id: string
          room_id: string | null
          scheduled_date: string | null
          start_time: string
          status: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
          updated_at: string
          weekday: number | null
        }
        Insert: {
          admin_block?: boolean
          admin_block_until?: string | null
          admin_notes?: string | null
          attachment_card_path?: string | null
          attachment_guide_path?: string | null
          attachment_rg_path?: string | null
          cid_code?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          insurance_card_number?: string | null
          insurance_plan_id?: string | null
          patient_id: string
          physician_crm?: string | null
          physician_name?: string | null
          professional_id: string
          room_id?: string | null
          scheduled_date?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
          updated_at?: string
          weekday?: number | null
        }
        Update: {
          admin_block?: boolean
          admin_block_until?: string | null
          admin_notes?: string | null
          attachment_card_path?: string | null
          attachment_guide_path?: string | null
          attachment_rg_path?: string | null
          cid_code?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          insurance_card_number?: string | null
          insurance_plan_id?: string | null
          patient_id?: string
          physician_crm?: string | null
          physician_name?: string | null
          professional_id?: string
          room_id?: string | null
          scheduled_date?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id?: string
          updated_at?: string
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_insurance_plan_id_fkey"
            columns: ["insurance_plan_id"]
            isOneToOne: false
            referencedRelation: "insurance_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_table: string
          id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_table: string
          id?: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_table?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_declarations: {
        Row: {
          appointment_id: string | null
          clinic_cnpj_snapshot: string | null
          clinic_name_snapshot: string | null
          companion_name: string | null
          consultation_date: string | null
          consultation_time: string | null
          declaration_type: string
          entry_time: string | null
          exit_time: string | null
          generated_at: string
          generated_by: string | null
          id: string
          patient_name: string
          professional_crp_snapshot: string | null
          professional_id: string
          professional_name_snapshot: string | null
          storage_path: string | null
          tenant_id: string
          verification_code: string
        }
        Insert: {
          appointment_id?: string | null
          clinic_cnpj_snapshot?: string | null
          clinic_name_snapshot?: string | null
          companion_name?: string | null
          consultation_date?: string | null
          consultation_time?: string | null
          declaration_type: string
          entry_time?: string | null
          exit_time?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          patient_name: string
          professional_crp_snapshot?: string | null
          professional_id: string
          professional_name_snapshot?: string | null
          storage_path?: string | null
          tenant_id: string
          verification_code?: string
        }
        Update: {
          appointment_id?: string | null
          clinic_cnpj_snapshot?: string | null
          clinic_name_snapshot?: string | null
          companion_name?: string | null
          consultation_date?: string | null
          consultation_time?: string | null
          declaration_type?: string
          entry_time?: string | null
          exit_time?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          patient_name?: string
          professional_crp_snapshot?: string | null
          professional_id?: string
          professional_name_snapshot?: string | null
          storage_path?: string | null
          tenant_id?: string
          verification_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_declarations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_declarations_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_declarations_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_declarations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_documents: {
        Row: {
          clinic_cnpj_snapshot: string | null
          clinic_name_snapshot: string | null
          doc_type: string
          gross_value_snapshot: number | null
          id: string
          inss_deduction_snapshot: number | null
          legacy_drive_url: string | null
          net_value_snapshot: number | null
          payout_id: string | null
          pix_key_encrypted: string | null
          pix_key_key_version: number
          professional_cpf_encrypted: string | null
          professional_cpf_key_version: number
          professional_id: string
          professional_name_snapshot: string | null
          reference_month: number | null
          reference_year: number | null
          sent_at: string | null
          storage_path: string | null
          tenant_id: string
        }
        Insert: {
          clinic_cnpj_snapshot?: string | null
          clinic_name_snapshot?: string | null
          doc_type: string
          gross_value_snapshot?: number | null
          id?: string
          inss_deduction_snapshot?: number | null
          legacy_drive_url?: string | null
          net_value_snapshot?: number | null
          payout_id?: string | null
          pix_key_encrypted?: string | null
          pix_key_key_version?: number
          professional_cpf_encrypted?: string | null
          professional_cpf_key_version?: number
          professional_id: string
          professional_name_snapshot?: string | null
          reference_month?: number | null
          reference_year?: number | null
          sent_at?: string | null
          storage_path?: string | null
          tenant_id: string
        }
        Update: {
          clinic_cnpj_snapshot?: string | null
          clinic_name_snapshot?: string | null
          doc_type?: string
          gross_value_snapshot?: number | null
          id?: string
          inss_deduction_snapshot?: number | null
          legacy_drive_url?: string | null
          net_value_snapshot?: number | null
          payout_id?: string | null
          pix_key_encrypted?: string | null
          pix_key_key_version?: number
          professional_cpf_encrypted?: string | null
          professional_cpf_key_version?: number
          professional_id?: string
          professional_name_snapshot?: string | null
          reference_month?: number | null
          reference_year?: number | null
          sent_at?: string | null
          storage_path?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_documents_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      guide_status_overrides: {
        Row: {
          guide_id: string
          id: string
          new_status: Database["public"]["Enums"]["guide_status"]
          note: string | null
          overridden_at: string
          overridden_by: string | null
          previous_status: Database["public"]["Enums"]["guide_status"] | null
          tenant_id: string
        }
        Insert: {
          guide_id: string
          id?: string
          new_status: Database["public"]["Enums"]["guide_status"]
          note?: string | null
          overridden_at?: string
          overridden_by?: string | null
          previous_status?: Database["public"]["Enums"]["guide_status"] | null
          tenant_id: string
        }
        Update: {
          guide_id?: string
          id?: string
          new_status?: Database["public"]["Enums"]["guide_status"]
          note?: string | null
          overridden_at?: string
          overridden_by?: string | null
          previous_status?: Database["public"]["Enums"]["guide_status"] | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guide_status_overrides_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guide_status_overrides_overridden_by_fkey"
            columns: ["overridden_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guide_status_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      guides: {
        Row: {
          attachment_path: string | null
          created_at: string
          gloss_type: string | null
          gloss_value: number | null
          id: string
          informed_value: number | null
          operator_guide_number: string | null
          patient_id: string | null
          patient_name: string
          patient_name_encrypted: string | null
          patient_name_key_version: number
          professional_id: string
          provider_guide_number: string | null
          released_value: number | null
          session_id: string | null
          status: Database["public"]["Enums"]["guide_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attachment_path?: string | null
          created_at?: string
          gloss_type?: string | null
          gloss_value?: number | null
          id?: string
          informed_value?: number | null
          operator_guide_number?: string | null
          patient_id?: string | null
          patient_name: string
          patient_name_encrypted?: string | null
          patient_name_key_version?: number
          professional_id: string
          provider_guide_number?: string | null
          released_value?: number | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["guide_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attachment_path?: string | null
          created_at?: string
          gloss_type?: string | null
          gloss_value?: number | null
          id?: string
          informed_value?: number | null
          operator_guide_number?: string | null
          patient_id?: string | null
          patient_name?: string
          patient_name_encrypted?: string | null
          patient_name_key_version?: number
          professional_id?: string
          provider_guide_number?: string | null
          released_value?: number | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["guide_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guides_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guides_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guides_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_claim_returns: {
        Row: {
          auth_password: string | null
          auth_password_encrypted: string | null
          auth_password_key_version: number
          beneficiary_name: string | null
          beneficiary_name_encrypted: string | null
          beneficiary_name_key_version: number
          billing_end_date: string | null
          billing_end_time: string | null
          billing_start_date: string | null
          billing_start_time: string | null
          card_number: string | null
          card_number_encrypted: string | null
          card_number_key_version: number
          contracted_party: string | null
          gloss_type: string | null
          gloss_value: number | null
          guide_id: string | null
          guide_situation: string | null
          id: string
          imported_at: string
          informed_value: number | null
          insurance_plan_id: string | null
          operator_guide_number: string | null
          processed_value: number | null
          provider_guide_number: string | null
          realization_date: string | null
          released_value: number | null
          source_file: string | null
          statement_emission_date: string | null
          statement_number: string | null
          tenant_id: string
        }
        Insert: {
          auth_password?: string | null
          auth_password_encrypted?: string | null
          auth_password_key_version?: number
          beneficiary_name?: string | null
          beneficiary_name_encrypted?: string | null
          beneficiary_name_key_version?: number
          billing_end_date?: string | null
          billing_end_time?: string | null
          billing_start_date?: string | null
          billing_start_time?: string | null
          card_number?: string | null
          card_number_encrypted?: string | null
          card_number_key_version?: number
          contracted_party?: string | null
          gloss_type?: string | null
          gloss_value?: number | null
          guide_id?: string | null
          guide_situation?: string | null
          id?: string
          imported_at?: string
          informed_value?: number | null
          insurance_plan_id?: string | null
          operator_guide_number?: string | null
          processed_value?: number | null
          provider_guide_number?: string | null
          realization_date?: string | null
          released_value?: number | null
          source_file?: string | null
          statement_emission_date?: string | null
          statement_number?: string | null
          tenant_id: string
        }
        Update: {
          auth_password?: string | null
          auth_password_encrypted?: string | null
          auth_password_key_version?: number
          beneficiary_name?: string | null
          beneficiary_name_encrypted?: string | null
          beneficiary_name_key_version?: number
          billing_end_date?: string | null
          billing_end_time?: string | null
          billing_start_date?: string | null
          billing_start_time?: string | null
          card_number?: string | null
          card_number_encrypted?: string | null
          card_number_key_version?: number
          contracted_party?: string | null
          gloss_type?: string | null
          gloss_value?: number | null
          guide_id?: string | null
          guide_situation?: string | null
          id?: string
          imported_at?: string
          informed_value?: number | null
          insurance_plan_id?: string | null
          operator_guide_number?: string | null
          processed_value?: number | null
          provider_guide_number?: string | null
          realization_date?: string | null
          released_value?: number | null
          source_file?: string | null
          statement_emission_date?: string | null
          statement_number?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurance_claim_returns_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claim_returns_insurance_plan_id_fkey"
            columns: ["insurance_plan_id"]
            isOneToOne: false
            referencedRelation: "insurance_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claim_returns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_plans: {
        Row: {
          active: boolean
          id: string
          name: string
          requires_weekly_auth_token: boolean
          session_value: number | null
          tenant_id: string
          weekly_session_limit: number | null
        }
        Insert: {
          active?: boolean
          id?: string
          name: string
          requires_weekly_auth_token?: boolean
          session_value?: number | null
          tenant_id: string
          weekly_session_limit?: number | null
        }
        Update: {
          active?: boolean
          id?: string
          name?: string
          requires_weekly_auth_token?: boolean
          session_value?: number | null
          tenant_id?: string
          weekly_session_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          appointment_id: string | null
          created_at: string
          id: string
          kind: string
          professional_id: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          kind: string
          professional_id?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          professional_id?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          birth_date: string | null
          city: string | null
          cpf: string | null
          cpf_blind_index: string | null
          cpf_encrypted: string | null
          cpf_key_version: number
          created_at: string
          deleted_at: string | null
          emergency_phone: string | null
          full_name: string
          id: string
          neighborhood: string | null
          phone: string | null
          responsible_cpf: string | null
          responsible_cpf_encrypted: string | null
          responsible_cpf_key_version: number
          responsible_name: string | null
          sex: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          city?: string | null
          cpf?: string | null
          cpf_blind_index?: string | null
          cpf_encrypted?: string | null
          cpf_key_version?: number
          created_at?: string
          deleted_at?: string | null
          emergency_phone?: string | null
          full_name: string
          id?: string
          neighborhood?: string | null
          phone?: string | null
          responsible_cpf?: string | null
          responsible_cpf_encrypted?: string | null
          responsible_cpf_key_version?: number
          responsible_name?: string | null
          sex?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          city?: string | null
          cpf?: string | null
          cpf_blind_index?: string | null
          cpf_encrypted?: string | null
          cpf_key_version?: number
          created_at?: string
          deleted_at?: string | null
          emergency_phone?: string | null
          full_name?: string
          id?: string
          neighborhood?: string | null
          phone?: string | null
          responsible_cpf?: string | null
          responsible_cpf_encrypted?: string | null
          responsible_cpf_key_version?: number
          responsible_name?: string | null
          sex?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_rules: {
        Row: {
          cnpj_percentage: number | null
          id: string
          inss_ceiling_value: number | null
          inss_percentage: number | null
          is_cnpj: boolean
          pf_percentage: number | null
          professional_id: string
          tenant_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          cnpj_percentage?: number | null
          id?: string
          inss_ceiling_value?: number | null
          inss_percentage?: number | null
          is_cnpj?: boolean
          pf_percentage?: number | null
          professional_id: string
          tenant_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          cnpj_percentage?: number | null
          id?: string
          inss_ceiling_value?: number | null
          inss_percentage?: number | null
          is_cnpj?: boolean
          pf_percentage?: number | null
          professional_id?: string
          tenant_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_rules_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          calculated_at: string
          calculated_by: string | null
          gross_value: number
          id: string
          inss_deduction: number | null
          net_value: number
          professional_id: string
          reference_month: number
          reference_year: number
          tenant_id: string
        }
        Insert: {
          calculated_at?: string
          calculated_by?: string | null
          gross_value: number
          id?: string
          inss_deduction?: number | null
          net_value: number
          professional_id: string
          reference_month: number
          reference_year: number
          tenant_id: string
        }
        Update: {
          calculated_at?: string
          calculated_by?: string | null
          gross_value?: number
          id?: string
          inss_deduction?: number | null
          net_value?: number
          professional_id?: string
          reference_month?: number
          reference_year?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_calculated_by_fkey"
            columns: ["calculated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      professional_availability_blocks: {
        Row: {
          end_date: string
          id: string
          professional_id: string
          reason: string | null
          start_date: string
          tenant_id: string
        }
        Insert: {
          end_date: string
          id?: string
          professional_id: string
          reason?: string | null
          start_date: string
          tenant_id: string
        }
        Update: {
          end_date?: string
          id?: string
          professional_id?: string
          reason?: string | null
          start_date?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_availability_blocks_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_availability_blocks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_credentials: {
        Row: {
          doc_type: string
          id: string
          legacy_drive_url: string | null
          professional_id: string
          storage_path: string
          tenant_id: string
          uploaded_at: string
        }
        Insert: {
          doc_type: string
          id?: string
          legacy_drive_url?: string | null
          professional_id: string
          storage_path: string
          tenant_id: string
          uploaded_at?: string
        }
        Update: {
          doc_type?: string
          id?: string
          legacy_drive_url?: string | null
          professional_id?: string
          storage_path?: string
          tenant_id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_credentials_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_credentials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_profiles: {
        Row: {
          active: boolean
          approach: string | null
          birth_date: string | null
          cpf: string | null
          cpf_blind_index: string | null
          cpf_encrypted: string | null
          cpf_key_version: number
          created_at: string
          crp: string | null
          deleted_at: string | null
          full_name: string
          id: string
          min_patient_age: number | null
          pix_key: string | null
          pix_key_encrypted: string | null
          pix_key_key_version: number
          rg: string | null
          rg_encrypted: string | null
          rg_key_version: number
          short_name: string | null
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          approach?: string | null
          birth_date?: string | null
          cpf?: string | null
          cpf_blind_index?: string | null
          cpf_encrypted?: string | null
          cpf_key_version?: number
          created_at?: string
          crp?: string | null
          deleted_at?: string | null
          full_name: string
          id?: string
          min_patient_age?: number | null
          pix_key?: string | null
          pix_key_encrypted?: string | null
          pix_key_key_version?: number
          rg?: string | null
          rg_encrypted?: string | null
          rg_key_version?: number
          short_name?: string | null
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          approach?: string | null
          birth_date?: string | null
          cpf?: string | null
          cpf_blind_index?: string | null
          cpf_encrypted?: string | null
          cpf_key_version?: number
          created_at?: string
          crp?: string | null
          deleted_at?: string | null
          full_name?: string
          id?: string
          min_patient_age?: number | null
          pix_key?: string | null
          pix_key_encrypted?: string | null
          pix_key_key_version?: number
          rg?: string | null
          rg_encrypted?: string | null
          rg_key_version?: number
          short_name?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          id: string
          name: string
          tenant_id: string
          visible_in_availability_summary: boolean
        }
        Insert: {
          id?: string
          name: string
          tenant_id: string
          visible_in_availability_summary?: boolean
        }
        Update: {
          id?: string
          name?: string
          tenant_id?: string
          visible_in_availability_summary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "rooms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          appointment_id: string | null
          billing_status: Database["public"]["Enums"]["billing_status"]
          created_at: string
          deleted_at: string | null
          id: string
          insurance_plan_id: string | null
          patient_id: string
          professional_id: string
          session_date: string
          session_type: string | null
          tenant_id: string
          updated_at: string
          value: number | null
        }
        Insert: {
          appointment_id?: string | null
          billing_status?: Database["public"]["Enums"]["billing_status"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          insurance_plan_id?: string | null
          patient_id: string
          professional_id: string
          session_date: string
          session_type?: string | null
          tenant_id: string
          updated_at?: string
          value?: number | null
        }
        Update: {
          appointment_id?: string | null
          billing_status?: Database["public"]["Enums"]["billing_status"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          insurance_plan_id?: string | null
          patient_id?: string
          professional_id?: string
          session_date?: string
          session_type?: string | null
          tenant_id?: string
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_insurance_plan_id_fkey"
            columns: ["insurance_plan_id"]
            isOneToOne: false
            referencedRelation: "insurance_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professional_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          billing_status: string
          cnpj: string | null
          created_at: string
          id: string
          is_internal: boolean
          legal_name: string | null
          name: string
          plan: string | null
        }
        Insert: {
          billing_status?: string
          cnpj?: string | null
          created_at?: string
          id?: string
          is_internal?: boolean
          legal_name?: string | null
          name: string
          plan?: string | null
        }
        Update: {
          billing_status?: string
          cnpj?: string | null
          created_at?: string
          id?: string
          is_internal?: boolean
          legal_name?: string | null
          name?: string
          plan?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          active: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          tenant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          full_name: string
          id: string
          phone?: string | null
          role: Database["public"]["Enums"]["user_role"]
          tenant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_entries: {
        Row: {
          created_at: string
          id: string
          matched_appointment_id: string | null
          min_age: number | null
          patient_name: string
          patient_phone: string | null
          preferred_period: string | null
          preferred_weekday: number | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          matched_appointment_id?: string | null
          min_age?: number | null
          patient_name: string
          patient_phone?: string | null
          preferred_period?: string | null
          preferred_weekday?: number | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          matched_appointment_id?: string | null
          min_age?: number | null
          patient_name?: string
          patient_phone?: string | null
          preferred_period?: string | null
          preferred_weekday?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_matched_appointment_id_fkey"
            columns: ["matched_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_tenant_id: { Args: never; Returns: string }
      hmac_blind_index: { Args: { plaintext: string }; Returns: string }
      is_platform_admin: { Args: never; Returns: boolean }
      pgp_decrypt_field: { Args: { ciphertext: string }; Returns: string }
      pgp_encrypt_field: { Args: { plaintext: string }; Returns: string }
    }
    Enums: {
      appointment_status:
        | "scheduled"
        | "cancelled"
        | "discharged"
        | "transferred"
      billing_status:
        | "not_billed"
        | "billed"
        | "awaiting_operator"
        | "paid"
        | "glossed"
        | "missed"
      guide_status:
        | "registered"
        | "billed"
        | "missing_registration"
        | "missed"
        | "glossed"
        | "glossed_pending"
        | "excluded"
      user_role: "owner" | "manager" | "admin_staff" | "professional"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      appointment_status: [
        "scheduled",
        "cancelled",
        "discharged",
        "transferred",
      ],
      billing_status: [
        "not_billed",
        "billed",
        "awaiting_operator",
        "paid",
        "glossed",
        "missed",
      ],
      guide_status: [
        "registered",
        "billed",
        "missing_registration",
        "missed",
        "glossed",
        "glossed_pending",
        "excluded",
      ],
      user_role: ["owner", "manager", "admin_staff", "professional"],
    },
  },
} as const
