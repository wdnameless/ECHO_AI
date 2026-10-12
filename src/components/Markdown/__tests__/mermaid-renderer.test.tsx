import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MarkdownRenderer from "../renderer";

describe("MarkdownRenderer (R15 / R16: mermaid diagram vs plain text)", () => {
  it("renders plain markdown as text without any mermaid placeholder or container", () => {
    const { container } = render(
      <MarkdownRenderer>
        {"Plain answer about quicksort with no diagrams."}
      </MarkdownRenderer>
    );

    expect(
      screen.getByText("Plain answer about quicksort with no diagrams.")
    ).toBeInTheDocument();
    // No mermaid block or container rendered
    expect(container.querySelector('[data-streamdown="mermaid-block"]')).toBeNull();
  });

  it("renders mermaid diagram block when markdown contains mermaid fence", async () => {
    const markdownWithDiagram = `System architecture:

\`\`\`mermaid
graph TD
    Client --> Gateway
    Gateway --> Service
\`\`\``;

    const { container } = render(
      <MarkdownRenderer>{markdownWithDiagram}</MarkdownRenderer>
    );

    expect(screen.getByText("System architecture:")).toBeInTheDocument();
    await waitFor(() => {
      const mermaidBlock = container.querySelector(
        '[data-streamdown="mermaid-block"]'
      );
      expect(mermaidBlock).not.toBeNull();
    });
  });
});
