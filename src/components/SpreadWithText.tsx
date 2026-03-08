'use client';

import { Spread } from '@/lib/types';

interface Props {
  spread: Spread;
  showText: boolean;
  className?: string;
}

export default function SpreadWithText({ spread, showText, className = '' }: Props) {
  if (!spread.generatedImage) {
    return (
      <div className={`bg-gray-100 flex items-center justify-center ${className}`}>
        <span className="text-gray-400">Ingen bild</span>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Background illustration */}
      <img
        src={`data:image/png;base64,${spread.generatedImage}`}
        alt={`Sida ${spread.pages}`}
        className="w-full h-full object-contain"
      />

      {/* Text overlay */}
      {showText && spread.textBlocks.length > 0 && (
        <div className="absolute inset-0 flex flex-col justify-end pointer-events-none">
          {spread.textBlocks.map((block, idx) => {
            // Determine position based on block.position
            const posStyle = getTextPosition(block.position, idx, spread.textBlocks.length);
            return (
              <div
                key={idx}
                className="absolute px-3 py-2"
                style={posStyle}
              >
                <div className="bg-white/85 backdrop-blur-sm rounded-lg px-4 py-3 shadow-lg
                                border border-white/50 max-w-md">
                  <p className="text-sm leading-relaxed text-gray-900 whitespace-pre-line font-serif">
                    {block.text}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getTextPosition(
  position: string,
  index: number,
  total: number
): React.CSSProperties {
  const pos = position.toLowerCase();

  // Check for specific position hints
  if (pos.includes('överst') || pos.includes('top') || pos.includes('uppe')) {
    return { top: '4%', left: '4%', right: '4%' };
  }
  if (pos.includes('mitt') || pos.includes('mitten') || pos.includes('center')) {
    return { top: '35%', left: '4%', right: '4%' };
  }
  if (pos.includes('nedre') || pos.includes('nere') || pos.includes('botten') || pos.includes('bottom')) {
    return { bottom: '4%', left: '4%', right: '4%' };
  }

  // Check for left/right page hints in spread
  const pageMatch = pos.match(/sida\s*(\d+)/);
  if (pageMatch) {
    const pageNum = parseInt(pageMatch[1]);
    const isLeftPage = pageNum % 2 === 0; // Even pages are left in a spread

    if (isLeftPage) {
      // Left side of spread
      if (total === 1) {
        return { bottom: '4%', left: '4%', right: '52%' };
      }
      return {
        top: index === 0 ? '4%' : 'auto',
        bottom: index > 0 ? '4%' : 'auto',
        left: '4%',
        right: '52%',
      };
    } else {
      // Right side of spread
      if (total === 1) {
        return { bottom: '4%', left: '52%', right: '4%' };
      }
      return {
        top: index === 0 ? '4%' : 'auto',
        bottom: index > 0 ? '4%' : 'auto',
        left: '52%',
        right: '4%',
      };
    }
  }

  // Default: stack text blocks at bottom
  if (total === 1) {
    return { bottom: '4%', left: '4%', right: '4%' };
  }
  if (index === 0) {
    return { bottom: `${4 + (total - 1) * 20}%`, left: '4%', right: '52%' };
  }
  return { bottom: '4%', left: '52%', right: '4%' };
}
