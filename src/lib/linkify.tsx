import React from 'react';

const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
const TRAILING_PUNCTUATION_PATTERN = /[)\]\}.,;:!?\u3002\uff0c\uff1a\uff1b\uff01\uff1f]+$/;

export interface LinkPart {
  text: string;
  href: string | null;
}

export function splitTextIntoLinkParts(text: string): LinkPart[] {
  if (!text) return [];
  const parts: LinkPart[] = [];
  let lastIndex = 0;
  const matches = text.matchAll(URL_PATTERN);
  for (const match of matches) {
    const matchText = match[0];
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      parts.push({ text: text.slice(lastIndex, matchIndex), href: null });
    }
    const trailingMatch = matchText.match(TRAILING_PUNCTUATION_PATTERN);
    const trailingLength = trailingMatch ? trailingMatch[0].length : 0;
    const linkText = trailingLength > 0 ? matchText.slice(0, matchText.length - trailingLength) : matchText;
    const trailingText = trailingLength > 0 ? matchText.slice(matchText.length - trailingLength) : '';
    if (linkText) {
      const href = linkText.startsWith('www.') ? `https://${linkText}` : linkText;
      parts.push({ text: linkText, href });
    }
    if (trailingText) {
      parts.push({ text: trailingText, href: null });
    }
    lastIndex = matchIndex + matchText.length;
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), href: null });
  }
  return parts;
}

export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts = splitTextIntoLinkParts(text);
  if (parts.length === 0) return <span className={className} />;
  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (!part.href) return <React.Fragment key={`plain-${index}`}>{part.text}</React.Fragment>;
        return (
          <a
            key={`link-${index}`}
            href={part.href}
            target="_blank"
            rel="noreferrer"
            onClick={event => event.stopPropagation()}
            className="font-black text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800"
          >
            {part.text}
          </a>
        );
      })}
    </span>
  );
}
