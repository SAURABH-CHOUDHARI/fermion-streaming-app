// utils/mediaUtils.ts
export const getDevices = async (): Promise<{
    audioInputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
}> => {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();

        return {
            audioInputs: devices.filter(device => device.kind === 'audioinput'),
            videoInputs: devices.filter(device => device.kind === 'videoinput'),
            audioOutputs: devices.filter(device => device.kind === 'audiooutput')
        };
    } catch (error) {
        console.error('Error getting devices:', error);
        return {
            audioInputs: [],
            videoInputs: [],
            audioOutputs: []
        };
    }
};

export const getMediaStream = async (
    options: {
        audio: boolean | MediaTrackConstraints;
        video: boolean | MediaTrackConstraints;
    }
): Promise<MediaStream | null> => {
    try {
        return await navigator.mediaDevices.getUserMedia(options);
    } catch (error) {
        console.error('Error getting media stream:', error);
        return null;
    }
};

export const getScreenShareStream = async (): Promise<MediaStream | null> => {
    try {
        return await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always',
                displaySurface: 'monitor',
            } as MediaTrackConstraints,
            audio: true
        });
    } catch (error) {
        console.error('Error getting screen share:', error);
        return null;
    }
};

export const stopMediaStream = (stream: MediaStream | null): void => {
    if (!stream) return;

    stream.getTracks().forEach(track => {
        track.stop();
    });
};

export const addTrackToStream = (
    stream: MediaStream,
    track: MediaStreamTrack
): MediaStream => {
    stream.addTrack(track);
    return stream;
};

export const removeTrackFromStream = (
    stream: MediaStream,
    track: MediaStreamTrack
): MediaStream => {
    stream.removeTrack(track);
    return stream;
};