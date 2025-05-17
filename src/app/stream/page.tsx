'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as mediasoupClient from 'mediasoup-client';

export default function StreamPage() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [status, setStatus] = useState('Connecting to server...');
    const [isStreaming, setIsStreaming] = useState(false);
    const [remoteStreams, setRemoteStreams] = useState<{ [id: string]: MediaStream }>({});
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);

    // Refs for WebRTC components
    const deviceRef = useRef<mediasoupClient.Device | null>(null);
    const sendTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
    const recvTransportsRef = useRef<{ [id: string]: mediasoupClient.types.Transport }>({});
    const consumersRef = useRef<{ [id: string]: mediasoupClient.types.Consumer[] }>({});
    const wsRef = useRef<WebSocket | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const producersRef = useRef<{ video?: string, audio?: string }>({});

    // Initialize WebSocket connection
    const connectWebSocket = useCallback(() => {
        if (wsRef.current) return;

        setStatus('Connecting to signaling server...');
        wsRef.current = new WebSocket('ws://localhost:3001');

        wsRef.current.onopen = () => {
            setStatus('Connected. Joining room...');
            wsRef.current?.send(JSON.stringify({
                action: 'join',
                role: 'participant' // Changed from 'streamer' to 'participant' to allow both producing and consuming
            }));
        };

        wsRef.current.onclose = () => {
            setStatus('Connection closed. Refresh to reconnect.');
            wsRef.current = null;
        };

        wsRef.current.onerror = (err) => {
            console.error('WebSocket error:', err);
            setStatus('Connection error. Refresh to reconnect.');
        };
    }, []);

    // Handle WebSocket messages
    const handleMessage = useCallback(async (event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data);
            console.log('SFU message:', data);

            switch (data.type) {
                case 'joined':
                    await handleJoined(data);
                    break;
                case 'transport-created':
                    await handleTransportCreated(data);
                    break;
                case 'transport-connected':
                    setStatus('Transport connected. Ready to stream.');
                    break;
                case 'produced':
                    if (data.kind === 'video') {
                        producersRef.current.video = data.producerId;
                    } else if (data.kind === 'audio') {
                        producersRef.current.audio = data.producerId;
                    }
                    console.log(`${data.kind} producer created:`, data.producerId);
                    break;
                case 'new-producer':
                    // A new producer has been created, we should consume it
                    await consumeProducer(data.producerId, data.producerKind, data.producerPeerId);
                    break;
                case 'producer-closed':
                    // Handle remote producer closed
                    handleProducerClosed(data.producerId, data.producerPeerId);
                    break;
                case 'consumer-created':
                    // Handle consumer created response
                    await handleConsumerCreated(data);
                    break;
                case 'error':
                    console.error('Server error:', data.message);
                    setStatus(`Error: ${data.message}`);
                    break;
                default:
                    console.warn('Unhandled message type:', data.type);
            }
        } catch (err) {
            console.error('Message handling error:', err);
            setStatus('Error processing server message');
        }
    }, []);

    // Handle 'joined' message
    const handleJoined = async (data: any) => {
        try {
            setStatus('Initializing media device...');
            const device = new mediasoupClient.Device();
            await device.load({ routerRtpCapabilities: data.routerRtpCapabilities });
            deviceRef.current = device;

            // Create send transport for producing our media
            setStatus('Creating send transport...');
            wsRef.current?.send(JSON.stringify({
                action: 'create-transport',
                direction: 'send'
            }));

            // Request existing producers to consume
            if (data.existingProducers && data.existingProducers.length > 0) {
                for (const producer of data.existingProducers) {
                    await consumeProducer(producer.id, producer.kind, producer.peerId);
                }
            }
        } catch (err) {
            console.error('Device initialization failed:', err);
            setStatus('Failed to initialize media device');
            throw err;
        }
    };

    // Handle 'transport-created' message
    const handleTransportCreated = async (data: any) => {
        try {
            if (!deviceRef.current) {
                throw new Error('Device not initialized');
            }

            if (data.direction === 'send') {
                setStatus('Setting up send transport...');
                const transport = deviceRef.current.createSendTransport({
                    id: data.id,
                    iceParameters: data.iceParameters,
                    iceCandidates: data.iceCandidates,
                    dtlsParameters: data.dtlsParameters,
                });

                // Transport event handlers
                transport.on('connect', ({ dtlsParameters }, callback, errback) => {
                    setStatus('Connecting transport...');

                    // Increased timeout to 30 seconds
                    const timeout = setTimeout(() => {
                        errback(new Error('Transport connection timed out (30s)'));
                    }, 30000);

                    // Create a one-time message listener
                    const listener = (event: MessageEvent) => {
                        const response = JSON.parse(event.data);
                        if (response.type === 'transport-connected' && response.transportId === transport.id) {
                            clearTimeout(timeout);
                            wsRef.current?.removeEventListener('message', listener);
                            callback();
                        } else if (response.type === 'error' && response.transportId === transport.id) {
                            clearTimeout(timeout);
                            wsRef.current?.removeEventListener('message', listener);
                            errback(new Error(response.message || 'Transport connection failed'));
                        }
                    };

                    wsRef.current?.addEventListener('message', listener);

                    // Send connect request
                    wsRef.current?.send(JSON.stringify({
                        action: 'connect-transport',
                        transportId: transport.id,
                        dtlsParameters,
                    }));
                });

                transport.on('connectionstatechange', (state) => {
                    console.log('Transport state:', state);
                    if (state === 'connected') {
                        setStatus('Transport connected. Ready to stream.');
                    } else if (state === 'failed') {
                        setStatus('Transport failed. Please refresh.');
                    }
                });

                transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
                    try {
                        const producerId = await new Promise<string>((resolve, reject) => {
                            const listener = (event: MessageEvent) => {
                                const response = JSON.parse(event.data);
                                if (response.type === 'produced' && response.kind === kind) {
                                    wsRef.current?.removeEventListener('message', listener);
                                    resolve(response.producerId);
                                } else if (response.type === 'error') {
                                    wsRef.current?.removeEventListener('message', listener);
                                    reject(new Error(response.message));
                                }
                            };

                            wsRef.current?.addEventListener('message', listener);
                            wsRef.current?.send(JSON.stringify({
                                action: 'produce',
                                transportId: transport.id,
                                kind,
                                rtpParameters,
                            }));
                        });

                        callback({ id: producerId });
                    } catch (err) {
                        errback(err as Error);
                    }
                });

                sendTransportRef.current = transport;
                setStatus('Transport ready. Click "Start Streaming" to begin.');
            } else if (data.direction === 'receive') {
                // Create receive transport for consuming remote media
                const recvTransport = deviceRef.current.createRecvTransport({
                    id: data.id,
                    iceParameters: data.iceParameters,
                    iceCandidates: data.iceCandidates,
                    dtlsParameters: data.dtlsParameters,
                });

                recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                    wsRef.current?.send(JSON.stringify({
                        action: 'connect-transport',
                        transportId: recvTransport.id,
                        dtlsParameters,
                    }));

                    // Create a one-time message listener for transport connected response
                    const listener = (event: MessageEvent) => {
                        const response = JSON.parse(event.data);
                        if (response.type === 'transport-connected' && response.transportId === recvTransport.id) {
                            wsRef.current?.removeEventListener('message', listener);
                            callback();
                        } else if (response.type === 'error' && response.transportId === recvTransport.id) {
                            wsRef.current?.removeEventListener('message', listener);
                            errback(new Error(response.message || 'Transport connection failed'));
                        }
                    };

                    wsRef.current?.addEventListener('message', listener);
                });

                recvTransport.on('connectionstatechange', (state) => {
                    console.log(`Receive transport ${data.peerId} state:`, state);
                });

                // Store receive transport in our ref
                recvTransportsRef.current[data.peerId] = recvTransport;

                // Now consume the producer
                if (data.producerId) {
                    wsRef.current?.send(JSON.stringify({
                        action: 'consume',
                        transportId: recvTransport.id,
                        producerId: data.producerId,
                        peerId: data.peerId
                    }));
                }
            }
        } catch (err) {
            console.error('Transport creation failed:', err);
            setStatus('Failed to create transport');
            throw err;
        }
    };

    // Consume a producer from another participant
    const consumeProducer = async (producerId: string, kind: string, peerId: string) => {
        try {
            if (!deviceRef.current) {
                console.error('Device not initialized');
                return;
            }

            // If we don't have a receive transport for this peer yet, create one
            if (!recvTransportsRef.current[peerId]) {
                wsRef.current?.send(JSON.stringify({
                    action: 'create-transport',
                    direction: 'receive',
                    peerId: peerId,
                    producerId: producerId
                }));
            } else {
                // Otherwise, use the existing transport to consume
                wsRef.current?.send(JSON.stringify({
                    action: 'consume',
                    transportId: recvTransportsRef.current[peerId].id,
                    producerId: producerId,
                    peerId: peerId
                }));
            }
        } catch (err) {
            console.error('Failed to consume producer:', err);
        }
    };

    // Handle consumer created message
    const handleConsumerCreated = async (data: any) => {
        try {
            const { transportId, id, producerId, kind, rtpParameters, peerId } = data;
            const transport = recvTransportsRef.current[peerId];
            
            if (!transport) {
                console.error('Receive transport not found for peer:', peerId);
                return;
            }

            // Create consumer for this producer
            const consumer = await transport.consume({
                id,
                producerId,
                kind,
                rtpParameters
            });

            // Store consumer
            if (!consumersRef.current[peerId]) {
                consumersRef.current[peerId] = [];
            }
            consumersRef.current[peerId].push(consumer);

            // Send consumer ready signal to server
            wsRef.current?.send(JSON.stringify({
                action: 'consumer-ready',
                consumerId: id,
                transportId
            }));

            // Add the consumer's track to a stream
            let stream = remoteStreams[peerId];
            if (!stream) {
                stream = new MediaStream();
                setRemoteStreams(prev => ({ ...prev, [peerId]: stream }));
            }
            stream.addTrack(consumer.track);

            // If this is a video consumer and we've just created a new stream, update our state
            if (kind === 'video') {
                setRemoteStreams(prev => ({ ...prev, [peerId]: stream }));
            }

            console.log(`Consumer created for ${kind} track from peer ${peerId}`);
        } catch (err) {
            console.error('Failed to create consumer:', err);
        }
    };

    // Handle remote producer closed
    const handleProducerClosed = (producerId: string, peerId: string) => {
        // Find and close the associated consumer
        const peerConsumers = consumersRef.current[peerId];
        if (peerConsumers) {
            const consumerIndex = peerConsumers.findIndex(c => c.producerId === producerId);
            if (consumerIndex >= 0) {
                const consumer = peerConsumers[consumerIndex];
                consumer.close();
                consumersRef.current[peerId].splice(consumerIndex, 1);
            }

            // If this peer has no more consumers, remove their stream
            if (consumersRef.current[peerId].length === 0) {
                delete consumersRef.current[peerId];
                setRemoteStreams(prev => {
                    const updated = { ...prev };
                    delete updated[peerId];
                    return updated;
                });

                // Also clean up the receive transport if it exists
                if (recvTransportsRef.current[peerId]) {
                    recvTransportsRef.current[peerId].close();
                    delete recvTransportsRef.current[peerId];
                }
            }
        }
    };

    // Start streaming
    const startStreaming = async () => {
        if (!sendTransportRef.current) {
            setStatus('Transport not ready');
            return;
        }

        try {
            setStatus('Requesting media permissions...');
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            localStreamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }

            setStatus('Starting media production...');

            // Produce video track
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
                await sendTransportRef.current.produce({
                    track: videoTrack,
                    encodings: [
                        { maxBitrate: 500000 },
                        { maxBitrate: 1000000 }
                    ],
                    codecOptions: {
                        videoGoogleStartBitrate: 1000
                    }
                });
            }

            // Produce audio track
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                await sendTransportRef.current.produce({
                    track: audioTrack,
                    codecOptions: {
                        opusStereo: true,
                        opusDtx: true
                    }
                });
            }

            setIsStreaming(true);
            setStatus('You are now streaming!');
        } catch (err) {
            console.error('Streaming failed:', err);
            setStatus('Failed to start streaming');
        }
    };

    // Stop streaming
    const stopStreaming = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }

        if (sendTransportRef.current) {
            sendTransportRef.current.close();
            sendTransportRef.current = null;
        }

        // Close all receive transports
        Object.values(recvTransportsRef.current).forEach(transport => {
            transport.close();
        });
        recvTransportsRef.current = {};

        // Clear all consumers
        consumersRef.current = {};

        // Clear remote streams
        setRemoteStreams({});

        if (wsRef.current) {
            wsRef.current.send(JSON.stringify({ action: 'leave' }));
        }

        setIsStreaming(false);
        setStatus('Stream ended. Refresh to start a new stream.');
    };

    // Toggle audio mute
    const toggleMute = () => {
        if (localStreamRef.current) {
            const audioTracks = localStreamRef.current.getAudioTracks();
            audioTracks.forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsMuted(!isMuted);
        }
    };

    // Toggle video
    const toggleVideo = () => {
        if (localStreamRef.current) {
            const videoTracks = localStreamRef.current.getVideoTracks();
            videoTracks.forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsVideoOff(!isVideoOff);
        }
    };

    // Initialize connection
    useEffect(() => {
        connectWebSocket();

        const ws = wsRef.current;
        return () => {
            stopStreaming();
            ws?.close();
        };
    }, [connectWebSocket]);

    // Set up message listener
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws) return;

        ws.addEventListener('message', handleMessage);
        return () => {
            ws.removeEventListener('message', handleMessage);
        };
    }, [handleMessage]);

   return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="w-full max-w-6xl bg-white rounded-lg shadow-xl overflow-hidden">
            {/* Video Grid Area */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2 bg-black">
                {/* Local Stream (You) */}
                <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                    />
                    {(!isStreaming || isVideoOff) && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-white text-center p-4">
                                <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-2">
                                    <span className="text-xl font-bold">YOU</span>
                                </div>
                                <p className="text-sm">{status}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Remote Streams (Others) */}
                {Object.entries(remoteStreams).map(([streamId, stream]) => (
                    <div key={streamId} className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
                        <video
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover"
                            ref={(el) => {
                                if (el) el.srcObject = stream;
                            }}
                        />
                        <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs">
                            User {streamId.slice(0, 5)}
                        </div>
                    </div>
                ))}
            </div>

            {/* Controls */}
            <div className="p-4 bg-gray-50 flex flex-col items-center">
                <div className="flex flex-wrap justify-center gap-3 mb-3">
                    <button
                        onClick={toggleMute}
                        className={`p-2 rounded-full ${isMuted ? 'bg-red-500 text-white' : 'bg-gray-800 text-white'}`}
                        disabled={!isStreaming}
                    >
                        {isMuted ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                            </svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            </svg>
                        )}
                    </button>

                    <button
                        onClick={toggleVideo}
                        className={`p-2 rounded-full ${isVideoOff ? 'bg-red-500 text-white' : 'bg-gray-800 text-white'}`}
                        disabled={!isStreaming}
                    >
                        {isVideoOff ? (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                        )}
                    </button>

                    {!isStreaming ? (
                        <button
                            onClick={startStreaming}
                            className="flex items-center gap-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-full font-medium transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Start Streaming
                        </button>
                    ) : (
                        <button
                            onClick={stopStreaming}
                            className="flex items-center gap-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-full font-medium transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                            </svg>
                            Stop Streaming
                        </button>
                    )}
                </div>

                <div className="text-sm text-gray-600 text-center">
                    {status}
                    {Object.keys(remoteStreams).length > 0 && (
                        <span className="ml-2 text-green-600">
                            {Object.keys(remoteStreams).length} participant(s)
                        </span>
                    )}
                </div>
            </div>
        </div>
    </div>
);
}