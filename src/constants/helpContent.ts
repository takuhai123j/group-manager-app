export interface HelpItem {
  title: string
  description: string
  caution?: string
}

export interface HelpContent {
  items: readonly HelpItem[]
  commonMistake?: HelpItem
}

export const HELP_CONTENT = {
  monthView: {
    items: [
      {
        title: '月を切り替える',
        description: '上部の「＜」「＞」で前後の月に移動できます。「今日」を押すと今月に戻ります。',
      },
      {
        title: '日付を開く',
        description: '日付のマスを押すと、その日の日表示に切り替わります。日表示で時間帯を押すと予定を登録できます。',
      },
      {
        title: '予定を確認・編集する',
        description: 'マスの中の予定を押すと詳細が開き、内容の確認や編集ができます。',
      },
      {
        title: '表示しきれない予定',
        description: '1日に4件以上予定がある場合は「他◯件」とまとめて表示されます。日表示で全件確認できます。',
      },
      {
        title: '表示を切り替える',
        description: '右上の「月／週／日」ボタンで表示形式を切り替えられます。',
      },
    ],
  },
  weekView: {
    items: [
      {
        title: '週を切り替える',
        description: '上部の「＜」「＞」で前後の週に移動できます。「今日」を押すと今週に戻ります。',
      },
      {
        title: '予定を登録する',
        description: '空いている時間帯を押すと、その日時を対象にした予定登録画面が開きます。',
      },
      {
        title: '予定を確認・編集する',
        description: '登録済みの予定を押すと詳細が開き、内容の確認や編集ができます。',
      },
      {
        title: '時間の見方',
        description: '横方向に日付、縦方向に時間が並びます。同じ時間に重なる予定は横に並んで表示されます。',
      },
    ],
  },
  dayView: {
    items: [
      {
        title: '日を切り替える',
        description: '上部の「＜」「＞」で前後の日に移動できます。「今日」を押すと今日に戻ります。',
      },
      {
        title: '予定を登録する',
        description: 'スマホでは「予定を追加」ボタンから、パソコンでは空いている時間帯を押すと登録画面が開きます。',
      },
      {
        title: '予定を確認・編集する',
        description: '一覧または時間帯の予定を押すと詳細が開き、内容の確認や編集ができます。',
        caution: 'スマホは時間順のリスト表示、パソコンは時間帯グリッド表示と、見た目が異なります。',
      },
      {
        title: '終日の予定',
        description: '公休・有休などの終日予定は、一覧の一番上（終日欄）にまとめて表示されます。',
      },
    ],
  },
  eventForm: {
    items: [
      {
        title: '種別を選ぶ',
        description: '巡回・会議・面談などから予定の種別を選びます。種別ごとに色分けされて表示されます。',
      },
      {
        title: '日付・時間を入力する',
        description: '対象日と開始・終了時刻を入力します。カレンダーで日付や時間帯を押してから開くと自動で入力されます。',
      },
      {
        title: '担当G長・施設を選ぶ',
        description: '担当のグループ長と、関連する施設を選択します。',
      },
      {
        title: 'メモを入力する',
        description: '補足事項があればメモ欄に入力できます（任意）。',
      },
      {
        title: '保存・削除する',
        description: '入力後は「保存」で登録します。編集時は「削除」で予定を削除できます。',
      },
    ],
  },
  leaveForm: {
    items: [
      {
        title: '種別を選ぶ',
        description: '公休・有休・半休・半有休から種別を選びます。',
      },
      {
        title: '公休・有休（終日）',
        description: '時間の指定は不要です。複数日をまとめて登録することもできます。',
      },
      {
        title: '半休・半有休（時間指定）',
        description: '開始時刻を入力すると、終了時刻は自動で4時間後に設定されます。',
        caution: '半休・半有休は時間指定が必須です。開始時刻の入力を忘れないようにしてください。',
      },
      {
        title: '担当G長を選ぶ',
        description: '休暇を取得するグループ長を選択します。',
      },
    ],
    commonMistake: {
      title: '公休・有休なのに時間を入力しようとしてしまう',
      description: '公休・有休は終日扱いのため時間欄はありません。時間を指定したい場合は半休・半有休を選んでください。',
    },
  },
  shiftChange: {
    items: [
      {
        title: '新規登録する',
        description: '右上の「新規登録」から、単日・期間・複数日選択のいずれかのモードで登録できます。',
      },
      {
        title: '対象者を入力する',
        description: '欠勤・変更となる対象者、変更種別、変更内容を入力します。対象者は単日・期間・複数日選択モードいずれも最大5名まで追加できます。',
      },
      {
        title: '他施設からの調整',
        description: '他施設からの応援で対応する場合は「他施設からの調整」にチェックし、調整元の施設を選択します。',
      },
      {
        title: '入力者・理由を入力する',
        description: '入力者には記録を入力した本人の名前を入力します。理由も必ず入力してください。',
      },
      {
        title: '保存すると通知メールが送信される',
        description: '新規登録を保存すると、設定された宛先へ自動でメール通知が送信されます。',
      },
    ],
    commonMistake: {
      title: '入力者を「対応した人」の名前にしてしまう',
      description: '入力者欄には、対応した人ではなく、この記録を入力している本人の名前を入力してください。',
    },
  },
  shiftFiles: {
    items: [
      {
        title: 'PDFを登録する',
        description: '「PDFを追加」から、対象の施設・対象月を選んでPDFファイルをアップロードします。',
      },
      {
        title: 'ファイルを確認する',
        description: '一覧のファイルを押すと、PDFを開いて内容を確認できます。',
      },
      {
        title: 'ファイルを削除する',
        description: '不要になったファイルは一覧から削除できます。',
      },
    ],
    commonMistake: {
      title: '対象月を間違えて登録してしまう',
      description: 'アップロード前に、対象月が正しい月になっているか必ず確認してください。',
    },
  },
} as const

export type HelpContentKey = keyof typeof HELP_CONTENT
