import { ROLES, TARGET_TYPES } from '../constants'
import { majority } from './liar'

export interface UserRow {
  id: string
  name: string
  team_id: string | null
  role: string | null
  is_voted?: boolean
  room_id?: string | null
  is_alive?: boolean
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

/** 팀별로 역할을 무작위 배정한다. (보스, 마피아, 오른팔, 트롤 각 1명, 나머지는 시민) */
export function assignMafiaRoles(teams: TeamRow[], users: UserRow[]): { id: string; role: string }[] {
  const updates: { id: string; role: string }[] = []
  
  for (const team of teams) {
    const members = users.filter((u) => u.team_id === team.id)
    if (members.length === 0) continue
    
    // 팀원들을 무작위로 섞음
    const shuffled = [...members].sort(() => Math.random() - 0.5)
    
    // 역할 정의 (우선순위: BOSS > MAFIA > RIGHT_HAND > TROLL)
    const specialRoles = [ROLES.BOSS, ROLES.MAFIA, ROLES.RIGHT_HAND, ROLES.TROLL]
    
    shuffled.forEach((m, i) => {
      // 인덱스가 특수 역할 개수보다 작으면 해당 역할 부여, 아니면 시민
      let role: string = i < specialRoles.length ? specialRoles[i] : ROLES.CITIZEN
      updates.push({ id: m.id, role })
    })
  }
  return updates
}

/** 밤 사이의 처치 결과를 계산한다. */
export function processNightKills(users: UserRow[], votes: VoteRow[]): string[] {
  const killedIds: string[] = []
  
  // 마피아들이 지목한 대상들
  const killVotes = votes.filter(v => v.target_type === TARGET_TYPES.MAFIA_KILL)
  const targets = killVotes.map(v => v.candidate_id).filter(Boolean) as string[]
  
  for (const targetId of targets) {
    const targetUser = users.find(u => u.id === targetId)
    if (!targetUser || targetUser.is_alive === false) continue
    
    if (targetUser.role === ROLES.BOSS) {
      // 보스가 지목됨 -> 같은 팀의 오른팔이 살아있는지 확인
      const rightHand = users.find(u => 
        u.team_id === targetUser.team_id && 
        u.role === ROLES.RIGHT_HAND && 
        u.is_alive !== false && 
        !killedIds.includes(u.id)
      )
      
      if (rightHand) {
        killedIds.push(rightHand.id)
      } else {
        killedIds.push(targetUser.id)
      }
    } else {
      killedIds.push(targetId)
    }
  }
  
  // 중복 제거 및 실제로 살아있는 사람만 죽임
  return Array.from(new Set(killedIds))
}

/** 투표로 가장 많이 지목된 사람을 찾음 (재판 후보) */
export function getExecutionCandidate(votes: VoteRow[]): string | null {
  const nominationVotes = votes
    .filter(v => v.target_type === TARGET_TYPES.EXECUTION_NOMINATION)
    .map(v => v.candidate_id)
  
  return majority(nominationVotes)
}

/** 재판 결과 (찬성이 절반 이상인지) */
export function isExecuted(votes: VoteRow[], candidateId: string, totalAliveCount: number): boolean {
  const agreementVotes = votes.filter(v =>
    v.target_type === TARGET_TYPES.EXECUTION_AGREEMENT &&
    v.candidate_id === candidateId
  )

  return agreementVotes.length >= totalAliveCount / 2
}

/** 승리 조건을 체크한다. */
export function checkMafiaVictory(users: UserRow[]): { winnerTeamId: string | 'TROLL' | null } {
  // 1. 트롤 승리 체크 (죽은 사람 중 트롤이 있는데, 투표로 죽었는지는 외부에서 판단해야 함)
  // 사실 checkMafiaVictory는 상태 변화 직후에 호출되므로, 
  // 방금 죽은 사람이 트롤인지 확인하는 로직이 필요함.
  
  // 보스 생존 여부 확인
  const teams = Array.from(new Set(users.map(u => u.team_id).filter(Boolean))) as string[]
  const aliveBosses = users.filter(u => u.role === ROLES.BOSS && u.is_alive !== false)
  
  const teamsWithAliveBoss = new Set(aliveBosses.map(u => u.team_id))
  
  if (teams.length > 0) {
    if (teamsWithAliveBoss.size === 1) {
        // 한 팀의 보스만 남음 -> 그 팀 승리
        return { winnerTeamId: Array.from(teamsWithAliveBoss)[0] }
    } else if (teamsWithAliveBoss.size === 0) {
        // 모든 보스 사망 (동시 사망 시 처리 등은 기획에 없으므로 일단 null)
        return { winnerTeamId: null }
    }
  }

  return { winnerTeamId: null }
}
