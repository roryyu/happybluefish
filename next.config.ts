import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 注意：/proxy/* 的代理逻辑已迁移到 app/proxy/[...path]/route.ts 运行时处理，
  // 直接从 public 目录读取文件，这样部署到 public 的新文件无需 npm run build 即可访问。
};

export default nextConfig;
