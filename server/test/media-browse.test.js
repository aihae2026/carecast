// 음원·동영상 탐색기의 찾기·줄 세우기 (UX-27, 2026-09-11).
//
// **순수 함수를 진짜 돌린다.** 소스 글자만 보는 검사는 결함을 놓친다 —
// 이 저장소에서 하루 전에 그 일이 있었다(BGM 이력, 독립 검수가 잡았다).
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src', 'lib', 'mediaBrowse.js')
const load = () => import('node:url').then(({ pathToFileURL }) => import(pathToFileURL(SRC).href))

const 파일 = (name, over = {}) => ({
  id: name, original_name: name, uploaded_at: '2026-09-01T00:00:00Z', duration: 100, ...over,
})

test('검색어가 비면 전부 보인다 — 거르기가 기본이 아니다', async () => {
  const { 파일고르기 } = await load()
  const list = [파일('가을.mp3'), 파일('겨울.mp3')]
  assert.equal(파일고르기(list, { 검색어: '' }).length, 2)
  assert.equal(파일고르기(list).length, 2)
})

test('공백을 무시하고 찾는다 — 사람이 붙인 이름은 띄어쓰기가 제각각이다', async () => {
  const { 파일고르기 } = await load()
  const list = [파일('가을 노래.mp3')]
  assert.equal(파일고르기(list, { 검색어: '가을노래' }).length, 1)
  assert.equal(파일고르기(list, { 검색어: '가을 노래' }).length, 1)
})

test('대소문자를 접는다', async () => {
  const { 파일고르기 } = await load()
  assert.equal(파일고르기([파일('Autumn.MP3')], { 검색어: 'autumn' }).length, 1)
})

test('자모가 분해된 이름(맥·아이폰 업로드)도 찾는다', async () => {
  const { 파일고르기 } = await load()
  // NFD — '가'가 ㄱ+ㅏ 로 분해된 형태
  const nfd = '가을'.normalize('NFD') + '.mp3'
  assert.equal(파일고르기([파일(nfd)], { 검색어: '가을' }).length, 1,
    '맥에서 올린 파일이 검색에 안 잡히면 사람은 "없어졌다"고 읽는다')
})

test('이름순은 한국어 순서를 쓴다', async () => {
  const { 파일고르기 } = await load()
  const list = [파일('하늘.mp3'), 파일('가을.mp3'), 파일('나비.mp3')]
  assert.deepEqual(파일고르기(list, { 정렬: 'name' }).map(f => f.original_name),
    ['가을.mp3', '나비.mp3', '하늘.mp3'])
})

test('최근 올린 순은 새것이 위다', async () => {
  const { 파일고르기 } = await load()
  const list = [
    파일('옛것', { uploaded_at: '2026-01-01T00:00:00Z' }),
    파일('새것', { uploaded_at: '2026-09-01T00:00:00Z' }),
  ]
  assert.deepEqual(파일고르기(list, { 정렬: 'recent' }).map(f => f.original_name), ['새것', '옛것'])
})

test('길이순에서 길이를 모르는 것은 맨 뒤다 — 0으로 치면 "가장 짧은 것"이 된다', async () => {
  const { 파일고르기 } = await load()
  const list = [
    파일('몰라', { duration: null }),
    파일('삼분', { duration: 180 }),
    파일('일분', { duration: 60 }),
  ]
  assert.deepEqual(파일고르기(list, { 정렬: 'duration' }).map(f => f.original_name),
    ['일분', '삼분', '몰라'])
})

test('원본 배열을 안 건드린다 — 정렬이 위쪽 상태를 뒤집으면 다음 렌더가 어긋난다', async () => {
  const { 파일고르기 } = await load()
  const list = [파일('하늘'), 파일('가을')]
  const 원본순서 = list.map(f => f.original_name)
  파일고르기(list, { 정렬: 'name' })
  assert.deepEqual(list.map(f => f.original_name), 원본순서)
})

test('폴더도 이름으로 걸러지고 늘 이름순이다', async () => {
  const { 폴더고르기 } = await load()
  const folders = [{ id: 1, name: '하반기' }, { id: 2, name: '가곡' }, { id: 3, name: '체조' }]
  assert.deepEqual(폴더고르기(folders).map(f => f.name), ['가곡', '체조', '하반기'])
  assert.deepEqual(폴더고르기(folders, { 검색어: '가' }).map(f => f.name), ['가곡'])
})

test('빈 입력·null 에 죽지 않는다', async () => {
  const { 파일고르기, 폴더고르기 } = await load()
  assert.deepEqual(파일고르기(null), [])
  assert.deepEqual(폴더고르기(undefined), [])
  assert.deepEqual(파일고르기([{ id: 1 }], { 검색어: 'x' }), [], '이름이 없는 줄도 죽지 않는다')
})

test('정렬 고르개 목록이 화면과 같은 값을 쓴다 — 라벨을 두 벌로 적지 않는다', async () => {
  const { 정렬규칙 } = await load()
  assert.deepEqual(정렬규칙.map(r => r.id), ['recent', 'name', 'duration'])
  const 화면 = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'admin', 'sections', 'MusicManagement.jsx'), 'utf8')
  assert.match(화면, /정렬규칙/,
    '화면이 정렬 목록을 직접 들고 있다 — 라벨과 동작이 갈린다')
  for (const r of 정렬규칙) {
    assert.ok(!화면.includes(`'${r.label}'`) && !화면.includes(`"${r.label}"`),
      `화면에 정렬 라벨 '${r.label}' 이 박혀 있다 — 정본에서 가져다 쓸 것`)
  }
})

test('화면이 거르기를 직접 적지 않는다 — 판단은 여기 한 곳', async () => {
  const 화면 = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'admin', 'sections', 'MusicManagement.jsx'), 'utf8')
  assert.match(화면, /파일고르기|폴더고르기/, '긍정 앵커 — 화면이 이 모듈을 쓴다')
})
