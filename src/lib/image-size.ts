import { Spread } from './types';

// Bildupplösning efter hur stor bilden blir i den tryckta boken.
// Utklippta figurer och runda vinjetter trycks 6-9 cm breda: 1K (1024 px)
// ger där 290-330 dpi, vilket räcker för tryck. Helsidor, uppslag, band och
// serierutor fyller sidan och behöver 2K. 1K kostar ungefär en tredjedel mindre.
export function imageSizeFor(spread: Pick<Spread, 'composition' | 'pages'>): '1K' | '2K' {
  if (spread.pages === 'omslag') return '2K';
  return spread.composition === 'spot' || spread.composition === 'round' ? '1K' : '2K';
}
