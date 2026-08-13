"use client";
import React, { useEffect, useId, useRef, useState } from "react";

interface Option {
  value: string;
  text: string;
  selected: boolean;
}

interface MultiSelectProps {
  label: string;
  options: Option[];
  defaultSelected?: string[];
  onChange?: (selected: string[]) => void;
  disabled?: boolean;
}

const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  options,
  defaultSelected = [],
  onChange,
  disabled = false,
}) => {
  const [selectedOptions, setSelectedOptions] =
    useState<string[]>(defaultSelected);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);

  const baseId = useId();
  const listId = `${baseId}-listbox`;
  const labelId = `${baseId}-label`;
  const optionId = (i: number) => `${baseId}-option-${i}`;

  const close = () => setIsOpen(false);
  const toggleDropdown = () => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  };

  const handleSelect = (optionValue: string) => {
    const next = selectedOptions.includes(optionValue)
      ? selectedOptions.filter((value) => value !== optionValue)
      : [...selectedOptions, optionValue];
    setSelectedOptions(next);
    onChange?.(next);
  };

  const removeOption = (value: string) => {
    const next = selectedOptions.filter((opt) => opt !== value);
    setSelectedOptions(next);
    onChange?.(next);
  };

  // Close on outside click.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen]);

  // Full keyboard support: open/navigate/select/close via the combobox control.
  const onControlKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
        setActiveIndex((i) => (i < 0 ? 0 : i));
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      controlRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < options.length) {
        handleSelect(options[activeIndex].value);
      }
    }
  };

  return (
    <div className="w-full" ref={containerRef}>
      <label
        id={labelId}
        className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
      >
        {label}
      </label>

      <div className="relative z-20 inline-block w-full">
        <div className="relative flex flex-col items-center">
          <div
            ref={controlRef}
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={listId}
            aria-labelledby={labelId}
            aria-disabled={disabled}
            aria-activedescendant={
              isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
            tabIndex={disabled ? -1 : 0}
            onClick={toggleDropdown}
            onKeyDown={onControlKeyDown}
            className={`w-full rounded-lg outline-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
              disabled ? "cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <div className="mb-2 flex h-11 rounded-lg border border-gray-300 bg-transparent py-1.5 pl-3 pr-3 shadow-theme-xs transition-colors duration-150 ease-out hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600">
              <div className="flex flex-auto flex-wrap gap-2">
                {selectedOptions.length > 0 ? (
                  selectedOptions.map((value) => {
                    const text =
                      options.find((o) => o.value === value)?.text || "";
                    return (
                      <div
                        key={value}
                        className="group flex items-center justify-center rounded-lg border border-transparent bg-gray-100 py-1 pl-2.5 pr-2 text-sm text-gray-800 transition-colors duration-150 ease-out hover:border-gray-300 dark:bg-gray-800 dark:text-white/90 dark:hover:border-gray-700"
                      >
                        <span className="max-w-full flex-initial">{text}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${text}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeOption(value);
                          }}
                          className="ml-1 flex items-center rounded text-gray-500 transition-colors duration-150 ease-out hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                          <svg
                            className="fill-current"
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              fillRule="evenodd"
                              clipRule="evenodd"
                              d="M3.40717 4.46881C3.11428 4.17591 3.11428 3.70104 3.40717 3.40815C3.70006 3.11525 4.17494 3.11525 4.46783 3.40815L6.99943 5.93975L9.53095 3.40822C9.82385 3.11533 10.2987 3.11533 10.5916 3.40822C10.8845 3.70112 10.8845 4.17599 10.5916 4.46888L8.06009 7.00041L10.5916 9.53193C10.8845 9.82482 10.8845 10.2997 10.5916 10.5926C10.2987 10.8855 9.82385 10.8855 9.53095 10.5926L6.99943 8.06107L4.46783 10.5927C4.17494 10.8856 3.70006 10.8856 3.40717 10.5927C3.11428 10.2998 3.11428 9.8249 3.40717 9.53201L5.93877 7.00041L3.40717 4.46881Z"
                            />
                          </svg>
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <span className="flex items-center p-1 text-sm text-gray-500 dark:text-gray-400">
                    Select option
                  </span>
                )}
              </div>
              <div className="flex w-7 items-center py-1 pl-1 pr-1">
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 items-center justify-center text-gray-500 dark:text-gray-400"
                >
                  <svg
                    className={`stroke-current transition-transform duration-150 ease-out ${
                      isOpen ? "rotate-180" : ""
                    }`}
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M4.79175 7.39551L10.0001 12.6038L15.2084 7.39551"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </div>
          </div>

          {isOpen && (
            <div
              id={listId}
              role="listbox"
              aria-multiselectable="true"
              aria-labelledby={labelId}
              className="glass-popover absolute left-0 top-full z-40 max-h-select w-full overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800"
            >
              <div className="flex flex-col">
                {options.map((option, index) => {
                  const isSelected = selectedOptions.includes(option.value);
                  return (
                    <div
                      key={option.value}
                      id={optionId(index)}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => handleSelect(option.value)}
                      className={`w-full cursor-pointer border-b border-gray-100 transition-colors duration-150 ease-out dark:border-white/[0.06] ${
                        activeIndex === index
                          ? "bg-gray-100 dark:bg-white/[0.06]"
                          : ""
                      }`}
                    >
                      <div
                        className={`relative flex w-full items-center p-2 pl-2 ${
                          isSelected ? "bg-brand-50 dark:bg-brand-500/10" : ""
                        }`}
                      >
                        <div className="mx-2 leading-6 text-gray-800 dark:text-white/90">
                          {option.text}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MultiSelect;
