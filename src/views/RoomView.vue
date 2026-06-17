<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../supabase'
import { useAuthStore } from '../stores/auth'
import { ROOM_STATUS, CATEGORIES } from '../constants'
import { GAME_WORDS } from '../data/words'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const roomId = route.params.id as string

const room = ref<any>(null)
const teams = ref<any[]>([])
const users = ref<any[]>([])
const loading = ref(true)

const fetchRoomData = async () => {
  const { data: roomData } = await supabase.from('room').select('*').eq('id', roomId).single()
  if (!roomData) {
    alert('방을 찾을 수 없습니다.')
    router.push({ name: 'lobby' })
    return
  }
  room.value = roomData

  if (roomData.status !== ROOM_STATUS.WAITING) {
    router.push({ name: 'game', params: { id: roomId } })
    return
  }

  const { data: teamData } = await supabase.from('team').select('*').eq('room_id', roomId)
  teams.value = teamData || []

  const { data: userData } = await supabase.from('user').select('*').eq('room_id', roomId)
  users.value = userData || []
  
  loading.value = false
}

const joinTeam = async (teamId: string) => {
  if (!authStore.user) return
  const { error } = await supabase
    .from('user')
    .update({ team_id: teamId })
    .eq('id', authStore.user.id)
  
  if (error) {
    alert('팀 참가 중 오류가 발생했습니다.')
  }
}

const leaveRoom = async () => {
  if (!authStore.user) return
  await supabase
    .from('user')
    .update({ room_id: null, team_id: null, role: null })
    .eq('id', authStore.user.id)
  
  authStore.user.room_id = undefined
  router.push({ name: 'lobby' })
}

const startGame = async () => {
  if (users.value.length < 2) {
    alert('최소 2명의 플레이어가 필요합니다.')
    return
  }
  
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)]
  const words = GAME_WORDS[category]
  const secretWord = words[Math.floor(Math.random() * words.length)]
  
  // Assign roles: 1 Liar per team
  const userUpdates: any[] = []
  for (const team of teams.value) {
    const members = users.value.filter(u => u.team_id === team.id)
    if (members.length === 0) continue
    
    const liarIndex = Math.floor(Math.random() * members.length)
    members.forEach((member, index) => {
      userUpdates.push({
        id: member.id,
        role: index === liarIndex ? 'LIAR' : 'CITIZEN',
        is_voted: false
      })
    })
  }

  // Batch update users (Supabase doesn't support batch update with different values easily in one call without RPC, so we'll do it sequentially for simplicity or use a loop)
  // Actually, we can use UPSERT if we provide all columns, but let's just do individual updates for safety in this prototype.
  for (const update of userUpdates) {
    await supabase.from('user').update({ role: update.role, is_voted: false }).eq('id', update.id)
  }

  const { error } = await supabase
    .from('room')
    .update({ 
      status: ROOM_STATUS.PLAYING,
      category: category,
      secret_word: secretWord,
      current_round: room.value.current_round || 1
    })
    .eq('id', roomId)
  
  if (error) alert('게임 시작 중 오류가 발생했습니다.')
}

let subscription: any = null

onMounted(() => {
  fetchRoomData()
  
  subscription = supabase
    .channel(`room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user', filter: `room_id=eq.${roomId}` }, () => {
      fetchRoomData()
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'room', filter: `id=eq.${roomId}` }, (payload) => {
      if (payload.new.status === ROOM_STATUS.PLAYING) {
        router.push({ name: 'game', params: { id: roomId } })
      }
    })
    .subscribe()
})

onUnmounted(() => {
  if (subscription) supabase.removeChannel(subscription)
})

const teamMembers = (teamId: string) => users.value.filter(u => u.team_id === teamId)
const unassignedUsers = computed(() => users.value.filter(u => !u.team_id))
</script>

<template>
  <div class="flex-1 flex flex-col p-6 max-w-4xl mx-auto w-full">
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
    </div>

    <template v-else>
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-3xl font-bold text-gray-800">{{ roomId }} 번 방</h1>
          <p class="text-gray-500 font-medium">{{ room.game_type }} 대기 중</p>
        </div>
        <button @click="leaveRoom" class="bg-gray-200 hover:bg-gray-300 px-4 py-2 rounded-lg font-bold transition-colors">나가기</button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div v-for="team in teams" :key="team.id" class="bg-white rounded-xl shadow-sm border p-6">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-bold">{{ team.team_name }}</h2>
            <span class="bg-indigo-100 text-indigo-600 px-3 py-1 rounded-full text-sm font-bold">
              {{ teamMembers(team.id).length }} 명
            </span>
          </div>
          
          <div class="space-y-2 mb-6 min-h-[100px]">
            <div v-for="member in teamMembers(team.id)" :key="member.id" class="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
              <div class="w-2 h-2 rounded-full bg-green-500"></div>
              <span class="font-medium text-gray-700">{{ member.name }}</span>
              <span v-if="member.id === authStore.user?.id" class="text-xs text-indigo-500 font-bold">(나)</span>
            </div>
            <p v-if="teamMembers(team.id).length === 0" class="text-gray-400 text-sm text-center py-4">팀원이 없습니다.</p>
          </div>

          <button 
            @click="joinTeam(team.id)"
            :disabled="authStore.user?.team_id === team.id"
            :class="['w-full py-3 rounded-lg font-bold transition-all', authStore.user?.team_id === team.id ? 'bg-indigo-50 text-indigo-400 cursor-default' : 'bg-indigo-600 hover:bg-indigo-700 text-white']"
          >
            {{ authStore.user?.team_id === team.id ? '소속됨' : '팀 참가' }}
          </button>
        </div>
      </div>

      <div v-if="unassignedUsers.length > 0" class="bg-white rounded-xl shadow-sm border p-6 mb-8">
        <h2 class="text-lg font-bold mb-4">팀 미지정</h2>
        <div class="flex flex-wrap gap-2">
          <span v-for="user in unassignedUsers" :key="user.id" class="px-3 py-1 bg-gray-100 rounded-full text-sm font-medium text-gray-600 border">
            {{ user.name }}
          </span>
        </div>
      </div>

      <button 
        @click="startGame"
        class="w-full py-4 bg-green-600 hover:bg-green-700 text-white text-xl font-bold rounded-xl transition-colors shadow-lg"
      >
        게임 시작!
      </button>
    </template>
  </div>
</template>
