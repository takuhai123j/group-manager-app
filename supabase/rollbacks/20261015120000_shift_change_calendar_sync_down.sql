-- =======================================================
-- 【本番用】20261015120000_shift_change_calendar_sync のロールバック
-- （Supabase Dashboard > SQL Editor で実行。実行は承認を得た場合のみ）
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv) 専用
--
-- 先に画面側を元に戻してから実行する（戻した後に画面から新しいRPC・列を使わせないため）
-- 削除するのは今回追加したRPC・索引・制約・列と、その履歴行だけ。既存の列・データには触れない
--
-- ガード: 自動生成予定（schedules.shift_change_record_id あり）が1件でもある場合は中止する。
--   列を消すと「自動生成かどうか」の区別が失われ、手動の予定と見分けられなくなるため。
--   自動生成予定を消してよいと決めた場合だけ、下の【任意】のDELETEを先に実行してから本体を実行する。
--   （明細の反映先・時刻の列は消えるが、シフト変更の記録そのもの・手動の予定は残る）
-- =======================================================

-- 【任意】自動生成予定を消す場合のみ（手動の予定は shift_change_record_id が NULL なので対象外）
-- DELETE FROM public.schedules WHERE shift_change_record_id IS NOT NULL;

BEGIN;

DO $$
DECLARE
  n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.facilities WHERE name LIKE 'テスト施設%') THEN
    RAISE EXCEPTION '中止: 検証用プロジェクトのデータがあります（本番用SQLです）';
  END IF;
  SELECT count(*) INTO n FROM public.schedules WHERE shift_change_record_id IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '中止: シフト変更から自動登録した予定が % 件あります（残すか消すかを先に決めてください）', n;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.shift_change_save_batch(jsonb);

DROP INDEX IF EXISTS public.schedules_shift_change_person_unique;
ALTER TABLE public.schedules DROP COLUMN IF EXISTS shift_change_record_id;

ALTER TABLE public.shift_change_details
  DROP CONSTRAINT IF EXISTS shift_change_details_time_format,
  DROP CONSTRAINT IF EXISTS shift_change_details_time_pair,
  DROP CONSTRAINT IF EXISTS shift_change_details_calendar_target_at_most_one,
  DROP COLUMN IF EXISTS end_time,
  DROP COLUMN IF EXISTS start_time,
  DROP COLUMN IF EXISTS calendar_staff_member_id,
  DROP COLUMN IF EXISTS calendar_group_manager_id;

DELETE FROM supabase_migrations.schema_migrations
 WHERE version = '20261015120000' AND name = 'shift_change_calendar_sync';

COMMIT;
