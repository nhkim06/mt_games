import { supabase } from '../supabase'

/**
 * 특정 방과 관련된 room/team/user/votes 변경을 모두 구독한다.
 * 변경이 감지되면 cb()를 호출(전달된 payload 포함)한다.
 * 정리 함수를 반환한다.
 */
export function subscribeRoom(roomId: string, cb: (payload?: any) => void): () => void {
  const channel = supabase
    .channel(`room-sync:${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room', filter: `id=eq.${roomId}` },
      (p) => cb(p)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'team', filter: `room_id=eq.${roomId}` },
      (p) => cb(p)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user', filter: `room_id=eq.${roomId}` },
      (p) => cb(p)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'votes', filter: `room_id=eq.${roomId}` },
      (p) => cb(p)
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
