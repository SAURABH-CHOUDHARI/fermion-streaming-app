// types/mediasoup.d.ts
declare module 'mediasoup-client' {
    export class Device {
        load(options: { routerRtpCapabilities: any }): Promise<void>;
        rtpCapabilities: any;
        canProduce(kind: string): boolean;
        createSendTransport(options: any): Transport;
        createRecvTransport(options: any): Transport;
    }

    export interface Transport {
        id: string;
        closed: boolean;
        direction: string;
        on(event: 'connect', listener: (options: { dtlsParameters: any }, callback: () => void, errback: (error: Error) => void) => void): void;
        on(event: 'produce', listener: (options: { kind: string, rtpParameters: any }, callback: (options: { id: string }) => void, errback: (error: Error) => void) => void): void;
        on(event: 'connectionstatechange', listener: (state: string) => void): void;
        close(): void;
        connect(options: { dtlsParameters: any }): Promise<void>;
        produce(options: { track: MediaStreamTrack, encodings?: any[], codecOptions?: any }): Promise<Producer>;
        consume(options: { id: string, producerId: string, kind: string, rtpParameters: any }): Promise<Consumer>;
    }

    export interface Producer {
        id: string;
        kind: string;
        track: MediaStreamTrack;
        paused: boolean;
        closed: boolean;
        pause(): void;
        resume(): void;
        close(): void;
        replaceTrack(track: MediaStreamTrack): Promise<void>;
    }

    export interface Consumer {
        id: string;
        producerId: string;
        kind: string;
        track: MediaStreamTrack;
        paused: boolean;
        producerPaused: boolean;
        closed: boolean;
        pause(): void;
        resume(): Promise<void>;
        close(): void;
    }
}