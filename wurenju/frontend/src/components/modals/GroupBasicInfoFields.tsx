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
  return (
    <div className="space-y-5">
      <label className="block">
        <div className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          项目组名称 <span className="text-rose-400">*</span>
        </div>
        <input
          value={name}
          onChange={(event) => {
            onNameChange(event.target.value);
          }}
          placeholder={namePlaceholder}
          className="h-[52px] w-full rounded-[18px] border border-violet-400/25 bg-white/[0.03] px-5 text-[15px] text-[var(--color-text-primary)] outline-none transition-all duration-200 placeholder:text-[var(--color-text-secondary)] focus:border-violet-400/55 focus:bg-white/[0.05] focus:shadow-[0_0_0_1px_rgba(168,85,247,0.22)]"
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
          className="w-full resize-none rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-[15px] leading-7 text-[var(--color-text-primary)] outline-none transition-all duration-200 placeholder:text-[var(--color-text-secondary)] focus:border-violet-400/35 focus:bg-white/[0.05]"
        />
      </label>
    </div>
  );
}
