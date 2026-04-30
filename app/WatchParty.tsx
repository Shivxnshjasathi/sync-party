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

interface SyncPacket {
  action: "PLAY" | "PAUSE" | "SEEK" | "URL_CHANGE";
  time: number;
  url?: string;
}

// ─── Utility: Generate short IDs ─────────────────────────────────────
function generateShortId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SP-${id}`;
}

// ─── Utility: Extract YouTube Video ID from URL ──────────────────────
function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.pathname.startsWith("/watch")) {
        return parsed.searchParams.get("v");
      }
      if (parsed.pathname.startsWith("/embed/") || parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.split("/")[2];
      }
    }
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.slice(1);
    }
  } catch (e) {
    // Fallback to regex if URL parsing fails
    const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }
  return null;
}

// ─── Icon Components ─────────────────────────────────────────────────
function CopyIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  );
}

// ─── Main Component ──────────────────────────────────────────────────
export default function WatchParty() {
  // State
  const [myPeerId, setMyPeerId] = useState<string>("");
  const [partnerId, setPartnerId] = useState<string>("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [videoUrl, setVideoUrl] = useState<string>(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  );
  const [urlInput, setUrlInput] = useState<string>(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  );
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<{ from: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showSearch, setShowSearch] = useState<boolean>(false);

  // Refs
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const playerRef = useRef<YTPlayerType | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const isSyncingRef = useRef<boolean>(false);
  const chatEndRef = useRef<HTMLDivElement | null>(0 as unknown as HTMLDivElement); // placeholder for ref
  const lastTimeRef = useRef<number>(0);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ─── Send Sync Packet ──────────────────────────────────────────
  const sendPacket = useCallback((packet: SyncPacket) => {
    if (connRef.current && connRef.current.open) {
      connRef.current.send(packet);
    }
  }, []);

  // ─── Player Instance Manager ──────────────────────────────────
  const initPlayer = useCallback((videoId: string) => {
    if (!playerContainerRef.current) return;

    // Clean up old player if exists
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch (e) {}
    }

    // Create new player
    const player = YouTubePlayer(playerContainerRef.current, {
      videoId,
      width: "100%" as unknown as number,
      height: "100%" as unknown as number,
      playerVars: {
        autoplay: 1,
        modestbranding: 1,
        rel: 0,
        controls: 1,
        enablejsapi: 1,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
      },
    });

    playerRef.current = player;

    // Listen for state changes
    player.on("stateChange", (event: { data: number }) => {
      if (isSyncingRef.current) return;
      const state = event.data;
      if (state === 1 || state === 2) {
        player.getCurrentTime().then((time: number) => {
          sendPacket({ action: state === 1 ? "PLAY" : "PAUSE", time });
        });
      }
    });

    // Handle initial sizing
    const iframe = playerContainerRef.current.querySelector("iframe");
    if (iframe) {
      iframe.style.width = "100%";
      iframe.style.height = "100%";
    }

    // Seek detection loop
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    syncIntervalRef.current = setInterval(async () => {
      if (isSyncingRef.current || !playerRef.current) return;
      try {
        const currentTime = await player.getCurrentTime();
        const diff = Math.abs(currentTime - lastTimeRef.current);
        
        // If jump is more than 2 seconds, it's likely a manual seek
        if (diff > 2) {
          sendPacket({ action: "SEEK", time: currentTime });
        }
        lastTimeRef.current = currentTime;
      } catch (e) {}
    }, 500);
  }, [sendPacket]);

  // Initial load
  useEffect(() => {
    const initialId = extractVideoId(videoUrl) || "dQw4w9WgXcQ";
    initPlayer(initialId);
    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      playerRef.current?.destroy();
    };
  }, [initPlayer, videoUrl]); // Re-run if these change, but initPlayer is stable

  // Video loading handled in handleUrlChange and connection handler


  // ─── Initialize PeerJS ──────────────────────────────────────────
  useEffect(() => {
    const id = generateShortId();
    const peer = new Peer(id, {
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ],
      },
    });
    peerRef.current = peer;

    peer.on("open", (peerId) => {
      setMyPeerId(peerId);

      // Auto-connect if ?join= param exists
      const params = new URLSearchParams(window.location.search);
      const joinId = params.get("join");
      if (joinId) {
        setPartnerId(joinId);
        connectToPeer(joinId);
      }
    });

    peer.on("connection", (conn) => {
      handleConnection(conn);
    });

    peer.on("error", (err) => {
      console.error("Peer error:", err);
      const messages: Record<string, string> = {
        "peer-unavailable": "Partner not found — check the ID and try again",
        "webrtc": "WebRTC connection failed — partner may be offline",
        "network": "Network error — check your internet connection",
        "server-error": "Signaling server error — try again in a moment",
        "disconnected": "Disconnected from signaling server",
      };
      setErrorMsg(messages[err.type] || `Connection error: ${err.type}`);
      setStatus("disconnected");
      setTimeout(() => setErrorMsg(""), 5000);
    });

    return () => {
      peer.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Connection Handling ────────────────────────────────────────
  const handleConnection = useCallback((conn: DataConnection) => {
    connRef.current = conn;
    setStatus("connecting");

    conn.on("open", () => {
      setStatus("connected");
      setErrorMsg("");
    });

    conn.on("data", (data: unknown) => {
      const packet = data as { action: string; time?: number; url?: string; text?: string };

      if (packet.action === "CHAT") {
        setChatMessages((prev) => [
          ...prev,
          { from: "partner", text: packet.text || "" },
        ]);
        return;
      }

      if (packet.action === "URL_CHANGE" && packet.url) {
        const videoId = extractVideoId(packet.url);
        if (videoId) {
          initPlayer(videoId);
        }
        setVideoUrl(packet.url);
        setUrlInput(packet.url);
        return;
      }

      // Sync player — anti-loop protection
      isSyncingRef.current = true;
      const player = playerRef.current;
      if (!player) return;

      const time = packet.time ?? 0;

      if (packet.action === "PLAY") {
        player.seekTo(time, true);
        player.playVideo();
      } else if (packet.action === "PAUSE") {
        player.seekTo(time, true);
        player.pauseVideo();
      } else if (packet.action === "SEEK") {
        player.seekTo(time, true);
      }

      // Reset sync flag after delay to avoid event loop
      setTimeout(() => {
        isSyncingRef.current = false;
      }, 500);
    });

    conn.on("close", () => {
      setStatus("disconnected");
      connRef.current = null;
    });

    conn.on("error", (err) => {
      console.error("Connection error:", err);
      setStatus("disconnected");
      setErrorMsg("Connection lost");
      setTimeout(() => setErrorMsg(""), 5000);
    });
  }, []);

  const connectToPeer = useCallback(
    (targetId: string) => {
      if (!peerRef.current) return;
      setStatus("connecting");
      const conn = peerRef.current.connect(targetId, { reliable: true });
      handleConnection(conn);
    },
    [handleConnection]
  );



  // ─── Search YouTube ───────────────────────────────────────────
  const searchYouTube = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setIsSearching(true);
    try {
      // Note: This is a fallback since we don't have a YouTube API key.
      // In a real app, you'd use a backend or a proper API key.
      // For now, we'll use a search suggest API as a proof of concept
      // or just guide the user.
      const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${query}`);
      // This won't work for arbitrary search.
      // Let's just provide a nice UI for it.
      setErrorMsg("Direct search requires a YouTube API key. Please paste a link for now, or use the 'Browse' feature below.");
      setTimeout(() => setErrorMsg(""), 5000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleUrlChange = useCallback(() => {
    if (!urlInput.trim()) return;
    const videoId = extractVideoId(urlInput.trim());
    if (!videoId) {
      setErrorMsg("Invalid YouTube URL");
      setTimeout(() => setErrorMsg(""), 3000);
      return;
    }
    
    // Direct player re-init
    initPlayer(videoId);

    setVideoUrl(urlInput.trim());
    sendPacket({ action: "URL_CHANGE", time: 0, url: urlInput.trim() });
  }, [urlInput, sendPacket, initPlayer]);

  // ─── Chat ──────────────────────────────────────────────────────
  const sendChatMessage = useCallback(() => {
    if (!chatInput.trim() || !connRef.current?.open) return;
    connRef.current.send({ action: "CHAT", text: chatInput.trim() });
    setChatMessages((prev) => [
      ...prev,
      { from: "me", text: chatInput.trim() },
    ]);
    setChatInput("");
  }, [chatInput]);

  // ─── Copy Helpers ──────────────────────────────────────────────
  const copyPeerId = useCallback(() => {
    navigator.clipboard.writeText(myPeerId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [myPeerId]);

  const copyInviteLink = useCallback(() => {
    const link = `${window.location.origin}${window.location.pathname}?join=${myPeerId}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [myPeerId]);

  // ─── Status Badge ──────────────────────────────────────────────
  const statusConfig = useMemo(() => {
    switch (status) {
      case "connected":
        return { color: "bg-success", text: "Connected", textColor: "text-success" };
      case "connecting":
        return { color: "bg-warning", text: "Connecting…", textColor: "text-warning" };
      default:
        return { color: "bg-danger", text: "Disconnected", textColor: "text-danger" };
    }
  }, [status]);

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-screen">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="glass-card mx-3 mt-3 sm:mx-4 sm:mt-4 px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between animate-fade-in-up">
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center glow-accent">
            <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-accent to-accent-secondary bg-clip-text text-transparent">
              SyncParty
            </h1>
            <p className="text-[10px] sm:text-xs text-muted hidden sm:block">
              Peer-to-peer watch party
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full glass-card ${statusConfig.textColor}`}>
            <div className={`w-2 h-2 rounded-full ${statusConfig.color} ${status === "connecting" ? "status-pulse" : ""}`} />
            <span className="text-xs font-medium">{statusConfig.text}</span>
          </div>
        </div>
      </header>

      {/* ── Error Banner ────────────────────────────────────────── */}
      {errorMsg && (
        <div className="mx-3 mt-2 sm:mx-4 px-4 py-2 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm text-center animate-fade-in-up">
          {errorMsg}
        </div>
      )}

      {/* ── Main Content ────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col lg:flex-row gap-3 sm:gap-4 p-3 sm:p-4 animate-fade-in-up">
        {/* Left Column — Video + URL */}
        <div className="flex-1 flex flex-col gap-3 sm:gap-4 min-w-0">
          {/* YouTube Player */}
          <div className="glass-card p-2 sm:p-3 glow-accent-hover transition-shadow duration-500">
            <div
              className="relative w-full rounded-lg overflow-hidden bg-black"
              style={{ aspectRatio: "16/9" }}
            >
              <div
                ref={playerContainerRef}
                id="youtube-player"
                className="absolute inset-0 w-full h-full"
              />
            </div>
          </div>

          {/* URL Input */}
          <div className="glass-card p-3 sm:p-4">
            <label className="text-xs text-muted-light font-medium uppercase tracking-wider mb-2 block">
              Video URL
            </label>
            <div className="flex gap-2">
              <input
                id="video-url-input"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUrlChange()}
                placeholder="Paste a YouTube URL…"
                className="flex-1 bg-background/50 border border-card-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted transition-all duration-200 hover:border-accent/30 focus:border-accent/50 min-w-0"
              />
              <button
                id="load-video-btn"
                onClick={handleUrlChange}
                className="px-4 sm:px-5 py-2.5 bg-gradient-to-r from-accent to-accent-secondary rounded-xl text-white text-sm font-semibold transition-all duration-200 hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] shrink-0 cursor-pointer"
              >
                Load
              </button>
            </div>
            <div className="mt-4 flex gap-2">
               <button
                onClick={() => window.open('https://www.youtube.com', '_blank')}
                className="flex-1 px-4 py-2 bg-background/50 border border-card-border rounded-xl text-xs text-muted-light hover:text-foreground transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
                Browse on YouTube.com
              </button>
            </div>
          </div>
        </div>

        {/* Right Column — Connection + Chat */}
        <div className="lg:w-[380px] xl:w-[420px] flex flex-col gap-3 sm:gap-4 shrink-0">
          {/* Your ID Card */}
          <div className="glass-card p-4 sm:p-5">
            <label className="text-xs text-muted-light font-medium uppercase tracking-wider mb-3 block">
              Your Peer ID
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-background/50 border border-card-border rounded-xl px-4 py-2.5 font-mono text-sm text-accent select-all truncate">
                {myPeerId || <span className="shimmer inline-block w-24 h-4 rounded" />}
              </div>
              <button
                id="copy-peer-id-btn"
                onClick={copyPeerId}
                disabled={!myPeerId}
                className="p-2.5 rounded-xl bg-accent/10 border border-accent/20 text-accent transition-all duration-200 hover:bg-accent/20 hover:scale-105 active:scale-95 disabled:opacity-40 cursor-pointer"
                title="Copy Peer ID"
              >
                <CopyIcon copied={copied} />
              </button>
              <button
                id="copy-invite-link-btn"
                onClick={copyInviteLink}
                disabled={!myPeerId}
                className="p-2.5 rounded-xl bg-accent-secondary/10 border border-accent-secondary/20 text-accent-secondary transition-all duration-200 hover:bg-accent-secondary/20 hover:scale-105 active:scale-95 disabled:opacity-40 cursor-pointer"
                title="Copy Invite Link"
              >
                {copiedLink ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <LinkIcon />
                )}
              </button>
            </div>
            {(copied || copiedLink) && (
              <p className="text-xs text-success mt-2 animate-fade-in-up">
                {copied ? "Peer ID copied!" : "Invite link copied!"}
              </p>
            )}
          </div>

          {/* Connect Card */}
          <div className="glass-card p-4 sm:p-5">
            <label className="text-xs text-muted-light font-medium uppercase tracking-wider mb-3 block">
              Connect to Partner
            </label>
            <div className="flex gap-2">
              <input
                id="partner-id-input"
                type="text"
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value.toUpperCase())}
                onKeyDown={(e) =>
                  e.key === "Enter" && partnerId && connectToPeer(partnerId)
                }
                placeholder="Enter partner ID…"
                className="flex-1 bg-background/50 border border-card-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted font-mono transition-all duration-200 hover:border-accent/30 focus:border-accent/50 min-w-0"
              />
              <button
                id="connect-btn"
                onClick={() => connectToPeer(partnerId)}
                disabled={!partnerId || status === "connected"}
                className="px-4 sm:px-5 py-2.5 bg-gradient-to-r from-accent to-purple-500 rounded-xl text-white text-sm font-semibold transition-all duration-200 hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:scale-100 shrink-0 cursor-pointer"
              >
                {status === "connecting" ? (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    …
                  </span>
                ) : (
                  "Connect"
                )}
              </button>
            </div>
          </div>

          {/* Chat */}
          <div className="glass-card flex-1 flex flex-col p-4 sm:p-5 min-h-[200px] lg:min-h-0">
            <label className="text-xs text-muted-light font-medium uppercase tracking-wider mb-3 block">
              Chat
            </label>

            <div className="flex-1 overflow-y-auto space-y-2 mb-3 pr-1 max-h-[300px] lg:max-h-none">
              {chatMessages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs text-muted italic">
                    {status === "connected"
                      ? "Say hi to your partner! 👋"
                      : "Connect to start chatting"}
                  </p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.from === "me" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${
                      msg.from === "me"
                        ? "bg-accent/20 text-accent rounded-br-md"
                        : "bg-card border border-card-border text-foreground rounded-bl-md"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="flex gap-2">
              <input
                id="chat-input"
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChatMessage()}
                placeholder={
                  status === "connected" ? "Type a message…" : "Connect first…"
                }
                disabled={status !== "connected"}
                className="flex-1 bg-background/50 border border-card-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted transition-all duration-200 hover:border-accent/30 focus:border-accent/50 disabled:opacity-40 min-w-0"
              />
              <button
                id="send-chat-btn"
                onClick={sendChatMessage}
                disabled={status !== "connected" || !chatInput.trim()}
                className="p-2.5 rounded-xl bg-accent/10 border border-accent/20 text-accent transition-all duration-200 hover:bg-accent/20 hover:scale-105 active:scale-95 disabled:opacity-40 cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="text-center py-3 text-xs text-muted">
        <p>
          P2P powered by <span className="text-accent font-medium">PeerJS</span> — No server, just vibes ✨
        </p>
      </footer>
    </div>
  );
}
