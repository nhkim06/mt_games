<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../supabase'
import { useAuthStore } from '../stores/auth'
import { TEAM_NAMES, PREFERRED_TEAM_KEY } from '../constants'

const router = useRouter()
const authStore = useAuthStore()

const loading = ref(false)
const checking = ref(true)

// 단계: auth(구글 로그인) -> name(이름 입력) -> team(팀 선택)
const step = ref<'auth' | 'name' | 'team'>('auth')
const nameInput = ref('')
const selectedTeam = ref<(typeof TEAM_NAMES)[number] | null>(null)

// 세션/프로필 상태에 따라 보여줄 단계를 결정한다.
// 구글 리다이렉트 후 세션이 비동기로 도착하므로 watch로도 다시 평가한다.
const evaluate = () => {
  if (!authStore.profileChecked) return // 프로필 조회 완료 전에는 판단 보류

  if (authStore.isAuthenticated) {
    // 이미 가입된 유저 -> 로비
    router.replace({ name: 'lobby' })
  } else if (authStore.needsProfile) {
    // 구글 로그인은 됐지만 신규 유저 -> 프로필 설정 모달 시작
    if (step.value === 'auth') step.value = 'name'
  } else {
    // 세션 없음 -> 구글 로그인 화면
    step.value = 'auth'
  }
}

onMounted(async () => {
  checking.value = true
  await authStore.initialize()
  checking.value = false
  evaluate()
})

watch(
  () => [authStore.profileChecked, authStore.session, authStore.user?.name],
  evaluate
)

const handleGoogleLogin = async () => {
  loading.value = true
  try {
    await authStore.signInWithGoogle()
    // 구글 리다이렉트 후 페이지가 다시 로드되며 onMounted가 분기 처리한다.
  } catch (err) {
    console.error(err)
    alert('구글 로그인 중 오류가 발생했습니다.')
    loading.value = false
  }
}

const proceedToTeam = () => {
  if (!nameInput.value.trim()) return
  step.value = 'team'
}

const completeProfile = async () => {
  if (!nameInput.value.trim() || !selectedTeam.value || !authStore.session?.user) return

  loading.value = true
  try {
    const { data, error } = await supabase
      .from('user')
      .upsert({
        id: authStore.session.user.id,
        name: nameInput.value.trim(),
        is_voted: false
      })
      .select()
      .single()

    if (error) throw error

    // 팀 테이블은 방에 종속되므로, 선호 팀은 기기에 저장해두고 방 입장 시 적용한다.
    localStorage.setItem(PREFERRED_TEAM_KEY, selectedTeam.value)

    authStore.setUser(data)
    router.replace({ name: 'lobby' })
  } catch (err) {
    console.error('프로필 저장 오류:', err)
    alert('프로필 저장 중 오류가 발생했습니다.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex-1 flex flex-col items-center justify-center p-6">
    <!-- 로딩 -->
    <div v-if="checking" class="flex flex-col items-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
      <p class="text-gray-500 font-medium">사용자 정보를 확인 중입니다...</p>
    </div>

    <!-- 1단계: 구글 로그인 -->
    <div v-else-if="step === 'auth'" class="max-w-md w-full text-center animate-in fade-in">
      <div class="mb-12">
        <h1 class="text-5xl font-black text-indigo-600 mb-4 tracking-tighter">LIAR GAME</h1>
        <p class="text-gray-500 text-lg">구글 계정으로 로그인하고 시작하세요</p>
      </div>

      <button
        @click="handleGoogleLogin"
        :disabled="loading"
        class="w-full bg-white hover:bg-gray-50 text-gray-700 font-bold py-4 px-8 rounded-2xl border-2 border-gray-100 shadow-sm flex items-center justify-center gap-4 transition-all active:scale-95 disabled:opacity-50"
      >
        <img
          src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
          class="w-6 h-6"
          alt="Google"
        />
        <span class="text-lg">Google 계정으로 시작하기</span>
      </button>
    </div>

    <!-- 신규 유저 프로필 설정 모달 -->
    <div
      v-else
      class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
    >
      <!-- 2단계: 이름 입력 -->
      <div
        v-if="step === 'name'"
        class="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full animate-in zoom-in-95"
      >
        <div class="mb-8">
          <div class="w-12 h-1.5 bg-indigo-600 rounded-full mb-6"></div>
          <h2 class="text-2xl font-black text-gray-800 mb-2">환영합니다! 🎉</h2>
          <p class="text-gray-500">게임에서 사용할 이름을 입력해주세요.</p>
        </div>

        <input
          v-model="nameInput"
          type="text"
          placeholder="닉네임 입력"
          maxlength="12"
          class="w-full px-5 py-4 bg-gray-50 rounded-2xl border-2 border-transparent focus:border-indigo-500 focus:bg-white outline-none transition-all text-xl font-bold mb-6"
          @keyup.enter="proceedToTeam"
          autofocus
        />

        <button
          @click="proceedToTeam"
          :disabled="!nameInput.trim()"
          class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-indigo-100 active:scale-95 disabled:opacity-50"
        >
          다음
        </button>
      </div>

      <!-- 3단계: 팀 선택 -->
      <div
        v-else-if="step === 'team'"
        class="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full animate-in zoom-in-95"
      >
        <div class="mb-8 text-center">
          <div class="flex justify-center gap-1 mb-6">
            <div class="w-6 h-1.5 bg-gray-200 rounded-full"></div>
            <div class="w-12 h-1.5 bg-indigo-600 rounded-full"></div>
          </div>
          <h2 class="text-2xl font-black text-gray-800 mb-2">선호 팀 선택</h2>
          <p class="text-gray-500">방 입장 시 우선 배정될 팀을 골라주세요.</p>
        </div>

        <div class="grid grid-cols-2 gap-4 mb-8">
          <button
            v-for="team in TEAM_NAMES"
            :key="team"
            @click="selectedTeam = team"
            :class="[
              'relative overflow-hidden py-8 rounded-2xl border-4 transition-all active:scale-95',
              selectedTeam === team
                ? 'border-indigo-600 bg-indigo-50 text-indigo-600'
                : 'border-gray-50 bg-gray-50 text-gray-400 hover:border-gray-100'
            ]"
          >
            <span class="text-2xl font-black block">{{ team }}</span>
            <div v-if="selectedTeam === team" class="absolute top-2 right-2">
              <div class="bg-indigo-600 text-white p-1 rounded-full">
                <svg class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fill-rule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
            </div>
          </button>
        </div>

        <div class="flex gap-3">
          <button
            @click="step = 'name'"
            class="flex-1 py-4 bg-gray-100 text-gray-500 font-bold rounded-2xl hover:bg-gray-200 transition-all"
          >
            이전
          </button>
          <button
            @click="completeProfile"
            :disabled="!selectedTeam || loading"
            class="flex-[2] bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-indigo-100 active:scale-95 disabled:opacity-50"
          >
            시작하기
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
