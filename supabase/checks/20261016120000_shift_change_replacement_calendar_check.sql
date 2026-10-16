-- =======================================================
-- 【読み取り専用】変更後担当のカレンダー反映（20261016120000）の適用前後確認
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv)。SELECT のみで、データ・構造は一切変更しない
-- 使い方: 適用SQLの直前と直後に同じものを実行し、「data:」の行（件数・ハッシュ）が一致することを確かめる。
--         ハッシュはカレンダー反映用の列（20261015120000・今回の分の両方）を除いて計算するため、適用前後で同じ値になる
--         （適用の前後にアプリで予定やシフト変更を登録・編集すると変わる。その場合は件数・最終更新日時で確認する）
--         「struct:」の行は 適用前=0 / false、適用後=期待値 になる
-- =======================================================
SELECT k, v FROM (
  -- ── 既存データ（カレンダー反映用の列を除いて比較） ──
  SELECT 1 o, 'data: schedules 件数・ハッシュ' k,
    count(*) || ' / ' || md5(coalesce(string_agg((to_jsonb(s) - 'shift_change_record_id')::text, '|' ORDER BY s.id), '')) v
    FROM public.schedules s
  UNION ALL SELECT 2, 'data: shift_change_records 件数・ハッシュ',
    count(*) || ' / ' || md5(coalesce(string_agg(to_jsonb(r)::text, '|' ORDER BY r.id), ''))
    FROM public.shift_change_records r
  UNION ALL SELECT 3, 'data: shift_change_details 件数・ハッシュ',
    count(*) || ' / ' || md5(coalesce(string_agg((to_jsonb(d)
      - 'calendar_group_manager_id' - 'calendar_staff_member_id' - 'start_time' - 'end_time'
      - 'replacement_calendar_group_manager_id' - 'replacement_calendar_staff_member_id'
      - 'replacement_start_time' - 'replacement_end_time')::text, '|' ORDER BY d.id), ''))
    FROM public.shift_change_details d
  UNION ALL SELECT 4, 'data: facilities / group_managers / staff_members 件数',
    (SELECT count(*) FROM public.facilities) || ' / ' || (SELECT count(*) FROM public.group_managers) || ' / ' || (SELECT count(*) FROM public.staff_members)
  UNION ALL SELECT 5, 'data: meetings / meeting_minutes 件数',
    (SELECT count(*) FROM public.meetings) || ' / ' || (SELECT count(*) FROM public.meeting_minutes)
  UNION ALL SELECT 6, 'data: 最終更新日時（schedules / shift_change_records）',
    (SELECT max(updated_at)::text FROM public.schedules) || ' / ' || (SELECT max(updated_at)::text FROM public.shift_change_records)
  UNION ALL SELECT 7, 'data: 自動登録の予定 / うち代替出勤（適用直後は代替出勤 0）',
    (SELECT count(*) FROM public.schedules WHERE shift_change_record_id IS NOT NULL) || ' / '
    || (SELECT count(*) FROM public.schedules WHERE shift_change_record_id IS NOT NULL AND title LIKE '%／代替出勤')
  UNION ALL SELECT 8, 'data: 変更後担当の反映先が設定された明細（適用直後は 0）',
    (SELECT count(*) FROM public.shift_change_details d
      WHERE (to_jsonb(d) ->> 'replacement_calendar_group_manager_id') IS NOT NULL
         OR (to_jsonb(d) ->> 'replacement_calendar_staff_member_id') IS NOT NULL)::text
  UNION ALL SELECT 9, 'data: 自動予定の重複（同じシフト変更×同じ人。常に 0）',
    (SELECT count(*) - count(DISTINCT (shift_change_record_id, coalesce(group_manager_id, staff_member_id)))
       FROM public.schedules WHERE shift_change_record_id IS NOT NULL)::text

  -- ── 構造（適用前は 0 / false、適用後は期待値） ──
  UNION ALL SELECT 20, 'struct: 明細の追加列 4/4（NULL可）',
    (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shift_change_details'
      AND column_name IN ('replacement_calendar_group_manager_id', 'replacement_calendar_staff_member_id',
                          'replacement_start_time', 'replacement_end_time') AND is_nullable = 'YES') || '/4'
  UNION ALL SELECT 21, 'struct: 明細の追加制約 4/4（検証済み）',
    (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.shift_change_details'::regclass AND convalidated
      AND conname IN ('shift_change_details_replacement_target_at_most_one', 'shift_change_details_replacement_target_needs_name',
                      'shift_change_details_replacement_time_pair', 'shift_change_details_replacement_time_format')) || '/4'
  UNION ALL SELECT 22, 'struct: 変更後担当の外部キー 2/2',
    (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.shift_change_details'::regclass AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (replacement_calendar_%') || '/2'
  UNION ALL SELECT 23, 'struct: 一意索引（変わらないこと）',
    coalesce((SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'schedules_shift_change_person_unique'), 'なし')
  UNION ALL SELECT 24, 'struct: RPC が変更後担当に対応（適用前 false）',
    coalesce((SELECT (prosrc LIKE '%replacement_calendar_group_manager_id%' AND prosrc LIKE '%代替出勤%')::text
      FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'shift_change_save_batch'), 'なし')
  UNION ALL SELECT 25, 'struct: RPC の数（同名の重複なし）',
    (SELECT count(*) FROM pg_proc WHERE proname = 'shift_change_save_batch')::text
  UNION ALL SELECT 26, 'struct: RPC の実行権限（anon のみ ＋ 管理用 postgres/service_role）',
    coalesce((SELECT proacl::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'shift_change_save_batch'), 'なし')
  UNION ALL SELECT 27, 'struct: RPC は SECURITY INVOKER・search_path 固定',
    coalesce((SELECT (NOT prosecdef)::text || ' / ' || coalesce(proconfig::text, '') FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = 'shift_change_save_batch'), 'なし')
  UNION ALL SELECT 28, 'struct: RLS ポリシー数（変わらないこと）',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
      AND tablename IN ('schedules', 'shift_change_records', 'shift_change_details'))::text
  UNION ALL SELECT 29, 'struct: マイグレーション履歴',
    (SELECT count(*) = 1 FROM supabase_migrations.schema_migrations
      WHERE version = '20261016120000' AND name = 'shift_change_replacement_calendar')::text
) x ORDER BY o;
