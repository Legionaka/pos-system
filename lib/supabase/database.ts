export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Relationship<
  ForeignKeyName extends string,
  Columns extends string[],
  ReferencedRelation extends string,
  ReferencedColumns extends string[],
> = {
  foreignKeyName: ForeignKeyName;
  columns: Columns;
  isOneToOne: boolean;
  referencedRelation: ReferencedRelation;
  referencedColumns: ReferencedColumns;
};

type Table<Row, Insert, Update = Partial<Insert>, Relationships extends unknown[] = []> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationships;
};

type RelTable<Row, Insert, Relationships extends unknown[]> = Table<Row, Insert, Partial<Insert>, Relationships>;

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        { id: string; name: string | null; email: string | null; role: Database['public']['Enums']['app_role']; active: boolean; created_at: string },
        { id: string; name?: string | null; email?: string | null; role?: Database['public']['Enums']['app_role']; active?: boolean; created_at?: string },
        { name?: string | null }
      >;
      categories: Table<
        { id: string; name: string; created_at: string },
        { id?: string; name: string; created_at?: string }
      >;
      products: RelTable<
        {
          id: string; sku: string; barcode: string | null; name: string; price_cents: number;
          tax_category: Database['public']['Enums']['tax_category']; stock_qty: number; reorder_at: number;
          active: boolean; category_id: string | null; image_path: string | null; created_at: string; updated_at: string;
        },
        {
          id?: string; sku: string; barcode?: string | null; name: string; price_cents: number;
          tax_category: Database['public']['Enums']['tax_category']; stock_qty?: number; reorder_at?: number;
          active?: boolean; category_id?: string | null; image_path?: string | null; created_at?: string; updated_at?: string;
        },
        [Relationship<'products_category_id_fkey', ['category_id'], 'categories', ['id']>]
      >;
      shifts: RelTable<
        {
          id: string; user_id: string; opened_at: string; closed_at: string | null; opening_cash_cents: number;
          expected_cash_cents: number | null; counted_cash_cents: number | null; cash_variance_cents: number | null;
        },
        {
          id?: string; user_id: string; opened_at?: string; closed_at?: string | null; opening_cash_cents: number;
          expected_cash_cents?: number | null; counted_cash_cents?: number | null; cash_variance_cents?: number | null;
        },
        [Relationship<'shifts_user_id_fkey', ['user_id'], 'profiles', ['id']>]
      >;
      held_sales: RelTable<
        { id: string; cashier_id: string; shift_id: string; label: string | null; created_at: string; updated_at: string },
        { id?: string; cashier_id: string; shift_id: string; label?: string | null; created_at?: string; updated_at?: string },
        [
          Relationship<'held_sales_cashier_id_fkey', ['cashier_id'], 'profiles', ['id']>,
          Relationship<'held_sales_shift_id_cashier_id_fkey', ['shift_id', 'cashier_id'], 'shifts', ['id', 'user_id']>,
        ]
      >;
      held_sale_items: RelTable<
        {
          id: string; held_sale_id: string; product_id: string; qty: number; unit_price_cents: number;
          tax_category: Database['public']['Enums']['tax_category']; created_at: string;
        },
        {
          id?: string; held_sale_id: string; product_id: string; qty: number; unit_price_cents: number;
          tax_category: Database['public']['Enums']['tax_category']; created_at?: string;
        },
        [
          Relationship<'held_sale_items_held_sale_id_fkey', ['held_sale_id'], 'held_sales', ['id']>,
          Relationship<'held_sale_items_product_id_fkey', ['product_id'], 'products', ['id']>,
        ]
      >;
      sales: RelTable<
        {
          id: string; number: number; cashier_id: string; shift_id: string; status: Database['public']['Enums']['sale_status'];
          subtotal_cents: number; vat_cents: number; discount_cents: number; rounding_cents: number; total_cents: number;
          cash_received_cents: number; change_cents: number; created_at: string;
        },
        {
          id?: string; number?: never; cashier_id: string; shift_id: string;
          status?: Database['public']['Enums']['sale_status']; subtotal_cents: number; vat_cents: number;
          discount_cents?: number; rounding_cents?: number; total_cents: number;
          cash_received_cents?: number; change_cents?: number; created_at?: string;
        },
        [
          Relationship<'sales_cashier_id_fkey', ['cashier_id'], 'profiles', ['id']>,
          Relationship<'sales_shift_id_cashier_id_fkey', ['shift_id', 'cashier_id'], 'shifts', ['id', 'user_id']>,
        ]
      >;
      sale_items: RelTable<
        {
          id: string; sale_id: string; product_id: string; product_name: string; sku: string; qty: number;
          unit_price_cents: number; discount_cents: number; line_total_cents: number;
          tax_category: Database['public']['Enums']['tax_category']; vat_cents: number; created_at: string;
        },
        {
          id?: string; sale_id: string; product_id: string; product_name: string; sku: string; qty: number;
          unit_price_cents: number; discount_cents?: number; line_total_cents: number;
          tax_category: Database['public']['Enums']['tax_category']; vat_cents: number; created_at?: string;
        },
        [
          Relationship<'sale_items_sale_id_fkey', ['sale_id'], 'sales', ['id']>,
          Relationship<'sale_items_product_id_fkey', ['product_id'], 'products', ['id']>,
        ]
      >;
      payments: RelTable<
        {
          id: string; sale_id: string; method: Database['public']['Enums']['payment_method']; amount_cents: number;
          received_cents: number | null; change_cents: number | null; reference: string | null; created_at: string;
        },
        {
          id?: string; sale_id: string; method: Database['public']['Enums']['payment_method']; amount_cents: number;
          received_cents?: number | null; change_cents?: number | null; reference?: string | null; created_at?: string;
        },
        [Relationship<'payments_sale_id_fkey', ['sale_id'], 'sales', ['id']>]
      >;
      refunds: RelTable<
        {
          id: string; number: number; sale_id: string; approved_by: string; reason: string; total_cents: number;
          vat_cents: number; rounding_cents: number; created_at: string;
        },
        {
          id?: string; number?: never; sale_id: string; approved_by: string; reason: string; total_cents: number;
          vat_cents?: number; rounding_cents?: number; created_at?: string;
        },
        [
          Relationship<'refunds_sale_id_fkey', ['sale_id'], 'sales', ['id']>,
          Relationship<'refunds_approved_by_fkey', ['approved_by'], 'profiles', ['id']>,
        ]
      >;
      refund_items: RelTable<
        {
          id: string; refund_id: string; sale_item_id: string; qty: number; amount_cents: number;
          vat_cents: number; restock: boolean; created_at: string;
        },
        {
          id?: string; refund_id: string; sale_item_id: string; qty: number; amount_cents: number;
          vat_cents?: number; restock?: boolean; created_at?: string;
        },
        [
          Relationship<'refund_items_refund_id_fkey', ['refund_id'], 'refunds', ['id']>,
          Relationship<'refund_items_sale_item_id_fkey', ['sale_item_id'], 'sale_items', ['id']>,
        ]
      >;
      refund_payments: RelTable<
        {
          id: string; refund_id: string; method: Database['public']['Enums']['payment_method'];
          amount_cents: number; reference: string | null; created_at: string;
        },
        {
          id?: string; refund_id: string; method: Database['public']['Enums']['payment_method'];
          amount_cents: number; reference?: string | null; created_at?: string;
        },
        [Relationship<'refund_payments_refund_id_fkey', ['refund_id'], 'refunds', ['id']>]
      >;
      stock_movements: RelTable<
        {
          id: string; product_id: string; delta: number; reason: string; actor_id: string | null;
          sale_id: string | null; refund_id: string | null; delivery_id: string | null; count_id: string | null; created_at: string;
        },
        {
          id?: string; product_id: string; delta: number; reason: string; actor_id?: string | null;
          sale_id?: string | null; refund_id?: string | null; delivery_id?: string | null; count_id?: string | null; created_at?: string;
        },
        [
          Relationship<'stock_movements_product_id_fkey', ['product_id'], 'products', ['id']>,
          Relationship<'stock_movements_actor_id_fkey', ['actor_id'], 'profiles', ['id']>,
          Relationship<'stock_movements_sale_id_fkey', ['sale_id'], 'sales', ['id']>,
          Relationship<'stock_movements_refund_id_fkey', ['refund_id'], 'refunds', ['id']>,
          Relationship<'stock_movements_delivery_id_fkey', ['delivery_id'], 'inventory_deliveries', ['id']>,
          Relationship<'stock_movements_count_id_fkey', ['count_id'], 'inventory_counts', ['id']>,
        ]
      >;
      inventory_deliveries: RelTable<
        { id: string; supplier_name: string; delivery_date: string; reference: string | null; notes: string | null; received_by: string; created_at: string },
        { id?: string; supplier_name: string; delivery_date?: string; reference?: string | null; notes?: string | null; received_by: string; created_at?: string },
        [Relationship<'inventory_deliveries_received_by_fkey', ['received_by'], 'profiles', ['id']>]
      >;
      inventory_delivery_items: RelTable<
        { id: string; delivery_id: string; product_id: string; product_name: string; sku: string; qty: number; unit_cost_cents: number; created_at: string },
        { id?: string; delivery_id: string; product_id: string; product_name: string; sku: string; qty: number; unit_cost_cents: number; created_at?: string },
        [Relationship<'inventory_delivery_items_delivery_id_fkey', ['delivery_id'], 'inventory_deliveries', ['id']>, Relationship<'inventory_delivery_items_product_id_fkey', ['product_id'], 'products', ['id']>]
      >;
      inventory_counts: RelTable<
        { id: string; status: 'in_progress' | 'completed' | 'cancelled'; started_by: string; started_at: string; completed_by: string | null; completed_at: string | null },
        { id?: string; status?: 'in_progress' | 'completed' | 'cancelled'; started_by: string; started_at?: string; completed_by?: string | null; completed_at?: string | null },
        [Relationship<'inventory_counts_started_by_fkey', ['started_by'], 'profiles', ['id']>, Relationship<'inventory_counts_completed_by_fkey', ['completed_by'], 'profiles', ['id']>]
      >;
      inventory_count_items: RelTable<
        { id: string; count_id: string; product_id: string; product_name: string; sku: string; expected_qty: number; counted_qty: number | null; counted_by: string | null; counted_at: string | null },
        { id?: string; count_id: string; product_id: string; product_name: string; sku: string; expected_qty: number; counted_qty?: number | null; counted_by?: string | null; counted_at?: string | null },
        [Relationship<'inventory_count_items_count_id_fkey', ['count_id'], 'inventory_counts', ['id']>, Relationship<'inventory_count_items_product_id_fkey', ['product_id'], 'products', ['id']>, Relationship<'inventory_count_items_counted_by_fkey', ['counted_by'], 'profiles', ['id']>]
      >;
      audit_logs: RelTable<
        {
          id: string; user_id: string | null; action: string; entity_type: string | null;
          entity_id: string | null; meta: Json; created_at: string;
        },
        {
          id?: string; user_id?: string | null; action: string; entity_type?: string | null;
          entity_id?: string | null; meta?: Json; created_at?: string;
        },
        [Relationship<'audit_logs_user_id_fkey', ['user_id'], 'profiles', ['id']>]
      >;
      feature_flags: RelTable<
        { key: string; enabled: boolean; description: string | null; updated_by: string | null; updated_at: string },
        { key: string; enabled?: boolean; description?: string | null; updated_by?: string | null; updated_at?: string },
        [Relationship<'feature_flags_updated_by_fkey', ['updated_by'], 'profiles', ['id']>]
      >;
      store_settings: Table<
        { singleton: boolean; store_name: string; logo_path: string | null; updated_by: string | null; updated_at: string },
        { singleton?: boolean; store_name?: string; logo_path?: string | null; updated_by?: string | null; updated_at?: string },
        { store_name?: string; logo_path?: string | null; updated_by?: string | null; updated_at?: string }
      >;
      staff_invitations: RelTable<
        { id: string; email: string; role: 'cashier' | 'manager'; status: 'pending' | 'accepted' | 'cancelled'; invited_by: string; user_id: string | null; created_at: string; accepted_at: string | null },
        { id?: string; email: string; role: 'cashier' | 'manager'; status?: 'pending' | 'accepted' | 'cancelled'; invited_by: string; user_id?: string | null; created_at?: string; accepted_at?: string | null },
        [Relationship<'staff_invitations_invited_by_fkey', ['invited_by'], 'profiles', ['id']>]
      >;
      feature_flag_registry: Table<
        { key: string; description: string },
        { key: string; description: string }
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      current_user_role: { Args: Record<PropertyKey, never>; Returns: Database['public']['Enums']['app_role'] | null };
      has_role: { Args: { p_role: Database['public']['Enums']['app_role'] }; Returns: boolean };
      has_any_role: { Args: { p_roles: Database['public']['Enums']['app_role'][] }; Returns: boolean };
      open_shift: { Args: { p_opening_cash_cents: number }; Returns: string };
      close_shift: { Args: { p_counted_cash_cents: number; p_shift_id: string }; Returns: Json };
      complete_sale: { Args: { p_items: Json; p_payments: Json; p_shift_id: string }; Returns: string };
      record_refund: { Args: { p_items: Json; p_payments: Json; p_reason: string; p_sale_id: string }; Returns: string };
      void_sale: { Args: { p_payments: Json; p_sale_id: string }; Returns: string };
      adjust_stock: { Args: { p_delta: number; p_product_id: string; p_reason: string }; Returns: string };
      set_profile_role: {
        Args: { p_active: boolean; p_role: Database['public']['Enums']['app_role']; p_user_id: string };
        Returns: undefined;
      };
      set_feature_flag: { Args: { p_enabled: boolean; p_key: string }; Returns: undefined };
      owner_create_staff_invitation: { Args: { p_email: string; p_role: 'cashier' | 'manager' }; Returns: string };
      owner_cancel_staff_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      owner_update_store_settings: { Args: { p_store_name: string; p_logo_path: string | null }; Returns: undefined };
      owner_dashboard_summary: { Args: Record<PropertyKey, never>; Returns: Json };
      dev_activity_feed: { Args: { p_limit?: number }; Returns: Array<{ id: string; action: string; entity_type: string | null; created_at: string }> };
      receive_inventory_delivery: { Args: { p_delivery_date: string; p_items: Json; p_notes: string | null; p_reference: string | null; p_supplier_name: string }; Returns: string };
      start_inventory_count: { Args: Record<PropertyKey, never>; Returns: string };
      finish_inventory_count: { Args: { p_count_id: string; p_counts: Json }; Returns: undefined };
      cancel_inventory_count: { Args: { p_count_id: string }; Returns: undefined };
      save_held_sale: { Args: { p_items: Json; p_label: string | null; p_shift_id: string }; Returns: string };
      update_held_sale: { Args: { p_held_sale_id: string; p_items: Json; p_label: string | null }; Returns: string };
      complete_held_sale: { Args: { p_held_sale_id: string; p_items: Json; p_payments: Json }; Returns: string };
      inventory_checkout_paused: { Args: Record<PropertyKey, never>; Returns: boolean };
      sales_report: { Args: { p_from: string; p_to: string }; Returns: Json };
    };
    Enums: {
      app_role: 'cashier' | 'manager' | 'owner' | 'dev';
      tax_category: 'standard' | 'zero_rated' | 'exempt';
      payment_method: 'cash' | 'card' | 'eft' | 'qr';
      sale_status: 'completed' | 'voided' | 'refunded' | 'partially_refunded';
    };
    CompositeTypes: { [_ in never]: never };
  };
};
