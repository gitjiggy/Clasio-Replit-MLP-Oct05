import neuralMicImage from "@assets/ClasioMic_transparent_1759626739147.png";

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
      <img 
        src={neuralMicImage} 
        alt="Neural Network Microphone - AI Voice Search"
        className="neural-mic-image"
      />
      <style>{`
        .neural-mic-container {
          display: inline-block;
          transition: transform 0.3s ease;
          cursor: pointer;
          position: relative;
        }
        
        /* Glow layer behind the image */
        .neural-mic-container::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 100%;
          height: 100%;
          background: radial-gradient(circle, rgba(168, 85, 247, 0.6) 0%, rgba(99, 102, 241, 0.4) 40%, transparent 70%);
          filter: blur(20px);
          opacity: 0;
          transition: opacity 0.3s ease;
          z-index: -1;
          pointer-events: none;
        }
        
        .neural-mic-image {
          width: 100%;
          height: 100%;
          object-fit: contain;
          position: relative;
          z-index: 1;
          transition: transform 0.4s ease;
        }
        
        /* Active state - animate glow layer */
        .neural-mic-container.active::before {
          animation: glowPulse 2s ease-in-out infinite;
        }
        
        .neural-mic-container.active .neural-mic-image {
          animation: scalePulse 2s ease-in-out infinite;
        }
        
        @keyframes glowPulse {
          0%, 100% { 
            opacity: 0.3;
            transform: translate(-50%, -50%) scale(1);
          }
          50% { 
            opacity: 0.8;
            transform: translate(-50%, -50%) scale(1.2);
          }
        }
        
        @keyframes scalePulse {
          0%, 100% { 
            transform: scale(1);
          }
          50% { 
            transform: scale(1.05);
          }
        }
        
        /* Hover effect - subtle glow preview */
        .neural-mic-container:hover::before {
          opacity: 0.2;
        }
        
        .neural-mic-container:hover .neural-mic-image {
          transform: scale(1.02);
        }
      `}</style>
    </div>
  );
}
