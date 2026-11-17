# 함께 쓰는 것들의 라이선스와 이용 조건

CareCast 가 함께 담거나 부르는 외부 프로그램·모델·서비스의 출처와 조건을 모은 문서입니다.
설치판에는 이 문서와 `licenses/` 폴더가 함께 들어갑니다. (2026-09-21 작성)

## 0. CareCast 자체 — 코드 Apache-2.0 · 문서·프롬프트 CC BY 4.0

CareCast 의 소스 코드는 **Apache License 2.0** 으로 공개합니다. **Copyright 2026 jung-svg.**
전문은 저장소 맨 위 [`LICENSE`](LICENSE), 저작권·함께 쓰는 것의 고지는 [`NOTICE`](NOTICE)에 있습니다.
Apache-2.0 은 **CareCast 코드에만** 적용됩니다 — 아래 모델·데이터·프로그램은 각자의 조건을 따르며,
특히 음성 모델(1절)은 **이용 제한이 있는 별도 라이선스**입니다.

**자체 작성한 안내 문서와 프롬프트에는 CC BY 4.0 을 적용합니다**(크리에이티브 커먼즈 저작자표시 4.0 국제).
대상은 `README.md`·`docs/` 의 안내서(이용자·관리자 매뉴얼, 도입 안내, 백업 안내 등)와 화면 안내 문구,
그리고 AI 에 보내는 지시문(프롬프트 — 예: `server/domain/broadcastPrompt.js`, `server/services/gemini*.js`)입니다.
출처(CareCast · 해뜨는마을 · 저장소 주소)와 고친 경우 고쳤다는 사실을 밝히면 상업적 이용·수정을 포함해 자유롭게 쓸 수 있습니다.
소스 파일 안에 든 프롬프트는 그 코드와 함께 Apache-2.0 도 적용되며, 둘 중 어느 조건으로든 쓸 수 있습니다.
전문 링크와 범위는 [`LICENSE-DOCS`](LICENSE-DOCS), 공식 안내는 <https://creativecommons.org/licenses/by/4.0/deed.ko>.
**외부 프로그램·모델·자료는 각자의 이용 조건을 따릅니다**(아래 1절부터).

설치한 기관은 처음 설정의 「이용 조건」 장이나 메뉴 → **라이선스 · 고지** 화면에서 이 조건에 동의하고,
같은 화면에서 **합성 음성 게시문을 인쇄**할 수 있습니다. 동의 버튼은 확인 기록입니다 — **안내 음성 모델의
이용 제한은 동의 여부와 관계없이, 이 프로그램으로 모델을 쓰는 모든 기관에 적용됩니다**(동의하지 않아도 방송은 나갑니다).
npm 부품 목록은 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) (`npm run notices` 로 다시 만든다).

---

## 1. 안내 음성 모델 — Supertonic 3 (기본 엔진)

| 항목 | 내용 |
|---|---|
| 무엇 | 글로 쓴 방송문을 이 PC 안에서 목소리로 바꾸는 음성 합성 모델(화자 sid 1) |
| 만든 곳 | Supertone Inc. — Copyright (c) 2026 Supertone Inc. |
| 원본 | <https://huggingface.co/Supertone/supertonic-3> · 코드 <https://github.com/supertone-inc/supertonic> |
| 받은 판 | `sherpa-onnx-supertonic-3-tts-int8-2026-05-11` (k2-fsa/sherpa-onnx 배포본, sha256 `82fa96f9…c427`) |
| **모델 가중치 라이선스** | **BigScience Open RAIL-M (2022-08-18)** — 전문: [`licenses/Supertonic-3-OpenRAIL-M.txt`](licenses/Supertonic-3-OpenRAIL-M.txt) |
| 예제 코드 라이선스 | MIT (모델 폴더의 `LICENSE` — 예제 코드에 대한 것이며 가중치에는 적용되지 않습니다) |
| 고친 것 | 받은 판은 원본을 k2-fsa(sherpa-onnx)가 ONNX int8 로 변환한 **파생본**입니다. CareCast 는 이 파일을 더 고치지 않습니다. |
| 관계 | Supertonic 은 Supertone Inc. 의 이름이며, CareCast 는 Supertone 과 관계가 없고 보증받지 않았습니다(상표 — 라이선스 제8조). 모델은 「있는 그대로」 제공되며 보증이 없습니다(제9조). |

라이선스 제7조는 **최신 판을 쓰도록 합리적으로 노력할 것**을 요구합니다. 판을 올릴 때는 `scripts/setup-tts.cjs` 의
이름·해시를 바꾸고, 라이선스 원문이 바뀌었는지 다시 확인합니다.

CareCast 와 함께 배포되는 Supertonic 3 모델은 Open RAIL-M 과 그 Attachment A 의 이용 제한을 지키는 조건으로만
쓸 수 있으며, **이 제한은 이 배포의 이용 조건에 그대로 포함됩니다**(구속 조건 원문은 [`NOTICE`](NOTICE)).

### 이용 제한 — 이 모델로 만든 음성을 **이렇게 쓰면 안 됩니다**

Open RAIL-M 은 모델과 그 산출물의 **용도를 제한**합니다(라이선스 전문 Attachment A). CareCast 를 설치해
쓰는 기관과 사람은 아래 제한을 지켜야 하며, **CareCast 를 다시 나눠 줄 때도 이 제한과 라이선스 전문을
함께 넘겨야 합니다**(라이선스 제5조·제4조).

모델 또는 그 파생물을 다음 용도로 쓰지 않습니다:

- (a) 법령을 어기는 일
- (b) 미성년자를 착취하거나 해치는 일
- (c) 남을 해칠 목적으로 거짓임이 확인된 정보를 만들거나 퍼뜨리는 일
- (d) 개인을 해치는 데 쓰일 수 있는 개인 식별 정보를 만들거나 퍼뜨리는 일
- (e) **기계가 만든 것임을 분명히 밝히지 않고** 생성물을 내보내는 일
- (f) 남을 헐뜯거나 괴롭히는 일
- (g) **동의 없이 다른 사람을 사칭하는 일**(딥페이크 포함)
- (h) 개인의 법적 권리에 불리한 완전 자동 결정
- (i)·(k) 사회적 행동·성격·법적으로 보호되는 특성에 따른 차별
- (j) **나이·신체·정신적 특성에 따른 취약성을 이용해** 사람의 행동을 해롭게 왜곡하는 일
- (l) **의료 조언이나 의료 결과 해석을 제공하는 일**
- (m) 사법·수사·출입국 절차에 쓰일 정보를 만드는 일

원문(영어)이 기준입니다 — 위 목록은 이해를 돕기 위한 요약입니다.

### 요양원에서 특히 지킬 것

- **합성 음성임을 알립니다((e)).** 안내 방송이 사람 목소리가 아니라 기계가 만든 목소리라는 것을 어르신과
  보호자께 알려 두세요 — **방송을 듣는 어르신이 알아볼 수 있게**(게시물이 기본, 입소 안내문은 함께). **뽑아 붙일 게시문 견본: [`docs/SYNTHETIC-VOICE-NOTICE.md`](docs/SYNTHETIC-VOICE-NOTICE.md).**
  Azure 음성을 쓸 때도 Microsoft 가 같은 고지를 요구합니다.
- **의료 조언을 방송하지 않습니다((l)).** 「약 드실 시간입니다」 같은 시간 알림은 조언이 아니지만,
  증상 판단·복약 지도·검사 결과 설명 같은 내용은 이 목소리로 방송하지 마세요.
- **동의 없이 다른 사람을 사칭하지 않습니다((g)).** 본인 동의 없이 특정 직원·가족이 직접 말하는 것처럼 꾸며 방송하지 마세요.
- **만든 음성의 책임은 쓰는 쪽에 있습니다.** 라이선스는 「Licensor claims no rights in the Output …
  You are accountable for the Output you generate and its subsequent uses」라고 적고 있습니다.

## 2. 음성 합성 엔진 라이브러리

| 이름 | 판 | 라이선스 | 비고 |
|---|---|---|---|
| sherpa-onnx-node · sherpa-onnx-win-x64 (k2-fsa) | 1.13.8 | Apache-2.0 | 설치판의 `server/node_modules` 에 들어 있음. npm 꾸러미에 LICENSE 파일이 없어 원본 저장소 v1.13.8 의 원문을 [`licenses/sherpa-onnx-1.13.8-LICENSE.txt`](licenses/sherpa-onnx-1.13.8-LICENSE.txt) 에 받아 두었다 |
| ONNX Runtime (`onnxruntime.dll`, Microsoft) | 1.28.2 (DLL 판 정보로 확인) | MIT | 위 꾸러미 안에 들어 있음. 원문 [`licenses/onnxruntime-1.28.2-LICENSE.txt`](licenses/onnxruntime-1.28.2-LICENSE.txt) · 제3자 고지 [`licenses/onnxruntime-1.28.2-ThirdPartyNotices.txt`](licenses/onnxruntime-1.28.2-ThirdPartyNotices.txt) |

sherpa-onnx 판을 올리면 `npm run notices` 가 실패한다 — 그 판의 원문을 다시 받아 `scripts/third-party-notices.cjs` 의
「확인한원문」 표를 고치라는 뜻이다(2026-10-07, Codex 3회차).

### 2-1. sherpa-onnx 실행 파일 안의 GPL-3.0 부품 — espeak-ng · piper-phonemize

| 이름 | 라이선스 | 들어 있는 곳 |
|---|---|---|
| espeak-ng (발음 변환) | **GPL-3.0** | `sherpa-onnx-win-x64` 의 `sherpa-onnx-c-api.dll` 안에 정적으로 묶여 있음(DLL 안에서 `espeak_Initialize`·`espeak-ng-data` 문자열로 확인, 2026-10-17) |
| piper-phonemize | MIT | 같은 DLL 안 |

sherpa-onnx 꾸러미는 스스로를 Apache-2.0 으로 밝히지만, 그 실행 파일에는 위 부품이 함께 들어 있습니다.
이 사실이 뜻하는 것:

- **CareCast 소스 코드는 Apache-2.0 그대로입니다.** 이 저장소에는 sherpa-onnx 실행 파일이 없습니다
  (`node_modules` 는 저장소에 들어 있지 않고 `npm install` 할 때 받습니다). 소스를 받아 쓰는 것만으로는 GPL 의무가 생기지 않습니다.
- **설치판(`CareCast-Setup.exe` 등 `server/node_modules` 를 담은 묶음)을 남에게 나눠 줄 때는 GPL-3.0 조건을 따라야 합니다.**
  Apache-2.0 코드는 GPL-3.0 묶음 안에 들어갈 수 있으므로(한 방향 호환) 묶음 자체는 가능하며, 나눠 주는 쪽은
  - GPL-3.0 전문과 「이 설치판에는 espeak-ng(GPL-3.0)가 들어 있다」는 고지를 함께 담고,
  - espeak-ng(및 그것을 묶은 sherpa-onnx 판)의 **대응 소스를 받을 수 있는 방법**을 함께 제공해야 합니다
    (상류 저장소 <https://github.com/espeak-ng/espeak-ng> · <https://github.com/k2-fsa/sherpa-onnx> v1.13.8 의 해당 판을 안내하거나 직접 함께 담는다).
- GPL-3.0 전문은 `licenses/GPL-3.0.txt` 에 있고(gnu.org 원문과 같은 바이트 — sha256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`),
  설치판 묶기 스크립트(`scripts/package-release.cjs`)가 이 파일이 들어갔는지 확인하고 빠지면 실패합니다.
  **대응 소스 안내는 위 상류 주소로 합니다** — 설치판을 공개 배포하는 쪽이 그 판을 계속 받을 수 있게 할 책임은 남습니다.

## 3. 그 밖의 안내 음성 엔진

| 이름 | 쓰는 방식 | 조건 |
|---|---|---|
| Azure AI Speech (선택) | 기관이 **자기** Azure 구독·키를 넣었을 때만 인터넷으로 부릅니다 | Microsoft 제품 약관 · [AI 서비스 행동 강령](https://learn.microsoft.com/legal/ai-code-of-conduct) — 합성 음성임을 알릴 것, 동의 없이 사람을 사칭하지 말 것(2026-09-22 원문 확인). 키는 그 기관의 것만 넣고 여러 기관이 한 키를 나눠 쓰지 않습니다(운영 원칙) |
| 윈도우 기본 음성 (SAPI, 예: Microsoft Heami) | 앞 엔진이 모두 실패했을 때만 이 PC 의 윈도우 음성으로 만듭니다 | 윈도우에 포함된 기능이며 CareCast 가 따로 나눠 주지 않습니다. 만든 소리는 그 PC 에서 트는 데만 쓰고 파일로 밖에 내보내지 않습니다 — 윈도우 사용권은 명시하지 않은 권리를 모두 Microsoft 에 남겨 두므로, 음성 파일을 따로 배포·판매하려면 별도 확인이 필요합니다 |

## 4. 설치판에 함께 담는 실행기

| 이름 | 라이선스 |
|---|---|
| Node.js (`runtime/node`) | MIT (Node.js 폴더의 `LICENSE`) |
| Python 임베디드 판 (`runtime/python`) | Python Software Foundation License |
| numpy | BSD-3-Clause |

## 4-1. 날씨·대기 자료

| 출처 | 자료 | 조건 |
|---|---|---|
| 기상청 | 단기예보 · 기상특보 · 생활기상지수 | 공공누리 제1유형(출처표시) · 생활기상지수는 이용허락범위 제한 없음 |
| 한국환경공단 에어코리아 | 대기오염정보(미세먼지) | 공공누리 제3유형(출처표시 · **변경금지**) — 등급을 다시 나누지 않습니다 |
| **Open-Meteo** | 기상청 자료를 못 받을 때의 보조 자료(기온·바람·습도·하늘) | 데이터 **CC BY 4.0** — 「Weather data by Open-Meteo.com」 링크로 출처 표시. **무료 API 는 비상업 이용만**(하루 1만·시간 5천·분 600회 미만). 상업적으로 쓰는 기관은 Open-Meteo 유료 API 계약이 필요합니다 |

Open-Meteo 조건은 2026-10-07 원문으로 확인했습니다(<https://open-meteo.com/en/licence> · <https://open-meteo.com/en/terms>).
출처는 관리 화면 **데이터 출처**·**라이선스 · 고지**에 링크로 밝힙니다. Open-Meteo 의 API 서버 코드(AGPLv3)는
CareCast 에 들어 있지 않습니다 — 인터넷으로 부르기만 합니다.

## 5. 배경음악·영상

배경음악과 영상은 CareCast 에 들어 있지 않습니다. **저작권이 확인된 음원만** 각 기관이 이 PC 에 직접
등록합니다(예: Pixabay 음원 — Pixabay Content License). 등록할 때 출처와 이용 조건을 함께 적어 두세요.

Pixabay 는 예시일 뿐이며 **CareCast 는 어떤 음원의 권리도 보증하지 않습니다.** Pixabay 음원을 쓸 때는

1. 곡 페이지 주소와 받은 날짜를 출처 칸에 남기고,
2. 방패(Content ID) 표시가 있는 곡은 라이선스 인증서를 함께 받아 두고,
3. 상표·로고·실존 인물이 든 곡은 피하고,
4. 받은 파일을 다른 기관이나 인터넷에 그대로 나눠 주지 않습니다(Pixabay 약관 5조 Standalone 금지).

약관은 바뀔 수 있으니 받을 때 <https://pixabay.com/service/terms/> 를 확인하세요. (2026-10-17 확인 — 그때 약관의
「Last updated」 는 2024-11-18)

## 6. 도입 기관이 확인할 것 — 법률 해석

아래는 CareCast 가 판단해 줄 수 없는 법률 해석입니다. 법률 자문이 아니며, **도입 기관이 직접(필요하면 전문가와) 확인**하세요.

- **시설 안 방송의 공연권** — Pixabay 약관과 FAQ 에는 공연·방송 조항이 없습니다. 저작권법 제29조 제2항과
  시행령 제11조의 공연권 대상 시설에 그 기관이 드는지, 쓰려는 곡의 저작자가 한국음악저작권협회(KOMCA) 같은
  신탁 단체 회원인지 확인합니다.
- **「인공지능 기본법」의 생성물 표시 의무** — 합성 음성 안내 방송에 표시 의무가 걸리는지, 걸린다면 기관(이용자)과
  배포자 중 누구에게 걸리는지 확인합니다. CareCast 는 라이선스가 요구하는 합성 음성 게시문(1절)을 제공하지만,
  그것이 법령상 표시 의무를 채우는지는 별개입니다.
- **합성 음성 고지의 방식** — 게시물만으로 라이선스 (e) 의 「expressly and intelligibly」를 채우는지는 해석의 문제입니다.
  하루 첫 방송 앞에 말로 한 번 알리는 방법을 권합니다([`docs/SYNTHETIC-VOICE-NOTICE.md`](docs/SYNTHETIC-VOICE-NOTICE.md) 3번).
