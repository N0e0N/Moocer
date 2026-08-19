import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOOCER",
  description: "从课件与课纲生成逐页口播、声音和课程视频的本地制作工作台",
  openGraph: { title: "MOOCER", description: "把课件变成一堂可播放的课", type: "website" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
