interface NeuralMicIconProps {
  className?: string;
  active?: boolean;
  onClick?: () => void;
}

export function NeuralMicIcon({ className = "", active = false, onClick }: NeuralMicIconProps) {
  return (
    <div 
      className={`neural-mic-container ${active ? 'active' : ''} ${className}`}
      onClick={onClick}
    >
      <svg viewBox="0 0 400 600" xmlns="http://www.w3.org/2000/svg" className="neural-mic-svg">
        <defs>
          {/* Gradient for mic body - purple to indigo */}
          <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d946ef" />
            <stop offset="50%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
          
          {/* Gradient for darker parts */}
          <linearGradient id="darkGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#4c1d95" />
          </linearGradient>

          {/* Metallic shine gradient */}
          <linearGradient id="shineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.3" />
          </linearGradient>

          {/* Soft glow filter for dots */}
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>

          {/* Strong glow filter for active state */}
          <filter id="strongGlow" x="-70%" y="-70%" width="240%" height="240%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="b1"/>
            <feGaussianBlur in="SourceGraphic" stdDeviation="18" result="b2"/>
            <feMerge>
              <feMergeNode in="b2"/>
              <feMergeNode in="b1"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Base stand */}
        <ellipse cx="200" cy="560" rx="80" ry="15" fill="url(#darkGradient)" opacity="0.9"/>
        
        {/* Stand pole */}
        <rect x="190" y="480" width="20" height="80" rx="5" fill="url(#bodyGradient)"/>
        <ellipse cx="200" cy="480" rx="15" ry="8" fill="url(#shineGradient)"/>
        
        {/* Mounting ring */}
        <ellipse cx="200" cy="450" rx="30" ry="12" fill="none" stroke="url(#bodyGradient)" strokeWidth="12"/>
        <path d="M 170 450 Q 170 350, 180 280" fill="none" stroke="url(#bodyGradient)" strokeWidth="14" strokeLinecap="round"/>
        <path d="M 230 450 Q 230 350, 220 280" fill="none" stroke="url(#bodyGradient)" strokeWidth="14" strokeLinecap="round"/>
        
        {/* Side supports */}
        <rect x="140" y="270" width="16" height="30" rx="8" fill="url(#bodyGradient)"/>
        <rect x="244" y="270" width="16" height="30" rx="8" fill="url(#bodyGradient)"/>
        
        {/* Main microphone body - upper rounded part */}
        <path d="M 200 80 
                 C 120 80, 100 120, 100 180
                 L 100 250
                 Q 100 280, 130 285
                 L 270 285
                 Q 300 280, 300 250
                 L 300 180
                 C 300 120, 280 80, 200 80 Z" 
              fill="url(#bodyGradient)" />
        
        {/* Mic body shine */}
        <path d="M 140 100 
                 C 140 90, 160 85, 180 85
                 C 200 85, 220 90, 220 100
                 L 220 240
                 Q 140 235, 140 240 Z" 
              fill="url(#shineGradient)" opacity="0.3"/>
        
        {/* Lower mic body */}
        <rect x="130" y="285" width="140" height="80" rx="15" fill="url(#darkGradient)"/>
        <ellipse cx="200" cy="285" rx="70" ry="10" fill="url(#shineGradient)" opacity="0.2"/>
        
        {/* Grille area background */}
        <rect x="110" y="100" width="180" height="170" rx="90" fill="#3b0764" opacity="0.8"/>
        
        {/* Neural network connection lines */}
        <g opacity="0.4" stroke="#a855f7" strokeWidth="1.5" fill="none">
          <line x1="170" y1="130" x2="200" y2="160"/>
          <line x1="200" y1="160" x2="230" y2="130"/>
          <line x1="200" y1="160" x2="200" y2="200"/>
          <line x1="170" y1="180" x2="200" y2="200"/>
          <line x1="230" y1="180" x2="200" y2="200"/>
          <line x1="150" y1="200" x2="170" y2="180"/>
          <line x1="250" y1="200" x2="230" y2="180"/>
          <line x1="170" y1="220" x2="200" y2="200"/>
          <line x1="230" y1="220" x2="200" y2="200"/>
          <line x1="200" y1="240" x2="200" y2="200"/>
          <line x1="180" y1="240" x2="200" y2="240"/>
          <line x1="220" y1="240" x2="200" y2="240"/>
        </g>
        
        {/* Neural network dots with glow effect */}
        <g className="neural-dots">
          {/* Top nodes */}
          <circle className="glow pink" cx="170" cy="130" r="14"/>
          <circle className="dot pink" cx="170" cy="130" r="6"/>
          
          <circle className="glow violet" cx="230" cy="130" r="14"/>
          <circle className="dot violet" cx="230" cy="130" r="6"/>
          
          {/* Center hub */}
          <circle className="glow white" cx="200" cy="160" r="16"/>
          <circle className="dot white" cx="200" cy="160" r="7"/>
          
          {/* Mid layer */}
          <circle className="glow blue" cx="150" cy="200" r="14"/>
          <circle className="dot blue" cx="150" cy="200" r="6"/>
          
          <circle className="glow pink" cx="170" cy="180" r="14"/>
          <circle className="dot pink" cx="170" cy="180" r="6"/>
          
          <circle className="glow violet" cx="230" cy="180" r="14"/>
          <circle className="dot violet" cx="230" cy="180" r="6"/>
          
          <circle className="glow blue" cx="250" cy="200" r="14"/>
          <circle className="dot blue" cx="250" cy="200" r="6"/>
          
          {/* Lower hub */}
          <circle className="glow white" cx="200" cy="200" r="16"/>
          <circle className="dot white" cx="200" cy="200" r="7"/>
          
          {/* Bottom nodes */}
          <circle className="glow pink" cx="170" cy="220" r="14"/>
          <circle className="dot pink" cx="170" cy="220" r="6"/>
          
          <circle className="glow violet" cx="230" cy="220" r="14"/>
          <circle className="dot violet" cx="230" cy="220" r="6"/>
          
          <circle className="glow blue" cx="180" cy="240" r="14"/>
          <circle className="dot blue" cx="180" cy="240" r="6"/>
          
          <circle className="glow pink" cx="200" cy="240" r="14"/>
          <circle className="dot pink" cx="200" cy="240" r="6"/>
          
          <circle className="glow violet" cx="220" cy="240" r="14"/>
          <circle className="dot violet" cx="220" cy="240" r="6"/>
        </g>
      </svg>

      <style>{`
        .neural-mic-container {
          display: inline-block;
          transition: all 0.3s ease;
          cursor: pointer;
        }
        
        .neural-mic-svg {
          width: 100%;
          height: 100%;
        }
        
        /* Dot styles */
        .dot {
          paint-order: stroke fill;
          stroke: rgba(255,255,255,0.35);
          stroke-width: 2;
        }
        
        .glow {
          filter: url(#softGlow);
          opacity: 0.55;
        }
        
        /* Color classes */
        .pink { fill: #ff6aa9; }
        .violet { fill: #a66cff; }
        .blue { fill: #7cc7ff; }
        .white { fill: #ffffff; }
        
        /* Pulse animation for active state */}
        @keyframes pulse {
          0%, 100% { 
            opacity: 0.45; 
            transform: scale(1); 
          }
          50% { 
            opacity: 0.85; 
            transform: scale(1.25); 
          }
        }
        
        /* Apply pulse to glows when active */
        .neural-mic-container.active .glow {
          transform-box: fill-box;
          transform-origin: center;
          animation: pulse 2.2s ease-in-out infinite;
        }
        
        /* Stronger glow on active */
        .neural-mic-container.active .glow {
          filter: url(#strongGlow);
          opacity: 0.75;
        }
        
        /* Hover effect */
        .neural-mic-container:hover .neural-mic-svg {
          transform: scale(1.02);
        }
        
        .neural-mic-container:hover .glow {
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}
