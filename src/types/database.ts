export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// Supabase CLI が生成する型と同等のフォーマット
// interface ではなく type を使うこと（Supabase SDK の型推論に必要）
export type Database = {
  public: {
    Tables: {
      announcements: {
        Row: {
          id: string
          title: string
          content: string
          is_important: boolean
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          content: string
          is_important?: boolean
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          content?: string
          is_important?: boolean
          active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      group_managers: {
        Row: {
          active: boolean
          color: string
          created_at: string
          id: string
          memo: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          id?: string
          memo?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          id?: string
          memo?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      facilities: {
        Row: {
          active: boolean
          area: string
          created_at: string
          id: string
          memo: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          area?: string
          created_at?: string
          id?: string
          memo?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          area?: string
          id?: string
          memo?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      group_manager_facilities: {
        Row: {
          id: string
          group_manager_id: string
          facility_id: string
          created_at: string
        }
        Insert: {
          id?: string
          group_manager_id: string
          facility_id: string
          created_at?: string
        }
        Update: {
          id?: string
          group_manager_id?: string
          facility_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'group_manager_facilities_group_manager_id_fkey'
            columns: ['group_manager_id']
            isOneToOne: false
            referencedRelation: 'group_managers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'group_manager_facilities_facility_id_fkey'
            columns: ['facility_id']
            isOneToOne: false
            referencedRelation: 'facilities'
            referencedColumns: ['id']
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string
          date: string
          end_time: string
          facility_id: string | null
          group_manager_id: string
          id: string
          is_all_day: boolean
          memo: string
          start_time: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          end_time: string
          facility_id?: string | null
          group_manager_id: string
          id?: string
          is_all_day?: boolean
          memo?: string
          start_time: string
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          date?: string
          end_time?: string
          facility_id?: string | null
          group_manager_id?: string
          id?: string
          is_all_day?: boolean
          memo?: string
          start_time?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'schedules_group_manager_id_fkey'
            columns: ['group_manager_id']
            isOneToOne: false
            referencedRelation: 'group_managers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'schedules_facility_id_fkey'
            columns: ['facility_id']
            isOneToOne: false
            referencedRelation: 'facilities'
            referencedColumns: ['id']
          },
        ]
      }
      staff_members: {
        Row: {
          id: string
          name: string
          role: string
          color: string
          memo: string
          active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          role: string
          color?: string
          memo?: string
          active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          role?: string
          color?: string
          memo?: string
          active?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      shift_change_records: {
        Row: {
          id: string
          facility_id: string
          target_date: string
          reason: string
          handled_by: string
          memo: string | null
          created_at: string
          updated_at: string
          related_change_group_id: string | null
        }
        Insert: {
          id?: string
          facility_id: string
          target_date: string
          reason: string
          handled_by: string
          memo?: string | null
          created_at?: string
          updated_at?: string
          related_change_group_id?: string | null
        }
        Update: {
          id?: string
          facility_id?: string
          target_date?: string
          reason?: string
          handled_by?: string
          memo?: string | null
          updated_at?: string
          related_change_group_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'shift_change_records_facility_id_fkey'
            columns: ['facility_id']
            isOneToOne: false
            referencedRelation: 'facilities'
            referencedColumns: ['id']
          },
        ]
      }
      shift_change_details: {
        Row: {
          id: string
          record_id: string
          employee_name: string
          change_type: string
          change_detail: string
          is_external_support: boolean
          support_from_facility_id: string | null
          sort_order: number
          created_at: string
          original_shift: string | null
          replacement_name: string | null
          replacement_original_shift: string | null
          compensatory_leave_status: string | null
        }
        Insert: {
          id?: string
          record_id: string
          employee_name: string
          change_type: string
          change_detail: string
          is_external_support?: boolean
          support_from_facility_id?: string | null
          sort_order?: number
          created_at?: string
          original_shift?: string | null
          replacement_name?: string | null
          replacement_original_shift?: string | null
          compensatory_leave_status?: string | null
        }
        Update: {
          id?: string
          record_id?: string
          employee_name?: string
          change_type?: string
          change_detail?: string
          is_external_support?: boolean
          support_from_facility_id?: string | null
          sort_order?: number
          original_shift?: string | null
          replacement_name?: string | null
          replacement_original_shift?: string | null
          compensatory_leave_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'shift_change_details_record_id_fkey'
            columns: ['record_id']
            isOneToOne: false
            referencedRelation: 'shift_change_records'
            referencedColumns: ['id']
          },
        ]
      }
      shift_files: {
        Row: {
          id: string
          file_type: string
          facility_id: string | null
          target_month: string
          file_name: string
          file_path: string
          memo: string | null
          created_at: string
        }
        Insert: {
          id?: string
          file_type: string
          facility_id?: string | null
          target_month: string
          file_name: string
          file_path: string
          memo?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          file_type?: string
          facility_id?: string | null
          target_month?: string
          file_name?: string
          file_path?: string
          memo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'shift_files_facility_id_fkey'
            columns: ['facility_id']
            isOneToOne: false
            referencedRelation: 'facilities'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
