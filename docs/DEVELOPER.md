# CareCast 개발자 안내

> 소스에서 직접 띄우는 사람을 위한 안내입니다. 현장 설치는 README 「설치」의 설치 파일을 쓰세요.

**준비**: Node.js **24**(설치본 동봉판 24.19.0) · Python 3(차임·서버 스피커) · 안내 음성 모델 `npm run setup:tts` · Windows 권장(출력장치·마스터 볼륨·자동 종료는 Windows 전용, 다른 OS에서는 자동으로 꺼짐).

```bash
npm install && npm install --prefix server   # 최초 1회
npm run dev              # 화면 개발 서버 (https://localhost:5173, /api 는 3001 로 프록시)
node server/index.js     # 백엔드 (http://localhost:3001, dist/ 도 서빙)
```

API 키는 `.env` 가 아니라 **DB의 `settings` 표**에서 읽습니다(관리자 화면 → 시스템 설정 → AI · API 연동). 드라이런: `CARECAST_NO_HARDWARE=1`(서버 스피커·장치 무음). **자동 종료는 이 스위치로 막히지 않습니다** — 개발 PC 여부는 브랜치(`main` = 현장)로 판정합니다.

**검증 — `npm run verify` (6칸, 하나라도 실패하면 완료 아님)**

| # | 칸 | 무엇 | 2026-10-18 결과 |
| --- | --- | --- | --- |
| 1 | `lint:check` | ESLint | PASS |
| 2 | `build` | Vite 빌드(`dist/`) | PASS |
| 3 | `test:server` | 서버 시험(`node --test`) | PASS · 3732건(통과 3710 · 건너뜀 22) |
| 4 | `test:regression` | 회귀 시험 | PASS · 14건 |
| 5 | `verify:db` | DB 스키마 ↔ `db/schema.expected.json` | PASS |
| 6 | `verify:times` | 방송 시각 사본 대조 | PASS |

설치 파일 만들기: `npm run package:installer` → `release/CareCast-Setup.exe`(Inno Setup 6 필요, `ISCC_PATH` 로 경로 지정). 자세히: [`docs/PACKAGING.md`](PACKAGING.md)

**폴더 구조**

| 경로 | 무엇 |
| --- | --- |
| `src/pages` · `src/components` · `src/hooks` · `src/lib` | 화면(React). 간편·캘린더·자동순서·업로드·설정, 초기 설정·처음 안내 |
| `server/index.js` | 서버 진입점 |
| `server/routes` | API 창구(예약·TTS·설정·음원·AI…) |
| `server/services` | 스케줄러·방송 시퀀서·음성 합성·감시·자동 업데이트 |
| `server/domain` | 순수 규칙 단일 출처(볼륨·방송 시각·날씨 코드·오늘 일과…) |
| `server/config` | 초기값·설정 가져오기 |
| `server/test` · `tests/regression` | 서버 시험 · 회귀 시험 |
| `db/migrations` · `db/schema.expected.json` | 스키마 변경 이력 · 기대 스키마 |
| `scripts` | 검증·측정·포장 스크립트(`scripts/installer` 는 설치 파일 재료) |
| `docs` | 설명서(`MANUAL-USER` · `MANUAL-ADMIN` · `ADOPT` · `BACKUP` · `DEVELOPER`) · 배포·포장(`DEPLOY` · `PACKAGING`) · 설계 기록 |

작업 규칙·남은 일 목록(`CLAUDE.md` · `TASKS.md` · `docs/audit/`)은 개발 저장소의 내부 문서라 공개판에는 들어 있지 않습니다.
공개판에서 고칠 점은 GitHub 이슈로 알려 주세요.
