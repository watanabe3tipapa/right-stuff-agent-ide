import { describe, expect, it } from "vitest";

import type {
  SkillAction,
  SkillManifest,
  SkillRunResult,
  VerificationResult,
} from "../shared/types";
import {
  buildSkillReport,
  escapeHtml,
  reportFileName,
} from "./report";

const action: SkillAction = {
  id: "terminal.run",
  handler: "terminal.run",
  description: "テストを実行する",
  risk: "write",
  params: {
    program: {
      type: "string",
      description: "実行するプログラム",
      required: true,
    },
  },
  timeoutMs: 300_000,
};

const skill: SkillManifest = {
  schemaVersion: 1,
  id: "terminal-command",
  name: "Terminal Command",
  description: "許可されたプログラムを直接実行する",
  version: "0.1.0",
  category: "terminal",
  risk: "write",
  actions: [action],
  permissions: {
    paths: { read: [], write: [] },
    commands: [],
    env: [],
  },
  approval: { default: "ask", overrides: {} },
  verification: {
    mode: "auto",
    checks: ["test"],
    timeoutMs: 300_000,
    stopOnFailure: true,
  },
  limits: {
    maxFiles: 20,
    maxBytes: 1_048_576,
    timeoutMs: 300_000,
    maxOutputChars: 50_000,
  },
};

const result: SkillRunResult = {
  runId: "run:demo/1",
  status: "failed",
  decision: "ask",
  changedFiles: ["src/app.ts"],
  stdout: "<script>alert('stdout')</script>",
  stderr: "stderr <b>bold</b>",
  exitCode: 1,
  durationMs: 42,
  auditId: 7,
  errorCode: "handler_failed",
};

const verification: VerificationResult = {
  status: "failed",
  checks: [
    {
      name: "test",
      ecosystem: "node",
      status: "failed",
      command: ["npm", "test"],
      exitCode: 1,
      output: "<img src=x onerror=alert(1)>",
      durationMs: 30,
    },
  ],
};

describe("skill report", () => {
  it("escapes user-controlled text", () => {
    expect(escapeHtml("<script>&\"'")).toBe(
      "&lt;script&gt;&amp;&quot;&#39;",
    );
  });

  it("builds a self-contained report with the workflow and verification", () => {
    const html = buildSkillReport({
      skill,
      action,
      params: { program: "<npm>", args: ["test"] },
      result,
      verification,
      generatedAt: new Date("2026-11-05T12:34:56"),
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Terminal Command");
    expect(html).toContain("実行フロー");
    expect(html).toContain("data-theme");
    expect(html).toContain("2026-11-05 12:34:56");
    expect(html).toContain("npm test");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("does not inject unescaped output or parameters", () => {
    const html = buildSkillReport({
      skill,
      action,
      params: { program: "<npm>" },
      result,
      verification,
    });

    expect(html).not.toContain("<script>alert('stdout')</script>");
    expect(html).toContain("&lt;script&gt;alert(&#39;stdout&#39;)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<npm>");
  });

  it("sanitizes report file names", () => {
    expect(reportFileName(result)).toBe("run-demo-1.html");
    expect(reportFileName({ ...result, runId: "///" })).toBe("skill-run.html");
  });
});
