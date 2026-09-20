import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, GlobeIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODEL_CAPABILITY_LANGUAGES } from "@/lib/constants/languages";

/**
 * Searchable language picker.
 *
 * The catalogue exposes 100+ languages, so a plain `<select>` (or a select without
 * search) is unusable: the chosen row scrolls out of the popup and the user ends up
 * clicking whatever is behind it. This mirrors Handy's picker: a search box that
 * narrows the list, a scrollable body, and a highlighted current selection.
 */
export const LanguageFilterDropdown = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const label = useMemo(() => {
    if (value === "all") return "All Languages";
    return (
      MODEL_CAPABILITY_LANGUAGES.find((l) => l.value === value)?.label ?? value
    );
  }, [value]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return MODEL_CAPABILITY_LANGUAGES;
    return MODEL_CAPABILITY_LANGUAGES.filter((l) =>
      l.label.toLowerCase().includes(needle)
    );
  }, [query]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
          value !== "all"
            ? "bg-foreground text-background"
            : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        )}
      >
        <GlobeIcon className="size-3.5" />
        <span className="max-w-[130px] truncate">{label}</span>
        <ChevronDownIcon
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <div className="border-b border-border/60 p-2">
            <div className="relative">
              <SearchIcon className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search languages…"
                className="h-8 w-full rounded-md border border-border/60 bg-muted/40 pl-7 pr-2 text-xs outline-none focus:border-ring/60"
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto py-1" role="listbox">
            <button
              type="button"
              onClick={() => pick("all")}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/60",
                value === "all" && "bg-muted font-semibold"
              )}
            >
              <CheckIcon
                className={cn("size-3.5", value !== "all" && "invisible")}
              />
              All Languages
            </button>

            {matches.map((language) => (
              <button
                key={language.value}
                type="button"
                onClick={() => pick(language.value)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/60",
                  value === language.value && "bg-muted font-semibold"
                )}
              >
                <CheckIcon
                  className={cn(
                    "size-3.5",
                    value !== language.value && "invisible"
                  )}
                />
                {language.label}
              </button>
            ))}

            {matches.length === 0 && (
              <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                No languages match "{query}"
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
