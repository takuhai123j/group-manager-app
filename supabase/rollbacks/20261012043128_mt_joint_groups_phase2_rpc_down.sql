-- =======================================================
-- 【本番用】MT同時開催 第2段階A ロールバック  Supabase Dashboard > SQL Editor（承認を得た場合のみ）
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv) 専用
-- 削除するのは第2段階で追加したRPC・トリガー・関数と、その履歴行だけ。テーブル・データ・Storage には触れない
-- 履歴行の削除は Supabase CLI の `migration repair --status reverted` と同じ扱い（未適用状態に戻す）
-- ガード: 同時開催グループが1件でもある場合は中止（整合性トリガーを外した状態で運用させないため）
-- =======================================================
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.facilities WHERE name LIKE 'テスト施設%') THEN
    RAISE EXCEPTION '中止: 検証用プロジェクトのデータがあります（本番用SQLです）';
  END IF;
  IF EXISTS (SELECT 1 FROM public.meeting_joint_groups) THEN
    RAISE EXCEPTION '中止: 同時開催グループが存在します（先に解除するか、方針を確認してください）';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.mt_create_joint_meetings(uuid, text, date, text, uuid, date, date, text, text, boolean, uuid, uuid);
DROP FUNCTION IF EXISTS public.mt_leave_joint(uuid, uuid);
DROP FUNCTION IF EXISTS public.mt_mark_joint_done(uuid, date);
DROP FUNCTION IF EXISTS public.mt_confirm_joint_schedule(uuid, date, text, text, boolean, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.mt_join_meetings(uuid, uuid, uuid, uuid, date);

DROP TRIGGER  IF EXISTS trg_meeting_minutes_joint_partner_link ON public.meeting_minutes;
DROP FUNCTION IF EXISTS public.mt_link_minute_to_joint_partner();

DROP TRIGGER  IF EXISTS trg_mt_joint_group_check_meetings ON public.meetings;
DROP TRIGGER  IF EXISTS trg_mt_joint_group_check_groups ON public.meeting_joint_groups;
DROP FUNCTION IF EXISTS public.mt_check_joint_group();

DELETE FROM supabase_migrations.schema_migrations
 WHERE version = '20261012043128' AND name = 'mt_joint_groups_phase2_rpc';

COMMIT;
