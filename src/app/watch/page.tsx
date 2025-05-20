'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as mediasoupClient from 'mediasoup-client';

export default function WatchPage() {
    // State for managing WebRTC connection status
    const [connected, setConnected] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeStream, setActiveStream] = useState<string | null>(null);
    const [availableStreams, setAvailableStreams] = useState<string[]>([]);

    // Refs for WebSocket, MediaSoup device, and video element
    const ws = useRef<WebSocket | null>(null);
    const deviceRef = useRef<mediasoupClient.Device | null>(null);
    const consumerRef = useRef<mediasoupClient.types.Consumer | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const rtpCapabilitiesRef = useRef<any>(null);
    const transportRef = useRef<mediasoupClient.types.Transport | null>(null);

    // Connect to WebSocket server and initialize MediaSoup
    useEffect(() => {
        const connectToServer = async () => {
            try {
                setLoading(true);
                setError(null);

                // Initialize WebSocket connection
                ws.current = new WebSocket('ws://localhost:3001');

                ws.current.onopen = () => {
                    console.log('WebSocket connection established');
                    setLoading(false);

                    // Join as a watcher
                    ws.current?.send(JSON.stringify({
                        action: 'join',
                        role: 'watcher'
                    }));
                };

                ws.current.onmessage = async (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        console.log('Received message:', data);

                        if (data.type === 'joined') {
                            // Save available streams
                            if (data.streams && data.streams.length > 0) {
                                setAvailableStreams(data.streams);
                            }

                            // Initialize MediaSoup device with router capabilities
                            await handleJoined(data);

                            // Create transport after successful join
                            createTransport();
                        }
                        else if (data.type === 'transport-created') {
                            // Connect the transport
                            await connectTransport(data);
                        }
                        else if (data.type === 'transport-connected') {
                            console.log('Transport connected successfully');

                            // If there are streams available, consume the first one
                            if (availableStreams.length > 0) {
                                consumeStream(availableStreams[0]);
                            }
                        }
                        else if (data.type === 'consumed') {
                            // Handle the consumer
                            console.log('Received consume request:', data);
                            await handleConsume(data);
                        }
                        else if (data.type === 'consumer-resumed') {
                            console.log('Consumer resumed successfully');
                            setLoading(false);
                            setConnected(true);
                        }
                        else if (data.type === 'error') {
                            console.error('Server error:', data.message);
                            setError(data.message || 'Server error occurred');
                            setLoading(false);
                        }
                    } catch (err) {
                        console.error('Failed to process message:', err);
                        setError('Failed to process server message');
                        setLoading(false);
                    }
                };

                ws.current.onerror = (event) => {
                    console.error('WebSocket error:', event);
                    setError('WebSocket connection error');
                    setLoading(false);
                };

                ws.current.onclose = () => {
                    console.log('WebSocket connection closed');
                    setConnected(false);
                    setLoading(false);
                };
            } catch (err) {
                console.error('Failed to connect:', err);
                setError('Failed to initialize connection');
                setLoading(false);
            }
        };

        connectToServer();

        // Cleanup function
        return () => {
            if (ws.current) {
                ws.current.close();
            }

            if (consumerRef.current) {
                consumerRef.current.close();
            }

            if (transportRef.current) {
                transportRef.current.close();
            }
        };
    }, []);

    // Handle joined event from server
    const handleJoined = async (data: any) => {
        try {
            console.log('Joined server with ID:', data.id);

            if (data.streams && data.streams.length > 0) {
                console.log('Available streams:', data.streams);
                setAvailableStreams(data.streams);
            }

            // Load MediaSoup device with router capabilities
            const device = new mediasoupClient.Device();

            if (!data.routerRtpCapabilities) {
                throw new Error('No router capabilities received');
            }

            await device.load({ routerRtpCapabilities: data.routerRtpCapabilities });
            deviceRef.current = device;
            rtpCapabilitiesRef.current = device.rtpCapabilities;

            console.log('Device loaded successfully');
        } catch (err) {
            console.error('Failed to initialize device:', err);
            setError('Failed to initialize WebRTC device');
            setLoading(false);
        }
    };

    // Create transport for consuming media
    const createTransport = () => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
                action: 'create-transport',
                consuming: true,
            }));
            console.log('Requested transport creation');
        } else {
            setError('WebSocket not connected');
            setLoading(false);
        }
    };

    // Connect transport with server
    const connectTransport = async (data: any) => {
        try {
            if (!deviceRef.current) {
                throw new Error('Device not initialized');
            }

            // Create a receive transport
            const transport = deviceRef.current.createRecvTransport({
                id: data.id,
                iceParameters: data.iceParameters,
                iceCandidates: data.iceCandidates,
                dtlsParameters: data.dtlsParameters,
            });

            transportRef.current = transport;

            // Handle transport connection events
            transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    console.log('Transport connect event triggered');
                    ws.current?.send(JSON.stringify({
                        action: 'connect-transport',
                        transportId: data.id,
                        dtlsParameters,
                    }));

                    // Call the callback to complete the connection
                    callback();
                } catch (error) {
                    console.error('Error in connect event:', error);
                    errback(error as Error);
                }
            });

            // Handle connection state change
            transport.on('connectionstatechange', (state) => {
                console.log('Transport connection state changed to', state);
                if (state === 'connected') {
                    console.log('Transport successfully connected!');
                } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                    console.error('Transport connection failed or closed:', state);
                    setError(`Transport connection ${state}`);
                    setLoading(false);
                }
            });

            console.log('Transport created successfully');

        } catch (err) {
            console.error('Failed to connect transport:', err);
            setError('Failed to create media transport');
            setLoading(false);
        }
    };

    // Consume a media stream
    const consumeStream = (streamId: string) => {

        if (!deviceRef.current || !rtpCapabilitiesRef.current) {
            setError('Device not initialized properly');
            return;
        }

        if (!transportRef.current) {
            setError('Transport not created');
            return;
        }

        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            console.log(`Requesting to consume stream: ${streamId}`);
            setActiveStream(streamId);

            ws.current.send(JSON.stringify({
                action: 'consume',
                producerId: streamId,
                rtpCapabilities: rtpCapabilitiesRef.current,
                transportId: transportRef.current.id,
            }));
        } else {
            setError('WebSocket not connected');
        }
    };

    // Handle consumer creation
    const handleConsume = async (data: any) => {
        try {
            console.log('Handling consume response:', data);

            if (!transportRef.current) {
                throw new Error('Transport not created');
            }

            if (!data.id || !data.producerId || !data.kind || !data.rtpParameters) {
                console.log("Looking for producer:", data.producerId);
                console.error('Missing required consumer data:', data);
                throw new Error('Invalid consumer data received from server');
            }

            // Create consumer
            const consumer = await transportRef.current.consume({
                id: data.id,
                producerId: data.producerId,
                kind: data.kind,
                rtpParameters: data.rtpParameters,
                paused: true,
            });

            console.log('Consumer created:', consumer);
            consumerRef.current = consumer;

            // Add the track to video element
            if (videoRef.current) {
                console.log('Adding track to video element:', consumer.track);
                const stream = new MediaStream();
                stream.addTrack(consumer.track);
                videoRef.current.srcObject = stream;

                try {
                    await videoRef.current.play();
                    console.log('Video playback started');
                } catch (error) {
                    console.error('Error playing video:', error);
                    handleAutoplayIssue(error);
                }
            }

            // Resume the consumer
            console.log('Resuming consumer with ID:', data.id);
            consumer.resume();

            ws.current?.send(JSON.stringify({
                action: 'resume-consumer',
                consumerId: data.id,
            }));

            setLoading(false);
            setConnected(true);
            console.log('Consumer setup complete');
        } catch (err) {
            console.error('Failed to consume stream:', err);
            setError(`Failed to create stream consumer: ${err.message}`);
            setLoading(false);
        }
    };

    // Handle autoplay issues
    const handleAutoplayIssue = (error: any) => {
        if (error.name === 'NotAllowedError') {
            alert('Autoplay blocked. Please click the video area to enable playback.');

            if (videoRef.current) {
                const playOnClick = async () => {
                    try {
                        await videoRef.current?.play();
                        videoRef.current?.removeEventListener('click', playOnClick);
                    } catch (e) {
                        console.error('Still cannot play video:', e);
                    }
                };

                videoRef.current.addEventListener('click', playOnClick);
            }
        }
    };

    // Manually reconnect function
    const handleReconnect = () => {
        console.log('Manually reconnecting...');
        setLoading(true);
        setError(null);

        // Clean up existing connections
        if (consumerRef.current) {
            consumerRef.current.close();
            consumerRef.current = null;
        }

        if (transportRef.current) {
            transportRef.current.close();
            transportRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }

        // Reconnect from scratch
        if (ws.current) {
            ws.current.close();
        }

        const newWs = new WebSocket('ws://localhost:3001');
        ws.current = newWs;

        newWs.onopen = () => {
            console.log('WebSocket reconnected');
            newWs.send(JSON.stringify({
                action: 'join',
                role: 'watcher'
            }));
        };

        newWs.onmessage = ws.current.onmessage;
        newWs.onerror = ws.current.onerror;
        newWs.onclose = ws.current.onclose;
    };

    // Debug information
    const connectionStatus = () => {
        const wsStatus = ws.current ?
            ws.current.readyState === WebSocket.OPEN ? 'Connected' :
                ws.current.readyState === WebSocket.CONNECTING ? 'Connecting' :
                    ws.current.readyState === WebSocket.CLOSING ? 'Closing' : 'Closed'
            : 'Not initialized';

        return `WebSocket: ${wsStatus}, Transport: ${transportRef.current ? 'Created' : 'None'}, Consumer: ${consumerRef.current ? 'Active' : 'None'}`;
    };

    return (
        <div className="flex flex-col min-h-screen bg-gray-900">
            {/* Header */}
            <header className="bg-black p-4 shadow-md">
                <div className="container mx-auto">
                    <h1 className="text-2xl font-bold text-white">Live Stream</h1>
                </div>
            </header>

            {/* Main content */}
            <main className="flex-grow container mx-auto p-4">
                <div className="bg-black rounded-lg overflow-hidden shadow-lg mb-6">
                    {/* Video player */}
                    <div className="relative aspect-video bg-gray-800">
                        {loading && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500"></div>
                            </div>
                        )}

                        {error && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="bg-red-500 bg-opacity-75 text-white p-4 rounded text-center">
                                    <p className="text-lg font-semibold">Error</p>
                                    <p>{error}</p>
                                    <button
                                        className="mt-4 px-4 py-2 bg-white text-red-500 rounded hover:bg-gray-100 transition"
                                        onClick={handleReconnect}
                                    >
                                        Try Again
                                    </button>
                                </div>
                            </div>
                        )}

                        <video
                            ref={videoRef}
                            className="w-full h-full"
                            autoPlay
                            playsInline
                            muted
                            controls
                        />
                    </div>

                    {/* Stream info */}
                    <div className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-semibold text-white mb-1">
                                    {activeStream ? `Stream: ${activeStream.slice(0, 8)}...` : 'No active stream'}
                                </h2>
                                <p className="text-gray-400">
                                    {connectionStatus()}
                                </p>
                            </div>

                            <div className="flex items-center space-x-2">
                                <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                <span className={`text-sm ${connected ? 'text-green-500' : 'text-red-500'}`}>
                                    {connected ? 'Live' : 'Offline'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Stream controls */}
                <div className="bg-black rounded-lg p-4 shadow-lg">
                    <h2 className="text-lg font-semibold text-white mb-4">Stream Controls</h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <button
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                            onClick={handleReconnect}
                            disabled={loading}
                        >
                            {loading ? 'Connecting...' : 'Reconnect'}
                        </button>

                        <button
                            className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition"
                            onClick={() => {
                                if (availableStreams.length > 0) {
                                    consumeStream(availableStreams[0]);
                                } else {
                                    setError('No streams available');
                                }
                            }}
                            disabled={loading || availableStreams.length === 0}
                        >
                            Consume Stream
                        </button>

                        <button
                            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
                            onClick={() => {
                                if (consumerRef.current) {
                                    consumerRef.current.close();
                                    consumerRef.current = null;
                                }
                                if (videoRef.current) {
                                    videoRef.current.srcObject = null;
                                }
                                setConnected(false);
                                setActiveStream(null);
                            }}
                            disabled={!connected}
                        >
                            Disconnect
                        </button>
                    </div>
                </div>

                {/* Debug information */}
                <div className="bg-black rounded-lg p-4 shadow-lg mt-4">
                    <h2 className="text-lg font-semibold text-white mb-4">Debug Information</h2>
                    <div className="text-gray-400 text-sm">
                        <p>Available Streams: {availableStreams.length > 0 ? availableStreams.join(', ') : 'None'}</p>
                        <p>Active Stream: {activeStream || 'None'}</p>
                        <p>Connection Status: {connected ? 'Connected' : 'Disconnected'}</p>
                        <p>Media Device Ready: {deviceRef.current ? 'Yes' : 'No'}</p>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="bg-black p-4 mt-6">
                <div className="container mx-auto text-center text-gray-400">
                    <p>&copy; {new Date().getFullYear()} Stream Viewer</p>
                </div>
            </footer>
        </div>
    );
}