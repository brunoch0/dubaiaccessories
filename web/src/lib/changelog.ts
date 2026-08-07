// 시스템 개발 소식 — 배포 시마다 최신 항목을 맨 위에 추가
export type ChangeEntry = { date: string; title: string; desc?: string; milestone?: boolean };

export const CHANGELOG: ChangeEntry[] = [
  { date: "8/7", title: "분석(Beta) 오픈", desc: "베스트셀러 TOP20 · 카테고리/가격대 판매 · 재고 회전등급 · 데드스톡(묶인 원가) · 품절 임박 재주문 추천 · 상위 고객", milestone: true },
  { date: "8/7", title: "동기화 안정화", desc: "전체 새로고침이 판매 기준시점을 건드리지 않도록 수정 (8/5 영수증 누락 원인 해결·복구)" },
  { date: "8/4", title: "정산 고도화", desc: "실결제·정가·할인 회계 구분 · 매장별 추이 차트 · 직원별 정산 · 고객명 · CSV 4종 · A4 인쇄 · 표 정렬/필터/컬럼 순서변경", milestone: true },
  { date: "8/4", title: "상품 등록 (POS 동시 등록)", desc: "SKU·바코드 자동 채번 → Loyverse에 자동 생성 · VAT · 다중 사진(대표 지정) · AI 스튜디오 컷(배경 제거·교체)", milestone: true },
  { date: "8/4", title: "Loyverse API 연동", desc: "판매 영수증 자동 수집 · 전체 상품/재고 새로고침 · 기록 타임라인", milestone: true },
  { date: "8/4", title: "상품 특성 AI 분석 (파일럿 10개)", desc: "사진에서 재료·키워드·설명 멘트 추출 — 재고 상세와 스캔 카드에 표시" },
  { date: "7/24", title: "재고 CSV 업로드", desc: "변경 미리보기 후 적용" },
  { date: "7/23", title: "운영허브 오픈 🚀", desc: "대시보드 · 재고 브라우저 · 바코드 스캔 · 고객 분석 — 상품 1,889개 실데이터 탑재", milestone: true },
];
