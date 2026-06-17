<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../supabase'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()
const loading = ref(false)
const checkingProfile = ref(true)

// Steps: 'auth' -> 'name' -> 'team'
const currentStep = ref<'auth' | 'name' | 'team'>('auth')
const nameInput = ref('')
const selectedTeam = ref<'A팀' | 'B팀' | null>(null)

const init = async () => {
  checkingProfile.value = true
  await authStore.initialize()
  
  // If there is a session, check if profile exists
  if (authStore.session) {
    if (authStore.user?.name) {
      // Existing user with profile -> Go to lobby
      router.push({ name: 'lobby' })
    } else {
      // Authenticated but no profile -> Start profile setup
      currentStep.value = 'name'
    }
  } else {
    // No session -> Show Google Login button
    currentStep.value = 'auth'
  }
  checkingProfile.value = false
}

onMounted(init)

// Watch for auth state changes (e.g., after Google redirect)
watch(() => authStore.session, async (newSession) => {
  if (newSession) {
    checkingProfile.value = true
    // Wait a bit for profile to be fetched by the store's onAuthStateChange
    // or manually trigger it if needed. The store's initialize handles this.
    if (authStore.user?.name) {
      router.push({ name: 'lobby' })
    } else {
      currentStep.value = 'name'
    }
    checkingProfile.value = false
  }
})

const handleGoogleLogin = async () => {
  loading.value = true
  try {
    await authStore.signInWithGoogle()
  } catch (err) {
    console.error(err)
    alert('구글 로그인 중 오류가 발생했습니다.')
    loading.value = false
  }
}

const proceedToTeam = () => {
  if (!nameInput.value.trim()) return
  currentStep.value = 'team'
}

const completeProfile = async () => {
  if (!selectedTeam.value || !authStore.session?.user) return
  
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
    
    localStorage.setItem('preferred_team_name', selectedTeam.value)
    
    authStore.setUser(data)
    router.push({ name: 'lobby' })
  } catch (error) {
    console.error('Error saving profile:', error)
    alert('프로필 저장 중 오류가 발생했습니다.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex-1 flex flex-col items-center justify-center p-6 bg-gray-50">
    <!-- Initial Loading State -->
    <div v-if="checkingProfile" class="flex flex-col items-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
      <p class="text-gray-500 font-medium">사용자 정보를 확인 중입니다...</p>
    </div>

    <!-- Step 1: Mandatory Google Login -->
    <div v-else-if="currentStep === 'auth'" class="max-w-md w-full text-center animate-in fade-in duration-500">
      <div class="mb-12">
        <h1 class="text-5xl font-black text-indigo-600 mb-4 tracking-tighter">LIAR GAME</h1>
        <p class="text-gray-500 text-lg">먼저 구글 계정으로 로그인해주세요</p>
      </div>

      <button
        @click="handleGoogleLogin"
        :disabled="loading"
        class="w-full bg-white hover:bg-gray-50 text-gray-700 font-bold py-4 px-8 rounded-2xl border-2 border-gray-100 shadow-sm flex items-center justify-center gap-4 transition-all active:scale-95 disabled:opacity-50"
      >
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" class="w-6 h-6" alt="Google">
        <span class="text-lg">Google 계정으로 시작하기</span>
      </button>
    </div>

    <!-- Profile Setup Modals (Only for authenticated users without a profile) -->
    <div v-if="!checkingProfile && currentStep !== 'auth'" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      
      <!-- Step 2: Name Entry Modal -->
      <div v-if="currentStep === 'name'" class="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full animate-in zoom-in-95 duration-200">
        <div class="mb-8">
          <div class="w-12 h-1.5 bg-indigo-600 rounded-full mb-6"></div>
          <h2 class="text-2xl font-black text-gray-800 mb-2">신규 가입을 환영합니다!</h2>
          <p class="text-gray-500">게임에서 사용할 이름을 입력해주세요.</p>
        </div>

        <input
          v-model="nameInput"
          type="text"
          placeholder="닉네임 입력"
          class="w-full px-5 py-4 bg-gray-50 rounded-2xl border-2 border-transparent focus:border-indigo-500 focus:bg-white outline-none transition-all text-xl font-bold mb-6"
          @keyup.enter="proceedToTeam"
          autofocus
        />

        <button
          @click="proceedToTeam"
          :disabled="!nameInput.trim()"
          class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-indigo-100 active:scale-95"
        >
          다음으로
        </button>
      </div>

      <!-- Step 3: Team Selection Modal -->
      <div v-if="currentStep === 'team'" class="bg-white rounded-3xl shadow-2xl p-8 max-w-sm w-full animate-in zoom-in-95 duration-200">
        <div class="mb-8 text-center">
          <div class="flex justify-center gap-1 mb-6">
            <div class="w-6 h-1.5 bg-gray-200 rounded-full"></div>
            <div class="w-12 h-1.5 bg-indigo-600 rounded-full"></div>
          </div>
          <h2 class="text-2xl font-black text-gray-800 mb-2">선호 팀 선택</h2>
          <p class="text-gray-500">입장 시 우선 배정될 팀을 선택하세요.</p>
        </div>

        <div class="grid grid-cols-2 gap-4 mb-8">
          <button 
            v-for="team in (['A팀', 'B팀'] as const)" 
            :key="team"
            @click="selectedTeam = team"
            :class="[
              'group relative overflow-hidden py-8 rounded-2xl border-4 transition-all active:scale-95',
              selectedTeam === team ? 'border-indigo-600 bg-indigo-50 text-indigo-600' : 'border-gray-50 bg-gray-50 text-gray-400 hover:border-gray-100'
            ]"
          >
            <span class="text-2xl font-black block mb-1">{{ team }}</span>
            <div v-if="selectedTeam === team" class="absolute top-2 right-2">
              <div class="bg-indigo-600 text-white p-1 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </div>
            </div>
          </button>
        </div>

        <div class="flex gap-3">
          <button @click="currentStep = 'name'" class="flex-1 py-4 bg-gray-100 text-gray-500 font-bold rounded-2xl hover:bg-gray-200 transition-all">이전</button>
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

<style scoped>
.animate-in {
  animation-duration: 0.3s;
  animation-fill-mode: both;
}
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes zoom-in-95 { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
.fade-in { animation-name: fade-in; }
.zoom-in-95 { animation-name: zoom-in-95; }
</style>
