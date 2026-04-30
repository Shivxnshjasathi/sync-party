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

interface SyncPacket {
  action: "PLAY" | "PAUSE" | "SEEK" | "URL_CHANGE";
  time: number;
  url?: string;
}

// ─── Icon Components ─────────────────────────────────────────────────
function CopyIcon({ copied }: { copied: boolean }) {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {copied ? (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      )}
    </svg>
  );
}

function WatchIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-7 h-7 transition-all duration-300 ${active ? 'text-red-600 scale-110' : 'text-zinc-600'}`} fill="currentColor" viewBox="0 0 24 24">
      <path d="M10 16.5l6-4.5-6-4.5v9zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
    </svg>
  );
}

function ChatIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-7 h-7 transition-all duration-300 ${active ? 'text-red-600 scale-110' : 'text-zinc-600'}`} fill="currentColor" viewBox="0 0 24 24">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
    </svg>
  );
}

function PartyIcon({ active }: { active: boolean }) {
  return (
    <svg className={`w-7 h-7 transition-all duration-300 ${active ? 'text-red-600 scale-110' : 'text-zinc-600'}`} fill="currentColor" viewBox="0 0 24 24">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
    </svg>
  );
}

// ─── Utility ─────────────────────────────────────────────────────────
function generateShortId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return `NET-${id}`;
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
  const [chatMessages, setChatMessages] = useState<{ from: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [showChat, setShowChat] = useState(true);

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
    if (connRef.current?.open) connRef.current.send(packet);
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
      // Send current state to the new peer immediately
      if (playerRef.current) {
        try {
          const time = await playerRef.current.getCurrentTime();
          const state = await playerRef.current.getPlayerState();
          conn.send({ action: "URL_CHANGE", url: urlInput });
          setTimeout(() => {
            conn.send({ action: state === 1 ? "PLAY" : "PAUSE", time });
          }, 1000); // Give player time to load on the other side
        } catch (e) {}
      }
    });
    conn.on("data", (data: any) => {
      if (data.action === "CHAT") { setChatMessages(p => [...p, { from: "partner", text: data.text }]); return; }
      if (data.action === "URL_CHANGE") { 
        const id = extractVideoId(data.url); 
        if (id) initPlayer(id); 
        setUrlInput(data.url); 
        return; 
      }
      isSyncingRef.current = true;
      if (data.action === "PLAY") { playerRef.current?.seekTo(data.time, true); playerRef.current?.playVideo(); }
      else if (data.action === "PAUSE") { playerRef.current?.seekTo(data.time, true); playerRef.current?.pauseVideo(); }
      else if (data.action === "SEEK") { playerRef.current?.seekTo(data.time, true); }
      setTimeout(() => isSyncingRef.current = false, 500);
    });
    conn.on("close", () => { setStatus("disconnected"); connRef.current = null; });
  }, [initPlayer, urlInput]);

  const connectToPeer = useCallback((id: string) => {
    if (!peerRef.current) return;
    setStatus("connecting");
    handleConnection(peerRef.current.connect(id, { reliable: true }));
  }, [handleConnection]);

  const initPeer = useCallback(() => {
    if (peerRef.current) peerRef.current.destroy();
    const peer = new Peer(generateShortId(), {
      debug: 1, secure: true,
      config: { 
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" }
        ] 
      }
    });
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
    initPlayer(extractVideoId(urlInput) || "dQw4w9WgXcQ");
    return () => { peerRef.current?.destroy(); if (syncIntervalRef.current) clearInterval(syncIntervalRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, activeTab]);

  const handleUrlChange = () => {
    const id = extractVideoId(urlInput);
    if (!id) return;
    initPlayer(id);
    sendPacket({ action: "URL_CHANGE", time: 0, url: urlInput });
  };

  const sendChat = () => {
    if (!chatInput.trim() || !connRef.current?.open) return;
    connRef.current.send({ action: "CHAT", text: chatInput });
    setChatMessages(p => [...p, { from: "me", text: chatInput }]);
    setChatInput("");
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-black text-white font-sans overflow-hidden select-none">
      <header className="h-16 lg:h-20 px-6 lg:px-12 flex items-center justify-between fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/90 to-transparent">
        <div className="flex items-center gap-4 lg:gap-10">
          <h1 className="text-2xl lg:text-3xl font-black text-red-600 tracking-tighter uppercase italic cursor-pointer hover:scale-105 transition-transform">synclcod</h1>
          {!isMobile && (
            <nav className="flex gap-6 text-sm font-bold text-zinc-400">
              <span className="hover:text-white transition-colors cursor-pointer">Live Party</span>
              <span className="hover:text-white transition-colors cursor-pointer">History</span>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden lg:flex items-center gap-3 bg-zinc-900/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/5">
            <div className={`w-2 h-2 rounded-full ${status==='connected' ? 'bg-green-500 animate-pulse' : 'bg-zinc-700'}`} />
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{status}</span>
          </div>
          {!isMobile && (
            <button onClick={()=>setShowChat(!showChat)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ChatIcon active={showChat} />
            </button>
          )}
        </div>
      </header>

      <main className={`flex-1 flex flex-col lg:flex-row overflow-hidden relative ${!isMobile ? 'pt-20' : ''}`}>
        <div className="flex-1 flex flex-col items-center justify-center p-4 lg:p-8 overflow-hidden transition-all duration-500">
          <div className={`w-full max-w-5xl transition-all duration-500 ease-in-out ${showChat && !isMobile ? 'lg:max-w-4xl' : 'lg:max-w-6xl'}`}>
            <div className="aspect-video bg-black rounded-xl lg:rounded-3xl overflow-hidden shadow-[0_30px_100px_rgba(0,0,0,0.8)] border border-white/5 relative group">
              <div ref={playerContainerRef} className="w-full h-full" />
              {!isMobile && (
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none flex items-end p-8">
                  <div className="w-full flex gap-4 pointer-events-auto animate-fade-in">
                    <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleUrlChange()} placeholder="YouTube Link..." className="flex-1 bg-black/40 backdrop-blur-xl border border-white/10 px-6 py-4 rounded-2xl outline-none focus:border-red-600/50 transition-all text-sm" />
                    <button onClick={handleUrlChange} className="px-10 bg-red-600 hover:bg-red-700 rounded-2xl font-black uppercase text-xs shadow-lg shadow-red-600/20 active:scale-95 transition-all">Load</button>
                  </div>
                </div>
              )}
            </div>
            {!isMobile && (
              <div className="mt-8 flex justify-between items-center px-4 animate-fade-in">
                <div className="space-y-1">
                  <h2 className="text-3xl font-black uppercase tracking-tighter">THE CINEMA</h2>
                  <div className="flex items-center gap-4 text-xs font-bold text-zinc-500">
                    <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-red-600" /> SYNCED</span>
                    <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-zinc-700" /> P2P</span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="bg-zinc-900/40 backdrop-blur-md border border-white/5 px-6 py-3 rounded-2xl flex items-center gap-4">
                    <div className="flex flex-col text-left">
                      <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">My ID</span>
                      <span className="font-mono text-sm font-bold text-zinc-300">{myPeerId || "..."}</span>
                    </div>
                    <button onClick={()=>{navigator.clipboard.writeText(myPeerId); setCopied(true); setTimeout(()=>setCopied(false), 2000);}} className="text-red-600 hover:scale-110 transition-transform"><CopyIcon copied={copied}/></button>
                  </div>
                  <div className="flex bg-zinc-900/40 backdrop-blur-md border border-white/5 p-1 rounded-2xl">
                    <input value={partnerId} onChange={e=>setPartnerId(e.target.value.toUpperCase())} placeholder="Partner ID" className="w-32 bg-transparent px-4 py-2 text-xs font-mono outline-none" />
                    <button onClick={()=>connectToPeer(partnerId)} className="px-6 bg-red-600 rounded-xl font-black uppercase text-[10px] tracking-widest">Connect</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {!isMobile && showChat && (
          <aside className="w-[450px] bg-[#0A0A0A] border-l border-white/5 flex flex-col animate-slide-left shadow-2xl relative z-10">
            <div className="p-8 flex justify-between items-center border-b border-white/5">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Audience Chat</span>
              <button onClick={()=>setShowChat(false)} className="text-zinc-600 hover:text-white transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide">
              {chatMessages.length === 0 && <div className="h-full flex items-center justify-center text-zinc-800 text-xs italic uppercase tracking-widest">Quiet in the theater...</div>}
              {chatMessages.map((m, i) => (
                <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-5 py-3.5 rounded-2xl text-[13px] shadow-2xl leading-relaxed ${m.from==='me' ? 'bg-red-600 text-white rounded-tr-none' : 'bg-zinc-900 text-zinc-400 rounded-tl-none border border-white/5'}`}>{m.text}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-8 bg-black/50 backdrop-blur-xl">
              <div className="flex gap-3 bg-[#121212] p-2 rounded-2xl border border-white/5 shadow-2xl">
                <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat()} placeholder="Send a reaction..." className="flex-1 bg-transparent px-4 text-sm outline-none" />
                <button onClick={sendChat} className="w-12 h-12 flex items-center justify-center bg-red-600 rounded-xl text-white shadow-lg shadow-red-600/20"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
              </div>
            </div>
          </aside>
        )}

        {isMobile && (
          <div className="flex-1 overflow-y-auto scrollbar-hide pb-28">
            {activeTab === "watch" && (
              <div className="p-6 space-y-8 animate-fade-in">
                <div className="space-y-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 ml-1">Streaming Source</p>
                  <div className="relative">
                    <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} placeholder="YouTube URL" className="w-full bg-[#121212] border border-white/5 rounded-3xl px-6 py-5 text-sm outline-none focus:ring-4 ring-red-600/10 transition-all shadow-2xl" />
                    <button onClick={handleUrlChange} className="absolute right-2 top-2 bottom-2 px-8 bg-red-600 rounded-2xl font-black text-[10px] uppercase shadow-xl shadow-red-600/30">Load</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-8 bg-gradient-to-br from-[#1A1A1A] to-[#121212] rounded-[2rem] border border-white/5 flex flex-col items-center gap-4 shadow-2xl active:scale-95 transition-transform" onClick={()=>{navigator.clipboard.writeText(`${window.location.origin}/?join=${myPeerId}`); setCopied(true); setTimeout(()=>setCopied(false), 2000);}}>
                    <div className="w-14 h-14 bg-red-600/10 rounded-full flex items-center justify-center text-red-600 shadow-inner"><PartyIcon active={true}/></div>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{copied ? "COPIED" : "INVITE"}</span>
                  </div>
                  <div className="p-8 bg-gradient-to-br from-[#1A1A1A] to-[#121212] rounded-[2rem] border border-white/5 flex flex-col items-center gap-4 shadow-2xl active:scale-95 transition-transform" onClick={()=>window.open('https://youtube.com', '_blank')}>
                    <div className="w-14 h-14 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-500 shadow-inner"><WatchIcon active={true}/></div>
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">BROWSE</span>
                  </div>
                </div>
              </div>
            )}
            {activeTab === "chat" && (
              <div className="h-full flex flex-col p-6 animate-fade-in">
                 <div className="flex-1 space-y-5 mb-4">
                    {chatMessages.map((m, i) => (
                      <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] px-6 py-4 rounded-[2rem] text-[15px] shadow-2xl ${m.from==='me' ? 'bg-red-600 text-white shadow-red-600/20' : 'bg-[#1A1A1A] text-zinc-300 border border-white/5'}`}>{m.text}</div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                 </div>
                 <div className="flex gap-2 sticky bottom-4 bg-zinc-900/90 backdrop-blur-3xl p-2 rounded-[2.5rem] border border-white/10 shadow-2xl">
                    <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat()} placeholder="Chat..." className="flex-1 bg-transparent px-6 text-base outline-none" />
                    <button onClick={sendChat} className="w-14 h-14 flex items-center justify-center bg-red-600 text-white rounded-full shadow-2xl shadow-red-600/40 active:scale-90 transition-transform">
                      <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </button>
                 </div>
              </div>
            )}
            {activeTab === "party" && (
              <div className="p-6 space-y-6 animate-fade-in">
                <div className="bg-gradient-to-br from-[#1A1A1A] to-[#0A0A0A] rounded-[3rem] p-12 border border-white/5 shadow-2xl flex flex-col items-center text-center gap-8">
                  <div className="w-28 h-28 bg-red-600/10 rounded-full flex items-center justify-center text-red-600 shadow-[0_0_80px_rgba(229,9,20,0.15)] ring-1 ring-red-600/20">
                    <PartyIcon active={true}/>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-black text-zinc-600 uppercase tracking-widest">My Streaming ID</p>
                    <h3 className="text-5xl font-black tracking-tighter text-white">{myPeerId || "..."}</h3>
                  </div>
                  <button onClick={()=>{navigator.clipboard.writeText(myPeerId); setCopied(true); setTimeout(()=>setCopied(false), 2000);}} className="w-full py-5 bg-white text-black font-black text-sm uppercase rounded-[1.5rem] shadow-2xl active:scale-95 transition-all">Copy Connection ID</button>
                </div>
                <div className="bg-[#121212] rounded-[3rem] p-10 border border-white/5 space-y-8 shadow-2xl">
                   <div className="space-y-4">
                     <p className="text-[11px] font-black text-zinc-600 uppercase tracking-widest text-center">Join Partner</p>
                     <input value={partnerId} onChange={e=>setPartnerId(e.target.value.toUpperCase())} placeholder="NET-XXXXXX" className="w-full bg-black border border-white/5 rounded-2xl px-6 py-6 text-center font-mono text-2xl tracking-[0.3em] outline-none focus:border-red-600/40 transition-all text-red-600" />
                   </div>
                   <button onClick={()=>connectToPeer(partnerId)} className="w-full py-6 bg-red-600 text-white rounded-2xl font-black uppercase text-sm tracking-[0.3em] shadow-2xl shadow-red-600/30 active:scale-95 transition-all">Connect</button>
                </div>
              </div>
            )}
          </div>
        )}

        {isMobile && (
          <nav className="h-[95px] bg-black/80 backdrop-blur-3xl border-t border-white/5 flex items-center justify-around fixed bottom-0 left-0 right-0 z-50 px-10 pb-6 shadow-[0_-20px_50px_rgba(0,0,0,0.9)]">
            <button onClick={()=>setActiveTab("watch")} className="flex flex-col items-center gap-1.5 group">
              <WatchIcon active={activeTab === "watch"} />
              <span className={`text-[10px] font-black uppercase tracking-tighter transition-colors ${activeTab === 'watch' ? 'text-white' : 'text-zinc-600'}`}>Watch</span>
            </button>
            <button onClick={()=>setActiveTab("chat")} className="flex flex-col items-center gap-1.5 group">
              <ChatIcon active={activeTab === "chat"} />
              <span className={`text-[10px] font-black uppercase tracking-tighter transition-colors ${activeTab === 'chat' ? 'text-white' : 'text-zinc-600'}`}>Chat</span>
            </button>
            <button onClick={()=>setActiveTab("party")} className="flex flex-col items-center gap-1.5 group">
              <PartyIcon active={activeTab === "party"} />
              <span className={`text-[10px] font-black uppercase tracking-tighter transition-colors ${activeTab === 'party' ? 'text-white' : 'text-zinc-600'}`}>Party</span>
            </button>
          </nav>
        )}
      </main>
    </div>
  );
}
