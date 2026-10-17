"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRightIcon,
  Building2Icon,
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardListIcon,
  ContactIcon,
  FactoryIcon,
  FileDownIcon,
  FileTextIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  MapPinIcon,
  MessageSquareIcon,
  LightbulbIcon,
  PackageIcon,
  PhoneCallIcon,
  RadarIcon,
  ReceiptIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  TagsIcon,
  TrendingUpIcon,
  WalletIcon,
  ScaleIcon,
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
  /** true면 book prefix를 붙이지 않고 절대 경로로 링크(예: /radar — book 밖 독립 라우트). */
  absolute?: boolean;
  /** true면 평소엔 접어 두고 그룹 끝 [더보기]로 펼친다. 지금 보고 있는 화면이면 접혀 있어도 보인다. */
  more?: boolean;
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
        { label: "세금계산서", href: "/tax-invoices", icon: ReceiptTextIcon, more: true },
        { label: "재고", href: "/inventory", icon: PackageIcon, more: true },
        { label: "통장", href: "/bank", icon: WalletIcon, more: true },
        { label: "미수금", href: "/receivables", icon: CalendarClockIcon, more: true },
        { label: "외상매입금", href: "/payables", icon: LandmarkIcon, more: true },
        { label: "영수증·비용", href: "/receipts", icon: ReceiptIcon, more: true },
        { label: "책 간 이관", href: "/transfers", icon: ArrowLeftRightIcon, more: true },
      ],
    },
    {
      label: "영업",
      items: [
        { label: "견적서", href: "/quotes", icon: FileTextIcon },
        { label: "매입견적서", href: "/purchase-quotes", icon: ScaleIcon },
        { label: "영업내역", href: "/sales-log", icon: PhoneCallIcon },
        { label: "명함", href: "/business-cards", icon: ContactIcon },
        { label: "정기업무", href: "/recurring-tasks", icon: ClipboardListIcon, more: true },
        { label: "개선 아이디어", href: "/improvement-ideas", icon: LightbulbIcon, more: true },
      ],
    },
    {
      label: "인텔리전스",
      items: [
        // book 밖 독립 라우트 — 외부 공공데이터(법인 영역). absolute로 prefix 생략.
        { label: "발주 레이더", href: "/radar", icon: RadarIcon, absolute: true },
      ],
    },
    {
      label: "공유 마스터",
      items: [
        { label: "거래처", href: "/partners", icon: Building2Icon },
        { label: "현장", href: "/sites", icon: MapPinIcon },
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
    {
      label: "설정",
      items: [
        { label: "회사 정보", href: "/settings/company", icon: FactoryIcon },
        { label: "문자 발송", href: "/settings/sms", icon: MessageSquareIcon },
      ],
    },
  ];
}

export function AdminSidebar({ book }: { book: BookView }) {
  const pathname = usePathname();
  const groups = buildMenuGroups();
  // [더보기]로 펼친 그룹 — 처음엔 접힌 상태(more 항목은 기본으로 안 보임).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
        {groups.map((group) => {
          const open = !!expanded[group.label];
          return (
            <SidebarGroup key={group.label}>
              {/* 아이콘 모드에선 투명해진 그룹 이름이 위 그룹 마지막 항목의 아래쪽을 덮는다 — 클릭이 지나가게 */}
              <SidebarGroupLabel className="group-data-[collapsible=icon]:pointer-events-none">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const fullHref = item.absolute ? item.href : `/${book}${item.href}`;
                    const isActive = pathname === fullHref || pathname.startsWith(fullHref + "/");
                    if (item.more && !open && !isActive) return null;
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
                  {group.items.some((item) => item.more) ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={() => setExpanded((e) => ({ ...e, [group.label]: !e[group.label] }))}
                        aria-expanded={open}
                        tooltip={open ? "접기" : "더보기"}
                        className="text-muted-foreground"
                      >
                        {open ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
                        <span>{open ? "접기" : "더보기"}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : null}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
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
