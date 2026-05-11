import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'
import type { Announcement, CreateAnnouncementInput, UpdateAnnouncementInput } from '@/lib/types'

type AnnouncementRow = {
  id: string
  title: string
  content: string
  is_important: boolean
  active: boolean
  created_at: string
  updated_at: string
}

function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    isImportant: row.is_important,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const announcementService = {
  async getActive(limit = 5): Promise<Announcement[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []).map(row => toAnnouncement(row as AnnouncementRow))
  },

  async getAll(): Promise<Announcement[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(row => toAnnouncement(row as AnnouncementRow))
  },

  async create(input: CreateAnnouncementInput): Promise<Announcement> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('announcements')
      .insert({
        title: input.title,
        content: input.content,
        is_important: input.isImportant,
        active: input.active,
      })
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('お知らせの作成に失敗しました')
    return toAnnouncement(data as AnnouncementRow)
  },

  async update(id: string, input: UpdateAnnouncementInput): Promise<Announcement> {
    const supabase = createClient()
    const patch: Database['public']['Tables']['announcements']['Update'] = {}
    if (input.title !== undefined)       patch.title        = input.title
    if (input.content !== undefined)     patch.content      = input.content
    if (input.isImportant !== undefined) patch.is_important = input.isImportant
    if (input.active !== undefined)      patch.active       = input.active
    const { data, error } = await supabase
      .from('announcements')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('お知らせの更新に失敗しました')
    return toAnnouncement(data as AnnouncementRow)
  },

  async delete(id: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase
      .from('announcements')
      .delete()
      .eq('id', id)
    if (error) throw error
  },
}
