export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// Supabase CLI が生成する型と同等のフォーマット
// interface ではなく type を使うこと（Supabase SDK の型推論に必要）
export type Database = {
  public: {
    Tables: {
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
