"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

type StudyTheme = "light" | "dark";

type StudyThemeContextValue = {
  theme: StudyTheme;
  setTheme: (theme: StudyTheme) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = "examora-study-theme";

const StudyThemeContext = createContext<StudyThemeContextValue | undefined>(
  undefined,
);

export function StudyThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<StudyTheme>(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    const savedTheme = window.localStorage.getItem(STORAGE_KEY);

    if (savedTheme === "light" || savedTheme === "dark") {
      return savedTheme;
    }

    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return systemPrefersDark ? "dark" : "light";
  });

  function setTheme(themeValue: StudyTheme) {
    setThemeState(themeValue);
    window.localStorage.setItem(STORAGE_KEY, themeValue);
  }

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <StudyThemeContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </StudyThemeContext.Provider>
  );
}

export function useStudyTheme() {
  const context = useContext(StudyThemeContext);

  if (!context) {
    throw new Error("useStudyTheme must be used within a StudyThemeProvider.");
  }

  return context;
}
