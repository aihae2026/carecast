// 스케줄 방송용 임시 오디오 파일 저장소 (메모리)
// 스케줄러가 생성한 MP3를 ID로 보관하다가, 브라우저가 조회 시 경로를 반환하고 제거
const { randomUUID } = require('crypto')
const fs             = require('fs')

// id → { path, timer }
const store = new Map()

// 오디오 파일 등록 → ID 반환 (30분 후 자동 만료·삭제)
function storeAudio(filePath) {
  const id    = randomUUID()
  const timer = setTimeout(() => {
    const entry = store.get(id)
    if (entry) {
      try { fs.unlinkSync(entry.path) } catch { /* 만료된 임시 파일 청소 — 이미 지워졌어도 목표(파일 없음)는 달성이다 */ }
      store.delete(id)
    }
  }, 30 * 60 * 1000)
  // 이 청소 타이머가 프로세스를 붙잡지 않게 한다. 서버는 http 서버 때문에 어차피 살아 있고,
  // 프로세스가 끝나는 마당에는 청소할 것도 없다. 안 하면 테스트가 30분짜리 타이머를 기다린다.
  timer.unref?.()
  store.set(id, { path: filePath, timer })
  return id
}

// ID로 파일 경로를 꺼내고 저장소에서 제거 (1회 소비)
function consumeAudio(id) {
  const entry = store.get(id)
  if (!entry) return null
  clearTimeout(entry.timer)
  store.delete(id)
  return entry.path
}

module.exports = { storeAudio, consumeAudio }
