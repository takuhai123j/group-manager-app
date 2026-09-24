// 画面ごとのPDF操作マニュアル（public/manuals 配下に配置し、別タブで開く）。
// 将来、既存のヘルプ（HELP_CONTENT / HelpModal）から同じURLを参照して統合できるよう、ここで一元管理する。
export const MANUALS = {
  meetingPlan: {
    label: '操作マニュアル',
    url: '/manuals/mt-yearly-plan-manual.pdf',
  },
} as const
