<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
const goHome = () => router.replace({ name: 'lobby' })
</script>

<template>
  <div class="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50 min-h-screen">
    <div class="max-w-md w-full bg-white rounded-3xl shadow-xl border border-gray-100 p-8 md:p-10 text-center relative overflow-hidden transition-all duration-300 hover:shadow-2xl">
      <!-- 배경 장식용 그라데이션 원형 패턴 -->
      <div class="absolute -top-10 -right-10 w-32 h-32 bg-indigo-50 rounded-full -z-0 opacity-70"></div>
      <div class="absolute -bottom-10 -left-10 w-32 h-32 bg-rose-50 rounded-full -z-0 opacity-70"></div>

      <div class="relative z-10">
        <!-- 아이콘 또는 일러스트 영역 -->
        <div class="mb-6 flex justify-center">
          <div class="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center text-5xl shadow-inner animate-bounce duration-1000">
            🕵️‍♂️
          </div>
        </div>

        <!-- 404 타이틀 -->
        <h1 class="text-7xl md:text-8xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 bg-clip-text text-transparent mb-2">
          404
        </h1>

        <!-- 메인 슬로건 -->
        <h2 class="text-2xl font-black text-gray-800 mb-4">
          방을 찾을 수 없습니다!
        </h2>

        <!-- 게임 맞춤형 귀여운 가이드 텍스트 -->
        <p class="text-gray-500 text-sm leading-relaxed mb-8 max-w-xs mx-auto">
          요청하신 페이지가 존재하지 않거나,<br />
          <span class="font-bold text-rose-500">라이어</span>가 흔적을 숨겼거나,<br />
          밤 사이에 <span class="font-bold text-indigo-600">마피아</span>에게 정체를 들켰을 수 있습니다!
        </p>

        <!-- 버튼 영역 -->
        <div class="space-y-3">
          <button 
            @click="goHome"
            class="w-full py-4 px-6 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white text-base font-black rounded-2xl shadow-lg shadow-indigo-100 transition-all duration-200 active:scale-95 flex items-center justify-center gap-2"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            안전한 로비로 돌아가기
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 통통 튀는 바운스 애니메이션 커스텀 속도 */
.animate-bounce {
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(-5%);
    animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
  }
  50% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
  }
}
</style>
