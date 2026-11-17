import { useNavigate } from 'react-router-dom'
import { Volume2, Bot, Plug, Music2, Settings2, Sunrise } from 'lucide-react'
import HelpTip from '../shared/HelpTip'

const links = [
  { id: 'ttsSettings',     label: 'TTS 설정',  Icon: Volume2,   color: 'text-ds-v3-tts' },
  { id: 'aiSettings',      label: 'AI 설정',   Icon: Bot,       color: 'text-ds-v3-flow'  },
  { id: 'apiSettings',     label: 'API 연동',  Icon: Plug,      color: 'text-ds-v3-ink-3' },
  { id: 'morningEditor',   label: '방송 일정', Icon: Sunrise,   color: 'text-ds-v3-ink-2'  },
  { id: 'musicManagement', label: '배경음악',  Icon: Music2,    color: 'text-ds-v3-ink-2' },
  { id: 'systemSettings',  label: '시스템',    Icon: Settings2, color: 'text-ds-v3-ink-2'     },
]

// 우측: 상세 모드 설정 페이지 바로가기 그리드
export default function QuickSettingsNav() {
  const navigate = useNavigate()

  return (
    <div className="card-base">
      <h3 className="text-sm font-semibold text-ds-v3-ink mb-3 flex items-center gap-1.5">빠른 설정<HelpTip id="quickSettings" /></h3>
      <div className="grid grid-cols-3 gap-2">
        {links.map(({ id, label, Icon, color }) => (
          <button
            key={id}
            onClick={() => navigate(`/admin?section=${id}`)}
            className="flex flex-col items-center gap-1.5 py-3 bg-ds-v3-bg border border-ds-v3-line
                       rounded-[10px] hover:border-ds-v3-tts/40 hover:bg-ds-v3-tts-bg
                       btn-press transition-colors group min-h-[44px] min-w-[44px] laptop:min-h-[24px] laptop:min-w-[24px]"
          >
            <Icon size={20} className={`${color} group-hover:text-ds-v3-tts transition-colors`} />
            <span className="text-xs text-ds-v3-ink-2 group-hover:text-ds-v3-tts transition-colors text-center leading-tight">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
