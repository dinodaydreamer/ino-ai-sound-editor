import React, { useRef, useEffect, useMemo, useState } from 'react';
import * as d3 from 'd3';
import type { SelectionRange } from '../types';

interface WaveformProps {
    audioBuffer: AudioBuffer;
    selection: SelectionRange;
    onSelectionChange: (newSelection: SelectionRange) => void;
    currentTime: number;
}

const WAVEFORM_HEIGHT = 200;
const AXIS_HEIGHT = 30;
const TOTAL_HEIGHT = WAVEFORM_HEIGHT + AXIS_HEIGHT;

const Waveform: React.FC<WaveformProps> = ({ audioBuffer, selection, onSelectionChange, currentTime }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dimensions = { width: 800, height: TOTAL_HEIGHT };

    const [contextMenu, setContextMenu] = useState<{
        visible: boolean;
        x: number;
        y: number;
        time: number;
    } | null>(null);

    const downsampledData = useMemo(() => {
        const rawData = audioBuffer.getChannelData(0);
        const samples = Math.floor(dimensions.width);
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData = [];
        for (let i = 0; i < samples; i++) {
            const blockStart = blockSize * i;
            let sum = 0;
            for (let j = 0; j < blockSize; j++) {
                sum += Math.abs(rawData[blockStart + j]);
            }
            filteredData.push(sum / blockSize);
        }
        return filteredData;
    }, [audioBuffer, dimensions.width]);


    useEffect(() => {
        if (!svgRef.current || !downsampledData.length) return;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove(); 

        const xScale = d3.scaleLinear()
            .domain([0, audioBuffer.duration])
            .range([0, dimensions.width]);

        const yScale = d3.scaleLinear()
            .domain([0, d3.max(downsampledData) || 1])
            .range([WAVEFORM_HEIGHT, 0]);
        
        const pathData = downsampledData.map((d, i) => {
            const x = xScale(i * (audioBuffer.duration / downsampledData.length));
            const y0 = WAVEFORM_HEIGHT / 2 + (yScale(0) - yScale(d)) / 2;
            const y1 = WAVEFORM_HEIGHT / 2 - (yScale(0) - yScale(d)) / 2;
            return `M${x},${y1} L${x},${y0}`;
        }).join(' ');

        svg.append('path')
            .attr('d', pathData)
            .attr('stroke', '#f59e0b')
            .attr('stroke-width', 1);

        const playhead = svg.append('line')
            .attr('class', 'playhead')
            .attr('stroke', '#fbbf24')
            .attr('stroke-width', 2)
            .attr('y1', 0)
            .attr('y2', WAVEFORM_HEIGHT);

        const brush = d3.brushX()
            .extent([[0, 0], [dimensions.width, WAVEFORM_HEIGHT]])
            .on('end', (event) => {
                if (event.selection) {
                    const [x0, x1] = event.selection;
                    onSelectionChange({
                        start: xScale.invert(x0),
                        end: xScale.invert(x1),
                    });
                } else {
                    onSelectionChange({start: 0, end: audioBuffer.duration});
                }
            });

        const brushGroup = svg.append('g')
            .attr('class', 'brush')
            .call(brush);
        
        brushGroup.select('.selection').attr('fill', 'rgba(245, 158, 11, 0.4)');
        
        const xAxis = d3.axisBottom(xScale)
            .ticks(10)
            .tickFormat(d => `${(d as number).toFixed(1)}s`);

        svg.append('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(0, ${WAVEFORM_HEIGHT})`)
            .call(xAxis)
            .selectAll('text')
            .attr('fill', '#a1a1aa')
            .style('font-size', '10px');
            
        svg.selectAll('.x-axis path, .x-axis line').attr('stroke', '#4b5563');

        if (selection.start !== 0 || selection.end !== audioBuffer.duration) {
          brush.move(brushGroup, [xScale(selection.start), xScale(selection.end)]);
        }
        
        const updatePlayhead = (time: number) => {
            playhead.attr('transform', `translate(${xScale(time)}, 0)`);
        };

        updatePlayhead(currentTime);

        return () => {
             svg.selectAll("*").remove();
        }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioBuffer, downsampledData, dimensions.width, dimensions.height]);
    
     useEffect(() => {
        if (!svgRef.current) return;
        const svg = d3.select(svgRef.current);
        const xScale = d3.scaleLinear()
            .domain([0, audioBuffer.duration])
            .range([0, dimensions.width]);

        svg.select('.playhead').attr('transform', `translate(${xScale(currentTime)}, 0)`);

     }, [currentTime, audioBuffer.duration, dimensions.width]);

    useEffect(() => {
        if (!svgRef.current) return;
        const svg = d3.select(svgRef.current);
        const brushGroup = svg.select<SVGGElement>('.brush');
        if (!brushGroup.node()) return; 

        const xScale = d3.scaleLinear()
            .domain([0, audioBuffer.duration])
            .range([0, dimensions.width]);
        
        const brush = d3.brushX().extent([[0, 0], [dimensions.width, WAVEFORM_HEIGHT]]);

        // @ts-ignore
        const currentBrushSelection = d3.brushSelection(brushGroup.node());
        const newSelectionPixels = [xScale(selection.start), xScale(selection.end)];

        if (!currentBrushSelection || Math.abs(currentBrushSelection[0] - newSelectionPixels[0]) > 1 || Math.abs(currentBrushSelection[1] - newSelectionPixels[1]) > 1) {
            brush.move(brushGroup, newSelectionPixels);
        }
    }, [selection, audioBuffer.duration, dimensions.width]);


    useEffect(() => {
        const handleClickOutside = () => {
            setContextMenu(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        const svg = svgRef.current;
        if (!svg) return;

        const rect = svg.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const xScale = d3.scaleLinear()
            .domain([0, audioBuffer.duration])
            .range([0, dimensions.width]);

        const time = Math.max(0, Math.min(audioBuffer.duration, xScale.invert(x)));

        setContextMenu({ visible: true, x, y, time });
    };
    
    const handleSetStart = () => {
        if (contextMenu) {
            const newStart = Math.max(0, contextMenu.time);
            if (newStart < selection.end) {
                onSelectionChange({ start: newStart, end: selection.end });
            }
            setContextMenu(null);
        }
    };

    const handleSetEnd = () => {
        if (contextMenu) {
            const newEnd = Math.min(audioBuffer.duration, contextMenu.time);
            if (newEnd > selection.start) {
                onSelectionChange({ start: selection.start, end: newEnd });
            }
            setContextMenu(null);
        }
    };

    return (
        <div 
            ref={containerRef}
            className="w-full h-full flex items-center justify-center relative"
            onContextMenu={handleContextMenu}
        >
            <svg
                ref={svgRef}
                viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                preserveAspectRatio="xMidYMid meet"
                className="w-full h-full"
            />
            {contextMenu?.visible && (
                <div
                    className="absolute bg-slate-800/80 backdrop-blur-sm rounded-md shadow-lg p-1 text-sm z-10 border border-slate-700"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onMouseDown={(e) => e.stopPropagation()} 
                >
                    <ul className="text-slate-200">
                        <li className="px-3 py-1 hover:bg-amber-600/50 rounded cursor-pointer" onClick={handleSetStart}>
                            Đặt làm điểm bắt đầu
                        </li>
                        <li className="px-3 py-1 hover:bg-amber-600/50 rounded cursor-pointer" onClick={handleSetEnd}>
                            Đặt làm điểm kết thúc
                        </li>
                    </ul>
                </div>
            )}
        </div>
    );
};

export default Waveform;