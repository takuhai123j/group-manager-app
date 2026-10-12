-- =======================================================
-- 【本番用】MT同時開催 第1段階 ロールバック（Supabase Dashboard > SQL Editor で実行）
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv)  ※実行は承認を得た場合のみ
--
-- ガード:
--   1) 同時開催グループが1件でもある、または所有者以外への共有リンクがある場合は中止
--      （第2段階の利用データ＝消えると復元できない情報を守るため）
-- 削除対象は up.sql で追加した構造のみ。meetings / meeting_minutes / schedules の行と
-- Storage のファイルには触れない。CASCADE は使わない（想定外の依存があればエラーで止まる）
-- =======================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.meeting_joint_groups') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.meeting_joint_groups) THEN
    RAISE EXCEPTION '中止: 同時開催グループが存在します（先に内容を退避してください）';
  END IF;
  IF to_regclass('public.meeting_minute_links') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.meeting_minute_links l
                 JOIN public.meeting_minutes mm ON mm.id = l.minute_id
                 WHERE l.meeting_id <> mm.meeting_id) THEN
    RAISE EXCEPTION '中止: 議事録の共有リンクが存在します（先に内容を退避してください）';
  END IF;
END $$;

DROP TRIGGER  IF EXISTS trg_meeting_minutes_owner_link ON public.meeting_minutes;
DROP FUNCTION IF EXISTS public.add_owner_meeting_minute_link();

DROP TABLE    IF EXISTS public.meeting_minute_links;
DROP FUNCTION IF EXISTS public.check_meeting_minute_link_facility();

ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_joint_group_type_unique;
ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_joint_group_facility_fkey;
ALTER TABLE public.meetings DROP COLUMN     IF EXISTS joint_group_id;

DROP TABLE    IF EXISTS public.meeting_joint_groups;

COMMIT;
