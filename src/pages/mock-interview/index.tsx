import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/contexts";
import { PageLayout } from "@/layouts";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Button,
  Textarea,
  Badge,
} from "@/components";
import { fetchAIResponse, shouldUsePluelyAPI, transcribeWithFallback } from "@/lib";
import { useMicCapture } from "@/hooks/useMicCapture";
import { invoke } from "@tauri-apps/api/core";
import {
  getHumanizerSettings,
  HUMANIZER_INSTRUCTIONS,
  INTERVIEW_MODE_INSTRUCTIONS,
} from "@/config/humanizer.rules";
import {
  Loader2,
  Play,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  MessageSquare,
  Flag,
  Square,
  RotateCcw,
  Mic,
  Volume2,
  VolumeX,
  Wand2,
  Server,
  ServerOff,
  Languages,
} from "lucide-react";

interface InterviewMessage {
  role: "user" | "assistant";
  content: string;
}

type Phase = "idle" | "asking" | "answering" | "finishing" | "done";

const INTERVIEW_START_PROMPT =
  "You are a professional technical interviewer conducting a mock interview with the candidate. Use the [CONTEXT: JOB DESCRIPTION] and [CONTEXT: MY RESUME] sections to ask relevant questions. Ask exactly ONE question per turn, starting with an easy opening question. Do not answer for the candidate. After each question, wait for the candidate's answer. Keep questions realistic and tailored to the vacancy.";

const INTERVIEW_NEXT_PROMPT =
  "The candidate has answered. Ask the next logical interview question, one question only, going progressively deeper based on the previous answers. Reference specifics from the candidate's answers when relevant.";

const INTERVIEW_FINISH_PROMPT =
  "The interview is over. Give the candidate a concise evaluation: (1) strengths shown, (2) weak spots to improve, (3) a score out of 10, and (4) 2-3 concrete tips for the real interview. Be honest and specific. Keep it under 250 words.";

const ANSWER_GENERATOR_PROMPT =
  "You are a candidate in a live interview answering the interviewer. Write an organic, highly conversational spoken answer.\n\nStrict Rules:\n1. Natural Spoken Openers & Fillers: Start with a natural human conversational opener matching the language of the question (e.g. in Russian: 'Да, хороший вопрос. По опыту...', 'Слушайте, на прошлом проекте мы как раз...', 'Тут на самом деле всё зависит от нагрузки, но чаще всего...', 'Если честно, мы сначала сделали просто в лоб, а потом уже...'; in English: 'Yeah, good question. In my experience...', 'Honestly, on our previous project we actually...', 'It really depends on the scale, but typically we...', 'To be fair, we started simple and then...').\n2. THINK ALOUD - EXPLAIN YOUR STEPS: Do not just blurt out a finished answer. Show a brief chain of thought in a natural spoken way: 'Я бы в первую очередь посмотрел на нагрузку, потому что от этого всё отталкивается...', 'Здесь есть пара вариантов, и я бы начал с простого, потому что...'. Explain WHY you would choose something, not just WHAT.\n3. Flow: Sound spontaneous, unscripted, and human - a connected conversational monologue, NOT bullet points, NOT a numbered list, NOT an encyclopedia entry. Use natural spoken connectors and short pauses.\n4. Length: 3 to 5 punchy spoken sentences (45-85 words maximum). Direct to the point with 1 concrete tool/example from background.\n5. Language: Match the language of the question strictly (Russian if asked in Russian, English if asked in English).\n6. Format: Output ONLY the exact raw words to be spoken aloud. Zero markdown, no bullet points, no numbered lists, no quotes, no labels.";

const RU_ANCHORS = [
  "Да, хороший вопрос. По моему опыту, ",
  "Слушайте, на прошлом проекте мы как раз ",
  "Вообще, тут всё сильно зависит от нагрузки, но чаще всего мы ",
  "Если честно, мы сначала попробовали простое решение, а потом ",
  "На практике мы обычно отталкивались от того, что ",
  "В целом, если говорить про наш стек, то ",
  "Обычно я в таких кейсах предпочитаю ",
  "Давайте расскажу на реальном примере: у нас ",
  "Тут есть важный нюанс. Обычно мы ",
  "По сути, основная идея была в том, чтобы ",
  "Мы с командой долго это обсуждали и в итоге решили, что ",
  "Честно говоря, здесь главное не переусложнять: мы ",
];

const EN_ANCHORS = [
  "Yeah, good question. In my experience, ",
  "Honestly, on our previous project we actually ",
  "It really depends on the scale, but typically we ",
  "To be fair, we started simple and then ",
  "In practice, what worked best for us was ",
  "Overall, in our architecture we usually ",
  "I'd say the main trade-off here is, so we ",
  "Let me give you a quick real example: we ",
];

function isCyrillic(text: string): boolean {
  return /[а-яё]/i.test(text);
}
function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function speak(text: string, onDone?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onDone?.();
    return;
  }
  window.speechSynthesis.cancel();
  const voices = window.speechSynthesis.getVoices();
  const ruVoice =
    voices.find((v) => v.lang?.toLowerCase().startsWith("ru")) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith("en"));
  const parts = splitSentences(text);
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    if (ruVoice) u.voice = ruVoice;
    u.rate = 1.05;
    u.pitch = 1;
    u.onend = () => {
      if (i === parts.length - 1) onDone?.();
    };
    u.onerror = () => {
      if (i === parts.length - 1) onDone?.();
    };
    window.speechSynthesis.speak(u);
  });
}

function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

const MockInterview = () => {
  const {
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    selectedSttProvider,
    allSttProviders,
  } = useApp();

  const [phase, setPhase] = useState<Phase>("idle");
  const [streamingText, setStreamingText] = useState("");
  const [answer, setAnswer] = useState("");
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [questionCount, setQuestionCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jobContextReady, setJobContextReady] = useState<boolean | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGeneratingAnswer, setIsGeneratingAnswer] = useState(false);
  const [serverStatus, setServerStatus] = useState<boolean | null>(null);
  const [dualPane, setDualPane] = useState(false);
  const [translatedMessages, setTranslatedMessages] = useState<string[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<InterviewMessage[]>([]);
  const questionRef = useRef<string>("");
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const checkJobContext = () => {
      try {
        const enabled = localStorage.getItem("rag_job_enabled");
        setJobContextReady(enabled === "true");
      } catch {
        setJobContextReady(false);
      }
    };
    checkJobContext();
  }, []);

  // Poll the local Handy STT server status once.
  useEffect(() => {
    invoke<boolean>("handy_server_status")
      .then(setServerStatus)
      .catch(() => setServerStatus(false));
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages.length, phase]);

  // Voice pipeline: mic segment -> STT -> fill the answer textarea.
  const handleMicSegment = useCallback(
    async (audio: Blob) => {
      if (phaseRef.current !== "answering") return;
      setIsTranscribing(true);
      try {
        const usePluelyAPI = await shouldUsePluelyAPI();
        if (!selectedSttProvider.provider && !usePluelyAPI) {
          setError("No speech provider selected.");
          return;
        }
        const provider = allSttProviders.find(
          (p) => p.id === selectedSttProvider.provider
        );
        if (!provider && !usePluelyAPI) {
          setError("Speech provider config not found.");
          return;
        }
        const text = await transcribeWithFallback({
          provider: usePluelyAPI ? undefined : provider,
          selectedProvider: selectedSttProvider,
          audio,
        });
        if (text && !text.toLowerCase().startsWith("pluely stt error")) {
          // Ignore pure fillers/backchannels so "угу"/"мгм" don't pollute the answer.
          const { isFillerOrBackchannel } = await import("@/lib/speech-filter");
          if (isFillerOrBackchannel(text)) {
            return;
          }
          setAnswer((prev) => (prev ? prev + " " + text : text));
        } else {
          setError(text || "Empty transcription");
        }
      } catch (e: any) {
        setError(e?.message || "Failed to transcribe audio");
      } finally {
        setIsTranscribing(false);
      }
    },
    [selectedSttProvider, allSttProviders]
  );

  const mic = useMicCapture({
    onMicSegment: handleMicSegment,
  });

  const startListening = useCallback(() => {
    if (!mic.start) return;
    setError(null);
    setIsListening(true);
    mic.start();
  }, [mic]);

  const stopListening = useCallback(() => {
    mic.stop();
    setIsListening(false);
  }, [mic]);

  const cancelRequest = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const runPhase = useCallback(
    async (instruction: string, finalize: (full: string) => void) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      setStreamingText("");
      setError(null);

      try {
        const usePluelyAPI = await shouldUsePluelyAPI();
        if (!selectedAIProvider.provider && !usePluelyAPI) {
          setError("Please select an AI provider in settings");
          return;
        }
        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (!provider && !usePluelyAPI) {
          setError("Invalid provider selected");
          return;
        }

        let fullResponse = "";
        for await (const chunk of fetchAIResponse({
          provider: usePluelyAPI ? undefined : provider,
          selectedProvider: selectedAIProvider,
          systemPrompt: systemPrompt || undefined,
          history: messagesRef.current.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          userMessage: instruction,
          signal,
        })) {
          if (signal.aborted) {
            return;
          }
          fullResponse += chunk;
          setStreamingText(fullResponse);
        }

        if (signal.aborted) {
          return;
        }

        finalize(fullResponse);
      } catch (e: any) {
        if (!signal.aborted) {
          setError(e.message || "An error occurred");
        }
      }
    },
    [selectedAIProvider, allAiProviders, systemPrompt]
  );

  const startInterview = useCallback(() => {
    setMessages([]);
    setQuestionCount(0);
    setPhase("asking");
    runPhase(INTERVIEW_START_PROMPT, (full) => {
      setMessages([{ role: "assistant", content: full }]);
      questionRef.current = full;
      setQuestionCount(1);
      setPhase("answering");
      setStreamingText("");
      if (voiceEnabled) speak(full);
    });
  }, [runPhase, voiceEnabled]);

  const askNextQuestion = useCallback(() => {
    const lastAnswer = answer.trim();
    if (!lastAnswer) {
      return;
    }
    stopListening();
    setMessages((prev) => [...prev, { role: "user", content: lastAnswer }]);
    setAnswer("");
    setPhase("asking");
    runPhase(INTERVIEW_NEXT_PROMPT, (full) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: full },
      ]);
      questionRef.current = full;
      setQuestionCount((c) => c + 1);
      setPhase("answering");
      setStreamingText("");
      if (voiceEnabled) speak(full);
    });
  }, [answer, runPhase, voiceEnabled, stopListening]);

  const finishInterview = useCallback(() => {
    const lastAnswer = answer.trim();
    stopListening();
    const finalMessages: InterviewMessage[] = lastAnswer
      ? [{ role: "user", content: lastAnswer }]
      : [];
    setMessages((prev) => [...prev, ...finalMessages]);
    setAnswer("");
    setPhase("finishing");
    runPhase(INTERVIEW_FINISH_PROMPT, (full) => {
      setMessages((prev) => [...prev, { role: "assistant", content: full }]);
      setPhase("done");
      setStreamingText("");
    });
  }, [answer, runPhase, stopListening]);

  const resetInterview = useCallback(() => {
    cancelRequest();
    stopListening();
    stopSpeaking();
    setPhase("idle");
    setStreamingText("");
    setAnswer("");
    setMessages([]);
    setQuestionCount(0);
    setError(null);
    questionRef.current = "";
  }, [cancelRequest, stopListening]);

  // Ask the AI to generate a model answer for the current question with Instant Anchors.
  const generateAnswer = useCallback(async () => {
    const question = questionRef.current;
    if (!question) {
      setError("No question yet. Start the interview first.");
      return;
    }
    setIsGeneratingAnswer(true);
    setError(null);

    // 0ms Instant Conversational Anchor
    const isRu = isCyrillic(question);
    const anchors = isRu ? RU_ANCHORS : EN_ANCHORS;
    const initialAnchor = anchors[Math.floor(Math.random() * anchors.length)];
    setAnswer(initialAnchor);

    try {
      const usePluelyAPI = await shouldUsePluelyAPI();
      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );

      // Always apply Humanizer rules for interview answers, regardless of
      // the global toggle, so answers sound human and match the user's style.
      const humanizer = getHumanizerSettings();
      const humanizerPrompt = [
        HUMANIZER_INSTRUCTIONS,
        INTERVIEW_MODE_INSTRUCTIONS,
        humanizer.customStyle?.trim()
          ? `Match this personal speaking style: ${humanizer.customStyle.trim()}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      let full = initialAnchor;
      for await (const chunk of fetchAIResponse({
        provider: usePluelyAPI ? undefined : provider,
        selectedProvider: selectedAIProvider,
        systemPrompt: systemPrompt
          ? `${systemPrompt} ${humanizerPrompt}`
          : humanizerPrompt,
        history: [],
        userMessage: `${ANSWER_GENERATOR_PROMPT}\n\nInterviewer Question: ${question}\n\nStart your answer by naturally continuing this opening thought: "${initialAnchor}"`,
      })) {
        full += chunk;
        setAnswer(full);
      }
      setAnswer(full.trim());
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to generate answer");
    } finally {
      setIsGeneratingAnswer(false);
    }
  }, [allAiProviders, selectedAIProvider, systemPrompt]);

  const isBusy = phase === "asking" || phase === "finishing";
  const canSpeak =
    typeof window !== "undefined" && "speechSynthesis" in window;

  // Translate messages into counterpart language when dualPane is active
  const translateMessages = useCallback(async () => {
    if (!messages.length) return;
    setIsTranslating(true);
    try {
      const usePluelyAPI = await shouldUsePluelyAPI();
      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );
      const textToTranslate = messages
        .map((m, i) => `[${i + 1}] ${m.role === "assistant" ? "Interviewer" : "Candidate"}: ${m.content}`)
        .join("\n\n");

      // Explicit direction based on the source language of the interview.
      const sourceIsRussian = messages.some((m) => /[а-яё]/i.test(m.content));
      const direction = sourceIsRussian
        ? "Translate the following interview log from Russian into English."
        : "Translate the following interview log from English into Russian.";

      let full = "";
      for await (const chunk of fetchAIResponse({
        provider: usePluelyAPI ? undefined : provider,
        selectedProvider: selectedAIProvider,
        systemPrompt:
          "You are a professional translator. " +
          direction +
          " Keep the exact format [N] Interviewer/Candidate: <text> without commentary, no quotes, no labels.",
        history: [],
        userMessage: textToTranslate,
      })) {
        full += chunk;
      }
      const parsed = full
        .split(/\[\d+\]\s*(?:Interviewer|Candidate):\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
      setTranslatedMessages(parsed);
    } catch {
      // ignore translation error
    } finally {
      setIsTranslating(false);
    }
  }, [messages, allAiProviders, selectedAIProvider]);

  useEffect(() => {
    if (dualPane && messages.length) {
      translateMessages();
    }
  }, [dualPane, messages.length, translateMessages]);

  return (
    <PageLayout
      title="Mock Interview"
      description="Practice answering real interview questions based on the loaded job description and your resume."
      rightSlot={
        <div className="flex items-center gap-2">
          <Button
            variant={dualPane ? "default" : "outline"}
            size="sm"
            onClick={() => setDualPane((d) => !d)}
            title="Toggle side-by-side bilingual translation (RU ⟷ EN)"
          >
            <Languages className="mr-1.5 h-4 w-4" />
            {dualPane ? "Dual Pane (Active)" : "Dual Pane (RU ⟷ EN)"}
          </Button>
          {phase !== "idle" && !isBusy ? (
            <Button variant="outline" size="sm" onClick={resetInterview}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
          ) : null}
        </div>
      }
    >
      <div className={`grid gap-4 ${dualPane ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        <div className="flex flex-col gap-4">
        {jobContextReady === false && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="flex items-center gap-3 py-4">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <p className="text-sm text-amber-600">
                No job description loaded yet. Go to{" "}
                <span className="font-semibold">
                  Settings → Job Description
                </span>{" "}
                and enable it so questions target the vacancy.
              </p>
            </CardContent>
          </Card>
        )}

        {serverStatus === false && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="flex items-center gap-3 py-4">
              <ServerOff className="h-5 w-5 text-amber-500" />
              <div className="flex-1">
                <p className="text-sm text-amber-600">
                  Local STT server (Handy) is not running.
                </p>
                <p className="text-xs text-muted-foreground">
                  Voice answers won't transcribe until it is up.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await invoke("start_handy_server");
                    const ok = await invoke<boolean>("handy_server_status");
                    setServerStatus(ok);
                  } catch {
                    setServerStatus(false);
                  }
                }}
              >
                <Server className="mr-1 h-3.5 w-3.5" />
                Start server
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Interview Session
            </CardTitle>
            <CardDescription>
              {phase === "idle" &&
                "The AI interviewer asks one question at a time based on the vacancy. Answer out loud or type, then move on."}
              {phase !== "idle" && (
                <span className="flex items-center gap-2">
                  <Badge variant="secondary">Question {questionCount}</Badge>
                  {isBusy && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {phase === "asking"
                        ? "Interviewer is asking..."
                        : "Evaluating..."}
                    </span>
                  )}
                  {serverStatus && (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <Server className="h-3 w-3" />
                      STT
                    </span>
                  )}
                </span>
              )}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div
              ref={scrollRef}
              className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto pr-2"
            >
              {phase === "idle" && (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <Play className="h-10 w-10 text-muted-foreground/40" />
                  <p className="max-w-md text-sm text-muted-foreground">
                    Ready when you are. The interviewer will use the job
                    description (and your resume) to ask relevant questions.
                  </p>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${
                    msg.role === "assistant" ? "justify-start" : "justify-end"
                  }`}
                >
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${
                      msg.role === "assistant"
                        ? "bg-muted text-foreground"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {streamingText && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-muted px-4 py-2 text-sm text-foreground">
                    {streamingText}
                  </div>
                </div>
              )}
            </div>

            {phase === "answering" && (
              <div className="flex flex-col gap-2">
                <Textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type your answer here (or speak it out loud)..."
                  className="min-h-[100px]"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={askNextQuestion} disabled={!answer.trim()}>
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Next question
                  </Button>
                  <Button variant="outline" onClick={finishInterview}>
                    <Flag className="mr-2 h-4 w-4" />
                    Finish and evaluate
                  </Button>
                </div>

                {/* Voice controls */}
                <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/30 p-2">
                  <Button
                    size="sm"
                    variant={isListening ? "default" : "outline"}
                    onClick={isListening ? stopListening : startListening}
                    disabled={!serverStatus || isBusy}
                    className={isListening ? "bg-red-500 hover:bg-red-600 text-white" : ""}
                  >
                    <Mic className="mr-1 h-3.5 w-3.5" />
                    {isListening ? "Stop listening" : "Answer by voice"}
                  </Button>
                  {isTranscribing && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Transcribing...
                    </span>
                  )}
                  {isListening && (
                    <span className="flex items-center gap-1 text-xs text-emerald-600">
                      <Mic className="h-3 w-3 animate-pulse" />
                      Listening...
                    </span>
                  )}
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setVoiceEnabled((v) => !v)}
                    title="Read questions aloud"
                    disabled={!canSpeak}
                  >
                    {voiceEnabled ? (
                      <Volume2 className="mr-1 h-3.5 w-3.5" />
                    ) : (
                      <VolumeX className="mr-1 h-3.5 w-3.5" />
                    )}
                    Voice
                  </Button>
                </div>
              </div>
            )}

            {phase === "answering" && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
                <div>
                  <p className="text-xs font-medium">Generate answer</p>
                  <p className="text-[10px] text-muted-foreground">
                    The AI drafts a spoken-style answer to the last question,
                    so you can practice reading it out loud.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={generateAnswer}
                  disabled={isGeneratingAnswer || isBusy}
                >
                  {isGeneratingAnswer ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="mr-1 h-3.5 w-3.5" />
                  )}
                  Generate answer (AI)
                </Button>
              </div>
            )}

            {isBusy && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {phase === "asking"
                  ? "The interviewer is preparing the next question..."
                  : "Evaluating your performance..."}
              </div>
            )}

            {phase === "done" && (
              <div className="flex items-center justify-center gap-2 py-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                Evaluation complete. Scroll up to read the feedback.
              </div>
            )}
          </CardContent>

          <CardFooter className="flex justify-start gap-2 border-t pt-4">
            {phase === "idle" && (
              <Button onClick={startInterview}>
                <Play className="mr-2 h-4 w-4" />
                Start mock interview
              </Button>
            )}
            {phase === "done" && (
              <Button variant="outline" onClick={resetInterview}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Start a new session
              </Button>
            )}
            {isBusy && (
              <Button variant="outline" onClick={cancelRequest}>
                <Square className="mr-2 h-4 w-4" />
                Stop
              </Button>
            )}
          </CardFooter>
        </Card>
        </div>

        {/* Dual-Pane Side-by-Side Live Mirror Translation (RU ⟷ EN) */}
        {dualPane && (
          <Card className="border-primary/20 bg-muted/10">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Languages className="h-5 w-5 text-primary" />
                  Live Mirror Translation (RU ⟷ EN)
                </span>
                {isTranslating && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Translating...
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                Synchronous counterpart translation for real-time bilingual interview practice.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-2">
                {!translatedMessages.length && !isTranslating && (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-muted-foreground">
                    <Languages className="mb-2 h-8 w-8 text-muted-foreground/40" />
                    Start talking or asking questions — translations will appear here synchronously.
                  </div>
                )}
                {translatedMessages.map((msg, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-border/40 bg-background/80 p-3 text-xs leading-relaxed"
                  >
                    <div className="mb-1 font-semibold text-primary">
                      {i % 2 === 0 ? "Interviewer (Translated)" : "Candidate (Translated)"}
                    </div>
                    <p className="whitespace-pre-wrap text-foreground/90">{msg}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {mic.bridge}
      </div>
    </PageLayout>
  );
};

export default MockInterview;
