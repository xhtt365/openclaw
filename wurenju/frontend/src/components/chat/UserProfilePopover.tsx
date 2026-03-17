"use client";

import { Camera, UserRound } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getUserInitial, getUserProfile, saveUserAvatar, saveUserName } from "@/utils/userProfile";

type UserProfilePopoverProps = {
  open: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
};

type PopoverPosition = {
  left: number;
  top: number;
  transformOrigin: string;
};

const POPOVER_WIDTH = 280;
const POPOVER_GAP = 12;
const POPOVER_MARGIN = 12;
const AVATAR_SIZE = 200;
const MAX_AVATAR_BYTES = 50 * 1024;
const SAVE_TOAST_DURATION_MS = 1500;

function toDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string" || !reader.result.trim()) {
        reject(new Error("头像读取结果为空"));
        return;
      }
      resolve(reader.result);
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("头像读取失败"));
    });
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.addEventListener("load", () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片加载失败"));
    });
    image.src = objectUrl;
  });
}

async function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("头像压缩失败"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

async function buildAvatarDataUrl(file: File) {
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("头像裁剪失败");
  }

  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);

  context.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );

  let quality = 0.8;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > MAX_AVATAR_BYTES && quality > 0.4) {
    quality = Math.max(0.4, quality - 0.1);
    blob = await canvasToBlob(canvas, quality);
  }

  return toDataUrl(blob);
}

function getPopoverPosition(anchorRect: DOMRect, popoverHeight: number): PopoverPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = anchorRect.left - POPOVER_WIDTH - POPOVER_GAP;
  let horizontalOrigin = "100%";

  if (left < POPOVER_MARGIN) {
    left = anchorRect.right + POPOVER_GAP;
    horizontalOrigin = "0%";
  }

  if (left + POPOVER_WIDTH > viewportWidth - POPOVER_MARGIN) {
    left = Math.max(POPOVER_MARGIN, viewportWidth - POPOVER_WIDTH - POPOVER_MARGIN);
  }

  let top = anchorRect.top - popoverHeight - POPOVER_GAP;
  let verticalOrigin = "100%";

  if (top < POPOVER_MARGIN) {
    top = anchorRect.bottom + POPOVER_GAP;
    verticalOrigin = "0%";
  }

  if (top + popoverHeight > viewportHeight - POPOVER_MARGIN) {
    top = Math.max(
      POPOVER_MARGIN,
      Math.min(
        anchorRect.top + anchorRect.height / 2 - popoverHeight / 2,
        viewportHeight - popoverHeight - POPOVER_MARGIN,
      ),
    );
    verticalOrigin = "50%";
  }

  return {
    left,
    top,
    transformOrigin: `${horizontalOrigin} ${verticalOrigin}`,
  };
}

export function UserProfilePopover(props: UserProfilePopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [profile, setProfile] = useState(() => getUserProfile());
  const [draftName, setDraftName] = useState("");
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function showSavedToast() {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }

    setToastMessage("已保存");
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, SAVE_TOAST_DURATION_MS);
  }

  function commitDraftName() {
    const nextName = draftName.trim().slice(0, 20) || null;
    const currentName = profile.name ?? null;
    const savedName = saveUserName(draftName);
    setDraftName(savedName ?? "");
    setProfile((current) => ({
      ...current,
      name: savedName,
    }));

    if (savedName !== currentName || nextName !== currentName) {
      showSavedToast();
    }
  }

  useEffect(() => {
    if (!props.open) {
      return;
    }

    const nextProfile = getUserProfile();
    setProfile(nextProfile);
    setDraftName(nextProfile.name ?? "");
    setPreviewAvatar(nextProfile.avatar);
  }, [props.open]);

  useEffect(() => {
    if (!props.open || !props.anchorRect || !popoverRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!props.anchorRect || !popoverRef.current) {
        return;
      }

      setPosition(getPopoverPosition(props.anchorRect, popoverRef.current.offsetHeight));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [props.anchorRect, props.open]);

  useEffect(() => {
    if (!props.open) {
      return;
    }

    const saveDraftNameOnClose = () => {
      const nextName = draftName.trim().slice(0, 20) || null;
      const currentName = profile.name ?? null;
      const savedName = saveUserName(draftName);
      setDraftName(savedName ?? "");
      setProfile((current) => ({
        ...current,
        name: savedName,
      }));

      if (savedName !== currentName || nextName !== currentName) {
        showSavedToast();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (popoverRef.current?.contains(event.target as Node)) {
        return;
      }

      saveDraftNameOnClose();
      props.onClose();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        saveDraftNameOnClose();
        props.onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [draftName, profile.name, props.open, props.onClose]);

  useEffect(() => {
    if (!props.open) {
      return;
    }

    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [props.open]);

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const nextAvatar = await buildAvatarDataUrl(file);
      setPreviewAvatar(nextAvatar);
      const savedAvatar = saveUserAvatar(nextAvatar);
      setProfile((current) => ({
        ...current,
        avatar: savedAvatar,
      }));
      showSavedToast();
    } catch (error) {
      console.error("[UserProfile] 保存头像失败:", error);
    } finally {
      event.target.value = "";
    }
  }

  function handleNameBlur() {
    commitDraftName();
  }

  const previewProfile = {
    avatar: previewAvatar,
    name: draftName.trim() || profile.name,
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const shouldRenderPopover = props.open && props.anchorRect !== null && position !== null;
  if (!shouldRenderPopover && !toastMessage) {
    return null;
  }

  if (typeof document === "undefined" || !document.body) {
    return null;
  }

  return createPortal(
    <>
      {shouldRenderPopover && position ? (
        <div
          ref={popoverRef}
          className="chat-user-profile-popover"
          style={{
            left: `${position.left}px`,
            top: `${position.top}px`,
            transformOrigin: position.transformOrigin,
          }}
        >
          <div className="chat-user-profile-popover__avatar-block">
            <button
              type="button"
              className="chat-user-profile-popover__avatar-button"
              onClick={() => {
                fileInputRef.current?.click();
              }}
            >
              {previewProfile.avatar ? (
                <img
                  alt="用户头像预览"
                  className="chat-user-profile-popover__avatar-image"
                  src={previewProfile.avatar}
                />
              ) : (
                <div className="chat-user-profile-popover__avatar-fallback">
                  {previewProfile.name ? (
                    <span>{getUserInitial(previewProfile)}</span>
                  ) : (
                    <UserRound className="h-8 w-8" />
                  )}
                </div>
              )}
              <span className="chat-user-profile-popover__avatar-overlay">
                <Camera className="h-4 w-4" />
                更换头像
              </span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>

          <div className="chat-user-profile-popover__field">
            <label className="chat-user-profile-popover__label" htmlFor="xiaban-user-name-input">
              昵称
            </label>
            <input
              ref={inputRef}
              id="xiaban-user-name-input"
              type="text"
              maxLength={20}
              value={draftName}
              placeholder="输入你的名字"
              className="chat-user-profile-popover__input"
              onChange={(event) => {
                setDraftName(event.target.value);
              }}
              onBlur={handleNameBlur}
            />
          </div>
        </div>
      ) : null}

      {toastMessage ? (
        <div className="chat-user-profile-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
