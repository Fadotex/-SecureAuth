import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  return useSyncExternalStore(
    (onChange) => {
      const subscription = Appearance.addChangeListener(() => onChange());
      return () => subscription.remove();
    },
    () => Appearance.getColorScheme(),
    () => 'light',
  );
}
