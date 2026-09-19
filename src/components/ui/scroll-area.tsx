import * as React from "react";
import { cn } from "@/lib/utils";

export interface ScrollAreaProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
}

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="scroll-area"
        className={cn(
          "relative flex-1 w-full min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:hsl(var(--muted-foreground)/0.3)_transparent]",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ScrollArea.displayName = "ScrollArea";

function ScrollBar() {
  return null;
}

export { ScrollArea, ScrollBar };
