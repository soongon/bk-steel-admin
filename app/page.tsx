import { redirect } from "next/navigation";

export default function Home() {
  // 기본 진입: 전체 보기 (RLS가 권한에 따라 자동 필터).
  redirect("/all/dashboard");
}
