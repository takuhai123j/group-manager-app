-- ============================================================
-- イートハピネス総合スケジュール管理アプリ - Supabase Schema v2
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
-- is_all_day: 全日予定フラグ（公休・有休など時間指定なし）
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
  is_all_day       BOOLEAN     NOT NULL DEFAULT FALSE,
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
-- 既存DBへの is_all_day カラム追加（初回 schema.sql 実行済み環境用）
-- Supabase Dashboard > SQL Editor で実行してください
-- -------------------------------------------------------
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_all_day BOOLEAN NOT NULL DEFAULT FALSE;

-- -------------------------------------------------------
-- Announcements（お知らせ）
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT        NOT NULL,
  content      TEXT        NOT NULL,
  is_important BOOLEAN     NOT NULL DEFAULT FALSE,
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_announcements_updated_at ON announcements;
CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_announcements" ON announcements;
CREATE POLICY "anon_all_announcements" ON announcements
  FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

-- -------------------------------------------------------
-- Shift Files（シフト表ファイル管理）
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS shift_files (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_type    TEXT        NOT NULL,
  facility_id  UUID        REFERENCES facilities(id),
  target_month TEXT        NOT NULL,
  file_name    TEXT        NOT NULL,
  file_path    TEXT        NOT NULL,
  memo         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_files_facility_id  ON shift_files(facility_id);
CREATE INDEX IF NOT EXISTS idx_shift_files_target_month ON shift_files(target_month);
CREATE INDEX IF NOT EXISTS idx_shift_files_file_type    ON shift_files(file_type);

ALTER TABLE shift_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_shift_files" ON shift_files;
CREATE POLICY "anon_all_shift_files" ON shift_files
  FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

-- Storage: shift-files バケット作成
-- ※ Supabase Dashboard > SQL Editor で実行してください
INSERT INTO storage.buckets (id, name, public)
VALUES ('shift-files', 'shift-files', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anon_all_shift_files_objects" ON storage.objects;
CREATE POLICY "anon_all_shift_files_objects" ON storage.objects
  FOR ALL TO anon
  USING (bucket_id = 'shift-files')
  WITH CHECK (bucket_id = 'shift-files');

-- -------------------------------------------------------
-- Staff Members（スタッフマスタ: リーダー・ラウンダー・現場社員）
-- role: 'leader' | 'rounder' | 'field_employee'
-- group_managers テーブルとは独立。既存G長予定に影響しない。
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  role        TEXT        NOT NULL,
  color       TEXT        NOT NULL DEFAULT '#4F46E5',
  memo        TEXT        NOT NULL DEFAULT '',
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_members_role_check CHECK (role IN ('leader', 'rounder', 'field_employee'))
);

CREATE INDEX IF NOT EXISTS idx_staff_members_role ON staff_members(role);

DROP TRIGGER IF EXISTS trg_staff_members_updated_at ON staff_members;
CREATE TRIGGER trg_staff_members_updated_at
  BEFORE UPDATE ON staff_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_staff_members" ON staff_members;
CREATE POLICY "anon_all_staff_members" ON staff_members
  FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

-- -------------------------------------------------------
-- Staff Member Facilities（スタッフの担当施設・多対多）
-- 当面UIから設定するのは role = 'leader' のみだが、
-- 将来 rounder 等にも流用できるようDB側ではroleを限定しない。
-- G長の group_manager_facilities とは独立。
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_member_facilities (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_member_id  UUID        NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  facility_id      UUID        NOT NULL REFERENCES facilities(id)    ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_member_facilities_unique UNIQUE (staff_member_id, facility_id)
);

-- UNIQUE(staff_member_id, facility_id) の索引が staff_member_id での検索を兼ねるため、
-- 施設からの逆引き用のみ追加する
CREATE INDEX IF NOT EXISTS idx_staff_member_facilities_facility_id
  ON staff_member_facilities(facility_id);

ALTER TABLE staff_member_facilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_staff_member_facilities" ON staff_member_facilities;
CREATE POLICY "anon_all_staff_member_facilities" ON staff_member_facilities
  FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

-- -------------------------------------------------------
-- schedules の担当者拡張（MT担当者としてリーダーを登録可能にする）
--   G長・主任の予定 : group_manager_id = UUID, staff_member_id = NULL
--   リーダーの予定   : group_manager_id = NULL, staff_member_id = UUID（当面MTのみ）
-- staff_members より後に定義する必要があるため、schedules 本体とは別にここで ALTER する。
-- -------------------------------------------------------
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS staff_member_id UUID NULL;

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_staff_member_id_fkey;
ALTER TABLE schedules ADD CONSTRAINT schedules_staff_member_id_fkey
  FOREIGN KEY (staff_member_id) REFERENCES staff_members(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_schedules_staff_member_id
  ON schedules(staff_member_id);

ALTER TABLE schedules ALTER COLUMN group_manager_id DROP NOT NULL;

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_assignee_exactly_one;
ALTER TABLE schedules ADD CONSTRAINT schedules_assignee_exactly_one
  CHECK (num_nonnulls(group_manager_id, staff_member_id) = 1);

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_staff_assignee_mt_only;
ALTER TABLE schedules ADD CONSTRAINT schedules_staff_assignee_mt_only
  CHECK (staff_member_id IS NULL OR type = 'mt');

-- -------------------------------------------------------
-- Meeting Frequencies（施設ごとのMT頻度設定）
-- meeting_type: 'facility'（施設MT） | 'kitchen'（厨房MT）
-- 施設×MT種別ごとに何ヶ月おきに実施するかを設定する。
-- 物理削除はせず active=false で無効化する運用を想定（他マスタと同様）。
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_frequencies (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id      UUID        NOT NULL REFERENCES facilities(id),
  meeting_type     TEXT        NOT NULL,
  interval_months  SMALLINT    NOT NULL,
  start_month      SMALLINT    NOT NULL DEFAULT 1,
  active           BOOLEAN     NOT NULL DEFAULT TRUE,
  memo             TEXT        NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meeting_frequencies_type_check
    CHECK (meeting_type IN ('facility', 'kitchen')),
  CONSTRAINT meeting_frequencies_interval_check
    CHECK (interval_months BETWEEN 1 AND 12),
  CONSTRAINT meeting_frequencies_start_month_check
    CHECK (start_month BETWEEN 1 AND 12),
  CONSTRAINT meeting_frequencies_unique
    UNIQUE (facility_id, meeting_type)
);

DROP TRIGGER IF EXISTS trg_meeting_frequencies_updated_at ON meeting_frequencies;
CREATE TRIGGER trg_meeting_frequencies_updated_at
  BEFORE UPDATE ON meeting_frequencies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE meeting_frequencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_meeting_frequencies" ON meeting_frequencies;
CREATE POLICY "anon_all_meeting_frequencies" ON meeting_frequencies
  FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

-- -------------------------------------------------------
-- Meetings（MT年間計画〜実施状況。1レコード = 1回のMT予定。暦年(1〜12月)で管理）
-- status: 'scheduled'（予定） | 'done'（実施済）
-- 「議事録登録済」は status に持たず、meeting_minutes の有無から画面側で判定する
--   scheduled                    → 予定
--   done かつ meeting_minutesなし → 実施済
--   done かつ meeting_minutesあり → 議事録登録済
-- frequency_id が NULL の行は手動追加（年間計画の自動再生成の対象外として保護する）
-- schedule_id は具体的な日程が決まった際に schedules と連携するための参照（任意）
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS meetings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id    UUID        NOT NULL REFERENCES facilities(id),
  meeting_type   TEXT        NOT NULL,
  target_month   DATE        NOT NULL,
  frequency_id   UUID        REFERENCES meeting_frequencies(id) ON DELETE SET NULL,
  schedule_id    UUID        REFERENCES schedules(id) ON DELETE SET NULL,
  status         TEXT        NOT NULL DEFAULT 'scheduled',
  executed_date  DATE,
  memo           TEXT        NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meetings_type_check
    CHECK (meeting_type IN ('facility', 'kitchen')),
  CONSTRAINT meetings_status_check
    CHECK (status IN ('scheduled', 'done')),
  CONSTRAINT meetings_target_month_first_day_check
    CHECK (EXTRACT(DAY FROM target_month) = 1),
  CONSTRAINT meetings_unique_month
    UNIQUE (facility_id, meeting_type, target_month)
);

CREATE INDEX IF NOT EXISTS idx_meetings_facility_id  ON meetings(facility_id);
CREATE INDEX IF NOT EXISTS idx_meetings_target_month ON meetings(target_month);
CREATE INDEX IF NOT EXISTS idx_meetings_status       ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_schedule_id  ON meetings(schedule_id);
CREATE INDEX IF NOT EXISTS idx_meetings_frequency_id ON meetings(frequency_id);

DROP TRIGGER IF EXISTS trg_meetings_updated_at ON meetings;
CREATE TRIGGER trg_meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_meetings" ON meetings;
CREATE POLICY "anon_all_meetings" ON meetings
  FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

-- -------------------------------------------------------
-- Meeting Minutes（MT議事録PDFのメタデータ。1件のMTに対し複数可）
-- 実体ファイルは Storage の meeting-minutes バケット（private）に保存する
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS meeting_minutes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   UUID        NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  file_name    TEXT        NOT NULL,
  file_path    TEXT        NOT NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  memo         TEXT
);

CREATE INDEX IF NOT EXISTS idx_meeting_minutes_meeting_id ON meeting_minutes(meeting_id);

ALTER TABLE meeting_minutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_meeting_minutes" ON meeting_minutes;
CREATE POLICY "anon_all_meeting_minutes" ON meeting_minutes
  FOR ALL TO anon USING (TRUE) WITH CHECK (TRUE);

-- Storage: meeting-minutes バケット作成（private。shift-filesとは分離）
-- 認証は導入しないため、shift-files と同様に anon ロールに対して
-- バケットを限定した全操作ポリシーを付与する。
-- public=false のため、閲覧は getPublicUrl ではなく
-- createSignedUrl（期限付きURL）をアプリ側で都度発行する運用とする。
-- 将来 Supabase Auth を導入する際は、このポリシーを
-- authenticated ロール向けに見直すことを前提とする。
-- ※ Supabase Dashboard > SQL Editor で実行してください
INSERT INTO storage.buckets (id, name, public)
VALUES ('meeting-minutes', 'meeting-minutes', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anon_all_meeting_minutes_objects" ON storage.objects;
CREATE POLICY "anon_all_meeting_minutes_objects" ON storage.objects
  FOR ALL TO anon
  USING (bucket_id = 'meeting-minutes')
  WITH CHECK (bucket_id = 'meeting-minutes');

-- -------------------------------------------------------
-- MTメール通知の通知済み管理
--   meetings.schedule_notified_at      : MT予定確定通知を送信済みの日時（1MTにつき原則1回）
--   meetings.schedule_notify_claimed_at: 予定確定通知を送信処理中の目印（並行送信の抑止用）
--   meeting_minutes.notified_at        : 議事録保存通知を送信済みの日時（1ファイルにつき1回）
--   meeting_minutes.notify_claimed_at  : 議事録通知を送信処理中の目印（並行送信の抑止用）
-- ※ これら4列の更新は通知API Route（/api/meeting-notify/*）側だけで行い、
--    クライアントコードからは直接更新しない（Phase 1 のRLSでは技術的には更新可能なため運用ルールとする）。
-- ※ 導入時に既存データを通知済みにする穴埋めUPDATEは初回migration専用のため、ここには含めない。
-- -------------------------------------------------------
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS schedule_notified_at       TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS schedule_notify_claimed_at TIMESTAMPTZ NULL;

ALTER TABLE meeting_minutes
  ADD COLUMN IF NOT EXISTS notified_at       TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS notify_claimed_at TIMESTAMPTZ NULL;

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
