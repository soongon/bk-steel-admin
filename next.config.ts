import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 인감(직인) 등 이미지 업로드 Server Action — 기본 1MB 초과 허용.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
