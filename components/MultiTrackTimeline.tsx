
import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { Track } from '../types';
import * as d3 from 'd3';
import { TrashIcon } from './icons';

interface MultiTrackTimelineProps {
    tracks: Track[];
    currentTime: number;
    onUpdateTrack: (id: string, updates: Partial<Track>) => void;
    onRemoveTrack: (id: string) => void;
    onSeek: (time: number) => void;
    duration: number; // Total visible duration or max duration
}

const TRACK_HEIGHT = 100;
const RULER_HEIGHT = 30;
const HEADER_WIDTH = 160;

export const MultiTrackTimeline: React.FC<MultiTrackTimelineProps> = ({ 
    tracks, 
    currentTime, 
    onUpdateTrack, 
    onRemoveTrack,
    onSeek,
    duration 
}) => {
    const rulerRef = useRef<HTMLDivElement>(null);
    const tracksAreaRef = useRef<HTMLDivElement>(null);
    const [pixelsPerSecond, setPixelsPerSecond] = useState(50);
    const [dragState, setDragState] = useState<{ trackId: string, startX: number, initialStartTime: number } | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, trackId: string } | null>(null);

    // Ensure we have enough width for the longest track
    const maxDuration = Math.max(duration, ...tracks.map(t => t.startTime + t.buffer.duration), 10); // Min 10s
    const timelineWidth = maxDuration * pixelsPerSecond;

    // Sync scroll between ruler and tracks
    const handleScroll = () => {
        if (tracksAreaRef.current && rulerRef.current) {
            rulerRef.current.scrollLeft = tracksAreaRef.current.scrollLeft;
        }
    };

    // Mouse Wheel Zooming
    const handleWheel = useCallback((e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey || true) { // Always zoom on scroll in this area for better UX
            e.preventDefault();
            const zoomSpeed = 0.001;
            const newScale = pixelsPerSecond * (1 - e.deltaY * zoomSpeed);
            setPixelsPerSecond(Math.max(10, Math.min(500, newScale)));
        }
    }, [pixelsPerSecond]);

    useEffect(() => {
        const el = tracksAreaRef.current;
        if (el) {
            el.addEventListener('wheel', handleWheel, { passive: false });
        }
        return () => {
            if (el) {
                el.removeEventListener('wheel', handleWheel);
            }
        };
    }, [handleWheel]);

    // Close context menu on click outside
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    // Drag Logic
    const handleMouseDown = (e: React.MouseEvent, track: Track) => {
        if (e.button !== 0) return; // Only left click drags
        e.stopPropagation(); // Prevent triggering timeline seek
        setDragState({
            trackId: track.id,
            startX: e.clientX,
            initialStartTime: track.startTime
        });
    };

    const handleContextMenu = (e: React.MouseEvent, trackId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            trackId: trackId
        });
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!dragState) return;

        const deltaPixels = e.clientX - dragState.startX;
        const deltaTime = deltaPixels / pixelsPerSecond;
        
        let newStartTime = dragState.initialStartTime + deltaTime;
        newStartTime = Math.max(0, newStartTime); // Cannot go before 0

        onUpdateTrack(dragState.trackId, { startTime: newStartTime });
    }, [dragState, pixelsPerSecond, onUpdateTrack]);

    const handleMouseUp = useCallback(() => {
        setDragState(null);
    }, []);

    useEffect(() => {
        if (dragState) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragState, handleMouseMove, handleMouseUp]);


    // Handle Click on Timeline to Seek
    const handleTimelineClick = (e: React.MouseEvent) => {
        const container = tracksAreaRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const clickX = e.clientX - rect.left;

        // If clicked in the sticky header area, ignore
        if (clickX < HEADER_WIDTH) return;

        const scrollLeft = container.scrollLeft;
        // Calculate time based on scroll position and click offset
        const time = (clickX - HEADER_WIDTH + scrollLeft) / pixelsPerSecond;
        
        if (time >= 0) {
            onSeek(time);
        }
    };

    const handleRulerClick = (e: React.MouseEvent) => {
        const container = rulerRef.current;
        if (!container) return;
        
        const rect = container.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const scrollLeft = container.scrollLeft;
        
        const time = (clickX + scrollLeft) / pixelsPerSecond;
        if (time >= 0) {
            onSeek(time);
        }
    };

    // Render Ruler ticks
    const renderRuler = () => {
        const ticks = [];
        const step = pixelsPerSecond > 100 ? 0.5 : pixelsPerSecond > 30 ? 1 : 5;
        
        for (let t = 0; t <= maxDuration; t += step) {
            const left = t * pixelsPerSecond;
            ticks.push(
                <div key={t} className="absolute top-0 flex flex-col items-center" style={{ left }}>
                    <div className="h-2 border-l border-slate-500"></div>
                    <span className="text-[10px] text-slate-400 mt-1 -ml-2 select-none">{t}s</span>
                </div>
            );
        }
        return ticks;
    };

    return (
        <div className="flex flex-col h-full w-full bg-slate-900 rounded-lg border border-slate-700 overflow-hidden select-none relative">
            {/* Top Bar / Ruler Container */}
            <div className="flex h-[30px] border-b border-slate-700 bg-slate-800 z-30 relative">
                <div className="w-[160px] flex-shrink-0 border-r border-slate-700 flex items-center justify-center text-xs text-slate-400 font-mono bg-slate-900 z-40 shadow-md">
                    TRACKS
                </div>
                {/* Ruler Area */}
                <div 
                    className="flex-grow relative overflow-hidden cursor-pointer" 
                    ref={rulerRef}
                    onClick={handleRulerClick}
                >
                    <div className="absolute top-0 left-0 h-full pointer-events-none" style={{ width: timelineWidth }}>
                        {renderRuler()}
                    </div>
                    {/* Playhead Indicator in Ruler */}
                    <div 
                        className="absolute top-0 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-amber-500 z-30 transition-none"
                        style={{ left: currentTime * pixelsPerSecond - 6 }}
                    />
                </div>
            </div>

            {/* Tracks Area */}
            <div 
                className="flex-grow overflow-auto relative custom-scrollbar" 
                ref={tracksAreaRef}
                onScroll={handleScroll}
                onClick={handleTimelineClick}
            >
                 <div className="relative min-h-full">
                    {/* Global Playhead Line */}
                    <div 
                        className="absolute top-0 bottom-0 w-[2px] bg-amber-500/80 z-20 pointer-events-none"
                        style={{ left: currentTime * pixelsPerSecond + HEADER_WIDTH }}
                    />

                    {tracks.map((track) => (
                        <div key={track.id} className="flex h-[100px] border-b border-slate-700/50 relative group hover:bg-slate-800/30 transition-colors">
                            {/* Track Header (Controls) - Sticky */}
                            <div className="sticky left-0 w-[160px] flex-shrink-0 bg-slate-900 border-r border-slate-700 p-2 flex flex-col justify-between z-10 shadow-[2px_0_5px_rgba(0,0,0,0.3)]">
                                <div className="text-xs font-semibold text-slate-300 truncate" title={track.file.name}>
                                    {track.file.name}
                                </div>
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-slate-500">Vol</span>
                                        <span className="text-[10px] text-slate-300">{Math.round(track.volume * 100)}%</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="0" max="1.5" step="0.1"
                                        value={track.volume}
                                        onChange={(e) => onUpdateTrack(track.id, { volume: parseFloat(e.target.value) })}
                                        className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-amber-500"
                                        onMouseDown={(e) => e.stopPropagation()} 
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>
                                <div className="flex items-center justify-between mt-1">
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onUpdateTrack(track.id, { isMuted: !track.isMuted }); }}
                                        className={`text-[10px] px-2 py-0.5 rounded border ${track.isMuted ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-slate-700 border-slate-600 text-slate-400 hover:text-white'}`}
                                    >
                                        {track.isMuted ? 'MUTED' : 'MUTE'}
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); onRemoveTrack(track.id); }} className="text-slate-500 hover:text-red-400">
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Track Timeline Lane */}
                            <div className="flex-grow relative">
                                <div 
                                    className={`absolute top-2 bottom-2 rounded-md overflow-hidden cursor-grab active:cursor-grabbing border border-opacity-50 hover:border-opacity-100 transition-colors shadow-sm ${track.isMuted ? 'opacity-50 grayscale' : ''}`}
                                    style={{
                                        left: track.startTime * pixelsPerSecond,
                                        width: track.buffer.duration * pixelsPerSecond,
                                        backgroundColor: track.color + '40', // 40 hex = 25% opacity
                                        borderColor: track.color
                                    }}
                                    onMouseDown={(e) => handleMouseDown(e, track)}
                                    onContextMenu={(e) => handleContextMenu(e, track.id)}
                                >
                                    {/* Waveform placeholder */}
                                    <div className="w-full h-full opacity-50 flex items-center justify-center overflow-hidden pointer-events-none">
                                        <svg className="w-full h-full" preserveAspectRatio="none">
                                            <path d="M0,50 L1000,50" stroke={track.color} strokeWidth="100" strokeDasharray="4 4" />
                                        </svg>
                                    </div>
                                    <div className="absolute top-1 left-2 text-[10px] font-mono text-white/90 truncate max-w-full pointer-events-none select-none drop-shadow-md font-bold">
                                        {track.file.name}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    
                    {/* Drop zone placeholder / Empty state */}
                    {tracks.length === 0 && (
                        <div className="h-32 flex items-center justify-center text-slate-600 text-sm italic pointer-events-none">
                            Tải lên tệp để thêm vào timeline
                        </div>
                    )}
                 </div>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div 
                    className="fixed z-50 bg-slate-800 border border-slate-600 shadow-xl rounded-md py-1 min-w-[120px]"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    <button 
                        className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-700 flex items-center gap-2"
                        onClick={() => {
                            onRemoveTrack(contextMenu.trackId);
                            setContextMenu(null);
                        }}
                    >
                        <TrashIcon className="w-4 h-4" />
                        Xóa File
                    </button>
                </div>
            )}
            
            {/* Styles for custom scrollbar */}
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    height: 10px;
                    width: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: #0f172a;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #334155;
                    border-radius: 5px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #475569;
                }
            `}</style>
        </div>
    );
};
