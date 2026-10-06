// Subset of Claw3D's core/types.ts and objects/types.ts (MIT, see ./LICENSE),
// plus the RackIQ crew fields read by AgentModel.
import type { RefObject } from "react";
import type { AgentAvatarProfile } from "./avatarProfile";

export type OfficeAgent = {
  id: string;
  name: string;
  subtitle?: string | null;
  status: "working" | "idle" | "error";
  color: string;
  item: string;
  avatarProfile?: AgentAvatarProfile | null;
};

export type JanitorActor = {
  id: string;
  name: string;
  role: "janitor";
  status: "working";
  color: string;
  item: "cleaning";
  janitorTool: "broom" | "vacuum" | "floor_scrubber";
};

export type RenderAgent = (OfficeAgent | JanitorActor) & {
  x: number;
  y: number;
  facing: number;
  frame: number;
  phaseOffset: number;
  state: "walking" | "sitting" | "standing" | "away" | "working_out" | "dancing";
  workoutStyle?: "run" | "lift" | "bike" | "box" | "row" | "stretch";
  pingPongUntil?: number;
  pingPongSide?: 0 | 1;
  bumpTalkUntil?: number;
  // RackIQ crew fields
  device?: string;
  deviceKind?: "tablet" | "phone" | "badge";
  carrying?: string | null;
  task?: string;
};

export type AgentModelProps = {
  agentId: string;
  name: string;
  subtitle?: string | null;
  status: OfficeAgent["status"];
  color: string;
  appearance?: AgentAvatarProfile | null;
  agentsRef: RefObject<RenderAgent[]>;
  agentLookupRef?: RefObject<Map<string, RenderAgent>>;
  onHover?: (id: string) => void;
  onUnhover?: () => void;
  onClick?: (id: string) => void;
  onContextMenu?: (id: string, x: number, y: number) => void;
  showSpeech?: boolean;
  speechText?: string | null;
  suppressSpeechBubble?: boolean;
};
