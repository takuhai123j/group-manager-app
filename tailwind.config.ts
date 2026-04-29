import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Hiragino Sans"',
          '"Hiragino Kaku Gothic ProN"',
          '"Noto Sans JP"',
          "Meiryo",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
  safelist: [
    // Event types
    "bg-blue-100", "text-blue-800", "border-blue-300", "bg-blue-500",
    "bg-purple-100", "text-purple-800", "border-purple-300", "bg-purple-500",
    "bg-emerald-100", "text-emerald-800", "border-emerald-300", "bg-emerald-500",
    "bg-red-100", "text-red-800", "border-red-300", "bg-red-500",
    "bg-gray-100", "text-gray-700", "border-gray-300", "bg-gray-500",
    "bg-orange-100", "text-orange-800", "border-orange-300", "bg-orange-500",
    "bg-yellow-100", "text-yellow-800", "border-yellow-300", "bg-yellow-500",
    // Group leaders
    "bg-indigo-100", "text-indigo-800", "border-indigo-300", "bg-indigo-500",
    "bg-rose-100", "text-rose-800", "border-rose-300", "bg-rose-500",
    "bg-teal-100", "text-teal-800", "border-teal-300", "bg-teal-500",
    "bg-amber-100", "text-amber-800", "border-amber-300", "bg-amber-500",
  ],
};
export default config;
