-- =======================================================
-- 【本番用】リーダー・ラウンダー・現場社員を全種別の予定の担当にできるようにする
-- （Supabase Dashboard > SQL Editor で実行）
-- 実行先: スケジュールアプリ (gmtgnlxgzftrpnhlkcpv)  ※実行は承認を得た場合のみ
--
-- 変更内容: schedules の CHECK 制約 schedules_staff_assignee_mt_only（staff_member_id は MT のみ）を外す。
--   担当者が「G長・主任」か「スタッフ」のどちらか一方である制約（schedules_assignee_exactly_one）と
--   staff_members への外部キーはそのまま残す。既存の行は変更しない。
-- 公開順: このSQLを先に適用してから、画面側（全役職を担当候補に表示）を公開する。
--   逆順だと、MT以外の予定をスタッフ担当で保存したときに制約違反で保存に失敗する。
-- 戻し方: supabase/rollbacks/20261014120000_schedules_staff_assignee_all_types_down.sql
-- =======================================================
BEGIN;

ALTER TABLE public.schedules DROP CONSTRAINT IF EXISTS schedules_staff_assignee_mt_only;

COMMIT;
