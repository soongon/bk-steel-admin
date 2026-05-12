import { redirect } from "next/navigation";

export default function Home() {
  // 인증 도입 전: 기본 책(법인)의 대시보드로 진입.
  // 추후 auth 도입 후 사용자가 권한 가진 첫 책으로 동적 redirect.
  redirect("/bk/dashboard");
}
