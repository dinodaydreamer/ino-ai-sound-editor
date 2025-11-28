
import type { Track } from '../types';

// App-specific audio utilities
export const decodeFileAsAudioBuffer = (file: File, audioContext: AudioContext): Promise<AudioBuffer> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            if (event.target?.result instanceof ArrayBuffer) {
                audioContext.decodeAudioData(event.target.result, resolve, reject);
            } else {
                reject(new Error('Failed to read file as ArrayBuffer.'));
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
};

export const trimAudioBuffer = (
    buffer: AudioBuffer,
    start: number,
    end: number,
    audioContext: AudioContext
): AudioBuffer => {
    const startOffset = Math.floor(start * buffer.sampleRate);
    const endOffset = Math.floor(end * buffer.sampleRate);
    const frameCount = endOffset - startOffset;

    if (frameCount <= 0) {
        throw new Error("Invalid trim range. End time must be after start time.");
    }

    const newBuffer = audioContext.createBuffer(
        buffer.numberOfChannels,
        frameCount,
        buffer.sampleRate
    );

    for (let i = 0; i < buffer.numberOfChannels; i++) {
        const channelData = buffer.getChannelData(i);
        const newChannelData = newBuffer.getChannelData(i);
        newChannelData.set(channelData.subarray(startOffset, endOffset));
    }

    return newBuffer;
};


// Effect functions
const cloneAudioBuffer = (buffer: AudioBuffer, context: AudioContext): AudioBuffer => {
    const newBuffer = context.createBuffer(
        buffer.numberOfChannels,
        buffer.length,
        buffer.sampleRate
    );
    for (let i = 0; i < buffer.numberOfChannels; i++) {
        newBuffer.copyToChannel(buffer.getChannelData(i), i);
    }
    return newBuffer;
};

export const applyFadeIn = (buffer: AudioBuffer, selectionStart: number, selectionEnd: number, context: AudioContext, duration: number): AudioBuffer => {
    const newBuffer = cloneAudioBuffer(buffer, context);
    const startSample = Math.floor(selectionStart * newBuffer.sampleRate);
    const selectionEndSample = Math.floor(selectionEnd * newBuffer.sampleRate);
    const fadeSamples = Math.floor(duration * newBuffer.sampleRate);
    
    // The fade ends at the minimum of (start + duration) or the end of selection
    const endSample = Math.min(startSample + fadeSamples, selectionEndSample);
    const length = endSample - startSample;

    if (length <= 0) return newBuffer;

    for (let i = 0; i < newBuffer.numberOfChannels; i++) {
        const channelData = newBuffer.getChannelData(i);
        for (let j = startSample; j < endSample; j++) {
            // The linear ramp goes from 0 to 1 over `length` samples
            channelData[j] *= (j - startSample) / length;
        }
    }
    return newBuffer;
};

export const applyFadeOut = (buffer: AudioBuffer, selectionStart: number, selectionEnd: number, context: AudioContext, duration: number): AudioBuffer => {
    const newBuffer = cloneAudioBuffer(buffer, context);
    const selectionStartSample = Math.floor(selectionStart * newBuffer.sampleRate);
    const endSample = Math.floor(selectionEnd * newBuffer.sampleRate);
    const fadeSamples = Math.floor(duration * newBuffer.sampleRate);

    // The fade starts at the maximum of (end - duration) or the start of selection
    const startSample = Math.max(selectionStartSample, endSample - fadeSamples);
    const length = endSample - startSample;

    if (length <= 0) return newBuffer;

    for (let i = 0; i < newBuffer.numberOfChannels; i++) {
        const channelData = newBuffer.getChannelData(i);
        for (let j = startSample; j < endSample; j++) {
            // The linear ramp goes from 1 to 0 over `length` samples
            channelData[j] *= 1 - ((j - startSample) / length);
        }
    }
    return newBuffer;
};

export const applyNormalize = (buffer: AudioBuffer, start: number, end: number, context: AudioContext): AudioBuffer => {
    const newBuffer = cloneAudioBuffer(buffer, context);
    const startSample = Math.floor(start * newBuffer.sampleRate);
    const endSample = Math.floor(end * newBuffer.sampleRate);
    
    let peak = 0;
    for (let i = 0; i < newBuffer.numberOfChannels; i++) {
        const channelData = newBuffer.getChannelData(i);
        for (let j = startSample; j < endSample; j++) {
            peak = Math.max(peak, Math.abs(channelData[j]));
        }
    }

    if (peak === 0) return newBuffer;

    const gain = 1.0 / peak;

    for (let i = 0; i < newBuffer.numberOfChannels; i++) {
        const channelData = newBuffer.getChannelData(i);
        for (let j = startSample; j < endSample; j++) {
            channelData[j] *= gain;
        }
    }

    return newBuffer;
};

export const applyNoiseReduction = async (buffer: AudioBuffer, start: number, end: number, context: AudioContext): Promise<AudioBuffer> => {
    // Simple noise gate implementation
    const newBuffer = cloneAudioBuffer(buffer, context);
    const startSample = Math.floor(start * newBuffer.sampleRate);
    const endSample = Math.floor(end * newBuffer.sampleRate);
    const threshold = 0.02; // Noise threshold

    for (let i = 0; i < newBuffer.numberOfChannels; i++) {
        const channelData = newBuffer.getChannelData(i);
        for (let j = startSample; j < endSample; j++) {
            if (Math.abs(channelData[j]) < threshold) {
                channelData[j] = 0;
            }
        }
    }
    return newBuffer;
};


export const applyStudioEffect = async (buffer: AudioBuffer, start: number, end: number, context: AudioContext): Promise<AudioBuffer> => {
    // Uses a compressor and EQ for a "studio" vocal effect
    const trimmedBuffer = trimAudioBuffer(buffer, start, end, context);
    
    const offlineCtx = new OfflineAudioContext(
        trimmedBuffer.numberOfChannels,
        trimmedBuffer.length,
        trimmedBuffer.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = trimmedBuffer;

    // Compressor to even out volume
    const compressor = offlineCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, offlineCtx.currentTime);
    compressor.knee.setValueAtTime(30, offlineCtx.currentTime);
    compressor.ratio.setValueAtTime(12, offlineCtx.currentTime);
    compressor.attack.setValueAtTime(0.003, offlineCtx.currentTime);
    compressor.release.setValueAtTime(0.25, offlineCtx.currentTime);

    // EQ to add warmth (slight bass boost)
    const eq = offlineCtx.createBiquadFilter();
    eq.type = "lowshelf";
    eq.frequency.setValueAtTime(300, offlineCtx.currentTime);
    eq.gain.setValueAtTime(3, offlineCtx.currentTime);

    source.connect(eq);
    eq.connect(compressor);
    compressor.connect(offlineCtx.destination);
    
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();

    // Now, combine the processed (trimmed) part with the original buffer
    const originalBufferClone = cloneAudioBuffer(buffer, context);
    const startSample = Math.floor(start * buffer.sampleRate);
    for (let i = 0; i < originalBufferClone.numberOfChannels; i++) {
        originalBufferClone.getChannelData(i).set(renderedBuffer.getChannelData(i), startSample);
    }

    return originalBufferClone;
};


// WAV encoding function
function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
    for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
}

export const audioBufferToWavBlob = (buffer: AudioBuffer): Blob => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    let offset = 0;

    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, length - 8, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint16(offset, numOfChan, true); offset += 2;
    view.setUint32(offset, buffer.sampleRate, true); offset += 4;
    view.setUint32(offset, buffer.sampleRate * 2 * numOfChan, true); offset += 4;
    view.setUint16(offset, numOfChan * 2, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, length - offset - 4, true); offset += 4;

    const channels = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }

    const interleaved = new Float32Array(buffer.length * numOfChan);
    let index = 0;
    for (let i = 0; i < buffer.length; i++) {
        for (let j = 0; j < numOfChan; j++) {
            interleaved[index++] = channels[j][i];
        }
    }

    floatTo16BitPCM(view, offset, interleaved);

    return new Blob([view], { type: 'audio/wav' });
};

// Multi-track rendering
export const renderMix = async (tracks: Track[], sampleRate: number = 44100): Promise<AudioBuffer> => {
    if (tracks.length === 0) {
        throw new Error("No tracks to render");
    }

    // Find total duration
    let totalDuration = 0;
    tracks.forEach(track => {
        const end = track.startTime + track.buffer.duration;
        if (end > totalDuration) totalDuration = end;
    });
    
    // Add a little buffer at the end
    totalDuration += 0.5;

    const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate);

    tracks.forEach(track => {
        if (track.isMuted) return;

        const source = offlineCtx.createBufferSource();
        source.buffer = track.buffer;

        const gain = offlineCtx.createGain();
        gain.gain.value = track.volume;

        source.connect(gain);
        gain.connect(offlineCtx.destination);

        source.start(track.startTime);
    });

    return await offlineCtx.startRendering();
};
