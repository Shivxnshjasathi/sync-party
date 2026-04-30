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
  Copy: () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
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
  const [showChat, setShowChat] = useState(true);
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
    if (playerRef.current) { try { playerRef.current.destroy(); } catch (e) {} }
    const player = YouTubePlayer(playerContainerRef.current, {
      videoId, width: "100%" as any, height: "100%" as any,
      playerVars: { autoplay: 1, modestbranding: 1, rel: 0, controls: 1, enablejsapi: 1, origin: typeof window !== 'undefined' ? window.location.origin : '' },
    });
    playerRef.current = player;
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
      } catch (e) {}
    }, 500);
  }, [sendPacket]);

  const handleConnection = useCallback((conn: DataConnection) => {
    connRef.current = conn;
    setStatus("connecting");
    conn.on("open", async () => {
      setStatus("connected");
      conn.send({ action: "URL_CHANGE", url: urlInput });
    });
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
    if (s === "youtube") { const id = extractVideoId(finalUrl); if (id) initPlayer(id); }
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
      
      {/* ── SHARED HEADER ────────────────────────────────────────── */}
      <header className="h-14 lg:h-20 px-6 lg:px-12 flex items-center justify-between fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black to-transparent">
        <h1 className="text-xl lg:text-3xl font-black text-red-600 tracking-tighter uppercase italic text-glow">syncloud</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 bg-zinc-900/40 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/5">
             <div className={`w-1.5 h-1.5 rounded-full ${status==='connected' ? 'bg-red-600 animate-pulse shadow-[0_0_8px_rgba(229,9,20,0.8)]' : 'bg-zinc-800'}`} />
             <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">{status}</span>
          </div>
          {!isMobile && (
            <button onClick={()=>setShowChat(!showChat)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <svg className={`w-6 h-6 ${showChat ? 'text-red-600' : 'text-zinc-500'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            </button>
          )}
        </div>
      </header>

      <main className={`flex-1 flex flex-col lg:flex-row overflow-hidden relative ${!isMobile ? 'pt-20' : 'pt-14 pb-20'}`}>
        
        {countdown !== null && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/90 animate-fade-in">
            <span className="text-9xl font-black text-red-600 animate-pulse">{countdown}</span>
          </div>
        )}

        {/* WEB CINEMA PLAYER (Restored Desktop View) */}
        {!isMobile && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 transition-all duration-700">
             <div className={`w-full transition-all duration-700 ease-in-out ${showChat ? 'max-w-4xl' : 'max-w-6xl'}`}>
                <div className="aspect-video bg-[#050505] rounded-[2.5rem] overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.9)] border border-white/5 relative group">
                  {source === "youtube" ? (
                    <div ref={playerContainerRef} className="w-full h-full" />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center space-y-6">
                       <div className="text-red-600 text-6xl font-black italic">NETFLIX</div>
                       <div className="text-zinc-500 text-xs font-black uppercase tracking-[0.5em] animate-pulse">Coming Soon</div>
                       <div className="flex gap-4">
                          <button onClick={()=>window.open(urlInput, '_blank')} className="px-10 py-4 bg-white text-black text-[10px] font-black uppercase rounded-2xl">Launch</button>
                          <button onClick={()=>startCountdown()} className="px-10 py-4 bg-red-600 text-white text-[10px] font-black uppercase rounded-2xl">Sync</button>
                       </div>
                    </div>
                  )}
                  <div className="absolute bottom-10 left-10 right-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                    <div className="flex gap-4 pointer-events-auto bg-black/40 backdrop-blur-3xl p-2 rounded-[2rem] border border-white/10">
                       <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleUrlChange()} placeholder="Paste Link..." className="flex-1 bg-transparent px-8 py-4 text-sm outline-none" />
                       <button onClick={()=>handleUrlChange()} className="px-10 bg-red-600 rounded-[1.5rem] font-black uppercase text-[10px] tracking-widest">Update</button>
                    </div>
                  </div>
                </div>
                <div className="mt-12 flex justify-between items-end px-6 animate-fade-in">
                   <div className="space-y-1">
                      <h2 className="text-4xl font-black tracking-tighter uppercase text-glow">Streaming Now</h2>
                      <p className="text-zinc-600 text-[10px] font-black uppercase tracking-widest">Shared Theater Cloud</p>
                   </div>
                   <div className="flex gap-4">
                      <div className="bg-[#080808] border border-white/5 p-6 rounded-[2rem] flex items-center gap-6 shadow-2xl">
                         <div className="flex flex-col">
                            <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Cloud ID</span>
                            <span className="text-xl font-mono font-bold text-red-600 uppercase">{myPeerId || "..."}</span>
                         </div>
                         <button onClick={()=>{navigator.clipboard.writeText(myPeerId); setCopied(true); setTimeout(()=>setCopied(false), 2000);}} className="p-3 bg-white/5 rounded-2xl hover:bg-red-600 transition-colors text-white">{copied ? "DONE" : <Icons.Copy />}</button>
                      </div>
                      <div className="bg-[#080808] border border-white/5 p-2 rounded-[2rem] flex gap-2 shadow-2xl">
                         <input value={partnerId} onChange={e=>setPartnerId(e.target.value.toUpperCase())} placeholder="Partner ID" className="w-32 bg-transparent px-6 py-2 font-mono text-sm outline-none" />
                         <button onClick={()=>connectToPeer(partnerId)} className="px-8 bg-red-600 rounded-2xl font-black uppercase text-[10px] tracking-widest">Join</button>
                      </div>
                   </div>
                </div>
             </div>
          </div>
        )}

        {/* WEB DRAWER CHAT (Restored Desktop Chat) */}
        {!isMobile && showChat && (
          <aside className="w-[450px] bg-[#050505] border-l border-white/5 flex flex-col animate-slide-left shadow-2xl">
             <div className="p-10 border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-600">Sync Chat</span>
                <div className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
             </div>
             <div className="flex-1 overflow-y-auto p-10 space-y-6 scrollbar-hide">
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] px-6 py-4 rounded-[1.8rem] text-[13px] shadow-2xl ${m.from==='me' ? 'bg-red-600 text-white rounded-tr-none' : 'bg-[#111] text-zinc-400 border border-white/5 rounded-tl-none'}`}>{m.text}</div>
                  </div>
                ))}
                <div ref={chatEndRef} />
             </div>
             <div className="p-10 bg-black">
                <div className="flex gap-3 bg-[#111] p-2 rounded-2xl border border-white/5 shadow-2xl">
                   <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat()} placeholder="Type..." className="flex-1 bg-transparent px-5 text-sm outline-none" />
                   <button onClick={sendChat} className="w-12 h-12 bg-red-600 rounded-xl text-white flex items-center justify-center"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
                </div>
             </div>
          </aside>
        )}

        {/* NATIVE MINIMAL MOBILE UI (Preserved Mobile Style) */}
        {isMobile && (
          <div className="flex-1 flex flex-col overflow-hidden bg-black animate-fade-in">
            <div className={`w-full bg-black shrink-0 relative transition-all duration-500 ${activeTab !== 'watch' ? 'h-0 opacity-0' : 'h-auto'}`}>
              <div className="w-full aspect-video overflow-hidden shadow-2xl border-b border-zinc-900">
                {source === "youtube" ? (
                  <div ref={playerContainerRef} className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center space-y-4">
                     <div className="text-red-600 font-black text-2xl italic">NETFLIX</div>
                     <div className="text-[10px] font-black uppercase text-zinc-600 tracking-[0.4em] animate-pulse">Coming Soon</div>
                     <div className="flex gap-2">
                        <button onClick={()=>window.open(urlInput, '_blank')} className="px-6 py-3 bg-white text-black text-[10px] font-black uppercase rounded">Launch</button>
                        <button onClick={()=>startCountdown()} className="px-6 py-3 bg-red-600 text-white text-[10px] font-black uppercase rounded">Sync</button>
                     </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-hidden relative">
              {activeTab === "watch" && (
                <div className="h-full flex flex-col p-6 space-y-10 animate-fade-in">
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-zinc-700 uppercase tracking-widest ml-1">Modes</p>
                    <div className="grid grid-cols-2 gap-4">
                       <button onClick={()=>handleUrlChange("https://www.youtube.com/watch?v=dQw4w9WgXcQ")} className={`p-6 border rounded-2xl flex flex-col items-center gap-3 ${source==='youtube' ? 'border-red-600' : 'border-zinc-800'}`}>
                          <div className={source==='youtube' ? 'text-red-600' : 'text-zinc-600'}><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg></div>
                          <span className="text-[10px] font-black uppercase tracking-widest">YT</span>
                       </button>
                       <button onClick={()=>handleUrlChange("https://www.netflix.com/browse")} className={`p-6 border rounded-2xl flex flex-col items-center gap-3 ${source==='netflix' ? 'border-red-600' : 'border-zinc-800'}`}>
                          <div className={source==='netflix' ? 'text-red-600' : 'text-zinc-600'}><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6.51 20L6.5 4l3.12 1.4L10.36 20h2.95l-1.3-15 3.03-1.38L18 20h-3.15l-1.3-15-3.04 1.4z"/></svg></div>
                          <span className="text-[10px] font-black uppercase tracking-widest">NETFLIX</span>
                       </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-zinc-700 uppercase tracking-widest ml-1">Custom Link</p>
                    <div className="relative">
                      <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleUrlChange()} placeholder="URL..." className="w-full bg-zinc-900/30 border border-zinc-800 rounded-xl px-6 py-4 text-sm outline-none focus:border-red-600/50" />
                      <button onClick={()=>handleUrlChange()} className="absolute right-2 top-2 bottom-2 px-6 bg-red-600 text-white text-[10px] font-black uppercase rounded-lg">Go</button>
                    </div>
                  </div>
                </div>
              )}
              {activeTab === "chat" && (
                <div className="h-full flex flex-col p-6 animate-fade-in">
                  <div className="flex-1 overflow-y-auto space-y-4 mb-4 scrollbar-hide">
                    {chatMessages.map((m, i) => (
                      <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'} animate-slide-up`}>
                        <div className={`max-w-[80%] px-4 py-2 text-[14px] ${m.from==='me' ? 'text-red-500 border-r-2 border-red-600 pr-4 text-right' : 'text-zinc-400 border-l-2 border-zinc-800 pl-4 text-left'}`}>{m.text}</div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="flex gap-2 bg-zinc-900/30 p-2 rounded-xl border border-zinc-800/50">
                    <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat()} placeholder="Chat..." className="flex-1 bg-transparent px-3 text-sm outline-none" />
                    <button onClick={sendChat} className="w-10 h-10 flex items-center justify-center text-red-600"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
                  </div>
                </div>
              )}
              {activeTab === "party" && (
                <div className="h-full flex flex-col p-8 space-y-12 animate-fade-in">
                  <div className="space-y-6 text-center">
                    <p className="text-[10px] font-black text-zinc-700 uppercase tracking-widest">Your Sky-ID</p>
                    <h3 className="text-5xl font-black tracking-tighter text-white uppercase">{myPeerId || "..."}</h3>
                    <button onClick={()=>{navigator.clipboard.writeText(myPeerId); setCopied(true); setTimeout(()=>setCopied(false), 2000);}} className="text-red-600 font-black uppercase text-[10px] tracking-widest">{copied ? "Copied" : "Copy ID"}</button>
                  </div>
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-zinc-700 uppercase tracking-widest text-center">Connect</p>
                    <input value={partnerId} onChange={e=>setPartnerId(e.target.value.toUpperCase())} placeholder="Partner ID" className="w-full bg-zinc-900/30 border border-zinc-800 rounded-xl px-6 py-5 text-center font-mono text-xl outline-none" />
                    <button onClick={()=>connectToPeer(partnerId)} className="w-full mt-4 py-4 bg-red-600 text-white font-black uppercase text-xs tracking-widest rounded-xl">Connect</button>
                  </div>
                </div>
              )}
            </div>

            <nav className="h-16 bg-black border-t border-zinc-900 flex items-center justify-around fixed bottom-0 left-0 right-0 z-50">
              <button onClick={()=>setActiveTab("watch")} className="p-4"><Icons.Watch active={activeTab === "watch"} /></button>
              <button onClick={()=>setActiveTab("chat")} className="p-4"><Icons.Chat active={activeTab === "chat"} /></button>
              <button onClick={()=>setActiveTab("party")} className="p-4"><Icons.Party active={activeTab === "party"} /></button>
            </nav>
          </div>
        )}
      </main>
    </div>
  );
}
