<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../supabase'
import { useAuthStore } from '../stores/auth'
import {
  ROOM_STATUS,
  GAME_TYPES,
  GAME_TYPE_LABELS,
  MESSAGES,
  READY_THRESHOLD,
  MAFIA_QUESTIONS
} from '../constants'
import { subscribeRoom } from '../lib/realtime'
import { assignRoles, pickCategoryAndWord } from '../game/liar'
import { assignMafiaRoles } from '../game/mafia'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const roomId = route.params.id as string

const room = ref<any>(null)
const teams = ref<any[]>([])
const users = ref<any[]>([])
const loading = ref(true)
const starting = ref(false)
const togglingReady = ref(false)

const me = computed(() => users.value.find((u) => u.id === authStore.user?.id))
// 대기룸에서는 is_voted 컬럼을 "준비 완료" 표시로 재사용한다.
const iAmReady = computed(() => !!me.value?.is_voted)
const readyCount = computed(() => users.value.filter((u) => u.is_voted).length)

const membersOf = (teamId: string) => users.value.filter((u) => u.team_id === teamId)
const isLiarGame = computed(() => room.value?.game_type === GAME_TYPES.LIAR)
const isMafiaGame = computed(() => room.value?.game_type === GAME_TYPES.MAFIA)
// 모든 참여자가 준비 완료를 눌러야 게임 시작 버튼이 활성화된다.
const canStart = computed(() => users.length > 0 && users.value.every((u) => u.is_voted))

const fetchData = async () => {
  const { data: roomData } = await supabase.from('room').select('*').eq('id', roomId).maybeSingle()
  if (!roomData) {
    alert('방이 존재하지 않습니다.')
    router.replace({ name: 'lobby' })
    return
  }
  room.value = roomData

  const [{ data: teamData }, { data: userData }] = await Promise.all([
    supabase.from('team').select('*').order('team_name'),
    supabase.from('user').select('*').eq('room_id', roomId)
  ])
  
  const currentUsers = userData || []
  const allTeams = teamData || []
  
  // 허용된 팀만 필터링
  if (roomData?.allowed_teams) {
    const allowedIds = roomData.allowed_teams.split(',')
    teams.value = allTeams.filter(t => allowedIds.includes(t.id))
  } else {
    teams.value = allTeams
  }
  const myData = currentUsers.find(u => u.id === authStore.user?.id)
  if (myData && !myData.team_id) {
    const { PREFERRED_TEAM_KEY } = await import('../constants')
    const preferred = localStorage.getItem(PREFERRED_TEAM_KEY)
    if (preferred) {
      const teamId = `team_${preferred}`
      await supabase.from('user').update({ team_id: teamId }).eq('id', authStore.user?.id)
      myData.team_id = teamId
      if (authStore.user) authStore.user.team_id = teamId
    }
  }

  users.value = currentUsers
  
  // 방에 이미 소속된 유저인지 확인
  const isMember = users.value.some(u => u.id === authStore.user?.id)

  // 게임이 시작된 방에 비멤버가 접근하면 로비로 튕김
  if (roomData.status !== ROOM_STATUS.WAITING && !isMember) {
    alert('이미 게임이 진행 중이거나 종료된 방입니다.')
    router.replace({ name: 'lobby' })
    return
  }

  // 기존 멤버인데 게임 중이면 게임 화면으로 이동
  const isGameInProgress = [
    ROOM_STATUS.PLAYING,
    ROOM_STATUS.RESULT,
    ROOM_STATUS.MAFIA_NIGHT,
    ROOM_STATUS.MAFIA_MORNING,
    ROOM_STATUS.MAFIA_PLATFORM
  ].includes(roomData.status)

  if (isGameInProgress && isMember) {
    router.replace({ name: 'game', params: { id: roomId } })
    return
  }

  loading.value = false
}

const toggleReady = async () => {
  if (togglingReady.value || !authStore.user) return
  if (!me.value?.team_id) {
    alert('먼저 팀을 선택해주세요.')
    return
  }
  togglingReady.value = true
  try {
    await supabase
      .from('user')
      .update({ is_voted: !iAmReady.value })
      .eq('id', authStore.user.id)
    await fetchData()
  } finally {
    togglingReady.value = false
  }
}

// 게임 시작: 준비 인원 충족 시에만 동작하며, 단 한 클라이언트만 시작 처리한다.
const startGame = async () => {
  if (starting.value || !canStart.value) return
  starting.value = true
  try {
    // 조건부 업데이트로 WAITING -> PLAYING 전환을 한 명만 성공시킨다.
    // 마피아는 밤부터 시작, 라이어는 PLAYING(낮)부터 시작
    const nextStatus = isMafiaGame.value ? ROOM_STATUS.MAFIA_NIGHT : ROOM_STATUS.PLAYING
    
    const { data: claimed } = await supabase
      .from('room')
      .update({ status: nextStatus })
      .eq('id', roomId)
      .eq('status', ROOM_STATUS.WAITING)
      .select()

    if (claimed && claimed.length > 0) {
      let roleUpdates: { id: string; role: string }[] = []
      
      if (isLiarGame.value) {
        const { category, secret_word } = pickCategoryAndWord()
        roleUpdates = assignRoles(teams.value, users.value)
        await supabase
          .from('room')
          .update({ category, secret_word, current_round: 1 })
          .eq('id', roomId)
      } else if (isMafiaGame.value) {
        const initialQuestion = MAFIA_QUESTIONS[Math.floor(Math.random() * MAFIA_QUESTIONS.length)]
        roleUpdates = assignMafiaRoles(teams.value, users.value)
        await supabase
          .from('room')
          .update({ current_round: 1, category: initialQuestion })
          .eq('id', roomId)
      }

      await Promise.all(
        roleUpdates.map((u) =>
          supabase.from('user').update({ 
            role: u.role, 
            is_voted: false, 
            is_alive: true 
          }).eq('id', u.id)
        )
      )
      await supabase.from('votes').delete().eq('room_id', roomId)
    }
  } catch (e) {
    console.error(e)
  } finally {
    starting.value = false
  }
}

const leaveRoom = async () => {
  if (!authStore.user) return
  if (!confirm(MESSAGES.LEAVE_CONFIRM)) return
  await supabase
    .from('user')
    .update({ room_id: null, team_id: null, role: null, is_voted: false })
    .eq('id', authStore.user.id)
  authStore.user.room_id = undefined
  authStore.user.team_id = undefined
  router.replace({ name: 'lobby' })
}

// 리셋: 같은 방 모든 인원을 내보내고 방 삭제 (constants의 안내 문구 사용)
const resetRoom = async () => {
  if (!confirm(MESSAGES.RESET_CONFIRM)) return
  await supabase
    .from('user')
    .update({ room_id: null, team_id: null, role: null, is_voted: false })
    .eq('room_id', roomId)
  await supabase.from('room').delete().eq('id', roomId) // team/votes는 ON DELETE CASCADE
  router.replace({ name: 'lobby' })
}

let unsubscribe: (() => void) | null = null
let poll: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  fetchData()
  unsubscribe = subscribeRoom(roomId, () => fetchData())
  // 리얼타임 미설정 환경 대비 폴링
  poll = setInterval(fetchData, 3000)
})
onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  if (poll) clearInterval(poll)
})
</script>

<template>
  <div class="flex-1 flex flex-col p-6 max-w-3xl mx-auto w-full">
    <div v-if="loading" class="flex-1 flex items-center justify-center py-20">
      <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
    </div>

    <template v-else>
      <!-- 헤더 -->
      <div class="flex justify-between items-center mb-6">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span
              class="text-xs font-black px-2 py-0.5 rounded uppercase tracking-wider bg-orange-100 text-orange-600"
              >{{ GAME_TYPE_LABELS[room.game_type] || room.game_type }}</span
            >
            <span class="text-xs font-bold px-2 py-0.5 rounded bg-green-100 text-green-600"
              >대기중</span
            >
          </div>
          <h1 class="text-2xl font-black text-gray-800">{{ room.name || room.id }} 대기룸</h1>
        </div>
        <button @click="leaveRoom" class="text-sm text-gray-500 hover:text-gray-700 hover:underline">
          나가기
        </button>
      </div>

      <p class="text-gray-500 mb-6">
        총 <b class="text-gray-800">{{ users.length }}</b
        >명 입장 · 준비 완료
        <b class="text-indigo-600">{{ readyCount }}</b> / {{ READY_THRESHOLD }}명
      </p>

      <!-- 참여자 목록 (팀별) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div
          v-for="team in teams"
          :key="team.id"
          :class="[
            'bg-white rounded-2xl border-2 p-5 transition-all',
            me?.team_id === team.id ? 'border-indigo-500 shadow-md' : 'border-gray-100'
          ]"
        >
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-black text-gray-800">{{ team.team_name }}</h3>
            <span class="text-sm font-bold text-gray-400">{{ membersOf(team.id).length }}명</span>
          </div>

          <ul class="space-y-2 mb-4 min-h-[40px]">
            <li
              v-for="member in membersOf(team.id)"
              :key="member.id"
              class="flex items-center gap-2 text-gray-700"
            >
              <span
                :class="[
                  'w-2 h-2 rounded-full',
                  member.is_voted ? 'bg-green-500' : 'bg-gray-300'
                ]"
              ></span>
              <span class="font-medium">{{ member.name }}</span>
              <span v-if="member.id === authStore.user?.id" class="text-xs text-indigo-500 font-bold"
                >(나)</span
              >
              <span
                v-if="member.is_voted"
                class="ml-auto text-xs font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded"
                >준비완료</span
              >
            </li>
            <li v-if="membersOf(team.id).length === 0" class="text-sm text-gray-300">
              아직 팀원이 없습니다
            </li>
          </ul>

          <div
            v-if="me?.team_id === team.id"
            class="w-full py-2 text-sm font-bold text-center text-indigo-600 bg-indigo-50 rounded-xl"
          >
            내 팀
          </div>
        </div>
      </div>

      <!-- 준비 완료 -->
      <div class="mt-auto space-y-3">
        <!-- 진행 상황 바 -->
        <div class="bg-white rounded-2xl border p-4">
          <div class="flex justify-between text-sm font-bold mb-2">
            <span class="text-gray-600">게임 시작까지</span>
            <span class="text-indigo-600">{{ readyCount }} / {{ users.length }}명 준비</span>
          </div>
          <div class="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              class="h-full bg-indigo-600 transition-all"
              :style="{ width: users.length > 0 ? (readyCount / users.length) * 100 + '%' : '0%' }"
            ></div>
          </div>
          <p v-if="canStart" class="text-xs text-green-600 font-bold mt-2">
            모두 준비되었습니다! 게임을 시작할 수 있습니다.
          </p>
          <p v-else class="text-xs text-gray-400 font-bold mt-2">
            모든 참여자가 준비 완료를 눌러야 게임을 시작할 수 있습니다.
          </p>
        </div>

        <!-- 준비 완료 토글 -->
        <button
          @click="toggleReady"
          :disabled="togglingReady"
          :class="[
            'w-full py-4 text-lg font-black rounded-2xl transition-colors shadow-lg active:scale-95 disabled:opacity-50',
            iAmReady
              ? 'bg-green-500 hover:bg-green-600 text-white shadow-green-200'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'
          ]"
        >
          {{ iAmReady ? '✓ 준비 완료 (취소하려면 누르세요)' : '준비 완료' }}
        </button>

        <!-- 게임 시작: 준비 인원이 충족되면 활성화 -->
        <button
          @click="startGame"
          :disabled="!canStart || starting"
          class="w-full py-4 text-lg font-black rounded-2xl transition-all shadow-lg active:scale-95 bg-gray-800 hover:bg-gray-900 text-white shadow-gray-300 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed"
        >
          {{ starting ? '시작하는 중...' : '게임 시작' }}
        </button>

        <button
          @click="resetRoom"
          class="w-full py-3 text-sm font-bold text-red-500 border border-red-100 hover:bg-red-50 rounded-2xl transition-colors"
        >
          방 초기화 (전원 퇴장)
        </button>
      </div>
    </template>
  </div>
</template>
