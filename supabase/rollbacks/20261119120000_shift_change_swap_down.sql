-- =======================================================
-- 【本番用】20261119120000_shift_change_swap のロールバック
-- （Supabase Dashboard > SQL Editor で実行。実行は承認を得た場合のみ）
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv) 専用
--
-- 先に画面側を元に戻してから実行する（戻した後に画面から振替を登録させないため）
-- 内容: 今回追加した関数・トリガー・制約・索引・列・テーブルと履歴行を削除し、記録の施設を NOT NULL に戻す。
--       既存のシフト変更・応援チェーン・振休・自動予定・手動の予定・MT には触れない
--
-- ガード（どれかに当たれば何も変えずに中止）:
--   ・振替が1件でもある（消すと振替の記録・自動予定・非表示の紐付けが失われるため。残すか取り消すかを先に決め、
--     取り消す場合は画面から取り消してから実行する）
--   ・施設なしの記録、振替の種別の明細・予定が残っている（施設を NOT NULL に戻せない／種別だけが残るため）
--   ・本部へ未送信の通知（送信済み以外）が残っている（通知の記録ごと消えて、送れなくなるため）
-- 注意: 送信済みの通知の記録（操作の履歴）は、ロールバックで削除される
-- =======================================================
BEGIN;

DO $$
DECLARE
  n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.facilities WHERE name LIKE 'テスト施設%') THEN
    RAISE EXCEPTION '中止: 検証用プロジェクトのデータがあります（本番用SQLです）';
  END IF;
  SELECT count(*) INTO n FROM public.shift_change_swaps;
  IF n > 0 THEN
    RAISE EXCEPTION '中止: 勤務・休日振替が % 件あります（残すか取り消すかを先に決めてください）', n;
  END IF;
  SELECT count(*) INTO n FROM public.shift_change_swap_operations WHERE notify_status <> 'sent';
  IF n > 0 THEN
    RAISE EXCEPTION '中止: 本部へ未送信の振替の通知が % 件あります（送信するか、要確認を片付けてから実行してください）', n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_change_records WHERE facility_id IS NULL OR swap_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.shift_change_details WHERE change_type IN ('振替出勤', '振替休日'))
     OR EXISTS (SELECT 1 FROM public.schedules WHERE type IN ('furikae_work', 'furikae_off')) THEN
    RAISE EXCEPTION '中止: 施設なしの記録、または振替の種別の明細・予定が残っています';
  END IF;
END $$;

-- 保存・取消の関数
DROP FUNCTION IF EXISTS public.shift_change_swap_save(jsonb);
DROP FUNCTION IF EXISTS public.shift_change_swap_delete(uuid, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.shift_change_swap_notify_claim(uuid);
DROP FUNCTION IF EXISTS public.shift_change_swap_notify_finish(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.shift_change_swap_notify_resolve(uuid, text);
DROP FUNCTION IF EXISTS public.shift_change_swap_mail_content(uuid);

-- トリガー（見張り・2日分の検査）
DROP TRIGGER IF EXISTS shift_change_records_swap_guard_ins ON public.shift_change_records;
DROP TRIGGER IF EXISTS shift_change_records_swap_guard_upd ON public.shift_change_records;
DROP TRIGGER IF EXISTS shift_change_records_swap_guard_del ON public.shift_change_records;
DROP TRIGGER IF EXISTS shift_change_details_swap_guard ON public.shift_change_details;
DROP TRIGGER IF EXISTS schedules_swap_guard_ins ON public.schedules;
DROP TRIGGER IF EXISTS schedules_swap_guard_upd ON public.schedules;
DROP TRIGGER IF EXISTS schedules_swap_guard_del ON public.schedules;
DROP TRIGGER IF EXISTS shift_change_swaps_check ON public.shift_change_swaps;
DROP TRIGGER IF EXISTS shift_change_records_swap_check_ins ON public.shift_change_records;
DROP TRIGGER IF EXISTS shift_change_records_swap_check_upd ON public.shift_change_records;
DROP TRIGGER IF EXISTS shift_change_records_swap_check_del ON public.shift_change_records;
DROP TRIGGER IF EXISTS shift_change_details_swap_check ON public.shift_change_details;

DROP FUNCTION IF EXISTS public.shift_change_swap_guard_records();
DROP FUNCTION IF EXISTS public.shift_change_swap_guard_details();
DROP FUNCTION IF EXISTS public.shift_change_swap_guard_schedules();
DROP FUNCTION IF EXISTS public.shift_change_swap_check();

-- 予定の制約
ALTER TABLE public.schedules DROP CONSTRAINT IF EXISTS schedules_furikae_auto_only;

-- 記録の制約・索引・列（外部キーを先に外す）
DROP INDEX IF EXISTS public.shift_change_records_swap_role_unique;
ALTER TABLE public.shift_change_records
  DROP CONSTRAINT IF EXISTS shift_change_records_swap_person_date_excl,
  DROP CONSTRAINT IF EXISTS shift_change_records_swap_fkey,
  DROP CONSTRAINT IF EXISTS shift_change_records_swap_not_in_group,
  DROP CONSTRAINT IF EXISTS shift_change_records_facility_required,
  DROP CONSTRAINT IF EXISTS shift_change_records_swap_role_values,
  DROP CONSTRAINT IF EXISTS shift_change_records_swap_fields_together,
  DROP COLUMN IF EXISTS swap_person_key,
  DROP COLUMN IF EXISTS swap_role,
  DROP COLUMN IF EXISTS swap_id;
ALTER TABLE public.shift_change_records
  ALTER COLUMN facility_id SET NOT NULL;

-- 新しいテーブル（非表示の紐付け → 振替の順）
DROP TABLE IF EXISTS public.shift_change_swap_operations;
DROP TABLE IF EXISTS public.shift_change_swap_hidden_schedules;
DROP TABLE IF EXISTS public.shift_change_swaps;

DELETE FROM supabase_migrations.schema_migrations
 WHERE version = '20261119120000' AND name = 'shift_change_swap';

COMMIT;
