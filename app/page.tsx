"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const WatchParty = dynamic(() => import("./WatchParty"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center min-h-screen">
      <div className="text-center animate-fade-in-up">
        <div className="relative w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center glow-accent">
          <svg
            className="w-8 h-8 text-white animate-pulse"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <p className="text-muted-light text-sm">Loading SyncParty…</p>
      </div>
    </div>
  ),
});

export default function Page() {
  return (
    <Suspense>
      <WatchParty />
    </Suspense>
  );
}
