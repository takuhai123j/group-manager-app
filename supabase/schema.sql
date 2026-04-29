-- ============================================================
-- グループ長スケジュール管理アプリ - Supabase Schema v2
-- ============================================================
-- 実行方法: Supabase Dashboard > SQL Editor に貼り付けて実行
-- ============================================================

-- -------------------------------------------------------
-- Extensions
-- -------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------
-- Tables
-- -------------------------------------------------------

-- Group managers（グループ長マスタ）
CREATE TABLE IF NOT EXISTS group_managers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  color       TEXT        NOT NULL DEFAULT '#4F46E5',
  memo        TEXT        NOT NULL DEFAULT '',
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Facilities（施設マスタ）
-- active=false で無効化（物理削除しない）
CREATE TABLE IF NOT EXISTS facilities (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  area        TEXT        NOT NULL DEFAULT '',
  memo        TEXT        NOT NULL DEFAULT '',
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Schedules（スケジュール）
-- group_manager_id: G長への外部キー（必須）
-- facility_id: 施設への外部キー（任意、NULLで未設定）
CREATE TABLE IF NOT EXISTS schedules (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_manager_id UUID        NOT NULL REFERENCES group_managers(id),
  facility_id      UUID        REFERENCES facilities(id),
  title            TEXT        NOT NULL,
  date             DATE        NOT NULL,
  start_time       TEXT        NOT NULL,
  end_time         TEXT        NOT NULL,
  type             TEXT        NOT NULL DEFAULT 'other',
  memo             TEXT        NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_date             ON schedules(date);
CREATE INDEX IF NOT EXISTS idx_schedules_group_manager_id ON schedules(group_manager_id);
CREATE INDEX IF NOT EXISTS idx_schedules_facility_id      ON schedules(facility_id);

-- -------------------------------------------------------
-- updated_at 自動更新トリガー
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_managers_updated_at ON group_managers;
CREATE TRIGGER trg_group_managers_updated_at
  BEFORE UPDATE ON group_managers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_facilities_updated_at ON facilities;
CREATE TRIGGER trg_facilities_updated_at
  BEFORE UPDATE ON facilities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_schedules_updated_at ON schedules;
CREATE TRIGGER trg_schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -------------------------------------------------------
-- Row Level Security
-- Phase 1: ログインなし、anonユーザーで全操作可能
-- Phase 2（将来）: authenticated ユーザーのみ、RLS強化
-- -------------------------------------------------------
ALTER TABLE group_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules      ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除してから再作成（冪等実行のため）
DROP POLICY IF EXISTS "anon_all_group_managers" ON group_managers;
DROP POLICY IF EXISTS "anon_all_facilities"     ON facilities;
DROP POLICY IF EXISTS "anon_all_schedules"      ON schedules;

-- Phase 1ポリシー: anonユーザーに全操作を許可
CREATE POLICY "anon_all_group_managers" ON group_managers
  FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "anon_all_facilities" ON facilities
  FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "anon_all_schedules" ON schedules
  FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

-- -------------------------------------------------------
-- シードデータ（テーブルが空の場合のみ挿入）
-- -------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM group_managers LIMIT 1) THEN
    INSERT INTO group_managers (name, color, memo, active, sort_order) VALUES
      ('福田G長',   '#4F46E5', '', TRUE, 0),
      ('東本G長',   '#E11D48', '', TRUE, 1),
      ('井上G長',   '#0D9488', '', TRUE, 2),
      ('山本G長',   '#D97706', '', TRUE, 3);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM facilities LIMIT 1) THEN
    INSERT INTO facilities (name, area, memo, active, sort_order) VALUES
      ('高槻南',   '', '', TRUE, 0),
      ('登美ヶ丘', '', '', TRUE, 1),
      ('寝屋川',   '', '', TRUE, 2),
      ('豊中北',   '', '', TRUE, 3),
      ('交野',     '', '', TRUE, 4),
      ('大塚',     '', '', TRUE, 5);
  END IF;
END;
$$;

-- -------------------------------------------------------
-- Phase 2 移行時の参考SQL（コメントアウト）
-- -------------------------------------------------------
-- ALTER TABLE group_managers ADD COLUMN IF NOT EXISTS org_id UUID;
-- ALTER TABLE facilities     ADD COLUMN IF NOT EXISTS org_id UUID;
-- ALTER TABLE schedules      ADD COLUMN IF NOT EXISTS org_id UUID;
--
-- DROP POLICY IF EXISTS "anon_all_group_managers" ON group_managers;
-- CREATE POLICY "auth_own_group_managers" ON group_managers
--   FOR ALL TO authenticated
--   USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()))
--   WITH CHECK (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));
