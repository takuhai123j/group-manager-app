-- =======================================================
-- 【本番用】20261014120000_schedules_staff_assignee_all_types のロールバック
-- （Supabase Dashboard > SQL Editor で実行）
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv)  ※実行は承認を得た場合のみ
--
-- ガード: スタッフ担当でMT以外の予定が1件でもある場合は中止する
--   （制約を戻すと既存行が違反になるため。予定を消したり担当を書き換えたりはしない）
-- 先に画面側を元に戻してから実行する（戻した後に画面側でスタッフ担当の予定を作らせないため）
-- =======================================================
BEGIN;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.schedules
   WHERE staff_member_id IS NOT NULL AND type <> 'mt';
  IF n > 0 THEN
    RAISE EXCEPTION '中止: スタッフ担当でMT以外の予定が % 件あります（担当の付け替えを先に決めてください）', n;
  END IF;
END $$;

ALTER TABLE public.schedules DROP CONSTRAINT IF EXISTS schedules_staff_assignee_mt_only;
ALTER TABLE public.schedules ADD CONSTRAINT schedules_staff_assignee_mt_only
  CHECK (staff_member_id IS NULL OR type = 'mt');

COMMIT;
