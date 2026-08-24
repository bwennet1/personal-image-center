"use client";

import { createContext, useContext } from "react";

export type SpaceState = {
  spaceId: string;
  role: string;
  ready: boolean;
  refresh: () => Promise<void>;
};

export const SpaceContext = createContext<SpaceState>({
  spaceId: "",
  role: "",
  ready: false,
  refresh: async () => undefined,
});

export function useSpace(): SpaceState {
  return useContext(SpaceContext);
}
