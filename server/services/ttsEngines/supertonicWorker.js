// Supertonic 3 합성 프로세스 — `supertonic.js` 가 fork 로 띄운다. **이 파일을 require 하지 말 것.**
//
// 왜 따로 도는 프로세스인가(2026-09-21 구조 검토 High):
//   · sherpa-onnx 의 `generate()` 는 **동기**다. 실시간의 0.22배라 30초 문안이면 6~7초 동안
//     서버의 이벤트 루프가 멎는다 — SSE·마이크 스트림·「재생 끝」 보고·cron·합성 시간 상한 타이머까지.
//     (scratchpad 실측: 이 프로세스에서 합성하는 동안 부모의 20ms 타이머 최대 틈 31ms.)
//   · 네이티브 애드온이 죽어도(segfault) **방송 서버는 살아 있다.** 부모가 다시 띄운다.
//   · 모델은 여기서 **한 번** 적재한다(0.8~1.3초). 요청마다 적재하지 않는다.
//
// 주고받는 말(IPC):
//   부모 → { id, text, speed, out }
//   자식 → { ready: true } | { ready: false, error }            (적재 결과, 처음 한 번)
//          { id, ok: true, durationSec } | { id, ok: false, error }
'use strict'

const path = require('path')
const fs = require('fs')

// 화자·단계는 **사용자가 정한 값**이다(2026-09-21 지시서: 현장에서 10명 비교 뒤 sid 1 확정 — 임의로 바꾸지 말 것).
// 2026-09-22: 설정에서 화자를 고를 수 있다(사용자 결정) — SID 는 **기본값**이고, 부모가 보낸 sid 가 이긴다.
const SID = 1
const NUM_STEPS = 8

const 모델파일 = {
  durationPredictor: 'duration_predictor.int8.onnx',
  textEncoder:       'text_encoder.int8.onnx',
  vectorEstimator:   'vector_estimator.int8.onnx',
  vocoder:           'vocoder.int8.onnx',
  ttsJson:           'tts.json',
  unicodeIndexer:    'unicode_indexer.bin',
  voiceStyle:        'voice.bin',
}

function 적재(modelDir) {
  const sherpa = require('sherpa-onnx-node')
  const supertonic = {}
  for (const [k, f] of Object.entries(모델파일)) supertonic[k] = path.join(modelDir, f)
  const tts = new sherpa.OfflineTts({
    model: { supertonic, numThreads: 2, debug: 0, provider: 'cpu' },
    maxNumSentences: 1,
  })
  return { sherpa, tts }
}

if (require.main === module) {
  let 엔진 = null
  try {
    엔진 = 적재(process.env.CARECAST_TTS_MODEL_DIR)
    process.send({ ready: true })
  } catch (e) {
    process.send({ ready: false, error: e.message })
    process.exit(1)
  }
  process.on('message', (m) => {
    try {
      const speed = Number(m.speed) > 0 ? Number(m.speed) : 1
      // 화자는 부모가 정해 보낸 것(0~9)만 쓴다 — 여기서 설정을 다시 읽으면 캐시 열쇠와 갈린다. 없으면 기본 SID.
      const sid = Number.isInteger(m.sid) && m.sid >= 0 && m.sid <= 9 ? m.sid : SID
      // 합성 단계 — 부모가 정해 보낸 것(미리 만들기는 고음질). 없으면 기본 단계. 캐시 열쇠(소금)와 같은 값이어야 한다.
      const numSteps = Number.isInteger(m.numSteps) && m.numSteps >= 1 && m.numSteps <= 64 ? m.numSteps : NUM_STEPS
      // 문장 사이 쉼(ms) — 엔진의 silenceScale 은 효과가 없어(실측) 문장을 나눠 만들고 무음을 끼운다(domain/ttsSentences).
      const 쉼 = Number.isInteger(m.pauseMs) && m.pauseMs > 0 && m.pauseMs <= 2000 ? m.pauseMs : 0
      const 한번 = (t) => {
        const a = 엔진.tts.generate({ text: t, sid, speed, generationConfig: { sid, speed, numSteps, extra: { lang: 'ko' } } })
        if (!a || !a.samples || !a.samples.length) throw new Error('합성 결과가 비었다')
        return a
      }
      const 문장들 = 쉼 ? require('../../domain/ttsSentences').문장나누기(m.text) : []
      let samples, sampleRate, 구간 = null
      if (문장들.length > 1) {
        const 조각 = []; 구간 = []; let 길이 = 0
        for (const [i, 문장] of 문장들.entries()) {
          const a = 한번(문장)
          sampleRate = a.sampleRate
          if (i > 0) { const 무음 = new Float32Array(Math.round(sampleRate * 쉼 / 1000)); 조각.push(무음); 길이 += 무음.length }
          구간.push([길이 / sampleRate, (길이 + a.samples.length) / sampleRate])
          조각.push(a.samples); 길이 += a.samples.length
        }
        samples = new Float32Array(길이)
        let at = 0
        for (const c of 조각) { samples.set(c, at); at += c.length }
      } else {
        const a = 한번(String(m.text))
        samples = a.samples; sampleRate = a.sampleRate
      }
      // writeWave 는 16비트 PCM 모노로 쓴다(실측: audioFormat 1 · 16bit · 44100Hz).
      fs.mkdirSync(path.dirname(m.out), { recursive: true })
      엔진.sherpa.writeWave(m.out, { samples, sampleRate })
      process.send({ id: m.id, ok: true, durationSec: samples.length / sampleRate, ...(구간 ? { 구간 } : {}) })
    } catch (e) {
      process.send({ id: m.id, ok: false, error: e.message })
    }
  })
  // 부모가 사라지면 따라 끝난다 — 고아 프로세스가 모델을 물고 남지 않게.
  process.on('disconnect', () => process.exit(0))
}

module.exports = { 모델파일, SID, NUM_STEPS }
