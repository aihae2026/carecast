// 즐겨찾기 버튼 — **방송설정 갈래의 제 화면** (사용자 지시 2026-09-13).
//
// *"방송설정에 차라리 음량 및 TTS설정 넣어주고 즐겨찾기 넣어줘"*.
//
// 그전에는 「시스템 설정」 안의 카드 하나였다. 그런데 이것은 **시스템 설정이 아니다** —
// 직원이 간편 화면에서 한 번 눌러 내보내는 문구를 정하는 자리라, 방송을 어떻게 내보낼지의
// 일부다. 「시스템 설정」은 서버·업데이트·자동종료 같은 **기계 쪽**이고, 여기는 방송 쪽이다.
// 찾는 사람이 "방송설정"에서 찾게 된다.
//
// 편집기 자체는 **옮기지 않고 그대로 쓴다**(`SystemSettings` 의 `FavoritesEditor`).
// 옮기면 저장·삭제·개수 제한을 다시 옮겨야 하고, 그때 한쪽만 고쳐질 자리가 생긴다.
import { FavoritesEditor } from './SystemSettings'

export default function FavoritesSection() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="t-section text-ds-v3-ink">즐겨찾기 버튼</h1>
        <p className="t-sub text-ds-v3-ink-2 mt-1">
          간편 화면에서 한 번 눌러 바로 내보내는 버튼입니다. 최대 4개까지 둘 수 있습니다.
        </p>
      </div>
      <FavoritesEditor />
    </div>
  )
}
