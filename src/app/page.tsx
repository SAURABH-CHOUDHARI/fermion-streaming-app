'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function Home() {
  useEffect(() => {
    document.title = 'Fermion Live';
  }, []);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-6 bg-gray-950 text-white">
      <h1 className="text-4xl font-bold mb-6">Fermion Live Streaming Demo</h1>

      <div className="flex gap-6">
        <Link href="/stream">
          <button className="px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 transition-all shadow-lg text-lg font-semibold">
            Start Streaming
          </button>
        </Link>

        <Link href="/watch">
          <button className="px-6 py-3 rounded-2xl bg-green-600 hover:bg-green-700 transition-all shadow-lg text-lg font-semibold">
            Watch Stream
          </button>
        </Link>
      </div>
    </main>
  );
}
