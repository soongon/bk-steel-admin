"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { ChevronsUpDownIcon } from "lucide-react";
import {
  BOOK_VIEWS,
  type BookView,
  isValidBookView,
} from "@/lib/book";
import { BookBadge } from "@/components/admin/book-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";

/**
 * 책 selector — sidebar 상단.
 * URL prefix(/all·/bk·/sl·/b)만 교체하여 같은 메뉴 유지.
 */
export function BookSwitcher() {
  const params = useParams<{ book?: string }>();
  const pathname = usePathname();
  const router = useRouter();

  const current: BookView = isValidBookView(params.book) ? params.book : "all";

  function switchTo(target: BookView) {
    if (target === current) return;
    const next = pathname.replace(/^\/(all|bk|sl|b)(\/|$)/, `/${target}$2`);
    router.push(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          />
        }
      >
        <div className="flex flex-col items-start gap-0.5 text-left">
          <span className="text-xs text-muted-foreground">현재 보기</span>
          <div className="flex items-center gap-2">
            <BookBadge book={current} size="md" />
          </div>
        </div>
        <ChevronsUpDownIcon className="ml-auto size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>책 전환</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {BOOK_VIEWS.map((b) => (
            <DropdownMenuItem
              key={b}
              onClick={() => switchTo(b)}
              className="flex items-center gap-2"
            >
              <BookBadge book={b} />
              <span className="ml-auto text-xs text-muted-foreground">
                {b === current ? "현재" : "/" + b}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
