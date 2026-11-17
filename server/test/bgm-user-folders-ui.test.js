// 화면 쪽 BGM 폴더 규칙과 연결 (사용자 결정 2026-09-22 「폴더를 자유롭게 늘림」 · 음성 설정 정리).
//
//   · src/lib/bgmTypes.js — 저장값 규칙이 서버(domain/bgmRoles)와 같고, 목록에 없는 값을 **보존**한다
//     (옛 판은 모르는 값을 방송용으로 바꿔 보여 줘서, 열었다 저장만 해도 사람이 고른 폴더가 지워졌다 — 설계 검토 위험 2)
//   · 업로드 화면에 「배경음악」 갈래가 있고, 바뀌면 고르개들이 다시 읽게 알린다
//   · 여섯 자리가 같은 목록 부품을 쓴다 — 폴더 이름을 코드에 적은 칩이 남지 않았다
//   · 음성 설정: 음높이·Azure 목소리는 Azure 가 맨 앞일 때만, 이 PC 목소리는 그 반대
'use strict'

const test   = require('node:test')
const assert = require('node:assert/strict')
const fs     = require('node:fs')
const path   = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const 읽기 = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const 벗김 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

let T
test.before(async () => { T = await import('../../src/lib/bgmTypes.js') })

test('저장값 규칙 — 용도 값·폴더 값을 알아듣고, _seq 는 차례로', () => {
  assert.equal(T.bgmSourceOf('local_f12_seq'), 'local_f12')
  assert.equal(T.bgmOrderOf('local_f12_seq'), 'seq')
  assert.equal(T.bgmTypeFrom('local_f12', 'seq'), 'local_f12_seq')
  assert.equal(T.bgmTypeFrom('local_meal', 'random'), 'local_meal')
  // 옛 값(유튜브 시절 등)·빈 값은 서버처럼 방송용이다
  assert.equal(T.bgmSourceOf('trot_seq'), 'local_broadcast')
  assert.equal(T.bgmSourceOf(''), 'local_broadcast')
  assert.equal(T.bgmTypeFrom('local_f0'), 'local_broadcast', '0번 폴더 값을 받았다(서버는 거절한다)')
})

test('서버 규칙과 같다 — 화면이 local_f 로 적은 값을 서버가 같은 폴더로 읽는다', () => {
  const { 폴더값 } = require('../domain/bgmRoles')
  for (const [폴더, 차례] of [[3, 'random'], [27, 'seq']]) {
    const 값 = T.bgmTypeFrom(`local_f${폴더}`, 차례)
    assert.deepEqual(폴더값(값), { folderId: 폴더, 차례: 차례 === 'seq' })
  }
})

test('목록에 없는 폴더도 보존한다 — 열었다 저장만 해도 고른 폴더가 지워지지 않는다', () => {
  const 목록 = [{ id: 1, name: '방송', role: 'broadcast' }, { id: 2, name: '식사', role: 'meal' }]
  // 지워졌거나 다른 PC 의 DB 인 폴더 99
  assert.equal(T.bgmSourceOf('local_f99'), 'local_f99', '목록에 없다고 방송용으로 바꿨다')
  assert.equal(T.bgmTypeFrom(T.bgmSourceOf('local_f99_seq'), 'seq'), 'local_f99_seq')
  assert.equal(T.folderOfSource('local_f99', 목록), null)
  assert.equal(T.bgmFolderName('local_f99', 목록), '없어진 BGM 폴더')
  assert.equal(T.bgmFolderName('local_f99', null), 'BGM 폴더', '목록을 못 불러왔는데 「없어졌다」고 단정했다')
})

test('폴더 이름은 목록의 지금 이름 — 기본 폴더도 이름을 바꾸면 따라간다', () => {
  const 목록 = [{ id: 7, name: '신나는 곡', role: 'broadcast' }, { id: 8, name: '클래식', role: null }]
  assert.equal(T.bgmFolderName('local_broadcast', 목록), '신나는 곡')
  assert.equal(T.bgmTypeLabel('local_f8_seq', 목록), '클래식 · 차례로')
  assert.equal(T.sourceOfFolder(목록[0]), 'local_broadcast', '기본 폴더를 번호 값으로 적었다 — 폴더 하나에 값 하나')
  assert.equal(T.sourceOfFolder(목록[1]), 'local_f8')
})

test('자동방송 단계 — 기본 폴더는 bgmRole, 만든 폴더는 bgmFolderId 하나만', () => {
  assert.deepEqual(T.stepFieldsOfSource('local_meal'), { bgmRole: 'meal', bgmFolderId: undefined, bgmFileId: undefined })
  assert.deepEqual(T.stepFieldsOfSource('local_f5'), { bgmRole: undefined, bgmFolderId: 5, bgmFileId: undefined })
  assert.deepEqual(T.stepFieldsOfSource(null), { bgmRole: undefined, bgmFolderId: undefined, bgmFileId: undefined })
  assert.equal(T.sourceOfStep({ bgmFolderId: 5, bgmRole: 'meal' }), 'local_f5', '만든 폴더 번호보다 옛 용도가 이겼다')
  assert.equal(T.sourceOfStep({ bgmRole: 'meal' }), 'local_meal')
  assert.equal(T.sourceOfStep({}), null)
})

test('업로드 화면 — 「배경음악」 갈래가 있고, 바뀌면 고르개들이 다시 읽게 알린다', () => {
  const src = 벗김(읽기('src/components/admin/sections/MusicManagement.jsx'))
  assert.ok(/<GroupHeader title="배경음악"/.test(src), '왼쪽 목록에 배경음악 갈래가 없다 — 방송용·식사용 폴더에 곡을 넣을 길이 없다')
  assert.ok(/navigateTo\('bgm', \[\]\)/.test(src), '배경음악 갈래를 눌러도 그 자리로 안 간다')
  assert.ok(/dispatchEvent\(new CustomEvent\(BGM_FOLDERS_CHANGED\)\)/.test(src), '폴더를 바꿔도 고르개에 알리지 않는다 — 옛 이름이 남는다')
  assert.ok(/배경맨위/.test(src) && /disabled=\{uploading \|\| 배경맨위\}/.test(src), '배경음악 맨 위에 올리는 것을 안 막는다 — 어느 방송에도 안 나가는 곡이 생긴다')
  const 상수 = 읽기('src/components/admin/sections/musicManagementConst.js')
  assert.ok(/bgm:\s*\{ cat: 'bgm'/.test(상수))
})

test('여섯 자리가 같은 목록 부품을 쓴다 — 폴더 이름을 코드에 적은 칩이 없다', () => {
  const 고르개 = 벗김(읽기('src/components/shared/BgmSourcePicker.jsx'))
  assert.ok(/<select /.test(고르개), '고르개가 아래로 펼치는 목록이 아니다')
  assert.ok(!/BGM_SOURCES/.test(고르개), '고정 칩 목록이 남았다')
  for (const 파일 of ['src/components/easy/LocalBGMCard.jsx', 'src/components/shared/ScheduleModal.jsx',
    'src/components/shared/QuickSchedulePhrase.jsx', 'src/components/shared/FlowBuilder.jsx',
    'src/components/admin/sections/morningEditorParts.jsx']) {
    assert.ok(/<BgmSourcePicker/.test(읽기(파일)), `${파일} 가 공용 고르개를 안 쓴다`)
  }
  const 단계 = 벗김(읽기('src/components/admin/sections/StepList.jsx'))
  assert.ok(/<BgmFolderSelect /.test(단계), '자동방송 단계 편집기가 같은 목록 부품을 안 쓴다')
  assert.ok(!/BGM_ROLE_OPTIONS/.test(단계), '자동방송 단계에 고정 이름 칩이 남았다')
})

test('음성 설정 — 음높이·Azure 목소리는 Azure 가 맨 앞일 때만, 이 PC 목소리는 그 반대', () => {
  const src = 벗김(읽기('src/components/admin/sections/TTSSettings.jsx'))
  assert.ok(/\{azure앞 && <SliderRow label="음높이"/.test(src), '이 PC 음성인데 음높이 칸이 보인다 — 효과 없는 막대')
  assert.ok(/\{엔진 && !엔진\.error && azure앞 && \(/.test(src) && /<VoiceSelect label="일반 방송 음성"/.test(src), 'Azure 목소리 칸이 조건 없이 보인다')
  assert.ok(/\{엔진 && !엔진\.error && !azure앞 && \(/.test(src) && /id="tts-supertonic-sid"/.test(src), '이 PC 목소리 고르개가 없다')
  // 엔진 상태를 못 읽으면 「확인 중」에 멈추지 않고 그렇다고 말한다(화면 검수 Medium)
  assert.ok(/\{엔진\?\.error && <p /.test(src), '엔진 상태를 못 읽었을 때 목소리 칸이 「확인 중」에 멈춘다')
  assert.ok(/saveTTSSettings\(\{[\s\S]*?\bsupertonicSid,[\s\S]*?\}\)/.test(src), '저장할 때 이 PC 목소리를 안 보낸다')
  assert.ok(/sentencePauseMs: pauseMs/.test(src), '저장할 때 문장 사이 쉼을 안 보낸다')
  assert.ok(/sid: supertonicSid/.test(src), '미리듣기가 고른 목소리를 안 싣는다 — 저장 전에 비교해 들을 수 없다')
  const 카드 = 벗김(읽기('src/components/admin/sections/ttsEngineChoice.jsx'))
  assert.ok(/onState\?\.\(\{ primary: 상태\.primary, front:/.test(카드), '엔진 카드가 실제 맨 앞 엔진을 알려 주지 않는다')
  assert.ok(/onState\?\.\(\{ error: true \}\)/.test(카드), '엔진 카드가 못 읽은 것을 알리지 않는다')
})

test('곡 넣으러 가는 길이 그 BGM 폴더로 곧장 열린다 — 음원 자리에 올려 안 나가는 곡이 생기지 않게(화면 검수 High)', async () => {
  const { bgmUploadPathFor, BGM_UPLOAD_PATH } = await import('../../src/lib/bgmFolders.js').catch(() => ({}))
  // bgmFolders.js 는 React 를 불러 node 에서 못 읽을 수 있다 — 그러면 소스로 본다.
  if (bgmUploadPathFor) {
    assert.equal(bgmUploadPathFor(12), '/upload?cat=bgm&folder=12&from=picker')
    assert.equal(BGM_UPLOAD_PATH, '/upload?cat=bgm')
  } else {
    const lib = 읽기('src/lib/bgmFolders.js')
    assert.ok(/\/upload\?cat=bgm&folder=/.test(lib), '폴더로 곧장 여는 길이 없다')
  }
  const 고르개 = 벗김(읽기('src/components/shared/BgmSourcePicker.jsx'))
  assert.ok(/to=\{bgmUploadPathFor\(/.test(고르개), '고르개 링크가 그 폴더로 안 간다')
  const mm = 벗김(읽기('src/components/admin/sections/MusicManagement.jsx'))
  assert.ok(/useState\(주소첫자리\)/.test(mm) && /q\.get\('cat'\) !== 'bgm'/.test(mm), '업로드 화면이 주소의 폴더를 안 읽는다 — 늘 음원 자리에서 열린다')
  assert.ok(/badge=\{용도of\(f\.id\) \? '기본' : null\}/.test(mm), '기본 폴더를 색으로만 구분한다')
})
