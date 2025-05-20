// components/MediaControls.tsx
import React from 'react';

interface MediaControlsProps {
    isStreaming: boolean;
    isMuted: boolean;
    isVideoEnabled: boolean;
    onToggleMute: () => void;
    onToggleVideo: () => void;
    onEndCall: () => void;
}

const MediaControls: React.FC<MediaControlsProps> = ({
    isStreaming,
    isMuted,
    isVideoEnabled,
    onToggleMute,
    onToggleVideo,
    onEndCall
}) => {
    return (
        <div className="flex justify-center gap-4 p-4 bg-gray-100 rounded-lg">
            <button
                onClick={onToggleMute}
                className={`p-3 rounded-full ${isMuted ? 'bg-red-500' : 'bg-blue-500'} text-white`}
                title={isMuted ? 'Unmute' : 'Mute'}
            >
                {isMuted ? 'Mic Off' : 'Mic On'}
            </button>

            <button
                onClick={onToggleVideo}
                className={`p-3 rounded-full ${isVideoEnabled ? 'bg-blue-500' : 'bg-red-500'} text-white`}
                title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
            >
                {isVideoEnabled ? 'Cam On' : 'Cam Off'}
            </button>

            {isStreaming && (
                <button
                    onClick={onEndCall}
                    className="p-3 rounded-full bg-red-600 text-white"
                    title="End call"
                >
                    End
                </button>
            )}
        </div>
    );
};

export default MediaControls;