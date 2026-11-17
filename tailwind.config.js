/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // 반응형 중단점 — **디자인 시스템 캔버스가 정한 값**이다(390 · 834 · 1440).
      // Tailwind 기본(sm 640 · md 768 · lg 1024)과 하나도 안 맞아서, 기본만 쓰면
      // 폰과 태블릿의 경계가 디자인과 어긋난다. 기본값은 **지우지 않고 더한다** —
      // 지우면 지금 md:를 쓰는 13곳이 그 자리에서 깨진다(ScheduledBroadcast 등).
      // 새 화면과 옮기는 화면은 아래 이름을 쓴다:
      //   phone   390  — 폰 세로                   (iPhone 14/15)
      //     ⚠ **`phone:`은 "폰에서"가 아니라 "390 이상 전부"다.** 모바일 우선이라 모든
      //       접두사가 min-width이고, `phone:grid-cols-1`이라고 쓰면 PC에도 걸린다.
      //       **폰의 모습은 접두사 없이 쓴다** — 그게 기본 구간이다. 그래서 빌드된 CSS에
      //       390 미디어쿼리가 없는 것이 정상이고, 실질 계단은 834·1024·1440 셋이다.
      //       (2026-09-04: 표를 "phone 390 — 1열"로 적었더니 "폰에서 1열"로 읽혀 오해를 샀다.
      //        지금 `phone:` 사용처는 0곳이라 아직 안 드러났을 뿐이다.)
      //   tablet  834  — 세로로 쌓기               (iPad Pro 11" 세로 — 캔버스가 고른 실기 폭)
      //   laptop 1024  — 넓어진 세로 쌓기           (iPad Pro 12.9" 세로 · 가로 태블릿 · 작은 노트북)
      //   wide   1440  — 두 판                     (데스크톱)
      //
      // **1024는 2026-09-04에 더했다.** 캔버스는 셋(390·834·1440)만 정했는데, 834 다음이
      // 바로 1440이라 그 사이 600px가 통째로 "그냥 늘어나는" 구간이었다 — 사용자가 실제로
      // 그 폭(약 1000px)에서 화면이 늘어지는 것을 보고 지적했다. 1024는 표준 사다리
      // (480·768·1024·1280·1536)에서도, 실제 기기(iPad Pro 12.9" 세로 1024×1366)에서도
      // 같은 자리다. **캔버스에는 아직 이 칸이 없다** — 다음에 캔버스를 고칠 때 함께 넣어야
      // 둘이 갈라지지 않는다.
      //
      // 늘어짐을 막는 것은 중단점만으로 안 된다. 화면은 **최대 폭**도 함께 정한다
      // (SimpleMode: 세로로 쌓는 동안 834로 묶고, wide에서 1440까지 편다).
      screens: {
        phone:  '390px',
        tablet: '834px',
        laptop: '1024px',
        wide:   '1440px',
      },
      colors: {
        cc: {
          bg:      '#F4F6FB', // 전체 배경
          card:    '#FFFFFF', // 카드 배경
          border:  '#E8ECF4', // 보더
          text:    '#1A1D2E', // 기본 텍스트
          // 서브 텍스트·프라이머리는 **글자 대비 때문에** 2026-09-12에 한 단계씩 어둡게 했다(UX-42).
          // 브라우저 전수 측정에서 이 둘이 대비 미달의 뿌리였다 — 한 화면에서만 15건 중 11건.
          //   sub     #6B7280 → 회색 배경(#F4F6FB)에서 4.47  (AA 기준 4.5 미달)
          //   primary #4F8EF7 → 글자로 쓰면 3.21, 흰 글자를 올리면 2.80  (둘 다 미달)
          // 색을 바꾸지 않고 어둡기만 내렸다. `text-cc-primary` 253곳·`bg-cc-primary` 122곳이
          // 이 두 줄을 따라온다 — 375곳을 손대는 대신 여기를 고친다.
          // `#2563EB`는 이미 이 앱의 `hover:bg-blue-600`이라 새 색이 아니다.
          // 되돌리려면 이 두 값만 되돌린다. 가드: tests/audit/ux42-contrast.test.cjs
          sub:     '#4B5563', // 서브 텍스트 (흰 7.56 / 회 6.99)
          primary: '#2563EB', // 프라이머리 (글자 5.17 / 흰 글자를 올리면 5.17)
          // 상태색도 같은 사연이다(UX-42, 2026-09-12). 다섯 다 **글자로 더 많이 쓰인다** —
          // `text-cc-*` 152곳 대 `bg-cc-*` 39곳. 그런데 값은 채움색으로 골라져 있어서
          // 글자로 쓰면 전부 미달이었다(success 2.04 · warning 1.92 · danger 3.37 ·
          // orange 2.51 · purple 3.79). 흰 글자를 올린 채움도 같이 미달이었다.
          // **색조는 그대로 두고 어둡기만 내렸다** — 그래서 "초록=정상, 빨강=위험"이 안 바뀐다.
          // 연한 배경(greenBg·redBg·amberBg…)은 안 건드렸다. 그건 글자가 아니라 바탕이다.
          success: '#166534', // 밝은 배경 최저 6.38 / 흰 글자 7.13
          warning: '#92400E', // 밝은 배경 최저 6.34 / 흰 글자 7.09
          danger:  '#B91C1C', // 밝은 배경 최저 5.79 / 흰 글자 6.47
          orange:  '#C2410C', // 밝은 배경 최저 4.63 / 흰 글자 5.18
          purple:  '#6D28D9', // 밝은 배경 최저 6.36 / 흰 글자 7.10
          // 쉬운 모드 카드 배경색
          greenBg:  '#F0FFF4',
          purpleBg: '#F5F0FF',
          blueBg:   '#EFF6FF',
          amberBg:  '#FFF7ED',
          redBg:    '#FFF0F0',
          orangeBg: '#FFF9ED',
          tableBg:  '#F8FAFF', // 테이블 짝수행
        },
        // 디자인 시스템 토큰 — **값을 여기 적지 않는다.** src/styles/tokens.css가 유일한
        // 출처이고 여기는 이름만 잇는다(`bg-ds-brand` → `var(--ds-brand)`).
        // 값을 여기 다시 적으면 config가 네 번째 사본이 되고, 캔버스 색이 바뀔 때
        // 어느 쪽이 진짜인지 알 수 없게 된다 — design-tokens.test.js가 hex를 막는다.
        //
        // ⚠ **투명도 수식어(`bg-ds-brand/45`)는 안 먹는다.** Tailwind v3는 값이 var()면
        //   알파를 합성하지 못하고 그냥 불투명하게 낸다(오류도 안 난다 — 조용히 틀린다).
        //   반투명이 필요하면 그 값을 토큰으로 만든다(--ds-chip-on-brand가 그 예다).
        //
        // ⚠ 이 목록과 tokens.css는 **1:1이어야 한다.** 한쪽에만 있으면 화면에서 어떤
        //   이름은 되고 어떤 이름은 조용히 안 먹어서 클래스 오타와 구분이 안 된다.
        //   design-tokens.test.js가 양쪽을 대조한다.
        ds: {
          brand:          'var(--ds-brand)',
          'brand-mid':    'var(--ds-brand-mid)',
          'brand-tint':   'var(--ds-brand-tint)',
          'brand-soft':   'var(--ds-brand-soft)',
          'brand-ink':    'var(--ds-brand-ink)',
          bg:             'var(--ds-bg)',
          surface:        'var(--ds-surface)',
          border:         'var(--ds-border)',
          text:           'var(--ds-text)',
          'text-sub':     'var(--ds-text-sub)',
          'chip-on-brand': 'var(--ds-chip-on-brand)',
          'kind-now':      'var(--ds-kind-now)',
          'kind-now-soft': 'var(--ds-kind-now-soft)',
          'kind-bgm':      'var(--ds-kind-bgm)',
          'kind-bgm-soft': 'var(--ds-kind-bgm-soft)',
          'kind-done':      'var(--ds-kind-done)',
          'kind-done-soft': 'var(--ds-kind-done-soft)',
          // 통합 홈(목업 v3) — 값은 tokens.css 에만 있다. 여기는 이름만 잇는다.
          'v3-bg': 'rgb(var(--ds-v3-bg-rgb) / <alpha-value>)',
          'v3-surface': 'rgb(var(--ds-v3-surface-rgb) / <alpha-value>)',
          'v3-line': 'rgb(var(--ds-v3-line-rgb) / <alpha-value>)',
          'v3-line-2': 'rgb(var(--ds-v3-line-2-rgb) / <alpha-value>)',
          'v3-ink': 'rgb(var(--ds-v3-ink-rgb) / <alpha-value>)',
          'v3-ink-2': 'rgb(var(--ds-v3-ink-2-rgb) / <alpha-value>)',
          'v3-ink-3': 'rgb(var(--ds-v3-ink-3-rgb) / <alpha-value>)',
          'v3-tts': 'rgb(var(--ds-v3-tts-rgb) / <alpha-value>)',
          'v3-tts-bg': 'rgb(var(--ds-v3-tts-bg-rgb) / <alpha-value>)',
          'v3-tts-line': 'rgb(var(--ds-v3-tts-line-rgb) / <alpha-value>)',
          'v3-bgm': 'rgb(var(--ds-v3-bgm-rgb) / <alpha-value>)',
          'v3-bgm-bg': 'rgb(var(--ds-v3-bgm-bg-rgb) / <alpha-value>)',
          'v3-bgm-line': 'rgb(var(--ds-v3-bgm-line-rgb) / <alpha-value>)',
          'v3-flow': 'rgb(var(--ds-v3-flow-rgb) / <alpha-value>)',
          'v3-flow-bg': 'rgb(var(--ds-v3-flow-bg-rgb) / <alpha-value>)',
          'v3-flow-line': 'rgb(var(--ds-v3-flow-line-rgb) / <alpha-value>)',
          // 물감 두 방울은 **RGB 세 값**으로 둔다 — 그라디언트에서 알파를 따로 얹어야
          // 해서(`rgba(var(--…), .9)`) 색 하나로는 못 쓴다. 여기 등록은 토큰과 config 를
          // 1:1 로 맞추기 위한 것이고(design-tokens.test.js), 클래스로 쓸 일은 드물다.
          'v3-warn':      'rgb(var(--ds-v3-warn-rgb) / <alpha-value>)',
          'v3-warn-bg':   'rgb(var(--ds-v3-warn-bg-rgb) / <alpha-value>)',
          'v3-drop-tts':  'rgb(var(--ds-v3-drop-tts))',
          'v3-drop-bgm':  'rgb(var(--ds-v3-drop-bgm))',
          'v3-hair':      'var(--ds-v3-hair)',
          'v3-veil':      'var(--ds-v3-veil)',
          'v3-surface-2': 'rgb(var(--ds-v3-surface-2-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        // 서체는 하나다(T-8, docs/audit/design-typography-v4.md). `inter` 별칭은
        // 참조 0곳이라 걷었다 — 안 쓰는 이름을 남겨 두면 "있으니 쓰자"가 된다.
        sans: ['Pretendard', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
        btn:  '10px',
      },
      // 통합 홈의 그림자 — 값은 tokens.css 에만 있다(화면에 rgba 를 다시 적지 않는다).
      boxShadow: {
        'v3-card':  'var(--ds-v3-shadow-card)',
        'v3-panel': 'var(--ds-v3-shadow-panel)',
        'v3-grip':  'var(--ds-v3-shadow-grip)',
        'v3-ask':     'var(--ds-v3-shadow-ask)',
        'v3-compose': 'var(--ds-v3-shadow-compose)',
        'v3-ring':    'var(--ds-v3-shadow-ring)',
      },
    },
  },
  plugins: [],
}
