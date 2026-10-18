-- =======================================================
-- 【本番用・Dashboard実行】シフト変更の「応援チェーン」（最大5人）を1件の記録で持つ（追加のみ＋RPCの置き換え）
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv) 専用。Supabase Dashboard > SQL Editor で全文を1回実行する
-- 中身: supabase/migrations/20261018120000_shift_change_support_chain.sql の本文そのもの
--       ＋ 実行前ガード ＋ マイグレーション履歴への記録。全体を1トランザクションで実行する
--       （途中で失敗した場合は何も適用されない）
--
-- 実行前ガード（どれかに当たれば何も変えずに中止）:
--   ・検証用プロジェクトのデータがある（本番以外で実行しようとしている）
--   ・前提の 20261016120000_shift_change_replacement_calendar が適用されていない
--   ・今回追加する列・制約・索引のどれか、または履歴行が既にある（二重実行）
-- 実行の前後で supabase/checks/20261018120000_shift_change_support_chain_check.sql（読み取り専用）を実行し、結果を比べる
-- 公開順: このSQLを適用 → すぐに画面を公開（旧画面のまま応援チェーンの記録を編集すると、チェーンの情報が外れるため）
-- 戻し方: 画面を戻してから supabase/rollbacks/20261018120000_shift_change_support_chain_down.sql
-- =======================================================
BEGIN;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.facilities WHERE name LIKE 'テスト施設%') THEN
    RAISE EXCEPTION '中止: 検証用プロジェクトのデータがあります（本番用SQLです）';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shift_change_details' AND column_name = 'replacement_calendar_group_manager_id')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'shift_change_save_batch'
                      AND prosrc LIKE '%replacement_calendar_group_manager_id%') THEN
    RAISE EXCEPTION '中止: 前提の 20261016120000_shift_change_replacement_calendar が適用されていません';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shift_change_details'
               AND column_name IN ('work_facility_id', 'chain_position'))
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('shift_change_details_chain_position_range', 'shift_change_details_work_facility_chain_only'))
     OR EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'shift_change_details_chain_position_unique')
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261018120000') THEN
    RAISE EXCEPTION '中止: このSQLは既に適用されています（二重実行）';
  END IF;
END $guard$;

-- =======================================================
-- シフト変更の「応援チェーン」（最大5人）を1件の記録で持つ（追加のみ＋RPCの置き換え）
-- migration name: shift_change_support_chain
-- 前提: 20261016120000_shift_change_replacement_calendar（変更後担当の反映先・時刻、RPC）が適用済み
--
-- 例: A が施設Xを欠勤 → B が施設Yから応援 → C が施設Zから B の元施設Yへ応援
--   1番目 A（勤務先 X ＝記録の施設） / 2番目 B（勤務先 X、Y から） / 3番目 C（勤務先 Y、Z から）
--
-- 方針:
--   ・既存の列・制約・索引・データは変更しない（明細に列2つ・制約2つ・部分一意索引1つを追加。追加列はすべて NULL 可）
--   ・work_facility_id: その人がこの日に働く施設。チェーンの明細だけが持つ（チェーン外は NULL のまま＝従来どおり記録の施設）
--   ・chain_position: チェーンの順番（1〜5）。同じ記録の中で重複しない。チェーン外は NULL
--   ・勤務先の決まり（RPC で確認）: 1番目＝記録の施設、2番目＝1番目と同じ、3番目以降＝1つ前の人の元施設（support_from_facility_id）。
--     2番目以降は他施設からの応援（元施設あり・勤務先と別の施設）
--   ・自動予定は勤務先の施設で作る（施設・タイトルとも）。チェーン外の明細は従来どおり記録の施設
--   ・チェーンの人は次の応援者として明細を持つので、チェーンの明細では変更後担当のカレンダー反映を受け付けない（二重入力の防止）
--   ・RPC は同じ名前・引数・戻り値で置き換える（実行権限・SECURITY INVOKER・search_path は保たれる）。
--     チェーンの項目を送らない従来の画面・期間・複数日の呼び出しは、チェーンなしとして従来どおり動く
-- =======================================================

-- -------------------------------------------------------
-- 1) 明細: 勤務先とチェーンの順番
-- -------------------------------------------------------
ALTER TABLE public.shift_change_details
  ADD COLUMN work_facility_id uuid NULL REFERENCES public.facilities(id),
  ADD COLUMN chain_position smallint NULL;

ALTER TABLE public.shift_change_details
  ADD CONSTRAINT shift_change_details_chain_position_range
    CHECK (chain_position IS NULL OR chain_position BETWEEN 1 AND 5),
  ADD CONSTRAINT shift_change_details_work_facility_chain_only
    CHECK (chain_position IS NOT NULL OR work_facility_id IS NULL);

CREATE UNIQUE INDEX shift_change_details_chain_position_unique
  ON public.shift_change_details (record_id, chain_position)
  WHERE chain_position IS NOT NULL;

-- -------------------------------------------------------
-- 2) 保存RPC（置き換え）
--    p_records の details に次の項目を追加（省略可）: work_facility_id, chain_position
--    それ以外の仕様（入力・戻り値・エラー形式）は 20261016120000 と同じ。チェーンの誤りは SCC_INVALID_CHAIN
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
  v_fac_id uuid;
  v_fac_name text;
  v_date date;
  v_reason text;
  v_ord int;
  v_dup int;
  v_chain_n int;
  v_chain_distinct int;
  v_chain_min int;
  v_chain_max int;
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

    -- 応援チェーン（任意）: 順番は1から連続した2〜5人。勤務先はチェーンの明細だけが持つ
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(r->'details') x
       WHERE NULLIF(x->>'chain_position', '') IS NULL AND NULLIF(x->>'work_facility_id', '') IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'SCC_INVALID_CHAIN: 勤務先は応援チェーンの人だけに指定できます' USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*), count(DISTINCT p), min(p), max(p)
      INTO v_chain_n, v_chain_distinct, v_chain_min, v_chain_max
      FROM (SELECT (x->>'chain_position')::int AS p FROM jsonb_array_elements(r->'details') x
             WHERE NULLIF(x->>'chain_position', '') IS NOT NULL) c;
    IF v_chain_n > 0 THEN
      IF v_chain_n < 2 OR v_chain_n <> v_chain_distinct OR v_chain_min <> 1 OR v_chain_max <> v_chain_n OR v_chain_max > 5 THEN
        RAISE EXCEPTION 'SCC_INVALID_CHAIN: 応援チェーンは1番目から順に2〜5人でつないでください' USING ERRCODE = 'P0001';
      END IF;
      IF EXISTS (
        SELECT 1 FROM (
          SELECT p, work, sup, ext, rep_cal,
                 lag(sup) OVER (ORDER BY p) AS prev_sup,
                 first_value(work) OVER (ORDER BY p) AS head_work
            FROM (SELECT (x->>'chain_position')::int AS p,
                         NULLIF(x->>'work_facility_id', '')::uuid AS work,
                         NULLIF(x->>'support_from_facility_id', '')::uuid AS sup,
                         coalesce((x->>'is_external_support')::boolean, false) AS ext,
                         coalesce(NULLIF(x->>'replacement_calendar_group_manager_id', ''), NULLIF(x->>'replacement_calendar_staff_member_id', '')) AS rep_cal
                    FROM jsonb_array_elements(r->'details') x
                   WHERE NULLIF(x->>'chain_position', '') IS NOT NULL) c0
        ) c
        WHERE work IS NULL
           OR rep_cal IS NOT NULL
           OR (p = 1 AND work IS DISTINCT FROM NULLIF(r->>'facility_id', '')::uuid)
           OR (p >= 2 AND (NOT ext OR sup IS NULL OR sup = work))
           OR (p = 2 AND work IS DISTINCT FROM head_work)
           OR (p >= 3 AND work IS DISTINCT FROM prev_sup)
      ) THEN
        RAISE EXCEPTION 'SCC_INVALID_CHAIN: 応援チェーンの勤務先・応援元が正しくありません（2番目は1番目の施設、3番目以降は1つ前の人の元施設で勤務し、別の施設から応援します）' USING ERRCODE = 'P0001';
      END IF;
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
        replacement_start_time, replacement_end_time,
        work_facility_id, chain_position
      ) VALUES (
        v_id, d->>'employee_name', d->>'change_type', d->>'change_detail',
        coalesce((d->>'is_external_support')::boolean, false),
        NULLIF(d->>'support_from_facility_id', '')::uuid, v_ord,
        NULLIF(d->>'original_shift', ''), NULLIF(d->>'replacement_name', ''),
        NULLIF(d->>'replacement_original_shift', ''), NULLIF(d->>'compensatory_leave_status', ''),
        NULLIF(d->>'calendar_group_manager_id', '')::uuid, NULLIF(d->>'calendar_staff_member_id', '')::uuid,
        NULLIF(d->>'start_time', ''), NULLIF(d->>'end_time', ''),
        NULLIF(d->>'replacement_calendar_group_manager_id', '')::uuid, NULLIF(d->>'replacement_calendar_staff_member_id', '')::uuid,
        NULLIF(d->>'replacement_start_time', ''), NULLIF(d->>'replacement_end_time', ''),
        NULLIF(d->>'work_facility_id', '')::uuid, NULLIF(d->>'chain_position', '')::smallint
      );
      v_ord := v_ord + 1;
    END LOOP;

    -- このシフト変更の自動生成予定だけを作り直す（手動の予定は shift_change_record_id が NULL なので対象外）
    DELETE FROM public.schedules WHERE shift_change_record_id = v_id;

    SELECT s.facility_id, f.name, s.target_date, s.reason INTO v_fac_id, v_fac_name, v_date, v_reason
      FROM public.shift_change_records s JOIN public.facilities f ON f.id = s.facility_id
     WHERE s.id = v_id;

    -- 元の対象者の予定（勤務先があればその施設、なければ記録の施設）と、変更後担当の予定（代替出勤・記録の施設）。
    -- 反映先がある分だけ作る。同じ人が2回になる入力は上の検証で止めており、一意索引でも防がれる
    INSERT INTO public.schedules (
      group_manager_id, staff_member_id, facility_id, title, date, start_time, end_time,
      type, memo, is_all_day, shift_change_record_id
    )
    SELECT gm, sm, fac, title, v_date, st, et, 'shift_change', memo, all_day, v_id
    FROM (
      SELECT d2.sort_order AS ord, 0 AS role,
        d2.calendar_group_manager_id AS gm, d2.calendar_staff_member_id AS sm,
        coalesce(d2.work_facility_id, v_fac_id) AS fac,
        coalesce((SELECT wf.name FROM public.facilities wf WHERE wf.id = d2.work_facility_id), v_fac_name) || '／' || d2.change_type AS title,
        coalesce(d2.start_time, '00:00') AS st, coalesce(d2.end_time, '00:00') AS et,
        '【シフト変更から自動登録】' || d2.change_type || '：' || d2.change_detail || E'\n理由：' || v_reason AS memo,
        d2.start_time IS NULL AS all_day
      FROM public.shift_change_details d2
      WHERE d2.record_id = v_id
        AND (d2.calendar_group_manager_id IS NOT NULL OR d2.calendar_staff_member_id IS NOT NULL)
      UNION ALL
      SELECT d3.sort_order, 1,
        d3.replacement_calendar_group_manager_id, d3.replacement_calendar_staff_member_id,
        v_fac_id,
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
-- 3) 実行権限（置き換えでも保たれるが、念のため 20261016120000 と同じ状態に揃える）
-- -------------------------------------------------------
REVOKE ALL ON FUNCTION public.shift_change_save_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_change_save_batch(jsonb) TO anon;

-- マイグレーション履歴に記録する（MCP の apply_migration で適用した場合と同じ形。ロールバックSQLで削除する）
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261018120000', 'shift_change_support_chain');

COMMIT;
