import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 팝빌(전자세금계산서) SDK는 CJS + linkhub 의존 — 번들 대신 런타임 require(서버 전용).
  // nodemailer(문서 메일 SMTP)도 서버 전용 — 번들하지 않고 런타임 require.
  serverExternalPackages: ["popbill", "nodemailer"],
  experimental: {
    // 인감(직인) 등 이미지 업로드 Server Action — 기본 1MB 초과 허용.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
