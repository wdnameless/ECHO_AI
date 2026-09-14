import React from "react";
import { GripVerticalIcon } from "lucide-react";
import { Button } from "@/components";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const DragButton: React.FC = () => {
  const handleMouseDown = async (e: React.MouseEvent) => {
    // Only trigger on primary (left) mouse button
    if (e.button !== 0) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.debug("Failed to start dragging:", err);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="-ml-[2px] w-fit cursor-grab active:cursor-grabbing select-none"
      data-tauri-drag-region="true"
      onMouseDown={handleMouseDown}
      title="Drag window"
    >
      <GripVerticalIcon className="h-4 w-4" />
    </Button>
  );
};
