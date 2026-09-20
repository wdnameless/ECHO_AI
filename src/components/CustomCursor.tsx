import { useEffect, useRef } from "react";
import { MousePointer2 } from "lucide-react";

/**
 * Follows the pointer with the themed cursor.
 *
 * The loop parks itself whenever the pointer has not moved: a `requestAnimationFrame`
 * callback that writes a transform every frame keeps the compositor busy for as long
 * as the window is on screen, which is exactly the "the app gets slower while I hover
 * it" symptom. It also writes only on an actual position change.
 */
export const CustomCursor = () => {
  const cursorRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef({ x: 0, y: 0 });
  const paintedRef = useRef({ x: -1, y: -1 });
  const visibleRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const paint = () => {
      frameRef.current = null;
      const node = cursorRef.current;
      const { x, y } = positionRef.current;
      if (!node || !visibleRef.current) return;
      if (x === paintedRef.current.x && y === paintedRef.current.y) return;
      paintedRef.current = { x, y };
      node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };

    const schedule = () => {
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(paint);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      positionRef.current = { x: e.clientX, y: e.clientY };

      if (!visibleRef.current) {
        visibleRef.current = true;
        if (cursorRef.current) cursorRef.current.style.opacity = "1";
      }
      schedule();
    };

    const hide = () => {
      visibleRef.current = false;
      if (cursorRef.current) cursorRef.current.style.opacity = "0";
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", hide);
    window.addEventListener("blur", hide);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", hide);
      window.removeEventListener("blur", hide);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <div
      ref={cursorRef}
      className="pointer-events-none fixed left-0 top-0 z-[9999] opacity-0 will-change-transform"
      style={{
        transform: "translate3d(0px, 0px, 0)",
        transition: "opacity 0.1s ease-out",
      }}
    >
      <MousePointer2 className="h-5 w-5 fill-secondary stroke-primary" />
    </div>
  );
};
