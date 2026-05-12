import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-12 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">404</h1>
      <p className="text-muted-foreground">존재하지 않는 페이지입니다.</p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        메인으로
      </Link>
    </div>
  );
}
