"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import Peer, { DataConnection } from "peerjs";
import YouTubePlayer from "youtube-player";
import type { YouTubePlayer as YTPlayerType } from "youtube-player/dist/types";

// ─── Types ───────────────────────────────────────────────────────────
type ConnectionStatus = "disconnected" | "connecting" | "connected";
type ActiveTab = "watch" | "chat" | "party";
type VideoSource = "youtube" | "netflix" | "none";

interface SyncPacket {
  action: "PLAY" | "PAUSE" | "SEEK" | "URL_CHANGE" | "COUNTDOWN" | "CHAT";
  time: number;
  url?: string;
  sentAt?: number;
  text?: string;
}

// ─── Icons ───────────────────────────────────────────────────────────
const Icons = {
  Watch: ({ active }: { active: boolean }) => (
    <svg className={`w-6 h-6 transition-colors duration-300 ${active ? 'text-red-600' : 'text-zinc-700'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  Chat: ({ active }: { active: boolean }) => (
    <svg className={`w-6 h-6 transition-colors duration-300 ${active ? 'text-red-600' : 'text-zinc-700'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  Party: ({ active }: { active: boolean }) => (
    <svg className={`w-6 h-6 transition-colors duration-300 ${active ? 'text-red-600' : 'text-zinc-700'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  YouTube: () => (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
    </svg>
  ),
  Netflix: () => (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6.51 20L6.5 4l3.12 1.4L10.36 20h2.95l-1.3-15 3.03-1.38L18 20h-3.15l-1.3-15-3.04 1.4z" />
    </svg>
  )
};

// ─── Utility ─────────────────────────────────────────────────────────
function generateShortId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return `SKY-${id}`;
}

function getSource(url: string): VideoSource {
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("netflix.com")) return "netflix";
  return "none";
}

function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.pathname.startsWith("/watch")) return parsed.searchParams.get("v");
      if (parsed.pathname.startsWith("/embed/") || parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2];
    }
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
  } catch (e) {
    const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }
  return null;
}

// ─── Main Component ──────────────────────────────────────────────────
export default function WatchParty() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("watch");
  const [isMobile, setIsMobile] = useState(false);
  const [myPeerId, setMyPeerId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [urlInput, setUrlInput] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const [source, setSource] = useState<VideoSource>("youtube");
  const [chatMessages, setChatMessages] = useState<{ from: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const playerRef = useRef<YTPlayerType | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const isSyncingRef = useRef<boolean>(false);
  const lastTimeRef = useRef<number>(0);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const checkSize = () => setIsMobile(window.innerWidth < 1024);
    checkSize();
    window.addEventListener("resize", checkSize);
    return () => window.removeEventListener("resize", checkSize);
  }, []);

  const sendPacket = useCallback((packet: SyncPacket) => {
    if (connRef.current?.open) {
      connRef.current.send({ ...packet, sentAt: Date.now() });
    }
  }, []);

  const initPlayer = useCallback((videoId: string) => {
    if (!playerContainerRef.current) return;
    if (playerRef.current) { try { playerRef.current.destroy(); } catch (e) { } }
    const player = YouTubePlayer(playerContainerRef.current, {
      videoId, width: "100%" as any, height: "100%" as any,
      playerVars: { autoplay: 1, modestbranding: 1, rel: 0, controls: 1, enablejsapi: 1, origin: typeof window !== 'undefined' ? window.location.origin : '' },
    });
    playerRef.current = player;
    
    // Force play as soon as it's ready
    player.on("ready", () => {
      player.playVideo().catch(() => {});
    });

    player.on("stateChange", (event: { data: number }) => {
      if (isSyncingRef.current) return;
      if (event.data === 1 || event.data === 2) {
        player.getCurrentTime().then(time => sendPacket({ action: event.data === 1 ? "PLAY" : "PAUSE", time }));
      }
    });
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    syncIntervalRef.current = setInterval(async () => {
      if (isSyncingRef.current || !playerRef.current) return;
      try {
        const currentTime = await player.getCurrentTime();
        if (Math.abs(currentTime - lastTimeRef.current) > 2) sendPacket({ action: "SEEK", time: currentTime });
        lastTimeRef.current = currentTime;
      } catch (e) { }
    }, 500);
  }, [sendPacket]);

  const handleConnection = useCallback((conn: DataConnection) => {
    connRef.current = conn;
    setStatus("connecting");

    const onOpen = () => {
      setStatus("connected");
      conn.send({ action: "URL_CHANGE", url: urlInput });
    };

    if (conn.open) onOpen();
    else conn.on("open", onOpen);

    conn.on("data", (data: any) => {
      if (data.action === "CHAT") { setChatMessages(p => [...p, { from: "partner", text: data.text }]); return; }
      if (data.action === "COUNTDOWN") { startCountdown(false); return; }
      if (data.action === "URL_CHANGE") {
        const s = getSource(data.url);
        setSource(s);
        setUrlInput(data.url);
        if (s === "youtube") {
          const id = extractVideoId(data.url);
          if (id) initPlayer(id);
        }
        return;
      }
      isSyncingRef.current = true;
      const latency = data.sentAt ? (Date.now() - data.sentAt) / 1000 : 0;
      const compensatedTime = data.time + latency;
      if (data.action === "PLAY") { playerRef.current?.seekTo(compensatedTime, true); playerRef.current?.playVideo(); }
      else if (data.action === "PAUSE") { playerRef.current?.seekTo(data.time, true); playerRef.current?.pauseVideo(); }
      else if (data.action === "SEEK") { playerRef.current?.seekTo(compensatedTime, true); }
      setTimeout(() => isSyncingRef.current = false, 500);
    });
    conn.on("close", () => { setStatus("disconnected"); connRef.current = null; });
  }, [initPlayer, urlInput]);

  const startCountdown = (broadcast = true) => {
    if (broadcast) sendPacket({ action: "COUNTDOWN", time: 0 });
    let count = 3;
    setCountdown(count);
    const itv = setInterval(() => {
      count--;
      if (count <= 0) { clearInterval(itv); setCountdown(null); if (source === "youtube") playerRef.current?.playVideo(); }
      else { setCountdown(count); }
    }, 1000);
  };

  const connectToPeer = useCallback((id: string) => {
    if (!peerRef.current) return;
    setStatus("connecting");
    handleConnection(peerRef.current.connect(id, { reliable: true }));
  }, [handleConnection]);

  const initPeer = useCallback(() => {
    if (peerRef.current) peerRef.current.destroy();
    const peer = new Peer(generateShortId(), { debug: 1, secure: true, config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:global.stun.twilio.com:3478" }] } });
    peerRef.current = peer;
    peer.on("open", id => {
      setMyPeerId(id);
      const joinId = new URLSearchParams(window.location.search).get("join");
      if (joinId) { setPartnerId(joinId); connectToPeer(joinId); }
    });
    peer.on("connection", handleConnection);
    peer.on("error", () => setStatus("disconnected"));
  }, [connectToPeer, handleConnection]);

  useEffect(() => {
    initPeer();
    const s = getSource(urlInput);
    setSource(s);
    if (s === "youtube") initPlayer(extractVideoId(urlInput) || "dQw4w9WgXcQ");
    return () => { peerRef.current?.destroy(); if (syncIntervalRef.current) clearInterval(syncIntervalRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const handleUrlChange = (forcedUrl?: string) => {
    const finalUrl = forcedUrl || urlInput;
    const s = getSource(finalUrl);
    setSource(s);
    if (s === "youtube") {
      const id = extractVideoId(finalUrl);
      if (id) {
        initPlayer(id);
      }
    }
    setUrlInput(finalUrl);
    sendPacket({ action: "URL_CHANGE", time: 0, url: finalUrl });
  };

  const sendChat = () => {
    if (!chatInput.trim() || !connRef.current?.open) return;
    connRef.current.send({ action: "CHAT", text: chatInput });
    setChatMessages(p => [...p, { from: "me", text: chatInput }]);
    setChatInput("");
  };

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[100dvh] bg-black text-white font-sans overflow-hidden select-none">

      <header className="h-14 px-6 flex items-center justify-between fixed top-0 left-0 right-0 z-50 bg-black/50 backdrop-blur-md">
        <h1 className="text-xl font-black text-red-600 tracking-tighter uppercase italic">syncloud</h1>
        <div className="flex items-center gap-3">
          <div className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-red-600 shadow-[0_0_8px_rgba(229,9,20,0.8)]' : 'bg-zinc-800'}`} />
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{status}</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col pt-14 pb-20 overflow-hidden relative">

        {countdown !== null && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/90 animate-fade-in">
            <span className="text-9xl font-black text-red-600 animate-pulse">{countdown}</span>
          </div>
        )}

        <div className={`w-full bg-black shrink-0 relative transition-all duration-500 ${activeTab !== 'watch' && isMobile ? 'h-0 opacity-0' : 'h-auto'}`}>
          <div className="w-full aspect-video lg:max-w-4xl lg:mx-auto lg:mt-8 lg:rounded-2xl overflow-hidden shadow-2xl">
            {source === "youtube" ? (
              <div ref={playerContainerRef} className="w-full h-full" />
            ) : source === "netflix" ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-zinc-900/10">
                <div className="space-y-6 animate-fade-in">
                  <div className="text-red-600 font-black text-4xl italic tracking-tighter uppercase">NETFLIX</div>
                  <div className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.4em] animate-pulse">Coming Soon</div>
                  <div className="flex gap-2 justify-center">
                    <button onClick={() => window.open(urlInput, '_blank')} className="px-6 py-3 bg-white text-black text-[10px] font-black uppercase rounded">Launch</button>
                    <button onClick={() => startCountdown()} className="px-6 py-3 bg-red-600 text-white text-[10px] font-black uppercase rounded">Sync</button>
                  </div>
                </div>
              </div>
            ) : <div className="w-full h-full flex items-center justify-center text-zinc-800 text-xs italic">Select a Mode Below</div>}
          </div>
        </div>

        <div className="flex-1 overflow-hidden relative">
          {activeTab === "watch" && (
            <div className="h-full flex flex-col p-6 lg:p-12 max-w-4xl lg:mx-auto w-full animate-fade-in space-y-10">

              {/* MODE SELECTOR GALLERY */}
              <div className="space-y-4">
                <p className="text-[10px] font-black text-zinc-700 uppercase tracking-widest ml-1">Streaming Modes</p>
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => handleUrlChange("https://www.youtube.com/watch?v=dQw4w9WgXcQ")} className={`p-6 border rounded-2xl flex flex-col items-center gap-3 transition-all ${source === 'youtube' ? 'border-red-600 bg-red-600/5' : 'border-zinc-800 hover:border-zinc-600'}`}>
                    <div className={`${source === 'youtube' ? 'text-red-600' : 'text-zinc-600'}`}><Icons.YouTube /></div>
                    <span className="text-[10px] font-black uppercase tracking-widest">YouTube</span>
                  </button>
                  <button onClick={() => handleUrlChange("https://www.netflix.com/browse")} className={`p-6 border rounded-2xl flex flex-col items-center gap-3 transition-all ${source === 'netflix' ? 'border-red-600 bg-red-600/5' : 'border-zinc-800 hover:border-zinc-600'}`}>
                    <div className={`${source === 'netflix' ? 'text-red-600' : 'text-zinc-600'}`}><Icons.Netflix /></div>
                    <span className="text-[10px] font-black uppercase tracking-widest">Netflix</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-black text-zinc-700 uppercase tracking-widest ml-1">Custom URL</p>
                <div className="relative group">
                  <input value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleUrlChange()} placeholder={`Paste ${source.toUpperCase()} Link...`} className="w-full bg-zinc-900/30 border border-zinc-800 rounded-xl px-6 py-4 text-sm outline-none focus:border-red-600/50 transition-all" />
                  <button onClick={() => handleUrlChange()} className="absolute right-2 top-2 bottom-2 px-6 bg-red-600 text-white text-[10px] font-black uppercase rounded-lg">Update</button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "chat" && (
            <div className="h-full flex flex-col p-6 lg:max-w-2xl lg:mx-auto w-full animate-fade-in">
              <div className="flex-1 overflow-y-auto space-y-4 mb-4 scrollbar-hide">
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'} animate-slide-up`}>
                    <div className={`max-w-[80%] px-4 py-2 text-[14px] ${m.from === 'me' ? 'text-red-500 border-r-2 border-red-600 pr-4 text-right' : 'text-zinc-400 border-l-2 border-zinc-800 pl-4 text-left'}`}>{m.text}</div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-2 bg-zinc-900/30 p-2 rounded-xl border border-zinc-800/50">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder="Type..." className="flex-1 bg-transparent px-3 text-sm outline-none" />
                <button onClick={sendChat} className="w-10 h-10 flex items-center justify-center text-red-600 hover:scale-110 transition-transform"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg></button>
              </div>
            </div>
          )}

          {activeTab === "party" && (
            <div className="h-full flex flex-col p-8 lg:p-12 max-w-2xl lg:mx-auto w-full animate-fade-in space-y-12">
              <div className="space-y-6 text-center">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-zinc-700 uppercase tracking-widest">Sky-ID</p>
                  <h3 className="text-5xl font-black tracking-tighter text-white uppercase">{myPeerId || "..."}</h3>
                </div>
                <button onClick={() => { navigator.clipboard.writeText(myPeerId); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="text-red-600 font-black uppercase text-[10px] tracking-widest">{copied ? "Copied" : "Copy Connection ID"}</button>
              </div>
              <div className="space-y-4">
                <p className="text-[10px] font-black text-zinc-700 uppercase tracking-widest text-center">Join Partner</p>
                <div className="relative">
                  <input value={partnerId} onChange={e => setPartnerId(e.target.value.toUpperCase())} placeholder="Partner ID" className="w-full bg-zinc-900/30 border border-zinc-800 rounded-xl px-6 py-5 text-center font-mono text-xl outline-none focus:border-red-600/30" />
                  <button onClick={() => connectToPeer(partnerId)} className="w-full mt-4 py-4 bg-red-600 text-white font-black uppercase text-xs tracking-widest rounded-xl hover:bg-red-700">Connect</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <nav className="h-16 bg-black border-t border-zinc-900 flex items-center justify-around fixed bottom-0 left-0 right-0 z-50">
        <button onClick={() => setActiveTab("watch")} className="p-4 transition-transform active:scale-90"><Icons.Watch active={activeTab === "watch"} /></button>
        <button onClick={() => setActiveTab("chat")} className="p-4 transition-transform active:scale-90"><Icons.Chat active={activeTab === "chat"} /></button>
        <button onClick={() => setActiveTab("party")} className="p-4 transition-transform active:scale-90"><Icons.Party active={activeTab === "party"} /></button>
      </nav>

    </div>
  );
}
