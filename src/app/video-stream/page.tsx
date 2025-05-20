'use client';
// pages/video-stream.tsx
import React, { useEffect, useRef, useState } from 'react';
import * as mediasoupClient from 'mediasoup-client';
import { Device } from 'mediasoup-client';

interface WebSocketMessage {
    type: string;
    data: unknown;
}

let device: Device;

const VideoStreamPage: React.FC = () => {
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [isProducing, setIsProducing] = useState<boolean>(false);
    const [isConsuming, setIsConsuming] = useState<boolean>(false);
    const [statusMessage, setStatusMessage] = useState<string>('Disconnected');
    const [consumers, setConsumers] = useState<unknown[]>([]);
    const [shareScreen, setShareScreen] = useState<boolean>(false);

    const wsRef = useRef<WebSocket | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteStreamRef = useRef<HTMLVideoElement>(null);
    const producerTransportRef = useRef<unknown>(null);
    const consumerTransportRef = useRef<any>(null);
    const producerRef = useRef<unknown>(null);
    const consumerRef = useRef<unknown>(null);
    const localStreamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        // Initialize WebSocket connection
        connect();

        // Cleanup function
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }

            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);


    const connect = () => {
        // Update with your WebSocket server URL
        const ws = new WebSocket('ws://localhost:8000/ws');
        wsRef.current = ws;

        ws.onopen = () => {
            setIsConnected(true);
            setStatusMessage('Connected to server');
            getRouterRtpCapabilities();
        };

        ws.onclose = () => {
            setIsConnected(false);
            setStatusMessage('Disconnected from server');
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            setStatusMessage('Connection error');
        };

        ws.onmessage = (message) => handleSocketMessage(message);
    };

    const handleSocketMessage = (message: MessageEvent) => {
        const parsedMessage: WebSocketMessage = JSON.parse(message.data);

        console.log('Received message:', parsedMessage.type, parsedMessage.data);

        switch (parsedMessage.type) {
            case 'routerCapabilities':
                onRouterRtpCapabilities(parsedMessage.data);
                break;

            case 'producerTransportCreated':
                onProducerTransportCreated(parsedMessage.data);
                break;

            case 'producerConnected':
                startProducing();
                break;

            case 'produced':
                break;

            case 'subTransportCreated':
                onSubTransportCreated(parsedMessage.data);
                break;

            case 'subConnected':
                consume();
                break;

            case 'subscribed':
                onSubscribed(parsedMessage.data);
                break;

            case 'resumed':
                setStatusMessage('Consumer resumed');
                break;

            case 'newProducer':
                handleNewProducer();
                break;

            case 'error':
                console.error('Server error:', parsedMessage.data);
                setStatusMessage(`Error: ${parsedMessage.data}`);
                break;

            default:
                console.log('Unknown message type:', parsedMessage.type);
        }
    };

    const sendMessage = (type: string, data: unknown = {}) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            setStatusMessage('WebSocket not connected');
            return;
        }

        const message = JSON.stringify({ type, ...data });
        wsRef.current.send(message);
    };

    const sendMessageWithResponse = (expectedType: string, message: any): Promise<any> => {
        return new Promise((resolve, reject) => {
            const handleMessage = (event: MessageEvent) => {
                try {
                    const response = JSON.parse(event.data);
                    if (response.type === expectedType) {
                        wsRef.current?.removeEventListener('message', handleMessage);
                        resolve(response.data);
                    }
                } catch (err) {
                    reject(err);
                }
            };

            wsRef.current?.addEventListener('message', handleMessage);
            wsRef.current?.send(JSON.stringify(message));
        });
    };

    const getRouterRtpCapabilities = () => {
        sendMessage('getRouterRtpCapabilities');
    };

    const onRouterRtpCapabilities = (routerRtpCapabilities: unknown) => {
        loadDevice(routerRtpCapabilities);
        createProducerTransport();
    };

    const createProducerTransport = () => {
        sendMessage('createProducerTransport', { forceTcp: false });
    };

    const onProducerTransportCreated = async (event: any) => {
        if (!deviceRef.current) {
            setStatusMessage('Device not loaded');
            return;
        };
        if (event.error) {
            console.error('producer transport create error', event.error);
            return;
        };
        try {
            const transport = deviceRef.current.createSendTransport(event);

            // Set up transport event handlers

            transport.on('connect', ({ dtlsParameters }, callback, errback) => {
                try {
                    sendMessage('producerTransportConnected', {
                        type: 'connectProducerTransport',
                        dtlsParameters,
                    });

                    callback(); // ✅ Only call after server confirms
                } catch (error) {
                    console.error('❌ Transport connect error:', error);
                    errback(error as Error);
                }
            });


            transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
                try {
                    const data = await sendMessageWithResponse('produced', {
                        type: 'produce',
                        transportId: transport.id,
                        kind,
                        rtpParameters,
                    });
                    callback({ id: data.id }); // Return the producer ID to mediasoup
                } catch (error) {
                    console.error('Produce error:', error);
                    errback(error as Error);
                }
            });

            //end transport producer

            //connection state change begin

            transport.on('connectionstatechange', (state) => {
                console.log('Producer transport state changed to', state);
                if (state === 'failed') {
                    transport.close();
                    setStatusMessage(`Transport state: ${state}`);
                };
                if (state === 'closed') {
                    setStatusMessage(`Transport state: ${state}`);
                }
            });
            //connection state change end

            producerTransportRef.current = transport;
            setStatusMessage('Producer transport created');

        } catch (error) {
            console.error('Failed to create send transport:', error);
            setStatusMessage('Failed to create send transport');
        }
    };

    const startProducing = async (useScreen: boolean) => {
        if (!producerTransportRef.current) {
            setStatusMessage('Producer transport not created');
            return;
        }

        try {
            let stream: MediaStream;

            if (useScreen) {
                stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            } else {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            }

            localStreamRef.current = stream;
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            const videoTrack = stream.getVideoTracks()[0];
            const audioTrack = stream.getAudioTracks()[0];

            if (videoTrack) {
                producerRef.current = await producerTransportRef.current.produce({
                    track: videoTrack,
                    encodings: [
                        { maxBitrate: 100000 },
                        { maxBitrate: 300000 },
                        { maxBitrate: 900000 }
                    ],
                    codecOptions: {
                        videoGoogleStartBitrate: 1000
                    }
                });
            }

            if (audioTrack) {
                await producerTransportRef.current.produce({
                    track: audioTrack
                });
            }

            setIsProducing(true);
            setStatusMessage(useScreen ? 'Sharing screen' : 'Sharing webcam');

        } catch (error) {
            console.error('Failed to start producing:', error);
            setStatusMessage('Failed to start producing');
        }
    };

    const createConsumerTransport = () => {
        // Prevent creating multiple consumer transports
        if (consumerTransportRef.current) {
            console.log("Reusing existing consumer transport");
            return consumerTransportRef.current;
        }

        console.log('Creating consumer transport...');
        sendMessage('createConsumerTransport');
    };

    const onSubTransportCreated = (event: any) => {
        if (!deviceRef.current) {
            setStatusMessage('Device not loaded');
            return;
        }

        try {
            const transport = deviceRef.current.createRecvTransport(event);
            console.log("hello from outside")

            transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    console.log('hello from indside')
                    sendMessage('connectConsumerTransport', {
                        transportId: transport.id,
                        dtlsParameters
                    });

                    console.log('✅ Consumer transport connected!');
                    callback();

                } catch (error) {
                    console.error('Consumer transport connect error:', error);
                    errback(error as Error);
                }
            });

            transport.on('connectionstatechange', (state) => {
                console.log('Consumer transport state changed to', state);
                if (state === 'failed' || state === 'closed') {
                    transport.close();
                    setStatusMessage(`Consumer transport state: ${state}`);
                };
            });

            consumerTransportRef.current = transport;
            setStatusMessage('Consumer transport created');

            // IMPORTANT: Start consuming immediately after transport creation
            // This will trigger the connect event
            if (deviceRef.current?.rtpCapabilities) {
                consume();
            }

        } catch (error) {
            console.error('Failed to create consumer transport:', error);
            setStatusMessage('Failed to create consumer transport');
        }
    };

    const consume = () => {
        if (!deviceRef.current || !consumerTransportRef.current) {
            setStatusMessage('Device or consumer transport not ready');
            return;
        }

        if (!deviceRef.current.rtpCapabilities) {
            setStatusMessage('RTP capabilities not available');
            return;
        }

        // Prevent duplicate consume requests
        if (isConsuming) {
            setStatusMessage('Already consuming');
            return;
        }

        setIsConsuming(true); // Set consuming state
        sendMessage('consume', {
            rtpCapabilities: deviceRef.current.rtpCapabilities,
        });
    };

    const onSubscribed = async (data: any) => {
        try {
            const { id, kind, rtpParameters, producerId } = data;


            const consumer = await consumerTransportRef.current.consume({
                id,
                producerId,
                kind,
                rtpParameters,
                codecOptions: {}
            });

            consumerRef.current = consumer;

            // Handle the consumer's track
            const track = consumer.track;
            const stream = new MediaStream([track]);

            if (remoteStreamRef.current) {
                remoteStreamRef.current.srcObject = stream;
            }

            setConsumers(prev => [...prev, consumer]);

            sendMessage('resume');
            setIsConsuming(true);
            setStatusMessage('Consuming remote stream');

        } catch (error) {
            console.error('Failed to consume:', error);
            setStatusMessage('Failed to consume');
        }
    };

    const handleNewProducer = () => {
        // When a new producer connects, try to consume their stream
        if (isConsuming) {
            setStatusMessage('New producer detected');
            consume();
        }
    };

    const toggleShareScreen = async () => {
        const newShareScreen = !shareScreen;
        setShareScreen(newShareScreen);

        // Stop current stream 
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
        }

        setIsProducing(false);

        // Start producing with the correct source 
        if (isProducing) {
            await startProducing(newShareScreen);
        };
    };

    const loadDevice = async (routerRtpCapabilities: unknown) => {
        try {
            device = new mediasoupClient.Device();

        } catch (error: any) {
            if (error.name === 'UnsupportedError') {
                console.error("Browser Not Supported")
            }
            console.error('Failed to load device:', error);
            setStatusMessage('Failed to load device');
        }
        await device.load({ routerRtpCapabilities });
        deviceRef.current = device;
        setStatusMessage('Device loaded');


    };

    return (
        <div className="container mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Video Streaming</h1>

            <div className="mb-4">
                <p className="text-lg">Status: {statusMessage}</p>
            </div>

            <div className="flex flex-col md:flex-row gap-4 mb-6">
                <div className="w-full md:w-1/2">
                    <h2 className="text-xl font-semibold mb-2">Local Stream</h2>
                    <div className="bg-gray-200 relative aspect-video">
                        <video
                            ref={localVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover"
                        />
                    </div>
                </div>

                <div className="w-full md:w-1/2">
                    <h2 className="text-xl font-semibold mb-2">Remote Stream</h2>
                    <div className="bg-gray-200 relative aspect-video">
                        <video
                            ref={remoteStreamRef}
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover"
                        />
                    </div>
                </div>
            </div>

            <div className="flex gap-2 mb-6">
                <button
                    onClick={() => !isProducing && startProducing(shareScreen)}
                    disabled={!isConnected || isProducing}
                    className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
                >
                    {isProducing ? 'Streaming' : 'Start Streaming'}
                </button>

                <button
                    onClick={toggleShareScreen}
                    disabled={!isConnected}
                    className="px-4 py-2 bg-green-500 text-white rounded disabled:bg-gray-400"
                >
                    {shareScreen ? 'Switch to Camera' : 'Share Screen'}
                </button>

                <button
                    onClick={() => !isConsuming && createConsumerTransport()}
                    disabled={!isConnected || isConsuming}
                    className="px-4 py-2 bg-purple-500 text-white rounded disabled:bg-gray-400"
                >
                    {isConsuming ? 'Subscribed' : 'Subscribe to Streams'}
                </button>
            </div>

            <div className="mb-4">
                <h2 className="text-xl font-semibold mb-2">Connected Consumers ({consumers.length})</h2>
                {consumers.length === 0 && <p>No other streams available</p>}
            </div>
        </div>
    );
};

export default VideoStreamPage;