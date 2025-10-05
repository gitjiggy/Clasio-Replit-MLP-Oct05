interface NeuralMicIconProps {
  className?: string;
  active?: boolean;
  onClick?: () => void;
}

export function NeuralMicIcon({ className = "", active = false, onClick }: NeuralMicIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="200"
      height="200"
      viewBox="0 0 512 512"
      role="img"
      aria-labelledby="title desc"
      className={`neural-mic-3d ${active ? 'active' : ''} ${className}`}
      onClick={onClick}
    >
      <title id="title">Neural Microphone Icon (3D)</title>
      <desc id="desc">A realistic 3D microphone whose grille is a brain-like neural network. Nodes glow in a purple-to-indigo gradient (#a855f7 → #6366f1).</desc>

      <defs>
        <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a855f7"/>
          <stop offset="100%" stopColor="#6366f1"/>
        </linearGradient>

        <linearGradient id="metalV" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#b19cff"/>
          <stop offset="35%" stopColor="#8d7bea"/>
          <stop offset="55%" stopColor="#7868e0"/>
          <stop offset="100%" stopColor="#5b4dc6"/>
        </linearGradient>

        <radialGradient id="glass" cx="50%" cy="35%" r="70%">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.12"/>
          <stop offset="100%" stopColor="#000000" stopOpacity="0.22"/>
        </radialGradient>

        <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.8"/>
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.15"/>
        </linearGradient>

        <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="12" stdDeviation="16" floodColor="#000000" floodOpacity="0.25"/>
        </filter>

        <filter id="nodeGlow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur1"/>
          <feFlood floodColor="#a855f7" floodOpacity="0.95" result="c1"/>
          <feComposite in="c1" in2="blur1" operator="in" result="g1"/>
          <feGaussianBlur in="g1" stdDeviation="3" result="g1b"/>

          <feFlood floodColor="#6366f1" floodOpacity="0.85" result="c2"/>
          <feComposite in="c2" in2="blur1" operator="in" result="g2"/>
          <feGaussianBlur in="g2" stdDeviation="5" result="g2b"/>

          <feMerge>
            <feMergeNode in="g2b"/>
            <feMergeNode in="g1b"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50%      { transform: scale(1.12); opacity: 1; }
        }
        .active .node {
          animation: pulse 2.2s ease-in-out infinite;
        }
      `}</style>

      <g filter="url(#softShadow)" transform="translate(0,6)">
        <ellipse cx="256" cy="446" rx="120" ry="20" fill="#e9e6ff"/>
        <rect x="172" y="416" width="168" height="18" rx="9" fill="url(#brand)"/>
        <rect x="244" y="370" width="24" height="56" rx="12" fill="url(#brand)"/>
        <path d="M152 214a14 14 0 0 1 14-14h180a14 14 0 0 1 14 14v22a14 14 0 0 1-14 14H166a14 14 0 0 1-14-14z" fill="url(#brand)"/>
        <path d="M168 312a88 88 0 0 0 176 0v-12H168z" fill="url(#metalV)"/>
        
        <g>
          <rect x="132" y="86" width="248" height="212" rx="124" fill="url(#metalV)"/>
          <rect x="140" y="94" width="232" height="196" rx="112" fill="none" stroke="url(#rim)" strokeWidth="2"/>
          <rect x="156" y="110" width="200" height="168" rx="100" fill="#1b1537"/>
          <rect x="156" y="110" width="200" height="168" rx="100" fill="url(#glass)"/>
          <rect x="156" y="110" width="200" height="168" rx="100" fill="none" stroke="#000" strokeOpacity="0.25" strokeWidth="1"/>
        </g>

        <g transform="translate(0,0)">
          <g stroke="#ece9ff" strokeOpacity="0.95" strokeWidth="2">
            <path d="M256 132
                     C230 138,210 152,200 174
                     C196 186,196 206,204 218
                     C214 234,234 244,256 248
                     C278 244,298 234,308 218
                     C316 206,316 186,312 174
                     C302 152,282 138,256 132" fill="none"/>
            <path d="M224 162 L 288 162" />
            <path d="M214 190 L 298 190" />
            <path d="M220 216 L 292 216" />
            <path d="M238 148 L 274 148" />
            <path d="M232 234 L 280 234" />
            <path d="M256 140 L 256 242" />
            <path d="M204 168 C196 178,194 198,204 210" />
            <path d="M308 168 C316 178,318 198,308 210" />
          </g>

          <g fill="#ffffff" filter="url(#nodeGlow)">
            <circle className="node" cx="256" cy="140" r="6"/>
            <circle className="node" cx="256" cy="162" r="5"/>
            <circle className="node" cx="256" cy="190" r="5"/>
            <circle className="node" cx="256" cy="216" r="5"/>
            <circle className="node" cx="256" cy="242" r="5"/>

            <circle className="node" cx="224" cy="162" r="5"/>
            <circle className="node" cx="288" cy="162" r="5"/>
            <circle className="node" cx="214" cy="190" r="5"/>
            <circle className="node" cx="298" cy="190" r="5"/>
            <circle className="node" cx="220" cy="216" r="5"/>
            <circle className="node" cx="292" cy="216" r="5"/>
            <circle className="node" cx="238" cy="148" r="4.6"/>
            <circle className="node" cx="274" cy="148" r="4.6"/>
            <circle className="node" cx="232" cy="234" r="4.6"/>
            <circle className="node" cx="280" cy="234" r="4.6"/>
            <circle className="node" cx="204" cy="168" r="4.6"/>
            <circle className="node" cx="308" cy="168" r="4.6"/>
            <circle className="node" cx="204" cy="210" r="4.6"/>
            <circle className="node" cx="308" cy="210" r="4.6"/>
          </g>

          <rect x="156" y="110" width="200" height="168" rx="100" fill="url(#brand)" opacity="0.22"/>
        </g>
      </g>
    </svg>
  );
}
