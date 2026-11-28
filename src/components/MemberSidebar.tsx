'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeftRight, CalendarDays, CalendarRange, ChevronDown, ChevronRight, FileText, Settings, Users, Search, X } from 'lucide-react'

export type MemberItem = { key: string; id: string; kind: 'manager' | 'staff'; name: string; color: string }
export type MemberGroup = { id: string; label: string; members: MemberItem[] }

interface Props {
  groups: MemberGroup[]
  selection: string[] | null
  onChange: (selection: string[] | null) => void
  onMeeting: () => void
  onShiftChange: () => void
  onDocuments: () => void
  onCloseMobile: () => void
  adminItems: { label: string; onClick: () => void }[]
}

function GroupCheck({ checked, mixed, label, onChange, disabled }: {
  checked: boolean; mixed: boolean; label: string; onChange: () => void; disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed }, [mixed])
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={onChange} disabled={disabled}
    className="h-4 w-4 shrink-0 accent-blue-600 cursor-pointer disabled:cursor-default" />
}

export function MemberSidebar({ groups, selection, onChange, onMeeting, onShiftChange, onDocuments, onCloseMobile, adminItems }: Props) {
  const [expanded, setExpanded] = useState<string[]>(['group_manager'])
  const [query, setQuery] = useState('')
  const [adminOpen, setAdminOpen] = useState(false)
  const all = groups.flatMap(g => g.members.map(m => m.key))
  const selected = new Set(selection ?? all)
  const selectedCount = all.filter(k => selected.has(k)).length
  const q = query.trim().toLocaleLowerCase()
  const toggleGroup = (keys: string[]) => {
    const next = new Set(selected)
    const remove = keys.every(k => next.has(k))
    keys.forEach(k => remove ? next.delete(k) : next.add(k))
    onChange([...next])
  }
  const nav = (label: string, icon: ReactNode, action?: () => void) => (
    <button key={label} type="button" onClick={action ? () => { action(); onCloseMobile() } : onCloseMobile}
      className={'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left ' + (action ? 'text-slate-600 hover:bg-slate-100' : 'bg-blue-50 font-semibold text-blue-700')}>
      {icon}<span>{label}</span>
    </button>
  )
  return (
    <aside aria-label="メニューとメンバー" className="flex h-full min-h-0 flex-col bg-slate-50 text-slate-800">
      <div className="flex items-center justify-between px-3 pt-3 lg:hidden">
        <span className="text-sm font-semibold">メニュー・メンバー</span>
        <button type="button" onClick={onCloseMobile} aria-label="閉じる" className="p-2 rounded hover:bg-slate-200"><X size={18}/></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-4">
        <nav aria-label="機能メニュー" className="space-y-1">
          {nav('スケジュール', <CalendarDays size={17}/>)}
          {nav('MT年間計画', <CalendarRange size={17}/>, onMeeting)}
          {nav('シフト変更', <ArrowLeftRight size={17}/>, onShiftChange)}
          {nav('PDF資料', <FileText size={17}/>, onDocuments)}
        </nav>
        <section className="border-t border-slate-200 pt-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="flex items-center gap-2 font-semibold text-sm"><Users size={16}/>メンバー</h2>
            <span className="text-xs text-slate-500">{selectedCount}/{all.length}人</span>
          </div>
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2.5">
            <Search size={15} className="text-slate-400 shrink-0"/>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="名前で検索" aria-label="メンバー検索" className="w-full min-w-0 py-2 bg-transparent text-sm outline-none"/>
          </div>
          <div className="flex gap-2 my-2 text-xs">
            <button type="button" onClick={() => onChange(null)} className="flex-1 rounded border border-slate-200 bg-white py-1.5 text-blue-700 hover:bg-blue-50">全選択</button>
            <button type="button" onClick={() => onChange([])} className="flex-1 rounded border border-slate-200 bg-white py-1.5 text-slate-600 hover:bg-slate-100">全解除</button>
          </div>
          <div className="space-y-1">
            {groups.map(g => {
              const keys = g.members.map(m => m.key)
              const count = keys.filter(k => selected.has(k)).length
              const matchesGroup = g.label.toLocaleLowerCase().includes(q)
              const members = g.members.filter(m => !q || matchesGroup || m.name.toLocaleLowerCase().includes(q))
              if (q && !matchesGroup && members.length === 0) return null
              const open = Boolean(q) || expanded.includes(g.id)
              return <div key={g.id}>
                <div className="flex items-center gap-2 py-1.5">
                  <button type="button" aria-expanded={open} aria-label={g.label + (open ? 'を閉じる' : 'を開く')} onClick={() => setExpanded(old => old.includes(g.id) ? old.filter(x => x !== g.id) : [...old, g.id])} className="p-0.5 text-slate-500">
                    {open ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}
                  </button>
                  <GroupCheck checked={keys.length > 0 && count === keys.length} mixed={count > 0 && count < keys.length} label={g.label + ' 全員'} disabled={!keys.length} onChange={() => toggleGroup(keys)}/>
                  <button type="button" onClick={() => setExpanded(old => old.includes(g.id) ? old.filter(x => x !== g.id) : [...old, g.id])} className="flex-1 text-left text-sm font-medium min-w-0">{g.label}</button>
                  <span className="text-xs text-slate-500">{count}/{keys.length}</span>
                </div>
                {open && <div className="ml-6 border-l border-slate-200 pl-3">
                  {members.map(m => <label key={m.key} className="flex items-center gap-2 py-1.5 text-sm cursor-pointer hover:text-blue-700">
                    <input type="checkbox" checked={selected.has(m.key)} onChange={() => toggleGroup([m.key])} className="h-4 w-4 shrink-0 accent-blue-600"/>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{backgroundColor: m.color}}/>
                    <span className="truncate" title={m.name}>{m.name}</span>
                  </label>)}
                  {!members.length && <p className="text-xs text-slate-400 py-2">登録なし</p>}
                </div>}
              </div>
            })}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">チェックしたメンバーの予定を表示します。</p>
        </section>
        <section className="border-t border-slate-200 pt-3">
          <button type="button" onClick={() => setAdminOpen(v => !v)} aria-expanded={adminOpen} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            <Settings size={17}/><span className="flex-1 text-left">管理・設定</span>{adminOpen ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}
          </button>
          {adminOpen && adminItems.map(item => <button key={item.label} type="button" onClick={() => {item.onClick(); onCloseMobile()}} className="block w-full rounded px-4 py-2 text-left text-sm text-slate-600 hover:bg-slate-100">{item.label}</button>)}
        </section>
      </div>
    </aside>
  )
}
