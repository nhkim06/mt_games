<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { supabase } from '../supabase'
import { GAME_TYPES } from '../constants'
import LiarGameView from './LiarGameView.vue'
import MafiaGameView from './MafiaGameView.vue'

const route = useRoute()
const roomId = route.params.id as string
const gameType = ref<string | null>(null)
const loading = ref(true)

const fetchData = async () => {
  const { data: roomData } = await supabase
    .from('room')
    .select('game_type')
    .eq('id', roomId)
    .maybeSingle()
  
  if (roomData) {
    gameType.value = roomData.game_type
  }
  loading.value = false
}

onMounted(() => {
  fetchData()
})
</script>

<template>
  <div v-if="loading" class="flex-1 flex items-center justify-center py-20">
    <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
  </div>
  <template v-else>
    <LiarGameView v-if="gameType === GAME_TYPES.LIAR" :roomId="roomId" />
    <MafiaGameView v-else-if="gameType === GAME_TYPES.MAFIA" :roomId="roomId" />
    <div v-else class="flex-1 flex flex-col items-center justify-center">
        <p class="text-gray-500">알 수 없는 게임 타입입니다.</p>
        <router-link to="/" class="text-indigo-600 font-bold mt-4">로비로 돌아가기</router-link>
    </div>
  </template>
</template>
