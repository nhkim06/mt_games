<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../supabase'
import { ROOM_STATUS } from '../constants'

const rooms = ref<any[]>([])
const selectedRoom = ref<any>(null)
const roomUsers = ref<any[]>([])
const roomTeams = ref<any[]>([])
const loading = ref(true)

const fetchRooms = async () => {
  const { data } = await supabase.from('room').select('*')
  rooms.value = data || []
  loading.value = false
}

const selectRoom = async (room: any) => {
  selectedRoom.value = room
  const { data: users } = await supabase.from('user').select('*').eq('room_id', room.id)
  roomUsers.value = users || []
  const { data: teams } = await supabase.from('team').select('*').eq('room_id', room.id)
  roomTeams.value = teams || []
}

const updateScore = async (teamId: string, amount: number) => {
  const team = roomTeams.value.find(t => t.id === teamId)
  if (!team) return
  
  const { error } = await supabase
    .from('team')
    .update({ score: team.score + amount })
    .eq('id', teamId)
  
  if (!error) {
    team.score += amount
  }
}

const changeUserTeam = async (userId: string, teamId: string) => {
  const { error } = await supabase
    .from('user')
    .update({ team_id: teamId })
    .eq('id', userId)
  
  if (!error) {
    const user = roomUsers.value.find(u => u.id === userId)
    if (user) user.team_id = teamId
  }
}

const stopGame = async (roomId: string) => {
  await supabase.from('room').update({ status: ROOM_STATUS.WAITING }).eq('id', roomId)
  fetchRooms()
  if (selectedRoom.value?.id === roomId) selectedRoom.value.status = ROOM_STATUS.WAITING
}

onMounted(() => {
  fetchRooms()
})
</script>

<template>
  <div class="flex-1 flex flex-col p-6 max-w-6xl mx-auto w-full">
    <h1 class="text-3xl font-bold mb-8">어드민 패널</h1>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- Room List -->
      <div class="lg:col-span-1 space-y-4">
        <h2 class="text-xl font-bold mb-4">방 목록</h2>
        <div 
          v-for="room in rooms" 
          :key="room.id"
          @click="selectRoom(room)"
          :class="['p-4 rounded-xl border cursor-pointer transition-all', selectedRoom?.id === room.id ? 'border-indigo-600 bg-indigo-50' : 'bg-white hover:border-gray-400']"
        >
          <div class="flex justify-between items-start mb-2">
            <span class="font-bold text-lg">{{ room.id }}</span>
            <span :class="['text-xs px-2 py-1 rounded font-bold', room.status === ROOM_STATUS.WAITING ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600']">
              {{ room.status }}
            </span>
          </div>
          <p class="text-sm text-gray-500">{{ room.game_type }} / 라운드: {{ room.current_round }}</p>
        </div>
      </div>

      <!-- Room Details -->
      <div class="lg:col-span-2">
        <div v-if="selectedRoom" class="bg-white rounded-2xl shadow-sm border p-8">
          <div class="flex justify-between items-center mb-8">
            <h2 class="text-2xl font-bold">{{ selectedRoom.id }} 번 방 상세</h2>
            <button @click="stopGame(selectedRoom.id)" class="px-4 py-2 bg-red-100 text-red-600 rounded-lg font-bold hover:bg-red-200">게임 중단</button>
          </div>

          <div class="grid grid-cols-2 gap-4 mb-8">
            <div class="p-4 bg-gray-50 rounded-xl">
              <span class="text-sm text-gray-500 block mb-1">제시어</span>
              <span class="text-xl font-bold">{{ selectedRoom.secret_word || '-' }}</span>
            </div>
            <div class="p-4 bg-gray-50 rounded-xl">
              <span class="text-sm text-gray-500 block mb-1">카테고리</span>
              <span class="text-xl font-bold">{{ selectedRoom.category || '-' }}</span>
            </div>
          </div>

          <!-- Team Scores -->
          <div class="mb-8">
            <h3 class="text-lg font-bold mb-4">팀 점수 관리</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div v-for="team in roomTeams" :key="team.id" class="p-4 border rounded-xl flex justify-between items-center">
                <div>
                  <span class="font-bold">{{ team.team_name }}</span>
                  <span class="ml-2 text-indigo-600 font-bold">{{ team.score }}점</span>
                </div>
                <div class="flex gap-2">
                  <button @click="updateScore(team.id, -10)" class="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200">-</button>
                  <button @click="updateScore(team.id, 10)" class="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200">+</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Players -->
          <div>
            <h3 class="text-lg font-bold mb-4">플레이어 리스트</h3>
            <div class="space-y-2">
              <div v-for="user in roomUsers" :key="user.id" class="p-3 border rounded-lg flex justify-between items-center">
                <div class="flex items-center gap-3">
                  <span class="font-medium">{{ user.name }}</span>
                  <span :class="['text-xs px-2 py-0.5 rounded font-bold', user.role === 'LIAR' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600']">
                    {{ user.role }}
                  </span>
                </div>
                <select 
                  @change="changeUserTeam(user.id, ($event.target as HTMLSelectElement).value)"
                  class="text-sm border rounded px-2 py-1 outline-none"
                >
                  <option v-for="team in roomTeams" :key="team.id" :value="team.id" :selected="user.team_id === team.id">
                    {{ team.team_name }}
                  </option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="h-full flex flex-col items-center justify-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 p-12 text-gray-400">
          <p>관리할 방을 선택해주세요.</p>
        </div>
      </div>
    </div>
  </div>
</template>
