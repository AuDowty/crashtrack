import { useEffect } from "react";

const BASE = "crashtrack";

export function useDocumentTitle(suffix?: string): void {
  useEffect(() => {
    const prev = document.title;
    document.title = suffix ? `${BASE} · ${suffix}` : BASE;
    return () => {
      document.title = prev;
    };
  }, [suffix]);
}
