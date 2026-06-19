<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../supabase'
import { useAuthStore } from '../stores/auth'
import { ROOM_STATUS, ROLES, TARGET_TYPES, MESSAGES, MAFIA_QUESTIONS } from '../constants'
import { subscribeRoom } from '../lib/realtime'
import {
  processNightKills,
  getExecutionCandidate,
  isExecuted,
  checkMafiaVictory
} from '../game/mafia'

const props = defineProps<{ roomId: string }>()
const router = useRouter()
const authStore = useAuthStore()
const roomId = props.roomId

const room = ref<any>(null)
const teams = ref<any[]>([])
const users = ref<any[]>([])
const votes = ref<any[]>([])
const loading = ref(true)

const selection = ref('')
const submitting = ref(false)
const roleVisible = ref(false)
const nightQuestion = ref('')
const scores = ref<Record<string, number>>({})

const me = computed(() => users.value.find((u) => u.id === authStore.user?.id))
const myRole = computed(() => me.value?.role)
const isAlive = computed(() => me.value?.is_alive !== false)
const hasVoted = computed(() => !!me.value?.is_voted)

const aliveUsers = computed(() => users.value.filter(u => u.is_alive !== false))

// 밤 전환 시 room.secret_word(마피아 게임에서는 미사용 컬럼)에 저장해 둔 사망자 목록을 읽는다.
const nightKilledIds = computed<string[]>(() => {
  if (room.value?.status !== ROOM_STATUS.MAFIA_MORNING) return []
  return (room.value.secret_word || '').split(',').filter(Boolean)
})

const executionCandidateId = computed(() => {
  if (room.value?.status !== ROOM_STATUS.MAFIA_PLATFORM) return null
  return getExecutionCandidate(votes.value)
})

const executionCandidate = computed(() => 
  users.value.find(u => u.id === executionCandidateId.value)
)

const isMyTeamWinner = computed(() => {
  if (!room.value || room.value.status !== ROOM_STATUS.FINISHED) return false
  
  const winnerTeamId = room.value.secret_word
  if (winnerTeamId) {
    return me.value?.team_id === winnerTeamId
  }
  
  const aliveBosses = users.value.filter(u => u.role === ROLES.BOSS && u.is_alive !== false)
  const teamsWithAliveBoss = Array.from(new Set(aliveBosses.map(u => u.team_id).filter(Boolean)))
  
  if (teamsWithAliveBoss.length === 1) {
    return me.value?.team_id === teamsWithAliveBoss[0]
  }
  
  return false
})

const winnerTeam = computed(() => {
  if (!room.value || room.value.status !== ROOM_STATUS.FINISHED) return null
  
  const winnerTeamId = room.value.secret_word
  if (winnerTeamId) {
    return teams.value.find(t => t.id === winnerTeamId) || null
  }
  
  const aliveBosses = users.value.filter(u => u.role === ROLES.BOSS && u.is_alive !== false)
  const teamsWithAliveBoss = Array.from(new Set(aliveBosses.map(u => u.team_id).filter(Boolean)))
  
  if (teamsWithAliveBoss.length === 1) {
    return teams.value.find(t => t.id === teamsWithAliveBoss[0]) || null
  }
  
  return null
})

const fetchData = async () => {
  const [{ data: roomData }, { data: settingsData }] = await Promise.all([
    supabase.from('room').select('*').eq('id', roomId).maybeSingle(),
    supabase.from('settings').select('*')
  ])
  
  if (!roomData) {
    alert('방이 초기화되었습니다.')
    router.replace({ name: 'lobby' })
    return
  }
  room.value = roomData
  
  const newScores: Record<string, number> = {}
  settingsData?.forEach(s => newScores[s.key] = s.value)
  scores.value = newScores

  if (roomData.status === ROOM_STATUS.WAITING) {
    router.replace({ name: 'room', params: { id: roomId } })
    return
  }

  const [{ data: teamData }, { data: userData }, { data: voteData }] = await Promise.all([
    supabase.from('team').select('*').order('team_name'),
    supabase.from('user').select('*').eq('room_id', roomId),
    supabase
      .from('votes')
      .select('*')
      .eq('room_id', roomId)
      .eq('round', roomData.current_round)
  ])
  
  teams.value = (teamData || []).filter(t => 
    (userData || []).some(u => u.team_id === t.id)
  )
  users.value = userData || []
  votes.value = voteData || []
  loading.value = false

  if (roomData.category) {
    nightQuestion.value = roomData.category
  }

  if (roomData.status === ROOM_STATUS.MAFIA_NIGHT) await resolveIfAllVotedNight()
  if (roomData.status === ROOM_STATUS.MAFIA_MORNING) await resolveIfAllVotedMorning()
  if (roomData.status === ROOM_STATUS.MAFIA_PLATFORM) await resolveIfAllVotedPlatform()
}

const finishWithWinner = async (winnerTeamId: string, points: number) => {
  const { data: currentTeams } = await supabase.from('team').select('id, score')
  const team = (currentTeams || []).find((t) => t.id === winnerTeamId)
  if (team) {
    await supabase.from('team').update({ score: team.score + points }).eq('id', team.id)
  }
  await supabase.from('room').update({ status: ROOM_STATUS.FINISHED, secret_word: winnerTeamId }).eq('id', roomId)
}

const advanceToNight = async (fromStatus: string) => {
  const nextQuestion = MAFIA_QUESTIONS[Math.floor(Math.random() * MAFIA_QUESTIONS.length)]
  const { data: claimed } = await supabase
    .from('room')
    .update({
      status: ROOM_STATUS.MAFIA_NIGHT,
      current_round: room.value.current_round + 1,
      category: nextQuestion,
      secret_word: null
    })
    .eq('id', roomId)
    .eq('status', fromStatus)
    .select()

  if (claimed && claimed.length > 0) {
    await supabase.from('votes').delete().eq('room_id', roomId)
    await supabase.from('user').update({ is_voted: false }).eq('room_id', roomId)
  }
}

const resolveIfAllVotedNight = async () => {
  const allVoted = aliveUsers.value.length > 0 && aliveUsers.value.every((u) => u.is_voted)
  if (!allVoted) return

  const nightKills = processNightKills(users.value, votes.value)

  const { data: claimed } = await supabase
    .from('room')
    .update({ status: ROOM_STATUS.MAFIA_MORNING, secret_word: nightKills.join(',') })
    .eq('id', roomId)
    .eq('status', ROOM_STATUS.MAFIA_NIGHT)
    .select()

  if (claimed && claimed.length > 0) {
    if (nightKills.length > 0) {
      await supabase.from('user').update({ is_alive: false }).in('id', nightKills)
    }
    await supabase.from('user').update({ is_voted: false }).eq('room_id', roomId)

    const { data: latestUsers } = await supabase.from('user').select('*').eq('room_id', roomId)
    const victory = checkMafiaVictory(latestUsers || [])
    if (victory.winnerTeamId) {
      await finishWithWinner(victory.winnerTeamId, scores.value['score_boss_kill'] || 10)
    }
  }
}

const resolveIfAllVotedMorning = async () => {
  const allVoted = aliveUsers.value.length > 0 && aliveUsers.value.every((u) => u.is_voted)
  if (!allVoted) return

  const { data: claimed } = await supabase
    .from('room')
    .update({ status: ROOM_STATUS.MAFIA_PLATFORM })
    .eq('id', roomId)
    .eq('status', ROOM_STATUS.MAFIA_MORNING)
    .select()

  if (claimed && claimed.length > 0) {
    await supabase.from('user').update({ is_voted: false }).eq('room_id', roomId)
  }
}

const resolveIfAllVotedPlatform = async () => {
  const candidateId = executionCandidateId.value
  if (!candidateId) {
    await advanceToNight(ROOM_STATUS.MAFIA_PLATFORM)
    return
  }

  const allVoted = aliveUsers.value.length > 0 && aliveUsers.value.every((u) => u.is_voted)
  if (!allVoted) return

  const executed = isExecuted(votes.value, candidateId, aliveUsers.value.length)
  const executedUser = users.value.find((u) => u.id === candidateId)

  const { data: claimed } = await supabase
    .from('room')
    .update({ status: 'PROCESSING_PLATFORM' as any })
    .eq('id', roomId)
    .eq('status', ROOM_STATUS.MAFIA_PLATFORM)
    .select()

  if (!claimed || claimed.length === 0) return

  if (executed) {
    await supabase.from('user').update({ is_alive: false }).eq('id', candidateId)
    if (executedUser?.role === ROLES.TROLL && executedUser.team_id) {
      await finishWithWinner(executedUser.team_id, scores.value['score_troll_win'] || 20)
      return
    }
  }

  const { data: latestUsers } = await supabase.from('user').select('*').eq('room_id', roomId)
  const victory = checkMafiaVictory(latestUsers || [])
  if (victory.winnerTeamId) {
    await finishWithWinner(victory.winnerTeamId, scores.value['score_boss_kill'] || 10)
    return
  }

  await advanceToNight('PROCESSING_PLATFORM')
}

const ROLE_LABELS: Record<string, string> = {
  [ROLES.BOSS]: '보스',
  [ROLES.MAFIA]: '마피아',
  [ROLES.RIGHT_HAND]: '오른팔',
  [ROLES.TROLL]: '트롤',
  [ROLES.CITIZEN]: '시민'
}
const getRoleLabel = (role: string | null | undefined) =>
  (role && ROLE_LABELS[role]) || '??????'

const submitAction = async (targetType: string, candidateId: string | null) => {
  if (submitting.value || !authStore.user) return
  submitting.value = true
  try {
    await supabase.from('votes').insert({
      room_id: roomId,
      round: room.value.current_round,
      voter_id: authStore.user.id,
      voter_team_id: me.value?.team_id ?? null,
      target_type: targetType,
      candidate_id: candidateId
    })
    await supabase.from('user').update({ is_voted: true }).eq('id', authStore.user.id)
    selection.value = ''
    await fetchData()
  } catch (e) {
    console.error(e)
    alert('제출 중 오류가 발생했습니다.')
  } finally {
    submitting.value = false
  }
}

const resetRoom = async () => {
  if (!confirm(MESSAGES.RESET_CONFIRM)) return
  await supabase
    .from('user')
    .update({ room_id: null, team_id: null, role: null, is_voted: false })
    .eq('room_id', roomId)
  await supabase.from('room').delete().eq('id', roomId)
  router.replace({ name: 'lobby' })
}

const goLobby = async () => {
  if (authStore.user) {
    await supabase
      .from('user')
      .update({ room_id: null, team_id: null, role: null, is_voted: false })
      .eq('id', authStore.user.id)
    authStore.user.room_id = undefined
    authStore.user.team_id = undefined
    authStore.user.role = null
  }
  router.replace({ name: 'lobby' })
}

let unsubscribe: (() => void) | null = null
let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  fetchData()
  unsubscribe = subscribeRoom(roomId, () => fetchData())
  poll = setInterval(fetchData, 3000)
})
onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  if (poll) clearInterval(poll)
})

</script>

<template>
  <div :class="['flex-1 flex flex-col w-full transition-colors duration-500', room?.status === ROOM_STATUS.MAFIA_NIGHT ? 'bg-gray-900' : 'bg-gray-50']">
    <div class="flex-1 flex flex-col p-6 max-w-2xl mx-auto w-full">
      <div v-if="loading" class="flex-1 flex items-center justify-center py-20">
        <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
      </div>

      <template v-else>
        <div :class="['rounded-2xl shadow-sm border p-5 mb-6 flex justify-between items-center', room.status === ROOM_STATUS.MAFIA_NIGHT ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white text-gray-800']">
          <div>
            <span class="text-xs font-black text-indigo-400 bg-indigo-900/30 px-2 py-1 rounded uppercase block w-fit mb-1">ROUND {{ room.current_round }} · {{ room.status === ROOM_STATUS.MAFIA_NIGHT ? '밤 🌙' : '낮 ☀️' }}</span>
            <h1 class="text-xl font-black">{{ room.status === ROOM_STATUS.MAFIA_NIGHT ? '조용히 행동하십시오...' : '토론하고 투표하세요' }}</h1>
          </div>
          <button @click="resetRoom" class="text-xs font-bold text-red-400 hover:text-red-600 border border-red-100/20 px-2 py-1.5 rounded-lg transition-all">리셋</button>
        </div>

        <div :class="['rounded-3xl shadow-xl p-8 mb-8 text-center text-white transition-all duration-300 relative overflow-hidden', !roleVisible ? 'bg-gray-800' : (myRole === ROLES.MAFIA || myRole === ROLES.BOSS ? 'bg-rose-700' : 'bg-indigo-700')]">
          <button @click="roleVisible = !roleVisible" class="absolute top-4 right-4 bg-white/20 hover:bg-white/30 p-2 rounded-full transition-colors">
            <svg v-if="roleVisible" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
            </svg>
            <svg v-else class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
          <h2 class="text-sm opacity-80 mb-2">당신의 역할</h2>
          <template v-if="!roleVisible">
            <h3 class="text-4xl font-black mb-4 tracking-tighter opacity-20">??????</h3>
            <p class="text-gray-400 text-sm">터치하여 역할을 확인하세요</p>
          </template>
          <template v-else>
            <h3 class="text-4xl font-black mb-4 tracking-tighter animate-in zoom-in-95">{{ getRoleLabel(myRole) }}</h3>
            <p v-if="!isAlive" class="text-rose-200 font-bold uppercase tracking-widest">[사망함]</p>
            <p v-else class="text-white/80 text-sm">
                <span v-if="myRole === ROLES.BOSS">보스가 죽으면 상대팀 승으로 게임은 끝난다.</span>
                <span v-if="myRole === ROLES.MAFIA">밤마다 1명씩 처치한다.</span>
                <span v-if="myRole === ROLES.RIGHT_HAND">1회 보스 대신 죽는다.</span>
                <span v-if="myRole === ROLES.TROLL">투표로 죽으면 당신의 팀이 승리합니다.</span>
                <span v-if="myRole === ROLES.CITIZEN">마피아를 찾아내 처형하세요.</span>
            </p>
          </template>
        </div>

        <div v-if="room.status === ROOM_STATUS.MAFIA_NIGHT" class="space-y-6">
          <div v-if="!hasVoted" class="space-y-6">
            <div class="bg-gray-800 border border-gray-700 rounded-2xl p-6 text-white">
                <h3 class="text-indigo-400 font-bold mb-2">밤의 임무</h3>
                <template v-if="myRole === ROLES.MAFIA">
                    <p class="text-xl font-black">처치할 대상을 선택하십시오.</p>
                    <p v-if="nightQuestion" class="text-sm text-gray-400 mt-2">오늘의 질문: {{ nightQuestion }}</p>
                </template>
                <p v-else class="text-xl font-black">{{ nightQuestion || '참여자를 선택하십시오.' }}</p>
            </div>
            
            <div class="grid grid-cols-2 gap-3">
                <button v-for="user in aliveUsers" :key="user.id" 
                    @click="selection = user.id"
                    :class="['py-4 px-4 rounded-2xl font-bold transition-all border-2', 
                        selection === user.id ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-gray-800 border-gray-700 text-gray-400']">
                    {{ user.name }} {{ user.id === authStore.user?.id ? '(나)' : '' }}
                </button>
            </div>

            <button @click="submitAction(myRole === ROLES.MAFIA ? TARGET_TYPES.MAFIA_KILL : TARGET_TYPES.RANDOM_QUESTION, selection)"
                :disabled="!selection || submitting"
                class="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white text-lg font-black rounded-2xl shadow-lg disabled:opacity-50">
                제출하기
            </button>
          </div>
          <div v-else class="bg-gray-800 border border-gray-700 rounded-2xl p-12 text-center text-white">
            제출 완료! 아침을 기다리는 중...
          </div>
        </div>

        <div v-else-if="room.status === ROOM_STATUS.MAFIA_MORNING" class="space-y-6">
          <div class="bg-white border rounded-2xl p-6 shadow-sm">
            <h3 class="text-lg font-black mb-4">어젯밤의 결과</h3>
            <ul v-if="nightKilledIds.length > 0" class="space-y-2">
                <li v-for="id in nightKilledIds" :key="id" class="text-rose-600 font-bold flex items-center gap-2">
                    <span class="w-2 h-2 bg-rose-600 rounded-full"></span>
                    {{ users.find(u => u.id === id)?.name }}님이 사망했습니다.
                </li>
            </ul>
            <p v-else class="text-green-600 font-bold">어젯밤에는 아무도 죽지 않았습니다.</p>
          </div>

          <div v-if="!hasVoted" class="space-y-6">
            <h2 class="text-lg font-black flex items-center gap-2">처형할 사람을 고르시오</h2>
            <div class="grid grid-cols-2 gap-3">
                <button v-for="user in aliveUsers" :key="user.id" 
                    @click="selection = user.id"
                    :class="['py-4 px-4 rounded-2xl font-bold transition-all border-2', 
                        selection === user.id ? 'bg-indigo-600 border-indigo-200 text-white' : 'bg-white border-gray-100 text-gray-700']">
                    {{ user.name }}
                </button>
            </div>
            <button @click="submitAction(TARGET_TYPES.EXECUTION_NOMINATION, selection)"
                :disabled="!selection || submitting"
                class="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white text-lg font-black rounded-2xl shadow-lg disabled:opacity-50">
                투표 제출
            </button>
          </div>
          <div v-else class="bg-white border rounded-2xl p-12 text-center text-gray-500">
            투표 완료! 재판 결과를 기다리는 중...
          </div>
        </div>

        <div v-else-if="room.status === ROOM_STATUS.MAFIA_PLATFORM" class="space-y-6">
          <div v-if="!executionCandidateId" class="bg-white border rounded-2xl p-12 text-center">
            <p class="text-xl font-black mb-2">동표이거나 투표가 없습니다.</p>
            <p class="text-gray-500">재판 없이 밤이 됩니다...</p>
          </div>
          <div v-else class="space-y-6">
            <div class="bg-amber-50 border-2 border-amber-200 rounded-3xl p-8 text-center">
                <p class="text-amber-600 font-black mb-2 tracking-widest uppercase">재판 단상</p>
                <h3 class="text-4xl font-black text-gray-800 mb-4">{{ executionCandidate?.name }}</h3>
                <p class="text-gray-600">이 사람을 처형하는 것에 찬성하십니까?</p>
            </div>

            <div v-if="!hasVoted" class="grid grid-cols-4 gap-4">
                <button @click="submitAction(TARGET_TYPES.EXECUTION_AGREEMENT, executionCandidateId!)"
                    :disabled="submitting"
                    class="col-span-2 py-6 bg-rose-600 text-white rounded-2xl font-black text-2xl shadow-lg shadow-rose-200 active:scale-95">찬성</button>
                <button @click="submitAction(TARGET_TYPES.EXECUTION_AGREEMENT, null as any)"
                    :disabled="submitting"
                    class="col-span-2 py-6 bg-gray-400 text-white rounded-2xl font-black text-2xl shadow-lg shadow-gray-200 active:scale-95">반대</button>
            </div>
            <div v-else class="bg-white border rounded-2xl p-12 text-center text-gray-500">
                의견을 제출했습니다. 결과를 기다리는 중...
            </div>
          </div>
        </div>

        <div v-else-if="room.status === ROOM_STATUS.FINISHED" class="space-y-6 text-center">
          <h2 class="text-4xl font-black mb-4">게임 종료 🏁</h2>
          <div class="bg-white border rounded-3xl p-10 mb-6">
              <p v-if="me?.team_id" :class="[isMyTeamWinner ? 'text-green-600' : 'text-rose-600', 'font-black text-2xl mb-4']">
                {{ isMyTeamWinner ? '우리팀 승리! 🎉' : '우리팀 패배... 😢' }}
              </p>
              <p v-else class="text-indigo-600 font-black text-xl mb-4">
                게임 종료! (우승팀: {{ winnerTeam?.team_name || '알 수 없음' }})
              </p>
              <div class="grid grid-cols-2 gap-4">
                  <div v-for="team in teams" :key="team.id" class="p-4 rounded-2xl bg-gray-50">
                      <p class="text-xs text-gray-400 font-bold mb-1">{{ team.team_name }}</p>
                      <p class="text-2xl font-black">{{ team.score }}</p>
                  </div>
              </div>
          </div>
          <button @click="goLobby" class="w-full py-4 bg-indigo-600 text-white text-lg font-black rounded-2xl shadow-lg">로비로 돌아가기</button>
        </div>

        <div class="mt-8">
            <h3 class="text-xs font-black text-gray-400 mb-3 uppercase tracking-widest">참여자 상태</h3>
            <div class="grid grid-cols-2 gap-2">
                <div v-for="user in users" :key="user.id" 
                    :class="['px-3 py-2 rounded-xl text-sm font-bold flex items-center justify-between', 
                        user.is_alive === false ? 'bg-gray-200 text-gray-400 line-through' : 'bg-white border border-gray-100 text-gray-700']">
                    <span>{{ user.name }}</span>
                    <span v-if="user.is_alive === false" class="text-[10px] bg-gray-300 text-white px-1.5 py-0.5 rounded ml-2">DEAD</span>
                    <span v-else-if="user.is_voted" class="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded ml-2">VOTED</span>
                </div>
            </div>
        </div>
      </template>
    </div>
  </div>
</template>
