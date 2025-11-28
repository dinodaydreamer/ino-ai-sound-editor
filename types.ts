
export interface SelectionRange {
    start: number;
    end: number;
}

export interface Track {
    id: string;
    file: File;
    buffer: AudioBuffer;
    startTime: number; // Start time in seconds
    volume: number;
    isMuted: boolean;
    color: string;
}
