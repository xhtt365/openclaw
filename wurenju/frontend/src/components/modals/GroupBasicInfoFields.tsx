type GroupBasicInfoFieldsProps = {
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  namePlaceholder?: string;
  descriptionPlaceholder?: string;
};

export function GroupBasicInfoFields({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  namePlaceholder = "例如：产品讨论组",
  descriptionPlaceholder = "项目组的用途说明",
}: GroupBasicInfoFieldsProps) {
  const inputClassName =
    "w-full rounded-[18px] border border-[var(--border)] bg-[var(--card)] text-[15px] text-[var(--color-text-primary)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)] focus:shadow-[0_0_0_1px_var(--accent-glow)]";

  return (
    <div className="space-y-5">
      <label className="block">
        <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          项目组名称 <span className="text-[var(--danger)]">*</span>
        </div>
        <input
          value={name}
          onChange={(event) => {
            onNameChange(event.target.value);
          }}
          placeholder={namePlaceholder}
          className={`${inputClassName} h-[52px] px-5`}
        />
      </label>

      <label className="block">
        <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          描述（可选）
        </div>
        <textarea
          value={description}
          onChange={(event) => {
            onDescriptionChange(event.target.value);
          }}
          rows={5}
          placeholder={descriptionPlaceholder}
          className={`${inputClassName} resize-none px-5 py-4 leading-7`}
        />
      </label>
    </div>
  );
}
