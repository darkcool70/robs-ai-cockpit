// Open-source build: assistants and goals are part of Robs AI Cockpit Pro. This page explains
// what they are and where to get them. (The Pro edition replaces this file, see docs/PRO.md.)
import { Download, Sparkles, Target } from "lucide-react";
import { api } from "../lib/api";
import { AssistantAvatar, PRESETS } from "../components/Avatar";
import { Button, Card } from "../components/ui";

const MOODS = ["working", "thinking", "waiting", "done", "idle", "working", "thinking", "done"] as const;

export function AssistantsView() {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-[760px] space-y-5">
        <div className="flex flex-wrap justify-center gap-3">
          {PRESETS.map((p, i) => <AssistantAvatar key={p.id} avatar={`preset:${p.id}`} mood={MOODS[i]} size={64} />)}
        </div>
        <div className="text-center">
          <h1 className="flex items-center justify-center gap-2 text-[22px] font-semibold"><Sparkles size={20} className="text-accent" /> Assistants are part of Pro</h1>
          <p className="mx-auto mt-1 max-w-[560px] text-[13px] text-muted">
            Build your own AI team: assistants with a face, a personality (soul.md) and working agreements (agent.md) that pursue a goal on
            their own. After every step a small supervisor model checks the progress and writes the next instruction.
          </p>
        </div>
        <Card className="grid gap-3 p-4 text-[12.5px] sm:grid-cols-3">
          <p><Target size={14} className="mb-1 text-accent" /> Goals instead of fixed prompts, until the goal is verified</p>
          <p><Sparkles size={14} className="mb-1 text-accent" /> Animated characters or your own picture, in notifications too</p>
          <p><Download size={14} className="mb-1 text-accent" /> Chat room with live terminal and one-click permission answers</p>
        </Card>
        <div className="flex flex-col items-center gap-2">
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void api.openProjectPage("download")}><Download size={13} /> Get the official app: 7 days free</Button>
            <Button onClick={() => void api.openProjectPage("pro")}><Sparkles size={13} /> Learn more about Pro</Button>
          </div>
          <p className="max-w-[560px] text-center text-[11.5px] text-faint">
            This build is the free open-source edition, which does not include Pro. The official installer contains Pro with a 7-day
            trial, no account or card needed. Everything else in the cockpit stays free.
          </p>
        </div>
      </div>
    </div>
  );
}
