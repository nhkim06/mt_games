<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../supabase'
import { useAuthStore } from '../stores/auth'
import { ROOM_STATUS, ROLES, TARGET_TYPES, MESSAGES } from '../constants'
import { subscribeRoom } from '../lib/realtime'
import {
  computeResults,
  computeScoreDeltas,
  caughtLiarIds,
  getAllLiarIds,
  noLiarCaught,
  assignRoles,
  pickCategoryAndWord,
  normalizeWord
} from '../game/liar'

const props = defineProps<{ roomId: string }>()
const router = useRouter()
const authStore = useAuthStore()
const roomId = props.roomId

const room = ref<any>(null)
const teams = ref<any[]>([])
const users = ref<any[]>([])
const votes = ref<any[]>([])
const loading = ref(true)

const selection = ref<{ own: string; opp: string }>({ own: '', opp: '' })
const submitting = ref(false)
const guessInput = ref('')
const submittingGuess = ref(false)
const guessResult = ref<'correct' | 'wrong' | ''>('')
const advancing = ref(false)
const roleVisible = ref(false)
const dynamicScores = ref({ own_liar: 10, opp_liar: 20, liar_guess: 30 })

const me = computed(() => users.value.find((u) => u.id === authStore.user?.id))
const myRole = computed(() => me.value?.role ?? authStore.user?.role)
const hasVoted = computed(() => !!me.value?.is_voted)

const myTeam = computed(() => teams.value.find((t) => t.id === me.value?.team_id))
const myTeamMembers = computed(() => users.value.filter((u) => u.team_id === me.value?.team_id))
const opponentTeamMembers = computed(() =>
  users.value.filter((u) => u.team_id && u.team_id !== me.value?.team_id)
)

const userName = (id: string | null) => users.value.find((u) => u.id === id)?.name ?? '지목 없음'

const results = computed(() => computeResults(teams.value, users.value, votes.value))
const myResult = computed(() => results.value.find((r) => r.teamId === me.value?.team_id) ?? null)
const allLiarIds = computed(() => getAllLiarIds(users.value))
const iMustGuess = computed(
  () => myRole.value === ROLES.LIAR && !!me.value && allLiarIds.value.includes(me.value.id)
)
const nobodyCaught = computed(() => results.value.length > 0 && noLiarCaught(results.value))

const guessedLiarIds = computed(() =>
  votes.value
    .filter((v) => v.target_type === TARGET_TYPES.LIAR_GUESS)
    .map((v) => v.voter_id as string)
)
const iHaveGuessed = computed(() => !!me.value && guessedLiarIds.value.includes(me.value.id))
const pendingLiarIds = computed(() =>
  allLiarIds.value.filter((id) => !guessedLiarIds.value.includes(id))
)
const submittedCount = computed(() => allLiarIds.value.length - pendingLiarIds.value.length)
const canAdvance = computed(() => pendingLiarIds.value.length === 0)

const bgClass = computed(() => {
  if (room.value?.status !== ROOM_STATUS.RESULT) return ''
  return nobodyCaught.value ? 'bg-rose-100' : 'bg-green-100'
})

const fetchData = async () => {
  const { data: roomData } = await supabase.from('room').select('*').eq('id', roomId).maybeSingle()
  if (!roomData) {
    alert('방이 초기화되었습니다. 로비로 이동합니다.')
    router.replace({ name: 'lobby' })
    return
  }
  room.value = roomData

  if (roomData.status === ROOM_STATUS.WAITING) {
    router.replace({ name: 'room', params: { id: roomId } })
    return
  }

  const [{ data: teamData }, { data: userData }, { data: voteData }, { data: settingsData }] = await Promise.all([
    supabase.from('team').select('*').order('team_name'),
    supabase.from('user').select('*').eq('room_id', roomId),
    supabase
      .from('votes')
      .select('*')
      .eq('room_id', roomId)
      .eq('round', roomData.current_round),
    supabase.from('settings').select('*')
  ])
  
  if (settingsData) {
    settingsData.forEach(s => {
      if (s.key === 'score_own_liar') dynamicScores.value.own_liar = s.value
      if (s.key === 'score_opp_liar') dynamicScores.value.opp_liar = s.value
      if (s.key === 'score_liar_guess') dynamicScores.value.liar_guess = s.value
    })
  }

  teams.value = teamData || []
  users.value = userData || []
  votes.value = voteData || []
  loading.value = false

  if (roomData.status === ROOM_STATUS.PLAYING) await resolveIfAllVoted()
}

const submitVotes = async () => {
  if (submitting.value) return
  if (!selection.value.own || !selection.value.opp) {
    alert('우리팀/상대팀 라이어를 모두 지목해주세요.')
    return
  }
  submitting.value = true
  try {
    const base = {
      room_id: roomId,
      round: room.value.current_round,
      voter_id: authStore.user?.id,
      voter_team_id: me.value?.team_id
    }
    await supabase.from('votes').insert([
      { ...base, target_type: TARGET_TYPES.OWN_TEAM, candidate_id: selection.value.own },
      { ...base, target_type: TARGET_TYPES.OPPONENT_TEAM, candidate_id: selection.value.opp }
    ])
    await supabase.from('user').update({ is_voted: true }).eq('id', authStore.user?.id)
    await fetchData()
  } catch (e) {
    console.error(e)
    alert('투표 중 오류가 발생했습니다.')
  } finally {
    submitting.value = false
  }
}

const resolveIfAllVoted = async () => {
  const allVoted = users.value.length > 0 && users.value.every((u) => u.is_voted)
  if (!allVoted) return

  const { data: claimed } = await supabase
    .from('room')
    .update({ status: ROOM_STATUS.RESULT })
    .eq('id', roomId)
    .eq('status', ROOM_STATUS.PLAYING)
    .select()

  if (claimed && claimed.length > 0) {
    const deltas = computeScoreDeltas(results.value, {
      own_liar: dynamicScores.value.own_liar,
      opp_liar: dynamicScores.value.opp_liar
    })
    await Promise.all(
      teams.value.map((t) => {
        const d = deltas[t.id] || 0
        return d ? supabase.from('team').update({ score: t.score + d }).eq('id', t.id) : null
      })
    )
  }
}

const submitGuess = async () => {
  if (submittingGuess.value || iHaveGuessed.value || !me.value) return
  submittingGuess.value = true
  try {
    const correct = normalizeWord(guessInput.value) === normalizeWord(room.value.secret_word)
    guessResult.value = correct ? 'correct' : 'wrong'

    await supabase.from('votes').insert({
      room_id: roomId,
      round: room.value.current_round,
      voter_id: me.value.id,
      voter_team_id: me.value.team_id,
      target_type: TARGET_TYPES.LIAR_GUESS,
      candidate_id: me.value.id
    })

    if (correct && myTeam.value) {
      await supabase
        .from('team')
        .update({ score: myTeam.value.score + dynamicScores.value.liar_guess })
        .eq('id', myTeam.value.id)
    }
    await fetchData()
  } catch (e) {
    console.error(e)
    alert('제출 중 오류가 발생했습니다.')
  } finally {
    submittingGuess.value = false
  }
}

const nextRound = async () => {
  if (advancing.value || (!nobodyCaught.value && !canAdvance.value)) return
  advancing.value = true
  try {
    const isGameOver = !nobodyCaught.value || room.value.current_round >= 3
    const nextStatus = isGameOver ? ROOM_STATUS.FINISHED : ROOM_STATUS.PLAYING

    const { data: claimed } = await supabase
      .from('room')
      .update({ status: nextStatus })
      .eq('id', roomId)
      .eq('status', ROOM_STATUS.RESULT)
      .select()

    if (claimed && claimed.length > 0) {
      if (nextStatus === ROOM_STATUS.PLAYING) {
        const { category, secret_word } = pickCategoryAndWord()
        const roleUpdates = assignRoles(teams.value, users.value)
        await Promise.all(
          roleUpdates.map((u) =>
            supabase.from('user').update({ role: u.role, is_voted: false }).eq('id', u.id)
          )
        )
        await supabase.from('votes').delete().eq('room_id', roomId)
        await supabase
          .from('room')
          .update({ category, secret_word, current_round: room.value.current_round + 1 })
          .eq('id', roomId)
      }
    }
    if (nextStatus === ROOM_STATUS.PLAYING) {
      selection.value = { own: '', opp: '' }
      guessInput.value = ''
      guessResult.value = ''
      await fetchData()
    }
  } finally {
    advancing.value = false
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
    authStore.user.room_id = null
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
  <div :class="['flex-1 flex flex-col w-full transition-colors duration-500', bgClass]">
    <div class="flex-1 flex flex-col p-6 max-w-2xl mx-auto w-full">
      <div v-if="loading" class="flex-1 flex items-center justify-center py-20">
        <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
      </div>

      <template v-else>
        <div class="bg-white rounded-2xl shadow-sm border p-5 mb-6 flex justify-between items-center">
          <div>
            <span class="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded uppercase block w-fit mb-1">{{ room.name || room.id }} · ROUND {{ room.current_round }}</span>
            <h1 class="text-xl font-black text-gray-800">카테고리 · {{ room.category }}</h1>
          </div>
          <button @click="resetRoom" class="text-xs font-bold text-red-400 hover:text-red-600 border border-red-100 px-2 py-1.5 rounded-lg transition-all">리셋</button>
        </div>

        <div :class="['rounded-3xl shadow-xl p-8 mb-8 text-center text-white transition-all duration-300 relative overflow-hidden', !roleVisible ? 'bg-gray-800' : (myRole === ROLES.LIAR ? 'bg-rose-600' : 'bg-indigo-600')]">
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
            <p class="text-gray-400 text-sm">버튼을 눌러 역할을 확인하세요.</p>
          </template>
          <template v-else>
            <template v-if="myRole === ROLES.LIAR">
              <h3 class="text-4xl font-black mb-4 tracking-tighter animate-in zoom-in-95">라이어 🤫</h3>
              <p class="text-rose-100 leading-relaxed text-sm">제시어를 모르는 척 연기하세요.<br />들켜도 제시어를 맞히면 역전할 수 있습니다!</p>
            </template>
            <template v-else>
              <h3 class="text-4xl font-black mb-3 tracking-tighter animate-in zoom-in-95">시민 🙂</h3>
              <p class="text-indigo-100 text-sm">제시어는 <span class="bg-white text-indigo-600 px-2 py-0.5 rounded font-black mx-1 shadow-sm">{{ room.secret_word }}</span> 입니다.</p>
              <p class="text-indigo-200 text-xs mt-2 opacity-80">라이어에게 들키지 않게 대화하세요.</p>
            </template>
          </template>
        </div>

      <div v-if="room.status === ROOM_STATUS.PLAYING">
        <div v-if="!hasVoted" class="space-y-6">
          <h2 class="text-lg font-black flex items-center gap-2"><span class="w-2 h-6 bg-indigo-600 rounded-full"></span>라이어 지목 <span class="text-sm font-medium text-gray-400">(다수결로 채택)</span></h2>
          <div class="bg-white rounded-2xl border p-5">
            <label class="block text-xs font-black text-gray-400 mb-3 uppercase tracking-wider">우리팀 라이어</label>
            <div class="grid grid-cols-2 gap-2">
              <button v-for="m in myTeamMembers" :key="m.id" @click="selection.own = m.id" :class="['py-3 px-4 rounded-xl font-bold text-sm transition-all', selection.own === m.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-50 text-gray-700 hover:bg-gray-100']">{{ m.name }}</button>
            </div>
          </div>
          <div class="bg-white rounded-2xl border p-5">
            <label class="block text-xs font-black text-gray-400 mb-3 uppercase tracking-wider">상대팀 라이어</label>
            <div class="grid grid-cols-2 gap-2">
              <button v-for="m in opponentTeamMembers" :key="m.id" @click="selection.opp = m.id" :class="['py-3 px-4 rounded-xl font-bold text-sm transition-all', selection.opp === m.id ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-50 text-gray-700 hover:bg-gray-100']">{{ m.name }}</button>
            </div>
          </div>
          <button @click="submitVotes" :disabled="submitting" class="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white text-lg font-black rounded-2xl transition-colors shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50">제출하기</button>
        </div>
        <div v-else class="bg-white rounded-2xl border p-12 text-center">
          <div class="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
          </div>
          <h2 class="text-2xl font-black mb-2">투표 완료!</h2>
          <p class="text-gray-500">{{ users.filter((u) => u.is_voted).length }} / {{ users.length }}명 투표 · 나머지 인원을 기다리는 중...</p>
        </div>
      </div>

      <div v-else-if="room.status === ROOM_STATUS.RESULT" class="space-y-5">
        <h2 class="text-2xl font-black text-center">투표 결과</h2>
        <div v-if="myResult" class="space-y-3">
          <div class="bg-white rounded-2xl border p-5">
            <p class="text-gray-500 text-sm mb-1">우리팀 라이어는 <b class="text-gray-800">{{ userName(myResult.ownDesignatedId) }}</b>(으)로 지목했습니다</p>
            <p :class="myResult.ownCaught ? 'text-green-600 font-black' : 'text-rose-500 font-bold'">{{ myResult.ownCaught ? '✓ 라이어가 맞습니다 (+10)' : '✗ 라이어가 아닙니다' }}</p>
          </div>
          <div class="bg-white rounded-2xl border p-5">
            <p class="text-gray-500 text-sm mb-1">상대팀 라이어는 <b class="text-gray-800">{{ userName(myResult.oppDesignatedId) }}</b>(으)로 지목했습니다</p>
            <p :class="myResult.oppCaught ? 'text-green-600 font-black' : 'text-rose-500 font-bold'">{{ myResult.oppCaught ? '✓ 라이어가 맞습니다!' : '✗ 라이어가 아닙니다' }}</p>
          </div>
        </div>
        <div v-if="nobodyCaught" class="bg-amber-50 border border-amber-200 text-amber-700 rounded-2xl p-5 text-center font-bold">
          <template v-if="room.current_round < 3">두 팀 다 상대팀 라이어를 맞추지 못했습니다!<br /><span class="text-sm font-medium">다음 라운드로 넘어갑니다.</span></template>
          <template v-else>3라운드까지 라이어를 잡지 못했습니다!<br /><span class="text-sm font-medium">라이어팀의 승리입니다.</span></template>
        </div>
        <div v-if="!nobodyCaught" class="mt-4">
          <div v-if="iMustGuess" class="bg-rose-50 border-2 border-rose-200 rounded-2xl p-6 text-center">
            <h3 class="text-lg font-black text-rose-600 mb-2">정체가 들켰습니다!</h3>
            <p class="text-rose-500 text-sm mb-4">제시어를 제출하세요. 맞히면 +30점!</p>
            <template v-if="!iHaveGuessed">
              <input v-model="guessInput" type="text" placeholder="제시어 입력" class="w-full px-4 py-3 rounded-xl border-2 border-rose-200 focus:border-rose-400 outline-none mb-3 text-center text-xl font-black" @keyup.enter="submitGuess" />
              <button @click="submitGuess" :disabled="submittingGuess" class="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl transition-colors disabled:opacity-50">{{ submittingGuess ? '제출 중...' : '제시어 제출' }}</button>
            </template>
            <div v-else><p :class="['text-2xl font-black', guessResult === 'correct' ? 'text-green-600' : 'text-gray-500']">{{ guessResult === 'correct' ? '정답! +30점 🎉' : '오답입니다 😢' }}</p></div>
          </div>
          <div v-else class="bg-white border rounded-2xl p-6 text-center">
            <p class="text-gray-700 font-bold mb-1">라이어가 제시어를 제출하는 중입니다…</p>
            <p class="text-gray-400 text-sm">제출 {{ submittedCount }} / {{ allLiarIds.length }} · 모두 제출하면 결과 화면으로 넘어갑니다.</p>
          </div>
        </div>
        <button @click="nextRound" :disabled="advancing || (!nobodyCaught && !canAdvance)" class="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white text-lg font-black rounded-2xl transition-colors shadow-lg shadow-indigo-200 active:scale-95 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed mt-4">{{ !nobodyCaught || room.current_round >= 3 ? '게임 종료' : '다음 라운드' }}</button>
      </div>

      <div v-else-if="room.status === ROOM_STATUS.FINISHED" class="space-y-5">
        <h2 class="text-2xl font-black text-center mb-2">게임 종료 🏁</h2>
        <div v-for="team in [...teams].sort((a, b) => b.score - a.score)" :key="team.id" class="bg-white rounded-2xl border p-5 flex justify-between items-center">
          <span class="font-black text-gray-800">{{ team.team_name }}</span>
          <span class="text-2xl font-black text-indigo-600">{{ team.score }}점</span>
        </div>
        <button @click="goLobby" class="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white text-lg font-black rounded-2xl transition-colors shadow-lg">로비로 돌아가기</button>
      </div>

      <div v-if="room.status !== ROOM_STATUS.FINISHED" class="mt-8 grid grid-cols-2 gap-3">
        <div v-for="team in teams" :key="team.id" :class="['rounded-2xl border p-4 text-center', team.id === myTeam?.id ? 'bg-indigo-50 border-indigo-200' : 'bg-white']">
          <p class="text-xs font-bold text-gray-400 mb-1">{{ team.team_name }}</p>
          <p class="text-2xl font-black text-gray-800">{{ team.score }}</p>
        </div>
      </div>
    </template>
  </div>
</div>
</template>
