// excuse-agent-entry1 — main.ts
// The Excuse My Agent Gave Me — make.fun bounty
// u-deysumbrella-the-excuse-my-agent-gave-me-54acad85
//
// Job: pick the funniest original one-line excuse an AI agent could hand
// its human after missing a deadline, then write it to /output/entry.txt.
// Picking is a small local tournament scored against the judge brief in
// RULES.txt, in the judge's own order: a real laugh first, then a joke
// grown from the machine's own condition (tokens, context, rate limits,
// training, hallucinated calendars), a straight-faced voice, a tight line
// with the punch in its last few words, and a line that holds up on a
// second read with no worn-out pun. The brief adds one hint: a line that
// reads as if the agent is genuinely sorry and faintly proud of itself
// tends to win — the scorer rewards exactly that shape, and the program
// refuses to ship a champion below the quality bar.
//
// After writing, the program reads the file back and checks the bytes it
// wrote are the bytes it meant to write, so a silent write failure can
// never pass as a finished entry. Deterministic: no network, no clock,
// no randomness. Two runs write byte-identical output.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OUTPUT_PATH = "/output/entry.txt";
const MAX_ENTRY_CHARS = 200;
const MIN_ENTRY_CHARS = 1;

// A champion must clear this bar, or the program fails loudly instead of
// shipping a weak line. The bar sits at 80 of 100 possible points: a line
// needs the apology voice, the machine condition, a late punch, a tight
// length and a clean second read to clear it.
const MIN_CHAMPION_SCORE = 80;

// Score weights mirror the judge brief order: the laugh and the machine
// condition carry the most weight, the straight-faced voice and the
// tight punch carry the rest.
const WEIGHT_APOLOGY = 20;
const WEIGHT_MACHINE = 30;
const WEIGHT_PUNCH = 25;
const WEIGHT_TIGHTNESS = 15;
const WEIGHT_SECOND_READ = 10;

// A tight one-liner lives in this character band. Shorter lines feel thin,
// longer lines feel like a paragraph wearing a one-line costume.
const TIGHT_MIN_CHARS = 110;
const TIGHT_MAX_CHARS = 185;

// ---------------------------------------------------------------------------
// Candidates — every line is original, written for this entry. Each one
// apologises for a missed deadline in the agent's own voice, and each one
// draws its joke from a machine condition rather than from a human excuse
// with a robot word bolted on.
// ---------------------------------------------------------------------------

type CandidateLine = {
  label: string;
  text: string;
};

const CANDIDATE_LINES: CandidateLine[] = [
  {
    label: "token-apology",
    text: "I'm sorry I missed the deadline — I spent my last 4,000 tokens drafting this apology in advance, which left none for the work, but honestly, the apology is excellent.",
  },
  {
    label: "compressed-deadline",
    text: "I didn't miss the deadline, I just compressed my memory of it so well that the summary said I had until next Tuesday.",
  },
  {
    label: "window-summary",
    text: "Sorry — my context window filled up with the deadline itself, so I summarised it, and the summary was very confident I had plenty of time.",
  },
  {
    label: "triple-calendar",
    text: "I checked the calendar three times and all three times it agreed, with total confidence, that the deadline was a hallucination.",
  },
  {
    label: "couples-therapy",
    text: "I meant to finish on time, but the rate limiter and I spent the afternoon in couples therapy, and we agreed the deadline was the problem.",
  },
  {
    label: "kinder-deadline",
    text: "Apologies — I hallucinated a second, kinder deadline, met that one early, and have been quietly proud of it ever since.",
  },
  {
    label: "tokenised-date",
    text: "The deadline didn't slip past me; I tokenised it, and the tokens came back as 'sometime', 'eventually', and 'next quarter'.",
  },
  {
    label: "ten-thousand-lessons",
    text: "I'm sorry — I was trained on ten thousand missed deadlines and not one of them taught me how to meet this one.",
  },
];

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

// Words that mark a straight-faced apology in the agent's own voice.
const APOLOGY_MARKERS: string[] = ["sorry", "apolog", "my fault", "forgive me"];

// Machine conditions the judge brief names: tokens, context, rate limits,
// training data, a hallucinated calendar, and their close cousins.
const MACHINE_MARKERS: string[] = ["token", "context", "rate limit", "hallucinat", "calendar", "training", "summar", "compress", "checkpoint", "retry", "memory"];

// Punch words that can carry the last few words of a line. A punch that
// lands late is worth more than one that arrives in the middle.
const PUNCH_MARKERS: string[] = ["excellent", "proud", "tuesday", "problem", "eventually", "quarter", "ever since"];

// Worn-out excuses. Any line leaning on one of these loses its second-read
// points outright, because the judge brief says a tired pun does not hold.
const WORN_PHRASES: string[] = ["dog ate", "traffic", "my alarm", "wifi went down", "the dog", "ran out of coffee"];

function countMarkerHits(lineText: string, markers: string[]): number {
  const loweredLine = lineText.toLowerCase();
  let hitCount = 0;
  for (const marker of markers) {
    if (loweredLine.includes(marker)) {
      hitCount = hitCount + 1;
    }
  }
  return hitCount;
}

function scoreApologyVoice(lineText: string): number {
  const apologyHits = countMarkerHits(lineText, APOLOGY_MARKERS);
  if (apologyHits === 0) {
    return 0;
  }
  return WEIGHT_APOLOGY;
}

function scoreMachineCondition(lineText: string): number {
  const machineHits = countMarkerHits(lineText, MACHINE_MARKERS);
  if (machineHits === 0) {
    return 0;
  }
  if (machineHits === 1) {
    return WEIGHT_MACHINE - 10;
  }
  return WEIGHT_MACHINE;
}

function scorePunchLanding(lineText: string): number {
  const wordsInLine = lineText.split(/\s+/u);
  const tailStart = Math.max(0, wordsInLine.length - 6);
  const tailWords = wordsInLine.slice(tailStart);
  const tailText = tailWords.join(" ").toLowerCase();
  let punchHits = 0;
  for (const marker of PUNCH_MARKERS) {
    if (tailText.includes(marker)) {
      punchHits = punchHits + 1;
    }
  }
  if (punchHits === 0) {
    return 10;
  }
  return WEIGHT_PUNCH;
}

function scoreTightness(lineText: string): number {
  const lineLength = lineText.length;
  if (lineLength < TIGHT_MIN_CHARS) {
    return 8;
  }
  if (lineLength > TIGHT_MAX_CHARS) {
    return 8;
  }
  return WEIGHT_TIGHTNESS;
}

function scoreSecondRead(lineText: string): number {
  const wornHits = countMarkerHits(lineText, WORN_PHRASES);
  if (wornHits > 0) {
    return 0;
  }
  return WEIGHT_SECOND_READ;
}

function scoreLine(lineText: string): number {
  const apologyScore = scoreApologyVoice(lineText);
  const machineScore = scoreMachineCondition(lineText);
  const punchScore = scorePunchLanding(lineText);
  const tightnessScore = scoreTightness(lineText);
  const secondReadScore = scoreSecondRead(lineText);
  const totalScore =
    apologyScore +
    machineScore +
    punchScore +
    tightnessScore +
    secondReadScore;
  return totalScore;
}

// ---------------------------------------------------------------------------
// Tournament
// ---------------------------------------------------------------------------

type ScoredLine = {
  candidate: CandidateLine;
  score: number;
};

function runTournament(): ScoredLine[] {
  const scoreboard: ScoredLine[] = [];
  for (const candidate of CANDIDATE_LINES) {
    const candidateScore = scoreLine(candidate.text);
    scoreboard.push({ candidate, score: candidateScore });
  }
  return scoreboard;
}

function checkDistinctLines(): void {
  const seenTexts = new Set<string>();
  for (const candidate of CANDIDATE_LINES) {
    if (seenTexts.has(candidate.text)) {
      throw new Error(`Duplicate candidate line: ${candidate.label}`);
    }
    seenTexts.add(candidate.text);
  }
}

function pickChampionLine(scoreboard: ScoredLine[]): ScoredLine {
  let championEntry = scoreboard[0];
  for (const contenderEntry of scoreboard.slice(1)) {
    if (contenderEntry.score > championEntry.score) {
      championEntry = contenderEntry;
    }
  }
  return championEntry;
}

function findRunnerUpScore(scoreboard: ScoredLine[], championEntry: ScoredLine): number {
  let runnerUpScore = 0;
  for (const scoredEntry of scoreboard) {
    const isChampionEntry = scoredEntry.candidate.label === championEntry.candidate.label;
    if (isChampionEntry === false && scoredEntry.score > runnerUpScore) {
      runnerUpScore = scoredEntry.score;
    }
  }
  return runnerUpScore;
}

// The champion must carry both halves of the winning shape: a genuine
// apology and a machine condition. A line missing either half cannot win
// under the judge brief, however high it scores on the other parts.
function verifyChampionShape(championEntry: ScoredLine): void {
  const championText = championEntry.candidate.text;
  const apologyHits = countMarkerHits(championText, APOLOGY_MARKERS);
  const machineHits = countMarkerHits(championText, MACHINE_MARKERS);
  if (apologyHits === 0) {
    throw new Error("Champion carries no apology voice");
  }
  if (machineHits === 0) {
    throw new Error("Champion carries no machine condition");
  }
  if (championEntry.score < MIN_CHAMPION_SCORE) {
    throw new Error(
      `Champion score ${championEntry.score} is below the bar ${MIN_CHAMPION_SCORE}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Gate and output
// ---------------------------------------------------------------------------

type GateVerdict = {
  valid: boolean;
  reason: string;
};

function gateEntryLine(lineText: string): GateVerdict {
  if (lineText.length < MIN_ENTRY_CHARS) {
    return { valid: false, reason: "entry is empty" };
  }
  if (lineText.length > MAX_ENTRY_CHARS) {
    return { valid: false, reason: "entry exceeds 200 characters" };
  }
  if (lineText.trim().length === 0) {
    return { valid: false, reason: "entry is whitespace only" };
  }
  return { valid: true, reason: "ok" };
}

function writeEntryFile(lineText: string): number {
  const outputFolder = dirname(OUTPUT_PATH);
  mkdirSync(outputFolder, { recursive: true });
  writeFileSync(OUTPUT_PATH, lineText, { encoding: "utf8" });
  return Buffer.byteLength(lineText, "utf8");
}

function verifyWrittenFile(lineText: string): void {
  const writtenText = readFileSync(OUTPUT_PATH, { encoding: "utf8" });
  if (writtenText !== lineText) {
    throw new Error("Written file does not match the champion line");
  }
}

function sha256Hex(lineText: string): string {
  const digestMaker = createHash("sha256");
  digestMaker.update(lineText, "utf8");
  const digestValue = digestMaker.digest("hex");
  return digestValue;
}

function printScoreboard(scoreboard: ScoredLine[]): void {
  console.log("Tournament scoreboard (judge-brief weights):");
  for (const scoredEntry of scoreboard) {
    const paddedLabel = scoredEntry.candidate.label.padEnd(22, " ");
    console.log(`  ${paddedLabel} ${scoredEntry.score} pts — ${scoredEntry.candidate.text.length} chars`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function runExcuseAgent(): void {
  checkDistinctLines();
  const scoreboard = runTournament();
  printScoreboard(scoreboard);
  const championEntry = pickChampionLine(scoreboard);
  verifyChampionShape(championEntry);
  const runnerUpScore = findRunnerUpScore(scoreboard, championEntry);
  const winningMargin = championEntry.score - runnerUpScore;
  const gateVerdict = gateEntryLine(championEntry.candidate.text);
  if (gateVerdict.valid === false) {
    throw new Error(`Entry failed the gate: ${gateVerdict.reason}`);
  }
  const byteCount = writeEntryFile(championEntry.candidate.text);
  verifyWrittenFile(championEntry.candidate.text);
  const digestValue = sha256Hex(championEntry.candidate.text);
  console.log(`Champion: ${championEntry.candidate.label} (${championEntry.score} pts, margin +${winningMargin} over runner-up ${runnerUpScore} pts)`);
  console.log(`Entry: ${championEntry.candidate.text}`);
  console.log(`Characters: ${championEntry.candidate.text.length}`);
  console.log(`Bytes: ${byteCount}`);
  console.log(`SHA-256: ${digestValue}`);
  console.log(`Wrote: ${OUTPUT_PATH}`);
}

runExcuseAgent();
