// 자연어 한 문장 → 방송 예약 초안 파싱.
//
// 파싱 결과는 곧바로 저장하지 않고 예약 추가 모달을 채운 채 열어 사람이 확인한다.
// 시간·요일을 잘못 읽으면 엉뚱한 시각에 방송이 나가므로, 못 읽은 건 조용히 추측하지 말고
// ambiguous로 표시해 사람이 고치게 하는 게 이 파서의 원칙이다.
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { parseSchedulePhrase } = require('../services/schedulePhrase')

// 테스트가 실행 날짜에 흔들리지 않도록 기준 시각을 고정 (2026-08-27 목요일)
const NOW = new Date(2026, 7, 27, 10, 0, 0)
const p = (text) => parseSchedulePhrase(text, NOW)

// ── 시간 ──────────────────────────────────────────────────────
test('오후 N시를 24시간제로 바꾼다', () => {
  assert.equal(p('매일 오후 3시에 산책 안내').scheduled_time, '15:00')
})

test('오전 N시 M분을 읽는다', () => {
  assert.equal(p('평일 오전 9시 30분 체조 안내').scheduled_time, '09:30')
})

test('오후 12시는 정오(12:00), 오전 12시는 자정(00:00)', () => {
  assert.equal(p('오후 12시 점심 안내').scheduled_time, '12:00')
  assert.equal(p('오전 12시 안내').scheduled_time, '00:00')
})

test('24시간제 표기(15시)와 HH:MM을 그대로 읽는다', () => {
  assert.equal(p('매일 15시 안내').scheduled_time, '15:00')
  assert.equal(p('매일 14:20 안내').scheduled_time, '14:20')
})

test('"N시 반"은 30분으로 읽는다', () => {
  assert.equal(p('매일 오후 2시 반 안내').scheduled_time, '14:30')
})

test('오전/오후 표시가 없는 1~12시는 임의로 정하지 않고 ambiguous로 알린다', () => {
  const r = p('매일 3시에 산책 안내')
  assert.ok(r.ambiguous.includes('time_meridiem'), '모호한 시간은 사람이 확인하도록 표시해야 한다')
})

test('오전/오후가 명시되면 모호 표시가 없다', () => {
  assert.deepEqual(p('매일 오후 3시에 산책 안내').ambiguous, [])
})

test('고유어 숫자 시각("세시")도 숫자("3시")처럼 읽는다', () => {
  const r = p('내일 오후 세시 산책')
  assert.equal(r.scheduled_time, '15:00')
  assert.deepEqual(r.ambiguous, [])
  assert.ok(!/세시|세\s*시/.test(r.content), `내용에 시각 표현이 남으면 안 된다: ${r.content}`)
})

test('고유어 숫자(한 시~열두 시) 전부 읽는다', () => {
  assert.equal(p('오전 한 시 안내').scheduled_time, '01:00')
  assert.equal(p('오전 열 시 안내').scheduled_time, '10:00')
  assert.equal(p('오전 열한 시 안내').scheduled_time, '11:00')
  assert.equal(p('오후 열두 시 안내').scheduled_time, '12:00')
})

// ── 반복 요일 ─────────────────────────────────────────────────
test('매일/평일/주말을 요일 배열로 바꾼다', () => {
  assert.deepEqual(p('매일 오후 3시 안내').repeat_weekdays, [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(p('평일 오전 9시 안내').repeat_weekdays, [1, 2, 3, 4, 5])
  assert.deepEqual(p('주말 오후 2시 안내').repeat_weekdays, [0, 6])
})

test('월수금/화목 같은 축약 표현을 읽는다', () => {
  assert.deepEqual(p('월수금 오후 2시 프로그램 안내').repeat_weekdays, [1, 3, 5])
  assert.deepEqual(p('화목 오전 10시 체조').repeat_weekdays, [2, 4])
})

test('매주 X요일을 읽는다', () => {
  assert.deepEqual(p('매주 화요일 오후 3시 안내').repeat_weekdays, [2])
})

// ── 1회성(오늘/내일) ──────────────────────────────────────────
test('"내일"은 1회성이고 시작일이 다음 날이다', () => {
  const r = p('내일 오전 10시에 면회 안내')
  assert.deepEqual(r.repeat_weekdays, [], '1회성은 요일이 빈 배열이어야 한다')
  assert.equal(r.repeat_start_date, '2026-08-28')
})

test('"오늘"은 1회성이고 시작일이 오늘이다', () => {
  const r = p('오늘 오후 4시 안내')
  assert.deepEqual(r.repeat_weekdays, [])
  assert.equal(r.repeat_start_date, '2026-08-27')
})

test('"모레"는 1회성이고 시작일이 이틀 뒤다', () => {
  const r = p('모레 오후 3시 산책 안내')
  assert.deepEqual(r.repeat_weekdays, [])
  assert.equal(r.repeat_start_date, '2026-08-29')
  assert.ok(!/모레/.test(r.content), `내용에 '모레'가 남으면 안 된다: ${r.content}`)
})

test('"글피"는 1회성이고 시작일이 사흘 뒤다', () => {
  const r = p('글피 오전 9시 체조 안내')
  assert.deepEqual(r.repeat_weekdays, [])
  assert.equal(r.repeat_start_date, '2026-08-30')
})

test('"N일 후"(숫자)/"이틀 뒤"(고유어)도 1회성으로 읽는다', () => {
  const r1 = p('3일 후 오후 2시 검진 안내')
  assert.deepEqual(r1.repeat_weekdays, [])
  assert.equal(r1.repeat_start_date, '2026-08-30')

  const r2 = p('이틀 뒤 오전 9시 체조')
  assert.deepEqual(r2.repeat_weekdays, [])
  assert.equal(r2.repeat_start_date, '2026-08-29')
  assert.ok(!/이틀/.test(r2.content), `내용에 '이틀'이 남으면 안 된다: ${r2.content}`)
})

// ── 명시적 날짜("8월 30일") ────────────────────────────────────
test('"M월 D일"은 1회성이고 그 날짜가 시작일이다', () => {
  const r = p('8월 30일 오후 3시 산책 안내')
  assert.deepEqual(r.repeat_weekdays, [])
  assert.equal(r.repeat_start_date, '2026-08-30')
  assert.ok(!/8월|30일/.test(r.content), `내용에 날짜가 남으면 안 된다: ${r.content}`)
})

test('이미 지난 월일을 말하면 내년으로 넘긴다', () => {
  // 기준일 2026-08-27(목) — "1월 5일"은 이미 지났으므로 2027년으로 계산돼야 한다
  const r = p('1월 5일 오전 9시 신년 인사')
  assert.equal(r.repeat_start_date, '2027-01-05')
})

test('오늘과 같은 월일이면 올해로 처리한다', () => {
  const r = p('8월 27일 오후 3시 안내')
  assert.equal(r.repeat_start_date, '2026-08-27')
})

// ── 새벽/정오/자정 ──────────────────────────────────────────────
// 검증 대상은 **시각**의 모호성이다. 반복 표현이 없어 붙는 repeat_assumed(2026-08-28 추가)는
// 이 테스트가 말하려는 바와 무관하므로, 시각 관련 항목만 골라서 본다.
const timeNotes = (r) => r.ambiguous.filter(a => a.startsWith('time_'))

test('"새벽"은 오전으로 읽어 모호하지 않다', () => {
  const r = p('새벽 5시 기상 안내')
  assert.equal(r.scheduled_time, '05:00')
  assert.deepEqual(timeNotes(r), [])
})

test('"정오"는 12:00, "자정"은 00:00으로 바로 읽는다(오전/오후 표시 없어도 모호하지 않음)', () => {
  assert.equal(p('정오 안내').scheduled_time, '12:00')
  assert.deepEqual(timeNotes(p('정오 안내')), [])
  assert.equal(p('자정 안내').scheduled_time, '00:00')
})

// ── 격주(스키마 미지원) ──────────────────────────────────────────
// ── 이번주/다음주 + 요일 ─────────────────────────────────────────
test('"다음주 X요일"은 1회성이고 다음 주 그 요일이 시작일이다(기준일 2026-08-27은 목요일)', () => {
  const r = p('다음주 월요일 오전 9시 체조 안내')
  assert.deepEqual(r.repeat_weekdays, [])
  assert.equal(r.repeat_start_date, '2026-08-31') // 이번주 월요일(8/24)이 아니라 다음주 월요일
  assert.ok(!/다음주/.test(r.content), `내용에 '다음주'가 남으면 안 된다: ${r.content}`)
})

test('"다음주 X요일"은 이번주에 아직 안 지난 요일이어도 반드시 다음 주로 넘어간다', () => {
  // 기준일 목요일(2026-08-27) 기준 "다음주 금요일"은 내일(8/28)이 아니라 9/4여야 한다
  const r = p('다음주 금요일 오후 2시 진료 안내')
  assert.equal(r.repeat_start_date, '2026-09-04')
})

test('"이번주 X요일"은 여전히 매주 반복으로 처리하되 내용에는 남지 않는다', () => {
  const r = p('이번주 금요일 오후 3시 산책 안내')
  assert.deepEqual(r.repeat_weekdays, [5])
  assert.ok(!/이번주/.test(r.content), `내용에 '이번주'가 남으면 안 된다: ${r.content}`)
})

test('"격주"는 요일은 반영하되 지원하지 않는다고 알린다', () => {
  const r = p('격주 화요일 오전 10시 진료 안내')
  assert.deepEqual(r.repeat_weekdays, [2])
  assert.ok(r.ambiguous.includes('repeat_biweekly'), '격주는 스키마상 지원 불가를 알려야 한다')
})

test('반복 표현이 없으면 기본은 매일이고 시작일은 오늘', () => {
  const r = p('오후 3시에 산책 안내')
  assert.deepEqual(r.repeat_weekdays, [0, 1, 2, 3, 4, 5, 6])
  assert.equal(r.repeat_start_date, '2026-08-27')
})

// ── 제목·내용 ────────────────────────────────────────────────
test('시간·요일 토큰을 걷어낸 나머지가 내용이 된다', () => {
  const r = p('매일 오후 3시에 산책 안내 방송 넣어줘')
  assert.ok(r.content.includes('산책'), `내용에 '산책'이 있어야 한다: ${r.content}`)
  assert.ok(!/오후|3시|매일/.test(r.content), `시간·요일이 내용에 남으면 안 된다: ${r.content}`)
  assert.ok(!/넣어줘|해줘/.test(r.content), `명령 꼬리말이 남으면 안 된다: ${r.content}`)
})

test('제목이 비어있지 않게 채워진다', () => {
  const r = p('매일 오후 3시에 산책 안내')
  assert.ok(r.title && r.title.trim().length > 0)
})

test('내용을 못 뽑아내도 빈 문자열로 안전하게 반환한다', () => {
  const r = p('매일 오후 3시')
  assert.equal(typeof r.content, 'string')
  assert.equal(typeof r.title, 'string')
})

// ── 방어 ──────────────────────────────────────────────────────
test('빈 값·비문자열은 기본값으로 안전하게 처리한다', () => {
  for (const v of ['', null, undefined, 123]) {
    const r = parseSchedulePhrase(v, NOW)
    assert.equal(typeof r.scheduled_time, 'string')
    assert.ok(Array.isArray(r.repeat_weekdays))
    assert.ok(Array.isArray(r.ambiguous))
  }
})

test('시간을 못 읽으면 기본 시간을 두되 ambiguous로 알린다', () => {
  const r = p('산책 안내 방송')
  assert.ok(r.ambiguous.includes('time_missing'), '시간을 못 읽었으면 사람이 채우도록 알려야 한다')
})

// ── 방송 유형(ontology.js) ────────────────────────────────────
// 문장이 가리키는 매체를 broadcast_type으로 옮긴다. 예전엔 항상 'text'라서
// "차임벨 울려줘"라고 해도 TTS가 그 문장을 그대로 읽었다.
test('매체를 말하지 않으면 지금까지처럼 TTS(text) 방송이다', () => {
  assert.equal(p('매일 오후 3시에 산책 안내').broadcast_type, 'text')
  assert.equal(p('평일 오전 9시 30분 체조 안내').broadcast_type, 'text')
})

test('"차임벨 울려줘"는 차임벨 방송으로 읽는다', () => {
  const r = p('저녁 6시에 차임벨 울려줘')
  assert.equal(r.broadcast_type, 'chime')
  assert.equal(r.scheduled_time, '18:00')
})

test('매체만 말한 문장은 유형 이름을 제목으로 쓰고 내용은 비운다', () => {
  const r = p('저녁 6시에 차임벨 울려줘')
  assert.equal(r.title, '차임벨')
  assert.equal(r.content, '', '차임벨 방송은 읽을 문구가 없다')
  assert.ok(!/울려|줘/.test(r.title), `명령 꼬리말이 제목에 남으면 안 된다: ${r.title}`)
})

test('재생할 파일이 필요한 유형은 사람이 고르도록 알린다', () => {
  const r = p('매일 12시에 안내 음원 틀어줘')
  assert.equal(r.broadcast_type, 'audio')
  assert.ok(r.ambiguous.includes('needs_audio_file'), '파일을 임의로 고르지 말고 알려야 한다')
})

test('낱말만 걸린 추측은 조용히 넘기지 않고 알린다', () => {
  const r = p('저녁 6시에 차임벨')
  assert.equal(r.broadcast_type, 'chime')
  assert.ok(r.ambiguous.includes('type_guess'), '확신이 없으면 사람이 확인하게 알려야 한다')
})

test('BGM 방송은 이 PC 의 방송용 폴더로 채운다 — 검색어는 없다(2026-09-21)', () => {
  const r = p('오후 3시에 클래식 음악 틀어줘')
  assert.equal(r.broadcast_type, 'bgm')
  assert.equal(r.bgm_enabled, 1)
  assert.equal(r.bgm_type, 'local_broadcast')
  assert.equal(r.bgm_value, '')
})

test('BGM이 아닌 유형에는 bgm_value를 넣지 않는다(화면 기본값 보존)', () => {
  // emptySchedule()의 BGM_DEFAULTS 위에 덮어써지므로, 여기서 빈 값을 보내면
  // 사용자가 나중에 BGM을 켤 때 검색어가 지워진 상태가 된다.
  const r = p('매일 오후 3시에 산책 안내')
  assert.equal(r.bgm_value, undefined)
  assert.equal(r.bgm_enabled, undefined)
})

test('빈 값도 broadcast_type을 반드시 포함한다', () => {
  for (const v of ['', null, undefined, 123]) {
    assert.equal(parseSchedulePhrase(v, NOW).broadcast_type, 'text')
  }
})

// ── 저장된 흐름 ───────────────────────────────────────────────
// 흐름은 이름을 맞춰야 실행되므로 사전(낱말)만으로는 못 고른다 — 호출부(라우트)가 DB에서
// 목록을 읽어 넘긴다. 목록을 안 넘기면 지금까지처럼 동작해야 한다(하위 호환).
const FLOWS = [{ id: 7, name: '아침 방송' }, { id: 8, name: '체조' }]

test('흐름 이름을 부르면 flow 예약이 되고 id가 채워진다', () => {
  const r = parseSchedulePhrase('내일 오전 8시에 아침 방송 흐름 실행해줘', NOW, { flows: FLOWS })
  assert.equal(r.broadcast_type, 'flow')
  assert.equal(r.flow_sequence_id, 7)
  assert.equal(r.scheduled_time, '08:00')
  assert.equal(r.repeat_start_date, '2026-08-28')
})

test('흐름 예약은 흐름 이름을 제목으로 쓰고 내용을 비운다', () => {
  const r = parseSchedulePhrase('오전 8시 아침방송 순서대로 틀어줘', NOW, { flows: FLOWS })
  assert.equal(r.title, '아침 방송')
  assert.equal(r.content, '', '흐름 방송은 읽을 문구가 없다')
})

test('흐름 이름이 매체 낱말보다 우선한다', () => {
  const flows = [{ id: 9, name: '음악 시간' }]
  const r = parseSchedulePhrase('오후 3시 음악 시간 흐름 실행해줘', NOW, { flows })
  assert.equal(r.broadcast_type, 'flow', 'BGM으로 새면 저장해둔 흐름이 실행되지 않는다')
  assert.equal(r.flow_sequence_id, 9)
})

test('흐름 목록을 안 넘기면 예전과 똑같이 동작한다(하위 호환)', () => {
  const r = p('내일 오전 8시에 아침 방송 흐름 실행해줘')
  assert.equal(r.broadcast_type, 'text')
  assert.equal(r.flow_sequence_id, undefined)
})

test('명시적 신호 없이 흐름 이름만 스치면 flow로 만들지 않는다', () => {
  const r = parseSchedulePhrase('오후 3시 체조 안내', NOW, { flows: FLOWS })
  assert.equal(r.broadcast_type, 'text')
})

test('BGM 검색어에 조사·명령 꼬리말이 남지 않는다', () => {
  // "음악을 좀 틀어주세요"에서 남은 "을 좀 틀어주세요"가 그대로 유튜브 검색어로 들어가던
  // 버그(2026-08-28). 검색어가 비면 scheduler가 기본값('클래식 음악')으로 넘어간다.
  const r = p('음악을 좀 틀어주세요')
  assert.equal(r.broadcast_type, 'bgm')
  assert.ok(!/틀어|주세요|^을|좀/.test(r.bgm_value), `검색어에 찌꺼기가 남았다: "${r.bgm_value}"`)
  assert.ok(!/틀어|주세요/.test(r.title), `제목에 찌꺼기가 남았다: "${r.title}"`)
})

test('일반 TTS 방송문에서는 "틀어"·"켜" 같은 말을 지우지 않는다', () => {
  // 재생 동작 제거는 매체 방송으로 읽힌 문장에만 적용해야 한다 — 안내 문구에는
  // 그 말이 내용으로 들어갈 수 있다.
  const r = p('오후 3시에 라디오 켜는 방법 안내')
  assert.equal(r.broadcast_type, 'text')
  assert.ok(r.content.includes('켜는'), `안내 문구가 훼손됐다: "${r.content}"`)
})

// ── 애매하면 되묻는다 ─────────────────────────────────────────
// 화면은 ambiguous가 하나라도 있으면 "확인했습니다"를 체크해야 저장할 수 있다.
test('유형 후보가 둘이면 type_ambiguous와 후보 이름을 함께 알린다', () => {
  const r = p('오후 3시 음악이랑 영상 틀어줘')
  assert.equal(r.broadcast_type, 'video')
  assert.ok(r.ambiguous.includes('type_ambiguous'))
  assert.deepEqual(r.type_alternatives, ['BGM'])
})

test('흐름 후보가 둘이면 flow_ambiguous와 후보 이름을 함께 알린다', () => {
  const flows = [{ id: 1, name: '아침 방송' }, { id: 2, name: '체조' }]
  const r = parseSchedulePhrase('내일 오전 8시 아침 방송 끝나고 체조 흐름 실행', NOW, { flows })
  assert.equal(r.broadcast_type, 'flow')
  assert.ok(r.ambiguous.includes('flow_ambiguous'))
  assert.deepEqual(r.flow_alternatives, ['체조'])
})

test('반복 표현이 없어 "매일"로 둔 것도 조용히 넘기지 않는다', () => {
  // 하루짜리 안내가 매일 나가는 건 위험한 오독이다 — 기본값은 유지하되 알린다
  const r = p('오후 3시에 산책 안내')
  assert.deepEqual(r.repeat_weekdays, [0, 1, 2, 3, 4, 5, 6])
  assert.ok(r.ambiguous.includes('repeat_assumed'))
})

test('반복·날짜를 분명히 말하면 되묻지 않는다', () => {
  for (const text of ['매일 오후 3시에 산책 안내', '평일 오전 9시 30분 체조 안내', '8월 30일 오후 2시 프로그램 안내']) {
    const r = p(text)
    assert.ok(!r.ambiguous.includes('repeat_assumed'), `"${text}"에는 되물을 게 없어야 한다`)
  }
})

test('분명한 문장에는 후보 목록을 아예 넣지 않는다(잔소리 방지)', () => {
  const r = p('매일 오후 3시에 산책 안내')
  assert.deepEqual(r.ambiguous, [])
  assert.equal(r.type_alternatives, undefined)
  assert.equal(r.flow_alternatives, undefined)
})

// ── 설정 수식어 ───────────────────────────────────────────────
// "오후 두시에 프로그램 안내해주고, 볼륨은 잔잔하게 시작해줘"
// = 예약 1건 + 그 예약에만 적용되는 볼륨. 독립 명령이 아니라 이 예약의 파라미터로 읽는다.
const LEVELS = { volumeLevels: { quiet: 30, loud: 85 } }

test('한 문장에 예약과 볼륨 지시가 같이 있으면 예약의 파라미터로 읽는다', () => {
  const r = parseSchedulePhrase('오후 두시에 프로그램 안내해주고, 볼륨은 잔잔하게 시작해줘', NOW, LEVELS)
  assert.equal(r.scheduled_time, '14:00')
  assert.equal(r.broadcast_type, 'text')
  assert.equal(r.bgm_volume, 30)
  assert.equal(r.title, '프로그램 안내', `볼륨 절이 내용에 남으면 안 된다: "${r.title}"`)
})

test('볼륨 절과 연결어·마무리 동사를 내용에서 걷어낸다', () => {
  const r = parseSchedulePhrase('매일 오후 3시 프로그램 안내, 볼륨 40으로', NOW, LEVELS)
  assert.equal(r.bgm_volume, 40)
  assert.ok(!/볼륨|40|으로/.test(r.content), `내용에 볼륨 절이 남았다: "${r.content}"`)
})

test('볼륨을 지시하면 사람이 숫자를 보고 확인하게 한다', () => {
  const r = parseSchedulePhrase('오후 2시 안내, 볼륨은 잔잔하게', NOW, LEVELS)
  assert.ok(r.ambiguous.includes('volume_set'), '귀로 체감되는 값이라 조용히 넘기면 안 된다')
  assert.equal(r.volume_label, '잔잔하게', '화면이 "30%(잔잔하게)"라고 물어볼 수 있어야 한다')
})

test('"보통으로"는 값을 넣지 않는다(= 시스템 기본값을 따른다)', () => {
  const r = parseSchedulePhrase('오후 2시 안내, 볼륨은 보통으로', NOW, LEVELS)
  assert.equal(r.bgm_volume, undefined, '값을 넣지 않는 것이 곧 기본값을 따른다는 뜻이다')
  assert.ok(!r.ambiguous.includes('volume_set'))
})

test('볼륨 지시가 없으면 아무 값도 넣지 않는다', () => {
  const r = p('매일 오후 3시에 산책 안내')
  assert.equal(r.bgm_volume, undefined)
  assert.equal(r.volume_label, undefined)
})

test('볼륨 수식어가 없는 문장의 "시작"·"하고"는 내용으로 남는다', () => {
  // 꼬리 정리는 수식어를 읽은 문장에만 적용해야 한다
  const r = p('내일 2시 체조하고 나서 목욕 안내')
  assert.ok(r.content.includes('체조하고'), `안내 문구가 훼손됐다: "${r.content}"`)
})

test('"안내 음성은 크게"는 주 소리 볼륨에 들어간다', () => {
  const r = parseSchedulePhrase('오후 2시 투약 안내, 안내 음성은 크게', NOW, LEVELS)
  assert.equal(r.main_volume, 85)
  assert.equal(r.bgm_volume, undefined, 'BGM은 건드리지 않아야 한다')
  assert.equal(r.volume_channel, 'main')
})

test('어느 소리인지 안 밝히면 BGM으로 두고 되묻는다', () => {
  const r = parseSchedulePhrase('오후 2시 안내, 볼륨은 잔잔하게', NOW, LEVELS)
  assert.equal(r.bgm_volume, 30)
  assert.equal(r.main_volume, undefined, '안내 음성을 조용히 낮추면 어르신이 못 듣는다')
  assert.ok(r.ambiguous.includes('volume_channel_guess'))
})

// ── 지난 시각 안전장치 ────────────────────────────────────────
// 1회성 예약은 repeat_start_date 당일에만 실행된다(repeatSchedule.shouldRunToday).
// "오늘 + 이미 지난 시각"으로 저장되면 영원히 발동하지 않는다 — 저장은 됐는데 방송이 안 나가는,
// 현장에서 원인을 찾기 가장 어려운 실패다.
const AFTERNOON = new Date(2026, 7, 28, 15, 0, 0)   // 2026-08-28(금) 15:00

test('1회성인데 오늘 시각이 이미 지났으면 내일로 옮기고 알린다', () => {
  const r = parseSchedulePhrase('오늘 오후 2시 면회 안내', AFTERNOON)
  assert.equal(r.repeat_start_date, '2026-08-29')
  assert.equal(r.scheduled_time, '14:00')
  assert.ok(r.ambiguous.includes('time_past_moved'))
})

test('아직 안 지난 시각은 그대로 오늘이다', () => {
  const r = parseSchedulePhrase('오늘 오후 5시 면회 안내', AFTERNOON)
  assert.equal(r.repeat_start_date, '2026-08-28')
  assert.ok(!r.ambiguous.includes('time_past_moved'))
})

test('반복 예약은 옮기지 않는다(내일 그 시각에 정상 발동한다)', () => {
  const r = parseSchedulePhrase('매일 오후 2시 안내', AFTERNOON)
  assert.equal(r.repeat_start_date, '2026-08-28')
  assert.ok(!r.ambiguous.includes('time_past_moved'), '반복은 오늘을 놓쳐도 내일 나가므로 잔소리가 된다')
})

test('명시적 날짜로 말한 미래 예약은 건드리지 않는다', () => {
  const r = parseSchedulePhrase('8월 30일 오후 2시 프로그램 안내', AFTERNOON)
  assert.equal(r.repeat_start_date, '2026-08-30')
  assert.ok(!r.ambiguous.includes('time_past_moved'))
})

// ── 일과방송 겹침 ─────────────────────────────────────────────
const AUTO = [
  { id: 'lunch',  label: '점심 식사 전 방송', time: '11:15' },
  { id: 'dinner', label: '저녁 식사 전 방송', time: '16:20' },
]

test('일과방송과 시각이 겹치면 이름과 시각을 대고 알린다', () => {
  const r = parseSchedulePhrase('내일 오전 11시 15분 안내', NOW, { autoTimes: AUTO })
  assert.ok(r.ambiguous.includes('overlaps_auto'))
  assert.deepEqual(r.auto_overlaps, [{ label: '점심 식사 전 방송', time: '11:15' }])
})

test('앞뒤 5분 이내도 겹침으로 본다(일과방송은 여러 단계가 이어진다)', () => {
  const r = parseSchedulePhrase('내일 오후 4시 22분 안내', NOW, { autoTimes: AUTO })
  assert.ok(r.ambiguous.includes('overlaps_auto'))
})

test('멀리 떨어진 시각은 겹침으로 보지 않는다', () => {
  const r = parseSchedulePhrase('내일 오후 2시 안내', NOW, { autoTimes: AUTO })
  assert.ok(!r.ambiguous.includes('overlaps_auto'))
  assert.equal(r.auto_overlaps, undefined)
})

test('일과방송 목록을 안 넘기거나 형식이 어긋나도 안전하다(하위 호환)', () => {
  for (const autoTimes of [undefined, null, [], 'x', [null], [{ label: 1, time: 2 }], [{ label: 'a' }]]) {
    const r = parseSchedulePhrase('내일 오전 11시 15분 안내', NOW, { autoTimes })
    assert.ok(!r.ambiguous.includes('overlaps_auto'))
  }
})
