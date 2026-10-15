-- =======================================================
-- 【本番用・Dashboard実行】シフト変更 → 個人カレンダー自動反映（追加のみ）
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv) 専用。Supabase Dashboard > SQL Editor で全文を1回実行する
-- 中身: supabase/migrations/20261015120000_shift_change_calendar_sync.sql の本文そのもの
--       ＋ 実行前ガード ＋ マイグレーション履歴への記録。全体を1トランザクションで実行する
--       （途中で失敗した場合は何も適用されない）
--
-- 実行前ガード（どれかに当たれば何も変えずに中止）:
--   ・検証用プロジェクトのデータがある（本番以外で実行しようとしている）
--   ・今回追加する列・制約・索引・関数のどれかが既にある（二重実行）
-- 実行の前後で supabase/checks/20261015120000_shift_change_calendar_sync_check.sql（読み取り専用）を実行し、結果を比べる
-- 戻し方: supabase/rollbacks/20261015120000_shift_change_calendar_sync_down.sql
-- =======================================================
BEGIN;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.facilities WHERE name LIKE 'テスト施設%') THEN
    RAISE EXCEPTION '中止: 検証用プロジェクトのデータがあります（本番用SQLです）';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
               AND ((table_name = 'schedules' AND column_name = 'shift_change_record_id')
                 OR (table_name = 'shift_change_details' AND column_name IN ('calendar_group_manager_id', 'calendar_staff_member_id', 'start_time', 'end_time'))))
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'shift_change_save_batch')
     OR EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'schedules_shift_change_person_unique') THEN
    RAISE EXCEPTION '中止: このSQLは既に適用されています（二重実行）';
  END IF;
END $guard$;

-- =======================================================
-- シフト変更 → 個人カレンダー自動反映（追加のみ）
-- migration name: shift_change_calendar_sync
--
-- 方針:
--   ・既存の列・制約・データは変更しない（列・制約・索引・RPCの追加のみ。追加列はすべて NULL 可）
--   ・反映先は明細ごとに「G長・主任 or スタッフ（全役職）」をIDで持つ（名前の自動照合はしない）。
--     未指定の明細はカレンダーに反映しない
--   ・自動生成した予定は schedules.shift_change_record_id でシフト変更に紐付ける。
--     手動の予定はこの列が NULL なので、RPC・削除連動のどちらからも触れない
--   ・シフト変更の削除は ON DELETE CASCADE で自動生成予定だけを消す
--   ・保存はRPC（SECURITY INVOKER）で、複数日分をまとめて1トランザクションで行う。
--     IDは画面側で発行して渡すため、通信失敗後の再試行でも二重登録にならない（同じIDの上書き）
--   ・エラーは 'SCC_<コード>: <日本語メッセージ>' 形式（SQLSTATE P0001）
--   ・過去のシフト変更には反映先が無いため、自動反映は起きない（遡って作らない）
-- =======================================================

-- -------------------------------------------------------
-- 1) 明細: 反映先（どちらか一方 or なし）と時刻（両方 or なし。なしは終日）
-- -------------------------------------------------------
ALTER TABLE public.shift_change_details
  ADD COLUMN calendar_group_manager_id uuid NULL REFERENCES public.group_managers(id),
  ADD COLUMN calendar_staff_member_id  uuid NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
  ADD COLUMN start_time text NULL,
  ADD COLUMN end_time   text NULL;

ALTER TABLE public.shift_change_details
  ADD CONSTRAINT shift_change_details_calendar_target_at_most_one
    CHECK (num_nonnulls(calendar_group_manager_id, calendar_staff_member_id) <= 1),
  ADD CONSTRAINT shift_change_details_time_pair
    CHECK ((start_time IS NULL) = (end_time IS NULL)),
  ADD CONSTRAINT shift_change_details_time_format
    CHECK (start_time IS NULL OR (
      start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND start_time < end_time
    ));

-- -------------------------------------------------------
-- 2) 予定: 自動生成元のシフト変更（手動の予定は NULL）
--    同じシフト変更から同じ人の予定は1件だけ（重複防止）
-- -------------------------------------------------------
ALTER TABLE public.schedules
  ADD COLUMN shift_change_record_id uuid NULL
    REFERENCES public.shift_change_records(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX schedules_shift_change_person_unique
  ON public.schedules (shift_change_record_id, (coalesce(group_manager_id, staff_member_id)))
  WHERE shift_change_record_id IS NOT NULL;

-- -------------------------------------------------------
-- 3) 保存RPC（新規・編集とも。期間・複数日は配列でまとめて渡す）
--    p_records: [{ id, mode: 'create'|'update', facility_id, target_date, reason, handled_by, memo,
--                  related_change_group_id, details: [{ employee_name, change_type, change_detail,
--                  is_external_support, support_from_facility_id, original_shift, replacement_name,
--                  replacement_original_shift, compensatory_leave_status,
--                  calendar_group_manager_id, calendar_staff_member_id, start_time, end_time }] }]
--    各シフト変更について「本体の保存 → 明細の入れ替え → そのシフト変更の自動生成予定の作り直し」を行う。
--    戻り値: 保存したシフト変更のID（入力順）
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
    SELECT count(*) - count(DISTINCT t) INTO v_dup FROM (
      SELECT coalesce(x->>'calendar_group_manager_id', x->>'calendar_staff_member_id') AS t
        FROM jsonb_array_elements(r->'details') x
    ) s WHERE t IS NOT NULL;
    IF v_dup > 0 THEN
      RAISE EXCEPTION 'SCC_DUPLICATE_TARGET: 同じ日のシフト変更で、同じ人のカレンダーを2回指定しています' USING ERRCODE = 'P0001';
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
        calendar_group_manager_id, calendar_staff_member_id, start_time, end_time
      ) VALUES (
        v_id, d->>'employee_name', d->>'change_type', d->>'change_detail',
        coalesce((d->>'is_external_support')::boolean, false),
        NULLIF(d->>'support_from_facility_id', '')::uuid, v_ord,
        NULLIF(d->>'original_shift', ''), NULLIF(d->>'replacement_name', ''),
        NULLIF(d->>'replacement_original_shift', ''), NULLIF(d->>'compensatory_leave_status', ''),
        NULLIF(d->>'calendar_group_manager_id', '')::uuid, NULLIF(d->>'calendar_staff_member_id', '')::uuid,
        NULLIF(d->>'start_time', ''), NULLIF(d->>'end_time', '')
      );
      v_ord := v_ord + 1;
    END LOOP;

    -- このシフト変更の自動生成予定だけを作り直す（手動の予定は shift_change_record_id が NULL なので対象外）
    DELETE FROM public.schedules WHERE shift_change_record_id = v_id;

    SELECT f.name, s.target_date, s.reason INTO v_fac_name, v_date, v_reason
      FROM public.shift_change_records s JOIN public.facilities f ON f.id = s.facility_id
     WHERE s.id = v_id;

    -- 反映先がある明細だけ。交代出勤の代わりに入る人（replacement_name）は名前だけなので反映しない
    INSERT INTO public.schedules (
      group_manager_id, staff_member_id, facility_id, title, date, start_time, end_time,
      type, memo, is_all_day, shift_change_record_id
    )
    SELECT
      d2.calendar_group_manager_id, d2.calendar_staff_member_id,
      (SELECT facility_id FROM public.shift_change_records WHERE id = v_id),
      v_fac_name || '／' || d2.change_type,
      v_date,
      coalesce(d2.start_time, '00:00'), coalesce(d2.end_time, '00:00'),
      'shift_change',
      '【シフト変更から自動登録】' || d2.change_type || '：' || d2.change_detail || E'\n理由：' || v_reason,
      d2.start_time IS NULL,
      v_id
    FROM public.shift_change_details d2
    WHERE d2.record_id = v_id
      AND (d2.calendar_group_manager_id IS NOT NULL OR d2.calendar_staff_member_id IS NOT NULL)
    ORDER BY d2.sort_order;

    v_ids := v_ids || v_id;
  END LOOP;

  RETURN v_ids;
END;
$$;

-- -------------------------------------------------------
-- 4) 実行権限（anon のみ。Supabase は新規関数に既定で実行権限を付けるため、取り消してから付与する）
-- -------------------------------------------------------
REVOKE ALL ON FUNCTION public.shift_change_save_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_change_save_batch(jsonb) TO anon;

-- マイグレーション履歴に記録する（MCP の apply_migration で適用した場合と同じ形。ロールバックSQLで削除する）
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261015120000', 'shift_change_calendar_sync');

COMMIT;
