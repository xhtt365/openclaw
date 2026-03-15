import { toast } from "@/hooks/use-toast";

export const GROUP_STORAGE_KEY = "wurenju.groups.v1";

const GROUP_STORAGE_ERROR_TITLE = "存储空间不足，数据未保存";
const GROUP_STORAGE_ERROR_DESCRIPTION = "建议导出或清理归档记录";

function isQuotaExceededError(error: unknown) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED";
  }

  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

export function reportGroupStorageWriteError(error: unknown, context: string) {
  const errorLabel = isQuotaExceededError(error) ? "QuotaExceededError" : "WriteError";
  console.error(`[Group] ${context} (${errorLabel}):`, error);
  toast({
    variant: "destructive",
    title: GROUP_STORAGE_ERROR_TITLE,
    description: GROUP_STORAGE_ERROR_DESCRIPTION,
  });
}

export function writeGroupStorageSnapshot(snapshot: unknown, context: string) {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    window.localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch (error) {
    reportGroupStorageWriteError(error, context);
    return false;
  }
}
