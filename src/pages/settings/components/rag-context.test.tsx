import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ResumeContext } from "@/pages/settings/components/ResumeContext";
import { JobContext } from "@/pages/settings/components/JobContext";
import { getRagContext, setRagContext, deleteRagContext } from "@/lib/rag";
import { extractPdfText } from "@/lib/pdf";

vi.mock("@/lib/rag", () => ({
  getRagContext: vi.fn(),
  setRagContext: vi.fn(),
  deleteRagContext: vi.fn(),
}));

vi.mock("@/lib/pdf", () => ({
  extractPdfText: vi.fn(),
}));

const mockedGetRagContext = vi.mocked(getRagContext);
const mockedSetRagContext = vi.mocked(setRagContext);
const mockedDeleteRagContext = vi.mocked(deleteRagContext);
const mockedExtractPdfText = vi.mocked(extractPdfText);

const PDF_TEXT = "VLADYSLAV OLIINYK\nAI Software Engineer / LLM Workflows\nBatumi, Georgia";

function makePdfFile(name = "resume.pdf"): File {
  return new File([new Uint8Array([37, 80, 68, 70])], name, {
    type: "application/pdf",
  });
}

function makeTxtFile(name = "resume.txt"): File {
  return new File(["Hello from txt"], name, { type: "text/plain" });
}

async function uploadFile(input: HTMLInputElement, file: File) {
  await userEvent.upload(input, file);
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockedGetRagContext.mockResolvedValue(null);
  mockedSetRagContext.mockResolvedValue(undefined);
  mockedDeleteRagContext.mockResolvedValue(undefined);
  mockedExtractPdfText.mockResolvedValue(PDF_TEXT);
});

describe("ResumeContext PDF upload flow", () => {
  it("extracts PDF text, shows it in textarea, shows file name, and enables the switch", async () => {
    renderWithRouter(<ResumeContext />);

    await waitFor(() => expect(screen.getByText("My Resume")).toBeInTheDocument());

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.accept).toContain(".pdf");

    await uploadFile(input, makePdfFile());

    await waitFor(() => {
      expect(mockedExtractPdfText).toHaveBeenCalledTimes(1);
      expect(mockedSetRagContext).toHaveBeenCalledWith(
        "resume",
        PDF_TEXT,
        "resume.pdf"
      );
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe(PDF_TEXT);

    expect(screen.getByText("resume.pdf")).toBeInTheDocument();

    const switchEl = document.querySelector(
      'button[role="switch"]'
    ) as HTMLButtonElement;
    expect(switchEl).not.toBeNull();
    expect(switchEl.getAttribute("data-state")).toBe("checked");
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(localStorage.getItem("rag_resume_enabled")).toBe("true");
  });

  it("falls back to plain text for .txt files", async () => {
    renderWithRouter(<ResumeContext />);

    await waitFor(() => expect(screen.getByText("My Resume")).toBeInTheDocument());

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    await uploadFile(input, makeTxtFile());

    await waitFor(() => {
      expect(mockedExtractPdfText).not.toHaveBeenCalled();
      expect(mockedSetRagContext).toHaveBeenCalledWith(
        "resume",
        "Hello from txt",
        "resume.txt"
      );
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hello from txt");
    expect(screen.getByText("resume.txt")).toBeInTheDocument();
    expect(localStorage.getItem("rag_resume_enabled")).toBe("true");
  });

  it("shows an error when PDF extraction fails", async () => {
    mockedExtractPdfText.mockRejectedValue(new Error("boom"));
    renderWithRouter(<ResumeContext />);

    await waitFor(() => expect(screen.getByText("My Resume")).toBeInTheDocument());

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    await uploadFile(input, makePdfFile());

    await waitFor(() => {
      expect(
        screen.getByText(
          "Failed to read this file. Try a .txt / .md file or paste the text."
        )
      ).toBeInTheDocument();
    });

    expect(mockedSetRagContext).not.toHaveBeenCalled();
    expect(localStorage.getItem("rag_resume_enabled")).toBeNull();
  });
});

describe("JobContext PDF upload flow", () => {
  it("extracts PDF text, shows it in textarea, shows file name, and enables the switch", async () => {
    renderWithRouter(<JobContext />);

    await waitFor(() => expect(screen.getByText("Job Description")).toBeInTheDocument());

    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(input.accept).toContain(".pdf");

    await uploadFile(input, makePdfFile("vacancy.pdf"));

    await waitFor(() => {
      expect(mockedExtractPdfText).toHaveBeenCalledTimes(1);
      expect(mockedSetRagContext).toHaveBeenCalledWith(
        "job",
        PDF_TEXT,
        "vacancy.pdf"
      );
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe(PDF_TEXT);
    expect(screen.getByText("vacancy.pdf")).toBeInTheDocument();

    const switchEl = document.querySelector(
      'button[role="switch"]'
    ) as HTMLButtonElement;
    expect(switchEl.getAttribute("data-state")).toBe("checked");
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(localStorage.getItem("rag_job_enabled")).toBe("true");
  });
});


