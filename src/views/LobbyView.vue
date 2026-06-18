<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../supabase'
import { useAuthStore } from '../stores/auth'
import {
  GAME_TYPES,
  GAME_TYPE_LABELS,
  ROOM_STATUS,
  ROOM_STATUS_LABELS,
  TEAM_NAMES,
  PREFERRED_TEAM_KEY
} from '../constants'

const router = useRouter()
const authStore = useAuthStore()

const rooms = ref<any[]>([])
const filterType = ref<'ALL' | keyof typeof GAME_TYPES>('ALL')
const loading = ref(false)
const showCreateModal = ref(false)
const joining = ref(false)

const showSettingsModal = ref(false)
const settingsName = ref('')
const settingsTeam = ref('')
const savingSettings = ref(false)

const newRoomType = ref<string>(GAME_TYPES.LIAR)
const newRoomName = ref('')
const selectedTeams = ref<string[]>([...TEAM_NAMES])

const toggleTeamSelection = (team: string) => {
  if (selectedTeams.value.includes(team)) {
    if (selectedTeams.value.length > 1) {
      selectedTeams.value = selectedTeams.value.filter((t) => t !== team)
    } else {
      alert('최소 하나 이상의 팀을 선택해야 합니다.')
    }
  } else {
    selectedTeams.value.push(team)
  }
}

const openSettings = () => {
  settingsName.value = authStore.user?.name || ''
  settingsTeam.value = localStorage.getItem(PREFERRED_TEAM_KEY) || TEAM_NAMES[0]
  showSettingsModal.value = true
}

const saveSettings = async () => {
  if (!authStore.user || !settingsName.value.trim() || savingSettings.value) return
  savingSettings.value = true
  try {
    const { error } = await supabase
      .from('user')
      .update({ name: settingsName.value.trim() })
      .eq('id', authStore.user.id)

    if (error) throw error

    localStorage.setItem(PREFERRED_TEAM_KEY, settingsTeam.value)

    if (authStore.user.room_id) {
      await supabase
        .from('user')
        .update({ team_id: `team_${settingsTeam.value}` })
        .eq('id', authStore.user.id)
    }

    await authStore.refreshProfile()
    showSettingsModal.value = false
    alert('설정이 저장되었습니다.')
  } catch (e) {
    console.error(e)
    alert('설정 저장 중 오류가 발생했습니다.')
  } finally {
    savingSettings.value = false
  }
}

const fetchRooms = async () => {
  loading.value = true
  let query = supabase.from('room').select('*').order('id')
  
  // 종료된 게임은 로비에서 보이지 않게 필터링
  query = query.neq('status', ROOM_STATUS.FINISHED)

  if (filterType.value !== 'ALL') {
    query = query.eq('game_type', filterType.value)
  }
  const { data, error } = await query
  if (error) {
    console.error('방 목록 조회 오류:', error)
    loading.value = false
    return
  }
  rooms.value = data || []

  const { data: members } = await supabase.from('user').select('room_id').not('room_id', 'is', null)
  const counts: Record<string, number> = {}
  for (const m of members || []) {
    if (m.room_id) counts[m.room_id] = (counts[m.room_id] || 0) + 1
  }
  memberCounts.value = counts
  loading.value = false
}

const memberCounts = ref<Record<string, number>>({})
const memberCount = (room: any) => memberCounts.value[room.id] || 0

const setFilter = (f: 'ALL' | keyof typeof GAME_TYPES) => {
  filterType.value = f
  fetchRooms()
}

const createRoom = async () => {
  if (!authStore.user || !authStore.isAdmin) return
  if (!newRoomName.value.trim()) {
    alert('방 이름을 입력해주세요.')
    return
  }
  joining.value = true

  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase()
  const { error: roomError } = await supabase.from('room').insert({
    id: roomId,
    name: newRoomName.value.trim(),
    game_type: newRoomType.value,
    status: ROOM_STATUS.WAITING,
    current_round: 1,
    allowed_teams: selectedTeams.value.map((t) => `team_${t}`).join(',')
  })
  if (roomError) {
    joining.value = false
    alert('방 생성 중 오류가 발생했습니다.')
    return
  }

  showCreateModal.value = false
  await joinRoom(roomId)
}

const joinRoom = async (roomId: string) => {
  if (!authStore.user || joining.value) return
  joining.value = true

  const { data: roomData } = await supabase
    .from('room')
    .select('allowed_teams')
    .eq('id', roomId)
    .maybeSingle()

  const userTeamId = authStore.user.team_id || `team_${localStorage.getItem(PREFERRED_TEAM_KEY)}`

  if (roomData?.allowed_teams) {
    const allowed = roomData.allowed_teams.split(',')
    if (!allowed.includes(userTeamId)) {
      alert('이 방은 소속 팀의 참여가 제한된 방입니다.')
      joining.value = false
      return
    }
  }

  if (authStore.user.room_id === roomId) {
    router.push({ name: 'room', params: { id: roomId } })
    joining.value = false
    return
  }

  let teamId: string | null = null
  const preferred = localStorage.getItem(PREFERRED_TEAM_KEY)
  if (preferred) {
    teamId = `team_${preferred}`
  }

  const { error } = await supabase
    .from('user')
    .update({ room_id: roomId, team_id: teamId, role: null, is_voted: false })
    .eq('id', authStore.user.id)

  joining.value = false
  if (error) {
    alert('방 입장 중 오류가 발생했습니다.')
    return
  }

  authStore.user.room_id = roomId
  authStore.user.team_id = teamId ?? undefined
  router.push({ name: 'room', params: { id: roomId } })
}

const resumeActiveRoom = async () => {
  if (!authStore.user?.room_id) return
  const { data } = await supabase
    .from('room')
    .select('id, status')
    .eq('id', authStore.user.room_id)
    .maybeSingle()
  if (!data) return
  if (data.status === ROOM_STATUS.PLAYING || data.status === ROOM_STATUS.RESULT) {
    router.push({ name: 'game', params: { id: data.id } })
  }
}

const logout = async () => {
  await authStore.logout()
  router.push({ name: 'login' })
}

let channel: any = null
onMounted(async () => {
  await resumeActiveRoom()
  await fetchRooms()
  channel = supabase
    .channel('lobby-rooms')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room' }, fetchRooms)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user' }, fetchRooms)
    .subscribe()
})
onUnmounted(() => {
  if (channel) supabase.removeChannel(channel)
})
</script>

<template>
  <div class="flex-1 flex flex-col p-6 max-w-4xl mx-auto w-full">
    <div class="flex justify-between items-center mb-8">
      <h1 class="text-2xl font-black text-gray-800">로비</h1>
      <div class="flex items-center gap-2 sm:gap-3">
        <span class="text-gray-600 font-bold text-sm sm:text-base">{{ authStore.user?.name }}</span>
        <button
          @click="openSettings"
          class="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
        >
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
        <button
          v-if="authStore.isAdmin"
          @click="router.push({ name: 'admin' })"
          class="text-sm font-bold text-indigo-600 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-all"
        >
          관리자
        </button>
        <button @click="logout" class="text-sm text-red-500 hover:underline">로그아웃</button>
      </div>
    </div>

    <div class="flex flex-col sm:flex-row gap-3 mb-6">
      <div class="flex bg-white rounded-xl p-1 shadow-sm border">
        <button
          @click="setFilter('ALL')"
          :class="[
            'px-4 py-2 rounded-lg text-sm font-bold transition-colors',
            filterType === 'ALL' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'
          ]"
        >
          전체
        </button>
        <button
          @click="setFilter('LIAR')"
          :class="[
            'px-4 py-2 rounded-lg text-sm font-bold transition-colors',
            filterType === 'LIAR' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'
          ]"
        >
          라이어
        </button>
        <button
          @click="setFilter('MAFIA')"
          :class="[
            'px-4 py-2 rounded-lg text-sm font-bold transition-colors',
            filterType === 'MAFIA' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'
          ]"
        >
          마피아
        </button>
      </div>
      <button
        v-if="authStore.isAdmin"
        @click="showCreateModal = true"
        class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-xl transition-colors shadow-sm sm:ml-auto"
      >
        + 방 만들기
      </button>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center py-20">
      <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
    </div>
    <div
      v-else-if="rooms.length === 0"
      class="flex-1 flex flex-col items-center justify-center bg-white rounded-2xl border-2 border-dashed border-gray-200 p-12"
    >
      <p class="text-gray-500 mb-3 text-lg">생성된 방이 없습니다.</p>
      <button
        v-if="authStore.isAdmin"
        @click="showCreateModal = true"
        class="text-indigo-600 font-bold hover:underline"
      >
        첫 번째 방을 만들어보세요!
      </button>
    </div>
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <button
        v-for="room in rooms"
        :key="room.id"
        :disabled="joining || room.status !== ROOM_STATUS.WAITING"
        class="text-left bg-white p-6 rounded-2xl shadow-sm border hover:border-indigo-400 hover:shadow-md transition-all disabled:opacity-60 disabled:bg-gray-50 disabled:cursor-not-allowed group relative overflow-hidden"
        @click="joinRoom(room.id)"
      >
        <div
          v-if="room.status !== ROOM_STATUS.WAITING"
          class="absolute inset-0 bg-gray-900/5 flex items-center justify-center z-10"
        >
          <span
            class="bg-gray-800 text-white text-xs font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-lg"
          >
            {{ room.status === ROOM_STATUS.FINISHED ? '종료됨' : '진행 중' }}
          </span>
        </div>
        <div class="flex justify-between items-start mb-4">
          <span
            :class="[
              'text-xs font-black px-2 py-1 rounded uppercase tracking-wider',
              room.game_type === GAME_TYPES.LIAR
                ? 'bg-orange-100 text-orange-600'
                : 'bg-blue-100 text-blue-600'
            ]"
          >
            {{ GAME_TYPE_LABELS[room.game_type] || room.game_type }}
          </span>
          <span
            :class="[
              'text-xs font-bold px-2 py-1 rounded',
              room.status === ROOM_STATUS.WAITING
                ? 'bg-green-100 text-green-600'
                : 'bg-gray-100 text-gray-500'
            ]"
          >
            {{ ROOM_STATUS_LABELS[room.status] || room.status }}
          </span>
        </div>
        <h3 class="text-xl font-black mb-2 group-hover:text-indigo-600 transition-colors">
          {{ room.name || room.id }}
        </h3>
        <div class="flex items-center gap-3 text-sm text-gray-500">
          <span class="text-xs font-bold text-gray-400">ID: {{ room.id }}</span>
          <span>👥 {{ memberCount(room) }}명</span>
        </div>
      </button>
    </div>

    <!-- 방 생성 모달 -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
    >
      <div class="bg-white rounded-3xl p-8 max-w-sm w-full animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
        <h2 class="text-2xl font-black mb-6">방 생성하기</h2>

        <div class="space-y-6 mb-8">
          <div>
            <label class="block text-sm font-bold text-gray-500 mb-2 uppercase tracking-wider">방 이름</label>
            <input
              v-model="newRoomName"
              type="text"
              placeholder="예: 즐거운 게임방"
              maxlength="20"
              class="w-full px-4 py-3 bg-gray-50 rounded-xl border-2 border-transparent focus:border-indigo-500 outline-none font-bold"
            />
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-500 mb-2 uppercase tracking-wider">게임 종류</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                @click="newRoomType = GAME_TYPES.LIAR"
                :class="[
                  'py-3 border-2 rounded-xl font-bold transition-all',
                  newRoomType === GAME_TYPES.LIAR
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                    : 'border-gray-100 hover:bg-gray-50 text-gray-500'
                ]"
              >
                라이어
              </button>
              <button
                @click="newRoomType = GAME_TYPES.MAFIA"
                :class="[
                  'py-3 border-2 rounded-xl font-bold transition-all',
                  newRoomType === GAME_TYPES.MAFIA
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                    : 'border-gray-100 hover:bg-gray-50 text-gray-500'
                ]"
              >
                마피아
              </button>
            </div>
          </div>

          <div>
            <label class="block text-sm font-bold text-gray-500 mb-2 uppercase tracking-wider">참여 가능 팀</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="team in TEAM_NAMES"
                :key="team"
                @click="toggleTeamSelection(team)"
                :class="[
                  'py-2 border-2 rounded-xl font-bold transition-all uppercase text-xs',
                  selectedTeams.includes(team)
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                    : 'border-gray-100 text-gray-400'
                ]"
              >
                {{ team }}
              </button>
            </div>
          </div>
        </div>

        <div class="flex gap-3">
          <button
            @click="showCreateModal = false"
            class="flex-1 py-3 bg-gray-100 hover:bg-gray-200 rounded-xl font-bold transition-colors"
          >
            취소
          </button>
          <button
            @click="createRoom"
            :disabled="joining"
            class="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-colors shadow-sm disabled:opacity-50"
          >
            생성
          </button>
        </div>
      </div>
    </div>

    <!-- 설정 모달 -->
    <div
      v-if="showSettingsModal"
      class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
    >
      <div class="bg-white rounded-3xl p-8 max-w-sm w-full animate-in zoom-in-95">
        <h2 class="text-2xl font-black mb-6">내 설정</h2>
        <div class="space-y-6 mb-8">
          <div>
            <label class="block text-sm font-bold text-gray-500 mb-2 uppercase tracking-wider"
              >이름</label
            >
            <input
              v-model="settingsName"
              type="text"
              maxlength="12"
              class="w-full px-4 py-3 bg-gray-50 rounded-xl border-2 border-transparent focus:border-indigo-500 outline-none font-bold"
            />
          </div>
          <div>
            <label class="block text-sm font-bold text-gray-500 mb-2 uppercase tracking-wider"
              >선호 팀</label
            >
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="team in TEAM_NAMES"
                :key="team"
                @click="settingsTeam = team"
                :class="[
                  'py-3 border-2 rounded-xl font-bold transition-all uppercase',
                  settingsTeam === team
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                    : 'border-gray-100 text-gray-400'
                ]"
              >
                {{ team }}
              </button>
            </div>
          </div>
        </div>
        <div class="flex gap-3">
          <button
            @click="showSettingsModal = false"
            class="flex-1 py-3 bg-gray-100 hover:bg-gray-200 rounded-xl font-bold transition-colors"
          >
            취소
          </button>
          <button
            @click="saveSettings"
            :disabled="savingSettings || !settingsName.trim()"
            class="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-colors shadow-sm disabled:opacity-50"
          >
            {{ savingSettings ? '저장 중...' : '저장' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
