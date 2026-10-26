"use client";

import { useEffect, useState } from "react";
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
  ExternalLinkIcon,
  FactoryIcon,
  FileDownIcon,
  FileSearchIcon,
  FileTextIcon,
  GlobeIcon,
  InboxIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  MapPinIcon,
  MessageSquareIcon,
  LightbulbIcon,
  NewspaperIcon,
  PackageIcon,
  PenLineIcon,
  PhoneCallIcon,
  RadarIcon,
  ReceiptIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  SmartphoneIcon,
  TagsIcon,
  TrendingUpIcon,
  WalletIcon,
  ScaleIcon,
} from "lucide-react";

import { type BookView } from "@/lib/book";
import { HOMEPAGE_URL } from "@/lib/inquiry";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
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
  /** true면 다른 사이트 — href 는 전체 주소, 새 탭으로 열고 바깥 링크 표시. */
  external?: boolean;
  /** 메뉴 오른쪽 숫자 배지 — AdminSidebar 의 같은 이름 prop(서버가 넘긴 promise)으로 그린다. */
  badge?: keyof MenuBadges;
};

/** 메뉴 배지 숫자 — 레이아웃이 기다리지 않고 promise 로 넘긴다(느려도 메뉴는 먼저 뜬다). null·0 이면 배지 없음. */
type MenuBadges = { newInquiries?: Promise<number | null> };
const BADGE_LABEL: Record<keyof MenuBadges, string> = { newInquiries: "새 문의" };

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
        { label: "홈택스 대사", href: "/hometax", icon: FileSearchIcon, more: true },
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
      // 문의는 이 어드민에서(홈페이지 DB 를 직접 읽음). 블로그 관리는 아직 홈페이지 관리자(별도 로그인) — 새 탭 링크.
      label: "홈페이지",
      items: [
        { label: "문의 관리", href: "/inquiries", icon: InboxIcon, badge: "newInquiries" },
        { label: "블로그 글", href: `${HOMEPAGE_URL}/admin`, icon: NewspaperIcon, external: true },
        { label: "빠른 글쓰기", href: `${HOMEPAGE_URL}/admin/quick-post`, icon: PenLineIcon, external: true, more: true },
        { label: "모바일 글쓰기", href: `${HOMEPAGE_URL}/admin/mobile-post`, icon: SmartphoneIcon, external: true, more: true },
        { label: "블로그 보기", href: `${HOMEPAGE_URL}/blog`, icon: GlobeIcon, external: true, more: true },
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

/**
 * 숫자 배지(펼친 메뉴) + 빨간 점(아이콘만 보이는 접힌 메뉴).
 * use()로 기다리지 않는다 — 서버 액션 뒤 레이아웃이 다시 그려질 때마다 화면 갱신이 홈페이지 DB 응답까지 멈춘다.
 * 새 숫자가 올 때까지는 이전 숫자를 둔다.
 */
function MenuCountBadge({ count, label }: { count: Promise<number | null>; label: string }) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    count.then(
      (v) => alive && setN(v),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [count]);
  if (!n) return null;
  return (
    <>
      <SidebarMenuBadge className="rounded-full bg-red-500 text-white peer-hover/menu-button:text-white peer-data-active/menu-button:text-white">
        <span className="sr-only">{label} </span>
        {n > 99 ? "99+" : n}
        <span className="sr-only">건</span>
      </SidebarMenuBadge>
      <span aria-hidden className="pointer-events-none absolute top-1 right-1 hidden size-2 rounded-full bg-red-500 group-data-[collapsible=icon]:block" />
    </>
  );
}

export function AdminSidebar({ book, badges = {} }: { book: BookView; badges?: MenuBadges }) {
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
                    const fullHref = item.absolute || item.external ? item.href : `/${book}${item.href}`;
                    const isActive = !item.external && (pathname === fullHref || pathname.startsWith(fullHref + "/"));
                    if (item.more && !open && !isActive) return null;
                    const Icon = item.icon;
                    const badgeCount = item.badge ? badges[item.badge] : undefined;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          render={
                            item.external ? (
                              <a href={fullHref} target="_blank" rel="noopener noreferrer" />
                            ) : (
                              <Link href={fullHref} />
                            )
                          }
                          isActive={isActive}
                          tooltip={item.label}
                          className={badgeCount ? "group-has-data-[sidebar=menu-badge]/menu-item:pr-8" : undefined}
                        >
                          <Icon className="size-4" />
                          <span>
                            {item.label}
                            {item.external ? <span className="sr-only"> (새 탭)</span> : null}
                          </span>
                          {item.external ? (
                            <span className="ml-auto text-muted-foreground">
                              <ExternalLinkIcon className="size-3" />
                            </span>
                          ) : null}
                        </SidebarMenuButton>
                        {badgeCount ? <MenuCountBadge count={badgeCount} label={BADGE_LABEL[item.badge!]} /> : null}
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
