# SH철강 운영 시스템 Makefile
#
# 일상 운영:
#   make sync       - xlsx → CSV + 매출 미러링 (xlsx 보존, Excel 캐시 보존)
#   make backup     - data/를 backup/YYYY-MM-DD/로 복사
#
# 양식 변경 (create_spreadsheets.py 수정 후):
#   make refresh    - extract + mirror + rebuild (양식 변경 사이클)
#
# 개별 명령:
#   make extract    - xlsx → CSV
#   make mirror     - 매출 수금완료 → 통장 미러링 (CSV → CSV)
#   make rebuild    - CSV → xlsx
#
# 첫 시작 (5/1 1회만):
#   make build      - 빈 양식 + 샘플로 xlsx 생성

.PHONY: install build extract mirror rebuild sync refresh backup clean help

XLSX = workbook/output/SL철강_5월_운영시트.xlsx
TODAY := $(shell date +%Y-%m-%d)

help:
	@echo "SH철강 운영 시스템 명령어:"
	@echo ""
	@echo "  📥 일상 운영"
	@echo "  make sync      - xlsx 편집 후 백업 + 매출 미러링 (가장 자주 사용)"
	@echo "  make backup    - data/를 backup/$(TODAY)/로 복사"
	@echo ""
	@echo "  🛠️  양식 변경 후"
	@echo "  make refresh   - extract + mirror + rebuild (create_spreadsheets.py 수정 후)"
	@echo ""
	@echo "  🔧 개별 명령"
	@echo "  make extract   - xlsx → CSV (데이터 추출만)"
	@echo "  make mirror    - 매출 수금완료 → 6.통장 자동 행 추가 (매칭ID dedup)"
	@echo "  make rebuild   - CSV → xlsx (빈 양식 + 데이터 주입)"
	@echo ""
	@echo "  📦 기타"
	@echo "  make install   - 의존성 설치 (openpyxl)"
	@echo "  make build     - 첫 워크북 생성 (5/1 1회만, 안전장치 있음)"
	@echo "  make clean     - 생성된 xlsx, __pycache__ 삭제 (CSV는 보존)"
	@echo ""
	@echo "⚠ make build는 데이터 있는 상태에서 호출하면 안전장치가 거부합니다."

install:
	pip install openpyxl

# build: ⚠ 첫 시작 (5/1) 1회만. 이후엔 데이터가 샘플로 덮어씌워질 수 있어 안전장치가 거부.
#        양식·데이터 모두 다시 만들고 싶으면 'make rebuild' (CSV 데이터 보존).
build:
	python3 workbook/create_spreadsheets.py
	@echo ""
	@echo "✓ 워크북 생성됨: $(XLSX)"
	@echo "→ iCloud Drive 또는 Google Drive에 업로드해서 친구·직원과 공유"

extract:
	python3 migrate.py extract

mirror:
	python3 migrate.py mirror

rebuild:
	python3 migrate.py rebuild

# sync: 일상 명령 — xlsx에서 편집한 데이터를 CSV로 백업 + 매출 미러링.
#       xlsx는 그대로 유지 (Excel이 박은 수식 캐시 보존).
sync:
	python3 migrate.py sync
	@echo ""
	@echo "다음 단계: git add data/ && git commit -m 'data: $(TODAY) 동기화'"

# refresh: 양식 변경 사이클 — create_spreadsheets.py 수정 후 xlsx 재생성.
#          (sync 후 추가로 rebuild 까지)
refresh:
	python3 migrate.py refresh
	@echo ""
	@echo "✓ xlsx 재생성 완료 (양식 변경 사이클)"

backup:
	@mkdir -p backup/$(TODAY)
	@cp -r data/* backup/$(TODAY)/ 2>/dev/null || true
	@cp $(XLSX) backup/$(TODAY)/ 2>/dev/null || true
	@echo "✓ backup/$(TODAY)/ 에 백업 완료"
	@ls -la backup/$(TODAY)/

clean:
	rm -rf workbook/__pycache__
	rm -f workbook/output/*.xlsx
	@echo "✓ 생성물 삭제 완료 (data/ CSV는 보존됨)"
