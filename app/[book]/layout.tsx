import { notFound } from "next/navigation";
import { isValidBookView, type BookView } from "@/lib/book";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { BookBadge } from "@/components/admin/book-badge";

export default async function BookLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ book: string }>;
}) {
  const { book } = await params;
  if (!isValidBookView(book)) notFound();
  const currentBook: BookView = book;

  return (
    <SidebarProvider>
      <AdminSidebar book={currentBook} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>현재 보기:</span>
            <BookBadge book={currentBook} />
          </div>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
