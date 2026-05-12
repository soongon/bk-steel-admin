import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm gap-6 py-6">
        <CardHeader>
          <CardTitle>BK Steel Admin</CardTitle>
          <CardDescription>로그인 후 진입합니다</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div className="h-32" />}>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
