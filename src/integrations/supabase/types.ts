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
      accounts: {
        Row: {
          code: string
          created_at: string
          id: string
          is_system: boolean
          name: string
          parent_id: string | null
          type: Database["public"]["Enums"]["account_type"]
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          parent_id?: string | null
          type: Database["public"]["Enums"]["account_type"]
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          parent_id?: string | null
          type?: Database["public"]["Enums"]["account_type"]
        }
        Relationships: [
          {
            foreignKeyName: "accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          asset_code: string
          asset_name: string
          asset_type: string
          created_at: string
          created_by: string | null
          current_location: string | null
          current_value: number | null
          deleted_at: string | null
          id: string
          notes: string | null
          plate_number: string | null
          purchase_date: string | null
          purchase_value: number | null
          responsible_person: string | null
          serial_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          asset_code: string
          asset_name: string
          asset_type: string
          created_at?: string
          created_by?: string | null
          current_location?: string | null
          current_value?: number | null
          deleted_at?: string | null
          id?: string
          notes?: string | null
          plate_number?: string | null
          purchase_date?: string | null
          purchase_value?: number | null
          responsible_person?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          asset_code?: string
          asset_name?: string
          asset_type?: string
          created_at?: string
          created_by?: string | null
          current_location?: string | null
          current_value?: number | null
          deleted_at?: string | null
          id?: string
          notes?: string | null
          plate_number?: string | null
          purchase_date?: string | null
          purchase_value?: number | null
          responsible_person?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          payload: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          payload?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          payload?: Json | null
        }
        Relationships: []
      }
      cash_accounts: {
        Row: {
          account_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          type: Database["public"]["Enums"]["cash_account_type"]
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          type: Database["public"]["Enums"]["cash_account_type"]
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          type?: Database["public"]["Enums"]["cash_account_type"]
        }
        Relationships: [
          {
            foreignKeyName: "cash_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          created_at: string
          expense_account_id: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          expense_account_id: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          expense_account_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_account_fk"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_category_account"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_funding_allocations: {
        Row: {
          amount: number
          created_at: string
          expense_id: string
          funding_check_id: string
          id: string
        }
        Insert: {
          amount: number
          created_at?: string
          expense_id: string
          funding_check_id: string
          id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          expense_id?: string
          funding_check_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_funding_allocations_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_funding_allocations_funding_check_id_fkey"
            columns: ["funding_check_id"]
            isOneToOne: false
            referencedRelation: "funding_checks"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          asset_cost_treatment: string | null
          asset_expense_type: string | null
          asset_id: string | null
          attachment_url: string | null
          category_id: string
          created_at: string
          created_by: string | null
          creditor_name: string | null
          deleted_at: string | null
          description: string | null
          due_date: string | null
          excel_attachment_url: string | null
          expense_date: string
          expense_scope: string
          id: string
          journal_entry_id: string | null
          payment_status: string
          project_id: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          amount: number
          asset_cost_treatment?: string | null
          asset_expense_type?: string | null
          asset_id?: string | null
          attachment_url?: string | null
          category_id: string
          created_at?: string
          created_by?: string | null
          creditor_name?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          excel_attachment_url?: string | null
          expense_date?: string
          expense_scope?: string
          id?: string
          journal_entry_id?: string | null
          payment_status?: string
          project_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          amount?: number
          asset_cost_treatment?: string | null
          asset_expense_type?: string | null
          asset_id?: string | null
          attachment_url?: string | null
          category_id?: string
          created_at?: string
          created_by?: string | null
          creditor_name?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          excel_attachment_url?: string | null
          expense_date?: string
          expense_scope?: string
          id?: string
          journal_entry_id?: string | null
          payment_status?: string
          project_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      funders: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_project: boolean
          name: string
          notes: string | null
          phone: string | null
          project_code: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_project?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          project_code?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_project?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          project_code?: string | null
        }
        Relationships: []
      }
      funding_checks: {
        Row: {
          amount: number
          amount_usd: number | null
          attachment_url: string | null
          cash_account_id: string
          check_number: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          funder_id: string
          id: string
          notes: string | null
          received_date: string
        }
        Insert: {
          amount: number
          amount_usd?: number | null
          attachment_url?: string | null
          cash_account_id: string
          check_number: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          funder_id: string
          id?: string
          notes?: string | null
          received_date?: string
        }
        Update: {
          amount?: number
          amount_usd?: number | null
          attachment_url?: string | null
          cash_account_id?: string
          check_number?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          funder_id?: string
          id?: string
          notes?: string | null
          received_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_checks_cash_account_id_fkey"
            columns: ["cash_account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_checks_funder_id_fkey"
            columns: ["funder_id"]
            isOneToOne: false
            referencedRelation: "funders"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          entry_date: string
          entry_number: string
          id: string
          source_id: string | null
          source_type: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_number?: string
          id?: string
          source_id?: string | null
          source_type?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_number?: string
          id?: string
          source_id?: string | null
          source_type?: string | null
        }
        Relationships: []
      }
      journal_lines: {
        Row: {
          account_id: string
          created_at: string
          credit: number
          debit: number
          description: string | null
          id: string
          journal_entry_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_withdrawals: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          attachment_url: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cash_account_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          funding_check_id: string | null
          id: string
          journal_entry_id: string | null
          payment_method: string
          person_name: string
          person_role: string
          project_id: string | null
          reversal_entry_id: string | null
          status: string
          updated_at: string
          withdrawal_date: string
          withdrawal_no: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_url?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_account_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          funding_check_id?: string | null
          id?: string
          journal_entry_id?: string | null
          payment_method: string
          person_name: string
          person_role: string
          project_id?: string | null
          reversal_entry_id?: string | null
          status?: string
          updated_at?: string
          withdrawal_date?: string
          withdrawal_no?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_url?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_account_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          funding_check_id?: string | null
          id?: string
          journal_entry_id?: string | null
          payment_method?: string
          person_name?: string
          person_role?: string
          project_id?: string | null
          reversal_entry_id?: string | null
          status?: string
          updated_at?: string
          withdrawal_date?: string
          withdrawal_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_withdrawals_cash_account_id_fkey"
            columns: ["cash_account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_withdrawals_funding_check_id_fkey"
            columns: ["funding_check_id"]
            isOneToOne: false
            referencedRelation: "funding_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_withdrawals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      payable_payments: {
        Row: {
          amount: number
          attachment_url: string | null
          cash_account_id: string | null
          created_at: string
          created_by: string | null
          funding_check_id: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          payable_id: string
          payment_date: string
          payment_method: string
        }
        Insert: {
          amount: number
          attachment_url?: string | null
          cash_account_id?: string | null
          created_at?: string
          created_by?: string | null
          funding_check_id?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payable_id: string
          payment_date: string
          payment_method: string
        }
        Update: {
          amount?: number
          attachment_url?: string | null
          cash_account_id?: string | null
          created_at?: string
          created_by?: string | null
          funding_check_id?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payable_id?: string
          payment_date?: string
          payment_method?: string
        }
        Relationships: [
          {
            foreignKeyName: "payable_payments_cash_account_id_fkey"
            columns: ["cash_account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payable_payments_funding_check_id_fkey"
            columns: ["funding_check_id"]
            isOneToOne: false
            referencedRelation: "funding_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payable_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payable_payments_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
        ]
      }
      payables: {
        Row: {
          created_at: string
          created_by: string | null
          creditor_name: string
          due_date: string | null
          expense_id: string
          id: string
          notes: string | null
          original_amount: number
          paid_amount: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          creditor_name: string
          due_date?: string | null
          expense_id: string
          id?: string
          notes?: string | null
          original_amount: number
          paid_amount?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          creditor_name?: string
          due_date?: string | null
          expense_id?: string
          id?: string
          notes?: string | null
          original_amount?: number
          paid_amount?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payables_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: true
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          created_at: string
          id: string
          module: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          module: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          module?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          username?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          notes: string | null
          status: Database["public"]["Enums"]["project_status"]
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          notes?: string | null
          status?: Database["public"]["Enums"]["project_status"]
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["project_status"]
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_withdrawal_atomic: { Args: { _id: string }; Returns: string }
      cancel_withdrawal_atomic: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      check_remaining: { Args: { _check_id: string }; Returns: number }
      create_expense_atomic:
        | {
            Args: {
              _allocations: Json
              _amount: number
              _attachment_url: string
              _category_id: string
              _description: string
              _expense_date: string
              _project_id: string
            }
            Returns: string
          }
        | {
            Args: {
              _allocations: Json
              _amount: number
              _attachment_url: string
              _category_id: string
              _description: string
              _excel_attachment_url?: string
              _expense_date: string
              _project_id: string
            }
            Returns: string
          }
      create_expense_v2: {
        Args: {
          _allocations: Json
          _amount: number
          _asset_cost_treatment: string
          _asset_expense_type: string
          _asset_id: string
          _attachment_url: string
          _category_id: string
          _description: string
          _excel_attachment_url?: string
          _expense_date: string
          _expense_scope: string
          _project_id: string
        }
        Returns: string
      }
      create_expense_v3: {
        Args: {
          _allocations: Json
          _amount: number
          _asset_cost_treatment: string
          _asset_expense_type: string
          _asset_id: string
          _attachment_url: string
          _category_id: string
          _creditor_name: string
          _description: string
          _due_date: string
          _excel_attachment_url?: string
          _expense_date: string
          _expense_scope: string
          _payment_status: string
          _project_id: string
        }
        Returns: string
      }
      create_withdrawal_atomic: {
        Args: {
          _amount: number
          _attachment_url: string
          _cash_account_id: string
          _description: string
          _funding_check_id: string
          _payment_method: string
          _person_name: string
          _person_role: string
          _project_id: string
          _withdrawal_date: string
        }
        Returns: string
      }
      has_permission: {
        Args: { _perm_code: string; _user_id: string }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      my_permissions: {
        Args: never
        Returns: {
          code: string
        }[]
      }
      pay_payable_atomic: {
        Args: {
          _amount: number
          _attachment_url: string
          _cash_account_id: string
          _funding_check_id: string
          _notes: string
          _payable_id: string
          _payment_date: string
          _payment_method: string
        }
        Returns: string
      }
      reverse_expense_atomic: {
        Args: { _expense_id: string; _reason: string }
        Returns: undefined
      }
      update_expense_atomic: {
        Args: {
          _allocations: Json
          _amount: number
          _asset_cost_treatment: string
          _asset_expense_type: string
          _asset_id: string
          _category_id: string
          _description: string
          _expense_date: string
          _expense_id: string
          _expense_scope: string
          _project_id: string
        }
        Returns: string
      }
    }
    Enums: {
      account_type: "asset" | "liability" | "equity" | "revenue" | "expense"
      cash_account_type: "cashbox" | "bank" | "field"
      project_status: "active" | "completed" | "on_hold" | "cancelled"
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
    Enums: {
      account_type: ["asset", "liability", "equity", "revenue", "expense"],
      cash_account_type: ["cashbox", "bank", "field"],
      project_status: ["active", "completed", "on_hold", "cancelled"],
    },
  },
} as const
