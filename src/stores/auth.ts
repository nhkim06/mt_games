import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '../supabase'

export interface Profile {
  id: string
  name: string
  role?: string | null
  team_id?: string | null
  room_id?: string | null
  is_voted?: boolean
}

export const useAuthStore = defineStore('auth', () => {
  const session = ref<any>(null)
  const user = ref<Profile | null>(null)
  const isAdmin = ref(false)
  // 세션에 대한 프로필 조회가 끝났는지 여부 (모달 표시 타이밍 판단용)
  const profileChecked = ref(false)

  let listenerRegistered = false
  let initPromise: Promise<void> | null = null

  const isAuthenticated = computed(() => !!session.value && !!user.value?.name)
  const needsProfile = computed(() => !!session.value && !user.value?.name)

  async function fetchProfile(userId: string) {
    const { data } = await supabase.from('user').select('*').eq('id', userId).maybeSingle()
    user.value = (data as Profile) ?? null

    if (data) {
      const { data: adminRow } = await supabase
        .from('admin')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle()
      isAdmin.value = !!adminRow
    } else {
      isAdmin.value = false
    }
  }

  async function _initialize() {
    const { data } = await supabase.auth.getSession()
    session.value = data.session

    if (data.session) {
      await fetchProfile(data.session.user.id)
    }
    profileChecked.value = true

    // 인증 상태 리스너는 단 한 번만 등록한다.
    // (구글 리다이렉트 직후 세션이 뒤늦게 도착하는 경우를 여기서 반영한다.)
    if (!listenerRegistered) {
      listenerRegistered = true
      supabase.auth.onAuthStateChange(async (_event, _session) => {
        session.value = _session
        if (_session) {
          profileChecked.value = false
          await fetchProfile(_session.user.id)
        } else {
          user.value = null
          isAdmin.value = false
        }
        profileChecked.value = true
      })
    }
  }

  /** 여러 곳에서 호출돼도 실제 초기화는 한 번만 수행한다. */
  function initialize() {
    if (!initPromise) initPromise = _initialize()
    return initPromise
  }

  async function refreshProfile() {
    if (session.value?.user) await fetchProfile(session.value.user.id)
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // 기존에 동작하던 리다이렉트 설정(사이트 루트)을 유지한다.
      // 신규 유저는 라우터 가드가 /login 으로 보내고, 거기서 프로필 모달이 뜬다.
      options: { redirectTo: window.location.origin }
    })
    if (error) throw error
  }

  function setUser(userData: Profile) {
    user.value = userData
  }

  async function logout() {
    await supabase.auth.signOut()
    user.value = null
    session.value = null
    isAdmin.value = false
  }

  return {
    session,
    user,
    isAdmin,
    profileChecked,
    isAuthenticated,
    needsProfile,
    initialize,
    refreshProfile,
    setUser,
    logout,
    signInWithGoogle
  }
})
