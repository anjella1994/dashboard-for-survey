# Home 화면 스펙

> 구현 파일: `home.html`
> 공통 토큰과 컴포넌트는 [design_system.md](design_system.md)를 따른다.
> 이 문서는 화면 구조, 문구, 상태, 검증 규칙만 관리한다. 세부 CSS 값은 `dashboard-for-survey.css`의 `.home-page` 스타일을 기준으로 한다.

---

## 화면 구조

| 영역 | 구성 |
|------|------|
| Top Bar | 로고, 저장된 대시보드 리스트 버튼, 저장 개수 Number Tag |
| Header | 페이지 제목 `설문조사 분석 대시보드 만들기` |
| Section 1 | 설문조사 제목 입력 |
| Section 2 | 문항 코드북, 응답 데이터셋_숫자형, 응답 데이터셋_라벨형 업로드 카드 |
| CTA | `대시보드 만들기` 버튼 |
| Guide | 코드북/응답 데이터셋 가이드 링크 |
| Footer | copyright |

- 화면 최대 너비는 홈 구현 CSS에서 관리한다.
- 공통 컴포넌트인 Logo, Button-1, Button-2, Number Tag는 `design_system.md` 기준을 따른다.

### 페이지 구조

```text
home.html
├─ head
│  ├─ meta / title
│  ├─ Pretendard 폰트
│  ├─ Material Symbols 폰트
│  └─ dashboard-for-survey.css 연결
│
└─ body.home-page
   ├─ .page
   │  ├─ .top-bar
   │  │  ├─ purple6studio 로고
   │  │  └─ 저장된 대시보드 리스트 버튼
   │  │     └─ 저장 개수 배지
   │  │
   │  ├─ header.header
   │  │  └─ 페이지 제목
   │  │
   │  ├─ main.container
   │  │  ├─ section 1
   │  │  │  ├─ 설문조사 제목 입력
   │  │  │  ├─ 입력 안내
   │  │  │  └─ 제목 에러 메시지
   │  │  │
   │  │  ├─ section 2
   │  │  │  └─ CSV 업로드 3칸
   │  │  │     ├─ 문항 코드북
   │  │  │     ├─ 응답 데이터셋_숫자형
   │  │  │     └─ 응답 데이터셋_라벨형
   │  │  │
   │  │  ├─ 대시보드 만들기 버튼
   │  │  └─ 가이드 배너
   │  │
   │  └─ footer
   │
   ├─ 저장된 대시보드 리스트 모달
   │  ├─ 모달 헤더 / 닫기 버튼
   │  └─ 저장 목록 영역
   │
   └─ script
      ├─ localStorage / IndexedDB 저장 유틸
      ├─ CSV 읽기 / 파싱 / 검증
      ├─ 업로드 UI 처리
      ├─ 대시보드 생성 후 dashboard.html 이동
      └─ 저장 목록 모달 / 이름 변경 / 삭제
```

---

## 컴포넌트 정의

홈 화면 컴포넌트는 별도 JS 컴포넌트 파일로 분리하지 않고 `home.html`의 마크업, `dashboard-for-survey.css`의 `.home-page` 스타일, `home.html` 하단 스크립트가 함께 구성한다.

| 컴포넌트 | HTML 정의 | 스타일 정의 | 동작 정의 |
|----------|-----------|-------------|-----------|
| Top Bar | `.top-bar`, `.top-brand`, `#open-list-btn`, `#saved-count` | `.home-page .top-bar`, 공통 `.list-btn`, `.list-btn .count` | 저장된 대시보드 모달 열기, 저장 개수 갱신 |
| Page Header | `header.header`, `.page-title` | `.home-page .header`, `.home-page .page-title` | 정적 제목 표시 |
| Title Field | `#survey-title`, `#title-error`, `.field-hint` | `.home-page .text-input`, `.home-page .field-hint`, `.home-page .error-text` | 입력 시 오류 해제, CTA 활성 조건 재계산 |
| Upload Card | `.upload-col`, `.drop-zone[data-key]`, `input[type=file]`, `.pick-btn`, `.reselect-btn`, `.dz-error-msg` | `.home-page .drop-zone`, `.drag-over`, `.done`, `.has-error`, `.dz-*` | 파일 선택/드롭, CSV 파싱, 개별 파일 검증, 업로드 상태 표시 |
| 대시보드 만들기 버튼 | `#start-btn.primary-btn` | `.home-page .primary-btn` | 제목과 세 파일이 유효할 때 활성화, 최종 검증 후 저장 및 이동 |
| Guide Banner | `#guide-link.guide-banner` | `.home-page .guide-banner` | 가이드 안내 알림 표시 |
| Saved Dashboard Modal | `#list-modal`, `#saved-list`, `#close-list-btn` | 공통 `.modal-*`, 공통 `.saved-*`, 홈 보정 `.home-page .modal-*` | 모달 열기/닫기, 저장 목록 렌더링 |
| Saved Dashboard Item | `renderList()`에서 `.saved-item`, `.saved-main`, `.saved-title`, `.saved-actions` 동적 생성 | 공통 `.saved-*`, 홈 보정 `.home-page .saved-*` | 항목 열기, 이름 변경, 삭제 |
| Footer | `.footer` | `.home-page .footer` | 정적 copyright 표시 |

관리 기준:

- `home.html`의 class/id는 홈 컴포넌트의 구조 API로 본다.
- `.drag-over`, `.done`, `.has-error`, `.show`, `.error`는 JS가 제어하는 상태 클래스다.
- 저장된 대시보드 항목은 초기 HTML에 고정하지 않고 `renderList()`에서 생성한다.
- 공통 컴포넌트 스타일은 `dashboard-for-survey.css` 앞쪽 공통 영역을 우선 사용하고, 홈 전용 차이는 `.home-page` 범위에서만 보정한다.

---

## 콘텐츠

### 제목 입력

| 항목 | 값 |
|------|----|
| 섹션 제목 | `1. 설문조사 제목을 입력해 주세요` |
| placeholder | `예: 2025 직장인 사무환경 조사` |
| 입력 제한 | 최대 30자 |
| 보조 문구 | `최대 30자까지 입력할 수 있습니다.` |
| 미입력 오류 | `설문조사 제목을 입력해 주세요.` |

### 파일 업로드

| 카드 | 필수 파일 | 허용 형식 |
|------|-----------|-----------|
| 문항 코드북 | 문항 정의 CSV | `.csv` |
| 응답 데이터셋_숫자형 | 숫자 코드 응답 CSV | `.csv` |
| 응답 데이터셋_라벨형 | 라벨 응답 CSV | `.csv` |

업로드 전 안내 문구:

```text
여기에 파일을 드래그하거나,
아래 버튼을 눌러 파일을 선택하세요.
※ CSV 파일만 지원합니다
```

지원하지 않는 파일 형식 오류:

```text
지원하지 않는 파일 형식입니다. .csv 파일만 업로드할 수 있습니다.
```

---

## 상태

### 제목 입력

| 상태 | 조건 | 표시 |
|------|------|------|
| 기본 | 입력 전 또는 정상 입력 | 기본 input |
| Focus | 입력 중 | 포커스 보더 |
| Error | 제목 없이 CTA 클릭 | error 보더, 오류 메시지 노출 |

### 업로드 카드

| 상태 | 조건 | 표시 |
|------|------|------|
| Default | 파일 없음 | 안내 문구와 파일 선택 Button-1 |
| Drag Over | 파일 드래그 중 | 카드 강조 |
| Done | 파일 검증 성공 | `업로드 완료!`, 체크 아이콘, 파일명, 다시 선택하기 |
| Error | 형식 또는 데이터 구조 검증 실패 | error 배경, 오류 메시지 노출 |

---

## 검증

- 세 파일은 모두 CSV여야 한다.
- 코드북은 필수 컬럼을 포함해야 한다.
- 숫자형/라벨형 응답 데이터셋은 응답 데이터 필수 컬럼을 포함해야 한다.
- 코드북과 두 응답 데이터셋의 문항 순서와 이름이 일치해야 한다.
- 숫자형/라벨형 응답 데이터셋의 응답자 행 구조가 일치해야 한다.
- 제목과 세 파일이 모두 유효할 때만 CTA가 활성화된다.

---

## 저장된 대시보드 모달

| 항목 | 동작 |
|------|------|
| 열기 | Top Bar의 저장된 대시보드 리스트 버튼 클릭 |
| 항목 클릭 | 해당 대시보드 열기 |
| 이름 바꾸기 | inline edit, Enter/blur 저장, Esc 취소 |
| 삭제 | 사용자 확인 후 삭제 |
| 닫기 | 닫기 버튼, 모달 외부 클릭, Esc |
| Empty | 저장된 대시보드가 없으면 빈 상태 문구 표시 |

---

## 인터랙션

| 트리거 | 결과 |
|--------|------|
| 제목 입력 | 오류 상태 해제, CTA 활성 조건 재계산 |
| 파일 선택/드랍 | 확장자 확인 → 파일 파싱 → 개별 파일 검증 |
| 세 파일 업로드 완료 | 번들 일관성 검증 |
| 대시보드 만들기 | 저장 후 `dashboard.html` 이동 |
| 저장된 대시보드 리스트 버튼 클릭 | 저장된 대시보드 모달 열기 |
| 모달 닫기 버튼 / 모달 외부 클릭 / Esc | 저장된 대시보드 모달 닫기 |
| 가이드 링크 클릭 | 가이드 안내 알림 표시. 실제 문서 링크는 추후 연결 |
