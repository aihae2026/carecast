// 현장 PC의 설정을 다른 PC의 "기초 설정"으로 심는다.
//
// 왜 필요했나(2026-08-30, 사용자 지적): `server/db/`는 gitignore라 PC를 옮기면 따라오지
// 않는다. 그래서 개발 PC의 DB는 사실상 비어 있고, 예약(환기방송 포함)·연속 방송 흐름이
// **한 번도 있던 적이 없다.** 그런데 화면은 그걸 "없어졌다"로 보여준다.
// 같은 뿌리로 최소 세 번 헛걸음했다 — 백로그 유실(08-29), BGM 안 나옴, 환기방송 없어짐.
// 매번 원인만 다시 찾고 고치지는 않았다. 이 파일이 그 고침이다.
//
// 규칙 하나, 그리고 그게 전부다: **이미 값이 있으면 절대 덮어쓰지 않는다.**
// `importEnvSettings.js`가 쓰는 규칙과 같다. 그래야
//   · 현장 PC에서 돌아도 아무 일이 안 일어나고(현장 값이 진실이다)
//   · 개발 PC에서 손으로 바꿔 둔 값이 서버 재시작마다 되돌아가지 않는다.
//
// 무엇을 안 가져오는지는 scripts/make-site-baseline.cjs가 정한다 — 뽑는 시점에 거른다.
// 여기까지 온 JSON에는 비밀키가 없다는 전제이고, 그 전제는 그 스크립트와
// server/test/site-baseline.test.js가 지킨다.
'use strict'

const fs   = require('fs')
const path = require('path')

const BASELINE_PATH = path.join(__dirname, 'site-baseline.json')

/** 옮기지 않을 열을 뺀 사본. 구조분해로 버리면 "안 쓰는 변수"가 되고, 무엇을 왜 빼는지도 안 보인다. */
function without(row, keys) {
  const out = {}
  for (const [k, v] of Object.entries(row)) if (!keys.includes(k)) out[k] = v
  return out
}

function load(file = BASELINE_PATH) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    console.warn('[기초설정] 파일을 읽지 못했습니다(기동은 계속):', e.message)
    return null
  }
}

/** settings — 아직 없는 키만 채운다 */
function seedSettings(db, settings) {
  if (!settings) return 0
  let n = 0
  const has = db.prepare('SELECT 1 FROM settings WHERE key = ?')
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries(settings)) {
    if (has.get(key)) continue        // 있는 값은 손대지 않는다
    put.run(key, String(value))
    n++
  }
  return n
}

/**
 * 표 하나를 통째로 심는다 — **비어 있을 때만.**
 * 한 행이라도 있으면 건너뛴다. 반쯤 채워진 표에 덧붙이면 중복 예약이 생기고,
 * 그건 어르신이 같은 방송을 두 번 듣는다는 뜻이다.
 */
function seedTable(db, table, rows, { remap } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return 0
  let existing
  try {
    existing = db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c
  } catch {
    return 0                          // 그 표가 없는 버전이면 조용히 넘어간다
  }
  if (existing > 0) return 0

  let n = 0
  for (const row of rows) {
    const mapped = remap ? remap(row) : row
    if (!mapped) continue
    const cols = Object.keys(mapped)
    if (cols.length === 0) continue
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    try {
      db.prepare(sql).run(...cols.map(c => mapped[c]))
      n++
    } catch (e) {
      // 한 행이 안 들어간다고 나머지를 버리지 않는다 — 스키마가 조금 다를 수 있다
      console.warn(`[기초설정] ${table} 한 행 건너뜀: ${e.message}`)
    }
  }
  return n
}

/**
 * 기동 시 1회. 비어 있는 것만 채운다.
 * @returns {object} 심은 개수 요약. 파일이 없으면 null
 */
function applyBaseline(db, file = BASELINE_PATH) {
  const data = load(file)
  if (!data) return null

  const done = {}
  try {
    done.settings = seedSettings(db, data.settings)

    // 흐름은 부모(flow_sequences)의 id를 자식(steps)이 참조한다. 부모를 먼저 넣고
    // **새로 받은 id로 자식을 다시 연결한다** — 옛 id를 그대로 쓰면 엉뚱한 흐름에 붙는다.
    const idMap = new Map()
    if (Array.isArray(data.flow_sequences) && data.flow_sequences.length) {
      let empty = true
      try { empty = db.prepare('SELECT COUNT(*) c FROM flow_sequences').get().c === 0 } catch { empty = false }
      if (empty) {
        const put = db.prepare('INSERT INTO flow_sequences (name, created_at, updated_at) VALUES (?, ?, ?)')
        for (const f of data.flow_sequences) {
          const now = new Date().toISOString()
          const newId = put.run(f.name, f.created_at || now, f.updated_at || now).lastInsertRowid
          idMap.set(f.id, newId)
        }
        done.flow_sequences = idMap.size
        done.flow_sequence_steps = seedTable(db, 'flow_sequence_steps', data.flow_sequence_steps, {
          remap: (s) => {
            const parent = idMap.get(s.flow_sequence_id)
            if (!parent) return null
            // id는 새 DB가 다시 매긴다
            return { ...without(s, ['id']), flow_sequence_id: parent }
          },
        })
      }
    }

    // 예약도 흐름 id를 참조한다 — 같은 이유로 새 id로 갈아 끼운다
    done.schedules = seedTable(db, 'schedules', data.schedules, {
      remap: (s) => {
        // last_fired는 남의 PC의 "오늘 나갔다" 기록이다 — 가져오면 오늘 방송이 안 나간다
        const rest = without(s, ['id', 'last_fired'])
        if (rest.flow_sequence_id != null) {
          const parent = idMap.get(rest.flow_sequence_id)
          if (!parent) return null      // 흐름이 없으면 그 예약은 아무 소리도 못 낸다
          rest.flow_sequence_id = parent
        }
        return rest
      },
    })

    for (const t of ['favorites']) {
      done[t] = seedTable(db, t, data[t], { remap: (row) => without(row, ['id']) })
    }
  } catch (e) {
    console.warn('[기초설정] 심기 실패(기동은 계속):', e.message)
  }
  return done
}

module.exports = { applyBaseline, seedSettings, seedTable, BASELINE_PATH }
