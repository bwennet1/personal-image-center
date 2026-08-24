import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "个人图片中心",
  description: "云端图片资产管理、浏览、分享与创作",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
