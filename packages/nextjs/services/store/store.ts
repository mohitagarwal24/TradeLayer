import { create } from "zustand";
import { useEffect, useState } from "react";
import { ChainWithAttributes } from "~~/utils/scaffold-eth";
import { getTargetNetwork } from "~~/utils/scaffold-eth";

/**
 * Global state store
 */
type GlobalState = {
  nativeCurrencyPrice: number;
  usdcPrice: number;
  targetNetwork: ChainWithAttributes;
  setNativeCurrencyPrice: (newNativeCurrencyPrice: number) => void;
  setUsdcPrice: (newUsdcPrice: number) => void;
  setTargetNetwork: (newTargetNetwork: ChainWithAttributes) => void;
};

export const useGlobalState = create<GlobalState>(set => ({
  nativeCurrencyPrice: 0,
  usdcPrice: 0,
  targetNetwork: getTargetNetwork(),
  setNativeCurrencyPrice: newValue => set(() => ({ nativeCurrencyPrice: newValue })),
  setUsdcPrice: newValue => set(() => ({ usdcPrice: newValue })),
  setTargetNetwork: newValue => set(() => ({ targetNetwork: newValue })),
}));

export const useAnimationConfig = () => {
  const [showAnimation, setShowAnimation] = useState(false);

  useEffect(() => {
    if (showAnimation) {
      setTimeout(() => {
        setShowAnimation(false);
      }, 800);
    }
  }, [showAnimation]);

  return { showAnimation };
};
