-- =======================================================
-- 【読み取り専用】シフト変更 → 個人カレンダー自動反映の適用前後確認
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv)。SELECT のみで、データ・構造は一切変更しない
-- 使い方: 適用SQLの直前と直後に同じものを実行し、「data:」の行（件数・ハッシュ）が一致することを確かめる。
--         ハッシュは今回追加する列を除いて計算するため、適用前後で同じ値になる
--         （適用の前後にアプリで予定やシフト変更を登録・編集すると変わる。その場合は件数・最終更新日時で確認する）
--         「struct:」の行は 適用前=すべて false / 0、適用後=すべて true / 期待値 になる
-- =======================================================
SELECT k, v FROM (
  -- ── 既存データ（今回追加する列を除いて比較） ──
  SELECT 1 o, 'data: schedules 件数・ハッシュ' k,
    count(*) || ' / ' || md5(coalesce(string_agg((to_jsonb(s) - 'shift_change_record_id')::text, '|' ORDER BY s.id), '')) v
    FROM public.schedules s
  UNION ALL SELECT 2, 'data: shift_change_records 件数・ハッシュ',
    count(*) || ' / ' || md5(coalesce(string_agg(to_jsonb(r)::text, '|' ORDER BY r.id), ''))
    FROM public.shift_change_records r
  UNION ALL SELECT 3, 'data: shift_change_details 件数・ハッシュ',
    count(*) || ' / ' || md5(coalesce(string_agg((to_jsonb(d) - 'calendar_group_manager_id' - 'calendar_staff_member_id' - 'start_time' - 'end_time')::text, '|' ORDER BY d.id), ''))
    FROM public.shift_change_details d
  UNION ALL SELECT 4, 'data: facilities / group_managers / staff_members 件数',
    (SELECT count(*) FROM public.facilities) || ' / ' || (SELECT count(*) FROM public.group_managers) || ' / ' || (SELECT count(*) FROM public.staff_members)
  UNION ALL SELECT 5, 'data: meetings / meeting_minutes 件数',
    (SELECT count(*) FROM public.meetings) || ' / ' || (SELECT count(*) FROM public.meeting_minutes)
  UNION ALL SELECT 6, 'data: 最終更新日時（schedules / shift_change_records）',
    (SELECT max(updated_at)::text FROM public.schedules) || ' / ' || (SELECT max(updated_at)::text FROM public.shift_change_records)
  UNION ALL SELECT 7, 'data: 自動登録の予定（適用直後は 0）',
    (SELECT count(*) FROM public.schedules s WHERE (to_jsonb(s) ->> 'shift_change_record_id') IS NOT NULL)::text
  UNION ALL SELECT 8, 'data: 反映先が設定された明細（適用直後は 0）',
    (SELECT count(*) FROM public.shift_change_details d
      WHERE (to_jsonb(d) ->> 'calendar_group_manager_id') IS NOT NULL OR (to_jsonb(d) ->> 'calendar_staff_member_id') IS NOT NULL)::text

  -- ── 構造（適用前は false / 0、適用後は true / 期待値） ──
  UNION ALL SELECT 20, 'struct: 明細の追加列 4/4',
    (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shift_change_details'
      AND column_name IN ('calendar_group_manager_id', 'calendar_staff_member_id', 'start_time', 'end_time') AND is_nullable = 'YES') || '/4'
  UNION ALL SELECT 21, 'struct: 予定の追加列（NULL可）',
    (SELECT count(*) = 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'schedules'
      AND column_name = 'shift_change_record_id' AND is_nullable = 'YES')::text
  UNION ALL SELECT 22, 'struct: 予定→シフト変更 の外部キー（削除連動）',
    coalesce((SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
      WHERE c.conrelid = 'public.schedules'::regclass AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid) LIKE '%shift_change_records%'), 'なし')
  UNION ALL SELECT 23, 'struct: 明細の制約 3/3',
    (SELECT count(*) FROM pg_constraint WHERE conname IN ('shift_change_details_calendar_target_at_most_one',
      'shift_change_details_time_pair', 'shift_change_details_time_format')) || '/3'
  UNION ALL SELECT 24, 'struct: 重複防止の一意索引',
    coalesce((SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'schedules_shift_change_person_unique'), 'なし')
  UNION ALL SELECT 25, 'struct: RPC の実行権限（anon のみ ＋ 管理用 postgres/service_role）',
    coalesce((SELECT proacl::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'shift_change_save_batch'), 'なし')
  UNION ALL SELECT 26, 'struct: RPC は SECURITY INVOKER・search_path 固定',
    coalesce((SELECT (NOT prosecdef)::text || ' / ' || coalesce(proconfig::text, '') FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = 'shift_change_save_batch'), 'なし')
  UNION ALL SELECT 27, 'struct: RLS（schedules / shift_change_records / shift_change_details）',
    (SELECT string_agg(relname || '=' || relrowsecurity, ', ' ORDER BY relname) FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname IN ('schedules', 'shift_change_records', 'shift_change_details'))
  UNION ALL SELECT 28, 'struct: RLS ポリシー数（変わらないこと）',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
      AND tablename IN ('schedules', 'shift_change_records', 'shift_change_details'))::text
  UNION ALL SELECT 29, 'struct: マイグレーション履歴',
    (SELECT count(*) = 1 FROM supabase_migrations.schema_migrations
      WHERE version = '20261015120000' AND name = 'shift_change_calendar_sync')::text
) x ORDER BY o;
