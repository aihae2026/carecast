// BGM 자동재생 스케줄러 — 식사 시간대 BGM / 식전 안내 자동 실행
const crypto          = require('crypto')
const { broadcastSSE } = require('./sse')

function getSetting(db, key, def = '') { return rawSetting(db, key) ?? def }

// settings 쓰기는 domain/settingsRead 한 곳을 쓴다 — 같은 upsert가 8곳에 복사돼 있었다(TD-05).
const { rawSetting, writeSetting: setSetting } = require('../domain/settingsRead')

// HH:MM 시간에서 minutes 분을 뺀 시간 반환
function subtractMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number)
  let total    = ((h * 60 + m - minutes) % 1440 + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const MEALS = [
  { key: 'morning', prayerCat: 'morning-prayer', defStart: '07:00', defEnd: '08:30' },
  { key: 'lunch',   prayerCat: 'lunch-prayer',   defStart: '11:50', defEnd: '12:40' },
  { key: 'dinner',  prayerCat: 'dinner-prayer',  defStart: '17:50', defEnd: '18:40' },
]

async function checkBGMSchedule(db, current, today) {
  for (const { key, prayerCat, defStart, defEnd } of MEALS) {
    const enabled = getSetting(db, `bgm_${key}_enabled`, 'false')
    if (enabled !== 'true') continue

    const startTime = getSetting(db, `bgm_${key}_start`, defStart)
    const endTime   = getSetting(db, `bgm_${key}_end`,   defEnd)
    if (!startTime || !endTime) continue

    // BGM 시작 — **식사용 BGM** 폴더에서 그 용도의 기본 순서로(2026-09-21 사용자 지시:
    // 클래식은 식사용). 예전엔 bgm 재생목록 전체를 보내 방송용(happy) 곡이 식사 중에 섞였다.
    if (current === startTime && getSetting(db, `bgm_${key}_start_fired`) !== today) {
      const 고른것 = require('./localBgm').로컬BGM고르기(db, { role: 'meal' })
      if (고른것.ok) {
        broadcastSSE('bgm_start', {
          meal:    key,
          files:   고른것.files,
          eventId: crypto.randomBytes(4).toString('hex'),
        })
        setSetting(db, `bgm_${key}_start_fired`, today)
        console.log(`[BGM] ${key} BGM 시작 (${startTime}) — ${고른것.folderName} ${고른것.files.length}곡(${고른것.order})`)
      } else {
        // 조용히 넘어가지 않는다. 표시는 남긴다 — 안 남기면 같은 1분 동안 틱마다 같은 경고가 찍힌다.
        setSetting(db, `bgm_${key}_start_fired`, today)
        console.warn(`[BGM] ${key} BGM 시작 못 함 (${startTime}): ${고른것.사유}`)
      }
    }

    // BGM 종료
    if (current === endTime && getSetting(db, `bgm_${key}_end_fired`) !== today) {
      broadcastSSE('bgm_stop', { meal: key })
      setSetting(db, `bgm_${key}_end_fired`, today)
      console.log(`[BGM] ${key} BGM 종료 (${endTime})`)
    }

    // 식전 안내 방송
    const prayerEnabled = getSetting(db, `bgm_${key}_prayer_enabled`, 'false')
    if (prayerEnabled !== 'true') continue

    const offset     = parseInt(getSetting(db, `bgm_${key}_prayer_offset`, '5')) || 5
    const prayerTime = subtractMinutes(startTime, offset)

    if (current === prayerTime && getSetting(db, `bgm_${key}_prayer_fired`) !== today) {
      // 관리자가 지정한 파일 또는 카테고리 첫 번째 파일 사용
      const fileId     = getSetting(db, `bgm_${key}_prayer_file_id`, '')
      let prayerFile   = fileId
        ? db.prepare('SELECT * FROM audio_files WHERE id = ?').get(parseInt(fileId))
        : null
      if (!prayerFile) {
        // 지정이 없으면 관리 화면의 「지금 나가는 파일」과 **같은 함수**로 고른다. 예전엔 올린 순
        // 첫 번째를 직접 골라서, 재생목록 순서를 바꾼 현장에선 화면 표시와 실제로 나가는 파일이
        // 갈렸다 — 표시된 파일의 자막을 고쳐도 식전 안내엔 옛 자막이 떴다(2026-11-01 현장 보고).
        prayerFile = require('../domain/categoryPick').pickCategoryFile(db, prayerCat, 0)
      }

      if (prayerFile) {
        // **주소는 그 파일이 실제로 있는 카테고리로 만든다.** 예전엔 상수 prayerCat을 썼는데,
        // 파일은 id로 고르므로 관리자가 다른 카테고리 파일을 지정하면 없는 곳을 가리켰다
        // (음원은 public/audio/<카테고리>/ 아래에 저장된다) → 404 무음. 게다가 바로 아래에서
        // "오늘 나감"을 찍어서 그날 식전 안내는 영영 안 나가고 기록상으로는 나간 것이 됐다(CC-030).
        broadcastSSE('prayer_play', {
          meal:  key,
          url:   `/audio/${prayerFile.category || prayerCat}/${prayerFile.filename}`,
          name:  prayerFile.original_name,
          token: crypto.randomBytes(8).toString('hex'),
          // 화면이 이 값으로 자막을 찾는다. 없으면 소리만 나가고 자막이 안 뜬다.
          audioFileId: prayerFile.id,
        })
        setSetting(db, `bgm_${key}_prayer_fired`, today)
        console.log(`[BGM] ${key} 식전 안내 방송 (${prayerTime})`)
      } else {
        // 예전엔 여기서 아무 일도 안 일어났다 — 로그 한 줄도 없이 그날 식전 안내가 사라졌다.
        // "오늘 나감"은 찍지 않는다(안 나간 것을 나갔다고 적으면 이력이 거짓말을 한다).
        const msg = `${key} 식전 음원을 찾을 수 없어 식전 음원 방송이 나가지 않았습니다.`
        console.error(`[BGM] ${msg}`)
        try { require('./alert').raise('식전 안내', msg, { meal: key }) }
        catch (e) { console.error('[BGM] 경보 전달 실패:', e.message) }
      }
    }
  }
}

module.exports = { checkBGMSchedule }
