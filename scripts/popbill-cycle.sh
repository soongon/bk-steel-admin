#!/bin/zsh
# 팝빌 매입 계산서 자동 반영 사이클 — launchd 가 하루 2회 호출(scripts/launchd/com.sl-steel.popbill-cycle.plist).
#   1) ego-lite 로 팝빌 [실시간 내역수집] → 엑셀 다운로드 (scripts/popbill-fetch.mjs)
#   2) scripts/hometax-excel.ts <xlsx> --book sl 로 수집본 적재·매입/영수증 생성·연결 (자동 처리되는 건만 씀, 나머지는 후보)
#   3) 요약을 카카오워크로 (scripts/notify-text.ts). 실패(로그인 만료 등)도 알림.
# 수동 실행: scripts/popbill-cycle.sh   /   dry-run: scripts/popbill-cycle.sh --dry-run
set -u
export PATH="/Users/soongonkim/.local/bin:/Users/soongonkim/.nvm/versions/node/v24.15.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
REPO="/Users/soongonkim/WebstormProjects/bk-steel-admin"
INBOX="/Users/soongonkim/ego/popbill-inbox"
LOGDIR="$INBOX/log"
mkdir -p "$LOGDIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOGDIR/cycle-$STAMP.log"
DRY=""; [[ "${1:-}" == "--dry-run" ]] && DRY="--dry-run"
cd "$REPO" || exit 1

notify() { printf '%s\n' "$1" | npx tsx scripts/notify-text.ts >>"$LOG" 2>&1; }

echo "[$STAMP] popbill-cycle start $DRY" >>"$LOG"
# ego-browser 는 console 출력을 stderr 로 내보낸다 → 둘 다 받는다
FETCH_OUT="$(ego-browser nodejs < scripts/popbill-fetch.mjs 2>&1)"
echo "$FETCH_OUT" >>"$LOG"
RESULT="$(printf '%s\n' "$FETCH_OUT" | grep '^{' | tail -1)"
OK="$(printf '%s' "$RESULT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.ok?"1":"0")}catch{console.log("0")}})')"
FILE="$(printf '%s' "$RESULT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).file||"")}catch{console.log("")}})')"
REASON="$(printf '%s' "$RESULT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.reason||j.error||"")}catch{console.log("")}})')"

if [[ "$OK" != "1" ]]; then
  MSG="⚠️ 팝빌 매입 수집 실패 ($STAMP)"
  [[ "$REASON" == "login" ]] && MSG="$MSG\n팝빌 로그인이 풀렸습니다. ego-lite 에서 팝빌에 다시 로그인해 주세요."
  [[ "$REASON" != "login" ]] && MSG="$MSG\n사유: $REASON"
  notify "$(printf "$MSG")"
  echo "[$STAMP] fetch failed: $REASON" >>"$LOG"
  exit 1
fi
if [[ -z "$FILE" ]]; then
  echo "[$STAMP] no rows in range" >>"$LOG"
  exit 0
fi

APPLY_OUT="$(npx tsx scripts/hometax-excel.ts "$FILE" --book sl --out "$INBOX" $DRY 2>&1 | grep -v '^npm notice')"
echo "$APPLY_OUT" >>"$LOG"
# 요약: 첫 줄(건수·기간) + 대조 집계 + 건너뛰지 않은 결정 + 반영 결과
SUMMARY="$(printf '%s\n' "$APPLY_OUT" | grep -E '^엑셀:|^대조|^  \[매입\]|^  \[매출\]|^수집본 저장|^반영 완료|^오류|Error' | grep -v 'S_skip' | head -40)"
NEW_CNT="$(printf '%s\n' "$APPLY_OUT" | grep -E '^  \[매입\]|^  \[매출\]' | grep -vc 'S_skip' || true)"
if [[ "$NEW_CNT" == "0" && -z "$DRY" ]]; then
  echo "[$STAMP] nothing new" >>"$LOG"
  exit 0
fi
notify "$(printf '🧾 팝빌 매입 자동 반영 %s%s\n%s\nhttps://bk-steel-admin.vercel.app/sl/hometax' "$STAMP" "${DRY:+ (dry-run)}" "$SUMMARY")"
echo "[$STAMP] done" >>"$LOG"
