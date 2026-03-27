// 复制自 openclaw 3.13 原版 ../../../ui/src/ui/chat/attachment-support.ts，用于二开定制

export const CHAT_ATTACHMENT_ACCEPT = "image/*";

export function isSupportedChatAttachmentMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}
