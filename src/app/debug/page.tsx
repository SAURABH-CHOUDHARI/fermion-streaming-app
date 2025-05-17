'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as mediasoupClient from 'mediasoup-client';

export default function WatchPageDebugger() {
    const [logs, setLogs] = useState<Array<{time: string, type: string, message: string}>>([]);
    const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
    const [deviceStatus, setDeviceStatus] = useState<'uninitialized' | 'loading' | 'loaded'>('uninitialized');
    const [transportStatus, setTransportStatus] = useState<'none' | 'creating' | 'created' | 'connecting' | 'connected'>('none');
    const [consumerStatus, setConsumerStatus] = useState<'none' | 'consuming' | 'created' | 'resumed'>('none');
    const [activeStreams, setActiveStreams] = useState<string[]>([]);
    const ws = useRef<WebSocket | null>(null);
    const deviceRef = useRef<mediasoupClient.Device | null>(null);
    
    const addLog = (type: string, message: string) => {
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + now.getMilliseconds().toString().padStart(3, '0');
        setLogs(prev => [...prev, { time, type, message }]);
    };
    
    const handleJoined = async (data: any) => {
        try {
            setDeviceStatus('loading');
            addLog('debug', 'Loading device with router capabilities...');
            
            const device = new mediasoupClient.Device();
            
            if (!data.routerRtpCapabilities) {
                throw new Error('No routerRtpCapabilities received from server');
            }
            
            addLog('debug', `Router capabilities: ${JSON.stringify(data.routerRtpCapabilities)}`);
            
            await device.load({ routerRtpCapabilities: data.routerRtpCapabilities });
            deviceRef.current = device;
            
            if (!device.rtpCapabilities || !device.rtpCapabilities.codecs || device.rtpCapabilities.codecs.length === 0) {
                throw new Error('Device failed to load proper capabilities');
            }
            
            addLog('debug', `Device loaded successfully. Capabilities: ${JSON.stringify(device.rtpCapabilities)}`);
            setDeviceStatus('loaded');
            
            if (data.streams) {
                setActiveStreams(data.streams);
            }
        } catch (err) {
            addLog('error', `Device load failed: ${err}`);
            setDeviceStatus('uninitialized');
        }
    };
    
    useEffect(() => {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;
        
        console.log = (...args) => {
            originalLog.apply(console, args);
            addLog('log', args.map(a => typeof a === 'object' ? JSON.stringify(a) : a.toString()).join(' '));
        };
        
        console.error = (...args) => {
            originalError.apply(console, args);
            addLog('error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : a.toString()).join(' '));
        };
        
        console.warn = (...args) => {
            originalWarn.apply(console, args);
            addLog('warn', args.map(a => typeof a === 'object' ? JSON.stringify(a) : a.toString()).join(' '));
        };
        
        const testConnection = () => {
            try {
                addLog('debug', 'Testing WebSocket connection to server...');
                setWsStatus('connecting');
                ws.current = new WebSocket('ws://localhost:3001');
                
                ws.current.onopen = () => {
                    addLog('debug', '✅ WebSocket connection successful');
                    setWsStatus('connected');
                    
                    ws.current?.send(JSON.stringify({ 
                        action: 'join', 
                        role: 'watcher' 
                    }));
                    addLog('debug', 'Sent join message');
                };
                
                ws.current.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        addLog('receive', JSON.stringify(data));
                        
                        if (data.type === 'joined') {
                            handleJoined(data);
                        } else if (data.type === 'transport-created') {
                            setTransportStatus('created');
                        } else if (data.type === 'transport-connected') {
                            setTransportStatus('connected');
                        } else if (data.type === 'consumed') {
                            setConsumerStatus('created');
                        } else if (data.type === 'consumer-resumed') {
                            setConsumerStatus('resumed');
                        }
                    } catch (err) {
                        addLog('error', `Failed to parse message: ${err}`);
                    }
                };
                
                ws.current.onerror = (event) => {
                    addLog('error', `WebSocket error: ${JSON.stringify(event)}`);
                    setWsStatus('disconnected');
                };
                
                ws.current.onclose = () => {
                    addLog('debug', 'WebSocket closed');
                    setWsStatus('disconnected');
                };
            } catch (err) {
                addLog('error', `Failed to initialize WebSocket: ${err}`);
                setWsStatus('disconnected');
            }
        };
        
        testConnection();
        
        return () => {
            console.log = originalLog;
            console.error = originalError;
            console.warn = originalWarn;
            
            if (ws.current) {
                ws.current.close();
            }
        };
    }, []);
    
    const testTransport = () => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            setTransportStatus('creating');
            ws.current.send(JSON.stringify({
                action: 'create-transport',
                consuming: true,
            }));
            addLog('debug', 'Sent create-transport request');
        } else {
            addLog('error', 'WebSocket not connected');
        }
    };
    
    const testConsume = (streamId: string) => {
        if (!deviceRef.current) {
            addLog('error', 'Device not loaded yet!');
            return;
        }

        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            setConsumerStatus('consuming');
            ws.current.send(JSON.stringify({
                action: 'consume',
                producerId: streamId,
                rtpCapabilities: deviceRef.current.rtpCapabilities,
            }));
            addLog('debug', `Sent consume request for stream ${streamId}`);
        } else {
            addLog('error', 'WebSocket not connected');
        }
    };
    
    const checkBrowserCapabilities = () => {
        try {
            const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
            addLog('debug', `Browser supported constraints: ${JSON.stringify(supportedConstraints)}`);
            
            if (window.RTCPeerConnection && navigator.mediaDevices) {
                addLog('debug', '✅ Browser supports WebRTC APIs');
            } else {
                addLog('error', '❌ Browser has incomplete WebRTC support');
            }
        } catch (err) {
            addLog('error', `Failed to check media capabilities: ${err}`);
        }
    };
    

    return (
        <div className="p-6 bg-gray-900 min-h-screen">
            <h1 className="text-2xl font-bold mb-4">WebRTC Connection Debugger</h1>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="p-4 bg-black rounded shadow">
                    <h2 className="text-lg font-semibold mb-2">Connection Status</h2>
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <span>WebSocket:</span>
                            <span className={
                                wsStatus === 'connected' ? 'text-green-600 font-medium' : 
                                wsStatus === 'connecting' ? 'text-yellow-600 font-medium' : 
                                'text-red-600 font-medium'
                            }>
                                {wsStatus.toUpperCase()}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>MediaSoup Device:</span>
                            <span className={
                                deviceStatus === 'loaded' ? 'text-green-600 font-medium' : 
                                deviceStatus === 'loading' ? 'text-yellow-600 font-medium' : 
                                'text-gray-600 font-medium'
                            }>
                                {deviceStatus.toUpperCase()}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>Transport:</span>
                            <span className={
                                transportStatus === 'connected' ? 'text-green-600 font-medium' : 
                                transportStatus === 'created' ? 'text-blue-600 font-medium' :
                                transportStatus === 'connecting' ? 'text-yellow-600 font-medium' : 
                                'text-gray-600 font-medium'
                            }>
                                {transportStatus.toUpperCase()}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span>Consumer:</span>
                            <span className={
                                consumerStatus === 'resumed' ? 'text-green-600 font-medium' : 
                                consumerStatus === 'created' ? 'text-blue-600 font-medium' :
                                consumerStatus === 'consuming' ? 'text-yellow-600 font-medium' : 
                                'text-gray-600 font-medium'
                            }>
                                {consumerStatus.toUpperCase()}
                            </span>
                        </div>
                    </div>
                </div>
                
                <div className="p-4 bg-black rounded shadow">
                    <h2 className="text-lg font-semibold mb-2">Test Functions</h2>
                    <div className="space-y-2">
                        <button 
                            onClick={() => testTransport()}
                            className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                            Test Transport Creation
                        </button>
                        <button 
                            onClick={checkBrowserCapabilities}
                            className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                        >
                            Check Browser Capabilities
                        </button>
                    </div>
                </div>
                
                <div className="p-4 bg-black rounded shadow">
                    <h2 className="text-lg font-semibold mb-2">Available Streams</h2>
                    {activeStreams.length === 0 ? (
                        <p className="text-gray-500">No streams available</p>
                    ) : (
                        <div className="space-y-2">
                            {activeStreams.map(streamId => (
                                <button
                                    key={streamId}
                                    onClick={() => testConsume(streamId)}
                                    className="w-full px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
                                >
                                    Test Consume {streamId.slice(0, 6)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            
            <div className="bg-black rounded shadow p-4">
                <h2 className="text-lg font-semibold mb-2">Debug Logs</h2>
                <div className="h-96 overflow-y-auto bg-gray-800 p-4 rounded text-sm font-mono">
                    {logs.map((log, index) => (
                        <div 
                            key={index} 
                            className={`
                                mb-1 flex 
                                ${log.type === 'error' ? 'text-red-400' : 
                                  log.type === 'warn' ? 'text-yellow-400' : 
                                  log.type === 'receive' ? 'text-green-400' : 'text-gray-300'}
                            `}
                        >
                            <span className="text-gray-500 mr-2">[{log.time}]</span>
                            <span className="w-16 mr-2">{log.type.toUpperCase()}</span>
                            <span className="break-words">{log.message}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}