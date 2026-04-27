# Home 화면 디자인 스펙 (Figma → home.html)

> 참조: Figma `component_home` 프레임 (node-id: 85-3817)  
> 폰트: Pretendard / 배경: White (#FFFFFF)

---

## 컬러 토큰 (Figma Variables)

> 이 색상만 사용. 임의 hex 값 사용 금지.

### Neutral

| 변수명 | 값 | 주요 용도 |
|--------|----|-----------|
| `Black` | `#000000` | 버튼 배경, 체크 아이콘, 포커스 보더, 배지 bg |
| `neutral-900` | `#151515` | 주요 텍스트, 제목, 레이블 |
| `neutral-800` | `#363636` | 보조 텍스트, hover 텍스트 |
| `neutral-700` | `#525252` | — |
| `neutral-600` | `#777777` | hint, placeholder, 메타 텍스트, 파일명 |
| `neutral-500` | `#919191` | — |
| `neutral-400` | `#AFAFAF` | disabled 텍스트 |
| `neutral-300` | `#CCCCCC` | disabled 버튼 배경, dashed 보더 |
| `neutral-200` | `#E3E3E3` | 기본 보더 (solid) |
| `neutral-100` | `#F1F1F1` | hover 강조 bg |
| `neutral-50` | `#F8F8F8` | soft bg, 가이드 배너, hover bg |
| `White` | `#FFFFFF` | 카드 배경, 인풋 배경, 버튼 텍스트 |

### 데이터 시각화 (대시보드 전용, home 화면 미사용)

| 변수명 | 값 |
|--------|----|
| `color-1` | `#577A9A` |
| `color-2` | `#C67B7B` |
| `color-3` | `#6E9A78` |
| `color-4` | `#9A82BC` |
| `color-5` | `#B89A62` |
| `color-6` | `#5E9898` |
| `color-7` | `#BC8098` |
| `color-8` | `#62906E` |
| `color-9` | `#8284BC` |
| `color-10` | `#A8924E` |
| `color-11` | `#5E88A8` |
| `color-12` | `#A87CB0` |
| `color-13` | `#82986A` |
| `color-14` | `#7A7AB8` |
| `color-15` | `#B88868` |
| `color-16` | `#5A9488` |
| `color-17` | `#B07A9A` |
| `color-18` | `#C08878` |
| `color-19` | `#6A9880` |
| `color-20` | `#7A9870` |
| `high-4` | `#859DB2` |
| `high-3` | `#9EAFBF` |
| `high-2` | `#B1BEC9` |
| `low-4` | `#CF9D9D` |
| `low-3` | `#D4AEAE` |
| `low-2` | `#DAC3C3` |

---

## 전체 레이아웃

```
┌────────────────────────────────────┐
│ [top-bar]  로고         리스트 버튼│
│                                    │
│ [header]   설문조사 분석 대시보드 만들기 (H1)      │
│                                    │
│ [container]                        │
│  Section 1: 설문조사 제목 입력     │
│    └─ input-home                   │
│                                    │
│  Section 2: 파일 업로드            │
│    └─ card-home × 3               │
│                                    │
│  button-home (대시보드 만들기)     │
│  guide banner                      │
├────────────────────────────────────┤
│ [footer]                           │
└────────────────────────────────────┘
```

- 최대 너비: `840px`, 가운데 정렬
- 배경: `White (#FFFFFF)`

---

## 컴포넌트 상세 스펙

---

### 1. `button-1` — 다시 선택하기 / 저장된 대시보드 리스트

상단 우측과 upload card 완료 상태에서 사용되는 아웃라인 버튼.

#### Variants

| 상태 | 배경 | 텍스트 색 | 보더 |
|------|------|-----------|------|
| Default | `White` | `neutral-900` | `1px solid neutral-300` |
| Focus | `White` | `neutral-900` | `1px solid neutral-900` |
| Black | `neutral-900` | `White (#FFFFFF)` | 없음 |
| Gray | `neutral-100` | `neutral-900` | `1px solid neutral-300` |

#### 스타일

```css
display: inline-flex;
align-items: center;
gap: 4px;
padding: 7px 14px;
border-radius: 8px;
font-size: 14px;       /* button-1 */
font-weight: 500;
line-height: 1.6;
```

#### 아이콘 + 카운트 뱃지 (리스트 버튼 전용)

```html
<button class="list-btn">
  <img class="icon" ...>
  저장된 대시보드 리스트
  <span class="count">3</span>
</button>
```

- count badge: `background: neutral-900`, `color: White`, `border-radius: 999px`, `height: 18px`, `padding: 0 6px`, `font-size: 12px`, `font-weight: 600`

---

### 2. `button-2` — 이름 바꾸기 (Modal 내)

저장 목록 모달의 각 항목 우측에 위치하는 소형 액션 버튼.

#### Variants

| 상태 | 배경 | 텍스트 색 | 보더 |
|------|------|-----------|------|
| Default | `White` | `neutral-600 (#777777)` | `1px solid neutral-200 (#E3E3E3)` |
| Hover | `White` | `Black (#000000)` | `1px solid Black (#000000)` |
| Active | `Black (#000000)` | `White` | 없음 |

#### 스타일

```css
display: inline-flex;
align-items: center;
gap: 6px;
padding: 6px 10px;
border-radius: 10px;
font-size: 12px;       /* button-2 */
font-weight: 500;
```

---

### 3. `input-home` — 설문조사 제목 입력

Section 1에서 사용하는 텍스트 인풋.

#### States

| 상태 | 보더 | 설명 |
|------|------|------|
| Placeholder | `1px solid neutral-200 (#E3E3E3)` | placeholder: `예: 2025 직장인 사무환경 조사` |
| Typing (Focus) | `1px solid Black (#000000)` | 검정 보더, cursor 표시 |
| Filled | `1px solid neutral-200 (#E3E3E3)` | 입력 완료 |
| Error | `1px solid low-4 (#CF9D9D)` | 제목 미입력 제출 시 |

#### 스타일

```css
width: 100%;
padding: 15px 20px;
border-radius: 14px;
font-size: 16px;       /* body-2 */
font-weight: 400;
line-height: 1.6;
background: White (#FFFFFF);
color: neutral-900 (#151515);
transition: border-color 0.15s;
```

- placeholder 색: `neutral-600 (#777777)`
- focus 시 `box-shadow: none`
- 하단 hint: `"최대 30자까지 입력할 수 있습니다."` — `12px`, `neutral-600 (#777777)`

---

### 4. `list item_saved modal` — 저장된 대시보드 항목

저장 목록 모달 안의 각 항목 행.

#### 구조

```
┌───────────────────────────────────────────────┐
│ [saved-main]              [saved-actions]      │
│  설문조사 제목 (bold 14px)  [이름 바꾸기] [삭제]│
│  저장일 0000-00-00 00:00  (neutral-600 12px)  │
└───────────────────────────────────────────────┘
```

#### 스타일

```css
display: flex;
align-items: center;
gap: 12px;
padding: 14px 12px;
border-radius: 10px;

/* hover */
background: neutral-50 (#F8F8F8);
```

- **제목**: `14px`, `font-weight: 700`, `color: neutral-900 (#151515)`, 말줄임 처리
- **저장일**: `12px`, `color: neutral-600 (#777777)`
- **이름 바꾸기 버튼**: `button-2` 스타일 동일
- **삭제 버튼**: hover 시 `color: low-4 (#CF9D9D)`, `border-color: low-4 (#CF9D9D)`
- **이름 편집 input**: `border: 1px solid Black (#000000)`, `border-radius: 10px`, `padding: 4px 8px`, enter/blur 저장, esc 취소

---

### 5. `card-home` — 파일 업로드 카드

Section 2의 파일 업로드 카드. 3개 나란히 배치 (grid 3열).

**카드 레이블 (3종)**
1. `문항 코드북`
2. `응답 데이터셋_숫자형`
3. `응답 데이터셋_라벨형`

#### State A — 업로드 전 (Default)

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   ← dashed (neutral-300)
│   여기에 파일을 드래그하거나,│
│   아래 버튼을 눌러 파일을   │
│   선택하세요.               │
│   [ .csv · .xlsx ]         │
│   ┌──────────────────┐     │
│   │  ↑  파일 선택    │     │
│   └──────────────────┘     │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

```css
border: 1.5px dashed neutral-300 (#CCCCCC);
border-radius: 14px;
padding: 24px 14px;
min-height: 192px;
background: White (#FFFFFF);
```

- drag-over 시: `border-color: Black (#000000)`, `background: neutral-50 (#F8F8F8)`
- hint 텍스트: `14px`, `font-weight: 500`, `color: neutral-600 (#777777)`
- formats: `12px`, `color: neutral-600 (#777777)`
- pick-btn: `background: Black (#000000)`, `color: White`, `border-radius: 999px`, `padding: 9px 16px`, `font-size: 14px`

#### State B — 업로드 완료 (Done)

```
┌───────────────────────────┐   ← solid (neutral-200)
│   업로드 완료!             │
│      ✓                    │   ← 검정 원형 체크 아이콘
│   파일이름.csv             │
│   ┌──────────────────┐    │
│   │ ↺ 다시 선택하기  │    │
│   └──────────────────┘    │
└───────────────────────────┘
```

```css
border: 1px solid neutral-200 (#E3E3E3);
background: White (#FFFFFF);
padding: 18px 14px 16px;
```

- "업로드 완료!": `16px`, `font-weight: 700`, `color: neutral-900 (#151515)`
- check-icon: `28px`, `border-radius: 50%`, `background: Black (#000000)`
- 파일명: `14px`, `color: neutral-600 (#777777)`
- reselect-btn: `border: 1px solid neutral-200 (#E3E3E3)`, `border-radius: 999px`, `padding: 6px 12px`, `12px`, hover 시 `border-color: Black (#000000)`

#### State C — 오류 (Error)

```css
border-color: low-4 (#CF9D9D);   /* 에러 보더 */
background: low-2 (#DAC3C3);     /* 에러 배경 */
```

- 오류 메시지: `12px`, `color: low-4 (#CF9D9D)`, 카드 하단 표시

---

### 6. `button-home` — 대시보드 만들기 (CTA)

전체 너비의 주요 액션 버튼.

#### Variants

| 상태 | 배경 | 텍스트 색 | cursor |
|------|------|-----------|--------|
| Disabled | `neutral-300 (#CCCCCC)` | `White (#FFFFFF)` | `not-allowed` |
| Active | `Black (#000000)` | `White (#FFFFFF)` | `pointer` |
| Hover | `neutral-900 (#151515)` | `White (#FFFFFF)` | `pointer` |

```css
display: block;
width: 100%;
height: 54px;
padding: 16px 22px;
border-radius: 12px;
font-size: 16px;       /* heading-5 */
font-weight: 700;
letter-spacing: -0.01em;
margin-top: 28px;
transition: background 0.15s;
```

- 활성 조건: 제목 입력 + 3개 파일 모두 업로드 완료

---

## 모달 — 저장된 대시보드 리스트

```css
/* backdrop */
position: fixed;
inset: 0;
background: rgba(0, 0, 0, 0.35);
backdrop-filter: blur(2px);

/* modal */
width: 100%;
max-width: 560px;
max-height: 80vh;
border-radius: 18px;
box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
```

- 헤더 텍스트: `"저장된 대시보드 리스트"`, `18px`, `font-weight: 600`, `color: neutral-900 (#151515)`
- 구분선: `neutral-200 (#E3E3E3)`
- 닫기 버튼: X 아이콘, `28×28`, 원형, hover bg `neutral-50 (#F8F8F8)`
- body: 스크롤 가능, 항목 없을 때 empty state (`neutral-600`, `14px`)

---

## 타이포그래피 토큰

| 토큰 | 크기 | 굵기 | line-height | 용도 |
|------|------|------|-------------|------|
| Heading-1 | 28px | Bold (700) | 120% | 페이지 제목 |
| Heading-4 | 18px | Bold (700) | 120% | 섹션 제목, 모달 제목 |
| Heading-5 | 16px | Semibold (600) | 120% | 카드 레이블, CTA 버튼, done 텍스트 |
| Heading-6 | 14px | Semibold (600) | 120% | 저장 항목 제목 |
| Body-2 | 16px | Medium (500) | 160% | 인풋 텍스트 |
| Body-3 | 14px | Medium (500) | 160% | hint, 파일명, 저장일 |
| Label-1 | 14px | Regular (400) | 160% | 가이드 링크 |
| Button-1 | 14px | Regular (400) | 160% | 아웃라인 버튼 |
| Button-2 | 12px | Regular (400) | 160% | 소형 버튼 |
| Caption-1 | 12px | Regular (400) | 160% | hint, 오류 메시지 |

---

## 인터랙션 요약

| 트리거 | 동작 |
|--------|------|
| 제목 입력 | CTA 활성 조건 충족 |
| 파일 드래그 | drop-zone drag-over 상태 |
| 파일 선택/드랍 | 유효성 검증 → done or error 상태 |
| 다시 선택하기 | file input 재클릭 |
| 대시보드 만들기 | 유효성 최종 검증 → dashboard.html 이동 |
| 저장된 대시보드 리스트 | 모달 열기 |
| 모달 항목 클릭 | 해당 대시보드 열기 |
| 이름 바꾸기 | inline edit 모드 |
| 삭제 | confirm → 삭제 |

---

## 현재 home.html과의 차이점 (검토 필요)

| 항목 | 현재 HTML | Figma 변수 기반 |
|------|-----------|----------------|
| `--black` | `#0A0A0A` | `Black (#000000)` |
| `--text` | `#1A1A1A` | `neutral-900 (#151515)` |
| `--text-2` | `#4A4A4A` | `neutral-800 (#363636)` |
| `--border` | `#E5E5E5` | `neutral-200 (#E3E3E3)` |
| `--border-dashed` | `#D4D4D4` | `neutral-300 (#CCCCCC)` |
| `--bg-soft` | `#F6F6F6` | `neutral-50 (#F8F8F8)` |
| `--bg-soft-2` | `#F0F0F0` | `neutral-100 (#F1F1F1)` |
| `--red` | `#E14B4B` | `low-4 (#CF9D9D)` ← 에러 보더/텍스트로 확정 |
| `--red-bg` | `#FFF3F3` | `low-2 (#DAC3C3)` ← 에러 배경으로 확정 |
| 섹션2 제목 | `문항 코드북과 응답 데이터셋을 업로드해 주세요` | 재확인 필요 |
