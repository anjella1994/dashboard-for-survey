# Design System

## Typography

Base font family

- `Pretendard Variable`, `Pretendard`, `Apple SD Gothic Neo`, `Noto Sans KR`, `Malgun Gothic`, `sans-serif`

Web font import

- Use Pretendard as a web font so it renders even on devices without the font installed

```html
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css"
>
```

```css
body {
  font-family: "Pretendard Variable", Pretendard, "Apple SD Gothic Neo",
    "Noto Sans KR", "Malgun Gothic", sans-serif;
}
```

Typeface scale

| Token | Korean Name | Size | Weight |
| --- | --- | ---: | --- |
| `heading-1` | 제목 1 | 28px | Bold |
| `heading-2` | 제목 2 | 24px | Bold |
| `heading-3` | 제목 3 | 20px | Bold |
| `heading-4` | 제목 4 | 18px | Semibold |
| `heading-5` | 제목 5 | 16px | Semibold |
| `heading-6` | 제목 6 | 14px | Semibold |
| `body-1` | 본문 1 | 18px | Medium |
| `body-2` | 본문 2 | 16px | Regular |
| `body-3` | 본문 3 | 14px | Regular |
| `label-1` | 라벨 1 | 14px | Semibold |
| `label-2` | 라벨 2 | 14px | Regular |
| `button-1` | 버튼 1 | 14px | Medium |
| `button-2` | 버튼 2 | 12px | Medium |
| `caption-1` | 캡션 1 | 12px | Regular |

## Usage Guide

- `heading-1`: 페이지의 가장 큰 대표 제목
- `heading-2`: 섹션 대표 제목, 주요 화면 제목
- `heading-3`: 카드/그룹 제목
- `heading-4`: 보조 제목, 모달 제목, 작은 섹션 제목
- `heading-5`: 업로드 카드 제목, 작은 강조 제목
- `heading-6`: 아주 작은 강조 제목, 보조 섹션 제목
- `body-1`: 강조가 필요한 본문
- `body-2`: 기본 본문 텍스트
- `body-3`: 보조 본문, 메타 정보
- `label-1`: 강조형 라벨
- `label-2`: 일반 라벨
- `button-1`: 기본 버튼 텍스트
- `button-2`: 작은 버튼 텍스트
- `caption-1`: 주석, 설명, 보조 안내 문구

## Suggested CSS Tokens

```css
:root {
  --font-family-base: "Pretendard Variable", Pretendard, "Apple SD Gothic Neo",
    "Noto Sans KR", "Malgun Gothic", sans-serif;

  --heading-1-size: 28px;
  --heading-2-size: 24px;
  --heading-3-size: 20px;
  --heading-4-size: 18px;
  --heading-5-size: 16px;
  --heading-6-size: 14px;

  --body-1-size: 18px;
  --body-2-size: 16px;
  --body-3-size: 14px;

  --label-1-size: 14px;
  --label-2-size: 14px;

  --button-1-size: 14px;
  --button-2-size: 12px;

  --caption-1-size: 12px;

  --font-weight-bold: 700;
  --font-weight-semibold: 600;
  --font-weight-medium: 500;
  --font-weight-regular: 400;
}
```

## Notes

- `heading-4` and `label-1` use `Semibold`
- `heading-5` and `heading-6` use `Semibold`
- `body-1` uses `Medium`
- `button-1` and `button-2` use `Medium`
- Most interface copy should default to `body-2`
