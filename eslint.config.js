import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `_loops` 는 루프·감사 테스트가 **만들었다 지우는** 작업 폴더다(.gitignore 대상).
  // 빼기 전에는 eslint 가 759건 중 99건을 거기서 읽었고, 테스트와 린트가 동시에 돌면
  // 읽는 사이에 파일이 사라져 **ENOENT 로 크래시**했다 — 위반이 아니라 exit 2 라
  // "린트 실패"로 보이지만 코드와 무관하다(2026-09-12 실측).
  // release/ 는 설치판 산출물(압축·푼 폴더) — .gitignore 와 같이 검사하지 않는다(2026-09-22, 푼 설치판이 린트에 잡혔다).
  globalIgnores(['dist', '_loops', 'release']),
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // server/ 는 Node CommonJS — 브라우저 전역이 아니라 Node 전역(require/module/process 등)을 써야
    // require/module 등을 no-undef로 잘못 잡지 않는다. react 관련 규칙도 여기선 무의미하므로 제외.
    files: ['server/**/*.js', 'scripts/**/*.{js,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
  },
])
