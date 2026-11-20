#!/usr/bin/env node
/**
 * Checks the glossary table in docs/GLOSSARY.md against prose documents.
 *
 * The table is the single source of truth:
 *   | 推奨表記 | 非推奨 | 備考 |
 *
 * Scope: README.md, docs/**\/*.md, templates/**\/*.md.
 * Code fences, inline code, and lines marked `<!-- glossary: allow -->` are
 * skipped. This script never rewrites files.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const glossaryPath = join(root, "docs", "GLOSSARY.md");
const scopes = ["README.md", "docs", "templates"];
const extensions = new Set([".md", ".mdx"]);

function rowCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

async function loadGlossary() {
  const text = await readFile(glossaryPath, "utf8");
  const terms = [];
  let inTable = false;
  let sawSeparator = false;

  for (const line of text.split(/\r?\n/)) {
    const cells = rowCells(line);
    if (!cells) {
      inTable = false;
      continue;
    }
    if (cells[0] === "推奨表記" && cells[1] === "非推奨") {
      inTable = true;
      sawSeparator = false;
      continue;
    }
    if (!inTable) continue;
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      sawSeparator = true;
      continue;
    }
    if (!sawSeparator) continue;

    const [preferred, discouraged] = cells;
    if (!preferred || !discouraged || preferred === discouraged) continue;
    terms.push({ preferred, discouraged });
  }

  if (terms.length === 0) {
    throw new Error("docs/GLOSSARY.md の用語表を読み取れませんでした。");
  }
  return terms;
}

async function collectFiles(target) {
  const absolute = join(root, target);
  let info;
  try {
    info = await stat(absolute);
  } catch {
    return [];
  }
  if (info.isFile()) return [absolute];

  const files = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(relative(root, child))));
    } else if (extensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      files.push(child);
    }
  }
  return files;
}

/**
 * Yields prose lines with their 1-based line numbers. Fenced code blocks are
 * removed, and inline code is blanked so examples are not checked.
 */
function* proseLines(content) {
  let inFence = false;
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.includes("<!-- glossary: allow -->")) continue;
    yield { number: index + 1, text: line.replace(/`[^`]*`/g, "") };
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const terms = await loadGlossary();
const files = new Set();
for (const scope of scopes) {
  for (const file of await collectFiles(scope)) files.add(file);
}

const problems = [];
for (const file of [...files].sort()) {
  if (file === glossaryPath) continue;
  const content = await readFile(file, "utf8");
  const patterns = terms.map((term) => ({
    ...term,
    pattern: new RegExp(`${escapeRegExp(term.discouraged)}(?!ー)`, "gu"),
  }));

  for (const { number, text } of proseLines(content)) {
    for (const { preferred, discouraged, pattern } of patterns) {
      if (!pattern.test(text)) continue;
      pattern.lastIndex = 0;
      problems.push({
        file: relative(root, file),
        line: number,
        discouraged,
        preferred,
        text: text.trim(),
      });
    }
  }
}

if (problems.length === 0) {
  console.log(
    `用語集チェック: ${files.size} ファイル、${terms.length} 用語、指摘なし`,
  );
  process.exit(0);
}

for (const problem of problems) {
  console.error(
    `${problem.file}:${problem.line}: 「${problem.discouraged}」→「${problem.preferred}」`,
  );
  if (problem.text) console.error(`  ${problem.text}`);
}
console.error(`\n用語集チェック: ${problems.length} 件の表記ゆれ`);
process.exit(1);
