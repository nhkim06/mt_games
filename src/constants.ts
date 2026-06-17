// 게임 종류
export const GAME_TYPES = {
  LIAR: 'LIAR',
  MAFIA: 'MAFIA'
} as const

export const GAME_TYPE_LABELS: Record<string, string> = {
  LIAR: '라이어',
  MAFIA: '마피아'
}

// 방 상태
export const ROOM_STATUS = {
  WAITING: 'WAITING', // 대기룸
  PLAYING: 'PLAYING', // 게임 진행(역할 확인 + 라이어 지목 투표)
  RESULT: 'RESULT', // 결과 공개(라이어 제시어 입력)
  FINISHED: 'FINISHED' // 게임 종료
} as const

export const ROOM_STATUS_LABELS: Record<string, string> = {
  WAITING: '대기중',
  PLAYING: '게임중',
  RESULT: '결과확인',
  FINISHED: '종료'
}

// 역할
export const ROLES = {
  LIAR: 'LIAR',
  CITIZEN: 'CITIZEN'
} as const

// 라이어 지목 대상 / 투표 종류
export const TARGET_TYPES = {
  OWN_TEAM: 'OWN_TEAM',
  OPPONENT_TEAM: 'OPPONENT_TEAM',
  // 검거된 라이어의 제시어 제출 기록 (votes 테이블에 공유 상태로 저장)
  LIAR_GUESS: 'LIAR_GUESS'
} as const

// 기본 팀 구성
export const TEAM_NAMES = ['cpu', 'gpu', 'ram', 'cache'] as const

// 게임 시작에 필요한 "준비 완료" 인원 수
export const READY_THRESHOLD = 1

// 포인트 정책
export const SCORES = {
  OWN_LIAR: 10, // 우리팀 라이어 검거
  OPPONENT_LIAR_SOLO: 20, // 우리팀만 상대팀 라이어 검거 (두 팀 모두 맞추면 0)
  LIAR_GUESS: 30 // 라이어가 제시어를 맞춤
}

// 안내 문구
export const MESSAGES = {
  RESET_CONFIRM: '방을 초기화하면 같은 방의 모든 인원이 로비로 이동합니다. 진행하시겠습니까?',
  LEAVE_CONFIRM: '방에서 나가시겠습니까?',
  START_NEED_MEMBERS: '게임을 시작하려면 두 팀 모두 최소 1명 이상이 필요합니다.',
  END_CONFIRM: '게임을 종료하시겠습니까?'
}

export const PREFERRED_TEAM_KEY = 'preferred_team_name'
