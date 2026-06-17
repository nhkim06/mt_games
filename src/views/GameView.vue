<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../supabase'
import { useAuthStore } from '../stores/auth'
import { ROOM_STATUS, TARGET_TYPES, CATEGORIES } from '../constants'
import { GAME_WORDS } from '../data/words'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const roomId = route.params.id as string

const room = ref<any>(null)
const teams = ref<any[]>([])
const users = ref<any[]>([])
const myVotes = ref({ ownTeamLiar: '', opponentTeamLiar: '' })
const hasVoted = ref(false)
const loading = ref(true)
const resultMessage = ref('')
const liarGuess = ref('')

const fetchGameData = async () => {
  const { data: roomData } = await supabase.from('room').select('*').eq('id', roomId).single()
  if (!roomData) return router.push({ name: 'lobby' })
  room.value = roomData

  if (roomData.status === ROOM_STATUS.WAITING) {
    router.push({ name: 'room', params: { id: roomId } })
    return
  }

  const { data: teamData } = await supabase.from('team').select('*').eq('room_id', roomId)
  teams.value = teamData || []

  const { data: userData } = await supabase.from('user').select('*').eq('room_id', roomId)
  users.value = userData || []
  
  const me = userData?.find(u => u.id === authStore.user?.id)
  if (me) {
    hasVoted.value = me.is_voted
  }
  
  loading.value = false
}

const myTeam = computed(() => teams.value.find(t => t.id === authStore.user?.team_id))
const opponentTeam = computed(() => teams.value.find(t => t.id !== authStore.user?.team_id))

const myTeamMembers = computed(() => users.value.filter(u => u.team_id === authStore.user?.team_id))
const opponentTeamMembers = computed(() => users.value.filter(u => u.team_id !== authStore.user?.team_id))

const submitVotes = async () => {
  if (!myVotes.value.ownTeamLiar || !myVotes.value.opponentTeamLiar) {
    alert('모든 지목을 완료해주세요.')
    return
  }

  const votes = [
    {
      room_id: roomId,
      round: room.value.current_round,
      voter_id: authStore.user?.id,
      voter_team_id: authStore.user?.team_id,
      target_type: TARGET_TYPES.OWN_TEAM,
      candidate_id: myVotes.value.ownTeamLiar
    },
    {
      room_id: roomId,
      round: room.value.current_round,
      voter_id: authStore.user?.id,
      voter_team_id: authStore.user?.team_id,
      target_type: TARGET_TYPES.OPPONENT_TEAM,
      candidate_id: myVotes.value.opponentTeamLiar
    }
  ]

  const { error } = await supabase.from('votes').insert(votes)
  if (error) {
    alert('투표 중 오류가 발생했습니다.')
    return
  }

  await supabase.from('user').update({ is_voted: true }).eq('id', authStore.user?.id)
  hasVoted.value = true
  
  // Check if everyone voted
  checkAllVoted()
}

const checkAllVoted = async () => {
  const { data } = await supabase.from('user').select('is_voted').eq('room_id', roomId)
  if (data?.every(u => u.is_voted)) {
    // Transition to RESULT status
    await supabase.from('room').update({ status: ROOM_STATUS.RESULT }).eq('id', roomId)
  }
}

const resetRoom = async () => {
  if (!confirm('정말 방을 초기화하시겠습니까? 모든 플레이어가 로비로 이동됩니다.')) return
  
  await supabase.from('user').update({ room_id: null, team_id: null, role: null, is_voted: false }).eq('room_id', roomId)
  await supabase.from('room').delete().eq('id', roomId)
  router.push({ name: 'lobby' })
}

const submitLiarGuess = async () => {
  const normalizedGuess = liarGuess.value.trim().replace(/\s+/g, '')
  const normalizedSecret = room.value.secret_word.trim().replace(/\s+/g, '')
  
  if (normalizedGuess === normalizedSecret) {
    alert('정답입니다! 라이어가 승리하여 점수를 획득합니다.')
    // Update score logic here (+30)
  } else {
    alert('오답입니다! 시민팀이 승리합니다.')
  }
  
  // Finish game or go to next round
  await supabase.from('room').update({ status: ROOM_STATUS.WAITING, current_round: room.value.current_round + 1 }).eq('id', roomId)
  await supabase.from('user').update({ is_voted: false, role: null }).eq('room_id', roomId)
}

let subscription: any = null

onMounted(() => {
  fetchGameData()
  
  subscription = supabase
    .channel(`game:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user', filter: `room_id=eq.${roomId}` }, () => {
      fetchGameData()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room', filter: `id=eq.${roomId}` }, (payload) => {
      if (payload.eventType === 'DELETE') {
        alert('방이 초기화되었습니다. 로비로 이동합니다.')
        router.push({ name: 'lobby' })
        return
      }
      room.value = payload.new
      if (payload.new.status === ROOM_STATUS.WAITING) {
        router.push({ name: 'room', params: { id: roomId } })
      }
    })
    .subscribe()
})

onUnmounted(() => {
  if (subscription) supabase.removeChannel(subscription)
})
</script>

<template>
  <div class="flex-1 flex flex-col p-6 max-w-2xl mx-auto w-full">
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="bg-white rounded-xl shadow-sm border p-6 mb-6 flex justify-between items-center">
        <div>
          <span class="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded uppercase mb-1 block w-fit">ROUND {{ room.current_round }}</span>
          <h1 class="text-2xl font-bold text-gray-800">카테고리: {{ room.category }}</h1>
        </div>
        <button @click="resetRoom" class="text-xs text-red-400 hover:text-red-600 font-bold border border-red-100 hover:border-red-200 px-2 py-1 rounded transition-all">방 초기화</button>
      </div>

      <!-- Role Card -->
      <div class="bg-indigo-600 rounded-2xl shadow-xl p-8 mb-8 text-white text-center transform transition-all hover:scale-[1.02]">
        <h2 class="text-lg opacity-80 mb-2">당신의 역할은?</h2>
        <div v-if="authStore.user?.role === 'LIAR'">
          <h3 class="text-4xl font-black mb-4 tracking-tighter">라이어 입니다!</h3>
          <p class="text-indigo-100 leading-relaxed">제시어를 들키지 않게 연기하세요.<br>들키더라도 제시어를 맞추면 역전의 기회가 있습니다!</p>
        </div>
        <div v-else>
          <h3 class="text-4xl font-black mb-2 tracking-tighter">{{ authStore.user?.role }} 입니다!</h3>
          <p class="text-indigo-100 mb-4">제시어는 <span class="bg-white text-indigo-600 px-2 py-0.5 rounded font-bold">{{ room.secret_word }}</span> 입니다.</p>
          <p class="text-indigo-100 text-sm opacity-80">라이어에게 제시어를 들키지 않도록 주의하며 대화하세요.</p>
        </div>
      </div>

      <!-- Voting Phase -->
      <div v-if="room.status === ROOM_STATUS.PLAYING" class="space-y-6">
        <div v-if="!hasVoted">
          <h2 class="text-xl font-bold mb-4 flex items-center gap-2">
            <span class="w-2 h-6 bg-indigo-600 rounded-full"></span>
            라이어 지목 (다수결 채택)
          </h2>
          
          <div class="space-y-6">
            <!-- Own Team -->
            <div class="bg-white rounded-xl border p-5">
              <label class="block text-sm font-bold text-gray-500 mb-3 uppercase tracking-wider">우리팀 라이어</label>
              <div class="grid grid-cols-2 gap-2">
                <button 
                  v-for="member in myTeamMembers" 
                  :key="member.id"
                  @click="myVotes.ownTeamLiar = member.id"
                  :class="['py-3 px-4 rounded-lg font-medium transition-all text-sm', myVotes.ownTeamLiar === member.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-50 text-gray-700 hover:bg-gray-100']"
                >
                  {{ member.name }}
                </button>
              </div>
            </div>

            <!-- Opponent Team -->
            <div class="bg-white rounded-xl border p-5">
              <label class="block text-sm font-bold text-gray-500 mb-3 uppercase tracking-wider">상대팀 라이어</label>
              <div class="grid grid-cols-2 gap-2">
                <button 
                  v-for="member in opponentTeamMembers" 
                  :key="member.id"
                  @click="myVotes.opponentTeamLiar = member.id"
                  :class="['py-3 px-4 rounded-lg font-medium transition-all text-sm', myVotes.opponentTeamLiar === member.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-50 text-gray-700 hover:bg-gray-100']"
                >
                  {{ member.name }}
                </button>
              </div>
            </div>
          </div>

          <button 
            @click="submitVotes"
            class="w-full mt-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xl font-bold rounded-xl transition-colors shadow-lg shadow-indigo-200"
          >
            제출하기
          </button>
        </div>

        <div v-else class="bg-white rounded-xl border p-12 text-center">
          <div class="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 class="text-2xl font-bold mb-2">투표 완료!</h2>
          <p class="text-gray-500">다른 플레이어들이 투표를 마칠 때까지 기다려주세요.</p>
        </div>
      </div>

      <!-- Result Phase -->
      <div v-if="room.status === ROOM_STATUS.RESULT" class="space-y-6">
        <h2 class="text-2xl font-bold text-center mb-8">투표 결과</h2>
        <!-- This part needs more logic to show who was picked and if they were correct -->
        <div class="bg-white rounded-xl border p-8 text-center">
          <p class="text-lg mb-4">결과를 집계 중입니다...</p>
          
          <div v-if="authStore.user?.role === 'LIAR'" class="mt-8 border-t pt-8">
            <h3 class="text-xl font-bold mb-4 text-red-500">당신은 정체를 들켰습니다!</h3>
            <p class="mb-4">제시어를 맞추면 역전할 수 있습니다.</p>
            <input 
              v-model="liarGuess"
              type="text"
              placeholder="제시어 입력"
              class="w-full px-4 py-3 rounded-lg border mb-4 text-center text-xl font-bold"
              @keyup.enter="submitLiarGuess"
            />
            <button @click="submitLiarGuess" class="w-full py-3 bg-red-500 text-white font-bold rounded-lg">정답 제출</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
