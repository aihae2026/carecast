// 업로드된 음원이 사는 곳 — **경로의 단일 출처**.
//
// 2026-09-05까지 같은 경로를 네 곳이 각자 계산했다: routes/audio.js(AUDIO_DIR) ·
// scripts/caption-draft.cjs(ROOT 기준으로 다시) · db/schema.js(카테고리 폴더 만들기) ·
// index.js(정적 서빙). 넷이 같은 값을 뱉는 동안에는 아무 일도 없지만, 한 곳을 옮기면
// **나머지가 조용히 다른 데를 본다** — 파일은 A에 저장되고 서빙은 B에서 찾는 식이라
// 오류 대신 404와 무음이 난다.
//
// 왜 domain/인가: **이 파일이** 아무것도 안 부른다(path 하나뿐). db/schema.js가 이 값을 쓰는데
// db/는 services/를 부르면 안 되므로(route-wiring.test.js), db/가 안심하고 부를 수 있으려면
// 그 상대가 부서를 안 물고 있어야 한다. domain/broadcastDefaults.js가 같은 이유로 그 자리에 산다.
//
// ⚠ **"domain/은 전부 잎 층"이라는 뜻이 아니다.** 실제로 stepHistory.js는 최상위에서,
// volume.js·broadcastEstimate.js·broadcastScheduleRead.js는 함수 안에서 services/를 부른다.
// 그래서 db/가 domain/의 아무 파일이나 불러도 되는 것은 아니다 — 부르는 그 파일이 무엇을
// 물고 있는지 봐야 한다. 새로 최상위에서 services/를 부르는 것은 route-wiring.test.js가 막는다.
'use strict'

const path = require('path')

// server/domain/ 에서 두 칸 올라가면 server/ 다.
const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio')

/** 그 카테고리의 폴더. 업로드도 읽기도 이 함수를 쓴다. */
const audioCategoryDir = (category) => path.join(AUDIO_DIR, String(category))

/** 그 파일의 자리. 카테고리 폴더 아래에 원래 이름 그대로 있다. */
const audioFilePath = (category, filename) => path.join(AUDIO_DIR, String(category), String(filename))

module.exports = { AUDIO_DIR, audioCategoryDir, audioFilePath }
