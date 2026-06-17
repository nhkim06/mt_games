<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../supabase'
import { useAuthStore } from '../stores/auth'
import { GAME_TYPES, ROOM_STATUS } from '../constants'
import { v4 as uuidv4 } from 'uuid'

const router = useRouter()
const authStore = useAuthStore()
const rooms = ref<any[]>([])
const filterType = ref('ALL')
const loading = ref(false)
const showCreateModal = ref(false)
const newRoomType = ref(GAME_TYPES.LIAR)

const fetchRooms = async () => {
  loading.value = true
  let query = supabase.from('room').select('*').order('id', { ascending: false })
  
  if (filterType.value !== 'ALL') {
    query = query.eq('game_type', filterType.value)
  }
  
  const { data, error } = await query
  if (!error) {
    rooms.value = data
  }
  loading.value = false
}

const createRoom = async () => {
  if (!authStore.user) return
  
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase()
  const { error: roomError } = await supabase
    .from('room')
    .insert({
      id: roomId,
      game_type: newRoomType.value,
      status: ROOM_STATUS.WAITING,
      current_round: 1
    })
  
  if (roomError) {
    alert('방 생성 중 오류가 발생했습니다.')
    return
  }

  // Create default teams for the room
  const teams = [
    { id: uuidv4(), team_name: 'A팀', room_id: roomId, score: 0 },
    { id: uuidv4(), team_name: 'B팀', room_id: roomId, score: 0 }
  ]
  
  const { error: teamError } = await supabase.from('team').insert(teams)
  if (teamError) {
    console.error('Error creating teams:', teamError)
  }

  joinRoom(roomId)
}

const joinRoom = async (roomId: string) => {
  if (!authStore.user) return

  // Resolve the team the user picked at login (stored per-device) to the
  // matching team row within this specific room.
  let teamId: string | null = null
  const preferredTeam = localStorage.getItem('preferred_team_name')
  if (preferredTeam) {
    const { data: team } = await supabase
      .from('team')
      .select('id')
      .eq('room_id', roomId)
      .eq('team_name', preferredTeam)
      .maybeSingle()
    teamId = team?.id ?? null
  }

  const { error } = await supabase
    .from('user')
    .update({ room_id: roomId, team_id: teamId, role: null })
    .eq('id', authStore.user.id)

  if (error) {
    alert('방 입장 중 오류가 발생했습니다.')
    return
  }

  // Update local store
  authStore.user.room_id = roomId
  authStore.user.team_id = teamId ?? undefined
  router.push({ name: 'room', params: { id: roomId } })
}

const checkActiveRoom = () => {
  if (authStore.user?.room_id) {
    // Check if room still exists and what's the status
    supabase.from('room').select('status').eq('id', authStore.user.room_id).single().then(({ data }) => {
      if (data) {
        if (data.status === ROOM_STATUS.PLAYING || data.status === ROOM_STATUS.VOTING) {
          router.push({ name: 'game', params: { id: authStore.user!.room_id! } })
        } else {
          router.push({ name: 'room', params: { id: authStore.user!.room_id! } })
        }
      }
    })
  }
}

onMounted(() => {
  checkActiveRoom()
  fetchRooms()
})

const filteredRooms = computed(() => rooms.value)
</script>

<template>
  <div class="flex-1 flex flex-col p-6 max-w-4xl mx-auto w-full">
    <div class="flex justify-between items-center mb-8">
      <h1 class="text-2xl font-bold text-gray-800">로비</h1>
      <div class="flex items-center gap-4">
        <span class="text-gray-600 font-medium">{{ authStore.user?.name }} 님 환영합니다</span>
        <button @click="authStore.logout(); router.push({ name: 'login' })" class="text-sm text-red-500 hover:underline">로그아웃</button>
      </div>
    </div>

    <div class="flex flex-col md:flex-row gap-4 mb-6">
      <div class="flex bg-white rounded-lg p-1 shadow-sm border">
        <button 
          @click="filterType = 'ALL'; fetchRooms()"
          :class="['px-4 py-2 rounded-md transition-colors', filterType === 'ALL' ? 'bg-indigo-600 text-white shadow-sm' : 'hover:bg-gray-100']"
        >전체</button>
        <button 
          @click="filterType = GAME_TYPES.LIAR; fetchRooms()"
          :class="['px-4 py-2 rounded-md transition-colors', filterType === GAME_TYPES.LIAR ? 'bg-indigo-600 text-white shadow-sm' : 'hover:bg-gray-100']"
        >라이어</button>
        <button 
          @click="filterType = GAME_TYPES.MAFIA; fetchRooms()"
          :class="['px-4 py-2 rounded-md transition-colors', filterType === GAME_TYPES.MAFIA ? 'bg-indigo-600 text-white shadow-sm' : 'hover:bg-gray-100']"
        >마피아</button>
      </div>
      
      <button 
        @click="showCreateModal = true"
        class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg transition-colors shadow-sm ml-auto"
      >방 만들기</button>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
    </div>

    <div v-else-if="rooms.length === 0" class="flex-1 flex flex-col items-center justify-center bg-white rounded-xl border-2 border-dashed border-gray-300 p-12">
      <p class="text-gray-500 mb-4 text-lg">생성된 방이 없습니다.</p>
      <button @click="showCreateModal = true" class="text-indigo-600 font-bold hover:underline">새로운 방을 만들어보세요!</button>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div 
        v-for="room in rooms" 
        :key="room.id"
        class="bg-white p-6 rounded-xl shadow-sm border hover:border-indigo-400 transition-all cursor-pointer group"
        @click="joinRoom(room.id)"
      >
        <div class="flex justify-between items-start mb-4">
          <span :class="['text-xs font-bold px-2 py-1 rounded uppercase tracking-wider', room.game_type === GAME_TYPES.LIAR ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600']">
            {{ room.game_type }}
          </span>
          <span :class="['text-xs font-medium px-2 py-1 rounded', room.status === ROOM_STATUS.WAITING ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600']">
            {{ room.status }}
          </span>
        </div>
        <h3 class="text-xl font-bold mb-2 group-hover:text-indigo-600 transition-colors">{{ room.id }} 번 방</h3>
        <p class="text-gray-500 text-sm">라운드: {{ room.current_round }}</p>
      </div>
    </div>

    <!-- Create Room Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div class="bg-white rounded-xl p-8 max-w-sm w-full">
        <h2 class="text-2xl font-bold mb-6">방 생성하기</h2>
        
        <div class="space-y-4 mb-8">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">게임 종류</label>
            <div class="grid grid-cols-2 gap-2">
              <button 
                @click="newRoomType = GAME_TYPES.LIAR"
                :class="['py-3 border rounded-lg font-bold transition-all', newRoomType === GAME_TYPES.LIAR ? 'border-indigo-600 bg-indigo-50 text-indigo-600' : 'border-gray-200 hover:bg-gray-50']"
              >라이어</button>
              <button 
                @click="newRoomType = GAME_TYPES.MAFIA"
                :class="['py-3 border rounded-lg font-bold transition-all', newRoomType === GAME_TYPES.MAFIA ? 'border-indigo-600 bg-indigo-50 text-indigo-600' : 'border-gray-200 hover:bg-gray-50']"
              >마피아</button>
            </div>
          </div>
        </div>
        
        <div class="flex gap-3">
          <button @click="showCreateModal = false" class="flex-1 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold transition-colors">취소</button>
          <button @click="createRoom" class="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold transition-colors shadow-sm">생성</button>
        </div>
      </div>
    </div>
  </div>
</template>
