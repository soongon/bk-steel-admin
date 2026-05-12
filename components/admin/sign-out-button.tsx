"use client";

import { useRouter } from "next/navigation";
import { LogOutIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <SidebarMenuButton onClick={handleSignOut} size="sm" tooltip="로그아웃">
      <LogOutIcon className="size-4" />
      <span>로그아웃</span>
    </SidebarMenuButton>
  );
}
