import React from "react";
import Image, { type StaticImageData } from "next/image";
import nickImg from "@/agents/agent-nick.png";
import julesImg from "@/agents/agent-jules.png";
import pepperImg from "@/agents/agent-pepper.png";
import tonyImg from "@/agents/agent-tony.png";
import joyImg from "@/agents/agent-joy.png";
import georgeImg from "@/agents/agent-george.png";

export type AgentName =
  | "Nick"
  | "Jules"
  | "Pepper"
  | "Tony"
  | "Joy"
  | "George";

// Canonical agent identity colors from the AIX Core Design System
// (--color-agent-* tokens in globals.css). Do not improvise new hues.
export const AGENT_META: Record<
  AgentName,
  { role: string; color: string; hex: string }
> = {
  Nick: { role: "Demand gen", color: "bg-agent-nick", hex: "#F47920" },
  Jules: { role: "Outbound", color: "bg-agent-jules", hex: "#3B82F6" },
  Pepper: { role: "Inbound", color: "bg-agent-pepper", hex: "#10B981" },
  Tony: { role: "Technical", color: "bg-agent-tony", hex: "#7A5AF8" },
  Joy: { role: "Deal ops", color: "bg-agent-joy", hex: "#F79009" },
  George: { role: "Retention", color: "bg-agent-george", hex: "#344054" },
};

// Portrait avatars — bundled + optimized from src/agents/.
const AGENT_IMAGES: Record<AgentName, StaticImageData> = {
  Nick: nickImg,
  Jules: julesImg,
  Pepper: pepperImg,
  Tony: tonyImg,
  Joy: joyImg,
  George: georgeImg,
};

interface AgentAvatarProps {
  name: AgentName;
  size?: "sm" | "md" | "lg";
  showStatus?: boolean;
  status?: "active" | "training" | "paused";
}

const sizeClasses = {
  sm: "size-8",
  md: "size-10",
  lg: "size-14",
};

const sizePx = { sm: 32, md: 40, lg: 56 };

const statusColor = {
  active: "bg-success-500",
  training: "bg-warning-500",
  paused: "bg-gray-400",
};

export default function AgentAvatar({
  name,
  size = "md",
  showStatus = false,
  status = "active",
}: AgentAvatarProps) {
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={`relative block overflow-hidden rounded-full ring-1 ring-black/5 dark:ring-white/10 ${sizeClasses[size]}`}
      >
        <Image
          src={AGENT_IMAGES[name]}
          alt={name}
          fill
          sizes={`${sizePx[size]}px`}
          className="object-cover"
        />
      </span>
      {showStatus && (
        <span
          className={`absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white dark:border-gray-900 ${statusColor[status]}`}
        />
      )}
    </span>
  );
}
