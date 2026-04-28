# Design System

> 폰트: Pretendard / 모든 색상은 아래 Figma Variables만 사용. 임의 hex 값 사용 금지.
> 이 문서는 공통 토큰과 재사용 컴포넌트만 정의한다. 화면별 레이아웃, 간격, 상태별 세부 CSS는 각 화면 구현 파일과 화면 스펙 문서에서 관리한다.

---

## Typography

### Base Font

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
```

```css
font-family: "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
```

### Typeface Scale

| Token | Korean | Size | Weight |
|-------|--------|-----:|--------|
| `Heading-1` | 제목 1 | 28px | Bold (700) |
| `Heading-2` | 제목 2 | 24px | Bold (700) |
| `Heading-3` | 제목 3 | 20px | Bold (700) |
| `Heading-4` | 제목 4 | 18px | Bold (700) |
| `Heading-5` | 제목 5 | 16px | Semibold (600) |
| `Heading-6` | 제목 6 | 14px | Semibold (600) |
| `Body-1` | 본문 1 | 18px | Medium (500) |
| `Body-2` | 본문 2 | 16px | Medium (500) |
| `Body-3` | 본문 3 | 14px | Medium (500) |
| `Label-1` | 라벨 1 | 14px | Regular (400) |
| `Label-1-strong` | 라벨 1 강조 | 14px | Semibold (600) |
| `Label-2` | 라벨 2 | 12px | Regular (400) |
| `Label-2-strong` | 라벨 2 강조 | 12px | Semibold (600) |
| `Button-1` | 버튼 1 | 14px | Regular (400) |
| `Button-1-strong` | 버튼 1 강조 | 14px | Semibold (600) |
| `Button-2` | 버튼 2 | 12px | Regular (400) |
| `Button-2-strong` | 버튼 2 강조 | 12px | Semibold (600) |
| `Caption-1` | 캡션 1 | 12px | Regular (400) |

- Line-height: Heading `120%` / 나머지 `160%`

### Usage

| Token | 용도 |
|-------|------|
| `Heading-1` | 페이지 대표 제목 |
| `Heading-2` | 섹션 대표 제목 |
| `Heading-3` | 카드/그룹 제목 |
| `Heading-4` | 보조 제목, 모달 제목 |
| `Heading-5` | 카드 레이블, 작은 강조 제목 |
| `Heading-6` | 아주 작은 강조 제목 |
| `Body-1` | 강조가 필요한 본문 |
| `Body-2` | 기본 본문 (인풋 텍스트 등) |
| `Body-3` | 보조 본문, 메타 정보, hint |
| `Label-1` | 라벨, 가이드 링크 |
| `Label-1-strong` | 강조 라벨 |
| `Label-2` | 보조 라벨 |
| `Label-2-strong` | 강조 보조 라벨 |
| `Button-1` | 기본 버튼 텍스트 (Default, Gray) |
| `Button-1-strong` | 강조 버튼 텍스트 (Focus, Black) |
| `Button-2` | 소형 버튼 텍스트 |
| `Button-2-strong` | 강조 소형 버튼 텍스트 |
| `Caption-1` | 주석, 설명, 보조 안내, 오류 메시지 |

### CSS Tokens

```css
:root {
  --heading-1-size: 28px;
  --heading-2-size: 24px;
  --heading-3-size: 20px;
  --heading-4-size: 18px;
  --heading-5-size: 16px;
  --heading-6-size: 14px;
  --body-1-size: 18px;
  --body-2-size: 16px;
  --body-3-size: 14px;
  --label-1-size: 14px;      /* Regular */
  --label-1-strong: 600;     /* Semibold */
  --label-2-size: 12px;      /* Regular */
  --label-2-strong: 600;     /* Semibold */
  --button-1-size: 14px;     /* Regular */
  --button-1-strong: 600;    /* Semibold — Focus, Black variant */
  --button-2-size: 12px;     /* Regular */
  --button-2-strong: 600;    /* Semibold */
  --caption-1-size: 12px;

  --heading-line-height: 1.2;
  --body-line-height: 1.6;

  --font-weight-bold: 700;
  --font-weight-semibold: 600;
  --font-weight-medium: 500;
  --font-weight-regular: 400;
}
```

---

## Common Components

### Logo

| 항목 | 기준 |
|------|------|
| 자산 | `assets/purple6studio_한줄_black.png` |
| 사용 위치 | 홈 상단, 대시보드 헤더 |
| 표시 규칙 | 로고 이미지는 왜곡 없이 표시하고, 링크 또는 브랜드 영역 자체의 텍스트 장식은 제거한다. |

### Button-1

주요 화면 액션과 헤더 유틸리티에 쓰는 기본 버튼이다. 아이콘을 함께 쓸 수 있고, 필요하면 숫자 태그를 오른쪽에 붙인다.

| Variant | 용도 | 배경 | 텍스트 | 보더 | 굵기 |
|---------|------|------|--------|------|------|
| Default | 보조 액션, 리스트 버튼 | `White` | `neutral-900` | `neutral-300` | Medium |
| Focus | 선택 또는 강조된 보조 액션 | `White` | `neutral-900` | `neutral-900` | Semibold |
| Black | 주요 소형 액션 | `neutral-900` | `White` | 없음 | Semibold |
| Gray | 약한 배경 강조 액션 | `neutral-100` | `neutral-900` | `neutral-300` | Medium |

- 타입 토큰: `Button-1` / `Button-1-strong`
- 아이콘이 있을 때는 텍스트 앞에 둔다.
- 호버는 variant의 의미를 유지하면서 보더 또는 배경 대비만 높인다.

### Button-2

목록, 모달, 반복 항목 안의 작은 액션 버튼이다.

| Variant | 용도 | 배경 | 텍스트 | 보더 |
|---------|------|------|--------|------|
| Default | 이름 바꾸기, 교체하기 같은 일반 액션 | `White` | `neutral-600` | `neutral-200` |
| Hover | 일반 액션 hover | `White` | `Black` | `Black` |
| Delete Hover | 삭제 액션 hover | `White` | `low-4` | `low-4` |
| Active | 확정 또는 선택 상태 | `Black` | `White` | 없음 |

- 타입 토큰: `Button-2` / `Button-2-strong`
- 삭제처럼 위험도가 있는 액션은 hover에서만 error 계열을 사용한다.

### Checkbox

필터, 범례, 표시/숨김 설정처럼 다중 선택 또는 토글성 선택에 사용한다.

| 상태 | 기준 |
|------|------|
| Default | 네이티브 checkbox 사용 |
| Checked | `Black` 또는 해당 화면의 주 텍스트 색을 accent color로 사용 |
| Disabled/비활성 | 텍스트와 보조 마커를 흐리게 표시 |

- 체크박스 자체보다 라벨 전체를 클릭 영역으로 사용하는 것을 기본으로 한다.
- 범례와 연결된 체크박스는 색상 swatch와 함께 표시한다.

### Number Tag

개수, 선택 수, 필터 선택 수처럼 짧은 숫자를 보여주는 pill 태그다.

| 항목 | 기준 |
|------|------|
| 배경 | `Black` 또는 `neutral-900` |
| 텍스트 | `White`, `Label-2-strong` |
| 형태 | pill radius, 최소 너비를 보장 |
| 사용 예 | 저장된 대시보드 개수, 필터 선택 개수 |

- 숫자만 단독으로 보여주고, 단위가 필요하면 태그 바깥의 라벨에서 설명한다.
- 값이 0이어도 맥락상 필요한 경우에는 표시한다.

---

## Color

> Figma Variables 기준. 이 목록에 없는 색상 사용 금지.

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

### Error

| 변수명 | 값 | 용도 |
|--------|----|------|
| `error-bg` | `#FFEBEE` | 오류 상태 카드 배경 |
| `error-text` | `#D32F2F` | 오류 메시지 텍스트 |
| `low-4` | `#CF9D9D` | 에러 보더, 삭제 hover |
| `low-3` | `#D4AEAE` | — |
| `low-2` | `#DAC3C3` | 보조 에러 배경 |

### Data Visualization (대시보드 전용)

| 변수명 | 값 | 변수명 | 값 |
|--------|----|--------|----|
| `color-1` | `#577A9A` | `color-11` | `#5E88A8` |
| `color-2` | `#C67B7B` | `color-12` | `#A87CB0` |
| `color-3` | `#6E9A78` | `color-13` | `#82986A` |
| `color-4` | `#9A82BC` | `color-14` | `#7A7AB8` |
| `color-5` | `#B89A62` | `color-15` | `#B88868` |
| `color-6` | `#5E9898` | `color-16` | `#5A9488` |
| `color-7` | `#BC8098` | `color-17` | `#B07A9A` |
| `color-8` | `#62906E` | `color-18` | `#C08878` |
| `color-9` | `#8284BC` | `color-19` | `#6A9880` |
| `color-10` | `#A8924E` | `color-20` | `#7A9870` |
| `high-4` | `#859DB2` | `low-4` | `#CF9D9D` |
| `high-3` | `#9EAFBF` | `low-3` | `#D4AEAE` |
| `high-2` | `#B1BEC9` | `low-2` | `#DAC3C3` |

### CSS Tokens

```css
:root {
  /* neutral */
  --Black: #000000;
  --White: #ffffff;
  --neutral-900: #151515;
  --neutral-800: #363636;
  --neutral-700: #525252;
  --neutral-600: #777777;
  --neutral-500: #919191;
  --neutral-400: #afafaf;
  --neutral-300: #cccccc;
  --neutral-200: #e3e3e3;
  --neutral-100: #f1f1f1;
  --neutral-50:  #f8f8f8;

  /* error */
  --error-bg: #ffebee;
  --error-text: #d32f2f;
  --low-4: #cf9d9d;
  --low-3: #d4aeae;
  --low-2: #dac3c3;

  /* data visualization */
  --color-1: #577a9a;  --color-11: #5e88a8;
  --color-2: #c67b7b;  --color-12: #a87cb0;
  --color-3: #6e9a78;  --color-13: #82986a;
  --color-4: #9a82bc;  --color-14: #7a7ab8;
  --color-5: #b89a62;  --color-15: #b88868;
  --color-6: #5e9898;  --color-16: #5a9488;
  --color-7: #bc8098;  --color-17: #b07a9a;
  --color-8: #62906e;  --color-18: #c08878;
  --color-9: #8284bc;  --color-19: #6a9880;
  --color-10: #a8924e; --color-20: #7a9870;
  --high-4: #859db2;   --low-4: #cf9d9d;
  --high-3: #9eafbf;   --low-3: #d4aeae;
  --high-2: #b1bec9;   --low-2: #dac3c3;
}
```
