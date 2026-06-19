<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
const goHome = () => router.replace({ name: 'lobby' })
</script>

<template>
  <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
    <h1 class="text-9xl font-black text-indigo-600 mb-4">404</h1>
    <h2 class="text-3xl font-black text-gray-800 mb-6">페이지를 찾을 수 없습니다</h2>
    <p class="text-gray-500 mb-10 max-w-sm">요청하신 페이지가 존재하지 않거나, 이동되었을 수 있습니다.</p>
    
    <button 
      @click="goHome"
      class="py-4 px-8 bg-indigo-600 hover:bg-indigo-700 text-white text-lg font-black rounded-2xl shadow-lg transition-all active:scale-95"
    >
      홈으로 돌아가기
    </button>
  </div>
</template>
