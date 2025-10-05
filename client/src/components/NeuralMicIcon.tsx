import neuralMicImage from "@assets/Clasio Mic_1759625010545.png";

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
          transition: all 0.3s ease;
          cursor: pointer;
        }
        
        .neural-mic-image {
          width: 100%;
          height: 100%;
          object-fit: contain;
          transition: all 0.4s ease;
        }
        
        /* Active state with enhanced multi-layered glow */
        .neural-mic-container.active .neural-mic-image {
          animation: neuralGlow 2s ease-in-out infinite;
        }
        
        @keyframes neuralGlow {
          0%, 100% { 
            transform: scale(1);
            filter: 
              drop-shadow(0 0 8px rgba(168, 85, 247, 0.4))
              drop-shadow(0 0 16px rgba(168, 85, 247, 0.3))
              drop-shadow(0 0 24px rgba(99, 102, 241, 0.2));
          }
          50% { 
            transform: scale(1.05);
            filter: 
              drop-shadow(0 0 12px rgba(168, 85, 247, 0.8))
              drop-shadow(0 0 24px rgba(168, 85, 247, 0.6))
              drop-shadow(0 0 40px rgba(99, 102, 241, 0.4))
              drop-shadow(0 0 60px rgba(99, 102, 241, 0.3));
          }
        }
        
        /* Hover effect - subtle glow preview */
        .neural-mic-container:hover .neural-mic-image {
          transform: scale(1.02);
          filter: 
            drop-shadow(0 0 6px rgba(168, 85, 247, 0.3))
            drop-shadow(0 0 12px rgba(168, 85, 247, 0.2));
        }
      `}</style>
    </div>
  );
}
