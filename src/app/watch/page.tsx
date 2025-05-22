// app/stream/page.tsx or pages/stream.tsx — depending on your Next.js version
'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface StreamResponse {
    status: 'live' | 'offline';
    streams: string[];
}

export default function StreamPage() {
    const [streamData, setStreamData] = useState<StreamResponse | null>(null);

    useEffect(() => {
        const fetchStreams = async () => {
            const res = await fetch('http://localhost:8000/api/streams');
            const data = await res.json();
            setStreamData(data);
        };

        fetchStreams();
        const interval = setInterval(fetchStreams, 5000); // Poll every 5s

        return () => clearInterval(interval);
    }, []);

    if (!streamData) return <p>Loading...</p>;

    if (streamData.status === 'offline' || streamData.streams.length === 0) {
        return <p>No streams are live right now.</p>;
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-4">
            {streamData.streams.map((streamUrl, index) => (
                <VideoPlayer key={streamUrl} url={`http://localhost:8000/hls/${streamUrl}`} label={`Stream ${index + 1}`} />
            ))}
        </div>
    );
}

function VideoPlayer({ url, label }: { url: string; label: string }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        const video = videoRef.current;
        if (video && Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(url);
            hls.attachMedia(video);

            return () => {
                hls.destroy();
            };
        } else if (video?.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
        }
    }, [url]);

    return (
        <div className="rounded-xl shadow-lg overflow-hidden bg-black">
            <video
                ref={videoRef}
                controls
                autoPlay
                muted
                playsInline
                className="w-full aspect-video"
            />
            <div className="text-white text-sm p-2 bg-zinc-800">{label}</div>
        </div>
    );
}
