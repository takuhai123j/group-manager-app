-- =======================================================
-- シフト変更の「変更後担当」も個人カレンダーへ反映する（追加のみ＋RPCの置き換え）
-- migration name: shift_change_replacement_calendar
-- 前提: 20261015120000_shift_change_calendar_sync（反映先・時刻の列、schedules.shift_change_record_id、RPC）が適用済み
--
-- 方針:
--   ・既存の列・制約・索引・データは変更しない（明細に列4つと制約4つを追加。追加列はすべて NULL 可）
--   ・元の対象者（calendar_*）と変更後担当（replacement_calendar_*）の反映先・時刻は独立して持つ
--   ・変更後担当の反映先は、変更後担当の名前（replacement_name）がある明細だけに持てる
--   ・自動予定の一意索引 schedules_shift_change_person_unique（同じシフト変更×同じ人は1件）はそのまま使う。
--     元の対象者と変更後担当を合わせて同じ人を2回指定した場合は、RPC が保存前にエラーにする（重複反映の防止）
--   ・変更後担当の予定は「施設名／代替出勤」。元の対象者の予定（「施設名／変更種別」）は従来どおり
--   ・編集・削除連動、手動予定の保護、再試行で二重にならない仕組みは従来どおり
--     （保存のたびにそのシフト変更の自動予定だけを作り直す。手動の予定は shift_change_record_id が NULL なので触れない）
--   ・RPC は同じ名前・引数・戻り値で置き換える（実行権限・SECURITY INVOKER・search_path は保たれる）。
--     変更後担当の項目を送らない従来の画面からの呼び出しは、変更後担当の反映なしとして従来どおり動く
-- =======================================================

-- -------------------------------------------------------
-- 1) 明細: 変更後担当の反映先（どちらか一方 or なし）と時刻（両方 or なし。なしは終日）
-- -------------------------------------------------------
ALTER TABLE public.shift_change_details
  ADD COLUMN replacement_calendar_group_manager_id uuid NULL REFERENCES public.group_managers(id),
  ADD COLUMN replacement_calendar_staff_member_id  uuid NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
  ADD COLUMN replacement_start_time text NULL,
  ADD COLUMN replacement_end_time   text NULL;

ALTER TABLE public.shift_change_details
  ADD CONSTRAINT shift_change_details_replacement_target_at_most_one
    CHECK (num_nonnulls(replacement_calendar_group_manager_id, replacement_calendar_staff_member_id) <= 1),
  ADD CONSTRAINT shift_change_details_replacement_target_needs_name
    CHECK (num_nonnulls(replacement_calendar_group_manager_id, replacement_calendar_staff_member_id) = 0
           OR coalesce(btrim(replacement_name), '') <> ''),
  ADD CONSTRAINT shift_change_details_replacement_time_pair
    CHECK ((replacement_start_time IS NULL) = (replacement_end_time IS NULL)),
  ADD CONSTRAINT shift_change_details_replacement_time_format
    CHECK (replacement_start_time IS NULL OR (
      replacement_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND replacement_end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND replacement_start_time < replacement_end_time
    ));

-- -------------------------------------------------------
-- 2) 保存RPC（置き換え）
--    p_records の details に次の項目を追加（省略可）:
--      replacement_calendar_group_manager_id, replacement_calendar_staff_member_id,
--      replacement_start_time, replacement_end_time
--    それ以外の仕様（入力・戻り値・エラー形式）は 20261015120000 と同じ
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shift_change_save_batch(p_records jsonb)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  r jsonb;
  d jsonb;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_mode text;
  v_fac_name text;
  v_date date;
  v_reason text;
  v_ord int;
  v_dup int;
BEGIN
  IF p_records IS NULL OR jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) = 0 THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 保存するシフト変更がありません' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(p_records) > 100 THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 一度に保存できるのは100件までです' USING ERRCODE = 'P0001';
  END IF;

  -- 入力全体の検証（途中まで保存してから失敗しないよう、書き込み前にまとめて確認する）
  FOR r IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    IF (r->>'id') IS NULL OR coalesce(r->>'mode', '') NOT IN ('create', 'update') THEN
      RAISE EXCEPTION 'SCC_INVALID_INPUT: シフト変更のIDと保存方法を指定してください' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_typeof(r->'details') <> 'array' OR jsonb_array_length(r->'details') = 0 THEN
      RAISE EXCEPTION 'SCC_INVALID_INPUT: 対象者を1名以上指定してください' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(r->'details') x
       WHERE coalesce(NULLIF(x->>'replacement_calendar_group_manager_id', ''), NULLIF(x->>'replacement_calendar_staff_member_id', '')) IS NOT NULL
         AND coalesce(btrim(x->>'replacement_name'), '') = ''
    ) THEN
      RAISE EXCEPTION 'SCC_INVALID_INPUT: 変更後担当の名前を入力してください（カレンダーに反映する場合）' USING ERRCODE = 'P0001';
    END IF;
    -- 元の対象者と変更後担当を合わせて、同じ人のカレンダーは1つのシフト変更につき1回まで
    SELECT count(*) - count(DISTINCT t) INTO v_dup FROM (
      SELECT coalesce(NULLIF(x->>'calendar_group_manager_id', ''), NULLIF(x->>'calendar_staff_member_id', '')) AS t
        FROM jsonb_array_elements(r->'details') x
      UNION ALL
      SELECT coalesce(NULLIF(x->>'replacement_calendar_group_manager_id', ''), NULLIF(x->>'replacement_calendar_staff_member_id', ''))
        FROM jsonb_array_elements(r->'details') x
    ) s WHERE t IS NOT NULL;
    IF v_dup > 0 THEN
      RAISE EXCEPTION 'SCC_DUPLICATE_TARGET: 同じ日のシフト変更で、同じ人のカレンダーを2回指定しています（元の対象者・変更後担当を合わせて1人1回にしてください）' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF (SELECT count(*) <> count(DISTINCT value->>'id') FROM jsonb_array_elements(p_records)) THEN
    RAISE EXCEPTION 'SCC_INVALID_INPUT: 同じシフト変更が重複しています' USING ERRCODE = 'P0001';
  END IF;

  -- 編集対象（既存行）は ID 順にロックし、同時編集では後続を待たせる
  PERFORM 1 FROM public.shift_change_records
   WHERE id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_records))
   ORDER BY id FOR UPDATE;

  FOR r IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    v_id := (r->>'id')::uuid;
    v_mode := r->>'mode';

    IF v_mode = 'update' THEN
      UPDATE public.shift_change_records SET
        facility_id = (r->>'facility_id')::uuid,
        target_date = (r->>'target_date')::date,
        reason = r->>'reason',
        handled_by = r->>'handled_by',
        memo = NULLIF(r->>'memo', ''),
        related_change_group_id = NULLIF(r->>'related_change_group_id', '')::uuid
      WHERE id = v_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'SCC_NOT_FOUND: 編集中のシフト変更が見つかりません（他の端末で削除された可能性があります）' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      -- 新規。同じIDが既にある＝前回の保存は完了していて応答だけ失われた再試行なので、同じ内容で上書きする
      INSERT INTO public.shift_change_records
        (id, facility_id, target_date, reason, handled_by, memo, related_change_group_id)
      VALUES (
        v_id, (r->>'facility_id')::uuid, (r->>'target_date')::date, r->>'reason', r->>'handled_by',
        NULLIF(r->>'memo', ''), NULLIF(r->>'related_change_group_id', '')::uuid
      )
      ON CONFLICT (id) DO UPDATE SET
        facility_id = EXCLUDED.facility_id,
        target_date = EXCLUDED.target_date,
        reason = EXCLUDED.reason,
        handled_by = EXCLUDED.handled_by,
        memo = EXCLUDED.memo,
        related_change_group_id = EXCLUDED.related_change_group_id;
    END IF;

    -- 明細は従来どおり入れ替え（並び順は入力順）
    DELETE FROM public.shift_change_details WHERE record_id = v_id;
    v_ord := 0;
    FOR d IN SELECT value FROM jsonb_array_elements(r->'details') LOOP
      INSERT INTO public.shift_change_details (
        record_id, employee_name, change_type, change_detail, is_external_support,
        support_from_facility_id, sort_order, original_shift, replacement_name,
        replacement_original_shift, compensatory_leave_status,
        calendar_group_manager_id, calendar_staff_member_id, start_time, end_time,
        replacement_calendar_group_manager_id, replacement_calendar_staff_member_id,
        replacement_start_time, replacement_end_time
      ) VALUES (
        v_id, d->>'employee_name', d->>'change_type', d->>'change_detail',
        coalesce((d->>'is_external_support')::boolean, false),
        NULLIF(d->>'support_from_facility_id', '')::uuid, v_ord,
        NULLIF(d->>'original_shift', ''), NULLIF(d->>'replacement_name', ''),
        NULLIF(d->>'replacement_original_shift', ''), NULLIF(d->>'compensatory_leave_status', ''),
        NULLIF(d->>'calendar_group_manager_id', '')::uuid, NULLIF(d->>'calendar_staff_member_id', '')::uuid,
        NULLIF(d->>'start_time', ''), NULLIF(d->>'end_time', ''),
        NULLIF(d->>'replacement_calendar_group_manager_id', '')::uuid, NULLIF(d->>'replacement_calendar_staff_member_id', '')::uuid,
        NULLIF(d->>'replacement_start_time', ''), NULLIF(d->>'replacement_end_time', '')
      );
      v_ord := v_ord + 1;
    END LOOP;

    -- このシフト変更の自動生成予定だけを作り直す（手動の予定は shift_change_record_id が NULL なので対象外）
    DELETE FROM public.schedules WHERE shift_change_record_id = v_id;

    SELECT f.name, s.target_date, s.reason INTO v_fac_name, v_date, v_reason
      FROM public.shift_change_records s JOIN public.facilities f ON f.id = s.facility_id
     WHERE s.id = v_id;

    -- 元の対象者の予定（従来どおり）と、変更後担当の予定（代替出勤）。
    -- 反映先がある分だけ作る。同じ人が2回になる入力は上の検証で止めており、一意索引でも防がれる
    INSERT INTO public.schedules (
      group_manager_id, staff_member_id, facility_id, title, date, start_time, end_time,
      type, memo, is_all_day, shift_change_record_id
    )
    SELECT gm, sm, fac, title, v_date, st, et, 'shift_change', memo, all_day, v_id
    FROM (
      SELECT d2.sort_order AS ord, 0 AS role,
        d2.calendar_group_manager_id AS gm, d2.calendar_staff_member_id AS sm,
        (SELECT facility_id FROM public.shift_change_records WHERE id = v_id) AS fac,
        v_fac_name || '／' || d2.change_type AS title,
        coalesce(d2.start_time, '00:00') AS st, coalesce(d2.end_time, '00:00') AS et,
        '【シフト変更から自動登録】' || d2.change_type || '：' || d2.change_detail || E'\n理由：' || v_reason AS memo,
        d2.start_time IS NULL AS all_day
      FROM public.shift_change_details d2
      WHERE d2.record_id = v_id
        AND (d2.calendar_group_manager_id IS NOT NULL OR d2.calendar_staff_member_id IS NOT NULL)
      UNION ALL
      SELECT d3.sort_order, 1,
        d3.replacement_calendar_group_manager_id, d3.replacement_calendar_staff_member_id,
        (SELECT facility_id FROM public.shift_change_records WHERE id = v_id),
        v_fac_name || '／代替出勤',
        coalesce(d3.replacement_start_time, '00:00'), coalesce(d3.replacement_end_time, '00:00'),
        '【シフト変更から自動登録】代替出勤：' || d3.employee_name || '（' || d3.change_type || '）の代わり'
          || coalesce(E'\n変更後担当の元シフト：' || NULLIF(d3.replacement_original_shift, ''), '')
          || E'\n変更内容：' || d3.change_detail || E'\n理由：' || v_reason,
        d3.replacement_start_time IS NULL
      FROM public.shift_change_details d3
      WHERE d3.record_id = v_id
        AND (d3.replacement_calendar_group_manager_id IS NOT NULL OR d3.replacement_calendar_staff_member_id IS NOT NULL)
    ) x
    ORDER BY ord, role;

    v_ids := v_ids || v_id;
  END LOOP;

  RETURN v_ids;
END;
$$;

-- -------------------------------------------------------
-- 3) 実行権限（置き換えでも保たれるが、念のため 20261015120000 と同じ状態に揃える）
-- -------------------------------------------------------
REVOKE ALL ON FUNCTION public.shift_change_save_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_change_save_batch(jsonb) TO anon;
