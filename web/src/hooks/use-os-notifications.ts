import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from './use-auth'

export function useOSNotifications() {
    const { user } = useAuth()

    useEffect(() => {
        if (!user?.id) return

        const channel = supabase
            .channel(`os-notifications:${user.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${user.id}`,
                },
                (payload) => {
                    const newDoc = payload.new as any
                    const w = window as any
                    if (w.ipcRenderer && w.ipcRenderer.invoke) {
                        w.ipcRenderer.invoke('notify', {
                            title: newDoc.title || 'CTrack',
                            body: newDoc.message || 'You have a new notification.'
                        }).catch((err: any) => console.error('Failed to show OS notification', err))
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [user?.id])
}
