# グループ長スケジュール管理アプリ

給食会社のグループ長スケジュールをPC・スマホで共有・管理するアプリです。

## 機能

- カレンダー表示（月・週・日ビュー）
- グループ長ごとの予定管理・色分け表示
- 施設マスタ管理
- 種別・施設によるフィルタリング
- PC・スマホ両対応

## 技術スタック

- [Next.js 14](https://nextjs.org/) (App Router)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Supabase](https://supabase.com/)

---

## ローカル開発環境のセットアップ

### 1. 依存パッケージをインストール

```bash
npm install
```

### 2. 環境変数を設定

`.env.example` をコピーして `.env.local` を作成し、Supabase の接続情報を記入します。

```bash
cp .env.example .env.local
```

`.env.local` を編集：

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

> 取得場所: [Supabase Dashboard](https://supabase.com/dashboard) > Project Settings > API

### 3. Supabase にスキーマを作成

Supabase Dashboard の **SQL Editor** を開き、`supabase/schema.sql` の内容を貼り付けて実行します。  
テーブル・RLS・初期データ（G長4名・施設6件）が作成されます。

### 4. 開発サーバーを起動

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) で動作確認できます。

---

## Vercel へのデプロイ

### 1. GitHub にリポジトリを作成してプッシュ

```bash
git remote add origin https://github.com/your-username/your-repo.git
git branch -M main
git push -u origin main
```

### 2. Vercel にインポート

1. [vercel.com](https://vercel.com) にログイン
2. **Add New > Project** からGitHubリポジトリを選択
3. **Environment Variables** に以下を設定：

| 変数名 | 値 | 環境 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase の Project URL | Production / Preview / Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase の anon public key | Production / Preview / Development |

4. **Deploy** をクリック

> **注意:** `.env.local` は絶対にGitHubにアップロードしないでください。  
> 環境変数は必ずVercelの管理画面で設定してください。

### Supabase の CORS 設定（必要な場合）

Supabase Dashboard > Project Settings > API > **Allowed Origins** に Vercel の URL を追加してください。

```
https://your-app.vercel.app
```

---

## 環境変数一覧

| 変数名 | 説明 | 必須 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクトの URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase の anon（公開）キー | ✅ |

---

## データベース構成

`supabase/schema.sql` に全定義が含まれています。

| テーブル | 用途 |
|---|---|
| `group_managers` | グループ長マスタ（ソフトデリート対応） |
| `facilities` | 施設マスタ（ソフトデリート対応） |
| `schedules` | 予定データ（グループ長・施設にFK） |

RLS（Row Level Security）有効済み。現在はログインなしで読み書き可能な Phase 1 設定です。
