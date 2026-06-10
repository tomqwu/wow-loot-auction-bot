import { AttachmentBuilder, type BaseMessageOptions } from 'discord.js';

// Discord message content caps at 2000 characters; leave headroom for the
// code fence.
export const INLINE_REPORT_LIMIT = 1900;

/**
 * Wraps a plain-text report for a Discord reply: inline code block when it
 * fits in one message (tap-to-copy on mobile), otherwise a .txt attachment.
 */
export function textReportPayload(
  report: string,
  filename: string,
  tooLongContent: string
): BaseMessageOptions {
  const block = '```text\n' + report + '\n```';
  if (block.length <= INLINE_REPORT_LIMIT) {
    return { content: block, allowedMentions: { parse: [] } };
  }
  return {
    content: tooLongContent,
    files: [new AttachmentBuilder(Buffer.from(report, 'utf8'), { name: filename })],
    allowedMentions: { parse: [] },
  };
}
