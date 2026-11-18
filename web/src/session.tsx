import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';

export type Role = 'owner' | 'staff1' | 'staff2' | 'staff3';
export interface User { id: string; name: string; username: string; role: Role; roleLabel: string; must_change_password: boolean; mobile?: string }

interface Session {
  user: User | null;
  demoMode: boolean;
  ready: boolean;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  unread: number;
  refreshUnread: () => void;
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
}
const Ctx = createContext<Session>(null as any);
export const useSession = () => useContext(Ctx);

/** Short two-tone alert generated with WebAudio (no sound file needed). */
function beep(high: boolean) {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = (beep as any).ctx ?? ((beep as any).ctx = new AC());
    const tones = high ? [880, 1175, 880] : [660, 880];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.15);
    });
    if (high && 'vibrate' in navigator) navigator.vibrate([120, 60, 120]);
  } catch {
    /* audio blocked until the user interacts — ignore */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [demoMode, setDemo] = useState(false);
  const [ready, setReady] = useState(false);
  const [unread, setUnread] = useState(0);
  const [soundOn, setSound] = useState(() => {
    try { return localStorage.getItem('yg_sound') !== 'off'; } catch { return true; }
  });
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/auth/me');
      setUser(r.user);
      setDemo(r.demoMode);
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    refresh();
  }, [refresh]);

  const refreshUnread = useCallback(() => {
    api.get('/notifications?unread=1').then((r) => setUnread(r.unread)).catch(() => {});
  }, []);

  // Real-time alerts via Server-Sent Events, with polling as a fallback.
  useEffect(() => {
    if (!user || user.must_change_password) return;
    refreshUnread();
    const es = new EventSource('/api/notifications/stream');
    es.addEventListener('notification', (ev) => {
      const n = JSON.parse((ev as MessageEvent).data);
      setUnread((x) => x + 1);
      if (soundRef.current) beep(n.priority === 'high');
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification(n.title, { body: n.body ?? '', icon: '/icons/icon-192.png', tag: String(n.id) }); } catch { /* ignore */ }
      }
      window.dispatchEvent(new CustomEvent('yg:notification', { detail: n }));
    });
    const poll = setInterval(refreshUnread, 60_000);
    return () => { es.close(); clearInterval(poll); };
  }, [user, refreshUnread]);

  const login = async (username: string, password: string) => {
    const r = await api.post('/auth/login', { username, password });
    setUser(r.user);
    await refresh();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  };
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
  };
  const setSoundOn = (v: boolean) => {
    setSound(v);
    try { localStorage.setItem('yg_sound', v ? 'on' : 'off'); } catch { /* ignore */ }
    if (v) beep(false); // also unlocks audio on mobile browsers
  };

  return (
    <Ctx.Provider value={{ user, demoMode, ready, login, logout, refresh, unread, refreshUnread, soundOn, setSoundOn }}>
      {children}
    </Ctx.Provider>
  );
}
