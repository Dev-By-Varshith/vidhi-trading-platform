import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, AreaSeries } from 'lightweight-charts';

// ULL Rule 2: No React State for Live Data
// ULL Rule 1: Lightweight Canvas Charts

export const AreaChartWidget = ({ title, color, dataType }) => {
  const chartContainerRef = useRef();
  const seriesRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    // ULL initialization
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#5c729b',
        fontFamily: "'Roboto Mono', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
      },
      crosshair: {
        vertLine: {
          color: 'rgba(255, 255, 255, 0.1)',
          width: 1,
          style: 0,
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.1)',
          width: 1,
          style: 0,
        },
      },
      handleScroll: false,
      handleScale: false,
    });
    
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: color.replace('1)', '0.4)'), // Assume color is rgba
      bottomColor: color.replace('1)', '0.0)'),
      lineWidth: 2,
      priceFormat: {
        type: 'price',
        precision: 4,
        minMove: 0.0001,
      },
    });
    seriesRef.current = series;

    // Generate initial dummy data
    let currentVal = 100;
    const initialData = [];
    let time = Math.floor(Date.now() / 1000) - 100;
    
    for (let i = 0; i < 100; i++) {
      currentVal += (Math.random() - 0.5) * 2;
      initialData.push({ time: time + i, value: currentVal });
    }
    time += 100;
    series.setData(initialData);

    // Hardware accelerated resizing
    const handleResize = () => {
      chart.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight });
    };
    
    // Initial size
    handleResize();
    window.addEventListener('resize', handleResize);

    // Live Simulator (Bypasses React)
    let animationId;
    const tick = () => {
      currentVal += (Math.random() - 0.5) * 2;
      time += 1;
      // Direct Canvas Mutation - Zero DOM reconciliation
      series.update({ time: time, value: currentVal });
      
      // Simulate 60FPS or 10FPS depending on data type
      setTimeout(() => {
        animationId = requestAnimationFrame(tick);
      }, dataType === 'fast' ? 16 : 100);
    };
    
    animationId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      chart.remove();
    };
  }, [color, dataType]);

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <div className="panel-title">{title}</div>
        <div className="panel-controls">
          <span className="badge">ULL</span>
          <span className="status-dot pulsing" style={{boxShadow: `0 0 5px ${color}`, backgroundColor: color}}></span>
        </div>
      </div>
      <div ref={chartContainerRef} className="chart-container" />
    </div>
  );
};
