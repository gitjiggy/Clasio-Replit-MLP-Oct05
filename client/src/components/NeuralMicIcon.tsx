import neuralMicImage from "@assets/mic-3d-white-background_1759623007689.png";

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
          transition: all 0.3s ease;
        }
        
        .neural-mic-container.active .neural-mic-image {
          animation: neuralGlow 2s ease-in-out;
        }
        
        @keyframes neuralGlow {
          0%, 100% { 
            transform: scale(1); 
            filter: drop-shadow(0 0 0px rgba(168, 85, 247, 0));
          }
          50% { 
            transform: scale(1.05); 
            filter: drop-shadow(0 0 30px rgba(168, 85, 247, 0.6)) 
                    drop-shadow(0 0 60px rgba(99, 102, 241, 0.4));
          }
        }
        
        .neural-mic-container:hover .neural-mic-image {
          transform: scale(1.02);
          filter: drop-shadow(0 0 15px rgba(168, 85, 247, 0.3));
        }
      `}</style>
    </div>
  );
}
