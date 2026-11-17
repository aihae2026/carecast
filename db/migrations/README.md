# db/migrations

스키마를 바꾸는 작업(컬럼/테이블 추가·변경)마다 여기에 `NNNN_설명.sql` 파일을 하나 추가한다.

- 번호는 4자리, 순서대로 증가 (`0001_add_repeat_broadcast.sql` 형식)
- 실제 반영은 지금까지처럼 `server/db/schema.js`의 `initDB()` 안 `try { ALTER TABLE ... } catch {}` 블록으로 한다 — 이 파일들은 "무엇이 언제 바뀌었는지"를 사람이 읽는 이력이자, `npm run verify:db`가 `db/schema.expected.json`과 대조할 때 참고하는 근거 자료다.
- 새 마이그레이션 파일을 추가했다면 반드시 `db/schema.expected.json`도 같이 갱신한다 (CLAUDE.md 4번 규칙).

지금은 비어 있다 — 기존 컬럼들은 이미 `schema.js`에 반영되어 있는 상태에서 이 검증 체계가 새로 생겼기 때문에, 과거분까지 소급해서 파일을 만들지는 않았다. **이 시점 이후의 스키마 변경부터 여기에 기록한다.**
