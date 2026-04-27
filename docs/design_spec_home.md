# Home 화면 디자인 스펙 (Figma → home.html)

> 참조: Figma `home` 프레임 (node-id: 85-3817)  
> 컬러 토큰 및 타이포그래피 토큰은 [design_system.md](design_system.md) 참조.  
> 아이콘은 `assets/icons/` 경로 참조.

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
│    └─ input-title                  │
│                                    │
│  Section 2: 파일 업로드            │
│    └─ card-home × 3               │
│                                    │
│  button-home (대시보드 만들기)     │
│  guide banner                      │
│                                    │
│ [footer]                           │
└────────────────────────────────────┘
```

- 최대 너비: `840px`, 가운데 정렬
- 배경: `White (#FFFFFF)`

---

## 컴포넌트 상세 스펙

---

### 1. `button-1` — 저장된 대시보드 리스트 버튼

상단 우측에 위치하는 아웃라인 버튼.

#### Variants

| Variant | 배경 | 텍스트 색 | 보더 | 굵기 |
|---------|------|-----------|------|------|
| Default | `White` | `neutral-900` | `1px solid neutral-300` | Regular |
| Focus | `White` | `neutral-900` | `1px solid neutral-900` | Semibold |
| Black | `neutral-900` | `White` | 없음 | Semibold |
| Gray | `neutral-100` | `neutral-900` | `1px solid neutral-300` | Regular |

#### 스타일

```css
display: inline-flex;
align-items: center;
gap: 4px;
padding: 7px 14px;
border-radius: 8px;
font-size: 14px;       /* Button-1 */
line-height: 1.6;
```

#### 아이콘 + 카운트 뱃지

- 아이콘: `assets/icons/list_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.png`
- count badge: `background: neutral-900`, `color: White`, `border-radius: 999px`, `height: 18px`, `padding: 0 6px`, `font-size: 12px`, `font-weight: 600`

---

### 2. `button-2` — 이름 바꾸기 / 삭제 (Modal_Saved 내)

저장 목록 모달의 각 항목 우측 액션 버튼.

#### Variants

| Variant | 배경 | 텍스트 색 | 보더 |
|---------|------|-----------|------|
| Default | `White` | `neutral-600` | `1px solid neutral-200` |
| Hover | `White` | `Black` | `1px solid Black` |
| Active (Black) | `Black` | `White` | 없음 |

- 삭제 버튼 Hover 시: `color: low-4`, `border-color: low-4`

#### 스타일

```css
display: inline-flex;
align-items: center;
gap: 6px;
padding: 6px 10px;
border-radius: 10px;
font-size: 12px;       /* Button-2 */
font-weight: 400;      /* Regular — Button-2 */
```

---

### 3. `input-title` — 설문조사 제목 입력

Section 1 텍스트 인풋.

#### States

| State | 보더 | 설명 |
|-------|------|------|
| Placeholder | `1px solid neutral-200` | placeholder: `예: 2025 직장인 사무환경 조사` |
| Typing | `1px solid Black` | focus, cursor 표시 |
| Filled | `1px solid neutral-200` | 입력 완료 |
| Error | `1px solid low-4` | 제목 미입력 제출 시 |

#### 스타일

```css
width: 100%;
padding: 15px 20px;
border-radius: 14px;
font-size: 16px;       /* Body-2 */
font-weight: 500;      /* Medium */
line-height: 1.6;
background: White;
color: neutral-900;
transition: border-color 0.15s;
```

- placeholder 색: `neutral-600`
- focus 시 `outline: none`, `box-shadow: none`
- 하단 hint: `"최대 30자까지 입력할 수 있습니다."` — Caption-1, `neutral-600`

---

### 4. `item_saved` — 저장된 대시보드 항목 (Modal_Saved 내)

#### 구조

```
┌───────────────────────────────────────────────┐
│ [saved-main]              [saved-actions]      │
│  설문조사 제목              [이름 바꾸기] [삭제] │
│  저장일 0000-00-00 00:00                       │
└───────────────────────────────────────────────┘
```

#### 스타일

```css
display: flex;
align-items: center;
gap: 12px;
padding: 14px 12px;
border-radius: 10px;
transition: background 0.15s;

/* hover */
background: neutral-50;
```

- **제목**: Heading-6 (Semibold), `neutral-900`, 말줄임 처리
- **저장일**: Caption-1 (Regular), `neutral-600`
- **버튼**: `button-2` 컴포넌트
- **이름 편집 input**: `border: 1px solid Black`, `border-radius: 10px`, `padding: 4px 8px`, enter/blur 저장, esc 취소

---

### 5. `card-home` — 파일 업로드 카드

Section 2. 3개 나란히 배치 (grid 3열).

**카드 레이블 (3종)**
1. `문항 코드북`
2. `응답 데이터셋_숫자형`
3. `응답 데이터셋_라벨형`

#### State A — Default (업로드 전)

```css
border: 1.5px dashed neutral-300;
border-radius: 14px;
padding: 24px 14px;
min-height: 192px;
background: White;
```

- drag-over: `border-color: Black`, `background: neutral-50`
- hint 텍스트: Body-3 (Medium), `neutral-600`
- formats `[ .csv · .xlsx ]`: Caption-1, `neutral-600`
- **pick-btn**:  button-1의 Variant 중 Black

#### State B — Done (업로드 완료)

```css
border: 1px solid neutral-200;
background: White;
padding: 18px 14px 16px;
```

- "업로드 완료!": Heading-5 (Semibold), `neutral-900`
- **check-icon**: `width: 28px`, `height: 28px`, `border-radius: 50%`, `background: Black`
  - 아이콘: SVG checkmark (현재 inline SVG 사용, `assets/icons/`에 없음)
- 파일명: Body-3 (Medium), `neutral-600`
- **reselect-btn** (다시 선택하기): button-1의 Variant 중 Default
  - 아이콘: SVG rotate (현재 inline SVG 사용)

#### State C — Error

```css
border-color: low-4;
background: low-2;
```

- 오류 메시지: Caption-1, `low-4`, 카드 하단 표시

---

### 6. `button-home` — 대시보드 만들기 (CTA)

#### Variants

| Variant | 배경 | 텍스트 색 | cursor |
|---------|------|-----------|--------|
| Disabled | `neutral-300` | `White` | `not-allowed` |
| Default (Active) | `Black` | `White` | `pointer` |
| Hover | `neutral-900` | `White` | `pointer` |

```css
display: block;
width: 100%;
height: 54px;
padding: 16px 22px;
border-radius: 12px;
font-size: 16px;       /* Heading-5 */
font-weight: 600;      /* Semibold */
letter-spacing: -0.01em;
margin-top: 28px;
transition: background 0.15s;
```

- 활성 조건: 제목 입력 + 3개 파일 모두 업로드 완료

---

## Modal_Saved — 저장된 대시보드 리스트

```css
/* backdrop */
position: fixed;
inset: 0;
background: rgba(0, 0, 0, 0.35);
backdrop-filter: blur(2px);

/* modal */
width: 560px;
border-radius: 16px;
background: White;
display: flex;
flex-direction: column;
```

- **헤더**: `"저장된 대시보드 리스트"` — Heading-5 (Semibold), `neutral-900`
- **헤더 하단 구분선**: `neutral-200`
- **닫기 버튼 (×)**: `26×26`, 원형, `neutral-600`, hover bg `neutral-50`
- **항목**: `item_saved` 컴포넌트 반복
- **empty state**: `neutral-600`, Body-3
- body 영역: 스크롤 가능

---

## 인터랙션 요약

| 트리거 | 동작 |
|--------|------|
| 제목 입력 | CTA 활성 조건 충족 |
| 파일 드래그 | card-home drag-over 상태 |
| 파일 선택/드랍 | 유효성 검증 → Done or Error 상태 |
| 다시 선택하기 | file input 재클릭 |
| 대시보드 만들기 | 유효성 최종 검증 → dashboard.html 이동 |
| 저장된 대시보드 리스트 버튼 | Modal_Saved 열기 |
| 모달 항목 클릭 | 해당 대시보드 열기 |
| 이름 바꾸기 | inline edit 모드 |
| 삭제 | confirm → 삭제 |
| 모달 외부 클릭 / ESC | 모달 닫기 |
