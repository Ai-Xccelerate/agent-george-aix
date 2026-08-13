"use client";

import React, { useEffect, useRef, useState } from "react";

type Placement = "top" | "bottom" | "left" | "right";

interface PopoverProps {
  trigger: React.ReactNode;
  content: React.ReactNode;
  placement?: Placement;
}

const placementClasses: Record<Placement, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

const Popover: React.FC<PopoverProps> = ({
  trigger,
  content,
  placement = "bottom",
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`absolute z-50 w-64 rounded-2xl border border-gray-200 p-4 glass-popover dark:border-gray-800 ${placementClasses[placement]}`}
        >
          {content}
        </div>
      )}
    </div>
  );
};

export default Popover;
