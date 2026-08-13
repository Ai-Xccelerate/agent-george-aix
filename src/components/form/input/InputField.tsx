import React, { FC } from "react";

interface InputProps {
  type?: "text" | "number" | "email" | "password" | "date" | "time" | string;
  id?: string;
  name?: string;
  placeholder?: string;
  defaultValue?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  min?: string;
  max?: string;
  step?: number;
  disabled?: boolean;
  success?: boolean;
  error?: boolean;
  hint?: string; // Optional hint text
}

const Input: FC<InputProps> = ({
  type = "text",
  id,
  name,
  placeholder,
  defaultValue,
  onChange,
  className = "",
  min,
  max,
  step,
  disabled = false,
  success = false,
  error = false,
  hint,
}) => {
  // Base styles shared across every state
  let inputClasses = `h-11 w-full appearance-none rounded-lg border px-4 py-2.5 text-sm shadow-theme-xs transition-colors duration-150 ease-out placeholder:text-gray-500 focus:outline-hidden dark:placeholder:text-gray-400 ${className}`;

  // Add styles for the different states
  if (disabled) {
    inputClasses += ` cursor-not-allowed border-gray-300 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400`;
  } else if (error) {
    inputClasses += ` border-error-500 bg-transparent text-gray-800 focus:border-error-500 focus:ring-2 focus:ring-error-500/20 dark:border-error-500 dark:bg-gray-900 dark:text-white/90`;
  } else if (success) {
    inputClasses += ` border-success-500 bg-transparent text-gray-800 focus:border-success-500 focus:ring-2 focus:ring-success-500/20 dark:border-success-500 dark:bg-gray-900 dark:text-white/90`;
  } else {
    inputClasses += ` border-gray-300 bg-transparent text-gray-800 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90`;
  }

  return (
    <div className="relative">
      <input
        type={type}
        id={id}
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={inputClasses}
      />

      {/* Optional Hint Text */}
      {hint && (
        <p
          className={`mt-1.5 text-xs ${
            error
              ? "text-error-500 dark:text-error-400"
              : success
              ? "text-success-600 dark:text-success-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
};

export default Input;
