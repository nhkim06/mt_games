import { ROLES, TARGET_TYPES, SCORES } from '../constants'
import { GAME_WORDS } from '../data/words'

export interface UserRow {
  id: string
  name: string
  team_id: string | null
  role: string | null
  is_voted?: boolean
  room_id?: string | null
}

export interface TeamRow {
  id: string
  team_name: string
  score: number
  room_id: string | null
}

export interface VoteRow {
  voter_id?: string | null
  voter_team_id: string | null
  target_type: string
  candidate_id: string | null
}

/** 다수결로 가장 많이 지목된 후보를 반환. 동률/무투표면 null. */
function majority(candidateIds: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const id of candidateIds) {
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  let tie = false
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id
      bestN = n
      tie = false
    } else if (n === bestN) {
      tie = true
    }
  }
  return tie ? null : best
}

export interface TeamResult {
  teamId: string
  oppTeamId: string | null
  /** 우리팀이 지목한 "우리팀 라이어" */
  ownDesignatedId: string | null
  ownLiarId: string | null
  ownCaught: boolean
  /** 우리팀이 지목한 "상대팀 라이어" */
  oppDesignatedId: string | null
  oppLiarId: string | null
  oppCaught: boolean
}

/** 투표 결과를 팀별 관점으로 계산한다. */
export function computeResults(teams: TeamRow[], users: UserRow[], votes: VoteRow[]): TeamResult[] {
  return teams.map((team) => {
    // 우리팀의 실제 라이어
    const ownLiar = users.find((u) => u.team_id === team.id && u.role === ROLES.LIAR) ?? null
    
    // 우리팀 사람들이 투표로 지목한 후보들 (다수결)
    const ownDesignatedId = majority(
      votes
        .filter((v) => v.voter_team_id === team.id && v.target_type === TARGET_TYPES.OWN_TEAM)
        .map((v) => v.candidate_id)
    )
    const oppDesignatedId = majority(
      votes
        .filter((v) => v.voter_team_id === team.id && v.target_type === TARGET_TYPES.OPPONENT_TEAM)
        .map((v) => v.candidate_id)
    )

    // 검거 여부 판단:
    // 1. 우리팀 검거: 우리팀이 지목한 사람이 우리팀의 실제 라이어인가?
    const ownCaught = !!ownLiar && ownDesignatedId === ownLiar.id

    // 2. 상대팀 검거: 우리팀이 지목한 사람이 '다른 팀'의 라이어인가?
    // (지목된 사람이 존재하고, 역할이 라이어이며, 우리팀 소속이 아닐 때 성공)
    const designatedUser = users.find(u => u.id === oppDesignatedId)
    const oppCaught = !!designatedUser && designatedUser.role === ROLES.LIAR && designatedUser.team_id !== team.id

    return {
      teamId: team.id,
      oppTeamId: null, // 이제 고정된 상대팀 하나가 아니므로 null 처리하거나 제거 고려
      ownDesignatedId,
      ownLiarId: ownLiar?.id ?? null,
      ownCaught,
      oppDesignatedId,
      oppLiarId: designatedUser?.role === ROLES.LIAR ? designatedUser.id : null,
      oppCaught
    }
  })
}

/**
 * 검거 점수(+10, +20) 산정.
 * - 우리팀 라이어 검거: +10
 * - 상대팀 라이어 검거: +20 (기존 로직: 우리팀만 맞췄을 때 20이었으나 기획에 따라 조정 가능)
 * 여기서는 '상대팀 라이어 검거' 성공 시 해당 팀에 점수를 부여하도록 수정.
 */
export function computeScoreDeltas(results: TeamResult[]): Record<string, number> {
  const deltas: Record<string, number> = {}
  for (const r of results) deltas[r.teamId] = 0

  for (const r of results) {
    // 우리팀 라이어 잡아냄 -> +10
    if (r.ownCaught) deltas[r.teamId] += SCORES.OWN_LIAR

    // 상대팀 라이어 잡아냄 -> +20
    // (기획: "우리팀만 상대팀 라이어 검거" 조건이 있으나 3팀 이상일 경우 복잡하므로 
    // 여기서는 지목한 상대가 실제 라이어면 점수를 주는 것으로 일단 구현)
    if (r.oppCaught) {
      // 다른 팀들도 이 라이어를 맞췄는지 확인 (독식 여부 판단 필요 시 추가 로직)
      // 일단은 맞추면 부여
      deltas[r.teamId] += SCORES.OPPONENT_LIAR_SOLO
    }
  }
  return deltas
}

/** 상대팀에게 검거당해 제시어를 맞춰야 하는 라이어들의 userId 목록. */
export function caughtLiarIds(results: TeamResult[]): string[] {
  return results.filter((r) => r.oppCaught && r.oppLiarId).map((r) => r.oppLiarId as string)
}

/** 모든 라이어의 userId 목록. */
export function getAllLiarIds(users: UserRow[]): string[] {
  return users.filter((u) => u.role === ROLES.LIAR).map((u) => u.id)
}

/** 어떤 라이어도 검거되지 않았는지(=라운드 재진행) */
export function noLiarCaught(results: TeamResult[]): boolean {
  return results.every((r) => !r.oppCaught)
}

/** 팀별로 1명씩 라이어를 무작위 배정한 user 업데이트 목록을 만든다. */
export function assignRoles(teams: TeamRow[], users: UserRow[]): { id: string; role: string }[] {
  const updates: { id: string; role: string }[] = []
  for (const team of teams) {
    const members = users.filter((u) => u.team_id === team.id)
    if (members.length === 0) continue
    const liarIdx = Math.floor(Math.random() * members.length)
    members.forEach((m, i) => {
      updates.push({ id: m.id, role: i === liarIdx ? ROLES.LIAR : ROLES.CITIZEN })
    })
  }
  return updates
}

/** 무작위 카테고리/제시어 선택. */
export function pickCategoryAndWord(): { category: string; secret_word: string } {
  const categories = Object.keys(GAME_WORDS)
  const category = categories[Math.floor(Math.random() * categories.length)]
  const words = GAME_WORDS[category]
  const secret_word = words[Math.floor(Math.random() * words.length)]
  return { category, secret_word }
}

/** 제시어 비교용 정규화: 앞뒤 공백 제거 + 모든 공백 제거. */
export function normalizeWord(s: string): string {
  return (s || '').trim().replace(/\s+/g, '')
}
