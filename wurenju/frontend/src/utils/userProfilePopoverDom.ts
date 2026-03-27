import {
  getUserInitial,
  getUserProfile,
  saveUserAvatar,
  saveUserName,
  type UserProfile,
} from "@/utils/userProfile";

const USER_PROFILE_POPOVER_ID = "xiaban-user-profile-popover";
const USER_PROFILE_OVERLAY_ID = "xiaban-user-profile-overlay";
const USER_PROFILE_NAME_INPUT_ID = "xiaban-user-profile-name-input";
const USER_PROFILE_FILE_INPUT_ID = "xiaban-user-profile-file-input";
const USER_PROFILE_DONE_BUTTON_ID = "xiaban-user-profile-done-button";
const POPOVER_WIDTH = 280;
const POPOVER_GAP = 12;
const POPOVER_MARGIN = 12;
const AVATAR_SIZE = 200;

type AnchorRect = Pick<DOMRect, "top" | "left" | "right" | "bottom" | "height">;

type PopoverPosition = {
  left: number;
  top: number;
  transformOrigin: string;
};

type PopoverInputKeydownEvent = Pick<KeyboardEvent, "key" | "preventDefault">;

let activePopoverCleanup: (() => void) | null = null;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderUserAvatarMarkup(profile: UserProfile) {
  if (profile.avatar) {
    return `<img class="chat-user-profile-popover__avatar-image" src="${escapeHtml(profile.avatar)}" alt="用户头像预览" />`;
  }

  return `<div class="chat-user-profile-popover__avatar-fallback"><span>${escapeHtml(getUserInitial(profile))}</span></div>`;
}

function removeExistingPopover() {
  activePopoverCleanup?.();
  activePopoverCleanup = null;
  if (typeof document === "undefined") {
    return;
  }

  document.getElementById(USER_PROFILE_OVERLAY_ID)?.remove();
  document.getElementById(USER_PROFILE_POPOVER_ID)?.remove();
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

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
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

function blobToDataUrl(blob: Blob) {
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

  const blob = await canvasToBlob(canvas, 0.8);
  return blobToDataUrl(blob);
}

export function getUserProfilePopoverPosition(
  anchorRect: AnchorRect,
  popoverHeight: number,
): PopoverPosition {
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

export function handleUserProfileNameInputKeydown(
  event: PopoverInputKeydownEvent,
  blur: () => void,
  onEnter: () => void,
) {
  if (event.key !== "Enter") {
    return false;
  }

  event.preventDefault();
  blur();
  onEnter();
  return true;
}

export function handleUserProfilePopoverActionEvent(
  event: Pick<Event, "preventDefault" | "stopPropagation"> | null | undefined,
  action: () => void,
) {
  event?.preventDefault();
  event?.stopPropagation();
  action();
}

export function openUserProfilePopover(anchorElement: HTMLElement) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  removeExistingPopover();
  console.log("avatar clicked");

  const profile = getUserProfile();
  const overlay = document.createElement("div");
  overlay.id = USER_PROFILE_OVERLAY_ID;
  overlay.className = "chat-user-profile-popover-overlay";
  const popover = document.createElement("div");
  popover.id = USER_PROFILE_POPOVER_ID;
  popover.className = "chat-user-profile-popover";
  popover.style.visibility = "hidden";
  popover.innerHTML = `
    <div class="chat-user-profile-popover__avatar-block">
      <button type="button" class="chat-user-profile-popover__avatar-button" data-popover-avatar-trigger="true">
        ${renderUserAvatarMarkup(profile)}
        <span class="chat-user-profile-popover__avatar-overlay">更换头像</span>
      </button>
      <input id="${USER_PROFILE_FILE_INPUT_ID}" type="file" accept="image/*" class="hidden" />
    </div>
    <div class="chat-user-profile-popover__field">
      <label class="chat-user-profile-popover__label" for="${USER_PROFILE_NAME_INPUT_ID}">昵称</label>
      <input
        id="${USER_PROFILE_NAME_INPUT_ID}"
        class="chat-user-profile-popover__input"
        type="text"
        maxlength="20"
        value="${escapeHtml(profile.name ?? "")}"
        placeholder="输入你的名字"
      />
    </div>
    <button
      id="${USER_PROFILE_DONE_BUTTON_ID}"
      type="button"
      class="chat-user-profile-popover__done"
    >
      完成
    </button>
  `;
  overlay.appendChild(popover);
  document.body.appendChild(overlay);

  const position = getUserProfilePopoverPosition(
    anchorElement.getBoundingClientRect(),
    popover.offsetHeight,
  );
  popover.style.left = `${position.left}px`;
  popover.style.top = `${position.top}px`;
  popover.style.transformOrigin = position.transformOrigin;
  popover.style.visibility = "visible";

  const avatarButton = popover.querySelector<HTMLButtonElement>(
    "[data-popover-avatar-trigger='true']",
  );
  const fileInput = popover.querySelector<HTMLInputElement>(`#${USER_PROFILE_FILE_INPUT_ID}`);
  const nameInput = popover.querySelector<HTMLInputElement>(`#${USER_PROFILE_NAME_INPUT_ID}`);
  const doneButton = popover.querySelector<HTMLButtonElement>(`#${USER_PROFILE_DONE_BUTTON_ID}`);

  const syncAvatarPreview = (nextProfile: UserProfile) => {
    if (avatarButton) {
      avatarButton.innerHTML = `
        ${renderUserAvatarMarkup(nextProfile)}
        <span class="chat-user-profile-popover__avatar-overlay">更换头像</span>
      `;
    }
  };

  const commitName = () => {
    if (!nameInput) {
      return;
    }
    const savedName = saveUserName(nameInput.value);
    nameInput.value = savedName ?? "";
  };

  const commitAndClose = () => {
    commitName();
    removeExistingPopover();
  };

  const handleEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    commitAndClose();
  };

  popover.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  overlay.addEventListener("click", (event) => {
    handleUserProfilePopoverActionEvent(event, commitAndClose);
  });

  avatarButton?.addEventListener("click", (event) => {
    handleUserProfilePopoverActionEvent(event, () => {
      fileInput?.click();
    });
  });

  fileInput?.addEventListener("change", async (event) => {
    event.stopPropagation();
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }

    try {
      const avatarDataUrl = await buildAvatarDataUrl(file);
      const savedAvatar = saveUserAvatar(avatarDataUrl);
      const nextProfile = {
        ...getUserProfile(),
        avatar: savedAvatar,
        name: nameInput?.value.trim() || getUserProfile().name,
      } satisfies UserProfile;
      syncAvatarPreview(nextProfile);
    } catch (error) {
      console.error("[UserProfile] 保存头像失败:", error);
    } finally {
      (event.target as HTMLInputElement).value = "";
    }
  });

  nameInput?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  nameInput?.addEventListener("blur", () => {
    commitName();
  });

  nameInput?.addEventListener("keydown", (event) => {
    event.stopPropagation();
    handleUserProfileNameInputKeydown(
      event,
      () => {
        nameInput.blur();
      },
      () => {
        commitAndClose();
      },
    );
  });

  doneButton?.addEventListener("click", (event) => {
    handleUserProfilePopoverActionEvent(event, commitAndClose);
  });

  window.requestAnimationFrame(() => {
    if (!nameInput) {
      return;
    }

    nameInput.focus();
    nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
  });
  document.addEventListener("keydown", handleEscape);

  activePopoverCleanup = () => {
    document.removeEventListener("keydown", handleEscape);
  };
}

export function closeUserProfilePopover() {
  removeExistingPopover();
}
