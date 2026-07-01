"use client";

import { useEffect, useRef, useState } from "react";

const MIN = 320;
const MAX = 760;
const DEFAULT = 400;
const STORAGE_KEY = "actions-chat-width";

/**
 * The resizable shell for the George chat column on the AI actions page. A drag
 * handle on its left edge widens/shrinks it (persisted to localStorage). The
 * fixed width only applies at `xl`; below that the column stacks full-width.
 */
export function ResizableChat({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(DEFAULT);
  const widthRef = useRef(DEFAULT);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved >= MIN && saved <= MAX) {
      setWidth(saved);
      widthRef.current = saved;
    }
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      // Chat sits on the right, so dragging the handle left (smaller clientX)
      // widens it.
      const next = Math.min(MAX, Math.max(MIN, startW.current + (startX.current - e.clientX)));
      widthRef.current = next;
      setWidth(next);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem(STORAGE_KEY, String(widthRef.current));
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = widthRef.current;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  return (
    <div
      style={{ ["--chat-w" as string]: `${width}px` }}
      className="relative flex h-[560px] min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] xl:sticky xl:top-5 xl:h-[calc(100vh-200px)] xl:w-[var(--chat-w)]"
    >
      {/* Drag handle — desktop only */}
      <div
        onMouseDown={startDrag}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        className="group absolute left-0 top-0 z-20 hidden h-full w-2 cursor-col-resize xl:block"
      >
        <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-[var(--color-accent)]" />
      </div>
      {children}
    </div>
  );
}
