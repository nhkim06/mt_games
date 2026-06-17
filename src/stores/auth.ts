import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '../supabase'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<any>(null)
  const user = ref<{ id: string; name: string; role?: string; team_id?: string; room_id?: string } | null>(null)
  let listenerRegistered = false

  const isAuthenticated = computed(() => !!session.value && !!user.value?.name)
  const needsProfile = computed(() => !!session.value && !user.value?.name)

  async function initialize() {
    const { data } = await supabase.auth.getSession()
    session.value = data.session

    if (data.session) {
      await fetchProfile(data.session.user.id)
    }

    // Register the auth state listener only once, even if initialize() is
    // called from multiple places (router guard + LoginView).
    if (!listenerRegistered) {
      listenerRegistered = true
      supabase.auth.onAuthStateChange(async (_event, _session) => {
        session.value = _session
        if (_session) {
          await fetchProfile(_session.user.id)
        } else {
          user.value = null
        }
      })
    }
  }

  async function fetchProfile(userId: string) {
    const { data, error } = await supabase
      .from('user')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    
    if (!error && data) {
      user.value = data
    } else {
      user.value = null
    }
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/login'
      }
    })
    if (error) throw error
  }

  function setUser(userData: any) {
    user.value = userData
  }

  async function logout() {
    await supabase.auth.signOut()
    user.value = null
    session.value = null
  }

  return { session, user, isAuthenticated, needsProfile, initialize, setUser, logout, signInWithGoogle }
})
