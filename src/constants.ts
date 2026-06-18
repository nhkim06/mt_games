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
  PLAYING: 'PLAYING', // 게임 진행(역할 확인 + 라이어 지목 투표 / 마피아 밤)
  RESULT: 'RESULT', // 결과 공개(라이어 제시어 입력 / 마피아 아침 결과)
  FINISHED: 'FINISHED', // 게임 종료
  
  // 마피아 전용 상태 (필요 시 세분화)
  MAFIA_NIGHT: 'MAFIA_NIGHT',
  MAFIA_MORNING: 'MAFIA_MORNING',
  MAFIA_PLATFORM: 'MAFIA_PLATFORM'
} as const

export const ROOM_STATUS_LABELS: Record<string, string> = {
  WAITING: '대기중',
  PLAYING: '게임중',
  RESULT: '결과확인',
  FINISHED: '종료',
  MAFIA_NIGHT: '밤',
  MAFIA_MORNING: '아침',
  MAFIA_PLATFORM: '재판'
}

// 역할
export const ROLES = {
  // 공통
  CITIZEN: 'CITIZEN',
  
  // 라이어
  LIAR: 'LIAR',
  
  // 마피아
  BOSS: 'BOSS',
  MAFIA: 'MAFIA',
  RIGHT_HAND: 'RIGHT_HAND',
  TROLL: 'TROLL'
} as const

// 지목 대상 / 투표 종류
export const TARGET_TYPES = {
  // 라이어
  OWN_TEAM: 'OWN_TEAM',
  OPPONENT_TEAM: 'OPPONENT_TEAM',
  LIAR_GUESS: 'LIAR_GUESS',
  
  // 마피아
  MAFIA_KILL: 'MAFIA_KILL',
  RANDOM_QUESTION: 'RANDOM_QUESTION',
  EXECUTION_NOMINATION: 'EXECUTION_NOMINATION',
  EXECUTION_AGREEMENT: 'EXECUTION_AGREEMENT'
} as const

// 기본 팀 구성
export const TEAM_NAMES = ['cpu', 'gpu', 'ram', 'cache'] as const

// 게임 시작에 필요한 "준비 완료" 인원 수
export const READY_THRESHOLD = 1

// 포인트 정책
export const SCORES = {
  // 라이어
  OWN_LIAR: 10,
  OPPONENT_LIAR_SOLO: 20,
  LIAR_GUESS: 30,
  
  // 마피아
  BOSS_KILL: 10, // 상대 팀 보스 처치
  TROLL_WIN: 20  // 트롤 승 (트롤이 투표로 죽음)
}

// 안내 문구
export const MESSAGES = {
  RESET_CONFIRM: '방을 초기화하면 같은 방의 모든 인원이 로비로 이동합니다. 진행하시겠습니까?',
  LEAVE_CONFIRM: '방에서 나가시겠습니까?',
  START_NEED_MEMBERS: '게임을 시작하려면 두 팀 모두 최소 1명 이상이 필요합니다.',
  END_CONFIRM: '게임을 종료하시겠습니까?'
}

// 마피아 밤 질문 리스트
export const MAFIA_QUESTIONS = [
  '가장 웃긴 사람을 고르시오',
  '가장 이상한 사람을 고르시오',
  '첫인상이 가장 좋았던 사람을 고르시오',
  '가장 마피아 같은 사람을 고르시오',
  '가장 말을 잘할 것 같은 사람을 고르시오',
  '끝까지 살아남을 것 같은 사람을 고르시오'
]

export const PREFERRED_TEAM_KEY = 'preferred_team_name'
