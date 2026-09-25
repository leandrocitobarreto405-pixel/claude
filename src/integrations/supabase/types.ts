export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      app_settings: {
        Row: {
          empresa_id: string;
          key: string;
          updated_at: string;
          value: NonNullable<Json>;
        };
        Insert: {
          empresa_id?: string;
          key: string;
          updated_at?: string;
          value?: NonNullable<Json>;
        };
        Update: {
          empresa_id?: string;
          key?: string;
          updated_at?: string;
          value?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "app_settings_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      budget_visits: {
        Row: {
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          crm_lead_id: string | null;
          customer_id: string;
          empresa_id: string;
          generated_work_order_id: string | null;
          google_event_id: string | null;
          id: string;
          mileage_cost_allocated: number;
          notes: string | null;
          result: string | null;
          result_notes: string | null;
          sales_origin_id: string | null;
          scheduled_date: string;
          scheduled_time: string;
          status: string;
          technician_id: string | null;
          updated_at: string;
          upholstery_description: string | null;
          visit_fee: number;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          crm_lead_id?: string | null;
          customer_id: string;
          empresa_id?: string;
          generated_work_order_id?: string | null;
          google_event_id?: string | null;
          id?: string;
          mileage_cost_allocated?: number;
          notes?: string | null;
          result?: string | null;
          result_notes?: string | null;
          sales_origin_id?: string | null;
          scheduled_date: string;
          scheduled_time?: string;
          status?: string;
          technician_id?: string | null;
          updated_at?: string;
          upholstery_description?: string | null;
          visit_fee?: number;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          crm_lead_id?: string | null;
          customer_id?: string;
          empresa_id?: string;
          generated_work_order_id?: string | null;
          google_event_id?: string | null;
          id?: string;
          mileage_cost_allocated?: number;
          notes?: string | null;
          result?: string | null;
          result_notes?: string | null;
          sales_origin_id?: string | null;
          scheduled_date?: string;
          scheduled_time?: string;
          status?: string;
          technician_id?: string | null;
          updated_at?: string;
          upholstery_description?: string | null;
          visit_fee?: number;
        };
        Relationships: [
          {
            foreignKeyName: "budget_visits_crm_lead_id_fkey";
            columns: ["crm_lead_id"];
            referencedRelation: "crm_leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "budget_visits_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "budget_visits_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "budget_visits_generated_work_order_id_fkey";
            columns: ["generated_work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "budget_visits_sales_origin_id_fkey";
            columns: ["sales_origin_id"];
            referencedRelation: "config_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "budget_visits_technician_id_fkey";
            columns: ["technician_id"];
            referencedRelation: "technicians";
            referencedColumns: ["id"];
          },
        ];
      };
      campaign_investments: {
        Row: {
          amount: number;
          campaign_id: string;
          created_at: string;
          empresa_id: string;
          id: string;
          notes: string | null;
          period_end_date: string | null;
          reference_date: string;
          updated_at: string;
        };
        Insert: {
          amount?: number;
          campaign_id: string;
          created_at?: string;
          empresa_id?: string;
          id?: string;
          notes?: string | null;
          period_end_date?: string | null;
          reference_date: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          campaign_id?: string;
          created_at?: string;
          empresa_id?: string;
          id?: string;
          notes?: string | null;
          period_end_date?: string | null;
          reference_date?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "campaign_investments_campaign_id_fkey";
            columns: ["campaign_id"];
            referencedRelation: "crm_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "campaign_investments_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      config_options: {
        Row: {
          active: boolean;
          created_at: string;
          display_order: number;
          empresa_id: string;
          id: string;
          kind: string;
          metadata: NonNullable<Json>;
          name: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          display_order?: number;
          empresa_id?: string;
          id?: string;
          kind: string;
          metadata?: NonNullable<Json>;
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          display_order?: number;
          empresa_id?: string;
          id?: string;
          kind?: string;
          metadata?: NonNullable<Json>;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "config_options_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      configuracoes_plataforma: {
        Row: {
          chave: string;
          descricao: string | null;
          updated_at: string;
          updated_by: string | null;
          valor: NonNullable<Json>;
        };
        Insert: {
          chave: string;
          descricao?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valor: NonNullable<Json>;
        };
        Update: {
          chave?: string;
          descricao?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valor?: NonNullable<Json>;
        };
        Relationships: [];
      };
      contratos_comissao: {
        Row: {
          base: string;
          created_at: string;
          created_by: string | null;
          empresa_id: string;
          id: string;
          observacoes: string | null;
          percentual: number;
          somente_atendentes_nexa: boolean;
          updated_at: string;
          vigencia_fim: string | null;
          vigencia_inicio: string;
        };
        Insert: {
          base?: string;
          created_at?: string;
          created_by?: string | null;
          empresa_id: string;
          id?: string;
          observacoes?: string | null;
          percentual: number;
          somente_atendentes_nexa?: boolean;
          updated_at?: string;
          vigencia_fim?: string | null;
          vigencia_inicio: string;
        };
        Update: {
          base?: string;
          created_at?: string;
          created_by?: string | null;
          empresa_id?: string;
          id?: string;
          observacoes?: string | null;
          percentual?: number;
          somente_atendentes_nexa?: boolean;
          updated_at?: string;
          vigencia_fim?: string | null;
          vigencia_inicio?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contratos_comissao_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      convites_empresa: {
        Row: {
          aceito_em: string | null;
          created_at: string;
          criado_por: string | null;
          email: string;
          empresa_id: string;
          id: string;
          papel: Database["public"]["Enums"]["papel_empresa"];
        };
        Insert: {
          aceito_em?: string | null;
          created_at?: string;
          criado_por?: string | null;
          email: string;
          empresa_id?: string;
          id?: string;
          papel?: Database["public"]["Enums"]["papel_empresa"];
        };
        Update: {
          aceito_em?: string | null;
          created_at?: string;
          criado_por?: string | null;
          email?: string;
          empresa_id?: string;
          id?: string;
          papel?: Database["public"]["Enums"]["papel_empresa"];
        };
        Relationships: [
          {
            foreignKeyName: "convites_empresa_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_campaigns: {
        Row: {
          active: boolean;
          ad_external_id: string | null;
          ad_name: string | null;
          ad_set_external_id: string | null;
          ad_set_name: string | null;
          advertised_service: string | null;
          campaign_external_id: string | null;
          campaign_name: string;
          created_at: string;
          empresa_id: string;
          id: string;
          platform: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          ad_external_id?: string | null;
          ad_name?: string | null;
          ad_set_external_id?: string | null;
          ad_set_name?: string | null;
          advertised_service?: string | null;
          campaign_external_id?: string | null;
          campaign_name: string;
          created_at?: string;
          empresa_id?: string;
          id?: string;
          platform?: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          ad_external_id?: string | null;
          ad_name?: string | null;
          ad_set_external_id?: string | null;
          ad_set_name?: string | null;
          advertised_service?: string | null;
          campaign_external_id?: string | null;
          campaign_name?: string;
          created_at?: string;
          empresa_id?: string;
          id?: string;
          platform?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crm_campaigns_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_followups: {
        Row: {
          assigned_to: string | null;
          completed_at: string | null;
          created_at: string;
          crm_lead_id: string;
          empresa_id: string;
          id: string;
          notes: string | null;
          result: string | null;
          scheduled_at: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          completed_at?: string | null;
          created_at?: string;
          crm_lead_id: string;
          empresa_id?: string;
          id?: string;
          notes?: string | null;
          result?: string | null;
          scheduled_at?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          completed_at?: string | null;
          created_at?: string;
          crm_lead_id?: string;
          empresa_id?: string;
          id?: string;
          notes?: string | null;
          result?: string | null;
          scheduled_at?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crm_followups_crm_lead_id_fkey";
            columns: ["crm_lead_id"];
            referencedRelation: "crm_leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_followups_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_import_batches: {
        Row: {
          created_at: string;
          created_leads: number;
          empresa_id: string;
          errors: NonNullable<Json>;
          file_name: string | null;
          id: string;
          imported_by: string | null;
          mode: string;
          skipped_rows: number;
          total_rows: number;
          updated_leads: number;
        };
        Insert: {
          created_at?: string;
          created_leads?: number;
          empresa_id?: string;
          errors?: NonNullable<Json>;
          file_name?: string | null;
          id?: string;
          imported_by?: string | null;
          mode?: string;
          skipped_rows?: number;
          total_rows?: number;
          updated_leads?: number;
        };
        Update: {
          created_at?: string;
          created_leads?: number;
          empresa_id?: string;
          errors?: NonNullable<Json>;
          file_name?: string | null;
          id?: string;
          imported_by?: string | null;
          mode?: string;
          skipped_rows?: number;
          total_rows?: number;
          updated_leads?: number;
        };
        Relationships: [
          {
            foreignKeyName: "crm_import_batches_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_leads: {
        Row: {
          ad_id: string | null;
          campaign_id: string | null;
          closed_at: string | null;
          created_at: string;
          customer_id: string | null;
          empresa_id: string;
          first_contact_date: string;
          follow_up_result: string | null;
          id: string;
          import_batch_id: string | null;
          is_open: boolean;
          last_follow_up_at: string | null;
          last_interaction_at: string | null;
          lead_name: string;
          linked_work_order_id: string | null;
          loss_reason_id: string | null;
          next_follow_up_at: string | null;
          normalized_phone: string | null;
          notes: string | null;
          phone: string;
          referral_data: NonNullable<Json>;
          sales_origin_id: string | null;
          salesperson_id: string | null;
          service_interest: string | null;
          source_type: string | null;
          status_id: string | null;
          summary: string | null;
          summary_source: string;
          temperature: string;
          temperature_confirmed: boolean;
          temperature_score: number | null;
          updated_at: string;
          upholstery_description: string | null;
          whatsapp_contact_id: string | null;
        };
        Insert: {
          ad_id?: string | null;
          campaign_id?: string | null;
          closed_at?: string | null;
          created_at?: string;
          customer_id?: string | null;
          empresa_id?: string;
          first_contact_date?: string;
          follow_up_result?: string | null;
          id?: string;
          import_batch_id?: string | null;
          is_open?: boolean;
          last_follow_up_at?: string | null;
          last_interaction_at?: string | null;
          lead_name?: string;
          linked_work_order_id?: string | null;
          loss_reason_id?: string | null;
          next_follow_up_at?: string | null;
          normalized_phone?: string | null;
          notes?: string | null;
          phone?: string;
          referral_data?: NonNullable<Json>;
          sales_origin_id?: string | null;
          salesperson_id?: string | null;
          service_interest?: string | null;
          source_type?: string | null;
          status_id?: string | null;
          summary?: string | null;
          summary_source?: string;
          temperature?: string;
          temperature_confirmed?: boolean;
          temperature_score?: number | null;
          updated_at?: string;
          upholstery_description?: string | null;
          whatsapp_contact_id?: string | null;
        };
        Update: {
          ad_id?: string | null;
          campaign_id?: string | null;
          closed_at?: string | null;
          created_at?: string;
          customer_id?: string | null;
          empresa_id?: string;
          first_contact_date?: string;
          follow_up_result?: string | null;
          id?: string;
          import_batch_id?: string | null;
          is_open?: boolean;
          last_follow_up_at?: string | null;
          last_interaction_at?: string | null;
          lead_name?: string;
          linked_work_order_id?: string | null;
          loss_reason_id?: string | null;
          next_follow_up_at?: string | null;
          normalized_phone?: string | null;
          notes?: string | null;
          phone?: string;
          referral_data?: NonNullable<Json>;
          sales_origin_id?: string | null;
          salesperson_id?: string | null;
          service_interest?: string | null;
          source_type?: string | null;
          status_id?: string | null;
          summary?: string | null;
          summary_source?: string;
          temperature?: string;
          temperature_confirmed?: boolean;
          temperature_score?: number | null;
          updated_at?: string;
          upholstery_description?: string | null;
          whatsapp_contact_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_leads_campaign_id_fkey";
            columns: ["campaign_id"];
            referencedRelation: "crm_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_leads_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_leads_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_leads_import_batch_id_fkey";
            columns: ["import_batch_id"];
            referencedRelation: "crm_import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_leads_linked_work_order_id_fkey";
            columns: ["linked_work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_leads_loss_reason_id_fkey";
            columns: ["loss_reason_id"];
            referencedRelation: "config_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_leads_sales_origin_id_fkey";
            columns: ["sales_origin_id"];
            referencedRelation: "config_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_leads_salesperson_id_fkey";
            columns: ["salesperson_id"];
            referencedRelation: "salespeople";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_leads_status_id_fkey";
            columns: ["status_id"];
            referencedRelation: "config_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_leads_whatsapp_contact_id_fkey";
            columns: ["whatsapp_contact_id"];
            referencedRelation: "whatsapp_contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_source_integrations: {
        Row: {
          active: boolean;
          created_at: string;
          default_campaign_id: string | null;
          default_salesperson_id: string | null;
          empresa_id: string;
          field_mapping: NonNullable<Json>;
          id: string;
          name: string;
          secret: string | null;
          source_type: Database["public"]["Enums"]["crm_source_type"];
          updated_at: string;
          webhook_token: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          default_campaign_id?: string | null;
          default_salesperson_id?: string | null;
          empresa_id?: string;
          field_mapping?: NonNullable<Json>;
          id?: string;
          name: string;
          secret?: string | null;
          source_type: Database["public"]["Enums"]["crm_source_type"];
          updated_at?: string;
          webhook_token: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          default_campaign_id?: string | null;
          default_salesperson_id?: string | null;
          empresa_id?: string;
          field_mapping?: NonNullable<Json>;
          id?: string;
          name?: string;
          secret?: string | null;
          source_type?: Database["public"]["Enums"]["crm_source_type"];
          updated_at?: string;
          webhook_token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crm_source_integrations_default_campaign_id_fkey";
            columns: ["default_campaign_id"];
            referencedRelation: "crm_campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_source_integrations_default_salesperson_id_fkey";
            columns: ["default_salesperson_id"];
            referencedRelation: "salespeople";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_source_integrations_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_status_history: {
        Row: {
          change_source: string;
          changed_at: string;
          changed_by: string | null;
          crm_lead_id: string;
          empresa_id: string;
          id: string;
          new_status_id: string | null;
          new_status_name: string | null;
          notes: string | null;
          previous_status_id: string | null;
          previous_status_name: string | null;
        };
        Insert: {
          change_source?: string;
          changed_at?: string;
          changed_by?: string | null;
          crm_lead_id: string;
          empresa_id?: string;
          id?: string;
          new_status_id?: string | null;
          new_status_name?: string | null;
          notes?: string | null;
          previous_status_id?: string | null;
          previous_status_name?: string | null;
        };
        Update: {
          change_source?: string;
          changed_at?: string;
          changed_by?: string | null;
          crm_lead_id?: string;
          empresa_id?: string;
          id?: string;
          new_status_id?: string | null;
          new_status_name?: string | null;
          notes?: string | null;
          previous_status_id?: string | null;
          previous_status_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_status_history_crm_lead_id_fkey";
            columns: ["crm_lead_id"];
            referencedRelation: "crm_leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_status_history_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_webhook_events: {
        Row: {
          contact_created: boolean;
          contact_id: string | null;
          crm_lead_id: string | null;
          duplicated_messages: number;
          empresa_id: string;
          error_message: string | null;
          event_reference: string | null;
          id: string;
          lead_created: boolean;
          messages_stored: number;
          payload: NonNullable<Json>;
          processed_at: string | null;
          processing_status: string;
          received_at: string;
          retry_count: number;
        };
        Insert: {
          contact_created?: boolean;
          contact_id?: string | null;
          crm_lead_id?: string | null;
          duplicated_messages?: number;
          empresa_id?: string;
          error_message?: string | null;
          event_reference?: string | null;
          id?: string;
          lead_created?: boolean;
          messages_stored?: number;
          payload?: NonNullable<Json>;
          processed_at?: string | null;
          processing_status?: string;
          received_at?: string;
          retry_count?: number;
        };
        Update: {
          contact_created?: boolean;
          contact_id?: string | null;
          crm_lead_id?: string | null;
          duplicated_messages?: number;
          empresa_id?: string;
          error_message?: string | null;
          event_reference?: string | null;
          id?: string;
          lead_created?: boolean;
          messages_stored?: number;
          payload?: NonNullable<Json>;
          processed_at?: string | null;
          processing_status?: string;
          received_at?: string;
          retry_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "crm_webhook_events_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          city: string | null;
          complement: string | null;
          created_at: string;
          document_number: string | null;
          email: string | null;
          empresa_id: string;
          full_address: string | null;
          full_name: string;
          id: string;
          latitude: number | null;
          longitude: number | null;
          neighborhood: string | null;
          notes: string | null;
          phone: string;
          postal_code: string | null;
          reference_point: string | null;
          state: string | null;
          street: string | null;
          street_number: string | null;
          updated_at: string;
        };
        Insert: {
          city?: string | null;
          complement?: string | null;
          created_at?: string;
          document_number?: string | null;
          email?: string | null;
          empresa_id?: string;
          full_address?: string | null;
          full_name: string;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          neighborhood?: string | null;
          notes?: string | null;
          phone: string;
          postal_code?: string | null;
          reference_point?: string | null;
          state?: string | null;
          street?: string | null;
          street_number?: string | null;
          updated_at?: string;
        };
        Update: {
          city?: string | null;
          complement?: string | null;
          created_at?: string;
          document_number?: string | null;
          email?: string | null;
          empresa_id?: string;
          full_address?: string | null;
          full_name?: string;
          id?: string;
          latitude?: number | null;
          longitude?: number | null;
          neighborhood?: string | null;
          notes?: string | null;
          phone?: string;
          postal_code?: string | null;
          reference_point?: string | null;
          state?: string | null;
          street?: string | null;
          street_number?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_routes: {
        Row: {
          adjustment_reason: string | null;
          allocation_method: string;
          base_address: string | null;
          calculated_at: string | null;
          calculated_km: number | null;
          calculation_source: string;
          cost_per_km: number | null;
          created_at: string;
          empresa_id: string;
          error_message: string | null;
          estimated_minutes: number | null;
          expense_id: string | null;
          financial_difference: boolean;
          id: string;
          last_auto_sync_at: string | null;
          needs_recalculation: boolean;
          paid_amount_snapshot: number | null;
          real_km: number | null;
          route_date: string;
          route_status: string;
          segments: NonNullable<Json>;
          technician_id: string | null;
          total_cost: number | null;
          updated_at: string;
        };
        Insert: {
          adjustment_reason?: string | null;
          allocation_method?: string;
          base_address?: string | null;
          calculated_at?: string | null;
          calculated_km?: number | null;
          calculation_source?: string;
          cost_per_km?: number | null;
          created_at?: string;
          empresa_id?: string;
          error_message?: string | null;
          estimated_minutes?: number | null;
          expense_id?: string | null;
          financial_difference?: boolean;
          id?: string;
          last_auto_sync_at?: string | null;
          needs_recalculation?: boolean;
          paid_amount_snapshot?: number | null;
          real_km?: number | null;
          route_date: string;
          route_status?: string;
          segments?: NonNullable<Json>;
          technician_id?: string | null;
          total_cost?: number | null;
          updated_at?: string;
        };
        Update: {
          adjustment_reason?: string | null;
          allocation_method?: string;
          base_address?: string | null;
          calculated_at?: string | null;
          calculated_km?: number | null;
          calculation_source?: string;
          cost_per_km?: number | null;
          created_at?: string;
          empresa_id?: string;
          error_message?: string | null;
          estimated_minutes?: number | null;
          expense_id?: string | null;
          financial_difference?: boolean;
          id?: string;
          last_auto_sync_at?: string | null;
          needs_recalculation?: boolean;
          paid_amount_snapshot?: number | null;
          real_km?: number | null;
          route_date?: string;
          route_status?: string;
          segments?: NonNullable<Json>;
          technician_id?: string | null;
          total_cost?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "daily_routes_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_routes_expense_id_fkey";
            columns: ["expense_id"];
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_routes_technician_id_fkey";
            columns: ["technician_id"];
            referencedRelation: "technicians";
            referencedColumns: ["id"];
          },
        ];
      };
      empresas: {
        Row: {
          ativo: boolean;
          cnpj: string | null;
          controle_insumos_ativo: boolean;
          created_at: string;
          id: string;
          nome: string;
          plano: string;
          telefone: string | null;
          updated_at: string;
        };
        Insert: {
          ativo?: boolean;
          cnpj?: string | null;
          controle_insumos_ativo?: boolean;
          created_at?: string;
          id?: string;
          nome: string;
          plano?: string;
          telefone?: string | null;
          updated_at?: string;
        };
        Update: {
          ativo?: boolean;
          cnpj?: string | null;
          controle_insumos_ativo?: boolean;
          created_at?: string;
          id?: string;
          nome?: string;
          plano?: string;
          telefone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      expense_status_history: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          empresa_id: string;
          expense_id: string;
          id: string;
          new_paid_amount: number | null;
          new_payment_date: string | null;
          new_status: string;
          notes: string | null;
          previous_paid_amount: number | null;
          previous_payment_date: string | null;
          previous_status: string | null;
          reason: string | null;
        };
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          empresa_id?: string;
          expense_id: string;
          id?: string;
          new_paid_amount?: number | null;
          new_payment_date?: string | null;
          new_status: string;
          notes?: string | null;
          previous_paid_amount?: number | null;
          previous_payment_date?: string | null;
          previous_status?: string | null;
          reason?: string | null;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          empresa_id?: string;
          expense_id?: string;
          id?: string;
          new_paid_amount?: number | null;
          new_payment_date?: string | null;
          new_status?: string;
          notes?: string | null;
          previous_paid_amount?: number | null;
          previous_payment_date?: string | null;
          previous_status?: string | null;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expense_status_history_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_status_history_expense_id_fkey";
            columns: ["expense_id"];
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          actual_amount: number | null;
          beneficiary: string | null;
          category: string;
          competence_date: string;
          created_at: string;
          daily_route_id: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          description: string;
          due_date: string | null;
          empresa_id: string;
          expected_amount: number;
          id: string;
          notes: string | null;
          origin: string;
          paid_amount: number;
          payment_date: string | null;
          payment_method: string | null;
          receipt_url: string | null;
          recurring_expense_id: string | null;
          reference_key: string | null;
          status: string;
          updated_at: string;
          updated_by: string | null;
          work_order_id: string | null;
        };
        Insert: {
          actual_amount?: number | null;
          beneficiary?: string | null;
          category?: string;
          competence_date?: string;
          created_at?: string;
          daily_route_id?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description: string;
          due_date?: string | null;
          empresa_id?: string;
          expected_amount?: number;
          id?: string;
          notes?: string | null;
          origin?: string;
          paid_amount?: number;
          payment_date?: string | null;
          payment_method?: string | null;
          receipt_url?: string | null;
          recurring_expense_id?: string | null;
          reference_key?: string | null;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          work_order_id?: string | null;
        };
        Update: {
          actual_amount?: number | null;
          beneficiary?: string | null;
          category?: string;
          competence_date?: string;
          created_at?: string;
          daily_route_id?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string;
          due_date?: string | null;
          empresa_id?: string;
          expected_amount?: number;
          id?: string;
          notes?: string | null;
          origin?: string;
          paid_amount?: number;
          payment_date?: string | null;
          payment_method?: string | null;
          receipt_url?: string | null;
          recurring_expense_id?: string | null;
          reference_key?: string | null;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          work_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_daily_route_id_fkey";
            columns: ["daily_route_id"];
            referencedRelation: "daily_routes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_recurring_expense_id_fkey";
            columns: ["recurring_expense_id"];
            referencedRelation: "recurring_expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_tasks: {
        Row: {
          created_at: string;
          customer_id: string | null;
          document_number: string | null;
          empresa_id: string;
          file_url: string | null;
          id: string;
          invoice_amount: number;
          invoice_number: string | null;
          issue_date: string | null;
          notes: string | null;
          service_date: string | null;
          status: string;
          updated_at: string;
          work_order_id: string;
        };
        Insert: {
          created_at?: string;
          customer_id?: string | null;
          document_number?: string | null;
          empresa_id?: string;
          file_url?: string | null;
          id?: string;
          invoice_amount?: number;
          invoice_number?: string | null;
          issue_date?: string | null;
          notes?: string | null;
          service_date?: string | null;
          status?: string;
          updated_at?: string;
          work_order_id: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string | null;
          document_number?: string | null;
          empresa_id?: string;
          file_url?: string | null;
          id?: string;
          invoice_amount?: number;
          invoice_number?: string | null;
          issue_date?: string | null;
          notes?: string | null;
          service_date?: string | null;
          status?: string;
          updated_at?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_tasks_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_tasks_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_tasks_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      job_runs: {
        Row: {
          created_at: string;
          details: NonNullable<Json>;
          empresa_id: string;
          errors: NonNullable<Json>;
          expenses_created: number;
          expenses_updated: number;
          finished_at: string | null;
          id: string;
          job_name: string;
          reference_date: string | null;
          routes_created: number;
          routes_skipped: number;
          routes_updated: number;
          started_at: string;
          status: string;
          technicians_processed: number;
        };
        Insert: {
          created_at?: string;
          details?: NonNullable<Json>;
          empresa_id?: string;
          errors?: NonNullable<Json>;
          expenses_created?: number;
          expenses_updated?: number;
          finished_at?: string | null;
          id?: string;
          job_name: string;
          reference_date?: string | null;
          routes_created?: number;
          routes_skipped?: number;
          routes_updated?: number;
          started_at?: string;
          status?: string;
          technicians_processed?: number;
        };
        Update: {
          created_at?: string;
          details?: NonNullable<Json>;
          empresa_id?: string;
          errors?: NonNullable<Json>;
          expenses_created?: number;
          expenses_updated?: number;
          finished_at?: string | null;
          id?: string;
          job_name?: string;
          reference_date?: string | null;
          routes_created?: number;
          routes_skipped?: number;
          routes_updated?: number;
          started_at?: string;
          status?: string;
          technicians_processed?: number;
        };
        Relationships: [
          {
            foreignKeyName: "job_runs_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      monthly_goals: {
        Row: {
          created_at: string;
          empresa_id: string;
          goal_amount: number;
          id: string;
          month: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          empresa_id?: string;
          goal_amount?: number;
          id?: string;
          month: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          empresa_id?: string;
          goal_amount?: number;
          id?: string;
          month?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "monthly_goals_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      os_drive_files: {
        Row: {
          created_at: string;
          destination: string;
          empresa_id: string;
          file_name: string;
          file_size: number;
          folder_id: string;
          google_file_id: string;
          google_file_url: string | null;
          id: string;
          mime_type: string;
          uploaded_by: string | null;
          work_order_id: string;
        };
        Insert: {
          created_at?: string;
          destination: string;
          empresa_id?: string;
          file_name: string;
          file_size: number;
          folder_id: string;
          google_file_id: string;
          google_file_url?: string | null;
          id?: string;
          mime_type: string;
          uploaded_by?: string | null;
          work_order_id: string;
        };
        Update: {
          created_at?: string;
          destination?: string;
          empresa_id?: string;
          file_name?: string;
          file_size?: number;
          folder_id?: string;
          google_file_id?: string;
          google_file_url?: string | null;
          id?: string;
          mime_type?: string;
          uploaded_by?: string | null;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "os_drive_files_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "os_drive_files_folder_id_fkey";
            columns: ["folder_id"];
            referencedRelation: "os_drive_folders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "os_drive_files_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      os_drive_folders: {
        Row: {
          after_folder_id: string | null;
          before_folder_id: string | null;
          created_at: string;
          customer_shared_email: string | null;
          empresa_id: string;
          folder_month: string;
          folder_name: string | null;
          folder_year: string;
          id: string;
          internal_folder_id: string | null;
          materials_folder_id: string | null;
          materials_folder_url: string | null;
          updated_at: string;
          videos_folder_id: string | null;
          work_order_id: string;
        };
        Insert: {
          after_folder_id?: string | null;
          before_folder_id?: string | null;
          created_at?: string;
          customer_shared_email?: string | null;
          empresa_id?: string;
          folder_month: string;
          folder_name?: string | null;
          folder_year: string;
          id?: string;
          internal_folder_id?: string | null;
          materials_folder_id?: string | null;
          materials_folder_url?: string | null;
          updated_at?: string;
          videos_folder_id?: string | null;
          work_order_id: string;
        };
        Update: {
          after_folder_id?: string | null;
          before_folder_id?: string | null;
          created_at?: string;
          customer_shared_email?: string | null;
          empresa_id?: string;
          folder_month?: string;
          folder_name?: string | null;
          folder_year?: string;
          id?: string;
          internal_folder_id?: string | null;
          materials_folder_id?: string | null;
          materials_folder_url?: string | null;
          updated_at?: string;
          videos_folder_id?: string | null;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "os_drive_folders_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "os_drive_folders_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      os_produtos_utilizados: {
        Row: {
          created_at: string;
          created_by: string | null;
          custo_calculado: number;
          custo_por_ml_snapshot: number;
          empresa_id: string;
          id: string;
          produto_id: string | null;
          produto_nome: string;
          quantidade_ml: number;
          visit_id: string | null;
          work_order_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          custo_calculado?: number;
          custo_por_ml_snapshot?: number;
          empresa_id?: string;
          id?: string;
          produto_id?: string | null;
          produto_nome?: string;
          quantidade_ml: number;
          visit_id?: string | null;
          work_order_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          custo_calculado?: number;
          custo_por_ml_snapshot?: number;
          empresa_id?: string;
          id?: string;
          produto_id?: string | null;
          produto_nome?: string;
          quantidade_ml?: number;
          visit_id?: string | null;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "os_produtos_utilizados_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "os_produtos_utilizados_produto_id_fkey";
            columns: ["produto_id"];
            referencedRelation: "produtos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "os_produtos_utilizados_visit_id_fkey";
            columns: ["visit_id"];
            referencedRelation: "visits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "os_produtos_utilizados_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_history: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          empresa_id: string;
          event_type: string;
          id: string;
          new_applied_rate: number | null;
          new_gross_amount: number | null;
          new_installments: number | null;
          new_net_amount: number | null;
          new_payment_channel: string | null;
          new_payment_date: string | null;
          new_payment_fee_amount: number | null;
          new_payment_status: string | null;
          new_payment_type: string | null;
          notes: string | null;
          payment_id: string;
          previous_applied_rate: number | null;
          previous_gross_amount: number | null;
          previous_installments: number | null;
          previous_net_amount: number | null;
          previous_payment_channel: string | null;
          previous_payment_date: string | null;
          previous_payment_fee_amount: number | null;
          previous_payment_status: string | null;
          previous_payment_type: string | null;
          reason: string | null;
          work_order_id: string | null;
        };
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          empresa_id?: string;
          event_type: string;
          id?: string;
          new_applied_rate?: number | null;
          new_gross_amount?: number | null;
          new_installments?: number | null;
          new_net_amount?: number | null;
          new_payment_channel?: string | null;
          new_payment_date?: string | null;
          new_payment_fee_amount?: number | null;
          new_payment_status?: string | null;
          new_payment_type?: string | null;
          notes?: string | null;
          payment_id: string;
          previous_applied_rate?: number | null;
          previous_gross_amount?: number | null;
          previous_installments?: number | null;
          previous_net_amount?: number | null;
          previous_payment_channel?: string | null;
          previous_payment_date?: string | null;
          previous_payment_fee_amount?: number | null;
          previous_payment_status?: string | null;
          previous_payment_type?: string | null;
          reason?: string | null;
          work_order_id?: string | null;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          empresa_id?: string;
          event_type?: string;
          id?: string;
          new_applied_rate?: number | null;
          new_gross_amount?: number | null;
          new_installments?: number | null;
          new_net_amount?: number | null;
          new_payment_channel?: string | null;
          new_payment_date?: string | null;
          new_payment_fee_amount?: number | null;
          new_payment_status?: string | null;
          new_payment_type?: string | null;
          notes?: string | null;
          payment_id?: string;
          previous_applied_rate?: number | null;
          previous_gross_amount?: number | null;
          previous_installments?: number | null;
          previous_net_amount?: number | null;
          previous_payment_channel?: string | null;
          previous_payment_date?: string | null;
          previous_payment_fee_amount?: number | null;
          previous_payment_status?: string | null;
          previous_payment_type?: string | null;
          reason?: string | null;
          work_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_history_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_history_payment_id_fkey";
            columns: ["payment_id"];
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_history_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_rates: {
        Row: {
          active: boolean;
          channel: string;
          created_at: string;
          effective_from: string;
          empresa_id: string;
          id: string;
          installments: number;
          payment_type: string;
          rate_percent: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          channel: string;
          created_at?: string;
          effective_from?: string;
          empresa_id?: string;
          id?: string;
          installments?: number;
          payment_type: string;
          rate_percent?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          channel?: string;
          created_at?: string;
          effective_from?: string;
          empresa_id?: string;
          id?: string;
          installments?: number;
          payment_type?: string;
          rate_percent?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_rates_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          applied_rate: number;
          created_at: string;
          empresa_id: string;
          gross_amount: number;
          id: string;
          installments: number;
          is_active: boolean;
          net_amount: number;
          notes: string | null;
          payment_channel: string;
          payment_date: string | null;
          payment_fee_amount: number;
          payment_status: string;
          payment_type: string;
          reopen_reason: string | null;
          reopened_at: string | null;
          reopened_by: string | null;
          updated_at: string;
          visit_id: string | null;
          work_order_id: string;
        };
        Insert: {
          applied_rate?: number;
          created_at?: string;
          empresa_id?: string;
          gross_amount?: number;
          id?: string;
          installments?: number;
          is_active?: boolean;
          net_amount?: number;
          notes?: string | null;
          payment_channel: string;
          payment_date?: string | null;
          payment_fee_amount?: number;
          payment_status?: string;
          payment_type?: string;
          reopen_reason?: string | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
          updated_at?: string;
          visit_id?: string | null;
          work_order_id: string;
        };
        Update: {
          applied_rate?: number;
          created_at?: string;
          empresa_id?: string;
          gross_amount?: number;
          id?: string;
          installments?: number;
          is_active?: boolean;
          net_amount?: number;
          notes?: string | null;
          payment_channel?: string;
          payment_date?: string | null;
          payment_fee_amount?: number;
          payment_status?: string;
          payment_type?: string;
          reopen_reason?: string | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
          updated_at?: string;
          visit_id?: string | null;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_visit_id_fkey";
            columns: ["visit_id"];
            referencedRelation: "visits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      plataforma_usuarios: {
        Row: {
          ativo: boolean;
          created_at: string;
          papel: string;
          user_id: string;
        };
        Insert: {
          ativo?: boolean;
          created_at?: string;
          papel: string;
          user_id: string;
        };
        Update: {
          ativo?: boolean;
          created_at?: string;
          papel?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      produtos: {
        Row: {
          ativo: boolean;
          created_at: string;
          custo_por_ml: number | null;
          empresa_id: string;
          estoque_atual_ml: number;
          id: string;
          nome: string;
          preco_pago: number;
          tipo_servico: Database["public"]["Enums"]["produto_tipo_servico"];
          updated_at: string;
          volume_embalagem_ml: number;
        };
        Insert: {
          ativo?: boolean;
          created_at?: string;
          custo_por_ml?: never;
          empresa_id?: string;
          estoque_atual_ml?: number;
          id?: string;
          nome: string;
          preco_pago?: number;
          tipo_servico: Database["public"]["Enums"]["produto_tipo_servico"];
          updated_at?: string;
          volume_embalagem_ml: number;
        };
        Update: {
          ativo?: boolean;
          created_at?: string;
          custo_por_ml?: never;
          empresa_id?: string;
          estoque_atual_ml?: number;
          id?: string;
          nome?: string;
          preco_pago?: number;
          tipo_servico?: Database["public"]["Enums"]["produto_tipo_servico"];
          updated_at?: string;
          volume_embalagem_ml?: number;
        };
        Relationships: [
          {
            foreignKeyName: "produtos_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      quote_items: {
        Row: {
          created_at: string;
          display_order: number;
          empresa_id: string;
          id: string;
          motivo_desconto: string | null;
          nome_snapshot: string;
          preco_aplicado: number;
          preco_tabela: number;
          quantidade: number;
          quote_id: string;
          subtotal: number;
          tabela_preco_item_id: string | null;
          tipo_servico: Database["public"]["Enums"]["quote_tipo_servico"];
        };
        Insert: {
          created_at?: string;
          display_order?: number;
          empresa_id?: string;
          id?: string;
          motivo_desconto?: string | null;
          nome_snapshot: string;
          preco_aplicado?: number;
          preco_tabela?: number;
          quantidade?: number;
          quote_id: string;
          subtotal?: number;
          tabela_preco_item_id?: string | null;
          tipo_servico: Database["public"]["Enums"]["quote_tipo_servico"];
        };
        Update: {
          created_at?: string;
          display_order?: number;
          empresa_id?: string;
          id?: string;
          motivo_desconto?: string | null;
          nome_snapshot?: string;
          preco_aplicado?: number;
          preco_tabela?: number;
          quantidade?: number;
          quote_id?: string;
          subtotal?: number;
          tabela_preco_item_id?: string | null;
          tipo_servico?: Database["public"]["Enums"]["quote_tipo_servico"];
        };
        Relationships: [
          {
            foreignKeyName: "quote_items_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_items_quote_id_fkey";
            columns: ["quote_id"];
            referencedRelation: "quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quote_items_tabela_preco_item_id_fkey";
            columns: ["tabela_preco_item_id"];
            referencedRelation: "tabela_precos_itens";
            referencedColumns: ["id"];
          },
        ];
      };
      quotes: {
        Row: {
          cliente_cep: string | null;
          cliente_endereco: string | null;
          cliente_nome: string;
          cliente_telefone: string | null;
          contribuicao_percentual: number | null;
          contribuicao_valor: number | null;
          created_at: string;
          created_by: string | null;
          custo_deslocamento: number;
          custo_fixo_alocado: number | null;
          custo_imposto: number | null;
          custo_mao_obra: number;
          custo_produtos: number;
          custo_taxa: number | null;
          custo_total: number;
          customer_id: string | null;
          data_servico: string | null;
          desconto: number;
          empresa_id: string;
          forma_pagamento: string | null;
          generated_work_order_id: string | null;
          id: string;
          km_ida_volta: number;
          lucro_percentual: number | null;
          lucro_valor: number | null;
          margem_percentual: number;
          margem_valor: number;
          observacoes: string | null;
          parcelas: number | null;
          preencher_agenda: boolean;
          status: Database["public"]["Enums"]["quote_status"];
          subtotal: number;
          taxa_percentual: number | null;
          total: number;
          updated_at: string;
          valor_a_vista: number | null;
        };
        Insert: {
          cliente_cep?: string | null;
          cliente_endereco?: string | null;
          cliente_nome: string;
          cliente_telefone?: string | null;
          contribuicao_percentual?: number | null;
          contribuicao_valor?: number | null;
          created_at?: string;
          created_by?: string | null;
          custo_deslocamento?: number;
          custo_fixo_alocado?: number | null;
          custo_imposto?: number | null;
          custo_mao_obra?: number;
          custo_produtos?: number;
          custo_taxa?: number | null;
          custo_total?: number;
          customer_id?: string | null;
          data_servico?: string | null;
          desconto?: number;
          empresa_id?: string;
          forma_pagamento?: string | null;
          generated_work_order_id?: string | null;
          id?: string;
          km_ida_volta?: number;
          lucro_percentual?: number | null;
          lucro_valor?: number | null;
          margem_percentual?: number;
          margem_valor?: number;
          observacoes?: string | null;
          parcelas?: number | null;
          preencher_agenda?: boolean;
          status?: Database["public"]["Enums"]["quote_status"];
          subtotal?: number;
          taxa_percentual?: number | null;
          total?: number;
          updated_at?: string;
          valor_a_vista?: number | null;
        };
        Update: {
          cliente_cep?: string | null;
          cliente_endereco?: string | null;
          cliente_nome?: string;
          cliente_telefone?: string | null;
          contribuicao_percentual?: number | null;
          contribuicao_valor?: number | null;
          created_at?: string;
          created_by?: string | null;
          custo_deslocamento?: number;
          custo_fixo_alocado?: number | null;
          custo_imposto?: number | null;
          custo_mao_obra?: number;
          custo_produtos?: number;
          custo_taxa?: number | null;
          custo_total?: number;
          customer_id?: string | null;
          data_servico?: string | null;
          desconto?: number;
          empresa_id?: string;
          forma_pagamento?: string | null;
          generated_work_order_id?: string | null;
          id?: string;
          km_ida_volta?: number;
          lucro_percentual?: number | null;
          lucro_valor?: number | null;
          margem_percentual?: number;
          margem_valor?: number;
          observacoes?: string | null;
          parcelas?: number | null;
          preencher_agenda?: boolean;
          status?: Database["public"]["Enums"]["quote_status"];
          subtotal?: number;
          taxa_percentual?: number | null;
          total?: number;
          updated_at?: string;
          valor_a_vista?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "quotes_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotes_generated_work_order_id_fkey";
            columns: ["generated_work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_expenses: {
        Row: {
          active: boolean;
          beneficiary: string | null;
          category: string;
          created_at: string;
          default_amount: number;
          due_day: number | null;
          empresa_id: string;
          end_date: string | null;
          id: string;
          name: string;
          notes: string | null;
          recurrence: string;
          seed_key: string | null;
          start_date: string;
          updated_at: string;
          weekday: number | null;
        };
        Insert: {
          active?: boolean;
          beneficiary?: string | null;
          category?: string;
          created_at?: string;
          default_amount?: number;
          due_day?: number | null;
          empresa_id?: string;
          end_date?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          recurrence?: string;
          seed_key?: string | null;
          start_date?: string;
          updated_at?: string;
          weekday?: number | null;
        };
        Update: {
          active?: boolean;
          beneficiary?: string | null;
          category?: string;
          created_at?: string;
          default_amount?: number;
          due_day?: number | null;
          empresa_id?: string;
          end_date?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          recurrence?: string;
          seed_key?: string | null;
          start_date?: string;
          updated_at?: string;
          weekday?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      route_cost_allocations: {
        Row: {
          allocated_cost: number;
          allocated_kilometers: number;
          allocation_method: string;
          budget_visit_id: string | null;
          created_at: string;
          empresa_id: string;
          id: string;
          route_id: string;
          service_id: string | null;
          updated_at: string;
          work_order_id: string | null;
        };
        Insert: {
          allocated_cost?: number;
          allocated_kilometers?: number;
          allocation_method?: string;
          budget_visit_id?: string | null;
          created_at?: string;
          empresa_id?: string;
          id?: string;
          route_id: string;
          service_id?: string | null;
          updated_at?: string;
          work_order_id?: string | null;
        };
        Update: {
          allocated_cost?: number;
          allocated_kilometers?: number;
          allocation_method?: string;
          budget_visit_id?: string | null;
          created_at?: string;
          empresa_id?: string;
          id?: string;
          route_id?: string;
          service_id?: string | null;
          updated_at?: string;
          work_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "route_cost_allocations_budget_visit_id_fkey";
            columns: ["budget_visit_id"];
            referencedRelation: "budget_visits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "route_cost_allocations_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "route_cost_allocations_route_id_fkey";
            columns: ["route_id"];
            referencedRelation: "daily_routes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "route_cost_allocations_service_id_fkey";
            columns: ["service_id"];
            referencedRelation: "visits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "route_cost_allocations_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      salespeople: {
        Row: {
          active: boolean;
          atendente_nexa: boolean;
          commission_percentage: number;
          commission_rule: string;
          created_at: string;
          display_order: number;
          effective_from: string;
          empresa_id: string;
          id: string;
          name: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          active?: boolean;
          atendente_nexa?: boolean;
          commission_percentage?: number;
          commission_rule?: string;
          created_at?: string;
          display_order?: number;
          effective_from?: string;
          empresa_id?: string;
          id?: string;
          name: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          active?: boolean;
          atendente_nexa?: boolean;
          commission_percentage?: number;
          commission_rule?: string;
          created_at?: string;
          display_order?: number;
          effective_from?: string;
          empresa_id?: string;
          id?: string;
          name?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "salespeople_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      service_items: {
        Row: {
          active: boolean;
          created_at: string;
          description: string | null;
          display_order: number;
          empresa_id: string;
          id: string;
          item_group_id: string;
          quantity: number;
          subtotal: number;
          unit_price: number;
          updated_at: string;
          upholstery_type_id: string | null;
          visit_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          display_order?: number;
          empresa_id?: string;
          id?: string;
          item_group_id?: string;
          quantity?: number;
          subtotal?: number;
          unit_price?: number;
          updated_at?: string;
          upholstery_type_id?: string | null;
          visit_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          display_order?: number;
          empresa_id?: string;
          id?: string;
          item_group_id?: string;
          quantity?: number;
          subtotal?: number;
          unit_price?: number;
          updated_at?: string;
          upholstery_type_id?: string | null;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_items_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_items_upholstery_type_id_fkey";
            columns: ["upholstery_type_id"];
            referencedRelation: "config_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_items_visit_id_fkey";
            columns: ["visit_id"];
            referencedRelation: "visits";
            referencedColumns: ["id"];
          },
        ];
      };
      tabela_precos_itens: {
        Row: {
          ativo: boolean;
          created_at: string;
          empresa_id: string;
          id: string;
          nome: string;
          ordem: number;
          preco_higienizacao: number;
          preco_impermeabilizacao: number | null;
          updated_at: string;
        };
        Insert: {
          ativo?: boolean;
          created_at?: string;
          empresa_id?: string;
          id?: string;
          nome: string;
          ordem?: number;
          preco_higienizacao?: number;
          preco_impermeabilizacao?: number | null;
          updated_at?: string;
        };
        Update: {
          ativo?: boolean;
          created_at?: string;
          empresa_id?: string;
          id?: string;
          nome?: string;
          ordem?: number;
          preco_higienizacao?: number;
          preco_impermeabilizacao?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tabela_precos_itens_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      technician_expenses: {
        Row: {
          amount: number;
          categories: string[];
          created_at: string;
          created_by: string | null;
          empresa_id: string;
          expense_date: string;
          expense_id: string | null;
          id: string;
          notes: string | null;
          technician_id: string | null;
          updated_at: string;
          work_order_id: string | null;
        };
        Insert: {
          amount?: number;
          categories?: string[];
          created_at?: string;
          created_by?: string | null;
          empresa_id?: string;
          expense_date?: string;
          expense_id?: string | null;
          id?: string;
          notes?: string | null;
          technician_id?: string | null;
          updated_at?: string;
          work_order_id?: string | null;
        };
        Update: {
          amount?: number;
          categories?: string[];
          created_at?: string;
          created_by?: string | null;
          empresa_id?: string;
          expense_date?: string;
          expense_id?: string | null;
          id?: string;
          notes?: string | null;
          technician_id?: string | null;
          updated_at?: string;
          work_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "technician_expenses_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_expenses_expense_id_fkey";
            columns: ["expense_id"];
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_expenses_technician_id_fkey";
            columns: ["technician_id"];
            referencedRelation: "technicians";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "technician_expenses_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      technicians: {
        Row: {
          active: boolean;
          base_address: string | null;
          base_latitude: number | null;
          base_longitude: number | null;
          created_at: string;
          display_order: number;
          email: string | null;
          empresa_id: string;
          id: string;
          include_return: boolean;
          name: string;
          updated_at: string;
          vehicle: string | null;
        };
        Insert: {
          active?: boolean;
          base_address?: string | null;
          base_latitude?: number | null;
          base_longitude?: number | null;
          created_at?: string;
          display_order?: number;
          email?: string | null;
          empresa_id?: string;
          id?: string;
          include_return?: boolean;
          name: string;
          updated_at?: string;
          vehicle?: string | null;
        };
        Update: {
          active?: boolean;
          base_address?: string | null;
          base_latitude?: number | null;
          base_longitude?: number | null;
          created_at?: string;
          display_order?: number;
          email?: string | null;
          empresa_id?: string;
          id?: string;
          include_return?: boolean;
          name?: string;
          updated_at?: string;
          vehicle?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "technicians_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      users_profiles: {
        Row: {
          active: boolean;
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      usuarios_empresa: {
        Row: {
          created_at: string;
          empresa_id: string;
          id: string;
          papel: Database["public"]["Enums"]["papel_empresa"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          empresa_id?: string;
          id?: string;
          papel?: Database["public"]["Enums"]["papel_empresa"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          empresa_id?: string;
          id?: string;
          papel?: Database["public"]["Enums"]["papel_empresa"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usuarios_empresa_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      visits: {
        Row: {
          completion_date: string | null;
          completion_time: string | null;
          created_at: string;
          discount_amount: number;
          discount_at: string | null;
          discount_by: string | null;
          discount_notes: string | null;
          discount_reason: string | null;
          empresa_id: string;
          final_value: number | null;
          google_event_id: string | null;
          id: string;
          item_quantity: number;
          item_unit_label: string | null;
          mileage_cost_allocated: number;
          original_scheduled_date: string | null;
          preserve_original_route: boolean;
          recurrence_work_order_id: string | null;
          reschedule_notes: string | null;
          reschedule_reason: string | null;
          reschedule_type: string | null;
          rescheduled_at: string | null;
          rescheduled_by: string | null;
          rescheduled_from_visit_id: string | null;
          rescheduled_to_visit_id: string | null;
          scheduled_date: string;
          scheduled_time: string;
          service_type_id: string | null;
          status: string;
          technician_id: string | null;
          technician_travel_occurred: boolean;
          updated_at: string;
          upholstery_description: string | null;
          upholstery_type_id: string | null;
          value_change_reason: string | null;
          visit_notes: string | null;
          visit_value: number;
          work_order_id: string;
        };
        Insert: {
          completion_date?: string | null;
          completion_time?: string | null;
          created_at?: string;
          discount_amount?: number;
          discount_at?: string | null;
          discount_by?: string | null;
          discount_notes?: string | null;
          discount_reason?: string | null;
          empresa_id?: string;
          final_value?: number | null;
          google_event_id?: string | null;
          id?: string;
          item_quantity?: number;
          item_unit_label?: string | null;
          mileage_cost_allocated?: number;
          original_scheduled_date?: string | null;
          preserve_original_route?: boolean;
          recurrence_work_order_id?: string | null;
          reschedule_notes?: string | null;
          reschedule_reason?: string | null;
          reschedule_type?: string | null;
          rescheduled_at?: string | null;
          rescheduled_by?: string | null;
          rescheduled_from_visit_id?: string | null;
          rescheduled_to_visit_id?: string | null;
          scheduled_date: string;
          scheduled_time: string;
          service_type_id?: string | null;
          status?: string;
          technician_id?: string | null;
          technician_travel_occurred?: boolean;
          updated_at?: string;
          upholstery_description?: string | null;
          upholstery_type_id?: string | null;
          value_change_reason?: string | null;
          visit_notes?: string | null;
          visit_value?: number;
          work_order_id: string;
        };
        Update: {
          completion_date?: string | null;
          completion_time?: string | null;
          created_at?: string;
          discount_amount?: number;
          discount_at?: string | null;
          discount_by?: string | null;
          discount_notes?: string | null;
          discount_reason?: string | null;
          empresa_id?: string;
          final_value?: number | null;
          google_event_id?: string | null;
          id?: string;
          item_quantity?: number;
          item_unit_label?: string | null;
          mileage_cost_allocated?: number;
          original_scheduled_date?: string | null;
          preserve_original_route?: boolean;
          recurrence_work_order_id?: string | null;
          reschedule_notes?: string | null;
          reschedule_reason?: string | null;
          reschedule_type?: string | null;
          rescheduled_at?: string | null;
          rescheduled_by?: string | null;
          rescheduled_from_visit_id?: string | null;
          rescheduled_to_visit_id?: string | null;
          scheduled_date?: string;
          scheduled_time?: string;
          service_type_id?: string | null;
          status?: string;
          technician_id?: string | null;
          technician_travel_occurred?: boolean;
          updated_at?: string;
          upholstery_description?: string | null;
          upholstery_type_id?: string | null;
          value_change_reason?: string | null;
          visit_notes?: string | null;
          visit_value?: number;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "visits_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visits_recurrence_work_order_id_fkey";
            columns: ["recurrence_work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visits_rescheduled_from_visit_id_fkey";
            columns: ["rescheduled_from_visit_id"];
            referencedRelation: "visits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visits_rescheduled_to_visit_id_fkey";
            columns: ["rescheduled_to_visit_id"];
            referencedRelation: "visits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visits_service_type_id_fkey";
            columns: ["service_type_id"];
            referencedRelation: "config_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visits_technician_id_fkey";
            columns: ["technician_id"];
            referencedRelation: "technicians";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visits_upholstery_type_id_fkey";
            columns: ["upholstery_type_id"];
            referencedRelation: "config_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visits_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_contacts: {
        Row: {
          active: boolean;
          created_at: string;
          current_customer_id: string | null;
          display_phone: string | null;
          empresa_id: string;
          first_contact_at: string;
          id: string;
          is_existing_customer: boolean;
          last_contact_at: string;
          last_message_at: string | null;
          normalized_phone: string;
          profile_name: string | null;
          total_inbound_messages: number;
          total_outbound_messages: number;
          updated_at: string;
          wa_id: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          current_customer_id?: string | null;
          display_phone?: string | null;
          empresa_id?: string;
          first_contact_at?: string;
          id?: string;
          is_existing_customer?: boolean;
          last_contact_at?: string;
          last_message_at?: string | null;
          normalized_phone: string;
          profile_name?: string | null;
          total_inbound_messages?: number;
          total_outbound_messages?: number;
          updated_at?: string;
          wa_id?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          current_customer_id?: string | null;
          display_phone?: string | null;
          empresa_id?: string;
          first_contact_at?: string;
          id?: string;
          is_existing_customer?: boolean;
          last_contact_at?: string;
          last_message_at?: string | null;
          normalized_phone?: string;
          profile_name?: string | null;
          total_inbound_messages?: number;
          total_outbound_messages?: number;
          updated_at?: string;
          wa_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_contacts_current_customer_id_fkey";
            columns: ["current_customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_contacts_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_messages: {
        Row: {
          created_at: string;
          crm_lead_id: string | null;
          delivery_status: string | null;
          direction: string;
          empresa_id: string;
          id: string;
          media_id: string | null;
          message_timestamp: string;
          message_type: string;
          raw_event_reference: string | null;
          referral_body: string | null;
          referral_headline: string | null;
          referral_source_id: string | null;
          referral_source_url: string | null;
          reply_to_message_id: string | null;
          text_content: string | null;
          whatsapp_contact_id: string;
          whatsapp_message_id: string | null;
        };
        Insert: {
          created_at?: string;
          crm_lead_id?: string | null;
          delivery_status?: string | null;
          direction?: string;
          empresa_id?: string;
          id?: string;
          media_id?: string | null;
          message_timestamp?: string;
          message_type?: string;
          raw_event_reference?: string | null;
          referral_body?: string | null;
          referral_headline?: string | null;
          referral_source_id?: string | null;
          referral_source_url?: string | null;
          reply_to_message_id?: string | null;
          text_content?: string | null;
          whatsapp_contact_id: string;
          whatsapp_message_id?: string | null;
        };
        Update: {
          created_at?: string;
          crm_lead_id?: string | null;
          delivery_status?: string | null;
          direction?: string;
          empresa_id?: string;
          id?: string;
          media_id?: string | null;
          message_timestamp?: string;
          message_type?: string;
          raw_event_reference?: string | null;
          referral_body?: string | null;
          referral_headline?: string | null;
          referral_source_id?: string | null;
          referral_source_url?: string | null;
          reply_to_message_id?: string | null;
          text_content?: string | null;
          whatsapp_contact_id?: string;
          whatsapp_message_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_crm_lead_id_fkey";
            columns: ["crm_lead_id"];
            referencedRelation: "crm_leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_messages_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_messages_whatsapp_contact_id_fkey";
            columns: ["whatsapp_contact_id"];
            referencedRelation: "whatsapp_contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      work_order_documents: {
        Row: {
          created_at: string;
          document_name: string | null;
          document_version: number;
          empresa_id: string;
          error_message: string | null;
          generated_at: string | null;
          generated_by: string | null;
          generation_status: string;
          google_document_id: string | null;
          google_document_url: string | null;
          id: string;
          is_active: boolean;
          last_synced_at: string | null;
          source_updated_at: string | null;
          template_type: string;
          updated_at: string;
          work_order_id: string;
        };
        Insert: {
          created_at?: string;
          document_name?: string | null;
          document_version?: number;
          empresa_id?: string;
          error_message?: string | null;
          generated_at?: string | null;
          generated_by?: string | null;
          generation_status?: string;
          google_document_id?: string | null;
          google_document_url?: string | null;
          id?: string;
          is_active?: boolean;
          last_synced_at?: string | null;
          source_updated_at?: string | null;
          template_type: string;
          updated_at?: string;
          work_order_id: string;
        };
        Update: {
          created_at?: string;
          document_name?: string | null;
          document_version?: number;
          empresa_id?: string;
          error_message?: string | null;
          generated_at?: string | null;
          generated_by?: string | null;
          generation_status?: string;
          google_document_id?: string | null;
          google_document_url?: string | null;
          id?: string;
          is_active?: boolean;
          last_synced_at?: string | null;
          source_updated_at?: string | null;
          template_type?: string;
          updated_at?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_documents_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_documents_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_order_history: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string;
          details: NonNullable<Json>;
          empresa_id: string;
          event_type: string;
          id: string;
          work_order_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description: string;
          details?: NonNullable<Json>;
          empresa_id?: string;
          event_type: string;
          id?: string;
          work_order_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string;
          details?: NonNullable<Json>;
          empresa_id?: string;
          event_type?: string;
          id?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_history_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_history_work_order_id_fkey";
            columns: ["work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_orders: {
        Row: {
          adjustment_reason: string | null;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          collection_configuration_updated_at: string | null;
          collection_rule: string | null;
          collection_visit_id: string | null;
          commission_expected: number;
          commission_percentage_snapshot: number | null;
          commission_realized: number;
          created_at: string;
          created_by: string | null;
          customer_id: string;
          deleted_at: string | null;
          deleted_by: string | null;
          deletion_reason: string | null;
          empresa_id: string;
          general_notes: string | null;
          id: string;
          items_sum: number;
          manual_total_reason: string | null;
          negotiated_installments: number | null;
          negotiated_payment_method: string | null;
          origin_work_order_id: string | null;
          os_number: string;
          os_type: string;
          os_value_text: string | null;
          payment_instruction: string | null;
          payment_notes: string | null;
          recurrence_notes: string | null;
          recurrence_reason: string | null;
          sale_date: string;
          sales_origin_id: string | null;
          salesperson_id: string | null;
          status: string;
          total_gross_value: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          adjustment_reason?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          collection_configuration_updated_at?: string | null;
          collection_rule?: string | null;
          collection_visit_id?: string | null;
          commission_expected?: number;
          commission_percentage_snapshot?: number | null;
          commission_realized?: number;
          created_at?: string;
          created_by?: string | null;
          customer_id: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          deletion_reason?: string | null;
          empresa_id?: string;
          general_notes?: string | null;
          id?: string;
          items_sum?: number;
          manual_total_reason?: string | null;
          negotiated_installments?: number | null;
          negotiated_payment_method?: string | null;
          origin_work_order_id?: string | null;
          os_number: string;
          os_type?: string;
          os_value_text?: string | null;
          payment_instruction?: string | null;
          payment_notes?: string | null;
          recurrence_notes?: string | null;
          recurrence_reason?: string | null;
          sale_date?: string;
          sales_origin_id?: string | null;
          salesperson_id?: string | null;
          status?: string;
          total_gross_value?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          adjustment_reason?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          collection_configuration_updated_at?: string | null;
          collection_rule?: string | null;
          collection_visit_id?: string | null;
          commission_expected?: number;
          commission_percentage_snapshot?: number | null;
          commission_realized?: number;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          deletion_reason?: string | null;
          empresa_id?: string;
          general_notes?: string | null;
          id?: string;
          items_sum?: number;
          manual_total_reason?: string | null;
          negotiated_installments?: number | null;
          negotiated_payment_method?: string | null;
          origin_work_order_id?: string | null;
          os_number?: string;
          os_type?: string;
          os_value_text?: string | null;
          payment_instruction?: string | null;
          payment_notes?: string | null;
          recurrence_notes?: string | null;
          recurrence_reason?: string | null;
          sale_date?: string;
          sales_origin_id?: string | null;
          salesperson_id?: string | null;
          status?: string;
          total_gross_value?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "work_orders_collection_visit_id_fkey";
            columns: ["collection_visit_id"];
            referencedRelation: "visits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_customer_id_fkey";
            columns: ["customer_id"];
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_empresa_id_fkey";
            columns: ["empresa_id"];
            referencedRelation: "empresas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_origin_work_order_id_fkey";
            columns: ["origin_work_order_id"];
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_sales_origin_id_fkey";
            columns: ["sales_origin_id"];
            referencedRelation: "config_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_salesperson_id_fkey";
            columns: ["salesperson_id"];
            referencedRelation: "salespeople";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      convidar_usuario: {
        Args: {
          _email: string;
          _papel: Database["public"]["Enums"]["papel_empresa"];
        };
        Returns: string;
      };
      definir_comissao_empresa: {
        Args: { _empresa_id: string; _inicio?: string; _percentual: number };
        Returns: string;
      };
      empresa_ativa: { Args: Record<PropertyKey, never>; Returns: string };
      empresas_do_usuario: { Args: { _user_id: string }; Returns: string[] };
      ensure_my_access: { Args: Record<PropertyKey, never>; Returns: undefined };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_staff: { Args: { _user_id: string }; Returns: boolean };
      meu_papel: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["papel_empresa"];
      };
      minha_empresa: { Args: Record<PropertyKey, never>; Returns: string };
      provisionar_empresa: {
        Args: {
          _cnpj?: string;
          _nome: string;
          _percentual_comissao?: number;
          _telefone?: string;
        };
        Returns: string;
      };
      registrar_consumo_produto: {
        Args: {
          _produto_id: string;
          _quantidade_ml: number;
          _visit_id: string;
          _work_order_id: string;
        };
        Returns: string;
      };
      registrar_empresa: {
        Args: { _cnpj?: string; _nome: string; _telefone?: string };
        Returns: string;
      };
      sou_admin_nexa: { Args: Record<PropertyKey, never>; Returns: boolean };
      tem_papel: {
        Args: { _papel: Database["public"]["Enums"]["papel_empresa"] };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "operator";
      crm_source_type: "meta_lead_ads" | "google_ads" | "custom_form";
      papel_empresa: "admin" | "atendente" | "tecnico";
      produto_tipo_servico: "higienizacao" | "impermeabilizacao";
      quote_status: "rascunho" | "enviado" | "aprovado" | "recusado" | "convertido";
      quote_tipo_servico: "higienizacao" | "impermeabilizacao";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operator"],
      crm_source_type: ["meta_lead_ads", "google_ads", "custom_form"],
      papel_empresa: ["admin", "atendente", "tecnico"],
      produto_tipo_servico: ["higienizacao", "impermeabilizacao"],
      quote_status: ["rascunho", "enviado", "aprovado", "recusado", "convertido"],
      quote_tipo_servico: ["higienizacao", "impermeabilizacao"],
    },
  },
} as const;
