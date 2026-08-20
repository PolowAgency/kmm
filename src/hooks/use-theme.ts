/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useEffect, useState } from 'react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const scheme = useColorScheme();
  const theme = scheme === 'unspecified' ? 'light' : scheme;
  const [palette, setPalette] = useState('');

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const sync = () => setPalette(root.dataset.palette ?? '');
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['data-palette'] });
    return () => observer.disconnect();
  }, []);

  if (palette === 'cb') {
    return {
      ...Colors[theme],
      sideBid: '#3c87f7',
      sideAsk: '#f28c28',
    };
  }

  return Colors[theme];
}
