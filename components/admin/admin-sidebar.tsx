"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRightIcon,
  Building2Icon,
  CalendarClockIcon,
  ClipboardListIcon,
  FileDownIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  LightbulbIcon,
  PackageIcon,
  PhoneCallIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  TagsIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";

import { type BookView } from "@/lib/book";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { BookSwitcher } from "@/components/admin/book-switcher";
import { SignOutButton } from "@/components/admin/sign-out-button";

type MenuItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

type MenuGroup = {
  label: string;
  items: MenuItem[];
};

/**
 * 책 컨텍스트별 메뉴 그룹.
 * 책 prefix(/bk·/sl·/b)는 BookSidebar에서 prepend.
 */
function buildMenuGroups(): MenuGroup[] {
  return [
    {
      label: "운영",
      items: [
        { label: "대시보드", href: "/dashboard", icon: LayoutDashboardIcon },
        { label: "매출", href: "/sales", icon: ShoppingCartIcon },
        { label: "매입", href: "/purchases", icon: ShoppingBagIcon },
        { label: "재고", href: "/inventory", icon: PackageIcon },
        { label: "통장", href: "/bank", icon: WalletIcon },
        { label: "미수금", href: "/receivables", icon: CalendarClockIcon },
        { label: "외상매입금", href: "/payables", icon: LandmarkIcon },
        { label: "영수증·비용", href: "/receipts", icon: ReceiptIcon },
        { label: "책 간 이관", href: "/transfers", icon: ArrowLeftRightIcon },
      ],
    },
    {
      label: "영업",
      items: [
        { label: "영업내역", href: "/sales-log", icon: PhoneCallIcon },
        { label: "정기업무", href: "/recurring-tasks", icon: ClipboardListIcon },
        { label: "개선 아이디어", href: "/improvement-ideas", icon: LightbulbIcon },
      ],
    },
    {
      label: "공유 마스터",
      items: [
        { label: "거래처", href: "/partners", icon: Building2Icon },
        { label: "품목", href: "/items", icon: TagsIcon },
        { label: "오늘의 시세", href: "/prices", icon: TrendingUpIcon },
      ],
    },
    {
      label: "결산·감사",
      items: [
        { label: "결산·신고 export", href: "/export", icon: FileDownIcon },
        { label: "감사 로그", href: "/audit", icon: ShieldCheckIcon },
      ],
    },
  ];
}

export function AdminSidebar({ book }: { book: BookView }) {
  const pathname = usePathname();
  const groups = buildMenuGroups();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <BookSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const fullHref = `/${book}${item.href}`;
                  const isActive = pathname === fullHref || pathname.startsWith(fullHref + "/");
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        render={<Link href={fullHref} />}
                        isActive={isActive}
                        tooltip={item.label}
                      >
                        <Icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SignOutButton />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" className="text-xs text-muted-foreground">
              bk-steel-admin v0.1
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
