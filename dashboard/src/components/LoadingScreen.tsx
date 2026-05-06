'use client';

import { useState, useEffect } from 'react';

export function LoadingScreen() {
    const [progress, setProgress] = useState(0);
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(interval);
                    setTimeout(() => setIsVisible(false), 500);
                    return 100;
                }
                return prev + Math.floor(Math.random() * 15) + 5;
            });
        }, 150);

        return () => clearInterval(interval);
    }, []);

    if (!isVisible) return null;

    return (
        <div 
            className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#050505] transition-opacity duration-1000 ${progress === 100 ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
            {/* Background Texture */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
            
            {/* Center Content */}
            <div className="relative text-center space-y-12 animate-in fade-in zoom-in duration-1000">
                <div className="relative inline-block">
                    <h1 className="text-4xl font-black text-white tracking-[0.3em] font-outfit uppercase bg-clip-text text-transparent bg-gradient-to-b from-white to-white/20">
                        UNAC
                    </h1>
                    <div className="absolute -bottom-2 left-0 w-full h-0.5 bg-blue-600/50 blur-sm" />
                </div>

                <div className="space-y-4">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.5em] ml-1">
                        Estableciendo Conexión Senior
                    </p>
                    
                    {/* Progress Container */}
                    <div className="w-64 h-[2px] bg-background/5 rounded-full overflow-hidden relative">
                        <div 
                            className="absolute top-0 left-0 h-full bg-blue-600 transition-all duration-300 ease-out shadow-[0_0_15px_rgba(37,99,235,0.8)]"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    
                    {/* Percentage */}
                    <div className="flex justify-between items-center text-[9px] font-bold tracking-widest text-slate-600 tabular-nums">
                        <span>INIT_BOOT_SEQ</span>
                        <span>{progress}%</span>
                    </div>
                </div>
            </div>

            {/* Bottom Status */}
            <div className="absolute bottom-12 flex items-center gap-4 opacity-20">
                <span className="text-[8px] font-bold text-white uppercase tracking-widest animate-pulse">System Encrypted</span>
                <div className="w-1 h-1 rounded-full bg-blue-500" />
                <span className="text-[8px] font-bold text-white uppercase tracking-widest">v4.0.2</span>
            </div>
        </div>
    );
}
