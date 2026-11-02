import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api } from "../lib/api";

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...props }) {
            const external = Boolean(href && /^https?:\/\//i.test(href));
            return (
              <a
                {...props}
                href={href}
                onClick={(event) => {
                  if (!external || !href) return;
                  event.preventDefault();
                  if (api.isTauri) {
                    void openUrl(href);
                  } else {
                    window.open(href, "_blank", "noopener,noreferrer");
                  }
                }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
