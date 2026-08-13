"use client";

import React, { useState } from "react";
import { AlertIcon, CheckCircleIcon, CloseIcon, ErrorIcon, InfoIcon } from "@/icons";

type NotificationVariant = "success" | "error" | "warning" | "info";

interface NotificationProps {
  variant: NotificationVariant;
  title: string;
  message: string;
  dismissible?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}

const variantStyles: Record<
  NotificationVariant,
  { container: string; icon: string; node: React.ReactNode }
> = {
  success: {
    container:
      "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15",
    icon: "text-success-500",
    node: <CheckCircleIcon className="h-5 w-5" />,
  },
  error: {
    container:
      "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
    icon: "text-error-500",
    node: <ErrorIcon className="h-5 w-5" />,
  },
  warning: {
    container:
      "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15",
    icon: "text-warning-500",
    node: <AlertIcon className="h-5 w-5" />,
  },
  info: {
    container:
      "border-blue-light-500 bg-blue-light-50 dark:border-blue-light-500/30 dark:bg-blue-light-500/15",
    icon: "text-blue-light-500",
    node: <InfoIcon className="h-5 w-5" />,
  },
};

const Notification: React.FC<NotificationProps> = ({
  variant,
  title,
  message,
  dismissible = false,
  actionLabel,
  onAction,
}) => {
  const [visible, setVisible] = useState(true);
  const styles = variantStyles[variant];

  if (!visible) return null;

  const isError = variant === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 ${styles.container}`}
    >
      <span className={`mt-0.5 shrink-0 ${styles.icon}`}>{styles.node}</span>
      <div className="flex-1">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h4>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{message}</p>
        {actionLabel && (
          <button
            onClick={onAction}
            className="mt-3 rounded-lg text-sm font-medium text-brand-500 transition-colors duration-150 ease-out hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
          >
            {actionLabel}
          </button>
        )}
      </div>
      {dismissible && (
        <button
          onClick={() => setVisible(false)}
          aria-label="Dismiss notification"
          className="shrink-0 rounded-lg text-gray-500 transition-colors duration-150 ease-out hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:text-gray-400 dark:hover:text-gray-200 dark:focus-visible:ring-offset-gray-900"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  );
};

export default Notification;
