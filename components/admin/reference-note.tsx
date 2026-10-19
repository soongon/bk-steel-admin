/** 견적 폼 위 참고 원문(홈페이지 문의 내용 등) — 통화하며 품목을 옮겨 적을 수 있게. 저장·출력하지 않는다. */
export function ReferenceNote({ text, label = "문의 내용" }: { text: string; label?: string }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs">
      <div className="mb-0.5 text-muted-foreground">{label} (참고 · 견적서에는 안 나감)</div>
      <p className="max-h-28 overflow-y-auto whitespace-pre-wrap">{text}</p>
    </div>
  );
}
