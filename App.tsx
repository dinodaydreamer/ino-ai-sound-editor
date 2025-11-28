
import React, { useState, useRef, useEffect, useCallback } from 'react';
import Waveform from './components/Waveform';
import { MultiTrackTimeline } from './components/MultiTrackTimeline';
import { decodeFileAsAudioBuffer, trimAudioBuffer, audioBufferToWavBlob, applyFadeIn, applyFadeOut, applyNormalize, applyNoiseReduction, applyStudioEffect, renderMix } from './utils/audio';
import { PlayIcon, PauseIcon, DownloadIcon, UploadIcon, LogoIcon, UndoIcon, RedoIcon, SparklesIcon, SoundWaveIcon, MicIcon, ScissorsIcon, LayersIcon, PlusIcon, KeyIcon, LockClosedIcon } from './components/icons';
import { Spinner } from './components/Spinner';
import type { SelectionRange, Track } from './types';

const COLORS = ['#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899'];

const App: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'editor' | 'studio'>('editor');
    
    // --- API KEY STATE ---
    const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('dino_audio_api_key') || '');
    const [hasApiKey, setHasApiKey] = useState<boolean>(false);

    useEffect(() => {
        localStorage.setItem('dino_audio_api_key', apiKey);
        setHasApiKey(apiKey.trim().length > 0);
    }, [apiKey]);
    
    // --- EDITOR STATE ---
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
    const [selection, setSelection] = useState<SelectionRange>({ start: 0, end: 0 });
    const [history, setHistory] = useState<AudioBuffer[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);

    // --- STUDIO STATE ---
    const [tracks, setTracks] = useState<Track[]>([]);

    // --- SHARED STATE ---
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [currentTime, setCurrentTime] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [volume, setVolume] = useState<number>(1);
    const [fadeDuration, setFadeDuration] = useState<number>(1.0);

    const audioContextRef = useRef<AudioContext | null>(null);
    
    // Refs for Editor playback
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const playbackStartTimeRef = useRef<number>(0);
    const playbackStartOffsetRef = useRef<number>(0);

    // Refs for Studio playback
    const studioSourceNodesRef = useRef<AudioBufferSourceNode[]>([]);

    useEffect(() => {
        if (!audioContextRef.current) {
            const context = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = context;
            gainNodeRef.current = context.createGain();
            gainNodeRef.current.connect(context.destination);
        }
    }, []);

    // --- EDITOR LOGIC ---
    const updateHistory = useCallback((newBuffer: AudioBuffer) => {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(newBuffer);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        setAudioBuffer(newBuffer);
    }, [history, historyIndex]);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            if (activeTab === 'studio') {
                await addTrackToStudio(file);
            } else {
                loadEditorFile(file);
            }
        }
        // Reset input
        event.target.value = ''; 
    };

    const loadEditorFile = async (file: File) => {
        setIsLoading(true);
        setError(null);
        setAudioFile(file);
        setAudioBuffer(null);
        setCurrentTime(0);
        setSelection({ start: 0, end: 0 });
        setHistory([]);
        setHistoryIndex(-1);
        try {
            if (!audioContextRef.current) throw new Error("AudioContext not initialized");
            const buffer = await decodeFileAsAudioBuffer(file, audioContextRef.current);
            setSelection({ start: 0, end: buffer.duration });
            updateHistory(buffer);
        } catch (err) {
            setError('Không thể giải mã tệp âm thanh.');
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const addTrackToStudio = async (file: File) => {
        setIsLoading(true);
        setError(null);
        try {
            if (!audioContextRef.current) throw new Error("Ctx missing");
            const buffer = await decodeFileAsAudioBuffer(file, audioContextRef.current);
            const newTrack: Track = {
                id: Math.random().toString(36).substr(2, 9),
                file,
                buffer,
                startTime: 0,
                volume: 1,
                isMuted: false,
                color: COLORS[tracks.length % COLORS.length]
            };
            setTracks(prev => [...prev, newTrack]);
        } catch (err) {
            setError("Không thể thêm track.");
        } finally {
            setIsLoading(false);
        }
    }
    
    // Playback Loop (Visuals)
    useEffect(() => {
        if (!isPlaying) return;

        let animationFrameId: number;
        const loop = () => {
            if (audioContextRef.current) {
                const elapsedTime = audioContextRef.current.currentTime - playbackStartTimeRef.current;
                const newCurrentTime = playbackStartOffsetRef.current + elapsedTime;

                // Stop condition depends on mode
                if (activeTab === 'editor') {
                    if (newCurrentTime >= selection.end) {
                        setCurrentTime(selection.end);
                        setIsPlaying(false);
                        stopAllAudio();
                    } else {
                        setCurrentTime(newCurrentTime);
                        animationFrameId = requestAnimationFrame(loop);
                    }
                } else {
                    // Studio mode: Stop when we exceed max duration significantly or manual stop
                    setCurrentTime(newCurrentTime);
                    animationFrameId = requestAnimationFrame(loop);
                }
            }
        };
        animationFrameId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(animationFrameId);
    }, [isPlaying, selection.end, activeTab]);


    const stopAllAudio = () => {
        if (audioSourceRef.current) {
            try { audioSourceRef.current.stop(); } catch(e) {}
            audioSourceRef.current = null;
        }
        studioSourceNodesRef.current.forEach(node => {
            try { node.stop(); } catch (e) {}
        });
        studioSourceNodesRef.current = [];
    };

    const startPlayback = useCallback((startOffset: number) => {
        if (!audioContextRef.current) return;
        const ctx = audioContextRef.current;
        stopAllAudio(); // Ensure clean slate

        if (activeTab === 'editor') {
            if (!audioBuffer || !gainNodeRef.current) return;
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(gainNodeRef.current);
            gainNodeRef.current.gain.value = volume;
            
            const offset = startOffset >= selection.end ? selection.start : Math.max(selection.start, startOffset);
            const duration = selection.end - offset;

            if (duration <= 0) {
                 // Reset to start if at end
                 setCurrentTime(selection.start);
                 playbackStartOffsetRef.current = selection.start;
                 source.start(0, selection.start, selection.end - selection.start);
            } else {
                source.start(0, offset, duration);
                playbackStartOffsetRef.current = offset;
                setCurrentTime(offset);
            }

            audioSourceRef.current = source;
            
        } else {
            // Studio Mode
            if (tracks.length === 0) return;
            
            const studioStartOffset = startOffset;
            
            tracks.forEach(track => {
                if (track.isMuted) return;
                
                // Calculate if this track should be playing right now or in future
                const trackEnd = track.startTime + track.buffer.duration;
                
                // If track is already finished at current time, skip
                if (trackEnd <= studioStartOffset) return;

                const source = ctx.createBufferSource();
                source.buffer = track.buffer;
                const trackGain = ctx.createGain();
                trackGain.gain.value = track.volume;
                source.connect(trackGain);
                trackGain.connect(ctx.destination); // Connect to master
                
                if (track.startTime >= studioStartOffset) {
                    // Track starts in the future relative to now
                    const when = track.startTime - studioStartOffset;
                    source.start(ctx.currentTime + when, 0);
                } else {
                    // Track is in the middle
                    const offsetInTrack = studioStartOffset - track.startTime;
                    source.start(0, offsetInTrack);
                }
                studioSourceNodesRef.current.push(source);
            });
            playbackStartOffsetRef.current = studioStartOffset;
        }
        
        playbackStartTimeRef.current = ctx.currentTime;
        setIsPlaying(true);
    }, [activeTab, audioBuffer, selection, tracks, volume]);

    const handlePlayPause = useCallback(() => {
        if (!audioContextRef.current) return;
        const ctx = audioContextRef.current;

        if (isPlaying) {
            // PAUSE LOGIC
            stopAllAudio();
            setIsPlaying(false);
            
            // Calculate the exact time we stopped
            const elapsedTime = ctx.currentTime - playbackStartTimeRef.current;
            const actualPauseTime = playbackStartOffsetRef.current + elapsedTime;
            
            setCurrentTime(actualPauseTime);
            playbackStartOffsetRef.current = actualPauseTime;
            
        } else {
            // PLAY LOGIC
            startPlayback(currentTime);
        }
    }, [isPlaying, startPlayback, currentTime]);

    const handleSeek = (time: number) => {
        const newTime = Math.max(0, time);
        setCurrentTime(newTime);
        playbackStartOffsetRef.current = newTime;
        
        if (isPlaying) {
            startPlayback(newTime);
        }
    };
    
    useEffect(() => {
        if (gainNodeRef.current && activeTab === 'editor') {
            gainNodeRef.current.gain.value = volume;
        }
    }, [volume, activeTab]);
    
    // Spacebar
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!hasApiKey) return; // Disable shortcuts if locked
            const activeElement = document.activeElement as HTMLElement;
            if (activeElement && ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(activeElement.tagName)) return;
            if (event.code === 'Space') {
                event.preventDefault();
                handlePlayPause();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handlePlayPause, hasApiKey]);

    // --- EDITOR ACTIONS ---
    const handleTrimAndDownload = () => {
        if (!audioBuffer || !audioContextRef.current) return;
        try {
            const trimmedBuffer = trimAudioBuffer(audioBuffer, selection.start, selection.end, audioContextRef.current);
            downloadBuffer(trimmedBuffer, `cut_${audioFile?.name || 'audio'}`);
        } catch (err) {
            setError("Không thể cắt hoặc xuất âm thanh.");
        }
    };

    const downloadBuffer = (buffer: AudioBuffer, filenameBase: string) => {
        const blob = audioBufferToWavBlob(buffer);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filenameBase}_${Date.now()}.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    const handleEffect = useCallback(async (effectFn: Function) => {
        if (!audioBuffer || !audioContextRef.current) return;
        setIsProcessing(true);
        setError(null);
        try {
            await new Promise(resolve => setTimeout(resolve, 50));
            const newBuffer = await effectFn(audioBuffer, selection.start, selection.end, audioContextRef.current);
            updateHistory(newBuffer);
        } catch (err) {
            setError(`Lỗi hiệu ứng: ${(err as Error).message}`);
        } finally {
            setIsProcessing(false);
        }
    }, [audioBuffer, selection.start, selection.end, updateHistory]);

    const handleApplyFade = (effect: 'in' | 'out') => {
        const actualDuration = Math.min(fadeDuration, selection.end - selection.start);
        if (actualDuration < 0.1) return setError("Vùng chọn quá ngắn.");
        const fn = effect === 'in' ? applyFadeIn : applyFadeOut;
        handleEffect((b: AudioBuffer, s: number, e: number, c: AudioContext) => fn(b, s, e, c, actualDuration));
    };

    const handleUndo = () => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setAudioBuffer(history[newIndex]);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setAudioBuffer(history[newIndex]);
        }
    };

    // --- STUDIO ACTIONS ---
    const updateTrack = (id: string, updates: Partial<Track>) => {
        setTracks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    };

    const removeTrack = (id: string) => {
        setTracks(prev => prev.filter(t => t.id !== id));
    };

    const handleExportMix = async () => {
        if (tracks.length === 0) return;
        setIsProcessing(true);
        try {
            // Give UI time to render spinner
            await new Promise(resolve => setTimeout(resolve, 50));
            const mixedBuffer = await renderMix(tracks);
            downloadBuffer(mixedBuffer, 'studio_mix');
        } catch (e) {
            setError("Lỗi khi xuất file: " + (e as Error).message);
        } finally {
            setIsProcessing(false);
        }
    };


    return (
        <div className="min-h-screen bg-transparent flex flex-col text-gray-200 p-4 sm:p-6 lg:p-8 relative">
            {/* API Key Blocker Overlay */}
            {!hasApiKey && (
                <div className="fixed inset-0 z-50 bg-gray-950/80 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center space-y-6">
                        <div className="p-4 bg-gray-800 rounded-full border border-gray-700">
                            <LockClosedIcon className="w-12 h-12 text-amber-500" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-white mb-2">Yêu cầu API Key</h2>
                            <p className="text-gray-400 text-sm mb-4">
                                Để sử dụng ứng dụng DINO AI SOUND EDITOR, vui lòng nhập API Key của bạn.
                            </p>
                            <input 
                                type="password" 
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-amber-500 outline-none text-center"
                                placeholder="Dán Gemini API Key vào đây..."
                                autoFocus
                            />
                        </div>
                        <p className="text-xs text-gray-500">
                           Key sẽ được lưu trong trình duyệt của bạn (LocalStorage).
                        </p>
                    </div>
                </div>
            )}

            <header className="w-full max-w-7xl mx-auto mb-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center space-x-3">
                        <LogoIcon className="h-10 w-10 text-amber-400" />
                        <h1 className="text-3xl font-bold tracking-tight text-white">DINO AI SOUND EDITOR</h1>
                    </div>
                    
                    <div className="flex items-center gap-3">
                         {/* API Key Input (Menu Bar) */}
                         <div className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs font-semibold transition-colors ${
                                hasApiKey 
                                    ? 'bg-slate-800/50 border-slate-700 text-slate-300' 
                                    : 'bg-red-900/20 border-red-700/50 text-red-400 animate-pulse'
                            }`}>
                            <KeyIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            <input 
                                type="password" 
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="Nhập API Key..."
                                className="bg-transparent border-none outline-none focus:ring-0 w-32 sm:w-64 placeholder-white/20"
                            />
                        </div>

                        {/* Tab Switcher */}
                        <div className="flex bg-gray-800 p-1 rounded-lg border border-gray-700">
                            <button 
                                onClick={() => { setActiveTab('editor'); stopAllAudio(); setIsPlaying(false); }}
                                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'editor' ? 'bg-amber-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                            >
                                <ScissorsIcon className="w-4 h-4" /> Editor đơn
                            </button>
                            <button 
                                onClick={() => { setActiveTab('studio'); stopAllAudio(); setIsPlaying(false); }}
                                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'studio' ? 'bg-amber-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                            >
                                <LayersIcon className="w-4 h-4" /> Phòng thu (Multi)
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className={`flex-grow w-full max-w-7xl mx-auto flex flex-col lg:flex-row gap-8 ${!hasApiKey ? 'blur-sm pointer-events-none select-none opacity-50' : ''}`}>
                {/* Controls Sidebar */}
                <div className="lg:w-1/3 bg-gray-900/70 backdrop-blur-sm border border-gray-700/50 rounded-xl shadow-lg p-6 flex flex-col space-y-6 h-fit">
                    <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-600 rounded-lg hover:border-amber-500/50 transition-colors bg-slate-800/20">
                        <UploadIcon className="w-12 h-12 text-slate-500 mb-2" />
                        <label htmlFor="audio-upload" className="cursor-pointer bg-amber-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-amber-700 transition-colors flex items-center gap-2">
                            {activeTab === 'studio' ? <PlusIcon className="w-5 h-5"/> : null}
                            {activeTab === 'studio' ? 'Thêm file âm thanh' : (audioFile ? 'Đổi âm thanh' : 'Tải lên âm thanh')}
                        </label>
                        <input id="audio-upload" type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />
                        <p className="text-xs text-slate-400 mt-2">{activeTab === 'studio' ? 'Có thể thêm nhiều file' : (audioFile ? audioFile.name : 'MP3, WAV, OGG, etc.')}</p>
                    </div>

                    {error && <div className="text-red-400 bg-red-900/50 p-3 rounded-md text-sm border border-red-800">{error}</div>}

                    {/* Playback Controls (Shared) */}
                    <div className="space-y-4 border-b border-slate-700 pb-6">
                       <div className="flex items-center justify-center space-x-6">
                            <button onClick={handlePlayPause} className="p-4 bg-slate-700 rounded-full hover:bg-amber-500 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 group">
                                {isPlaying ? <PauseIcon className="w-8 h-8 group-hover:text-white"/> : <PlayIcon className="w-8 h-8 group-hover:text-white"/>}
                            </button>
                       </div>
                       <div className="text-center font-mono text-2xl text-amber-300 tabular-nums">
                           {currentTime.toFixed(2)}s
                       </div>
                    </div>
                    
                    {/* Editor Specific Controls */}
                    {activeTab === 'editor' && audioBuffer && (
                        <div className="space-y-4 animate-in fade-in duration-300">
                            <div className="flex items-center justify-between">
                                 <h2 className="text-lg font-semibold text-white">Lịch sử</h2>
                                 <div className="flex space-x-2">
                                     <button onClick={handleUndo} disabled={historyIndex <= 0 || isProcessing} className="p-2 bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-50"><UndoIcon className="w-4 h-4"/></button>
                                     <button onClick={handleRedo} disabled={historyIndex >= history.length - 1 || isProcessing} className="p-2 bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-50"><RedoIcon className="w-4 h-4"/></button>
                                 </div>
                            </div>
                            
                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">Master Volume</label>
                                <input type="range" min="0" max="2" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500" />
                            </div>

                            <div className="space-y-2 pt-2">
                                <label className="text-sm font-medium text-slate-300">Fade (Giây)</label>
                                <div className="flex gap-2">
                                    <input type="number" min="0.1" step="0.1" value={fadeDuration} onChange={(e) => setFadeDuration(parseFloat(e.target.value))} className="w-20 bg-slate-700 rounded px-2 text-sm" />
                                    <button onClick={() => handleApplyFade('in')} disabled={isProcessing} className="flex-1 bg-slate-700 hover:bg-slate-600 text-xs py-2 rounded">Fade In</button>
                                    <button onClick={() => handleApplyFade('out')} disabled={isProcessing} className="flex-1 bg-slate-700 hover:bg-slate-600 text-xs py-2 rounded">Fade Out</button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-2">
                                <button onClick={() => handleEffect(applyNormalize)} disabled={isProcessing} className="bg-slate-700 hover:bg-slate-600 text-xs py-2 rounded">Normalize</button>
                                <button onClick={() => handleEffect(applyNoiseReduction)} disabled={isProcessing} className="bg-slate-700 hover:bg-slate-600 text-xs py-2 rounded flex justify-center items-center gap-1"><SoundWaveIcon className="w-3 h-3"/> Khử nhiễu</button>
                                <button onClick={() => handleEffect(applyStudioEffect)} disabled={isProcessing} className="col-span-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs py-2 rounded flex justify-center items-center gap-1"><SparklesIcon className="w-3 h-3"/> Giọng Studio AI</button>
                            </div>

                            <button onClick={handleTrimAndDownload} className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 px-4 rounded-md transition-colors mt-4" disabled={isProcessing}>
                                <DownloadIcon className="w-5 h-5"/>
                                Lưu vùng chọn (.wav)
                            </button>
                        </div>
                    )}

                    {/* Studio Specific Controls */}
                    {activeTab === 'studio' && (
                        <div className="space-y-4 animate-in fade-in duration-300">
                             <div className="bg-slate-800/50 p-3 rounded text-sm text-slate-300">
                                <p className="mb-2 font-semibold text-amber-400">Hướng dẫn:</p>
                                <ul className="list-disc pl-4 space-y-1 text-xs">
                                    <li>Thêm nhiều file âm thanh để mix.</li>
                                    <li>Kéo thả thanh màu trên timeline để di chuyển.</li>
                                    <li><strong>Click vào timeline để chọn điểm phát.</strong></li>
                                    <li>Phải chuột vào track để <strong>Xóa</strong>.</li>
                                    <li>Lăn chuột trên timeline để <strong>Zoom</strong>.</li>
                                </ul>
                             </div>
                             
                             <button onClick={handleExportMix} disabled={isProcessing || tracks.length === 0} className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-4 rounded-md transition-colors shadow-lg shadow-indigo-900/20">
                                {isProcessing ? <Spinner /> : <DownloadIcon className="w-5 h-5"/>}
                                Xuất bản Mix (Merge)
                            </button>
                        </div>
                    )}
                </div>

                {/* Main Visualization Area */}
                <div className="lg:w-2/3 bg-gray-900/70 backdrop-blur-sm border border-gray-700/50 rounded-xl shadow-lg p-4 flex flex-col min-h-[500px] relative overflow-hidden">
                     {isProcessing && (
                        <div className="absolute inset-0 bg-gray-900/80 flex flex-col items-center justify-center z-50 rounded-xl">
                            <Spinner />
                            <p className="mt-4 text-white animate-pulse">Đang xử lý...</p>
                        </div>
                    )}
                    
                    {activeTab === 'editor' ? (
                        audioBuffer ? (
                            <>
                                <div className="flex-grow w-full h-full relative">
                                    <Waveform 
                                        audioBuffer={audioBuffer} 
                                        selection={selection}
                                        onSelectionChange={setSelection}
                                        currentTime={currentTime}
                                    />
                                </div>
                                <div className="h-8 w-full pt-2 flex justify-between text-xs text-slate-400 font-mono">
                                    <span>Start: {selection.start.toFixed(2)}s</span>
                                    <span>End: {selection.end.toFixed(2)}s</span>
                                </div>
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-slate-500">
                                <SoundWaveIcon className="w-16 h-16 mb-4 opacity-20" />
                                <p>Chế độ Editor: Tải lên một tệp để cắt & chỉnh hiệu ứng</p>
                            </div>
                        )
                    ) : (
                        // Studio Mode
                        <div className="flex-grow flex flex-col h-full">
                             <MultiTrackTimeline 
                                tracks={tracks}
                                currentTime={currentTime}
                                onUpdateTrack={updateTrack}
                                onRemoveTrack={removeTrack}
                                onSeek={handleSeek}
                                duration={tracks.length > 0 ? Math.max(...tracks.map(t => t.startTime + t.buffer.duration)) : 60}
                             />
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default App;
