-- =======================================================
-- 【読み取り専用】勤務・休日振替（20261119120000）の適用前後確認
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv)。SELECT のみで、データ・構造は一切変更しない
-- 使い方: 適用SQLの直前と直後に同じものを実行し、「data:」の行（件数・ハッシュ）が一致することを確かめる。
--         ハッシュは今回追加する列（swap_id / swap_role / swap_person_key）を除いて計算するため、適用前後で同じ値になる
--         （適用の前後にアプリで予定やシフト変更を登録・編集すると変わる。その場合は件数・最終更新日時で確認する）
--         「struct:」の行は 適用前=0 / false / なし、適用後=期待値 になる
--         適用前は新しいテーブルが無いため、テーブル名を直接書かず to_regclass と to_jsonb で参照している
-- =======================================================
SELECT k, v FROM (
  -- ── 既存データ（今回の列を除いて比較） ──
  SELECT 1 o, 'data: schedules 件数・ハッシュ' k,
    count(*) || ' / ' || md5(coalesce(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) v
    FROM public.schedules s
  UNION ALL SELECT 2, 'data: shift_change_records 件数・ハッシュ（今回の列を除く）',
    count(*) || ' / ' || md5(coalesce(string_agg((to_jsonb(r) - 'swap_id' - 'swap_role' - 'swap_person_key')::text, '|' ORDER BY r.id), ''))
    FROM public.shift_change_records r
  UNION ALL SELECT 3, 'data: shift_change_details 件数・ハッシュ',
    count(*) || ' / ' || md5(coalesce(string_agg(to_jsonb(d)::text, '|' ORDER BY d.id), ''))
    FROM public.shift_change_details d
  UNION ALL SELECT 4, 'data: facilities / group_managers / staff_members 件数',
    (SELECT count(*) FROM public.facilities) || ' / ' || (SELECT count(*) FROM public.group_managers) || ' / ' || (SELECT count(*) FROM public.staff_members)
  UNION ALL SELECT 5, 'data: meetings / meeting_joint_groups 件数・meetings ハッシュ',
    (SELECT count(*) FROM public.meetings) || ' / ' || (SELECT count(*) FROM public.meeting_joint_groups) || ' / '
    || (SELECT md5(coalesce(string_agg(to_jsonb(m)::text, '|' ORDER BY m.id), '')) FROM public.meetings m)
  UNION ALL SELECT 6, 'data: 最終更新日時（schedules / shift_change_records）',
    (SELECT max(updated_at)::text FROM public.schedules) || ' / ' || (SELECT max(updated_at)::text FROM public.shift_change_records)
  UNION ALL SELECT 7, 'data: 施設なしの記録（常に 0。振替を登録した後は振替の記録だけ）',
    (SELECT count(*) FROM public.shift_change_records r WHERE r.facility_id IS NULL
       AND (to_jsonb(r) ->> 'swap_id') IS NULL)::text
  UNION ALL SELECT 8, 'data: 振替の種別の明細 / 予定（適用直後は 0 / 0）',
    (SELECT count(*) FROM public.shift_change_details WHERE change_type IN ('振替出勤', '振替休日')) || ' / '
    || (SELECT count(*) FROM public.schedules WHERE type IN ('furikae_work', 'furikae_off'))
  UNION ALL SELECT 9, 'data: 自動予定の重複（同じシフト変更×同じ人。常に 0）',
    (SELECT count(*) - count(DISTINCT (shift_change_record_id, coalesce(group_manager_id, staff_member_id)))
       FROM public.schedules WHERE shift_change_record_id IS NOT NULL)::text

  -- ── 構造（適用前は 0 / false / なし、適用後は期待値） ──
  UNION ALL SELECT 20, 'struct: 新しいテーブル（振替 / 非表示の紐付け / 操作・通知の記録）',
    (to_regclass('public.shift_change_swaps') IS NOT NULL)::text || ' / '
    || (to_regclass('public.shift_change_swap_hidden_schedules') IS NOT NULL)::text || ' / '
    || (to_regclass('public.shift_change_swap_operations') IS NOT NULL)::text
  UNION ALL SELECT 21, 'struct: 記録の追加列 3/3（NULL可）',
    (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shift_change_records'
      AND column_name IN ('swap_id', 'swap_role', 'swap_person_key') AND is_nullable = 'YES') || '/3'
  UNION ALL SELECT 22, 'struct: 記録の施設（適用前 NO → 適用後 YES）',
    (SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shift_change_records'
      AND column_name = 'facility_id')
  UNION ALL SELECT 23, 'struct: 記録の追加制約 6/6（検証済み）',
    (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.shift_change_records'::regclass AND convalidated
      AND conname IN ('shift_change_records_swap_fields_together', 'shift_change_records_swap_role_values',
                      'shift_change_records_facility_required', 'shift_change_records_swap_not_in_group',
                      'shift_change_records_swap_fkey', 'shift_change_records_swap_person_date_excl')) || '/6'
  UNION ALL SELECT 24, 'struct: 予定の追加制約（自動登録専用の種別）',
    (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.schedules'::regclass AND convalidated
      AND conname = 'schedules_furikae_auto_only') || '/1'
  UNION ALL SELECT 25, 'struct: 追加トリガー 12/12（有効）',
    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O' AND tgname IN (
      'shift_change_records_swap_guard_ins', 'shift_change_records_swap_guard_upd', 'shift_change_records_swap_guard_del',
      'shift_change_details_swap_guard', 'schedules_swap_guard_ins', 'schedules_swap_guard_upd', 'schedules_swap_guard_del',
      'shift_change_swaps_check', 'shift_change_records_swap_check_ins', 'shift_change_records_swap_check_upd',
      'shift_change_records_swap_check_del', 'shift_change_details_swap_check')) || '/12'
  UNION ALL SELECT 26, 'struct: 保存・取消・通知の関数（SECURITY DEFINER・search_path 固定。5つ）',
    coalesce((SELECT string_agg(proname || '=' || prosecdef::text || ':' || coalesce(proconfig::text, ''), ' / ' ORDER BY proname)
      FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('shift_change_swap_save', 'shift_change_swap_delete',
        'shift_change_swap_notify_claim', 'shift_change_swap_notify_finish', 'shift_change_swap_notify_resolve')), 'なし')
  UNION ALL SELECT 27, 'struct: 関数を実行できるロール（保存・取消=anon だけ / 通知の確保・記録=service_role だけ / 要確認の片付け=なし）',
    coalesce((SELECT string_agg(p.proname || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
      || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
      || ' service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE'), ' / ' ORDER BY p.proname)
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('shift_change_swap_save', 'shift_change_swap_delete',
        'shift_change_swap_notify_claim', 'shift_change_swap_notify_finish', 'shift_change_swap_notify_resolve')), 'なし')
  UNION ALL SELECT 28, 'struct: トリガー用・通知内容の組み立て用の関数を anon が直接実行できない（すべて false）',
    coalesce((SELECT string_agg(p.proname || '=' || has_function_privilege('anon', p.oid, 'EXECUTE'), ' / ' ORDER BY p.proname)
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('shift_change_swap_guard_records', 'shift_change_swap_guard_details', 'shift_change_swap_guard_schedules',
                         'shift_change_swap_check', 'shift_change_swap_mail_content')), 'なし')
  UNION ALL SELECT 29, 'struct: 新しいテーブルの anon / authenticated / service_role の権限（SELECT / なし / SELECT）',
    coalesce((SELECT string_agg(g.table_name || ':' || g.grantee || '=' || g.privs, ' / ' ORDER BY g.table_name, g.grantee) FROM (
      SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) privs
        FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name IN ('shift_change_swaps', 'shift_change_swap_hidden_schedules', 'shift_change_swap_operations')
         AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
       GROUP BY table_name, grantee) g), 'なし')
  UNION ALL SELECT 30, 'struct: 新しいテーブルの RLS（有効 / ポリシー数）',
    coalesce((SELECT string_agg(c.relname || '=' || c.relrowsecurity::text || '/'
      || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname), ' / ' ORDER BY c.relname)
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('shift_change_swaps', 'shift_change_swap_hidden_schedules', 'shift_change_swap_operations')), 'なし')
  UNION ALL SELECT 31, 'struct: 既存の保存関数 shift_change_save_batch が変わっていない（応援チェーン対応のまま・anon のみ）',
    coalesce((SELECT (prosrc LIKE '%chain_position%')::text || ' / ' || (NOT prosecdef)::text || ' / ' || proacl::text
      FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'shift_change_save_batch'), 'なし')
  UNION ALL SELECT 32, 'struct: 既存の RLS ポリシー数（記録・明細・予定。変わらないこと）',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
      AND tablename IN ('schedules', 'shift_change_records', 'shift_change_details'))::text
  UNION ALL SELECT 33, 'struct: マイグレーション履歴',
    (SELECT count(*) = 1 FROM supabase_migrations.schema_migrations
      WHERE version = '20261119120000' AND name = 'shift_change_swap')::text
  -- ── 所有者（振替の記録を書き換えられるのは「振替テーブルの所有者として実行中」のときだけ、という見張りの前提） ──
  UNION ALL SELECT 34, 'struct: 所有者（振替 / 非表示の紐付け / 保存 / 取消 / 操作の記録 / 通知3つ）・すべて同じか',
    coalesce((SELECT string_agg(o, ' / ' ORDER BY ord) || ' : ' || (count(DISTINCT o) = 1 AND count(*) = 8)::text FROM (
      SELECT 1 ord, pg_get_userbyid(c.relowner)::text o FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'shift_change_swaps'
      UNION ALL SELECT 2, pg_get_userbyid(c.relowner)::text FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'shift_change_swap_hidden_schedules'
      UNION ALL SELECT 3, pg_get_userbyid(p.proowner)::text FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'shift_change_swap_save'
      UNION ALL SELECT 4, pg_get_userbyid(p.proowner)::text FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'shift_change_swap_delete'
      UNION ALL SELECT 5, pg_get_userbyid(c.relowner)::text FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'shift_change_swap_operations'
      UNION ALL SELECT 6, pg_get_userbyid(p.proowner)::text FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('shift_change_swap_notify_claim', 'shift_change_swap_notify_finish', 'shift_change_swap_notify_resolve')) x
      HAVING count(*) > 0), 'なし')
  UNION ALL SELECT 35, 'struct: 所有者は RLS を無視できる（保存・取消の関数が既存の記録・予定を書けること。true）',
    coalesce((SELECT (r.rolbypassrls OR r.rolsuper)::text FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'shift_change_swaps'), 'なし')
  UNION ALL SELECT 36, 'struct: 既存の記録・明細・予定の所有者も同じ（見張りを外部キーの連鎖が通れること。true）',
    coalesce((SELECT (count(DISTINCT c.relowner) = 1)::text FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname IN ('shift_change_swaps', 'shift_change_records', 'shift_change_details', 'schedules')
      HAVING count(*) = 4), 'なし')
  -- ── 操作・通知の記録の守り（anon は状態の列だけ読める。内容・確保の印は読めず、書き込めない） ──
  UNION ALL SELECT 37, 'struct: anon が読めない列（通知の内容 / 確保の印 / 重複防止キーの版。すべて false）',
    coalesce((SELECT has_column_privilege('anon', c.oid, 'after_content', 'SELECT')::text || ' / '
      || has_column_privilege('anon', c.oid, 'notify_claim_token', 'SELECT')::text || ' / '
      || has_column_privilege('anon', c.oid, 'notify_key_version', 'SELECT')::text
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'shift_change_swap_operations'), 'なし')
  UNION ALL SELECT 38, 'struct: anon が操作の記録に書き込めない（追加 / 変更 / 削除。すべて false）',
    coalesce((SELECT has_table_privilege('anon', c.oid, 'INSERT')::text || ' / '
      || has_table_privilege('anon', c.oid, 'UPDATE')::text || ' / '
      || has_table_privilege('anon', c.oid, 'DELETE')::text
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'shift_change_swap_operations'), 'なし')
) x ORDER BY o;
