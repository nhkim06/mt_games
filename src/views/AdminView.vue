<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../supabase'
import {
  ROOM_STATUS,
  ROOM_STATUS_LABELS,
  GAME_TYPES,
  GAME_TYPE_LABELS,
  ROLES,
  MESSAGES
} from '../constants'
import { assignRoles, pickCategoryAndWord } from '../game/liar'

const router = useRouter()

const rooms = ref<any[]>([])
const loading = ref(true)
const selectedRoomId = ref<string | null>(null)
const busy = ref(false)

const activeRooms = computed(() => rooms.value.filter(r => r.status !== ROOM_STATUS.FINISHED))
const finishedRooms = computed(() => rooms.value.filter(r => r.status === ROOM_STATUS.FINISHED))

const globalTeams = ref<any[]>([])

const fetchRooms = async () => {
  const [{ data: roomData }, { data: teamData }] = await Promise.all([
    supabase.from('room').select('*, user(*)').order('status', { ascending: false }),
    supabase.from('team').select('*').order('team_name')
  ])
  rooms.value = roomData || []
  globalTeams.value = teamData || []
  loading.value = false
}

const teamsOf = (_room: any) => globalTeams.value
const membersOf = (room: any, teamId: string) =>
  (room.user || []).filter((u: any) => u.team_id === teamId)
const memberCount = (room: any) => (room.user ? room.user.length : 0)

const startGame = async (room: any) => {
  if (busy.value) return
  if (room.game_type !== GAME_TYPES.LIAR) {
    alert('마피아 게임은 준비 중입니다.')
    return
  }
  const teams = teamsOf(room)
  // 최소 인원 체크는 해당 방의 멤버를 기준으로 함
  const hasMembers = teams.some(t => membersOf(room, t.id).length >= 1)
  if (!hasMembers) {
    alert(MESSAGES.START_NEED_MEMBERS)
    return
  }
  busy.value = true
  try {
    const { category, secret_word } = pickCategoryAndWord()
    const roleUpdates = assignRoles(teams, room.user || [])
    await Promise.all(
      roleUpdates.map((u) =>
        supabase.from('user').update({ role: u.role, is_voted: false }).eq('id', u.id)
      )
    )
    await supabase.from('votes').delete().eq('room_id', room.id)
    await supabase
      .from('room')
      .update({ status: ROOM_STATUS.PLAYING, category, secret_word, current_round: 1 })
      .eq('id', room.id)
    await fetchRooms()
  } finally {
    busy.value = false
  }
}

const endGame = async (room: any) => {
  if (!confirm(MESSAGES.END_CONFIRM)) return
  await supabase.from('room').update({ status: ROOM_STATUS.FINISHED }).eq('id', room.id)
  await fetchRooms()
}

const deleteRoom = async (room: any) => {
  if (!confirm('방을 삭제하고 모든 인원을 내보냅니다. 진행할까요?')) return
  await supabase
    .from('user')
    .update({ room_id: null, team_id: null, role: null, is_voted: false })
    .eq('room_id', room.id)
  await supabase.from('room').delete().eq('id', room.id)
  if (selectedRoomId.value === room.id) selectedRoomId.value = null
  await fetchRooms()
}

const adjustScore = async (team: any, delta: number) => {
  const next = Math.max(0, team.score + delta)
  await supabase.from('team').update({ score: next }).eq('id', team.id)
  await fetchRooms()
}

const changeTeam = async (user: any, teamId: string) => {
  await supabase.from('user').update({ team_id: teamId }).eq('id', user.id)
  await fetchRooms()
}

const roleLabel = (role: string | null) =>
  role === ROLES.LIAR ? '라이어' : role === ROLES.CITIZEN ? '시민' : '-'

let channel: any = null
onMounted(() => {
  fetchRooms()
  channel = supabase
    .channel('admin-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room' }, fetchRooms)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team' }, fetchRooms)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user' }, fetchRooms)
    .subscribe()
})
onUnmounted(() => {
  if (channel) supabase.removeChannel(channel)
})
</script>

<template>
  <div class="flex-1 flex flex-col p-6 max-w-5xl mx-auto w-full">
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
      <div>
        <h1 class="text-2xl font-black text-gray-800">관리자 패널</h1>
        <p class="text-sm text-gray-500">전체 게임 진행 현황 및 팀 포인트 통제</p>
      </div>
      <div class="flex bg-gray-100 p-1 rounded-xl">
        <button
          @click="router.push({ name: 'lobby' })"
          class="px-4 py-2 text-sm font-bold text-gray-500 hover:text-gray-700 transition-colors"
        >
          유저 화면
        </button>
        <button
          class="px-4 py-2 text-sm font-bold bg-white text-indigo-600 rounded-lg shadow-sm"
        >
          관리자 화면
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center py-20">
      <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
    </div>

    <div v-else-if="rooms.length === 0" class="text-center text-gray-400 py-20 bg-white rounded-3xl border-2 border-dashed">
      생성된 방이 없습니다.
    </div>

    <div v-else class="space-y-12">
      <!-- 활성 게임 -->
      <section>
        <h2 class="text-lg font-black text-gray-800 mb-4 flex items-center gap-2">
          <span class="w-2 h-5 bg-indigo-600 rounded-full"></span>
          진행 중인 방
          <span class="text-sm font-medium text-gray-400 ml-1">{{ activeRooms.length }}</span>
        </h2>
        <div v-if="activeRooms.length === 0" class="text-sm text-gray-400 py-10 text-center bg-gray-50 rounded-2xl border">
          현재 진행 중인 게임이 없습니다.
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div v-for="room in activeRooms" :key="room.id" class="bg-white rounded-2xl border p-5 shadow-sm hover:shadow-md transition-shadow">
            <!-- 카드 헤더 -->
            <div class="flex justify-between items-start mb-3">
              <div>
                <div class="flex items-center gap-2 mb-1">
                  <span
                    :class="[
                      'text-xs font-black px-2 py-0.5 rounded uppercase',
                      room.game_type === GAME_TYPES.LIAR
                        ? 'bg-orange-100 text-orange-600'
                        : 'bg-blue-100 text-blue-600'
                    ]"
                  >{{ GAME_TYPE_LABELS[room.game_type] || room.game_type }}</span>
                  <span
                    :class="[
                      'text-xs font-bold px-2 py-0.5 rounded',
                      room.status === ROOM_STATUS.WAITING
                        ? 'bg-green-100 text-green-600'
                        : room.status === ROOM_STATUS.FINISHED
                          ? 'bg-gray-200 text-gray-500'
                          : 'bg-indigo-100 text-indigo-600'
                    ]"
                  >{{ ROOM_STATUS_LABELS[room.status] || room.status }}</span>
                </div>
                <h3 class="text-xl font-black text-gray-800">{{ room.name || room.id }}</h3>
                <p v-if="room.name" class="text-xs font-bold text-gray-400">ID: {{ room.id }}</p>
              </div>
              <span class="text-sm text-gray-400 font-bold">라운드 {{ room.current_round }}</span>
            </div>

            <!-- 팀 인원/점수 -->
            <div class="flex flex-wrap gap-2 text-sm text-gray-500 mb-4">
              <span v-for="t in teamsOf(room)" :key="t.id" class="bg-gray-50 px-2 py-1 rounded">
                {{ t.team_name }} {{ membersOf(room, t.id).length }}명 · {{ t.score }}점
              </span>
              <span class="ml-auto">총 {{ memberCount(room) }}명</span>
            </div>

            <!-- 컨트롤 -->
            <div class="flex flex-wrap gap-2">
              <button
                v-if="room.status === ROOM_STATUS.WAITING"
                @click="startGame(room)"
                :disabled="busy"
                class="px-3 py-1.5 text-sm font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                게임 시작
              </button>
              <button
                v-if="room.status === ROOM_STATUS.PLAYING || room.status === ROOM_STATUS.RESULT"
                @click="endGame(room)"
                class="px-3 py-1.5 text-sm font-bold bg-rose-600 text-white rounded-lg hover:bg-rose-700"
              >
                게임 종료
              </button>
              <button
                @click="selectedRoomId = selectedRoomId === room.id ? null : room.id"
                class="px-3 py-1.5 text-sm font-bold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                {{ selectedRoomId === room.id ? '닫기' : '상세' }}
              </button>
              <button
                @click="deleteRoom(room)"
                class="px-3 py-1.5 text-sm font-bold text-red-500 border border-red-100 rounded-lg hover:bg-red-50 ml-auto"
              >
                삭제
              </button>
            </div>

            <!-- 상세 -->
            <div v-if="selectedRoomId === room.id" class="mt-5 pt-5 border-t space-y-4">
              <div class="text-sm">
                <span class="text-gray-400 font-bold">제시어: </span>
                <span class="font-black text-gray-800">{{ room.secret_word || '미정' }}</span>
                <span class="text-gray-400 font-bold ml-3">카테고리: </span>
                <span class="font-bold text-gray-700">{{ room.category || '미정' }}</span>
              </div>

              <!-- 팀별 점수 조정 -->
              <div class="space-y-2">
                <div
                  v-for="t in teamsOf(room)"
                  :key="t.id"
                  class="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2"
                >
                  <span class="font-bold text-gray-700">{{ t.team_name }}</span>
                  <div class="flex items-center gap-2">
                    <button
                      @click="adjustScore(t, -10)"
                      class="w-7 h-7 rounded-lg bg-white border text-gray-600 font-black hover:bg-gray-100"
                    >
                      −
                    </button>
                    <span class="w-12 text-center font-black text-indigo-600">{{ t.score }}</span>
                    <button
                      @click="adjustScore(t, 10)"
                      class="w-7 h-7 rounded-lg bg-white border text-gray-600 font-black hover:bg-gray-100"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <!-- 플레이어 리스트 (역할 표시 + 팀 수정) -->
              <div>
                <p class="text-xs font-black text-gray-400 uppercase tracking-wider mb-2">플레이어</p>
                <ul class="space-y-2">
                  <li
                    v-for="player in room.user"
                    :key="player.id"
                    class="flex items-center justify-between bg-white border rounded-xl px-3 py-2"
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="font-bold text-gray-800 truncate">{{ player.name }}</span>
                      <span
                        v-if="player.role"
                        :class="[
                          'text-xs font-black px-1.5 py-0.5 rounded',
                          player.role === ROLES.LIAR
                            ? 'bg-rose-100 text-rose-600'
                            : 'bg-gray-100 text-gray-500'
                        ]"
                        >{{ roleLabel(player.role) }}</span
                      >
                    </div>
                    <select
                      :value="player.team_id || ''"
                      @change="changeTeam(player, ($event.target as HTMLSelectElement).value)"
                      class="text-sm border rounded-lg px-2 py-1 bg-gray-50 font-bold text-gray-700"
                    >
                      <option v-for="t in teamsOf(room)" :key="t.id" :value="t.id">
                        {{ t.team_name }}
                      </option>
                    </select>
                  </li>
                  <li v-if="!room.user || room.user.length === 0" class="text-sm text-gray-300">
                    참여자가 없습니다.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 종료된 게임 (히스토리) -->
      <section>
        <h2 class="text-lg font-black text-gray-800 mb-4 flex items-center gap-2">
          <span class="w-2 h-5 bg-gray-400 rounded-full"></span>
          지난 게임 내역
          <span class="text-sm font-medium text-gray-400 ml-1">{{ finishedRooms.length }}</span>
        </h2>
        <div v-if="finishedRooms.length === 0" class="text-sm text-gray-400 py-10 text-center bg-gray-50 rounded-2xl border">
          종료된 게임이 없습니다.
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div v-for="room in finishedRooms" :key="room.id" class="bg-gray-50/50 rounded-2xl border p-5 opacity-80">
            <!-- 카드 헤더 (종료된 게임) -->
            <div class="flex justify-between items-start mb-3">
              <div>
                <div class="flex items-center gap-2 mb-1">
                  <span
                    :class="[
                      'text-xs font-black px-2 py-0.5 rounded uppercase',
                      room.game_type === GAME_TYPES.LIAR
                        ? 'bg-orange-100 text-orange-600'
                        : 'bg-blue-100 text-blue-600'
                    ]"
                  >{{ GAME_TYPE_LABELS[room.game_type] || room.game_type }}</span>
                  <span class="text-xs font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-500">종료됨</span>
                </div>
                <h3 class="text-xl font-black text-gray-800">{{ room.name || room.id }}</h3>
                <p v-if="room.name" class="text-xs font-bold text-gray-400">ID: {{ room.id }}</p>
              </div>
              <span class="text-sm text-gray-400 font-bold">라운드 {{ room.current_round }}</span>
            </div>


            <!-- 팀 점수 (종료된 게임) -->
            <div class="flex flex-wrap gap-2 text-sm text-gray-500 mb-4">
              <span v-for="t in teamsOf(room)" :key="t.id" class="bg-white/50 px-2 py-1 rounded">
                {{ t.team_name }}: {{ t.score }}점
              </span>
            </div>

            <div class="flex gap-2">
              <button
                @click="selectedRoomId = selectedRoomId === room.id ? null : room.id"
                class="px-3 py-1.5 text-sm font-bold bg-white text-gray-700 border rounded-lg hover:bg-gray-100"
              >
                {{ selectedRoomId === room.id ? '닫기' : '결과 상세' }}
              </button>
              <button
                @click="deleteRoom(room)"
                class="px-3 py-1.5 text-sm font-bold text-red-400 hover:text-red-600 ml-auto"
              >
                삭제
              </button>
            </div>

            <!-- 상세 (종료된 게임) -->
            <div v-if="selectedRoomId === room.id" class="mt-5 pt-5 border-t space-y-4 text-sm">
              <div>
                <span class="text-gray-400 font-bold">제시어: </span>
                <span class="font-black text-gray-800">{{ room.secret_word }}</span>
                <span class="text-gray-400 font-bold ml-3">카테고리: </span>
                <span class="font-bold text-gray-700">{{ room.category }}</span>
              </div>
              <div>
                <p class="text-xs font-black text-gray-400 uppercase tracking-wider mb-2">참여자</p>
                <div class="flex flex-wrap gap-2">
                  <span v-for="u in room.user" :key="u.id" class="bg-white px-2 py-1 rounded border text-xs font-medium">
                    {{ u.name }} ({{ roleLabel(u.role) }})
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
