"use client";

import { create } from "zustand";

type AppState = {
  provider: string;
  theme: "light" | "dark";
  searchQuery: string;
  setProvider: (provider: string) => void;
  setTheme: (theme: "light" | "dark") => void;
  setSearchQuery: (searchQuery: string) => void;
};

export const useAppStore = create<AppState>((set) => ({
  provider: "",
  theme: "light",
  searchQuery: "",
  setProvider: (provider) => set({ provider }),
  setTheme: (theme) => set({ theme }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}));
